import Koa from 'koa'
import { koaBody } from 'koa-body'
import Router from 'koa2-router'
import { promises as fs } from 'fs'
import EventEmitter from 'events'
import { spawn, spawnSync } from 'child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_NAMES, nameToHead } from './func.js'
import type { BinaryResponse, ExecOutput } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = new Koa()
const router = new Router()

// Custom raw-body handler for /wolfram/exec to avoid koa-body JSON parse issues.
// This middleware is placed before `koaBody()` so we can read and log the
// raw request body and parse it robustly.
app.use(async (ctx: any, next: any) => {
  if (ctx.path === '/wolfram/exec' && ctx.method === 'POST') {
    if (!wolframAvailable) {
      ctx.status = 503
      ctx.body = 'Wolfram Engine unavailable'
      return
    }
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

      const output = await new Promise<any>((resolve, reject) => {
        const onMessage = (data: any) => {
          ee.removeListener('message', onMessage)
          ee.removeListener('error', onError)
          outArr.push(data)
          resolve(outArr.at(-1))
        }
        const onError = (err: unknown) => {
          ee.removeListener('message', onMessage)
          ee.removeListener('error', onError)
          reject(err)
        }
        ee.on('message', onMessage)
        ee.on('error', onError)
      })

      // If mock returned an object with binary data, set proper content type and body
      const outVal: ExecOutput = output as ExecOutput
      const looksLikeBinary =
        outVal !== null &&
        outVal !== undefined &&
        typeof outVal === 'object' &&
        ((outVal as BinaryResponse).binary === true || Buffer.isBuffer((outVal as any).body))

      if (looksLikeBinary) {
        const outObj = outVal as BinaryResponse
        if (outObj.mime) ctx.type = outObj.mime
        ctx.body = outObj.body
      } else {
        // If ExportString was asked for {"Base64", "<FMT>"}, decode and return binary with correct MIME.
        const outStr = String(outVal ?? '')
        const fmtMatch = cmd.match(/\{\s*"Base64"\s*,\s*"([A-Za-z0-9]+)"\s*\}/)
        if (fmtMatch) {
          const fmt = fmtMatch[1]
          const decoded = decodeDataUriOrBase64(outStr)
          if (decoded) {
            const preferred = mimeForFormat(fmt)
            ctx.type = preferred || decoded.mime
            ctx.body = decoded.buffer
            return
          }
        }
        ctx.body = outStr
      }
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

// Start wolframscript REPL if available. Supports env override WOLFRAMSCRIPT.
function startWolfram() {
  const exe = process.env.WOLFRAMSCRIPT && process.env.WOLFRAMSCRIPT.trim().length > 0
    ? process.env.WOLFRAMSCRIPT.trim()
    : 'wolframscript'
  try {
    wolframscriptProcess = spawn(exe, ['-i'])
    wolframscriptProcess.stdout.setEncoding('utf8')
    wolframAvailable = true

    wolframscriptProcess.on('error', (err) => {
      console.error('wolframscript spawn error:', err)
      wolframAvailable = false
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
}

startWolfram()

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

// Simple helper to map format -> MIME
function mimeForFormat(fmt: string): string | undefined {
  const f = String(fmt || '').trim().toLowerCase()
  switch (f) {
    case 'png':
      return 'image/png'
    case 'svg':
      return 'image/svg+xml'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    default:
      return undefined
  }
}

// Decode ExportString outputs (data URI or bare Base64) into Buffer and infer MIME.
// Supports common signatures: PNG, JPEG, GIF, WebP, WAV, MP3. Returns null if not decodable.
function decodeDataUriOrBase64(output: string): { mime: string; buffer: Buffer } | null {
  if (typeof output !== 'string') return null
  const trimmed = output.trim()

  // data:[mime];base64,<payload>
  const dataUriMatch = trimmed.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (dataUriMatch) {
    const mime = dataUriMatch[1]
    const b64 = dataUriMatch[2].replace(/\s+/g, '')
    try {
      const buf = Buffer.from(b64, 'base64')
      return { mime, buffer: buf }
    } catch {
      return null
    }
  }

  // Bare base64? Try to decode and detect by magic bytes
  const bare = trimmed.replace(/\s+/g, '')
  if (/^[A-Za-z0-9+/=]+$/.test(bare) && bare.length > 16) {
    try {
      const buf = Buffer.from(bare, 'base64')
      // PNG
      if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
        return { mime: 'image/png', buffer: buf }
      }
      // JPEG
      if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
        return { mime: 'image/jpeg', buffer: buf }
      }
      // GIF87a/89a
      if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF8')) {
        return { mime: 'image/gif', buffer: buf }
      }
      // WebP (RIFF....WEBP)
      if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        return { mime: 'image/webp', buffer: buf }
      }
      // WAV (RIFF....WAVE)
      if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
        return { mime: 'audio/wav', buffer: buf }
      }
      // MP3 (very loose: starts with ID3 or 0xFF Ex frame sync)
      if ((buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') || (buf.length >= 2 && buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0)) {
        return { mime: 'audio/mpeg', buffer: buf }
      }
      // Unknown binary but decodable; let caller decide (default to octet-stream)
      return { mime: 'application/octet-stream', buffer: buf }
    } catch {
      return null
    }
  }

  // Not decodable
  return null
}

// New API: transform arbitrary input using ImportString/ToExpression then ExportString
// Body JSON: { data: string, type?: string, format?: string, encoding?: string }
router.post('/wolfram/transform', async (ctx: any) => {
  console.log(ctx.method, ctx.url)
  let body: any = ctx.request.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  const data: string = String(body?.data ?? '')
  const type: string = String(body?.type ?? '')
  const format: string = String(body?.format ?? '')
  const encoding: string = String(body?.encoding ?? '')

  // Build Wolfram command according to the provided APIFunction idea
  const toExpr = !type
    ? `ToExpression[${JSON.stringify(data)}]`
    : `ImportString[${JSON.stringify(data)}, ${JSON.stringify(type)}]`

  const cmd = !format
    ? `ExportString[${toExpr}, "ExpressionJSON"]`
    : (!encoding
        ? `ExportString[${toExpr}, ${JSON.stringify(format)}]`
        : `ExportString[${toExpr}, {${JSON.stringify(encoding)}, ${JSON.stringify(format)}}]`)

  // If wolfram is available, route through the same REPL pipeline; else mock
  if (wolframAvailable) {
    inArr.push(cmd)
    ee.emit('input', cmd)
    const output: any = await new Promise((resolve, reject) => {
      const onMessage = (data: any) => { ee.off('message', onMessage); ee.off('error', onError); resolve(data) }
      const onError = (err: any) => { ee.off('message', onMessage); ee.off('error', onError); reject(err) }
      ee.on('message', onMessage)
      ee.on('error', onError)
    })

    const mime = mimeForFormat(format)
    // If we got a data URI or bare base64 and encoding indicates Base64, decode to binary
    if (typeof output === 'string' && mime && encoding.toLowerCase() === 'base64') {
      const trimmed = output.trim()
      let b64 = ''
      const m = trimmed.match(/^data:[^;]+;base64,([A-Za-z0-9+/=\r\n]+)/)
      if (m) b64 = m[1]
      else b64 = trimmed.replace(/\s+/g, '')
      try {
        const buf = Buffer.from(b64, 'base64')
        ctx.type = mime
        ctx.body = buf
        return
      } catch {}
    }
    // Even if encoding parameter wasn't provided as Base64, try generic decode (data URI / base64)
    if (typeof output === 'string') {
      const decoded = decodeDataUriOrBase64(output)
      if (decoded) {
        ctx.type = decoded.mime
        ctx.body = decoded.buffer
        return
      }
    }
    // Fallback: return as-is (text)
    ctx.body = output
    return
  }

  // Engine unavailable: return 503 so the client can surface the error
  ctx.status = 503
  ctx.type = 'text/plain; charset=utf-8'
  ctx.body = 'Wolfram Engine unavailable'
})

router.post('/wolfram/exec', async (ctx: any) => {
  console.log(ctx.method, ctx.url)

  if (!wolframAvailable) {
    ctx.status = 503
    ctx.body = 'Wolfram Engine unavailable'
    return
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
    const onMessage = (data: any) => {
      ee.removeListener('message', onMessage)
      ee.removeListener('error', onError)

      outArr.push(data)
      output = outArr.at(-1) ?? ''

      // if binary-like object, attach mime and body
      const outVal2: ExecOutput = output as ExecOutput
      const looksLikeBinary2 =
        outVal2 !== null &&
        outVal2 !== undefined &&
        typeof outVal2 === 'object' &&
        ((outVal2 as BinaryResponse).binary === true || Buffer.isBuffer((outVal2 as any).body))

      if (looksLikeBinary2) {
        const outObj = outVal2 as BinaryResponse
        if (outObj.mime) ctx.type = outObj.mime
        ctx.body = outObj.body
      } else {
        // Optional binary passthrough: if client requests binary=1 or X-Return-Binary: 1,
        // and output looks like data URI or Base64, decode and set appropriate MIME.
        const wantBinary = String(ctx.query?.binary || '').trim() === '1' || String(ctx.get('x-return-binary') || '').trim() === '1'
        const outStr = String(outVal2 ?? '')
        if (wantBinary) {
          const decoded = decodeDataUriOrBase64(outStr)
          if (decoded) {
            ctx.type = decoded.mime
            ctx.body = decoded.buffer
            resolve()
            return
          }
        }
        ctx.body = outStr
      }

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
