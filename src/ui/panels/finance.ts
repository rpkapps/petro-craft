// Finance (F): cash & net worth, daily revenue/expense stacked chart, P&L by category, loans, ledger.
import { h, clear, KeyedList } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, emptyState, field, kpi, segmented, slider, type KpiCtl } from '../core/components';
import { BarChart } from '../charts/BarChart';
import { amortisedPayment, loanRate, maxLoan } from '../../sim/economy';
import type { DailyFinance, LedgerCategory, LedgerEntry, Loan } from '../../core/types';
import { dayLabel, formatClock, money, moneyFull, signedMoney, pct, titleCase } from '../format';

export const CATEGORY_COLORS: Record<LedgerCategory, string> = {
  sales: '#3ddc84', contracts: '#2ad0e0', construction: '#ff8a1f', drilling: '#ffb35c', opex: '#ff6a6a', wages: '#f472b6',
  supplies: '#c9a44a', research: '#60a5fa', leases: '#38bdf8', royalties: '#fb7185', fines: '#ff4d4f', interest: '#a78bfa',
  loan: '#8b95a3', repairs: '#fbbf24', insurance: '#94a3b8', transport: '#818cf8', fuel: '#f59e0b', survey: '#22d3ee', carbon: '#10b981', misc: '#cbd5e1',
};
const CAT_NAMES: Partial<Record<LedgerCategory, string>> = { opex: 'Operating costs', misc: 'Other', loan: 'Loans (financing)' };
const catName = (c: string) => CAT_NAMES[c as LedgerCategory] ?? titleCase(c);

type Range = '30' | '90';

