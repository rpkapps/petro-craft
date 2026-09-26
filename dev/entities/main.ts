// Entity showcase: every building model in a grid, with status / night / weather / FX scenes.
// URL params:
//   status=constructing|fire|broken|destroyed|disabled|idle   progress=0..1 (constructing)
//   night=1   weather=rain|storm|snow|blizzard   labels=0
//   only=type1,type2   focus=type   cam=x,y,z   look=x,y,z   warm=seconds
//   scene=grid|anim|fx|vehicles|traffic|stress|avatar|drops
//   inst=0 (disable instanced building rendering)   paths=1 (traffic: draw truck/ship routes)
//   tex=classic|high|ultra (entity texture quality)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { B } from '../../src/core/blocks';
import { createPlayer } from '../../src/core/state';
import { BUILDINGS } from '../../src/content/buildings';
import type { BuildingState, DroppedItem, GameContext, PlayerState, WeatherKind } from '../../src/core/types';
import { createEntityLayer, type EntityLayerDebug } from '../../src/render/entities';
import { INSTANCING } from '../../src/render/entities/config';
import { FakeHost } from './fakeHost';
import { COAST_Z, LAKE, LAND_Y, RIVER_X, SEABED_Y, addBuilding, addWell, createFakeContext } from './fakeCtx';

const P = new URLSearchParams(location.search);
const night = P.get('night') === '1';
const scene = P.get('scene') ?? 'grid';
if (P.get('inst') === '0') INSTANCING.enabled = false;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const host = new FakeHost(canvas, night);
const ctx = createFakeContext(scene === 'traffic' ? 'hills' : 'flat');
const geo = ctx.geology;
const tex = P.get('tex');
if (tex === 'high' || tex === 'ultra' || tex === 'classic') ctx.settings.textureQuality = tex;
const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
document.body.appendChild(labels.domElement);
const statsEl = document.getElementById('stats') as HTMLDivElement;

/** Ground height at a footprint centre (hills terrain aware). */
const gy = (x: number, z: number) => geo.surfaceHeight(Math.floor(x), Math.floor(z));

// ---- ground: land, beach, seabed, water -------------------------------------------------------
function flatGround(): void {
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
}

/** Voxel-style heightfield (top faces + risers) for the hills terrain, with roads and trees. */
function hillsGround(x0: number, z0: number, x1: number, z1: number): void {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const quad = (a: number[], b: number[], d: number[], e: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...d, ...a, ...d, ...e);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  const H = (x: number, z: number) => Math.max(geo.surfaceHeight(x, z), SEABED_Y);
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      const h = H(x, z);
      const wet = h < 63;
      const road = ctx.world.getBlock(x, h, z) === B.ASPHALT_ROAD;
      if (road) c.setHex(0x2e2f31);
      else if (wet) c.setHex(h < 55 ? 0x8d8363 : 0xb9a57a);
      else if (h <= 64 && (z > COAST_Z - 6 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3 || Math.abs(x - RIVER_X) < 6)) c.setHex(0xcdb98a);
      else c.setHSL(0.25 + (h - 60) * 0.004, 0.38, 0.33 + ((x * 7 + z * 13) % 5) * 0.008 + (h - 64) * 0.012);
      const top = road ? h + 1 : h;
      quad([x, top, z], [x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z], c);
      // risers toward lower neighbours
      const side = c.clone().multiplyScalar(0.72);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nh = H(x + dx, z + dz);
        if (nh >= top) continue;
        if (dx === 1) quad([x + 1, top, z], [x + 1, top, z + 1], [x + 1, nh, z + 1], [x + 1, nh, z], side);
        if (dx === -1) quad([x, top, z + 1], [x, top, z], [x, nh, z], [x, nh, z + 1], side);
        if (dz === 1) quad([x + 1, top, z + 1], [x, top, z + 1], [x, nh, z + 1], [x + 1, nh, z + 1], side);
        if (dz === -1) quad([x, top, z], [x + 1, top, z], [x + 1, nh, z], [x, nh, z], side);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  host.scene.add(m);
  // trees
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6b4e2e, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 1 });
  for (const [k, t] of ctx.world.trees) {
    const x = Math.floor(k / 4096);
    const z = k % 4096;
    const s = geo.surfaceHeight(x, z);
    const tr = new THREE.Mesh(new THREE.BoxGeometry(1, t, 1), trunk);
    tr.position.set(x + 0.5, s + t / 2, z + 0.5);
    const lv = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), leaves);
    lv.position.set(x + 0.5, s + t + 0.5, z + 0.5);
    tr.castShadow = lv.castShadow = true;
    host.scene.add(tr, lv);
  }
}

