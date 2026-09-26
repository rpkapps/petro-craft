// HUD overlays: crosshair + target tooltip, build/pipe mode strips, x-ray indicator, scanner readout,
// and the critical-alert banner.
import { h, setText, toggleClass, clear } from '../dom';
import { icon, buildingIcon, type IconName } from '../icons';
import { BUILDINGS } from '../../content/buildings';
import { BLOCKS } from '../../core/blocks';
import type { GameContext, Vec3 } from '../../core/types';
import type { GameEvents, MapOverlay } from '../../core/EventBus';
import type { UIHost } from '../core/host';
import { statusChip, type ChipCtl } from '../core/components';
import { buildingName } from '../game';
import { money, oilRate, gasRate, pct, keyLabel, itemQty } from '../format';
import { rotatedSize } from '../../core/buildingUtil';

// ---- crosshair & target --------------------------------------------------------------------------
export class TargetInfo {
  readonly el: HTMLElement;
  private card: HTMLElement;
  private title: HTMLElement;
  private chipHolder: HTMLElement;
  private chip: ChipCtl | null = null;
  private chipKind = '';
  private stat: HTMLElement;
  private hint: HTMLElement;
  private ic: HTMLElement;
  private target: GameEvents['player:target'] = { kind: 'none' };

  constructor(private ui: UIHost, private ctx: GameContext) {
    this.title = h('div.tg-title.ellipsis');
    this.chipHolder = h('span');
    this.stat = h('div.tg-stat.mono');
    this.hint = h('div.tg-hint');
    this.ic = h('div.tg-ic');
    this.card = h('div.tg-card', this.ic, h('div.col.grow', { style: 'gap:.15rem' }, h('div.row', { style: 'gap:.45rem' }, this.title, this.chipHolder), this.stat, this.hint));
    const cross = h('div.pc-crosshair', h('i.ch-h'), h('i.ch-v'), h('i.ch-dot'));
    this.el = h('div.pc-target', cross, this.card);
  }

  set(t: GameEvents['player:target']) {
    this.target = t;
    this.update();
  }

  update() {
    const t = this.target;
    const st = this.ctx.state;
    let show = false;
    if (t.kind === 'building' && t.id && st.buildings[t.id]) {
      const b = st.buildings[t.id];
      show = true;
      this.setIcon(buildingIcon(b.type));
      setText(this.title, buildingName(st, b));
      this.setChip('building', b.status);
      setText(this.stat, buildingStat(this.ctx, b.id, this.ui.units));
      setText(this.hint, 'RMB · Inspect');
    } else if (t.kind === 'well' && t.id && st.wells[t.id]) {
      const w = st.wells[t.id];
      show = true;
      this.setIcon('wellhead');
      setText(this.title, w.name);
      this.setChip('well', w.status);
      setText(this.stat, w.status === 'producing' ? `${oilRate(w.rates.oil, this.ui.units)} · ${gasRate(w.rates.gas, this.ui.units)}` : `MD ${Math.round(w.measuredDepth)} / ${Math.round(w.plannedDepth)} blk`);
      setText(this.hint, 'RMB · Well details');
    } else if (t.kind === 'block' && t.block !== undefined && t.block > 1) {
      const def = BLOCKS[t.block];
      show = !!def;
      this.setIcon(def?.pipe ? 'pipe' : 'cube');
      setText(this.title, def?.name ?? 'Block');
      this.setChip('', '');
      setText(this.stat, def?.hydrocarbon ? `Hydrocarbon-bearing (${def.hydrocarbon})` : def?.rock ? 'Rock' : '');
      setText(this.hint, '');
    }
    toggleClass(this.card, 'show', show);
  }

  private setIcon(name: IconName) {
    if (this.ic.dataset.ic === name) return;
    this.ic.dataset.ic = name;
    this.ic.replaceChildren(icon(name));
  }

  private setChip(kind: '' | 'building' | 'well', status: string) {
    if (!kind) {
      clear(this.chipHolder);
      this.chip = null;
      this.chipKind = '';
      return;
    }
    if (!this.chip || this.chipKind !== kind) {
      this.chip = statusChip(kind, status);
      this.chipKind = kind;
      this.chipHolder.replaceChildren(this.chip.el);
    }
    this.chip.set(status);
  }
}

