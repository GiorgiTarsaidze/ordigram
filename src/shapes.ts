// The default elements. Each one is drawn around 0,0.
// Later, plugins add more elements to this table.

export interface Shape {
  /** Grows the room the text needs into the size of the whole element. */
  fit(w: number, h: number): [number, number]
  /** The outline, as an SVG path. */
  outline(w: number, h: number): string
  /** Lines drawn on top of the outline, like the rim of a cylinder. */
  detail?(w: number, h: number): string
  /** Moves the text down inside the element. */
  dy?: number
}

const round = (n: number) => Math.round(n * 10) / 10

function rect(cx: number, cy: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h / 2)
  const x = cx - w / 2
  const y = cy - h / 2
  const arc = (tx: number, ty: number) => `A${round(r)},${round(r)} 0 0 1 ${round(tx)},${round(ty)}`
  return `M${round(x + r)},${round(y)}H${round(x + w - r)}${arc(x + w, y + r)}V${round(y + h - r)}${arc(x + w - r, y + h)}`
    + `H${round(x + r)}${arc(x, y + h - r)}V${round(y + r)}${arc(x + r, y)}Z`
}

function circle(cx: number, cy: number, r: number): string {
  return `M${round(cx - r)},${round(cy)}A${round(r)},${round(r)} 0 1 0 ${round(cx + r)},${round(cy)}A${round(r)},${round(r)} 0 1 0 ${round(cx - r)},${round(cy)}Z`
}

/** A closed shape through the points, with every corner rounded off. */
function soft(points: [number, number][], radius: number): string {
  const n = points.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const [px, py] = points[(i + n - 1) % n]
    const [cx, cy] = points[i]
    const [nx, ny] = points[(i + 1) % n]
    const into = Math.hypot(cx - px, cy - py)
    const out = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(radius, into / 2, out / 2)
    const ax = cx - ((cx - px) / into) * r
    const ay = cy - ((cy - py) / into) * r
    const bx = cx + ((nx - cx) / out) * r
    const by = cy + ((ny - cy) / out) * r
    d += `${i ? 'L' : 'M'}${round(ax)},${round(ay)}Q${round(cx)},${round(cy)} ${round(bx)},${round(by)}`
  }
  return d + 'Z'
}

const rim = (h: number) => Math.min(9, h / 6)

export const shapes: Record<string, Shape> = {
  box: {
    fit: (w, h) => [w, h],
    outline: (w, h) => rect(0, 0, w, h, 10),
  },
  round: {
    fit: (w, h) => [w + 16, h],
    outline: (w, h) => rect(0, 0, w, h, h / 2),
  },
  circle: {
    fit: (w, h) => {
      const d = Math.max(w * 0.95, h + 24)
      return [d, d]
    },
    outline: w => circle(0, 0, w / 2),
  },
  diamond: {
    fit: (w, h) => [w * 1.45 + 16, h * 1.7],
    outline: (w, h) => soft([[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]], 8),
  },
  cylinder: {
    fit: (w, h) => [w, h + 16],
    outline: (w, h) => {
      const e = rim(h)
      const top = -h / 2 + e
      const bottom = h / 2 - e
      return `M${round(-w / 2)},${round(top)}A${round(w / 2)},${round(e)} 0 0 1 ${round(w / 2)},${round(top)}V${round(bottom)}`
        + `A${round(w / 2)},${round(e)} 0 0 1 ${round(-w / 2)},${round(bottom)}Z`
    },
    detail: (w, h) => {
      const top = -h / 2 + rim(h)
      return `M${round(-w / 2)},${round(top)}A${round(w / 2)},${round(rim(h))} 0 0 0 ${round(w / 2)},${round(top)}`
    },
    dy: 6,
  },
  person: {
    fit: (w, h) => [w, h + 24],
    outline: (w, h) => rect(0, 0, w, h, 14),
    // A small head and shoulders above the label.
    detail: (_, h) => {
      const top = -h / 2
      return circle(0, top + 15, 5.5) + `M-10,${round(top + 32)}A10,8.5 0 0 1 10,${round(top + 32)}`
    },
    dy: 12,
  },
  text: {
    fit: (w, h) => [w, h],
    outline: (w, h) => rect(0, 0, w, h, 8),
  },
}
