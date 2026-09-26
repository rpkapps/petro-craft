// Contracts (K): offers (price vs spot premium, bonus/penalty, deadline, reputation), active deliveries
// with progress and countdown, and history.
import { h, clear, setText, setBar, bar, toggleClass, KeyedList } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, emptyState, tabs, SortableTable, type TabsCtl } from '../core/components';
import { ITEMS } from '../../content/items';
import type { Contract } from '../../core/types';
import { itemIconEl } from '../render/itemIcons';
import { priceOf } from '../game';
import { itemQty, money, signedPct, unitPrice, daysLeft, int } from '../format';

type Tab = 'offers' | 'active' | 'history';

function clientBadge(name: string): HTMLElement {
  let hsh = 0;
  for (let i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hsh) % 360;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return h('div.ct-badge', { style: { background: `linear-gradient(135deg, hsl(${hue},55%,42%), hsl(${(hue + 40) % 360},60%,28%))` } }, initials);
}

export class ContractsPanel extends Panel {
  readonly id = 'contracts' as const;
  private tab: Tab = 'offers';
  private tabCtl!: TabsCtl<Tab>;
  private content!: HTMLElement;
  private rep!: HTMLElement;
  private offers: KeyedList<Contract> | null = null;
  private active: KeyedList<Contract> | null = null;
  private history: SortableTable<Contract> | null = null;
  private emptyEl: HTMLElement | null = null;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Contracts', 'contract', 'lg');
    const st = ui.game.state;
    this.tab = typeof args.tab === 'string' ? (args.tab as Tab) : st.contracts.active.length && !st.contracts.offers.length ? 'active' : 'offers';
  }

  protected build() {
    this.tabCtl = tabs<Tab>([
      { value: 'offers', label: 'Offers', icon: 'handshake' },
      { value: 'active', label: 'Active', icon: 'truck' },
      { value: 'history', label: 'History', icon: 'clock' },
    ], this.tab, (v) => { this.ui.sound('click'); this.tab = v; this.render(); });
    this.tabsEl.appendChild(this.tabCtl.el);
    this.rep = h('span.mono');
    this.actionsEl.append(h('div.bd-cash', icon('star'), h('span.dim', 'Reputation'), this.rep));
    this.content = h('div');
    this.body.appendChild(this.content);
    this.render();
  }

  private get st() {
    return this.ui.game.state;
  }

  private render() {
    clear(this.content);
    this.offers = this.active = null;
    this.history = null;
    this.emptyEl = null;
    if (this.tab === 'offers') {
      const grid = h('div.ct-grid');
      this.offers = new KeyedList<Contract>(grid, (c) => c.id, (c) => this.offerCard(c));
      this.content.append(h('div.tiny.dim', { style: 'margin-bottom:.6rem' }, 'Offers expire after a few days. Deliveries are drawn from terminal sales of the contracted commodity.'), grid);
    } else if (this.tab === 'active') {
      const list = h('div.col', { style: 'gap:.6rem' });
      this.active = new KeyedList<Contract>(list, (c) => c.id, (c) => this.activeRow(c));
      this.content.append(list);
    } else {
      this.history = new SortableTable<Contract>([
        { key: 'title', label: 'Contract', sort: (c) => c.title, cell: (c, td) => { td.append(h('div.row', clientBadge(c.client), h('div.col', { style: 'gap:0' }, h('b', c.title), h('span.tiny.dim', c.client)))); return () => {}; } },
        { key: 'com', label: 'Commodity', sort: (c) => c.commodity, cell: (c, td) => { td.append(h('div.row', itemIconEl(c.commodity), ITEMS[c.commodity]?.name ?? c.commodity)); return () => {}; } },
        { key: 'del', label: 'Delivered', align: 'right', cls: 'num', sort: (c) => c.delivered / Math.max(1, c.quantity), cell: (c, td) => { setText(td, `${itemQty(c.commodity, c.delivered, this.ui.units)} / ${itemQty(c.commodity, c.quantity, this.ui.units)}`); return () => {}; } },
        { key: 'val', label: 'Value', align: 'right', cls: 'num', sort: (c) => c.delivered * c.pricePerUnit, cell: (c, td) => { setText(td, money(c.delivered * c.pricePerUnit + (c.status === 'completed' ? c.bonus : -c.penalty))); return () => {}; } },
        { key: 'st', label: 'Result', sort: (c) => c.status, cell: (c, td) => { td.appendChild(chip(c.status, c.status === 'completed' ? 'ok' : c.status === 'failed' ? 'danger' : 'muted')); return () => {}; } },
        { key: 'day', label: 'Deadline', align: 'right', cls: 'num', sort: (c) => c.deadlineDay, cell: (c, td) => { setText(td, `Day ${c.deadlineDay}`); return () => {}; } },
      ], (c) => c.id, { sortKey: 'day', sortDir: -1 });
      this.content.append(h('div.card', { style: 'padding:0' }, this.history.el));
    }
    this.update();
  }

  private offerCard(c0: Contract) {
    let c = c0;
    const prem = h('span.mono');
    const dl = h('span');
    const acceptBtn = button('Accept', { icon: 'check', variant: 'primary', size: 'sm', onClick: () => {
      const r = this.ui.dispatch({ type: 'contract/accept', contractId: c.id }, { successSound: 'success' });
      if (r.ok) this.ui.toast('success', 'Contract accepted', `${c.title} — ${c.client}`, { icon: 'handshake' });
    } });
    const repLine = h('div.ct-rep');
    const node = h('div.card.ct-offer',
      h('div.ct-top', clientBadge(c.client), h('div.col.grow', { style: 'gap:0;min-width:0' }, h('div.ct-title.ellipsis', c.title), h('div.tiny.dim.ellipsis', c.client)), c.premium ? chip('Premium', 'accent', true) : null),
      c.description ? h('div.ct-desc', c.description) : null,
      h('div.ct-com', itemIconEl(c.commodity), h('div.col', { style: 'gap:0' }, h('b', itemQty(c.commodity, c.quantity, this.ui.units)), h('span.tiny.dim', ITEMS[c.commodity]?.name ?? c.commodity))),
      h('div.ct-terms',
        h('div', h('span.label', 'Price'), h('b.mono', unitPrice(c.commodity, c.pricePerUnit, this.ui.units)), prem),
        h('div', h('span.label', 'Contract value'), h('b.mono', money(c.pricePerUnit * c.quantity))),
        h('div', h('span.label', 'Bonus'), h('b.mono.ok', `+${money(c.bonus)}`)),
        h('div', h('span.label', 'Penalty'), h('b.mono.danger', `−${money(c.penalty)}`))),
      h('div.ct-foot', h('div.col', { style: 'gap:.1rem' }, h('span.row.small', icon('clock'), dl), repLine), h('span.sp'), acceptBtn));
    return {
      node,
      update: (x: Contract) => {
        c = x;
        const spot = priceOf(this.st, x.commodity);
        const p = spot ? x.pricePerUnit / spot - 1 : 0;
        setText(prem, ` ${signedPct(p, 0)} vs spot`);
        prem.className = `mono small ${p >= 0 ? 'up' : 'down'}`;
        setText(dl, `Deliver within ${Math.max(0, x.deadlineDay - this.st.time.day)} days`);
        const ok = this.st.company.reputation >= x.minReputation;
        repLine.replaceChildren(icon('star'), h('span', `Min. reputation ${x.minReputation}`));
        toggleClass(repLine, 'danger', !ok);
        acceptBtn.disabled = !ok;
        acceptBtn.title = ok ? '' : `Requires reputation ${x.minReputation}`;
      },
    };
  }

  private activeRow(c0: Contract) {
    let c = c0;
    const b = bar(0, 'teal', 'thick');
    const prog = h('span.mono.small');
    const left = h('span.ct-left.mono');
    const payout = h('span.mono');
    const abandon = button(null, { icon: 'close', size: 'sm', variant: 'danger', title: 'Abandon contract', onClick: async () => {
      const ok = await this.ui.confirm({ title: 'Abandon contract?', text: `You will pay a ${money(c.penalty)} penalty and lose reputation with ${c.client}.`, confirm: 'Abandon', danger: true });
      if (ok) this.ui.dispatch({ type: 'contract/abandon', contractId: c.id });
    } });
    const node = h('div.card.ct-active',
      clientBadge(c.client),
      h('div.col.grow', { style: 'gap:.35rem;min-width:0' },
        h('div.row', h('b.ellipsis', c.title), h('span.tiny.dim', `· ${c.client}`), h('span.sp'), left),
        h('div.row', itemIconEl(c.commodity), h('div.grow', b), prog),
        h('div.row.small.dim', h('span', `${unitPrice(c.commodity, c.pricePerUnit, this.ui.units)}`), h('span', '·'), h('span', 'On completion '), payout)),
      abandon);
    return {
      node,
      update: (x: Contract) => {
        c = x;
        const f = x.delivered / Math.max(1, x.quantity);
        setBar(b, f);
        setText(prog, `${itemQty(x.commodity, x.delivered, this.ui.units)} / ${itemQty(x.commodity, x.quantity, this.ui.units)}`);
        const dleft = x.deadlineDay - this.st.time.day - this.st.time.minuteOfDay / 1440;
        setText(left, daysLeft(dleft));
        toggleClass(left, 'danger', dleft < 3);
        toggleClass(left, 'pulse', dleft < 1.5);
        setText(payout, `+${money(x.bonus)} bonus`);
      },
    };
  }

  update() {
    const st = this.st;
    setText(this.rep, int(st.company.reputation));
    this.tabCtl.setBadge('offers', st.contracts.offers.length ? String(st.contracts.offers.length) : '');
    this.tabCtl.setBadge('active', st.contracts.active.length ? String(st.contracts.active.length) : '');
    const list = this.tab === 'offers' ? st.contracts.offers : this.tab === 'active' ? st.contracts.active : st.contracts.completed;
    if (this.offers) this.offers.sync(st.contracts.offers);
    if (this.active) this.active.sync(st.contracts.active);
    if (this.history) this.history.update(st.contracts.completed);
    const empty = !list.length;
    if (empty && !this.emptyEl) {
      this.emptyEl = this.tab === 'offers' ? emptyState('handshake', 'No offers right now', 'Clients post new contracts every few days.') : this.tab === 'active' ? emptyState('truck', 'No active contracts', 'Accept an offer to lock in a premium price.') : emptyState('clock', 'No contract history yet');
      this.content.appendChild(this.emptyEl);
    } else if (!empty && this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
  }
}
