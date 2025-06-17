import Koa from 'koa'
import { koaBody } from 'koa-body'
import Router from 'koa2-router'
import { promises as fs } from 'fs'
import EventEmitter from 'events'
import { spawn } from 'child_process'

const app = new Koa()
const router = new Router()

app.use(koaBody())
app.use(router)

const ee = new EventEmitter()
let curData = ''
let inArr = []
let outArr = []

const outRegExp = /^[\\\r\n\s]*Out\[[0-9]+\](\/\/[a-zA-Z]+)?\=\s/
const inRegExp = /In\[[0-9]+\]\:\=\s*$/
const trimRegExp = /[\\\r\n\s]+\>?[\\\r\n\s]+/g

try {
  const wolframscript = spawn('wolframscript', ['-i'])
  wolframscript.stdout.setEncoding('utf8')

  wolframscript.stdout.on('data', (data) => {
    console.log('data:', data)

    if (data.match(outRegExp) && data.match(inRegExp)) {
      curData = data
        .replace(outRegExp, '')
        .replace(inRegExp, '')
        .replaceAll(trimRegExp, '')

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

  ee.on('input', (cmd) => {
    wolframscript.stdin.write(`${cmd}\n`)
  })
} catch (err) {
  console.log(err)
}

router.get('/', async (ctx) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/html'
  ctx.body = await fs.readFile('root.html', 'utf8')
})

router.get('/favicon.ico', async (ctx) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'image/x-icon'
  ctx.body = await fs.readFile('favicon.ico')
})

router.get('/root.js', async (ctx) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  ctx.body = await fs.readFile('root.js', 'utf8')
})

router.get('/func.js', async (ctx) => {
  console.log(ctx.method, ctx.url)
  ctx.type = 'text/javascript'
  ctx.body = await fs.readFile('func.js', 'utf8')
})

router.post('/wolfram/exec', async (ctx) => {
  console.log(ctx.method, ctx.url)

  let output

  const bodyObj = JSON.parse(ctx.request.body)

  const cmd = decodeURIComponent(bodyObj.command)

  inArr.push(cmd)

  ee.emit('input', cmd)

  await new Promise((resolve, reject) => {
    ee.on('message', (data) => {
      ee.removeAllListeners('message')

      outArr.push(data)

      output = outArr.at(-1)

      ctx.body = output

      resolve()
    })
    ee.on('error', (data) => {
      ee.removeAllListeners('error')

      reject()
    })
  })
})

app.listen(3000)