function water(): void {
  const w = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a6f9e, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1 }),
  );
  w.position.set(256, 62.9, 256);
  w.receiveShadow = true;
  host.scene.add(w);
}

function pads(): void {
  // one instanced draw call for every pad (keeps the harness's own draw calls out of the measurements)
  const list = Object.values(ctx.state.buildings).filter((b) => BUILDINGS[b.type]?.placement !== 'water');
  if (!list.length) return;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xa29d92, roughness: 1 }), list.length);
  const m = new THREE.Matrix4();
  list.forEach((b, i) => {
    const depth = Math.max(1, b.y - SEABED_Y);
    m.compose(new THREE.Vector3(b.x + b.size[0] / 2, b.y - depth / 2 + 0.001, b.z + b.size[1] / 2), new THREE.Quaternion(), new THREE.Vector3(b.size[0], depth, b.size[1]));
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = true;
  host.scene.add(mesh);
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
        if (lift === 'natural') b.data.flareRate = 1800;
        if (lift === 'esp') b.data.ventRate = 900;
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
    if (type === 'production_platform') b.data.flareRate = 25000;
    b.workers = ['a', 'b', 'c', 'd', 'e', 'f'];
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
    if (i === 1) wh.data.flareRate = 2500;
    if (i === 2) wh.data.ventRate = 1500;
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
  addBuilding(ctx, 'truck_terminal', 26, LAND_Y, 36, 0, { utilization: 1, data: { salesUtil: 1 } });
}

function buildVehicleScene(): void {
  addBuilding(ctx, 'truck_terminal', 60, LAND_Y, 60, 0, { utilization: 1, data: { salesUtil: 1 } });
  addBuilding(ctx, 'rail_terminal', 40, LAND_Y, 80, 0, { utilization: 1, data: { salesUtil: 1 } });
  addBuilding(ctx, 'helipad', 90, LAND_Y, 70);
  addBuilding(ctx, 'export_terminal', 110, LAND_Y, COAST_Z - 10, 0, { utilization: 1, data: { salesUtil: 1 } });
  addBuilding(ctx, 'production_platform', 90, 63, COAST_Z + 30);
  for (const id of ['field_office', 'maintenance_depot', 'warehouse']) {
    const b = addBuilding(ctx, id, 64 + ['field_office', 'maintenance_depot', 'warehouse'].indexOf(id) * 9, LAND_Y, 40);
    b.workers = ['a', 'b', 'c', 'd', 'e'];
  }
  ctx.state.surveys.s1 = { id: 's1', kind: '2d', x0: 20, z0: 30, x1: 120, z1: 30, status: 'in_progress', progress: 0.4, quality: 1, fluidIndicators: false, startedDay: 1, cost: 0, name: 'Line 1' };
}

function buildFxScene(): void {
  addWell(ctx, 60, LAND_Y, 50, { status: 'blowout', blowout: { startedDay: 1, onFire: true, flowRate: 4000, capProgress: 0 } });
  addWell(ctx, 84, LAND_Y, 50, { status: 'blowout', blowout: { startedDay: 1, onFire: false, flowRate: 4000, capProgress: 0 } });
  const rig = addBuilding(ctx, 'drilling_rig_land', 100, LAND_Y, 48);
  rig.wellId = addWell(ctx, 102, LAND_Y, 50, { status: 'kick', rigId: rig.id }).id;
  ctx.state.networks.n1 = { id: 'n1', category: 'water', pipeCount: 10, buildings: [], linepack: {}, capacity: 1, flow: 0, boosters: 0, anchor: { x: 72, y: LAND_Y, z: 58 }, leak: { x: 72, y: LAND_Y, z: 58, rate: 300, startedDay: 1 } };
  ctx.state.networks.n2 = { id: 'n2', category: 'oil', pipeCount: 10, buildings: [], linepack: {}, capacity: 1, flow: 0, boosters: 0, anchor: { x: 76, y: LAND_Y, z: 58 }, leak: { x: 76, y: LAND_Y, z: 58, rate: 300, startedDay: 1 } };
}

/** Pathfinding showcase on hilly terrain: blocked lanes, a road, a lake, a river bridge, a coast. */
function buildTrafficScene(): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const place = (type: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0, patch: Partial<BuildingState> = {}) => {
    const b = addBuilding(ctx, type, x, 0, z, rot, patch);
    b.y = gy(b.x + b.size[0] / 2, b.z + b.size[1] / 2);
    return b;
  };
  // truck terminal hemmed in on both lane ends: trucks must drive round the blocking buildings
  place('truck_terminal', 70, 40, 0, { data: { salesUtil: 1 } });
  place('warehouse', 79, 38);
  place('field_office', 60, 39);
  place('oil_tank_small', 64, 30);
  place('oil_tank_small', 70, 30);
  // an asphalt road from the terminal yard west to the map edge: trucks should prefer it
  for (let x = 0; x <= 62; x++) for (const z of [47, 48]) ctx.world.setBlock(x, gy(x, z), z, B.ASPHALT_ROAD, 'player');
  for (let z = 44; z <= 48; z++) for (const x of [62, 63]) ctx.world.setBlock(x, gy(x, z), z, B.ASPHALT_ROAD, 'player');
  // rail terminal: open to the east across the river (bridge), dead-ended to the west by a plant
  place('rail_terminal', 170, 88, 0, { data: { salesUtil: 1 } });
  place('gas_plant', 138, 84);
  // marine terminal + offshore obstacles, FPSO further out
  place('export_terminal', 100, COAST_Z - 10, 0, { data: { salesUtil: 1 } });
  addBuilding(ctx, 'production_platform', 96, 63, COAST_Z + 34, 0, { workers: ['a', 'b', 'c', 'd', 'e', 'f'] });
  addBuilding(ctx, 'jackup_rig', 118, 63, COAST_Z + 30, 0, { workers: ['a', 'b', 'c', 'd'] });
  addBuilding(ctx, 'fpso', 250, 63, COAST_Z + 70, 0, { data: { salesUtil: 1, flareRate: 30000 }, workers: ['a', 'b', 'c', 'd', 'e', 'f'] });
  // scattered trees (not inside footprints / water / roads)
  const bs = Object.values(ctx.state.buildings);
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(8 + rnd() * 300);
    const z = Math.floor(4 + rnd() * (COAST_Z - 14));
    if (geo.waterDepth(x, z) > 0 || Math.abs(z - 47.5) < 3) continue;
    if (bs.some((b) => x >= b.x - 3 && x < b.x + b.size[0] + 3 && z >= b.z - 3 && z < b.z + b.size[1] + 3)) continue;
    ctx.world.trees.set(x * 4096 + z, 4 + Math.floor(rnd() * 2));
  }
  for (const b of bs) if (b.type !== 'truck_terminal' && b.type !== 'rail_terminal' && BUILDINGS[b.type].placement !== 'water') b.workers = ['a', 'b', 'c', 'd'];
}

