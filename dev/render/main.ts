// Render engine dev harness. URL params:
//   scene=day|sunset|night|dawn|xray|underwater|storm|fog|pipes|leases (preset camera/time/weather)
//   time=HH:MM  weather=<kind>  cover=0..1  overlay=xray|pipes|...  cam=x,y,z,yaw,pitch  rd=8
//   post=0 (disable bloom/ssao)  ssao=1  shadows=0  quality=low|medium|high  speed=<game minutes / s>
import * as THREE from 'three';
import type { EventBus } from '../../src/core/EventBus';
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { IGeology, IWorld, Vec3, WeatherKind, WellState, WellStatus, Settings } from '../../src/core/types';
import type { MapOverlay } from '../../src/core/EventBus';
import { B } from '../../src/core/blocks';
import { SEA_LEVEL } from '../../src/core/constants';
import { createRenderer } from '../../src/render';
import { DevGeology, DevWorld } from './devWorld';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'day';

interface Preset {
  time: string;
  weather?: WeatherKind;
  cover?: number;
  overlay?: MapOverlay;
  cam: [number, number, number, number, number];
}
// Camera offsets are relative to the focus point (spawn, at ground level).
const PRESETS: Record<string, Preset> = {
  day: { time: '10:30', cam: [-24, 17, 30, -0.72, -0.28] },
  sunset: { time: '17:48', cam: [20, 15, 10, 1.45, -0.1] },
  dawn: { time: '05:55', cam: [22, 13, -18, 1.9, -0.12] },
  night: { time: '23:10', cam: [-16, 9, 14, -0.6, -0.22] },
  xray: { time: '14:00', overlay: 'xray', cam: [-32, 25, 42, -0.55, -0.42] },
  pressure: { time: '14:00', overlay: 'pressure', cam: [-32, 25, 42, -0.55, -0.42] },
  underwater: { time: '12:00', cam: [0, 0, 0, -0.9, 0.12] },
  storm: { time: '15:00', weather: 'storm', cover: 1, cam: [-24, 17, 30, -0.72, -0.2] },
  fog: { time: '08:00', weather: 'fog', cover: 0.6, cam: [-24, 17, 30, -0.72, -0.2] },
  pipes: { time: '13:00', overlay: 'pipes', cam: [-10, 9, 18, -0.4, -0.5] },
  leases: { time: '13:00', overlay: 'leases', cam: [-28, 43, 42, -0.6, -0.6] },
  pad: { time: '11:00', cam: [-12, 6, 12, -0.55, -0.35] },
};
const preset = PRESETS[scene] ?? PRESETS.day;

/** Nearest column with deep-ish water (spiral search) for the underwater preset. */
function findWater(g: IGeology, x0: number, z0: number) {
  for (let r = 0; r < 200; r += 4)
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = Math.round(x0 + Math.cos(a) * r);
      const z = Math.round(z0 + Math.sin(a) * r);
      if (x < 2 || z < 2 || x >= g.sizeX - 2 || z >= g.sizeZ - 2) continue;
      if (g.waterDepth(x, z) >= 7) return { x, z };
    }
  return { x: x0, z: z0 };
}

function parseTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  return (h * 60 + (m || 0)) % 1440;
}

async function loadWorld(bus: EventBus, seed: number): Promise<{ geology: IGeology; world: IWorld; source: string }> {
  try {
    if (params.get('world') === 'dev') throw new Error('dev world requested');
    const mod = await import('../../src/world');
    const geology = mod.createGeology(seed, 'small');
    const world = mod.createWorld(geology, bus);
    world.ensureChunk(Math.floor(geology.sizeX / 32), Math.floor(geology.sizeZ / 32));
    return { geology, world, source: 'src/world' };
  } catch (err) {
    console.info('[dev] src/world unavailable, using dev fallback world:', (err as Error).message);
    const geology = new DevGeology(seed, 256, 256);
    return { geology, world: new DevWorld(geology, bus), source: 'dev fallback' };
  }
}

