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
vm.runInNewContext(transpiled + '\nmodule.exports = { parseMatra, matraToExpressionJSON, parseValue }', sandbox)
const { parseMatra, matraToExpressionJSON, parseValue } = sandbox.module.exports

const input = 'Plot(Power("x", 2), List("x", -5, 5), { AspectRatio: "Automatic" })'
console.log('Input:', input)
const ast = parseMatra(input)
console.log('Matra AST:', JSON.stringify(ast, null, 2))

// Diagnostic: re-split the inside of the top-level parentheses to inspect parts
function dbgSplit(s) {
  const parts = []
  let buf = ''
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) {
      buf += ch
      esc = false
      continue
    }
    if (inStr) {
      buf += ch
      if (ch === '\\') esc = true
      else if (ch === inStr) inStr = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch
      buf += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      buf += ch
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      buf += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim() !== '') parts.push(buf.trim())
  return parts
}

const open = input.indexOf('(')
const close = input.lastIndexOf(')')
if (open >= 0 && close > open) {
  const inner = input.slice(open + 1, close)
  console.log('Inner:', inner)
  console.log('Split parts:', JSON.stringify(dbgSplit(inner), null, 2))
  // debug parse each part
  const parts = dbgSplit(inner)
  for (let i = 0; i < parts.length; i++) {
    try {
      const v = parseValue(parts[i])
      console.log('parseValue part[' + i + ']:', JSON.stringify(v, null, 2))
    } catch (e) {
      console.log('parseValue error for part[' + i + ']:', e)
    }
  }
}
const expr = matraToExpressionJSON(ast, {
  nameToHead: (n) => {
    if (n.toLowerCase() === 'power') return 'Power'
    if (n.toLowerCase() === 'list') return 'List'
    if (n.toLowerCase() === 'plot') return 'Plot'
    return n[0].toUpperCase() + n.slice(1)
  },
})
console.log('ExpressionJSON:', JSON.stringify(expr, null, 2))
