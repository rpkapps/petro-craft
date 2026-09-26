// Market (M): commodity board with sparklines & auto-sell, interactive price chart, market events,
// manual sell dialog and futures hedges (with the Trading Desk technology).
import { h, clear, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, segmented, SortableTable, toggle, slider, field, emptyState, type ToggleCtl } from '../core/components';
import { ITEMS } from '../../content/items';
import { LineChart } from '../charts/LineChart';
import { sparkline, type SparkCtl } from '../charts/mini';
import { MARKET_IDS, commodityHoldings, priceChange, priceOf, tail } from '../game';
import { dayLabel, itemQty, money, signedPct, unitPrice, price, int, compact, pct } from '../format';
import { itemIconEl, brighten } from '../render/itemIcons';
import type { MarketEvent } from '../../core/types';

type Range = '30' | '90' | '365';
let lastSel = 'crude_oil';
let lastRange: Range = '90';

export class MarketPanel extends Panel {
  readonly id = 'market' as const;
  private sel = lastSel;
  private range: Range = lastRange;
  private table!: SortableTable<string>;
  private chart!: LineChart;
  private selName!: HTMLElement;
  private selPrice!: HTMLElement;
  private selChg!: HTMLElement;
  private selStats!: HTMLElement;
  private selIcon!: HTMLElement;
  private rule!: HTMLElement;
  private events!: HTMLElement;
  private hedges!: HTMLElement;
  private eventsSig = '';
  private hedgeSig = '';
  private ruleSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Commodity Market', 'chart', 'xl');
    this.fixedBody = true;
    if (typeof args.commodity === 'string') this.sel = args.commodity;
  }

  protected build() {
    const units = this.ui.units;
    this.setSubtitle('Spot prices update daily · terminals auto-sell by your rules');
    this.table = new SortableTable<string>([
      { key: 'name', label: 'Commodity', sort: (id) => ITEMS[id].name, cell: (id, td) => { td.append(h('div.mk-name', itemIconEl(id), h('span', ITEMS[id].name))); return () => {}; } },
      { key: 'price', label: 'Price', align: 'right', cls: 'num', sort: (id) => priceOf(this.st, id), cell: (_id, td) => (id) => setText(td, unitPrice(id, priceOf(this.st, id), units)) },
      { key: 'chg', label: '24h', align: 'right', cls: 'num', sort: (id) => priceChange(this.st, id), cell: (_id, td) => (id) => {
        const c = priceChange(this.st, id);
        setText(td, signedPct(c, 1));
        td.className = `num right ${c > 0.0005 ? 'up' : c < -0.0005 ? 'down' : 'dim'}`;
      } },
      { key: 'spark', label: '30 days', cell: (_id, td) => {
        const sp: SparkCtl = sparkline(84, 22);
        td.appendChild(sp.el);
        return (id) => {
          const d = tail(this.st.market.history[id], 30);
          sp.set(d, d.length > 1 && d[d.length - 1] >= d[0] ? '#3ddc84' : '#ff4d4f');
        };
      } },
      { key: 'held', label: 'Held', align: 'right', cls: 'num', sort: (id) => commodityHoldings(this.st, id).total, cell: (_id, td) => (id) => {
        const hq = commodityHoldings(this.st, id).total;
        setText(td, hq > 0.5 ? itemQty(id, hq, units) : '—');
        toggleClass(td, 'dim', hq <= 0.5);
      } },
      { key: 'auto', label: 'Auto-sell', align: 'center', cell: (id0, td) => {
        const t: ToggleCtl = toggle(null, !!this.st.company.autoSell[id0]?.enabled, (v) => {
          const r = this.st.company.autoSell[id0] ?? { enabled: false, minPrice: 0, keepReserve: 0 };
          this.ui.dispatch({ type: 'market/setAutoSell', commodity: id0, enabled: v, minPrice: r.minPrice, keepReserve: r.keepReserve });
          this.ui.sound('click');
        });
        t.el.addEventListener('click', (e) => e.stopPropagation());
        td.appendChild(t.el);
        return (id) => t.set(!!this.st.company.autoSell[id]?.enabled);
      } },
    ], (id) => id, { sortKey: 'held', sortDir: -1, onRowClick: (id) => { this.ui.sound('click'); this.select(id); } });
    this.table.selectedKey = this.sel;

    this.chart = new LineChart({ xLabel: (i) => this.xLabel(i), yFormat: (v) => price(v), crosshair: true, zero: false });
    this.selIcon = h('div.mk-selic');
    this.selName = h('div.mk-selname');
    this.selPrice = h('div.mk-selprice.mono');
    this.selChg = h('div.mk-selchg.mono');
    this.selStats = h('div.mk-stats');
    const rangeSeg = segmented<Range>([{ value: '30', label: '30D' }, { value: '90', label: '90D' }, { value: '365', label: '1Y' }], this.range, (v) => {
      this.ui.sound('click');
      this.range = v;
      lastRange = v;
      this.drawChart();
    });
    const sellBtn = button('Sell…', { icon: 'coin', variant: 'primary', size: 'sm', onClick: () => this.sellDialog() });
    const hedgeBtn = button('Hedge…', { icon: 'shield', size: 'sm', onClick: () => this.hedgeDialog() });
    hedgeBtn.classList.toggle('hidden', !this.ui.game.hasTech('trading_desk'));
    this.rule = h('div.mk-rule');
    this.events = h('div.mk-events');
    this.hedges = h('div.mk-hedges');
    const left = h('div.mk-left.card.scroll', this.table.el);
    const right = h('div.mk-right',
      h('div.card.mk-chartcard',
        h('div.mk-selhead', this.selIcon, h('div.col', { style: 'gap:0;min-width:0' }, this.selName, h('div.row', this.selPrice, this.selChg)), h('div.sp'), rangeSeg.el, hedgeBtn, sellBtn),
        h('div.mk-chart', this.chart.el),
        this.selStats),
      h('div.mk-lower',
        h('div.card.mk-rulecard', h('div.section-title', icon('settings'), 'Auto-sell rule'), this.rule),
        h('div.card.mk-eventcard.scroll', h('div.section-title', icon('globe'), 'Market events'), this.events, this.hedges)));
    this.body.appendChild(h('div.mk-layout', left, right));
    this.select(this.sel);
  }

  private get st() {
    return this.ui.game.state;
  }

  private xLabel(i: number): string {
    const st = this.st;
    const n = Math.min(Number(this.range), (st.market.history[this.sel] ?? []).length);
    return dayLabel(st, st.time.day - (n - 1 - i));
  }

  private select(id: string) {
    this.sel = id;
    lastSel = id;
    this.table.selectedKey = id;
    this.table.update(MARKET_IDS);
    const it = ITEMS[id];
    this.selIcon.replaceChildren(itemIconEl(id));
    setText(this.selName, it.name);
    this.ruleSig = '';
    this.drawChart();
    this.update();
  }

  private drawChart() {
    const st = this.st;
    const hist = tail(st.market.history[this.sel], Number(this.range));
    const c = brighten(ITEMS[this.sel]?.color ?? '#ff8a1f');
    const units = this.ui.units;
    this.chart.setData(
      [{ name: ITEMS[this.sel].name, color: c === '#c98b3a' ? '#ff8a1f' : c, data: hist, fill: true, format: (v) => unitPrice(this.sel, v, units) }],
      `${this.sel}|${this.range}|${hist.length}|${hist[hist.length - 1]}|${units}`,
    );
  }

  private renderRule() {
    const st = this.st;
    const r = st.company.autoSell[this.sel] ?? { enabled: false, minPrice: 0, keepReserve: 0 };
    const sig = `${this.sel}|${r.enabled}|${r.minPrice}|${r.keepReserve}`;
    if (sig === this.ruleSig) return;
    this.ruleSig = sig;
    clear(this.rule);
    const it = ITEMS[this.sel];
    const p = priceOf(st, this.sel);
    const cur = { ...r };
    const push = () => this.ui.dispatch({ type: 'market/setAutoSell', commodity: this.sel, enabled: cur.enabled, minPrice: cur.minPrice, keepReserve: cur.keepReserve });
    const en = toggle('Sell automatically at terminals', cur.enabled, (v) => { cur.enabled = v; push(); this.ui.sound('click'); });
    const minP = slider({ min: 0, max: Math.max(1, it.basePrice * 2), step: it.basePrice > 50 ? 0.5 : 0.05, value: cur.minPrice, format: (v) => (v > 0 ? `≥ ${price(v)}` : 'Any'), onChange: (v) => { cur.minPrice = v; push(); } });
    const reserve = slider({ min: 0, max: Math.max(1000, it.basePrice > 100 ? 5000 : 50000), step: 100, value: cur.keepReserve, format: (v) => (v > 0 ? compact(v) : 'None'), onChange: (v) => { cur.keepReserve = v; push(); } });
    this.rule.append(en.el, field(`Minimum price ($/${it.unit}) · spot ${price(p)}`, minP.el), field(`Keep in reserve (${it.unit})`, reserve.el));
  }

  private renderEvents() {
    const st = this.st;
    const sig = st.market.events.map((e) => `${e.id}:${e.endDay}`).join('|') + `@${st.time.day}`;
    if (sig !== this.eventsSig) {
      this.eventsSig = sig;
      clear(this.events);
      if (!st.market.events.length) this.events.appendChild(emptyState('globe', 'Markets are calm', 'World events will appear here.'));
      for (const e of st.market.events) this.events.appendChild(eventCard(e, st.time.day));
    }
    const hsig = st.market.hedges.map((x) => `${x.id}:${Math.round(x.remaining)}`).join('|');
    if (hsig !== this.hedgeSig) {
      this.hedgeSig = hsig;
      clear(this.hedges);
      if (st.market.hedges.length) {
        this.hedges.appendChild(h('div.section-title', { style: 'margin-top:.6rem' }, icon('shield'), 'Hedges'));
        for (const x of st.market.hedges) {
          const spot = priceOf(st, x.commodity);
          const mtm = (x.price - spot) * x.remaining;
          this.hedges.appendChild(h('div.mk-hedge', itemIconEl(x.commodity), h('div.col.grow', { style: 'gap:0' },
            h('div.small', `${itemQty(x.commodity, x.remaining, this.ui.units)} @ ${price(x.price)}`),
            h('div.tiny.dim', `Expires day ${x.expiryDay} · ${Math.max(0, x.expiryDay - st.time.day)} d left`)),
            h(`span.mono.small.${mtm >= 0 ? 'up' : 'down'}`, `${mtm >= 0 ? '+' : ''}${money(mtm)}`)));
        }
      }
    }
  }

  private sellDialog() {
    const st = this.st;
    const id = this.sel;
    const it = ITEMS[id];
    const hold = commodityHoldings(st, id);
    let source: 'warehouse' | 'network' = hold.warehouse >= hold.storage ? 'warehouse' : 'network';
    const avail = () => Math.floor(source === 'warehouse' ? hold.warehouse : hold.storage + hold.pipes);
    let qty = Math.min(avail(), Math.round(avail() / 2));
    const est = h('div.mk-est.mono');
    const qs = slider({ min: 0, max: Math.max(1, avail()), step: 1, value: qty, format: (v) => `${int(v)} ${it.unit}`, onInput: (v) => { qty = v; paintEst(); } });
    const paintEst = () => setText(est, `≈ ${money(qty * priceOf(st, id))}`);
    const src = segmented<'warehouse' | 'network'>([
      { value: 'warehouse', label: `Warehouse (${compact(hold.warehouse)})` },
      { value: 'network', label: `Tanks & pipes (${compact(hold.storage + hold.pipes)})` },
    ], source, (v) => { source = v; qs.setRange(0, Math.max(1, avail())); qty = Math.min(qty, avail()); qs.input.value = String(qty); qs.input.dispatchEvent(new Event('input')); });
    paintEst();
    this.ui.modal({
      title: `Sell ${it.name}`, icon: 'coin', width: '30rem',
      body: h('div.col', { style: 'gap:.9rem' },
        h('div.row', itemIconEl(id), h('div.col', { style: 'gap:0' }, h('b', it.name), h('span.dim.small', `Spot ${unitPrice(id, priceOf(st, id), this.ui.units)}`))),
        field('Source', src.el),
        field('Quantity', qs.el),
        h('div.row.between', h('span.dim', 'Estimated proceeds'), est),
        h('div.tiny.dim', 'Warehouse sales go by third-party truck at a small discount. Large volumes move the price against you.')),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Sell', icon: 'coin', variant: 'primary', disabled: () => false, onClick: () => {
          if (qty <= 0) return false;
          const r = this.ui.dispatch({ type: 'market/sell', commodity: id, quantity: qty, source }, { successSound: 'cash' });
          if (r.ok) this.ui.toast('success', `Sold ${int(qty)} ${it.unit} of ${it.name}`, `≈ ${money(qty * priceOf(st, id))}`, { icon: 'coin' });
          return r.ok;
        } },
      ],
    });
  }

  private hedgeDialog() {
    const st = this.st;
    const id = this.sel;
    const it = ITEMS[id];
    let volume = 10000;
    let days = 30;
    const summary = h('div.mono.small');
    const paint = () => setText(summary, `Lock ${int(volume)} ${it.unit} at ${price(priceOf(st, id))} for ${days} days · notional ${money(volume * priceOf(st, id))}`);
    paint();
    this.ui.modal({
      title: `Hedge ${it.name}`, icon: 'shield', width: '30rem',
      body: h('div.col', { style: 'gap:.9rem' },
        h('p.md-text', 'A swap locks today’s price for future sales. If the market falls you are protected; if it rises you give up the upside. A 2% fee applies.'),
        field('Volume', slider({ min: 1000, max: 200000, step: 1000, value: volume, format: (v) => `${compact(v)} ${it.unit}`, onInput: (v) => { volume = v; paint(); } }).el),
        field('Tenor', slider({ min: 7, max: 180, step: 1, value: days, format: (v) => `${v} days`, onInput: (v) => { days = v; paint(); } }).el),
        summary),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Place hedge', icon: 'shield', variant: 'primary', onClick: () => this.ui.dispatch({ type: 'market/hedge', commodity: id, volume, days }, { successSound: 'success' }).ok },
      ],
    });
  }

  update() {
    const st = this.st;
    this.table.update(MARKET_IDS);
    const p = priceOf(st, this.sel);
    const ch = priceChange(st, this.sel);
    setText(this.selPrice, unitPrice(this.sel, p, this.ui.units));
    setText(this.selChg, signedPct(ch, 2));
    this.selChg.className = `mk-selchg mono ${ch > 0 ? 'up' : ch < 0 ? 'down' : 'dim'}`;
    const hist = tail(st.market.history[this.sel], Number(this.range));
    const hi = Math.max(...hist, p);
    const lo = Math.min(...hist, p);
    const hold = commodityHoldings(st, this.sel);
    const ev = st.market.events.filter((e) => e.effects[this.sel]).reduce((a, e) => a * e.effects[this.sel], 1);
    const sig = `${this.sel}|${hist.length}|${Math.round(hold.total)}|${ev}|${st.market.soldToday[this.sel] ?? 0}`;
    if (this.selStats.dataset.sig !== sig) {
      this.selStats.dataset.sig = sig;
      clear(this.selStats);
      const stat = (k: string, v: string, cls = '') => h('div.mk-stat', h('span.label', k), h(`span.mono${cls ? '.' + cls : ''}`, v));
      this.selStats.append(
        stat(`${this.range}D high`, price(hi)), stat(`${this.range}D low`, price(lo)),
        stat('Base', price(ITEMS[this.sel].basePrice)),
        stat('Held', itemQty(this.sel, hold.total, this.ui.units)),
        stat('Value', money(hold.total * p)),
        stat('Demand', pct(st.market.demand[this.sel] ?? 1), (st.market.demand[this.sel] ?? 1) >= 1 ? 'up' : 'down'),
        ev !== 1 ? stat('Events', `${ev > 1 ? '+' : ''}${Math.round((ev - 1) * 100)}%`, ev > 1 ? 'up' : 'down') : stat('Sold today', itemQty(this.sel, st.market.soldToday[this.sel] ?? 0, this.ui.units)));
    }
    this.drawChart();
    this.renderRule();
    this.renderEvents();
  }

  destroy() {
    this.chart.destroy();
  }
}

export function eventCard(e: MarketEvent, day: number): HTMLElement {
  const left = Math.max(0, e.endDay - day);
  const sev = e.severity === 'crisis' ? 'danger' : e.severity === 'major' ? 'warn' : 'info';
  return h(`div.mk-event.sev-${sev}`,
    h('div.row', h('div.mk-evtitle.grow', e.title), chip(e.severity, sev === 'warn' ? 'warn' : sev)),
    h('div.mk-evdesc', e.description),
    h('div.mk-effects', Object.entries(e.effects).map(([k, m]) => h(`span.mk-eff.${m >= 1 ? 'up' : 'down'}`, icon(m >= 1 ? 'tri-up' : 'tri-down'), `${ITEMS[k]?.name ?? k} ${m >= 1 ? '+' : '−'}${Math.abs(Math.round((m - 1) * 100))}%`))),
    h('div.mk-evtime', h('div.bar.thin', h('i', { style: { width: `${Math.min(100, (1 - left / Math.max(1, e.endDay - e.startDay)) * 100)}%` } })), h('span.tiny.dim', `${left} days left`)));
}
