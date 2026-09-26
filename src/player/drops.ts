// Dropped item stacks lying in the world (GameState.drops): spawning in front of a player (tossed along the view),
// merging with nearby same-item stacks, pickup into an inventory, and the per-step physics — toss arc, gravity,
// resting on solid ground, sinking in water, nudging out of blocks, despawn after 5 game days and the list cap.
//
// Motion extension: a flying stack carries optional `vx`, `vy`, `vz` (blocks per real second) on top of the
// DroppedItem shape; the fields are removed once it comes to rest. Renderers can extrapolate `pos + v·t` between
// sim steps for a smooth arc. Position is the item's centre; a resting stack sits DROP.restHeight above its floor.
import type { DroppedItem, GameContext, GameState, PlayerState, Vec3 } from '../core/types';
import { IS_LIQUID } from '../core/blocks';
import { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, SIM_STEP_MS } from '../core/constants';
import { DROP } from './config';
import { maxStack } from './blockUtil';
import { addItem } from './inventory';

/** A DroppedItem with the optional motion extension written by this module (plain JSON). */
export interface MovingDrop extends DroppedItem {
  vx?: number;
  vy?: number;
  vz?: number;
}

type Result = { ok: boolean; error?: string; data?: unknown };
const fail = (error: string): Result => ({ ok: false, error });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The drop list, created on first use. */
export function dropsOf(state: GameState): MovingDrop[] {
  if (!Array.isArray(state.drops)) state.drops = [];
  return state.drops as MovingDrop[];
}

/** Drop invalid entries (bad saves) and cap the list. */
export function normaliseDrops(state: GameState): void {
  if (state.drops === undefined) return;
  const list = Array.isArray(state.drops) ? state.drops : [];
  state.drops = list.filter(
    (d) => !!d && typeof d.id === 'string' && typeof d.item === 'string' && isNum(d.count) && d.count >= 1 && isNum(d.x) && isNum(d.y) && isNum(d.z),
  );
  for (const d of state.drops) {
    d.count = Math.floor(d.count);
    if (!isNum(d.droppedMinute)) d.droppedMinute = state.time.totalMinutes;
  }
  capDrops(state.drops);
}

function solidAt(ctx: GameContext, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  if (iy < 0) return true;
  if (ix < 0 || iz < 0 || ix >= w.sizeX || iz >= w.sizeZ) return true;
  if (iy >= w.height) return false;
  return w.isSolid(ix, iy, iz);
}

function liquidAt(ctx: GameContext, x: number, y: number, z: number): boolean {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  return ctx.world.inBounds(ix, iy, iz) && IS_LIQUID[ctx.world.getBlock(ix, iy, iz)] === 1;
}

const isMoving = (d: MovingDrop) => !!(d.vx || d.vy || d.vz);

function stopMotion(d: MovingDrop): void {
  delete d.vx;
  delete d.vy;
  delete d.vz;
}

/** Remove the oldest stacks beyond DROP.maxDrops. */
function capDrops(list: MovingDrop[]): void {
  const excess = list.length - DROP.maxDrops;
  if (excess <= 0) return;
  const oldest = new Set(
    list
      .map((d, i) => ({ i, m: d.droppedMinute }))
      .sort((a, b) => a.m - b.m || a.i - b.i)
      .slice(0, excess)
      .map((e) => e.i),
  );
  let w = 0;
  for (let i = 0; i < list.length; i++) if (!oldest.has(i)) list[w++] = list[i];
  list.length = w;
}

