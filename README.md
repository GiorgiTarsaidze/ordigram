# Ordigram

Another sexy set of diagrams where everything is a node.

You write a diagram as plain text. Any box can hold a whole diagram of its own, and so can any arrow.
Click a box to go inside it, as deep as the system goes. A connection written deep inside shows up on
every level above it, so the big picture always matches the details.

```
web "Web app"
api "API"
  orders "Orders service"
  auth "Auth service"
  auth -> orders "token ok"
db "Orders DB" shape=cylinder
web -> api "HTTPS" flow
api/orders -> db "SQL"
```

On the top level this draws `web -> api -> db`. Open `api` and you see `auth -> orders`, with `db`
outside. The whole format is five rules: see [SPEC.md](SPEC.md).

## Try it

```sh
pnpm install
pnpm dev      # the playground, on http://localhost:5173
```

The playground puts the text on the left and the drawing on the right:

- Type, and the drawing glides to its new layout.
- Double-click a stacked box, or click its "inside ›", to open it. `Esc` or the path at the top goes back.
- Hover a box or an arrow to light up its line. Put the cursor on a line to light up its box.
- Mistakes show with a line, a column and a hint, and the rest still draws.
- Each diagram keeps your changes in this browser. **Reset** brings back the original.
- Scroll, or hold Space and drag, to pan. Ctrl + scroll (or a pinch) zooms. The corner control and the
  `+`, `-` and `0` keys zoom in, out and back to fit.
- **Export** downloads the whole diagram as a `.ordi` file, or the level you see as SVG or PNG.

The mouse edits the text too, so you can draw instead of typing:

| Do this | And the text gets |
|---|---|
| Drag a box | `at=x,y` on its line. No other box moves. |
| Drag on empty space, or Shift-click | nothing yet: it selects boxes, like files on a desktop |
| Drag one of several selected boxes | `at=x,y` on each of them, in one step |
| Hold Shift while dragging | the box lined up with the box its arrow comes from, so the arrow runs straight |
| Double-click empty space | a new line, `box1 "Box 1"`, inside the open level |
| Drag one of the four dots on a box onto a side of another box | a new line, `a -> b from=right to=left`. The arrow keeps those sides when boxes move. |
| Double-click a box, or select it and press `Enter` | its label, typed in place |
| Select boxes or arrows and press `Delete` | those lines removed, with every arrow to the boxes |
| Press **Tidy** | every `at=` on the level removed |

`Ctrl+Z` undoes any of it, typed or drawn, because it is all one text.

## How it works

Four parts, each one small:

| Part | File | What it does |
|---|---|---|
| **Parser** | `src/parser.ts` | Text to a tree of nodes, in one pass. Finds what each arrow points at. |
| **Builder** | `src/builder.ts` | For one open node: its boxes, and every arrow that touches its inside, bubbled up. |
| **Drawer** | `src/drawer.ts` | Puts one level on screen as SVG, and reports what the mouse does. |
| **Writer** | `src/writer.ts` | Turns a change, like "move this box", into the smallest edit of the text. |

The Drawer uses `src/layout.ts`, which places boxes in columns, orders them to cut crossings, and
solves their heights exactly. It needs no browser, so it is tested on its own.

```sh
pnpm test     # 47 tests
pnpm check    # types
pnpm bench    # speed on a made-up file of 22,200 lines and 10,000 arrows
```

On that file, on one laptop on 2026-10-08: the parser reads it in about 7 to 9 ms, opening any level
takes 0.002 ms after the first, and laying out a level of 200 boxes takes under 1 ms.

## Status

Version 0.1. Next: pan and zoom, export and share links, and plugins for new shapes and properties.
