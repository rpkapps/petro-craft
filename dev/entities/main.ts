// Entity showcase: every building model in a grid, with status / night / weather / FX scenes.
// URL params:
//   status=constructing|fire|broken|destroyed|disabled|idle   progress=0..1 (constructing)
//   night=1   weather=rain|storm|snow|blizzard   labels=0
//   only=type1,type2   focus=type   cam=x,y,z   look=x,y,z   warm=seconds
//   scene=grid|anim|fx|vehicles
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BUILDINGS } from '../../src/content/buildings';
import type { BuildingState, GameContext, WeatherKind } from '../../src/core/types';
import { createEntityLayer, type EntityLayerDebug } from '../../src/render/entities';
import { FakeHost } from './fakeHost';
import { COAST_Z, LAND_Y, SEABED_Y, addBuilding, addWell, createFakeContext } from './fakeCtx';

const P = new URLSearchParams(location.search);
const night = P.get('night') === '1';
const scene = P.get('scene') ?? 'grid';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const host = new FakeHost(canvas, night);
const ctx = createFakeContext();
const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
document.body.appendChild(labels.domElement);

// ---- ground: land, beach, seabed, water -------------------------------------------------------
function ground(): void {
  const land = new THREE.Mesh(new THREE.BoxGeometry(700, 4, COAST_Z + 300), new THREE.MeshStandardMaterial({ color: 0x6f8f4e, roughness: 1 }));
  land.position.set(150, LAND_Y - 2, 0);
  land.position.z = COAST_Z - (COAST_Z + 300) / 2;
  land.receiveShadow = true;
  host.scene.add(land);
  const beach = new THREE.Mesh(new THREE.BoxGeometry(700, LAND_Y - SEABED_Y, 6), new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 1 }));
  beach.position.set(150, (LAND_Y + SEABED_Y) / 2, COAST_Z - 3 + 3);
  host.scene.add(beach);
  const seabed = new THREE.Mesh(new THREE.BoxGeometry(700, 2, 300), new THREE.MeshStandardMaterial({ color: 0x8d8363, roughness: 1 }));
  seabed.position.set(150, SEABED_Y - 1, COAST_Z + 150);
  seabed.receiveShadow = true;
  host.scene.add(seabed);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 300).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a6f9e, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1 }),
  );
  water.position.set(150, 62.9, COAST_Z + 150);
  water.receiveShadow = true;
  host.scene.add(water);
  // pad blocks under each building
  const padMat = new THREE.MeshStandardMaterial({ color: 0xa29d92, roughness: 1 });
  for (const b of Object.values(ctx.state.buildings)) {
    if (BUILDINGS[b.type]?.placement === 'water') continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.size[0], 1, b.size[1]), padMat);
    m.position.set(b.x + b.size[0] / 2, b.y - 0.5 + 0.001, b.z + b.size[1] / 2);
    m.receiveShadow = true;
    host.scene.add(m);
  }
}

function label(b: BuildingState, text: string): void {
  if (P.get('labels') === '0') return;
  const div = document.createElement('div');
  div.className = 'lbl';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(b.x + b.size[0] / 2, b.y + b.size[2] + 1.2, b.z + b.size[1] / 2);
  host.scene.add(o);
}

const CATS = ['support', 'drilling', 'production', 'environment', 'storage', 'midstream', 'logistics', 'processing', 'petrochem', 'power'];

function applyStatus(b: BuildingState): void {
  const st = P.get('status');
  if (!st) return;
  if (st === 'constructing') {
    b.status = 'constructing';
    b.constructionProgress = Number(P.get('progress') ?? 0.55);
  } else {
    b.status = st as BuildingState['status'];
    if (st === 'fire') b.fire = 0.8;
  }
}

