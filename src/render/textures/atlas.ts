// Builds the block texture array (one 16×16 layer per texture key) and the per-layer property texture.
import * as THREE from 'three';
import { LAYERS, layerProps } from './layers';
import { Pixmap, TEX, rgb, type RGB } from './Pixmap';
import { hashString } from '../util/noise';
import * as N from './paintNatural';
import * as R from './paintRock';
import * as I from './paintIndustrial';
import type { Painter } from './paintNatural';

const PAINTERS: Record<string, Painter> = {
  missing: I.paintMissing,
  bedrock: R.paintBedrock,
  stone: R.paintStone,
  dirt: N.paintDirtTex,
  grass_top: N.paintGrassTop,
  grass_side: N.paintGrassSide,
  sand: N.paintSand,
  gravel: (p, pal) => N.paintGravel(p, pal, 11),
  clay: N.paintClay,
  water: N.paintWater,
  snow: N.paintSnow,
  snow_side: N.paintSnowSide,
  ice: N.paintIce,
  sandstone: R.paintSandstone,
  shale: R.paintShale,
  limestone: R.paintLimestone,
  dolomite: R.paintDolomite,
  salt: R.paintSalt,
  granite: R.paintGranite,
  basalt: R.paintBasalt,
  chalk: R.paintChalk,
  coal_seam: R.paintCoal,
  mudstone: R.paintMudstone,
  oil_sandstone: R.paintOilSandstone,
  oil_limestone: R.paintOilLimestone,
  gas_sandstone: R.paintGasSandstone,
  gas_shale: R.paintGasShale,
  tight_oil_shale: R.paintTightOilShale,
  brine_sandstone: R.paintBrineSandstone,
  caprock: R.paintCaprock,
  log_oak: N.paintLogOak,
  log_oak_top: N.paintLogOakTop,
  leaves_oak: N.paintLeavesOak,
  log_pine: N.paintLogPine,
  log_pine_top: N.paintLogPineTop,
  leaves_pine: N.paintLeavesPine,
  tall_grass: N.paintTallGrass,
  flower_red: N.paintFlowerRed,
  flower_yellow: N.paintFlowerYellow,
  cactus: N.paintCactus,
  cactus_top: N.paintCactusTop,
  dead_bush: N.paintDeadBush,
  red_sand: R.paintRedSand,
  terracotta: R.paintTerracotta,
  podzol_top: N.paintPodzolTop,
  podzol_side: N.paintPodzolSide,
  mud: N.paintMud,
  reeds: N.paintReeds,
  seagrass: N.paintSeagrass,
  mossy_stone: R.paintMossyStone,
  concrete: I.paintConcrete,
  concrete_pad: I.paintConcretePad,
  asphalt: I.paintAsphalt,
  steel_plate: I.paintSteelPlate,
  steel_grate: I.paintSteelGrate,
  brick: I.paintBrick,
  glass: I.paintGlass,
  planks: I.paintPlanks,
  hazard_stripe: I.paintHazard,
  lamp: I.paintLamp,
  gravel_pad: I.paintGravelPad,
  container_top: I.paintContainerTop,
  container_red: (p, pal) => I.paintContainerSide(p, pal),
  container_blue: (p, pal) => I.paintContainerSide(p, pal),
  pipe_oil: I.paintPipeOil,
  pipe_gas: I.paintPipeGas,
  pipe_water: I.paintPipeWater,
  pipe_product: I.paintPipeProduct,
  casing: I.paintCasing,
  oil_pool: I.paintOilPool,
  scorched_earth: N.paintScorched,
  ash: N.paintAsh,
  fire: I.paintFire,
  ore_iron: (p, pal) => R.paintOre(p, pal, [pal[1], rgb(0xd8b08c)]),
  ore_copper: (p, pal) => R.paintOre(p, pal, [pal[1], pal[2]]),
  leaves_autumn: N.paintLeavesAutumn,
  birch_log: N.paintBirchLog,
  birch_log_top: N.paintBirchTop,
  birch_leaves: N.paintLeavesBirch,
  seabed_silt: N.paintSilt,
  coral: N.paintCoral,
  kelp: N.paintKelp,
  permafrost: N.paintPermafrost,
};

/** Fallback for texture keys added to BLOCK_DEFS later: palette-driven stone-like noise. */
const fallback: Painter = (p, pal) => R.paintStoneBase(p, [pal[0], pal[1] ?? pal[0], pal[2] ?? pal[0]], 1);

export interface BlockAtlas {
  texture: THREE.DataArrayTexture;
  /** 256×2 RGBA8: row 0 = (emissive, specular, kind, 0), row 1 = average colour (sRGB). */
  props: THREE.DataTexture;
  layerCount: number;
  /** Average linear-ish sRGB colour per layer (0..1) for overlays / LOD tints. */
  average: Float32Array;
  dispose(): void;
}

export function paintLayer(key: string, palette: number[]): Pixmap {
  const p = new Pixmap(hashString(key) % 100000);
  const pal: RGB[] = palette.length ? palette.map(rgb) : [rgb(0x808080)];
  while (pal.length < 3) pal.push(pal[pal.length - 1]);
  if (key.startsWith('crack_')) {
    const px = new Pixmap(4242);
    I.paintCrack(px, Number(key.slice(6)));
    return px;
  }
  (PAINTERS[key] ?? fallback)(p, pal);
  return p;
}

export function createBlockAtlas(maxAnisotropy: number): BlockAtlas {
  const count = LAYERS.length;
  const bytes = new Uint8Array(TEX * TEX * 4 * count);
  const average = new Float32Array(count * 3);
  const props = new Uint8Array(256 * 2 * 4);
  LAYERS.forEach((layer, i) => {
    const pix = paintLayer(layer.key, layer.source?.palette ?? []);
    pix.toBytes(bytes, i * TEX * TEX * 4);
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let k = 0; k < TEX * TEX; k++) {
      const o = i * TEX * TEX * 4 + k * 4;
      if (bytes[o + 3] < 128) continue;
      r += bytes[o];
      g += bytes[o + 1];
      b += bytes[o + 2];
      n++;
    }
    n = Math.max(1, n);
    average[i * 3] = r / n / 255;
    average[i * 3 + 1] = g / n / 255;
    average[i * 3 + 2] = b / n / 255;
    const lp = layerProps(layer.key);
    props[i * 4] = Math.round(lp.emissive * 255);
    props[i * 4 + 1] = Math.round(lp.specular * 255);
    props[i * 4 + 2] = lp.kind;
    props[i * 4 + 3] = layer.key.startsWith('crack_') ? 255 : 0;
    const o2 = (256 + i) * 4;
    props[o2] = Math.round((r / n));
    props[o2 + 1] = Math.round((g / n));
    props[o2 + 2] = Math.round((b / n));
    props[o2 + 3] = 255;
  });

  const texture = new THREE.DataArrayTexture(bytes, TEX, TEX, count);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(4, maxAnisotropy);
  texture.needsUpdate = true;

  const propTex = new THREE.DataTexture(props, 256, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  propTex.magFilter = THREE.NearestFilter;
  propTex.minFilter = THREE.NearestFilter;
  propTex.generateMipmaps = false;
  propTex.needsUpdate = true;

  return {
    texture,
    props: propTex,
    layerCount: count,
    average,
    dispose() {
      texture.dispose();
      propTex.dispose();
    },
  };
}
