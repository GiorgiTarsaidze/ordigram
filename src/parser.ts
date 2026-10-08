import type { Arrow, Box, Doc, Node, ParseError, Props } from './types'

// The Parser turns text into a tree of nodes, in one pass over the characters.
// It never stops at an error: a broken line and the lines inside it are skipped, the rest is kept.

const TAB = 9
const CR = 13
const SPACE = 32
const QUOTE = 34
const HASH = 35
const MINUS = 45
const SLASH = 47
const EQUALS = 61
const GT = 62
const BACKSLASH = 92
const LETTER_N = 110

const isSpace = (c: number) => c === SPACE || c === TAB
const isIdStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95
const isIdChar = (c: number) => isIdStart(c) || (c >= 48 && c <= 57) || c === MINUS

// Most nodes have nothing inside and no properties. They all share these two, which saves memory.
const NO_KIDS: readonly Node[] = Object.freeze([])
const NO_PROPS: Readonly<Props> = Object.freeze(Object.create(null))

function addKid(parent: Node, kid: Node) {
  if (parent.kids === NO_KIDS) parent.kids = [kid]
  else (parent.kids as Node[]).push(kid)
}

function setProp(node: Node, key: string, value: string | true) {
  if (node.props === NO_PROPS) node.props = Object.create(null)
  ;(node.props as Props)[key] = value
}

