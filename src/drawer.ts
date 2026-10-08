import { hasInside, isBox, keyOf, pathOf } from './builder'
import type { Level, Link } from './builder'
import { layout } from './layout'
import type { Layout, Placed, Point, Route } from './layout'
import { shapes } from './shapes'
import type { Shape } from './shapes'
import type { Arrow, Box, Node } from './types'

// The Drawer puts one level on screen as SVG: plain outlines, plain arrows, plain text.
// "new" draws a level from scratch. "update" keeps every element and moves it to its new place,
// so typing in the text moves the drawing instead of redrawing it.

export interface DrawerOptions {
  /** Called when someone clicks a box, or an arrow label, that has an inside. */
  onOpen?: (node: Node) => void
  /** Called when the pointer enters a box or an arrow, and with null when it leaves. */
  onHover?: (node: Node | null) => void
}

export interface Drawer {
  /** Draws a level. Use "new" when another level opens, "update" when the same level changed. */
  show(level: Level, how?: 'new' | 'update'): void
  /** Marks a node, or the nearest visible box around it. Null clears the mark. */
  highlight(node: Node | null): void
  destroy(): void
}

const NS = 'http://www.w3.org/2000/svg'
// Figtree when the page has it, otherwise the system's own font.
const SANS = '"Figtree Variable", Figtree, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const LABEL_FONT = `600 14px ${SANS}`
const SUB_FONT = `12px ${SANS}`
const TAG_FONT = `500 12px ${SANS}`
const LINE = 19
const TEXT_MAX = 190
/** Soft fills with a darker border of the same color, like sticky notes on a whiteboard. */
const PALETTE: Record<string, Paint> = {
  blue: { fill: '#e4ecfd', line: '#97b3ec' },
  green: { fill: '#e2f3e8', line: '#93cba8' },
  red: { fill: '#fbe4e1', line: '#e8a49c' },
  gold: { fill: '#fdf1cf', line: '#dfc160' },
  purple: { fill: '#ede7fb', line: '#b9a5e6' },
  grey: { fill: '#efefec', line: '#c2c2bb' },
}

interface Paint {
  fill: string
  line: string
}

interface BoxView {
  key: string
  box: Box
  out: boolean
  deep: boolean
  shapeName: string
  shape: Shape
  lines: string[]
  sub: string
  w: number
  h: number
  color: Paint | null
  at: Point | null
}

interface LinkView {
  key: string
  link: Link
  text: string
  opens: Arrow | null
  flow: boolean
  tag: { w: number; h: number } | null
}

interface NodeItem {
  kind: 'node'
  el: SVGGElement
  view: BoxView
  body: SVGPathElement
  back: SVGPathElement
  detail: SVGPathElement
  label: SVGTextElement
  sub: SVGTextElement
  title: SVGTitleElement
  text: string
}

interface LinkItem {
  kind: 'link'
  el: SVGGElement
  view: LinkView
  hit: SVGPathElement
  line: SVGPathElement
  dots: SVGGElement
  title: SVGTitleElement
}

interface TagItem {
  kind: 'tag'
  el: SVGGElement
  view: LinkView
  rect: SVGRectElement
  text: SVGTextElement
}

type Item = NodeItem | LinkItem | TagItem

interface Scene {
  root: SVGGElement
  layers: { links: SVGGElement; nodes: SVGGElement; tags: SVGGElement }
  items: Map<string, Item>
  /** The key of the element that shows each visible box or arrow. */
  shown: Map<Node, string[]>
  bounds: Layout['bounds']
}

let drawers = 0

