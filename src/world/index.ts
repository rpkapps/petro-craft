// World module entry point: terrain, biomes, geology (reservoirs, faults, aquifers, pressures) and the
// chunked voxel world. See docs in each file; the public surface is:
//
//   createGeology(seed, size)   → IGeology (deterministic; ~0.3–1.5 s)
//   createWorld(geology, bus)   → IWorld   (chunks generated lazily & synchronously, ≈2–4 ms each)
//   findSpawn(geology)          → feet position on dry, flat land near the map centre (cached)
//   generateChunkData(seed, size, cx, cz) → pure chunk generator for Web Workers
//   biomeColor(biome), mapColor(geology, x, z), renderMapImage(geology, step) → UI / minimap helpers
import type { EventBus } from '../core/EventBus';
import type { IGeology, IWorld } from '../core/types';
import { WORLD_SIZES, type WorldSizeKey } from '../core/constants';
import { geologyFor } from './chunkgen';
import { Geology } from './geology';
import { spawnFor, spawnGeneric } from './spawn';
import { VoxelWorld } from './World';

export { Geology } from './geology';
export { VoxelWorld } from './World';
export { biomeColor, BIOME_NAMES } from './biomes';
export { mapColor, renderMapImage } from './mapColor';
export { generateChunk, generateChunkData, CHUNK_VOLUME } from './chunkgen';

/** Deterministically build the subsurface model + terrain functions from a seed. */
export function createGeology(seed: number, size: WorldSizeKey): IGeology {
  return geologyFor(seed, size);
}

function asGeology(geology: IGeology): Geology {
  if (geology instanceof Geology) return geology;
  const key = (Object.keys(WORLD_SIZES) as WorldSizeKey[]).find((k) => WORLD_SIZES[k] === geology.sizeX) ?? 'medium';
  return geologyFor(geology.seed, key);
}

/** Create the voxel world (chunks generated lazily from geology). */
export function createWorld(geology: IGeology, bus: EventBus): IWorld {
  return new VoxelWorld(asGeology(geology), bus);
}

/** Find a good player spawn point on land near the map centre. Returns feet position. */
export function findSpawn(geology: IGeology): { x: number; y: number; z: number } {
  return geology instanceof Geology ? spawnFor(geology) : spawnGeneric(geology);
}

/** Formation name at a voxel (well-log tops, scanner readouts). Works with any IGeology from createGeology. */
export function formationAt(geology: IGeology, x: number, y: number, z: number): string {
  return geology instanceof Geology ? geology.formationAt(x, y, z) : geology.rockAt(x, y, z);
}
