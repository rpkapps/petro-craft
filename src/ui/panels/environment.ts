// Environment: licence-to-operate gauge & trend, emissions/flaring/venting, spills, fines, violations,
// suspension state, carbon credits and recent incidents.
import { h, clear, setText, setBar, bar, toggleClass, KeyedList } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, emptyState, kpi, segmented, type KpiCtl } from '../core/components';
import { gauge, type GaugeCtl } from '../charts/mini';
import { LineChart } from '../charts/LineChart';
import type { GameState, Spill } from '../../core/types';
import { dayLabel, gasRate, int, money, qty, titleCase } from '../format';

const scoreHistory = new WeakMap<GameState, { day: number; values: number[] }>();
/** Session-only daily record of the environment score — fallback for saves without `environment.history`. */
export function trackEnvironment(st: GameState) {
  let hs = scoreHistory.get(st);
  if (!hs) {
    hs = { day: st.time.day, values: [st.environment.score] };
    scoreHistory.set(st, hs);
  }
  if (st.time.day !== hs.day) {
    hs.day = st.time.day;
    hs.values.push(st.environment.score);
    if (hs.values.length > 120) hs.values.shift();
  } else hs.values[hs.values.length - 1] = st.environment.score;
  return hs.values;
}

type Range = '30' | '90' | '365';
let lastRange: Range = '90';

/** Daily score series ending today (persisted history + the live score), or the session samples as a fallback. */
function scoreSeries(st: GameState): { values: number[]; persisted: boolean } {
  const env = st.environment;
  if (env.history && env.history.length) return { values: [...env.history, env.score], persisted: true };
  return { values: trackEnvironment(st).slice(), persisted: false };
}

const INCIDENT_ICON: Record<string, IconName> = { fire: 'fire', blowout: 'explosion', explosion: 'explosion', spill: 'spill', failure: 'wrench', injury: 'medkit', leak: 'pipe', lightning: 'storm', h2s: 'skull' };

function standing(score: number): [string, string] {
  if (score >= 80) return ['Exemplary', '#3ddc84'];
  if (score >= 65) return ['Good standing', '#8be08a'];
  if (score >= 45) return ['Under scrutiny', '#ffc233'];
  if (score >= 25) return ['Hostile community', '#ff8a4f'];
  return ['Licence at risk', '#ff4d4f'];
}