export function createDrawer(svg: SVGSVGElement, options: DrawerOptions = {}): Drawer {
  const id = `o${++drawers}`
  svg.classList.add('ordigram')
  const defs = make('defs', {}, svg)
  make('style', {}, defs).textContent = css(id)
  for (const tone of ['line', 'soft', 'accent']) {
    const marker = make('marker', {
      id: `${id}-${tone}`, viewBox: '0 0 10 10', refX: '8.5', refY: '5',
      markerWidth: '9', markerHeight: '9', markerUnits: 'userSpaceOnUse', orient: 'auto',
    }, defs)
    make('path', { d: 'M0.5,1L9.5,5L0.5,9Q2.2,5 0.5,1Z', class: `o-tip-${tone}` }, marker)
  }

  const canvas = document.createElement('canvas').getContext('2d')!
  const widths = new Map<string, number>()
  const measure = (text: string, font: string) => {
    const key = font + '\u0000' + text
    let w = widths.get(key)
    if (w === undefined) {
      if (widths.size > 4000) widths.clear()
      canvas.font = font
      widths.set(key, (w = canvas.measureText(text).width))
    }
    return w
  }

  let scene: Scene | null = null
  let shown: Level | null = null

  // Text is measured to size the elements. If the font arrives after the first drawing, measure again.
  const refont = () => {
    widths.clear()
    if (scene && shown) {
      fill(scene, shown, true)
      fit(scene, true)
    }
  }
  document.fonts?.addEventListener('loadingdone', refont)
  /** The keys of the marked elements. Keys stay the same from one edit to the next, so marks do too. */
  let marked: string[] = []

  // ---------- sizes ----------

  const wrap = (text: string) => {
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (line && measure(next, LABEL_FONT) > TEXT_MAX) {
          lines.push(line)
          line = word
        } else line = next
      }
      lines.push(line)
    }
    return lines
  }

  const boxView = (box: Box, out: boolean): BoxView => {
    const asked = typeof box.props.shape === 'string' ? box.props.shape : 'box'
    const shapeName = shapes[asked] ? asked : 'box'
    const shape = shapes[shapeName]
    const deep = !out && hasInside(box)
    const lines = wrap(box.label ?? box.id)
    // A small second line says when there is more to see: what is inside, or that it lives elsewhere.
    const sub = out ? 'outside' : deep ? `${box.kids.filter(isBox).length} inside` : ''
    let textW = sub ? measure(sub, SUB_FONT) : 0
    for (const line of lines) textW = Math.max(textW, measure(line, LABEL_FONT))
    let [w, h] = shape.fit(Math.min(280, Math.max(120, textW + 40)), lines.length * LINE + (sub ? 17 : 0) + 30)
    const size = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(box.props.size ?? ''))
    if (size) [w, h] = [Number(size[1]), Number(size[2])]
    const at = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(box.props.at ?? ''))
    return {
      key: (out ? 'out:' : 'box:') + keyOf(box), box, out, deep, shapeName, shape, lines, sub, w, h,
      color: colorOf(box.props.color), at: at ? { x: Number(at[1]), y: Number(at[2]) } : null,
    }
  }

  const linkView = (link: Link): LinkView => {
    const first = link.arrows[0]
    const labels = link.arrows.map(a => a.label).filter(Boolean) as string[]
    const more = link.arrows.length - 1
    const opens = !more && hasInside(first) ? first : null
    let text = labels[0] ?? ''
    if (more) text = text ? `${text} +${more}` : `${more + 1} arrows`
    // An arrow that opens gets a small card with a chevron, like a box that opens gets a stacked card.
    if (opens) text = text ? `${text} ›` : 'open ›'
    return {
      key: `link:${link.key}`, link, text, opens, flow: link.arrows.some(a => a.props.flow),
      tag: text ? { w: Math.ceil(measure(text, TAG_FONT)) + (opens ? 24 : 12), h: opens ? 24 : 18 } : null,
    }
  }

  // ---------- one scene ----------

  const newScene = (): Scene => {
    const root = make('g', { class: 'o-scene' })
    const layers = {
      links: make('g', { class: 'o-links' }, root),
      nodes: make('g', { class: 'o-nodes' }, root),
      tags: make('g', { class: 'o-tags' }, root),
    }
    svg.append(root)
    return { root, layers, items: new Map(), shown: new Map(), bounds: { x: 0, y: 0, w: 0, h: 0 } }
  }

  // New elements start see-through. fill() then makes the browser note that, and fades them in.
  let entering: Element[] = []

  const fill = (target: Scene, level: Level, glide: boolean) => {
    const boxes = [...level.boxes.map(b => boxView(b, false)), ...level.outside.map(b => boxView(b, true))]
    const keyOfBox = new Map(boxes.map(v => [v.box, v.key]))
    const links = level.links.map(linkView)
    const placed = layout(
      boxes.map(v => ({ key: v.key, w: v.w, h: v.h, at: v.at })),
      links.map(v => ({ key: v.key, from: keyOfBox.get(v.link.from)!, to: keyOfBox.get(v.link.to)!, label: v.tag })),
    )

    const seen = new Set<string>()
    target.shown = new Map()
    const show = (node: Node, key: string) => {
      const keys = target.shown.get(node)
      if (keys) keys.push(key)
      else target.shown.set(node, [key])
    }

    for (const view of boxes) {
      const spot = placed.nodes.get(view.key)!
      const item = (target.items.get(view.key) as NodeItem | undefined) ?? enter(target, view.key, makeNode(), glide)
      drawNode(item, view, spot)
      seen.add(view.key)
      show(view.box, view.key)
    }
    for (const view of links) {
      const route = placed.edges.get(view.key)
      if (!route) continue
      const item = (target.items.get(view.key) as LinkItem | undefined) ?? enter(target, view.key, makeLink(), glide)
      drawLink(item, view, route)
      seen.add(view.key)
      const tagKey = `tag:${view.key}`
      if (view.tag) {
        const tag = (target.items.get(tagKey) as TagItem | undefined) ?? enter(target, tagKey, makeTag(), glide)
        drawTag(tag, view, route.label)
        seen.add(tagKey)
      }
      for (const arrow of view.link.arrows) {
        show(arrow, view.key)
        if (view.tag) show(arrow, tagKey)
      }
    }
    for (const [key, item] of target.items) {
      if (seen.has(key)) continue
      target.items.delete(key)
      if (glide) {
        item.el.classList.add('o-gone')
        setTimeout(() => item.el.remove(), 260)
      } else item.el.remove()
    }
    target.bounds = placed.bounds
    if (entering.length) {
      void getComputedStyle(entering[0]).opacity
      for (const el of entering) el.classList.remove('o-new')
      entering = []
    }
  }

  const enter = <T extends Item>(target: Scene, key: string, item: T, glide: boolean): T => {
    target.items.set(key, item)
    target.layers[item.kind === 'node' ? 'nodes' : item.kind === 'link' ? 'links' : 'tags'].append(item.el)
    if (glide) {
      item.el.classList.add('o-new')
      entering.push(item.el)
    }
    return item
  }

  // ---------- boxes ----------

  const makeNode = (): NodeItem => {
    const el = make('g', { class: 'o-node' })
    const item: NodeItem = {
      kind: 'node', el, view: null!, text: '',
      back: make('path', { class: 'o-back', transform: 'translate(4 4)' }, el),
      body: make('path', { class: 'o-body' }, el),
      detail: make('path', { class: 'o-detail' }, el),
      label: make('text', { class: 'o-label', 'text-anchor': 'middle' }, el),
      sub: make('text', { class: 'o-sub', 'text-anchor': 'middle' }, el),
      title: make('title', {}, el),
    }
    el.addEventListener('pointerenter', () => options.onHover?.(item.view.box))
    el.addEventListener('pointerleave', () => options.onHover?.(null))
    el.addEventListener('click', () => {
      if (item.view.deep) options.onOpen?.(item.view.box)
    })
    return item
  }

  const drawNode = (item: NodeItem, view: BoxView, spot: Placed) => {
    item.view = view
    const { el } = item
    const { shape } = view
    let cls = `o-node o-shape-${view.shapeName}`
    if (view.deep) cls += ' o-deep'
    if (view.out) cls += ' o-out'
    if (view.color) cls += ' o-colored'
    if (marked.includes(view.key)) cls += ' o-mark'
    el.setAttribute('class', cls)
    if (view.color) {
      el.style.setProperty('--o-fill', view.color.fill)
      el.style.setProperty('--o-line', view.color.line)
    } else {
      el.style.removeProperty('--o-fill')
      el.style.removeProperty('--o-line')
    }
    el.style.transform = `translate(${spot.x}px, ${spot.y}px)`

    const outline = shape.outline(view.w, view.h)
    item.body.setAttribute('d', outline)
    item.back.setAttribute('d', view.deep ? outline : '')
    item.detail.setAttribute('d', shape.detail?.(view.w, view.h) ?? '')

    const text = view.lines.join('\n') + '\u0000' + view.sub + '\u0000' + view.h + (shape.dy ?? 0)
    if (text !== item.text) {
      item.text = text
      const block = view.lines.length * LINE + (view.sub ? 17 : 0)
      const top = (shape.dy ?? 0) - block / 2 + 14
      item.label.replaceChildren(...view.lines.map((line, i) => {
        const span = make('tspan', { x: '0', y: String(top + i * LINE) })
        span.textContent = line
        return span
      }))
      item.sub.setAttribute('y', String(top + (view.lines.length - 1) * LINE + 18))
      item.sub.textContent = view.sub
    }
    const where = view.out ? `${pathOf(view.box).join('/')} · outside this level` : `${view.box.id} · line ${view.box.line}`
    item.title.textContent = `${view.box.label ?? view.box.id}\n${where}${view.deep ? ' · click to open' : ''}`
  }

  // ---------- arrows ----------

  const makeLink = (): LinkItem => {
    const el = make('g', { class: 'o-link' })
    const item: LinkItem = {
      kind: 'link', el, view: null!,
      hit: make('path', { class: 'o-hit' }, el),
      line: make('path', { class: 'o-line' }, el),
      dots: make('g', { class: 'o-dots' }, el),
      title: make('title', {}, el),
    }
    el.addEventListener('pointerenter', () => options.onHover?.(item.view.link.arrows[0]))
    el.addEventListener('pointerleave', () => options.onHover?.(null))
    return item
  }

  const drawLink = (item: LinkItem, view: LinkView, route: Route) => {
    item.view = view
    const { link } = view
    let cls = 'o-link'
    if (link.bubbled) cls += ' o-bubbled'
    if (view.flow) cls += ' o-flow'
    if (marked.includes(view.key)) cls += ' o-mark'
    item.el.setAttribute('class', cls)
    setPath(item.hit, route.d)
    setPath(item.line, route.d)
    item.line.setAttribute('marker-end', `url(#${id}-${link.bubbled ? 'soft' : 'line'})`)

    // Moving dots, at an even speed whatever the length.
    let length = 0
    for (let i = 1; i < route.points.length; i++) {
      length += Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].y - route.points[i - 1].y)
    }
    const dots = view.flow ? Math.max(2, Math.min(5, Math.round(length / 110))) : 0
    const seconds = Math.max(1.2, length / 90)
    if (item.dots.childElementCount !== dots) {
      item.dots.replaceChildren()
      for (let i = 0; i < dots; i++) {
        const dot = make('circle', { r: '2.5', class: 'o-dot' }, item.dots)
        make('animateMotion', { repeatCount: 'indefinite', calcMode: 'paced' }, dot)
      }
    }
    item.dots.querySelectorAll('animateMotion').forEach((motion, i) => {
      motion.setAttribute('path', route.d)
      motion.setAttribute('dur', `${seconds.toFixed(2)}s`)
      motion.setAttribute('begin', `${(-seconds * i / dots).toFixed(2)}s`)
    })

    item.title.textContent = link.arrows
      .map(a => `Line ${a.line}: ${a.fromRef} -> ${a.toRef}${a.label ? ` "${a.label}"` : ''}`)
      .join('\n') + (link.bubbled ? '\nDrawn here from deeper inside' : '')
  }

  const makeTag = (): TagItem => {
    const el = make('g', { class: 'o-tag' })
    const item: TagItem = {
      kind: 'tag', el, view: null!,
      rect: make('rect', {}, el),
      text: make('text', { 'text-anchor': 'middle', y: '4' }, el),
    }
    el.addEventListener('pointerenter', () => options.onHover?.(item.view.link.arrows[0]))
    el.addEventListener('pointerleave', () => options.onHover?.(null))
    el.addEventListener('click', () => {
      if (item.view.opens) options.onOpen?.(item.view.opens)
    })
    return item
  }

  const drawTag = (item: TagItem, view: LinkView, at: Point) => {
    item.view = view
    const { w, h } = view.tag!
    item.el.setAttribute('class', `o-tag${view.opens ? ' o-opens' : ''}${view.link.bubbled ? ' o-bubbled' : ''}${marked.includes(`tag:${view.key}`) ? ' o-mark' : ''}`)
    item.el.style.transform = `translate(${at.x}px, ${at.y}px)`
    setAttrs(item.rect, { x: String(-w / 2), y: String(-h / 2), width: String(w), height: String(h), rx: view.opens ? '7' : '3' })
    item.text.textContent = view.text
  }

  // ---------- fitting and fading ----------

  const fit = (target: Scene, glide: boolean) => {
    const { width, height } = svg.getBoundingClientRect()
    if (!width || !height) return
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const b = target.bounds
    const pad = 56
    const scale = b.w && b.h ? Math.min(1.1, (width - pad * 2) / b.w, (height - pad * 2) / b.h) : 1
    const tx = width / 2 - (b.x + b.w / 2) * scale
    const ty = height / 2 - (b.y + b.h / 2) * scale
    target.root.style.transition = glide ? 'transform .35s ease' : 'none'
    target.root.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
  }

  // Another level: the old one fades out while the new one fades in.
  const fade = (old: Scene, next: Scene) => {
    old.root.style.pointerEvents = 'none'
    old.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })
    next.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
    // A timer, not the animation's promise: browsers hold that promise back while the page is not painted.
    setTimeout(() => old.root.remove(), 190)
  }

  const resize = new ResizeObserver(() => {
    if (scene) fit(scene, false)
  })
  resize.observe(svg)

  return {
    show(level, how = 'update') {
      shown = level
      if (how === 'update' && scene) {
        fill(scene, level, true)
        fit(scene, true)
      } else {
        const old = scene
        scene = newScene()
        fill(scene, level, false)
        fit(scene, false)
        if (old) fade(old, scene)
      }
    },

    highlight(node) {
      if (!scene) return
      for (const key of marked) scene.items.get(key)?.el.classList.remove('o-mark')
      marked = []
      for (let n: Node | null = node; n; n = n.parent) {
        const keys = scene.shown.get(n)
        if (!keys) continue
        marked = keys
        for (const key of keys) scene.items.get(key)?.el.classList.add('o-mark')
        break
      }
    },

    destroy() {
      resize.disconnect()
      document.fonts?.removeEventListener('loadingdone', refont)
      svg.replaceChildren()
      svg.classList.remove('ordigram')
    },
  }
}

