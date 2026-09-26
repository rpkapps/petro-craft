// Growable interleaved-by-attribute vertex/index buffers used by the mesher.
import type { PassData } from './protocol';

export class MeshBuffer {
  pos = new Float32Array(4096 * 3);
  nrm = new Int8Array(4096 * 4);
  uv = new Float32Array(4096 * 2);
  info = new Uint8Array(4096 * 4);
  idx = new Uint32Array(6144);
  vc = 0;
  ic = 0;
  /** Quad centres (translucent pass only). */
  centers: number[] | null;

  constructor(trackCenters = false) {
    this.centers = trackCenters ? [] : null;
  }

  reset() {
    this.vc = 0;
    this.ic = 0;
    if (this.centers) this.centers.length = 0;
  }

  private growV(n: number) {
    if (this.vc + n <= this.pos.length / 3) return;
    const cap = Math.max((this.pos.length / 3) * 2, this.vc + n);
    const p = new Float32Array(cap * 3);
    p.set(this.pos);
    this.pos = p;
    const nr = new Int8Array(cap * 4);
    nr.set(this.nrm);
    this.nrm = nr;
    const u = new Float32Array(cap * 2);
    u.set(this.uv);
    this.uv = u;
    const inf = new Uint8Array(cap * 4);
    inf.set(this.info);
    this.info = inf;
  }
  private growI(n: number) {
    if (this.ic + n <= this.idx.length) return;
    const a = new Uint32Array(Math.max(this.idx.length * 2, this.ic + n));
    a.set(this.idx);
    this.idx = a;
  }

  /** Append a vertex. Normal components in [-1,1], sway 0..1, light values 0..255. */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, sway: number, u: number, v: number, layer: number, ao: number, sky: number, blk: number) {
    this.growV(1);
    const i = this.vc++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nrm[i * 4] = Math.round(nx * 127);
    this.nrm[i * 4 + 1] = Math.round(ny * 127);
    this.nrm[i * 4 + 2] = Math.round(nz * 127);
    this.nrm[i * 4 + 3] = Math.round(sway * 127);
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.info[i * 4] = layer;
    this.info[i * 4 + 1] = ao;
    this.info[i * 4 + 2] = sky;
    this.info[i * 4 + 3] = blk;
  }

  /** Index the last four vertices as a quad; `flip` swaps the diagonal (AO anisotropy fix). */
  quad(flip: boolean) {
    this.growI(6);
    const b = this.vc - 4;
    const I = this.idx;
    let k = this.ic;
    if (!flip) {
      I[k++] = b;
      I[k++] = b + 1;
      I[k++] = b + 2;
      I[k++] = b;
      I[k++] = b + 2;
      I[k++] = b + 3;
    } else {
      I[k++] = b + 1;
      I[k++] = b + 2;
      I[k++] = b + 3;
      I[k++] = b + 1;
      I[k++] = b + 3;
      I[k++] = b;
    }
    this.ic = k;
    if (this.centers) {
      const P = this.pos;
      this.centers.push(
        (P[b * 3] + P[b * 3 + 3] + P[b * 3 + 6] + P[b * 3 + 9]) * 0.25,
        (P[b * 3 + 1] + P[b * 3 + 4] + P[b * 3 + 7] + P[b * 3 + 10]) * 0.25,
        (P[b * 3 + 2] + P[b * 3 + 5] + P[b * 3 + 8] + P[b * 3 + 11]) * 0.25,
      );
    }
  }

  /** Index the last three vertices as a triangle. */
  tri() {
    this.growI(3);
    const b = this.vc - 3;
    this.idx[this.ic++] = b;
    this.idx[this.ic++] = b + 1;
    this.idx[this.ic++] = b + 2;
  }

  finish(): PassData | null {
    if (this.ic === 0) return null;
    const indices = this.vc > 65535 ? this.idx.slice(0, this.ic) : Uint16Array.from(this.idx.subarray(0, this.ic));
    return {
      positions: this.pos.slice(0, this.vc * 3),
      normals: this.nrm.slice(0, this.vc * 4),
      uvs: this.uv.slice(0, this.vc * 2),
      info: this.info.slice(0, this.vc * 4),
      indices,
    };
  }
}
