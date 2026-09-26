// Single floating tooltip element shared by the whole UI. Content may be a string or a builder.
import { h, clear } from '../dom';

export type TipContent = string | Node | (() => string | Node | null);

export class Tooltip {
  readonly el: HTMLElement;
  private owner: Element | null = null;
  private content: TipContent | null = null;
  private x = 0;
  private y = 0;
  private timer = 0;
  private bound = new WeakMap<Element, TipContent>();

  constructor(parent: HTMLElement) {
    this.el = h('div.pc-tooltip');
    parent.appendChild(this.el);
  }

  /** Attach a tooltip to an element. Calling again replaces the content. */
  attach(target: Element, content: TipContent) {
    const had = this.bound.has(target);
    this.bound.set(target, content);
    if (had) {
      if (this.owner === target) this.render();
      return;
    }
    target.addEventListener('mouseenter', (e) => this.enter(target, e as MouseEvent));
    target.addEventListener('mousemove', (e) => this.move(e as MouseEvent));
    target.addEventListener('mouseleave', () => this.leave(target));
    target.addEventListener('mousedown', () => this.leave(target));
  }

  /** Show immediately at a screen position (used by canvases). */
  showAt(x: number, y: number, content: TipContent) {
    this.owner = null;
    this.content = content;
    this.x = x;
    this.y = y;
    this.render();
    this.el.classList.add('show');
    this.position();
  }

  hide() {
    window.clearTimeout(this.timer);
    this.owner = null;
    this.el.classList.remove('show');
  }

  private enter(target: Element, e: MouseEvent) {
    this.owner = target;
    this.content = this.bound.get(target) ?? null;
    this.x = e.clientX;
    this.y = e.clientY;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.owner !== target) return;
      this.render();
      this.el.classList.add('show');
      this.position();
    }, 220);
  }

  private move(e: MouseEvent) {
    this.x = e.clientX;
    this.y = e.clientY;
    if (this.el.classList.contains('show')) this.position();
  }

  private leave(target: Element) {
    if (this.owner !== target) return;
    this.hide();
  }

  private render() {
    const c = typeof this.content === 'function' ? this.content() : this.content;
    clear(this.el);
    if (c === null || c === undefined || c === '') {
      this.el.classList.remove('show');
      return;
    }
    if (typeof c === 'string') this.el.textContent = c;
    else this.el.appendChild(c);
  }

  private position() {
    const r = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = this.x + 16;
    let y = this.y + 18;
    if (x + r.width > vw - 8) x = this.x - r.width - 12;
    if (y + r.height > vh - 8) y = this.y - r.height - 12;
    this.el.style.left = `${Math.max(8, x)}px`;
    this.el.style.top = `${Math.max(8, y)}px`;
  }
}

/** Standard rich tooltip body. */
export function tipBody(title: string, sub?: string, body?: string | Node, extra?: Node[]): HTMLElement {
  return h('div', h('div.tt-title', title), sub ? h('div.tt-sub', sub) : null, body ? h('div.tt-body', body) : null, extra ?? null);
}
