// Well planner (opened from a rig): trajectory kind, target depth on a depth track (pore/frac pressure,
// nearby seismic, known reservoirs), kickoff, azimuth dial, offset/lateral, casing program, mud weight,
// purpose and name; live trajectory previews and quote; confirm → 'well/plan' + 'well/spud'.
import { h, s as svgEl, clear, setText, setAttr, fitCanvas, toggleClass } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, field, segmented, select, slider, type SegCtl, type SliderCtl } from '../core/components';
import type { BuildingState, SeismicImage, WellPlan, WellPurpose, WellState, Vec3 } from '../../core/types';
import { COLORMAPS } from '../charts/colormap';
import { drawWellSchematic } from '../render/wellViz';
import { buildingName, isRig } from '../game';
import { lengthBlocks, lengthValue, lengthUnit, money, mudWeight, int, titleCase } from '../format';
import { niceTicks } from '../charts/LineChart';

type Kind = WellPlan['kind'];
const PURPOSES: { value: WellPurpose; label: string; tech?: string }[] = [
  { value: 'exploration', label: 'Exploration (wildcat)' }, { value: 'appraisal', label: 'Appraisal' }, { value: 'development', label: 'Development (producer)' },
  { value: 'injector_water', label: 'Water injector', tech: 'waterflood' }, { value: 'injector_gas', label: 'Gas injector', tech: 'compression' },
  { value: 'injector_co2', label: 'CO₂ injector', tech: 'co2_eor' }, { value: 'disposal', label: 'Disposal well' },
];
const CASING_NAMES = ['Surface', 'Intermediate', 'Production', 'Liner', 'Liner 2'];

