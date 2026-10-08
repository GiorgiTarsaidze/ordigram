// The layout decides where boxes and arrows go. It is plain math, with no browser needed.
// Boxes stand in columns from left to right, so arrows mostly point right:
//   1. turn cycles around, so every arrow can point right
//   2. pick a column for every box
//   3. add bend points where an arrow skips columns
//   4. order each column to cut crossings
//   5. space the columns
//   6. solve the height of every box exactly, column by column
//   7. draw smooth curves through the bend points, or straight from side to side when the sides are chosen

export interface Point { x: number; y: number }
/** A side of a box, where an arrow leaves or arrives. */
export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface Size { w: number; h: number }
export interface Placed extends Point, Size {}

export interface LayoutNode extends Size {
  key: string
  /** A fixed center, from `at=x,y`. */
  at?: Point | null
}

export interface LayoutEdge {
  key: string
  from: string
  to: string
  /** Room for the label, kept free in the middle of the arrow. */
  label?: Size | null
  /** The sides it leaves from and arrives at. A missing one is picked from where the boxes are. */
  sides?: { from?: Side | null; to?: Side | null } | null
}

export interface Route {
  /** An SVG path. */
  d: string
  points: Point[]
  /** The center of the label. */
  label: Point
}

export interface Layout {
  nodes: Map<string, Placed>
  edges: Map<string, Route>
  bounds: Placed & { x: number; y: number }
}

const COLUMN_GAP = 88
const ROW_GAP = 30
const BEND_GAP = 14
const BEND_H = 4
const PORT_STEP = 12
const GRID_GAP = 44
const LOOSE_GAP = 72

interface Edge {
  key: string
  s: number
  t: number
  label: Size | null
  /** Turned around to break a cycle. */
  turned: boolean
  /** Vertices from the left end to the right end, with bend points between. */
  chain: number[]
  /** The bend point that holds the label, or -1 when it sits between two columns. */
  labelAt: number
  /** Which piece of the chain holds the label when labelAt is -1. */
  labelPiece: number
  sides: { from: Side | null; to: Side | null }
}

/** One end of an arrow on one side of a box, and how far along that side it sits. */
interface End {
  v: number
  side: Side
  /** Where the other end is, along this side. Ends are spread in this order, so they do not cross. */
  toward: number
  offset: number
}

const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

