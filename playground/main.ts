import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import { addArrow, addBox, build, createDrawer, find, isBox, parse, pathOf, remove, setLabel, setProps, svgToPng, tidy } from '../src'
import type { Doc, Edit, Node } from '../src'
import { paint } from './paint'
import shop from '../examples/shop.ordi?raw'
import shapes from '../examples/shapes.ordi?raw'
import figtreeLatin from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url'

// The playground: the text on the left, the drawing on the right, and both kept in step.
// The mouse edits the text too: every drag, click and rename becomes a small text edit, so the
// browser's undo works for both, and the text stays the only truth.
// It is for trying things out locally. Each diagram keeps your changes in this browser as you go.

const EXAMPLES: Record<string, string> = { shop, shapes, blank: '# Double-click anywhere to add a box.\n' }
const STORE = 'ordigram:playground:v2'
const LINE = 20
const PAD = 12

const byId = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T
const src = byId<HTMLTextAreaElement>('src')
const paintEl = byId('paint')
const gutter = byId('gutter')
const mark = byId('mark')
const problems = byId('problems')
const crumbs = byId('crumbs')
const status = byId('status')
const picker = byId<HTMLSelectElement>('example')
const tidyButton = byId<HTMLButtonElement>('tidy')
const zoomLevel = byId('zoom-level')
const exportMenu = byId<HTMLDetailsElement>('export')

let doc: Doc = parse('')
let path = readHash()
let byLine = new Map<number, Node>()
let selection: Node[] = []
let hoverLine = 0
let timings = { parse: 0, build: 0, draw: 0 }
let scale = 1

const open = () => find(doc, path)

const drawer = createDrawer(byId<SVGSVGElement>('canvas'), {
  onOpen: node => go(pathOf(node)),
  onHover: node => {
    hoverLine = node && node.line > 0 ? node.line : 0
    markLine()
  },
  onView: next => {
    scale = next
    zoomLevel.textContent = `${Math.round(next * 100)}%`
  },
  onSelect: nodes => {
    selection = nodes
    if (nodes.length === 1) showInText(nodes[0].line)
    markLine()
  },
  edit: {
    move: moves => write(setProps(src.value, moves.map(({ box, at }) => ({ node: box, key: 'at', value: `${at.x},${at.y}` })))),
    add: at => {
      const { edit, id } = addBox(src.value, open(), { at: `${at.x},${at.y}` })
      write(edit)
      const box = find(doc, [...path, id])
      if (box.id === id) {
        drawer.select(box)
        drawer.rename(box)
      }
    },
    connect: (from, to, sides) => write(addArrow(src.value, open(), from, to, { from: sides.from, to: sides.to })),
    rename: (node, label) => write(setLabel(src.value, node, label)),
  },
})

// ---------- text to drawing ----------

function update(how: 'update' | 'new' = 'update') {
  const t0 = performance.now()
  doc = parse(src.value)
  timings.parse = performance.now() - t0
  byLine = new Map()
  const walk = (node: Node) => {
    for (const kid of node.kids) {
      byLine.set(kid.line, kid)
      walk(kid)
    }
  }
  walk(doc.root)
  draw(how)
  paintEditor()
  paintProblems()
  save()
}

function draw(how: 'update' | 'new') {
  const t0 = performance.now()
  const node = open()
  path = pathOf(node)
  const level = build(doc, node)
  const t1 = performance.now()
  drawer.show(level, how)
  timings.build = t1 - t0
  timings.draw = performance.now() - t1
  tidyButton.disabled = !node.kids.some(k => isBox(k) && k.props.at !== undefined)
  paintCrumbs()
  paintStatus()
  followCaret()
}

function go(next: string[]) {
  path = next
  draw('new')
  const hash = '#/' + path.map(encodeURIComponent).join('/')
  if (location.hash !== hash) history.pushState(null, '', hash)
}

function up(depth: number) {
  if (depth >= path.length) return
  go(path.slice(0, depth))
}

