import * as func from './func.js'
import type { Action, Expr } from './types.js'
import { splitTopLevelCommas, parseWjsToken } from './wjs.js'
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
for (const key in func) {
  if (Object.prototype.hasOwnProperty.call(func, key)) {
    // @ts-ignore attach for console debug
    ;(globalThis as any)[key] = (func as any)[key]
  }
}
// also expose the namespace for convenience
// @ts-ignore
;(globalThis as any).func = func
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

// 入力タイプ判定関数
function detectInputType(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^```([a-zA-Z0-9]*)\n[\s\S]*\n```$/.test(trimmed)) {
    const m = trimmed.match(/^```([a-zA-Z0-9]*)\n/)
    const lang = m && m[1]
    return lang ? lang.toLowerCase() : 'js'
  }
  if (/^[a-zA-Z0-9]+`[\s\S]*`$/.test(trimmed)) {
    const m = trimmed.match(/^([a-zA-Z0-9]+)`/)
    return m ? m[1].toLowerCase() : null
  }
  if (/^`[\s\S]*`$/.test(trimmed)) return 'js'
  if (/^[a-zA-Z0-9]+`[\s\S]*`$/.test(trimmed)) {
    const m = trimmed.match(/^([a-zA-Z0-9]+)`/)
    const lang = m && m[1]
    return lang ? lang.toLowerCase() : null
  }
  if (/^\$\$\n[\s\S]*\n\$\$$/.test(trimmed)) return 'texblock'
  if (/^\$[\s\S]*\$$/.test(trimmed)) return 'tex'
  try {
    JSON.parse(trimmed)
    return 'json'
  } catch {}
  return null
}

// parsing helpers are in src/wjs.ts and imported above

const evaluate = async ({ action }: { action?: Action } = { action: 'vector' }) => {
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
    case 'wjs':
      // wjs: light-weight JS-like sugar for calling functions, e.g. plus(1,2)
      jsStr = trimmed
        .replace(/^```[a-zA-Z0-9]*\n/, '')
        .replace(/\n```$/, '')
        .replace(/^[a-zA-Z0-9]+`|`$/g, '')
        .trim()

      // parse simple call: name(arg1,arg2,...)
      // special-case: W.Head(...) -> treat as raw Wolfram head call
      if (jsStr.startsWith('W.')) {
        // Use robust parsing for nested W.Head(...) calls
        const mm = jsStr.match(/^W\.([a-zA-Z_$][\w$]*)\s*\((.*)\)$/s)
        if (mm) {
          const head = mm[1]
          const inner = mm[2].trim()
          const parts = inner.length > 0 ? splitTopLevelCommas(inner) : []
          const args = parts.map((p) => parseWjsToken(p))
          obj = { head, body: args }
        } else {
          console.info('wjs parse failed; not a W.<Head>(...) expression')
        }
      } else {
        const m = jsStr.match(/^([a-zA-Z_$][\w$]*)\s*\((.*)\)$/s)
        if (m) {
          const name = m[1]
          const inner = m[2].trim()
          const parts = inner.length > 0 ? splitTopLevelCommas(inner) : []
          const args = parts.map((p) => parseWjsToken(p))
          obj = { call: name, args }
        } else {
          console.info('wjs parse failed; not a call expression')
        }
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
      // If obj is a call descriptor {call, args}, convert to Expr
      if (typeof obj === 'object' && obj !== null && 'call' in obj && Array.isArray((obj as any).args)) {
        const callName = (obj as any).call
        const callArgs = (obj as any).args

        // whitelist of allowed short-call names is provided by func
        const allowed = new Set(ALLOWED_NAMES)

        if (typeof callName === 'string' && allowed.has(callName)) {
          // resolve to canonical head name via func.nameToHead, fallback to camel-case
          const head = nameToHead(callName) ?? callName[0].toUpperCase() + callName.slice(1)
          obj = { head, body: callArgs }
        } else {
          throw new Error(`Disallowed or invalid call: ${String(callName)}`)
        }
      }

      const exprJsonStr = JSON.stringify(obj, replacer as any, 2).replace(/"/g, '\\"')
      exprStr = `ImportString["${exprJsonStr}", "ExpressionJSON"]`
      cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
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
    case 'raster':
      outputClone.innerHTML = `<img src="data:image/png;base64,${output}" alt="output">`
      break
    case 'vector':
      outputClone.innerHTML = `<img src="data:image/svg+xml;base64,${output}" alt="output">`
      break
    case 'audio':
      outputClone.innerHTML = `<audio controls><source type="audio/mpeg" src="data:audio/mpeg;base64,${output}"></source>`
      break
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
