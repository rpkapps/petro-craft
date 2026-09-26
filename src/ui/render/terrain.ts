// Progressive top-down terrain renderer shared by the minimap and the full map.
// Samples the geology (surface height, water depth, biome) into an offscreen canvas over several frames
// (a coarse pass first so something shows immediately), with hill-shading and subtle contours.
import type { BiomeId, IGeology } from '../../core/types';
import { SEA_LEVEL } from '../../core/constants';

const BIOME_RGB: Record<BiomeId, [number, number, number]> = {
  plains: [104, 150, 70], forest: [66, 116, 52], birch_forest: [98, 146, 76], taiga: [70, 104, 78], desert: [214, 192, 136],
  badlands: [184, 108, 62], swamp: [78, 102, 62], tundra: [178, 188, 184], mountains: [132, 130, 124], beach: [220, 204, 146],
  ocean: [40, 92, 150], deep_ocean: [24, 58, 112], river: [58, 120, 186],
};

export class TerrainMap {
  readonly canvas: HTMLCanvasElement;
  readonly res: number;
  readonly scale: number;
  /** Increments whenever new pixels were written (consumers redraw when it changes). */
  version = 0;
  progress = 0;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private heights: Float32Array;
  private pass = 0;
  private row = 0;
  private done = false;

  constructor(private geo: IGeology) {
    const size = Math.max(geo.sizeX, geo.sizeZ);
    this.res = Math.min(512, size);
    this.scale = size / this.res;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.res;
    this.canvas.height = this.res;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.img = this.ctx.createImageData(this.res, this.res);
    this.heights = new Float32Array(this.res * this.res);
    this.ctx.fillStyle = '#0b1016';
    this.ctx.fillRect(0, 0, this.res, this.res);
  }

  get complete() {
    return this.done;
  }

  /** World (block) coordinate → map pixel. */
  toPx(x: number) {
    return x / this.scale;
  }

  /** Render for up to `budgetMs`. Returns true when finished. */
  step(budgetMs: number): boolean {
    if (this.done) return true;
    const t0 = performance.now();
    const res = this.res;
    const coarse = this.pass === 0 ? 4 : 1;
    let wrote = false;
    while (performance.now() - t0 < budgetMs) {
      if (this.row >= res) {
        if (this.pass === 0) {
          this.pass = 1;
          this.row = 0;
          continue;
        }
        this.done = true;
        break;
      }
      const z = this.row;
      if (coarse > 1 && z % coarse !== 0) {
        this.row++;
        continue;
      }
      for (let x = 0; x < res; x += coarse) this.sample(x, z, coarse);
      this.row++;
      wrote = true;
    }
    if (wrote) {
      this.ctx.putImageData(this.img, 0, 0);
      this.version++;
    }
    this.progress = this.pass === 0 ? (this.row / res) * 0.25 : 0.25 + (this.row / res) * 0.75;
    if (this.done) this.progress = 1;
    return this.done;
  }

  private sample(px: number, pz: number, block: number) {
    const g = this.geo;
    const res = this.res;
    const wx = Math.min(g.sizeX - 1, Math.floor((px + 0.5) * this.scale));
    const wz = Math.min(g.sizeZ - 1, Math.floor((pz + 0.5) * this.scale));
    let hgt = SEA_LEVEL;
    let wd = 0;
    let biome: BiomeId = 'plains';
    try {
      hgt = g.surfaceHeight(wx, wz);
      wd = g.waterDepth(wx, wz);
      biome = g.biomeAt(wx, wz);
    } catch {
      /* geology not ready */
    }
    this.heights[pz * res + px] = hgt;
    const hl = px >= block ? this.heights[pz * res + px - block] : hgt;
    const hu = pz >= block ? this.heights[(pz - block) * res + px] : hgt;
    let r: number;
    let gg: number;
    let b: number;
    if (wd > 0) {
      const t = Math.min(1, wd / 28);
      r = 52 + (12 - 52) * t;
      gg = 132 + (44 - 132) * t;
      b = 190 + (92 - 190) * t;
      // shoreline foam
      if (wd <= 1) { r += 30; gg += 30; b += 20; }
    } else {
      const c = BIOME_RGB[biome] ?? BIOME_RGB.plains;
      r = c[0];
      gg = c[1];
      b = c[2];
      const elev = Math.max(0, Math.min(1, (hgt - SEA_LEVEL) / 60));
      const lift = 1 + elev * 0.28;
      r *= lift;
      gg *= lift;
      b *= lift;
      if (hgt > SEA_LEVEL + 48) {
        const snow = Math.min(1, (hgt - SEA_LEVEL - 48) / 10);
        r += (238 - r) * snow;
        gg += (242 - gg) * snow;
        b += (246 - b) * snow;
      }
      const shade = Math.max(0.62, Math.min(1.38, 1 + ((hgt - hl) + (hgt - hu)) * 0.09 / Math.max(1, block * this.scale * 0.5)));
      r *= shade;
      gg *= shade;
      b *= shade;
      if (Math.floor(hgt / 6) !== Math.floor(hl / 6) || Math.floor(hgt / 6) !== Math.floor(hu / 6)) {
        r *= 0.86;
        gg *= 0.86;
        b *= 0.86;
      }
    }
    const d = this.img.data;
    const R = Math.max(0, Math.min(255, r)) | 0;
    const G = Math.max(0, Math.min(255, gg)) | 0;
    const B = Math.max(0, Math.min(255, b)) | 0;
    for (let dz = 0; dz < block && pz + dz < res; dz++)
      for (let dx = 0; dx < block && px + dx < res; dx++) {
        const i = ((pz + dz) * res + px + dx) * 4;
        d[i] = R;
        d[i + 1] = G;
        d[i + 2] = B;
        d[i + 3] = 255;
      }
  }
}

const cache = new WeakMap<IGeology, TerrainMap>();
const active = new Set<TerrainMap>();

export function terrainFor(geo: IGeology): TerrainMap {
  let t = cache.get(geo);
  if (!t) {
    t = new TerrainMap(geo);
    cache.set(geo, t);
    active.add(t);
  }
  return t;
}

/** Advance all in-progress terrain renders (called once per frame by the UI). */
export function pumpTerrain(budgetMs = 4) {
  for (const t of active) {
    if (t.step(budgetMs)) active.delete(t);
    break;
  }
}