function fakeWell(id: string, name: string, status: WellStatus, x: number, z: number, surfaceY: number, traj: Vec3[], plan: WellState['plan']): WellState {
  return {
    id, name, x, z, surfaceY, offshore: false, purpose: 'development', status, plan, trajectory: traj,
    measuredDepth: traj.length, plannedDepth: 80, currentY: traj[traj.length - 1]?.y ?? surfaceY, casing: [], mudWeight: 10, bitCondition: 90,
    kickVolume: 0, penetrated: [], completedReservoirs: [], reservoirContact: 0, fracStages: 0, choke: 0.5, lift: 'natural', productivity: 1,
    rates: { oil: 0, gas: 0, water: 0 }, bhp: 0, waterCut: 0, gor: 0, cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 1, cost: 0, owner: 'p1',
  };
}

function path(x: number, z: number, y0: number, y1: number, kick?: { y: number; dx: number; dz: number; len: number }): Vec3[] {
  const pts: Vec3[] = [];
  let cx = x;
  let cz = z;
  for (let y = y0; y >= y1; y--) {
    if (kick && y < kick.y) {
      const k = Math.min(1, (kick.y - y) / 8);
      cx += kick.dx * k;
      cz += kick.dz * k;
    }
    pts.push({ x: Math.round(cx), y, z: Math.round(cz) });
  }
  if (kick) for (let i = 1; i <= kick.len; i++) pts.push({ x: Math.round(cx + kick.dx * i), y: y1, z: Math.round(cz + kick.dz * i) });
  return pts;
}

