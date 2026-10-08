import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser'
import type { Arrow, Box, Node } from '../src/types'
import shop from '../examples/shop.ordi?raw'
import shapes from '../examples/shapes.ordi?raw'

const ids = (node: Node) => node.kids.map(k => k.id)
const kid = (node: Node, id: string) => node.kids.find(k => k.id === id)!
const errorsOf = (text: string) => parse(text).errors.map(e => `${e.line}:${e.col} ${e.message}`)

describe('parser', () => {
  it('reads the examples without errors', () => {
    expect(parse(shop).errors).toEqual([])
    expect(parse(shapes).errors).toEqual([])
  })

  it('builds the tree from indentation', () => {
    const { root } = parse(shop)
    expect(ids(root)).toEqual([
      'customer', 'web', 'api', 'db', 'stripe', 'mail',
      'customer->web', 'web->api', 'api/orders/save->db', 'api/orders/pay->stripe', 'api/orders->mail',
    ])
    const api = kid(root, 'api')
    expect(ids(api)).toEqual(['gateway', 'auth', 'orders', 'gateway->auth', 'gateway->orders'])
    expect(ids(kid(api, 'orders'))).toEqual(['check', 'pay', 'save', 'check->pay', 'pay->save'])
    expect(kid(api, 'orders').parent).toBe(api)
    expect(kid(api, 'orders').line).toBe(9)
  })

  it('gives an arrow an inside, like any node', () => {
    const https = kid(parse(shop).root, 'web->api') as Arrow
    expect(https.kind).toBe('arrow')
    expect(https.label).toBe('HTTPS')
    expect(https.props.flow).toBe(true)
    expect(ids(https)).toEqual(['cdn', 'lb', 'web->cdn', 'cdn->lb', 'lb->api'])
  })

  it('reads labels, escapes, properties and comments', () => {
    const { root, errors } = parse('a "Say \\"hi\\"\\nthen \\\\ go" k=v on note="two words" c=#e0a800 # a comment')
    expect(errors).toEqual([])
    const a = root.kids[0]
    expect(a.label).toBe('Say "hi"\nthen \\ go')
    expect({ ...a.props }).toEqual({ k: 'v', on: true, note: 'two words', c: '#e0a800' })
  })

  it('uses the id when there is no label, and handles CRLF and blank lines', () => {
    const { root, errors } = parse('a\r\n\r\n  # just a comment\r\nb "B"\r\n')
    expect(errors).toEqual([])
    expect(root.kids.map(k => [k.id, k.label, k.line])).toEqual([['a', null, 1], ['b', 'B', 4]])
  })

  it('reads arrows with or without spaces, and numbers repeats', () => {
    const { root, errors } = parse('a\nb\na->b "one"\na -> b "two"')
    expect(errors).toEqual([])
    expect(ids(root)).toEqual(['a', 'b', 'a->b', 'a->b#2'])
    const [one, two] = root.kids.slice(2) as Arrow[]
    expect(one.from).toBe(root.kids[0])
    expect(two.to).toBe(root.kids[1])
  })

  it('looks names up like variables: the nearest one wins, and a slash goes inside', () => {
    const { root, errors } = parse('x "outer"\ng\n  x "inner"\n  y\n  y -> x\nz\nz -> g/x')
    expect(errors).toEqual([])
    const g = kid(root, 'g')
    expect((kid(g, 'y->x') as Arrow).to!.label).toBe('inner')
    expect((kid(root, 'z->g/x') as Arrow).to).toBe(kid(g, 'x'))
  })

  it('finds names from inside an arrow', () => {
    const https = kid(parse(shop).root, 'web->api')
    const lbToApi = kid(https, 'lb->api') as Arrow
    expect(lbToApi.from).toBe(kid(https, 'lb'))
    expect(lbToApi.to!.id).toBe('api')
    expect(lbToApi.to!.parent!.id).toBe('')
  })

  it('reports errors with a line, a column and a plain message', () => {
    expect(errorsOf('\tx')).toEqual(['1:1 Indent with spaces, not tabs.'])
    expect(errorsOf('a\n    b\n  c')).toEqual(['3:3 This line is indented 2 spaces, but the lines next to it use 4.'])
    expect(errorsOf('a\na')).toEqual(['2:1 "a" is already used here.'])
    expect(errorsOf('a "oops')).toEqual(['1:3 This text has no closing quote.'])
    expect(errorsOf('a "x" "y"')).toEqual(['1:7 A node has only one label. Put more text in a property, like note="...".'])
    expect(errorsOf('a/b')).toEqual(['1:1 A box id can not contain "/". To connect two boxes, write a -> b.'])
    expect(errorsOf('a color=')).toEqual(['1:3 "color=" needs a value.'])
    expect(errorsOf('a ->')).toEqual(['1:5 An arrow needs an end after "->".'])
    expect(errorsOf('"Label"')).toEqual(['1:1 A line starts with an id, then the label: web "Web app".'])
    expect(errorsOf('9lives')).toEqual(['1:1 "9lives" must start with a letter or "_".'])
    expect(errorsOf('a"A"')).toEqual(['1:2 Put a space here.'])
    expect(errorsOf('a\nb\nc\na -> b -> c')).toEqual(['4:8 One arrow per line. Write the next arrow on its own line.'])
  })

  it('checks what arrows point at, with a hint for typos', () => {
    expect(errorsOf('orders\nsave\norder -> save')).toEqual(['3:1 Can not find "order". Did you mean "orders"?'])
    expect(errorsOf('api\n  orders\ndb\napi/order -> db')).toEqual(['4:5 "api" has no "order" inside. Did you mean "orders"?'])
    expect(errorsOf('a\na -> a')).toEqual(['2:1 An arrow can not point at itself.'])
    expect(errorsOf('a\n  b\na/b -> a')).toEqual(['3:1 An arrow can not connect a box with a box around it: "a" holds "b".'])
  })

  it('skips a broken line and what is inside it, and keeps everything else', () => {
    const { root, errors } = parse('a/b\n  c\n  d\ne\nf "F"')
    expect(errors).toHaveLength(1)
    expect(ids(root)).toEqual(['e', 'f'])
    expect((root.kids[1] as Box).label).toBe('F')
  })
})
