// Input manager: keyboard by KeyboardEvent.code (actions resolved through live keybinds), mouse buttons with
// press/release edges and drag distance, pointer-lock mouse deltas (spike-filtered), wheel, cursor tracking and
// double-tap detection. Everything is edge-latched between frames so short taps are never lost.
import { LOOK } from './config';

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Keys whose browser default (scrolling, bookmarks, find…) must not fire during gameplay. */
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'AltLeft', 'AltRight']);

export class InputManager {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private releasedKeys = new Set<string>();
  private doubleTaps = new Set<string>();
  private lastTap = new Map<string, number>();
  private buttons = [false, false, false, false, false];
  private pressedButtons = [false, false, false, false, false];
  private releasedButtons = [false, false, false, false, false];
  private dragDist = [0, 0, 0, 0, 0];
  private mdx = 0;
  private mdy = 0;
  private wheelDelta = 0;
  private enabled = true;
  private offs: (() => void)[] = [];
  /** Cursor position in canvas pixels and whether it is over the canvas. */
  cursorX = 0;
  cursorY = 0;
  cursorInside = false;
  /** Called on a primary click on the canvas while not pointer-locked (after the press was recorded). */
  onCanvasPress: ((button: number) => boolean) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly binds: () => Record<string, string>,
    private readonly isLocked: () => boolean,
    private readonly doubleTapWindow = 0.3,
  ) {}

  attach(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', this.onKeyDown, { capture: false });
    on(window, 'keyup', this.onKeyUp);
    on(window, 'blur', () => this.releaseAll());
    on(this.canvas, 'mousedown', this.onMouseDown);
    on(window, 'mouseup', this.onMouseUp);
    on(window, 'mousemove', this.onMouseMove);
    on(this.canvas, 'wheel', this.onWheel, { passive: false });
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(this.canvas, 'mouseenter', () => (this.cursorInside = true));
    on(this.canvas, 'mouseleave', () => (this.cursorInside = false));
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.releaseAll();
  }

  /** Gameplay input gate (false while UI panels capture input). Disabling releases everything. */
  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    if (!v) this.releaseAll();
  }
  get isEnabled(): boolean {
    return this.enabled;
  }

  // ---- queries ------------------------------------------------------------------------------------
  code(action: string): string | undefined {
    return this.binds()[action];
  }
  down(action: string): boolean {
    const c = this.code(action);
    return !!c && this.keys.has(c);
  }
  pressed(action: string): boolean {
    const c = this.code(action);
    return !!c && this.pressedKeys.has(c);
  }
  released(action: string): boolean {
    const c = this.code(action);
    return !!c && this.releasedKeys.has(c);
  }
  doubleTapped(action: string): boolean {
    const c = this.code(action);
    return !!c && this.doubleTaps.has(c);
  }
  codeDown(code: string): boolean {
    return this.keys.has(code);
  }
  codePressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }
  /** Either Shift key (used for build-mode chaining / pipe elevation lock). */
  shift(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.down('sneak');
  }
  button(b: number): boolean {
    return this.buttons[b];
  }
  buttonPressed(b: number): boolean {
    return this.pressedButtons[b];
  }
  buttonReleased(b: number): boolean {
    return this.releasedButtons[b];
  }
  /** Pixels the mouse travelled since button `b` went down. */
  dragDistance(b: number): number {
    return this.dragDist[b];
  }
  /** Take accumulated mouse movement (pixels). */
  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mdx, dy: this.mdy };
    this.mdx = 0;
    this.mdy = 0;
    return r;
  }
  /** Take accumulated wheel delta (pixels, positive = scroll down / towards user). */
  takeWheel(): number {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  /** Clear per-frame edges. Call once at the end of each frame. */
  endFrame(): void {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.doubleTaps.clear();
    for (let i = 0; i < 5; i++) {
      this.pressedButtons[i] = false;
      this.releasedButtons[i] = false;
    }
  }

  releaseAll(): void {
    for (const k of this.keys) this.releasedKeys.add(k);
    this.keys.clear();
    for (let i = 0; i < 5; i++) {
      if (this.buttons[i]) this.releasedButtons[i] = true;
      this.buttons[i] = false;
    }
    this.mdx = 0;
    this.mdy = 0;
    this.wheelDelta = 0;
  }

  // ---- synthetic input (dev harness / automation) ---------------------------------------------------
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.keys.has(code)) this.registerTap(code);
      this.keys.add(code);
      this.pressedKeys.add(code);
    } else if (this.keys.delete(code)) this.releasedKeys.add(code);
  }
  simulateButton(b: number, isDown: boolean): void {
    if (isDown) {
      this.buttons[b] = true;
      this.pressedButtons[b] = true;
      this.dragDist[b] = 0;
    } else if (this.buttons[b]) {
      this.buttons[b] = false;
      this.releasedButtons[b] = true;
    }
  }
  simulateMouse(dx: number, dy: number): void {
    this.mdx += dx;
    this.mdy += dy;
    const d = Math.hypot(dx, dy);
    for (let i = 0; i < 5; i++) if (this.buttons[i]) this.dragDist[i] += d;
  }
  simulateWheel(d: number): void {
    this.wheelDelta += d;
  }
  setCursor(x: number, y: number): void {
    this.cursorX = x;
    this.cursorY = y;
    this.cursorInside = true;
  }

  // ---- DOM handlers ----------------------------------------------------------------------------------
  private registerTap(code: string) {
    const now = performance.now() / 1000;
    const last = this.lastTap.get(code);
    if (last !== undefined && now - last < this.doubleTapWindow) {
      this.doubleTaps.add(code);
      this.lastTap.delete(code);
    } else this.lastTap.set(code, now);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (EDITABLE.has(t.tagName) || t.isContentEditable)) return;
    if (!this.enabled) return;
    const gameplayKey = BLOCK_DEFAULT.has(e.code) || (e.ctrlKey && Object.values(this.binds()).includes(e.code));
    if (gameplayKey) e.preventDefault();
    if (e.repeat) return;
    this.registerTap(e.code);
    this.keys.add(e.code);
    this.pressedKeys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.keys.delete(e.code)) this.releasedKeys.add(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 1) e.preventDefault(); // no autoscroll
    this.updateCursor(e);
    if (!this.isLocked() && this.onCanvasPress && this.onCanvasPress(e.button)) return; // consumed (e.g. pointer-lock request)
    const b = e.button;
    if (b < 0 || b > 4) return;
    this.buttons[b] = true;
    this.pressedButtons[b] = true;
    this.dragDist[b] = 0;
  };

  private onMouseUp = (e: MouseEvent) => {
    const b = e.button;
    if (b < 0 || b > 4) return;
    if (this.buttons[b]) {
      this.buttons[b] = false;
      this.releasedButtons[b] = true;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    const locked = this.isLocked();
    if (!locked) this.updateCursor(e);
    if (!this.enabled) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (Math.abs(dx) > LOOK.maxEventDelta || Math.abs(dy) > LOOK.maxEventDelta) return; // browser spike
    const anyButton = this.buttons.some((v) => v);
    if (locked || anyButton) {
      this.mdx += dx;
      this.mdy += dy;
    }
    if (anyButton) {
      const d = Math.hypot(dx, dy);
      for (let i = 0; i < 5; i++) if (this.buttons[i]) this.dragDist[i] += d;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    this.wheelDelta += e.deltaY * scale;
  };

  private updateCursor(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.cursorX = e.clientX - r.left;
    this.cursorY = e.clientY - r.top;
    this.cursorInside = this.cursorX >= 0 && this.cursorY >= 0 && this.cursorX < r.width && this.cursorY < r.height && e.target === this.canvas;
  }
}
