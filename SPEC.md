# The Ordigram format, v0.1

Another sexy set of diagrams where everything is a node. A file is the top node. Every line in it is
a node, a comment, or blank. The inside of a node is a diagram made of more nodes.

```
# An online shop
web "Web app"
api "API"
  orders "Orders service"
  auth "Auth service"
  auth -> orders "token ok"
db "Orders DB" shape=cylinder
web -> api "HTTPS" flow
api/orders -> db "SQL"
```

The file is UTF-8. Lines end with `\n` or `\r\n`.

## Rule 1: one line is one node

```
id "Label" key=value flag
```

- **id**: letters `a-z A-Z`, digits, `_` and `-`. It starts with a letter or `_`. Two boxes inside the
  same node can not share an id.
- **label**: optional, in double quotes. Inside it, `\"` is a quote, `\\` a backslash and `\n` a new
  line. Without a label, the id is shown.
- **properties**: optional, any number. `key=value`, or just `key`, which means "on". A value with
  spaces goes in quotes: `note="two words"`.
- **comments**: `#` starts a comment at the start of a line, or after a space. Inside a value,
  `#` is just a character: `color=#e0a800`.

## Rule 2: indent a line to put it inside

- Indent with spaces. Tabs are an error.
- A line indented more than the line above it goes inside that line's node.
- Lines inside the same node use the same indentation.

## Rule 3: an arrow is a node too

```
from -> to "Label" key=value
```

- It is drawn as an arrow. Lines indented under it are its inside, just like a box.
- Its id is `from->to`. A second arrow with the same ends in the same node gets `from->to#2`.

## Rule 4: names are looked up like variables

- `from` and `to` are paths: `api`, or `api/orders/save` to reach inside.
- The first part of a path is looked up in the node that holds the arrow, then in its parent, and so
  on up to the top. The other parts go inside, one level each.
- An arrow can not point at itself, and can not connect a box with a box around it.

## Rule 5: arrows bubble up

When you open a node, you see its inside:

- every box directly inside it;
- every arrow with at least one end somewhere inside it;
- an end deeper down is drawn at the box that holds it. This arrow is **bubbled**;
- an end outside the open node is drawn as a dashed **outside** box;
- an arrow with both ends inside the same box is not drawn here. It belongs to that box's inside;
- the inside of an arrow is only shown when you open that arrow.

Many arrows between the same two boxes are drawn as one, with a count.

Example: `api/orders -> db` is written once. On the top level it is drawn `api -> db`. Inside `api`
it is drawn `orders -> db`, with `db` as an outside box.

## Properties the basic drawer knows

| Property | Values | Meaning |
|---|---|---|
| `shape` | `box` (default), `round`, `circle`, `diamond`, `cylinder`, `person`, `text` | The outline of a box |
| `color` | `blue`, `green`, `red`, `gold`, `purple`, `grey`, or a hex color like `#e0a800` | The color of a box |
| `size` | `WxH`, like `200x80` | A fixed size, instead of fitting the label |
| `at` | `x,y`, like `120,80` | A fixed position for the center, instead of the automatic layout |
| `flow` | on arrows | Dots move along the arrow, from start to end |
| `from`, `to` | on arrows: `top`, `right`, `bottom`, `left` | The side of its start box the arrow leaves from, and the side of its end box it arrives at. Without them, the sides follow where the boxes are. |

Every other property is kept and ignored. Later, plugins give them a meaning.

## Errors

The parser never stops at the first error. Every error has a line, a column and a plain message.
A broken line and the lines inside it are skipped; everything else is still drawn.
