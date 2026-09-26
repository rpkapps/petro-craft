// Modal dialogs (confirmations, small forms) and toast notifications.
import { h, setText } from '../dom';
import { icon, type IconName } from '../icons';
import { button } from './components';
import type { ModalHandle, ModalOptions, UISound } from './host';
import type { NotificationLevel } from '../../core/types';

export class ModalLayer {
  readonly el: HTMLElement;
  private open: { handle: ModalHandle; opts: ModalOptions; refreshers: (() => void)[] }[] = [];

  constructor(parent: HTMLElement, private sound: (s: UISound) => void) {
    this.el = h('div.pc-modals');
    parent.appendChild(this.el);
  }

  get count() {
    return this.open.length;
  }

  show(opts: ModalOptions): ModalHandle {
    const refreshers: (() => void)[] = [];
    const actions = h('div.md-actions');
    const body = typeof opts.body === 'string' ? h('p.md-text', opts.body) : opts.body;
    const closeBtn = h<HTMLButtonElement>('button.ph-close', { type: 'button', title: 'Close' }, icon('close'));
    const box = h(
      `div.pc-modal.glass${opts.danger ? '.danger' : ''}`,
      { style: opts.width ? { width: opts.width } : undefined, role: 'alertdialog' },
      h('header.md-head', opts.icon ? h('div.ph-icon', icon(opts.icon)) : null, h('h3', opts.title), h('div.sp'), closeBtn),
      h('div.md-body', body),
      actions,
    );
    const wrap = h('div.pc-modal-wrap', box);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) handle.close();
    });
    let closed = false;
    const handle: ModalHandle = {
      el: box,
      close: () => {
        if (closed) return;
        closed = true;
        this.open = this.open.filter((m) => m.handle !== handle);
        wrap.classList.add('closing');
        window.setTimeout(() => wrap.remove(), 150);
        opts.onClose?.();
      },
      refresh: () => refreshers.forEach((r) => r()),
    };
    closeBtn.addEventListener('click', () => { this.sound('close'); handle.close(); });
    for (const a of opts.actions ?? [{ label: 'OK', variant: 'primary' as const }]) {
      const b = button(a.label, {
        icon: a.icon,
        variant: a.variant ?? '',
        onClick: async () => {
          this.sound('click');
          const r = await a.onClick?.();
          if (r !== false) handle.close();
        },
      });
      if (a.disabled) refreshers.push(() => { b.disabled = a.disabled!(); });
      actions.appendChild(b);
    }
    handle.refresh();
    this.el.appendChild(wrap);
    this.open.push({ handle, opts, refreshers });
    const first = box.querySelector<HTMLElement>('input, select, textarea');
    window.setTimeout(() => first?.focus(), 30);
    return handle;
  }

  closeTop(): boolean {
    const m = this.open[this.open.length - 1];
    if (!m) return false;
    m.handle.close();
    return true;
  }

  closeAll() {
    for (const m of [...this.open]) m.handle.close();
  }

  refreshAll() {
    for (const m of this.open) for (const r of m.refreshers) r();
  }
}

const LEVEL_ICON: Record<NotificationLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', danger: 'danger' };

export class ToastStack {
  readonly el: HTMLElement;
  private items: { el: HTMLElement; ttl: number; key: string; count: number }[] = [];

  constructor(parent: HTMLElement) {
    this.el = h('div.pc-toasts');
    parent.appendChild(this.el);
  }

  push(level: NotificationLevel, title: string, text?: string, opts: { icon?: IconName; onClick?: () => void; ttl?: number } = {}) {
    const key = `${level}|${title}|${text ?? ''}`;
    const dup = this.items.find((t) => t.key === key);
    if (dup) {
      dup.count++;
      dup.ttl = opts.ttl ?? 6;
      const badge = dup.el.querySelector('.t-count');
      setText(badge, `×${dup.count}`);
      badge?.classList.add('show');
      dup.el.classList.remove('bump');
      void dup.el.offsetWidth;
      dup.el.classList.add('bump');
      return;
    }
    const el = h(
      `div.pc-toast.lv-${level}${opts.onClick ? '.clickable' : ''}`,
      h('div.t-icon', icon(opts.icon ?? LEVEL_ICON[level])),
      h('div.t-main', h('div.t-title', title, h('span.t-count')), text ? h('div.t-text', text) : null),
      h('div.t-timer'),
    );
    const ttl = opts.ttl ?? (level === 'danger' ? 9 : 6);
    el.style.setProperty('--ttl', `${ttl}s`);
    const item = { el, ttl, key, count: 1 };
    el.addEventListener('click', () => {
      opts.onClick?.();
      item.ttl = 0;
    });
    this.el.prepend(el);
    this.items.unshift(item);
    while (this.items.length > 5) this.remove(this.items[this.items.length - 1]);
  }

  private remove(t: { el: HTMLElement }) {
    this.items = this.items.filter((i) => i !== t);
    t.el.classList.add('leaving');
    window.setTimeout(() => t.el.remove(), 260);
  }

  update(dt: number) {
    for (const t of [...this.items]) {
      if (t.el.matches(':hover')) continue;
      t.ttl -= dt;
      if (t.ttl <= 0) this.remove(t);
    }
  }

  clear() {
    for (const t of [...this.items]) this.remove(t);
  }
}
