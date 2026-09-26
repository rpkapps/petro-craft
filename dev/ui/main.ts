// UI dev harness: boots the real UI against a fake AppShell and a rich mock game.
// URL params: ?screen=menu|loading|hud&panel=<id>&w=<wellStatus>&demo=1
import { createUIController, type UIController, type PanelId } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import { CommandBus } from '../../src/core/commands';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { getModifier, hasTech } from '../../src/core/state';
import type { AppShell, RenderHost, SaveSlotInfo } from '../../src/core/client';
import type { GameContext, GameState, Settings } from '../../src/core/types';
import type { AudioEngine } from '../../src/audio';
import type { NewGameOptions } from '../../src/core/state';
import { createMockGeology } from './mockGeology';
import { createMockState } from './mockState';
import { createMockServices, createMockWorld } from './mockServices';
import { mockTick, registerMockCommands } from './mockCommands';
import { B } from '../../src/core/blocks';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'hud';
const panel = params.get('panel');
const demo = params.get('demo') === '1';

function makeCtx(): GameContext {
  const geology = createMockGeology(512);
  const state: GameState = createMockState(geology);
  const bus = new EventBus();
  const commands = new CommandBus();
  const ctx: GameContext = {
    state, geology, bus, commands, world: createMockWorld(geology, state), services: createMockServices(() => ctx.state, geology),
    settings: app.settings, localPlayerId: 'p1', isAuthority: true,
    rng: Math.random,
    newId: (p) => `${p}${(state.nextId++).toString(36)}`,
    notify(level, title, text, at) {
      const n = { id: ctx.newId('n'), day: state.time.day, minute: state.time.minuteOfDay, level, title, text, at, read: false };
      state.notifications.push(n);
      bus.emit('notify', n);
    },
    transact(amount, category, note, requireFunds) {
      const c = state.company;
      if (requireFunds && amount < 0 && c.money + amount < 0) return false;
      c.money += amount;
      c.ledger.push({ day: state.time.day, minute: Math.floor(state.time.minuteOfDay), amount, category, note });
      if (amount >= 0) c.today.revenue += amount;
      else c.today.expenses -= amount;
      c.today.byCategory[category] = (c.today.byCategory[category] ?? 0) + amount;
      bus.emit('money:changed', { amount, balance: c.money, category });
      return true;
    },
    hasTech: (id) => hasTech(state, id),
    modifier: (k) => getModifier(state, k),
  };
  commands.bind(ctx);
  registerMockCommands(commands);
  return ctx;
}

function thumb(hue: number): string {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 180);
  sky.addColorStop(0, `hsl(${hue},45%,30%)`);
  sky.addColorStop(1, `hsl(${hue + 30},60%,65%)`);
  g.fillStyle = sky;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = `hsl(${hue + 90},35%,30%)`;
  g.fillRect(0, 120, 320, 60);
  g.fillStyle = '#222';
  g.fillRect(80, 60, 8, 60);
  g.fillRect(60, 110, 50, 10);
  g.beginPath();
  g.moveTo(84, 40);
  g.lineTo(70, 110);
  g.lineTo(98, 110);
  g.fill();
  g.fillStyle = '#ffb35c';
  g.beginPath();
  g.arc(250, 70, 16, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL('image/jpeg', 0.8);
}

const saves: SaveSlotInfo[] = [
  { slot: 'game-a', saveName: 'Permian Dreams', companyName: 'Black Mesa Petroleum', day: 214, money: 12_437_820, savedAt: Date.now() - 1000 * 60 * 42, playTimeSec: 19_380, worldSize: 'medium', difficulty: 'normal', thumbnail: thumb(20) },
  { slot: 'autosave', saveName: 'Permian Dreams', companyName: 'Black Mesa Petroleum', day: 215, money: 12_901_000, savedAt: Date.now() - 1000 * 60 * 3, playTimeSec: 19_520, worldSize: 'medium', difficulty: 'normal', thumbnail: thumb(200) },
  { slot: 'quicksave', saveName: 'Permian Dreams', companyName: 'Black Mesa Petroleum', day: 210, money: 11_200_000, savedAt: Date.now() - 1000 * 3600 * 5, playTimeSec: 18_000, worldSize: 'medium', difficulty: 'normal' },
  { slot: 'game-b', saveName: 'North Sea Venture', companyName: 'Stormcrest Energy', day: 47, money: -380_000, savedAt: Date.now() - 1000 * 3600 * 50, playTimeSec: 6_200, worldSize: 'large', difficulty: 'hard', thumbnail: thumb(260) },
  { slot: 'game-c', saveName: 'Sandbox Refinery', companyName: 'Copperline Resources', day: 402, money: 880_000_000, savedAt: Date.now() - 1000 * 3600 * 24 * 9, playTimeSec: 40_000, worldSize: 'small', difficulty: 'sandbox', thumbnail: thumb(120) },
];

const audio: AudioEngine = {
  attach() {}, detach() {}, update() {}, setVolumes() {}, menuMusic() {},
  ui(s) { if (params.get('logsound')) console.log('[sound]', s); },
};

