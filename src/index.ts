import Koa from 'koa'
import { koaBody } from 'koa-body'
import Router from 'koa2-router'
import { promises as fs } from 'fs'
import EventEmitter from 'events'
import { spawn, spawnSync } from 'child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_NAMES, nameToHead } from './func.js'
import zlib from 'node:zlib'
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

// --- PNG helper (for mock PNG generation) ---
function crc32(buf: Buffer): number {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      const m = -(c & 1)
      c = (c >>> 1) ^ (0xEDB88320 & m)
    }
  }
  return (~c) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function makeSolidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(2, 9) // color type: truecolor
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace
  const ihdrChunk = pngChunk('IHDR', ihdr)

  const rowLen = 1 + width * 3 // filter byte + RGB per pixel
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLen
    raw[rowStart] = 0 // filter 0 (None)
    for (let x = 0; x < width; x++) {
      const i = rowStart + 1 + x * 3
      raw[i] = rgb[0]
      raw[i + 1] = rgb[1]
      raw[i + 2] = rgb[2]
    }
  }
  const compressed = zlib.deflateSync(raw)
  const idatChunk = pngChunk('IDAT', compressed)
  const iendChunk = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk])
}

// Very simple PNG plot generator for mock: draws axes and a sampled curve
function makePlotPng(width: number, height: number, opts: { fn: (x: number) => number; xMin: number; xMax: number }): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(2, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  const ihdrChunk = pngChunk('IHDR', ihdr)

  // raw RGB rows with filter byte per row
  const rowLen = 1 + width * 3
  const raw = Buffer.alloc(rowLen * height, 0)
  // fill white background
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLen
    raw[rowStart] = 0
    for (let x = 0; x < width; x++) {
      const i = rowStart + 1 + x * 3
      raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255
    }
  }

  const putPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const rowStart = y * rowLen
    const i = rowStart + 1 + x * 3
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
  }
  const drawLine = (x0: number, y0: number, x1: number, y1: number, col: [number, number, number]) => {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    while (true) {
      putPixel(x0, y0, col[0], col[1], col[2])
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }

  const { fn, xMin, xMax } = opts
  // sample function to determine y-range
  const samples = 512
  const xs: number[] = []
  const ys: number[] = []
  let yMin = Number.POSITIVE_INFINITY, yMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1)
    const x = xMin + (xMax - xMin) * t
    const y = fn(x)
    xs.push(x); ys.push(y)
    if (isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y }
  }
  if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) { yMin = -1; yMax = 1 }
  // add margins
  const yPad = (yMax - yMin) * 0.1 || 1
  yMin -= yPad; yMax += yPad

  // map function to pixel coords
  const toX = (x: number) => Math.round((x - xMin) / (xMax - xMin) * (width - 1))
  const toY = (y: number) => Math.round((1 - (y - yMin) / (yMax - yMin)) * (height - 1))

  // axes (grey)
  const zeroX = (0 >= xMin && 0 <= xMax) ? toX(0) : -1
  const zeroY = (0 >= yMin && 0 <= yMax) ? toY(0) : -1
  if (zeroX >= 0) drawLine(zeroX, 0, zeroX, height - 1, [200, 200, 200])
  if (zeroY >= 0) drawLine(0, zeroY, width - 1, zeroY, [200, 200, 200])

  // curve (blue)
  let px = toX(xs[0]); let py = toY(ys[0])
  for (let i = 1; i < samples; i++) {
    const qx = toX(xs[i]); const qy = toY(ys[i])
    if (isFinite(ys[i - 1]) && isFinite(ys[i])) drawLine(px, py, qx, qy, [13, 110, 253])
    px = qx; py = qy
  }

  const compressed = zlib.deflateSync(raw)
  const idatChunk = pngChunk('IDAT', compressed)
  const iendChunk = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk])
}

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
              // If looks like Plot[ f[var], {var,a,b} ] then draw a simple plot
              const plotMatch = cmd.match(/Plot\[\s*([\s\S]+?)\s*,\s*\{\s*([a-zA-Z][\w]*)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\}\s*\]/)
              if (plotMatch) {
                const expr = plotMatch[1]
                const varName = plotMatch[2]
                const a = parseFloat(plotMatch[3]); const b = parseFloat(plotMatch[4])
                // support a couple of simple forms: var^2, Sin[var], Cos[var]
                let fn: (x: number) => number
                try {
                  const reSin = new RegExp(`\\bSin\\s*\\[\\s*${varName}\\s*\\]`)
                  const reCos = new RegExp(`\\bCos\\s*\\[\\s*${varName}\\s*\\]`)
                  const reSq = new RegExp(`\\b${varName}\\s*\\^\\s*2\\b`)
                  if (reSin.test(expr)) fn = Math.sin
                  else if (reCos.test(expr)) fn = Math.cos
                  else if (reSq.test(expr)) fn = (x) => x * x
                  else fn = (x) => Math.sin(x)
                } catch {
                  fn = (x) => Math.sin(x)
                }
                const png = makePlotPng(512, 384, { fn, xMin: a, xMax: b })
                const b64 = png.toString('base64')
                ee.emit('message', `data:image/png;base64,${b64}`)
              } else {
                // fallback: visible solid
                const png = makeSolidPng(256, 256, [13, 110, 253])
                const b64 = png.toString('base64')
                ee.emit('message', `data:image/png;base64,${b64}`)
              }
            return
          }
          if (wantsBase64MP3) {
              // generate a short 1s sine wave WAV (PCM 16-bit 44.1kHz) and return as data:audio/wav;base64,
              try {
                const sampleRate = 44100
                const duration = 1 // seconds
                const freq = 440
                const numSamples = sampleRate * duration
                const samples = Buffer.alloc(numSamples * 2) // 16-bit PCM
                for (let i = 0; i < numSamples; i++) {
                  const t = i / sampleRate
                  const v = Math.sin(2 * Math.PI * freq * t)
                  const s = Math.max(-1, Math.min(1, v))
                  const intSample = Math.round(s * 32767)
                  samples.writeInt16LE(intSample, i * 2)
                }

                // WAV header (PCM)
                const header = Buffer.alloc(44)
                // ChunkID 'RIFF'
                header.write('RIFF', 0)
                // ChunkSize 36 + Subchunk2Size
                header.writeUInt32LE(36 + samples.length, 4)
                // Format 'WAVE'
                header.write('WAVE', 8)
                // Subchunk1ID 'fmt '
                header.write('fmt ', 12)
                // Subchunk1Size 16 for PCM
                header.writeUInt32LE(16, 16)
                // AudioFormat 1 (PCM)
                header.writeUInt16LE(1, 20)
                // NumChannels 1
                header.writeUInt16LE(1, 22)
                // SampleRate
                header.writeUInt32LE(sampleRate, 24)
                // ByteRate = SampleRate * NumChannels * BitsPerSample/8
                header.writeUInt32LE(sampleRate * 1 * 16 / 8, 28)
                // BlockAlign = NumChannels * BitsPerSample/8
                header.writeUInt16LE(1 * 16 / 8, 32)
                // BitsPerSample
                header.writeUInt16LE(16, 34)
                // Subchunk2ID 'data'
                header.write('data', 36)
                // Subchunk2Size
                header.writeUInt32LE(samples.length, 40)

                const wav = Buffer.concat([header, samples])
                const b64 = wav.toString('base64')
                ee.emit('message', `data:audio/wav;base64,${b64}`)
              } catch (e) {
                ee.emit('message', `MOCK_RESULT_ERROR: ${String(e)}`)
              }
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

  // Mock responder for transform when wolfram is not available
  const mime = mimeForFormat(format)
  if (mime === 'image/png') {
    // Return a visible 256x256 solid PNG as binary Buffer (mock)
    const png = makeSolidPng(256, 256, [13, 110, 253]) // #0d6efd
    ctx.type = 'image/png'
    ctx.body = png
    return
  }

  // Default mock: echo back ExpressionJSON or text as data URI text/plain
  const txt = `MOCK_TRANSFORM: ${cmd}`
  ctx.type = 'text/plain; charset=utf-8'
  ctx.body = txt
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
