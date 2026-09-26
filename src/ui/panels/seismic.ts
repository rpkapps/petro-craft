// Seismic viewer: renders a survey's SeismicImage with a selectable colour map & gain, depth/distance axes,
// fluid-indicator overlay and projected wells. 3D surveys add inline/crossline selection and a depth slice.
import { h, clear, setText, fitCanvas } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { chip, field, segmented, slider, toggle, emptyState, type SliderCtl } from '../core/components';
import { COLORMAPS, FLUID_COLORS, colormapCss, type ColormapName } from '../charts/colormap';
import type { SeismicImage, SurveyState } from '../../core/types';
import { lengthBlocks, lengthValue, lengthUnit, int } from '../format';
import { WELL_COLOR } from '../hud/minimap';
import { niceTicks } from '../charts/LineChart';

let cmapPref: ColormapName = 'seismic';
let gainPref = 1.3;

export class SeismicPanel extends Panel {
  readonly id = 'seismic' as const;
  private survey: SurveyState | null = null;
  private img: SeismicImage | null = null;
  private imgKey = '';
  private raster = document.createElement('canvas');
  private canvas!: HTMLCanvasElement;
  private sliceCanvas: HTMLCanvasElement | null = null;
  private slice: SeismicImage | null = null;
  private sliceKey = '';
  private sliceRaster = document.createElement('canvas');
  private cmap: ColormapName = cmapPref;
  private gain = gainPref;
  private showFluid = true;
  private showWells = true;
  private orient: 'inline' | 'crossline' = 'inline';
  private linePos = 0;
  private depthY = 30;
  private hover: { x: number; y: number } | null = null;
  private readout!: HTMLElement;
  private posSlider: SliderCtl | null = null;
  private legendBar!: HTMLElement;
  private geom = { x0: 0, y0: 0, w: 0, h: 0 };
  private ro: ResizeObserver | null = null;
  private dirty = true;
  private lastProg = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Seismic Interpretation', 'seismic', 'full');
    this.fixedBody = true;
    const st = ui.game.state;
    const id = typeof args.surveyId === 'string' ? args.surveyId : Object.values(st.surveys).sort((a, b) => b.startedDay - a.startedDay)[0]?.id;
    this.survey = id ? st.surveys[id] ?? null : null;
    if (this.survey?.kind === '3d') {
      this.linePos = Math.floor(Math.abs(this.survey.z1 - this.survey.z0) / 2);
      const g = ui.game.geology;
      const r = g.reservoirs.find((x) => x.center.x >= Math.min(this.survey!.x0, this.survey!.x1) && x.center.x <= Math.max(this.survey!.x0, this.survey!.x1));
      this.depthY = r ? Math.round((r.topY + r.bottomY) / 2) : 30;
    }
  }

  protected build() {
    const s = this.survey;
    if (!s) {
      this.body.appendChild(emptyState('seismic', 'No seismic data yet', 'Open the map and shoot a 2D line with the seismic tool.'));
      return;
    }
    this.setTitle(s.name);
    this.setSubtitle(`${s.kind.toUpperCase()} survey · quality ×${s.quality.toFixed(1)} · started day ${s.startedDay}`);
    this.actionsEl.append(chip(s.status === 'complete' ? 'Processed' : s.status === 'processing' ? 'Processing' : `Acquiring ${Math.round(s.progress * 100)}%`, s.status === 'complete' ? 'ok' : 'teal'));
    const cm = segmented<ColormapName>([{ value: 'seismic', label: 'Red–Blue' }, { value: 'gray', label: 'Gray' }, { value: 'rainbow', label: 'Rainbow' }], this.cmap, (v) => {
      this.cmap = v;
      cmapPref = v;
      this.imgKey = this.sliceKey = '';
      this.legendBar.style.background = colormapCss(v);
      this.dirty = true;
      this.ui.sound('click');
    });
    const gain = slider({ min: 0.5, max: 4, step: 0.1, value: this.gain, format: (v) => `${v.toFixed(1)}×`, onInput: (v) => { this.gain = v; gainPref = v; this.imgKey = this.sliceKey = ''; this.dirty = true; } });
    const fl = toggle('Fluid indicators', this.showFluid, (v) => { this.showFluid = v; this.imgKey = this.sliceKey = ''; this.dirty = true; });
    if (!s.fluidIndicators) fl.setDisabled(true);
    const wl = toggle('Project wells', this.showWells, (v) => { this.showWells = v; this.dirty = true; });
    this.legendBar = h('div.sx-cbar', { style: { background: colormapCss(this.cmap) } });
    this.canvas = h<HTMLCanvasElement>('canvas.sx-canvas');
    this.readout = h('div.sx-readout.mono');
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.updateReadout();
      this.dirty = true;
    });
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.updateReadout(); this.dirty = true; });
    const controls = h('div.card.sx-controls',
      h('div.section-title', icon('settings'), 'Display'),
      field('Colour map', cm.el),
      h('div.sx-legend', h('span.tiny.dim', 'Trough −'), this.legendBar, h('span.tiny.dim', '+ Peak')),
      field('Gain', gain.el),
      fl.el, s.fluidIndicators ? h('div.sx-fluidkey', ...([['Gas', 3], ['Oil', 2], ['Brine', 1]] as const).map(([n, k]) => h('span', h('i', { style: { background: `rgb(${FLUID_COLORS[k].join(',')})` } }), n))) : h('div.tiny.dim', 'Research AVO analysis for fluid indicators.'),
      wl.el);
    const side = h('div.sx-side.scroll', controls);
    if (s.kind === '3d') {
      const w = Math.abs(s.x1 - s.x0);
      const d = Math.abs(s.z1 - s.z0);
      const or = segmented<'inline' | 'crossline'>([{ value: 'inline', label: 'Inline (W–E)' }, { value: 'crossline', label: 'Crossline (N–S)' }], this.orient, (v) => {
        this.orient = v;
        this.linePos = Math.floor((v === 'inline' ? d : w) / 2);
        if (this.posSlider) {
          this.posSlider.setRange(0, v === 'inline' ? d : w);
          this.posSlider.input.value = String(this.linePos);
          this.posSlider.input.dispatchEvent(new Event('input'));
        }
        this.imgKey = this.sliceKey = '';
        this.dirty = true;
      });
      this.posSlider = slider({ min: 0, max: d, step: 1, value: this.linePos, format: (v) => lengthBlocks(v, this.ui.units), onInput: (v) => { this.linePos = v; this.imgKey = this.sliceKey = ''; this.dirty = true; } });
      const g = this.ui.game.geology;
      const surf = g.surfaceHeight(Math.floor((s.x0 + s.x1) / 2), Math.floor((s.z0 + s.z1) / 2));
      const depth = slider({ min: 4, max: Math.max(5, surf - 2), step: 1, value: this.depthY, format: (v) => lengthBlocks(surf - v, this.ui.units), onInput: (v) => { this.depthY = v; this.sliceKey = ''; this.dirty = true; } });
      this.sliceCanvas = h<HTMLCanvasElement>('canvas.sx-slice');
      side.append(h('div.card',
        h('div.section-title', icon('layers'), '3D volume'),
        field('Section', or.el),
        field('Line position', this.posSlider.el),
        h('div.sx-slicebox', this.sliceCanvas),
        field('Depth slice', depth.el)));
    }
    side.append(h('div.card.sx-hints',
      h('div.section-title', icon('bulb'), 'Interpretation'),
      h('ul',
        h('li', 'Look for ', h('b', 'arched (anticlinal) reflectors'), ' — hydrocarbons migrate up into the crest.'),
        h('li', h('b', 'Offset reflectors'), ' mark faults. Sealing faults trap oil against them.'),
        h('li', h('b', 'Bright spots'), ' (strong negative amplitude) often indicate gas-charged sand.'),
        h('li', 'Tie the section to ', h('b', 'known wells'), ' to identify which reflector is your reservoir.'),
        h('li', 'Plan your well so the target depth sits just below the top of the trap.'))));
    this.body.appendChild(h('div.sx-layout', h('div.sx-main.card', h('div.sx-view', this.canvas), this.readout), side));
    this.ro = new ResizeObserver(() => { this.dirty = true; });
    this.ro.observe(this.canvas);
  }

  private ensureImage() {
    const s = this.survey!;
    const key = `${s.id}|${Math.round(s.progress * 50)}|${s.status}|${this.orient}|${this.linePos}|${this.cmap}|${this.gain}|${this.showFluid}`;
    if (key === this.imgKey && this.img) return;
    this.imgKey = key;
    const svc = this.ui.game.services.seismic;
    try {
      this.img = s.kind === '3d' ? svc.getSection(s, this.orient === 'inline' ? { inline: this.linePos } : { crossline: this.linePos }) : svc.getSection(s);
    } catch (err) {
      console.error('[UI] seismic section failed', err);
      this.img = null;
    }
    if (this.img) this.rasterize(this.img, this.raster);
  }

  private ensureSlice() {
    const s = this.survey!;
    if (s.kind !== '3d' || !this.sliceCanvas) return;
    const key = `${s.id}|${this.depthY}|${this.cmap}|${this.gain}|${this.showFluid}|${Math.round(s.progress * 20)}`;
    if (key === this.sliceKey && this.slice) return;
    this.sliceKey = key;
    try {
      this.slice = this.ui.game.services.seismic.getDepthSlice(s, this.depthY);
    } catch (err) {
      console.error('[UI] depth slice failed', err);
      this.slice = null;
    }
    if (this.slice) this.rasterize(this.slice, this.sliceRaster);
  }

  private rasterize(img: SeismicImage, target: HTMLCanvasElement) {
    const W = Math.max(1, img.width);
    const H = Math.max(1, img.height);
    target.width = W;
    target.height = H;
    const g = target.getContext('2d')!;
    const out = g.createImageData(W, H);
    const lut = COLORMAPS[this.cmap];
    const d = out.data;
    const gain = this.gain;
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(-1, Math.min(1, (img.data[i] ?? 0) * gain));
      const k = Math.round((v + 1) * 127.5) * 3;
      let r = lut[k];
      let gg = lut[k + 1];
      let b = lut[k + 2];
      const f = this.showFluid ? img.fluid?.[i] ?? 0 : 0;
      if (f > 0) {
        const c = FLUID_COLORS[f];
        const a = f === 1 ? 0.25 : 0.55;
        r = r * (1 - a) + c[0] * a;
        gg = gg * (1 - a) + c[1] * a;
        b = b * (1 - a) + c[2] * a;
      }
      d[i * 4] = r;
      d[i * 4 + 1] = gg;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = img.data[i] === 0 && !f ? 0 : 255;
    }
    g.putImageData(out, 0, 0);
  }

  private surfaceMid(): number {
    const img = this.img;
    const g = this.ui.game.geology;
    const c = img?.columns[Math.floor((img.columns.length - 1) / 2)];
    const s = this.survey!;
    return g.surfaceHeight(Math.floor(c?.x ?? (s.x0 + s.x1) / 2), Math.floor(c?.z ?? (s.z0 + s.z1) / 2));
  }

  private updateReadout() {
    const img = this.img;
    const hv = this.hover;
    const { x0, y0, w, h: hh } = this.geom;
    if (!img || !hv || hv.x < x0 || hv.y < y0 || hv.x > x0 + w || hv.y > y0 + hh) {
      setText(this.readout, img ? `${img.width} traces · ${img.height} samples · move the cursor over the section to read values` : '');
      return;
    }
    const col = Math.min(img.width - 1, Math.floor(((hv.x - x0) / w) * img.width));
    const row = Math.min(img.height - 1, Math.floor(((hv.y - y0) / hh) * img.height));
    const y = img.topY - (row / Math.max(1, img.height - 1)) * (img.topY - img.bottomY);
    const amp = img.data[row * img.width + col] ?? 0;
    const c = img.columns[col];
    const fluid = img.fluid?.[row * img.width + col] ?? 0;
    const fl = ['', 'brine', 'OIL', 'GAS'][fluid] ?? '';
    setText(this.readout, `Depth ${lengthBlocks(this.surfaceMid() - y, this.ui.units)} · block y ${Math.round(y)} · X ${c ? Math.round(c.x) : '—'} Z ${c ? Math.round(c.z) : '—'} · amplitude ${amp >= 0 ? '+' : ''}${amp.toFixed(2)}${fl ? ` · ${fl}` : ''}`);
  }

  frame() {
    if (!this.survey || !this.dirty) return;
    this.dirty = false;
    this.ensureImage();
    this.draw();
    this.ensureSlice();
    this.drawSlice();
  }

  update() {
    if (!this.survey) return;
    const s = this.ui.game.state.surveys[this.survey.id];
    if (s && s !== this.survey) this.survey = s;
    const prog = s ? `${Math.round(s.progress * 50)}|${s.status}` : '';
    if (prog !== this.lastProg) {
      this.lastProg = prog;
      this.dirty = true;
    }
  }

  private draw() {
    if (!this.canvas.isConnected) return;
    const { w, h: hh, ctx: g } = fitCanvas(this.canvas);
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, hh);
    const img = this.img;
    const padL = 64;
    const padB = 34;
    const padT = 14;
    const padR = 14;
    const gw = w - padL - padR;
    const gh = hh - padT - padB;
    this.geom = { x0: padL, y0: padT, w: gw, h: gh };
    if (!img || img.width < 2) {
      g.fillStyle = 'rgba(160,170,184,0.7)';
      g.font = '500 13px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Acquiring data — the section will appear as the crew advances.', w / 2, hh / 2);
      return;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.raster, padL, padT, gw, gh);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(padL + 0.5, padT + 0.5, gw - 1, gh - 1);
    const units = this.ui.units;
    const surf = this.surfaceMid();
    // depth axis
    const dTop = lengthValue(surf - img.topY, units);
    const dBot = lengthValue(surf - img.bottomY, units);
    g.font = '500 10.5px "JetBrains Mono", monospace';
    g.fillStyle = 'rgba(190,200,212,0.8)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const t of niceTicks(Math.min(dTop, dBot), Math.max(dTop, dBot), 7)) {
      const y = padT + ((t - dTop) / (dBot - dTop)) * gh;
      if (y < padT || y > padT + gh) continue;
      g.fillText(int(t), padL - 8, y);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); g.moveTo(padL, Math.round(y) + 0.5); g.lineTo(padL + gw, Math.round(y) + 0.5); g.stroke();
    }
    g.save();
    g.translate(14, padT + gh / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillText(`Depth below surface (${lengthUnit(units)})`, 0, 0);
    g.restore();
    // distance axis
    const c0 = img.columns[0];
    const c1 = img.columns[img.columns.length - 1];
    const len = c0 && c1 ? Math.hypot(c1.x - c0.x, c1.z - c0.z) : img.width;
    const lenV = lengthValue(len, units);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const t of niceTicks(0, lenV, 8)) {
      const x = padL + (t / Math.max(1e-6, lenV)) * gw;
      if (x < padL - 1 || x > padL + gw + 1) continue;
      g.fillText(int(t), x, padT + gh + 6);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, padT); g.lineTo(Math.round(x) + 0.5, padT + gh); g.stroke();
    }
    g.fillText(`Distance along line (${lengthUnit(units)})`, padL + gw / 2, padT + gh + 20);
    // wells projected onto the section
    // ground / seabed profile
    const geo = this.ui.game.geology;
    const span = img.topY - img.bottomY || 1;
    g.strokeStyle = '#7fc25a';
    g.lineWidth = 1.5;
    g.beginPath();
    const stepC = Math.max(1, Math.floor(img.columns.length / 300));
    for (let i = 0; i < img.columns.length; i += stepC) {
      const c = img.columns[i];
      let sy = img.topY;
      try { sy = geo.surfaceHeight(Math.floor(c.x), Math.floor(c.z)); } catch { /* ignore */ }
      const x = padL + (i / Math.max(1, img.columns.length - 1)) * gw;
      const y = padT + ((img.topY - sy) / span) * gh;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    if (this.showWells) this.drawWells(g, img, padL, padT, gw, gh);
    // crosshair
    const hv = this.hover;
    if (hv && hv.x >= padL && hv.x <= padL + gw && hv.y >= padT && hv.y <= padT + gh) {
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(hv.x, padT); g.lineTo(hv.x, padT + gh); g.moveTo(padL, hv.y); g.lineTo(padL + gw, hv.y); g.stroke();
      g.setLineDash([]);
    }
  }

  private drawWells(g: CanvasRenderingContext2D, img: SeismicImage, x0: number, y0: number, gw: number, gh: number) {
    const cols = img.columns;
    if (cols.length < 2) return;
    const span = img.topY - img.bottomY || 1;
    for (const wl of Object.values(this.ui.game.state.wells)) {
      if (wl.trajectory.length < 2) continue;
      const pts: [number, number][] = [];
      for (const p of wl.trajectory) {
        let best = -1;
        let bd = 5;
        for (let i = 0; i < cols.length; i += Math.max(1, Math.floor(cols.length / 400))) {
          const d = Math.hypot(cols[i].x - p.x, cols[i].z - p.z);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) continue;
        pts.push([x0 + (best / (cols.length - 1)) * gw, y0 + ((img.topY - p.y) / span) * gh]);
      }
      if (pts.length < 2) continue;
      const col = WELL_COLOR[wl.status] ?? '#fff';
      g.strokeStyle = '#000';
      g.lineWidth = 4;
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      const [tx, ty] = pts[0];
      g.font = '700 11px Rajdhani, "Liberation Sans", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = col;
      g.shadowColor = '#000';
      g.shadowBlur = 4;
      g.fillText(wl.name, tx, Math.max(y0 + 12, ty - 4));
      g.shadowBlur = 0;
      for (const r of wl.completedReservoirs) {
        const res = this.ui.game.geology.getReservoir(r);
        if (!res) continue;
        const yy = y0 + ((img.topY - (res.topY + res.bottomY) / 2) / span) * gh;
        const last = pts[pts.length - 1];
        g.fillStyle = '#ff8a1f';
        g.beginPath(); g.arc(last[0], yy, 3.5, 0, Math.PI * 2); g.fill();
      }
    }
  }

  private drawSlice() {
    const c = this.sliceCanvas;
    const s = this.survey;
    if (!c || !s || !c.isConnected) return;
    const { w, h: hh, ctx: g } = fitCanvas(c);
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, hh);
    if (!this.slice) return;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.sliceRaster, 0, 0, w, hh);
    const W = Math.abs(s.x1 - s.x0);
    const D = Math.abs(s.z1 - s.z0);
    g.strokeStyle = '#ff8a1f';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.beginPath();
    if (this.orient === 'inline') {
      const y = (this.linePos / Math.max(1, D)) * hh;
      g.moveTo(0, y); g.lineTo(w, y);
    } else {
      const x = (this.linePos / Math.max(1, W)) * w;
      g.moveTo(x, 0); g.lineTo(x, hh);
    }
    g.stroke();
    g.setLineDash([]);
    for (const wl of Object.values(this.ui.game.state.wells)) {
      const x = ((wl.x - Math.min(s.x0, s.x1)) / Math.max(1, W)) * w;
      const y = ((wl.z - Math.min(s.z0, s.z1)) / Math.max(1, D)) * hh;
      if (x < 0 || y < 0 || x > w || y > hh) continue;
      g.fillStyle = WELL_COLOR[wl.status] ?? '#fff';
      g.strokeStyle = '#000';
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = '600 10px "JetBrains Mono", monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('N↑', 6, 6);
  }

  destroy() {
    this.ro?.disconnect();
  }

  setArgs(args: PanelArgs) {
    if (args.surveyId === this.survey?.id) return;
    this.args = args;
    const st = this.ui.game.state;
    this.survey = typeof args.surveyId === 'string' ? st.surveys[args.surveyId] ?? null : null;
    this.img = null;
    this.imgKey = '';
    clear(this.body);
    clear(this.actionsEl);
    this.build();
    this.dirty = true;
  }
}
