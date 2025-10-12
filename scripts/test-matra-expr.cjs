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

console.log('case1', JSON.stringify(matraExpr('W.Plus(1,2,3)'), null, 2))
console.log('case2', JSON.stringify(matraExpr('object[xpath="/W/Plus"] { [[1,2,3]] }'), null, 2))
console.log('case3', JSON.stringify(matraExpr('["Plus",1,2,3]'), null, 2))
