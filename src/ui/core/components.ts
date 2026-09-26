// Reusable UI controls. Each returns its root element plus a small imperative API for patching.
import { h, setText, toggleClass, setVariant, KeyedList, type Child } from '../dom';
import { icon, type IconName } from '../icons';
import { titleCase } from '../format';
import type { BuildingStatus, WellStatus } from '../../core/types';

export interface ButtonOpts {
  icon?: IconName;
  variant?: 'primary' | 'danger' | 'teal' | 'ghost' | 'active' | '';
  size?: 'xs' | 'sm' | 'lg' | '';
  title?: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  block?: boolean;
  kbd?: string;
  cls?: string;
}

export function button(label: string | null, opts: ButtonOpts = {}): HTMLButtonElement {
  const cls = ['btn', opts.variant, opts.size, opts.block ? 'block' : '', !label && opts.icon ? 'icon' : '', opts.cls].filter(Boolean).join('.');
  const b = h<HTMLButtonElement>(`button.${cls}`, { type: 'button', title: opts.title, disabled: !!opts.disabled });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(h('span.lbl', label));
  if (opts.kbd) b.appendChild(h('span.kbd', opts.kbd));
  if (opts.onClick) b.addEventListener('click', (e) => { if (!b.disabled) opts.onClick!(e); });
  return b;
}

export function setDisabled(el: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, disabled: boolean) {
  if (el.disabled !== disabled) el.disabled = disabled;
}

export function setLabel(btn: HTMLElement, text: string) {
  setText(btn.querySelector('.lbl'), text);
}

// ---- toggle ----------------------------------------------------------------------------------------
export interface ToggleCtl { el: HTMLElement; set(v: boolean): void; readonly value: boolean; setDisabled(d: boolean): void }
export function toggle(label: string | Node | null, value: boolean, onChange: (v: boolean) => void, sub?: string): ToggleCtl {
  let v = value;
  let disabled = false;
  const el = h('label.toggle', { role: 'switch', tabIndex: 0 }, h('span.track'), label ? h('span.col', { style: 'gap:0' }, h('span', label), sub ? h('span.tiny.dim', sub) : null) : null);
  const apply = () => {
    toggleClass(el, 'on', v);
    el.setAttribute('aria-checked', String(v));
  };
  const flip = (e: Event) => {
    e.preventDefault();
    if (disabled) return;
    v = !v;
    apply();
    onChange(v);
  };
  el.addEventListener('click', flip);
  el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).code === 'Space' || (e as KeyboardEvent).code === 'Enter') flip(e); });
  apply();
  return {
    el,
    set(nv: boolean) { if (nv !== v) { v = nv; apply(); } },
    get value() { return v; },
    setDisabled(d: boolean) { disabled = d; toggleClass(el, 'disabled', d); },
  };
}

