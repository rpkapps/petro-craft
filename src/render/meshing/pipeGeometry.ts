// Industrial pipe geometry: octagonal tubes with half-flanges straddling every other block boundary,
// a colour-banded junction hub where lines branch, and end caps on dead ends.
import type { MeshBuffer } from './MeshBuffer';

const SEG = 8;
const COS: number[] = [];
const SIN: number[] = [];
for (let k = 0; k <= SEG; k++) {
  const a = (k / SEG) * Math.PI * 2 + Math.PI / SEG;
  COS.push(Math.cos(a));
  SIN.push(Math.sin(a));
}

/** Axis frames [A, P, Q] with P × Q = A. */
const FRAMES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
];

interface Ctx {
  buf: MeshBuffer;
  ox: number;
  oy: number;
  oz: number;
  layer: number;
  sky: number;
  blk: number;
}

function point(axis: number, t: number, r: number, k: number, out: number[]) {
  const [A, P, Q] = FRAMES[axis];
  const c = COS[k] * r;
  const s = SIN[k] * r;
  out[0] = 0.5 + (A[0] ? (t - 0.5) : 0) + P[0] * c + Q[0] * s;
  out[1] = 0.5 + (A[1] ? (t - 0.5) : 0) + P[1] * c + Q[1] * s;
  out[2] = 0.5 + (A[2] ? (t - 0.5) : 0) + P[2] * c + Q[2] * s;
}

const pa = [0, 0, 0];
const pb = [0, 0, 0];
const pc = [0, 0, 0];
const pd = [0, 0, 0];

function tube(c: Ctx, axis: number, t0: number, t1: number, r: number, u0: number, u1: number) {
  const [, P, Q] = FRAMES[axis];
  const b = c.buf;
  for (let k = 0; k < SEG; k++) {
    point(axis, t0, r, k, pa);
    point(axis, t0, r, k + 1, pb);
    point(axis, t1, r, k + 1, pc);
    point(axis, t1, r, k, pd);
    const n0x = P[0] * COS[k] + Q[0] * SIN[k];
    const n0y = P[1] * COS[k] + Q[1] * SIN[k];
    const n0z = P[2] * COS[k] + Q[2] * SIN[k];
    const n1x = P[0] * COS[k + 1] + Q[0] * SIN[k + 1];
    const n1y = P[1] * COS[k + 1] + Q[1] * SIN[k + 1];
    const n1z = P[2] * COS[k + 1] + Q[2] * SIN[k + 1];
    const v0 = k / SEG;
    const v1 = (k + 1) / SEG;
    b.vert(c.ox + pa[0], c.oy + pa[1], c.oz + pa[2], n0x, n0y, n0z, 0, u0, v0, c.layer, 255, c.sky, c.blk);
    b.vert(c.ox + pb[0], c.oy + pb[1], c.oz + pb[2], n1x, n1y, n1z, 0, u0, v1, c.layer, 255, c.sky, c.blk);
    b.vert(c.ox + pc[0], c.oy + pc[1], c.oz + pc[2], n1x, n1y, n1z, 0, u1, v1, c.layer, 255, c.sky, c.blk);
    b.vert(c.ox + pd[0], c.oy + pd[1], c.oz + pd[2], n0x, n0y, n0z, 0, u1, v0, c.layer, 255, c.sky, c.blk);
    b.quad(false);
  }
}

function cap(c: Ctx, axis: number, t: number, r: number, facing: 1 | -1, u: number) {
  const [A] = FRAMES[axis];
  const b = c.buf;
  const cx = 0.5 + (A[0] ? t - 0.5 : 0);
  const cy = 0.5 + (A[1] ? t - 0.5 : 0);
  const cz = 0.5 + (A[2] ? t - 0.5 : 0);
  const nx = A[0] * facing;
  const ny = A[1] * facing;
  const nz = A[2] * facing;
  for (let k = 0; k < SEG; k++) {
    const k0 = facing > 0 ? k : k + 1;
    const k1 = facing > 0 ? k + 1 : k;
    point(axis, t, r, k0, pa);
    point(axis, t, r, k1, pb);
    b.vert(c.ox + cx, c.oy + cy, c.oz + cz, nx, ny, nz, 0, u, 0.5, c.layer, 255, c.sky, c.blk);
    b.vert(c.ox + pa[0], c.oy + pa[1], c.oz + pa[2], nx, ny, nz, 0, u, k0 / SEG, c.layer, 255, c.sky, c.blk);
    b.vert(c.ox + pb[0], c.oy + pb[1], c.oz + pb[2], nx, ny, nz, 0, u, k1 / SEG, c.layer, 255, c.sky, c.blk);
    b.tri();
  }
}

