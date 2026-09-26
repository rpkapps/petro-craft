// Analytic minimap colouring (no chunk generation): biome & altitude tint, bathymetry, snow, hill-shading.
import { SEA_LEVEL } from '../core/constants';
import type { IGeology } from '../core/types';
import { lerp } from '../core/rng';
import { BI, BIOME_INDEX, BIOME_RGB } from './biomes';
import { Geology } from './geology';
import { TF, type Terrain } from './terrain';

type RGB = [number, number, number];

const SHALLOW: RGB = [96, 196, 204];
const SHELF: RGB = [44, 128, 186];
const DEEP: RGB = [14, 42, 98];
const LAKE: RGB = [56, 128, 196];
const ICE: RGB = [206, 228, 242];
const SNOW: RGB = [240, 244, 248];
const ROCK: RGB = [128, 124, 120];
const BAD_BANDS: RGB[] = [[196, 104, 62], [176, 122, 92], [206, 146, 96], [160, 86, 56], [214, 166, 120]];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function terrainColor(t: Terrain, x: number, z: number): RGB {
  const i = t.index(x, z);
  const g = t.ground[i];
  const f = t.flags[i];
  const b = t.biome[i];
  const s1 = t.size - 1;
  const gx0 = t.ground[t.index(Math.max(0, x - 1), z)];
  const gx1 = t.ground[t.index(Math.min(s1, x + 1), z)];
  const gz0 = t.ground[t.index(x, Math.max(0, z - 1))];
  const gz1 = t.ground[t.index(x, Math.min(s1, z + 1))];
  const ddx = gx1 - gx0;
  const ddz = gz1 - gz0;

  if (f & TF.WATER) {
    const wd = SEA_LEVEL + 1 - g;
    let c: RGB;
    if (f & TF.OCEAN) c = wd <= 6 ? mix(SHALLOW, SHELF, wd / 6) : wd <= 16 ? SHELF.slice() as RGB : mix(SHELF, DEEP, Math.min(1, (wd - 16) / 26));
    else if (t.temp[i] < 56) c = ICE.slice() as RGB;
    else c = mix(SHALLOW, LAKE, Math.min(1, wd / 4));
    const sh = 1 + (-ddx - ddz) * 0.012;
    return [c[0] * sh, c[1] * sh, c[2] * sh];
  }

  let c: RGB;
  const temp = t.temp[i] / 255;
  const hum = t.humid[i] / 255;
  switch (b) {
    case BI.MOUNTAINS: {
      const snowLine = 110 + ((t.patch[i] - 128) >> 4);
      c = g > snowLine ? SNOW.slice() as RGB : t.slope[i] <= 2 && g < 106 ? [92, 128, 74] : ROCK.slice() as RGB;
      break;
    }
    case BI.BADLANDS:
      c = BAD_BANDS[(g >> 1) % BAD_BANDS.length].slice() as RGB;
      break;
    case BI.TUNDRA:
      c = SNOW.slice() as RGB;
      break;
    case BI.TAIGA:
      c = t.temp[i] < 72 && t.patch[i] < 110 ? [214, 224, 230] : [54, 96, 70];
      break;
    case BI.PLAINS:
    case BI.FOREST:
    case BI.BIRCH:
    case BI.SWAMP: {
      const base = BIOME_RGB[b];
      const dry: RGB = [166, 172, 92];
      c = mix(base as RGB, dry, Math.max(0, (temp - 0.45) * 1.2 - hum * 0.6));
      if ((b === BI.FOREST || b === BI.BIRCH) && t.patch[i] > 196) c = mix(c, [196, 118, 44], 0.55);
      break;
    }
    default:
      c = (BIOME_RGB[b] as RGB).slice() as RGB;
  }
  if (t.slope[i] >= 4 && b !== BI.BADLANDS && b !== BI.TUNDRA) c = mix(c, [132, 122, 108], 0.55);
  const alt = 0.9 + Math.min(0.2, Math.max(-0.1, (g - 70) * 0.0035));
  const shade = Math.min(1.35, Math.max(0.55, 1 + (-ddx - ddz) * 0.075));
  const k = alt * shade;
  return [c[0] * k, c[1] * k, c[2] * k];
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Minimap surface colour at a column (RGB 0..255). Fast & analytic. */
export function mapColor(geology: IGeology, x: number, z: number): [number, number, number] {
  let c: RGB;
  if (geology instanceof Geology) c = terrainColor(geology.terrain, Math.floor(x), Math.floor(z));
  else {
    const wd = geology.waterDepth(x, z);
    c = wd > 0 ? mix(SHELF, DEEP, Math.min(1, wd / 40)) : ((BIOME_RGB[BIOME_INDEX[geology.biomeAt(x, z)]] ?? BIOME_RGB[0]) as RGB).slice() as RGB;
  }
  return [clamp8(c[0]), clamp8(c[1]), clamp8(c[2])];
}

/**
 * Render the whole map (or a downsampled version) into an RGBA buffer, e.g. for a minimap texture:
 * `new ImageData(img.data, img.width, img.height)`.
 */
export function renderMapImage(geology: IGeology, step = 1): { width: number; height: number; data: Uint8ClampedArray } {
  const s = Math.max(1, Math.floor(step));
  const w = Math.ceil(geology.sizeX / s);
  const h = Math.ceil(geology.sizeZ / s);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = mapColor(geology, i * s, j * s);
      const o = (i + j * w) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