// ---- slider ----------------------------------------------------------------------------------------
export interface SliderOpts {
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (v: number) => string;
  onInput?: (v: number) => void;
  onChange?: (v: number) => void;
  showValue?: boolean;
}
export interface SliderCtl { el: HTMLElement; input: HTMLInputElement; set(v: number): void; readonly value: number; setRange(min: number, max: number): void }
export function slider(o: SliderOpts): SliderCtl {
  const input = h<HTMLInputElement>('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 'any', value: o.value });
  const val = h('span.val');
  const el = h('div.range', input, o.showValue === false ? null : val);
  let dragging = false;
  const paint = () => {
    const v = Number(input.value);
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--pct', `${((v - min) / Math.max(1e-9, max - min)) * 100}%`);
    setText(val, o.format ? o.format(v) : String(v));
  };
  input.addEventListener('input', () => { paint(); o.onInput?.(Number(input.value)); });
  input.addEventListener('change', () => { dragging = false; o.onChange?.(Number(input.value)); });
  input.addEventListener('pointerdown', () => (dragging = true));
  input.addEventListener('pointerup', () => (dragging = false));
  paint();
  return {
    el,
    input,
    set(v: number) {
      if (dragging || document.activeElement === input) return;
      if (Number(input.value) !== v) { input.value = String(v); paint(); }
    },
    get value() { return Number(input.value); },
    setRange(min: number, max: number) { input.min = String(min); input.max = String(max); paint(); },
  };
}

// ---- segmented control / tabs ----------------------------------------------------------------------
export interface SegOption<T extends string> { value: T; label: string; icon?: IconName; disabled?: boolean; title?: string }
export interface SegCtl<T extends string> { el: HTMLElement; set(v: T): void; readonly value: T; setDisabled(v: T, d: boolean): void }
export function segmented<T extends string>(options: SegOption<T>[], value: T, onChange: (v: T) => void, cls = ''): SegCtl<T> {
  let cur = value;
  const btns = new Map<T, HTMLButtonElement>();
  const el = h(`div.seg${cls ? '.' + cls : ''}`);
  for (const o of options) {
    const b = h<HTMLButtonElement>('button', { type: 'button', title: o.title, disabled: !!o.disabled }, o.icon ? icon(o.icon) : null, o.label ? h('span', o.label) : null);
    b.addEventListener('click', () => {
      if (b.disabled || cur === o.value) return;
      cur = o.value;
      paint();
      onChange(o.value);
    });
    btns.set(o.value, b);
    el.appendChild(b);
  }
  const paint = () => { for (const [v, b] of btns) toggleClass(b, 'on', v === cur); };
  paint();
  return {
    el,
    set(v: T) { if (v !== cur) { cur = v; paint(); } },
    get value() { return cur; },
    setDisabled(v: T, d: boolean) { const b = btns.get(v); if (b && b.disabled !== d) b.disabled = d; },
  };
}

// ---- select ------------------------------------------------------------------------------------------
export function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, cls = ''): HTMLSelectElement {
  const el = h<HTMLSelectElement>(`select.select${cls ? '.' + cls : ''}`);
  for (const o of options) el.appendChild(h('option', { value: o.value }, o.label));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

export function field(label: string, control: Child, hint?: string): HTMLElement {
  return h('div.field', h('label', label), control, hint ? h('div.tiny.mute', hint) : null);
}

// ---- status chips -----------------------------------------------------------------------------------
const CHIP_VARIANTS = ['ok', 'warn', 'danger', 'info', 'teal', 'accent', 'muted'] as const;
type ChipVariant = (typeof CHIP_VARIANTS)[number];

const BUILDING_STATUS: Record<BuildingStatus, [string, ChipVariant, boolean?]> = {
  constructing: ['Building', 'info', true], active: ['Active', 'ok'], idle: ['Idle', 'muted'], disabled: ['Disabled', 'muted'],
  unstaffed: ['Unstaffed', 'warn'], no_power: ['No power', 'warn', true], broken: ['Broken', 'danger'], fire: ['On fire', 'danger', true],
  destroyed: ['Destroyed', 'danger'],
};
const WELL_STATUS: Record<WellStatus, [string, ChipVariant, boolean?]> = {
  planned: ['Planned', 'muted'], drilling: ['Drilling', 'accent', true], tripping: ['Tripping', 'accent'], casing: ['Casing', 'info', true],
  kick: ['Kick!', 'danger', true], blowout: ['Blowout', 'danger', true], drilled: ['Drilled', 'teal'], completing: ['Completing', 'info', true],
  fracking: ['Fracking', 'info', true], producing: ['Producing', 'ok'], injecting: ['Injecting', 'teal'], shut_in: ['Shut in', 'warn'],
  dry_hole: ['Dry hole', 'muted'], plugged: ['Plugged', 'muted'],
};

export function statusInfo(kind: 'building' | 'well', status: string): { label: string; variant: ChipVariant; pulse: boolean } {
  const t = (kind === 'building' ? (BUILDING_STATUS as Record<string, [string, ChipVariant, boolean?]>) : (WELL_STATUS as Record<string, [string, ChipVariant, boolean?]>))[status];
  if (!t) return { label: titleCase(status), variant: 'muted', pulse: false };
  return { label: t[0], variant: t[1], pulse: !!t[2] };
}

export interface ChipCtl { el: HTMLElement; set(status: string): void }
export function statusChip(kind: 'building' | 'well', status: string): ChipCtl {
  const el = h('span.chip');
  let cur = '';
  const set = (s: string) => {
    if (s === cur) return;
    cur = s;
    const i = statusInfo(kind, s);
    setVariant(el, CHIP_VARIANTS, i.variant);
    toggleClass(el, 'pulse', i.pulse);
    setText(el, i.label);
  };
  set(status);
  return { el, set };
}

export function chip(text: string, variant: ChipVariant | '' = '', noDot = false): HTMLElement {
  return h(`span.chip${variant ? '.' + variant : ''}${noDot ? '.no-dot' : ''}`, text);
}

// ---- KPI tile ------------------------------------------------------------------------------------
export interface KpiCtl { el: HTMLElement; set(value: string, sub?: string, cls?: string): void }
export function kpi(label: string, ic?: IconName, color?: string): KpiCtl {
  const v = h('div.v', '—');
  const sub = h('div.s', '');
  const el = h('div.kpi', { style: color ? { '--kpi-c': color } : undefined }, h('div.k', ic ? icon(ic) : null, label), v, sub);
  let lastCls = '';
  return {
    el,
    set(value: string, s?: string, cls = '') {
      setText(v, value);
      if (s !== undefined) setText(sub, s);
      if (cls !== lastCls) {
        if (lastCls) v.classList.remove(lastCls);
        if (cls) v.classList.add(cls);
        lastCls = cls;
      }
    },
  };
}

// ---- stars -------------------------------------------------------------------------------------------
export function stars(n: number, max = 5, cls = ''): HTMLElement {
  const el = h(`span.stars${cls ? '.' + cls : ''}`);
  for (let i = 0; i < max; i++) el.appendChild(icon(i < Math.round(n) ? 'star-fill' : 'star', i < Math.round(n) ? 'on' : ''));
  return el;
}

export function emptyState(ic: IconName, text: string, sub?: string): HTMLElement {
  return h('div.empty', icon(ic), h('div', text), sub ? h('div.tiny', sub) : null);
}

export function sectionTitle(text: string, ic?: IconName, right?: Child): HTMLElement {
  return h('div.section-title', ic ? icon(ic) : null, h('span', text), right ?? null);
}

// ---- sortable table ----------------------------------------------------------------------------------
export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  sort?: (row: T) => number | string;
  /** Create cell content once; returns an updater called on every refresh. */
  cell: (row: T, td: HTMLTableCellElement) => (row: T) => void;
  cls?: string;
}