/** Draw-call stress test: 400 pumpjack wellheads, 100 tanks, turbines and solar farms. */
function buildStressScene(): void {
  const n = Number(P.get('n') ?? 20);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const wh = addBuilding(ctx, 'wellhead', 10 + i * 6, LAND_Y, 4 + j * 5.5);
      wh.x = Math.round(wh.x);
      wh.z = Math.round(wh.z);
      wh.wellId = addWell(ctx, wh.x + 1, LAND_Y, wh.z + 1, { lift: 'pumpjack', choke: 0.3 + ((i * 7 + j * 3) % 10) / 14 }).id;
    }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) addBuilding(ctx, 'oil_tank_small', 140 + i * 6, LAND_Y, 4 + j * 6);
  for (let i = 0; i < 6; i++) addBuilding(ctx, 'solar_farm', 140 + (i % 3) * 10, LAND_Y, 66 + Math.floor(i / 3) * 10);
  for (let i = 0; i < 12; i++) addBuilding(ctx, 'wind_turbine', 210 + (i % 3) * 12, LAND_Y, 8 + Math.floor(i / 3) * 16);
}

/** Players: the local body parked in drone view, remote players walking, running, flying, idling. */
function buildAvatarScene(): void {
  const players = ctx.state.players;
  const local = players.p1;
  local.mode = 'drone';
  local.position = { x: 60, y: LAND_Y, z: 60 };
  local.yaw = -0.6;
  local.color = '#ff8a1f';
  const add = (id: string, name: string, color: string, patch: Partial<PlayerState>) => {
    const p = createPlayer(id, name, { x: 60, y: LAND_Y, z: 60 });
    Object.assign(p, { color, ...patch });
    players[id] = p;
  };
  add('p2', 'Roughneck Ray', '#3a78c9', {});
  add('p3', 'Sky Sam', '#2fb36a', { mode: 'fly' });
  add('p4', 'Idle Ida', '#e0425a', { position: { x: 57, y: LAND_Y, z: 63 }, pitch: 0.3 });
  add('p5', 'Runner Rui', '#f2c230', {});
  addBuilding(ctx, 'field_office', 64, LAND_Y, 52);
}

