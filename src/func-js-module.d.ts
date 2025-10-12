declare module './func.js' {
  import type { Expr } from './types.js'

  export function operate(head: string): (...body: unknown[]) => Expr
  export function constant(head: string): Expr

  export const func: Record<string, any>
  const _default: Record<string, any>
  export default _default
}
