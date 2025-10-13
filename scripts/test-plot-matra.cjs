const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const s = 'plot(power(x, 2), { domain: { x: range(-3, 3) }, color: "red", samples: 200 })'
const ast = parseMatra(s)
const out = matraToExpressionJSON(ast, { nameToHead: (n) => n[0].toUpperCase() + n.slice(1) })
console.log('AST:')
console.log(JSON.stringify(ast, null, 2))
console.log('\n->')
console.log(JSON.stringify(out, null, 2))