export class SortableTable<T> {
  readonly el: HTMLTableElement;
  private body: HTMLTableSectionElement;
  private list: KeyedList<T, HTMLTableRowElement>;
  private sortKey: string | null;
  private sortDir: 1 | -1;
  private ths = new Map<string, HTMLTableCellElement>();
  private rows: readonly T[] = [];
  selectedKey: string | null = null;

  constructor(
    private columns: Column<T>[],
    private keyOf: (row: T) => string,
    opts: { sortKey?: string; sortDir?: 1 | -1; onRowClick?: (row: T) => void; rowClass?: (row: T) => string } = {},
  ) {
    this.sortKey = opts.sortKey ?? null;
    this.sortDir = opts.sortDir ?? -1;
    const headRow = h('tr');
    for (const c of columns) {
      const th = h<HTMLTableCellElement>(`th${c.align === 'right' ? '.right' : ''}${c.sort ? '.sortable' : ''}`, { style: c.width ? { width: c.width } : undefined }, c.label);
      if (c.sort) {
        th.addEventListener('click', () => {
          if (this.sortKey === c.key) this.sortDir = this.sortDir === 1 ? -1 : 1;
          else {
            this.sortKey = c.key;
            this.sortDir = -1;
          }
          this.paintHeads();
          this.update(this.rows);
        });
      }
      this.ths.set(c.key, th);
      headRow.appendChild(th);
    }
    this.body = h<HTMLTableSectionElement>('tbody');
    this.el = h<HTMLTableElement>('table.tbl', h('thead', headRow), this.body);
    this.list = new KeyedList<T, HTMLTableRowElement>(this.body, keyOf, (row) => {
      const tr = h<HTMLTableRowElement>(`tr${opts.onRowClick ? '.clickable' : ''}`);
      const updaters: ((r: T) => void)[] = [];
      for (const c of columns) {
        const td = h<HTMLTableCellElement>(`td${c.align === 'right' ? '.right' : c.align === 'center' ? '.center' : ''}${c.cls ? '.' + c.cls : ''}`);
        updaters.push(c.cell(row, td));
        tr.appendChild(td);
      }
      let current = row;
      if (opts.onRowClick) tr.addEventListener('click', () => opts.onRowClick!(current));
      return {
        node: tr,
        update: (r: T) => {
          current = r;
          for (const u of updaters) u(r);
          toggleClass(tr, 'sel', this.selectedKey === keyOf(r));
          if (opts.rowClass) {
            const rc = opts.rowClass(r);
            if (tr.dataset.rc !== rc) {
              if (tr.dataset.rc) tr.classList.remove(tr.dataset.rc);
              if (rc) tr.classList.add(rc);
              tr.dataset.rc = rc;
            }
          }
        },
      };
    });
    this.paintHeads();
  }

