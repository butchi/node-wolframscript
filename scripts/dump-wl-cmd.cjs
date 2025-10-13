const { parseMatra, matraToExpressionJSON } = require('../dist/matra.js')
const util = require('util')

function buildExportCommand(exprJsonArr, format = 'PNG') {
  const j = JSON.stringify(exprJsonArr).replace(/"/g, '\\"')
  // Use ImportString["<escaped>", "ExpressionJSON"] wrapped in ExportString
  return `ExportString[ImportString["${j}", "ExpressionJSON"], {"Base64", "${format}"}]`
}

const s = 'plot(power(x, 2), { domain: { x: range(-3, 3) }, color: "red", samples: 200 })'
const ast = parseMatra(s)
const expr = matraToExpressionJSON(ast, { nameToHead: (n) => n[0].toUpperCase() + n.slice(1) })
console.log('ExpressionJSON:')
console.log(util.inspect(expr, { depth: null, colors: false }))
console.log('\nWolfram command:')
console.log(buildExportCommand(expr, 'PNG'))
