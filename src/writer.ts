import { isBox, pathOf } from './builder'
import type { Box, Doc, Node } from './types'

// The Writer changes the text, so the text stays the only truth. Every mouse action becomes one of
// these edits, and then the text is parsed and drawn again, just like after typing.
// Each function returns the smallest replacement that does the job, so it is one step to undo.

/** Replace the text from `from` up to `to` with `insert`. */
export interface Edit {
  from: number
  to: number
  insert: string
}

export function apply(text: string, edit: Edit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

/** Sets a property on a node's line, like `at=120,80`. A null value removes it. */
export function setProp(text: string, node: Node, key: string, value: string | null): Edit | null {
  return setProps(text, [{ node, key, value }])
}

/** Sets properties on many lines at once, like moving several boxes. One edit, so one step to undo. */
export function setProps(text: string, changes: readonly { node: Node; key: string; value: string | null }[]): Edit | null {
  const lines = split(text)
  for (const { node, key, value } of changes) {
    const line = lines.list[node.line - 1]
    if (line === undefined) continue
    const { parts, end } = partsOf(line)
    const same = parts.filter(p => p.key === key)
    if (value === null) {
      lines.list[node.line - 1] = same.reverse().reduce(cut, line)
      continue
    }
    const token = `${key}=${valueText(value)}`
    const last = same[same.length - 1]
    lines.list[node.line - 1] = last ? line.slice(0, last.start) + token + line.slice(last.end) : line.slice(0, end) + ' ' + token + line.slice(end)
  }
  return change(text, join(lines))
}

/** Sets the label in quotes. An empty label removes it, and a box shows its id again. */
export function setLabel(text: string, node: Node, label: string): Edit | null {
  return onLine(text, node.line, line => {
    const { head, parts } = partsOf(line)
    const old = parts.find(p => p.key === null)
    if (!label) return old ? cut(line, old) : line
    if (old) return line.slice(0, old.start) + quote(label) + line.slice(old.end)
    return line.slice(0, head) + ' ' + quote(label) + line.slice(head)
  })
}

/** Adds a box inside `parent`, after its other boxes. It is named box1, box2, ... */
export function addBox(text: string, parent: Node, props: Record<string, string> = {}): { edit: Edit; id: string } {
  const taken = new Set(parent.kids.filter(isBox).map(k => k.id))
  let n = 1
  while (taken.has(`box${n}`)) n++
  const id = `box${n}`
  let line = `${id} "Box ${n}"`
  for (const [key, value] of Object.entries(props)) line += ` ${key}=${valueText(value)}`

  const lines = split(text)
  const boxes = parent.kids.filter(isBox)
  const at = boxes.length ? lastLine(boxes[boxes.length - 1])
    : parent.kids.length ? parent.kids[0].line - 1
    : parent.parent ? parent.line
    : lines.list.length
  lines.list.splice(at, 0, indentFor(lines, parent) + line)
  return { edit: change(text, join(lines))!, id }
}

/**
 * Adds an arrow inside `parent`, after everything else in it, with any properties given, like the
 * sides it connects: `from=right to=left`. Null when the ends can not be named from there.
 */
export function addArrow(text: string, parent: Node, from: Box, to: Box, props: Record<string, string> = {}): Edit | null {
  if (from === to) return null
  const a = nameFrom(parent, from)
  const b = nameFrom(parent, to)
  if (!a || !b) return null
  let line = `${a} -> ${b}`
  for (const [key, value] of Object.entries(props)) line += ` ${key}=${valueText(value)}`
  const lines = split(text)
  const at = parent.kids.length ? lastLine(parent.kids[parent.kids.length - 1]) : parent.parent ? parent.line : lines.list.length
  lines.list.splice(at, 0, indentFor(lines, parent) + line)
  return change(text, join(lines))
}

/**
 * Removes nodes with everything inside them. Arrows that start or end at a removed box, or anywhere
 * inside one, are removed too, wherever they are written.
 */
export function remove(text: string, doc: Doc, nodes: readonly Node[]): Edit | null {
  const removed = new Set<Node>(nodes)
  const gone = new Set<number>()
  const drop = (node: Node) => {
    for (let line = node.line, last = lastLine(node); line <= last; line++) gone.add(line)
  }
  const isGone = (box: Box | null) => {
    for (let n: Node | null = box; n; n = n.parent) if (removed.has(n)) return true
    return false
  }
  for (const node of nodes) if (node.parent) drop(node)
  for (const arrow of doc.arrows) if (isGone(arrow.from) || isGone(arrow.to)) drop(arrow)
  const lines = split(text)
  lines.list = lines.list.filter((_, i) => !gone.has(i + 1))
  return change(text, join(lines))
}

/** Removes `at=` from every box directly inside `open`, so the automatic layout places them again. */
export function tidy(text: string, open: Node): Edit | null {
  const lines = split(text)
  for (const kid of open.kids) {
    if (!isBox(kid) || kid.props.at === undefined) continue
    const line = lines.list[kid.line - 1]
    lines.list[kid.line - 1] = partsOf(line).parts.filter(p => p.key === 'at').reverse().reduce(cut, line)
  }
  return change(text, join(lines))
}

// ---------- names ----------

/** The shortest path that finds `target` when written inside `scope`, following rule 4. */
function nameFrom(scope: Node, target: Box): string | null {
  const path = pathOf(target)
  for (let k = path.length - 1; k >= 0; k--) {
    if (path[k].includes('->')) break // a path can not go through an arrow
    const name = path.slice(k).join('/')
    if (find(scope, name) === target) return name
  }
  return null
}

function find(scope: Node, name: string): Box | null {
  const parts = name.split('/')
  const kid = (node: Node, id: string) => node.kids.find(k => isBox(k) && k.id === id) as Box | undefined
  let box: Box | undefined
  for (let s: Node | null = scope; s && !box; s = s.parent) box = kid(s, parts[0])
  for (let i = 1; box && i < parts.length; i++) box = kid(box, parts[i])
  return box ?? null
}

// ---------- lines ----------

interface Lines {
  list: string[]
  eol: string
  trailing: boolean
}

function split(text: string): Lines {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const list = text === '' ? [] : text.split(/\r?\n/)
  const trailing = list.length > 0 && list[list.length - 1] === ''
  if (trailing) list.pop()
  return { list, eol, trailing }
}

function join(lines: Lines): string {
  return lines.list.join(lines.eol) + (lines.trailing ? lines.eol : '')
}

/** The smallest edit that turns `before` into `after`. */
function change(before: string, after: string): Edit | null {
  if (before === after) return null
  const most = Math.min(before.length, after.length)
  let start = 0
  while (start < most && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end < most - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

function onLine(text: string, line: number, edit: (line: string) => string): Edit | null {
  const lines = split(text)
  const old = lines.list[line - 1]
  if (old === undefined) return null
  lines.list[line - 1] = edit(old)
  return change(text, join(lines))
}

/** The last line that belongs to a node: its own, or the last one of anything inside it. */
function lastLine(node: Node): number {
  let last = node.line
  for (const kid of node.kids) last = Math.max(last, lastLine(kid))
  return last
}

/** The indentation for a new line inside `parent`: the same as the lines already there, or one step deeper. */
function indentFor(lines: Lines, parent: Node): string {
  const lead = (line: number) => /^ */.exec(lines.list[line - 1] ?? '')![0]
  if (parent.kids.length) return lead(parent.kids[0].line)
  return parent.parent ? lead(parent.line) + '  ' : ''
}

// ---------- inside one line ----------

/** One label (key null) or one property on a line, by position. */
interface Part {
  start: number
  end: number
  key: string | null
}

/** Where the id (or "from -> to") ends, and where every label and property sits. Same rules as the Parser. */
function partsOf(line: string): { head: number; parts: Part[]; end: number } {
  const n = line.length
  const isPathChar = (i: number) => /[\w/-]/.test(line[i]) && !(line[i] === '-' && line[i + 1] === '>')
  const skip = (i: number) => {
    while (i < n && (line[i] === ' ' || line[i] === '\t')) i++
    return i
  }
  const string = (i: number) => {
    for (i++; i < n && line[i] !== '"'; i++) if (line[i] === '\\') i++
    return Math.min(i + 1, n)
  }
  let i = skip(0)
  while (i < n && isPathChar(i)) i++
  const arrow = skip(i)
  if (line.startsWith('->', arrow)) {
    i = skip(arrow + 2)
    while (i < n && isPathChar(i)) i++
  }
  const head = i
  const parts: Part[] = []
  let end = head
  for (;;) {
    const before = i
    i = skip(i)
    if (i >= n || (line[i] === '#' && i > before)) break
    const start = i
    if (line[i] === '"') {
      i = string(i)
      parts.push({ start, end: i, key: null })
    } else if (/[A-Za-z_]/.test(line[i])) {
      while (i < n && /[\w-]/.test(line[i])) i++
      const key = line.slice(start, i)
      if (line[i] === '=') {
        i++
        if (line[i] === '"') i = string(i)
        else while (i < n && line[i] !== ' ' && line[i] !== '\t') i++
      }
      parts.push({ start, end: i, key })
    } else {
      while (i < n && line[i] !== ' ' && line[i] !== '\t') i++
      continue
    }
    end = i
  }
  return { head, parts, end }
}

/** Removes one part and the space before it. */
function cut(line: string, part: Part): string {
  const start = part.start > 0 && line[part.start - 1] === ' ' ? part.start - 1 : part.start
  return line.slice(0, start) + line.slice(part.end)
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function valueText(value: string): string {
  return /^[^\s"]+$/.test(value) ? value : quote(value)
}
