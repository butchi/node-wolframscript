const fetch = require('node-fetch')

const cmd = 'ExportString[ImportString["[\\"Graphics\\",[\\"Circle\\"]]", "ExpressionJSON"], {"Base64", "SVG"}]'
const body = { command: encodeURIComponent(cmd) }

fetch('http://localhost:3001/wolfram/exec', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
  .then((r) => r.text())
  .then((t) => {
    console.log('Response text:', t)
    try {
      const b = Buffer.from(t.trim(), 'base64')
      console.log('Decoded length:', b.length)
      console.log('Decoded begins with:', b.toString('utf8').slice(0, 80))
    } catch (e) {
      console.error('Decode error:', e)
    }
  })
  .catch((e) => console.error('Fetch error:', e))
