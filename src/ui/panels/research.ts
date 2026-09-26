// Research (T): technology tree graph (branches × tiers) with SVG prerequisite connectors, node states,
// progress ring, selection details (modifiers in plain language, unlocks) and start/queue actions.
import { h, s, clear, setText, toggleClass, setAttr, bar, setBar } from '../dom';
import { icon, buildingIcon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip } from '../core/components';
import { TECHS, TECH_BRANCHES, type ModifierKey, type TechBranch, type TechDef } from '../../content/tech';
import { BUILDINGS } from '../../content/buildings';
import { techStatus, type TechStatus } from '../game';
import { roman, int, titleCase, fixed } from '../format';
import { ring, type RingCtl } from '../charts/mini';
import { researchEta } from '../../sim/economy';

const BRANCH_INFO: Record<TechBranch, { label: string; icon: IconName; color: string }> = {
  exploration: { label: 'Exploration', icon: 'seismic', color: '#2ad0e0' }, drilling: { label: 'Drilling', icon: 'rig', color: '#ff8a1f' },
  production: { label: 'Production', icon: 'pumpjack', color: '#ffb35c' }, midstream: { label: 'Midstream', icon: 'pipe', color: '#a78bfa' },
  refining: { label: 'Refining', icon: 'refinery', color: '#ff6a6a' }, petrochem: { label: 'Petrochem', icon: 'flask', color: '#f472b6' },
  safety: { label: 'Safety', icon: 'shield', color: '#ffc233' }, environment: { label: 'Environment', icon: 'leaf', color: '#3ddc84' },
  automation: { label: 'Automation', icon: 'chip', color: '#60a5fa' }, offshore: { label: 'Offshore', icon: 'platform', color: '#38bdf8' },
  management: { label: 'Management', icon: 'building', color: '#cbd5e1' },
};

const MOD_TEXT: Record<ModifierKey, [string, boolean]> = {
  seismic_resolution: ['seismic resolution', true], seismic_cost: ['seismic survey cost', false], seismic_speed: ['seismic acquisition speed', true],
  drill_speed: ['drilling speed', true], bit_life: ['bit life', true], kick_risk: ['kick risk', false], drill_cost: ['drilling cost', false],
  max_depth: ['maximum well depth', true], max_lateral: ['maximum lateral length', true], production_rate: ['production rates', true],
  recovery_factor: ['recovery factor', true], decline_rate: ['production decline', false], lift_efficiency: ['artificial-lift efficiency', true],
  water_cut: ['water cut', false], pipeline_capacity: ['pipeline capacity', true], compressor_efficiency: ['compressor efficiency', true],
  storage_capacity: ['storage capacity', true], transport_cost: ['transport cost', false], refinery_yield: ['refinery yields', true],
  process_speed: ['processing speed', true], petrochem_yield: ['petrochemical yields', true], failure_rate: ['equipment failure rate', false],
  fire_spread: ['fire spread', false], blowout_risk: ['blowout risk', false], accident_rate: ['accident rate', false], repair_speed: ['repair speed', true],
  emissions: ['emissions', false], spill_risk: ['spill risk', false], flare_emissions: ['flaring emissions', false], water_treatment: ['water treatment capacity', true],
  worker_efficiency: ['worker efficiency', true], wages: ['wages', false], research_speed: ['research speed', true], construction_speed: ['construction speed', true],
  construction_cost: ['construction cost', false], sale_price: ['sale prices', true], power_efficiency: ['power efficiency', true], offshore_depth: ['offshore water depth', true],
};
const FEATURE_TEXT: Record<string, string> = {
  survey_2d: '2D seismic surveys', survey_3d: '3D seismic surveys', seismic_fluid: 'Seismic fluid indicators', seismic_4d: '4D time-lapse monitoring',
  well_logs: 'Wireline logs on every well', directional: 'Directional wells', horizontal: 'Horizontal wells', lift_pumpjack: 'Pumpjack lift',
  lift_esp: 'ESP lift', lift_gaslift: 'Gas lift', fracking: 'Hydraulic fracturing', injector_water: 'Water injectors', injector_co2: 'CO₂ injectors',
  telemetry: 'Remote telemetry & alerts', auto_choke: 'Automatic choke control', auto_shutin: 'Automatic hazard shut-in', auto_repair: 'Automatic drone repairs',
  hedging: 'Price hedging', premium_contracts: 'Premium contracts',
};

