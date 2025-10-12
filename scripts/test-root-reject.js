const fs = require('fs')
const path = require('path')
const vm = require('vm')

const src = fs.readFileSync(path.join(__dirname, '..', 'dist', 'root.js'), 'utf8')
// Run dist/root.js in a sandboxed environment where we can call evaluate indirectly.
const sandbox = {
  console,
  globalThis: {},
  window: {},
  document: { querySelector: () => null },
  fetch: async () => ({ text: async () => 'OK' }),
}
vm.runInNewContext(src, sandbox)

// Try to simulate evaluation: we can't easily call evaluate due to DOM reliance, but
// we'll directly run the Matra parse and the disallowed-check logic extracted.
const { parseMatra } = require('../dist/matra.js')
const jsStr = 'Plus(1,2,3)'
try {
  // emulate the disallowed-check from root.ts
  const sugarMatch = jsStr.match(/^([a-zA-Z_][\w-]*)\s*\(/)
  const ALLOWED_NAMES = require('../dist/func.js').ALLOWED_NAMES
  const nameToHead = require('../dist/func.js').nameToHead
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