/** A same-item stack within DROP.mergeRadius of `at` that can absorb `count` more items (not `except`). */
function mergeTarget(list: MovingDrop[], item: string, count: number, at: Vec3, except?: MovingDrop): MovingDrop | null {
  const max = maxStack(item);
  let best: MovingDrop | null = null;
  let bestD: number = DROP.mergeRadius;
  for (const d of list) {
    if (d === except || d.item !== item || d.count + count > max) continue;
    const dist = Math.hypot(d.x - at.x, d.y - at.y, d.z - at.z);
    if (dist <= bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Put a stack into the world at `pos` (item centre) with an optional initial velocity. Merges into a nearby
 * same-item stack when it fits (the merged stack keeps its position and refreshes its despawn timer).
 */
export function spawnDrop(
  ctx: GameContext, item: string, count: number, pos: Vec3, vel?: Vec3, droppedBy?: string,
): { drop: MovingDrop; merged: boolean } {
  const list = dropsOf(ctx.state);
  const now = ctx.state.time.totalMinutes;
  const n = Math.max(1, Math.floor(count));
  const target = mergeTarget(list, item, n, pos);
  if (target) {
    target.count += n;
    target.droppedMinute = now;
    if (droppedBy) target.droppedBy = droppedBy;
    return { drop: target, merged: true };
  }
  const w = ctx.world;
  const drop: MovingDrop = {
    id: ctx.newId('drop'),
    item,
    count: n,
    x: Math.min(Math.max(pos.x, DROP.radius), w.sizeX - DROP.radius),
    y: pos.y,
    z: Math.min(Math.max(pos.z, DROP.radius), w.sizeZ - DROP.radius),
    droppedMinute: now,
  };
  if (droppedBy) drop.droppedBy = droppedBy;
  if (vel && (vel.x || vel.y || vel.z)) {
    drop.vx = vel.x;
    drop.vy = vel.y;
    drop.vz = vel.z;
  }
  list.push(drop);
  capDrops(list);
  return { drop, merged: false };
}

/** Spawn point and toss velocity for a stack dropped by a player (from the synced position, yaw and pitch). */
export function tossFrom(ctx: GameContext, p: PlayerState): { pos: Vec3; vel: Vec3 } {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const ex = p.position.x, ez = p.position.z;
  const y = p.position.y + PLAYER_EYE_HEIGHT - DROP.spawnBelowEye;
  // Stop short of walls so the stack never spawns inside (or behind) a block.
  let dist: number = DROP.spawnDistance;
  let blocked = false;
  for (let t = 0.1; t <= DROP.spawnDistance + 1e-9; t += 0.1) {
    if (solidAt(ctx, ex + fx * t, y, ez + fz * t)) {
      dist = Math.max(0, t - 0.1 - DROP.radius);
      blocked = true;
      break;
    }
  }
  const pos = { x: ex + fx * dist, y, z: ez + fz * dist };
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const pv = p.velocity ?? { x: 0, y: 0, z: 0 };
  const vel = blocked
    ? { x: 0, y: DROP.tossUp * 0.5, z: 0 }
    : { x: fx * cp * DROP.tossSpeed + (pv.x || 0), y: sp * DROP.tossSpeed + DROP.tossUp, z: fz * cp * DROP.tossSpeed + (pv.z || 0) };
  return { pos, vel };
}

/** 'player/dropItem': take `count` (default: the whole stack) from a slot and toss it in front of the player. */
export function dropFromSlot(ctx: GameContext, p: PlayerState, slot: unknown, count: unknown): Result {
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= p.inventory.length) return fail('Invalid inventory slot');
  if (p.health <= 0) return fail('Cannot drop items right now');
  const s = slot as number;
  const stack = p.inventory[s];
  if (!stack || stack.count <= 0) return fail('Nothing to drop');
  let n = stack.count;
  if (count !== undefined && count !== null) {
    if (!isNum(count) || count < 1) return fail('Invalid count');
    n = Math.min(stack.count, Math.floor(count));
  }
  const item = stack.item;
  stack.count -= n;
  if (stack.count <= 0) p.inventory[s] = null;
  const { pos, vel } = tossFrom(ctx, p);
  const { drop, merged } = spawnDrop(ctx, item, n, pos, vel, p.id);
  ctx.bus.emit('player:itemDropped', { dropId: drop.id });
  return { ok: true, data: { dropId: drop.id, item, count: n, merged } };
}

/** Distance from a point to the player's body (vertical segment feet..head). */
export function distanceToBody(p: Vec3, at: Vec3): number {
  const cy = Math.min(Math.max(at.y, p.y), p.y + PLAYER_HEIGHT);
  return Math.hypot(at.x - p.x, at.y - cy, at.z - p.z);
}

/** 'player/pickup': move as much of a stack as fits into the player's inventory (partial pickups leave the rest). */
export function pickupDrop(ctx: GameContext, p: PlayerState, dropId: unknown): Result {
  if (typeof dropId !== 'string') return fail('Invalid item');
  const list = dropsOf(ctx.state);
  const i = list.findIndex((d) => d.id === dropId);
  if (i < 0) return fail('That item is gone');
  if (p.health <= 0) return fail('Cannot pick up items right now');
  const d = list[i];
  const v = p.velocity ?? { x: 0, y: 0, z: 0 };
  const slack = Math.hypot(v.x || 0, v.y || 0, v.z || 0) * 0.3;
  if (distanceToBody(p.position, d) > DROP.pickupReach + slack) return fail('Too far away');
  const left = addItem(p.inventory, d.item, d.count);
  const picked = d.count - left;
  if (picked <= 0) return fail('Inventory full');
  d.count = left;
  if (left <= 0) list.splice(i, 1);
  ctx.bus.emit('player:itemPickedUp', { item: d.item, count: picked });
  return { ok: true, data: { item: d.item, count: picked, left } };
}

/** Physics & housekeeping for one sim step of `seconds` real time (despawn uses state.time.totalMinutes). */
export function tickDrops(ctx: GameContext, seconds = SIM_STEP_MS / 1000): void {
  const state = ctx.state;
  if (!Array.isArray(state.drops) || state.drops.length === 0) return;
  const list = state.drops as MovingDrop[];
  const now = state.time.totalMinutes;
  const w = ctx.world;
  const rest = DROP.restHeight;
  let removed = false;
  for (const d of list) {
    if (d.count <= 0 || now - d.droppedMinute > DROP.despawnMinutes) {
      d.count = 0;
      removed = true;
      continue;
    }
    // Buried by a placed block / terrain edit: nudge up to the first free cell.
    if (solidAt(ctx, d.x, d.y, d.z)) {
      let yy = Math.floor(d.y);
      while (yy < w.height && solidAt(ctx, d.x, yy, d.z)) yy++;
      d.y = yy + rest;
      stopMotion(d);
      continue;
    }
    const bottom = d.y - rest;
    const floorY = Math.floor(bottom - 1e-3);
    const resting = !isMoving(d) && bottom - (floorY + 1) < 0.02 && solidAt(ctx, d.x, floorY, d.z);
    if (resting) continue;
    stepDrop(ctx, d, seconds);
    if (d.y < -8) {
      d.count = 0;
      removed = true;
      continue;
    }
    // Landed next to a same-item stack: merge into it.
    if (!isMoving(d)) {
      const t = mergeTarget(list, d.item, d.count, d, d);
      if (t && t.count > 0 && !isMoving(t)) {
        t.count += d.count;
        t.droppedMinute = Math.max(t.droppedMinute, d.droppedMinute);
        d.count = 0;
        removed = true;
      }
    }
  }
  if (removed) {
    let k = 0;
    for (const d of list) if (d.count > 0) list[k++] = d;
    list.length = k;
  }
  capDrops(list);
}

/** Integrate one flying/falling stack (sub-stepped so fast falls never tunnel through a floor). */
function stepDrop(ctx: GameContext, d: MovingDrop, seconds: number): void {
  const w = ctx.world;
  const rest = DROP.restHeight;
  const r = DROP.radius;
  let vx = d.vx ?? 0, vy = d.vy ?? 0, vz = d.vz ?? 0;
  const speed = Math.max(Math.hypot(vx, vz), Math.abs(vy) + DROP.gravity * seconds);
  const n = Math.min(12, Math.max(1, Math.ceil((speed * seconds) / 0.3)));
  const dt = seconds / n;
  let landed = false;
  for (let i = 0; i < n && !landed; i++) {
    if (liquidAt(ctx, d.x, d.y, d.z)) {
      const k = Math.exp(-DROP.liquidDrag * dt);
      vx *= k;
      vz *= k;
      vy += (-DROP.liquidSinkSpeed - vy) * (1 - k);
    } else {
      vy = Math.max(-DROP.terminalVelocity, vy - DROP.gravity * dt);
    }
    // Horizontal, axis by axis (walls stop that axis).
    if (vx) {
      const nx = d.x + vx * dt;
      if (solidAt(ctx, nx + Math.sign(vx) * r, d.y, d.z) || nx < r || nx > w.sizeX - r) vx = 0;
      else d.x = nx;
    }
    if (vz) {
      const nz = d.z + vz * dt;
      if (solidAt(ctx, d.x, d.y, nz + Math.sign(vz) * r) || nz < r || nz > w.sizeZ - r) vz = 0;
      else d.z = nz;
    }
    const ny = d.y + vy * dt;
    if (vy < 0) {
      const bottom = ny - rest;
      if (solidAt(ctx, d.x, bottom, d.z)) {
        d.y = Math.floor(bottom) + 1 + rest;
        landed = true;
      } else d.y = ny;
    } else if (vy > 0) {
      if (solidAt(ctx, d.x, ny + rest, d.z)) vy = 0;
      else d.y = ny;
    }
  }
  if (landed) stopMotion(d);
  else {
    d.vx = vx;
    d.vy = vy;
    d.vz = vz;
  }
}
