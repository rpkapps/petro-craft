// Unit tests for player physics, raycast, inventory, line planning and the authoritative command handlers.
// Run: node --experimental-strip-types --no-warnings --import ./dev/player/register.mjs --test dev/player/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { raycastVoxels } from '../../src/player/raycast';
import { createBody, newStepEvents, stepBody } from '../../src/player/physics';
import { addItem, countItem, moveItem, removeItem } from '../../src/player/inventory';
import { lColumns, planLine } from '../../src/player/linePath';
import { breakTime } from '../../src/player/blockUtil';
import { createPlayerSimSystem } from '../../src/player/sim';
import { senseHazards } from '../../src/player/hazards';
import { scanColumn } from '../../src/player/scanner';
import { B, blockItemId } from '../../src/core/blocks';
import { EventBus } from '../../src/core/EventBus';
import { CommandBus } from '../../src/core/commands';
import { createInitialState } from '../../src/core/state';
import { createFakeGeology, createFakeWorld } from './fakeWorld';

// ---- helpers ------------------------------------------------------------------------------------------
/** Voxel query over a set of solid cells + ground plane at y < groundY. */
function grid(groundY = 64, extra = [], liquid = []) {
  const solid = new Set(extra.map((c) => c.join(',')));
  const wet = new Set(liquid.map((c) => c.join(',')));
  return {
    solid: (x, y, z) => y < groundY || solid.has(`${x},${y},${z}`),
    liquid: (x, y, z) => wet.has(`${x},${y},${z}`),
  };
}
const idle = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };
function run(body, q, intent, seconds, flying = false, dt = 1 / 60) {
  const ev = newStepEvents();
  const all = { jumped: false, landed: null, fallDistance: 0, steppedUp: 0, maxY: body.y };
  for (let t = 0; t < seconds; t += dt) {
    const e = newStepEvents();
    stepBody(body, intent, flying, q, dt, e);
    if (e.jumped) all.jumped = true;
    if (e.landed !== null) all.landed = e.landed;
    all.fallDistance = Math.max(all.fallDistance, e.fallDistance);
    all.steppedUp += e.steppedUp;
    all.maxY = Math.max(all.maxY, body.y);
  }
  void ev;
  return all;
}