/** One-line key stat for a building shown in tooltips. */
export function buildingStat(ctx: GameContext, id: string, units: 'imperial' | 'metric'): string {
  const st = ctx.state;
  const b = st.buildings[id];
  if (!b) return '';
  if (b.constructionProgress < 1) return `Construction ${pct(b.constructionProgress)}`;
  if (b.status === 'fire') return `FIRE · intensity ${pct(b.fire)}`;
  if (b.type === 'wellhead' && b.wellId && st.wells[b.wellId]) {
    const w = st.wells[b.wellId];
    return `${oilRate(w.rates.oil, units)} · ${gasRate(w.rates.gas, units)} · WC ${pct(w.waterCut)}`;
  }
  if (b.wellId && st.wells[b.wellId]) {
    const w = st.wells[b.wellId];
    return `${w.name} · ${Math.round((w.measuredDepth / Math.max(1, w.plannedDepth)) * 100)}% drilled`;
  }
  const def = BUILDINGS[b.type];
  if (def?.power && def.power < 0) return `${Math.abs(def.power * b.utilization).toFixed(1)} MW generated`;
  const stored = Object.entries(b.storage).filter(([, v]) => v > 0.5).sort((a, c) => c[1] - a[1])[0];
  if (stored) return `${itemQty(stored[0], stored[1], units)} stored · ${pct(b.utilization)} util.`;
  return `Condition ${Math.round(b.condition)}% · ${pct(b.utilization)} util.`;
}

// ---- build / pipe mode strip ------------------------------------------------------------------
export class ModeStrip {
  readonly el: HTMLElement;
  private build: string | null = null;
  private pipe: number | null = null;
  private overlay: MapOverlay | null = null;
  private main: HTMLElement;
  private xray: HTMLElement;

  constructor(private ui: UIHost, private ctx: GameContext) {
    this.main = h('div.ms-strip.glass.flat');
    this.xray = h('div.ms-xray', icon('xray'), h('span', 'X-Ray View'), h('span.kbd', keyLabel(ui.app.settings.keybinds.xray)));
    this.el = h('div.pc-modestrip', this.xray, this.main);
    this.render();
  }

  setBuild(type: string | null) {
    this.build = type;
    if (type) this.pipe = null;
    this.render();
  }
  setPipe(block: number | null) {
    this.pipe = block;
    if (block !== null) this.build = null;
    this.render();
  }
  setOverlay(o: MapOverlay | null) {
    this.overlay = o;
    this.render();
  }

  private render() {
    clear(this.main);
    const kb = this.ui.app.settings.keybinds;
    const hints = (items: [string, string][]) => h('div.ms-hints', items.map(([k, t]) => h('span.ms-hint', h('span.kbd', k), t)));
    if (this.build && BUILDINGS[this.build]) {
      const d = BUILDINGS[this.build];
      const [w, dd] = rotatedSize(this.build, 0);
      const afford = this.ctx.state.company.money >= d.cost || this.ctx.state.meta.rules.creative;
      this.main.append(
        h('div.ms-ic', icon(buildingIcon(d.id))),
        h('div.col', { style: 'gap:0' }, h('div.ms-title', d.name), h('div.ms-sub', h('span', { class: afford ? 'accent' : 'danger' }, money(d.cost)), ` · ${w}×${dd} · ${d.power > 0 ? `−${d.power} MW` : d.power < 0 ? `+${-d.power} MW` : 'no power'}`)),
        hints([[keyLabel(kb.rotate), 'Rotate'], ['LMB', 'Place'], ['Shift', 'Keep'], ['RMB', 'Cancel']]),
      );
    } else if (this.pipe !== null) {
      const def = BLOCKS[this.pipe];
      this.main.append(
        h('div.ms-ic', icon(def?.pipe ? 'pipe' : 'cube')),
        h('div.col', { style: 'gap:0' }, h('div.ms-title', def?.name ?? 'Line'), h('div.ms-sub', 'Line placement mode')),
        hints([['LMB', 'Start / end'], ['Shift', 'Keep'], ['RMB', 'Cancel']]),
      );
    }
    toggleClass(this.main, 'show', !!this.build || this.pipe !== null);
    toggleClass(this.xray, 'show', !!this.overlay && this.overlay !== 'none');
    if (this.overlay && this.overlay !== 'none') setText(this.xray.children[1], this.overlay === 'xray' ? 'X-Ray View' : `${this.overlay[0].toUpperCase()}${this.overlay.slice(1)} Overlay`);
  }
}