export function layout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Layout {
  const n = nodes.length
  const index = new Map<string, number>()
  nodes.forEach((node, i) => index.set(node.key, i))

  // Vertices 0..n-1 are the boxes. Bend points are added after them.
  const W = nodes.map(v => v.w)
  const H = nodes.map(v => v.h)

  const es: Edge[] = []
  for (const e of edges) {
    const s = index.get(e.from)
    const t = index.get(e.to)
    if (s === undefined || t === undefined || s === t) continue
    const sides = { from: e.sides?.from ?? null, to: e.sides?.to ?? null }
    es.push({ key: e.key, s, t, label: e.label ?? null, turned: false, chain: [], labelAt: -1, labelPiece: 0, sides })
  }

  // 1. Cycles: walk depth first in file order. An arrow back to a box on the current path is turned.
  const out: number[][] = Array.from({ length: n }, () => [])
  const degree = new Int32Array(n)
  es.forEach((e, k) => {
    out[e.s].push(k)
    degree[e.s]++
    degree[e.t]++
  })
  const state = new Uint8Array(n)
  for (let start = 0; start < n; start++) {
    if (state[start]) continue
    const stack: [number, number][] = [[start, 0]]
    state[start] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      const v = top[0]
      if (top[1] < out[v].length) {
        const e = es[out[v][top[1]++]]
        if (state[e.t] === 1) e.turned = true
        else if (state[e.t] === 0) {
          state[e.t] = 1
          stack.push([e.t, 0])
        }
      } else {
        state[v] = 2
        stack.pop()
      }
    }
  }

  // 2. Columns: the longest path from the left, then boxes with nothing coming in move next to their targets.
  const rank: number[] = new Array(n).fill(0)
  const right: number[][] = Array.from({ length: n }, () => [])
  const left: number[][] = Array.from({ length: n }, () => [])
  for (const e of es) {
    const a = e.turned ? e.t : e.s
    const b = e.turned ? e.s : e.t
    right[a].push(b)
    left[b].push(a)
  }
  const waiting = left.map(l => l.length)
  const queue: number[] = []
  for (let v = 0; v < n; v++) if (waiting[v] === 0) queue.push(v)
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]
    for (const b of right[v]) {
      rank[b] = Math.max(rank[b], rank[v] + 1)
      if (--waiting[b] === 0) queue.push(b)
    }
  }
  for (let v = 0; v < n; v++) {
    if (left[v].length === 0 && right[v].length) {
      let r = Infinity
      for (const b of right[v]) r = Math.min(r, rank[b])
      rank[v] = r - 1
    }
  }
  let lowest = Infinity
  for (let v = 0; v < n; v++) if (degree[v]) lowest = Math.min(lowest, rank[v])
  for (let v = 0; v < n; v++) rank[v] = degree[v] ? rank[v] - lowest : 0

  // 3. Bend points, one per column an arrow skips. A label in the middle of a long arrow gets its own.
  const succ: number[][] = Array.from({ length: n }, () => [])
  const pred: number[][] = Array.from({ length: n }, () => [])
  const isBox: boolean[] = new Array(n).fill(true)
  const labelGap: number[] = []
  const addBend = (r: number) => {
    W.push(0)
    H.push(BEND_H)
    rank.push(r)
    isBox.push(false)
    succ.push([])
    pred.push([])
    return W.length - 1
  }
  for (const e of es) {
    const a = e.turned ? e.t : e.s
    const b = e.turned ? e.s : e.t
    const span = rank[b] - rank[a]
    const chain = [a]
    for (let r = rank[a] + 1; r < rank[b]; r++) chain.push(addBend(r))
    chain.push(b)
    for (let k = 0; k + 1 < chain.length; k++) {
      succ[chain[k]].push(chain[k + 1])
      pred[chain[k + 1]].push(chain[k])
    }
    e.chain = chain
    if (span % 2 === 0) {
      e.labelAt = chain[span / 2]
      if (e.label) {
        W[e.labelAt] = e.label.w
        H[e.labelAt] = e.label.h
      }
    } else {
      e.labelPiece = (span - 1) / 2
      const gap = rank[a] + e.labelPiece
      if (e.label) labelGap[gap] = Math.max(labelGap[gap] ?? 0, e.label.w + 28)
    }
  }

  const V = W.length
  let columns = 0
  for (let v = 0; v < V; v++) if (v >= n || degree[v]) columns = Math.max(columns, rank[v] + 1)
  let layers: number[][] = Array.from({ length: columns }, () => [])
  for (let v = 0; v < V; v++) if (v >= n || degree[v]) layers[rank[v]].push(v)
  const pos = new Int32Array(V)
  const number = () => {
    for (const layer of layers) layer.forEach((v, i) => (pos[v] = i))
  }
  number()

  // 4. Order inside columns: move each vertex to the average place of its neighbors, sweeping both ways,
  //    swap neighbors when that removes crossings, and keep the best order seen.
  const crossings = () => {
    let total = 0
    for (let r = 0; r + 1 < columns; r++) {
      const pairs: number[] = []
      for (const u of layers[r]) for (const v of succ[u]) pairs.push(pos[u] * 65536 + pos[v])
      pairs.sort((x, y) => x - y)
      const size = layers[r + 1].length
      const tree = new Int32Array(size + 1)
      let seen = 0
      for (const pair of pairs) {
        const p = (pair % 65536) + 1
        let below = 0
        for (let i = p; i > 0; i -= i & -i) below += tree[i]
        total += seen - below
        for (let i = p; i <= size; i += i & -i) tree[i]++
        seen++
      }
    }
    return total
  }
  const sweep = (down: boolean) => {
    for (let k = 1; k < columns; k++) {
      const layer = layers[down ? k : columns - 1 - k]
      const moving: { v: number; at: number }[] = []
      for (const v of layer) {
        const near = down ? pred[v] : succ[v]
        if (!near.length) continue
        let sum = 0
        for (const u of near) sum += pos[u]
        moving.push({ v, at: sum / near.length })
      }
      moving.sort((a, b) => a.at - b.at || pos[a.v] - pos[b.v])
      let m = 0
      for (let i = 0; i < layer.length; i++) {
        const v = layer[i]
        if ((down ? pred[v] : succ[v]).length) layer[i] = moving[m++].v
      }
      layer.forEach((v, i) => (pos[v] = i))
    }
  }
  const crossed = (u: number, v: number) => {
    let c = 0
    for (const a of pred[u]) for (const b of pred[v]) if (pos[a] > pos[b]) c++
    for (const a of succ[u]) for (const b of succ[v]) if (pos[a] > pos[b]) c++
    return c
  }
  const transpose = () => {
    for (let pass = 0; pass < 4; pass++) {
      let better = false
      for (const layer of layers) {
        for (let i = 0; i + 1 < layer.length; i++) {
          const u = layer[i]
          const v = layer[i + 1]
          if (crossed(u, v) > crossed(v, u)) {
            layer[i] = v
            layer[i + 1] = u
            pos[v] = i
            pos[u] = i + 1
            better = true
          }
        }
      }
      if (!better) break
    }
  }
  let best = layers.map(l => l.slice())
  let fewest = crossings()
  for (let round = 0; round < 24 && fewest > 0; round++) {
    sweep(round % 2 === 0)
    transpose()
    const c = crossings()
    if (c < fewest) {
      fewest = c
      best = layers.map(l => l.slice())
    }
  }
  layers = best
  number()

  // 5. Columns get as wide as their widest box, with room between them for labels.
  const columnX: number[] = []
  let x = 0
  for (let r = 0; r < columns; r++) {
    let widest = 0
    for (const v of layers[r]) widest = Math.max(widest, W[v])
    if (r === 0) x = widest / 2
    else {
      let before = 0
      for (const v of layers[r - 1]) before = Math.max(before, W[v])
      x += before / 2 + Math.max(COLUMN_GAP, labelGap[r - 1] ?? 0) + widest / 2
    }
    columnX.push(x)
  }

  // 6. Heights: each vertex wants to sit level with its neighbors, but vertices in a column keep their
  //    order and spacing. spread() finds the closest heights that keep both, exactly.
  const y = new Float64Array(V)
  const gap = (u: number, v: number) => (H[u] + H[v]) / 2 + (isBox[u] && isBox[v] ? ROW_GAP : BEND_GAP)
  for (const layer of layers) {
    let at = 0
    layer.forEach((v, i) => {
      if (i) at += gap(layer[i - 1], v)
      y[v] = at
    })
    for (const v of layer) y[v] -= at / 2
  }
  for (let pass = 0; pass < 12; pass++) {
    const mode = pass < 8 ? pass % 2 : 2 // 0: look left, 1: look right, 2: both
    for (let k = 0; k < columns; k++) {
      const layer = layers[mode === 1 ? columns - 1 - k : k]
      const want: number[] = []
      const weight: number[] = []
      const gaps: number[] = []
      layer.forEach((v, i) => {
        let sum = 0
        let count = 0
        if (mode !== 1) {
          for (const u of pred[v]) sum += y[u]
          count += pred[v].length
        }
        if (mode !== 0) {
          for (const u of succ[v]) sum += y[u]
          count += succ[v].length
        }
        want.push(count ? sum / count : y[v])
        weight.push((isBox[v] ? 1 : 2) * (count ? 1 : 0.3))
        if (i) gaps.push(gap(layer[i - 1], v))
      })
      const heights = spread(want, weight, gaps)
      layer.forEach((v, i) => (y[v] = heights[i]))
    }
  }

  const px = new Float64Array(V)
  const py = new Float64Array(V)
  for (let v = 0; v < V; v++) {
    if (v < n && !degree[v]) continue
    px[v] = columnX[rank[v]]
    py[v] = y[v]
  }

  // Boxes with no arrows on this level sit in a grid below.
  const loose: number[] = []
  for (let v = 0; v < n; v++) if (!degree[v]) loose.push(v)
  if (loose.length) {
    let top = 0
    let center = 0
    if (loose.length < n) {
      let minX = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let v = 0; v < n; v++) {
        if (!degree[v]) continue
        minX = Math.min(minX, px[v] - W[v] / 2)
        maxX = Math.max(maxX, px[v] + W[v] / 2)
        maxY = Math.max(maxY, py[v] + H[v] / 2)
      }
      top = maxY + LOOSE_GAP
      center = (minX + maxX) / 2
    }
    const perRow = Math.max(1, Math.round(Math.sqrt(loose.length * 1.6)))
    let cell = 0
    for (const v of loose) cell = Math.max(cell, W[v])
    cell += GRID_GAP
    for (let row = 0; row * perRow < loose.length; row++) {
      const items = loose.slice(row * perRow, row * perRow + perRow)
      let tall = 0
      for (const v of items) tall = Math.max(tall, H[v])
      items.forEach((v, i) => {
        px[v] = center + (i - (items.length - 1) / 2) * cell
        py[v] = top + tall / 2
      })
      top += tall + GRID_GAP
    }
  }

  const fixed = new Uint8Array(n)
  nodes.forEach((node, v) => {
    if (node.at) {
      px[v] = node.at.x
      py[v] = node.at.y
      fixed[v] = 1
    }
  })

  // 7. Arrows. Between two boxes the layout placed, an arrow runs through its bend points, from the right
  //    side of one to the left side of the next. With chosen sides, or a box placed by hand, it runs
  //    straight from side to side. Several arrows on one side of a box get their own spots.
  const sideToward = (a: number, b: number): Side => {
    const dx = px[b] - px[a]
    const dy = py[b] - py[a]
    if (Math.abs(dx) - (W[a] + W[b]) / 2 >= Math.abs(dy) - (H[a] + H[b]) / 2) return dx >= 0 ? 'right' : 'left'
    return dy >= 0 ? 'bottom' : 'top'
  }
  const along = (side: Side, v: number) => (side === 'left' || side === 'right' ? py[v] : px[v])
  const bySide = new Map<string, End[]>()
  const endsOf = new Map<Edge, [End, End]>()
  const straight = new Set<Edge>()
  const end = (v: number, side: Side, toward: number): End => {
    const it = { v, side, toward, offset: 0 }
    const key = `${v} ${side}`
    const list = bySide.get(key)
    if (list) list.push(it)
    else bySide.set(key, [it])
    return it
  }
  for (const e of es) {
    if (fixed[e.s] || fixed[e.t] || e.sides.from || e.sides.to) {
      straight.add(e)
      const from = e.sides.from ?? sideToward(e.s, e.t)
      const to = e.sides.to ?? sideToward(e.t, e.s)
      endsOf.set(e, [end(e.s, from, along(from, e.t)), end(e.t, to, along(to, e.s))])
    } else {
      const a = e.chain[0]
      const b = e.chain[e.chain.length - 1]
      endsOf.set(e, [end(a, 'right', py[e.chain[1]]), end(b, 'left', py[e.chain[e.chain.length - 2]])])
    }
  }
  for (const list of bySide.values()) {
    list.sort((p, q) => p.toward - q.toward)
    const { v, side } = list[0]
    const room = side === 'left' || side === 'right' ? H[v] : W[v]
    const step = list.length > 1 ? Math.max(0, Math.min(PORT_STEP, (room - 18) / (list.length - 1))) : 0
    list.forEach((it, i) => (it.offset = (i - (list.length - 1) / 2) * step))
  }
  const port = ({ v, side, offset }: End): Point =>
    side === 'right' ? { x: px[v] + W[v] / 2, y: py[v] + offset }
    : side === 'left' ? { x: px[v] - W[v] / 2, y: py[v] + offset }
    : side === 'top' ? { x: px[v] + offset, y: py[v] - H[v] / 2 }
    : { x: px[v] + offset, y: py[v] + H[v] / 2 }

  const routes = new Map<string, Route>()
  for (const e of es) {
    const [first, second] = endsOf.get(e)!
    if (straight.has(e)) {
      // One smooth curve that leaves its side square, and arrives square, with room for the tip.
      const n0 = NORMAL[first.side]
      const n3 = NORMAL[second.side]
      const p0 = port(first)
      const p3 = port(second)
      p3.x += n3.x * 2
      p3.y += n3.y * 2
      const reach = Math.max(24, Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4)
      const c1 = { x: p0.x + n0.x * reach, y: p0.y + n0.y * reach }
      const c2 = { x: p3.x + n3.x * reach, y: p3.y + n3.y * reach }
      const label = { x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8, y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8 }
      routes.set(e.key, { d: `M${xy(p0)}C${xy(c1)} ${xy(c2)} ${xy(p3)}`, points: [p0, c1, c2, p3], label })
      continue
    }
    const points = e.chain.map(v => ({ x: px[v], y: py[v] }))
    points[0] = port(first)
    points[points.length - 1] = port(second)
    let label: Point
    if (e.labelAt >= 0) label = { x: px[e.labelAt], y: py[e.labelAt] }
    else {
      const p = points[e.labelPiece]
      const q = points[e.labelPiece + 1]
      label = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    }
    if (e.turned) points.reverse()
    // Leave a little room at the end for the arrow tip.
    const last = points[points.length - 1]
    last.x += Math.sign(points[points.length - 2].x - last.x) * 2
    routes.set(e.key, { d: curve(points), points, label })
  }

  // Everything drawn, for fitting the view.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (cx: number, cy: number, w: number, h: number) => {
    minX = Math.min(minX, cx - w / 2)
    maxX = Math.max(maxX, cx + w / 2)
    minY = Math.min(minY, cy - h / 2)
    maxY = Math.max(maxY, cy + h / 2)
  }
  const placed = new Map<string, Placed>()
  nodes.forEach((node, v) => {
    placed.set(node.key, { x: px[v], y: py[v], w: W[v], h: H[v] })
    grow(px[v], py[v], W[v], H[v])
  })
  for (const e of es) {
    const route = routes.get(e.key)!
    for (const p of route.points) grow(p.x, p.y, 0, 0)
    if (e.label) grow(route.label.x, route.label.y, e.label.w, e.label.h)
  }
  const bounds = minX === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  return { nodes: placed, edges: routes, bounds }
}

