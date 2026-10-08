import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import { build, createDrawer, find, parse, pathOf } from '../src'
import type { Doc, Node } from '../src'
import { paint } from './paint'
import shop from '../examples/shop.ordi?raw'
import shapes from '../examples/shapes.ordi?raw'

// The playground: the text on the left, the drawing on the right, and both kept in step.
// It is for trying things out locally. It saves your text in this browser as you type.

const EXAMPLES: Record<string, string> = { shop, shapes }
const STORE = 'ordigram:playground'
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

let doc: Doc = parse('')
let path = readHash()
let byLine = new Map<number, Node>()
let markedLine = 0
let timings = { parse: 0, build: 0, draw: 0 }

const drawer = createDrawer(byId<SVGSVGElement>('canvas'), {
  onOpen: node => go(pathOf(node)),
  onHover: node => showLine(node && node.line > 0 ? node.line : 0),
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
  const open = find(doc, path)
  path = pathOf(open)
  const level = build(doc, open)
  const t1 = performance.now()
  drawer.show(level, how)
  timings.build = t1 - t0
  timings.draw = performance.now() - t1
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
  showLine(markedLine)
}

function showLine(line: number) {
  markedLine = line
  mark.style.display = line ? 'block' : 'none'
  mark.style.top = `${PAD + (line - 1) * LINE - src.scrollTop}px`
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
    const remove = Math.min(2, indent.length)
    if (!remove) return
    const caret = src.selectionStart
    src.setSelectionRange(lineStart, lineStart + remove)
    document.execCommand('delete')
    src.setSelectionRange(Math.max(lineStart, caret - remove), Math.max(lineStart, caret - remove))
  } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    type('\n' + indent)
  }
})

let queued = false
src.addEventListener('input', () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    picker.value = Object.keys(EXAMPLES).find(k => EXAMPLES[k] === src.value) ?? ''
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

function save() {
  try {
    localStorage.setItem(STORE, src.value)
  } catch {
    // Saving is a convenience. The page works without it.
  }
}

function load(text: string) {
  src.value = text
  path = []
  history.replaceState(null, '', '#/')
  update('new')
}

for (const name of ['', ...Object.keys(EXAMPLES)]) {
  picker.append(new Option(name || 'Your text', name, false, false))
}
picker.addEventListener('change', () => {
  if (picker.value) load(EXAMPLES[picker.value])
})
byId('reset').addEventListener('click', () => load(EXAMPLES[picker.value] ?? shop))

addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.activeElement !== src) up(path.length - 1)
})

let saved: string | null = null
try {
  saved = localStorage.getItem(STORE)
} catch {
  saved = null
}
src.value = saved ?? shop
picker.value = Object.keys(EXAMPLES).find(k => EXAMPLES[k] === src.value) ?? ''
// Wait for the fonts, so the first drawing is measured with the right one.
await Promise.all([
  document.fonts.load('600 14px "Figtree Variable"'),
  document.fonts.load('13px "JetBrains Mono Variable"'),
]).catch(() => {})
update('new')
