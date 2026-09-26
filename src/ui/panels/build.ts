// Build menu: category list, building cards (cost/size/power/crew/emissions, lock state) and
// the Pipes & Roads line tools. Clicking a card enters build mode ('ui:buildMode') and closes the menu.
import { h, clear, setText, toggleClass, KeyedList } from '../dom';
import { icon, buildingIcon, CATEGORY_ICON, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { chip, emptyState } from '../core/components';
import { BUILDINGS, type BuildingCategory, type BuildingDef, type WorkerRole } from '../../content/buildings';
import { B, BLOCKS } from '../../core/blocks';
import { money, power as fmtPower, int, keyLabel, titleCase } from '../format';
import { isUnlocked, techName, ROLE_NAMES } from '../game';
import { itemIconEl } from '../render/itemIcons';
import { tipBody } from '../core/tooltip';
import { CATEGORY_COLOR } from '../hud/minimap';

type Cat = BuildingCategory | 'lines';
const CATS: { id: Cat; label: string }[] = [
  { id: 'exploration', label: 'Exploration' }, { id: 'drilling', label: 'Drilling' }, { id: 'production', label: 'Production' },
  { id: 'storage', label: 'Storage' }, { id: 'midstream', label: 'Midstream' }, { id: 'logistics', label: 'Logistics' },
  { id: 'processing', label: 'Processing' }, { id: 'petrochem', label: 'Petrochemicals' }, { id: 'power', label: 'Power' },
  { id: 'offshore', label: 'Offshore' }, { id: 'support', label: 'Support' }, { id: 'environment', label: 'Environment' },
  { id: 'lines', label: 'Pipes & Roads' },
];

/** Listed shop prices per block for line tools (mirrors the economy's block price list). */
const LINE_TOOLS: { block: number; desc: string; price: number }[] = [
  { block: B.PIPE_OIL, desc: 'Carries crude & condensate. Connects to oil ports on wellheads, tanks, terminals and plants.', price: 350 },
  { block: B.PIPE_GAS, desc: 'Carries raw and dry gas, CO₂. Long lines need compressor stations.', price: 400 },
  { block: B.PIPE_WATER, desc: 'Produced & treated water to pits, disposal wells, injectors and frac spreads.', price: 250 },
  { block: B.PIPE_PRODUCT, desc: 'Refined products, NGLs and chemicals between plants, tanks and terminals.', price: 450 },
  { block: B.ASPHALT_ROAD, desc: 'Paved road. Faster movement for crews and trucks.', price: 60 },
  { block: B.CONCRETE, desc: 'Solid concrete for foundations, walls and pads.', price: 30 },
];
const ROLE_ICON: Record<WorkerRole, IconName> = { roughneck: 'worker', driller: 'rig', operator: 'gauge', engineer: 'settings', technician: 'wrench', geoscientist: 'seismic', firefighter: 'fire', trucker: 'truck' };

let lastCat: Cat = 'drilling';

export class BuildPanel extends Panel {
  readonly id = 'build' as const;
  private cat: Cat = lastCat;
  private catBtns = new Map<Cat, HTMLElement>();
  private grid!: HTMLElement;
  private search!: HTMLInputElement;
  private cards: KeyedList<BuildingDef> | null = null;
  private cashEl!: HTMLElement;
  private cardEls = new Map<string, { el: HTMLElement; cost: HTMLElement }>();

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Construction', 'build', 'xl');
    this.fixedBody = true;
    if (typeof args.category === 'string') this.cat = args.category as Cat;
  }

  protected build() {
    this.setSubtitle(`Select a structure, then place it in the world · ${keyLabel(this.ui.app.settings.keybinds.rotate)} rotates`);
    this.cashEl = h('span.mono.accent');
    this.actionsEl.append(h('div.bd-cash', icon('coin'), h('span.dim', 'Available'), this.cashEl));
    const nav = h('nav.bd-nav.scroll');
    const st = this.ui.game.state;
    for (const c of CATS) {
      const count = c.id === 'lines' ? LINE_TOOLS.length : Object.values(BUILDINGS).filter((d) => d.category === c.id && d.placement !== 'auto').length;
      if (!count) continue;
      const unlocked = c.id === 'lines' ? count : Object.values(BUILDINGS).filter((d) => d.category === c.id && d.placement !== 'auto' && isUnlocked(st, d)).length;
      const b = h('button.bd-cat', { type: 'button', style: { '--cat-c': c.id === 'lines' ? '#9aa1a8' : CATEGORY_COLOR[c.id] } },
        icon(c.id === 'lines' ? 'pipe' : CATEGORY_ICON[c.id]), h('span.grow', c.label), h('span.bd-count.mono', `${unlocked}/${count}`));
      b.addEventListener('click', () => {
        this.ui.sound('click');
        this.cat = c.id;
        lastCat = c.id;
        this.search.value = '';
        this.paintNav();
        this.renderGrid();
      });
      this.catBtns.set(c.id, b);
      nav.appendChild(b);
    }
    this.search = h<HTMLInputElement>('input.input.bd-search', { placeholder: 'Search all buildings…', type: 'search' });
    this.search.addEventListener('input', () => this.renderGrid());
    this.grid = h('div.bd-grid');
    const main = h('div.bd-main', h('div.row', this.search), h('div.bd-scroll.scroll', this.grid));
    this.body.appendChild(h('div.bd-layout', nav, main));
    this.paintNav();
    this.renderGrid();
    window.setTimeout(() => this.search.focus({ preventScroll: true }), 50);
  }

  private paintNav() {
    for (const [c, b] of this.catBtns) toggleClass(b, 'on', c === this.cat);
  }

  private renderGrid() {
    clear(this.grid);
    this.cardEls.clear();
    const q = this.search.value.trim().toLowerCase();
    if (!q && this.cat === 'lines') {
      for (const t of LINE_TOOLS) this.grid.appendChild(this.lineCard(t));
      return;
    }
    const defs = Object.values(BUILDINGS)
      .filter((d) => d.placement !== 'auto')
      .filter((d) => (q ? `${d.name} ${d.description} ${d.category}`.toLowerCase().includes(q) : d.category === this.cat))
      .sort((a, b) => (a.category === b.category ? a.order - b.order : a.category.localeCompare(b.category)));
    if (!defs.length) {
      this.grid.appendChild(h('div', { style: 'grid-column:1/-1' }, emptyState('search', 'No buildings match your search')));
      return;
    }
    for (const d of defs) this.grid.appendChild(this.card(d));
    this.update();
  }

  private card(d: BuildingDef): HTMLElement {
    const st = this.ui.game.state;
    const unlocked = isUnlocked(st, d);
    const color = CATEGORY_COLOR[d.category] ?? '#ff8a1f';
    const cost = h('span.bd-cost.mono', money(d.cost));
    const crew = Object.entries(d.crew).filter(([, n]) => n) as [WorkerRole, number][];
    const stats = h('div.bd-stats',
      h('span', { title: 'Footprint (w × d × h)' }, icon('grid'), `${d.size[0]}×${d.size[1]}×${d.size[2]}`),
      d.power ? h(`span.${d.power < 0 ? 'ok' : 'warn'}`, { title: d.power < 0 ? 'Generates power' : 'Power draw' }, icon('bolt'), `${d.power < 0 ? '+' : '−'}${fmtPower(Math.abs(d.power))}`) : null,
      crew.length ? h('span', { title: crew.map(([r, n]) => `${n} ${ROLE_NAMES[r]}`).join(', ') }, icon('users'), String(crew.reduce((a, [, n]) => a + n, 0))) : null,
      d.emissions ? h('span.dim', { title: 't CO₂e/day at full load' }, icon('co2'), `${int(d.emissions)} t/d`) : null,
      d.opex ? h('span.dim', { title: 'Daily operating cost' }, icon('clock'), `${money(d.opex, 1)}/d`) : null);
    const el = h(`button.bd-card${unlocked ? '' : '.locked'}`, { type: 'button', style: { '--cat-c': color } },
      h('div.bd-head', h('div.bd-ic', icon(buildingIcon(d.id))), h('div.col.grow', { style: 'gap:.05rem' }, h('div.bd-name', d.name), h('div.bd-catname', titleCase(d.category))), cost),
      h('div.bd-desc', d.description),
      stats,
      !unlocked ? h('div.bd-lock', icon('lock'), h('span', 'Requires '), h('b', techName(d.requiresTech))) : null,
      d.placement === 'water' ? h('div.bd-tag', chip('Offshore', 'info', true)) : d.placement === 'coast' ? h('div.bd-tag', chip('Coastline', 'info', true)) : d.placement === 'wellhead' ? h('div.bd-tag', chip('On wellhead', 'teal', true)) : null);
    this.ui.tooltip.attach(el, () => {
      const extra: HTMLElement[] = [];
      if (crew.length) extra.push(h('div.tt-crew', crew.map(([r, n]) => h('span', icon(ROLE_ICON[r]), `${n} ${ROLE_NAMES[r]}`))));
      if (d.storage) extra.push(h('div.tt-sub', `Storage: ${Object.entries(d.storage).map(([k, v]) => `${int(v!)} ${k}`).join(' · ')}`));
      if (d.ports.length) extra.push(h('div.tt-sub', `Pipe ports: ${d.ports.join(', ')}`));
      if (!unlocked) extra.push(h('div.tt-sub.warn', `Locked — research ${techName(d.requiresTech)}`));
      return tipBody(d.name, `${money(d.cost)} · build ${d.buildHours} h · opex ${money(d.opex)}/day`, d.hint ?? d.description, extra);
    });
    el.addEventListener('mouseenter', () => this.ui.sound('hover'));
    el.addEventListener('click', () => this.choose(d));
    this.cardEls.set(d.id, { el, cost });
    return el;
  }

  private lineCard(t: { block: number; desc: string; price: number }): HTMLElement {
    const def = BLOCKS[t.block];
    const el = h('button.bd-card.line', { type: 'button', style: { '--cat-c': '#9aa1a8' } },
      h('div.bd-head', h('div.bd-ic.blk', itemIconEl(`block:${def.key}`)), h('div.col.grow', { style: 'gap:.05rem' }, h('div.bd-name', def.name), h('div.bd-catname', def.pipe ? `${titleCase(def.pipe)} network` : 'Surface')), h('span.bd-cost.mono', `${money(t.price)}/blk`)),
      h('div.bd-desc', t.desc),
      h('div.bd-stats', h('span', icon('mouse-left'), 'Click start & end'), h('span', icon('pipe'), 'Straight & L runs')));
    el.addEventListener('mouseenter', () => this.ui.sound('hover'));
    el.addEventListener('click', () => {
      this.ui.sound('click');
      this.ui.game.bus.emit('ui:buildMode', { type: null });
      this.ui.game.bus.emit('ui:pipeMode', { block: t.block });
      this.ui.closeAll();
    });
    return el;
  }

  private choose(d: BuildingDef) {
    const st = this.ui.game.state;
    if (!isUnlocked(st, d)) {
      this.ui.sound('error');
      this.ui.toast('warning', `${d.name} is locked`, `Research ${techName(d.requiresTech)} to unlock it.`, { icon: 'lock', onClick: () => this.ui.open('research', { techId: d.requiresTech }) });
      return;
    }
    if (st.company.money < d.cost && !st.meta.rules.creative) {
      this.ui.sound('error');
      this.ui.toast('warning', 'Not enough money', `${d.name} costs ${money(d.cost)}.`, { icon: 'coin' });
      return;
    }
    this.ui.sound('click');
    this.ui.game.bus.emit('ui:pipeMode', { block: null });
    this.ui.game.bus.emit('ui:buildMode', { type: d.id, rotation: 0 });
    this.ui.closeAll();
  }

  update() {
    const st = this.ui.game.state;
    setText(this.cashEl, money(st.company.money));
    for (const [id, c] of this.cardEls) {
      const d = BUILDINGS[id];
      toggleClass(c.cost, 'danger', st.company.money < d.cost && !st.meta.rules.creative);
    }
  }
}
