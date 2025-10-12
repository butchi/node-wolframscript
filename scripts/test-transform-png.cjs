const http = require('http')

const body = {
  data: '["Graphics",["Circle"]]',
  type: 'ExpressionJSON',
  format: 'PNG',
  encoding: 'Base64'
}

const payload = JSON.stringify(body)

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/wolfram/transform',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  const chunks = []
  res.on('data', (c) => chunks.push(c))
  res.on('end', () => {
    const buf = Buffer.concat(chunks)
    console.log('HTTP', res.statusCode, res.headers['content-type'] || '')
    console.log('Body bytes:', buf.length)
    // show first few bytes
    console.log(buf.slice(0, 16))
  })
})
req.on('error', (e) => console.error('Request error:', e))
req.write(payload)
req.end()
