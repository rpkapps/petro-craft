// Per-layer shading properties used only by the HD texture qualities (packed into rows 2–3 of the
// layer-properties texture, see atlas.ts). Pure, worker-safe.

export const BOMB_NONE = 0;
/** Random per-block texture offset on every face. */
export const BOMB_OFFSET = 1;
/** Random offset + 90° rotations on horizontal faces (isotropic natural materials). */
export const BOMB_ROTATE = 2;
/** Offset along u only (layered rocks: beds stay continuous across neighbouring blocks). */
export const BOMB_STRATA = 3;

export interface HDLayerProps {
  bomb: number;
  /** Parallax depth of the full height range, in blocks (0 = no parallax). */
  pom: number;
  /** Micro-facet glints (snow, ice, salt, quartz). */
  sparkle: number;
  /** How much the surface darkens / gets glossy when wet (0..1). */
  porosity: number;
  /** Metalness 0..1. */
  metal: number;
  /** Light transmission for thin foliage (back-lighting) 0..1. */
  translucency: number;
  /** Macro (world-space) tint variation 0..1. */
  macro: number;
}

const ROCK = new Set(['stone', 'bedrock', 'granite', 'basalt', 'dolomite', 'chalk', 'caprock', 'mossy_stone', 'ore_iron', 'ore_copper', 'salt']);
const STRATA = new Set(['sandstone', 'shale', 'limestone', 'mudstone', 'coal_seam', 'oil_sandstone', 'oil_limestone', 'gas_sandstone', 'gas_shale', 'tight_oil_shale', 'brine_sandstone', 'terracotta']);
const SOIL = new Set(['dirt', 'mud', 'clay', 'sand', 'red_sand', 'gravel', 'gravel_pad', 'seabed_silt', 'scorched_earth', 'ash', 'snow', 'permafrost', 'podzol_top', 'grass_top']);

export function hdLayerProps(key: string): HDLayerProps {
  const p: HDLayerProps = { bomb: BOMB_NONE, pom: 0, sparkle: 0, porosity: 0, metal: 0, translucency: 0, macro: 0 };
  if (ROCK.has(key)) Object.assign(p, { bomb: BOMB_ROTATE, pom: 0.07, porosity: 0.6, macro: 0.8 });
  if (STRATA.has(key)) Object.assign(p, { bomb: BOMB_STRATA, pom: 0.06, porosity: 0.7, macro: 0.7 });
  if (SOIL.has(key)) Object.assign(p, { bomb: BOMB_ROTATE, pom: 0.05, porosity: 0.9, macro: 1 });
  switch (key) {
    case 'gravel':
    case 'gravel_pad':
      p.pom = 0.08;
      break;
    case 'sand':
    case 'red_sand':
    case 'seabed_silt':
      p.pom = 0.035;
      break;
    case 'grass_top':
      p.pom = 0.04;
      p.translucency = 0.35;
      break;
    case 'snow':
      p.pom = 0.03;
      p.sparkle = 1;
      p.porosity = 0;
      break;
    case 'salt':
    case 'granite':
      p.sparkle = 0.5;
      break;
    case 'ice':
      p.sparkle = 0.6;
      break;
    case 'brick':
      Object.assign(p, { pom: 0.05, porosity: 0.7, macro: 0.4 });
      break;
    case 'planks':
      Object.assign(p, { pom: 0.03, porosity: 0.6, macro: 0.3 });
      break;
    case 'concrete':
    case 'concrete_pad':
      Object.assign(p, { bomb: BOMB_OFFSET, pom: 0.025, porosity: 0.7, macro: 0.6 });
      break;
    case 'asphalt':
      Object.assign(p, { pom: 0.02, porosity: 0.8, macro: 0.5 });
      break;
    case 'steel_plate':
      Object.assign(p, { pom: 0.015, metal: 0.6, porosity: 0.2 });
      break;
    case 'steel_grate':
      Object.assign(p, { metal: 0.7, porosity: 0.2 });
      break;
    case 'container_red':
    case 'container_blue':
    case 'container_top':
      Object.assign(p, { pom: 0.05, porosity: 0.2, metal: 0.2 });
      break;
    case 'casing':
      Object.assign(p, { metal: 0.8, porosity: 0.1 });
      break;
    case 'hazard_stripe':
      Object.assign(p, { pom: 0.01, porosity: 0.3 });
      break;
    case 'grass_side':
    case 'podzol_side':
    case 'snow_side':
      Object.assign(p, { pom: 0.04, porosity: 0.8, macro: 0.8 });
      break;
    case 'log_oak':
    case 'log_pine':
    case 'birch_log':
      Object.assign(p, { pom: 0.07, porosity: 0.6, macro: 0.3 });
      break;
    case 'log_oak_top':
    case 'log_pine_top':
    case 'birch_log_top':
      Object.assign(p, { pom: 0.02, porosity: 0.5 });
      break;
    case 'coral':
      Object.assign(p, { pom: 0.06, porosity: 0.3 });
      break;
    case 'cactus':
      Object.assign(p, { pom: 0.04, translucency: 0.2 });
      break;
    default:
      break;
  }
  if (key.startsWith('leaves') || key.endsWith('_leaves')) Object.assign(p, { translucency: 0.8, porosity: 0.3, macro: 0.6 });
  if (['tall_grass', 'reeds', 'seagrass', 'kelp', 'flower_red', 'flower_yellow', 'dead_bush'].includes(key)) Object.assign(p, { translucency: 0.7, macro: 0.5 });
  return p;
}