// ---- raycast ------------------------------------------------------------------------------------------
test('raycast hits the ground with an up normal', () => {
  const get = (x, y, z) => (y < 64 ? B.STONE : B.AIR);
  const h = raycastVoxels({ x: 0.5, y: 70.5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 20, get, (b) => b !== B.AIR);
  assert.ok(h);
  assert.deepEqual([h.x, h.y, h.z, h.nx, h.ny, h.nz], [0, 63, 0, 0, 1, 0]);
  assert.ok(Math.abs(h.dist - 6.5) < 1e-9);
});

test('raycast diagonal into a wall reports the entered face', () => {
  const get = (x, y, z) => (x === 5 ? B.STONE : B.AIR);
  const h = raycastVoxels({ x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0.1, z: 0.3 }, 20, get, (b) => b !== B.AIR);
  assert.ok(h);
  assert.equal(h.x, 5);
  assert.deepEqual([h.nx, h.ny, h.nz], [-1, 0, 0]);
});

test('raycast respects max distance and misses', () => {
  const get = () => B.AIR;
  assert.equal(raycastVoxels({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 50, get, (b) => b !== B.AIR), null);
  const g2 = (x) => (x === 30 ? B.STONE : B.AIR);
  assert.equal(raycastVoxels({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 8, g2, (b) => b !== B.AIR), null);
});

// ---- physics ------------------------------------------------------------------------------------------
test('falls, lands on the ground and reports fall distance', () => {
  const b = createBody(0.5, 70, 0.5);
  const r = run(b, grid(), idle, 2);
  assert.ok(b.onGround);
  assert.ok(Math.abs(b.y - 64) < 1e-6, `y=${b.y}`);
  assert.ok(r.landed > 15, `impact ${r.landed}`);
  assert.ok(Math.abs(r.fallDistance - 6) < 0.05, `fall ${r.fallDistance}`);
});

test('jump reaches ~1.25 blocks and lands again', () => {
  const b = createBody(0.5, 64, 0.5);
  run(b, grid(), idle, 0.2);
  const r = run(b, grid(), { ...idle, jump: true }, 0.05);
  assert.ok(r.jumped);
  const r2 = run(b, grid(), idle, 1.2);
  const peak = Math.max(r.maxY, r2.maxY) - 64;
  assert.ok(peak > 1.15 && peak < 1.4, `peak ${peak}`);
  assert.ok(b.onGround && Math.abs(b.y - 64) < 1e-6);
});

test('walk speed converges to 4.3 b/s, sprint to 5.6', () => {
  const b = createBody(0.5, 64, 0.5);
  run(b, grid(), { ...idle, moveX: 1 }, 1);
  assert.ok(Math.abs(b.vx - 4.3) < 0.05, `vx ${b.vx}`);
  run(b, grid(), { ...idle, moveX: 1, sprint: true }, 1);
  assert.ok(Math.abs(b.vx - 5.6) < 0.05, `vx ${b.vx}`);
});

test('steps up a one-block ledge but not a two-block wall', () => {
  const ledge = [];
  for (let z = -3; z <= 3; z++) for (let x = 3; x < 10; x++) ledge.push([x, 64, z]);
  const b = createBody(0.5, 64, 0.5);
  const r = run(b, grid(64, ledge), { ...idle, moveX: 1 }, 1.2);
  assert.ok(b.y >= 65 - 1e-6, `y=${b.y}`);
  assert.ok(r.steppedUp > 0.9);
  const wall = [];
  for (let z = -3; z <= 3; z++) for (let y = 64; y < 66; y++) wall.push([3, y, z]);
  const c = createBody(0.5, 64, 0.5);
  run(c, grid(64, wall), { ...idle, moveX: 1 }, 1.5);
  assert.ok(c.x <= 3 - 0.3 + 1e-6 && c.y < 64.01, `x=${c.x} y=${c.y}`);
  assert.ok(c.collidedH);
});

test('sneaking never walks off an edge', () => {
  // Platform x in [0,4) at y=64 (top 65); void below elsewhere down to y<50.
  const plat = [];
  for (let x = 0; x < 4; x++) for (let z = -2; z <= 2; z++) plat.push([x, 64, z]);
  const q = grid(50, plat);
  const b = createBody(1.5, 65, 0.5);
  run(b, q, idle, 0.2);
  run(b, q, { ...idle, moveX: 1, sneak: true }, 3);
  assert.ok(b.onGround && b.y >= 65 - 1e-6, `y=${b.y}`);
  assert.ok(b.x > 4 && b.x < 4.3 + 1e-6, `x=${b.x}`);
  run(b, q, { ...idle, moveX: 1 }, 1);
  assert.ok(b.y < 65, 'walks off without sneak');
});

test('ceiling stops a jump', () => {
  const b = createBody(0.5, 64, 0.5);
  const q = grid(64, [[0, 66, 0]]);
  run(b, q, idle, 0.1);
  run(b, q, { ...idle, jump: true }, 0.4);
  assert.ok(b.y + 1.8 <= 66 + 1e-6);
});

test('swimming: sinks slowly, swims up with jump', () => {
  const water = [];
  for (let y = 64; y < 74; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) water.push([x, y, z]);
  const q = grid(64, [], water);
  const b = createBody(0.5, 70, 0.5);
  run(b, q, idle, 1);
  assert.ok(b.inLiquid && b.headInLiquid);
  assert.ok(b.vy > -3 && b.vy < 0, `vy ${b.vy}`);
  const y0 = b.y;
  run(b, q, { ...idle, jump: true }, 0.8);
  assert.ok(b.y > y0 + 1.5, `rose ${b.y - y0}`);
});

test('flying hovers and sneak descends to touchdown', () => {
  const b = createBody(0.5, 70, 0.5);
  run(b, grid(), idle, 1, true);
  assert.ok(Math.abs(b.y - 70) < 0.01);
  const ev = newStepEvents();
  for (let i = 0; i < 180; i++) stepBody(b, { ...idle, sneak: true }, true, grid(), 1 / 60, ev);
  assert.ok(ev.flyTouchdown && Math.abs(b.y - 64) < 1e-6);
});

test('break time uses tool speed, hand penalty and creative', () => {
  assert.equal(breakTime(B.STONE, 'tool:pickaxe'), 1.5 / 4);
  assert.ok(Math.abs(breakTime(B.STONE, null) - 1.5 * 3.3) < 1e-9);
  assert.equal(breakTime(B.STONE, null, true), 0);
  assert.equal(breakTime(B.BEDROCK, 'tool:pickaxe'), Infinity);
  assert.equal(breakTime(B.TALL_GRASS, null), 0);
  assert.equal(breakTime(B.LEAVES_OAK, null), 0.2);
});

// ---- inventory ----------------------------------------------------------------------------------------
test('inventory merge, overflow, remove and move', () => {
  const inv = new Array(4).fill(null);
  inv[1] = { item: 'block:dirt', count: 60 };
  assert.equal(addItem(inv, 'block:dirt', 10), 0);
  assert.equal(inv[1].count, 64);
  assert.equal(inv[0].count, 6);
  assert.equal(addItem(inv, 'tool:wrench', 3), 1); // tools don't stack: 2 empty slots
  assert.equal(countItem(inv, 'block:dirt'), 70);
  assert.equal(removeItem(inv, 'block:dirt', 66, 0), 66);
  assert.equal(countItem(inv, 'block:dirt'), 4);
  const j = [{ item: 'a', count: 10 }, { item: 'a', count: 60 }, { item: 'b', count: 1 }];
  moveItem(j, 0, 1);
  assert.deepEqual(j[0], { item: 'a', count: 6 });
  assert.equal(j[1].count, 64);
  moveItem(j, 0, 2);
  assert.deepEqual(j[0], { item: 'b', count: 1 });
  assert.deepEqual(j[2], { item: 'a', count: 6 });
});

// ---- line planning ------------------------------------------------------------------------------------
test('L columns and terrain-following risers keep face adjacency', () => {
  const cols = lColumns(0, 0, 3, 2, true);
  assert.deepEqual(cols.map((c) => `${c.x},${c.z}`), ['0,0', '1,0', '2,0', '3,0', '3,1', '3,2']);
  const surface = (x) => (x >= 2 ? 67 : 65);
  const { cells } = planLine({ x: 0, y: 65, z: 0 }, { x: 4, y: 67, z: 0 }, { xFirst: true, constantY: false, surfaceY: surface, maxCells: 100 });
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z), 1, `gap between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  const flat = planLine({ x: 0, y: 70, z: 0 }, { x: 5, y: 65, z: 0 }, { xFirst: true, constantY: true, surfaceY: surface, maxCells: 3 });
  assert.equal(flat.cells.length, 3);
  assert.ok(flat.truncated);
  assert.ok(flat.cells.every((c) => c.y === 70));
});

// ---- authoritative handlers -----------------------------------------------------------------------------
function makeCtx(creative = false) {
  const geology = createFakeGeology({ size: 64, flat: true, base: 66 });
  const bus = new EventBus();
  const world = createFakeWorld(geology, bus, { flat: true });
  const opts = { saveName: 't', companyName: 'T', seed: 1, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: true, creative };
  const state = createInitialState(opts, 'p1', { x: 32.5, y: 66, z: 32.5 });
  const commands = new CommandBus();
  const ctx = {
    state, world, geology, bus, commands, settings: { units: 'metric', keybinds: {} }, localPlayerId: 'p1', isAuthority: true,
    services: { construction: { buildingAt: () => undefined } },
    rng: Math.random, newId: (p) => `${p}${state.nextId++}`, notify() {},
    transact(amount, _cat, _note, requireFunds) {
      if (requireFunds && amount < 0 && state.company.money + amount < 0 && !state.meta.rules.creative) return false;
      state.company.money += amount;
      return true;
    },
    hasTech: () => false, modifier: () => 1,
  };
  commands.bind(ctx);
  createPlayerSimSystem().init(ctx);
  return ctx;
}

test('breakBlock: drop, stats, reach, unbreakable', () => {
  const ctx = makeCtx();
  const p = ctx.state.players.p1;
  p.inventory = new Array(36).fill(null);
  const r = ctx.commands.dispatch({ type: 'world/breakBlock', x: 32, y: 65, z: 33 });
  assert.ok(r.ok, r.error);
  assert.equal(ctx.world.getBlock(32, 65, 33), B.AIR);
  assert.equal(countItem(p.inventory, 'block:dirt'), 1); // grass drops dirt
  assert.equal(ctx.state.stats.blocksMined, 1);
  assert.equal(ctx.commands.dispatch({ type: 'world/breakBlock', x: 32, y: 0, z: 33 }).ok, false);
  assert.equal(ctx.commands.dispatch({ type: 'world/breakBlock', x: 5, y: 65, z: 5 }).error, 'Too far away');
  p.mode = 'drone';
  assert.ok(ctx.commands.dispatch({ type: 'world/breakBlock', x: 5, y: 65, z: 5 }).ok);
});

test('breakBlock floods with adjacent water at sea level', () => {
  const ctx = makeCtx();
  ctx.state.players.p1.mode = 'drone';
  ctx.world.setBlock(10, 62, 10, B.STONE);
  ctx.world.setBlock(11, 62, 10, B.WATER);
  assert.ok(ctx.commands.dispatch({ type: 'world/breakBlock', x: 10, y: 62, z: 10 }).ok);
  assert.equal(ctx.world.getBlock(10, 62, 10), B.WATER);
});

test('placeBlock consumes the slot and refuses occupied / player cells', () => {
  const ctx = makeCtx();
  const p = ctx.state.players.p1;
  const slot = p.inventory.findIndex((s) => s?.item === blockItemId(B.CONCRETE));
  const before = p.inventory[slot].count;
  assert.ok(ctx.commands.dispatch({ type: 'world/placeBlock', x: 34, y: 66, z: 32, slot }).ok);
  assert.equal(ctx.world.getBlock(34, 66, 32), B.CONCRETE);
  assert.equal(p.inventory[slot].count, before - 1);
  assert.equal(ctx.commands.dispatch({ type: 'world/placeBlock', x: 34, y: 66, z: 32, slot }).ok, false);
  assert.equal(ctx.commands.dispatch({ type: 'world/placeBlock', x: 32, y: 66, z: 32, slot }).error, 'A player is in the way');
  assert.equal(ctx.commands.dispatch({ type: 'world/placeBlock', x: 34, y: 66, z: 30, slot: 0 }).ok, false); // pickaxe
});

test('placeLine uses inventory first, then buys; fails when unaffordable or blocked', () => {
  const ctx = makeCtx();
  const p = ctx.state.players.p1;
  const item = blockItemId(B.PIPE_OIL);
  const points = [];
  for (let x = 0; x < 70 && points.length < 70; x++) points.push({ x: x % 64, y: 66 + Math.floor(x / 64), z: 5 });
  const money = ctx.state.company.money;
  const r = ctx.commands.dispatch({ type: 'world/placeLine', block: B.PIPE_OIL, points });
  assert.ok(r.ok, r.error);
  assert.equal(countItem(p.inventory, item), 0);
  assert.equal(ctx.state.company.money, money - 6 * 350);
  assert.equal(ctx.state.stats.blocksPlaced, 70);
  // Re-laying the same run is a no-op.
  assert.ok(ctx.commands.dispatch({ type: 'world/placeLine', block: B.PIPE_OIL, points }).ok);
  assert.equal(ctx.state.company.money, money - 6 * 350);
  // Blocked by terrain.
  const bad = ctx.commands.dispatch({ type: 'world/placeLine', block: B.PIPE_GAS, points: [{ x: 1, y: 65, z: 1 }] });
  assert.equal(bad.ok, false);
  // Unaffordable.
  ctx.state.company.money = 100;
  const pts = [{ x: 3, y: 66, z: 9 }, { x: 4, y: 66, z: 9 }];
  p.inventory = p.inventory.map((s) => (s?.item === blockItemId(B.PIPE_GAS) ? null : s));
  const un = ctx.commands.dispatch({ type: 'world/placeLine', block: B.PIPE_GAS, points: pts });
  assert.equal(un.ok, false);
  assert.match(un.error, /Not enough money/);
  assert.equal(ctx.world.getBlock(3, 66, 9), B.AIR);
});

test('sync, selectSlot, setMode and moveItem', () => {
  const ctx = makeCtx();
  const p = ctx.state.players.p1;
  assert.ok(ctx.commands.dispatch({ type: 'player/sync', position: { x: 10, y: 70, z: 11 }, velocity: { x: 1, y: 0, z: 0 }, yaw: 1, pitch: 0.2, health: 42 }).ok);
  assert.deepEqual(p.position, { x: 10, y: 70, z: 11 });
  assert.equal(p.health, 42);
  assert.ok(ctx.commands.dispatch({ type: 'player/selectSlot', slot: 4 }).ok);
  assert.equal(p.selectedSlot, 4);
  assert.equal(ctx.commands.dispatch({ type: 'player/selectSlot', slot: 9 }).ok, false);
  assert.ok(ctx.commands.dispatch({ type: 'player/setMode', mode: 'fly' }).ok);
  assert.equal(p.mode, 'fly');
  const a = p.inventory[0];
  assert.ok(ctx.commands.dispatch({ type: 'player/moveItem', from: 0, to: 30 }).ok);
  assert.equal(p.inventory[30], a);
  assert.equal(p.inventory[0], null);
});

// ---- hazards & scanner --------------------------------------------------------------------------------
test('hazard sensing: gas leak LEL falls off with distance; sour blowout H2S', () => {
  const ctx = makeCtx();
  ctx.state.networks.n1 = { id: 'n1', category: 'gas', pipeCount: 5, buildings: [], linepack: {}, capacity: 1, flow: 0, boosters: 0, anchor: { x: 0, y: 0, z: 0 }, leak: { x: 10, y: 66, z: 10, rate: 200, startedDay: 1 } };
  const near = senseHazards(ctx.state, ctx.geology, { x: 11, y: 67, z: 10 });
  const far = senseHazards(ctx.state, ctx.geology, { x: 30, y: 67, z: 10 });
  assert.ok(near.lel > far.lel && near.lel > 30);
  assert.equal(near.nearest.kind, 'leak');
  ctx.state.wells.w1 = { id: 'w1', x: 20, z: 20, surfaceY: 66, status: 'blowout', penetrated: ['r1'], blowout: { onFire: false } };
  const bo = senseHazards(ctx.state, ctx.geology, { x: 22, y: 67, z: 20 });
  assert.ok(bo.h2s > 100, `h2s ${bo.h2s}`);
});

test('scanner hides undiscovered reservoirs and names discovered ones', () => {
  const ctx = makeCtx();
  const surf = ctx.world.getSurfaceY(32, 32);
  const hidden = scanColumn(ctx.state, ctx.geology, 32, 32, surf, 'metric', () => 0.5);
  assert.ok(!hidden.lines.join('\n').includes('Eagle Sand A'));
  ctx.state.reservoirs.r1 = { id: 'r1', discovered: true };
  const shown = scanColumn(ctx.state, ctx.geology, 32, 32, surf, 'metric', () => 0.5);
  assert.ok(shown.lines.join('\n').includes('OIL — Eagle Sand A'), shown.lines.join('\n'));
  assert.ok(shown.lines.length <= 10);
});
