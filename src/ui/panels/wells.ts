// Wells (J): field production KPIs and a sortable, filterable table of every well; click for details.
import { h, setText } from '../dom';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { emptyState, kpi, segmented, SortableTable, statusChip, type KpiCtl } from '../core/components';
import type { WellState } from '../../core/types';
import { sparkline } from '../charts/mini';
import { gasRate, oilRate, pct, lengthBlocks, qty, titleCase } from '../format';
import { wellTvd } from '../game';

type Filter = 'all' | 'producing' | 'drilling' | 'problems' | 'inactive';
const DRILLING = new Set(['planned', 'drilling', 'tripping', 'casing', 'drilled', 'completing', 'fracking']);
const PROBLEMS = new Set(['kick', 'blowout']);
const INACTIVE = new Set(['shut_in', 'dry_hole', 'plugged']);
let lastFilter: Filter = 'all';

export class WellsPanel extends Panel {
  readonly id = 'wells' as const;
  private filter: Filter = lastFilter;
  private table!: SortableTable<WellState>;
  private kOil!: KpiCtl;
  private kGas!: KpiCtl;
  private kWater!: KpiCtl;
  private kCount!: KpiCtl;
  private kDrill!: KpiCtl;
  private search!: HTMLInputElement;
  private empty!: HTMLElement;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Wells', 'wells', 'xl');
  }

  protected build() {
    const u = this.ui.units;
    this.kOil = kpi('Oil production', 'oil', '#c98b3a');
    this.kGas = kpi('Gas production', 'gas', '#6fc3ff');
    this.kWater = kpi('Water', 'water', '#3f8fd8');
    this.kCount = kpi('Producing wells', 'pumpjack', '#3ddc84');
    this.kDrill = kpi('Rig activity', 'rig', '#ff8a1f');
    const seg = segmented<Filter>([
      { value: 'all', label: 'All' }, { value: 'producing', label: 'Producing' }, { value: 'drilling', label: 'Drilling & completion' },
      { value: 'problems', label: 'Well control' }, { value: 'inactive', label: 'Inactive' },
    ], this.filter, (v) => { this.ui.sound('click'); this.filter = v; lastFilter = v; this.update(); });
    this.search = h<HTMLInputElement>('input.input.sm', { placeholder: 'Search wells…', type: 'search', style: 'width:14rem' });
    this.search.addEventListener('input', () => this.update());
    this.table = new SortableTable<WellState>([
      { key: 'name', label: 'Well', sort: (w) => w.name, cell: (_w, td) => { const b = h('b'); const s = h('div.tiny.dim'); td.append(b, s); return (w) => { setText(b, w.name); setText(s, `${titleCase(w.plan.kind)} · ${titleCase(w.purpose)}`); }; } },
      { key: 'status', label: 'Status', sort: (w) => w.status, cell: (w0, td) => { const c = statusChip('well', w0.status); td.appendChild(c.el); return (w) => c.set(w.status); } },
      { key: 'depth', label: 'Depth (TVD)', align: 'right', cls: 'num', sort: (w) => wellTvd(w), cell: (_w, td) => (w) => setText(td, lengthBlocks(wellTvd(w), u)) },
      { key: 'oil', label: 'Oil', align: 'right', cls: 'num', sort: (w) => w.rates.oil, cell: (_w, td) => (w) => setText(td, w.rates.oil > 0.5 ? oilRate(w.rates.oil, u) : '—') },
      { key: 'gas', label: 'Gas', align: 'right', cls: 'num', sort: (w) => w.rates.gas, cell: (_w, td) => (w) => setText(td, w.rates.gas > 0.5 ? gasRate(w.rates.gas, u) : '—') },
      { key: 'water', label: 'Water', align: 'right', cls: 'num', sort: (w) => Math.abs(w.rates.water), cell: (_w, td) => (w) => setText(td, Math.abs(w.rates.water) > 0.5 ? `${w.rates.water < 0 ? 'inj ' : ''}${oilRate(Math.abs(w.rates.water), u)}` : '—') },
      { key: 'wc', label: 'WC', align: 'right', cls: 'num', sort: (w) => w.waterCut, cell: (_w, td) => (w) => setText(td, w.rates.oil + w.rates.water > 0 ? pct(w.waterCut) : '—') },
      { key: 'cum', label: 'Cum. oil', align: 'right', cls: 'num', sort: (w) => w.cumulative.oil, cell: (_w, td) => (w) => setText(td, w.cumulative.oil > 0 ? qty(w.cumulative.oil, 'bbl', u) : '—') },
      { key: 'trend', label: '30 days', cell: (_w, td) => {
        const sp = sparkline(80, 20, '#c98b3a');
        td.appendChild(sp.el);
        return (w) => sp.set(w.history.slice(-30).map((x) => x[1]));
      } },
    ], (w) => w.id, { sortKey: 'oil', sortDir: -1, onRowClick: (w) => { this.ui.sound('click'); this.ui.open('well', { wellId: w.id }, { stack: true }); }, rowClass: (w) => (PROBLEMS.has(w.status) ? 'row-danger' : '') });
    this.empty = emptyState('wells', 'No wells match', 'Build a drilling rig and plan your first well.');
    this.body.append(
      h('div.kpis', this.kOil.el, this.kGas.el, this.kWater.el, this.kCount.el, this.kDrill.el),
      h('div.row.wrap', { style: 'margin:.9rem 0 .6rem' }, seg.el, h('span.sp'), this.search),
      h('div.card', { style: 'padding:0' }, this.table.el, this.empty));
  }

  update() {
    const st = this.ui.game.state;
    const all = Object.values(st.wells);
    const u = this.ui.units;
    const prod = all.filter((w) => w.status === 'producing');
    const oil = prod.reduce((a, w) => a + w.rates.oil, 0);
    const gas = prod.reduce((a, w) => a + w.rates.gas, 0);
    const water = prod.reduce((a, w) => a + Math.max(0, w.rates.water), 0);
    this.kOil.set(oilRate(oil, u), `${qty(all.reduce((a, w) => a + w.cumulative.oil, 0), 'bbl', u)} cumulative`);
    this.kGas.set(gasRate(gas, u), `${qty(all.reduce((a, w) => a + w.cumulative.gas, 0), 'mcf', u)} cumulative`);
    this.kWater.set(oilRate(water, u), oil + water > 0 ? `${pct(water / (oil + water))} field water cut` : 'no production');
    this.kCount.set(String(prod.length), `${all.filter((w) => w.status === 'injecting').length} injectors · ${all.filter((w) => w.status === 'shut_in').length} shut in`);
    const drilling = all.filter((w) => ['drilling', 'tripping', 'casing', 'kick'].includes(w.status)).length;
    const problems = all.filter((w) => PROBLEMS.has(w.status)).length;
    this.kDrill.set(`${drilling} drilling`, problems ? `${problems} well-control events!` : `${all.filter((w) => DRILLING.has(w.status) && !['drilling', 'tripping', 'casing'].includes(w.status)).length} awaiting completion`, problems ? 'danger' : '');
    const q = this.search.value.trim().toLowerCase();
    const rows = all.filter((w) => {
      if (q && !w.name.toLowerCase().includes(q)) return false;
      if (this.filter === 'producing') return w.status === 'producing' || w.status === 'injecting';
      if (this.filter === 'drilling') return DRILLING.has(w.status);
      if (this.filter === 'problems') return PROBLEMS.has(w.status);
      if (this.filter === 'inactive') return INACTIVE.has(w.status);
      return true;
    });
    this.table.update(rows);
    this.empty.classList.toggle('hidden', rows.length > 0);
  }
}
