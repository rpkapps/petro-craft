// Authoritative handlers for world/* and player/* commands (runs on the host / single-player).
//
// Commands handled: world/breakBlock, world/placeBlock, world/placeLine, player/moveItem, player/selectSlot,
// player/setMode, player/sync, player/dropItem, player/pickup. The system tick runs dropped-item physics
// (see drops.ts). `player/sync` additionally accepts an optional `health` number (not part of the
// typed payload; read via cast) so the client-side health model persists in PlayerState.health.
import type { Command } from '../core/commands';
import type { GameContext, PlayerState, SimSystem, Vec3 } from '../core/types';
import { B, BLOCKS, blockItemId } from '../core/blocks';
import { HOTBAR_SLOTS, INVENTORY_SLOTS, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_REACH, PLAYER_WIDTH, SEA_LEVEL } from '../core/constants';
import { createPlayer, formatMoney } from '../core/state';
import { findBuildingAt } from '../core/buildingUtil';
import { dropForBlock, isPlaceableBlock, isPlant, isReplaceable, isTreeBlock, isTrunkBlock, isUnbreakable, isWaterPlant, linePrice, placeableBlockFromItem } from './blockUtil';
import { addItem, countItem, moveItem, normaliseInventory, removeItem } from './inventory';
import { LINE } from './config';
import { dropFromSlot, normaliseDrops, pickupDrop, spawnDrop, tickDrops } from './drops';
import { treeClearance } from './linePath';

type Result = { ok: boolean; error?: string; data?: unknown };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function playerOf(ctx: GameContext, cmd: Command): PlayerState | undefined {
  return ctx.state.players[cmd.playerId ?? ctx.localPlayerId];
}

/** Reach check against the last synced position (generous slack for sync latency). Drone mode is unlimited. */
function withinReach(p: PlayerState, x: number, y: number, z: number): boolean {
  if (p.mode === 'drone') return true;
  const ex = p.position.x, ey = p.position.y + PLAYER_EYE_HEIGHT, ez = p.position.z;
  const d = Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez);
  const speed = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
  return d <= PLAYER_REACH + 2 + speed * 0.3;
}

/** Whether a solid block at the cell would intersect any player's body. */
function intersectsPlayers(ctx: GameContext, x: number, y: number, z: number): boolean {
  const hw = PLAYER_WIDTH / 2 - 0.001;
  for (const p of Object.values(ctx.state.players)) {
    if (p.health <= 0) continue;
    const q = p.position;
    if (x < q.x + hw && x + 1 > q.x - hw && z < q.z + hw && z + 1 > q.z - hw && y < q.y + PLAYER_HEIGHT - 0.001 && y + 1 > q.y + 0.001) return true;
  }
  return false;
}

/** Water flows into a mined cell at/below sea level when water touches it from the side or above. */
function floodsWithWater(ctx: GameContext, x: number, y: number, z: number): boolean {
  if (y > SEA_LEVEL) return false;
  const w = ctx.world;
  const n: [number, number, number][] = [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y + 1, z]];
  return n.some(([a, b, c]) => w.inBounds(a, b, c) && w.getBlock(a, b, c) === B.WATER);
}

function ensurePlayers(ctx: GameContext): void {
  const s = ctx.state;
  if (!s.players) (s as { players: Record<string, PlayerState> }).players = {};
  if (!s.players[ctx.localPlayerId]) {
    const x = Math.floor(ctx.geology.sizeX / 2), z = Math.floor(ctx.geology.sizeZ / 2);
    s.players[ctx.localPlayerId] = createPlayer(ctx.localPlayerId, 'Player', { x: x + 0.5, y: ctx.geology.surfaceHeight(x, z), z: z + 0.5 });
  }
  for (const p of Object.values(s.players)) {
    p.inventory = normaliseInventory(p.inventory, INVENTORY_SLOTS);
    if (!isNum(p.health) || p.health <= 0) p.health = 100;
    if (!isInt(p.selectedSlot) || p.selectedSlot < 0 || p.selectedSlot >= HOTBAR_SLOTS) p.selectedSlot = 0;
    if (p.mode !== 'walk' && p.mode !== 'fly' && p.mode !== 'drone') p.mode = 'walk';
    p.velocity ??= { x: 0, y: 0, z: 0 };
  }
  normaliseDrops(s);
}

