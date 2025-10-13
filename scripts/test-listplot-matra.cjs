const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const cases = [
  'listPlot([[1,2],[2,3],[3,5]], { color: "blue", samples: 10 })',
  'listPlot({ data: [[1,2],[2,3],[3,5]], color: "green" })',
]
for (const s of cases) {
  const ast = parseMatra(s)
  const expr = matraToExpressionJSON(ast, { nameToHead: (n) => n[0].toUpperCase() + n.slice(1) })
  console.log('INPUT:', s)
  console.log('AST:', JSON.stringify(ast, null, 2))
  console.log('->', JSON.stringify(expr, null, 2))
  console.log('---')
}