function tickAvatars(t: number): void {
  const pl = ctx.state.players;
  const circle = (p: PlayerState, cx: number, cz: number, r: number, w: number, y: number) => {
    const a = t * w;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    // velocity along the tangent; yaw such that forward = (−sin yaw, −cos yaw)
    const vx = -Math.sin(a) * r * w;
    const vz = Math.cos(a) * r * w;
    p.velocity = { x: vx, y: 0, z: vz };
    p.position = { x, y, z };
    p.yaw = Math.atan2(-vx, -vz);
  };
  if (pl.p2) circle(pl.p2, 60, 60, 6, 0.5, LAND_Y);
  if (pl.p3) circle(pl.p3, 60, 60, 10, 0.35, LAND_Y + 5 + Math.sin(t) * 0.5);
  if (pl.p5) circle(pl.p5, 60, 60, 13, -0.55, LAND_Y);
  if (pl.p4) pl.p4.yaw = 2.2;
}

/** A field of dropped stacks: textured block cubes, tool tokens, supply crates, drums; some come and go. */
const DROP_ITEMS = ['block:grass', 'block:stone', 'block:asphalt_road', 'block:concrete', 'block:log_oak', 'block:brick', 'block:sand', 'block:lamp', 'block:hazard_stripe', 'block:container_red', 'block:planks', 'block:glass', 'tool:wrench', 'tool:extinguisher', 'tool:scanner', 'tool:detector', 'drill_bit', 'cement', 'spare_parts', 'crude_oil'];
let dropSeq = 0;
function addDrop(item: string, x: number, z: number, count: number, v?: [number, number, number]): void {
  const d: DroppedItem & { vx?: number; vy?: number; vz?: number } = { id: `d${dropSeq++}`, item, count, x, y: LAND_Y + 0.25, z, droppedMinute: 0 };
  if (v) [d.vx, d.vy, d.vz] = v;
  (ctx.state.drops ??= []).push(d);
}
function buildDropScene(): void {
  DROP_ITEMS.forEach((item, i) => addDrop(item, 56 + (i % 5) * 1.4, 56 + Math.floor(i / 5) * 1.4, [1, 5, 20, 64][i % 4]));
  for (let i = 0; i < 120; i++) addDrop(DROP_ITEMS[i % DROP_ITEMS.length], 40 + (i % 12) * 1.6, 70 + Math.floor(i / 12) * 1.6, 1 + (i % 3) * 10);
}
function tickDrops(dt: number, t: number): void {
  const list = (ctx.state.drops ?? []) as (DroppedItem & { vx?: number; vy?: number; vz?: number })[];
  // simple toss physics for flying stacks (the real sim does this in player/drops.ts)
  for (const d of list) {
    if (d.vy === undefined) continue;
    d.x += (d.vx ?? 0) * dt;
    d.z += (d.vz ?? 0) * dt;
    d.vy -= 24 * dt;
    d.y += d.vy * dt;
    if (d.y <= LAND_Y + 0.25) {
      d.y = LAND_Y + 0.25;
      delete d.vx;
      delete d.vy;
      delete d.vz;
    }
  }
  // every 1.5 s: pick one up and toss a new one
  if (Math.floor(t / 1.5) !== Math.floor((t - dt) / 1.5) && list.length > 20) {
    list.splice(20 + Math.floor(Math.random() * (list.length - 20)), 1);
    addDrop(DROP_ITEMS[Math.floor(Math.random() * DROP_ITEMS.length)], 62, 64, 1 + Math.floor(Math.random() * 30), [(Math.random() - 0.5) * 3, 4, 2 + Math.random() * 2]);
  }
}

