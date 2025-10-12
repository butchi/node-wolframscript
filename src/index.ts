import Koa from 'koa'
import { koaBody } from 'koa-body'
import Router from 'koa2-router'
import { promises as fs } from 'fs'
import EventEmitter from 'events'
import { spawn, spawnSync } from 'child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  ee.on('input', (cmd: string) => {
    // simulate async work and emit a plausible mock response
    setTimeout(() => {
      const mockResult = `MOCK_RESULT: ${cmd}`
      ee.emit('message', mockResult)
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
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
