// Player dev harness: fake world + fake render host + real GameSession with the player sim system.
// Automation hooks: window.harness (see below) — drive keys/mouse, advance time deterministically, inspect state.
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { AppShell } from '../../src/core/client';
import { createPlayerSimSystem } from '../../src/player/sim';
import { PlayerControllerImpl } from '../../src/player/index';
import { itemName } from '../../src/player/blockUtil';
import { BLOCKS } from '../../src/core/blocks';
import { createFakeGeology, createFakeWorld } from './fakeWorld';
import { FakeHost, fakePreview } from './fakeHost';
import { createFakeConstructionSystem } from './fakeSystems';

const params = new URLSearchParams(location.search);
const flat = params.has('flat');
const creative = params.has('creative');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const log: string[] = [];

const geology = createFakeGeology({ size: 128, flat });
const spawnX = 64, spawnZ = 64;
const state = createInitialState(
  { saveName: 'dev', companyName: 'Dev Oil', seed: 1, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: true, creative },
  'p1', { x: spawnX + 0.5, y: geology.surfaceHeight(spawnX, spawnZ), z: spawnZ + 0.5 },
);
const settings = structuredClone(DEFAULT_SETTINGS);
const session = new GameSession(state, null as never, geology, settings, 'p1', [createPlayerSimSystem(), createFakeConstructionSystem((s) => log.push(s))]);
const world = createFakeWorld(geology, session.bus, { flat });
session.world = world;
session.ctx.world = world;
session.init();
const ctx = session.ctx;

const host = new FakeHost(canvas, ctx);
host.buildingPreview = params.has('nopreview') ? null : { create: fakePreview };
host.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => host.resize(window.innerWidth, window.innerHeight));

let fakeLock = false;
/** Set once automation hooks are used: pointer lock is simulated (headless Chromium cannot lock). */
let automated = false;
const app = {
  uiCapturing: false,
  get pointerLocked() {
    return fakeLock || document.pointerLockElement === canvas;
  },
  requestPointerLock() {
    if (automated) {
      fakeLock = true;
      return;
    }
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* headless */
    }
  },
  exitPointerLock() {
    fakeLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  },
} as unknown as AppShell;

const pc = new PlayerControllerImpl(host, ctx, app);

// ---- event log & HUD ----------------------------------------------------------------------------------------
const events: { t: string; p: unknown }[] = [];
const origEmit = ctx.bus.emit.bind(ctx.bus);
(ctx.bus as { emit: typeof ctx.bus.emit }).emit = ((type: string, payload: unknown) => {
  if (/^(player:|ui:|audio:)/.test(type)) {
    events.push({ t: type, p: payload });
    if (events.length > 400) events.shift();
  }
  if (type === 'player:scan') {
    const el = document.getElementById('scan')!;
    const s = payload as { tool: string; lines: string[]; level?: string };
    el.textContent = `[${s.tool}]\n${s.lines.join('\n')}`;
    el.className = s.level ?? '';
  }
  if (type === 'ui:error') log.push(`ERROR ${(payload as { text: string }).text}`);
  return origEmit(type as never, payload as never);
}) as typeof ctx.bus.emit;

