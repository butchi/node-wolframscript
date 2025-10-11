import * as func from './func.js  '

console.log('Hello, world!')

const mainElm = document.querySelector('main')
const nbElm = document.querySelector('#nb')

let inputTmpl = document.querySelector('#input')
let outputTmpl = document.querySelector('#output')

let inputClone = inputTmpl.content.firstElementChild.cloneNode(true)
let inputElm = nbElm.appendChild(inputClone)

const contentClone = document.querySelector('#container').content.firstElementChild.cloneNode(true)
contentClone.querySelector('[data-slot]').appendChild(mainElm)
document.body.appendChild(contentClone)

// for debug
Object.keys(func).forEach((key) => {
  globalThis[key] = func[key]
})

// 入力タイプ判定関数
function detectInputType(input) {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^```([a-zA-Z0-9]*)\n[\s\S]*\n```$/.test(trimmed)) {
    const lang = trimmed.match(/^```([a-zA-Z0-9]*)\n/)[1]
    return lang ? lang.toLowerCase() : 'js'
  }
  if (/^[a-zA-Z0-9]+`[\s\S]*`$/.test(trimmed)) {
    return trimmed.match(/^([a-zA-Z0-9]+)`/)[1].toLowerCase()
  }
  if (/^`[\s\S]*`$/.test(trimmed)) return 'js'
  if (/^\$\$\n[\s\S]*\n\$\$$/.test(trimmed)) return 'texblock'
  if (/^\$[\s\S]*\$$/.test(trimmed)) return 'tex'
  try {
    JSON.parse(trimmed)
    return 'json'
  } catch {}
  return null
}

const evaluate = async ({ action } = { action: 'vector' }) => {
  const input = inputElm.querySelector('textarea').value
  if (!input?.trim()) return
  inputElm.querySelector('textarea').disabled = true
  console.log('Input:', input)

  let obj,
    exprStr = '',
    cmd = ''
  let jsonStr, jsStr, texFragment, wolframStr
  let jsonObj, exprJsonObj

  const replacer = (_key, value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value)
      if (keys.length === 2 && keys.includes('head') && keys.includes('body') && Array.isArray(value.body)) {
        if (value.body.length === 0) return value.head
        return [value.head, ...value.body]
      }
    }
    return value
  }

  // 入力タイプ判定
  const type = detectInputType(input)
  const trimmed = input.trim()

  switch (type) {
    case 'json':
      try {
        jsonObj = JSON.parse(trimmed)
        try {
          exprJsonObj = JSON.parse(jsonObj)
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
        .replace(/^`|`$/g, '')
        .trim()
      obj = eval(`(${jsStr})`)
      console.log('JavaScript String:', jsStr)
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
    // // STUB
    // case 'matra':
    //   jsStr = trimmed
    //     .replace(/^```[a-zA-Z0-9]*\n/, '')
    //     .replace(/\n```$/, '')
    //     .trim()
    //   obj = eval(`(${jsStr})`)
    //   break
    default:
      console.log('Invalid input format, expected JSON, JavaScript, or TeX Fragment')
  }

  if (!exprStr) {
    if (obj != null) {
      const exprJsonStr = JSON.stringify(obj, replacer, 2).replace(/"/g, '\\"')
      exprStr = `ImportString["${exprJsonStr}", "ExpressionJSON"]`
      cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
    } else if (texFragment != null) {
      exprStr = `ToExpression["${texFragment.replaceAll('\\', '\\\\')}", TeXForm]`
      cmd = `ExportString[${exprStr}, "ExpressionJSON"]`
    }
  }

  // アクションごとのコマンド生成
  if (action) {
    const actionMap = {
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
    body: JSON.stringify({ command: encodeURIComponent(cmd) }),
  })
  const output = await res.text()
  console.log(output)
  const outputClone = outputTmpl.content.firstElementChild.cloneNode(true)

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
      outputClone.innerHTML = output
  }

  nbElm.appendChild(outputClone)
  inputClone = inputTmpl.content.firstElementChild.cloneNode(true)
  inputElm = nbElm.appendChild(inputClone)
  inputElm.querySelector('textarea').focus()
}

globalThis.addEventListener('keydown', async (evt) => {
  if (evt.shiftKey && evt.key === 'Enter') {
    evt.preventDefault()

    evaluate()
  }
})

document.querySelectorAll('[data-box-command] .btn').forEach((elm) => {
  elm.addEventListener('click', (_) => {
    const action = elm.getAttribute('data-action')

    evaluate({ action })
  })
})

console.log('Thanks, world!')