function buildGrid(): void {
  const only = P.get('only')?.split(',');
  const types = Object.values(BUILDINGS)
    .filter((d) => d.category !== 'offshore' && d.id !== 'export_terminal')
    .filter((d) => !only || only.includes(d.id))
    .sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.order - b.order);
  let x = 10;
  let z = 10;
  let rowD = 0;
  const place = (type: string, patch: Partial<BuildingState> = {}, text = BUILDINGS[type].name) => {
    const [w, d] = BUILDINGS[type].size;
    if (x + w > 240) {
      x = 10;
      z += rowD + 9;
      rowD = 0;
    }
    const b = addBuilding(ctx, type, x, LAND_Y, z, 0, patch);
    applyStatus(b);
    label(b, text);
    x += w + 7;
    rowD = Math.max(rowD, d);
    return b;
  };
  for (const d of types) {
    if (d.id === 'wellhead') {
      for (const lift of ['natural', 'pumpjack', 'esp', 'gaslift'] as const) {
        const b = place('wellhead', {}, `Wellhead (${lift})`);
        const w = addWell(ctx, b.x + 1, LAND_Y, b.z + 1, { lift, wellheadId: b.id, rates: { oil: 180 + Math.random() * 200, gas: 300, water: 40 } });
        b.wellId = w.id;
      }
      continue;
    }
    const b = place(d.id);
    if (d.id === 'drilling_rig_land' || d.id === 'drilling_rig_heavy') {
      const w = addWell(ctx, b.x + Math.floor(b.size[0] / 2), LAND_Y, b.z + Math.floor(b.size[1] / 2), { status: d.id === 'drilling_rig_land' ? 'drilling' : 'tripping', rigId: b.id });
      b.wellId = w.id;
    }
    if (d.id === 'flare_stack') b.utilization = 0.7;
  }
  if (!only || only.includes('export_terminal')) {
    const b = addBuilding(ctx, 'export_terminal', 150, LAND_Y, COAST_Z - 10, 0);
    applyStatus(b);
    label(b, BUILDINGS.export_terminal.name);
  }
  // offshore row
  let ox = 20;
  for (const type of ['jackup_rig', 'semi_sub_rig', 'production_platform', 'fpso']) {
    if (only && !only.includes(type)) continue;
    const b = addBuilding(ctx, type, ox, 63, COAST_Z + 22, 0);
    applyStatus(b);
    label(b, BUILDINGS[type].name);
    if (type === 'jackup_rig' || type === 'semi_sub_rig') {
      const w = addWell(ctx, b.x + Math.floor(b.size[0] / 2), 63, b.z + Math.floor(b.size[1] / 2), { status: 'drilling', rigId: b.id, offshore: true });
      b.wellId = w.id;
    }
    ox += BUILDINGS[type].size[0] + 16;
  }
}

function buildAnimScene(): void {
  const rig = addBuilding(ctx, 'drilling_rig_land', 40, LAND_Y, 40);
  rig.wellId = addWell(ctx, 42, LAND_Y, 42, { status: 'drilling', rigId: rig.id }).id;
  const heavy = addBuilding(ctx, 'drilling_rig_heavy', 54, LAND_Y, 38);
  heavy.wellId = addWell(ctx, 57, LAND_Y, 41, { status: 'kick', rigId: heavy.id }).id;
  for (let i = 0; i < 3; i++) {
    const wh = addBuilding(ctx, 'wellhead', 30 + i * 6, LAND_Y, 54);
    wh.wellId = addWell(ctx, 31 + i * 6, LAND_Y, 55, { lift: 'pumpjack', rates: { oil: 100 + i * 150, gas: 100, water: 10 } }).id;
  }
  addBuilding(ctx, 'flare_stack', 50, LAND_Y, 55, 0, { utilization: 0.9 });
  const tank = addBuilding(ctx, 'oil_tank_small', 58, LAND_Y, 53);
  tank.status = 'fire';
  tank.fire = 1;
  ctx.state.hazards.fires.push({ id: 'f1', x: 60, y: LAND_Y, z: 55, intensity: 1, buildingId: tank.id, startedMinute: 0, spreadTimer: 0 });
  // blowouts: one burning, one gushing
  addWell(ctx, 72, LAND_Y, 44, { status: 'blowout', blowout: { startedDay: 1, onFire: true, flowRate: 4000, capProgress: 0 } });
  addWell(ctx, 84, LAND_Y, 50, { status: 'blowout', blowout: { startedDay: 1, onFire: false, flowRate: 4000, capProgress: 0 } });
  ctx.state.hazards.fires.push({ id: 'f2', x: 46, y: LAND_Y, z: 62, intensity: 0.7, startedMinute: 0, spreadTimer: 0 });
  ctx.state.networks.n1 = { id: 'n1', category: 'gas', pipeCount: 10, buildings: [], linepack: {}, capacity: 1, flow: 0, boosters: 0, anchor: { x: 36, y: LAND_Y, z: 62 }, leak: { x: 36, y: LAND_Y, z: 62, rate: 300, startedDay: 1 } };
  ctx.state.networks.n2 = { id: 'n2', category: 'oil', pipeCount: 10, buildings: [], linepack: {}, capacity: 1, flow: 0, boosters: 0, anchor: { x: 33, y: LAND_Y, z: 62 }, leak: { x: 33, y: LAND_Y, z: 62, rate: 300, startedDay: 1 } };
  addBuilding(ctx, 'wind_turbine', 70, LAND_Y, 58);
  addBuilding(ctx, 'truck_terminal', 26, LAND_Y, 36, 0, { utilization: 1 });
}

