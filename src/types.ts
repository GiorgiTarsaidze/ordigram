/** Properties of a node: `key=value`, or just `key`, which means true. */
export type Props = Record<string, string | true>

// The tree is read-only. To change a diagram, change the text and parse it again.

interface NodeBase {
  /** Unique among its siblings. Arrows use `from->to`, then `from->to#2`. */
  id: string
  /** The text in quotes, or null when the line has none. */
  label: string | null
  props: Readonly<Props>
  /** The inside of this node, in file order. */
  kids: readonly Node[]
  parent: Node | null
  /** The line it was written on, counting from 1. The top node has line 0. */
  line: number
}

export interface Box extends NodeBase {
  kind: 'box'
}

export interface Arrow extends NodeBase {
  kind: 'arrow'
  /** The paths as written, like `api/orders`. */
  fromRef: string
  toRef: string
  /** The boxes the paths point at, or null when they can not be found. */
  from: Box | null
  to: Box | null
}

/** Everything is a node. A box and an arrow differ only in that an arrow has two ends. */
export type Node = Box | Arrow

export interface ParseError {
  line: number
  col: number
  message: string
}

/** A parsed file. The top node is the file itself. */
export interface Doc {
  root: Box
  /** Every arrow in the file, in file order. */
  arrows: Arrow[]
  errors: ParseError[]
}
