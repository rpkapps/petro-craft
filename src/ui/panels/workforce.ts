// Workforce (H): employees (portraits, skill, wage, morale, fatigue, assignment, fire), candidates (hire),
// auto-assign, housing and crew requirements by role.
import { h, clear, setText, setBar, bar, toggleClass, KeyedList } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, emptyState, kpi, segmented, SortableTable, stars, tabs, toggle, type KpiCtl, type TabsCtl, type ToggleCtl } from '../core/components';
import { BUILDINGS, type WorkerRole } from '../../content/buildings';
import type { BuildingState, Worker } from '../../core/types';
import { portraitUrl, ROLE_COLOR } from '../render/avatar';
import { assignedOfRole, buildingName, crewSummary, ROLES, ROLE_NAMES } from '../game';
import { money, int } from '../format';

type Tab = 'staff' | 'hire' | 'needs';
type RoleFilter = 'all' | WorkerRole;

function portrait(w: Worker, size = 'sm'): HTMLElement {
  return h(`div.wf-portrait.${size}`, { style: { '--role-c': ROLE_COLOR[w.role] } }, h('img', { src: portraitUrl(w.portraitSeed, w.role), alt: '', draggable: false }));
}
function roleTag(role: WorkerRole): HTMLElement {
  return h('span.wf-role', { style: { '--role-c': ROLE_COLOR[role] } }, h('i'), ROLE_NAMES[role]);
}

