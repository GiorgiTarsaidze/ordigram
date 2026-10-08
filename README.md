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
- Click a stacked box, or an arrow label with ›, to open it. `Esc` or the path at the top goes back.
- Hover a box or an arrow to light up its line. Put the cursor on a line to light up its box.
- Mistakes show with a line, a column and a hint, and the rest still draws.
- Your text is saved in the browser as you type.

## How it works

Three parts, each one small:

| Part | File | What it does |
|---|---|---|
| **Parser** | `src/parser.ts` | Text to a tree of nodes, in one pass. Finds what each arrow points at. |
| **Builder** | `src/builder.ts` | For one open node: its boxes, and every arrow that touches its inside, bubbled up. |
| **Drawer** | `src/drawer.ts` | Puts one level on screen as SVG, and animates between levels and edits. |

The Drawer uses `src/layout.ts`, which places boxes in columns, orders them to cut crossings, and
solves their heights exactly. It needs no browser, so it is tested on its own.

```sh
pnpm test     # 32 tests
pnpm check    # types
pnpm bench    # speed on a made-up file of 22,200 lines and 10,000 arrows
```

On that file, on one laptop on 2026-10-08: the parser reads it in about 7 to 9 ms, opening any level
takes 0.002 ms after the first, and laying out a level of 200 boxes takes under 1 ms.

## Status

Version 0.1. You edit by typing. Next: dragging a box writes its position into the text, more
animation, and plugins for new shapes and properties.
