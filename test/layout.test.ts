import { describe, expect, it } from 'vitest'
import { layout, spread } from '../src/layout'
import type { LayoutEdge, LayoutNode, Placed } from '../src/layout'

const box = (key: string, w = 120, h = 60): LayoutNode => ({ key, w, h })
const edge = (from: string, to: string, label?: { w: number; h: number }): LayoutEdge => ({ key: `${from}>${to}`, from, to, label })

const overlap = (a: Placed, b: Placed) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2

function noOverlaps(nodes: Map<string, Placed>) {
  const list = [...nodes.entries()]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      expect(overlap(list[i][1], list[j][1]), `${list[i][0]} overlaps ${list[j][0]}`).toBe(false)
    }
  }
}

describe('spread', () => {
  it('keeps heights that already fit', () => {
    expect(spread([0, 100], [1, 1], [10])).toEqual([0, 100])
  })
  it('pushes crowded vertices apart evenly around where they want to be', () => {
    expect(spread([0, 0, 0], [1, 1, 1], [10, 10])).toEqual([-10, 0, 10])
  })
  it('lets heavier vertices move less', () => {
    const [a, b] = spread([0, 0], [3, 1], [20])
    expect(b - a).toBe(20)
    expect(a).toBe(-5)
  })
})

describe('layout', () => {
  it('puts a chain on one straight line, from left to right', () => {
    const { nodes } = layout([box('a'), box('b'), box('c')], [edge('a', 'b'), edge('b', 'c')])
    const [a, b, c] = ['a', 'b', 'c'].map(k => nodes.get(k)!)
    expect(a.y).toBeCloseTo(b.y)
    expect(b.y).toBeCloseTo(c.y)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
  })

  it('centers a box between the boxes it points to', () => {
    const { nodes } = layout([box('a'), box('b'), box('c')], [edge('a', 'b'), edge('a', 'c')])
    const [a, b, c] = ['a', 'b', 'c'].map(k => nodes.get(k)!)
    expect(a.y).toBeCloseTo((b.y + c.y) / 2)
    expect(b.x).toBe(c.x)
  })

  it('never overlaps boxes, and points arrows right unless they close a cycle', () => {
    const keys = 'abcdefgh'.split('')
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('d', 'e'), edge('a', 'e'), edge('f', 'c'), edge('g', 'h')]
    const { nodes } = layout(keys.map(k => box(k, 100 + k.charCodeAt(0) % 5 * 20)), edges)
    noOverlaps(nodes)
    for (const e of edges) expect(nodes.get(e.from)!.x, e.key).toBeLessThan(nodes.get(e.to)!.x)
  })

  it('finds an order with no crossings when there is one', () => {
    // Drawn in file order, b>d and c>e would cross.
    const { edges } = layout(
      [box('a'), box('b'), box('c'), box('e'), box('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'e')],
    )
    const ys = (key: string) => edges.get(key)!.points.map(p => p.y)
    const [bd, ce] = [ys('b>d'), ys('c>e')]
    expect(Math.sign(bd[0] - ce[0])).toBe(Math.sign(bd[bd.length - 1] - ce[ce.length - 1]))
  })

  it('routes both arrows of a cycle, in opposite directions', () => {
    const { edges, nodes } = layout([box('a'), box('b')], [edge('a', 'b'), edge('b', 'a')])
    const ab = edges.get('a>b')!.points
    const ba = edges.get('b>a')!.points
    const a = nodes.get('a')!
    const b = nodes.get('b')!
    expect(ab[0].x).toBeCloseTo(a.x + a.w / 2)
    expect(ba[0].x).toBeCloseTo(b.x - b.w / 2)
    expect(ab[0].y).not.toBeCloseTo(ba[ba.length - 1].y)
  })

  it('keeps room for labels between columns', () => {
    const { nodes, edges } = layout([box('a'), box('b')], [edge('a', 'b', { w: 300, h: 22 })])
    const a = nodes.get('a')!
    const b = nodes.get('b')!
    expect(b.x - b.w / 2 - (a.x + a.w / 2)).toBeGreaterThanOrEqual(300)
    expect(edges.get('a>b')!.label.x).toBeCloseTo((a.x + a.w / 2 + b.x - b.w / 2) / 2)
  })

  it('bends long arrows around the boxes in between', () => {
    const { nodes, edges } = layout([box('a'), box('b'), box('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')])
    const b = nodes.get('b')!
    const bend = edges.get('a>c')!.points[1]
    expect(bend.x).toBeCloseTo(b.x)
    expect(Math.abs(bend.y - b.y)).toBeGreaterThanOrEqual(b.h / 2)
  })

  it('puts boxes without arrows in a grid below', () => {
    const { nodes } = layout([box('a'), box('b'), box('x'), box('y'), box('z')], [edge('a', 'b')])
    noOverlaps(nodes)
    for (const k of ['x', 'y', 'z']) expect(nodes.get(k)!.y).toBeGreaterThan(nodes.get('a')!.y + 60)
  })

  it('keeps a box where at= puts it', () => {
    const side = layout([box('a'), { ...box('b'), at: { x: 500, y: -200 } }], [edge('a', 'b')])
    const a = side.nodes.get('a')!
    expect(side.nodes.get('b')).toMatchObject({ x: 500, y: -200 })
    expect(side.edges.get('a>b')!.points[0]).toEqual({ x: a.x + 60, y: a.y })
    const below = layout([box('a'), { ...box('b'), at: { x: 60, y: 400 } }], [edge('a', 'b')])
    const top = below.nodes.get('a')!
    expect(below.edges.get('a>b')!.points[0]).toEqual({ x: top.x, y: top.y + 30 })
  })

  it('handles nothing, and gives the same answer every time', () => {
    expect(layout([], []).bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    const input = [box('a'), box('b'), box('c')]
    const arrows = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    const once = layout(input, arrows)
    const again = layout(input, arrows)
    expect([...again.nodes]).toEqual([...once.nodes])
    expect([...again.edges]).toEqual([...once.edges])
  })
})
