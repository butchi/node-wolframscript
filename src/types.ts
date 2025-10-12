export interface BinaryResponse {
  mime?: string
  body: Buffer | string
  // optional marker that this is intended as binary-like response
  binary?: true
}

export type ExecOutput = BinaryResponse | string
export type Expr = { head: string; body: unknown[] }

export type Action = 'json' | 'mathml' | 'tex' | 'raster' | 'vector' | 'audio' | 'text'