export function parse(text: string): Doc {
  const root: Box = { kind: 'box', id: '', label: null, props: NO_PROPS, kids: NO_KIDS, parent: null, line: 0 }
  const errors: ParseError[] = []
  const arrows: Arrow[] = []
  const fromCols: number[] = []
  const toCols: number[] = []
  const boxesIn = new Map<Node, Map<string, Box>>()
  const arrowsIn = new Map<Node, Map<string, number>>()

  // The open nodes, outermost first. Lines indented deeper than a node's indent go inside it.
  // A null node is a broken line: everything inside it is skipped.
  const openNode: (Node | null)[] = [root]
  const openIndent: number[] = [-1]
  const kidIndent: number[] = [-1]
  let open = 1
  const push = (node: Node | null, indent: number) => {
    openNode[open] = node
    openIndent[open] = indent
    kidIndent[open] = -1
    open++
  }

  let line = 0
  let start = 0

  const fail = (at: number, message: string) => {
    errors.push({ line, col: at - start + 1, message })
  }

  const skipSpaces = (i: number, end: number) => {
    while (i < end && isSpace(text.charCodeAt(i))) i++
    return i
  }

  // An id or a path like api/orders. Stops before "->", since "-" is also allowed in ids.
  const scanPath = (i: number, end: number) => {
    while (i < end) {
      const c = text.charCodeAt(i)
      if (c === MINUS && text.charCodeAt(i + 1) === GT) break
      if (!isIdChar(c) && c !== SLASH) break
      i++
    }
    return i
  }

  // Reads "..." starting at the opening quote. Returns where it ends, and leaves the text in `value`.
  let value = ''
  const scanString = (i: number, end: number) => {
    let out = ''
    let from = i + 1
    for (let k = from; k < end; k++) {
      const c = text.charCodeAt(k)
      if (c === QUOTE) {
        value = out + text.slice(from, k)
        return k + 1
      }
      if (c === BACKSLASH && k + 1 < end) {
        const n = text.charCodeAt(k + 1)
        out += text.slice(from, k) + (n === LETTER_N ? '\n' : n === QUOTE || n === BACKSLASH ? text[k + 1] : text.slice(k, k + 2))
        from = ++k + 1
      }
    }
    fail(i, 'This text has no closing quote.')
    value = out + text.slice(from, end)
    return end
  }

  // Every part of a path must start like an id. Checked in place, without splitting the path.
  const checkPath = (from: number, to: number) => {
    let partStart = true
    for (let k = from; k < to; k++) {
      const c = text.charCodeAt(k)
      if (partStart) {
        if (c === SLASH) break
        if (!isIdStart(c)) {
          const slash = text.indexOf('/', k)
          fail(k, `"${text.slice(k, slash === -1 || slash > to ? to : slash)}" must start with a letter or "_".`)
          return false
        }
        partStart = false
      } else if (c === SLASH) partStart = true
    }
    if (!partStart) return true
    fail(from, `"${text.slice(from, to)}" has an empty part. Write paths like api/orders.`)
    return false
  }

  // The label and the properties after the id, or after "from -> to".
  const readRest = (i: number, end: number, node: Node) => {
    for (;;) {
      const before = i
      i = skipSpaces(i, end)
      if (i >= end) return
      const c = text.charCodeAt(i)
      if (c === HASH && i > before) return
      if (i === before) {
        fail(i, 'Put a space here.')
        while (i < end && !isSpace(text.charCodeAt(i))) i++
        continue
      }
      if (c === QUOTE) {
        const at = i
        i = scanString(i, end)
        if (node.label === null) node.label = value
        else fail(at, 'A node has only one label. Put more text in a property, like note="...".')
      } else if (isIdStart(c)) {
        const keyStart = i
        while (i < end && isIdChar(text.charCodeAt(i))) i++
        const key = text.slice(keyStart, i)
        if (text.charCodeAt(i) !== EQUALS) {
          setProp(node, key, true)
          continue
        }
        i++
        if (i >= end || isSpace(text.charCodeAt(i))) {
          fail(keyStart, `"${key}=" needs a value.`)
          continue
        }
        if (text.charCodeAt(i) === QUOTE) {
          i = scanString(i, end)
          setProp(node, key, value)
        } else {
          const valueStart = i
          while (i < end && !isSpace(text.charCodeAt(i))) i++
          setProp(node, key, text.slice(valueStart, i))
        }
      } else if (c === MINUS && text.charCodeAt(i + 1) === GT) {
        return fail(i, 'One arrow per line. Write the next arrow on its own line.')
      } else {
        fail(i, `Unexpected "${text[i]}".`)
        while (i < end && !isSpace(text.charCodeAt(i))) i++
      }
    }
  }

  // A whole line, from its first character after the indentation. Returns null if it is broken.
  const readNode = (i: number, end: number, parent: Node): Node | null => {
    const firstAt = i
    i = scanPath(i, end)
    if (i === firstAt) {
      const c = text.charCodeAt(i)
      fail(i, c === QUOTE ? 'A line starts with an id, then the label: web "Web app".'
        : c === MINUS && text.charCodeAt(i + 1) === GT ? 'An arrow needs a start before "->".'
        : `Unexpected "${text[i]}". A line starts with an id, like: web "Web app".`)
      return null
    }
    const firstEnd = i
    const j = skipSpaces(i, end)
    let node: Node

    if (text.charCodeAt(j) === MINUS && text.charCodeAt(j + 1) === GT) {
      const toAt = skipSpaces(j + 2, end)
      i = scanPath(toAt, end)
      if (i === toAt) return fail(toAt, 'An arrow needs an end after "->".'), null
      if (!checkPath(firstAt, firstEnd) || !checkPath(toAt, i)) return null
      const fromRef = text.slice(firstAt, firstEnd)
      const toRef = text.slice(toAt, i)
      const id = `${fromRef}->${toRef}`
      let seen = arrowsIn.get(parent)
      if (!seen) arrowsIn.set(parent, (seen = new Map()))
      const n = (seen.get(id) ?? 0) + 1
      seen.set(id, n)
      node = {
        kind: 'arrow', id: n === 1 ? id : `${id}#${n}`, label: null, props: NO_PROPS, kids: NO_KIDS, parent, line,
        fromRef, toRef, from: null, to: null,
      }
      arrows.push(node)
      fromCols.push(firstAt - start + 1)
      toCols.push(toAt - start + 1)
    } else {
      const id = text.slice(firstAt, firstEnd)
      if (id.includes('/')) return fail(firstAt, 'A box id can not contain "/". To connect two boxes, write a -> b.'), null
      if (!isIdStart(text.charCodeAt(firstAt))) return fail(firstAt, `"${id}" must start with a letter or "_".`), null
      let boxes = boxesIn.get(parent)
      if (boxes?.has(id)) return fail(firstAt, `"${id}" is already used here.`), null
      node = { kind: 'box', id, label: null, props: NO_PROPS, kids: NO_KIDS, parent, line }
      if (!boxes) boxesIn.set(parent, (boxes = new Map()))
      boxes.set(id, node)
    }

    readRest(i, end, node)
    addKid(parent, node)
    return node
  }

  const readLine = (end: number) => {
    let i = start
    while (i < end && text.charCodeAt(i) === SPACE) i++
    if (i === end) return
    const c = text.charCodeAt(i)
    if (c === HASH) return
    if (c === TAB) return fail(i, 'Indent with spaces, not tabs.')

    const indent = i - start
    while (openIndent[open - 1] >= indent) open--
    const top = open - 1
    if (kidIndent[top] === -1) kidIndent[top] = indent
    else if (kidIndent[top] !== indent && openNode[top]) {
      fail(i, `This line is indented ${indent} spaces, but the lines next to it use ${kidIndent[top]}.`)
      return push(null, indent)
    }
    const parent = openNode[top]
    push(parent && readNode(i, end, parent), indent)
  }

  for (;;) {
    let end = text.indexOf('\n', start)
    const last = end === -1
    if (last) end = text.length
    line++
    readLine(end > start && text.charCodeAt(end - 1) === CR ? end - 1 : end)
    if (last) break
    start = end + 1
  }

  // Rule 4: find what each arrow points at, now that every box is known.
  // Walks the path in place: the first part is looked up from the arrow outwards, the rest go inside.
  const lookup = (path: string, scope: Node, line: number, col: number): Box | null => {
    let cut = path.indexOf('/')
    const head = cut === -1 ? path : path.slice(0, cut)
    let box: Box | undefined
    for (let s: Node | null = scope; s && !box; s = s.parent) box = boxesIn.get(s)?.get(head)
    if (!box) {
      const names: string[] = []
      for (let s: Node | null = scope; s; s = s.parent) names.push(...(boxesIn.get(s)?.keys() ?? []))
      errors.push({ line, col, message: `Can not find "${head}".${hint(head, names)}` })
      return null
    }
    while (cut !== -1) {
      const from = cut + 1
      cut = path.indexOf('/', from)
      const part = cut === -1 ? path.slice(from) : path.slice(from, cut)
      const inside = boxesIn.get(box)
      const next: Box | undefined = inside?.get(part)
      if (!next) {
        errors.push({ line, col: col + from, message: `"${box.id}" has no "${part}" inside.${hint(part, [...(inside?.keys() ?? [])])}` })
        return null
      }
      box = next
    }
    return box
  }

  arrows.forEach((arrow, k) => {
    const from = lookup(arrow.fromRef, arrow.parent!, arrow.line, fromCols[k])
    const to = lookup(arrow.toRef, arrow.parent!, arrow.line, toCols[k])
    if (!from || !to) return
    if (from === to) {
      errors.push({ line: arrow.line, col: fromCols[k], message: 'An arrow can not point at itself.' })
    } else if (holds(from, to) || holds(to, from)) {
      const [outer, inner] = holds(from, to) ? [from, to] : [to, from]
      errors.push({ line: arrow.line, col: fromCols[k], message: `An arrow can not connect a box with a box around it: "${outer.id}" holds "${inner.id}".` })
    } else {
      arrow.from = from
      arrow.to = to
    }
  })

  errors.sort((a, b) => a.line - b.line || a.col - b.col)
  return { root, arrows, errors }
}

/** True when `inner` is somewhere inside `outer`. */
function holds(outer: Node, inner: Node): boolean {
  for (let p = inner.parent; p; p = p.parent) if (p === outer) return true
  return false
}

/** " Did you mean "x"?" for a name that is close to one that exists. */
function hint(name: string, names: string[]): string {
  let best = ''
  let bestDistance = Math.max(1, Math.floor(name.length / 3)) + 1
  for (const candidate of names) {
    const d = distance(name, candidate)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  return best ? ` Did you mean "${best}"?` : ''
}

/** How many single-letter edits turn `a` into `b`. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}
