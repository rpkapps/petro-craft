// Pure block/item helpers shared by the client controller and the authoritative handlers.
import { B, BLOCKS, BLOCK_BY_KEY, type BlockDef } from '../core/blocks';
import { ITEMS } from '../content/items';
import { INTERACT } from './config';

/** Block id for a 'block:<key>' item id, or null for non-block items. */
export function blockFromItem(item: string | null | undefined): number | null {
  if (!item || !item.startsWith('block:')) return null;
  const def = BLOCK_BY_KEY[item.slice(6)];
  return def ? def.id : null;
}

/** Block id for a placeable block item, else null. */
export function placeableBlockFromItem(item: string | null | undefined): number | null {
  const id = blockFromItem(item);
  return id !== null && isPlaceableBlock(id) ? id : null;
}

export function isPlaceableBlock(id: number): boolean {
  const d = BLOCKS[id];
  return !!d && d.placeable === true && d.id !== B.AIR && d.hardness !== Infinity;
}

/** Cross-shaped decorative plants (instantly breakable, replaced by placement). */
export function isPlant(id: number): boolean {
  const d = BLOCKS[id];
  return d.shape === 'cross' && !d.solid && id !== B.FIRE;
}

export function isLiquid(id: number): boolean {
  return BLOCKS[id].shape === 'liquid';
}

/** Cells a block may be placed into: air, water, plants and snow. */
export function isReplaceable(id: number): boolean {
  return id === B.AIR || id === B.WATER || id === B.SNOW || isPlant(id);
}

/** Tree parts and cacti: solid vegetation that line runs (pipes/roads) clear out of their way. */
const TREE_BLOCKS: ReadonlySet<number> = new Set<number>([
  B.LOG_OAK, B.LEAVES_OAK, B.LOG_PINE, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LOG, B.BIRCH_LEAVES, B.CACTUS,
]);
/** Trunk-like blocks: when one is cleared, the column stacked on it is cleared too (no floating trunks). */
const TRUNK_BLOCKS: ReadonlySet<number> = new Set<number>([B.LOG_OAK, B.LOG_PINE, B.BIRCH_LOG, B.CACTUS]);
const LEAF_BLOCKS: ReadonlySet<number> = new Set<number>([B.LEAVES_OAK, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LEAVES]);

/** Logs, leaves and cacti (solid vegetation cleared by line placement). */
export function isTreeBlock(id: number): boolean {
  return TREE_BLOCKS.has(id);
}
export function isTrunkBlock(id: number): boolean {
  return TRUNK_BLOCKS.has(id);
}
export function isLeafBlock(id: number): boolean {
  return LEAF_BLOCKS.has(id);
}

/**
 * Anything that is not "ground" for pipe routing: trees, cacti, plants and snow cover. Pipes are laid on the
 * ground below these (clearing them where the run passes).
 */
export function isVegetation(id: number): boolean {
  return TREE_BLOCKS.has(id) || isPlant(id) || id === B.SNOW;
}

/** Plants that grow under water (become water again when removed). */
export function isWaterPlant(id: number): boolean {
  return id === B.SEAGRASS || id === B.KELP;
}

/** What the crosshair can target: anything that is not air or a liquid. */
export function isTargetable(id: number): boolean {
  return id !== B.AIR && !isLiquid(id);
}

export function isUnbreakable(id: number): boolean {
  const d = BLOCKS[id];
  return d.hardness === Infinity || id === B.STRUCTURE || id === B.CASING || id === B.BEDROCK || id === B.AIR;
}

/** Item dropped when a block is broken (null = nothing). */
export function dropForBlock(id: number): string | null {
  const d: BlockDef = BLOCKS[id];
  if (d.drops === null) return null;
  if (typeof d.drops === 'string') return d.drops;
  return `block:${d.key}`;
}

/** Tool class and speed of a held item (null for non-tools / empty hand). */
export function toolOf(item: string | null | undefined): { toolClass: string; speed: number } | null {
  if (!item) return null;
  return ITEMS[item]?.tool ?? null;
}

/**
 * Seconds to break a block while holding `item`. Infinity for unbreakable blocks.
 * Matching tool: hardness / speed. Blocks whose tool is 'hand'/'none': hardness. Otherwise hardness × hand penalty.
 */
export function breakTime(blockId: number, item: string | null | undefined, creative = false): number {
  if (isUnbreakable(blockId)) return Infinity;
  const d = BLOCKS[blockId];
  if (creative || d.hardness <= 0) return 0;
  const tool = toolOf(item);
  if (tool && tool.toolClass === d.tool) return d.hardness / Math.max(0.1, tool.speed);
  if (d.tool === 'hand' || d.tool === 'none') return d.hardness;
  return d.hardness * INTERACT.handPenalty;
}

/** Maximum stack size of an item. Tools do not stack. */
export function maxStack(item: string): number {
  return item.startsWith('tool:') || ITEMS[item]?.kind === 'tool' ? 1 : 64;
}

/** Per-block purchase price for 'world/placeLine' when the inventory runs out (USD, before modifiers). */
const LINE_PRICES: Record<string, number> = {
  pipe_oil: 350, pipe_gas: 400, pipe_water: 250, pipe_product: 450, asphalt_road: 60, concrete: 30, gravel_pad: 15,
};
export function linePrice(blockId: number): number {
  return LINE_PRICES[BLOCKS[blockId].key] ?? 25;
}

/** Display colour for a block in ghosts / UI (pipes use their category colour). */
const PIPE_COLORS: Record<string, number> = { oil: 0xf2a31e, gas: 0xe8d23a, water: 0x3a8ee6, product: 0x3ec46a, casing: 0x9aa1a8 };
export function blockColor(blockId: number): number {
  const d = BLOCKS[blockId];
  if (d.pipe) return PIPE_COLORS[d.pipe] ?? 0xff8a1f;
  return d.palette[0] ?? 0xff8a1f;
}

export function blockName(blockId: number): string {
  return BLOCKS[blockId]?.name ?? 'Block';
}

export function itemName(item: string | null | undefined): string {
  if (!item) return 'Hand';
  const b = blockFromItem(item);
  if (b !== null) return blockName(b);
  return ITEMS[item]?.name ?? item;
}
