import type { Expr } from './types.js'

export function operate(head: string): (...body: unknown[]) => Expr
export function constant(head: string): Expr

export const nm: (...body: unknown[]) => Expr
export const plus: (...body: unknown[]) => Expr
export const times: (...body: unknown[]) => Expr
// ... minimal set exported as examples; func.ts exports many more symbols

export const pi: Expr
export const ee: Expr

export const table: (...body: unknown[]) => Expr
export const list: (...body: unknown[]) => Expr

export const graphics: (...body: unknown[]) => Expr

// Allow additional unknown exports
export as namespace FuncModule
