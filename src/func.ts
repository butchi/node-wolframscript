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
// For a small set of numeric-friendly heads, provide a "smart" wrapper that
// performs native JS arithmetic when all arguments are numbers, otherwise
// falls back to returning an Expr (so it becomes a Wolfram head call).
const numericHeads = new Set(['Plus', 'Times', 'Subtract', 'Divide', 'Power', 'Sin', 'Cos', 'Sqrt'])

const makeSmart = (head: string) => {
  const raw = operate(head)
  return (...body: unknown[]) => {
    const allNumbers = body.every((b) => typeof b === 'number')
    if (!allNumbers) return raw(...body)

    // All args are numbers: perform native JS operation for common heads
    const nums = body as number[]
    switch (head) {
      case 'Plus':
        return nums.reduce((a, b) => a + b, 0)
      case 'Times':
        return nums.reduce((a, b) => a * b, 1)
      case 'Subtract':
        if (nums.length === 1) return -nums[0]
        return nums.slice(1).reduce((a, b) => a - b, nums[0])
      case 'Divide':
        if (nums.length === 1) return 1 / nums[0]
        return nums.slice(1).reduce((a, b) => a / b, nums[0])
      case 'Power':
        if (nums.length === 0) return 1
        return nums.slice(1).reduce((a, b) => Math.pow(a, b), nums[0])
      case 'Sin':
        return Math.sin(nums[0])
      case 'Cos':
        return Math.cos(nums[0])
      case 'Sqrt':
        return Math.sqrt(nums[0])
      default:
        return raw(...body)
    }
  }
}

const operateEntries = OPERATE_HEADS.map((h) => {
  const name = operateNameOverrides[h] ?? toLowerCamel(h)
  const fn = numericHeads.has(h) ? makeSmart(h) : operate(h)
  return [name, fn] as const
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