export class EnvironmentPanel extends Panel {
  readonly id = 'environment' as const;
  private g!: GaugeCtl;
  private standingEl!: HTMLElement;
  private trend!: LineChart;
  private trendTxt!: HTMLElement;
  private range: Range = lastRange;
  private shownDays = 0;
  private violations!: HTMLElement;
  private banner!: HTMLElement;
  private k: KpiCtl[] = [];
  private spills!: KeyedList<Spill>;
  private spillEmpty!: HTMLElement;
  private incidents!: HTMLElement;
  private incSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Environment & Safety', 'leaf', 'lg');
    this.el.classList.add('auto-h');
  }

  protected build() {
    this.g = gauge(150, 12);
    this.standingEl = h('div.env-standing');
    this.trend = new LineChart({
      xLabel: (i) => dayLabel(this.ui.game.state, this.ui.game.state.time.day - (this.shownDays - 1 - i)),
      yFormat: (v) => String(Math.round(v)),
      yMin: 0,
      yMax: 100,
      padTop: 8,
      emptyText: 'Score history starts after the first day',
      refLines: [{ value: 65, color: 'rgba(61,220,132,0.5)', label: 'Good standing' }, { value: 25, color: 'rgba(255,77,79,0.55)', label: 'Licence at risk' }],
    }, 'env-chart');
    this.trendTxt = h('div.tiny.dim.env-trendtxt');
    const rangeSeg = segmented<Range>([{ value: '30', label: '30D' }, { value: '90', label: '90D' }, { value: '365', label: '1Y' }], this.range, (v) => {
      this.ui.sound('click');
      this.range = v;
      lastRange = v;
      this.update();
    });
    this.violations = h('div.env-viol');
    this.banner = h('div.banner.hidden', icon('ban'), h('span'));
    const names: [string, IconName, string][] = [['Emitted today', 'co2', '#94a3b8'], ['Flared today', 'flare', '#ff8a1f'], ['Vented today', 'wind', '#ff4d4f'], ['Lifetime CO₂', 'globe', '#a78bfa'], ['Fines paid', 'bank', '#ff6a6a'], ['Credits', 'leaf', '#3ddc84']];
    this.k = names.map(([n, i, c]) => kpi(n, i, c));
    const spillBox = h('div.col', { style: 'gap:.4rem' });
    this.spills = new KeyedList<Spill>(spillBox, (s) => s.id, (s0) => {
      let s = s0;
      const pb = bar(0, 'teal');
      const txt = h('span.mono.small');
      const node = h('div.env-spill',
        h(`div.env-sic.${s.kind}`, icon(s.kind === 'oil' ? 'spill' : s.kind === 'water' ? 'water' : 'flask')),
        h('div.col.grow', { style: 'gap:.2rem;min-width:0' }, h('div.row', h('b', `${titleCase(s.kind)} spill`), h('span.tiny.dim', `· ${dayLabel(this.ui.game.state, s.day)} · ${Math.round(s.x)}, ${Math.round(s.z)}`), h('span.sp'), txt), pb),
        button(null, { icon: 'map', size: 'xs', title: 'Show on map', onClick: () => this.ui.open('map', { at: { x: s.x, z: s.z } }, { stack: true }) }));
      return { node, update: (x) => { s = x; setBar(pb, x.cleaned / Math.max(1, x.volume)); setText(txt, `${qty(x.cleaned, 'bbl', this.ui.units)} / ${qty(x.volume, 'bbl', this.ui.units)} cleaned`); } };
    });
    this.spillEmpty = emptyState('check', 'No spills on record');
    this.incidents = h('div.col', { style: 'gap:.3rem' });
    this.body.append(
      this.banner,
      h('div.env-top',
        h('div.card.env-gaugecard', this.g.el, this.standingEl, this.violations),
        h('div.col.grow', { style: 'gap:.6rem;min-width:0' },
          h('div.card.env-trendcard',
            h('div.row.env-trendhead', h('div.section-title', icon('trend-up'), 'Score trend'), rangeSeg.el),
            h('div.env-chartbox', this.trend.el),
            this.trendTxt),
          h('div.kpis', ...this.k.map((x) => x.el)))),
      h('div.grid2', { style: 'margin-top:.8rem' },
        h('div.card', h('div.section-title', icon('spill'), 'Spills'), spillBox, this.spillEmpty),
        h('div.card', h('div.section-title', icon('warning'), 'Recent incidents'), this.incidents)),
      h('div.card.env-tips', { style: 'margin-top:.8rem' },
        h('div.section-title', icon('bulb'), 'Improving your standing'),
        h('div.env-tipgrid',
          h('div', icon('flare'), h('span', 'Connect wellhead gas to pipelines or flare stacks — never vent.')),
          h('div', icon('spill'), h('span', 'Spill Response bases clean spills fast and reduce fines.')),
          h('div', icon('co2'), h('span', 'Carbon capture and renewables cut emissions and earn credits.')),
          h('div', icon('shield'), h('span', 'Safety research reduces fires, blowouts and accidents.')))));
  }

  update() {
    const st = this.ui.game.state;
    const env = st.environment;
    const u = this.ui.units;
    const [label, color] = standing(env.score);
    this.g.set(env.score / 100, String(Math.round(env.score)), color);
    setText(this.standingEl, label);
    this.standingEl.style.color = color;
    const { values, persisted } = scoreSeries(st);
    const n = Math.min(values.length, Number(this.range));
    const shown = values.slice(values.length - n);
    this.shownDays = shown.length;
    this.trend.setData([{ name: 'Score', color, data: shown, fill: true, format: (v) => v.toFixed(1) }], `${this.range}|${values.length}|${values[values.length - 1]}|${values[0]}|${color}`);
    const dayDelta = values.length > 1 ? values[values.length - 1] - values[values.length - 2] : 0;
    const rangeDelta = shown.length > 1 ? shown[shown.length - 1] - shown[0] : 0;
    const sgn = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    setText(this.trendTxt, values.length > 1
      ? `${sgn(dayDelta)} since yesterday · ${sgn(rangeDelta)} over ${shown.length - 1} day${shown.length === 2 ? '' : 's'}${persisted ? '' : ' (this session)'}`
      : persisted ? 'Daily scores are recorded at the end of each day' : 'Tracking since this session started');
    const vk = `${env.violations}`;
    if (this.violations.dataset.k !== vk) {
      this.violations.dataset.k = vk;
      clear(this.violations);
      this.violations.append(h('span.label', 'Violations'), h('div.env-pips', [0, 1, 2].map((i) => h(`i${i < env.violations ? '.on' : ''}`))), h('span.tiny.dim', '3 → suspension'));
    }
    const suspended = !!env.suspendedUntilDay && env.suspendedUntilDay > st.time.day;
    toggleClass(this.banner, 'hidden', !suspended);
    if (suspended) setText(this.banner.lastElementChild, `Operations suspended by the regulator until day ${env.suspendedUntilDay} (${env.suspendedUntilDay! - st.time.day} days). Production and drilling are halted.`);
    const [kE, kF, kV, kT, kFi, kC] = this.k;
    kE.set(`${int(env.emissionsToday)} t`, 'CO₂ equivalent');
    kF.set(gasRate(env.flaredToday, u).replace('/d', ''), 'burned safely');
    kV.set(gasRate(env.ventedToday, u).replace('/d', ''), env.ventedToday > 0 ? 'methane released!' : 'none', env.ventedToday > 0 ? 'danger' : '');
    kT.set(`${int(env.emissionsTotal)} t`, 'since founding');
    kFi.set(money(env.finesTotal), `${env.violations} active violation(s)`);
    kC.set(int(env.carbonCredits), 'tradeable credits');
    const spills = [...env.spills].sort((a, b) => b.day - a.day);
    this.spills.sync(spills);
    toggleClass(this.spillEmpty, 'hidden', spills.length > 0);
    const inc = st.hazards.incidents.slice(-12).reverse();
    const isig = inc.map((i) => `${i.day}${i.text}`).join('|');
    if (isig !== this.incSig) {
      this.incSig = isig;
      clear(this.incidents);
      if (!inc.length) this.incidents.appendChild(emptyState('shield', 'No incidents', `${st.hazards.daysSinceIncident} days without an incident`));
      for (const i of inc) this.incidents.appendChild(h('div.env-inc', icon(INCIDENT_ICON[i.kind] ?? 'warning'), h('span.grow', i.text), h('span.tiny.dim.mono', dayLabel(st, i.day))));
    }
  }

  destroy() {
    this.trend.destroy();
  }
}
