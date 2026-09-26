// Well detail: KPIs, production history chart (linear/log), well schematic, log tracks and status-specific
// controls (mud weight & casing while drilling, kick & blowout response, completion/frac/P&A, choke, lift,
// shut-in, conversion and renaming).
import { h, clear, setText, setBar, bar, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, field, kpi, segmented, slider, statusChip, toggle, type ChipCtl, type KpiCtl, type SliderCtl } from '../core/components';
import { LineChart } from '../charts/LineChart';
import type { LiftType, WellPurpose, WellState } from '../../core/types';
import { drawLogTracks, drawMudWindow, drawWellSchematic } from '../render/wellViz';
import { dayLabel, gasRate, lengthBlocks, money, mudWeight, oilRate, pct, pressure, qty, titleCase, int, compact } from '../format';
import { buildingName, wellTvd } from '../game';

interface UpInfo { op?: { kind?: string; label?: string; hoursLeft?: number; hoursTotal?: number }; limit?: string; potential?: number; kickHours?: number; lostCirc?: boolean }

const LIFTS: { id: LiftType; label: string; tech?: string; desc: string }[] = [
  { id: 'natural', label: 'Natural flow', desc: 'Reservoir pressure lifts the fluids.' },
  { id: 'pumpjack', label: 'Pumpjack', tech: 'pumpjacks', desc: 'Beam pump for moderate rates.' },
  { id: 'esp', label: 'ESP', tech: 'esp_pumps', desc: 'Electric submersible pump — high rates, uses power.' },
  { id: 'gaslift', label: 'Gas lift', tech: 'gas_lift', desc: 'Injects gas to lighten the column.' },
];
const CONVERSIONS: { id: WellPurpose; label: string; tech?: string }[] = [
  { id: 'injector_water', label: 'Water injector', tech: 'waterflood' },
  { id: 'injector_gas', label: 'Gas injector', tech: 'compression' },
  { id: 'injector_co2', label: 'CO₂ injector', tech: 'co2_eor' },
  { id: 'disposal', label: 'Disposal well' },
];

let chartLog = false;

