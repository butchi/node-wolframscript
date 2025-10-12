const fs = require('fs')
const path = require('path')
const vm = require('vm')

const srcPath = path.join(__dirname, '..', 'src', 'matra.ts')
let src = fs.readFileSync(srcPath, 'utf8')

// Minimal transform: remove TypeScript-only type annotations and `export` keywords
src = src.replace(/export type [^\n]+\n/g, '')
src = src.replace(/export function /g, 'function ')
src = src.replace(/:\s*unknown/g, '')
src = src.replace(/:\s*unknown\[]/g, '[]')
src = src.replace(/:\s*Record<[^>]+>/g, '')
src = src.replace(/\?\:\s*\{[^}]+\}/g, '')
src = src.replace(/: any\[]/g, '[]')
src = src.replace(/\:\s*\{[^}]*\}/g, '')
src = src.replace(/\:\s*\w+\[\]/g, '')

// attach functions to module.exports after eval
const wrapped = `
(function(){
${src}
return { parseMatra, matraToExpressionJSON };
})()
`

const result = vm.runInThisContext(wrapped)
const { parseMatra, matraToExpressionJSON } = result

const input = 'Plot(Power("x", 2), List("x", -5, 5), { AspectRatio: "Automatic" })'
console.log('Input:', input)
const ast = parseMatra(input)
console.log('Matra AST:', JSON.stringify(ast, null, 2))
const expr = matraToExpressionJSON(ast, {
  nameToHead: (n) => {
    if (n.toLowerCase() === 'power') return 'Power'
    if (n.toLowerCase() === 'list') return 'List'
    if (n.toLowerCase() === 'plot') return 'Plot'
    return n[0].toUpperCase() + n.slice(1)
  },
})
console.log('ExpressionJSON:', JSON.stringify(expr, null, 2))
