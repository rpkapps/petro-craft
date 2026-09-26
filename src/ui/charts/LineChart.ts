// Interactive HiDPI canvas line/area chart with nice ticks, optional log scale and a crosshair tooltip.
// Redraws only when data (by key), options or size change.
import { h, fitCanvas, clear } from '../dom';

export interface Series {
  name: string;
  color: string;
  data: readonly number[];
  fill?: boolean;
  dashed?: boolean;
  width?: number;
  /** Format values for the tooltip. */
  format?: (v: number) => string;
  hidden?: boolean;
}

export interface LineChartOptions {
  /** Label for index i on the x-axis and in the tooltip. */
  xLabel?: (i: number) => string;
  yFormat?: (v: number) => string;
  log?: boolean;
  /** Force the y-axis to include zero. */
  zero?: boolean;
  crosshair?: boolean;
  padTop?: number;
  legend?: boolean;
  /** Horizontal reference lines. */
  refLines?: { value: number; color: string; label?: string }[];
  /** Smooth curves. */
  smooth?: boolean;
  emptyText?: string;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max - min < 1e-9) {
    const d = Math.abs(max) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export class LineChart {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private legendEl: HTMLElement;
  private series: Series[] = [];
  private key = '';
  private hoverIdx = -1;
  private ro: ResizeObserver;
  private dirty = true;
  private raf = 0;
  private geom = { x0: 0, x1: 0, y0: 0, y1: 0, n: 0 };

  constructor(private opts: LineChartOptions = {}, cls = '') {
    this.canvas = h<HTMLCanvasElement>('canvas');
    this.tip = h('div.chart-tip');
    this.legendEl = h('div.chart-legend');
    this.el = h(`div.chart${cls ? '.' + cls : ''}`, this.canvas, this.tip, this.legendEl);
    this.ro = new ResizeObserver(() => this.invalidate());
    this.ro.observe(this.el);
    if (opts.crosshair !== false) {
      this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
      this.canvas.addEventListener('mouseleave', () => {
        this.hoverIdx = -1;
        this.tip.classList.remove('show');
        this.invalidate();
      });
    }
  }

  setOptions(o: Partial<LineChartOptions>) {
    Object.assign(this.opts, o);
    this.invalidate();
  }

  /** Replace data. When `key` equals the previous key nothing is redrawn. */
  setData(series: Series[], key?: string) {
    const k = key ?? series.map((s) => `${s.name}:${s.data.length}:${s.data[s.data.length - 1]}:${s.hidden ? 1 : 0}`).join('|');
    if (k === this.key) return;
    this.key = k;
    this.series = series;
    this.renderLegend();
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.dirty) this.draw(); });
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  private renderLegend() {
    clear(this.legendEl);
    if (!this.opts.legend) return;
    for (const s of this.series) {
      this.legendEl.appendChild(h('span.lg-item', { style: { opacity: s.hidden ? 0.4 : 1 } }, h('i', { style: { background: s.color } }), s.name));
    }
  }

  private yMap(): { min: number; max: number; map: (v: number) => number; ticks: number[] } {
    const { y0, y1 } = this.geom;
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.series) {
      if (s.hidden) continue;
      for (const v of s.data) {
        if (!Number.isFinite(v)) continue;
        if (this.opts.log && v <= 0) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    for (const r of this.opts.refLines ?? []) {
      min = Math.min(min, r.value);
      max = Math.max(max, r.value);
    }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (this.opts.log) {
      const lmin = Math.floor(Math.log10(Math.max(1e-3, min)));
      const lmax = Math.max(lmin + 1, Math.ceil(Math.log10(Math.max(1e-3, max))));
      const ticks: number[] = [];
      for (let e = lmin; e <= lmax; e++) ticks.push(Math.pow(10, e));
      const map = (v: number) => y1 - ((Math.log10(Math.max(v, Math.pow(10, lmin))) - lmin) / (lmax - lmin)) * (y1 - y0);
      return { min: Math.pow(10, lmin), max: Math.pow(10, lmax), map, ticks };
    }
    if (this.opts.zero !== false) { min = Math.min(0, min); max = Math.max(0, max); }
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
    if (this.opts.zero === false) min -= pad;
    max += pad;
    const ticks = niceTicks(min, max, 4);
    const tmin = Math.min(min, ticks[0] ?? min);
    const tmax = Math.max(max, ticks[ticks.length - 1] ?? max);
    const map = (v: number) => y1 - ((v - tmin) / (tmax - tmin || 1)) * (y1 - y0);
    return { min: tmin, max: tmax, map, ticks };
  }

  draw() {
    this.dirty = false;
    if (!this.el.isConnected) return;
    const { w, h: hh, ctx } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, hh);
    const n = Math.max(0, ...this.series.map((s) => s.data.length));
    const yFmt = this.opts.yFormat ?? ((v: number) => String(Math.round(v)));
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
    // measure y labels
    const padTop = this.opts.padTop ?? (this.opts.legend ? 22 : 10);
    this.geom = { x0: 0, x1: w - 10, y0: padTop, y1: hh - 22, n };
    const ym = this.yMap();
    let labelW = 0;
    for (const t of ym.ticks) labelW = Math.max(labelW, ctx.measureText(yFmt(t)).width);
    this.geom.x0 = Math.ceil(labelW) + 14;
    const { x0, x1, y0, y1 } = this.geom;
    const ym2 = this.yMap();

    // grid
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ym2.ticks) {
      const y = Math.round(ym2.map(t)) + 0.5;
      if (y < y0 - 1 || y > y1 + 1) continue;
      ctx.strokeStyle = t === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,190,204,0.7)';
      ctx.fillText(yFmt(t), x0 - 7, y);
    }
    if (n < 2) {
      ctx.fillStyle = 'rgba(160,170,184,0.6)';
      ctx.textAlign = 'center';
      ctx.font = '500 12px Inter, system-ui, sans-serif';
      ctx.fillText(this.opts.emptyText ?? 'Not enough data yet', (x0 + x1) / 2, (y0 + y1) / 2);
      return;
    }
    const xAt = (i: number) => x0 + (i / (n - 1)) * (x1 - x0);

    // x labels
    if (this.opts.xLabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(160,170,184,0.65)';
      const approx = Math.max(2, Math.floor((x1 - x0) / 90));
      const step = Math.max(1, Math.ceil((n - 1) / approx));
      for (let i = 0; i < n; i += step) {
        const x = xAt(i);
        ctx.fillText(this.opts.xLabel(i), Math.min(x1 - 16, Math.max(x0 + 16, x)), y1 + 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, y0);
        ctx.lineTo(Math.round(x) + 0.5, y1);
        ctx.stroke();
      }
    }

    // reference lines
    for (const r of this.opts.refLines ?? []) {
      const y = Math.round(ym2.map(r.value)) + 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (r.label) {
        ctx.fillStyle = r.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(r.label, x0 + 4, y - 2);
      }
    }

    // series
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0 - 4, x1 - x0, y1 - y0 + 8);
    ctx.clip();
    for (const s of this.series) {
      if (s.hidden || s.data.length < 2) continue;
      const pts: [number, number][] = [];
      const off = n - s.data.length;
      for (let i = 0; i < s.data.length; i++) {
        const v = s.data[i];
        if (!Number.isFinite(v) || (this.opts.log && v <= 0)) continue;
        pts.push([xAt(i + off), ym2.map(v)]);
      }
      if (pts.length < 2) continue;
      const path = new Path2D();
      path.moveTo(pts[0][0], pts[0][1]);
      if (this.opts.smooth !== false && pts.length < 400) {
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1];
          const [cx, cy] = pts[i];
          const mx = (px + cx) / 2;
          path.bezierCurveTo(mx, py, mx, cy, cx, cy);
        }
      } else for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      if (s.fill) {
        const area = new Path2D(path);
        const base = this.opts.log ? y1 : Math.min(y1, ym2.map(Math.max(ym2.min, 0)));
        area.lineTo(pts[pts.length - 1][0], base);
        area.lineTo(pts[0][0], base);
        area.closePath();
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, hexA(s.color, 0.32));
        g.addColorStop(1, hexA(s.color, 0.0));
        ctx.fillStyle = g;
        ctx.fill(area);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.shadowColor = hexA(s.color, 0.5);
      ctx.shadowBlur = 6;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
    }
    ctx.restore();

    // crosshair
    if (this.hoverIdx >= 0 && this.hoverIdx < n) {
      const x = Math.round(xAt(this.hoverIdx)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of this.series) {
        if (s.hidden) continue;
        const i = this.hoverIdx - (n - s.data.length);
        const v = s.data[i];
        if (i < 0 || !Number.isFinite(v)) continue;
        const y = ym2.map(v);
        ctx.fillStyle = '#0b0e13';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private onMove(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const { x0, x1, n } = this.geom;
    if (n < 2) return;
    const mx = e.clientX - r.left;
    const idx = Math.round(((mx - x0) / (x1 - x0)) * (n - 1));
    const clamped = Math.max(0, Math.min(n - 1, idx));
    if (clamped !== this.hoverIdx) {
      this.hoverIdx = clamped;
      this.renderTip();
      this.invalidate();
    }
    const tw = this.tip.offsetWidth;
    let tx = mx + 14;
    if (tx + tw > r.width - 4) tx = mx - tw - 14;
    this.tip.style.left = `${Math.max(4, tx)}px`;
    this.tip.style.top = `${Math.max(4, e.clientY - r.top - 20)}px`;
  }

  private renderTip() {
    const n = this.geom.n;
    clear(this.tip);
    this.tip.appendChild(h('div.ct-x', this.opts.xLabel ? this.opts.xLabel(this.hoverIdx) : `#${this.hoverIdx}`));
    const fmt = this.opts.yFormat ?? ((v: number) => v.toFixed(1));
    for (const s of this.series) {
      if (s.hidden) continue;
      const i = this.hoverIdx - (n - s.data.length);
      const v = s.data[i];
      if (i < 0 || !Number.isFinite(v)) continue;
      this.tip.appendChild(h('div.ct-row', h('i', { style: { background: s.color } }), h('span', s.name), h('b', (s.format ?? fmt)(v))));
    }
    this.tip.classList.add('show');
  }
}

/** Colour with alpha from #rrggbb or rgb(). */
export function hexA(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}
