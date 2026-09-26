// PetroCraft DOM UI entry point: menus, loading screen, HUD, panels, dialogs, toasts and hotkeys.
import './styles/base.css';
import './styles/panels.css';
import './styles/hud.css';
import './styles/menus.css';
import './styles/screens.css';
import type { AppShell } from '../core/client';
import type { GameContext, NotificationLevel, Settings } from '../core/types';
import type { AudioEngine } from '../audio';
import type { GameEvents, UiPanelId } from '../core/EventBus';
import type { Command, CommandResult, CommandType } from '../core/commands';
import { GAME_SPEEDS } from '../core/constants';
import { h, isTyping } from './dom';
import type { IconName } from './icons';
import type { ModalHandle, ModalOptions, PanelArgs, PanelId, UIHost, UISound } from './core/host';
import { PanelManager } from './core/panel';
import { ModalLayer, ToastStack } from './core/overlays';
import { Tooltip } from './core/tooltip';
import { MenuBackground } from './menus/menuBackground';
import { MainMenu } from './menus/mainMenu';
import { LoadingScreen } from './menus/loading';
import { Hud } from './hud/hud';
import { registerPanels } from './panels/registry';
import { pumpTerrain } from './render/terrain';
import { pumpEdits } from './render/edits';
import { localPlayer } from './game';

export interface UI {
  /** Show main menu (no game running). */
  showMainMenu(): void;
  /** A game session started: build HUD & subscribe to its bus. */
  attachGame(ctx: GameContext): void;
  /** Game session ended. */
  detachGame(): void;
  /** Loading screen control. */
  setLoading(active: boolean, progress: number, label: string): void;
  /** Called every animation frame (throttle internally). */
  update(dt: number): void;
  /** True when a modal panel is open (player input suspended, pointer unlocked). */
  readonly capturing: boolean;
}

/** Extended controller API (used by the dev harness and tooling). */
export interface UIController extends UI, UIHost {}

export type { PanelId, UIHost } from './core/host';

const PANEL_ALIASES: Partial<Record<UiPanelId, PanelId>> = {
  saveLoad: 'load', wellPlanner: 'planner', leases: 'map', pause: 'pause', settings: 'settings', build: 'build', inventory: 'inventory',
  research: 'research', market: 'market', contracts: 'contracts', workforce: 'workforce', finance: 'finance', map: 'map', wells: 'wells',
  seismic: 'seismic', inspector: 'inspector', objectives: 'objectives', help: 'help', environment: 'environment', notifications: 'notifications',
};

const PANEL_EVENT_IDS: Partial<Record<PanelId, UiPanelId>> = {
  load: 'saveLoad', planner: 'wellPlanner', well: 'wells', pause: 'pause', settings: 'settings', build: 'build', inventory: 'inventory',
  research: 'research', market: 'market', contracts: 'contracts', workforce: 'workforce', finance: 'finance', map: 'map', wells: 'wells',
  seismic: 'seismic', inspector: 'inspector', objectives: 'objectives', help: 'help', environment: 'environment', notifications: 'notifications',
};

const PANEL_BINDS: [string, PanelId][] = [
  ['inventory', 'inventory'], ['build', 'build'], ['research', 'research'], ['market', 'market'], ['map', 'map'], ['wells', 'wells'],
  ['workforce', 'workforce'], ['contracts', 'contracts'], ['finance', 'finance'], ['objectives', 'objectives'],
];

class Controller implements UIController {
  readonly root: HTMLElement;
  readonly tooltip: Tooltip;
  private panels: PanelManager;
  private modals: ModalLayer;
  private toasts: ToastStack;
  private bg = new MenuBackground();
  private menu: MainMenu;
  private loadingScreen: LoadingScreen;
  private hudLayer: HTMLElement;
  private hud: Hud | null = null;
  private session: GameContext | null = null;
  private unsubs: (() => void)[] = [];
  private menuVisible = false;
  private wasLocked = false;
  private scaleKey = '';
  private lastErrorAt = 0;
  private echo = false;

  constructor(host: HTMLElement, readonly app: AppShell, readonly audio: AudioEngine) {
    this.root = host;
    host.classList.add('pc-root');
    installNoiseTexture(host);
    this.hudLayer = h('div.pc-hud-layer');
    host.appendChild(this.hudLayer);
    this.panels = new PanelManager(this, host);
    this.panels.onChange = () => this.onPanelsChanged();
    this.menu = new MainMenu(this, this.bg);
    host.appendChild(this.menu.el);
    this.loadingScreen = new LoadingScreen(this.bg);
    host.appendChild(this.loadingScreen.el);
    this.modals = new ModalLayer(host, (s) => this.sound(s));
    this.toasts = new ToastStack(host);
    this.tooltip = new Tooltip(host);
    registerPanels(this.panels);

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    window.addEventListener('resize', () => this.applyScale(false));
    this.applyScale(true);
  }

