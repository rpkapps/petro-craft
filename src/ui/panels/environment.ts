// Environment: licence-to-operate gauge & trend, emissions/flaring/venting, spills, fines, violations,
// suspension state, carbon credits and recent incidents.
import { h, clear, setText, setBar, bar, toggleClass, KeyedList } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, emptyState, kpi, type KpiCtl } from '../core/components';
import { gauge, sparkline, type GaugeCtl, type SparkCtl } from '../charts/mini';
import type { GameState, Spill } from '../../core/types';
import { dayLabel, gasRate, int, money, qty, titleCase } from '../format';

const scoreHistory = new WeakMap<GameState, { day: number; values: number[] }>();
/** Client-side daily record of the environment score (the sim keeps only the current value). */
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
  private trend!: SparkCtl;
  private trendTxt!: HTMLElement;
  private violations!: HTMLElement;
  private banner!: HTMLElement;
  private k: KpiCtl[] = [];
  private spills!: KeyedList<Spill>;
  private spillEmpty!: HTMLElement;
  private incidents!: HTMLElement;
  private incSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Environment & Safety', 'leaf', 'lg');
  }

  protected build() {
    this.g = gauge(150, 12);
    this.standingEl = h('div.env-standing');
    this.trend = sparkline(220, 46, '#3ddc84');
    this.trendTxt = h('div.small.dim');
    this.violations = h('div.env-viol');
    this.banner = h('div.banner.hidden', icon('ban'), h('span'));
    const names: [string, IconName, string][] = [['Emissions today', 'co2', '#94a3b8'], ['Flared today', 'flare', '#ff8a1f'], ['Vented today', 'wind', '#ff4d4f'], ['Total emissions', 'globe', '#a78bfa'], ['Fines paid', 'bank', '#ff6a6a'], ['Carbon credits', 'leaf', '#3ddc84']];
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
          h('div.card', h('div.section-title', icon('trend-up'), 'Score trend'), h('div.row', this.trend.el, this.trendTxt)),
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
    const hist = trackEnvironment(st);
    this.trend.set(hist.length > 1 ? hist : [hist[0], hist[0]], color);
    const delta = hist.length > 1 ? hist[hist.length - 1] - hist[hist.length - 2] : 0;
    setText(this.trendTxt, hist.length > 1 ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} since yesterday` : 'Tracking since this session started');
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
}
