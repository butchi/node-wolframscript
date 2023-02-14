const Koa = require("koa")
const Router = require("koa2-router")
const fs = require("fs").promises
const app = new Koa()
const router = new Router();

app.use(router)

const EventEmitter = require('events')
const { spawn } = require("child_process")

const ee = new EventEmitter()
let curData = ""
let inArr = []
let outArr = []

const outRegExp = /^[\\\r\n\s]*Out\[[0-9]+\]\=\s/
const inRegExp = /In\[[0-9]+\]\:\=\s*$/
const trimRegExp = /[\\\r\n\s]+\>?[\\\r\n\s]{1,4}/g

try {
    const wolframscript = spawn("wolframscript", ["-i"])
    wolframscript.stdout.setEncoding('utf8')

    wolframscript.stdout.on('data', data => {
        console.log("data:", data)

        if (data.match(outRegExp) && data.match(inRegExp)) {
            curData = data.replace(outRegExp, "").replace(inRegExp, "").replaceAll(trimRegExp, "")

            ee.emit("message", curData)

            curData = ""
        } else if (data.match(outRegExp)) {
            curData += data.replace(outRegExp, "").replaceAll(trimRegExp, "")
        } else if (data.match(inRegExp)) {
            curData += data.replace(inRegExp, "").replaceAll(trimRegExp, "")

            ee.emit("message", curData)

            curData = ""
        } else {
            curData += data.replaceAll(trimRegExp, "")
        }
    })

    ee.on("input", cmd => {
        wolframscript.stdin.write(`${cmd}\n`)
    })
} catch (err) {
    console.log(err)
}

router.get("/", async ctx => {
    console.log(ctx.method, ctx.url)
    ctx.body = await fs.readFile("root.html", "utf8")
})

router.get("/root.js", async ctx => {
    console.log(ctx.method, ctx.url)
    ctx.body = await fs.readFile("root.js", "utf8")
})

router.get("/wolfram/exec", async ctx => {
    console.log(ctx.method, ctx.url)

    let output

    const cmd = ctx.request.query.command

    inArr.push(cmd)

    ee.emit("input", cmd)

    await new Promise((resolve, reject) => {
        ee.on("message", data => {
            ee.removeAllListeners("message")

            outArr.push(data)

            output = outArr.at(-1)

            ctx.body = output

            resolve()
        })
        ee.on("error", data => {
            ee.removeAllListeners("error")

            reject()
        })
    })
})

app.listen(3000)