async function main() {
  const seed = Number(params.get('seed') ?? 1337);
  const state = createInitialState(
    { saveName: 'dev', companyName: 'Dev Petroleum', seed, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: true, creative: true },
    'p1',
    { x: 128, y: 80, z: 128 },
  );
  state.time.minuteOfDay = parseTime(params.get('time') ?? preset.time);
  const kind = (params.get('weather') as WeatherKind) ?? preset.weather ?? 'clear';
  state.weather.current = kind;
  state.weather.cloudCover = Number(params.get('cover') ?? preset.cover ?? 0.35);
  state.weather.intensity = kind === 'clear' ? 0 : 0.8;
  state.weather.precipitation = kind === 'rain' || kind === 'storm' || kind === 'snow' ? 0.8 : 0;
  state.weather.windSpeed = kind === 'storm' ? 16 : 5;

  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  settings.renderDistance = Number(params.get('rd') ?? 8);
  if (params.get('post') === '0') {
    settings.bloom = false;
    settings.ssao = false;
  }
  if (params.get('ssao') === '1') settings.ssao = true;
  if (params.get('shadows') === '0') settings.shadows = false;
  if (params.get('quality')) settings.shadowQuality = params.get('quality') as Settings['shadowQuality'];
  if (params.get('clouds') === '0') settings.clouds = false;

  // Same wiring as core/App: the world needs the session's bus, so the session is built first.
  const session = new GameSession(state, null as unknown as IWorld, null as unknown as IGeology, settings, 'p1', [], true);
  const { geology, world, source } = await loadWorld(session.bus, seed);
  session.world = world;
  session.geology = geology;
  session.ctx.world = world;
  session.ctx.geology = geology;
  const ctx = session.ctx;

  // subsurface knowledge + wells for the x-ray view
  for (const r of geology.reservoirs) {
    state.reservoirs[r.id] = {
      id: r.id, discovered: true, knowledge: r.id.endsWith('c') ? 0.3 : 1, pressure: r.initialPressure * (r.id.endsWith('a') ? 0.7 : 1),
      cumulative: { oil: 0, gas: 0, water: 0 }, injected: { water: 0, gas: 0, co2: 0 }, remainingOil: r.oilInPlace * 0.3, remainingGas: r.gasInPlace * 0.6, waterFrontY: r.owcY,
    };
  }
  const plan = { kind: 'horizontal' as const, targetY: 30, kickoffY: 44, azimuth: 0.4, lateralLength: 22, casingPoints: [], mudWeight: 10 };
  const [ra, rb] = geology.reservoirs;
  if (ra && rb) {
    const sx = Math.round(ra.center.x - 4);
    const sz = Math.round(ra.center.z + 2);
    const sy = geology.surfaceHeight(sx, sz);
    state.wells.w1 = fakeWell('w1', 'Eagle 1', 'producing', sx, sz, sy, path(sx, sz, sy, Math.round(ra.center.y)), plan);
    state.wells.w2 = fakeWell('w2', 'Eagle 2-H', 'producing', sx + 6, sz - 8, sy, path(sx + 6, sz - 8, sy, Math.round(ra.center.y), { y: 50, dx: 0.9, dz: 0.3, len: 18 }), plan);
    const gx = Math.round(rb.center.x + 3);
    const gz = Math.round(rb.center.z - 2);
    const gy = geology.surfaceHeight(gx, gz);
    state.wells.w3 = fakeWell('w3', 'Heron 1', 'drilling', gx, gz, gy, path(gx, gz, gy, Math.round(rb.center.y + 12)), { ...plan, kind: 'vertical', targetY: Math.round(rb.center.y) });
    state.wells.w4 = fakeWell('w4', 'Heron 2 inj', 'injecting', gx - 12, gz + 6, gy, path(gx - 12, gz + 6, gy, Math.round(rb.center.y - 2)), plan);
    ctx.services.wells.planTrajectory = (x, y, z, p) => path(x, z, y, p.targetY);
  }
  for (let px = 2; px < 6; px++) for (let pz = 3; pz < 6; pz++) state.leases[`${px},${pz}`] = { px, pz, owner: 'p1', acquiredDay: 1, price: 1, royalty: 0.125 };
  state.leases['6,6'] = { px: 6, pz: 6, owner: 'rival', acquiredDay: 1, price: 1, royalty: 0.125 };

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const r = createRenderer(canvas, ctx);
  r.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => r.resize(window.innerWidth, window.innerHeight));
  let focus = { x: 128, y: 67, z: 128 };
  if (!(world instanceof DevWorld)) {
    try {
      const mod = await import('../../src/world');
      const sp = mod.findSpawn(geology);
      focus = { x: sp.x, y: sp.y, z: sp.z };
    } catch {
      /* keep centre */
    }
  }
  const explicit = params.get('cam')?.split(',').map(Number) as Preset['cam'] | undefined;
  const [ox, oy, oz, yaw, pitch] = explicit ?? preset.cam;
  if (explicit) r.camera.position.set(ox, oy, oz);
  else if (scene === 'underwater') {
    const w = findWater(geology, focus.x, focus.z);
    r.camera.position.set(w.x + 0.5, SEA_LEVEL - 3.5, w.z + 0.5);
  } else r.camera.position.set(focus.x + ox, focus.y + oy, focus.z + oz);
  r.camera.rotation.order = 'YXZ';
  r.camera.rotation.set(pitch, yaw, 0);
  const ov = (params.get('overlay') as MapOverlay | null) ?? preset.overlay ?? null;
  r.overlay = ov === 'none' ? null : ov;
  if (params.get('highlight') !== '0') {
    r.setBlockHighlight({ x: focus.x - 2, y: focus.y - 1, z: focus.z + 4 }, 0.6);
    r.setSelectionBox({ x: focus.x + 3, y: focus.y, z: focus.z + 10 }, { x: focus.x + 5, y: focus.y + 1, z: focus.z + 11 });
  }
  const speed = Number(params.get('speed') ?? 0);
  (window as unknown as Record<string, unknown>).__r = r;
  (window as unknown as Record<string, unknown>).__ctx = ctx;

  const stats = document.getElementById('stats')!;
  let last = performance.now();
  let acc = 0;
  let demoEdit = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (speed) state.time.minuteOfDay = (state.time.minuteOfDay + speed * dt) % 1440;
    r.update(dt);
    r.render();
    acc += dt;
    // exercise the edit path once terrain is in: dig a small pit & place a lamp
    if (demoEdit === 0 && r.loadProgress >= 1 && params.get('edit') === '1') {
      demoEdit = 1;
      const ex = Math.floor(focus.x) - 8;
      const ez = Math.floor(focus.z) + 20;
      const ey = world.getSurfaceY(ex, ez) - 1;
      for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) world.setBlock(ex + dx, ey, ez + dz, B.AIR, 'player');
      world.setBlock(ex + 1, ey - 1, ez + 1, B.LAMP, 'player');
    }
    if (acc > 0.5) {
      acc = 0;
      const info = r.renderer.info;
      stats.textContent = `${source} · ${r.fps.toFixed(0)} fps · load ${(r.loadProgress * 100).toFixed(0)}% · calls ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k · scene=${scene}`;
    }
  };
  requestAnimationFrame(frame);
}

void main().catch((e) => {
  console.error(e);
  document.getElementById('stats')!.textContent = String(e?.stack ?? e);
});

export { THREE };
