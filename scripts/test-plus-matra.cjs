const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const { nameToHead } = require('../dist/func.js')

function matraExpr(s) {
  s = s.trim()
  if (s.startsWith('[')) return JSON.parse(s)
  const ast = parseMatra(s)
  if (Array.isArray(ast) && ast[0] === 'object' && ast[1] && typeof ast[1] === 'object') {
    const attrs = ast[1]
    const xpath = attrs['xpath']
    if (typeof xpath === 'string') {
      const m = xpath.match(/^\/W\/([A-Za-z_][\w]*)$/)
      if (m) {
        const head = m[1]
        const args = Array.isArray(ast[2]) ? ast[2] : []
        const out = [head, ...args]
        for (const [k, v] of Object.entries(attrs)) {
          if (k === 'xpath') continue
          out.push(['Rule', k, v])
        }
        return out
      }
    }
  }
  return matraToExpressionJSON(ast, { nameToHead })
}

// Test the specific case: plus(1, 2, 3)
const testInput = 'plus(1, 2, 3)'
const result = matraExpr(testInput)
const exprJsonStr = JSON.stringify(result).replace(/"/g, '\\"')
const cmd = `ExportString[ImportString["${exprJsonStr}", "ExpressionJSON"], "ExpressionJSON"]`

console.log('Input:', testInput)
console.log('Parsed Result:', JSON.stringify(result, null, 2))
console.log('Command:', cmd)
console.log('Expected MOCK_RESULT: ExportString[ImportString["[\"Plus\",1,2,3]", "ExpressionJSON"], "ExpressionJSON"]')