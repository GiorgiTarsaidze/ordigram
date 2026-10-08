import { test } from 'vitest'
import { build } from '../src/builder'
import { layout } from '../src/layout'
import { parse } from '../src/parser'

// A big made-up system: 200 services, each with 10 parts of 5 steps, and calls between services.
function bigFile(services = 200, parts = 10, steps = 5): string {
  const lines: string[] = []
  for (let s = 0; s < services; s++) {
    lines.push(`s${s} "Service ${s}" color=blue`)
    for (let p = 0; p < parts; p++) {
      lines.push(`  p${p} "Part ${p}"`)
      for (let k = 0; k < steps; k++) lines.push(`    k${k} "Step ${k}"`)
      for (let k = 0; k + 1 < steps; k++) lines.push(`    k${k} -> k${k + 1}`)
    }
    for (let p = 0; p + 1 < parts; p++) lines.push(`  p${p} -> p${p + 1} "next" flow`)
  }
  for (let s = 0; s < services; s++) lines.push(`s${s}/p0/k0 -> s${(s + 1) % services}/p1/k1 "call"`)
  return lines.join('\n')
}

const text = bigFile()
const doc = parse(text)
const top = build(doc, doc.root)
const nodes = top.boxes.map(b => ({ key: b.id, w: 140, h: 60 }))
const edges = top.links.map(l => ({ key: l.key, from: l.from.id, to: l.to.id, label: { w: 50, h: 22 } }))

test(`${text.split('\n').length} lines, ${doc.arrows.length} arrows`, async ({ bench }) => {
  await bench.compare(
    bench('parse the whole file', () => {
      parse(text)
    }),
    bench('build the top level (first time, with the index)', () => {
      const fresh = { ...doc }
      build(fresh, fresh.root)
    }),
    bench('build one service (index ready)', () => {
      build(doc, doc.root.kids[7])
    }),
    bench(`layout the top level (${nodes.length} boxes, ${edges.length} arrows)`, () => {
      layout(nodes, edges)
    }),
  )
})
