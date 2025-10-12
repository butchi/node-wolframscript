declare module 'koa2-router' {
  const Router: any
  export default Router
}

// KaTeX (CDNから読み込むグローバル)
declare const katex: {
  render: (expr: string, el: Element, opts?: Record<string, unknown>) => void
}
