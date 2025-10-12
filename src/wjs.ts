/**
 * Utilities to parse the lightweight wjs sugar syntax used in the UI.
 * Exported so we can unit-test the parser independently from DOM code.
 */
export function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = []
  let buf = ''
  let depth = 0
  let inString: boolean | string = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) {
      buf += ch
      esc = false
      continue
    }
    if (inString) {
      buf += ch
      if (ch === inString) inString = false
      if (ch === '\\') esc = true
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
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
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf !== '') parts.push(buf)
  return parts.map((p) => p.trim())
}

export function parseWjsToken(token: string): unknown {
  const t = token.trim()
  if (t === '') return undefined

  // W.Head(...) form -> produce Expr-like object { head, body }
  const wMatch = t.match(/^W\.([a-zA-Z_$][\w$]*)\s*\((.*)\)$/s)
  if (wMatch) {
    const head = wMatch[1]
    const inner = wMatch[2].trim()
    const innerParts = inner.length > 0 ? splitTopLevelCommas(inner) : []
    const args = innerParts.map((p) => parseWjsToken(p))
    return { head, body: args }
  }

  // generic call form name(...) -> produce { call, args }
  const callMatch = t.match(/^([a-zA-Z_$][\w$]*)\s*\((.*)\)$/s)
  if (callMatch) {
    const name = callMatch[1]
    const inner = callMatch[2].trim()
    const innerParts = inner.length > 0 ? splitTopLevelCommas(inner) : []
    const args = innerParts.map((p) => parseWjsToken(p))
    return { call: name, args }
  }

  // number
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t)

  // boolean or null
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null

  // quoted string or JSON literal
  try {
    return JSON.parse(t)
  } catch {
    // fallback: return raw token as string
    return t
  }
}

export const parseWjsExpression = (s: string): unknown => parseWjsToken(s)
