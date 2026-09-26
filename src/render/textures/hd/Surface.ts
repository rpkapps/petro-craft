// A square, tileable material canvas for the HD painters: sRGB albedo + alpha, a height field and a
// roughness map. `finish()` derives the tangent-space normal map from the height field (wrap-around
// central differences at two scales), bakes cavity AO into the albedo, dilates colour into transparent
// texels (no dark fringes in mipmaps) and packs:
//   albedo   RGBA8  sRGB colour, alpha
//   material RGBA8  normal.x, normal.y (tangent space, 0.5 = flat), roughness, height (1 = top)
// Image convention: x → +u, y → +v (row 0 is the top of a side face).

export type RGB = [number, number, number];

export interface FinishOptions {
  /** Physical relief of the full height range, in blocks (drives normal strength). */
  depth: number;
  /** Cavity AO strength baked into the albedo (0 = none). */
  cavity?: number;
}

export interface PackedLayer {
  albedo: Uint8Array;
  material: Uint8Array;
}

const TO8 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

export class Surface {
  readonly col: Float32Array;
  readonly alpha: Float32Array;
  readonly h: Float32Array;
  readonly r: Float32Array;
  readonly n: number;

  constructor(n: number) {
    this.n = n;
    const nn = n * n;
    this.col = new Float32Array(nn * 3);
    this.alpha = new Float32Array(nn).fill(1);
    this.h = new Float32Array(nn).fill(0.5);
    this.r = new Float32Array(nn).fill(0.85);
  }

  idx(x: number, y: number) {
    const n = this.n;
    return (((y % n) + n) % n) * n + (((x % n) + n) % n);
  }

  /** Visit every texel with texture coordinates at its centre. */
  each(fn: (u: number, v: number, i: number, x: number, y: number) => void) {
    const n = this.n;
    const inv = 1 / n;
    for (let y = 0, i = 0; y < n; y++)
      for (let x = 0; x < n; x++, i++) fn((x + 0.5) * inv, (y + 0.5) * inv, i, x, y);
  }

  setCol(i: number, c: RGB) {
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
  }

