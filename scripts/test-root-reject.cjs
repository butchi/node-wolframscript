const { parseMatra } = require('../dist/matra.js')

const jsStr = 'Plus(1,2,3)'
try {
  const sugarMatch = jsStr.match(/^([a-zA-Z_][\w-]*)\s*\(/)
  const { ALLOWED_NAMES, nameToHead } = require('../dist/func.js')
  const allowedCanonical = new Set()
  for (const n of ALLOWED_NAMES) {
    const head = nameToHead(n) ?? n[0].toUpperCase() + n.slice(1)
    allowedCanonical.add(head)
  }
  const called = sugarMatch[1]
  if (/^[A-Z]/.test(called) && allowedCanonical.has(called)) {
    throw new Error(`Disallowed bare head call: ${called}. Use lower-case shorthand or W.${called}`)
  }
  console.log('OK')
} catch (e) {
  console.log('REJECTED:', e.message)
}
