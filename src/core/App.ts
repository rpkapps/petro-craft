// Application shell: lifecycle of menus ↔ game sessions, frame loop, saving, pointer lock.
import { GameSession } from './Game';
import { createInitialState, type NewGameOptions } from './state';
import { loadSettings, saveSettings } from './settings';
import type { AppShell, SaveSlotInfo } from './client';
import type { GameContext, Settings } from './types';
import { SAVE_VERSION } from './constants';
import { SaveManager } from '../save/SaveManager';
import { createGeology, createWorld, findSpawn } from '../world';
import { createRenderer, type Renderer } from '../render';
import { createEntityLayer, type EntityLayer } from '../render/entities';
import { createPlayerController, type PlayerController } from '../player';
import { createPlayerSimSystem } from '../player/sim';
import { createAudioEngine, type AudioEngine } from '../audio';
import { createUpstreamSystems } from '../sim/upstream';
import { createFacilitySystems } from '../sim/facilities';
import { createEconomySystems } from '../sim/economy';
import { createUI, type UI } from '../ui';

const LOCAL_PLAYER = 'p1';
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class App implements AppShell {
  settings: Settings = loadSettings();
  uiCapturing = false;
  loading = { active: false, progress: 0, label: '' };

  private session: GameSession | null = null;
  private renderer: Renderer | null = null;
  private entities: EntityLayer | null = null;
  private player: PlayerController | null = null;
  private readonly saves = new SaveManager();
  readonly audio: AudioEngine;
  readonly ui: UI;
  private last = performance.now();
  private autosaveTimer = 0;
  private currentSlot = 'autosave';
  private running = false;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.audio = createAudioEngine(this);
    this.ui = createUI(uiRoot, this, this.audio);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume, this.settings.sfxVolume);
    window.addEventListener('resize', () => this.renderer?.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('beforeunload', () => {
      if (this.session) void this.saveGame('autosave');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session) void this.saveGame('autosave');
    });
    (window as any).petrocraft = this; // debugging handle
  }

  get ctx(): GameContext | null {
    return this.session?.ctx ?? null;
  }
  get host() {
    return this.renderer;
  }
  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  start() {
    this.ui.showMainMenu();
    this.audio.menuMusic(true);
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.frame);
    }
  }

  applySettings(s: Partial<Settings>) {
    Object.assign(this.settings, s);
    this.session?.bus.emit('settings:changed', { keys: Object.keys(s) });
    saveSettings(this.settings);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume, this.settings.sfxVolume);
    if (this.session) this.session.ctx.settings = this.settings;
  }

  requestPointerLock() {
    if (!this.pointerLocked) {
      try {
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } catch {
        /* ignored */
      }
    }
  }
  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private setLoading(active: boolean, progress: number, label: string) {
    this.loading = { active, progress, label };
    this.ui.setLoading(active, progress, label);
  }

  async newGame(opts: NewGameOptions) {
    await this.teardown();
    this.setLoading(true, 0.02, 'Surveying the basin…');
    await nextFrame();
    const geology = createGeology(opts.seed, opts.worldSize);
    this.setLoading(true, 0.15, 'Laying down strata…');
    await nextFrame();
    const spawn = findSpawn(geology);
    const state = createInitialState(opts, LOCAL_PLAYER, spawn);
    await this.startSession(state, geology, null);
    this.currentSlot = `game-${opts.seed.toString(36)}-${Date.now().toString(36)}`;
    await this.saveGame(this.currentSlot);
  }

  async loadGame(slot: string) {
    await this.teardown();
    this.setLoading(true, 0.02, 'Reading save…');
    await nextFrame();
    const blob = await this.saves.load(slot);
    const geology = createGeology(blob.state.meta.seed, blob.state.meta.worldSize);
    this.setLoading(true, 0.15, 'Rebuilding the world…');
    await nextFrame();
    await this.startSession(blob.state, geology, blob.world);
    this.currentSlot = slot === 'autosave' || slot === 'quicksave' ? this.currentSlot : slot;
    this.session?.bus.emit('game:loaded', { slot });
  }

  private async startSession(state: any, geology: ReturnType<typeof createGeology>, edits: any) {
    // The world needs the session's bus, so the session is constructed first and the world swapped in.
    const systems = [createPlayerSimSystem(), ...createUpstreamSystems(), ...createFacilitySystems(), ...createEconomySystems()];
    const session = new GameSession(state, null as any, geology, this.settings, LOCAL_PLAYER, systems, true);
    const world = createWorld(geology, session.bus);
    session.world = world;
    session.ctx.world = world;
    if (edits) world.loadEdits(edits);
    this.setLoading(true, 0.3, 'Initialising simulation…');
    await nextFrame();
    session.init();
    this.session = session;

    this.setLoading(true, 0.4, 'Building renderer…');
    await nextFrame();
    this.renderer = createRenderer(this.canvas, session.ctx);
    this.renderer.resize(window.innerWidth, window.innerHeight);
    this.entities = createEntityLayer(this.renderer, session.ctx);
    this.player = createPlayerController(this.renderer, session.ctx, this);
    this.audio.menuMusic(false);
    this.audio.attach(session.ctx, this.renderer);
    this.ui.attachGame(session.ctx);

    // Stream in terrain around the player before revealing the world.
    const t0 = performance.now();
    while (this.renderer.loadProgress < 1 && performance.now() - t0 < 20000) {
      this.renderer.update(1 / 60);
      this.setLoading(true, 0.45 + 0.55 * this.renderer.loadProgress, 'Generating terrain…');
      await nextFrame();
    }
    this.setLoading(false, 1, '');
    this.autosaveTimer = 0;
    this.last = performance.now();
    session.bus.emit('game:started', { isNew: state.time.tick === 0 });
  }

  async saveGame(slot = this.currentSlot) {
    const s = this.session;
    if (!s) return;
    s.state.meta.lastSavedAt = Date.now();
    const thumb = this.screenshot(320) ?? undefined;
    await this.saves.save(slot, { format: 'petrocraft-save', version: SAVE_VERSION, state: s.state, world: s.world.serializeEdits() }, thumb);
    if (slot !== 'autosave') this.currentSlot = slot;
    s.bus.emit('game:saved', { slot });
  }

  deleteSave(slot: string) {
    return this.saves.delete(slot);
  }
  listSaves(): Promise<SaveSlotInfo[]> {
    return this.saves.list();
  }
  exportSave(slot: string) {
    return this.saves.exportFile(slot);
  }
  importSave(file: File) {
    return this.saves.importFile(file);
  }

  async quitToMenu() {
    if (this.session) await this.saveGame('autosave');
    await this.teardown();
    this.ui.showMainMenu();
    this.audio.menuMusic(true);
  }

  private async teardown() {
    this.exitPointerLock();
    if (!this.session) return;
    this.ui.detachGame();
    this.audio.detach();
    this.player?.dispose();
    this.entities?.dispose();
    this.renderer?.dispose();
    this.session.dispose();
    this.player = null;
    this.entities = null;
    this.renderer = null;
    this.session = null;
  }

  screenshot(width = 320): string | null {
    const r = this.renderer;
    if (!r) return null;
    try {
      r.render();
      const src = r.canvas;
      const h = Math.round((width * src.height) / Math.max(1, src.width));
      const c = document.createElement('canvas');
      c.width = width;
      c.height = h;
      c.getContext('2d')!.drawImage(src, 0, 0, width, h);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const rawDt = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    const dt = Math.min(0.1, rawDt); // visuals/physics clamp; the sim clock gets the real elapsed time
    this.last = now;
    this.uiCapturing = this.ui.capturing;
    const s = this.session;
    if (s && this.renderer && !this.loading.active) {
      s.state.meta.playTimeSec += rawDt;
      s.update(rawDt);
      this.player?.update(dt);
      this.renderer.update(dt);
      this.entities?.update(dt);
      this.audio.update(dt);
      this.renderer.render();
      this.autosaveTimer += dt;
      if (this.settings.autosaveMinutes > 0 && this.autosaveTimer > this.settings.autosaveMinutes * 60) {
        this.autosaveTimer = 0;
        void this.saveGame('autosave');
      }
    }
    this.ui.update(dt);
  };
}
