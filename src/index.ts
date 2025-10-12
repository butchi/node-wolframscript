import Koa from 'koa'
import { koaBody } from 'koa-body'
import Router from 'koa2-router'
import { promises as fs } from 'fs'
import EventEmitter from 'events'
import { spawn, spawnSync } from 'child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_NAMES, nameToHead } from './func.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = new Koa()
const router = new Router()

// Custom raw-body handler for /wolfram/exec to avoid koa-body JSON parse issues.
// This middleware is placed before `koaBody()` so we can read and log the
// raw request body and parse it robustly.
app.use(async (ctx: any, next: any) => {
  if (ctx.path === '/wolfram/exec' && ctx.method === 'POST') {
    const raw = await new Promise<string>((resolve) => {
      let data = ''
      ctx.req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')))
      ctx.req.on('end', () => resolve(data))
      ctx.req.on('error', () => resolve(''))
    })

    console.log('raw incoming body (middleware):', raw)

    let bodyObj: any = undefined
    try {
      bodyObj = JSON.parse(raw)
    } catch (e) {
      // try urlencoded fallback like command=... or plain text
      try {
        const m = raw.match(/command=(.*)/)
        if (m) bodyObj = { command: decodeURIComponent(m[1]) }
      } catch {}
    }

    if (!bodyObj) {
      ctx.status = 400
      ctx.body = 'Bad Request: invalid JSON'
      return
    }

    try {
      const cmd: string = decodeURIComponent(bodyObj.command)
      console.log('middleware parsed command:', cmd)

      inArr.push(cmd)
      ee.emit('input', cmd)

      const output = await new Promise<string>((resolve, reject) => {
        const onMessage = (data: string) => {
          ee.removeListener('message', onMessage)
          ee.removeListener('error', onError)
          outArr.push(data)
          resolve(outArr.at(-1) ?? '')
        }
        const onError = (err: unknown) => {
          ee.removeListener('message', onMessage)
          ee.removeListener('error', onError)
          reject(err)
        }
        ee.on('message', onMessage)
        ee.on('error', onError)
      })

      ctx.body = output
      return
    } catch (err) {
      console.error('middleware wolfram handling error:', err)
      ctx.status = 500
      ctx.body = 'Internal Server Error'
      return
    }
  }

  await next()
})

// configure koaBody with an onError handler so we can log raw body on parse errors
app.use(
  koaBody({
    multipart: true,
    jsonLimit: '1mb',
    onError: (err: any, ctx: any) => {
      try {
        console.error('koaBody parse error:', err && err.message ? err.message : err)
        console.error(
          'raw request text (from ctx.request.rawBody):',
          (ctx && ctx.request && (ctx.request as any).rawBody) || null
        )
      } catch (e) {
        console.error('failed to log raw body in onError handler', e)
      }
      // rethrow so downstream sees Bad Request as before
      throw err
    },
  })
)
app.use(router)

const ee = new EventEmitter()
let curData = ''
const inArr: string[] = []
const outArr: string[] = []

const outRegExp = /^[\\\r\n\s]*Out\[[0-9]+\](\/\/[a-zA-Z]+)?\=\s/
const inRegExp = /In\[[0-9]+\]\:\=\s*$/
const trimRegExp = /[\\\r\n\s]+\>?[\\\r\n\s]+/g

let wolframAvailable = false
let wolframscriptProcess: ReturnType<typeof spawn> | undefined

// Check whether `wolframscript` is available on PATH before spawning.
try {
  const check = spawnSync('which', ['wolframscript'])
  if (check.status === 0) {
    try {
      wolframscriptProcess = spawn('wolframscript', ['-i'])
      wolframscriptProcess.stdout.setEncoding('utf8')
      wolframAvailable = true

      wolframscriptProcess.on('error', (err) => {
        console.error('wolframscript spawn error:', err)
        ee.emit('error', err)
      })

      wolframscriptProcess.stdout.on('data', (data: string) => {
        console.log('data:', data)

        if (data.match(outRegExp) && data.match(inRegExp)) {
          curData = data.replace(outRegExp, '').replace(inRegExp, '').replaceAll(trimRegExp, '')

          ee.emit('message', curData)

          curData = ''
        } else if (data.match(outRegExp)) {
          curData += data.replace(outRegExp, '').replaceAll(trimRegExp, '')
        } else if (data.match(inRegExp)) {
          curData += data.replace(inRegExp, '').replaceAll(trimRegExp, '')

          ee.emit('message', curData)

          curData = ''
        } else {
          curData += data.replaceAll(trimRegExp, '')
        }
      })

      ee.on('input', (cmd: string) => {
        if (wolframscriptProcess?.stdin) wolframscriptProcess.stdin.write(`${cmd}\n`)
      })
    } catch (err) {
      console.log('wolframscript spawn failed:', err)
      wolframAvailable = false
    }
  } else {
    console.log('wolframscript not found on PATH')
    wolframAvailable = false
  }
} catch (err) {
  console.log('failed to check wolframscript availability:', err)
  wolframAvailable = false
}