function hud() {
  const b = pc.body;
  const p = ctx.state.players.p1;
  const t = pc.target;
  const tgt = t.kind === 'block' && t.hit ? `${BLOCKS[t.hit.block].name} @ ${t.hit.x},${t.hit.y},${t.hit.z}` : t.kind === 'none' ? '-' : `${t.kind} ${t.id}`;
  document.getElementById('hud')!.textContent =
    `mode ${pc.mode}  ${b.onGround ? 'ground' : 'air'}${b.inLiquid ? ' swim' : ''}${b.headInLiquid ? ' underwater' : ''}\n` +
    `pos ${b.x.toFixed(2)} ${b.y.toFixed(2)} ${b.z.toFixed(2)}  v ${Math.hypot(b.vx, b.vz).toFixed(2)} / ${b.vy.toFixed(2)}\n` +
    `yaw ${pc.yaw.toFixed(2)} pitch ${pc.pitch.toFixed(2)}  fov ${host.camera.fov.toFixed(1)}\n` +
    `health ${pc.health.health.toFixed(0)}  air ${pc.health.air.toFixed(1)}  money $${Math.round(ctx.state.company.money).toLocaleString()}\n` +
    `target ${tgt}\nbuild ${pc.build.type ?? '-'} r${pc.build.rotation}  pipe ${pc.pipe.block ?? '-'}  overlay ${host.overlay ?? '-'}\n` +
    `synced ${p.position.x.toFixed(1)},${p.position.y.toFixed(1)},${p.position.z.toFixed(1)} hp ${p.health}\n` +
    log.slice(-4).join('\n');
  const hb = document.getElementById('hotbar')!;
  hb.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const s = p.inventory[i];
    const d = document.createElement('div');
    d.className = i === p.selectedSlot ? 'sel' : '';
    d.textContent = s ? `${i + 1} ${itemName(s.item)}${s.count > 1 ? ` ×${s.count}` : ''}` : `${i + 1}`;
    hb.appendChild(d);
  }
}

// ---- loop -------------------------------------------------------------------------------------------------
let manual = false;
let last = performance.now();
function frame(dt: number, render = true) {
  session.update(dt);
  pc.update(dt);
  host.update(dt);
  if (render) host.render();
}
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual) {
    frame(dt);
    hud();
  }
}
requestAnimationFrame(loop);

// ---- automation hooks ---------------------------------------------------------------------------------------
const harness = {
  pc, ctx, host, world, state, events, log,
  /** Take manual control of time: advance `sec` seconds in fixed 1/60 steps, then render once. */
  advance(sec: number, each?: (i: number) => void) {
    manual = true;
    const n = Math.round(sec * 60);
    for (let i = 0; i < n; i++) {
      each?.(i);
      frame(1 / 60, i === n - 1);
    }
    hud();
    return this.info();
  },
  resume() {
    manual = false;
  },
  lock(v = true) {
    automated = true;
    fakeLock = v;
  },
  key(code: string, down: boolean) {
    pc.input.simulateKey(code, down);
  },
  tap(code: string) {
    pc.input.simulateKey(code, true);
    frame(1 / 60, false);
    pc.input.simulateKey(code, false);
  },
  look(dx: number, dy: number) {
    pc.input.simulateMouse(dx, dy);
  },
  button(b: number, down: boolean) {
    pc.input.simulateButton(b, down);
  },
  click(b = 0) {
    pc.input.simulateButton(b, true);
    frame(1 / 60, false);
    pc.input.simulateButton(b, false);
    frame(1 / 60, false);
  },
  wheel(d: number) {
    pc.input.simulateWheel(d);
  },
  cursor(x: number, y: number) {
    pc.input.setCursor(x, y);
  },
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number) {
    pc.teleport(x, y, z, yaw, pitch);
  },
  emit(type: string, payload: unknown) {
    ctx.bus.emit(type as never, payload as never);
  },
  info() {
    const b = pc.body;
    return {
      mode: pc.mode, pos: [+b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3)], vel: [+b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2)], ground: b.onGround,
      swim: b.inLiquid, target: pc.target.kind === 'block' ? { ...pc.target.hit, point: undefined } : { kind: pc.target.kind, id: pc.target.id },
      health: pc.health.health, cam: host.camera.position.toArray().map((v) => +v.toFixed(2)), fov: +host.camera.fov.toFixed(2),
      slot: ctx.state.players.p1.selectedSlot, log: log.slice(-6),
    };
  },
  eventsOf(prefix: string) {
    return events.filter((e) => e.t.startsWith(prefix));
  },
};
(window as unknown as { harness: typeof harness }).harness = harness;