export class WorkforcePanel extends Panel {
  readonly id = 'workforce' as const;
  private tab: Tab = 'staff';
  private tabCtl!: TabsCtl<Tab>;
  private filter: RoleFilter = 'all';
  private content!: HTMLElement;
  private kHead!: KpiCtl;
  private kPay!: KpiCtl;
  private kMorale!: KpiCtl;
  private kHouse!: KpiCtl;
  private auto!: ToggleCtl;
  private staff: SortableTable<Worker> | null = null;
  private cands: KeyedList<Worker> | null = null;
  private needs: HTMLElement | null = null;
  private needsSig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Workforce', 'users', 'xl');
    if (typeof args.tab === 'string') this.tab = args.tab as Tab;
    if (typeof args.role === 'string') this.filter = args.role as WorkerRole;
  }

  private get st() {
    return this.ui.game.state;
  }

  protected build() {
    this.tabCtl = tabs<Tab>([
      { value: 'staff', label: 'Employees', icon: 'users' },
      { value: 'hire', label: 'Hiring', icon: 'user' },
      { value: 'needs', label: 'Crew Needs', icon: 'building' },
    ], this.tab, (v) => { this.ui.sound('click'); this.tab = v; this.render(); });
    this.tabsEl.appendChild(this.tabCtl.el);
    this.kHead = kpi('Employees', 'users', '#ff8a1f');
    this.kPay = kpi('Daily payroll', 'money', '#ff4d4f');
    this.kMorale = kpi('Avg. morale', 'heart', '#3ddc84');
    this.kHouse = kpi('Housing', 'house', '#2ad0e0');
    this.auto = toggle('Auto-assign new hires', this.st.workforce.autoAssign, (v) => { this.ui.dispatch({ type: 'worker/setAutoAssign', enabled: v }); this.ui.sound('click'); }, 'Fill understaffed buildings automatically');
    this.content = h('div.wf-content');
    this.body.append(h('div.wf-top', h('div.kpis.grow', this.kHead.el, this.kPay.el, this.kMorale.el, this.kHouse.el), h('div.card.wf-auto', this.auto.el)), this.content);
    this.render();
  }

  private render() {
    clear(this.content);
    this.staff = null;
    this.cands = null;
    this.needs = null;
    this.needsSig = '';
    if (this.tab === 'staff') {
      const seg = segmented<RoleFilter>([{ value: 'all', label: 'All' }, ...ROLES.map((r) => ({ value: r as RoleFilter, label: ROLE_NAMES[r] }))], this.filter, (v) => { this.ui.sound('click'); this.filter = v; this.update(); }, 'wf-filter');
      this.staff = new SortableTable<Worker>([
        { key: 'name', label: 'Name', sort: (w) => w.name, cell: (w, td) => { td.append(h('div.row', portrait(w), h('div.col', { style: 'gap:0' }, h('b', w.name), roleTag(w.role)))); return () => {}; } },
        { key: 'skill', label: 'Skill', sort: (w) => w.skill, cell: (_w, td) => { let last = -1; return (w) => { if (w.skill !== last) { last = w.skill; td.replaceChildren(stars(w.skill)); } }; } },
        { key: 'wage', label: 'Wage', align: 'right', cls: 'num', sort: (w) => w.wage, cell: (_w, td) => (w) => setText(td, `${money(w.wage)}/d`) },
        { key: 'morale', label: 'Morale', sort: (w) => w.morale, cell: (_w, td) => {
          const b = bar(0, 'ok');
          const t = h('span.mono.tiny');
          td.append(h('div.wf-meter', b, t));
          return (w) => { setBar(b, w.morale / 100); b.className = `bar ${w.morale >= 60 ? 'ok' : w.morale >= 35 ? 'warn' : 'danger'}`; setText(t, String(Math.round(w.morale))); };
        } },
        { key: 'fatigue', label: 'Fatigue', sort: (w) => w.fatigue, cell: (_w, td) => {
          const b = bar(0, 'warn');
          const t = h('span.mono.tiny');
          td.append(h('div.wf-meter', b, t));
          return (w) => { setBar(b, w.fatigue / 100); b.className = `bar ${w.fatigue < 50 ? 'teal' : w.fatigue < 80 ? 'warn' : 'danger'}`; setText(t, String(Math.round(w.fatigue))); };
        } },
        { key: 'assign', label: 'Assignment', sort: (w) => (w.assignedTo ? buildingName(this.st, this.st.buildings[w.assignedTo]) : '~'), cell: (w0, td) => {
          let w = w0;
          const sel = h<HTMLSelectElement>('select.select.sm.wf-assign');
          const fill = () => {
            const cur = w.assignedTo ?? '';
            clear(sel);
            sel.appendChild(h('option', { value: '' }, 'Unassigned'));
            for (const b of this.candidatesFor(w.role)) {
              const req = BUILDINGS[b.type]?.crew[w.role] ?? 0;
              const have = assignedOfRole(this.st, b, w.role);
              sel.appendChild(h('option', { value: b.id }, `${buildingName(this.st, b)} (${have}/${req})`));
            }
            if (cur && !sel.querySelector(`option[value="${cur}"]`)) sel.appendChild(h('option', { value: cur }, buildingName(this.st, this.st.buildings[cur])));
            sel.value = cur;
          };
          sel.addEventListener('mousedown', fill);
          sel.addEventListener('focus', fill);
          sel.addEventListener('change', () => {
            this.ui.dispatch({ type: 'worker/assign', workerId: w.id, buildingId: sel.value || null }, { successSound: 'click' });
            sel.blur();
          });
          sel.addEventListener('click', (e) => e.stopPropagation());
          td.appendChild(sel);
          let lastA = '~';
          return (x) => {
            w = x;
            if (document.activeElement === sel) return;
            const a = x.assignedTo ?? '';
            if (a !== lastA) {
              lastA = a;
              clear(sel);
              sel.appendChild(h('option', { value: a }, a ? buildingName(this.st, this.st.buildings[a]) : 'Unassigned'));
              sel.value = a;
            }
            toggleClass(sel, 'unassigned', !a);
          };
        } },
        { key: 'status', label: 'Status', cell: (_w, td) => {
          let last = '';
          return (w) => {
            const s = w.injured && w.injured > this.st.time.day ? `inj${w.injured}` : w.fatigue > 85 ? 'tired' : w.pinned ? 'pinned' : 'ok';
            if (s === last) return;
            last = s;
            td.replaceChildren(s.startsWith('inj') ? chip(`Injured · ${w.injured! - this.st.time.day} d`, 'danger') : s === 'tired' ? chip('Exhausted', 'warn') : s === 'pinned' ? chip('Pinned', 'accent', true) : chip('Fit', 'ok'));
          };
        } },
        { key: 'fire', label: '', align: 'right', cell: (w0, td) => {
          let w = w0;
          td.appendChild(button(null, { icon: 'logout', size: 'xs', variant: 'danger', title: 'Dismiss', onClick: async (e) => {
            e.stopPropagation();
            const ok = await this.ui.confirm({ title: `Dismiss ${w.name}?`, text: 'Severance pay applies and morale of the remaining crew drops slightly.', confirm: 'Dismiss', danger: true, icon: 'user' });
            if (ok) this.ui.dispatch({ type: 'worker/fire', workerId: w.id }, { successSound: 'click' });
          } }));
          return (x) => { w = x; };
        } },
      ], (w) => w.id, { sortKey: 'role', sortDir: 1 });
      this.content.append(h('div.row', { style: 'margin-bottom:.6rem' }, seg.el), h('div.card.wf-table', { style: 'padding:0' }, this.staff.el));
    } else if (this.tab === 'hire') {
      const grid = h('div.wf-cands');
      this.cands = new KeyedList<Worker>(grid, (w) => w.id, (w) => {
        const node = h('div.card.wf-cand',
          portrait(w, 'lg'),
          h('div.col', { style: 'gap:.15rem;align-items:center;text-align:center' }, h('b', w.name), roleTag(w.role), stars(w.skill)),
          h('div.wf-cwage', h('span.label', 'Wage'), h('b.mono', `${money(w.wage)}/day`)),
          button('Hire', { icon: 'plus', variant: 'primary', size: 'sm', block: true, onClick: () => {
            const r = this.ui.dispatch({ type: 'worker/hire', candidateId: w.id }, { successSound: 'success' });
            if (r.ok) this.ui.toast('success', `${w.name} hired`, ROLE_NAMES[w.role], { icon: 'user', ttl: 3 });
          } }));
        return { node, update: () => {} };
      });
      this.content.append(h('div.tiny.dim', { style: 'margin-bottom:.6rem' }, 'The candidate pool refreshes every few days. Field offices widen the pool; worker camps add housing.'), grid);
    } else {
      this.needs = h('div.wf-needs');
      this.content.append(this.needs);
    }
    this.update();
  }

  private candidatesFor(role: WorkerRole): BuildingState[] {
    return Object.values(this.st.buildings).filter((b) => (BUILDINGS[b.type]?.crew[role] ?? 0) > 0).sort((a, b) => buildingName(this.st, a).localeCompare(buildingName(this.st, b)));
  }

  private renderNeeds() {
    if (!this.needs) return;
    const st = this.st;
    const sum = crewSummary(st);
    const under = Object.values(st.buildings).filter((b) => b.constructionProgress >= 1).map((b) => {
      const miss = (Object.entries(BUILDINGS[b.type]?.crew ?? {}) as [WorkerRole, number][]).map(([r, n]) => [r, n - assignedOfRole(st, b, r)] as [WorkerRole, number]).filter(([, m]) => m > 0);
      return { b, miss };
    }).filter((x) => x.miss.length);
    const sig = JSON.stringify(sum) + under.map((u) => u.b.id + u.miss.join()).join();
    if (sig === this.needsSig) return;
    this.needsSig = sig;
    clear(this.needs);
    const grid = h('div.wf-rolegrid');
    for (const r of ROLES) {
      const s = sum[r];
      const short = Math.max(0, s.required - s.employed);
      const idle = Math.max(0, s.employed - s.assigned);
      grid.appendChild(h(`div.card.wf-rolecard${short ? '.short' : ''}`, { style: { '--role-c': ROLE_COLOR[r] } },
        h('div.row', roleTag(r), h('span.sp'), short ? chip(`Short ${short}`, 'danger') : chip('OK', 'ok')),
        h('div.wf-rolenums', h('div', h('span.label', 'Required'), h('b.mono', int(s.required))), h('div', h('span.label', 'Employed'), h('b.mono', int(s.employed))), h('div', h('span.label', 'Idle'), h(`b.mono${idle ? '.warn' : ''}`, int(idle)))),
        bar(s.required ? Math.min(1, s.assigned / s.required) : 1, short ? 'danger' : 'ok')));
    }
    const list = h('div.col', { style: 'gap:.35rem' });
    if (!under.length) list.appendChild(emptyState('check', 'Every building is fully staffed'));
    for (const u of under) {
      const row = h('button.wf-under', { type: 'button' },
        h('span.grow.ellipsis', buildingName(st, u.b)),
        h('span.row', { style: 'gap:.3rem' }, u.miss.map(([r, m]) => h('span.wf-miss', { style: { '--role-c': ROLE_COLOR[r] } }, `−${m} ${ROLE_NAMES[r]}`))),
        icon('chevron-right'));
      row.addEventListener('click', () => { this.ui.sound('click'); this.ui.open('inspector', { buildingId: u.b.id }, { stack: true }); });
      list.appendChild(row);
    }
    this.needs.append(h('div.section-title', icon('users'), 'By role'), grid, h('div.section-title', { style: 'margin-top:1rem' }, icon('warning'), 'Understaffed buildings'), list);
  }

  update() {
    const st = this.st;
    const wf = st.workforce;
    const n = wf.workers.length;
    this.kHead.set(int(n), `${wf.workers.filter((w) => !w.assignedTo).length} unassigned`);
    this.kPay.set(money(wf.workers.reduce((a, w) => a + w.wage, 0)), 'wages per day');
    const morale = n ? wf.workers.reduce((a, w) => a + w.morale, 0) / n : 0;
    this.kMorale.set(n ? `${Math.round(morale)}` : '—', morale >= 60 ? 'Content' : morale >= 35 ? 'Uneasy' : 'Unhappy', morale >= 60 ? 'ok' : morale >= 35 ? 'warn' : 'danger');
    this.kHouse.set(`${n} / ${wf.housing}`, n > wf.housing ? 'Overcrowded — build camps' : 'beds used', n > wf.housing ? 'danger' : '');
    this.auto.set(wf.autoAssign);
    this.tabCtl.setBadge('hire', wf.candidates.length ? String(wf.candidates.length) : '');
    if (this.staff) this.staff.update(this.filter === 'all' ? wf.workers : wf.workers.filter((w) => w.role === this.filter));
    if (this.cands) {
      this.cands.sync(wf.candidates);
      if (!wf.candidates.length && !this.content.querySelector('.empty')) this.content.appendChild(emptyState('user', 'No candidates available', 'Check back in a few days.'));
    }
    this.renderNeeds();
  }
}
