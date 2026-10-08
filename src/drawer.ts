import { hasInside, isBox, keyOf, pathOf } from './builder'
import type { Level, Link } from './builder'
import { layout } from './layout'
import type { Layout, Placed, Point, Route, Side } from './layout'
import { shapes } from './shapes'
import type { Shape } from './shapes'
import type { Arrow, Box, Node } from './types'

// The Drawer puts one level on screen as SVG.
// "new" draws a level from scratch. "update" keeps every element and moves it to its new place,
// so typing in the text moves the drawing instead of redrawing it.
// With `edit` set, the mouse can change the diagram too. The Drawer never changes anything itself:
// it reports what the mouse did, the page turns that into a text edit, and the new text is drawn.

export interface DrawerOptions {
  /** Called to open a box or an arrow that has an inside. */
  onOpen?: (node: Node) => void
  /** Called when the pointer enters a box or an arrow, and with null when it leaves. */
  onHover?: (node: Node | null) => void
  /** Called when the selection changes: one box, the arrows behind one arrow line, or nothing. */
  onSelect?: (nodes: Node[]) => void
  /** Turns on editing with the mouse. */
  edit?: Editing
}

/** What the mouse asks for. The page turns each one into a small edit of the text. */
export interface Editing {
  /** Boxes were dragged to here. Several move at once when several are selected. */
  move(moves: { box: Box; at: Point }[]): void
  /** Empty space was double-clicked here. */
  add(at: Point): void
  /** A line was dragged from a dot on one box onto a side of another. */
  connect(from: Box, to: Box, sides: { from: Side; to: Side }): void
  /** A new label was typed in place. */
  rename(node: Node, label: string): void
}

export interface Drawer {
  /** Draws a level. Use "new" when another level opens, "update" when the same level changed. */
  show(level: Level, how?: 'new' | 'update'): void
  /** Marks a node, or the nearest visible box around it. Null clears the mark. */
  highlight(node: Node | null): void
  /** Selects one box or arrow. Null clears the selection. */
  select(node: Node | null): void
  /** Starts typing a new label for a box or an arrow, in place. */
  rename(node: Node): void
  /** Fits the whole level in view. */
  fit(): void
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
  /** The sides it connects, from `from=` and `to=` on its line. */
  sides: { from: Side | null; to: Side | null }
}

interface NodeItem {
  kind: 'node'
  el: SVGGElement
  view: BoxView
  ring: SVGPathElement
  back: SVGPathElement
  body: SVGPathElement
  detail: SVGPathElement
  label: SVGTextElement
  sub: SVGTextElement
  /** The four dots to drag an arrow from, one on each side. */
  handles: SVGGElement[]
  title: SVGTitleElement
  text: string
}

interface LinkItem {
  kind: 'link'
  el: SVGGElement
  view: LinkView
  route: Route
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
  /** The keys of the elements that show each visible box or arrow. */
  shown: Map<Node, string[]>
  /** Where each box is, by key. */
  spots: Map<string, Placed>
  bounds: Layout['bounds']
  /** How the level is scaled and moved to sit in view. */
  view: { scale: number; tx: number; ty: number } | null
}

type Gesture =
  | { kind: 'press'; item: Item | null; x: number; y: number; go: boolean; add: boolean }
  | { kind: 'drag'; lead: NodeItem; items: { item: NodeItem; from: Point }[]; x: number; y: number }
  | { kind: 'wire'; item: NodeItem; side: Side; draft: SVGPathElement; target: NodeItem | null; targetSide: Side }
  | { kind: 'lasso'; start: Point; rect: SVGRectElement | null; x: number; y: number; base: Set<string> }

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
const asSide = (value: string | true | undefined): Side | null => (SIDES as unknown[]).includes(value) ? value as Side : null

let drawers = 0

