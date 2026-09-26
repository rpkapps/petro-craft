// Modal panel framework: a glass window with header, optional tabs and a scrolling body.
// The PanelManager keeps a stack (e.g. Wells → Well detail); only the top panel is visible.
import { h, setText, clear } from '../dom';
import { icon, type IconName } from '../icons';
import type { PanelArgs, PanelId, UIHost } from './host';

export type PanelSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export abstract class Panel {
  abstract readonly id: PanelId;
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  protected titleEl: HTMLElement;
  protected subEl: HTMLElement;
  protected iconEl: HTMLElement;
  protected actionsEl: HTMLElement;
  protected tabsEl: HTMLElement;
  protected backBtn: HTMLButtonElement;
  /** Set true by panels that render their own scrolling regions. */
  protected fixedBody = false;
  private built = false;

  constructor(protected ui: UIHost, public args: PanelArgs, title: string, ic: IconName, size: PanelSize = 'lg') {
    this.iconEl = h('div.ph-icon', icon(ic));
    this.titleEl = h('h2.ph-title', title);
    this.subEl = h('div.ph-sub');
    this.actionsEl = h('div.ph-actions');
    this.tabsEl = h('div.ph-tabs');
    this.backBtn = h<HTMLButtonElement>('button.btn.ghost.sm.ph-back', { type: 'button', title: 'Back' }, icon('chevron-left'), h('span.lbl', 'Back'));
    this.backBtn.addEventListener('click', () => this.ui.close(this.id));
    const closeBtn = h<HTMLButtonElement>('button.ph-close', { type: 'button', title: 'Close (Esc)' }, icon('close'));
    closeBtn.addEventListener('click', () => this.ui.closeAll());
    this.head = h('header.ph', this.backBtn, this.iconEl, h('div.ph-titles', this.titleEl, this.subEl), this.tabsEl, h('div.sp'), this.actionsEl, h('span.kbd.ph-esc', 'Esc'), closeBtn);
    this.body = h('div.pb.scroll');
    this.el = h(`section.pc-panel.glass.size-${size}`, { role: 'dialog' }, this.head, this.body);
  }

  /** Build DOM into this.body (called once when first shown). */
  protected abstract build(): void;
  /** Periodic refresh (~4 Hz) while visible. */
  update(): void {}
  /** Per-frame hook for animations (dt seconds). */
  frame(_dt: number): void {}
  /** Called when the panel is re-opened with new args while already open. */
  setArgs(args: PanelArgs): void {
    this.args = args;
    this.rebuild();
  }
  /** Clean up listeners / timers. */
  destroy(): void {}
  /** Return true if the key was handled (prevents global hotkeys). */
  onKey(_e: KeyboardEvent): boolean {
    return false;
  }

  mount() {
    if (!this.built) {
      this.built = true;
      if (this.fixedBody) this.body.classList.add('fixed');
      this.build();
      this.update();
    }
  }

  protected rebuild() {
    clear(this.body);
    clear(this.tabsEl);
    clear(this.actionsEl);
    this.build();
    this.update();
  }

  setTitle(t: string) {
    setText(this.titleEl, t);
  }
  setSubtitle(t: string) {
    setText(this.subEl, t);
  }
  setIcon(ic: IconName) {
    clear(this.iconEl);
    this.iconEl.appendChild(icon(ic));
  }
  setBack(label: string | null) {
    this.backBtn.classList.toggle('show', !!label);
    if (label) setText(this.backBtn.querySelector('.lbl'), label);
  }
}

export type PanelFactory = (ui: UIHost, args: PanelArgs) => Panel;

export class PanelManager {
  readonly layer: HTMLElement;
  private stack: Panel[] = [];
  private factories = new Map<PanelId, PanelFactory>();
  private timer = 0;
  onChange: (() => void) | null = null;

  constructor(private ui: UIHost, parent: HTMLElement) {
    this.layer = h('div.pc-panels');
    this.layer.addEventListener('mousedown', (e) => {
      if (e.target === this.layer) this.ui.closeAll();
    });
    parent.appendChild(this.layer);
  }

  register(id: PanelId, f: PanelFactory) {
    this.factories.set(id, f);
  }

  get top(): Panel | undefined {
    return this.stack[this.stack.length - 1];
  }
  get depth() {
    return this.stack.length;
  }
  isOpen(id: PanelId) {
    return this.stack.some((p) => p.id === id);
  }
  ids(): PanelId[] {
    return this.stack.map((p) => p.id);
  }

  open(id: PanelId, args: PanelArgs = {}, stack = false): Panel | null {
    const top = this.top;
    if (top && top.id === id) {
      top.setArgs(args);
      return top;
    }
    const f = this.factories.get(id);
    if (!f) return null;
    if (!stack) this.clearAll();
    const p = f(this.ui, args);
    const below = this.top;
    if (below) below.el.classList.add('covered');
    p.setBack(below ? backLabel(below) : null);
    this.stack.push(p);
    this.layer.appendChild(p.el);
    try {
      p.mount();
    } catch (err) {
      console.error(`[UI] panel ${id} failed to build`, err);
    }
    this.layer.classList.add('open');
    this.onChange?.();
    return p;
  }

  /** Close the given panel (and everything above it), or the top one. */
  close(id?: PanelId) {
    if (!this.stack.length) return;
    let idx = this.stack.length - 1;
    if (id) {
      idx = this.stack.map((p) => p.id).lastIndexOf(id);
      if (idx < 0) return;
    }
    while (this.stack.length > idx) this.destroyTop();
    const t = this.top;
    if (t) {
      t.el.classList.remove('covered');
      t.update();
    }
    if (!this.stack.length) this.layer.classList.remove('open');
    this.onChange?.();
  }

  clearAll() {
    const had = this.stack.length > 0;
    while (this.stack.length) this.destroyTop();
    this.layer.classList.remove('open');
    if (had) this.onChange?.();
  }

  private destroyTop() {
    const p = this.stack.pop()!;
    try {
      p.destroy();
    } catch (err) {
      console.error(err);
    }
    p.el.classList.add('closing');
    const el = p.el;
    window.setTimeout(() => el.remove(), 160);
  }

  update(dt: number) {
    const t = this.top;
    if (!t) return;
    t.frame(dt);
    this.timer += dt;
    if (this.timer >= 0.25) {
      this.timer = 0;
      try {
        t.update();
      } catch (err) {
        console.error(`[UI] panel ${t.id} update failed`, err);
      }
    }
  }
}

function backLabel(p: Panel): string {
  return (p.el.querySelector('.ph-title')?.textContent ?? 'Back').trim();
}
