const http = require('http')

const cmd = 'ExportString[ImportString["[\"Audio\",[{\"Wave\",\"Sin\",440,1}]]", "ExpressionJSON"], {"Base64", "MP3"}]'
const payload = JSON.stringify({ command: encodeURIComponent(cmd) })

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/wolfram/exec',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
  timeout: 5000,
}

const req = http.request(options, (res) => {
  let data = ''
  res.setEncoding('utf8')
  res.on('data', (chunk) => (data += chunk))
  res.on('end', () => {
    console.log('HTTP status:', res.statusCode)
    console.log('Raw response (first 200 chars):')
    console.log(data.slice(0, 200))
    if (res.statusCode === 200) process.exit(0)
    else process.exit(2)
  })
})

req.on('error', (e) => {
  console.error('Request error:', e.message || e)
  process.exit(3)
})

req.write(payload)
req.end()