export function modifierLines(t: TechDef): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  for (const [k, v] of Object.entries(t.modifiers ?? {}) as [ModifierKey, number][]) {
    const [label, higherBetter] = MOD_TEXT[k] ?? [titleCase(k), true];
    if (v === 1) continue;
    const pct = Math.round((v - 1) * 100);
    const good = higherBetter ? v > 1 : v < 1;
    out.push({ text: v >= 1.95 ? `${fixed(v, 1)}× ${label}` : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% ${label}`, good });
  }
  return out;
}

const NODE_W = 11.6;
const NODE_H = 3.7;
const COL_GAP = 3.4;
const ROW_H = 4.5;
const BAND_PAD = 0.7;
const LABEL_W = 8.4;
const HEAD_H = 2.2;

interface NodeView { t: TechDef; el: HTMLElement; ring: RingCtl; state: HTMLElement; x: number; y: number }

export class ResearchPanel extends Panel {
  readonly id = 'research' as const;
  private nodes = new Map<string, NodeView>();
  private links: { from: string; to: string; path: SVGPathElement }[] = [];
  private selected: string | null = null;
  private detail!: HTMLElement;
  private viewport!: HTMLElement;
  private curName!: HTMLElement;
  private curBar!: HTMLElement;
  private curPct!: HTMLElement;
  private ppd!: HTMLElement;
  private queueEl!: HTMLElement;
  private sig = '';
  private cleanup: (() => void)[] = [];

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Research', 'flask', 'full');
    this.fixedBody = true;
    if (typeof args.techId === 'string') this.selected = args.techId;
  }

  protected build() {
    const st = this.ui.game.state;
    this.selected ??= st.research.current ?? st.research.queue[0] ?? null;
    // summary strip
    this.curName = h('div.rs-curname');
    this.curBar = bar(0, 'teal', 'thick');
    this.curPct = h('span.mono.small');
    this.ppd = h('span.mono');
    this.queueEl = h('div.rs-queue');
    const summary = h('div.rs-summary',
      h('div.rs-cur', h('div.label', 'Researching'), this.curName, h('div.row', this.curBar, this.curPct)),
      h('div.rs-ppd', h('div.label', 'Output'), h('div.row', icon('flask'), this.ppd, h('span.dim.small', 'pts / day'))),
      h('div.rs-q', h('div.label', 'Queue'), this.queueEl));
    // graph
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const graph = h('div.rs-graph');
    const svg = s<SVGSVGElement>('svg', { class: 'rs-links' });
    graph.appendChild(svg);
    let y = HEAD_H;
    const pos = new Map<string, { x: number; y: number }>();
    for (let tier = 1; tier <= 5; tier++) {
      graph.appendChild(h('div.rs-tier', { style: { left: `${LABEL_W + (tier - 1) * (NODE_W + COL_GAP)}rem`, width: `${NODE_W}rem` } }, `Tier ${roman(tier)}`));
    }
    for (const br of TECH_BRANCHES) {
      const techs = Object.values(TECHS).filter((t) => t.branch === br);
      const byTier = new Map<number, TechDef[]>();
      for (const t of techs) byTier.set(t.tier, [...(byTier.get(t.tier) ?? []), t]);
      const rows = Math.max(1, ...[...byTier.values()].map((a) => a.length));
      const bandH = rows * ROW_H + BAND_PAD;
      const info = BRANCH_INFO[br];
      graph.appendChild(h('div.rs-band', { style: { top: `${y}rem`, height: `${bandH}rem`, '--br-c': info.color } }, h('div.rs-blabel', icon(info.icon), h('span', info.label))));
      for (const [tier, arr] of byTier) {
        arr.forEach((t, i) => {
          const nx = LABEL_W + (tier - 1) * (NODE_W + COL_GAP);
          const ny = y + BAND_PAD / 2 + i * ROW_H + (rows - arr.length) * ROW_H * 0.5 + (ROW_H - NODE_H) / 2;
          pos.set(t.id, { x: nx, y: ny });
        });
      }
      y += bandH;
    }
    const totalW = LABEL_W + 5 * NODE_W + 4 * COL_GAP + 1;
    graph.style.width = `${totalW}rem`;
    graph.style.height = `${y + 0.5}rem`;
    svg.setAttribute('width', String(totalW * rem));
    svg.setAttribute('height', String((y + 0.5) * rem));
    // links
    for (const t of Object.values(TECHS)) {
      const p1 = pos.get(t.id)!;
      for (const req of t.requires) {
        const p0 = pos.get(req);
        if (!p0) continue;
        const x0 = (p0.x + NODE_W) * rem;
        const y0 = (p0.y + NODE_H / 2) * rem;
        const x1 = p1.x * rem;
        const y1 = (p1.y + NODE_H / 2) * rem;
        const mx = (x0 + x1) / 2;
        const path = s<SVGPathElement>('path', { d: `M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`, class: TECHS[req].branch === t.branch ? 'lk' : 'lk cross' });
        svg.appendChild(path);
        this.links.push({ from: req, to: t.id, path });
      }
    }
    // nodes
    for (const t of Object.values(TECHS)) {
      const p = pos.get(t.id)!;
      const info = BRANCH_INFO[t.branch];
      const rg = ring(26, 3, '#2ad0e0');
      const state = h('div.rs-state');
      const el = h('button.rs-node', { type: 'button', style: { left: `${p.x}rem`, top: `${p.y}rem`, width: `${NODE_W}rem`, height: `${NODE_H}rem`, '--br-c': info.color } },
        h('div.rs-nic', rg.el, icon(info.icon)),
        h('div.col.grow', { style: 'gap:0;min-width:0' }, h('div.rs-nname', t.name), h('div.rs-ncost.mono', t.cost ? `${int(t.cost)} pts` : 'Starting tech')),
        state);
      el.addEventListener('click', () => { this.ui.sound('click'); this.select(t.id); });
      el.addEventListener('dblclick', () => this.start(t.id));
      el.addEventListener('mouseenter', () => this.hoverChain(t.id, true));
      el.addEventListener('mouseleave', () => this.hoverChain(t.id, false));
      graph.appendChild(el);
      this.nodes.set(t.id, { t, el, ring: rg, state, x: p.x, y: p.y });
    }
    this.viewport = h('div.rs-viewport.scroll', graph);
    this.enablePan(this.viewport);
    this.detail = h('div.rs-detail.card.scroll');
    this.body.append(summary, h('div.rs-main', this.viewport, this.detail));
    this.renderDetail();
    this.update();
    if (this.selected) window.setTimeout(() => this.scrollTo(this.selected!), 30);
  }

  private enablePan(vp: HTMLElement) {
    let sx = 0, sy = 0, sl = 0, stp = 0, down = false, moved = false;
    vp.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.rs-node') || e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; sl = vp.scrollLeft; stp = vp.scrollTop;
      vp.classList.add('panning');
    });
    const move = (e: MouseEvent) => {
      if (!down) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      vp.scrollLeft = sl - dx;
      vp.scrollTop = stp - dy;
    };
    const up = () => {
      down = false;
      vp.classList.remove('panning');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.cleanup.push(() => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    });
    void moved;
  }

  destroy() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }

  private scrollTo(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  private chain(id: string, acc = new Set<string>()): Set<string> {
    for (const r of TECHS[id]?.requires ?? []) if (!acc.has(r)) { acc.add(r); this.chain(r, acc); }
    return acc;
  }

  private hoverChain(id: string, on: boolean) {
    const ch = this.chain(id);
    ch.add(id);
    for (const l of this.links) if (ch.has(l.to) && ch.has(l.from)) l.path.classList.toggle('hover', on);
  }

  private select(id: string) {
    this.selected = id;
    this.renderDetail();
    this.update();
  }

  private missingChain(id: string): string[] {
    const st = this.ui.game.state;
    const done = new Set(st.research.completed);
    const order: string[] = [];
    const visit = (x: string) => {
      if (done.has(x) || order.includes(x)) return;
      for (const r of TECHS[x]?.requires ?? []) visit(r);
      order.push(x);
    };
    visit(id);
    return order;
  }

  private start(id: string) {
    const st = this.ui.game.state;
    const status = techStatus(st, id);
    if (status === 'done') return;
    if (status === 'locked') return this.queue(id);
    const r = this.ui.dispatch({ type: 'research/start', techId: id }, { successSound: 'success' });
    if (r.ok) this.ui.toast('info', `Researching ${TECHS[id].name}`, undefined, { icon: 'flask', ttl: 3 });
    this.renderDetail();
    this.update();
  }

  private queue(id: string) {
    const st = this.ui.game.state;
    const add = this.missingChain(id).filter((x) => x !== st.research.current && !st.research.queue.includes(x));
    if (!add.length) return;
    const r = this.ui.dispatch({ type: 'research/queue', techIds: [...st.research.queue, ...add] }, { successSound: 'click' });
    if (r.ok) this.ui.toast('info', add.length > 1 ? `Queued ${add.length} technologies` : `Queued ${TECHS[id].name}`, add.length > 1 ? add.map((x) => TECHS[x].name).join(' → ') : undefined, { icon: 'flask', ttl: 3 });
    this.renderDetail();
    this.update();
  }

  private unqueue(id: string) {
    const st = this.ui.game.state;
    this.ui.dispatch({ type: 'research/queue', techIds: st.research.queue.filter((x) => x !== id) });
    this.ui.sound('click');
    this.renderDetail();
    this.update();
  }

  private renderDetail() {
    clear(this.detail);
    const id = this.selected;
    const st = this.ui.game.state;
    if (!id || !TECHS[id]) {
      this.detail.append(h('div.empty', icon('flask'), h('div', 'Select a technology'), h('div.tiny', 'Double-click a node to start researching it.')));
      return;
    }
    const t = TECHS[id];
    const info = BRANCH_INFO[t.branch];
    const status = techStatus(st, id);
    const mods = modifierLines(t);
    const statusChip = { done: chip('Researched', 'ok'), current: chip('In progress', 'teal'), queued: chip(`Queued #${st.research.queue.indexOf(id) + 1}`, 'accent'), available: chip('Available', 'info'), locked: chip('Locked', 'muted') }[status];
    const reqs = t.requires.map((r) => {
      const rs = techStatus(st, r);
      const b = h(`button.rs-req.${rs}`, { type: 'button' }, icon(rs === 'done' ? 'check' : 'lock'), h('span', TECHS[r].name));
      b.addEventListener('click', () => { this.select(r); this.scrollTo(r); });
      return b;
    });
    const unlocks = (t.unlocks ?? []).filter((u) => BUILDINGS[u]).map((u) => h('div.rs-unlock', icon(buildingIcon(u)), h('span', BUILDINGS[u].name)));
    const features = (t.features ?? []).map((f) => h('div.rs-unlock', icon('sparkle'), h('span', FEATURE_TEXT[f] ?? titleCase(f))));
    const actions = h('div.col', { style: 'gap:.4rem' });
    if (status === 'available') actions.append(button('Research now', { icon: 'play', variant: 'primary', block: true, onClick: () => this.start(id) }), button('Add to queue', { icon: 'plus', block: true, onClick: () => this.queue(id) }));
    else if (status === 'locked') actions.append(button(this.missingChain(id).length > 1 ? `Queue with ${this.missingChain(id).length - 1} prerequisites` : 'Add to queue', { icon: 'plus', variant: 'primary', block: true, onClick: () => this.queue(id) }));
    else if (status === 'queued') actions.append(button('Research now', { icon: 'play', variant: 'primary', block: true, onClick: () => this.start(id) }), button('Remove from queue', { icon: 'close', block: true, onClick: () => this.unqueue(id) }));
    const days = Math.ceil(researchEta(st, id));
    this.detail.append(
      h('div.rs-dhead', { style: { '--br-c': info.color } }, h('div.rs-dic', icon(info.icon)), h('div.col', { style: 'gap:.1rem;min-width:0' }, h('div.rs-dbranch', `${info.label} · Tier ${roman(t.tier)}`), h('div.rs-dname', t.name))),
      h('div.row.wrap', statusChip, t.cost ? chip(`${int(t.cost)} pts`, '', true) : null, status !== 'done' && Number.isFinite(days) ? chip(`≈ ${days} days`, '', true) : null),
      h('p.rs-desc', t.description),
      mods.length ? h('div', h('div.section-title', 'Effects'), h('div.col', { style: 'gap:.25rem' }, mods.map((m) => h(`div.rs-mod.${m.good ? 'good' : 'bad'}`, icon(m.good ? 'trend-up' : 'trend-down'), h('span', m.text))))) : '',
      unlocks.length || features.length ? h('div', h('div.section-title', 'Unlocks'), h('div.col', { style: 'gap:.3rem' }, unlocks, features)) : '',
      reqs.length ? h('div', h('div.section-title', 'Requires'), h('div.col', { style: 'gap:.3rem' }, reqs)) : '',
      h('div.sp'),
      actions);
  }

  update() {
    const st = this.ui.game.state;
    const r = st.research;
    const cur = r.current ? TECHS[r.current] : null;
    setText(this.curName, cur ? cur.name : 'Nothing — pick a technology');
    const frac = cur ? Math.min(1, r.progress / Math.max(1, cur.cost)) : 0;
    setBar(this.curBar, frac);
    setText(this.curPct, cur ? `${int(r.progress)} / ${int(cur.cost)}` : '');
    setText(this.ppd, fixed(r.pointsPerDay, 1));
    const qsig = r.queue.join(',');
    if (qsig !== this.queueEl.dataset.sig) {
      this.queueEl.dataset.sig = qsig;
      clear(this.queueEl);
      if (!r.queue.length) this.queueEl.appendChild(h('span.dim.small', 'Empty — research stops after the current tech'));
      r.queue.forEach((q, i) => {
        const b = h('button.rs-qchip', { type: 'button', title: 'Click to select' }, h('span.mono', String(i + 1)), TECHS[q]?.name ?? q);
        b.addEventListener('click', () => { this.select(q); this.scrollTo(q); });
        this.queueEl.appendChild(b);
      });
    }
    const sig = `${r.completed.length}|${r.current}|${qsig}|${this.selected}`;
    const statusChanged = sig !== this.sig;
    this.sig = sig;
    for (const [id, n] of this.nodes) {
      if (statusChanged) {
        const status: TechStatus = techStatus(st, id);
        n.el.dataset.status = status;
        toggleClass(n.el, 'selected', id === this.selected);
        n.state.replaceChildren(
          status === 'done' ? icon('check') : status === 'locked' ? icon('lock') : status === 'queued' ? h('span.mono', `#${r.queue.indexOf(id) + 1}`) : status === 'available' ? icon('plus') : '');
      }
      if (id === r.current) n.ring.set(frac);
      else n.ring.set(n.el.dataset.status === 'done' ? 1 : 0);
    }
    if (statusChanged) {
      const done = new Set(r.completed);
      const sel = this.selected ? this.chain(this.selected) : new Set<string>();
      if (this.selected) sel.add(this.selected);
      for (const l of this.links) {
        setAttr(l.path, 'data-s', done.has(l.from) && done.has(l.to) ? 'done' : done.has(l.from) ? 'open' : 'locked');
        l.path.classList.toggle('sel', sel.has(l.to) && sel.has(l.from));
      }
      this.renderDetailIfNeeded();
    }
  }

  private lastDetailSig = '';
  private renderDetailIfNeeded() {
    const st = this.ui.game.state;
    const sig = `${this.selected}|${this.selected ? techStatus(st, this.selected) : ''}|${st.research.queue.join(',')}`;
    if (sig !== this.lastDetailSig) {
      this.lastDetailSig = sig;
      this.renderDetail();
    }
  }
}
