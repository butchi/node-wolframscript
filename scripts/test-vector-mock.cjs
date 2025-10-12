const http = require('http')

const cmd = 'ExportString[ImportString["[\\"Graphics\\",[\\"Circle\\"]]", "ExpressionJSON"], {"Base64", "SVG"}]'
const payload = JSON.stringify({ command: encodeURIComponent(cmd) })

function extractBase64OrDataUri(s) {
  const trimmed = s.trim()
  if (/^data:[A-Za-z0-9/+.-]+;base64,/.test(trimmed)) return trimmed
  const mockMatch = trimmed.match(/MOCK_RESULT:\s*(.*)$/s)
  const candidate = mockMatch ? mockMatch[1].trim() : trimmed
  const dataUriMatch = candidate.match(/(data:[^\s"']+;base64,[A-Za-z0-9+/=\r\n]+)/)
  if (dataUriMatch) return dataUriMatch[1]
  const b64 = candidate.replace(/\s+/g, '')
  if (/^[A-Za-z0-9+/=]+$/.test(b64)) return b64
  return trimmed
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const options = {
  hostname: 'localhost',
  port: 3000,
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
    console.log('HTTP status:', res.statusCode)
    console.log('Raw response:')
    console.log(data)

    const body = data.trim()
    if (body.startsWith('MOCK_RESULT:')) {
      console.log('\nClient would render a <pre> block with the following escaped text:')
      console.log(escapeHtml(body))
    } else {
      const maybe = extractBase64OrDataUri(body)
      if (maybe.startsWith('data:')) {
        console.log('\nClient would use full data URI as src (first 200 chars):')
        console.log(maybe.slice(0, 200))
      } else if (/^[A-Za-z0-9+/=]+$/.test(maybe)) {
        console.log('\nClient would build data:image/svg+xml;base64,<payload>. Payload length:', maybe.length)
      } else {
        console.log('\nClient fallback: show raw output in element')
      }
    }
  })
})

req.on('error', (e) => console.error('Request error:', e))
req.write(payload)
req.end()