  // ---- UIHost -----------------------------------------------------------------------------------
  get ctx(): GameContext | null {
    return this.session;
  }
  get game(): GameContext {
    if (!this.session) throw new Error('No game attached');
    return this.session;
  }
  get units() {
    return this.app.settings.units;
  }

  sound(name: UISound) {
    try {
      this.audio.ui(name);
    } catch {
      /* audio unavailable */
    }
  }

  open(id: PanelId, args: PanelArgs = {}, opts: { stack?: boolean } = {}) {
    if (this.loadingScreen.active) return;
    const inGameOnly = !['settings', 'help', 'load', 'newgame', 'credits'].includes(id);
    if (inGameOnly && !this.session) return;
    const wasOpen = this.panels.depth > 0;
    const p = this.panels.open(id, args, !!opts.stack);
    this.tooltip.hide();
    if (!p) return;
    // In-game opens are announced on the bus (the audio module plays the 'open' cue for those).
    const announced = this.announce(id, args);
    if (!wasOpen && !announced) this.sound('open');
  }

  /** Re-broadcast panel opens on the game bus (tutorial steps listen for them). Self-events are ignored. */
  private announce(id: PanelId, args: PanelArgs): boolean {
    const bus = this.session?.bus;
    const panel = PANEL_EVENT_IDS[id];
    if (!bus || !panel) return false;
    this.echo = true;
    try {
      bus.emit('ui:open', { panel, args });
      if (id === 'map' && args.layer === 'leases') bus.emit('ui:open', { panel: 'leases', args });
    } finally {
      this.echo = false;
    }
    return true;
  }

  /** Called by panels when a notable in-panel view is shown (e.g. the map's lease layer). */
  notifyView(panel: UiPanelId, args: PanelArgs = {}) {
    const bus = this.session?.bus;
    if (!bus) return;
    this.echo = true;
    try {
      bus.emit('ui:open', { panel, args });
    } finally {
      this.echo = false;
    }
  }

  close(id?: PanelId) {
    if (!this.panels.depth) return;
    this.panels.close(id);
    this.sound('close');
    this.tooltip.hide();
  }

  closeAll() {
    if (!this.panels.depth) return;
    this.panels.clearAll();
    this.sound('close');
    this.tooltip.hide();
  }

  toggle(id: PanelId, args?: PanelArgs) {
    if (this.panels.top?.id === id) this.closeAll();
    else this.open(id, args);
  }

  isOpen(id: PanelId) {
    return this.panels.isOpen(id);
  }

  toast(level: NotificationLevel, title: string, text?: string, opts?: { icon?: IconName; onClick?: () => void; ttl?: number }) {
    this.toasts.push(level, title, text, opts);
  }

  modal(opts: ModalOptions): ModalHandle {
    this.sound('open');
    this.app.exitPointerLock();
    return this.modals.show(opts);
  }

