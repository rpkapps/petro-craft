// Building inspector: status & alerts, construction, condition & repair, enable/throttle, recipes,
// IO rates, storage, crew, per-type configuration and type-specific sections (rigs, wellheads, terminals,
// power, research, flares). Demolish / cancel construction.
import { h, clear, setText, setBar, bar, toggleClass, KeyedList } from '../dom';
import { icon, buildingIcon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, emptyState, field, segmented, slider, statusChip, toggle, type ChipCtl } from '../core/components';
import { BUILDINGS, type WorkerRole } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { recipesFor, type Recipe } from '../../content/recipes';
import { CONFIG_SCHEMA } from '../../sim/facilities';
import { staffing } from '../../sim/economy';
import type { BuildingState } from '../../core/types';
import { buildingName, isRig, storageCap, ROLE_NAMES } from '../game';
import { itemIconEl, brighten } from '../render/itemIcons';
import { ROLE_COLOR } from '../render/avatar';
import { gasRate, itemQty, itemRate, money, oilRate, pct, power, titleCase, int, lengthBlocks, compact } from '../format';
import { CATEGORY_COLOR } from '../hud/minimap';

const TERMINALS = new Set(['truck_terminal', 'rail_terminal', 'export_terminal', 'gas_sales_meter', 'fpso']);
type Cat = 'oil' | 'gas' | 'water' | 'product';
const CAT_COLOR: Record<Cat, string> = { oil: '#c98b3a', gas: '#6fc3ff', water: '#3f8fd8', product: '#3ddc84' };

