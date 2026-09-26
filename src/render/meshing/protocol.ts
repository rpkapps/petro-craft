// Messages exchanged between the chunk streamer (main thread) and the mesher workers.
import { CHUNK_SIZE } from '../../core/constants';

/** Block margin around the chunk in the padded volume (neighbour faces, AO, smooth lighting). */
export const PAD = 1;
export const PW = CHUNK_SIZE + PAD * 2; // 18
/** Heightmap margin (soft lateral sky-light falloff radius + 1). */
export const HM = 5;
export const HW = CHUNK_SIZE + HM * 2; // 26
/** Block light reaches this far (Manhattan steps from a level-15 emitter). */
export const EMIT_RANGE = 14;

export interface MeshJob {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  height: number;
  /** PW × PW × height, index = px + pz*PW + y*PW*PW, px/pz = local + PAD. Out-of-world cells are AIR. */
  blocks: Uint8Array;
  /** HW × HW column heights: first y with open sky above (0..height). index = hx + hz*HW, hx = local + HM. */
  heights: Uint8Array;
  /** Emitters near the chunk: (x, y, z, level) quadruples in chunk-local coords (may be outside 0..15). */
  emitters: Int16Array;
}

export interface PassData {
  positions: Float32Array;
  /** xyz normal + sway weight (int8 normalized). */
  normals: Int8Array;
  uvs: Float32Array;
  /** layer, ao (or liquid depth), sky light, block light — uint8. */
  info: Uint8Array;
  indices: Uint16Array | Uint32Array;
}

export interface MeshResult {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  opaque: PassData | null;
  cutout: PassData | null;
  translucent: PassData | null;
  /** Centre of every translucent quad (for back-to-front sorting). */
  quadCenters: Float32Array | null;
  minY: number;
  maxY: number;
  ms: number;
}

export type WorkerRequest = MeshJob;
export type WorkerResponse = MeshResult | { type: 'error'; id: number; message: string };