let ctx: GameContext | null = null;
const host = { fps: 60, loadProgress: 1 } as unknown as RenderHost;

const app: AppShell = {
  get ctx() { return ctx; },
  get host() { return ctx ? host : null; },
  settings: structuredClone(DEFAULT_SETTINGS) as Settings,
  applySettings(s) { Object.assign(this.settings, s); },
  async newGame(_o: NewGameOptions) { await fakeLoad(); },
  async loadGame(_slot: string) { await fakeLoad(); },
  async saveGame(slot = 'game-a') { ctx?.bus.emit('game:saved', { slot }); },
  async deleteSave(slot) { const i = saves.findIndex((s) => s.slot === slot); if (i >= 0) saves.splice(i, 1); },
  async listSaves() { return saves.slice(); },
  async exportSave() { return new Blob(['{}'], { type: 'application/octet-stream' }); },
  async importSave(f) { return f.name; },
  async quitToMenu() { ctx = null; ui.detachGame(); ui.showMainMenu(); },
  requestPointerLock() {},
  exitPointerLock() {},
  get pointerLocked() { return false; },
  loading: { active: false, progress: 0, label: '' },
  uiCapturing: false,
  screenshot: () => null,
};

const ui: UIController = createUIController(document.getElementById('ui-root')!, app, audio);
(window as unknown as { ui: UIController; app: AppShell }).ui = ui;
(window as unknown as { app: AppShell }).app = app;

async function fakeLoad() {
  ui.detachGame();
  const steps = ['Surveying the basin…', 'Laying down strata…', 'Initialising simulation…', 'Building renderer…', 'Generating terrain…'];
  for (let i = 0; i <= 20; i++) {
    ui.setLoading(true, i / 20, steps[Math.min(steps.length - 1, Math.floor(i / 4.2))]);
    await new Promise((r) => setTimeout(r, 120));
  }
  startGame();
  ui.setLoading(false, 1, '');
}

function startGame() {
  ctx = makeCtx();
  ui.attachGame(ctx);
  const c = ctx;
  if (demo) {
    setInterval(() => c.transact(Math.random() > 0.4 ? 20000 + Math.random() * 90000 : -30000 * Math.random(), 'sales', 'demo'), 1500);
    setInterval(() => c.notify(['info', 'success', 'warning', 'danger'][Math.floor(Math.random() * 4)] as 'info', 'Demo notification', 'Something happened in the field.'), 6000);
  }
  const b = Object.values(c.state.buildings).find((x) => x.type === 'gas_plant')!;
  c.bus.emit('player:target', { kind: 'building', id: b.id });
  if (params.get('scan')) c.bus.emit('player:scan', { tool: 'tool:scanner', at: { x: 214, y: 61, z: 236 }, lines: ['Gravity anomaly +2.4 mGal', 'Magnetic: 48,120 nT', 'Probable anticline crest ~ 1,200 m'], level: 'info' });
  if (params.get('build')) c.bus.emit('ui:buildMode', { type: params.get('build') });
  if (params.get('pipe')) c.bus.emit('ui:pipeMode', { block: B.PIPE_GAS });
  if (params.get('xray')) c.bus.emit('ui:overlay', { overlay: 'xray' });
}

// ---- boot ------------------------------------------------------------------------------------
if (screen === 'menu') {
  ui.showMainMenu();
  if (panel) setTimeout(() => ui.open(panel as PanelId), 50);
} else if (screen === 'loading') {
  ui.showMainMenu();
  ui.setLoading(true, 0.62, 'Generating terrain…');
} else {
  ui.showMainMenu();
  startGame();
  if (panel) {
    const st = ctx!.state;
    const w = params.get('w');
    const args: Record<string, unknown> = {};
    const firstOf = (t: string) => Object.values(st.buildings).find((b) => b.type === t)?.id;
    let id = panel as PanelId;
    if (panel === 'well') args.wellId = Object.values(st.wells).find((x) => x.status === (w ?? 'producing'))?.id;
    if (panel === 'planner') args.rigId = firstOf(params.get('rig') ?? 'drilling_rig_heavy');
    if (panel === 'seismic') args.surveyId = Object.values(st.surveys).find((s) => s.kind === (params.get('kind') ?? '2d'))?.id;
    if (panel === 'inspector') args.buildingId = firstOf(params.get('b') ?? 'gas_plant');
    if (panel === 'map' && params.get('tool')) args.tool = params.get('tool');
    if (panel === 'map' && params.get('tool') === 'skid') args.rigId = firstOf('drilling_rig_land');
    if (params.get('tab')) args.tab = params.get('tab');
    if (panel === 'newgame' || panel === 'load') id = panel as PanelId;
    setTimeout(() => ui.open(id, args), 50);
  }
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.uiCapturing = ui.capturing;
  if (ctx && params.get('live') !== '0') mockTick(ctx, dt);
  ui.update(dt);
}
requestAnimationFrame(frame);