export class InspectorPanel extends Panel {
  readonly id = 'inspector' as const;
  private bid: string;
  private chip: ChipCtl | null = null;
  private patchers: (() => void)[] = [];
  private structSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Inspector', 'building', 'lg');
    this.bid = String(args.buildingId ?? '');
  }

  private get b(): BuildingState | undefined {
    return this.ui.game.state.buildings[this.bid];
  }

  setArgs(args: PanelArgs) {
    if (args.buildingId === this.bid) return;
    this.bid = String(args.buildingId ?? '');
    this.structSig = '';
    this.rebuild();
  }

  protected build() {
    const b = this.b;
    this.patchers = [];
    if (!b) {
      this.body.appendChild(emptyState('building', 'This building no longer exists'));
      return;
    }
    const ctx = this.ui.game;
    const def = BUILDINGS[b.type];
    this.setIcon(buildingIcon(b.type));
    this.iconEl.style.setProperty('color', CATEGORY_COLOR[def?.category ?? 'support'] ?? '');
    this.chip = statusChip('building', b.status);
    const locate = button(null, { icon: 'map', size: 'sm', title: 'Show on map', onClick: () => { this.ui.sound('click'); this.ui.open('map', { at: { x: b.x + b.size[0] / 2, z: b.z + b.size[1] / 2 } }, { stack: true }); } });
    this.actionsEl.append(this.chip.el, locate);
    this.structSig = this.sig(b);

    const left = h('div.col.ins-col');
    const right = h('div.col.ins-col');
    left.append(this.alerts(b));
    if (b.constructionProgress < 1) left.append(this.constructionCard(b));
    else left.append(this.operationCard(b));
    const recipes = recipesFor(b.type);
    if (recipes.length && b.constructionProgress >= 1) left.append(this.recipeCard(b, recipes));
    if (Object.keys(b.io).length || recipes.length) left.append(this.ioCard(b));
    if (def?.storage) left.append(this.storageCard(b));
    // type specific
    if (isRig(b.type)) right.append(this.rigCard(b));
    if (b.type === 'wellhead') right.append(this.wellheadCard(b));
    if (TERMINALS.has(b.type)) right.append(this.terminalCard(b));
    if (def && def.power < 0) right.append(this.powerCard(b));
    if (b.type === 'research_lab' || b.type === 'field_office') right.append(this.researchCard(b));
    if (b.type === 'flare_stack' || b.data.flareRate !== undefined || b.data.ventRate !== undefined) right.append(this.flareCard(b));
    if (Object.keys(def?.crew ?? {}).length) right.append(this.crewCard(b));
    const schema = CONFIG_SCHEMA[b.type];
    if (schema && b.constructionProgress >= 1) right.append(this.configCard(b));
    right.append(this.infoCard(b));
    this.body.appendChild(h('div.ins-grid', left, right));
    const foot = h('footer.ins-foot',
      h('span.dim.small', def?.description ?? ''),
      h('span.sp'),
      b.constructionProgress < 1
        ? button('Cancel construction', { icon: 'close', variant: 'danger', size: 'sm', onClick: () => this.cancelBuild(b) })
        : b.type !== 'wellhead' ? button('Demolish', { icon: 'trash', variant: 'danger', size: 'sm', onClick: () => this.demolish(b) }) : '');
    this.body.appendChild(foot);
  }

  private sig(b: BuildingState): string {
    return `${b.type}|${b.constructionProgress >= 1}|${b.status === 'destroyed'}|${b.wellId ?? ''}|${Object.keys(b.io).length > 0}`;
  }

  // ---- sections -------------------------------------------------------------------------------
  private alerts(b: BuildingState): HTMLElement {
    const box = h('div.col', { style: 'gap:.5rem' });
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      const key = `${x.status}|${x.condition < 25}|${x.enabled}`;
      if (box.dataset.k === key) return;
      box.dataset.k = key;
      clear(box);
      if (x.status === 'fire') box.appendChild(h('div.banner', icon('fire'), h('span', h('b', 'ON FIRE'), ' — equipment is burning. Fire stations nearby respond automatically; you can also use the extinguisher tool.')));
      if (x.status === 'destroyed') box.appendChild(h('div.banner', icon('skull'), h('span', h('b', 'DESTROYED'), ' — burnt-out ruin. Demolish it to clear the site.')));
      if (x.status === 'broken') box.appendChild(h('div.banner.warn', icon('wrench'), h('span.grow', h('b', 'BROKEN DOWN'), ' — needs repair before it can run again.'), button('Repair', { icon: 'wrench', size: 'sm', variant: 'primary', onClick: () => this.repair() })));
      if (x.status === 'unstaffed') box.appendChild(h('div.banner.warn', icon('users'), h('span.grow', h('b', 'UNSTAFFED'), ' — assign the required crew.'), button('Workforce', { size: 'sm', onClick: () => this.ui.open('workforce', { tab: 'needs' }, { stack: true }) })));
      if (x.status === 'no_power') box.appendChild(h('div.banner.warn', icon('bolt'), h('span', h('b', 'NO POWER'), ' — build generation or reduce demand.')));
      if (x.status !== 'broken' && x.condition < 25 && x.constructionProgress >= 1) box.appendChild(h('div.banner.warn', icon('warning'), h('span.grow', 'Condition is critical — failure is imminent.'), button('Repair', { icon: 'wrench', size: 'sm', onClick: () => this.repair() })));
    });
    return box;
  }

  private constructionCard(b: BuildingState): HTMLElement {
    const def = BUILDINGS[b.type];
    const pb = bar(0, 'striped', 'thick');
    const txt = h('span.mono');
    const eta = h('div.small.dim');
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      setBar(pb, x.constructionProgress);
      setText(txt, pct(x.constructionProgress, 0));
      const hoursLeft = (1 - x.constructionProgress) * (def?.buildHours ?? 0);
      setText(eta, `≈ ${hoursLeft.toFixed(1)} crew-hours remaining · ${x.workers.length} worker(s) on site`);
    });
    return h('div.card', h('div.section-title', icon('cone'), 'Under construction'), h('div.row.between', h('span.label', 'Progress'), txt), pb, eta);
  }

  private operationCard(b: BuildingState): HTMLElement {
    const cond = bar(0, 'ok');
    const condTxt = h('span.mono.small');
    const util = bar(0, 'teal');
    const utilTxt = h('span.mono.small');
    const en = toggle('Enabled', b.enabled, (v) => this.ui.dispatch({ type: 'building/toggle', buildingId: this.bid, enabled: v }, { successSound: 'click' }), 'Switch the building on or off');
    const thr = slider({ min: 0, max: 1, step: 0.05, value: b.throttle, format: (v) => pct(v), onChange: (v) => this.ui.dispatch({ type: 'building/setThrottle', buildingId: this.bid, throttle: v }, { successSound: 'click' }) });
    const repairBtn = button('Repair', { icon: 'wrench', size: 'xs', onClick: () => this.repair() });
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      setBar(cond, x.condition / 100);
      cond.className = `bar ${x.condition > 60 ? 'ok' : x.condition > 30 ? 'warn' : 'danger'}`;
      setText(condTxt, `${Math.round(x.condition)}%`);
      setBar(util, x.utilization);
      setText(utilTxt, pct(x.utilization));
      en.set(x.enabled);
      thr.set(x.throttle);
      repairBtn.disabled = x.condition > 97 && x.status !== 'broken';
      const rp = x.data.repairProgress as number | undefined;
      setText(repairBtn.querySelector('.lbl'), rp !== undefined && rp > 0 && rp < 1 ? `Repairing ${pct(rp)}` : 'Repair');
    });
    const showThrottle = recipesFor(b.type).length > 0 || ['compressor_station', 'pump_station', 'disposal_well', 'water_treatment', 'diesel_generator', 'gas_turbine_power'].includes(b.type);
    return h('div.card',
      h('div.section-title', icon('gauge'), 'Operation'),
      en.el,
      h('div.row.between', { style: 'margin-top:.6rem' }, h('span.label', 'Condition'), h('span.row', { style: 'gap:.4rem' }, condTxt, repairBtn)), cond,
      h('div.row.between', { style: 'margin-top:.5rem' }, h('span.label', 'Utilisation'), utilTxt), util,
      showThrottle ? h('div', { style: 'margin-top:.6rem' }, field('Throughput setpoint', thr.el)) : '');
  }

  private recipeCard(b: BuildingState, recipes: Recipe[]): HTMLElement {
    const list = h('div.col', { style: 'gap:.4rem' });
    const cards = new Map<string, HTMLElement>();
    const flow = (items: Record<string, number>) => h('div.ins-flow', Object.entries(items).map(([id, q]) => h('span.ins-flowitem', itemIconEl(id), h('span.mono', itemQty(id, q, this.ui.units)), h('span.tiny.dim', ITEMS[id]?.name ?? id))));
    for (const r of recipes) {
      const el = h('button.ins-recipe', { type: 'button' },
        h('div.row', h('b.grow', r.name), r.power ? chip(`+${r.power} MW`, 'warn', true) : null),
        h('div.ins-rflow', flow(r.inputs), h('span.ins-arrow', icon('arrow-right')), flow(r.outputs)),
        r.description ? h('div.tiny.dim', r.description) : null);
      el.addEventListener('click', () => {
        if (this.b?.recipeId === r.id) return;
        this.ui.dispatch({ type: 'building/setRecipe', buildingId: this.bid, recipeId: r.id }, { successSound: 'click' });
      });
      cards.set(r.id, el);
      list.appendChild(el);
    }
    this.patchers.push(() => {
      const cur = this.b?.recipeId ?? recipes[0]?.id;
      for (const [id, el] of cards) toggleClass(el, 'on', id === cur);
    });
    return h('div.card', h('div.section-title', icon('factory'), 'Recipe · per day at 100%'), list);
  }

  private ioCard(b: BuildingState): HTMLElement {
    const box = h('div.ins-io');
    const list = new KeyedList<[string, number]>(box, ([id]) => id, ([id0]) => {
      const val = h('span.mono');
      const node = h('div.ins-iorow', itemIconEl(id0), h('span.grow', ITEMS[id0]?.name ?? id0), val);
      return { node, update: ([id, v]) => { setText(val, `${v > 0 ? '+' : '−'}${itemRate(id, Math.abs(v), this.ui.units)}`); val.className = `mono ${v > 0 ? 'up' : 'down'}`; } };
    });
    const empty = h('div.small.dim', 'Idle — no flow in the last hour.');
    this.patchers.push(() => {
      const io = Object.entries(this.b?.io ?? {}).filter(([, v]) => Math.abs(v) > 0.05).sort((a, c) => c[1] - a[1]);
      list.sync(io);
      toggleClass(empty, 'hidden', io.length > 0);
    });
    void b;
    return h('div.card', h('div.section-title', icon('refresh'), 'Live flows'), box, empty);
  }

  private storageCard(b: BuildingState): HTMLElement {
    const def = BUILDINGS[b.type];
    const rows = h('div.col', { style: 'gap:.6rem' });
    const cats = Object.keys(def?.storage ?? {}) as Cat[];
    const views = cats.map((cat) => {
      const seg = h('div.ins-stack');
      const txt = h('span.mono.small');
      const legend = h('div.ins-slegend');
      rows.appendChild(h('div', h('div.row.between', h('span.label', { style: { color: CAT_COLOR[cat] } }, `${titleCase(cat)} storage`), txt), seg, legend));
      return { cat, seg, txt, legend };
    });
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      for (const v of views) {
        const cap = storageCap(x, v.cat, this.ui.game);
        const items = Object.entries(x.storage).filter(([id, q]) => ITEMS[id]?.category === v.cat && q > 0.01);
        const used = items.reduce((a, [, q]) => a + q, 0);
        const key = items.map(([id, q]) => `${id}:${Math.round(q)}`).join(',');
        setText(v.txt, `${compact(used)} / ${compact(cap)} ${ITEMS[items[0]?.[0] ?? '']?.unit ?? ''}`.trim());
        if (v.seg.dataset.k === key) continue;
        v.seg.dataset.k = key;
        clear(v.seg);
        clear(v.legend);
        for (const [id, q] of items) {
          const c = brighten(ITEMS[id]?.color ?? '#888');
          v.seg.appendChild(h('i', { style: { width: `${Math.min(100, (q / Math.max(1, cap)) * 100)}%`, background: c === '#c98b3a' ? CAT_COLOR[v.cat] : c } }));
          v.legend.appendChild(h('span', h('b', { style: { background: c } }), `${ITEMS[id]?.name ?? id} ${itemQty(id, q, this.ui.units)}`));
        }
        if (!items.length) v.legend.appendChild(h('span.dim', 'Empty'));
      }
    });
    return h('div.card', h('div.section-title', icon('tank'), 'Storage'), rows);
  }

  private crewCard(b: BuildingState): HTMLElement {
    const rows = h('div.col', { style: 'gap:.35rem' });
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      const st = staffing(this.ui.game.state, x);
      const key = st.map((s) => `${s.role}:${s.assigned}:${s.healthy}`).join(',');
      if (rows.dataset.k === key) return;
      rows.dataset.k = key;
      clear(rows);
      for (const s of st) {
        const ok = s.healthy >= s.required;
        rows.appendChild(h('div.ins-crew', { style: { '--role-c': ROLE_COLOR[s.role as WorkerRole] } },
          h('span.wf-role', h('i'), ROLE_NAMES[s.role as WorkerRole]),
          h('span.ins-pips', Array.from({ length: s.required }, (_, i) => h(`i${i < s.healthy ? '.on' : i < s.assigned ? '.hurt' : ''}`))),
          h(`span.mono.small.${ok ? 'ok' : 'warn'}`, `${s.healthy}/${s.required}`)));
      }
    });
    return h('div.card', h('div.section-title', icon('users'), 'Crew', button('Manage', { size: 'xs', onClick: () => this.ui.open('workforce', { tab: 'staff' }, { stack: true }) })), rows);
  }

  private configCard(b: BuildingState): HTMLElement {
    const schema = CONFIG_SCHEMA[b.type] ?? {};
    const box = h('div.col', { style: 'gap:.6rem' });
    const set = (key: string, value: number | string | boolean) => this.ui.dispatch({ type: 'building/configure', buildingId: this.bid, key, value }, { successSound: 'click' });
    for (const [key, spec] of Object.entries(schema)) {
      const cur = b.config[key] ?? spec.default;
      if (spec.kind === 'bool') {
        const t = toggle(spec.label, !!cur, (v) => set(key, v));
        this.patchers.push(() => t.set(!!(this.b?.config[key] ?? spec.default)));
        box.appendChild(t.el);
      } else if (spec.kind === 'enum') {
        const sg = segmented((spec.options ?? []).map((o) => ({ value: o, label: titleCase(o) })), String(cur), (v) => set(key, v));
        this.patchers.push(() => sg.set(String(this.b?.config[key] ?? spec.default)));
        box.appendChild(field(spec.label, sg.el));
      } else {
        const sl = slider({ min: spec.min ?? 0, max: spec.max ?? 100, step: 1, value: Number(cur), onChange: (v) => set(key, v) });
        this.patchers.push(() => sl.set(Number(this.b?.config[key] ?? spec.default)));
        box.appendChild(field(spec.label, sl.el));
      }
    }
    return h('div.card', h('div.section-title', icon('settings'), 'Configuration'), box);
  }

  private rigCard(b: BuildingState): HTMLElement {
    const ctx = this.ui.game;
    const box = h('div.col', { style: 'gap:.5rem' });
    const btns = h('div.row.wrap');
    const plan = button('Plan new well', { icon: 'ruler', variant: 'primary', size: 'sm', onClick: () => this.ui.open('planner', { rigId: this.bid }, { stack: true }) });
    const skid = button('Skid rig', { icon: 'map', size: 'sm', onClick: () => this.ui.open('map', { tool: 'skid', rigId: this.bid }, { stack: true }) });
    btns.append(plan, skid);
    let pbRef: HTMLElement | null = null;
    let txtRef: HTMLElement | null = null;
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      const w = x.wellId ? ctx.state.wells[x.wellId] : Object.values(ctx.state.wells).find((wl) => wl.rigId === x.id && !['plugged', 'dry_hole', 'producing', 'injecting', 'shut_in'].includes(wl.status));
      const busy = !!w && ['drilling', 'tripping', 'casing', 'kick', 'blowout', 'completing', 'fracking'].includes(w.status);
      plan.disabled = busy || x.constructionProgress < 1;
      skid.disabled = busy || x.constructionProgress < 1;
      const key = w ? `${w.id}|${w.status}` : 'none';
      if (box.dataset.k !== key) {
        box.dataset.k = key;
        clear(box);
        pbRef = txtRef = null;
        if (!w) box.appendChild(h('div.small.dim', 'No active well. Plan a well to start drilling here.'));
        else {
          const pb = bar(0, w.status === 'drilling' ? 'striped' : 'teal', 'thick');
          const txt = h('span.mono.small');
          const c = statusChip('well', w.status);
          box.append(
            h('div.row', h('b.grow', w.name), c.el),
            h('div.row.between', h('span.label', 'Depth'), txt), pb,
            h('div.row.wrap', button('Well details', { icon: 'wellhead', size: 'xs', onClick: () => this.ui.open('well', { wellId: w.id }, { stack: true }) }),
              w.status === 'planned' ? button('Spud now', { icon: 'play', size: 'xs', variant: 'primary', onClick: () => this.ui.dispatch({ type: 'well/spud', wellId: w.id }, { successSound: 'success' }) }) : null));
          pbRef = pb;
          txtRef = txt;
        }
      }
      if (w && pbRef && txtRef) {
        setBar(pbRef, w.measuredDepth / Math.max(1, w.plannedDepth));
        setText(txtRef, `${lengthBlocks(w.measuredDepth, this.ui.units)} / ${lengthBlocks(w.plannedDepth, this.ui.units)}`);
      }
    });
    return h('div.card', h('div.section-title', icon('rig'), 'Drilling'), box, btns);
  }

  private wellheadCard(b: BuildingState): HTMLElement {
    const ctx = this.ui.game;
    const w = b.wellId ? ctx.state.wells[b.wellId] : undefined;
    if (!w) return h('div.card', h('div.section-title', icon('wellhead'), 'Well'), h('div.small.dim', 'No well linked.'));
    const oil = h('b.mono');
    const gas = h('b.mono');
    const water = h('b.mono');
    const c = statusChip('well', w.status);
    this.patchers.push(() => {
      const x = ctx.state.wells[w.id];
      if (!x) return;
      c.set(x.status);
      setText(oil, oilRate(Math.max(0, x.rates.oil), this.ui.units));
      setText(gas, gasRate(Math.abs(x.rates.gas), this.ui.units));
      setText(water, `${oilRate(Math.abs(x.rates.water), this.ui.units)} · WC ${pct(x.waterCut)}`);
    });
    return h('div.card',
      h('div.section-title', icon('wellhead'), 'Well'),
      h('div.row', h('b.grow', w.name), c.el),
      h('div.kv', { style: 'margin:.5rem 0' }, h('span', 'Oil'), oil, h('span', 'Gas'), gas, h('span', 'Water'), water, h('span', 'Lift'), h('span', titleCase(w.lift)), h('span', 'Choke'), h('span', pct(w.choke))),
      button('Open well detail', { icon: 'arrow-right', size: 'sm', variant: 'teal', block: true, onClick: () => this.ui.open('well', { wellId: w.id }, { stack: true }) }));
  }

  private terminalCard(b: BuildingState): HTMLElement {
    const box = h('div.col', { style: 'gap:.4rem' });
    this.patchers.push(() => {
      const d = (this.b?.data ?? {}) as { salesToday?: number; revenueToday?: number; salesCapacity?: number; salesUtil?: number; salesByItem?: Record<string, number> };
      const key = `${Math.round(d.salesToday ?? 0)}|${Math.round(d.revenueToday ?? 0)}`;
      if (box.dataset.k === key) return;
      box.dataset.k = key;
      clear(box);
      if (d.salesToday === undefined && d.revenueToday === undefined) {
        box.appendChild(h('div.small.dim', 'No sales yet today. Connect pipelines and enable auto-sell in the Market.'));
        return;
      }
      box.append(
        h('div.row.between', h('span.label', 'Revenue today'), h('b.mono.up', money(d.revenueToday ?? 0))),
        h('div.row.between', h('span.label', 'Volume today'), h('span.mono', `${compact(d.salesToday ?? 0)}${d.salesCapacity ? ` / ${compact(d.salesCapacity)}` : ''}`)),
        d.salesCapacity ? bar(d.salesUtil ?? (d.salesToday ?? 0) / d.salesCapacity, 'teal') : '',
        ...Object.entries(d.salesByItem ?? {}).filter(([, v]) => v > 0).map(([id, v]) => h('div.ins-iorow', itemIconEl(id), h('span.grow', ITEMS[id]?.name ?? id), h('span.mono', itemQty(id, v, this.ui.units)))));
    });
    return h('div.card', h('div.section-title', icon('truck'), 'Sales'), box, button('Market', { icon: 'chart', size: 'xs', onClick: () => this.ui.open('market', {}, { stack: true }) }));
  }

  private powerCard(b: BuildingState): HTMLElement {
    const def = BUILDINGS[b.type];
    const out = h('b.pl-qbig');
    const grid = h('div.small.dim');
    this.patchers.push(() => {
      const x = this.b;
      if (!x) return;
      const mw = (x.data.outputMW as number | undefined) ?? Math.abs(def.power) * x.utilization;
      setText(out, power(mw));
      const p = this.ui.game.state.power;
      setText(grid, `Grid: ${power(p.generation)} generated · ${power(p.demand)} demand`);
    });
    return h('div.card', h('div.section-title', icon('bolt'), 'Generation'), h('div.row.between', h('span.label', `Output (max ${power(Math.abs(def.power))})`), out), grid);
  }

  private researchCard(b: BuildingState): HTMLElement {
    const t = h('b.mono');
    this.patchers.push(() => setText(t, `${this.ui.game.state.research.pointsPerDay.toFixed(1)} pts/day company-wide`));
    void b;
    return h('div.card', h('div.section-title', icon('flask'), 'Research'), t, button('Research tree', { icon: 'flask', size: 'xs', onClick: () => this.ui.open('research', {}, { stack: true }) }));
  }

  private flareCard(b: BuildingState): HTMLElement {
    const f = h('b.mono');
    const v = h('b.mono');
    this.patchers.push(() => {
      const d = this.b?.data ?? {};
      setText(f, gasRate(Number(d.flareRate ?? 0), this.ui.units));
      setText(v, gasRate(Number(d.ventRate ?? 0), this.ui.units));
      v.className = `mono ${Number(d.ventRate ?? 0) > 0 ? 'danger' : ''}`;
    });
    void b;
    return h('div.card', h('div.section-title', icon('flare'), 'Flaring'), h('div.kv', h('span', 'Flared'), f, h('span', 'Vented'), v));
  }

  private infoCard(b: BuildingState): HTMLElement {
    const def = BUILDINGS[b.type];
    const st = this.ui.game.state;
    return h('div.card',
      h('div.section-title', icon('info'), 'Details'),
      h('div.kv',
        h('span', 'Category'), h('span', titleCase(def?.category ?? '')),
        h('span', 'Footprint'), h('span', `${b.size[0]} × ${b.size[1]} × ${b.size[2]}`),
        h('span', 'Location'), h('span', `${b.x}, ${b.y}, ${b.z}`),
        h('span', 'Operating cost'), h('span', `${money(def?.opex ?? 0)}/day`),
        h('span', 'Power'), h('span', def?.power ? `${def.power > 0 ? '−' : '+'}${power(Math.abs(def.power))}` : '—'),
        h('span', 'Emissions'), h('span', def?.emissions ? `${int(def.emissions)} t CO₂e/d` : '—'),
        h('span', 'Built'), h('span', `Day ${b.builtDay}`),
        h('span', 'Last service'), h('span', `Day ${b.lastMaintenanceDay} (${st.time.day - b.lastMaintenanceDay} d ago)`)));
  }

  // ---- actions ----------------------------------------------------------------------------------
  private repair() {
    const r = this.ui.dispatch({ type: 'building/repair', buildingId: this.bid }, { successSound: 'success' });
    if (r.ok) this.ui.toast('info', 'Repair crew dispatched', buildingName(this.ui.game.state, this.b), { icon: 'wrench', ttl: 3 });
  }

  private async demolish(b: BuildingState) {
    const ok = await this.ui.confirm({ title: `Demolish ${buildingName(this.ui.game.state, b)}?`, text: 'The structure will be removed. Stored product is lost and only part of the cost is refunded.', confirm: 'Demolish', danger: true, icon: 'trash' });
    if (!ok) return;
    const r = this.ui.dispatch({ type: 'build/demolish', buildingId: b.id }, { successSound: 'click' });
    if (r.ok) this.ui.close(this.id);
  }

  private async cancelBuild(b: BuildingState) {
    const ok = await this.ui.confirm({ title: 'Cancel construction?', text: 'Construction stops and most of the cost is refunded.', confirm: 'Cancel construction', danger: true, icon: 'cone' });
    if (!ok) return;
    const r = this.ui.dispatch({ type: 'build/cancel', buildingId: b.id }, { successSound: 'click' });
    if (r.ok) this.ui.close(this.id);
  }

  update() {
    const b = this.b;
    if (!b) {
      if (this.chip) {
        this.chip = null;
        this.rebuild();
      }
      return;
    }
    if (this.sig(b) !== this.structSig) {
      this.rebuild();
      return;
    }
    const st = this.ui.game.state;
    this.setTitle(buildingName(st, b));
    this.setSubtitle(`${BUILDINGS[b.type]?.name ?? b.type} · ${titleCase(BUILDINGS[b.type]?.category ?? '')}`);
    this.chip?.set(b.status);
    for (const p of this.patchers) p();
  }
}
