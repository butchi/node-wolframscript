const http = require('http')

function postExec(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ command: encodeURIComponent(command) })
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/wolfram/exec' + (opts.query || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(opts.headers || {})
      }
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  // SVG Base64 - expect image/svg+xml when binary=1
  const cmdSvg = 'ExportString[Graphics[Circle[]], {"Base64","SVG"}]'
  const r1 = await postExec(cmdSvg, { query: '?binary=1' })
  console.log('SVG ->', r1.status, r1.type, r1.body.slice(0, 24))

  // PNG Base64 - expect image/png when binary=1
  const cmdPng = 'ExportString[Graphics[Circle[]], {"Base64","PNG"}]'
  const r2 = await postExec(cmdPng, { query: '?binary=1' })
  console.log('PNG ->', r2.status, r2.type, r2.body.slice(0, 24))

  // WAV audio Base64 - expect audio/wav
  const cmdWav = 'ExportString[Sound[Play[Sin[2*Pi*440*t],{t,0,0.1}]], {"Base64","MP3"}]'
  const r3 = await postExec(cmdWav, { query: '?binary=1' })
  console.log('AUDIO ->', r3.status, r3.type, r3.body.slice(0, 24))
}

main().catch(e => { console.error(e); process.exit(1) })
