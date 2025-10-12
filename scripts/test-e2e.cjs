const http = require('http')

const cmd = 'ExportString[ImportString["[\"Graphics\",[\"Circle\"]]", "ExpressionJSON"], {"Base64", "SVG"}]'
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
  timeout: 3000,
}

const req = http.request(options, (res) => {
  let data = ''
  res.setEncoding('utf8')
  res.on('data', (chunk) => (data += chunk))
  res.on('end', () => {
    console.log('HTTP status:', res.statusCode)
    console.log('Raw response:')
    console.log(data)
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
