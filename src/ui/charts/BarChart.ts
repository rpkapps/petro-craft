// Stacked diverging bar chart (positive stacks up, negative stacks down) with hover tooltip.
import { h, fitCanvas, clear } from '../dom';
import { niceTicks, hexA } from './LineChart';

export interface BarStack {
  label: string;
  /** Segments: key → signed value. */
  parts: Record<string, number>;
}
export interface BarChartOptions {
  colors: Record<string, string>;
  names?: Record<string, string>;
  yFormat?: (v: number) => string;
  /** Optional line overlay (e.g. net) per bar. */
  line?: { name: string; color: string; values: number[] };
}

export class BarChart {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private bars: BarStack[] = [];
  private key = '';
  private hover = -1;
  private ro: ResizeObserver;
  private raf = 0;
  private geom = { x0: 0, x1: 0, bw: 0, n: 0 };

  constructor(private opts: BarChartOptions) {
    this.canvas = h<HTMLCanvasElement>('canvas');
    this.tip = h('div.chart-tip');
    this.el = h('div.chart', this.canvas, this.tip);
    this.ro = new ResizeObserver(() => this.invalidate());
    this.ro.observe(this.el);
    this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = -1;
      this.tip.classList.remove('show');
      this.invalidate();
    });
  }

  setData(bars: BarStack[], key: string, line?: BarChartOptions['line']) {
    if (key === this.key) return;
    this.key = key;
    this.bars = bars;
    this.opts.line = line;
    this.invalidate();
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  private draw() {
    if (!this.el.isConnected) return;
    const { w, h: hh, ctx } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, hh);
    const fmt = this.opts.yFormat ?? ((v: number) => String(Math.round(v)));
    let max = 0;
    let min = 0;
    for (const b of this.bars) {
      let p = 0;
      let n = 0;
      for (const v of Object.values(b.parts)) (v >= 0 ? (p += v) : (n += v));
      max = Math.max(max, p);
      min = Math.min(min, n);
    }
    for (const v of this.opts.line?.values ?? []) { max = Math.max(max, v); min = Math.min(min, v); }
    if (max === min) max = 1;
    const ticks = niceTicks(min, max, 4);
    const tmin = Math.min(min, ticks[0]);
    const tmax = Math.max(max, ticks[ticks.length - 1]);
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
    let lw = 0;
    for (const t of ticks) lw = Math.max(lw, ctx.measureText(fmt(t)).width);
    const x0 = Math.ceil(lw) + 14;
    const x1 = w - 8;
    const y0 = 10;
    const y1 = hh - 22;
    const ym = (v: number) => y1 - ((v - tmin) / (tmax - tmin)) * (y1 - y0);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Math.round(ym(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,190,204,0.7)';
      ctx.fillText(fmt(t), x0 - 7, y);
    }
    const n = this.bars.length;
    this.geom = { x0, x1, bw: (x1 - x0) / Math.max(1, n), n };
    if (!n) {
      ctx.fillStyle = 'rgba(160,170,184,0.6)';
      ctx.textAlign = 'center';
      ctx.font = '500 12px Inter, system-ui, sans-serif';
      ctx.fillText('No history yet — check back tomorrow', (x0 + x1) / 2, (y0 + y1) / 2);
      return;
    }
    const bw = this.geom.bw;
    const gap = Math.max(1, Math.min(4, bw * 0.22));
    for (let i = 0; i < n; i++) {
      const b = this.bars[i];
      const bx = x0 + i * bw + gap / 2;
      const bwid = Math.max(1, bw - gap);
      let up = 0;
      let dn = 0;
      for (const [k, v] of Object.entries(b.parts)) {
        if (!v) continue;
        const c = this.opts.colors[k] ?? '#888';
        const a = this.hover === -1 || this.hover === i ? 0.95 : 0.45;
        if (v > 0) {
          const ya = ym(up);
          const yb = ym(up + v);
          ctx.fillStyle = hexA(c, a);
          ctx.fillRect(bx, yb, bwid, ya - yb);
          up += v;
        } else {
          const ya = ym(dn);
          const yb = ym(dn + v);
          ctx.fillStyle = hexA(c, a * 0.9);
          ctx.fillRect(bx, ya, bwid, yb - ya);
          dn += v;
        }
      }
      ctx.fillStyle = 'rgba(160,170,184,0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((x1 - x0) / 70))));
      if (i % every === 0) ctx.fillText(b.label, bx + bwid / 2, y1 + 7);
    }
    const line = this.opts.line;
    if (line && line.values.length) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = hexA(line.color, 0.6);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      line.values.forEach((v, i) => {
        const x = x0 + (i + 0.5) * bw;
        const y = ym(v);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  private onMove(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const { x0, bw, n } = this.geom;
    const i = Math.floor((mx - x0) / bw);
    const idx = i >= 0 && i < n ? i : -1;
    if (idx !== this.hover) {
      this.hover = idx;
      this.invalidate();
      clear(this.tip);
      if (idx < 0) {
        this.tip.classList.remove('show');
        return;
      }
      const b = this.bars[idx];
      const fmt = this.opts.yFormat ?? ((v: number) => String(Math.round(v)));
      this.tip.appendChild(h('div.ct-x', b.label));
      const entries = Object.entries(b.parts).filter(([, v]) => Math.abs(v) > 0.5).sort((a, c) => c[1] - a[1]);
      for (const [k, v] of entries) this.tip.appendChild(h('div.ct-row', h('i', { style: { background: this.opts.colors[k] ?? '#888' } }), h('span', this.opts.names?.[k] ?? k), h('b', fmt(v))));
      if (this.opts.line) this.tip.appendChild(h('div.ct-row.total', h('i', { style: { background: this.opts.line.color } }), h('span', this.opts.line.name), h('b', fmt(this.opts.line.values[idx] ?? 0))));
      this.tip.classList.add('show');
    }
    const tw = this.tip.offsetWidth;
    let tx = mx + 14;
    if (tx + tw > r.width - 4) tx = mx - tw - 14;
    this.tip.style.left = `${Math.max(4, tx)}px`;
    this.tip.style.top = `${Math.max(4, e.clientY - r.top - 30)}px`;
  }
}
