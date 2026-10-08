import { describe, expect, it } from 'vitest'
import { find } from '../src/builder'
import { parse } from '../src/parser'
import { addArrow, addBox, apply, remove, setLabel, setProp, setProps, tidy } from '../src/writer'
import type { Edit } from '../src/writer'
import type { Arrow, Box } from '../src/types'
import shop from '../examples/shop.ordi?raw'

const run = (text: string, edit: Edit | null) => (edit ? apply(text, edit) : text)
const at = (text: string, ...path: string[]) => find(parse(text), path)

describe('writer', () => {
  it('adds, changes and removes a property, and keeps comments', () => {
    expect(run('a "A"\nb', setProp('a "A"\nb', at('a "A"\nb', 'a'), 'at', '10,20'))).toBe('a "A" at=10,20\nb')
    const pinned = 'a "A" at=1,2 flow # keep me'
    expect(run(pinned, setProp(pinned, at(pinned, 'a'), 'at', '10,20'))).toBe('a "A" at=10,20 flow # keep me')
    expect(run(pinned, setProp(pinned, at(pinned, 'a'), 'at', null))).toBe('a "A" flow # keep me')
    expect(run('a', setProp('a', at('a', 'a'), 'note', 'two words'))).toBe('a note="two words"')
  })

  it('moves many boxes in one edit', () => {
    const text = 'a\nb "B" at=1,1\nc'
    const doc = parse(text)
    const edit = setProps(text, [
      { node: find(doc, ['a']), key: 'at', value: '10,10' },
      { node: find(doc, ['b']), key: 'at', value: '20,20' },
    ])
    expect(run(text, edit)).toBe('a at=10,10\nb "B" at=20,20\nc')
  })

  it('changes only the part of the text that changes', () => {
    const text = 'a "A"\nb "B"\nc "C"'
    const edit = setProp(text, at(text, 'b'), 'at', '5,5')!
    expect(edit).toEqual({ from: 11, to: 11, insert: ' at=5,5' })
  })

  it('sets, adds and removes labels, with quotes and line breaks kept safe', () => {
    expect(run('a "A" color=blue', setLabel('a "A" color=blue', at('a "A" color=blue', 'a'), 'Say "hi"'))).toBe('a "Say \\"hi\\"" color=blue')
    expect(run('a color=blue', setLabel('a color=blue', at('a color=blue', 'a'), 'Hi'))).toBe('a "Hi" color=blue')
    expect(run('a "A"', setLabel('a "A"', at('a "A"', 'a'), ''))).toBe('a')
    const arrows = 'a\nb\na -> b flow'
    const written = run(arrows, setLabel(arrows, at(arrows, 'a->b'), 'Two\nlines'))
    expect(written).toBe('a\nb\na -> b "Two\\nlines" flow')
    expect(at(written, 'a->b').label).toBe('Two\nlines')
  })

  it('adds a box after the other boxes, named box1, box2, ...', () => {
    const doc = parse(shop)
    const { edit, id } = addBox(shop, doc.root, { at: '10,20' })
    const text = apply(shop, edit)
    expect(id).toBe('box1')
    expect(text.split('\n')[19]).toBe('box1 "Box 1" at=10,20')
    expect(parse(text).errors).toEqual([])
    expect(addBox(text, parse(text).root).id).toBe('box2')
  })

  it('adds a box with the right indentation, inside any node', () => {
    const doc = parse(shop)
    const inApi = apply(shop, addBox(shop, find(doc, ['api'])).edit)
    expect(inApi.split('\n')[14]).toBe('  box1 "Box 1"')
    expect(find(parse(inApi), ['api', 'box1']).kind).toBe('box')
    expect(run('a "A"\nb', addBox('a "A"\nb', at('a "A"\nb', 'a')).edit)).toBe('a "A"\n  box1 "Box 1"\nb')
    expect(run('', addBox('', parse('').root).edit)).toBe('box1 "Box 1"')
  })

  it('adds an arrow with the shortest names that work from where it is written', () => {
    const doc = parse(shop)
    const api = find(doc, ['api'])
    const text = run(shop, addArrow(shop, api, find(doc, ['api', 'auth']) as Box, find(doc, ['db']) as Box))
    expect(text.split('\n')[16]).toBe('  auth -> db')
    const after = parse(text)
    expect(after.errors).toEqual([])
    expect((find(after, ['api', 'auth->db']) as Arrow).to!.id).toBe('db')

    const https = find(doc, ['web->api'])
    const inside = run(shop, addArrow(shop, https, find(doc, ['web->api', 'cdn']) as Box, find(doc, ['api']) as Box))
    expect(inside.split('\n')[27]).toBe('  cdn -> api')
    expect(parse(inside).errors).toEqual([])
  })

  it('writes the sides an arrow connects', () => {
    const text = 'a\nb'
    const doc = parse(text)
    const written = run(text, addArrow(text, doc.root, find(doc, ['a']) as Box, find(doc, ['b']) as Box, { from: 'bottom', to: 'top' }))
    expect(written).toBe('a\nb\na -> b from=bottom to=top')
    expect({ ...find(parse(written), ['a->b']).props }).toEqual({ from: 'bottom', to: 'top' })
  })

  it('refuses an arrow it can not name, instead of pointing at the wrong box', () => {
    const text = 'x "outer"\ng\n  x "inner"\n  y'
    const doc = parse(text)
    expect(addArrow(text, find(doc, ['g']), find(doc, ['g', 'y']) as Box, find(doc, ['x']) as Box)).toBeNull()
  })

  it('removes a box, and every arrow to it or into it', () => {
    const doc = parse(shop)
    const withoutDb = run(shop, remove(shop, doc, [find(doc, ['db'])]))
    expect(withoutDb).not.toMatch(/\bdb\b/)
    expect(parse(withoutDb).errors).toEqual([])

    const withoutApi = run(shop, remove(shop, doc, [find(doc, ['api'])]))
    const left = parse(withoutApi)
    expect(left.errors).toEqual([])
    expect(left.root.kids.map(k => k.id)).toEqual(['customer', 'web', 'db', 'stripe', 'mail', 'customer->web'])
  })

  it('removes an arrow with its inside', () => {
    const doc = parse(shop)
    const text = run(shop, remove(shop, doc, [find(doc, ['web->api'])]))
    expect(text).not.toContain('Load balancer')
    expect(parse(text).root.kids.map(k => k.id)).not.toContain('web->api')
    expect(parse(text).errors).toEqual([])
  })

  it('tidies only the boxes directly inside the open node', () => {
    const text = 'a at=1,2\n  b at=3,4\nc at=5,6 flow'
    expect(run(text, tidy(text, parse(text).root))).toBe('a\n  b at=3,4\nc flow')
    expect(tidy('a\nb', parse('a\nb').root)).toBeNull()
  })

  it('keeps Windows line endings', () => {
    const text = 'a\r\nb\r\n'
    expect(run(text, setProp(text, at(text, 'b'), 'flow', 'true'))).toBe('a\r\nb flow=true\r\n')
    expect(run(text, addBox(text, parse(text).root).edit)).toBe('a\r\nb\r\nbox1 "Box 1"\r\n')
  })
})
