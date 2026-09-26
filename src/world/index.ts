// STUB — owned by the World agent. Public entry points (signatures are a contract).
import type { IGeology, IWorld } from '../core/types';
import type { WorldSizeKey } from '../core/constants';
import type { EventBus } from '../core/EventBus';

/** Deterministically build the subsurface model + terrain functions from a seed. */
export function createGeology(seed: number, size: WorldSizeKey): IGeology {
  throw new Error('createGeology not implemented');
}

/** Create the voxel world (chunks generated lazily from geology). */
export function createWorld(geology: IGeology, bus: EventBus): IWorld {
  throw new Error('createWorld not implemented');
}

/** Find a good player spawn point on land near the map centre. Returns feet position. */
export function findSpawn(geology: IGeology): { x: number; y: number; z: number } {
  return { x: geology.sizeX / 2, y: 80, z: geology.sizeZ / 2 };
}
