const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const { nameToHead } = require('../dist/func.js')

const input = 'W.Graphics(W.Cirlcle(W.List(0, 0)))'
console.log('input:', input)
const ast = parseMatra(input)
console.log('ast:', JSON.stringify(ast, null, 2))
const expr = matraToExpressionJSON(ast, { nameToHead })
console.log('expr:', JSON.stringify(expr, null, 2))
