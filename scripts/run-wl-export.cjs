const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const { spawnSync } = require('child_process')

const s = 'plot(power(x, 2), { domain: { x: range(-3, 3) }, color: "red", samples: 200 })'
const ast = parseMatra(s)
const expr = matraToExpressionJSON(ast, { nameToHead: (n) => n[0].toUpperCase() + n.slice(1) })
const j = JSON.stringify(expr).replace(/"/g, '\\"')
const cmd = `ExportString[ImportString["${j}", "ExpressionJSON"], {"Base64", "PNG"}]`
console.log('Running wolframscript with command:')
console.log(cmd)

const res = spawnSync('wolframscript', ['-code', cmd], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
console.log('\nexitCode:', res.status)
console.log('\nstdout length:', res.stdout ? res.stdout.length : 0)
console.log('\nstdout (first 500 chars):\n', (res.stdout || '').slice(0, 500))
console.log('\nstderr (first 500 chars):\n', (res.stderr || '').slice(0, 500))

if (res.status === 0 && res.stdout) {
  console.log('\nGot output, writing to out.png (base64 decode)')
  const bs = Buffer.from(res.stdout.replace(/\s+/g, ''), 'base64')
  require('fs').writeFileSync('out.png', bs)
  console.log('wrote out.png', bs.length, 'bytes')
}