// If wolframscript is not available, install a simple mock responder so the UI can be tested.
if (!wolframAvailable) {
  console.warn('wolframscript not available — using mock responder for /wolfram/exec')
  // MOCK_MODE: 'base64' (default) or 'text' to control mock responder shape
  const mockMode = String(process.env.MOCK_MODE || 'base64').toLowerCase()

  ee.on('input', (cmd: string) => {
    // simulate async work and emit a plausible mock response
    setTimeout(() => {
      try {
        const wantsBase64SVG = /"Base64"\s*,\s*"SVG"/i.test(cmd)
        const wantsBase64PNG = /"Base64"\s*,\s*"PNG"/i.test(cmd)
        const wantsBase64MP3 = /"Base64"\s*,\s*"MP3"/i.test(cmd)

        if (mockMode === 'base64') {
          if (wantsBase64SVG) {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
              + '<rect width="100%" height="100%" fill="#ffffff"/>'
              + '<circle cx="128" cy="128" r="80" fill="#0d6efd"/>'
              + '<text x="128" y="140" font-size="24" text-anchor="middle" fill="#ffffff">SVG</text>'
              + '</svg>'
              const b64 = Buffer.from(svg, 'utf8').toString('base64')
              // return a full data URI to more closely match wolframscript output
              ee.emit('message', `data:image/svg+xml;base64,${b64}`)
            return
          }
          if (wantsBase64PNG) {
              const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
              ee.emit('message', `data:image/png;base64,${png1x1}`)
            return
          }
          if (wantsBase64MP3) {
              // placeholder for MP3 as an empty data URI (client will handle it)
              const mp3 = ''
              ee.emit('message', `data:audio/mpeg;base64,${mp3}`)
            return
          }

          // default base64 echo for non-asset commands: return encoded simple text
          const txt = `MOCK_BASE64_ECHO: ${cmd}`
          // encode and return a data:text/plain base64 URI so clients receive a data: URI
          ee.emit('message', `data:text/plain;base64,${Buffer.from(txt, 'utf8').toString('base64')}`)
          return
        }

        // text mode (fallback)
        const mockResult = `MOCK_RESULT: ${cmd}`
        ee.emit('message', mockResult)
      } catch (e) {
        ee.emit('message', `MOCK_RESULT_ERROR: ${String(e)}`)
      }
    }, 120)
  })
}

router.get('/', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/html'
  const htmlPath = path.join(__dirname, '../public/root.html')
  ctx.body = await fs.readFile(htmlPath, 'utf8')
})

router.get('/favicon.ico', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'image/x-icon'
  const favPath = path.join(__dirname, '../public/favicon.ico')
  try {
    ctx.body = await fs.readFile(favPath)
  } catch {
    ctx.body = undefined
  }
})

router.get('/root.js', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  const jsPath = path.join(__dirname, '../dist/root.js')
  try {
    ctx.body = await fs.readFile(jsPath, 'utf8')
  } catch {
    // fallback to src for dev convenience
    const fallback = path.join(__dirname, './root.js')
    ctx.body = await fs.readFile(fallback, 'utf8')
  }
})

router.get('/func.js', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  const jsPath = path.join(__dirname, '../dist/func.js')
  try {
    ctx.body = await fs.readFile(jsPath, 'utf8')
  } catch {
    const fallback = path.join(__dirname, './func.js')
    ctx.body = await fs.readFile(fallback, 'utf8')
  }
})