if (scene === 'anim') buildAnimScene();
else if (scene === 'fx') buildFxScene();
else if (scene === 'vehicles') buildVehicleScene();
else if (scene === 'traffic') buildTrafficScene();
else if (scene === 'stress') buildStressScene();
else if (scene === 'avatar') buildAvatarScene();
else if (scene === 'drops') buildDropScene();
else buildGrid();

const weather = P.get('weather') as WeatherKind | null;
if (weather) {
  ctx.state.weather.current = weather;
  ctx.state.weather.intensity = 0.9;
  ctx.state.weather.precipitation = 0.9;
  ctx.state.weather.windSpeed = weather === 'storm' || weather === 'blizzard' ? 16 : 6;
}
if (night) ctx.state.time.minuteOfDay = 23 * 60;

if (scene === 'traffic') hillsGround(0, 0, 330, COAST_Z + 6);
else flatGround();
water();
pads();
const layer = createEntityLayer(host, ctx) as unknown as EntityLayerDebug & { update(dt: number): void };
const stats = { calls: 0, triangles: 0, geometries: 0, frames: 0, instancedBatches: 0, instancedMembers: 0, fps: 0, tex: 'classic', texBytes: 0 };
(window as unknown as Record<string, unknown>).harness = { host, ctx, layer, THREE, stats };