export class FinancePanel extends Panel {
  readonly id = 'finance' as const;
  private kCash!: KpiCtl;
  private kWorth!: KpiCtl;
  private kToday!: KpiCtl;
  private k30!: KpiCtl;
  private kDebt!: KpiCtl;
  private chart!: BarChart;
  private range: Range = '30';
  private pnl!: HTMLElement;
  private pnlSig = '';
  private loans!: HTMLElement;
  private loanSig = '';
  private ledger!: KeyedList<LedgerEntry & { k: string }>;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Finance', 'bank', 'xl');
  }

  private get st() {
    return this.ui.game.state;
  }

  protected build() {
    this.kCash = kpi('Cash', 'coin', '#ff8a1f');
    this.kWorth = kpi('Net worth', 'bank', '#2ad0e0');
    this.kToday = kpi('Today', 'calendar', '#3ddc84');
    this.k30 = kpi('Last 30 days', 'chart', '#a78bfa');
    this.kDebt = kpi('Debt', 'contract', '#ff4d4f');
    this.chart = new BarChart({ colors: CATEGORY_COLORS, names: Object.fromEntries(Object.keys(CATEGORY_COLORS).map((k) => [k, catName(k)])), yFormat: (v) => money(v, 0) });
    const seg = segmented<Range>([{ value: '30', label: '30D' }, { value: '90', label: '90D' }], this.range, (v) => { this.ui.sound('click'); this.range = v; this.drawChart(); });
    this.pnl = h('div.fn-pnl');
    this.loans = h('div.fn-loans');
    const ledgerBox = h('div.fn-ledger');
    this.ledger = new KeyedList(ledgerBox, (e) => e.k, (e) => {
      const node = h('div.fn-lrow',
        h('span.mono.tiny.dim', `${dayLabel(this.st, e.day)} ${formatClock(e.minute)}`),
        h('span.fn-cat', { style: { '--c': CATEGORY_COLORS[e.category] ?? '#888' } }, catName(e.category)),
        h('span.grow.ellipsis.small', e.note),
        h(`span.mono.small.${e.amount >= 0 ? 'up' : 'down'}`, signedMoney(e.amount)));
      return { node, update: () => {} };
    });
    this.body.append(
      h('div.kpis', this.kCash.el, this.kWorth.el, this.kToday.el, this.k30.el, this.kDebt.el),
      h('div.fn-grid',
        h('div.card.fn-chartcard', h('div.row', h('div.section-title.grow', { style: 'margin:0' }, icon('chart'), 'Daily revenue & expenses'), seg.el), h('div.fn-chart', this.chart.el), this.legend()),
        h('div.card.fn-pnlcard', h('div.section-title', icon('bank'), 'Profit & loss'), this.pnl),
        h('div.card.fn-loancard', h('div.section-title', icon('contract'), 'Loans'), this.loans),
        h('div.card.fn-ledgercard', h('div.section-title', icon('menu'), 'Recent transactions'), h('div.scroll.fn-ledgerscroll', ledgerBox))));
    this.drawChart();
    this.update();
  }

  private legend(): HTMLElement {
    const cats: LedgerCategory[] = ['sales', 'contracts', 'drilling', 'construction', 'opex', 'wages', 'royalties', 'supplies'];
    return h('div.fn-legend', cats.map((c) => h('span', h('i', { style: { background: CATEGORY_COLORS[c] } }), catName(c))), h('span', h('i.line'), 'Net'));
  }

  private days(): DailyFinance[] {
    return this.st.company.history.slice(-Number(this.range));
  }

  private drawChart() {
    const d = this.days();
    const bars = d.map((x) => {
      const parts: Record<string, number> = {};
      for (const [k, v] of Object.entries(x.byCategory)) if (k !== 'loan' && v) parts[k] = v;
      return { label: dayLabel(this.st, x.day), parts };
    });
    const net = bars.map((b) => Object.values(b.parts).reduce((a, v) => a + v, 0));
    this.chart.setData(bars, `${this.range}|${d.length}|${d[d.length - 1]?.day}`, { name: 'Net', color: '#ffffff', values: net });
  }

  private sumRange(n: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of this.st.company.history.slice(-n)) for (const [k, v] of Object.entries(x.byCategory)) out[k] = (out[k] ?? 0) + (v ?? 0);
    return out;
  }

  private renderPnl() {
    const c = this.st.company;
    const today = c.today.byCategory;
    const d7 = this.sumRange(7);
    const d30 = this.sumRange(30);
    const sig = `${c.history.length}|${Math.round(c.today.revenue)}|${Math.round(c.today.expenses)}`;
    if (sig === this.pnlSig) return;
    this.pnlSig = sig;
    clear(this.pnl);
    const cats = [...new Set([...Object.keys(today), ...Object.keys(d7), ...Object.keys(d30)])].filter((k) => k !== 'loan');
    const rev = cats.filter((k) => (d30[k] ?? 0) + (today[k as LedgerCategory] ?? 0) > 0).sort((a, b) => (d30[b] ?? 0) - (d30[a] ?? 0));
    const exp = cats.filter((k) => !rev.includes(k)).sort((a, b) => (d30[a] ?? 0) - (d30[b] ?? 0));
    const row = (k: string, cls = '') => h(`div.fn-prow${cls}`, h('span.fn-pname', h('i', { style: { background: CATEGORY_COLORS[k as LedgerCategory] ?? '#888' } }), catName(k)),
      ...[today[k as LedgerCategory] ?? 0, d7[k] ?? 0, d30[k] ?? 0].map((v) => h(`span.mono.${v > 0 ? 'up' : v < 0 ? 'down' : 'dim'}`, v ? money(v) : '—')));
    const total = (label: string, keys: string[], cls: string) => h(`div.fn-prow.total${cls}`, h('span.fn-pname', label),
      ...[today, d7, d30].map((src) => { const v = keys.reduce((a, k) => a + ((src as Record<string, number>)[k] ?? 0), 0); return h(`span.mono.${v >= 0 ? 'up' : 'down'}`, money(v)); }));
    this.pnl.append(
      h('div.fn-prow.head', h('span'), h('span', 'Today'), h('span', '7 days'), h('span', '30 days')),
      ...rev.map((k) => row(k)), total('Revenue', rev, ''),
      ...exp.map((k) => row(k)), total('Expenses', exp, ''),
      total('Net profit', [...rev, ...exp], '.net'));
  }

  private renderLoans() {
    const c = this.st.company;
    const sig = c.loans.map((l) => `${l.id}:${Math.round(l.balance)}`).join('|');
    if (sig === this.loanSig) return;
    this.loanSig = sig;
    clear(this.loans);
    const rate = loanRate(this.st);
    for (const l of c.loans) this.loans.appendChild(this.loanRow(l));
    if (!c.loans.length) this.loans.appendChild(h('div.dim.small', { style: 'padding:.3rem 0 .6rem' }, 'No outstanding loans.'));
    this.loans.appendChild(button('Take a loan…', { icon: 'plus', variant: 'teal', size: 'sm', block: true, onClick: () => this.loanDialog(rate) }));
  }

  private loanRow(l: Loan): HTMLElement {
    const left = Math.max(0, l.takenDay + l.termDays - this.st.time.day);
    return h('div.fn-loan',
      h('div.row', h('b.mono', money(l.balance)), h('span.dim.small', `of ${money(l.principal)}`), h('span.sp'), h('span.mono.small', `${pct(l.rate, 1)} APR`)),
      h('div.bar.thin.teal', h('i', { style: { width: `${(1 - l.balance / Math.max(1, l.principal)) * 100}%` } })),
      h('div.row.small.dim', h('span', `${money(l.dailyPayment)}/day`), h('span', '·'), h('span', `${left} days left`), h('span.sp'),
        button('Repay…', { size: 'xs', onClick: () => this.repayDialog(l) })));
  }

  private loanDialog(rate: number) {
    let amount = 1_000_000;
    let term = 365;
    const preview = h('div.fn-preview');
    const cap = maxLoan(this.st, this.ui.game.services.economy.netWorth());
    if (cap < 100_000) {
      this.ui.toast('warning', 'Credit limit reached', 'Repay existing loans or grow your net worth and reputation to borrow more.', { icon: 'bank' });
      return;
    }
    amount = Math.min(amount, cap);
    const paint = () => {
      const daily = amortisedPayment(amount, rate, term);
      preview.replaceChildren(
        h('div.row.between', h('span.dim', 'Interest rate'), h('b.mono', `${pct(rate, 1)} APR`)),
        h('div.row.between', h('span.dim', 'Daily repayment'), h('b.mono', money(daily))),
        h('div.row.between', h('span.dim', 'Total repaid'), h('b.mono', money(daily * term))),
        h('div.row.between', h('span.dim', 'Credit available'), h('b.mono', money(cap))));
    };
    paint();
    this.ui.modal({
      title: 'Take a loan', icon: 'bank', width: '30rem',
      body: h('div.col', { style: 'gap:.9rem' },
        field('Amount', slider({ min: Math.min(100_000, cap), max: cap, step: 10_000, value: amount, format: (v) => money(v), onInput: (v) => { amount = v; paint(); } }).el),
        field('Term', segmented<string>([{ value: '90', label: '90 d' }, { value: '180', label: '180 d' }, { value: '365', label: '1 yr' }, { value: '730', label: '2 yr' }], String(term), (v) => { term = Number(v); paint(); }).el),
        preview,
        h('div.tiny.dim', 'Repayments are deducted daily. Missing payments hurts your credit rating and reputation.')),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Borrow', icon: 'coin', variant: 'primary', onClick: () => {
          const r = this.ui.dispatch({ type: 'finance/takeLoan', amount, termDays: term }, { successSound: 'cash' });
          if (r.ok) this.ui.toast('success', `Loan of ${money(amount)} received`, `${term} days at ${pct(rate, 1)}`, { icon: 'bank' });
          return r.ok;
        } },
      ],
    });
  }

  private repayDialog(l: Loan) {
    let amount = Math.min(l.balance, Math.max(0, this.st.company.money));
    const max = Math.max(1, Math.min(l.balance, Math.max(0, this.st.company.money)));
    this.ui.modal({
      title: 'Repay loan', icon: 'bank', width: '28rem',
      body: h('div.col', { style: 'gap:.9rem' },
        h('div.row.between', h('span.dim', 'Outstanding'), h('b.mono', moneyFull(l.balance))),
        field('Repayment', slider({ min: 0, max, step: Math.max(1, Math.round(max / 200)), value: amount, format: (v) => money(v), onInput: (v) => { amount = v; } }).el)),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Repay', icon: 'check', variant: 'primary', onClick: () => this.ui.dispatch({ type: 'finance/repayLoan', loanId: l.id, amount }, { successSound: 'cash' }).ok },
      ],
    });
  }

  update() {
    const st = this.st;
    const c = st.company;
    this.kCash.set(money(c.money, 2), moneyFull(c.money), c.money < 0 ? 'danger' : '');
    const worth = this.ui.game.services.economy.netWorth();
    const hist = st.stats.companyValueHistory;
    const prevWorth = hist.length > 30 ? hist[hist.length - 31] : hist[0];
    this.kWorth.set(money(worth, 2), prevWorth ? `${signedMoney(worth - prevWorth)} in 30 days` : 'assets − debt');
    const todayNet = Object.entries(c.today.byCategory).filter(([k]) => k !== 'loan').reduce((a, [, v]) => a + (v ?? 0), 0);
    this.kToday.set(signedMoney(todayNet), `${money(c.today.revenue)} in · ${money(c.today.expenses)} out`, todayNet >= 0 ? 'ok' : 'danger');
    const d30 = this.sumRange(30);
    const net30 = Object.entries(d30).filter(([k]) => k !== 'loan').reduce((a, [, v]) => a + v, 0);
    this.k30.set(signedMoney(net30), `${money(Math.max(0, d30.sales ?? 0))} sales`, net30 >= 0 ? 'ok' : 'danger');
    const debt = c.loans.reduce((a, l) => a + l.balance, 0);
    this.kDebt.set(money(debt), c.loans.length ? `${money(c.loans.reduce((a, l) => a + l.dailyPayment, 0))}/day repayments` : 'Debt-free');
    this.drawChart();
    this.renderPnl();
    this.renderLoans();
    const seen = new Map<string, number>();
    const led = c.ledger.slice(-60).reverse().map((e) => {
      const base = `${e.day}|${e.minute}|${e.amount.toFixed(2)}|${e.note}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...e, k: `${base}#${n}` };
    });
    this.ledger.sync(led);
    if (!led.length && !this.body.querySelector('.fn-ledger .empty')) this.body.querySelector('.fn-ledger')?.appendChild(emptyState('menu', 'No transactions yet'));
  }

  destroy() {
    this.chart.destroy();
  }
}