router.get('/wjs.js', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  const jsPath = path.join(__dirname, '../dist/wjs.js')
  try {
    ctx.body = await fs.readFile(jsPath, 'utf8')
  } catch {
    const fallback = path.join(__dirname, './wjs.js')
    ctx.body = await fs.readFile(fallback, 'utf8')
  }
})

router.get('/matra.js', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  const jsPath = path.join(__dirname, '../dist/matra.js')
  try {
    ctx.body = await fs.readFile(jsPath, 'utf8')
  } catch {
    const fallback = path.join(__dirname, './matra.js')
    ctx.body = await fs.readFile(fallback, 'utf8')
  }
})

router.post('/wolfram/exec', async (ctx: any) => {
  console.log(ctx.method, ctx.url)

  if (!wolframAvailable) {
    console.warn('wolframscript not available — using mock responder')
  }

  let output = ''

  // Log raw body for debugging JSON parse errors
  try {
    console.log('raw request body:', ctx.request.body)
  } catch (e) {
    console.log('failed to log raw body', e)
  }

  const bodyObj = typeof ctx.request.body === 'string' ? JSON.parse(ctx.request.body) : ctx.request.body

  const cmd: string = decodeURIComponent(bodyObj.command)

  // Server-side whitelist for ExpressionJSON heads.
  // By default only heads exposed via ALLOWED_NAMES are allowed. This can be
  // relaxed by setting ALLOW_ALL_W=true or by specifying ALLOWED_W_HEADS as a
  // comma-separated list of canonical head names (e.g. "Plus,Times,N").
  try {
    const allowAll = String(process.env.ALLOW_ALL_W || '').toLowerCase() === 'true'
    const extra = (process.env.ALLOWED_W_HEADS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    // compute allowed canonical head names (e.g. 'plus' -> 'Plus')
    const allowedCanonical = new Set<string>()
    for (const n of ALLOWED_NAMES) {
      const head = nameToHead(n) ?? n[0].toUpperCase() + n.slice(1)
      allowedCanonical.add(head)
    }
    for (const h of extra) allowedCanonical.add(h)

    // helper: extract ExpressionJSON payload from ImportString["...","ExpressionJSON"]
    const m = cmd.match(/ImportString\["([\s\S]*?)",\s*"ExpressionJSON"\]/)
    if (!allowAll && m) {
      const innerEscaped = m[1]
      // unescape the client-side escape of quotes (client replaces " with \" before embedding)
      const jsonText = innerEscaped.replace(/\\"/g, '"')
      let expr: unknown = null
      try {
        expr = JSON.parse(jsonText)
      } catch (e) {
        console.warn('Failed to parse ExpressionJSON payload for whitelist check', e)
        // If we can't parse, be conservative and reject
        ctx.status = 400
        ctx.body = 'Bad Request: cannot parse ExpressionJSON payload'
        return
      }

      // collect heads recursively
      const heads = new Set<string>()
      const collect = (node: any) => {
        if (Array.isArray(node) && node.length > 0) {
          const head = node[0]
          if (typeof head === 'string') heads.add(head)
          for (let i = 1; i < node.length; i++) collect(node[i])
        }
      }
      collect(expr)

      for (const h of heads) {
        if (!allowedCanonical.has(h)) {
          console.warn('Blocked disallowed head in request:', h)
          ctx.status = 403
          ctx.body = `Forbidden: usage of head ${h} is not allowed`
          return
        }
      }
    }
  } catch (e) {
    console.error('Error during whitelist check:', e)
    ctx.status = 500
    ctx.body = 'Internal Server Error'
    return
  }

  inArr.push(cmd)

  ee.emit('input', cmd)

  await new Promise<void>((resolve, reject) => {
    const onMessage = (data: string) => {
      ee.removeListener('message', onMessage)
      ee.removeListener('error', onError)

      outArr.push(data)
      output = outArr.at(-1) ?? ''
      ctx.body = output
      resolve()
    }
    const onError = (err: unknown) => {
      ee.removeListener('message', onMessage)
      ee.removeListener('error', onError)
      reject(err)
    }
    ee.on('message', onMessage)
    ee.on('error', onError)
  })
})

const port = Number(process.env.PORT) || 3000
// Bind to 0.0.0.0 so both IPv4 and IPv6 loopback addresses can connect reliably
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${port}`)
})