// ---- camera ---------------------------------------------------------------------------------------
const controls = new OrbitControls(host.camera, canvas);
(window as unknown as { harness: Record<string, unknown> }).harness.controls = controls;
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
} else if (scene === 'fx') {
  host.camera.position.set(80, 74, 96);
  controls.target.set(80, 72, 50);
} else if (scene === 'anim') {
  host.camera.position.set(38, 88, 98);
  controls.target.set(58, 66, 50);
} else if (scene === 'vehicles') {
  host.camera.position.set(60, 110, 150);
  controls.target.set(80, 64, 80);
} else if (scene === 'traffic') {
  host.camera.position.set(120, 230, 230);
  controls.target.set(130, 62, 80);
} else if (scene === 'stress') {
  host.camera.position.set(95, 150, 230);
  controls.target.set(95, 64, 70);
} else if (scene === 'avatar') {
  host.camera.position.set(76, 72, 76);
  controls.target.set(60, 65, 60);
} else if (scene === 'drops') {
  host.camera.position.set(66, 70, 70);
  controls.target.set(58, 64, 60);
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
if (scene === 'traffic' || scene === 'stress') {
  const sc = host.sun.shadow.camera;
  sc.left = sc.bottom = -260;
  sc.right = sc.top = 260;
  sc.updateProjectionMatrix();
}

function resize(): void {
  host.resize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// ---- debug route overlay (traffic) ------------------------------------------------------------------
const routeLines = new THREE.Group();
host.scene.add(routeLines);
function drawRoutes(): void {
  routeLines.clear();
  type RouteLike = { xs: Float32Array; zs: Float32Array; count: number };
  const add = (r: RouteLike | null | undefined, color: number, lift: number) => {
    if (!r) return;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < r.count; i++) pts.push(new THREE.Vector3(r.xs[i], geo.surfaceHeight(Math.floor(r.xs[i]), Math.floor(r.zs[i])) + lift, r.zs[i]));
    routeLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false })));
  };
  const traffic = layer.traffic as unknown as { trucks: { terminals: Map<string, { lanes: { route: RouteLike | null }[] }> }; ships: { berths: Map<string, { route: RouteLike | null }> } };
  for (const t of traffic.trucks.terminals.values()) for (const l of t.lanes) add(l.route, 0xff3030, 1.5);
  for (const b of traffic.ships.berths.values()) add(b.route, 0x30c0ff, 66 - SEABED_Y);
}

const warm = Number(P.get('warm') ?? 0);
let simT = 0;
const tick = (dt: number) => {
  simT += dt;
  if (scene === 'avatar') tickAvatars(simT);
  if (scene === 'drops') tickDrops(dt, simT);
  layer.update(dt);
};
for (let t = 0; t < warm; t += 1 / 30) tick(1 / 30);

let last = performance.now();
let tAcc = 0;
let fpsAcc = 0;
let fpsN = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  tAcc += dt;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 1) {
    stats.fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }
  if ((scene === 'anim' || scene === 'fx') && P.get('boom') !== '0' && Math.floor(tAcc / 6) !== Math.floor((tAcc - dt) / 6)) ctx.bus.emit('hazard:explosion', { x: 78, y: LAND_Y, z: 62, power: 1.5 });
  if (weather === 'storm' && Math.random() < dt * 0.4) ctx.bus.emit('weather:lightning', { x: controls.target.x + (Math.random() - 0.5) * 80, z: controls.target.z - 40 + Math.random() * 30 });
  host.update(dt);
  controls.update();
  tick(dt);
  if (P.get('paths') === '1' && (stats.frames === 0 || Math.floor(tAcc) !== Math.floor(tAcc - dt))) drawRoutes();
  host.camera.position.add(host.shakeOffset);
  host.renderer.render(host.scene, host.camera);
  host.camera.position.sub(host.shakeOffset);
  labels.render(host.scene, host.camera);
  const info = host.renderer.info;
  stats.calls = info.render.calls;
  stats.triangles = info.render.triangles;
  stats.geometries = info.memory.geometries;
  stats.frames++;
  stats.instancedBatches = layer.batcher.batchCount;
  stats.instancedMembers = layer.batcher.memberCount;
  stats.tex = layer.lib.quality;
  stats.texBytes = layer.lib.textureBytes;
  if (statsEl) statsEl.textContent = `${stats.tex} · draw calls ${stats.calls} · tris ${(stats.triangles / 1000).toFixed(0)}k · instanced ${stats.instancedMembers} in ${stats.instancedBatches} batches · ${stats.fps.toFixed(1)} fps`;
}
requestAnimationFrame(frame);