  getCol(i: number): RGB {
    return [this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]];
  }

  /** Blend a colour over texel i. */
  blend(i: number, c: RGB, t: number) {
    if (t <= 0) return;
    const k = t > 1 ? 1 : t;
    const o = i * 3;
    this.col[o] += (c[0] - this.col[o]) * k;
    this.col[o + 1] += (c[1] - this.col[o + 1]) * k;
    this.col[o + 2] += (c[2] - this.col[o + 2]) * k;
  }

  mulCol(i: number, k: number) {
    const o = i * 3;
    this.col[o] *= k;
    this.col[o + 1] *= k;
    this.col[o + 2] *= k;
  }

  /**
   * Visit texels within radius `r` (texture units) of (cu, cv), wrapping around the tile.
   * fn receives the texel index and the offset (du, dv) and distance d in texture units.
   */
  disk(cu: number, cv: number, r: number, fn: (i: number, du: number, dv: number, d: number) => void) {
    const n = this.n;
    const cx = cu * n - 0.5;
    const cy = cv * n - 0.5;
    const rp = r * n;
    const x0 = Math.floor(cx - rp);
    const x1 = Math.ceil(cx + rp);
    const y0 = Math.floor(cy - rp);
    const y1 = Math.ceil(cy + rp);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const du = (x - cx) / n;
        const dv = (y - cy) / n;
        const d = Math.sqrt(du * du + dv * dv);
        if (d <= r) fn(this.idx(x, y), du, dv, d);
      }
  }

  /**
   * Visit texels near a tapered segment from (u0, v0) along angle `ang` for length `len` with width
   * `w0` at the start and `w1` at the end (texture units). fn gets the index, the position along the
   * stroke t ∈ [0, 1] and the normalised distance across it s ∈ [-1, 1]. A texel can be visited more
   * than once, so callbacks should be idempotent (max / keep-nearest writes).
   */
  stroke(u0: number, v0: number, ang: number, len: number, w0: number, w1: number, fn: (i: number, t: number, s: number) => void, bend = 0) {
    const n = this.n;
    const steps = Math.max(2, Math.ceil(len * n * 1.5));
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const w = w0 + (w1 - w0) * t;
      const curve = bend * t * t;
      const cu = u0 + dx * len * t - dy * curve;
      const cv = v0 + dy * len * t + dx * curve;
      const rp = Math.max(0.5, (w * n) / 2);
      const cx = cu * n - 0.5;
      const cy = cv * n - 0.5;
      for (let y = Math.floor(cy - rp); y <= Math.ceil(cy + rp); y++)
        for (let x = Math.floor(cx - rp); x <= Math.ceil(cx + rp); x++) {
          const ox = x - cx;
          const oy = y - cy;
          // distance across the stroke direction
          const across = -ox * dy + oy * dx;
          const along = ox * dx + oy * dy;
          if (Math.abs(along) > 0.75) continue;
          const s = across / rp;
          if (s < -1 || s > 1) continue;
          fn(this.idx(x, y), t, s);
        }
    }
  }

  finish(o: FinishOptions): PackedLayer {
    const n = this.n;
    const nn = n * n;
    const h = this.h;
    // normalise the height field to 0..1
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < nn; i++) {
      if (h[i] < lo) lo = h[i];
      if (h[i] > hi) hi = h[i];
    }
    const span = hi - lo > 1e-6 ? hi - lo : 1;
    const hn = new Float32Array(nn);
    for (let i = 0; i < nn; i++) hn[i] = (h[i] - lo) / span;
    const depth = (o.depth * (hi - lo > 1e-6 ? 1 : 0)) || 0;

    // local mean (separable box blur, wrap) for cavity AO and the coarse normal scale
    const rad = Math.max(1, Math.round(n / 40));
    const blur = boxBlur(hn, n, rad);
    const albedo = new Uint8Array(nn * 4);
    const material = new Uint8Array(nn * 4);
    const cavity = o.cavity ?? 0.6;
    const k = depth * n * 0.5; // central difference → slope in block units
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const xl = y * n + ((x + n - 1) % n);
        const xr = y * n + ((x + 1) % n);
        const yu = ((y + n - 1) % n) * n + x;
        const yd = ((y + 1) % n) * n + x;
        // fine + coarse slopes (the coarse term keeps large forms readable after mipmapping)
        const sx = (hn[xr] - hn[xl]) * k + (blur[xr] - blur[xl]) * k * 0.6;
        const sy = (hn[yd] - hn[yu]) * k + (blur[yd] - blur[yu]) * k * 0.6;
        let nx = -sx;
        let ny = -sy;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= inv;
        ny *= inv;
        const cav = 1 - Math.min(0.75, Math.max(0, (blur[i] - hn[i]) * 2.2) * cavity);
        const o3 = i * 3;
        const o4 = i * 4;
        albedo[o4] = TO8(this.col[o3] * cav);
        albedo[o4 + 1] = TO8(this.col[o3 + 1] * cav);
        albedo[o4 + 2] = TO8(this.col[o3 + 2] * cav);
        albedo[o4 + 3] = TO8(this.alpha[i]);
        material[o4] = TO8(nx * 0.5 + 0.5);
        material[o4 + 1] = TO8(ny * 0.5 + 0.5);
        material[o4 + 2] = TO8(this.r[i]);
        material[o4 + 3] = TO8(hn[i]);
      }
    dilate(albedo, n);
    return { albedo, material };
  }
}

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * n + ((k + n) % n)];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = s / w;
      s += src[y * n + ((x + r + 1) % n)] - src[y * n + ((x - r + n) % n)];
    }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[((k + n) % n) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = s / w;
      s += tmp[((y + r + 1) % n) * n + x] - tmp[((y - r + n) % n) * n + x];
    }
  }
  return out;
}

/** Spread colour into fully transparent texels (a few passes) so filtering never pulls in black. */
function dilate(px: Uint8Array, n: number) {
  let any = false;
  for (let i = 3; i < px.length; i += 4)
    if (px[i] < 8) {
      any = true;
      break;
    }
  if (!any) return;
  const filled = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) filled[i] = px[i * 4 + 3] >= 8 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const next = filled.slice();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let c = 0;
        for (let k = 0; k < 4; k++) {
          const j = k === 0 ? y * n + ((x + 1) % n) : k === 1 ? y * n + ((x + n - 1) % n) : k === 2 ? ((y + 1) % n) * n + x : ((y + n - 1) % n) * n + x;
          if (!filled[j]) continue;
          r += px[j * 4];
          g += px[j * 4 + 1];
          b += px[j * 4 + 2];
          c++;
        }
        if (!c) continue;
        px[i * 4] = r / c;
        px[i * 4 + 1] = g / c;
        px[i * 4 + 2] = b / c;
        next[i] = 1;
      }
    filled.set(next);
  }
}