function readHash(): string[] {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

addEventListener('popstate', () => {
  path = readHash()
  draw('new')
})

// ---------- the mouse edits the text ----------

// Edits go through the text box, so they join its undo history. Focus goes back where it was.
let writing = false

function write(edit: Edit | null) {
  if (!edit) return
  const back = document.activeElement
  writing = true
  src.focus({ preventScroll: true })
  src.setSelectionRange(edit.from, edit.to)
  const done = edit.insert ? document.execCommand('insertText', false, edit.insert) : document.execCommand('delete')
  if (!done) src.setRangeText(edit.insert, edit.from, edit.to, 'end')
  // Put the text cursor at the start of the changed line, so the drawing lights up what changed.
  const at = edit.from + (/^\r?\n/.exec(edit.insert)?.[0].length ?? 0)
  const lineStart = src.value.lastIndexOf('\n', at - 1) + 1
  const indent = /^ */.exec(src.value.slice(lineStart))![0].length
  src.setSelectionRange(lineStart + indent, lineStart + indent)
  writing = false
  update()
  if (back instanceof HTMLElement || back instanceof SVGElement) back.focus({ preventScroll: true })
}

function undo(redo: boolean) {
  const back = document.activeElement
  writing = true
  src.focus({ preventScroll: true })
  document.execCommand(redo ? 'redo' : 'undo')
  writing = false
  update()
  if (back instanceof HTMLElement || back instanceof SVGElement) back.focus({ preventScroll: true })
}

tidyButton.addEventListener('click', () => {
  write(tidy(src.value, open()))
  drawer.fit()
})

addEventListener('keydown', e => {
  const target = e.target as Element
  const typing = target.matches('textarea, input, select')
  const command = e.ctrlKey || e.metaKey
  if (command && !typing && ['z', 'Z', 'y'].includes(e.key)) {
    e.preventDefault()
    undo(e.key === 'y' || e.shiftKey)
  } else if (typing) {
    return
  } else if (e.key === 'Escape') {
    if (selection.length) drawer.select(null)
    else up(path.length - 1)
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
    e.preventDefault()
    write(remove(src.value, doc, selection))
  } else if ((e.key === 'Enter' || e.key === 'F2') && selection.length === 1) {
    e.preventDefault()
    drawer.rename(selection[0])
  } else if (!command && (e.key === '+' || e.key === '=')) {
    drawer.zoom(1.25)
  } else if (!command && (e.key === '-' || e.key === '_')) {
    drawer.zoom(0.8)
  } else if (!command && e.key === '0') {
    drawer.fit()
  }
})

// ---------- text panel ----------

const split = document.querySelector('.split') as HTMLElement
const codeToggle = byId('code-toggle')
function showCode(show: boolean) {
  split.classList.toggle('no-code', !show)
  codeToggle.setAttribute('aria-pressed', String(show))
}
codeToggle.addEventListener('click', () => showCode(split.classList.contains('no-code')))
addEventListener('keydown', e => {
  if (e.key === '\\' && !e.ctrlKey && !e.metaKey && !(e.target as Element).matches('textarea, input, select')) showCode(split.classList.contains('no-code'))
})

// ---------- zoom ----------

byId('zoom-in').addEventListener('click', () => drawer.zoom(1.25))
byId('zoom-out').addEventListener('click', () => drawer.zoom(0.8))
byId('zoom-fit').addEventListener('click', () => drawer.fit())
zoomLevel.addEventListener('click', () => drawer.zoom(1 / scale))

// ---------- export ----------

// SVG and PNG carry the font inside them, so they look the same on a computer without it.
let fontFace: Promise<string> | null = null
function embeddedFont(): Promise<string> {
  fontFace ??= fetch(figtreeLatin)
    .then(response => response.blob())
    .then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(`@font-face { font-family: "Figtree Variable"; font-weight: 300 900; src: url(${reader.result}) format("woff2"); }`)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    }))
    .catch(() => '')
  return fontFace
}

