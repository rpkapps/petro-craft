// Tiny DOM toolkit: hyperscript-style element factory plus cheap "patch if changed" helpers.
// Components build their DOM once and then patch text/attributes on update ticks.

export type Child = Node | string | number | null | undefined | false | true | Child[];
export type StyleMap = Record<string, string | number | null | undefined>;
export interface Attrs {
  class?: string | null;
  style?: string | StyleMap;
  dataset?: Record<string, string>;
  html?: string;
  [key: string]: unknown;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function isAttrs(v: unknown): v is Attrs {
  return !!v && typeof v === 'object' && !(v instanceof Node) && !Array.isArray(v);
}

function appendChildren(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function applyStyle(el: HTMLElement | SVGElement, style: StyleMap) {
  for (const k in style) {
    const v = style[k];
    if (v === null || v === undefined) el.style.removeProperty(k);
    else if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(v));
    else (el.style as unknown as Record<string, string>)[k] = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v);
  }
}
const UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'lineHeight', 'fontWeight', 'zoom']);

function applyAttrs(el: Element, attrs: Attrs, svg: boolean) {
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') {
      if (svg) el.setAttribute('class', String(v));
      else (el as HTMLElement).className = ((el as HTMLElement).className ? (el as HTMLElement).className + ' ' : '') + String(v);
    } else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else applyStyle(el as HTMLElement, v as StyleMap);
    } else if (k === 'dataset') {
      Object.assign((el as HTMLElement).dataset, v as Record<string, string>);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (!svg && k in el && k !== 'list' && k !== 'form') {
      (el as unknown as Record<string, unknown>)[k] = v === true ? true : v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

/**
 * Create an element. `sel` may include classes and an id: `h('div.panel.glass#main')`.
 * Second argument may be attributes or the first child.
 */
export function h<T extends HTMLElement = HTMLElement>(sel: string, attrs?: Attrs | Child, ...children: Child[]): T {
  let tag = 'div';
  let id = '';
  const classes: string[] = [];
  const re = /([.#]?)([^.#]+)/g;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(sel))) {
    if (m[1] === '' && first) tag = m[2];
    else if (m[1] === '.') classes.push(m[2]);
    else if (m[1] === '#') id = m[2];
    first = false;
  }
  const el = document.createElement(tag) as T;
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;
  if (isAttrs(attrs)) applyAttrs(el, attrs, false);
  else if (attrs !== undefined) children.unshift(attrs as Child);
  appendChildren(el, children);
  return el;
}

/** Create an SVG element. */
export function s<T extends SVGElement = SVGElement>(tag: string, attrs?: Attrs | Child, ...children: Child[]): T {
  const el = document.createElementNS(SVG_NS, tag) as T;
  if (isAttrs(attrs)) applyAttrs(el, attrs, true);
  else if (attrs !== undefined) children.unshift(attrs as Child);
  appendChildren(el, children);
  return el;
}

/** Set textContent only if changed (avoids layout thrash on frequent ticks). */
export function setText(el: Element | null | undefined, text: string | number) {
  if (!el) return;
  const t = String(text);
  if (el.textContent !== t) el.textContent = t;
}

export function setAttr(el: Element | null | undefined, name: string, value: string | number | null) {
  if (!el) return;
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
    return;
  }
  const v = String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

export function setStyle(el: HTMLElement | SVGElement | null | undefined, prop: string, value: string) {
  if (!el) return;
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

export function toggleClass(el: Element | null | undefined, cls: string, on: boolean) {
  if (!el) return;
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Replace a set of mutually-exclusive classes with one. */
export function setVariant(el: Element, variants: readonly string[], active: string | null) {
  for (const v of variants) if (v !== active && el.classList.contains(v)) el.classList.remove(v);
  if (active && !el.classList.contains(active)) el.classList.add(active);
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Element, ...children: Child[]) {
  clear(el);
  appendChildren(el, children);
}

/** Width of a progress bar element (`.bar > i`). */
export function setBar(bar: HTMLElement, frac: number) {
  const i = bar.firstElementChild as HTMLElement | null;
  if (!i) return;
  const w = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  if (i.style.width !== w) i.style.width = w;
}

export function bar(frac = 0, variant = '', extra = ''): HTMLElement {
  const b = h(`div.bar${variant ? '.' + variant : ''}${extra ? '.' + extra : ''}`, h('i'));
  setBar(b, frac);
  return b;
}

/** Keyed list reconciliation: keeps DOM nodes for stable keys, creates/removes as needed, preserves order. */
export class KeyedList<T, N extends Element = HTMLElement> {
  private nodes = new Map<string, { node: N; update: (item: T) => void }>();
  constructor(
    readonly container: Element,
    private key: (item: T) => string,
    private create: (item: T) => { node: N; update: (item: T) => void },
  ) {}

  sync(items: readonly T[]) {
    const seen = new Set<string>();
    let prev: Element | null = null;
    for (const item of items) {
      const k = this.key(item);
      seen.add(k);
      let entry = this.nodes.get(k);
      if (!entry) {
        entry = this.create(item);
        this.nodes.set(k, entry);
      }
      entry.update(item);
      const expected: ChildNode | null = prev ? prev.nextSibling : this.container.firstChild;
      if (expected !== entry.node) this.container.insertBefore(entry.node, expected);
      prev = entry.node;
    }
    for (const [k, entry] of this.nodes) {
      if (!seen.has(k)) {
        entry.node.remove();
        this.nodes.delete(k);
      }
    }
  }

  get size() {
    return this.nodes.size;
  }

  clear() {
    for (const e of this.nodes.values()) e.node.remove();
    this.nodes.clear();
  }
}

/** Resize-aware HiDPI canvas helper. Returns CSS size in px and prepares the 2D context transform. */
export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = 2): { w: number; h: number; ctx: CanvasRenderingContext2D; dpr: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width));
  const hh = Math.max(1, Math.round(rect.height));
  const pw = Math.round(w * dpr);
  const ph = Math.round(hh * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h: hh, ctx, dpr };
}

/** Is the event target a text-entry element (so global hotkeys should be ignored)? */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)) || tag === 'TEXTAREA' || t.isContentEditable;
}

/** Download a Blob as a file. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = h<HTMLAnchorElement>('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
}

/** Smoothly tweened number for animated readouts. */
export class Tween {
  value: number;
  target: number;
  constructor(v = 0, private speed = 8) {
    this.value = v;
    this.target = v;
  }
  set(v: number, snap = false) {
    this.target = v;
    if (snap || !Number.isFinite(this.value)) this.value = v;
  }
  step(dt: number): number {
    const d = this.target - this.value;
    if (Math.abs(d) < Math.max(0.5, Math.abs(this.target) * 1e-5)) this.value = this.target;
    else this.value += d * Math.min(1, dt * this.speed);
    return this.value;
  }
  get settled() {
    return this.value === this.target;
  }
}
