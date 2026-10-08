import { describe, expect, it } from 'vitest'
import { build, find, hasInside, pathOf } from '../src/builder'
import { parse } from '../src/parser'
import type { Level } from '../src/builder'
import shop from '../examples/shop.ordi?raw'

const doc = parse(shop)
const at = (...path: string[]) => build(doc, find(doc, path))
const show = (level: Level) => ({
  boxes: level.boxes.map(b => b.id),
  outside: level.outside.map(b => pathOf(b).join('/')),
  links: level.links.map(l => `${l.from.id} > ${l.to.id}${l.bubbled ? ' (bubbled)' : ''}${l.arrows.length > 1 ? ` x${l.arrows.length}` : ''}`),
})

describe('builder', () => {
  it('draws the top level, with deep arrows bubbled up to the boxes that hold them', () => {
    expect(show(at())).toEqual({
      boxes: ['customer', 'web', 'api', 'db', 'stripe', 'mail'],
      outside: [],
      links: ['customer > web', 'web > api', 'api > db (bubbled)', 'api > stripe (bubbled)', 'api > mail (bubbled)'],
    })
  })

  it('draws the inside of a box, with the outside world dashed', () => {
    expect(show(at('api'))).toEqual({
      boxes: ['gateway', 'auth', 'orders'],
      outside: ['db', 'stripe', 'mail'],
      links: ['gateway > auth', 'gateway > orders', 'orders > db (bubbled)', 'orders > stripe (bubbled)', 'orders > mail'],
    })
  })

  it('goes as deep as the file goes', () => {
    expect(show(at('api', 'orders'))).toEqual({
      boxes: ['check', 'pay', 'save'],
      outside: ['db', 'stripe'],
      links: ['check > pay', 'pay > save', 'save > db', 'pay > stripe'],
    })
  })

  it('opens an arrow like any other node', () => {
    expect(show(at('web->api'))).toEqual({
      boxes: ['cdn', 'lb'],
      outside: ['web', 'api'],
      links: ['web > cdn', 'cdn > lb', 'lb > api'],
    })
  })

  it('draws many arrows between the same two boxes as one', () => {
    const many = parse('a\n  x\n  y\nb\na/x -> b "one"\na/y -> b "two"\na -> b "three"')
    const [link] = build(many, many.root).links
    expect(build(many, many.root).links).toHaveLength(1)
    expect(link.arrows.map(a => a.label)).toEqual(['one', 'two', 'three'])
    expect(link.bubbled).toBe(true)
  })

  it('skips arrows that could not be resolved', () => {
    const broken = parse('a\nb\na -> nope\na -> b')
    expect(broken.errors).toHaveLength(1)
    expect(build(broken, broken.root).links.map(l => `${l.from.id} > ${l.to.id}`)).toEqual(['a > b'])
  })

  it('finds a node by path, or the deepest one that still exists', () => {
    expect(pathOf(find(doc, ['api', 'orders', 'save']))).toEqual(['api', 'orders', 'save'])
    expect(pathOf(find(doc, ['api', 'gone', 'save']))).toEqual(['api'])
    expect(find(doc, [])).toBe(doc.root)
  })

  it('knows which nodes have an inside', () => {
    expect(hasInside(find(doc, ['api']))).toBe(true)
    expect(hasInside(find(doc, ['web->api']))).toBe(true)
    expect(hasInside(find(doc, ['customer->web']))).toBe(false)
    expect(hasInside(find(doc, ['db']))).toBe(false)
  })
})
