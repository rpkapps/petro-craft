// Performance overlay (settings.showFps): FPS with a frame-time sparkline, effective render scale and whatever
// renderer statistics the host exposes (duck-typed `host.stats`: drawCalls, triangles, chunks, frameMs, gpuMs, …).
import { h, setText, toggleClass, clear } from '../dom';
import type { AppShell } from '../../core/client';
import { sparkline, type SparkCtl } from '../charts/mini';
import { compact, titleCase } from '../format';

type StatFmt = (v: number) => string;
const ms: StatFmt = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
const KNOWN: Record<string, [label: string, fmt: StatFmt, order: number]> = {
  frameMs: ['CPU frame', ms, 0],
  gpuMs: ['GPU frame', ms, 1],
  drawCalls: ['Draw calls', (v) => compact(v, v >= 1000 ? 1 : 0), 2],
  triangles: ['Triangles', (v) => compact(v, v >= 1000 ? 1 : 0), 3],
  chunks: ['Chunks', (v) => String(Math.round(v)), 4],
  renderDistance: ['View distance', (v) => `${Math.round(v)} ch`, 5],
  autoQualityStep: ['Auto-quality step', (v) => String(Math.round(v)), 6],
};
const MAX_ROWS = 8;
const HISTORY = 60;

function fpsColor(fps: number): string {
  return fps >= 55 ? '#3ddc84' : fps >= 30 ? '#ffc233' : '#ff4d4f';
}

/** Readable label for an unknown stats key: "shadowCasters" → "Shadow casters". */
function labelFor(key: string): string {
  const words = titleCase(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  return words.charAt(0) + words.slice(1).toLowerCase();
}

export class PerfOverlay {
  readonly el: HTMLElement;
  private fpsEl: HTMLElement;
  private frameEl: HTMLElement;
  private spark: SparkCtl;
  private grid: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private rowSig = '';
  private history: number[] = [];
  private acc = 0;

  private lastH = -1;

  /** `root` receives `--perf-h` (the overlay height) so the toast stack can make room below it. */
  constructor(private app: AppShell, private root: HTMLElement) {
    this.fpsEl = h('span.pf-fps');
    this.frameEl = h('span.pf-ms');
    this.spark = sparkline(76, 22, '#3ddc84');
    this.grid = h('div.pf-grid');
    this.el = h('div.pc-perf.glass.flat.mono.hidden', h('div.pf-head', h('div.pf-main', this.fpsEl, h('span.pf-unit', 'FPS')), this.spark.el), h('div.pf-sub', h('span', 'Frame time'), this.frameEl), this.grid);
  }

  /** Called every HUD frame; samples at 4 Hz. */
  frame(dt: number) {
    const on = !!this.app.settings.showFps && !!this.app.host;
    toggleClass(this.el, 'hidden', !on);
    if (!on) {
      this.history.length = 0;
      this.setHeight(0);
      return;
    }
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.sample();
  }

  private sample() {
    const host = this.app.host!;
    const fps = Math.max(0, host.fps || 0);
    this.history.push(fps);
    if (this.history.length > HISTORY) this.history.shift();
    const col = fpsColor(fps);
    setText(this.fpsEl, String(Math.round(fps)));
    this.fpsEl.style.color = col;
    setText(this.frameEl, fps > 0 ? `${(1000 / fps).toFixed(1)} ms` : '—');
    this.spark.set(this.history.length > 1 ? this.history : [fps, fps], col);

    const entries: [string, string, string, number][] = [];
    const scale = host.effectiveRenderScale;
    if (typeof scale === 'number' && Number.isFinite(scale)) {
      const auto = this.app.settings.autoQuality && scale < this.app.settings.renderScale - 0.005;
      entries.push(['__scale', 'Render scale', `${Math.round(scale * 100)}%${auto ? ' auto' : ''}`, -1]);
    }
    const stats = (host as unknown as { stats?: unknown }).stats;
    if (stats && typeof stats === 'object') {
      for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const known = KNOWN[k];
        entries.push([k, known ? known[0] : labelFor(k), known ? known[1](v) : compact(v, Math.abs(v) < 10 && v % 1 ? 2 : 0), known ? known[2] : 10]);
      }
    }
    entries.sort((a, b) => a[3] - b[3]);
    const shown = entries.slice(0, MAX_ROWS);
    const sig = shown.map((e) => e[0]).join('|');
    if (sig !== this.rowSig) {
      this.rowSig = sig;
      clear(this.grid);
      this.rows.clear();
      for (const [k, label] of shown) {
        const v = h('span.pf-v');
        this.rows.set(k, v);
        this.grid.append(h('span.pf-k', label), v);
      }
    }
    for (const [k, , text] of shown) setText(this.rows.get(k), text);
    toggleClass(this.grid, 'hidden', shown.length === 0);
    this.setHeight(this.el.offsetHeight);
  }

  private setHeight(px: number) {
    if (px === this.lastH) return;
    this.lastH = px;
    this.root.style.setProperty('--perf-h', px ? `calc(${px}px + 0.5rem)` : '0px');
  }

  destroy() {
    this.setHeight(0);
  }
}
