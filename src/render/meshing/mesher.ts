// Chunk mesher: padded voxel volume → three vertex streams (opaque, alpha-tested cut-out, translucent).
// Features: hidden-face culling, per-vertex AO with anisotropy-free quad flipping, smooth sky/block
// light, directional liquids with depth attribute, cross plants with jitter, slabs and pipes.
import { B } from '../../core/blocks';
import { CHUNK_SIZE } from '../../core/constants';
import {
  SHAPE, PASS, FACE_LAYER, OPAQUE, SWAY, PIPE_CAT, WATERLOGGED, LIQUID_TOP, FULLBRIGHT,
  SHAPE_CUBE, SHAPE_CROSS, SHAPE_LIQUID, SHAPE_PIPE, SHAPE_SLAB, PASS_CUTOUT, PASS_TRANSLUCENT, PIPE_CASING, PIPE_NONE,
} from './blockTables';
import { MeshBuffer } from './MeshBuffer';
import { emitPipe } from './pipeGeometry';
import { computeBlockLight, computeSkyLight } from './lighting';
import { PW, PAD, type MeshJob, type MeshResult } from './protocol';
import { hash3 } from '../util/noise';

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
}

const FACES: FaceDef[] = [
  { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], tex: 1, ao: [] },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], tex: 1, ao: [] },
  { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], tex: 0, ao: [] },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], tex: 2, ao: [] },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], tex: 1, ao: [] },
  { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], tex: 1, ao: [] },
];
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

/** Reusable per-worker state. */
export class Mesher {
  private opaque = new MeshBuffer();
  private cutout = new MeshBuffer();
  private translucent = new MeshBuffer(true);

  // per-job
  private ext!: Uint8Array;
  private sky!: Uint8Array;
  private blk: Uint8Array | null = null;
  private minY = 1e9;
  private maxY = -1e9;

  // per-face scratch
  private fAo = [0, 0, 0, 0];
  private fSky = [0, 0, 0, 0];
  private fBlk = [0, 0, 0, 0];

  mesh(job: MeshJob): MeshResult {
    const t0 = performance.now();
    const H = job.height;
    this.opaque.reset();
    this.cutout.reset();
    this.translucent.reset();
    this.minY = 1e9;
    this.maxY = -1e9;

    // Extend the volume by one layer below (solid) and above (air) so no y bounds checks are needed.
    const ext = new Uint8Array(PL * (H + 2));
    ext.fill(B.BEDROCK, 0, PL);
    ext.set(job.blocks, PL);
    this.ext = ext;
    const skyRaw = computeSkyLight(job.blocks, job.heights, H);
    const sky = new Uint8Array(PL * (H + 2));
    sky.set(skyRaw, PL);
    sky.fill(255, PL * (H + 1));
    this.sky = sky;
    const blkRaw = computeBlockLight(job.blocks, job.emitters, H);
    if (blkRaw) {
      const b = new Uint8Array(PL * (H + 2));
      b.set(blkRaw, PL);
      this.blk = b;
    } else this.blk = null;

    // highest non-air layer in the chunk interior
    let top = 0;
    for (let y = H - 1; y >= 0 && !top; y--) {
      const base = PL * (y + 1);
      for (let z = PAD; z < PAD + CHUNK_SIZE && !top; z++)
        for (let x = PAD; x < PAD + CHUNK_SIZE; x++)
          if (ext[base + x + z * PW]) {
            top = y + 1;
            break;
          }
    }

    const wx0 = job.cx * CHUNK_SIZE;
    const wz0 = job.cz * CHUNK_SIZE;
    for (let ey = 1; ey <= top; ey++) {
      const y = ey - 1;
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = x + PAD + (z + PAD) * PW + ey * PL;
          const id = ext[i];
          if (id === 0) continue;
          const shape = SHAPE[id];
          switch (shape) {
            case SHAPE_CUBE:
              this.cube(i, id, x, y, z, 1);
              break;
            case SHAPE_SLAB:
              this.cube(i, id, x, y, z, 0.5);
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

    const quadCenters = this.translucent.centers && this.translucent.centers.length ? new Float32Array(this.translucent.centers) : null;
    return {
      type: 'mesh',
      id: job.id,
      cx: job.cx,
      cz: job.cz,
      opaque: this.opaque.finish(),
      cutout: this.cutout.finish(),
      translucent: this.translucent.finish(),
      quadCenters,
      minY: this.minY > this.maxY ? 0 : this.minY,
      maxY: this.minY > this.maxY ? 0 : this.maxY,
      ms: performance.now() - t0,
    };
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

  private cube(i: number, id: number, x: number, y: number, z: number, hy: number) {
    const ext = this.ext;
    const pass = PASS[id];
    const buf = this.bufFor(id);
    const isLeaves = SWAY[id] === 1;
    const sway = isLeaves ? 0.35 : 0;
    let emitted = false;
    for (let d = 0; d < 6; d++) {
      const ni = i + NOFF[d];
      const nb = ext[ni];
      if (OPAQUE[nb]) {
        if (!(hy < 1 && d === 2)) continue; // slab tops are always visible
      }
      if (pass !== 0 && nb === id && !isLeaves) continue; // glass/ice/grate: cull same-type seams
      if (d === 2 && hy === 1 && SHAPE[nb] === SHAPE_SLAB) continue;
      if (hy < 1 && d === 2) {
        // Slab top sits inside its own cell: light it from the cell itself.
        this.sampleFace(FACES[d], i, true);
      } else this.sampleFace(FACES[d], ni, true);
      const f = FACES[d];
      this.emitBoxFace(buf, f, x, y, z, hy, FACE_LAYER[id * 3 + f.tex], sway, -1);
      emitted = true;
    }
    if (emitted) this.track(y, y + hy);
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
    const buf = this.cutout;
    const layer = FACE_LAYER[id * 3 + 1];
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
    const quads = [
      [a, a, c, c],
      [a, c, c, a],
    ];
    for (const [x0, z0, x1, z1] of quads) {
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
}
