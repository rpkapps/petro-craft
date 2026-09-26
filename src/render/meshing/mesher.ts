// Chunk mesher: LW-padded voxel column → three vertex streams (opaque, alpha-tested cut-out, translucent)
// whose opaque/cut-out indices are grouped by vertical section. Features: hidden-face culling, per-vertex AO
// with anisotropy-free quad flipping, smooth sky/block light, greedy merging of uniformly lit opaque faces,
// leaf interiors culled beyond one layer, directional liquids with depth attribute, cross plants with jitter
// (flagged for the distance fade, omitted for far chunks), slabs and pipes, per-section cave-culling
// visibility and per-pass content hashes.
import { B } from '../../core/blocks';
import { CHUNK_SIZE } from '../../core/constants';
import {
  SHAPE, PASS, FACE_LAYER, OPAQUE, SWAY, PIPE_CAT, WATERLOGGED, LIQUID_TOP, FULLBRIGHT, PLANT, PLANT_LAYER_FLAG,
  SHAPE_CUBE, SHAPE_CROSS, SHAPE_LIQUID, SHAPE_PIPE, SHAPE_SLAB, PASS_OPAQUE, PASS_CUTOUT, PASS_TRANSLUCENT, PIPE_CASING, PIPE_NONE,
} from './blockTables';
import { MeshBuffer } from './MeshBuffer';
import { emitPipe } from './pipeGeometry';
import { computeBlockLight, computeSkyLight } from './lighting';
import { PW, PAD, LW, LPAD, SECTION, type MeshJob, type MeshResult, type PassData } from './protocol';
import { hash3 } from '../util/noise';

const CS = CHUNK_SIZE;
const PL = PW * PW;
/** Direction order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
const DIRS: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const stride = (v: number[]) => v[0] + v[2] * PW + v[1] * PL;
const NOFF = DIRS.map(stride);

interface FaceDef {
  n: number[];
  o: number[];
  u: number[];
  v: number[];
  /** 0 top, 1 side, 2 bottom */
  tex: number;
  /** neighbour-relative offsets for [corner][side1, side2, diagonal] */
  ao: number[][];
  /** Axis (0 x, 1 y, 2 z) and sign of u / v / n — used by greedy merging. */
  uAxis: number;
  uSign: number;
  vAxis: number;
  vSign: number;
  nAxis: number;
}

const axisOf = (v: number[]) => (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2);
const FACES: FaceDef[] = [
  { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], tex: 1 },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], tex: 1 },
  { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], tex: 0 },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], tex: 2 },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], tex: 1 },
  { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], tex: 1 },
].map((f) => {
  const uAxis = axisOf(f.u);
  const vAxis = axisOf(f.v);
  return { ...f, ao: [], uAxis, uSign: f.u[uAxis], vAxis, vSign: f.v[vAxis], nAxis: axisOf(f.n) };
});
const CORNER_SU = [-1, 1, 1, -1];
const CORNER_SV = [-1, -1, 1, 1];
const CORNER_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
for (const f of FACES) {
  for (let k = 0; k < 4; k++) {
    const su = CORNER_SU[k];
    const sv = CORNER_SV[k];
    const s1 = [f.u[0] * su, f.u[1] * su, f.u[2] * su];
    const s2 = [f.v[0] * sv, f.v[1] * sv, f.v[2] * sv];
    f.ao.push([stride(s1), stride(s2), stride([s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]])]);
  }
}

const AO_LEVEL = [112, 158, 206, 255];

/**
 * Per face: neighbour strides of the four in-plane directions (+a1, -a1, +a2, -a2; a1 < a2 are the world
 * axes other than the normal axis). An edge is exposed (convex) when the cell beside the block and the
 * cell diagonally in front are both open; the HD shader rounds those edges. Bits are packed as a negative
 * sway value (sway < 0 never animates).
 */
const EDGE_DIRS: number[][] = FACES.map((f) => {
  const axes = [0, 1, 2].filter((a) => a !== f.nAxis);
  const unit = (a: number, sgn: number) => [a === 0 ? sgn : 0, a === 1 ? sgn : 0, a === 2 ? sgn : 0];
  return [stride(unit(axes[0], 1)), stride(unit(axes[0], -1)), stride(unit(axes[1], 1)), stride(unit(axes[1], -1))];
});

