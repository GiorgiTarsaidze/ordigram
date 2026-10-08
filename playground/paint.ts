// Colors the text for the editor. It follows the same rules as the parser, but only to pick colors.

const escape = (s: string) => s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
const span = (cls: string, s: string) => (s ? `<span class="${cls}">${escape(s)}</span>` : '')
const isWord = (c: string | undefined) => c !== undefined && /[\w\-/]/.test(c)
const isSpace = (c: string | undefined) => c === ' ' || c === '\t'

/** HTML for the whole text. Lines in `bad` get a wavy underline. */
export function paint(text: string, bad: Set<number>): string {
  return text.split('\n').map((line, i) => (bad.has(i + 1) ? `<span class="bad">${paintLine(line)}</span>` : paintLine(line))).join('\n') + '\n'
}

function paintLine(src: string): string {
  let i = 0
  while (isSpace(src[i])) i++
  let out = src.slice(0, i)
  if (src[i] === '#') return out + span('cm', src.slice(i))

  const word = () => {
    const start = i
    while (isWord(src[i]) && !(src[i] === '-' && src[i + 1] === '>')) i++
    return src.slice(start, i)
  }
  const spaces = () => {
    const start = i
    while (isSpace(src[i])) i++
    return src.slice(start, i)
  }
  const string = () => {
    const start = i++
    while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
    i = Math.min(i + 1, src.length)
    return src.slice(start, i)
  }

  const first = word()
  const gap = spaces()
  if (src.startsWith('->', i)) {
    i += 2
    out += span('ref', first) + gap + span('op', '->') + spaces()
    out += span('ref', word())
  } else out += span('id', first) + gap

  while (i < src.length) {
    const c = src[i]
    if (isSpace(c)) out += spaces()
    else if (c === '#' && isSpace(src[i - 1])) {
      out += span('cm', src.slice(i))
      break
    } else if (c === '"') out += span('str', string())
    else if (/[A-Za-z_]/.test(c)) {
      const start = i
      while (/[\w-]/.test(src[i] ?? '')) i++
      out += span('key', src.slice(start, i))
      if (src[i] === '=') {
        i++
        out += span('op', '=')
        if (src[i] === '"') out += span('str', string())
        else {
          const at = i
          while (i < src.length && !isSpace(src[i])) i++
          out += span('val', src.slice(at, i))
        }
      }
    } else {
      out += escape(c)
      i++
    }
  }
  return out
}