/**
 * Heights for one column. Each vertex wants a height, with a weight for how much it cares, and
 * neighbors must stay at least `gaps[i]` apart. This finds the heights closest to what they want
 * (least squares) that keep the order and the gaps. It shifts by the gaps, then fits a rising line
 * with the pool-adjacent-violators algorithm, so it is exact and linear in time.
 */
export function spread(want: number[], weight: number[], gaps: number[]): number[] {
  const shift: number[] = [0]
  for (let i = 0; i < gaps.length; i++) shift.push(shift[i] + gaps[i])
  const value: number[] = []
  const mass: number[] = []
  const count: number[] = []
  for (let i = 0; i < want.length; i++) {
    let v = want[i] - shift[i]
    let m = weight[i]
    let c = 1
    while (value.length && value[value.length - 1] > v) {
      const pm = mass.pop()!
      v = (value.pop()! * pm + v * m) / (pm + m)
      m += pm
      c += count.pop()!
    }
    value.push(v)
    mass.push(m)
    count.push(c)
  }
  const out: number[] = []
  value.forEach((v, b) => {
    for (let k = 0; k < count[b]; k++) out.push(v + shift[out.length])
  })
  return out
}

const round = (n: number) => Math.round(n * 10) / 10

const xy = (p: Point) => `${round(p.x)},${round(p.y)}`

/** A smooth path through the points that leaves and enters each one level. */
function curve(points: Point[]): string {
  let d = `M${xy(points[0])}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]
    const q = points[i]
    const m = (q.x - p.x) / 2
    d += `C${xy({ x: p.x + m, y: p.y })} ${xy({ x: q.x - m, y: q.y })} ${xy(q)}`
  }
  return d
}
