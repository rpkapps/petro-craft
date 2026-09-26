// GPU frame time via EXT_disjoint_timer_query_webgl2 (when the browser exposes it). One TIME_ELAPSED query
// wraps the whole frame; results are read back asynchronously a few frames later (never stalls).
const MAX_PENDING = 4;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  /** Smoothed GPU frame time in ms, NaN until the first result (or when unsupported). */
  ms = NaN;
  private ext: TimerExt | null;
  private free: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    let ext: TimerExt | null = null;
    try {
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    } catch {
      ext = null;
    }
    this.ext = ext;
  }

  get supported() {
    return !!this.ext;
  }

  begin() {
    const ext = this.ext;
    if (!ext || this.active || this.pending.length >= MAX_PENDING) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    const ext = this.ext;
    if (!ext || !this.active) return;
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect finished queries (call once per frame, outside begin/end). */
  poll() {
    const ext = this.ext;
    if (!ext || !this.pending.length) return;
    const gl = this.gl;
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        if (Number.isFinite(ms) && ms >= 0) this.ms = Number.isFinite(this.ms) ? this.ms + (ms - this.ms) * 0.15 : ms;
      }
      this.free.push(q);
    }
  }

  dispose() {
    if (this.active && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of [...this.free, ...this.pending]) this.gl.deleteQuery(q);
    if (this.active) this.gl.deleteQuery(this.active);
    this.free = [];
    this.pending = [];
    this.active = null;
  }
}
