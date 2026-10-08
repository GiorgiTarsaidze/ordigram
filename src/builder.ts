import type { Arrow, Box, Doc, Node } from './types'

// The Builder answers one question: when a node is open, what is drawn?
// That is rule 5 of SPEC.md: its boxes, plus every arrow that touches its inside, bubbled up.

/** One drawn arrow. It can stand for many arrows between the same two boxes. */
export interface Link {
  /** Stable on this level, so the Drawer can follow a link from one edit to the next. */
  key: string
  from: Box
  to: Box
  /** The arrows drawn as this link, in file order. */
  arrows: Arrow[]
  /** True when an arrow really starts or ends deeper inside the box it is drawn at. */
  bubbled: boolean
}

/** What is drawn when one node is open. */
export interface Level {
  node: Node
  /** The boxes directly inside, in file order. */
  boxes: Box[]
  /** Boxes outside the open node that its arrows reach. They are drawn dashed. */
  outside: Box[]
  links: Link[]
}

export const isBox = (node: Node): node is Box => node.kind === 'box'

/** True when the node has boxes inside, so opening it shows something. */
export const hasInside = (node: Node): boolean => node.kids.some(isBox)

/** The ids from the top node down to this one. The top node has an empty path. */
export function pathOf(node: Node): string[] {
  const path: string[] = []
  for (let n: Node | null = node; n?.parent; n = n.parent) path.push(n.id)
  return path.reverse()
}

const keys = new WeakMap<Node, string>()

/** A string that names one node in the whole file. Ids can not hold a line break, so it joins with one. */
export function keyOf(node: Node): string {
  let key = keys.get(node)
  if (key === undefined) keys.set(node, (key = pathOf(node).join('\n')))
  return key
}

/** The node at this path, or the deepest one that still exists, so a view survives edits. */
export function find(doc: Doc, path: readonly string[]): Node {
  let node: Node = doc.root
  for (const id of path) {
    const next: Node | undefined = node.kids.find(k => k.id === id)
    if (!next) break
    node = next
  }
  return node
}

const indexes = new WeakMap<Doc, Map<Node, Arrow[]>>()

/**
 * Files every arrow under every node around its two ends, once per file.
 * Opening a node then only looks at the arrows that touch it, however big the file is.
 */
function touching(doc: Doc): Map<Node, Arrow[]> {
  let index = indexes.get(doc)
  if (index) return index
  index = new Map()
  for (const arrow of doc.arrows) {
    if (!arrow.from || !arrow.to) continue
    // An arrow inside another arrow is only seen when that arrow is open.
    let scope: Node | null = arrow.parent
    while (scope && scope.kind !== 'arrow') scope = scope.parent
    file(index, arrow, arrow.from, scope)
    file(index, arrow, arrow.to, scope)
  }
  indexes.set(doc, index)
  return index
}

function file(index: Map<Node, Arrow[]>, arrow: Arrow, end: Box, scope: Node | null) {
  if (scope && !inside(end, scope)) return
  for (let p = end.parent; p; p = p.parent) {
    let list = index.get(p)
    if (!list) index.set(p, (list = []))
    // Both ends share the nodes above them. The arrow was pushed last, so this skips the repeat.
    if (list[list.length - 1] !== arrow) list.push(arrow)
    if (p === scope) break
  }
}

function inside(node: Node, outer: Node): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === outer) return true
  return false
}

/** Where one end of an arrow is drawn when `open` is open. */
function place(end: Box, open: Node): { box: Box; deep: boolean; out: boolean } | null {
  if (end === open) return null
  let top: Node = end
  while (top.parent && top.parent !== open) top = top.parent
  if (top.parent !== open) return { box: end, deep: false, out: true }
  return isBox(top) ? { box: top, deep: top !== end, out: false } : null
}

export function build(doc: Doc, open: Node): Level {
  const boxes = open.kids.filter(isBox)
  const outside = new Set<Box>()
  const links: Link[] = []
  const pairs = new Map<Box, Map<Box, Link>>()

  for (const arrow of touching(doc).get(open) ?? []) {
    const from = place(arrow.from!, open)
    const to = place(arrow.to!, open)
    // Both ends in one box: it belongs to that box's inside. Both outside: it belongs further up.
    if (!from || !to || from.box === to.box || (from.out && to.out)) continue
    if (from.out) outside.add(from.box)
    if (to.out) outside.add(to.box)

    let row = pairs.get(from.box)
    if (!row) pairs.set(from.box, (row = new Map()))
    let link = row.get(to.box)
    if (!link) {
      link = { key: `${keyOf(from.box)}\t${keyOf(to.box)}`, from: from.box, to: to.box, arrows: [], bubbled: false }
      row.set(to.box, link)
      links.push(link)
    }
    link.arrows.push(arrow)
    if (from.deep || to.deep) link.bubbled = true
  }

  return { node: open, boxes, outside: [...outside], links }
}
