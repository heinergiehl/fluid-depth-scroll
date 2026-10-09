// Dev only: GPU time per named stage via EXT_disjoint_timer_query_webgl2. Stages must not nest.
// Results arrive a few frames later; `report()` averages what has come back.

export class GpuTimer {
  private readonly gl: WebGL2RenderingContext
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private pending: { name: string; query: WebGLQuery }[] = []
  private current: { name: string; query: WebGLQuery } | null = null
  private sums = new Map<string, { ms: number; n: number }>()
  enabled = false

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2")
  }

  get supported() {
    return !!this.ext
  }

  begin(name: string) {
    if (!this.enabled || !this.ext || this.current) return
    const query = this.gl.createQuery()!
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query)
    this.current = { name, query }
  }

  end() {
    if (!this.current || !this.ext) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.current)
    this.current = null
  }

  // Collect finished queries (call once per frame).
  poll() {
    if (!this.ext) return
    const gl = this.gl
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT)
    this.pending = this.pending.filter(({ name, query }) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true
      if (!disjoint) {
        const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
        const s = this.sums.get(name) ?? { ms: 0, n: 0 }
        s.ms += ms
        s.n++
        this.sums.set(name, s)
      }
      gl.deleteQuery(query)
      return false
    })
  }

  reset() {
    this.sums.clear()
  }

  report() {
    const rows: Record<string, number> = {}
    for (const [name, s] of this.sums) rows[name] = +(s.ms / s.n).toFixed(3)
    return rows
  }
}
