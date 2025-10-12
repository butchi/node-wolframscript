const http = require('http')

const cmd = 'ExportString[ImportString["[\\"Graphics\\",[\\"Circle\\"]]", "ExpressionJSON"], {"Base64", "SVG"}]'
const payload = JSON.stringify({ command: encodeURIComponent(cmd) })

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/wolfram/exec',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
}

const req = http.request(options, (res) => {
  let data = ''
  res.setEncoding('utf8')
  res.on('data', (chunk) => (data += chunk))
  res.on('end', () => {
    console.log('Status:', res.statusCode)
    console.log('Response body:', data)
    try {
      const buf = Buffer.from(data.trim(), 'base64')
      console.log('Decoded length:', buf.length)
      console.log('Decoded begin:', buf.toString('utf8').slice(0, 80))
    } catch (e) {
      console.error('Failed to decode base64:', e)
    }
  })
})

req.on('error', (e) => console.error('Request error:', e))
req.write(payload)
req.end()