// ---- handlers ---------------------------------------------------------------------------------------------
function breakBlock(cmd: Command<'world/breakBlock'>, ctx: GameContext): Result {
  const p = playerOf(ctx, cmd);
  if (!p) return fail('Unknown player');
  const { x, y, z } = cmd;
  if (!isInt(x) || !isInt(y) || !isInt(z) || !ctx.world.inBounds(x, y, z)) return fail('Out of bounds');
  const id = ctx.world.getBlock(x, y, z);
  if (id === B.AIR || BLOCKS[id].shape === 'liquid') return fail('Nothing to break');
  if (isUnbreakable(id)) return fail(`${BLOCKS[id].name} cannot be broken`);
  if (!withinReach(p, x, y, z)) return fail('Too far away');
  if (findBuildingAt(ctx.state, x, y + 1, z)) return fail('This block supports a building');

  ctx.world.setBlock(x, y, z, floodsWithWater(ctx, x, y, z) ? B.WATER : B.AIR, 'player');
  // Plants resting on the block pop off with it.
  if (ctx.world.inBounds(x, y + 1, z)) {
    const above = ctx.world.getBlock(x, y + 1, z);
    if (isPlant(above)) ctx.world.setBlock(x, y + 1, z, isWaterPlant(above) ? B.WATER : B.AIR, 'player');
  }
  const drop = dropForBlock(id);
  let spilled = 0;
  let dropId: string | undefined;
  if (drop) {
    // Straight into the inventory; when it is full the item pops out at the broken block instead of being lost.
    spilled = addItem(p.inventory, drop, 1);
    if (spilled > 0) {
      const s = spawnDrop(ctx, drop, spilled, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { x: 0, y: 1.5, z: 0 });
      dropId = s.drop.id;
      ctx.bus.emit('player:itemDropped', { dropId });
    }
  }
  ctx.state.stats.blocksMined++;
  return { ok: true, data: { prev: id, drop, spilled, dropId } };
}

function placeBlock(cmd: Command<'world/placeBlock'>, ctx: GameContext): Result {
  const p = playerOf(ctx, cmd);
  if (!p) return fail('Unknown player');
  const { x, y, z, slot } = cmd;
  if (!isInt(slot) || slot < 0 || slot >= p.inventory.length) return fail('Invalid slot');
  const stack = p.inventory[slot];
  const blockId = placeableBlockFromItem(stack?.item);
  if (!stack || blockId === null) return fail('Select a placeable block');
  if (!isInt(x) || !isInt(y) || !isInt(z) || !ctx.world.inBounds(x, y, z)) return fail('Out of bounds');
  const cur = ctx.world.getBlock(x, y, z);
  if (!isReplaceable(cur)) return fail('That space is occupied');
  if (findBuildingAt(ctx.state, x, y, z)) return fail('Inside a building footprint');
  if (BLOCKS[blockId].solid && intersectsPlayers(ctx, x, y, z)) return fail('A player is in the way');
  if (!withinReach(p, x, y, z)) return fail('Too far away');

  ctx.world.setBlock(x, y, z, blockId, 'player');
  if (!ctx.state.meta.rules.creative) {
    stack.count--;
    if (stack.count <= 0) p.inventory[slot] = null;
  }
  ctx.state.stats.blocksPlaced++;
  return { ok: true, data: { block: blockId } };
}

