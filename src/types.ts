export type Expr = { head: string; body: unknown[] }

export type Action = 'json' | 'mathml' | 'tex' | 'raster' | 'vector' | 'audio' | 'text'
