// PetroCraft Audio Lab: buttons for every sound / event / music state, an ambience playground with a
// draggable listener, and offline rendering with waveform/spectrum/level analysis.
import { createAudioEngineImpl, ONE_SHOT_NAMES, UI_SOUND_NAMES } from '../../src/audio';
import { B } from '../../src/core/blocks';
import type { BiomeId, WeatherKind, Vec3 } from '../../src/core/types';
import type { GameEvents } from '../../src/core/EventBus';
import { SEA_LEVEL } from '../../src/core/constants';
import { createFakeGame } from './fakeGame';
import { analyzeBank, drawSpectrum, drawWave, renderMusic } from './analysis';
import type { Mood } from '../../src/audio/music/composer';

const engine = createAudioEngineImpl(null);
engine.setVolumes(0.8, 0.6, 0.8);
const fake = createFakeGame();
const { ctx: game, host } = fake;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String(e.reason)}`));
const origErr = console.error.bind(console);
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '));
  origErr(...a);
};

const main = document.getElementById('main')!;
const statusEl = document.getElementById('status')!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let attached = false;

// ---- tiny DOM helpers ----------------------------------------------------------------------------
function section(title: string, wide = false, id?: string): HTMLElement {
  const s = document.createElement('section');
  if (wide) s.classList.add('wide');
  if (id) s.id = id;
  const h = document.createElement('h2');
  h.textContent = title;
  s.appendChild(h);
  main.appendChild(s);
  return s;
}
function group(parent: HTMLElement, title?: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  if (title) {
    const b = document.createElement('b');
    b.textContent = title;
    g.appendChild(b);
  }
  const row = document.createElement('div');
  row.className = 'row';
  g.appendChild(row);
  parent.appendChild(g);
  return row;
}
function button(parent: HTMLElement, label: string, fn: () => void, primary = false) {
  const b = document.createElement('button');
  b.textContent = label;
  if (primary) b.className = 'primary';
  b.onclick = () => {
    engine.unlock();
    fn();
  };
  parent.appendChild(b);
  return b;
}
function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, fn: (v: number) => void) {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  const out = document.createElement('span');
  out.textContent = String(value);
  i.oninput = () => {
    out.textContent = i.value;
    fn(Number(i.value));
  };
  l.append(i, out);
  parent.appendChild(l);
  return i;
}
function select<T extends string>(parent: HTMLElement, label: string, options: readonly T[], value: T, fn: (v: T) => void) {
  const l = document.createElement('label');
  l.textContent = label;
  const s = document.createElement('select');
  for (const o of options) {
    const op = document.createElement('option');
    op.value = op.textContent = o;
    s.appendChild(op);
  }
  s.value = value;
  s.onchange = () => fn(s.value as T);
  l.appendChild(s);
  parent.appendChild(l);
  return s;
}

// ---- scene -------------------------------------------------------------------------------------------
const G = fake.opts.groundY;
const cam = { x: 256, z: 256, y: G + 1.6, yaw: 0 };
const applyCam = () => fake.setCamera(cam.x, cam.y, cam.z, cam.yaw);

const rigWell = fake.addWell(272, 252, 'drilling');
const rig = fake.addBuilding('drilling_rig_land', 270, 250, 'active', { wellId: rigWell.id });
rigWell.rigId = rig.id;
const pjWell = fake.addWell(241, 271, 'producing', { lift: 'pumpjack' });
fake.addBuilding('wellhead', 240, 270, 'active', { wellId: pjWell.id });
const natWell = fake.addWell(226, 281, 'producing', { lift: 'natural', choke: 0.8 });
fake.addBuilding('wellhead', 225, 280, 'active', { wellId: natWell.id });
fake.addBuilding('compressor_station', 225, 228, 'active');
fake.addBuilding('pump_station', 250, 225, 'active');
fake.addBuilding('gas_plant', 292, 290, 'active');
fake.addBuilding('flare_stack', 305, 250, 'active', { utilization: 0.9 });
fake.addBuilding('gas_turbine_power', 215, 305, 'active');
fake.addBuilding('diesel_generator', 262, 280, 'active');
fake.addBuilding('wind_turbine', 195, 250, 'active');
fake.addBuilding('field_office', 250, 262, 'active');
const site = fake.addBuilding('refinery', 280, 205, 'constructing');
const blowWell = fake.addWell(330, 330, 'producing');

// ---- UI --------------------------------------------------------------------------------------------
const setup = section('Engine');
const r0 = group(setup);
button(r0, 'Start audio', () => engine.unlock(), true);
button(r0, 'Menu music ON', () => engine.menuMusic(true));
button(r0, 'Menu music OFF', () => engine.menuMusic(false));
button(r0, 'Attach game', () => attach());
button(r0, 'Detach game', () => detach());
const vols = { m: 0.8, mu: 0.6, s: 0.8 };
const r1 = group(setup, 'Volumes');
slider(r1, 'master', 0, 1, 0.01, vols.m, (v) => { vols.m = v; engine.setVolumes(vols.m, vols.mu, vols.s); });
slider(r1, 'music', 0, 1, 0.01, vols.mu, (v) => { vols.mu = v; engine.setVolumes(vols.m, vols.mu, vols.s); });
slider(r1, 'sfx', 0, 1, 0.01, vols.s, (v) => { vols.s = v; engine.setVolumes(vols.m, vols.mu, vols.s); });

function attach() {
  if (attached) return;
  attached = true;
  engine.menuMusic(false);
  engine.attach(game, host);
}
function detach() {
  if (!attached) return;
  attached = false;
  engine.detach();
}

const uiSec = section('UI sounds  (AudioEngine.ui)');
const ru = group(uiSec);
for (const s of ['click', 'hover', 'open', 'close', 'error', 'success', 'cash', 'notify', 'alarm'] as const) button(ru, s, () => engine.ui(s));
const ru2 = group(uiSec, 'extra UI-bus sounds');
for (const s of UI_SOUND_NAMES.filter((n) => !['click', 'hover', 'open', 'close', 'error', 'success', 'cash', 'notify', 'alarm'].includes(n))) button(ru2, s, () => engine.uiSound(s));

const shots = section('One-shots  (audio:play names)', true);
const groups = new Map<string, string[]>();
for (const n of ONE_SHOT_NAMES) {
  const k = n.includes('_') ? n.split('_')[0] : 'misc';
  const key = ['footstep', 'break', 'place', 'sting', 'bird', 'detector', 'scanner', 'explosion', 'thunder', 'fire'].includes(k) ? k : 'misc';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(n);
}
const near = (): Vec3 => ({ x: cam.x + 6, y: cam.y, z: cam.z - 4 });
for (const [k, list] of groups) {
  const r = group(shots, k);
  for (const n of list) button(r, n.replace(`${k}_`, ''), () => engine.playNamed(n, k === 'sting' || k === 'misc' ? undefined : near()));
}
const ra = group(shots, 'special');
button(ra, 'explosion (near)', () => engine.explosion({ x: cam.x + 25, y: G + 2, z: cam.z - 20 }, 6));
button(ra, 'explosion (far)', () => engine.explosion({ x: cam.x + 250, y: G + 2, z: cam.z - 120 }, 8));
button(ra, 'thunder near', () => engine.thunder(cam.x + 30, cam.z + 10));
button(ra, 'thunder far', () => engine.thunder(cam.x - 400, cam.z + 200));
button(ra, 'extinguisher (hold 1.5s)', async () => {
  for (let i = 0; i < 15; i++) {
    game.bus.emit('player:toolUse', { tool: 'extinguisher', x: cam.x, y: G, z: cam.z - 3 });
    await sleep(100);
  }
});

// ---- events --------------------------------------------------------------------------------------------
type EvList = { [K in keyof GameEvents]?: GameEvents[K][] };
const firstB = () => Object.keys(game.state.buildings)[0];
function eventList(): EvList {
  const at = { x: Math.floor(cam.x) + 3, y: G, z: Math.floor(cam.z) - 3 };
  const bid = firstB();
  const note = (level: 'info' | 'success' | 'warning' | 'danger') => ({ id: 'n', day: 1, minute: 0, level, title: level, read: false });
  return {
    'player:footstep': [B.GRASS, B.DIRT, B.STONE, B.SAND, B.GRAVEL, B.PLANKS, B.STEEL_PLATE, B.CONCRETE, B.SNOW, B.WATER, B.MUD].map((block) => ({ ...at, block })),
    'player:jump': [{}],
    'player:land': [{ speed: 6 }, { speed: 18 }],
    'player:blockBroken': [B.STONE, B.DIRT, B.LOG_OAK, B.GLASS, B.STEEL_PLATE, B.LEAVES_OAK, B.GRAVEL].map((id) => ({ ...at, id })),
    'player:blockPlaced': [B.CONCRETE, B.DIRT, B.PLANKS, B.PIPE_OIL, B.STEEL_PLATE, B.GLASS].map((id) => ({ ...at, id })),
    'player:damage': [{ amount: 8 }, { amount: 30 }],
    'player:toolUse': ['wrench', 'scanner', 'detector', 'pickaxe', 'tool:extinguisher', 'tablet'].map((tool) => ({ tool, ...at })),
    'player:scan': [
      { tool: 'scanner', at, lines: [], level: 'info' as const },
      { tool: 'detector', at, lines: [], level: 'info' as const },
      { tool: 'detector', at, lines: [], level: 'warning' as const },
      { tool: 'detector', at, lines: [], level: 'danger' as const },
    ],
    'player:death': [{ cause: 'test' }],
    'player:respawn': [{}],
    'building:placed': [{ id: bid }],
    'building:completed': [{ id: bid }],
    'building:removed': [{ id: 'gone', type: 'pump_station', x: at.x, y: at.y, z: at.z }],
    'building:statusChanged': [{ id: bid, prev: 'active', status: 'broken' }],
    'money:changed': [{ amount: 250_000, balance: 1e6, category: 'sales' }],
    notify: [note('info'), note('success'), note('warning'), note('danger')],
    'research:completed': [{ techId: 'x' }],
    'contract:completed': [{ id: 'c' }],
    'contract:failed': [{ id: 'c' }],
    'objective:completed': [{ id: 'o' }],
    'lease:acquired': [{ key: '1,1' }],
    'survey:completed': [{ id: 's' }],
    'game:saved': [{ slot: 'x' }],
    'well:spud': [{ id: rigWell.id }],
    'well:discovery': [{ id: rigWell.id, reservoirId: 'r', fluid: 'oil' }],
    'well:dryHole': [{ id: rigWell.id }],
    'well:kick': [{ id: rigWell.id }],
    'well:blowout': [{ id: blowWell.id }],
    'well:blowoutControlled': [{ id: blowWell.id }],
    'hazard:fireStarted': [{ id: 'f1', ...at }],
    'hazard:fireOut': [{ id: 'f1' }],
    'hazard:explosion': [{ x: at.x + 30, y: G, z: at.z, power: 4 }, { x: at.x + 300, y: G, z: at.z, power: 9 }],
    'hazard:spill': [{ ...at, volume: 100 }],
    'network:leak': [{ networkId: 'n', ...at }],
    'weather:lightning': [{ x: at.x + 20, z: at.z }, { x: at.x + 500, z: at.z }],
    'ui:error': [{ text: 'nope' }],
    'ui:click': [{}],
    'ui:hover': [{}],
    'ui:open': [{ panel: 'build' }],
    'ui:close': [{}],
    'audio:play': [
      { sound: 'detector_beep' }, { sound: 'click' }, { sound: 'thump', at }, { sound: 'clank', at }, { sound: 'klaxon' },
      { sound: 'footstep:5' }, { sound: 'break:3', at }, { sound: 'fanfare' }, { sound: 'explosion', at, volume: 0.5 }, { sound: 'thunder' },
      { sound: 'no_such_sound' },
    ],
  };
}

const evSec = section('Game events  (emitted on the bus — attaches the fake game)', true);
const evRow = group(evSec);
const evs = eventList();
for (const k of Object.keys(evs) as (keyof GameEvents)[]) {
  button(evRow, k, async () => {
    attach();
    for (const p of eventList()[k] ?? []) {
      game.bus.emit(k, p as never);
      await sleep(k === 'player:footstep' ? 330 : 700);
    }
  });
}

// ---- music & hazards ------------------------------------------------------------------------------
const mus = section('Music mood & tension');
const rm = group(mus);
slider(rm, 'time (min)', 0, 1439, 1, game.state.time.minuteOfDay, (v) => {
  game.state.time.minuteOfDay = v;
  const h = v / 60;
  host.daylight = Math.max(0, Math.min(1, Math.sin(((h - 6) / 12) * Math.PI)));
});
const rt = group(mus, 'tension sources');
button(rt, 'add fire', () => {
  game.state.hazards.fires.push({ id: `f${Math.random()}`, x: cam.x + 10 + Math.random() * 10, y: G, z: cam.z + Math.random() * 10, intensity: 0.8, startedMinute: 0, spreadTimer: 0 });
});
button(rt, 'kick', () => (rigWell.status = 'kick'));
button(rt, 'blowout (burning)', () => {
  blowWell.status = 'blowout';
  blowWell.blowout = { startedDay: 1, onFire: true, flowRate: 5000, capProgress: 0 };
});
button(rt, 'clear all', () => {
  game.state.hazards.fires.length = 0;
  rigWell.status = 'drilling';
  blowWell.status = 'producing';
});
const rs = group(mus, 'rig well status');
for (const st of ['drilling', 'tripping', 'casing', 'drilled'] as const) button(rs, st, () => (rigWell.status = st));

// ---- ambience ----------------------------------------------------------------------------------------
const amb = section('Ambience & listener');
const re = group(amb);
select(re, 'biome', ['plains', 'forest', 'birch_forest', 'taiga', 'desert', 'badlands', 'swamp', 'tundra', 'mountains', 'beach', 'ocean', 'river'] as BiomeId[], 'forest', (v) => (fake.opts.biome = v));
select(re, 'weather', ['clear', 'cloudy', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'hurricane'] as WeatherKind[], 'clear', (v) => (game.state.weather.current = v));
const rw = group(amb);
slider(rw, 'wind m/s', 0, 30, 0.5, game.state.weather.windSpeed, (v) => (game.state.weather.windSpeed = v));
slider(rw, 'precip', 0, 1, 0.01, 0, (v) => (game.state.weather.precipitation = v));
slider(rw, 'temp °C', -20, 40, 1, 18, (v) => (game.state.weather.temperature = v));
slider(rw, 'altitude', 0, 100, 1, 1.6, (v) => { cam.y = G + v; applyCam(); });
slider(rw, 'yaw', -3.14, 3.14, 0.01, 0, (v) => { cam.yaw = v; applyCam(); });
const rc = group(amb);
button(rc, 'coast nearby', () => (fake.opts.coastX = cam.x - 12));
button(rc, 'no coast', () => (fake.opts.coastX = -40));
button(rc, 'go underwater', () => {
  fake.opts.coastX = cam.x + 30;
  cam.y = SEA_LEVEL - 3;
  applyCam();
});
button(rc, 'surface', () => { cam.y = G + 1.6; fake.opts.coastX = -40; applyCam(); });
const map = document.createElement('canvas');
map.width = 360;
map.height = 300;
amb.appendChild(map);
const mapScale = 2;
const toWorld = (px: number, py: number) => ({ x: 256 + (px - map.width / 2) / mapScale, z: 256 + (py - map.height / 2) / mapScale });
map.onclick = (e) => {
  const r = map.getBoundingClientRect();
  const p = toWorld(((e.clientX - r.left) * map.width) / r.width, ((e.clientY - r.top) * map.height) / r.height);
  cam.x = p.x;
  cam.z = p.z;
  applyCam();
};
function drawMap() {
  const g = map.getContext('2d')!;
  g.fillStyle = '#0a0d10';
  g.fillRect(0, 0, map.width, map.height);
  const toPx = (x: number, z: number) => [(x - 256) * mapScale + map.width / 2, (z - 256) * mapScale + map.height / 2];
  if (fake.opts.coastX > 0) {
    const [cx] = toPx(fake.opts.coastX, 0);
    g.fillStyle = '#12304a';
    g.fillRect(0, 0, Math.max(0, cx), map.height);
  }
  const active = new Set(engine.debugInfo().loopKeys.map((k) => k.split('#')[0]));
  for (const b of Object.values(game.state.buildings)) {
    const [px, py] = toPx(b.x, b.z);
    g.fillStyle = active.has(`b:${b.id}`) ? '#ff8a1f' : '#3a4452';
    g.fillRect(px, py, b.size[0] * mapScale, b.size[1] * mapScale);
    g.fillStyle = '#8b95a1';
    g.font = '9px sans-serif';
    g.fillText(b.type.replace(/_/g, ' '), px, py - 2);
  }
  for (const f of game.state.hazards.fires) {
    const [px, py] = toPx(f.x, f.z);
    g.fillStyle = '#ff3b1f';
    g.beginPath();
    g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();
  }
  const [lx, ly] = toPx(cam.x, cam.z);
  g.strokeStyle = '#fff';
  g.beginPath();
  g.arc(lx, ly, 5, 0, Math.PI * 2);
  g.moveTo(lx, ly);
  g.lineTo(lx - Math.sin(cam.yaw) * 14, ly - Math.cos(cam.yaw) * 14);
  g.stroke();
}

// ---- analysis ------------------------------------------------------------------------------------------
const an = section('Offline analysis  (OfflineAudioContext renders: waveform, level, spectrum)', true, 'analysis');
const rAn = group(an);
const canvas = document.createElement('canvas');
canvas.width = 1260;
canvas.height = 40;
button(rAn, 'Render & analyse everything', () => void analyze(), true);
an.appendChild(canvas);

async function analyze(musicSeconds = 32) {
  const g = canvas.getContext('2d')!;
  const { bank, stats, totalMs } = await analyzeBank();
  const cols = 8;
  const cw = canvas.width / cols;
  const ch = 44;
  const rows = Math.ceil(stats.length / cols);
  const musicH = 70;
  const moods: [string, 'menu' | 'game', Mood, number][] = [
    ['menu', 'menu', 'dusk', 0], ['day', 'game', 'day', 0], ['night', 'game', 'night', 0], ['dawn', 'game', 'dawn', 0], ['tension', 'game', 'dusk', 1],
  ];
  const top = moods.length * musicH + 16;
  canvas.height = top + rows * ch + 10;
  g.fillStyle = '#0a0d10';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = '10px monospace';
  let y = 0;
  const musicStats = [];
  for (const [label, kind, mood, tension] of moods) {
    const { buffer, stat } = await renderMusic(bank, kind, mood, tension, musicSeconds);
    musicStats.push({ ...stat, label });
    drawWave(g, buffer, 4, y + 14, 900, musicH - 18, tension ? '#ff5252' : '#7bd88f');
    drawSpectrum(g, buffer, 912, y + 6, 340, musicH - 10);
    g.fillStyle = '#ddd';
    g.fillText(`music ${label} (${musicSeconds}s): peak ${stat.peakDb.toFixed(1)} dB, rms ${stat.rmsDb.toFixed(1)} dB, render ${stat.ms.toFixed(0)} ms ${stat.bad ?? ''}`, 6, y + 12);
    y += musicH;
  }
  g.fillStyle = '#ddd';
  g.fillText(`${stats.length} sounds rendered in ${totalMs.toFixed(0)} ms (name peak/rms dBFS)`, 4, y + 12);
  stats.forEach((s, i) => {
    const x = (i % cols) * cw;
    const yy = top + Math.floor(i / cols) * ch;
    const b = bank.get(s.name);
    const color = s.bad ? '#ff3b3b' : s.name.startsWith('loop_') ? '#4fc3f7' : s.name.startsWith('sting') ? '#c792ea' : '#ff8a1f';
    if (b) drawWave(g, b[0], x + 2, yy + 12, cw - 6, ch - 14, color);
    g.fillStyle = s.bad ? '#ff6b6b' : '#aab3bf';
    g.fillText(`${s.name.slice(0, 17)} ${s.peakDb.toFixed(0)}/${s.rmsDb.toFixed(0)}`, x + 3, yy + 10);
  });
  const bad = stats.filter((s) => s.bad).map((s) => `${s.name}:${s.bad}`);
  const slow = [...stats].sort((a, b) => b.ms - a.ms).slice(0, 5).map((s) => `${s.name} ${s.ms.toFixed(0)}ms`);
  return { count: stats.length, totalMs: Math.round(totalMs), bad, slow, music: musicStats, loud: stats.filter((s) => s.peakDb > -1).map((s) => s.name) };
}

// ---- automated run (used by scripts/shot.mjs) ----------------------------------------------------------
async function waitFor(fn: () => boolean, ms: number) {
  const t0 = performance.now();
  while (!fn() && performance.now() - t0 < ms) await sleep(50);
  return fn();
}

async function runAll() {
  engine.unlock();
  await waitFor(() => !!engine.bank?.has('click'), 4000);
  for (const s of ['click', 'hover', 'open', 'close', 'error', 'success', 'cash', 'notify', 'alarm'] as const) {
    engine.ui(s);
    await sleep(30);
  }
  engine.menuMusic(true);
  await waitFor(() => (engine.bank?.progress ?? 0) >= 1, 20000);
  const renderedMs = engine.bank?.stats.reduce((a, s) => a + s.ms, 0) ?? 0;
  for (const n of ONE_SHOT_NAMES) {
    engine.playNamed(n, n.startsWith('sting') ? undefined : near(), 0.3);
    await sleep(12);
  }
  await sleep(600);
  attach();
  const evsAll = eventList();
  for (const k of Object.keys(evsAll) as (keyof GameEvents)[]) for (const p of evsAll[k] ?? []) game.bus.emit(k, p as never);
  for (let i = 0; i < 6; i++) {
    game.bus.emit('player:toolUse', { tool: 'extinguisher', x: cam.x, y: G, z: cam.z });
    await sleep(60);
  }
  await sleep(800);
  const calm = engine.debugInfo();
  // hazards → tension
  game.state.hazards.fires.push({ id: 'fx', x: cam.x + 8, y: G, z: cam.z + 4, intensity: 0.9, startedMinute: 0, spreadTimer: 0 });
  blowWell.status = 'blowout';
  blowWell.blowout = { startedDay: 1, onFire: true, flowRate: 5000, capProgress: 0 };
  game.state.weather.current = 'storm';
  game.state.weather.precipitation = 0.9;
  game.state.weather.windSpeed = 18;
  await sleep(1200);
  const tense = engine.debugInfo();
  // walk around, night, coast, underwater
  game.state.time.minuteOfDay = 1320;
  host.daylight = 0;
  fake.opts.biome = 'swamp';
  fake.opts.coastX = cam.x - 10;
  for (const [x, z] of [[300, 250], [230, 300], [330, 330], [256, 256]]) {
    cam.x = x;
    cam.z = z;
    applyCam();
    await sleep(300);
  }
  const night = engine.debugInfo();
  fake.opts.coastX = cam.x + 30;
  cam.y = SEA_LEVEL - 3;
  applyCam();
  await sleep(500);
  const under = engine.debugInfo();
  cam.y = G + 1.6;
  fake.opts.coastX = -40;
  applyCam();
  detach();
  engine.menuMusic(true);
  await sleep(300);
  engine.setVolumes(0.5, 0.2, 0.9);
  return {
    errors,
    renderedMs: Math.round(renderedMs),
    calm: { loops: calm.loopKeys, music: calm.music, mood: calm.mood },
    tense: { loops: tense.loopKeys.length, tension: tense.tension, voices: tense.voices },
    night: { mood: night.mood, env: night.env.biome, nearWater: night.env.nearWater },
    under: { underwater: under.env.underwater },
    final: engine.debugInfo().music,
    ctxState: engine.debugInfo().state,
  };
}

(window as unknown as Record<string, unknown>).audioHarness = { engine, fake, runAll, analyze, errors };
if (location.search.includes('analyze')) document.body.classList.add('analyze');

// ---- loop ------------------------------------------------------------------------------------------------
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (attached) engine.update(dt);
  drawMap();
  const d = engine.debugInfo();
  statusEl.textContent =
    `ctx ${d.state}  bank ${d.bank}%  voices ${d.voices}  loops ${d.loops}  music ${d.music} key ${d.key} mood ${d.mood}/${d.pieceMood ?? '-'}${d.resting ? ' (rest)' : ''}  tension ${d.tension.toFixed(2)}\n` +
    `env: wind ${d.env.windSpeed} ${d.env.weather} precip ${d.env.precipitation} biome ${d.env.biome} water ${d.env.nearWater.toFixed(2)} alt ${d.env.altitude.toFixed(1)} underwater ${d.env.underwater}  errors ${errors.length}`;
}
requestAnimationFrame(frame);
void site;