export interface LineQuote {
  /** Cells that will receive a block (already-identical cells are skipped). */
  cells: Vec3[];
  /** Subset of `cells` currently holding tree parts (logs, leaves, cacti) that the run clears. */
  clearing: Vec3[];
  /** Distinct trunks (log / cactus columns) the run cuts through; their trunk above and canopy are cleared too. */
  trees: number;
  blocked: Vec3[];
  fromInventory: number;
  bought: number;
  cost: number;
}

/** Validate and price a line placement for a player (shared by the handler and the client preview). */
export function quoteLine(ctx: GameContext, p: PlayerState | undefined, block: number, points: Vec3[]): LineQuote {
  const cells: Vec3[] = [];
  const blocked: Vec3[] = [];
  const clearing: Vec3[] = [];
  const trunks = new Set<string>();
  const seen = new Set<string>();
  for (const pt of points) {
    if (!pt || !isInt(pt.x) || !isInt(pt.y) || !isInt(pt.z)) {
      blocked.push({ x: NaN, y: NaN, z: NaN });
      continue;
    }
    const k = `${pt.x},${pt.y},${pt.z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!ctx.world.inBounds(pt.x, pt.y, pt.z)) {
      blocked.push(pt);
      continue;
    }
    const cur = ctx.world.getBlock(pt.x, pt.y, pt.z);
    if (cur === block) continue;
    const tree = isTreeBlock(cur);
    if ((!isReplaceable(cur) && !tree) || findBuildingAt(ctx.state, pt.x, pt.y, pt.z) || (BLOCKS[block].solid && intersectsPlayers(ctx, pt.x, pt.y, pt.z))) {
      blocked.push(pt);
      continue;
    }
    const c = { x: pt.x, y: pt.y, z: pt.z };
    cells.push(c);
    if (tree) {
      clearing.push(c);
      if (isTrunkBlock(cur)) trunks.add(`${pt.x},${pt.z}`);
    }
  }
  const creative = ctx.state.meta.rules.creative;
  const have = creative ? cells.length : p ? countItem(p.inventory, blockItemId(block)) : 0;
  const fromInventory = Math.min(have, cells.length);
  const bought = cells.length - fromInventory;
  const cost = creative ? 0 : Math.round(bought * linePrice(block) * ctx.modifier('construction_cost'));
  return { cells, clearing, trees: trunks.size, blocked, fromInventory, bought, cost };
}

function placeLine(cmd: Command<'world/placeLine'>, ctx: GameContext): Result {
  const p = playerOf(ctx, cmd);
  if (!p) return fail('Unknown player');
  const block = cmd.block;
  if (!isInt(block) || block < 0 || block > 255 || !isPlaceableBlock(block)) return fail('That block cannot be placed');
  if (!Array.isArray(cmd.points) || cmd.points.length === 0) return fail('Nothing to place');
  if (cmd.points.length > LINE.maxCellsAuthoritative) return fail(`Too long — at most ${LINE.maxCellsAuthoritative} blocks per run`);
  const q = quoteLine(ctx, p, block, cmd.points);
  if (q.blocked.length > 0) {
    const f = q.blocked[0];
    const where = Number.isFinite(f.x) ? ` (first at ${f.x}, ${f.y}, ${f.z})` : '';
    return fail(`${q.blocked.length} cell${q.blocked.length > 1 ? 's are' : ' is'} blocked${where}`);
  }
  if (q.cells.length === 0) return { ok: true, data: { placed: 0, fromInventory: 0, bought: 0, cost: 0 } };
  const def = BLOCKS[block];
  if (q.cost > 0 && !ctx.transact(-q.cost, 'construction', `${def.name} ×${q.bought}`, true)) {
    return fail(`Not enough money: ${q.bought} × ${def.name} costs ${formatMoney(q.cost)}${q.fromInventory ? ` (after ${q.fromInventory} from inventory)` : ''}`);
  }
  if (!ctx.state.meta.rules.creative && q.fromInventory > 0) removeItem(p.inventory, blockItemId(block), q.fromInventory, p.selectedSlot);
  // Trees cut by the run are felled whole (trunk above, branches, own canopy) so nothing is left floating; the
  // wood is not recovered.
  const w = ctx.world;
  const extra = q.clearing.length ? treeClearance((x, y, z) => w.getBlock(x, y, z), q.cells) : [];
  for (const c of extra) {
    if (!findBuildingAt(ctx.state, c.x, c.y, c.z)) w.setBlock(c.x, c.y, c.z, B.AIR, 'player');
  }
  for (const c of q.cells) w.setBlock(c.x, c.y, c.z, block, 'player');
  ctx.state.stats.blocksPlaced += q.cells.length;
  return {
    ok: true,
    data: { placed: q.cells.length, fromInventory: q.fromInventory, bought: q.bought, cost: q.cost, cleared: q.clearing.length + extra.length, trees: q.trees },
  };
}

function sync(cmd: Command<'player/sync'>, ctx: GameContext): Result {
  const p = playerOf(ctx, cmd);
  if (!p) return fail('Unknown player');
  const pos = cmd.position, vel = cmd.velocity;
  if (pos && isNum(pos.x) && isNum(pos.y) && isNum(pos.z)) {
    const w = ctx.world;
    p.position = {
      x: Math.min(Math.max(pos.x, 0), w.sizeX),
      y: Math.min(Math.max(pos.y, -16), w.height + 64),
      z: Math.min(Math.max(pos.z, 0), w.sizeZ),
    };
  }
  if (vel && isNum(vel.x) && isNum(vel.y) && isNum(vel.z)) p.velocity = { x: vel.x, y: vel.y, z: vel.z };
  if (isNum(cmd.yaw)) p.yaw = cmd.yaw;
  if (isNum(cmd.pitch)) p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cmd.pitch));
  const health = (cmd as unknown as { health?: unknown }).health;
  if (isNum(health)) p.health = Math.max(0, Math.min(100, health));
  return OK;
}

export function createPlayerSimSystem(): SimSystem {
  return {
    id: 'player',
    init(ctx: GameContext) {
      ensurePlayers(ctx);
      const c = ctx.commands;
      c.register('world/breakBlock', breakBlock);
      c.register('world/placeBlock', placeBlock);
      c.register('world/placeLine', placeLine);
      c.register('player/moveItem', (cmd, cx) => {
        const p = playerOf(cx, cmd);
        if (!p) return fail('Unknown player');
        return moveItem(p.inventory, cmd.from, cmd.to) ? OK : fail('Invalid inventory slot');
      });
      c.register('player/selectSlot', (cmd, cx) => {
        const p = playerOf(cx, cmd);
        if (!p) return fail('Unknown player');
        if (!isInt(cmd.slot) || cmd.slot < 0 || cmd.slot >= HOTBAR_SLOTS) return fail('Invalid hotbar slot');
        p.selectedSlot = cmd.slot;
        return OK;
      });
      c.register('player/setMode', (cmd, cx) => {
        const p = playerOf(cx, cmd);
        if (!p) return fail('Unknown player');
        if (cmd.mode !== 'walk' && cmd.mode !== 'fly' && cmd.mode !== 'drone') return fail('Invalid mode');
        p.mode = cmd.mode;
        return OK;
      });
      c.register('player/sync', sync);
      c.register('player/dropItem', (cmd, cx) => {
        const p = playerOf(cx, cmd);
        if (!p) return fail('Unknown player');
        return dropFromSlot(cx, p, cmd.slot, cmd.count);
      });
      c.register('player/pickup', (cmd, cx) => {
        const p = playerOf(cx, cmd);
        if (!p) return fail('Unknown player');
        return pickupDrop(cx, p, cmd.dropId);
      });
    },
    tick(ctx: GameContext) {
      // Player state changes are command-driven; the tick only simulates dropped item stacks.
      tickDrops(ctx);
    },
  };
}
