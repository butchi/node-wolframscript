import type { Expr } from './types.js'

export const operate =
  (head: string) =>
  (...body: unknown[]): Expr => ({
    head,
    body: [...body],
  })

export const constant = (head: string): Expr => ({
  head,
  body: [],
})

// Helper to convert UpperCamelCase -> lowerCamelCase
const toLowerCamel = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

// Overrides for cases where the simple lower-camel conversion shouldn't be used
// or where a different exported name was chosen historically.
const operateNameOverrides: Record<string, string> = {
  N: 'approx',
  RandomReal: 'random',
  FactorInteger: 'factorInt',
  LucasL: 'lucas',
  BernoulliB: 'bernoulli',
  EulerE: 'euler',
}

const constantNameOverrides: Record<string, string> = {
  E: 'ee',
  I: 'ii',
  Undefined: 'undefinedSymbol',
  Null: 'nullSymbol',
  True: 'trueSymbol',
  False: 'falseSymbol',
}

// List of operate heads: only include the heads exposed via shorthand (allowed)
// The raw caller `W` can be used to call arbitrary heads not listed here.
const OPERATE_HEADS = ['Plus', 'Times', 'Power', 'Divide', 'Subtract', 'Sin', 'Cos', 'Sqrt', 'RandomReal']

// constants: only expose a small set used in shorthand
const CONSTANT_HEADS = ['Pi', 'E', 'I']

// Build maps
const operateEntries = OPERATE_HEADS.map((h) => {
  const name = operateNameOverrides[h] ?? toLowerCamel(h)
  return [name, operate(h)] as const
})

const operateMap = Object.fromEntries(operateEntries) as Record<string, (...body: unknown[]) => Expr>

const constantEntries = CONSTANT_HEADS.map((h) => {
  const name = constantNameOverrides[h] ?? toLowerCamel(h)
  return [name, constant(h)] as const
})

const constantMap = Object.fromEntries(constantEntries) as Record<string, Expr>

// Build a map from exported name -> canonical head (e.g. 'plus' -> 'Plus')
const nameToHeadEntries = [
  ...OPERATE_HEADS.map((h) => [operateNameOverrides[h] ?? toLowerCamel(h), h] as const),
  ...CONSTANT_HEADS.map((h) => [constantNameOverrides[h] ?? toLowerCamel(h), h] as const),
]
const nameToHeadMap = Object.fromEntries(nameToHeadEntries) as Record<string, string>

// Export allowed name lists and a resolver so the UI can stay in sync with func
export const ALLOWED_OPERATE_NAMES = Object.keys(Object.fromEntries(operateEntries))
export const ALLOWED_CONSTANT_NAMES = Object.keys(Object.fromEntries(constantEntries))
export const ALLOWED_NAMES = [...ALLOWED_OPERATE_NAMES, ...ALLOWED_CONSTANT_NAMES]

export function nameToHead(name: string): string | undefined {
  return nameToHeadMap[name]
}

// Single namespace object for easier management: func.plus, func.pi, etc.
// helper to call a raw Wolfram head: func.W('Plus')(1,2)
const rawCaller =
  (head: string) =>
  (...body: unknown[]) =>
    operate(head)(...body)

export const func = {
  ...operateMap,
  ...constantMap,
  W: rawCaller,
} as const
