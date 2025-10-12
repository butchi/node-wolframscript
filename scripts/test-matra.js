const fs = require('fs')
const path = require('path')
const ts = require('typescript')

// Load the TypeScript source and transpile it to plain JS in-memory
const srcPath = path.join(__dirname, '..', 'src', 'matra.ts')
const src = fs.readFileSync(srcPath, 'utf8')
const transpiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText

// Evaluate the transpiled code in a new module context
const vm = require('vm')
const sandbox = { module: {}, exports: {}, require, console }
vm.runInNewContext(transpiled + '\nmodule.exports = { parseMatra, matraToExpressionJSON }', sandbox)
const { parseMatra, matraToExpressionJSON } = sandbox.module.exports

const input = 'Plot(Power("x", 2), List("x", -5, 5), { AspectRatio: "Automatic" })'
console.log('Input:', input)
const ast = parseMatra(input)
console.log('Matra AST:', JSON.stringify(ast, null, 2))
const expr = matraToExpressionJSON(ast, {
  nameToHead: (n) => {
    // simple mapping for known heads in this test
    if (n === 'power') return 'Power'
    if (n === 'list') return 'List'
    if (n === 'plot') return 'Plot'
    return n[0].toUpperCase() + n.slice(1)
  },
})
console.log('ExpressionJSON:', JSON.stringify(expr, null, 2))
