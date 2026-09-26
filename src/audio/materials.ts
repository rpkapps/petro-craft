// Block id → acoustic material, and material → sound names for footsteps / breaking / placing / hitting.
import { B, BLOCKS } from '../core/blocks';

export type Material =
  | 'grass' | 'dirt' | 'mud' | 'sand' | 'gravel' | 'stone' | 'concrete' | 'wood' | 'metal' | 'pipe'
  | 'snow' | 'ice' | 'glass' | 'leaves' | 'water' | 'oil';

const TABLE = new Array<Material>(256).fill('stone');
const set = (m: Material, ...ids: number[]) => ids.forEach((id) => (TABLE[id] = m));

set('grass', B.GRASS, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.PODZOL, B.REEDS, B.DEAD_BUSH, B.SEAGRASS, B.KELP, B.CACTUS);
set('dirt', B.DIRT, B.CLAY, B.SCORCHED_EARTH, B.ASH, B.PERMAFROST);
set('mud', B.MUD, B.SEABED_SILT);
set('sand', B.SAND, B.RED_SAND);
set('gravel', B.GRAVEL, B.GRAVEL_PAD);
set('concrete', B.CONCRETE, B.CONCRETE_PAD, B.ASPHALT_ROAD, B.HAZARD_STRIPE, B.BRICK);
set('wood', B.LOG_OAK, B.LOG_PINE, B.BIRCH_LOG, B.PLANKS);
set('metal', B.STEEL_PLATE, B.STEEL_GRATE, B.CONTAINER_RED, B.CONTAINER_BLUE, B.LAMP, B.STRUCTURE);
set('pipe', B.PIPE_OIL, B.PIPE_GAS, B.PIPE_WATER, B.PIPE_PRODUCT, B.CASING);
set('snow', B.SNOW);
set('ice', B.ICE);
set('glass', B.GLASS);
set('leaves', B.LEAVES_OAK, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LEAVES);
set('water', B.WATER);
set('oil', B.OIL_POOL);
set('stone', B.CORAL, B.FIRE);

export function materialOf(id: number): Material {
  const i = id | 0;
  if (i < 0 || i > 255) return 'stone';
  // unknown ids: guess from block definition
  if (!BLOCKS[i] || BLOCKS[i].key.startsWith('unknown_')) return 'stone';
  return TABLE[i];
}

const FOOT: Record<Material, string> = {
  grass: 'footstep_grass', dirt: 'footstep_dirt', mud: 'footstep_mud', sand: 'footstep_sand', gravel: 'footstep_gravel',
  stone: 'footstep_stone', concrete: 'footstep_concrete', wood: 'footstep_wood', metal: 'footstep_metal', pipe: 'footstep_metal',
  snow: 'footstep_snow', ice: 'footstep_concrete', glass: 'footstep_concrete', leaves: 'footstep_grass', water: 'footstep_water',
  oil: 'footstep_mud',
};

const BREAK: Record<Material, string> = {
  grass: 'break_grass', dirt: 'break_dirt', mud: 'break_dirt', sand: 'break_sand', gravel: 'break_gravel',
  stone: 'break_stone', concrete: 'break_stone', wood: 'break_wood', metal: 'break_metal', pipe: 'break_metal',
  snow: 'break_snow', ice: 'break_glass', glass: 'break_glass', leaves: 'break_leaves', water: 'splash', oil: 'splash',
};

const PLACE: Record<Material, string> = {
  grass: 'place_dirt', dirt: 'place_dirt', mud: 'place_dirt', sand: 'place_sand', gravel: 'place_sand',
  stone: 'place_stone', concrete: 'place_stone', wood: 'place_wood', metal: 'place_metal', pipe: 'place_pipe',
  snow: 'place_sand', ice: 'place_glass', glass: 'place_glass', leaves: 'break_leaves', water: 'splash', oil: 'splash',
};

export const footstepSound = (id: number) => FOOT[materialOf(id)];
export const breakSound = (id: number) => BREAK[materialOf(id)];
export const placeSound = (id: number) => PLACE[materialOf(id)];
/** Tool-hit (mining progress) tick: the place sound played quieter & brighter. */
export const hitSound = (id: number) => PLACE[materialOf(id)];
