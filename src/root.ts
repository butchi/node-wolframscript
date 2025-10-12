import * as func from './func.js'
import type { Action } from './types.js'
// Matra parser replaces previous wjs sugar
import { parseMatra, matraToExpressionJSON } from './matra.js'
import { ALLOWED_NAMES, nameToHead } from './func.js'

console.log('Hello, world!')

const mainElm = document.querySelector('main')!
const nbElm = document.querySelector<HTMLDivElement>('#nb')!

const inputTmpl = document.querySelector<HTMLTemplateElement>('#input')!
const outputTmpl = document.querySelector<HTMLTemplateElement>('#output')!

let inputClone = inputTmpl.content.firstElementChild!.cloneNode(true) as HTMLElement
let inputElm = nbElm.appendChild(inputClone)

const contentClone = (
  document.querySelector<HTMLTemplateElement>('#container')!.content.firstElementChild! as HTMLElement
).cloneNode(true) as HTMLElement
contentClone.querySelector('[data-slot]')!.appendChild(mainElm)
document.body.appendChild(contentClone)

// for debug: expose individual function names and the namespace on globalThis
// expose W.<Head>(...) sugar via a Proxy so arbitrary heads need not be predeclared
// @ts-ignore
;(globalThis as any).W = new Proxy(
  {},
  {
    // property access: W.Plus -> returns a caller for head 'Plus'
    get: (_target, prop) => {
      if (typeof prop === 'string') return (func as any).W(prop)
      return undefined
    },
  }
)

// Provide an `M` namespace for the restricted, user-friendly aliases.
// `M.Plus` and `M.Times` behave like `W.Plus`/`W.Times` but are intended to be
// the target for small-letter convenience functions (plus(), times(), ...).
// @ts-ignore
;(globalThis as any).M = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (typeof prop === 'string') return (func as any).W(prop)
      return undefined
    },
  }
)

// Limit global convenience names to a small curated set and map to M.<Head>
// This keeps the door open for future specialized implementations that accept
// primitive values and expressions seamlessly while currently delegating to W/M.

// Re-route small-letter convenience functions to the `M` namespace (restricted)
// so `plus(...)` -> `M.Plus(...)`. Keep `W.*` as the unrestricted raw caller.
// @ts-ignore
;(globalThis as any).plus = (...args: unknown[]) => (globalThis as any).M.Plus(...args)
// @ts-ignore
;(globalThis as any).times = (...args: unknown[]) => (globalThis as any).M.Times(...args)

// also expose the func namespace for debugging convenience (not all names bound globally)
// @ts-ignore
;(globalThis as any).func = func

// Developer convenience: template-tag helpers for explicit Matra/ExpressionJSON construction
// Usage:
//   matra`W.Plus(1,2,3)` -> returns Matra AST for the content
//   matraExpr`["Plus",1,2,3]` -> returns ExpressionJSON (as JS array)
//   expressionJSON(["Plus",1,2,3]) -> identity helper
// These helpers are intended for developer/debug use and make intent explicit.
// @ts-ignore
;(globalThis as any).matra = (strings: TemplateStringsArray, ...args: any[]) => {
  const s = strings.raw[0]
  try {
    return parseMatra(s)
  } catch (e) {
    console.error('matra parse error:', e)
    return null
  }
}
// @ts-ignore
;(globalThis as any).matraExpr = (strings: TemplateStringsArray, ...args: any[]) => {
  const s = strings.raw[0].trim()
  // If looks like JSON array, parse directly
  if (s.startsWith('[')) {
    try {
      return JSON.parse(s)
    } catch (e) {
      console.error('matraExpr JSON parse error:', e)
      return null
    }
  }

  // Otherwise parse as Matra and convert to ExpressionJSON
  try {
    const ast = parseMatra(s)
    // Special-case: object with xpath pointing to /W/Head -> map to that head
    if (Array.isArray(ast) && ast[0] === 'object' && ast[1] && typeof ast[1] === 'object') {
      const attrs = ast[1] as Record<string, any>
      const xpath = attrs['xpath']
      if (typeof xpath === 'string') {
        const m = xpath.match(/^\/W\/([A-Za-z_][\w]*)$/)
        if (m) {
          const head = m[1]
          const args = Array.isArray(ast[2]) ? ast[2] : []
          const out: any[] = [head, ...args]
          for (const [k, v] of Object.entries(attrs)) {
            if (k === 'xpath') continue
            out.push(['Rule', k, v])
          }
          return out
        }
      }
    }

    // Fallback: use generic matraToExpressionJSON
    return matraToExpressionJSON(ast, { nameToHead })
  } catch (e) {
    console.error('matraExpr conversion error:', e)
    return null
  }
}
// @ts-ignore
;(globalThis as any).expressionJSON = (arr: any[]) => arr