  private paintHeads() {
    for (const [k, th] of this.ths) {
      toggleClass(th, 'sorted', k === this.sortKey);
      const c = this.columns.find((x) => x.key === k)!;
      const arrow = k === this.sortKey ? (this.sortDir === 1 ? ' ▲' : ' ▼') : '';
      setText(th, c.label + arrow);
    }
  }

  update(rows: readonly T[]) {
    this.rows = rows;
    let sorted = rows;
    const col = this.columns.find((c) => c.key === this.sortKey);
    if (col?.sort) {
      const f = col.sort;
      const d = this.sortDir;
      sorted = [...rows].sort((a, b) => {
        const va = f(a);
        const vb = f(b);
        return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * d;
      });
    }
    this.list.sync(sorted);
  }

  get count() {
    return this.list.size;
  }
}

// ---- header tab bar -----------------------------------------------------------------------------------
export interface TabItem<T extends string> { value: T; label: string; icon?: IconName }
export interface TabsCtl<T extends string> { el: HTMLElement; set(v: T): void; readonly value: T; setBadge(v: T, text: string): void }
export function tabs<T extends string>(items: TabItem<T>[], value: T, onChange: (v: T) => void): TabsCtl<T> {
  let cur = value;
  const el = h('div.tabbar');
  const btns = new Map<T, { b: HTMLButtonElement; badge: HTMLElement }>();
  for (const it of items) {
    const badge = h('span.badge');
    const b = h<HTMLButtonElement>('button.tab', { type: 'button' }, it.icon ? icon(it.icon) : null, h('span', it.label), badge);
    b.addEventListener('click', () => {
      if (cur === it.value) return;
      cur = it.value;
      paint();
      onChange(it.value);
    });
    btns.set(it.value, { b, badge });
    el.appendChild(b);
  }
  const paint = () => { for (const [v, x] of btns) toggleClass(x.b, 'on', v === cur); };
  paint();
  return {
    el,
    set(v: T) { if (v !== cur) { cur = v; paint(); } },
    get value() { return cur; },
    setBadge(v: T, text: string) { setText(btns.get(v)?.badge, text); },
  };
}

/** Numeric input with min/max clamping. */
export function numberInput(value: number, opts: { min?: number; max?: number; step?: number; onChange: (v: number) => void; cls?: string }): HTMLInputElement {
  const el = h<HTMLInputElement>(`input.input${opts.cls ? '.' + opts.cls : ''}`, { type: 'number', value, min: opts.min, max: opts.max, step: opts.step ?? 1 });
  el.addEventListener('change', () => {
    let v = Number(el.value);
    if (!Number.isFinite(v)) v = value;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    el.value = String(v);
    opts.onChange(v);
  });
  return el;
}
