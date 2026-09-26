// Dense per-block lookup tables for the mesher and chunk streaming. Pure data (no DOM / three) so it
// can be imported by the mesher worker as well as the main thread.
import { B, BLOCKS } from '../../core/blocks';
import { layerOf } from '../textures/layers';

export const SHAPE_NONE = 0;
export const SHAPE_CUBE = 1;
export const SHAPE_CROSS = 2;
export const SHAPE_LIQUID = 3;
export const SHAPE_PIPE = 4;
export const SHAPE_SLAB = 5;

export const PASS_OPAQUE = 0;
export const PASS_CUTOUT = 1;
export const PASS_TRANSLUCENT = 2;

export const PIPE_NONE = 0;
export const PIPE_CASING = 5;
const PIPE_CODES: Record<string, number> = { oil: 1, gas: 2, water: 3, product: 4, casing: PIPE_CASING };

export const SHAPE = new Uint8Array(256);
export const PASS = new Uint8Array(256);
/** Texture layer per block & face: index id*3 + (0 top, 1 side, 2 bottom). */
export const FACE_LAYER = new Uint8Array(256 * 3);
/** Full opaque cube: hides neighbour faces and occludes AO. */
export const OPAQUE = new Uint8Array(256);
/** Stops sky light for the column heightmap (opaque cubes + foliage canopy). */
export const SKY_BLOCKER = new Uint8Array(256);
/** Vertex-shader wind sway: 1 = whole block (leaves), 2 = anchored at the bottom (plants). */
export const SWAY = new Uint8Array(256);
/** Emitted block light 0..15. */
export const EMIT = new Uint8Array(256);
export const PIPE_CAT = new Uint8Array(256);
/** Plants that only ever live underwater — water faces against them are culled. */
export const WATERLOGGED = new Uint8Array(256);
/** Fraction of the cell a liquid surface fills when nothing of the same liquid is above. */
export const LIQUID_TOP = new Float32Array(256);
/** Full-bright blocks (no shading) — fire. */
export const FULLBRIGHT = new Uint8Array(256);

for (let id = 0; id < 256; id++) {
  const d = BLOCKS[id];
  const shape = d.shape;
  SHAPE[id] =
    shape === 'cube' ? SHAPE_CUBE : shape === 'cross' ? SHAPE_CROSS : shape === 'liquid' ? SHAPE_LIQUID : shape === 'pipe' ? SHAPE_PIPE : shape === 'slab' ? SHAPE_SLAB : SHAPE_NONE;
  if (d.key.startsWith('unknown_')) SHAPE[id] = SHAPE_NONE;
  FACE_LAYER[id * 3] = layerOf(d.tex.top);
  FACE_LAYER[id * 3 + 1] = layerOf(d.tex.side);
  FACE_LAYER[id * 3 + 2] = layerOf(d.tex.bottom);
  OPAQUE[id] = SHAPE[id] === SHAPE_CUBE && !d.transparent ? 1 : 0;
  const isGlassy = d.key === 'glass' || d.key === 'ice';
  if (SHAPE[id] === SHAPE_LIQUID || isGlassy) PASS[id] = PASS_TRANSLUCENT;
  else if (SHAPE[id] === SHAPE_CROSS || (SHAPE[id] === SHAPE_CUBE && d.transparent)) PASS[id] = PASS_CUTOUT;
  else PASS[id] = PASS_OPAQUE;
  SKY_BLOCKER[id] = OPAQUE[id] || (SHAPE[id] === SHAPE_CUBE && d.sway) ? 1 : 0;
  SWAY[id] = d.sway ? (SHAPE[id] === SHAPE_CROSS ? 2 : 1) : 0;
  EMIT[id] = d.light ?? 0;
  PIPE_CAT[id] = d.pipe ? PIPE_CODES[d.pipe] : PIPE_NONE;
  LIQUID_TOP[id] = id === B.OIL_POOL ? 0.14 : 0.875;
}
WATERLOGGED[B.SEAGRASS] = 1;
WATERLOGGED[B.KELP] = 1;
FULLBRIGHT[B.FIRE] = 1;
