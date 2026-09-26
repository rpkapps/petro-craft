// A tiny software canvas for painting 16×16 block textures in sRGB space, plus colour helpers and
// the drawing primitives shared by every painter (tileable noise, random walks, voronoi cells...).
import { fbm2, hash3, valueNoise2 } from '../util/noise';

export const TEX = 16;

export type RGB = [number, number, number];

export const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const add = (c: RGB, v: number): RGB => [c[0] + v, c[1] + v, c[2] + v];
export const lum = (c: RGB) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
export const saturate = (c: RGB, k: number): RGB => {
  const l = lum(c);
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
};
export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];

/** Build a 5-step pixel-art ramp (darkest → brightest) from a base colour and optional dark/light hints. */
export function ramp(base: RGB, dark?: RGB, light?: RGB): RGB[] {
  const d = dark ?? shade(base, 0.8);
  const l = light ?? shade(base, 1.15);
  return [shade(d, 0.84), d, base, l, mixc(l, WHITE, 0.12)];
}

/** Pick a ramp colour from t in [0,1] (quantised — keeps the crisp pixel-art look). */
export function pick(r: RGB[], t: number): RGB {
  const i = Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)));
  return r[i];
}

export class Pixmap {
  readonly data = new Float32Array(TEX * TEX * 4);
  constructor(public seed: number) {}

  private idx(x: number, y: number) {
    const xx = ((x % TEX) + TEX) % TEX;
    const yy = ((y % TEX) + TEX) % TEX;
    return (yy * TEX + xx) * 4;
  }
  set(x: number, y: number, c: RGB, a = 1) {
    const i = this.idx(x, y);
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = this.idx(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number) {
    return this.data[this.idx(x, y) + 3];
  }
  setAlpha(x: number, y: number, a: number) {
    this.data[this.idx(x, y) + 3] = a;
  }
  /** Blend a colour over the pixel (keeps alpha unless given). */
  blend(x: number, y: number, c: RGB, t: number, a?: number) {
    const i = this.idx(x, y);
    this.data[i] += (c[0] - this.data[i]) * t;
    this.data[i + 1] += (c[1] - this.data[i + 1]) * t;
    this.data[i + 2] += (c[2] - this.data[i + 2]) * t;
    if (a !== undefined) this.data[i + 3] = a;
  }
  mul(x: number, y: number, k: number) {
    const i = this.idx(x, y);
    this.data[i] *= k;
    this.data[i + 1] *= k;
    this.data[i + 2] *= k;
  }
  fill(fn: (x: number, y: number) => RGB, a = 1) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) this.set(x, y, fn(x, y), a);
  }
  forEach(fn: (x: number, y: number) => void) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) fn(x, y);
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 1) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }
  clear() {
    this.data.fill(0);
  }

  // ---- deterministic randomness -------------------------------------------------------------
  /** Per-pixel hash in [0,1). */
  h(x: number, y: number, salt = 0) {
    return hash3(x, y, this.seed * 7 + salt);
  }
  /** Tileable value noise with feature size `s` px (s must divide 16). */
  n(x: number, y: number, s: number, salt = 0) {
    return valueNoise2(x / s, y / s, TEX / s, this.seed + salt * 17);
  }
  /** Tileable fbm with base feature size `s` px. */
  f(x: number, y: number, s: number, oct = 3, salt = 0) {
    return fbm2(x / s, y / s, TEX / s, oct, this.seed + salt * 17);
  }
  /** Stream random for placing features. */
  private streamState = 0;
  r() {
    this.streamState++;
    return hash3(this.streamState, this.seed, 991);
  }
  ri(n: number) {
    return Math.floor(this.r() * n);
  }

  // ---- composite primitives ---------------------------------------------------------------
  /** Dithered noise fill across a ramp. */
  noiseFill(r: RGB[], s: number, grain: number, salt = 0, bias = 0) {
    this.forEach((x, y) => {
      const t = this.f(x, y, s, 3, salt) * (1 - grain) + this.h(x, y, salt + 1) * grain + bias;
      this.set(x, y, pick(r, Math.max(0, Math.min(0.999, (t - 0.5) * 1.35 + 0.5))));
    });
  }

  /** Random walk crack with bevel highlight above it (tileable — wraps around edges). */
  crack(len: number, dark: RGB, light: RGB | null, dir?: [number, number]) {
    let x = this.ri(TEX);
    let y = this.ri(TEX);
    const d = dir ?? [this.r() < 0.5 ? 1 : -1, this.r() < 0.5 ? 1 : 0];
    for (let i = 0; i < len; i++) {
      this.set(x, y, dark);
      if (light && this.get(x, y - 1)[0] !== dark[0]) this.blend(x, y - 1, light, 0.5);
      if (this.r() < 0.55) x += d[0];
      else y += this.r() < 0.5 ? 1 : -1;
      if (d[1] && this.r() < 0.3) y += d[1];
    }
  }

  /** Scatter single pixels of colour c with probability p. */
  speckle(c: RGB, p: number, salt: number, blendT = 1) {
    this.forEach((x, y) => {
      if (this.h(x, y, salt) < p) this.blend(x, y, c, blendT);
    });
  }

  /**
   * Tileable voronoi: returns per-pixel nearest cell index, distance to nearest and the edge distance
   * (second-nearest minus nearest). Useful for gravel, crystals, coral, chicken-wire anhydrite.
   */
  voronoi(count: number, salt = 0): { cell: Int32Array; edge: Float32Array; pts: [number, number][] } {
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([hash3(i, this.seed, 71 + salt) * TEX, hash3(i, this.seed, 113 + salt) * TEX]);
    const cell = new Int32Array(TEX * TEX);
    const edge = new Float32Array(TEX * TEX);
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        let b1 = 1e9;
        let b2 = 1e9;
        let bi = 0;
        for (let i = 0; i < count; i++) {
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const dx = pts[i][0] + ox * TEX - (x + 0.5);
              const dy = pts[i][1] + oy * TEX - (y + 0.5);
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < b1) {
                b2 = b1;
                b1 = d;
                bi = i;
              } else if (d < b2) b2 = d;
            }
        }
        cell[y * TEX + x] = bi;
        edge[y * TEX + x] = b2 - b1;
      }
    return { cell, edge, pts };
  }

  /** Line between two points (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Convert to RGBA8 (with transparent texels' colour bled from neighbours to avoid dark mip fringes). */
  toBytes(out: Uint8Array, offset: number) {
    const d = this.data;
    const bled = new Float32Array(d);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < TEX; y++)
        for (let x = 0; x < TEX; x++) {
          const i = (y * TEX + x) * 4;
          if (d[i + 3] > 0.01) continue;
          let r = 0,
            g = 0,
            b = 0,
            n = 0;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const j = ((((y + oy + TEX) % TEX) * TEX + ((x + ox + TEX) % TEX)) * 4) | 0;
              if (d[j + 3] > 0.01 || (pass > 0 && bled[j + 3] < 0)) {
                r += bled[j];
                g += bled[j + 1];
                b += bled[j + 2];
                n++;
              }
            }
          if (n > 0) {
            bled[i] = r / n;
            bled[i + 1] = g / n;
            bled[i + 2] = b / n;
            bled[i + 3] = -1; // marks "bled" for the next pass
          }
        }
    }
    for (let i = 0; i < TEX * TEX; i++) {
      const s = i * 4;
      const o = offset + s;
      out[o] = Math.max(0, Math.min(255, Math.round(bled[s])));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(bled[s + 1])));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(bled[s + 2])));
      out[o + 3] = Math.max(0, Math.min(255, Math.round(d[s + 3] * 255)));
    }
  }
}