/** The diagram's name, then the level, like shop-api.svg. */
function fileName(extension: string): string {
  return [saved.current, ...path].map(part => part.replace(/[^\w-]+/g, '_')).join('-') + '.' + extension
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

exportMenu.addEventListener('click', async e => {
  const as = (e.target as Element).closest('button')?.dataset.as
  if (!as) return
  exportMenu.open = false
  if (as === 'ordi') return download(new Blob([src.value], { type: 'text/plain' }), `${saved.current}.ordi`)
  const svg = drawer.toSvg({ fontFace: await embeddedFont() })
  if (as === 'svg') download(new Blob([svg], { type: 'image/svg+xml' }), fileName('svg'))
  else download(await svgToPng(svg), fileName('png'))
})
addEventListener('pointerdown', e => {
  if (exportMenu.open && !exportMenu.contains(e.target as Element)) exportMenu.open = false
})

// ---------- the editor ----------

function paintEditor() {
  const bad = new Map<number, string[]>()
  for (const e of doc.errors) bad.set(e.line, [...(bad.get(e.line) ?? []), e.message])
  paintEl.innerHTML = paint(src.value, new Set(bad.keys()))
  let lines = 1
  for (let i = src.value.indexOf('\n'); i !== -1; i = src.value.indexOf('\n', i + 1)) lines++
  let html = ''
  for (let n = 1; n <= lines; n++) {
    const messages = bad.get(n)
    html += messages ? `<div class="bad" title="${messages.join('\n').replace(/"/g, '&quot;')}">${n}</div>` : `<div>${n}</div>`
  }
  gutter.innerHTML = html
  syncScroll()
}

function syncScroll() {
  paintEl.scrollTop = src.scrollTop
  paintEl.scrollLeft = src.scrollLeft
  gutter.scrollTop = src.scrollTop
  markLine()
}

/** Lights up the line under the pointer, or else the line of what is selected. */
function markLine() {
  const line = hoverLine || (selection[0]?.line ?? 0)
  mark.style.display = line ? 'block' : 'none'
  mark.style.top = `${PAD + (line - 1) * LINE - src.scrollTop}px`
}

/** Puts the text cursor on a line and scrolls to it, without taking the keyboard away from the drawing. */
function showInText(line: number) {
  let offset = 0
  for (let n = 1; n < line; n++) offset = src.value.indexOf('\n', offset) + 1
  const indent = /^ */.exec(src.value.slice(offset))![0].length
  src.setSelectionRange(offset + indent, offset + indent)
  const top = (line - 1) * LINE
  if (top < src.scrollTop || top > src.scrollTop + src.clientHeight - LINE * 2) src.scrollTop = Math.max(0, top - src.clientHeight / 2)
  syncScroll()
  followCaret()
}

function lineAt(offset: number): number {
  let line = 1
  for (let i = src.value.indexOf('\n'); i !== -1 && i < offset; i = src.value.indexOf('\n', i + 1)) line++
  return line
}

function followCaret() {
  drawer.highlight(byLine.get(lineAt(src.selectionStart)) ?? null)
}

function moveCaret(line: number, col: number) {
  let offset = 0
  for (let n = 1; n < line; n++) offset = src.value.indexOf('\n', offset) + 1
  src.focus()
  src.setSelectionRange(offset + col - 1, offset + col - 1)
  src.scrollTop = Math.max(0, (line - 1) * LINE - src.clientHeight / 2)
  syncScroll()
  followCaret()
}

function type(text: string) {
  // execCommand keeps the browser's undo history. setRangeText is the fallback.
  if (!document.execCommand('insertText', false, text)) {
    src.setRangeText(text, src.selectionStart, src.selectionEnd, 'end')
    src.dispatchEvent(new Event('input'))
  }
}

src.addEventListener('keydown', e => {
  const lineStart = src.value.lastIndexOf('\n', src.selectionStart - 1) + 1
  const indent = /^ */.exec(src.value.slice(lineStart))![0]
  if (e.key === 'Tab') {
    e.preventDefault()
    if (!e.shiftKey) return type('  ')
    const drop = Math.min(2, indent.length)
    if (!drop) return
    const caret = src.selectionStart
    src.setSelectionRange(lineStart, lineStart + drop)
    document.execCommand('delete')
    src.setSelectionRange(Math.max(lineStart, caret - drop), Math.max(lineStart, caret - drop))
  } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    type('\n' + indent)
  }
})