export function createDrawer(svg: SVGSVGElement, options: DrawerOptions = {}): Drawer {
  const id = `o${++drawers}`
  svg.classList.add('ordigram')
  if (options.edit) svg.classList.add('o-editable')
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
  /** The keys of the marked elements. Keys stay the same from one edit to the next, so marks do too. */
  let marked: string[] = []
  /** The keys of the selected boxes and arrow lines. */
  let picked = new Set<string>()
  /** The boxes being dragged, and where they are now. */
  let dragging: Map<string, Point> | null = null
  let renaming: HTMLTextAreaElement | null = null
  let openedAt = 0

  // Text is measured to size the elements. If the font arrives after the first drawing, measure again.
  const refont = () => {
    widths.clear()
    if (scene && shown) {
      fill(scene, shown, true)
      fit(scene, true, false)
    }
  }
  document.fonts?.addEventListener('loadingdone', refont)

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
    const sub = out ? 'outside' : deep ? `${box.kids.filter(isBox).length} inside ›` : ''
    let textW = sub ? measure(sub, SUB_FONT) : 0
    for (const line of lines) textW = Math.max(textW, measure(line, LABEL_FONT))
    let [w, h] = shape.fit(Math.min(280, Math.max(120, textW + 40)), lines.length * LINE + (sub ? 17 : 0) + 30)
    const size = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(box.props.size ?? ''))
    if (size) [w, h] = [Number(size[1]), Number(size[2])]
    const key = (out ? 'out:' : 'box:') + keyOf(box)
    const at = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(box.props.at ?? ''))
    return {
      key, box, out, deep, shapeName, shape, lines, sub, w, h, color: colorOf(box.props.color),
      at: dragging?.get(key) ?? (at ? { x: Number(at[1]), y: Number(at[2]) } : null),
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
    const sided = link.arrows.find(a => asSide(a.props.from) || asSide(a.props.to))
    return {
      key: `link:${link.key}`, link, text, opens, flow: link.arrows.some(a => a.props.flow),
      tag: text ? { w: Math.ceil(measure(text, TAG_FONT)) + (opens ? 24 : 12), h: opens ? 24 : 18 } : null,
      sides: { from: asSide(sided?.props.from), to: asSide(sided?.props.to) },
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
    return { root, layers, items: new Map(), shown: new Map(), spots: new Map(), bounds: { x: 0, y: 0, w: 0, h: 0 }, view: null }
  }

  // New elements start see-through. fill() then makes the browser note that, and fades them in.
  let entering: Element[] = []

  const fill = (target: Scene, level: Level, glide: boolean) => {
    const boxes = [...level.boxes.map(b => boxView(b, false)), ...level.outside.map(b => boxView(b, true))]
    const keyOfBox = new Map(boxes.map(v => [v.box, v.key]))
    const links = level.links.map(linkView)
    const placed = layout(
      boxes.map(v => ({ key: v.key, w: v.w, h: v.h, at: v.at })),
      links.map(v => ({ key: v.key, from: keyOfBox.get(v.link.from)!, to: keyOfBox.get(v.link.to)!, label: v.tag, sides: v.sides })),
    )

    const seen = new Set<string>()
    target.shown = new Map()
    target.spots = placed.nodes
    const show = (node: Node, key: string) => {
      const keys = target.shown.get(node)
      if (keys) keys.push(key)
      else target.shown.set(node, [key])
    }

    for (const view of boxes) {
      const item = (target.items.get(view.key) as NodeItem | undefined) ?? enter(target, view.key, makeNode(), glide)
      drawNode(item, view, placed.nodes.get(view.key)!)
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
    const kept = new Set([...picked].filter(key => target.items.has(key)))
    if (kept.size !== picked.size) {
      picked = kept
      options.onSelect?.(pickedNodes())
    }
  }

  const enter = <T extends Item>(target: Scene, key: string, item: T, glide: boolean): T => {
    target.items.set(key, item)
    item.el.setAttribute('data-key', key)
    target.layers[item.kind === 'node' ? 'nodes' : item.kind === 'link' ? 'links' : 'tags'].append(item.el)
    if (glide) {
      item.el.classList.add('o-new')
      entering.push(item.el)
    }
    return item
  }

  const states = (key: string) =>
    (marked.includes(key) ? ' o-mark' : '') + (picked.has(key.replace(/^tag:/, '')) ? ' o-picked' : '')

  // ---------- boxes ----------

  const makeNode = (): NodeItem => {
    const el = make('g', { class: 'o-node' })
    const item: NodeItem = {
      kind: 'node', el, view: null!, text: '',
      ring: make('path', { class: 'o-ring' }, el),
      back: make('path', { class: 'o-back', transform: 'translate(4 4)' }, el),
      body: make('path', { class: 'o-body' }, el),
      detail: make('path', { class: 'o-detail' }, el),
      label: make('text', { class: 'o-label', 'text-anchor': 'middle' }, el),
      sub: make('text', { class: 'o-sub', 'text-anchor': 'middle' }, el),
      handles: SIDES.map(side => make('g', { class: 'o-handle', 'data-side': side }, el)),
      title: make('title', {}, el),
    }
    for (const handle of item.handles) {
      make('circle', { class: 'o-handle-hit', r: '9' }, handle)
      make('circle', { class: 'o-handle-dot', r: '4.5' }, handle)
    }
    el.addEventListener('pointerenter', () => options.onHover?.(item.view.box))
    el.addEventListener('pointerleave', () => options.onHover?.(null))
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
    el.setAttribute('class', cls + states(view.key))
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
    item.ring.setAttribute('d', shapes.box.outline(view.w + 12, view.h + 12))
    item.handles.forEach((handle, i) => {
      const n = NORMAL[SIDES[i]]
      handle.setAttribute('transform', `translate(${(n.x * view.w) / 2} ${(n.y * view.h) / 2})`)
    })

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
    item.sub.setAttribute('class', view.deep ? 'o-sub o-go' : 'o-sub')
    const where = view.out ? `${pathOf(view.box).join('/')} · outside this level` : `${view.box.id} · line ${view.box.line}`
    item.title.textContent = `${view.box.label ?? view.box.id}\n${where}`
  }

  // ---------- arrows ----------

  const makeLink = (): LinkItem => {
    const el = make('g', { class: 'o-link' })
    const item: LinkItem = {
      kind: 'link', el, view: null!, route: null!,
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
    item.route = route
    const { link } = view
    let cls = 'o-link'
    if (link.bubbled) cls += ' o-bubbled'
    if (view.flow) cls += ' o-flow'
    item.el.setAttribute('class', cls + states(view.key))
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
    return item
  }

  const drawTag = (item: TagItem, view: LinkView, at: Point) => {
    item.view = view
    const { w, h } = view.tag!
    let cls = 'o-tag'
    if (view.opens) cls += ' o-opens o-go'
    if (view.link.bubbled) cls += ' o-bubbled'
    item.el.setAttribute('class', cls + states(`tag:${view.key}`))
    item.el.style.transform = `translate(${at.x}px, ${at.y}px)`
    setAttrs(item.rect, { x: String(-w / 2), y: String(-h / 2), width: String(w), height: String(h), rx: view.opens ? '7' : '3' })
    item.text.textContent = view.text
  }

  // ---------- selection ----------

  const classFor = (key: string, cls: string, on: boolean) => {
    scene?.items.get(key)?.el.classList.toggle(cls, on)
    scene?.items.get(`tag:${key}`)?.el.classList.toggle(cls, on)
  }

  const setPicked = (keys: Set<string>) => {
    if (keys.size === picked.size && [...keys].every(key => picked.has(key))) return
    for (const key of picked) if (!keys.has(key)) classFor(key, 'o-picked', false)
    for (const key of keys) if (!picked.has(key)) classFor(key, 'o-picked', true)
    picked = keys
    options.onSelect?.(pickedNodes())
  }

  const pickedNodes = (): Node[] => {
    const nodes: Node[] = []
    for (const key of picked) {
      const item = scene?.items.get(key)
      if (item?.kind === 'node') nodes.push(item.view.box)
      else if (item?.kind === 'link') nodes.push(...item.view.link.arrows)
    }
    return nodes
  }

  // ---------- fitting and fading ----------

  /** Fits the level in view. Unless forced, the view stays put while everything still fits in it. */
  const fit = (target: Scene, glide: boolean, force: boolean) => {
    const { width, height } = svg.getBoundingClientRect()
    if (!width || !height) return
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const b = target.bounds
    if (!force && target.view) {
      const { scale, tx, ty } = target.view
      const margin = 12
      if (b.x * scale + tx >= margin && (b.x + b.w) * scale + tx <= width - margin
        && b.y * scale + ty >= margin && (b.y + b.h) * scale + ty <= height - margin) return
    }
    const pad = 56
    const scale = b.w && b.h ? Math.min(1.1, (width - pad * 2) / b.w, (height - pad * 2) / b.h) : 1
    const tx = width / 2 - (b.x + b.w / 2) * scale
    const ty = height / 2 - (b.y + b.h / 2) * scale
    target.view = { scale, tx, ty }
    target.root.style.transition = glide ? 'transform .35s ease' : 'none'
    target.root.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
  }

  const toScene = (x: number, y: number): Point => {
    const r = svg.getBoundingClientRect()
    const v = scene?.view ?? { scale: 1, tx: 0, ty: 0 }
    return { x: (x - r.left - v.tx) / v.scale, y: (y - r.top - v.ty) / v.scale }
  }

  const toScreen = (p: Point): Point => {
    const r = svg.getBoundingClientRect()
    const v = scene?.view ?? { scale: 1, tx: 0, ty: 0 }
    return { x: r.left + v.tx + p.x * v.scale, y: r.top + v.ty + p.y * v.scale }
  }

  // Another level: the old one fades out while the new one fades in.
  const fade = (old: Scene, next: Scene) => {
    old.root.style.pointerEvents = 'none'
    old.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })
    next.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
    // A timer, not the animation's promise: browsers hold that promise back while the page is not painted.
    setTimeout(() => old.root.remove(), 190)
  }

  // ---------- the mouse ----------

  let gesture: Gesture | null = null
  /** The last pointer position and Shift state, so pressing Shift alone can straighten a dragged box. */
  let last = { x: 0, y: 0, shift: false }

  const itemAt = (target: EventTarget | null): Item | null => {
    const el = target instanceof Element ? target.closest('[data-key]') : null
    return (el && scene?.items.get(el.getAttribute('data-key')!)) || null
  }

  const port = (spot: Placed, side: Side): Point => ({ x: spot.x + (NORMAL[side].x * spot.w) / 2, y: spot.y + (NORMAL[side].y * spot.h) / 2 })

  /** The side of a box nearest to a point. */
  const nearestSide = (spot: Placed, p: Point): Side => {
    let best: Side = 'right'
    let close = Infinity
    for (const side of SIDES) {
      const q = port(spot, side)
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < close) {
        close = d
        best = side
      }
    }
    return best
  }

  /** A curve that leaves one side square and arrives square at the other, as the layout draws them. */
  const draftPath = (p0: Point, n0: Point, p3: Point, n3: Point | null) => {
    const reach = Math.max(24, Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4)
    const c1 = { x: p0.x + n0.x * reach, y: p0.y + n0.y * reach }
    const c2 = n3 ? { x: p3.x + n3.x * reach, y: p3.y + n3.y * reach } : p3
    return `M${p0.x},${p0.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`
  }

  /**
   * With Shift held, a dragged box lines up with a box it is connected to, so the arrow between them
   * runs straight. It prefers an arrow coming in, then takes whichever line-up is the shortest move.
   */
  const straighten = (lead: NodeItem, at: Point, moving: Set<string>): Point => {
    if (!scene) return at
    const choices: { incoming: boolean; at: Point }[] = []
    for (const item of scene.items.values()) {
      if (item.kind !== 'link') continue
      const { link, sides } = item.view
      const incoming = link.to === lead.view.box
      if (!incoming && link.from !== lead.view.box) continue
      const otherKey = scene.shown.get(incoming ? link.from : link.to)?.[0]
      const other = otherKey && !moving.has(otherKey) ? scene.spots.get(otherKey) : undefined
      if (!other) continue
      const upright = (side: Side | null) => side === 'top' || side === 'bottom'
      const level = (side: Side | null) => side === 'left' || side === 'right'
      if (!(upright(sides.from) && upright(sides.to))) choices.push({ incoming, at: { x: at.x, y: other.y } })
      if (!(level(sides.from) && level(sides.to))) choices.push({ incoming, at: { x: other.x, y: at.y } })
    }
    const pool = choices.some(c => c.incoming) ? choices.filter(c => c.incoming) : choices
    let best = at
    let shortest = Infinity
    for (const choice of pool) {
      const d = Math.hypot(choice.at.x - at.x, choice.at.y - at.y)
      if (d < shortest) {
        shortest = d
        best = choice.at
      }
    }
    return best
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !scene || renaming) return
    svg.focus({ preventScroll: true })
    const target = e.target as Element
    const item = itemAt(target)
    const handle = target.closest('.o-handle')
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    last = { x: e.clientX, y: e.clientY, shift: e.shiftKey }
    if (options.edit && item?.kind === 'node' && !item.view.out && handle) {
      e.preventDefault()
      const side = handle.getAttribute('data-side') as Side
      gesture = { kind: 'wire', item, side, draft: make('path', { class: 'o-draft', 'marker-end': `url(#${id}-accent)` }, scene.root), target: null, targetSide: 'left' }
    } else if (!item) {
      gesture = { kind: 'lasso', start: toScene(e.clientX, e.clientY), rect: null, x: e.clientX, y: e.clientY, base: add ? new Set(picked) : new Set() }
    } else {
      gesture = { kind: 'press', item, x: e.clientX, y: e.clientY, go: !!target.closest('.o-go'), add }
    }
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    addEventListener('keydown', onShift)
    addEventListener('keyup', onShift)
  }

  const onShift = (e: KeyboardEvent) => {
    if (e.key !== 'Shift' || gesture?.kind !== 'drag') return
    last.shift = e.type === 'keydown'
    moveTo(last.x, last.y)
  }

  /** Moves the dragged boxes so the lead box follows the pointer, straightened when Shift is held. */
  const moveTo = (x: number, y: number) => {
    const drag = gesture
    if (drag?.kind !== 'drag' || !scene || !shown) return
    const scale = scene.view?.scale ?? 1
    const lead = drag.items.find(m => m.item === drag.lead)!
    let at = { x: lead.from.x + (x - drag.x) / scale, y: lead.from.y + (y - drag.y) / scale }
    if (last.shift) at = straighten(drag.lead, at, new Set(drag.items.map(m => m.item.view.key)))
    const dx = at.x - lead.from.x
    const dy = at.y - lead.from.y
    dragging = new Map(drag.items.map(m => [m.item.view.key, { x: Math.round(m.from.x + dx), y: Math.round(m.from.y + dy) }]))
    fill(scene, shown, false)
  }

  const onMove = (e: PointerEvent) => {
    if (!gesture || !scene || !shown) return
    last = { x: e.clientX, y: e.clientY, shift: e.shiftKey }
    if (gesture.kind === 'press') {
      const { item } = gesture
      if (!options.edit || item?.kind !== 'node' || item.view.out) return
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 4) return
      // Dragging a selected box moves the whole selection. Dragging another box selects it first.
      if (!picked.has(item.view.key)) setPicked(new Set(gesture.add ? [...picked, item.view.key] : [item.view.key]))
      const items: { item: NodeItem; from: Point }[] = []
      for (const key of picked) {
        const it = scene.items.get(key)
        const spot = scene.spots.get(key)
        if (it?.kind === 'node' && !it.view.out && spot) items.push({ item: it, from: { x: spot.x, y: spot.y } })
      }
      gesture = { kind: 'drag', lead: item, items, x: gesture.x, y: gesture.y }
      svg.classList.add('o-dragging')
    }
    if (gesture.kind === 'drag') moveTo(e.clientX, e.clientY)
    else if (gesture.kind === 'wire') {
      const from = scene.spots.get(gesture.item.view.key)!
      const pointer = toScene(e.clientX, e.clientY)
      const under = itemAt(document.elementFromPoint(e.clientX, e.clientY))
      const target = under?.kind === 'node' && under !== gesture.item ? under : null
      if (target !== gesture.target) {
        gesture.target?.el.classList.remove('o-target')
        target?.el.classList.add('o-target')
        gesture.target = target
      }
      const spot = target && scene.spots.get(target.view.key)
      if (target && spot) {
        // The side under the pointer, or else the side nearest to it.
        const handle = document.elementFromPoint(e.clientX, e.clientY)?.closest('.o-handle')
        const side = (handle?.getAttribute('data-side') as Side | null) ?? nearestSide(spot, pointer)
        gesture.targetSide = side
        target.handles.forEach((h, i) => h.classList.toggle('o-side', SIDES[i] === side))
        gesture.draft.setAttribute('d', draftPath(port(from, gesture.side), NORMAL[gesture.side], port(spot, side), NORMAL[side]))
      } else {
        gesture.draft.setAttribute('d', draftPath(port(from, gesture.side), NORMAL[gesture.side], pointer, null))
      }
    } else if (gesture.kind === 'lasso') {
      if (!gesture.rect && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 4) return
      gesture.rect ??= make('rect', { class: 'o-lasso' }, scene.root)
      const end = toScene(e.clientX, e.clientY)
      const left = Math.min(gesture.start.x, end.x)
      const top = Math.min(gesture.start.y, end.y)
      const right = Math.max(gesture.start.x, end.x)
      const bottom = Math.max(gesture.start.y, end.y)
      setAttrs(gesture.rect, { x: String(left), y: String(top), width: String(right - left), height: String(bottom - top) })
      // Every box the rectangle touches is selected, like files on a desktop.
      const keys = new Set(gesture.base)
      for (const item of scene.items.values()) {
        if (item.kind !== 'node' || item.view.out) continue
        const s = scene.spots.get(item.view.key)!
        if (s.x + s.w / 2 >= left && s.x - s.w / 2 <= right && s.y + s.h / 2 >= top && s.y - s.h / 2 <= bottom) keys.add(item.view.key)
      }
      setPicked(keys)
    }
  }

  const onUp = () => {
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onUp)
    removeEventListener('keydown', onShift)
    removeEventListener('keyup', onShift)
    const done = gesture
    gesture = null
    if (!done || !scene || !shown) return
    if (done.kind === 'drag') {
      svg.classList.remove('o-dragging')
      const moved = dragging!
      dragging = null
      const before = shown
      options.edit!.move(done.items.map(m => ({ box: m.item.view.box, at: moved.get(m.item.view.key)! })))
      // If the page did not draw the change, put the boxes back where the text says.
      if (shown === before) fill(scene, shown, false)
    } else if (done.kind === 'wire') {
      done.draft.remove()
      done.target?.el.classList.remove('o-target')
      done.target?.handles.forEach(h => h.classList.remove('o-side'))
      if (done.target) options.edit!.connect(done.item.view.box, done.target.view.box, { from: done.side, to: done.targetSide })
    } else if (done.kind === 'lasso') {
      done.rect?.remove()
      if (!done.rect) setPicked(done.base)
    } else {
      const { item } = done
      if (done.go && !done.add) {
        const node = item?.kind === 'node' ? item.view.box : item?.view.opens
        if (node) return options.onOpen?.(node)
      }
      if (!item || (item.kind === 'node' && item.view.out)) return
      const key = item.view.key
      if (!done.add) return setPicked(new Set([key]))
      const keys = new Set(picked)
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      setPicked(keys)
    }
  }

  const onDouble = (e: MouseEvent) => {
    // The first click may have opened another level. Ignore the second one landing there.
    if (!scene || renaming || performance.now() - openedAt < 500) return
    const item = itemAt(e.target)
    if (!item) {
      if (options.edit && e.target === svg) {
        const p = toScene(e.clientX, e.clientY)
        options.edit.add({ x: Math.round(p.x), y: Math.round(p.y) })
      }
      return
    }
    if (item.kind === 'node') {
      if (item.view.out) return
      if (item.view.deep) options.onOpen?.(item.view.box)
      else rename(item.view.box)
      return
    }
    const { arrows } = item.view.link
    if (arrows.length !== 1) return
    if (hasInside(arrows[0])) options.onOpen?.(arrows[0])
    else rename(arrows[0])
  }

  svg.addEventListener('pointerdown', onDown)
  svg.addEventListener('dblclick', onDouble)

  // ---------- typing a label in place ----------

  const rename = (node: Node) => {
    if (!options.edit || !scene) return
    const keys = scene.shown.get(node) ?? []
    const key = node.kind === 'box' ? keys[0] : keys.find(k => k.startsWith('tag:')) ?? keys[0]
    const item = key ? scene.items.get(key) : undefined
    if (!item || (item.kind === 'node' && item.view.out)) return
    renaming?.blur()

    // Where the element ends up, from the layout, not from the screen: it may still be sliding there.
    const scale = scene.view?.scale ?? 1
    const spot = item.kind === 'node' ? scene.spots.get(item.view.key)!
      : { ...(item.kind === 'tag' ? scene.items.get(item.view.key) as LinkItem : item).route.label, w: 140 / scale, h: 30 / scale }
    const middle = toScreen(spot)
    const rect = { left: middle.x - (spot.w * scale) / 2, top: middle.y - (spot.h * scale) / 2, width: spot.w * scale, height: spot.h * scale }

    const original = node.label ?? (node.kind === 'box' ? node.id : '')
    const input = document.createElement('textarea')
    input.className = 'o-rename'
    input.value = original
    input.spellcheck = false
    const w = Math.max(rect.width, 140)
    const h = Math.max(rect.height, 30)
    const lines = original.split('\n').length
    Object.assign(input.style, {
      left: `${rect.left + rect.width / 2 - w / 2}px`,
      top: `${rect.top + rect.height / 2 - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      fontSize: `${14 * scale}px`,
      lineHeight: `${LINE * scale}px`,
      paddingTop: `${Math.max(2, (h - lines * LINE * scale) / 2 - 2)}px`,
    })
    document.body.append(input)
    input.focus()
    input.select()
    renaming = input

    let finished = false
    const finish = (save: boolean) => {
      if (finished) return
      finished = true
      input.remove()
      renaming = null
      svg.focus({ preventScroll: true })
      if (save && input.value !== original) options.edit!.rename(node, input.value)
    }
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
  }

  const resize = new ResizeObserver(() => {
    if (scene) fit(scene, false, true)
  })
  resize.observe(svg)

  return {
    show(level, how = 'update') {
      shown = level
      if (how === 'update' && scene) {
        fill(scene, level, true)
        fit(scene, true, false)
      } else {
        const old = scene
        scene = newScene()
        picked = new Set()
        fill(scene, level, false)
        fit(scene, false, true)
        openedAt = performance.now()
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

    select(node) {
      const key = node ? scene?.shown.get(node)?.[0] : undefined
      setPicked(new Set(key ? [key] : []))
    },

    rename,

    fit() {
      if (scene) fit(scene, true, true)
    },

    destroy() {
      resize.disconnect()
      document.fonts?.removeEventListener('loadingdone', refont)
      renaming?.remove()
      svg.removeEventListener('pointerdown', onDown)
      svg.removeEventListener('dblclick', onDouble)
      svg.replaceChildren()
      svg.classList.remove('ordigram', 'o-editable')
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
  outline: none;
}
${s} .o-node, ${s} .o-tag { transition: transform .35s ease, opacity .2s; }
${s} .o-link, ${s} .o-dots { transition: opacity .2s; }
${s} .o-new, ${s} .o-gone { opacity: 0; }
${s} .o-gone { pointer-events: none; }
${s} .o-go { cursor: pointer; }

${s} .o-body { fill: var(--o-fill, var(--o-paper)); stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; transition: stroke .15s; }
/* The whole shape takes the pointer, even when it has no fill, like an outside box. */
${s} .o-body { pointer-events: all; }
${s} .o-back { fill: var(--o-fill, var(--o-back)); stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; }
${s} .o-detail { fill: none; stroke: var(--o-line, var(--o-border)); stroke-width: 1.2; }
${s} .o-shape-person .o-detail { stroke: var(--o-muted); stroke-width: 1.4; stroke-linecap: round; }
${s} .o-node:hover .o-body { stroke: var(--o-strong); }
${s} .o-label { fill: var(--o-ink); font: ${LABEL_FONT}; }
${s} .o-sub { fill: var(--o-muted); font: ${SUB_FONT}; }
${s} .o-sub.o-go:hover { fill: var(--o-mark); text-decoration: underline; }
${s} .o-out .o-body { fill: none; stroke: var(--o-edge-soft); stroke-dasharray: 5 4; }
${s} .o-out .o-detail { stroke: var(--o-edge-soft); }
${s} .o-out .o-label { fill: var(--o-muted); font-weight: 500; }
${s} .o-shape-text .o-body, ${s} .o-shape-text .o-back { fill: none; stroke: none; }
${s} .o-mark .o-body, ${s} .o-target .o-body, ${s} .o-node.o-mark:hover .o-body { stroke: var(--o-mark); stroke-width: 2; }
${s} .o-ring { fill: none; stroke: var(--o-mark); stroke-width: 1.5; opacity: 0; pointer-events: none; }
${s} .o-picked .o-ring { opacity: 1; }

${s} .o-line { fill: none; stroke: var(--o-edge); stroke-width: 1.4; stroke-linecap: round; transition: d .35s ease; }
${s} .o-hit { fill: none; stroke: transparent; stroke-width: 12; transition: d .35s ease; }
${s} .o-bubbled .o-line { stroke: var(--o-edge-soft); stroke-dasharray: 5 4; }
${s} .o-link:hover .o-line { stroke-width: 2; }
${s} .o-link.o-mark .o-line, ${s} .o-link.o-picked .o-line { stroke: var(--o-mark); stroke-width: 2; marker-end: url(#${id}-accent); }
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
${s} .o-tag.o-mark rect, ${s} .o-tag.o-picked rect { stroke: var(--o-mark); stroke-width: 1.2; }
${s} .o-tag.o-mark text, ${s} .o-tag.o-picked text { fill: var(--o-mark); }

${s} .o-handle { opacity: 0; cursor: crosshair; transition: opacity .12s; }
${s} .o-handle-hit { fill: transparent; }
${s} .o-handle-dot { fill: var(--o-paper); stroke: var(--o-mark); stroke-width: 1.5; transition: r .12s; }
${s} .o-handle:hover .o-handle-dot, ${s} .o-handle.o-side .o-handle-dot { fill: var(--o-mark); r: 5.5px; }
${s}:not(.o-editable) .o-handle, ${s} .o-out .o-handle, ${s}.o-dragging .o-handle { display: none; }
${s} .o-node:hover .o-handle, ${s} .o-picked .o-handle, ${s} .o-target .o-handle { opacity: 1; }
${s} .o-lasso { fill: color-mix(in srgb, var(--o-mark) 8%, transparent); stroke: var(--o-mark); stroke-width: 1; stroke-dasharray: 4 3; pointer-events: none; }
${s}.o-editable .o-node:not(.o-out) { cursor: grab; }
${s}.o-dragging, ${s}.o-dragging * { cursor: grabbing !important; }
${s}.o-dragging .o-node, ${s}.o-dragging .o-tag { transition: opacity .2s; }
${s}.o-dragging .o-line, ${s}.o-dragging .o-hit { transition: none; }
${s} .o-draft { fill: none; stroke: var(--o-mark); stroke-width: 1.6; stroke-dasharray: 5 4; pointer-events: none; }

.o-rename {
  position: fixed; z-index: 10; box-sizing: border-box; margin: 0; padding: 0 8px;
  border: 2px solid #4f6bed; border-radius: 10px; background: #ffffff; color: #1f1f1d;
  font-family: ${SANS}; font-weight: 600; text-align: center; resize: none; outline: none; overflow: hidden;
}
`
}