export class WellPanel extends Panel {
  readonly id = 'well' as const;
  private wellId: string;
  private chip: ChipCtl | null = null;
  private kpis: KpiCtl[] = [];
  private limit!: HTMLElement;
  private chart!: LineChart;
  private schematic!: HTMLCanvasElement;
  private logs!: HTMLCanvasElement;
  private logsCard!: HTMLElement;
  private chartCard!: HTMLElement;
  private controls!: HTMLElement;
  private controlsSig = '';
  private patchers: (() => void)[] = [];
  private t = 0;
  private schemSig = '';
  private logSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Well', 'wellhead', 'xl');
    this.wellId = String(args.wellId ?? '');
  }

  private get w(): WellState | undefined {
    return this.ui.game.state.wells[this.wellId];
  }

  setArgs(args: PanelArgs) {
    if (args.wellId === this.wellId) return;
    this.wellId = String(args.wellId ?? '');
    this.controlsSig = this.schemSig = this.logSig = '';
    this.chart?.destroy();
    this.rebuild();
  }

  protected build() {
    const w = this.w;
    if (!w) {
      this.body.appendChild(h('div.empty', icon('wells'), h('div', 'This well no longer exists.')));
      return;
    }
    this.setTitle(w.name);
    this.chip = statusChip('well', w.status);
    const rename = button(null, { icon: 'edit', size: 'sm', title: 'Rename well', onClick: () => this.renameDialog() });
    const locate = button(null, { icon: 'map', size: 'sm', title: 'Show on map', onClick: () => { this.ui.sound('click'); this.ui.open('map', { at: { x: w.x, z: w.z } }, { stack: true }); } });
    this.actionsEl.append(this.chip.el, rename, locate);
    const names: [string, IconName, string][] = [['Oil', 'oil', '#c98b3a'], ['Gas', 'gas', '#6fc3ff'], ['Water', 'water', '#3f8fd8'], ['Cumulative', 'barrel', '#ffb35c'], ['Pressure', 'gauge', '#a78bfa'], ['Depth', 'depth', '#2ad0e0']];
    this.kpis = names.map(([n, ic, c]) => kpi(n, ic, c));
    this.limit = h('div.banner.warn.hidden', icon('warning'), h('span'));
    this.chart = new LineChart({ xLabel: (i) => this.xLabel(i), yFormat: (v) => compact(v), legend: true, log: chartLog, zero: true, emptyText: 'No production history yet' });
    const scale = segmented<'lin' | 'log'>([{ value: 'lin', label: 'Linear' }, { value: 'log', label: 'Log' }], chartLog ? 'log' : 'lin', (v) => { chartLog = v === 'log'; this.chart.setOptions({ log: chartLog }); this.ui.sound('click'); });
    this.schematic = h<HTMLCanvasElement>('canvas.wl-schem');
    this.logs = h<HTMLCanvasElement>('canvas.wl-logs');
    this.logsCard = h('div.card.wl-logcard', h('div.section-title', icon('seismic'), 'Wireline & mud logs'), h('div.wl-logbox', this.logs));
    this.controls = h('div.wl-controls');
    this.body.append(
      h('div.kpis.wl-kpis', ...this.kpis.map((k) => k.el)),
      this.limit,
      h('div.wl-grid',
        h('div.col', { style: 'gap:.8rem;min-width:0' },
          this.chartCard = h('div.card.wl-chartcard', h('div.row', h('div.section-title.grow', { style: 'margin:0' }, icon('chart'), 'Production history'), scale.el), h('div.wl-chart', this.chart.el)),
          this.logsCard),
        h('div.card.wl-schemcard', h('div.section-title', icon('wells'), 'Schematic'), h('div.wl-schembox', this.schematic)),
        h('div.wl-side', this.controls)));
    this.update();
  }

  private xLabel(i: number): string {
    const w = this.w;
    const row = w?.history[i];
    return row ? dayLabel(this.ui.game.state, row[0]) : '';
  }

  private up(): UpInfo {
    return ((this.w as unknown as { up?: UpInfo })?.up ?? {}) as UpInfo;
  }

  // ---- status-specific controls ------------------------------------------------------------------
  private buildControls(w: WellState) {
    clear(this.controls);
    this.patchers = [];
    const s = w.status;
    const ctx = this.ui.game;
    const u = this.ui.units;
    const info = h('div.card', h('div.section-title', icon('info'), 'Well data'));
    const kv = h('div.kv');
    const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
    const wh = w.wellheadId ? ctx.state.buildings[w.wellheadId] : undefined;
    kv.append(
      h('span', 'Purpose'), h('span', titleCase(w.purpose)),
      h('span', 'Trajectory'), h('span', titleCase(w.plan.kind)),
      h('span', 'Location'), h('span', `${Math.round(w.x)}, ${Math.round(w.z)}${w.offshore ? ' · offshore' : ''}`),
      h('span', 'Spudded'), h('span', `Day ${w.spudDay}`),
      h('span', 'Cost to date'), h('span', money(w.cost)),
      h('span', 'Reservoirs'), h('span', w.penetrated.length ? w.penetrated.map((r) => ctx.geology.getReservoir(r)?.name ?? r).join(', ') : 'None found'));
    info.appendChild(kv);
    const links = h('div.row.wrap', { style: 'margin-top:.6rem' });
    if (rig) links.appendChild(button(buildingName(ctx.state, rig), { icon: 'rig', size: 'xs', onClick: () => this.ui.open('inspector', { buildingId: rig.id }, { stack: true }) }));
    if (wh) links.appendChild(button('Wellhead', { icon: 'wellhead', size: 'xs', onClick: () => this.ui.open('inspector', { buildingId: wh.id }, { stack: true }) }));
    if (links.childElementCount) info.appendChild(links);

    const card = h('div.card');
    if (['drilling', 'tripping', 'casing', 'kick', 'planned'].includes(s)) {
      card.appendChild(h('div.section-title', icon('rig'), 'Drilling'));
      const prog = bar(0, 'striped', 'thick');
      const progTxt = h('span.mono.small');
      const opTxt = h('div.small.dim');
      const bit = bar(0, 'ok');
      const bitTxt = h('span.mono.small');
      card.append(h('div.row.between', h('span.label', 'Depth (MD)'), progTxt), prog, opTxt, h('div.row.between', { style: 'margin-top:.6rem' }, h('span.label', 'Bit condition'), bitTxt), bit);
      if (s === 'planned') card.appendChild(h('div', { style: 'margin-top:.7rem' }, button('Spud well', { icon: 'play', variant: 'primary', block: true, onClick: () => {
        const r = this.ui.dispatch({ type: 'well/spud', wellId: this.wellId }, { successSound: 'success' });
        if (r.ok) this.ui.toast('success', `Spudded ${w.name}`, undefined, { icon: 'rig' });
      } })));
      this.patchers.push(() => {
        const x = this.w;
        if (!x) return;
        setBar(prog, x.measuredDepth / Math.max(1, x.plannedDepth));
        setText(progTxt, `${lengthBlocks(x.measuredDepth, u)} / ${lengthBlocks(x.plannedDepth, u)}`);
        const op = this.up().op;
        setText(opTxt, op?.label ? `${op.label}${op.hoursLeft !== undefined ? ` · ${op.hoursLeft.toFixed(1)} h left` : ''}` : x.status === 'tripping' ? 'Tripping pipe to change the bit' : x.status === 'casing' ? 'Running & cementing casing' : x.status === 'planned' ? 'Waiting to spud' : 'Making hole');
        setBar(bit, x.bitCondition / 100);
        bit.className = `bar ${x.bitCondition > 50 ? 'ok' : x.bitCondition > 20 ? 'warn' : 'danger'}`;
        setText(bitTxt, `${Math.round(x.bitCondition)}%`);
      });
      // mud weight
      const profile = ctx.services.wells.pressureProfile(w.x, w.z);
      const mw = h<HTMLCanvasElement>('canvas.wl-mud');
      const mwSlider: SliderCtl = slider({ min: 8.3, max: 18, step: 0.1, value: w.mudWeight, format: (v) => mudWeight(v, u), onInput: (v) => {
        const x = this.w;
        if (x) drawMudWindow(mw, profile, x.surfaceY, v, x.currentY, u, x.casing.map((c) => c.bottomY));
      }, onChange: (v) => this.ui.dispatch({ type: 'well/setMudWeight', wellId: this.wellId, mudWeight: v }, { successSound: 'click' }) });
      const mudCard = h('div.card',
        h('div.section-title', icon('gauge'), 'Mud weight window'),
        h('div.wl-mudbox', mw),
        h('div.wl-mudkey', h('span', h('i', { style: { background: '#4ea8ff' } }), 'Pore'), h('span', h('i', { style: { background: '#ff4d4f' } }), 'Fracture'), h('span', h('i', { style: { background: '#3ddc84' } }), 'Mud')),
        field('Mud weight', mwSlider.el),
        h('div.col', { style: 'margin-top:.5rem;gap:.3rem' }, button('Run casing now', { icon: 'pipe', size: 'sm', block: true, disabled: s !== 'drilling', onClick: () => this.ui.dispatch({ type: 'well/runCasing', wellId: this.wellId }, { successSound: 'success' }) }), h('span.tiny.dim', 'Sets and cements a casing string at the current depth.')));
      let mwSig = '';
      this.patchers.push(() => {
        const x = this.w;
        if (!x) return;
        mwSlider.set(x.mudWeight);
        const sig = `${x.mudWeight}|${x.currentY}|${x.casing.length}|${mw.clientWidth}`;
        if (sig !== mwSig) {
          mwSig = sig;
          drawMudWindow(mw, profile, x.surfaceY, mwSlider.value, x.currentY, u, x.casing.map((c) => c.bottomY));
        }
      });
      if (s === 'kick') this.controls.appendChild(this.kickCard(w));
      this.controls.append(card, mudCard, info);
      return;
    }
    if (s === 'blowout') {
      this.controls.append(this.blowoutCard(w), info);
      return;
    }
    if (s === 'drilled') {
      this.controls.append(this.completionCard(w), info);
      return;
    }
    if (s === 'completing' || s === 'fracking') {
      const prog = bar(0, 'striped', 'thick');
      const txt = h('div.small.dim');
      card.append(h('div.section-title', icon(s === 'fracking' ? 'frac' : 'wrench'), s === 'fracking' ? 'Hydraulic fracturing' : 'Completion'), prog, txt);
      this.patchers.push(() => {
        const op = this.up().op;
        setBar(prog, op?.hoursTotal ? 1 - (op.hoursLeft ?? 0) / op.hoursTotal : 0.5);
        setText(txt, op?.label ? `${op.label} · ${(op.hoursLeft ?? 0).toFixed(1)} h left` : s === 'fracking' ? `Pumping ${w.fracStages || ''} stages` : 'Perforating and running tubing');
      });
      this.controls.append(card, info);
      return;
    }
    if (['producing', 'shut_in', 'injecting'].includes(s)) {
      this.controls.append(this.productionCard(w), info);
      return;
    }
    // dry hole / plugged
    card.append(h('div.section-title', icon('ban'), s === 'dry_hole' ? 'Dry hole' : 'Plugged & abandoned'),
      h('p.small.dim', s === 'dry_hole' ? 'No commercial hydrocarbons were found. The well has been plugged. Use its logs to refine your geological model.' : 'This well is permanently abandoned with cement plugs.'));
    this.controls.append(card, info);
  }

  private kickCard(w: WellState): HTMLElement {
    const vol = h('b.mono');
    const hrs = h('span.small');
    const methods: { id: 'drillers' | 'wait_weight' | 'bullhead'; label: string; desc: string; icon: IconName; variant: 'primary' | 'teal' | 'danger' }[] = [
      { id: 'wait_weight', label: 'Wait & Weight', desc: 'Weight up mud with barite, then circulate. Safest; slower and uses barite.', icon: 'shield', variant: 'primary' },
      { id: 'drillers', label: "Driller's Method", desc: 'Circulate the influx out immediately, then weight up. Fast, moderate risk.', icon: 'refresh', variant: 'teal' },
      { id: 'bullhead', label: 'Bullhead', desc: 'Pump the influx back into the formation. Fastest; may fracture the rock.', icon: 'explosion', variant: 'danger' },
    ];
    const card = h('div.card.wl-urgent',
      h('div.row', h('div.wl-urgic', icon('warning')), h('div.col', { style: 'gap:0' }, h('b.wl-urgtitle', 'KICK — shut in & kill the well'), h('span.small', 'Influx ', vol, ' · ', hrs))),
      h('div.col', { style: 'gap:.4rem;margin-top:.6rem' }, methods.map((m) => h('button.wl-method', { type: 'button', onclick: () => {
        const r = this.ui.dispatch({ type: 'well/controlKick', wellId: w.id, method: m.id }, { successSound: 'success' });
        if (r.ok) this.ui.toast('info', `${m.label} started`, w.name, { icon: m.icon });
      } }, h(`span.wl-mic.${m.variant}`, icon(m.icon)), h('div.col', { style: 'gap:0;min-width:0' }, h('b', m.label), h('span.tiny.dim', m.desc))))));
    this.patchers.push(() => {
      const x = this.w;
      if (!x) return;
      setText(vol, `${int(x.kickVolume)} bbl`);
      const kh = this.up().kickHours;
      setText(hrs, kh !== undefined ? `${kh.toFixed(1)} h since detection — act before it escalates` : 'act before it escalates to a blowout');
    });
    return card;
  }

  private blowoutCard(w: WellState): HTMLElement {
    const flow = h('b.mono');
    const cap = bar(0, 'warn', 'thick');
    const capTxt = h('span.mono.small');
    const card = h('div.card.wl-urgent',
      h('div.row', h('div.wl-urgic', icon(w.blowout?.onFire ? 'fire' : 'explosion')), h('div.col', { style: 'gap:0' }, h('b.wl-urgtitle', w.blowout?.onFire ? 'BLOWOUT — WELL ON FIRE' : 'BLOWOUT — UNCONTROLLED FLOW'), h('span.small', 'Flowing ', flow))),
      h('div.row.between', { style: 'margin-top:.6rem' }, h('span.label', 'Control progress'), capTxt), cap,
      h('div.col', { style: 'gap:.4rem;margin-top:.6rem' },
        h('button.wl-method', { type: 'button', onclick: () => this.ui.dispatch({ type: 'well/capBlowout', wellId: w.id, method: 'cap' }, { successSound: 'success' }) }, h('span.wl-mic.primary', icon('shield')), h('div.col', { style: 'gap:0' }, h('b', 'Capping stack'), h('span.tiny.dim', 'Fire crews clear debris, then a capping stack is landed. Fast but can fail.'))),
        h('button.wl-method', { type: 'button', onclick: () => this.ui.dispatch({ type: 'well/capBlowout', wellId: w.id, method: 'relief_well' }, { successSound: 'success' }) }, h('span.wl-mic.teal', icon('rig')), h('div.col', { style: 'gap:0' }, h('b', 'Relief well'), h('span.tiny.dim', 'Drill an intersecting well and pump heavy mud. Slow, expensive, certain.')))));
    this.patchers.push(() => {
      const b = this.w?.blowout;
      setText(flow, b ? `${oilRate(b.flowRate, this.ui.units)}` : '—');
      setBar(cap, b?.capProgress ?? 0);
      setText(capTxt, pct(b?.capProgress ?? 0));
    });
    return card;
  }

  private completionCard(w: WellState): HTMLElement {
    const ctx = this.ui.game;
    const sel = new Set(w.penetrated);
    const resList = h('div.col', { style: 'gap:.3rem' });
    for (const r of w.penetrated) {
      const res = ctx.geology.getReservoir(r);
      const t = toggle(h('span', res?.name ?? r, h('span.tiny.dim', ` · ${res?.fluid ?? ''}`)), true, (v) => (v ? sel.add(r) : sel.delete(r)));
      resList.appendChild(t.el);
    }
    let stages = 8;
    const canFrac = ctx.hasTech('hydraulic_fracturing');
    const card = h('div.card',
      h('div.section-title', icon('flag'), 'Total depth reached'),
      w.penetrated.length ? h('div.small.dim', { style: 'margin-bottom:.4rem' }, 'Choose the reservoirs to perforate:') : h('div.banner.warn', icon('warning'), h('span', 'No hydrocarbon-bearing reservoirs were penetrated.')),
      resList,
      h('div.col', { style: 'gap:.4rem;margin-top:.7rem' },
        button('Complete well', { icon: 'check', variant: 'primary', block: true, disabled: !w.penetrated.length, onClick: () => {
          const r = this.ui.dispatch({ type: 'well/complete', wellId: w.id, reservoirIds: [...sel] }, { successSound: 'success' });
          if (r.ok) this.ui.toast('success', `Completing ${w.name}`, `${sel.size} zone(s) perforated`, { icon: 'wellhead' });
        } }),
        canFrac ? h('div.wl-frac', field(`Frac stages (${stages})`, slider({ min: 1, max: 40, step: 1, value: stages, format: (v) => `${v} stages`, onInput: (v) => (stages = v) }).el),
          button('Fracture stimulate', { icon: 'frac', variant: 'teal', block: true, onClick: () => this.ui.dispatch({ type: 'well/frac', wellId: w.id, stages }, { successSound: 'success' }) })) : h('div.tiny.dim', 'Research Hydraulic Fracturing to stimulate tight reservoirs.'),
        button('Plug & abandon', { icon: 'plug', variant: 'danger', block: true, onClick: () => this.plugDialog() })));
    return card;
  }

  private productionCard(w: WellState): HTMLElement {
    const ctx = this.ui.game;
    const u = this.ui.units;
    const chokeTxt = h('span.mono.small');
    const potential = h('span.small.dim');
    const choke = slider({ min: 0, max: 1, step: 0.01, value: w.choke, format: (v) => pct(v), onChange: (v) => this.ui.dispatch({ type: 'well/setChoke', wellId: w.id, choke: v }, { successSound: 'click' }) });
    const lift = segmented<LiftType>(LIFTS.map((l) => ({ value: l.id, label: l.label, disabled: !!l.tech && !ctx.hasTech(l.tech), title: l.tech && !ctx.hasTech(l.tech) ? `Requires research` : l.desc })), w.lift, (v) => this.ui.dispatch({ type: 'well/setLift', wellId: w.id, lift: v }, { successSound: 'success' }), 'wl-lift');
    const shut = toggle('Shut in', w.status === 'shut_in', (v) => this.ui.dispatch({ type: 'well/shutIn', wellId: w.id, shutIn: v }, { successSound: 'click' }), 'Stop flow at the wellhead');
    const convert = h('div.row.wrap', { style: 'gap:.3rem' }, CONVERSIONS.filter((c) => c.id !== w.purpose).map((c) => button(c.label, { size: 'xs', disabled: !!c.tech && !ctx.hasTech(c.tech), title: c.tech && !ctx.hasTech(c.tech) ? 'Requires research' : `Convert to ${c.label.toLowerCase()}`, onClick: async () => {
      const ok = await this.ui.confirm({ title: `Convert to ${c.label.toLowerCase()}?`, text: `${w.name} will stop producing and start injecting to support reservoir pressure.`, confirm: 'Convert', icon: 'inject' });
      if (ok) this.ui.dispatch({ type: 'well/convert', wellId: w.id, purpose: c.id }, { successSound: 'success' });
    } })));
    const card = h('div.card',
      h('div.section-title', icon('choke'), w.status === 'injecting' ? 'Injection control' : 'Production control'),
      field('Choke opening', choke.el), h('div.row.between', potential, chokeTxt),
      w.status !== 'injecting' ? field('Artificial lift', lift.el) : null,
      h('div', { style: 'margin-top:.6rem' }, shut.el),
      h('div.section-title', { style: 'margin-top:.9rem' }, icon('inject'), 'Convert'),
      convert,
      h('div', { style: 'margin-top:.8rem' }, button('Plug & abandon', { icon: 'plug', variant: 'danger', size: 'sm', block: true, onClick: () => this.plugDialog() })));
    this.patchers.push(() => {
      const x = this.w;
      if (!x) return;
      choke.set(x.choke);
      lift.set(x.lift);
      shut.set(x.status === 'shut_in');
      const up = this.up();
      setText(potential, up.potential ? `Potential ${oilRate(up.potential, u)}` : `BHP ${pressure(x.bhp, u)}`);
      setText(chokeTxt, `GOR ${int(x.gor)} scf/bbl`);
    });
    return card;
  }

  private async plugDialog() {
    const w = this.w;
    if (!w) return;
    const ok = await this.ui.confirm({ title: `Plug & abandon ${w.name}?`, text: 'Cement plugs are set and the wellhead removed. This cannot be undone.', confirm: 'Plug & abandon', danger: true, icon: 'plug' });
    if (ok) this.ui.dispatch({ type: 'well/plugAbandon', wellId: w.id }, { successSound: 'click' });
  }

  private renameDialog() {
    const w = this.w;
    if (!w) return;
    const input = h<HTMLInputElement>('input.input', { value: w.name, maxLength: 28 });
    this.ui.modal({
      title: 'Rename well', icon: 'edit', width: '24rem', body: field('Name', input),
      actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Rename', variant: 'primary', onClick: () => {
        const name = input.value.trim();
        if (!name) return false;
        return this.ui.dispatch({ type: 'well/rename', wellId: w.id, name }, { successSound: 'click' }).ok;
      } }],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') (input.closest('.pc-modal')?.querySelector('.md-actions .btn.primary') as HTMLButtonElement | null)?.click(); });
  }

  frame(dt: number) {
    this.t += dt;
    const w = this.w;
    if (!w || !this.schematic) return;
    const drilling = ['drilling', 'tripping', 'kick', 'casing'].includes(w.status);
    const sig = `${w.trajectory.length}|${w.casing.length}|${w.completedReservoirs.length}|${w.status}|${this.schematic.clientWidth}x${this.schematic.clientHeight}|${this.ui.units}`;
    if (sig !== this.schemSig || drilling) {
      this.schemSig = sig;
      drawWellSchematic(this.schematic, this.ui.game.geology, w, { units: this.ui.units, planned: w.trajectory.length < 3 || drilling ? this.planned(w) : undefined, t: this.t });
    }
  }

  private plannedCache: { key: string; pts: WellState['trajectory'] } | null = null;
  private planned(w: WellState) {
    const key = `${w.id}|${JSON.stringify(w.plan)}`;
    if (this.plannedCache?.key !== key) {
      let pts: WellState['trajectory'] = [];
      try {
        pts = this.ui.game.services.wells.planTrajectory(w.x, w.surfaceY, w.z, w.plan);
      } catch {
        pts = [];
      }
      this.plannedCache = { key, pts };
    }
    return this.plannedCache.pts;
  }

  update() {
    const w = this.w;
    if (!w) return;
    const u = this.ui.units;
    this.setTitle(w.name);
    this.setSubtitle(`${titleCase(w.purpose)} · ${titleCase(w.plan.kind)} · ${w.offshore ? 'Offshore' : 'Onshore'} · spud day ${w.spudDay}`);
    this.chip?.set(w.status);
    const [kO, kG, kW, kC, kP, kD] = this.kpis;
    const inj = w.rates.water < 0 || w.rates.gas < 0;
    kO.set(oilRate(Math.max(0, w.rates.oil), u), w.status === 'producing' ? `choke ${pct(w.choke)} · ${titleCase(w.lift)}` : titleCase(w.status));
    kG.set(gasRate(Math.abs(w.rates.gas), u), w.rates.gas < 0 ? 'injecting' : `GOR ${int(w.gor)}`);
    kW.set(oilRate(Math.abs(w.rates.water), u), inj ? 'injecting' : `water cut ${pct(w.waterCut)}`, w.waterCut > 0.8 ? 'warn' : '');
    kC.set(qty(w.cumulative.oil, 'bbl', u), `${qty(w.cumulative.gas, 'mcf', u)} gas`);
    const res = w.completedReservoirs[0] ?? w.penetrated[0];
    const rp = res ? this.ui.game.state.reservoirs[res]?.pressure : undefined;
    kP.set(pressure(w.bhp || rp || 0, u), rp ? `reservoir ${pressure(rp, u)}` : 'bottom-hole');
    kD.set(lengthBlocks(wellTvd(w), u), `MD ${lengthBlocks(w.measuredDepth, u)}`);
    const up = this.up();
    toggleClass(this.limit, 'hidden', !up.limit && !up.lostCirc);
    setText(this.limit.lastElementChild, up.lostCirc ? 'Lost circulation — mud weight exceeds the fracture gradient. Lower the mud weight.' : up.limit ?? '');
    // chart (hidden until the well has produced)
    const hist = w.history;
    toggleClass(this.chartCard, 'hidden', hist.length === 0 && !['producing', 'shut_in', 'injecting'].includes(w.status));
    this.chart.setData([
      { name: 'Oil (bbl/d)', color: '#ff9f43', data: hist.map((r) => r[1]), fill: true, format: (v) => oilRate(v, u) },
      { name: 'Gas (mcf/d)', color: '#6fc3ff', data: hist.map((r) => r[2]), format: (v) => gasRate(v, u) },
      { name: 'Water (bbl/d)', color: '#3f8fd8', data: hist.map((r) => r[3]), dashed: true, format: (v) => oilRate(v, u) },
    ], `${hist.length}|${hist[hist.length - 1]?.[0]}|${u}`);
    // logs
    const lsig = `${w.log.length}|${this.logs.clientWidth}x${this.logs.clientHeight}|${u}`;
    if (lsig !== this.logSig) {
      this.logSig = lsig;
      const drawn = drawLogTracks(this.logs, w, u);
      toggleClass(this.logsCard, 'nolog', !drawn);
    }
    // controls
    const csig = `${w.status}|${w.penetrated.join(',')}|${w.purpose}`;
    if (csig !== this.controlsSig) {
      this.controlsSig = csig;
      this.buildControls(w);
    }
    for (const p of this.patchers) p();
  }

  destroy() {
    this.chart?.destroy();
  }
}