// ---- scanner / detector readout ---------------------------------------------------------------
export class ScanCard {
  readonly el: HTMLElement;
  private ttl = 0;
  constructor() {
    this.el = h('div.pc-scan.glass.flat');
  }
  show(p: GameEvents['player:scan']) {
    clear(this.el);
    const ic: IconName = p.tool.includes('detector') ? 'detector' : 'scanner';
    this.el.className = `pc-scan glass flat show ${p.level ?? 'info'}`;
    this.el.append(
      h('div.sc-head', icon(ic), h('span', p.tool.includes('detector') ? 'Gas Detector' : 'Geo Scanner'), h('span.sp'), h('span.mono.dim', `${Math.floor(p.at.x)}, ${Math.floor(p.at.y)}, ${Math.floor(p.at.z)}`)),
      h('div.sc-lines', p.lines.map((l) => h('div.sc-line', l))),
      h('div.sc-scan'),
    );
    this.ttl = 9;
  }
  update(dt: number) {
    if (this.ttl > 0) {
      this.ttl -= dt;
      if (this.ttl <= 0) this.el.classList.remove('show');
    }
  }
}

// ---- critical alert banner ---------------------------------------------------------------------
interface Alert { key: string; level: 'danger' | 'warn'; icon: IconName; title: string; text: string; action: () => void; at?: Vec3 }

export class AlertBanner {
  readonly el: HTMLElement;
  private current = '';
  constructor(private ui: UIHost, private ctx: GameContext) {
    this.el = h('div.pc-alert');
  }

  update() {
    const st = this.ctx.state;
    const alerts: Alert[] = [];
    for (const w of Object.values(st.wells)) {
      if (w.status === 'blowout') alerts.push({ key: `bo${w.id}`, level: 'danger', icon: 'explosion', title: `Blowout — ${w.name}`, text: w.blowout?.onFire ? 'Well is on fire. Cap it or drill a relief well.' : 'Uncontrolled flow. Respond immediately.', action: () => this.ui.open('well', { wellId: w.id }), at: { x: w.x, y: w.surfaceY, z: w.z } });
      else if (w.status === 'kick') alerts.push({ key: `k${w.id}`, level: 'danger', icon: 'warning', title: `Kick detected — ${w.name}`, text: `${Math.round(w.kickVolume)} bbl influx. Choose a well-control method.`, action: () => this.ui.open('well', { wellId: w.id }) });
    }
    const fires = st.hazards.fires;
    if (fires.length) {
      const f = fires[0];
      const b = f.buildingId ? st.buildings[f.buildingId] : undefined;
      alerts.push({ key: `f${fires.length}`, level: 'danger', icon: 'fire', title: fires.length > 1 ? `${fires.length} active fires` : `Fire — ${b ? buildingName(st, b) : 'grass fire'}`, text: 'Send firefighters or use an extinguisher.', action: () => (b ? this.ui.open('inspector', { buildingId: b.id }) : this.ui.open('map')) });
    }
    const env = st.environment;
    if (env.suspendedUntilDay && env.suspendedUntilDay > st.time.day) alerts.push({ key: 'susp', level: 'warn', icon: 'ban', title: 'Operations suspended by regulator', text: `Until day ${env.suspendedUntilDay}. Improve your environmental record.`, action: () => this.ui.open('environment') });
    else if (st.company.money < 0) alerts.push({ key: 'debt', level: 'warn', icon: 'bank', title: 'Company overdrawn', text: 'Negative cash balance — sell product or take a loan.', action: () => this.ui.open('finance') });
    const a = alerts[0];
    const key = a ? `${a.key}|${a.title}|${a.text}|${alerts.length}` : '';
    if (key === this.current) return;
    this.current = key;
    clear(this.el);
    toggleClass(this.el, 'show', !!a);
    if (!a) return;
    this.el.className = `pc-alert show ${a.level}`;
    const btn = h('button.al-box', { type: 'button' },
      h('div.al-ic', icon(a.icon)),
      h('div.col', { style: 'gap:0' }, h('div.al-title', a.title), h('div.al-text', a.text)),
      alerts.length > 1 ? h('span.al-more', `+${alerts.length - 1}`) : null,
      h('span.al-go', 'Respond', icon('chevron-right')));
    btn.addEventListener('click', () => {
      this.ui.sound('open');
      a.action();
    });
    this.el.appendChild(btn);
  }
}