/** Face-pair index (a < b) → bit of the section visibility mask. */
const PAIR_BIT: number[][] = [];
{
  let bit = 0;
  for (let a = 0; a < 6; a++) PAIR_BIT.push([0, 0, 0, 0, 0, 0]);
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      PAIR_BIT[a][b] = PAIR_BIT[b][a] = 1 << bit;
      bit++;
    }
}
export const VIS_ALL = (1 << 15) - 1;

/** Section-local cell index for greedy masks: x + z*16 + (y - y0)*256. */
const GI = (x: number, ly: number, z: number) => x + z * CS + ly * CS * CS;

function fnv(h: number, data: ArrayBufferView): number {
  const u = data.byteLength & 3 ? new Uint16Array(data.buffer, data.byteOffset, data.byteLength >> 1) : new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  for (let i = 0; i < u.length; i++) {
    h ^= u[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashPass(h: number, p: PassData | null, salt: number): number {
  h = Math.imul(h ^ salt, 16777619);
  if (!p) return h >>> 0;
  h = fnv(h, p.positions);
  h = fnv(h, p.normals);
  h = fnv(h, p.uvs);
  h = fnv(h, p.info);
  h = fnv(h, p.indices);
  return h;
}

/** Reusable per-worker state. */
export class Mesher {
  private opaque = new MeshBuffer();
  private cutout = new MeshBuffer();
  private translucent = new MeshBuffer(true);

  // per-job volumes (PW × PW × (H+2), one solid layer below and one air layer above)
  private ext = new Uint8Array(0);
  private sky = new Uint8Array(0);
  private blk: Uint8Array | null = null;
  private blkBuf = new Uint8Array(0);
  private minY = 1e9;
  private maxY = -1e9;
  private skipPlants = false;
  private outside = 0;
  /** The job's LW-padded block volume (wider context than `ext`). */
  private lw: Uint8Array = new Uint8Array(0);
  private height = 0;

  // greedy merging: per direction, key of each mergeable face in the current section (0 = none)
  private greedy: Float64Array[] = DIRS.map(() => new Float64Array(CS * CS * SECTION));
  private greedyAny = [false, false, false, false, false, false];
  private slice = new Float64Array(CS * SECTION);
  // visibility flood scratch
  private visSeen = new Uint8Array(CS * CS * SECTION);
  private visStack = new Int32Array(CS * CS * SECTION);

  // per-face scratch
  private fAo = [0, 0, 0, 0];
  private fSky = [0, 0, 0, 0];
  private fBlk = [0, 0, 0, 0];

  mesh(job: MeshJob): MeshResult {
    const t0 = performance.now();
    const H = job.height;
    this.skipPlants = job.skipPlants;
    this.outside = job.outside;
    this.lw = job.blocks;
    this.height = H;
    const n = PL * (H + 2);
    if (this.ext.length !== n) {
      this.ext = new Uint8Array(n);
      this.sky = new Uint8Array(n);
      this.blkBuf = new Uint8Array(n);
    }
    const ext = this.ext;
    const sky = this.sky;
    const lplane = LW * LW;
    const skyRaw = computeSkyLight(job.blocks, H);
    const blkRaw = computeBlockLight(job.blocks, job.emitters, H);
    // Extend by one layer below (solid, dark) and above (air, full sky) so no y bounds checks are needed.
    ext.fill(B.BEDROCK, 0, PL);
    ext.fill(B.AIR, PL * (H + 1));
    sky.fill(0, 0, PL);
    sky.fill(255, PL * (H + 1));
    const blk = blkRaw ? this.blkBuf : null;
    if (blk) {
      blk.fill(0, 0, PL);
      blk.fill(0, PL * (H + 1));
    }
    const off = LPAD - PAD;
    for (let y = 0; y < H; y++)
      for (let pz = 0; pz < PW; pz++) {
        const s = off + (pz + off) * LW + y * lplane;
        const d = pz * PW + (y + 1) * PL;
        ext.set(job.blocks.subarray(s, s + PW), d);
        sky.set(skyRaw.subarray(s, s + PW), d);
        if (blk) blk.set(blkRaw!.subarray(s, s + PW), d);
      }
    this.blk = blk;

    // highest non-air layer in the chunk interior
    let top = 0;
    for (let y = H - 1; y >= 0 && !top; y--) {
      const base = PL * (y + 1);
      for (let z = PAD; z < PAD + CS && !top; z++)
        for (let x = PAD; x < PAD + CS; x++)
          if (ext[base + x + z * PW]) {
            top = y + 1;
            break;
          }
    }

    const wx0 = job.cx * CS;
    const wz0 = job.cz * CS;
    const nSec = Math.ceil(H / SECTION);
    const opaqueRanges = new Uint32Array(nSec + 1);
    const cutoutRanges = new Uint32Array(nSec + 1);
    const sectionMinY = new Float32Array(nSec);
    const sectionMaxY = new Float32Array(nSec);
    const vis = new Uint16Array(nSec);
    this.opaque.reset();
    this.cutout.reset();
    this.translucent.reset();
    for (let s = 0; s < nSec; s++) {
      const y0 = s * SECTION;
      const y1 = Math.min(H, y0 + SECTION);
      opaqueRanges[s] = this.opaque.ic;
      cutoutRanges[s] = this.cutout.ic;
      this.minY = 1e9;
      this.maxY = -1e9;
      for (let ey = y0 + 1, yEnd = Math.min(y1, top); ey <= yEnd; ey++) {
        const y = ey - 1;
        for (let z = 0; z < CS; z++)
          for (let x = 0; x < CS; x++) {
            const i = x + PAD + (z + PAD) * PW + ey * PL;
            const id = ext[i];
            if (id === 0) continue;
            switch (SHAPE[id]) {
              case SHAPE_CUBE:
                this.cube(i, id, x, y, z, 1, y0);
                break;
              case SHAPE_SLAB:
                this.cube(i, id, x, y, z, 0.5, y0);
                break;
              case SHAPE_LIQUID:
                this.liquid(i, id, x, y, z);
                break;
              case SHAPE_CROSS:
                this.cross(i, id, x, y, z, wx0 + x, wz0 + z);
                break;
              case SHAPE_PIPE:
                this.pipe(i, id, x, y, z, wx0 + x, y, wz0 + z);
                break;
              default:
                break;
            }
          }
      }
      this.flushGreedy(y0, y1);
      sectionMinY[s] = this.minY;
      sectionMaxY[s] = this.maxY;
      vis[s] = this.visibility(y0, y1);
    }
    opaqueRanges[nSec] = this.opaque.ic;
    cutoutRanges[nSec] = this.cutout.ic;

    const quadCenters = this.translucent.centers && this.translucent.centers.length ? new Float32Array(this.translucent.centers) : null;
    const opaque = this.opaque.finish();
    const cutout = this.cutout.finish();
    const translucent = this.translucent.finish();
    const hashes = new Uint32Array(3);
    hashes[0] = hashPass(fnv(2166136261, opaqueRanges), opaque, 1);
    hashes[1] = hashPass(fnv(2166136261, cutoutRanges), cutout, 2);
    hashes[2] = hashPass(2166136261, translucent, 3);
    return {
      type: 'mesh',
      id: job.id,
      cx: job.cx,
      cz: job.cz,
      opaque,
      cutout,
      translucent,
      quadCenters,
      opaqueRanges,
      cutoutRanges,
      sectionMinY,
      sectionMaxY,
      vis,
      hashes,
      skipPlants: job.skipPlants,
      ms: performance.now() - t0,
    };
  }

  /** Whether face `d` of the cell at chunk-local (x, z) faces a side beyond the streamed domain. */
  private beyond(d: number, x: number, z: number): boolean {
    const o = this.outside;
    if (!o) return false;
    return (d === 0 && x === CS - 1 && (o & 1) !== 0) || (d === 1 && x === 0 && (o & 2) !== 0) || (d === 4 && z === CS - 1 && (o & 16) !== 0) || (d === 5 && z === 0 && (o & 32) !== 0);
  }

  private bufFor(id: number): MeshBuffer {
    const p = PASS[id];
    return p === PASS_TRANSLUCENT ? this.translucent : p === PASS_CUTOUT ? this.cutout : this.opaque;
  }

  private track(y0: number, y1: number) {
    if (y0 < this.minY) this.minY = y0;
    if (y1 > this.maxY) this.maxY = y1;
  }

  /** Smooth light + AO for one face whose outward neighbour cell is `ni`. */
  private sampleFace(f: FaceDef, ni: number, withAo: boolean) {
    const ext = this.ext;
    const sky = this.sky;
    const blk = this.blk;
    for (let k = 0; k < 4; k++) {
      const o = f.ao[k];
      const a = ni + o[0];
      const b = ni + o[1];
      const c = ni + o[2];
      const oa = OPAQUE[ext[a]];
      const ob = OPAQUE[ext[b]];
      const oc = oa && ob ? 1 : OPAQUE[ext[c]];
      this.fAo[k] = withAo ? AO_LEVEL[oa && ob ? 0 : 3 - (oa + ob + oc)] : 255;
      let n = 1;
      let s = sky[ni];
      let l = blk ? blk[ni] : 0;
      if (!oa) {
        s += sky[a];
        if (blk) l += blk[a];
        n++;
      }
      if (!ob) {
        s += sky[b];
        if (blk) l += blk[b];
        n++;
      }
      if (!oc) {
        s += sky[c];
        if (blk) l += blk[c];
        n++;
      }
      this.fSky[k] = (s / n) | 0;
      this.fBlk[k] = (l / n) | 0;
    }
  }

  private emitBoxFace(buf: MeshBuffer, f: FaceDef, x: number, y: number, z: number, hy: number, layer: number, sway: number, aoOverride: number) {
    const s = sway;
    for (let k = 0; k < 4; k++) {
      const su = k === 1 || k === 2 ? 1 : 0;
      const sv = k === 2 || k === 3 ? 1 : 0;
      const px = f.o[0] + f.u[0] * su + f.v[0] * sv;
      let py = f.o[1] + f.u[1] * su + f.v[1] * sv;
      const pz = f.o[2] + f.u[2] * su + f.v[2] * sv;
      py *= hy;
      let v = CORNER_UV[k][1];
      if (f.tex === 1 && hy < 1) v = v === 0 ? 1 - hy : 1; // side faces of partial blocks use the lower texture part
      buf.vert(x + px, y + py, z + pz, f.n[0], f.n[1], f.n[2], s, CORNER_UV[k][0], v, layer, aoOverride >= 0 ? aoOverride : this.fAo[k], this.fSky[k], this.fBlk[k]);
    }
    const a0 = this.fAo[0] + this.fSky[0] * 0.25;
    const a1 = this.fAo[1] + this.fSky[1] * 0.25;
    const a2 = this.fAo[2] + this.fSky[2] * 0.25;
    const a3 = this.fAo[3] + this.fSky[3] * 0.25;
    buf.quad(a0 + a2 < a1 + a3);
  }

  private cube(i: number, id: number, x: number, y: number, z: number, hy: number, y0: number) {
    const ext = this.ext;
    const pass = PASS[id];
    const buf = this.bufFor(id);
    const isLeaves = SWAY[id] === 1;
    const sway = isLeaves ? 0.35 : 0;
    const mergeable = pass === PASS_OPAQUE && hy === 1 && !isLeaves;
    let emitted = false;
    for (let d = 0; d < 6; d++) {
      if (this.beyond(d, x, z)) continue;
      const ni = i + NOFF[d];
      const nb = ext[ni];
      if (OPAQUE[nb]) {
        if (!(hy < 1 && d === 2)) continue; // slab tops are always visible
      }
      if (pass !== 0 && nb === id && !isLeaves) continue; // glass/ice/grate: cull same-type seams
      // leaves: faces towards another leaf are only kept one layer deep (seen through that leaf's holes)
      if (isLeaves && SWAY[nb] === 1 && SHAPE[nb] === SHAPE_CUBE) {
        const by = y + DIRS[d][1] * 2;
        if (by >= 0 && by < this.height) {
          const beyond = this.lw[x + DIRS[d][0] * 2 + LPAD + (z + DIRS[d][2] * 2 + LPAD) * LW + by * LW * LW];
          if (OPAQUE[beyond] || (SWAY[beyond] === 1 && SHAPE[beyond] === SHAPE_CUBE)) continue;
        }
      }
      if (d === 2 && hy === 1 && SHAPE[nb] === SHAPE_SLAB) continue;
      if (hy < 1 && d === 2) {
        // Slab top sits inside its own cell: light it from the cell itself.
        this.sampleFace(FACES[d], i, true);
      } else this.sampleFace(FACES[d], ni, true);
      const f = FACES[d];
      const layer = FACE_LAYER[id * 3 + f.tex];
      emitted = true;
      if (mergeable) {
        const ao = this.fAo;
        const sk = this.fSky;
        const bl = this.fBlk;
        if (ao[0] === ao[1] && ao[0] === ao[2] && ao[0] === ao[3] && sk[0] === sk[1] && sk[0] === sk[2] && sk[0] === sk[3] && bl[0] === bl[1] && bl[0] === bl[2] && bl[0] === bl[3]) {
          this.greedy[d][GI(x, y - y0, z)] = layer + 1 + ao[0] * 256 + sk[0] * 65536 + bl[0] * 16777216 + this.edgeBits(i, d) * 4294967296;
          this.greedyAny[d] = true;
          continue;
        }
      }
      const eb = mergeable ? this.edgeBits(i, d) : 0;
      this.emitBoxFace(buf, f, x, y, z, hy, layer, eb ? -(eb + 1) / 127 : sway, -1);
    }
    if (emitted) this.track(y, y + hy);
  }

  private edgeBits(i: number, d: number): number {
    const ext = this.ext;
    const dirs = EDGE_DIRS[d];
    const fwd = NOFF[d];
    let bits = 0;
    for (let k = 0; k < 4; k++) {
      const side = i + dirs[k];
      if (!OPAQUE[ext[side]] && !OPAQUE[ext[side + fwd]]) bits |= 1 << k;
    }
    return bits;
  }

  /** Merge the section's uniformly lit opaque faces into maximal rectangles per slice and emit them. */
  private flushGreedy(y0: number, y1: number) {
    const SH = y1 - y0;
    const dims = [CS, SH, CS];
    const cell = [0, 0, 0];
    const lo = [0, 0, 0];
    const len = [1, 1, 1];
    for (let d = 0; d < 6; d++) {
      if (!this.greedyAny[d]) continue;
      this.greedyAny[d] = false;
      const f = FACES[d];
      const g = this.greedy[d];
      // plane axes: A = u axis, Bx = v axis (any consistent choice works; rects are axis-aligned)
      const A = f.uAxis;
      const Bx = f.vAxis;
      const N = f.nAxis;
      const WA = dims[A];
      const WB = dims[Bx];
      const sl = this.slice;
      for (let s = 0; s < dims[N]; s++) {
        // gather the slice
        let any = false;
        for (let b = 0; b < WB; b++)
          for (let a = 0; a < WA; a++) {
            cell[N] = s;
            cell[A] = a;
            cell[Bx] = b;
            const gi = GI(cell[0], cell[1], cell[2]);
            const k = g[gi];
            sl[a + b * WA] = k;
            if (k) {
              any = true;
              g[gi] = 0;
            }
          }
        if (!any) continue;
        for (let b = 0; b < WB; b++)
          for (let a = 0; a < WA; a++) {
            const k = sl[a + b * WA];
            if (!k) continue;
            let w = 1;
            while (a + w < WA && sl[a + w + b * WA] === k) w++;
            let h = 1;
            grow: while (b + h < WB) {
              const row = (b + h) * WA;
              for (let t = 0; t < w; t++) if (sl[a + t + row] !== k) break grow;
              h++;
            }
            for (let hh = 0; hh < h; hh++) {
              const row = (b + hh) * WA;
              for (let t = 0; t < w; t++) sl[a + t + row] = 0;
            }
            lo[N] = s;
            lo[A] = a;
            lo[Bx] = b;
            len[N] = 1;
            len[A] = w;
            len[Bx] = h;
            this.emitMerged(f, lo, len, k, y0);
          }
      }
    }
  }

  private emitMerged(f: FaceDef, lo: number[], len: number[], key: number, y0: number) {
    const layer = (key % 256) - 1;
    const ao = Math.floor(key / 256) % 256;
    const sky = Math.floor(key / 65536) % 256;
    const blk = Math.floor(key / 16777216) % 256;
    const edges = Math.floor(key / 4294967296) % 16;
    const sway = edges ? -(edges + 1) / 127 : 0;
    // start cell: the rectangle corner that the face's (u=0, v=0) vertex belongs to
    const sx = [lo[0], lo[1] + y0, lo[2]];
    if (f.uSign < 0) sx[f.uAxis] += len[f.uAxis] - 1;
    if (f.vSign < 0) sx[f.vAxis] += len[f.vAxis] - 1;
    const W = len[f.uAxis];
    const Hh = len[f.vAxis];
    const buf = this.opaque;
    for (let k = 0; k < 4; k++) {
      const su = (k === 1 || k === 2 ? 1 : 0) * W;
      const sv = (k === 2 || k === 3 ? 1 : 0) * Hh;
      buf.vert(
        sx[0] + f.o[0] + f.u[0] * su + f.v[0] * sv,
        sx[1] + f.o[1] + f.u[1] * su + f.v[1] * sv,
        sx[2] + f.o[2] + f.u[2] * su + f.v[2] * sv,
        f.n[0], f.n[1], f.n[2], sway, CORNER_UV[k][0] * W, CORNER_UV[k][1] * Hh, layer, ao, sky, blk,
      );
    }
    buf.quad(false);
  }

  private liquid(i: number, id: number, x: number, y: number, z: number) {
    const ext = this.ext;
    const above = ext[i + NOFF[2]];
    const sameAbove = above === id || (id === B.WATER && WATERLOGGED[above] === 1);
    const hy = sameAbove ? 1 : LIQUID_TOP[id];
    // water column depth below (incl. this cell) → shoreline tint & alpha in the water shader
    let depth = 0;
    let k = i;
    while (depth < 15 && (ext[k] === id || (id === B.WATER && WATERLOGGED[ext[k]] === 1))) {
      depth++;
      k -= PL;
    }
    const depthCode = Math.min(255, depth * 17);
    const buf = this.translucent;
    let emitted = false;
    for (let d = 0; d < 6; d++) {
      if (this.beyond(d, x, z)) continue;
      const ni = i + NOFF[d];
      const nb = ext[ni];
      if (nb === id || (id === B.WATER && WATERLOGGED[nb] === 1)) continue;
      if (OPAQUE[nb]) continue;
      if (d === 2 && sameAbove) continue;
      const f = FACES[d];
      this.sampleFace(f, d === 2 ? i + NOFF[2] : ni, false);
      this.emitBoxFace(buf, f, x, y, z, hy, FACE_LAYER[id * 3 + f.tex], 0, depthCode);
      emitted = true;
    }
    if (emitted) this.track(y, y + hy);
  }

  private cross(i: number, id: number, x: number, y: number, z: number, wx: number, wz: number) {
    const plant = PLANT[id] === 1;
    if (plant && this.skipPlants) return;
    const buf = this.cutout;
    const layer = FACE_LAYER[id * 3 + 1] + (plant ? PLANT_LAYER_FLAG : 0);
    const jx = (hash3(wx, wz, 11) - 0.5) * 0.3;
    const jz = (hash3(wx, wz, 23) - 0.5) * 0.3;
    const tall = id === B.TALL_GRASS || id === B.SEAGRASS ? 0.72 + hash3(wx, wz, 37) * 0.36 : id === B.FIRE ? 1.15 : 1;
    const sky = this.sky[i];
    const blk = this.blk ? this.blk[i] : 0;
    const full = FULLBRIGHT[id] === 1;
    const s = full ? 255 : sky;
    const b = full ? 255 : blk;
    const swayTop = SWAY[id] === 2 ? 1 : 0;
    const a = 0.12;
    const c = 0.88;
    for (let q = 0; q < 2; q++) {
      const x0 = a;
      const x1 = c;
      const z0 = q === 0 ? a : c;
      const z1 = q === 0 ? c : a;
      buf.vert(x + x0 + jx, y, z + z0 + jz, 0, 1, 0, 0, 0, 1, layer, 170, s, b);
      buf.vert(x + x1 + jx, y, z + z1 + jz, 0, 1, 0, 0, 1, 1, layer, 170, s, b);
      buf.vert(x + x1 + jx, y + tall, z + z1 + jz, 0, 1, 0, swayTop, 1, 0, layer, 255, s, b);
      buf.vert(x + x0 + jx, y + tall, z + z0 + jz, 0, 1, 0, swayTop, 0, 0, layer, 255, s, b);
      buf.quad(false);
    }
    this.track(y, y + tall);
  }

  private pipe(i: number, id: number, x: number, y: number, z: number, wx: number, wy: number, wz: number) {
    const ext = this.ext;
    const cat = PIPE_CAT[id];
    let mask = 0;
    for (let d = 0; d < 6; d++) {
      const nb = ext[i + NOFF[d]];
      const nc = PIPE_CAT[nb];
      const connects = cat === PIPE_CASING ? nc === PIPE_CASING : nc === cat || (nb === B.STRUCTURE && nc === PIPE_NONE);
      if (connects) mask |= 1 << d;
    }
    // Pipes are lit by their own cell, lifted a little by any open neighbour.
    let sky = this.sky[i];
    for (let d = 0; d < 6; d++) {
      const s = this.sky[i + NOFF[d]];
      if (s > sky) sky = (sky + s) >> 1;
    }
    const blk = this.blk ? this.blk[i] : 0;
    emitPipe(this.opaque, x, y, z, wx, wy, wz, mask, cat === PIPE_CASING, FACE_LAYER[id * 3 + 1], sky, blk);
    this.track(y, y + 1);
  }

  /** Which section faces are connected through non-opaque cells (flood fill of the open space). */
  private visibility(y0: number, y1: number): number {
    const SH = y1 - y0;
    const ext = this.ext;
    const seen = this.visSeen;
    const stack = this.visStack;
    const total = CS * CS * SH;
    seen.fill(0, 0, total);
    let vis = 0;
    let open = 0;
    for (let start = 0; start < total; start++) {
      if (seen[start]) continue;
      const ly = (start / (CS * CS)) | 0;
      const rem = start - ly * CS * CS;
      const z = (rem / CS) | 0;
      const x = rem - z * CS;
      if (OPAQUE[ext[x + PAD + (z + PAD) * PW + (ly + y0 + 1) * PL]]) {
        seen[start] = 1;
        continue;
      }
      // flood this component
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let faces = 0;
      while (sp > 0) {
        const c = stack[--sp];
        open++;
        const cy = (c / (CS * CS)) | 0;
        const cr = c - cy * CS * CS;
        const cz = (cr / CS) | 0;
        const cx = cr - cz * CS;
        if (cx === CS - 1) faces |= 1;
        if (cx === 0) faces |= 2;
        if (cy === SH - 1) faces |= 4;
        if (cy === 0) faces |= 8;
        if (cz === CS - 1) faces |= 16;
        if (cz === 0) faces |= 32;
        const base = cx + PAD + (cz + PAD) * PW + (cy + y0 + 1) * PL;
        // 6 neighbours inside the section
        if (cx < CS - 1 && !seen[c + 1]) {
          seen[c + 1] = 1;
          if (!OPAQUE[ext[base + 1]]) stack[sp++] = c + 1;
        }
        if (cx > 0 && !seen[c - 1]) {
          seen[c - 1] = 1;
          if (!OPAQUE[ext[base - 1]]) stack[sp++] = c - 1;
        }
        if (cz < CS - 1 && !seen[c + CS]) {
          seen[c + CS] = 1;
          if (!OPAQUE[ext[base + PW]]) stack[sp++] = c + CS;
        }
        if (cz > 0 && !seen[c - CS]) {
          seen[c - CS] = 1;
          if (!OPAQUE[ext[base - PW]]) stack[sp++] = c - CS;
        }
        if (cy < SH - 1 && !seen[c + CS * CS]) {
          seen[c + CS * CS] = 1;
          if (!OPAQUE[ext[base + PL]]) stack[sp++] = c + CS * CS;
        }
        if (cy > 0 && !seen[c - CS * CS]) {
          seen[c - CS * CS] = 1;
          if (!OPAQUE[ext[base - PL]]) stack[sp++] = c - CS * CS;
        }
      }
      for (let a = 0; a < 6; a++) {
        if (!(faces & (1 << a))) continue;
        for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) vis |= PAIR_BIT[a][b];
      }
      if (vis === VIS_ALL) break;
    }
    return open === 0 ? 0 : vis;
  }
}

/** Visibility bit for a face pair (exported for the main-thread cave-culling traversal). */
export function visPair(a: number, b: number): number {
  return a === b ? 0 : PAIR_BIT[a][b];
}