  confirm(o: { title: string; text: string; confirm?: string; danger?: boolean; icon?: IconName }): Promise<boolean> {
    return new Promise((resolve) => {
      let result = false;
      this.modal({
        title: o.title,
        icon: o.icon ?? (o.danger ? 'warning' : 'help'),
        danger: o.danger,
        body: o.text,
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          { label: o.confirm ?? 'Confirm', variant: o.danger ? 'danger' : 'primary', onClick: () => { result = true; } },
        ],
        onClose: () => resolve(result),
      });
    });
  }

  dispatch<K extends CommandType>(cmd: Command<K>, opts: { quiet?: boolean; successSound?: UISound } = {}): CommandResult {
    const ctx = this.session;
    if (!ctx) return { ok: false, error: 'No game running' };
    const r = ctx.commands.dispatch(cmd);
    if (r.ok && opts.successSound && !opts.quiet) this.sound(opts.successSound);
    return r;
  }

  applySettings(p: Partial<Settings>) {
    this.app.applySettings(p);
    // In game the app announces 'settings:changed' on the bus (handled in attachGame); menus have no bus.
    if (!this.session) this.onSettingsChanged(Object.keys(p));
  }

  private onSettingsChanged(keys: string[]) {
    if (keys.includes('uiScale')) this.applyScale(true);
    this.hud?.onSettingsChanged(keys);
  }

  listen<K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void): () => void {
    const ctx = this.session;
    if (!ctx) return () => {};
    const off = ctx.bus.on(type, fn);
    this.unsubs.push(off);
    return off;
  }

  // ---- UI lifecycle -----------------------------------------------------------------------------
  get capturing(): boolean {
    return this.menuVisible || this.loadingScreen.active || this.panels.depth > 0 || this.modals.count > 0;
  }

  showMainMenu() {
    this.detachGame();
    this.panels.clearAll();
    this.modals.closeAll();
    this.menuVisible = true;
    this.menu.show();
    this.toasts.el.classList.add('menu');
  }

  attachGame(ctx: GameContext) {
    this.detachGame();
    this.session = ctx;
    this.menuVisible = false;
    this.menu.hide();
    this.toasts.el.classList.remove('menu');
    this.hud = new Hud(this, ctx);
    this.hudLayer.appendChild(this.hud.el);
    this.hudLayer.classList.toggle('hidden', this.loadingScreen.active);

    this.listen('notify', (n) => {
      this.toast(n.level, n.title, n.text, {
        icon: n.icon as IconName | undefined,
        onClick: n.at ? () => this.session?.bus.emit('ui:focus', { at: n.at! }) : undefined,
      });
    });
    this.listen('ui:error', (e) => {
      const now = performance.now();
      if (now - this.lastErrorAt > 150) this.sound('error');
      this.lastErrorAt = now;
      this.toast('danger', 'Cannot do that', e.text, { icon: 'ban', ttl: 4 });
    });
    this.listen('ui:open', (e) => {
      if (!this.echo) this.openFromEvent(e.panel, e.args ?? {});
    });
    this.listen('ui:close', (e) => {
      const id = e.panel ? PANEL_ALIASES[e.panel] : undefined;
      if (e.panel && !id) return;
      if (id) this.close(id);
      else this.closeAll();
    });
    this.listen('ui:select', (e) => {
      if (e.kind === 'building' && e.id) this.open('inspector', { buildingId: e.id });
      else if (e.kind === 'well' && e.id) this.open('well', { wellId: e.id });
    });
    this.listen('game:saved', (e) => {
      if (e.slot !== 'autosave') this.toast('success', 'Game saved', e.slot === 'quicksave' ? 'Quicksave' : this.session?.state.meta.saveName, { icon: 'save', ttl: 3 });
    });
    this.listen('settings:changed', (e) => this.onSettingsChanged(e.keys));
    this.listen('player:itemPickedUp', (e) => this.hud?.onPickup(e.item, e.count));
    this.listen('research:completed', () => this.sound('success'));
    this.listen('achievement:unlocked', (a) => this.toast('success', `Achievement unlocked: ${a.title}`, undefined, { icon: 'trophy', ttl: 7, onClick: () => this.open('objectives', { tab: 'achievements' }) }));
    this.listen('objective:completed', () => this.sound('success'));
  }

  detachGame() {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.panels.clearAll();
    this.modals.closeAll();
    this.hud?.el.remove();
    this.hud = null;
    this.session = null;
    this.tooltip.hide();
  }

  setLoading(active: boolean, progress: number, label: string) {
    this.loadingScreen.set(active, progress, label);
    if (active) {
      this.menu.hide();
      this.panels.clearAll();
      this.modals.closeAll();
    } else if (!this.session && this.menuVisible) {
      this.menu.show();
    }
    this.hudLayer.classList.toggle('hidden', active);
  }

  update(dt: number) {
    this.loadingScreen.update(dt);
    if (!this.menuVisible && !this.loadingScreen.active) this.bg.stop();
    if (this.hud && !this.loadingScreen.active) this.hud.frame(dt, this.panels.ids());
    this.panels.update(dt);
    this.toasts.update(dt);
    if (this.session) {
      pumpTerrain(this.panels.depth ? 6 : 3);
      pumpEdits(dt, this.panels.depth ? 4 : 2);
    }
  }

  // ---- internals --------------------------------------------------------------------------------
  private openFromEvent(panel: UiPanelId, args: Record<string, unknown>) {
    if (panel === 'mainMenu') {
      void this.confirm({ title: 'Quit to main menu?', text: 'Your progress will be autosaved.', confirm: 'Quit', icon: 'logout' }).then((ok) => {
        if (ok) void this.app.quitToMenu();
      });
      return;
    }
    let id = PANEL_ALIASES[panel];
    if (!id) return;
    if (panel === 'wells' && typeof args.wellId === 'string') id = 'well';
    if (panel === 'seismic' && typeof args.surveyId !== 'string' && this.session && !Object.values(this.session.state.surveys).some((s) => s.progress > 0.02)) {
      id = 'map';
      args = { ...args, tool: 'seismic2d' };
    }
    if (panel === 'leases') args = { ...args, layer: 'leases' };
    this.open(id, args);
  }

  private onPanelsChanged() {
    this.toasts.el.classList.toggle('over-panel', this.panels.depth > 0 && !this.menuVisible);
    if (this.panels.depth > 0) {
      this.app.exitPointerLock();
      if (this.session && this.app.uiCapturing === false) this.app.uiCapturing = true;
    } else if (this.session && !this.loadingScreen.active) {
      const p = localPlayer(this.session);
      if (p && p.mode !== 'drone') this.app.requestPointerLock();
    }
  }

  private onPointerLockChange() {
    const locked = this.app.pointerLocked;
    if (!locked && this.wasLocked && this.session && !this.loadingScreen.active && this.panels.depth === 0 && this.modals.count === 0) {
      const p = localPlayer(this.session);
      if (!p || p.mode !== 'drone') this.open('pause');
    }
    this.wasLocked = locked;
  }

  /** Root font-size from settings.uiScale and the viewport. Called on resize and when uiScale changes. */
  private applyScale(force: boolean) {
    const s = this.app.settings.uiScale || 1;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const key = `${s}|${w}|${hgt}`;
    if (!force && key === this.scaleKey) return;
    this.scaleKey = key;
    const vp = Math.max(0.8, Math.min(1.3, Math.min(w / 1440, hgt / 810)));
    document.documentElement.style.fontSize = `${(16 * s * vp).toFixed(2)}px`;
  }

  private onKeyDown(e: KeyboardEvent) {
    if (this.loadingScreen.active) return;
    const kb = this.app.settings.keybinds;
    const top = this.panels.top;
    if (top && top.onKey(e)) return;
    if (this.modals.count > 0) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.modals.closeTop();
        this.sound('close');
      }
      return;
    }
    if (isTyping(e)) {
      if (e.code === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const code = e.code;
    if (code === 'Escape' || code === kb.pause) {
      e.preventDefault();
      if (this.panels.depth) this.close();
      else if (this.session) this.open('pause');
      return;
    }
    if (code === kb.help) {
      e.preventDefault();
      this.toggle('help');
      return;
    }
    if (!this.session || this.menuVisible) return;
    if (this.panels.top?.id === 'pause') return;
    if (code === kb.hideHud) {
      e.preventDefault();
      this.hud?.toggleHidden();
      return;
    }
    if (code === kb.quickSave) {
      e.preventDefault();
      void this.app.saveGame('quicksave').catch((err) => this.toast('danger', 'Quick save failed', String(err)));
      return;
    }
    if (code === kb.quickLoad) {
      e.preventDefault();
      void this.app.listSaves().then((saves) => {
        if (saves.some((s) => s.slot === 'quicksave')) return this.app.loadGame('quicksave');
        this.toast('warning', 'No quicksave yet', `Press ${kb.quickSave.replace('Key', '')} to quick save.`);
      }).catch((err) => this.toast('danger', 'Quick load failed', String(err)));
      return;
    }
    const st = this.session.state;
    if (code === kb.togglePause) {
      e.preventDefault();
      this.dispatch({ type: 'time/setPaused', paused: !st.time.paused });
      this.sound('click');
      return;
    }
    if (code === kb.speedUp || code === kb.speedDown) {
      e.preventDefault();
      const idx = GAME_SPEEDS.indexOf(st.time.speed as (typeof GAME_SPEEDS)[number]);
      const next = GAME_SPEEDS[Math.max(0, Math.min(GAME_SPEEDS.length - 1, (idx < 0 ? 0 : idx) + (code === kb.speedUp ? 1 : -1)))];
      this.dispatch({ type: 'time/setSpeed', speed: next });
      if (st.time.paused) this.dispatch({ type: 'time/setPaused', paused: false });
      this.sound('click');
      return;
    }
    if (e.repeat) return;
    for (const [bind, panel] of PANEL_BINDS) {
      if (code === kb[bind]) {
        e.preventDefault();
        this.toggle(panel);
        return;
      }
    }
  }
}

/** Small tiling grain texture generated once on a canvas (cheap to rasterise, unlike SVG turbulence). */
function installNoiseTexture(host: HTMLElement) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    const img = g.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 140;
    }
    g.putImageData(img, 0, 0);
    host.style.setProperty('--noise', `url(${c.toDataURL('image/png')})`);
  } catch {
    host.style.setProperty('--noise', 'none');
  }
}

export function createUI(root: HTMLElement, app: AppShell, audio: AudioEngine): UI {
  return new Controller(root, app, audio);
}

/** Same as createUI but typed with the extended controller API (dev harness / tools). */
export function createUIController(root: HTMLElement, app: AppShell, audio: AudioEngine): UIController {
  return new Controller(root, app, audio);
}
