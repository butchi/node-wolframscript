declare module './func.js' {
  import type { Expr } from './types.js'
  export function operate(head: string): (...body: unknown[]) => Expr
  export function constant(head: string): Expr

  export const nm: (...body: unknown[]) => Expr
  export const plus: (...body: unknown[]) => Expr
  export const times: (...body: unknown[]) => Expr

  export const pi: Expr
  export const ee: Expr

  export const table: (...body: unknown[]) => Expr
  export const list: (...body: unknown[]) => Expr

  export const graphics: (...body: unknown[]) => Expr

  const _default: Record<string, any>
  export default _default
}
