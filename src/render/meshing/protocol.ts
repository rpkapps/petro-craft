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
/** Vertical sub-chunk height: cave-occlusion culling works per 16×SECTION×16 section. */
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
  /**
   * Sides beyond the streamed domain (bit 1<<face: 0 +X, 1 -X, 4 +Z, 5 -Z): no faces are emitted
   * towards them (they could only be seen from outside, and double-sided water would show them).
   */
  outside: number;
}

export interface PassData {
  positions: Float32Array;
  /** xyz normal + sway weight (int8 normalized). */
  normals: Int8Array;
  uvs: Float32Array;
  /** layer (+128 for distance-faded plants), ao (or liquid depth), sky light, block light — uint8. */
  info: Uint8Array;
  indices: Uint16Array | Uint32Array;
}

/**
 * Geometry of one chunk column. Opaque and cut-out indices are ordered by vertical section (16×SECTION×16),
 * so a contiguous run of visible sections is one draw range; `*Ranges[s]..*Ranges[s+1]` is section s.
 * Coordinates are chunk-local (x/z 0..16, absolute y).
 */
export interface MeshResult {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  opaque: PassData | null;
  /** Alpha-tested cubes (leaves, grates) and crosses (plants carry the fade flag in their layer byte). */
  cutout: PassData | null;
  translucent: PassData | null;
  /** Centre of every translucent quad (for back-to-front sorting). */
  quadCenters: Float32Array | null;
  /** Index offsets per section (length sections + 1). */
  opaqueRanges: Uint32Array;
  cutoutRanges: Uint32Array;
  /** Vertical geometry extent per section (min > max when the section has no geometry). */
  sectionMinY: Float32Array;
  sectionMaxY: Float32Array;
  /**
   * Face-to-face visibility per section through non-opaque cells (cave culling): bit for the face pair
   * (a, b), a < b, in pair order (0,1),(0,2)…(4,5); faces 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
   */
  vis: Uint16Array;
  /** Content hash per pass (opaque, cut-out, translucent): unchanged passes are not re-uploaded. */
  hashes: Uint32Array;
  /** Whether plant geometry was omitted (distance LOD) — the streamer re-meshes when the chunk comes closer. */
  skipPlants: boolean;
  ms: number;
}

export type WorkerRequest = MeshJob;
export type WorkerResponse = MeshResult | { type: 'error'; id: number; message: string };
