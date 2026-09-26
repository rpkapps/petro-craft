// Messages exchanged between the chunk streamer (main thread) and the mesher workers.
import { CHUNK_SIZE } from '../../core/constants';

/** Block margin around the chunk used for geometry (neighbour faces, AO, smooth lighting). */
export const PAD = 1;
export const PW = CHUNK_SIZE + PAD * 2; // 18
/**
 * Margin of the volume shipped to the worker. Sky light floods sideways at most ~7 blocks and the
 * smooth-lighting samples reach one more, so an 8-block margin makes sky light exact across chunk
 * borders; lamp light (14 steps) also respects walls inside this margin.
 */
export const LPAD = 8;
export const LW = CHUNK_SIZE + LPAD * 2; // 32
/** Block light reaches this far (Manhattan steps from a level-15 emitter). */
export const EMIT_RANGE = 14;
/** Vertical sub-chunk height: meshes, culling and uploads are per 16×SECTION×16 section. */
export const SECTION = 32;

export interface MeshJob {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  height: number;
  /** LW × LW × height, index = lx + lz*LW + y*LW*LW with lx/lz = local + LPAD. Out-of-world cells are AIR. */
  blocks: Uint8Array;
  /** Emitters near the chunk: (x, y, z, level) quadruples in chunk-local coords (may be outside 0..15). */
  emitters: Int16Array;
  /** Distance LOD: skip plant (cross) geometry entirely (far chunks). */
  skipPlants: boolean;
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

/** Geometry of one vertical section. Coordinates are chunk-local (x/z 0..16, absolute y). */
export interface SectionData {
  /** Section index (y / SECTION). */
  sy: number;
  opaque: PassData | null;
  /** Alpha-tested cubes (leaves, grates) and non-plant crosses (fire). */
  cutout: PassData | null;
  /** Swaying cross plants (grass, flowers, sea grass) — distance-faded and dropped for far chunks. */
  plants: PassData | null;
  translucent: PassData | null;
  /** Centre of every translucent quad (for back-to-front sorting). */
  quadCenters: Float32Array | null;
  /** Tight vertical extent of the section's geometry (0,0 when empty). */
  minY: number;
  maxY: number;
  /**
   * Face-to-face visibility through non-opaque cells (cave culling): bit (a*6+b) is set when faces
   * a and b (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) are connected by open space inside the section.
   */
  vis: number;
  /** Content hash of all passes — unchanged sections are not re-uploaded after an edit. */
  hash: number;
}

export interface MeshResult {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  sections: SectionData[];
  /** Whether plant geometry was omitted (distance LOD) — the streamer re-meshes when the chunk comes closer. */
  skipPlants: boolean;
  ms: number;
}

export type WorkerRequest = MeshJob;
export type WorkerResponse = MeshResult | { type: 'error'; id: number; message: string };
