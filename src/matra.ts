// Lightweight Matra parser and transformer for this project
// Supported forms (minimal subset):
// - funcName(args...)            -> sugar for funcName { [[args...]] }
// - funcName[opts] { [[args]] } -> full form with attributes and args array
// Attributes syntax examples: [a: 1, b="x", flag]
// Values support: numbers, booleans, null, double-quoted strings, arrays ([...]/[[...]]), objects ({...}/[{...}])

export type MatraAst = [string, Record<string, unknown>, unknown[]]

// --- small helpers ---
const isWhitespace = (ch: string) => /\s/.test(ch)

function findMatching(input: string, start: number, open: string, close: string): number {
  let i = start
  let depth = 0
  let inStr: false | '"' | "'" = false
  let esc = false
  for (; i < input.length; i++) {
    const ch = input[i]
    if (esc) {
      esc = false
      continue
    }
    if (inStr) {
      if (ch === '\\') {
        esc = true
      } else if (ch === inStr) {
        inStr = false
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch as '"' | "'"
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = []
  let buf = ''
  let depth = 0
  let inStr: false | '"' | "'" = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) {
      buf += ch
      esc = false
      continue
    }
    if (inStr) {
      buf += ch
      if (ch === '\\') esc = true
      else if (ch === inStr) inStr = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch as '"' | "'"
      buf += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      buf += ch
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      buf += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim() !== '') parts.push(buf.trim())
  return parts
}

function tryJsonParse(token: string): unknown | undefined {
  try {
    return JSON.parse(token)
  } catch {}
  return undefined
}

function parseNumberBoolNull(t: string): unknown | undefined {
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  return undefined
}

function parseArray(src: string): unknown[] {
  // Accept [[...]] (Matra) or [...]
  let inner = src
  if (src.startsWith('[[') && src.endsWith(']]')) inner = src.slice(2, -2)
  else if (src.startsWith('[') && src.endsWith(']')) inner = src.slice(1, -1)
  else return [src]
  const parts = splitTopLevelCommas(inner)
  return parts.map((p) => parseValue(p))
}

function parseObject(src: string): Record<string, unknown> {
  // Accept [{...}] (Matra) or {...}
  let inner = src
  if (src.startsWith('[{') && src.endsWith('}]')) inner = src.slice(2, -2)
  else if (src.startsWith('{') && src.endsWith('}')) inner = src
  else return { __raw: src } as any

  // Try JSON first
  const asJson = tryJsonParse(inner)
  if (asJson !== undefined && typeof asJson === 'object' && asJson !== null && !Array.isArray(asJson)) {
    return asJson as Record<string, unknown>
  }

  // Fallback: naive key: value list split (non-JSON)
  const body = inner.startsWith('{') && inner.endsWith('}') ? inner.slice(1, -1) : inner
  const obj: Record<string, unknown> = {}
  const items = splitTopLevelCommas(body)
  for (const it of items) {
    const m = it.match(/^([a-zA-Z_][\w-]*)\s*(:|=)?\s*(.*)$/s)
    if (m) {
      const key = m[1]
      const hasVal = Boolean(m[2])
      const valSrc = m[3]?.trim()
      obj[key] = hasVal && valSrc ? parseValue(valSrc) : true
    }
  }
  return obj
}

function parseValue(token: string): unknown {
  const t = token.trim()
  if (t === '') return null

  // Matra or sugar inside values: try recursively
  try {
    // accept W.Head(...) nested calls as Matra too
    if (/^W\.[a-zA-Z_][\w$]*\s*\(/.test(t) || /^[a-zA-Z_][\w-]*\s*(\(|\[|\{)/.test(t)) {
      return parseMatra(t)
    }
  } catch {}

  // JSON first (strings with double quotes, numbers, arrays, objects)
  const asJson = tryJsonParse(t)
  if (asJson !== undefined) return asJson

  // number/bool/null (non-JSON forms)
  const prim = parseNumberBoolNull(t)
  if (prim !== undefined) return prim

  // arrays and objects (Matra variants)
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('[[') && t.endsWith(']]'))) return parseArray(t)
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[{') && t.endsWith('}]'))) return parseObject(t)

  // fallback: bare identifier -> treat as string literal
  return t
}

function parseAttributes(src: string): Record<string, unknown> {
  const s = src.trim()
  if (!s) return {}
  const items = splitTopLevelCommas(s)
  const obj: Record<string, unknown> = {}
  for (const it of items) {
    const m = it.match(/^([a-zA-Z_][\w-]*)\s*(?::|=)?\s*(.*)?$/s)
    if (m) {
      const key = m[1]
      const valRaw = (m[2] ?? '').trim()
      obj[key] = valRaw ? parseValue(valRaw) : true
    }
  }
  return obj
}

export function parseMatra(input: string): MatraAst {
  const s = input.trim()
  // Special-case: W.Head(...) sugar to allow W.Plus(1,2) style calls
  const wmatch = s.match(/^W\.([a-zA-Z_][\w$]*)\s*\((.*)\)$/s)
  if (wmatch) {
    const head = wmatch[1]
    const inner = wmatch[2].trim()
    const parts = inner.length > 0 ? splitTopLevelCommas(inner) : []
    const args = parts.map((p) => parseValue(p))
    return [head, {}, args]
  }
  // 1) Sugar: name(args)
  let m = s.match(/^([a-zA-Z_][\w-]*)\s*\(/)
  if (m) {
    const name = m[1]
    const openIdx = s.indexOf('(', m.index)
    const closeIdx = findMatching(s, openIdx, '(', ')')
    if (closeIdx < 0) throw new Error('Unbalanced parentheses in Matra sugar call')
    const inside = s.slice(openIdx + 1, closeIdx).trim()
    const parts = inside ? splitTopLevelCommas(inside) : []
    const args = parts.map((p) => parseValue(p))
    let attrs: Record<string, unknown> = {}
    // if last arg is plain object -> treat as options
    if (args.length > 0) {
      const last = args[args.length - 1]
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        attrs = last as Record<string, unknown>
        args.pop()
      }
    }
    return [name, attrs, args]
  }

  // 2) Full form: name [attrs]? { body? }
  m = s.match(/^([a-zA-Z_][\w-]*)/)
  if (!m) throw new Error('Invalid Matra: missing tag name')
  const name = m[1]
  let idx = m[0].length
  while (idx < s.length && isWhitespace(s[idx])) idx++

  // optional [attrs]
  let attrs: Record<string, unknown> = {}
  if (s[idx] === '[') {
    const end = findMatching(s, idx, '[', ']')
    if (end < 0) throw new Error('Unbalanced attribute brackets in Matra')
    const attrInner = s.slice(idx + 1, end)
    attrs = parseAttributes(attrInner)
    idx = end + 1
    while (idx < s.length && isWhitespace(s[idx])) idx++
  }

  // optional { body }
  let args: unknown[] = []
  if (s[idx] === '{') {
    const end = findMatching(s, idx, '{', '}')
    if (end < 0) throw new Error('Unbalanced block in Matra')
    const blkInner = s.slice(idx + 1, end).trim()
    if (blkInner) {
      // Expect a single array literal representing args
      // Accept [[...]] or [...]
      const arr = parseArray(blkInner)
      // If parseArray failed (returned [src]), retry treating as list of elements
      if (arr.length === 1 && typeof arr[0] === 'string' && arr[0] === blkInner) {
        const parts = splitTopLevelCommas(blkInner)
        args = parts.map((p) => parseValue(p))
      } else {
        args = arr
      }
    }
  }

  return [name, attrs, args]
}

// Convert MatraAst -> ExpressionJSON array: [Head, ...args, ["Rule", key, val]...]
export function matraToExpressionJSON(
  ast: MatraAst,
  opts?: { nameToHead?: (name: string) => string | undefined }
): unknown[] {
  const [name, attrs, args] = ast
  const head = opts?.nameToHead?.(name) ?? name[0].toUpperCase() + name.slice(1)

  const convVal = (v: any): any => {
    // If nested MatraAst, convert recursively
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      typeof v[0] === 'string' &&
      v[1] &&
      typeof v[1] === 'object' &&
      !Array.isArray(v[1]) &&
      Array.isArray(v[2])
    ) {
      return matraToExpressionJSON(v as MatraAst, opts)
    }
    if (Array.isArray(v)) return v.map((x) => convVal(x))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, convVal(val)]))
    return v
  }

  const out: any[] = [head, ...args.map((a) => convVal(a))]
  // Special-case handling for certain high-level constructs like Plot
  // where attributes need to be turned into positional arguments or
  // mapped to specific Option names.
  if (head === 'Plot') {
    // Work on a shallow copy so we can delete processed attrs
    const a: Record<string, any> = Object.assign({}, attrs || {})

    // domain: { x: ["range", [min, max]] } -> ["List", "x", min, max]
    if (a.domain && typeof a.domain === 'object') {
      for (const [varName, rng] of Object.entries(a.domain)) {
        const rv = convVal(rng)
        if (!Array.isArray(rv) || rv.length === 0 || typeof rv[0] !== 'string') continue
        const tag = rv[0].toLowerCase()
        // Possible shapes:
        // ['range', [min, max]]
        // ['range', min, max]
        if (tag === 'range') {
          if (rv.length === 2 && Array.isArray(rv[1]) && rv[1].length === 2) {
            out.splice(2, 0, ['List', varName, rv[1][0], rv[1][1]])
            delete a.domain
            break
          }
          if (rv.length >= 3 && typeof rv[1] === 'number' && typeof rv[2] === 'number') {
            out.splice(2, 0, ['List', varName, rv[1], rv[2]])
            delete a.domain
            break
          }
        }
      }
    }

    // Map simple option keys to Wolfram option names
    const optionNameMap: Record<string, string> = {
      color: 'PlotStyle',
      samples: 'PlotPoints',
    }

    for (const [k, v] of Object.entries(a)) {
      if (k === 'domain') continue
      const optName = optionNameMap[k] ?? k[0].toUpperCase() + k.slice(1)
      let val = convVal(v)
      // Convert color string like 'red' to 'Red' symbol form (capitalized)
      if (k === 'color' && typeof val === 'string') {
        const s = val
        val = s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
      }
      out.push(['Rule', optName, val])
    }
    return out
  }

  for (const [k, v] of Object.entries(attrs || {})) {
    out.push(['Rule', k, convVal(v)])
  }
  return out
}