function colorOf(value: string | true | undefined): Paint | null {
  if (typeof value !== 'string') return null
  if (PALETTE[value]) return PALETTE[value]
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null
  return { fill: `color-mix(in srgb, ${value} 16%, #ffffff)`, line: `color-mix(in srgb, ${value} 60%, #ffffff)` }
}

function make<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag)
  setAttrs(el, attrs)
  parent?.append(el)
  return el
}

function setAttrs(el: Element, attrs: Record<string, string>) {
  for (const key in attrs) el.setAttribute(key, attrs[key])
}

/** Sets a path. Browsers that animate the CSS `d` property glide it to its new shape. */
function setPath(path: SVGPathElement, d: string) {
  path.setAttribute('d', d)
  path.style.setProperty('d', `path("${d}")`)
}

function css(id: string): string {
  const s = '.ordigram'
  return `
${s} {
  --o-canvas: #f4f4f1; --o-dot: #dadad3; --o-paper: #ffffff; --o-back: #ecebe6;
  --o-ink: #1f1f1d; --o-muted: #85857f; --o-border: #d2d2cb; --o-strong: #9a9a93;
  --o-edge: #8f8f88; --o-edge-soft: #bcbcb5; --o-mark: #4f6bed;
  background-color: var(--o-canvas);
  background-image: radial-gradient(var(--o-dot) 1px, transparent 1.3px);
  background-size: 20px 20px;
  font-family: ${SANS};
  user-select: none;
}
${s} .o-node, ${s} .o-tag { transition: transform .35s ease, opacity .2s; }
${s} .o-link, ${s} .o-dots { transition: opacity .2s; }
${s} .o-new, ${s} .o-gone { opacity: 0; }
${s} .o-deep, ${s} .o-opens { cursor: pointer; }

${s} .o-body { fill: var(--o-fill, var(--o-paper)); stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; transition: stroke .15s; }
${s} .o-back { fill: var(--o-fill, var(--o-back)); stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; }
${s} .o-detail { fill: none; stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; }
${s} .o-shape-person .o-detail { stroke: var(--o-muted); stroke-width: 1.4; stroke-linecap: round; }
${s} .o-node:hover .o-body { stroke: var(--o-strong); }
${s} .o-deep:hover .o-body { stroke: var(--o-ink); }
${s} .o-label { fill: var(--o-ink); font: ${LABEL_FONT}; }
${s} .o-sub { fill: var(--o-muted); font: ${SUB_FONT}; }
${s} .o-out .o-body { fill: none; stroke: var(--o-edge-soft); stroke-dasharray: 5 4; }
${s} .o-out .o-detail { stroke: var(--o-edge-soft); }
${s} .o-out .o-label { fill: var(--o-muted); font-weight: 500; }
${s} .o-shape-text .o-body, ${s} .o-shape-text .o-back { fill: none; stroke: none; }
${s} .o-mark .o-body, ${s} .o-node.o-mark:hover .o-body { stroke: var(--o-mark); stroke-width: 2; }

${s} .o-line { fill: none; stroke: var(--o-edge); stroke-width: 1.4; stroke-linecap: round; transition: d .35s ease; }
${s} .o-hit { fill: none; stroke: transparent; stroke-width: 12; transition: d .35s ease; }
${s} .o-bubbled .o-line { stroke: var(--o-edge-soft); stroke-dasharray: 5 4; }
${s} .o-link:hover .o-line { stroke-width: 2; }
${s} .o-link.o-mark .o-line { stroke: var(--o-mark); stroke-width: 2; marker-end: url(#${id}-accent); }
${s} .o-dot { fill: var(--o-edge); }
${s} .o-bubbled .o-dot { fill: var(--o-edge-soft); }
${s} .o-tip-line { fill: var(--o-edge); }
${s} .o-tip-soft { fill: var(--o-edge-soft); }
${s} .o-tip-accent { fill: var(--o-mark); }

${s} .o-tag rect { fill: var(--o-canvas); }
${s} .o-tag text { fill: var(--o-muted); font: ${TAG_FONT}; }
${s} .o-opens rect { fill: var(--o-paper); stroke: var(--o-border); stroke-width: 1.2; }
${s} .o-opens text { fill: var(--o-ink); }
${s} .o-opens:hover rect { stroke: var(--o-ink); }
${s} .o-tag.o-mark rect { stroke: var(--o-mark); }
${s} .o-tag.o-mark text { fill: var(--o-mark); }
`
}