// 入力タイプ判定関数（Matra対応: デフォルトはMatraとみなす）
function detectInputType(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^```([a-zA-Z0-9]*)\n[\s\S]*\n```$/.test(trimmed)) {
    const m = trimmed.match(/^```([a-zA-Z0-9]*)\n/)
    const lang = m && m[1]
    const l = lang ? lang.toLowerCase() : 'js'
    return l === 'wjs' ? 'matra' : l
  }
  if (/^[a-zA-Z0-9]+`[\s\S]*`$/.test(trimmed)) {
    const m = trimmed.match(/^([a-zA-Z0-9]+)`/)
    const l = m ? m[1].toLowerCase() : null
    return l === 'wjs' ? 'matra' : l
  }
  if (/^`[\s\S]*`$/.test(trimmed)) return 'js'
  if (/^[a-zA-Z0-9]+`[\s\S]*`$/.test(trimmed)) {
    const m = trimmed.match(/^([a-zA-Z0-9]+)`/)
    const lang = m && m[1]
    const l = lang ? lang.toLowerCase() : null
    return l === 'wjs' ? 'matra' : l
  }
  if (/^\$\$\n[\s\S]*\n\$\$$/.test(trimmed)) return 'texblock'
  if (/^\$[\s\S]*\$$/.test(trimmed)) return 'tex'
  try {
    JSON.parse(trimmed)
    return 'json'
  } catch {}
  // 既定はMatraとみなす
  return 'matra'
}

// Matra parsing helpers are in src/matra.ts and imported above

const evaluate = async ({ action }: { action?: Action } = {}) => {
  const textarea = inputElm.querySelector<HTMLTextAreaElement>('textarea')
  const input = textarea?.value ?? ''
  if (!input?.trim()) return
  if (textarea) textarea.disabled = true
  console.log('Action:', action)
  console.log('Input:', input)

  let obj: unknown,
    exprStr = '',
    cmd = ''
  let jsonStr: string | undefined,
    jsStr: string | undefined,
    texFragment: string | undefined,
    wolframStr: string | undefined
  let jsonObj: unknown, exprJsonObj: unknown

  const replacer = (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value as Record<string, unknown>)
      if (keys.length === 2 && keys.includes('head') && keys.includes('body') && Array.isArray((value as any).body)) {
        if ((value as any).body.length === 0) return (value as any).head
        return [(value as any).head, ...(value as any).body]
      }
    }
    return value as any
  }

  // 入力タイプ判定
  const type = detectInputType(input)
  const trimmed = input.trim()

  console.log('Detected input type:', type)

  switch (type) {
    case 'json':
      try {
        const str = trimmed
          .replace(/^```[a-zA-Z0-9]*\n/, '')
          .replace(/\n```$/, '')
          .replace(/^[a-zA-Z0-9]+`|`$/g, '')
          .trim()
        jsonObj = JSON.parse(str)
        try {
          exprJsonObj = JSON.parse(jsonObj as string)
          obj = exprJsonObj
        } catch {
          obj = jsonObj
        }
        jsonStr = JSON.stringify(obj)
        console.log('Parsed JSON:', obj)
      } catch {
        console.info('input is not JSON')
      }
      break
    case 'js':
      jsStr = trimmed
        .replace(/^```[a-zA-Z0-9]*\n/, '')
        .replace(/\n```$/, '')
        .replace(/^[a-zA-Z0-9]+`|`$/g, '')
        .trim()
      // eslint-disable-next-line no-eval
      obj = eval(`(${jsStr})`)
      console.log('JavaScript String:', jsStr)
      break
    case 'matra':
      // Matra: tag [attrs]? { [[args]]? }
      jsStr = trimmed
        .replace(/^```[a-zA-Z0-9]*\n/, '')
        .replace(/\n```$/, '')
        .replace(/^[a-zA-Z0-9]+`|`$/g, '')
        .trim()
      try {
        const ast = parseMatra(jsStr)
        // Disallow bare capitalized sugar calls that match allowed canonical heads
        // e.g. `Plus(1,2)` should be disallowed; use `plus(...)` or `W.Plus(...)`.
        const sugarMatch = jsStr.match(/^([a-zA-Z_][\w-]*)\s*\(/)
        if (sugarMatch) {
          const called = sugarMatch[1]
          // build allowed canonical head names from ALLOWED_NAMES
          const allowedCanonical = new Set<string>()
          for (const n of ALLOWED_NAMES) {
            const head = nameToHead(n) ?? n[0].toUpperCase() + n.slice(1)
            allowedCanonical.add(head)
          }
          if (/^[A-Z]/.test(called) && allowedCanonical.has(called)) {
            throw new Error(`Disallowed bare head call: ${called}. Use lower-case shorthand or W.${called}`)
          }
        }
        // 旧Expr {head,body} ではなく、Matra ASTを保持
        obj = ast
        // If no explicit action requested, choose sensible default based on head
        if (!action && Array.isArray(ast) && typeof ast[0] === 'string') {
          const head = ast[0] as string
          // For plotting-like heads, prefer vector output; otherwise JSON
          if (head.toLowerCase() === 'plot' || head.toLowerCase() === 'plot3d') action = 'vector'
          else action = 'json'
        }
      } catch (e) {
        console.info('Matra parse failed:', e)
      }
      break
    case 'wolfram':
    case 'wl':
      wolframStr = trimmed
        .replace(/^```[a-zA-Z0-9]*\n/, '')
        .replace(/\n```$/, '')
        .replace(/^[a-zA-Z0-9]+`|`$/g, '')
        .trim()
      exprStr = wolframStr
      console.log('Wolfram String:', wolframStr)
      break
    case 'tex':
      texFragment = trimmed.slice(1, -1).trim()
      break
    case 'texblock':
      texFragment = trimmed.slice(3, -3).trim()
      break
    default:
      console.log('Invalid input format, expected JSON, JavaScript, or TeX Fragment')
  }

  if (!exprStr) {
    if (obj != null) {
      // Matra AST -> ExpressionJSON 配列
      if (Array.isArray(obj) && typeof obj[0] === 'string') {
        const ast = obj as any
        const exprJsonArr = matraToExpressionJSON(ast, { nameToHead })
        const exprJsonStr = JSON.stringify(exprJsonArr).replace(/"/g, '\\"')
        exprStr = `ImportString["${exprJsonStr}", "ExpressionJSON"]`
        cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
      } else {
        // JSON/JS raw object/array fallthrough (legacy support)
        const exprJsonStr = JSON.stringify(obj, replacer as any, 2).replace(/"/g, '\\"')
        exprStr = `ImportString["${exprJsonStr}", "ExpressionJSON"]`
        cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
      }
    } else if (texFragment != null) {
      exprStr = `ToExpression["${texFragment.replaceAll('\\', '\\\\')}", TeXForm]`
      cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
    }
  }

  // アクションごとのコマンド生成
  if (action) {
    const actionMap: Record<string, string> = {
      json: `ExportString[${exprStr}, "ExpressionJSON"]`,
      mathml: `ExportString[${exprStr}, "MathML"]`,
      tex: `ExportString[${exprStr}, "TeXFragment"]`,
      raster: `ExportString[${exprStr}, {"Base64", "PNG"}]`,
      vector: `ExportString[${exprStr}, {"Base64", "SVG"}]`,
      audio: `ExportString[${exprStr}, {"Base64", "MP3"}]`,
      text: exprStr,
    }
    cmd = actionMap[action] ?? cmd
  }

  console.log('Command:', cmd)
  const res = await fetch('/wolfram/exec', {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: encodeURIComponent(cmd) }),
  })
  const output = await res.text()
  console.log(output)
  const outputClone = outputTmpl.content.firstElementChild!.cloneNode(true) as HTMLElement

  // 出力処理
  switch (action) {
    case 'mathml':
      outputClone.innerHTML = `<p>${output}</p>`
      break
    case 'tex':
      try {
        katex.render(output.trim().slice(2, -2), outputClone, { throwOnError: false })
      } catch (err) {
        outputClone.innerHTML = `<pre>${output}</pre>`
      }
      break
    case 'raster': {
      const body = (output as string).trim()
      // If server returned the textual mock, show it instead of attempting to build a data URI
      if (body.startsWith('MOCK_RESULT:')) {
        outputClone.innerHTML = `<pre>${escapeHtml(body)}</pre>`
        break
      }
      const maybe = extractBase64OrDataUri(body)
      if (maybe.startsWith('data:')) {
        outputClone.innerHTML = `<img src="${maybe}" alt="output">`
      } else {
        outputClone.innerHTML = `<img src="data:image/png;base64,${maybe}" alt="output">`
      }
      break
    }
    case 'vector': {
      const body = (output as string).trim()
      if (body.startsWith('MOCK_RESULT:')) {
        outputClone.innerHTML = `<pre>${escapeHtml(body)}</pre>`
        break
      }
      const maybe = extractBase64OrDataUri(body)
      if (maybe.startsWith('data:')) {
        outputClone.innerHTML = `<img src="${maybe}" alt="output">`
      } else {
        outputClone.innerHTML = `<img src="data:image/svg+xml;base64,${maybe}" alt="output">`
      }
      break
    }
    case 'audio': {
      const body = (output as string).trim()
      if (body.startsWith('MOCK_RESULT:')) {
        outputClone.innerHTML = `<pre>${escapeHtml(body)}</pre>`
        break
      }
      const maybe = extractBase64OrDataUri(body)
      if (maybe.startsWith('data:')) {
        outputClone.innerHTML = `<audio controls><source src="${maybe}"></source>`
      } else {
        outputClone.innerHTML = `<audio controls><source type="audio/mpeg" src="data:audio/mpeg;base64,${maybe}"></source>`
      }
      break
    }
    default:
      outputClone.innerHTML = output as string
  }

  nbElm.appendChild(outputClone)
  inputClone = inputTmpl.content.firstElementChild!.cloneNode(true) as HTMLElement
  inputElm = nbElm.appendChild(inputClone)
  inputElm.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}

globalThis.addEventListener('keydown', async (evt) => {
  if ((evt as KeyboardEvent).shiftKey && (evt as KeyboardEvent).key === 'Enter') {
    evt.preventDefault()

    evaluate()
  }
})

document.querySelectorAll<HTMLElement>('[data-box-command] .btn').forEach((elm) => {
  elm.addEventListener('click', (_) => {
    const action = elm.getAttribute('data-action') as Action | null

    evaluate({ action: (action ?? undefined) as Action })
  })
})

console.log('Thanks, world!')

// Helper: extract either full data: URI or bare base64 payload from server output.
// Accepts strings like:
// - 'MOCK_RESULT: <cmd>'
// - 'data:image/svg+xml;base64,....'
// - 'PHN2ZyB...' (bare base64)
function extractBase64OrDataUri(s: string): string {
  const trimmed = s.trim()
  // If looks like full data URI, return as-is
  if (/^data:[a-zA-Z0-9/+.-]+;base64,/.test(trimmed)) return trimmed

  // If prefixed with MOCK_RESULT:, remove leading words up to first whitespace after colon
  const mockMatch = trimmed.match(/MOCK_RESULT:\s*(.*)$/s)
  const candidate = mockMatch ? mockMatch[1].trim() : trimmed

  // If candidate contains data:image..., extract that portion
  const dataUriMatch = candidate.match(/(data:[^\s"']+;base64,[A-Za-z0-9+/=\r\n]+)/)
  if (dataUriMatch) return dataUriMatch[1]

  // If candidate looks like a base64 string (letters, numbers, +,/ and =), return it
  const b64 = candidate.replace(/\s+/g, '')
  if (/^[A-Za-z0-9+/=]+$/.test(b64)) return b64

  // Fallback: return original trimmed string
  return trimmed
}

// Simple HTML escaper for safe insertion into innerHTML when showing pre blocks
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