function buildVehicleScene(): void {
  addBuilding(ctx, 'truck_terminal', 60, LAND_Y, 60, 0, { utilization: 1 });
  addBuilding(ctx, 'rail_terminal', 40, LAND_Y, 80, 0, { utilization: 1 });
  addBuilding(ctx, 'helipad', 90, LAND_Y, 70);
  addBuilding(ctx, 'export_terminal', 110, LAND_Y, COAST_Z - 10, 0, { utilization: 1 });
  addBuilding(ctx, 'production_platform', 90, 63, COAST_Z + 30);
  for (const id of ['field_office', 'maintenance_depot', 'warehouse']) {
    const b = addBuilding(ctx, id, 70 + Math.random() * 10, LAND_Y, 40 + Math.random() * 10);
    b.workers = ['a', 'b', 'c', 'd', 'e'];
  }
  ctx.state.surveys.s1 = { id: 's1', kind: '2d', x0: 20, z0: 30, x1: 120, z1: 30, status: 'in_progress', progress: 0.4, quality: 1, fluidIndicators: false, startedDay: 1, cost: 0, name: 'Line 1' };
}

if (scene === 'anim' || scene === 'fx') buildAnimScene();
else if (scene === 'vehicles') buildVehicleScene();
else buildGrid();

const weather = P.get('weather') as WeatherKind | null;
if (weather) {
  ctx.state.weather.current = weather;
  ctx.state.weather.intensity = 0.9;
  ctx.state.weather.precipitation = 0.9;
  ctx.state.weather.windSpeed = weather === 'storm' || weather === 'blizzard' ? 16 : 6;
}
if (night) ctx.state.time.minuteOfDay = 23 * 60;

ground();
const layer = createEntityLayer(host, ctx) as unknown as EntityLayerDebug & { update(dt: number): void };
(window as unknown as Record<string, unknown>).harness = { host, ctx, layer, THREE };

// ---- camera ---------------------------------------------------------------------------------------
const controls = new OrbitControls(host.camera, canvas);
const v3 = (s: string | null) => (s ? new THREE.Vector3(...(s.split(',').map(Number) as [number, number, number])) : null);
const focus = P.get('focus');
const fb = focus ? Object.values(ctx.state.buildings).find((b) => b.type === focus) : undefined;
if (fb) {
  const c = new THREE.Vector3(fb.x + fb.size[0] / 2, fb.y + fb.size[2] * 0.4, fb.z + fb.size[1] / 2);
  const r = Math.max(fb.size[0], fb.size[1], fb.size[2] * 0.8);
  const az = Number(P.get('az') ?? 0.8);
  const dist = r * Number(P.get('zoom') ?? 1.35);
  host.camera.position.set(c.x + Math.sin(az) * dist, c.y + r * 0.55 + (fb.y < LAND_Y ? 4 : 0), c.z + Math.cos(az) * dist);
  controls.target.copy(c);
} else if (scene === 'anim' || scene === 'fx') {
  host.camera.position.set(38, 88, 98);
  controls.target.set(58, 66, 50);
} else if (scene === 'vehicles') {
  host.camera.position.set(60, 110, 150);
  controls.target.set(80, 64, 80);
} else {
  host.camera.position.set(70, 120, 175);
  controls.target.set(120, 62, 60);
}
const cam = v3(P.get('cam'));
const look = v3(P.get('look'));
if (cam) host.camera.position.copy(cam);
if (look) controls.target.copy(look);
controls.update();
host.setSunCenter(controls.target.x, controls.target.y, controls.target.z);

function resize(): void {
  host.resize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const warm = Number(P.get('warm') ?? 0);
for (let t = 0; t < warm; t += 1 / 30) layer.update(1 / 30);

let last = performance.now();
let tAcc = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  tAcc += dt;
  if ((scene === 'anim' || scene === 'fx') && Math.floor(tAcc / 6) !== Math.floor((tAcc - dt) / 6)) ctx.bus.emit('hazard:explosion', { x: 78, y: LAND_Y, z: 62, power: 1.5 });
  if (weather === 'storm' && Math.random() < dt * 0.4) ctx.bus.emit('weather:lightning', { x: controls.target.x + (Math.random() - 0.5) * 80, z: controls.target.z - 40 + Math.random() * 30 });
  host.update(dt);
  controls.update();
  layer.update(dt);
  host.camera.position.add(host.shakeOffset);
  host.renderer.render(host.scene, host.camera);
  host.camera.position.sub(host.shakeOffset);
  labels.render(host.scene, host.camera);
}
requestAnimationFrame(frame);