let queued = false
src.addEventListener('input', () => {
  if (writing || queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    update()
  })
})
src.addEventListener('scroll', syncScroll)
document.addEventListener('selectionchange', () => {
  if (document.activeElement === src) followCaret()
})

// ---------- around the edges ----------

function paintCrumbs() {
  crumbs.replaceChildren()
  for (let depth = 0; depth <= path.length; depth++) {
    const node = find(doc, path.slice(0, depth))
    const name = depth === 0 ? 'Top' : node.kind === 'arrow' ? `${node.fromRef} -> ${node.toRef}` : node.id
    if (depth) crumbs.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '/' }))
    if (depth === path.length) {
      crumbs.append(Object.assign(document.createElement('span'), { className: 'here', textContent: name }))
    } else {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: name })
      button.addEventListener('click', () => up(depth))
      crumbs.append(button)
    }
  }
}

function paintProblems() {
  problems.replaceChildren(...doc.errors.map(e => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.innerHTML = `<span class="where">${e.line}:${e.col}</span>`
    button.append(e.message)
    button.addEventListener('click', () => moveCaret(e.line, e.col))
    item.append(button)
    return item
  }))
}

function paintStatus() {
  let boxes = 0
  let arrows = 0
  for (const node of byLine.values()) {
    if (node.kind === 'box') boxes++
    else arrows++
  }
  const ms = (n: number) => `${n < 1 ? n.toFixed(2) : n.toFixed(1)} ms`
  const errors = doc.errors.length
  status.innerHTML = [
    `${boxes} boxes`, `${arrows} arrows`,
    `parse ${ms(timings.parse)}`, `build ${ms(timings.build)}`, `draw ${ms(timings.draw)}`,
    errors ? `<span class="err">${errors} error${errors > 1 ? 's' : ''}</span>` : '<span class="ok">no errors</span>',
  ].map(s => `<span>${s}</span>`).join('')
}

// ---------- your diagrams ----------

// Every diagram keeps its own text, so switching between them loses nothing. Reset brings back the original.
interface Saved {
  current: string
  texts: Record<string, string>
}

function readSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    if (raw && EXAMPLES[raw.current] !== undefined && typeof raw.texts === 'object') return raw
  } catch {
    // Saving is a convenience. The page works without it.
  }
  return { current: 'shop', texts: {} }
}

const saved = readSaved()

function save() {
  saved.texts[saved.current] = src.value
  try {
    localStorage.setItem(STORE, JSON.stringify(saved))
  } catch {
    // Saving is a convenience. The page works without it.
  }
  for (const option of picker.options) {
    const text = saved.texts[option.value]
    option.text = option.value + (text !== undefined && text !== EXAMPLES[option.value] ? ' (edited)' : '')
  }
}

function load(text: string) {
  src.value = text
  path = []
  history.replaceState(null, '', '#/')
  update('new')
}

for (const name of Object.keys(EXAMPLES)) picker.append(new Option(name, name))
picker.addEventListener('change', () => {
  saved.current = picker.value
  load(saved.texts[picker.value] ?? EXAMPLES[picker.value])
})
byId('reset').addEventListener('click', () => load(EXAMPLES[saved.current]))

picker.value = saved.current
src.value = saved.texts[saved.current] ?? EXAMPLES[saved.current]
// Wait for the fonts, so the first drawing is measured with the right one.
await Promise.all([
  document.fonts.load('600 14px "Figtree Variable"'),
  document.fonts.load('13px "JetBrains Mono Variable"'),
]).catch(() => {})
update('new')