export class PlannerPanel extends Panel {
  readonly id = 'planner' as const;
  private rig: BuildingState | null = null;
  private cx = 0;
  private cz = 0;
  private surfaceY = 64;
  private plan!: WellPlan;
  private purpose: WellPurpose = 'exploration';
  private name = '';
  private profile: { y: number; pore: number; frac: number }[] = [];
  private seis: { img: SeismicImage; col: number; name: string } | null = null;
  private seisRaster: HTMLCanvasElement | null = null;
  private depthCanvas!: HTMLCanvasElement;
  private sideCanvas!: HTMLCanvasElement;
  private planCanvas!: HTMLCanvasElement;
  private quoteEl!: HTMLElement;
  private casingList!: HTMLElement;
  private dragging: 'target' | 'kickoff' | null = null;
  private dirty = true;
  private quoteTimer = 0;
  private traj: Vec3[] = [];
  private kindSeg!: SegCtl<Kind>;
  private targetSl!: SliderCtl;
  private kickSl!: SliderCtl;
  private offSl!: SliderCtl;
  private latSl!: SliderCtl;
  private mudSl!: SliderCtl;
  private dirBox!: HTMLElement;
  private azPointer!: SVGLineElement;
  private azText!: HTMLElement;
  private confirmBtn!: HTMLButtonElement;
  private cleanup: (() => void)[] = [];

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Well Planner', 'ruler', 'full');
    this.fixedBody = true;
    const st = ui.game.state;
    const rigId = typeof args.rigId === 'string' ? args.rigId : undefined;
    this.rig = rigId ? st.buildings[rigId] ?? null : null;
    if (!this.rig) {
      // Opened without a rig (e.g. from the tutorial): pick an idle, completed rig.
      const rigs = Object.values(st.buildings).filter((b) => isRig(b.type) && b.constructionProgress >= 1);
      this.rig = rigs.find((b) => !b.wellId) ?? rigs[0] ?? null;
    }
  }

  protected build() {
    const ctx = this.ui.game;
    const rig = this.rig;
    if (!rig) {
      this.body.appendChild(h('div.empty', icon('rig'), h('div', 'Select a drilling rig to plan a well.')));
      return;
    }
    this.cx = Math.floor(rig.x + rig.size[0] / 2);
    this.cz = Math.floor(rig.z + rig.size[1] / 2);
    this.surfaceY = ctx.geology.surfaceHeight(this.cx, this.cz);
    this.setSubtitle(`${buildingName(ctx.state, rig)} · surface location ${this.cx}, ${this.cz}`);
    // defaults
    const known = this.knownReservoirs();
    const target = known.length ? Math.round(known[0].bottomY + 1) : Math.max(8, this.surfaceY - 30);
    this.plan = ctx.services.wells.suggestPlan(this.cx, this.cz, target, 'vertical');
    this.plan.azimuth ??= 0;
    const nWells = Object.keys(ctx.state.wells).length;
    this.purpose = Object.values(ctx.state.wells).some((w) => Math.hypot(w.x - this.cx, w.z - this.cz) < 60 && w.penetrated.length) ? 'development' : 'exploration';
    this.name = `${known[0]?.name.split(' ')[0] ?? buildingName(ctx.state, rig).split(' ')[0]} ${nWells + 1}`;
    try {
      this.profile = ctx.services.wells.pressureProfile(this.cx, this.cz);
    } catch {
      this.profile = [];
    }
    this.findSeismic();

    // ---- left: depth track -------------------------------------------------------------------
    this.depthCanvas = h<HTMLCanvasElement>('canvas.pl-depth');
    const depthCard = h('div.card.pl-depthcard',
      h('div.section-title', icon('depth'), 'Target depth'),
      h('div.pl-depthbox', this.depthCanvas),
      h('div.pl-key',
        h('span', h('i', { style: { background: '#4ea8ff' } }), 'Pore'), h('span', h('i', { style: { background: '#ff4d4f' } }), 'Frac'),
        h('span', h('i', { style: { background: '#ff8a1f' } }), 'Target'), h('span', h('i', { style: { background: '#2ad0e0' } }), 'Kick-off'),
        h('span', h('i', { style: { background: 'rgba(61,220,132,.7)' } }), 'Reservoir')),
      h('div.tiny.dim', this.seis ? `Seismic: ${this.seis.name}` : 'No seismic near this rig — shoot a line to see the structure.'));
    this.bindDepthDrag();

    // ---- middle: previews ------------------------------------------------------------------------
    this.sideCanvas = h<HTMLCanvasElement>('canvas.pl-side');
    this.planCanvas = h<HTMLCanvasElement>('canvas.pl-plan');
    const previews = h('div.pl-previews',
      h('div.card.pl-prev', h('div.section-title', icon('wells'), 'Section view'), h('div.pl-canvasbox', this.sideCanvas)),
      h('div.card.pl-prev.small', h('div.section-title', icon('map'), 'Plan view'), h('div.pl-canvasbox', this.planCanvas)));

    // ---- right: form --------------------------------------------------------------------------
    const kinds: { value: Kind; label: string; disabled?: boolean; title?: string }[] = [
      { value: 'vertical', label: 'Vertical' },
      { value: 'directional', label: 'Directional', disabled: !ctx.hasTech('directional_drilling'), title: 'Requires Directional Drilling' },
      { value: 'horizontal', label: 'Horizontal', disabled: !ctx.hasTech('horizontal_drilling'), title: 'Requires Horizontal Drilling' },
    ];
    this.kindSeg = segmented<Kind>(kinds, this.plan.kind, (v) => this.setKind(v));
    const u = this.ui.units;
    // Depth sliders work in blocks below the surface (d = surfaceY − y) so dragging right goes deeper.
    const depthFmt = (d: number) => lengthBlocks(d, u);
    const S = this.surfaceY;
    this.targetSl = slider({ min: 4, max: S - 4, step: 1, value: S - this.plan.targetY, format: depthFmt, onInput: (d) => { this.plan.targetY = S - d; this.clampPlan(); this.changed(); } });
    this.kickSl = slider({ min: 3, max: S - 6, step: 1, value: S - (this.plan.kickoffY ?? this.plan.targetY + 12), format: depthFmt, onInput: (d) => { this.plan.kickoffY = S - d; this.clampPlan(); this.changed(); } });
    const maxLat = Math.round(40 * ctx.modifier('max_lateral'));
    this.offSl = slider({ min: 2, max: 40, step: 1, value: this.plan.offset ?? 12, format: (v) => lengthBlocks(v, u), onInput: (v) => { this.plan.offset = v; this.changed(); } });
    this.latSl = slider({ min: 4, max: Math.max(8, maxLat), step: 1, value: this.plan.lateralLength ?? 20, format: (v) => lengthBlocks(v, u), onInput: (v) => { this.plan.lateralLength = v; this.changed(); } });
    this.dirBox = h('div.col', { style: 'gap:.6rem' });
    this.casingList = h('div.pl-casing');
    this.mudSl = slider({ min: 8.4, max: 18, step: 0.1, value: this.plan.mudWeight, format: (v) => mudWeight(v, u), onInput: (v) => { this.plan.mudWeight = v; this.changed(); } });
    const purpose = select(PURPOSES.filter((p) => !p.tech || ctx.hasTech(p.tech)).map((p) => ({ value: p.value, label: p.label })), this.purpose, (v) => { this.purpose = v; this.changed(); });
    const nameIn = h<HTMLInputElement>('input.input', { value: this.name, maxLength: 28 });
    nameIn.addEventListener('input', () => (this.name = nameIn.value));
    this.quoteEl = h('div.pl-quote');
    const suggest = button(null, { icon: 'sparkle', size: 'xs', title: 'Suggest a casing program & mud weight', onClick: () => {
      const sp = ctx.services.wells.suggestPlan(this.cx, this.cz, this.plan.targetY, this.plan.kind);
      this.plan.casingPoints = sp.casingPoints;
      this.plan.mudWeight = sp.mudWeight;
      this.mudSl.set(sp.mudWeight);
      this.ui.sound('click');
      this.renderCasing();
      this.changed();
    } });
    this.confirmBtn = button('Approve & spud', { icon: 'play', variant: 'primary', size: 'lg', block: true, onClick: () => this.confirm() });
    const form = h('div.pl-form.scroll',
      h('div.card',
        h('div.section-title', icon('wells'), 'Trajectory'),
        this.kindSeg.el,
        field('Target depth (TVD)', this.targetSl.el),
        this.dirBox),
      h('div.card',
        h('div.section-title', icon('pipe'), 'Casing program', suggest),
        this.casingList,
        field('Mud weight', this.mudSl.el)),
      h('div.card',
        h('div.section-title', icon('flag'), 'Well'),
        field('Purpose', purpose),
        field('Name', nameIn)),
      h('div.card.pl-quotecard', h('div.section-title', icon('coin'), 'Estimate'), this.quoteEl, this.confirmBtn));
    this.body.appendChild(h('div.pl-layout', depthCard, previews, form));
    this.renderDirectional();
    this.renderCasing();
    this.changed();
  }

  private knownReservoirs() {
    const ctx = this.ui.game;
    return ctx.geology.reservoirs
      .filter((r) => {
        const rs = ctx.state.reservoirs[r.id];
        if (!rs || (!rs.discovered && rs.knowledge < 0.2)) return false;
        const dx = (this.cx - r.center.x) / (r.radiusX * 1.3);
        const dz = (this.cz - r.center.z) / (r.radiusZ * 1.3);
        return dx * dx + dz * dz <= 1;
      })
      .sort((a, b) => b.topY - a.topY);
  }

  private findSeismic() {
    const ctx = this.ui.game;
    let best: { s: (typeof ctx.state.surveys)[string]; opts?: { inline?: number; crossline?: number }; d: number } | null = null;
    for (const s of Object.values(ctx.state.surveys)) {
      if (s.progress < 0.3) continue;
      if (s.kind === '2d') {
        const vx = s.x1 - s.x0;
        const vz = s.z1 - s.z0;
        const L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((this.cx - s.x0) * vx + (this.cz - s.z0) * vz) / L2));
        const d = Math.hypot(s.x0 + vx * t - this.cx, s.z0 + vz * t - this.cz);
        if (d < 16 && (!best || d < best.d)) best = { s, d };
      } else {
        const inside = this.cx >= Math.min(s.x0, s.x1) && this.cx <= Math.max(s.x0, s.x1) && this.cz >= Math.min(s.z0, s.z1) && this.cz <= Math.max(s.z0, s.z1);
        if (inside) best = { s, opts: { inline: this.cz - Math.min(s.z0, s.z1) }, d: 0 };
      }
    }
    if (!best) return;
    try {
      const img = ctx.services.seismic.getSection(best.s, best.opts);
      let col = 0;
      let bd = Infinity;
      img.columns.forEach((c, i) => {
        const d = Math.hypot(c.x - this.cx, c.z - this.cz);
        if (d < bd) { bd = d; col = i; }
      });
      if (img.width > 1) {
        this.seis = { img, col, name: best.s.name };
        const half = Math.max(8, Math.round(img.width * 0.08));
        const c0 = Math.max(0, col - half);
        const c1 = Math.min(img.width - 1, col + half);
        const W = c1 - c0 + 1;
        const r = document.createElement('canvas');
        r.width = W;
        r.height = img.height;
        const g = r.getContext('2d')!;
        const out = g.createImageData(W, img.height);
        const lut = COLORMAPS.seismic;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < W; x++) {
          const v = Math.max(-1, Math.min(1, img.data[y * img.width + c0 + x] * 1.4));
          const k = Math.round((v + 1) * 127.5) * 3;
          const i = (y * W + x) * 4;
          out.data[i] = lut[k];
          out.data[i + 1] = lut[k + 1];
          out.data[i + 2] = lut[k + 2];
          out.data[i + 3] = 200;
        }
        g.putImageData(out, 0, 0);
        this.seisRaster = r;
      }
    } catch (err) {
      console.error('[UI] planner seismic failed', err);
    }
  }

  private setKind(k: Kind) {
    const ctx = this.ui.game;
    this.plan.kind = k;
    if (k !== 'vertical') {
      this.plan.kickoffY ??= Math.min(this.surfaceY - 4, this.plan.targetY + 12);
      this.plan.azimuth ??= 0;
      if (k === 'directional') this.plan.offset ??= 12;
      if (k === 'horizontal') this.plan.lateralLength ??= Math.round(20 * ctx.modifier('max_lateral'));
    }
    this.clampPlan();
    this.ui.sound('click');
    this.renderDirectional();
    this.changed();
  }

  private clampPlan() {
    const p = this.plan;
    p.targetY = Math.max(4, Math.min(this.surfaceY - 4, p.targetY));
    if (p.kind !== 'vertical') {
      const minGap = p.kind === 'horizontal' ? 6 : 3;
      p.kickoffY = Math.max(p.targetY + minGap, Math.min(this.surfaceY - 3, p.kickoffY ?? p.targetY + 12));
    }
    p.casingPoints = p.casingPoints.map((c) => Math.max(p.targetY, Math.min(this.surfaceY - 2, c))).sort((a, b) => b - a);
  }

  private renderDirectional() {
    clear(this.dirBox);
    const k = this.plan.kind;
    if (k === 'vertical') return;
    this.kickSl.set(this.surfaceY - (this.plan.kickoffY ?? this.plan.targetY + 12));
    this.dirBox.append(field('Kick-off point', this.kickSl.el), h('div.pl-dirrow', this.azimuthDial(), h('div.col.grow', { style: 'gap:.5rem' }, k === 'directional' ? field('Horizontal offset', this.offSl.el) : field('Lateral length', this.latSl.el))));
  }

  private azimuthDial(): HTMLElement {
    const R = 44;
    const svg = svgEl<SVGSVGElement>('svg', { viewBox: '-56 -56 112 112', class: 'pl-dial' });
    svg.appendChild(svgEl('circle', { r: R, class: 'dl-ring' }));
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r0 = i % 9 === 0 ? R - 8 : R - 4;
      svg.appendChild(svgEl('line', { x1: Math.cos(a) * r0, y1: Math.sin(a) * r0, x2: Math.cos(a) * R, y2: Math.sin(a) * R, class: 'dl-tick' }));
    }
    for (const [t, x, y] of [['N', 0, -R - 7], ['E', R + 7, 0], ['S', 0, R + 7], ['W', -R - 7, 0]] as const) svg.appendChild(svgEl('text', { x, y, class: 'dl-lbl' }, t));
    this.azPointer = svgEl<SVGLineElement>('line', { x1: 0, y1: 0, x2: R - 6, y2: 0, class: 'dl-ptr' });
    svg.appendChild(this.azPointer);
    svg.appendChild(svgEl('circle', { r: 4, class: 'dl-hub' }));
    this.azText = h('div.pl-aztxt.mono');
    const setFromEvent = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      let a = Math.atan2(dy, dx);
      const snap = Math.PI / 36;
      a = Math.round(a / snap) * snap;
      this.plan.azimuth = (a + Math.PI * 2) % (Math.PI * 2);
      this.paintAzimuth();
      this.changed();
    };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      setFromEvent(e);
      const mv = (ev: PointerEvent) => setFromEvent(ev);
      const upf = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', upf); };
      svg.addEventListener('pointermove', mv);
      svg.addEventListener('pointerup', upf);
    });
    this.paintAzimuth();
    return h('div.pl-dialwrap', svg, this.azText);
  }

  private paintAzimuth() {
    const a = this.plan.azimuth ?? 0;
    setAttr(this.azPointer, 'x2', (Math.cos(a) * 38).toFixed(2));
    setAttr(this.azPointer, 'y2', (Math.sin(a) * 38).toFixed(2));
    const bearing = ((a * 180) / Math.PI + 90 + 360) % 360;
    setText(this.azText, `${Math.round(bearing).toString().padStart(3, '0')}°`);
  }

  private renderCasing() {
    clear(this.casingList);
    const u = this.ui.units;
    this.plan.casingPoints.forEach((cp, i) => {
      const S = this.surfaceY;
      const sl = slider({ min: 2, max: S - this.plan.targetY, step: 1, value: S - cp, format: (d) => lengthBlocks(d, u), onChange: (d) => { this.plan.casingPoints[i] = S - d; this.clampPlan(); this.renderCasing(); this.changed(); }, onInput: (d) => { this.plan.casingPoints[i] = S - d; this.changed(); } });
      const rm = button(null, { icon: 'close', size: 'xs', variant: 'ghost', title: 'Remove', onClick: () => { this.plan.casingPoints.splice(i, 1); this.renderCasing(); this.changed(); } });
      this.casingList.appendChild(h('div.pl-cp', h('span.pl-cpname', CASING_NAMES[i] ?? `String ${i + 1}`), sl.el, rm));
    });
    if (this.plan.casingPoints.length < 5) this.casingList.appendChild(button('Add casing point', { icon: 'plus', size: 'xs', onClick: () => {
      const last = this.plan.casingPoints[this.plan.casingPoints.length - 1] ?? this.surfaceY - 6;
      this.plan.casingPoints.push(Math.max(this.plan.targetY, Math.round((last + this.plan.targetY) / 2)));
      this.clampPlan();
      this.renderCasing();
      this.changed();
    } }));
  }

  private changed() {
    this.dirty = true;
    this.quoteTimer = 0.12;
    this.targetSl.set(this.surfaceY - this.plan.targetY);
  }

  private bindDepthDrag() {
    const c = this.depthCanvas;
    const yAt = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const padT = 8;
      const padB = 22;
      const f = (e.clientY - r.top - padT) / (r.height - padT - padB);
      return Math.round(this.surfaceY - f * (this.surfaceY - 4));
    };
    c.addEventListener('mousedown', (e) => {
      const y = yAt(e);
      const k = this.plan.kickoffY;
      this.dragging = this.plan.kind !== 'vertical' && k !== undefined && Math.abs(y - k) <= 1 && Math.abs(y - k) < Math.abs(y - this.plan.targetY) ? 'kickoff' : 'target';
      this.applyDrag(y);
    });
    const move = (e: MouseEvent) => { if (this.dragging) this.applyDrag(yAt(e)); };
    const up = () => { if (this.dragging) { this.dragging = null; this.renderCasing(); } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.cleanup.push(() => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); });
  }

  private applyDrag(y: number) {
    if (this.dragging === 'kickoff') {
      this.plan.kickoffY = y;
      this.kickSl.set(this.surfaceY - y);
    } else this.plan.targetY = y;
    this.clampPlan();
    this.changed();
  }

  frame(dt: number) {
    if (!this.rig) return;
    if (this.quoteTimer > 0) {
      this.quoteTimer -= dt;
      if (this.quoteTimer <= 0) this.renderQuote();
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.traj = this.ui.game.services.wells.planTrajectory(this.cx, this.surfaceY, this.cz, this.plan);
    } catch {
      this.traj = [];
    }
    this.drawDepth();
    this.drawSide();
    this.drawPlan();
  }

  private drawDepth() {
    const { w, h: hh, ctx: g } = fitCanvas(this.depthCanvas);
    const geo = this.ui.game.geology;
    const u = this.ui.units;
    const padL = 54;
    const padR = 8;
    const padT = 8;
    const padB = 22;
    const gw = w - padL - padR;
    const gh = hh - padT - padB;
    const Y = (y: number) => padT + ((this.surfaceY - y) / (this.surfaceY - 4)) * gh;
    g.fillStyle = '#070a0e';
    g.fillRect(0, 0, w, hh);
    // seismic strip (left half)
    const stripW = this.seisRaster ? gw * 0.45 : 0;
    if (this.seisRaster && this.seis) {
      const img = this.seis.img;
      const y0 = Y(img.topY);
      const y1 = Y(img.bottomY);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.seisRaster, padL, y0, stripW, y1 - y0);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(padL + stripW / 2, padT); g.lineTo(padL + stripW / 2, padT + gh); g.stroke();
      g.setLineDash([]);
    }
    // strata column (right part)
    const colX = padL + stripW + 4;
    const colW = 14;
    for (let y = this.surfaceY; y >= 4; y--) {
      let rock = 'shale';
      try { rock = geo.rockAt(this.cx, y, this.cz); } catch { /* ignore */ }
      g.fillStyle = ({ sandstone: '#c9a86a', shale: '#4b4f55', limestone: '#b8b29c', dolomite: '#a8988a', salt: '#e8e2e6', caprock: '#d6d0c8', soil: '#6b4a2f', clay: '#8f95a1', mudstone: '#6d5d4f' } as Record<string, string>)[rock] ?? '#555';
      g.fillRect(colX, Y(y), colW, Math.max(1, gh / (this.surfaceY - 4)) + 0.5);
    }
    // known reservoirs
    for (const r of this.knownReservoirs()) {
      g.fillStyle = r.fluid === 'gas' ? 'rgba(255,90,90,0.28)' : 'rgba(61,220,132,0.28)';
      g.fillRect(padL, Y(r.topY), gw, Y(r.bottomY) - Y(r.topY));
      g.strokeStyle = r.fluid === 'gas' ? '#ff5a5a' : '#3ddc84';
      g.lineWidth = 1;
      g.strokeRect(padL + 0.5, Y(r.topY) + 0.5, gw - 1, Y(r.bottomY) - Y(r.topY));
      g.fillStyle = g.strokeStyle;
      g.font = '700 10px Rajdhani, "Liberation Sans", sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(r.name.toUpperCase(), padL + gw - 4, Y(r.topY) - 1);
    }
    // pressure curves (right part: ppg scale)
    const px0 = colX + colW + 6;
    const pw = padL + gw - px0;
    if (this.profile.length > 1 && pw > 30) {
      const pmin = 8;
      const pmax = Math.max(16, ...this.profile.map((p) => p.frac)) + 0.5;
      const X = (v: number) => px0 + ((v - pmin) / (pmax - pmin)) * pw;
      g.fillStyle = 'rgba(61,220,132,0.08)';
      g.beginPath();
      this.profile.forEach((p, i) => (i ? g.lineTo(X(p.pore), Y(p.y)) : g.moveTo(X(p.pore), Y(p.y))));
      for (let i = this.profile.length - 1; i >= 0; i--) g.lineTo(X(this.profile[i].frac), Y(this.profile[i].y));
      g.fill();
      for (const [k, col] of [['pore', '#4ea8ff'], ['frac', '#ff4d4f']] as const) {
        g.strokeStyle = col;
        g.lineWidth = 1.8;
        g.beginPath();
        this.profile.forEach((p, i) => (i ? g.lineTo(X(p[k]), Y(p.y)) : g.moveTo(X(p[k]), Y(p.y))));
        g.stroke();
      }
      g.strokeStyle = '#3ddc84';
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(this.plan.mudWeight), padT); g.lineTo(X(this.plan.mudWeight), padT + gh); g.stroke();
      g.setLineDash([]);
      g.font = '500 9.5px "JetBrains Mono", monospace';
      g.fillStyle = 'rgba(190,200,212,0.7)';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      for (const t of [8, 10, 12, 14, 16, 18]) if (t <= pmax) g.fillText(u === 'metric' ? (t / 8.345).toFixed(1) : String(t), X(t), padT + gh + 5);
    }
    // depth axis
    g.font = '500 9.5px "JetBrains Mono", monospace';
    g.fillStyle = 'rgba(190,200,212,0.75)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const dmax = lengthValue(this.surfaceY - 4, u);
    for (const t of niceTicks(0, dmax, 8)) {
      const y = padT + (t / dmax) * gh;
      g.fillText(int(t), padL - 5, y);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + gw, y); g.stroke();
    }
    g.save();
    g.translate(8, padT + gh / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillText(`TVD (${lengthUnit(u)})`, 0, 0);
    g.restore();
    // casing points
    for (const cp of this.plan.casingPoints) {
      const y = Y(cp);
      g.fillStyle = '#e8edf2';
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + 8, y); g.lineTo(padL, y - 8); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(232,237,242,0.35)';
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + gw, y); g.stroke();
    }
    // kickoff & target
    const line = (y: number, col: string, label: string) => {
      const yy = Y(y);
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.shadowColor = col;
      g.shadowBlur = 8;
      g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + gw, yy); g.stroke();
      g.shadowBlur = 0;
      g.font = '700 10.5px "JetBrains Mono", monospace';
      const txt = `${label} ${lengthBlocks(this.surfaceY - y, u)}`;
      const tw = g.measureText(txt).width;
      const lx = colX + colW + 6;
      g.fillStyle = 'rgba(8,11,15,0.9)';
      g.fillRect(lx, yy - 16, tw + 10, 14);
      g.fillStyle = col;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(txt, lx + 5, yy - 9);
      g.beginPath(); g.arc(padL + gw - 8, yy, 5, 0, Math.PI * 2); g.fill();
    };
    if (this.plan.kind !== 'vertical' && this.plan.kickoffY !== undefined) line(this.plan.kickoffY, '#2ad0e0', 'KOP');
    line(this.plan.targetY, '#ff8a1f', 'TD');
  }

  private tempWell(): WellState {
    const casing = this.plan.casingPoints.map((y, i) => ({ name: (['surface', 'intermediate', 'production', 'liner', 'liner'] as const)[i] ?? 'liner', topY: this.surfaceY, bottomY: y, cemented: true }));
    return {
      id: 'plan', name: this.name, x: this.cx, z: this.cz, surfaceY: this.surfaceY, offshore: false, purpose: this.purpose, status: 'planned', plan: this.plan,
      trajectory: this.traj, measuredDepth: 0, plannedDepth: this.traj.length, currentY: this.surfaceY, casing, mudWeight: this.plan.mudWeight, bitCondition: 100,
      kickVolume: 0, penetrated: [], completedReservoirs: [], reservoirContact: 0, fracStages: 0, choke: 1, lift: 'natural', productivity: 1,
      rates: { oil: 0, gas: 0, water: 0 }, bhp: 0, waterCut: 0, gor: 0, cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 0, cost: 0, owner: '',
    };
  }

  private drawSide() {
    drawWellSchematic(this.sideCanvas, this.ui.game.geology, this.tempWell(), { units: this.ui.units });
  }

  private drawPlan() {
    const { w, h: hh, ctx: g } = fitCanvas(this.planCanvas);
    const geo = this.ui.game.geology;
    g.fillStyle = '#070a0e';
    g.fillRect(0, 0, w, hh);
    const span = Math.max(40, ...this.traj.map((p) => Math.max(Math.abs(p.x - this.cx), Math.abs(p.z - this.cz)) * 2.4));
    const S = Math.min(w, hh) / span;
    const X = (x: number) => w / 2 + (x - this.cx) * S;
    const Z = (z: number) => hh / 2 + (z - this.cz) * S;
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    const step = span > 200 ? 32 : span > 80 ? 16 : 8;
    for (let x = Math.floor((this.cx - span) / step) * step; x < this.cx + span; x += step) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), hh); g.stroke(); }
    for (let z = Math.floor((this.cz - span) / step) * step; z < this.cz + span; z += step) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(w, Z(z)); g.stroke(); }
    for (const r of this.knownReservoirs()) {
      g.fillStyle = r.fluid === 'gas' ? 'rgba(255,90,90,0.18)' : 'rgba(61,220,132,0.18)';
      g.strokeStyle = r.fluid === 'gas' ? '#ff5a5a' : '#3ddc84';
      g.beginPath(); g.ellipse(X(r.center.x), Z(r.center.z), r.radiusX * S, r.radiusZ * S, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const wl of Object.values(this.ui.game.state.wells)) {
      if (Math.abs(wl.x - this.cx) > span || Math.abs(wl.z - this.cz) > span) continue;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); wl.trajectory.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath(); g.arc(X(wl.x), Z(wl.z), 2.5, 0, Math.PI * 2); g.fill();
    }
    if (this.rig) {
      g.strokeStyle = '#ff8a1f';
      g.setLineDash([4, 3]);
      g.strokeRect(X(this.rig.x), Z(this.rig.z), this.rig.size[0] * S, this.rig.size[1] * S);
      g.setLineDash([]);
    }
    if (this.traj.length > 1) {
      g.strokeStyle = '#ff8a1f';
      g.lineWidth = 3;
      g.shadowColor = 'rgba(255,138,31,0.7)';
      g.shadowBlur = 8;
      g.beginPath(); this.traj.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke();
      g.shadowBlur = 0;
      const e = this.traj[this.traj.length - 1];
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(X(e.x), Z(e.z), 3.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#ff8a1f';
    g.beginPath(); g.arc(X(this.cx), Z(this.cz), 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = '600 10px "JetBrains Mono", monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('N↑', 6, 6);
    g.textAlign = 'right';
    g.fillText(lengthBlocks(step, this.ui.units), w - 6, hh - 16);
    void geo;
  }

  private renderQuote() {
    const ctx = this.ui.game;
    if (!this.rig) return;
    let q: { cost: number; days: number; warnings: string[] };
    try {
      q = ctx.services.wells.quote(this.cx, this.cz, this.plan, this.rig.type);
    } catch (err) {
      q = { cost: 0, days: 0, warnings: [String(err)] };
    }
    const md = this.traj.length > 1 ? this.traj.reduce((a, p, i) => (i ? a + Math.hypot(p.x - this.traj[i - 1].x, p.y - this.traj[i - 1].y, p.z - this.traj[i - 1].z) : 0), 0) : this.surfaceY - this.plan.targetY;
    const afford = ctx.state.company.money >= q.cost || ctx.state.meta.rules.creative;
    clear(this.quoteEl);
    this.quoteEl.append(
      h('div.pl-qrow', h('div', h('span.label', 'Estimated cost'), h(`b.pl-qbig.${afford ? 'accent' : 'danger'}`, money(q.cost))), h('div', h('span.label', 'Duration'), h('b.pl-qbig', `${q.days} d`))),
      h('div.kv', h('span', 'Measured depth'), h('span', lengthBlocks(md, this.ui.units)), h('span', 'True vertical depth'), h('span', lengthBlocks(this.surfaceY - this.plan.targetY, this.ui.units)), h('span', 'Casing strings'), h('span', String(this.plan.casingPoints.length)), h('span', 'Trajectory'), h('span', titleCase(this.plan.kind))),
      q.warnings.length ? h('div.pl-warns', q.warnings.map((wn) => h('div.pl-warn', icon('warning'), h('span', wn)))) : h('div.pl-ok', icon('check'), h('span', 'Plan looks sound')));
    this.confirmBtn.disabled = !afford;
    toggleClass(this.confirmBtn, 'warned', q.warnings.length > 0);
  }

  private confirm() {
    const ctx = this.ui.game;
    const rig = this.rig;
    if (!rig) return;
    const name = this.name.trim() || undefined;
    const before = new Set(Object.keys(ctx.state.wells));
    const r = this.ui.dispatch({ type: 'well/plan', rigId: rig.id, plan: JSON.parse(JSON.stringify(this.plan)) as WellPlan, purpose: this.purpose, name });
    if (!r.ok) return;
    const data = r.data as { wellId?: string } | undefined;
    const wellId = data?.wellId ?? Object.keys(ctx.state.wells).find((id) => !before.has(id) && ctx.state.wells[id].rigId === rig.id) ?? Object.values(ctx.state.wells).find((w) => w.rigId === rig.id && w.status === 'planned')?.id;
    if (!wellId) {
      this.ui.toast('warning', 'Well planned', 'Spud it from the rig inspector when ready.');
      this.ui.closeAll();
      return;
    }
    const sp = this.ui.dispatch({ type: 'well/spud', wellId }, { successSound: 'success' });
    if (sp.ok) this.ui.toast('success', `Spudded ${ctx.state.wells[wellId]?.name ?? 'well'}`, `${buildingName(ctx.state, rig)} is making hole`, { icon: 'rig' });
    this.ui.open('well', { wellId });
  }

  destroy() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}