/** Axis-aligned box centred in the cell with half-extent h, textured with the colour band. */
function hub(c: Ctx, h: number) {
  const b = c.buf;
  const lo = 0.5 - h;
  const hi = 0.5 + h;
  const u0 = 6.2 / 16;
  const u1 = 9.8 / 16;
  const faces: [number[], number[], number[], number[]][] = [
    [[1, 0, 0], [hi, lo, hi], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [lo, lo, lo], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [lo, hi, hi], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [lo, lo, lo], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [lo, lo, hi], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [hi, lo, lo], [-1, 0, 0], [0, 1, 0]],
  ];
  const s = h * 2;
  for (const [n, o, U, V] of faces) {
    const corners = [
      [o[0], o[1], o[2]],
      [o[0] + U[0] * s, o[1] + U[1] * s, o[2] + U[2] * s],
      [o[0] + (U[0] + V[0]) * s, o[1] + (U[1] + V[1]) * s, o[2] + (U[2] + V[2]) * s],
      [o[0] + V[0] * s, o[1] + V[1] * s, o[2] + V[2] * s],
    ];
    const uvs = [[u0, 1], [u1, 1], [u1, 0], [u0, 0]];
    for (let k = 0; k < 4; k++) b.vert(c.ox + corners[k][0], c.oy + corners[k][1], c.oz + corners[k][2], n[0], n[1], n[2], 0, uvs[k][0], uvs[k][1], c.layer, 255, c.sky, c.blk);
    b.quad(false);
  }
}

/** Half flange at a block boundary (t = 0 or 1), flush with the boundary, extending `th` inward. */
function halfFlange(c: Ctx, axis: number, atEnd: 0 | 1, R: number, th: number) {
  const t0 = atEnd === 1 ? 1 - th : 0;
  const t1 = atEnd === 1 ? 1 : th;
  tube(c, axis, t0, t1, R, 0.03, 0.06);
  cap(c, axis, atEnd === 1 ? t0 : t1, R, atEnd === 1 ? -1 : 1, 0.03);
}

/**
 * Emit a pipe block. `mask` bits follow the mesher's direction order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
 * (wx, wy, wz) are world coordinates (for flange parity); (ox, oy, oz) the chunk-local cell origin.
 */
export function emitPipe(
  buf: MeshBuffer, ox: number, oy: number, oz: number, wx: number, wy: number, wz: number,
  mask: number, casing: boolean, layer: number, sky: number, blk: number,
) {
  const c: Ctx = { buf, ox, oy, oz, layer, sky, blk };
  const r = casing ? 0.19 : 0.22;
  const R = casing ? 0.25 : 0.3;
  const th = casing ? 0.05 : 0.06;
  const every = casing ? 1 : 2;
  const world = [wx, wy, wz];
  const axisOf = (dir: number) => (dir >> 1) as 0 | 1 | 2;
  const flangeAt = (axis: number, end: 0 | 1) => (world[axis] + end) % every === 0;

  let m = mask;
  if (m === 0) m = casing ? 0b001100 : 0b000011; // isolated: lay it along Y (casing) or X
  const straightAxis = m === 0b000011 ? 0 : m === 0b001100 ? 1 : m === 0b110000 ? 2 : -1;

  if (straightAxis >= 0) {
    tube(c, straightAxis, 0, 1, r, 0, 1);
    for (const end of [0, 1] as const) {
      const dirBit = straightAxis * 2 + (end === 1 ? 0 : 1);
      const connected = (mask & (1 << dirBit)) !== 0;
      if (!connected) {
        // dead end: blind flange + cap
        halfFlange(c, straightAxis, end, R, th * 1.6);
        cap(c, straightAxis, end, R, end === 1 ? 1 : -1, 0.03);
      } else if (flangeAt(straightAxis, end)) halfFlange(c, straightAxis, end, R, th);
    }
    return;
  }

  const h = r + 0.06;
  hub(c, h);
  for (let dir = 0; dir < 6; dir++) {
    if (!(m & (1 << dir))) continue;
    const axis = axisOf(dir);
    const positive = (dir & 1) === 0;
    if (positive) tube(c, axis, 0.5 + h, 1, r, 0.6, 1);
    else tube(c, axis, 0, 0.5 - h, r, 0, 0.4);
    const end: 0 | 1 = positive ? 1 : 0;
    if (flangeAt(axis, end)) halfFlange(c, axis, end, R, th);
  }
}
