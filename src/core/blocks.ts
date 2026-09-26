// Block registry. Block ids are stored as Uint8 in chunk data — NEVER renumber existing ids (breaks saves).
// Textures are generated procedurally by the render engine from the `tex` keys + `palette` hints.

export type BlockShape =
  | 'cube' // full opaque/transparent cube
  | 'cross' // two crossed quads (grass tufts, flowers, shrubs)
  | 'liquid' // water / oil surface (rendered in liquid pass, slightly lowered top)
  | 'pipe' // industrial pipe: center hub + arms toward connectable neighbours
  | 'slab' // bottom half block (roads, pads)
  | 'none'; // invisible (air, structure-occupancy)

export type ToolClass = 'hand' | 'pickaxe' | 'shovel' | 'axe' | 'none';

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  shape: BlockShape;
  /** Collides with the player. */
  solid: boolean;
  /** Light passes / neighbours' faces are drawn against this block. */
  transparent: boolean;
  /** Seconds to break with the right tool at tier 1. Infinity = unbreakable. */
  hardness: number;
  tool: ToolClass;
  /** Texture keys: top / side / bottom. The engine paints each key procedurally. */
  tex: { top: string; side: string; bottom: string };
  /** Base colours (hex) used by the procedural texture painter for the tex keys. */
  palette: number[];
  /** Emits light (0..15). */
  light?: number;
  /** Item dropped when broken (item id). Undefined => drops itself ("block:<key>"). null => nothing. */
  drops?: string | null;
  /** Pipe-network category for 'pipe' shape blocks. */
  pipe?: 'oil' | 'gas' | 'water' | 'product' | 'casing';
  /** Geological rock (used for drilling hardness & seismic impedance). */
  rock?: boolean;
  /** Hydrocarbon-bearing (reveals a reservoir when dug into). */
  hydrocarbon?: 'oil' | 'gas';
  /** Can be placed by players from inventory. */
  placeable?: boolean;
  /** Wind-sway / animated in shader. */
  sway?: boolean;
}

// ---- Block id table ---------------------------------------------------------------------------
export const B = {
  AIR: 0,
  STRUCTURE: 1, // invisible solid occupancy for multi-block buildings (entity rendered separately)
  BEDROCK: 2,
  STONE: 3,
  DIRT: 4,
  GRASS: 5,
  SAND: 6,
  GRAVEL: 7,
  CLAY: 8,
  WATER: 9,
  SNOW: 10,
  ICE: 11,
  // strata
  SANDSTONE: 12,
  SHALE: 13,
  LIMESTONE: 14,
  DOLOMITE: 15,
  SALT: 16,
  GRANITE: 17,
  BASALT: 18,
  CHALK: 19,
  COAL_SEAM: 20,
  MUDSTONE: 21,
  // hydrocarbon-bearing rocks
  OIL_SANDSTONE: 22,
  OIL_LIMESTONE: 23,
  GAS_SANDSTONE: 24,
  GAS_SHALE: 25,
  TIGHT_OIL_SHALE: 26,
  BRINE_SANDSTONE: 27, // aquifer
  CAPROCK: 28, // anhydrite seal
  // surface & nature
  LOG_OAK: 29,
  LEAVES_OAK: 30,
  LOG_PINE: 31,
  LEAVES_PINE: 32,
  TALL_GRASS: 33,
  FLOWER_RED: 34,
  FLOWER_YELLOW: 35,
  CACTUS: 36,
  DEAD_BUSH: 37,
  RED_SAND: 38,
  TERRACOTTA: 39,
  PODZOL: 40,
  MUD: 41,
  REEDS: 42,
  SEAGRASS: 43,
  MOSSY_STONE: 44,
  // player / industrial building blocks
  CONCRETE: 45,
  CONCRETE_PAD: 46, // slab foundation auto-placed under buildings
  ASPHALT_ROAD: 47,
  STEEL_PLATE: 48,
  STEEL_GRATE: 49,
  BRICK: 50,
  GLASS: 51,
  PLANKS: 52,
  HAZARD_STRIPE: 53,
  LAMP: 54,
  GRAVEL_PAD: 55,
  CONTAINER_RED: 56,
  CONTAINER_BLUE: 57,
  // pipes (connect to same-category pipes and adjacent buildings)
  PIPE_OIL: 58,
  PIPE_GAS: 59,
  PIPE_WATER: 60,
  PIPE_PRODUCT: 61,
  CASING: 62, // wellbore casing (vertical steel column written by drilling system)
  // hazards
  OIL_POOL: 63, // spilled crude (liquid shape, dark)
  SCORCHED_EARTH: 64,
  ASH: 65,
  FIRE: 66, // visual fire block (emissive, non-solid)
  ORE_IRON: 67,
  ORE_COPPER: 68,
  LEAVES_AUTUMN: 69,
  BIRCH_LOG: 70,
  BIRCH_LEAVES: 71,
  SEABED_SILT: 72,
  CORAL: 73,
  KELP: 74,
  PERMAFROST: 75,
} as const;
export type BlockId = (typeof B)[keyof typeof B];

const T = (all: string) => ({ top: all, side: all, bottom: all });
const cube = (
  id: number, key: string, name: string, tex: BlockDef['tex'], palette: number[], hardness: number, tool: ToolClass,
  extra: Partial<BlockDef> = {},
): BlockDef => ({ id, key, name, shape: 'cube', solid: true, transparent: false, hardness, tool, tex, palette, placeable: true, ...extra });

export const BLOCK_DEFS: BlockDef[] = [
  { id: B.AIR, key: 'air', name: 'Air', shape: 'none', solid: false, transparent: true, hardness: 0, tool: 'none', tex: T('none'), palette: [0], drops: null },
  { id: B.STRUCTURE, key: 'structure', name: 'Structure', shape: 'none', solid: true, transparent: true, hardness: Infinity, tool: 'none', tex: T('none'), palette: [0], drops: null },
  cube(B.BEDROCK, 'bedrock', 'Bedrock', T('bedrock'), [0x2b2b2e, 0x4a4a4f, 0x151517], Infinity, 'none', { drops: null, placeable: false }),
  cube(B.STONE, 'stone', 'Stone', T('stone'), [0x7d7d80, 0x6a6a6d, 0x8e8e91], 1.5, 'pickaxe', { rock: true }),
  cube(B.DIRT, 'dirt', 'Dirt', T('dirt'), [0x7a5536, 0x6b4a2f, 0x8b6442], 0.5, 'shovel'),
  cube(B.GRASS, 'grass', 'Grass', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, [0x5fa83a, 0x4e9430, 0x7a5536], 0.6, 'shovel', { drops: 'block:dirt' }),
  cube(B.SAND, 'sand', 'Sand', T('sand'), [0xdccb8e, 0xd2bf7f, 0xe6d8a0], 0.5, 'shovel'),
  cube(B.GRAVEL, 'gravel', 'Gravel', T('gravel'), [0x8a8580, 0x6e6a66, 0xa39e98], 0.6, 'shovel'),
  cube(B.CLAY, 'clay', 'Clay', T('clay'), [0x9ea4b0, 0x8f95a1, 0xadb3bf], 0.6, 'shovel'),
  { id: B.WATER, key: 'water', name: 'Water', shape: 'liquid', solid: false, transparent: true, hardness: Infinity, tool: 'none', tex: T('water'), palette: [0x2a6fb8, 0x3d85cf], drops: null },
  cube(B.SNOW, 'snow', 'Snow', { top: 'snow', side: 'snow_side', bottom: 'dirt' }, [0xf4f8fb, 0xe3ebf2, 0x7a5536], 0.3, 'shovel'),
  cube(B.ICE, 'ice', 'Ice', T('ice'), [0xa8d4f5, 0x8fc2ec], 0.5, 'pickaxe', { transparent: true }),
  cube(B.SANDSTONE, 'sandstone', 'Sandstone', T('sandstone'), [0xcdb27a, 0xbfa36b, 0xd9c08c], 1.2, 'pickaxe', { rock: true }),
  cube(B.SHALE, 'shale', 'Shale', T('shale'), [0x4b4f55, 0x3e4247, 0x5a5f66], 1.6, 'pickaxe', { rock: true }),
  cube(B.LIMESTONE, 'limestone', 'Limestone', T('limestone'), [0xc9c3ae, 0xb8b29c, 0xd7d2bf], 1.8, 'pickaxe', { rock: true }),
  cube(B.DOLOMITE, 'dolomite', 'Dolomite', T('dolomite'), [0xb9a99a, 0xa8988a, 0xc8baad], 2.0, 'pickaxe', { rock: true }),
  cube(B.SALT, 'salt', 'Rock Salt', T('salt'), [0xe8e2e6, 0xd8cfd5, 0xf3eff1], 1.2, 'pickaxe', { rock: true }),
  cube(B.GRANITE, 'granite', 'Granite', T('granite'), [0x9c6f63, 0x7f5a50, 0xb58a7d], 3.0, 'pickaxe', { rock: true }),
  cube(B.BASALT, 'basalt', 'Basalt', T('basalt'), [0x3a3a40, 0x2c2c31, 0x4a4a52], 3.2, 'pickaxe', { rock: true }),
  cube(B.CHALK, 'chalk', 'Chalk', T('chalk'), [0xeeeade, 0xdfdacb], 1.0, 'pickaxe', { rock: true }),
  cube(B.COAL_SEAM, 'coal_seam', 'Coal Seam', T('coal_seam'), [0x2a2a2a, 0x1a1a1a, 0x3c3c3c], 1.6, 'pickaxe', { rock: true }),
  cube(B.MUDSTONE, 'mudstone', 'Mudstone', T('mudstone'), [0x6d5d4f, 0x5e4f42, 0x7c6b5c], 1.4, 'pickaxe', { rock: true }),
  cube(B.OIL_SANDSTONE, 'oil_sandstone', 'Oil-Saturated Sandstone', T('oil_sandstone'), [0x4a3a22, 0x2e2415, 0x6b5530], 1.2, 'pickaxe', { rock: true, hydrocarbon: 'oil' }),
  cube(B.OIL_LIMESTONE, 'oil_limestone', 'Oil-Bearing Limestone', T('oil_limestone'), [0x6e6450, 0x3f372a, 0x877c66], 1.8, 'pickaxe', { rock: true, hydrocarbon: 'oil' }),
  cube(B.GAS_SANDSTONE, 'gas_sandstone', 'Gas-Charged Sandstone', T('gas_sandstone'), [0xb9b08a, 0x9fb0b8, 0xcfc59c], 1.2, 'pickaxe', { rock: true, hydrocarbon: 'gas' }),
  cube(B.GAS_SHALE, 'gas_shale', 'Gas Shale', T('gas_shale'), [0x3b4450, 0x2d343d, 0x566476], 1.7, 'pickaxe', { rock: true, hydrocarbon: 'gas' }),
  cube(B.TIGHT_OIL_SHALE, 'tight_oil_shale', 'Tight Oil Shale', T('tight_oil_shale'), [0x35302a, 0x241f1a, 0x4a4238], 1.8, 'pickaxe', { rock: true, hydrocarbon: 'oil' }),
  cube(B.BRINE_SANDSTONE, 'brine_sandstone', 'Water-Bearing Sandstone', T('brine_sandstone'), [0x9aa7a0, 0x7f938c, 0xb0bcb5], 1.2, 'pickaxe', { rock: true }),
  cube(B.CAPROCK, 'caprock', 'Anhydrite Caprock', T('caprock'), [0xd6d0c8, 0xc4bdb4, 0xe6e1da], 2.2, 'pickaxe', { rock: true }),
  cube(B.LOG_OAK, 'log_oak', 'Oak Log', { top: 'log_oak_top', side: 'log_oak', bottom: 'log_oak_top' }, [0x6b4f2e, 0x54391f, 0xa98458], 1.0, 'axe'),
  cube(B.LEAVES_OAK, 'leaves_oak', 'Oak Leaves', T('leaves_oak'), [0x3f8a2c, 0x2f6e20, 0x4f9e38], 0.2, 'hand', { transparent: true, drops: null, sway: true }),
  cube(B.LOG_PINE, 'log_pine', 'Pine Log', { top: 'log_pine_top', side: 'log_pine', bottom: 'log_pine_top' }, [0x4a3421, 0x3a2716, 0x8f7250], 1.0, 'axe'),
  cube(B.LEAVES_PINE, 'leaves_pine', 'Pine Needles', T('leaves_pine'), [0x2c5a35, 0x1f4527, 0x3a6d43], 0.2, 'hand', { transparent: true, drops: null, sway: true }),
  { id: B.TALL_GRASS, key: 'tall_grass', name: 'Tall Grass', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('tall_grass'), palette: [0x5fa83a, 0x4e9430], drops: null, sway: true },
  { id: B.FLOWER_RED, key: 'flower_red', name: 'Poppy', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('flower_red'), palette: [0xd83a2a, 0x3f8a2c], sway: true, placeable: true },
  { id: B.FLOWER_YELLOW, key: 'flower_yellow', name: 'Dandelion', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('flower_yellow'), palette: [0xf2cf2a, 0x3f8a2c], sway: true, placeable: true },
  cube(B.CACTUS, 'cactus', 'Cactus', { top: 'cactus_top', side: 'cactus', bottom: 'cactus_top' }, [0x3f7d34, 0x2e6327, 0x5a9a4c], 0.4, 'hand'),
  { id: B.DEAD_BUSH, key: 'dead_bush', name: 'Dead Bush', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('dead_bush'), palette: [0x8a6a3a, 0x6b5030], drops: null, sway: true },
  cube(B.RED_SAND, 'red_sand', 'Red Sand', T('red_sand'), [0xc2672e, 0xae5a26, 0xd07a3e], 0.5, 'shovel'),
  cube(B.TERRACOTTA, 'terracotta', 'Terracotta', T('terracotta'), [0xa0543a, 0x8e4a33, 0xb9684c], 1.3, 'pickaxe', { rock: true }),
  cube(B.PODZOL, 'podzol', 'Podzol', { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' }, [0x5a3f22, 0x4a3319, 0x7a5536], 0.5, 'shovel', { drops: 'block:dirt' }),
  cube(B.MUD, 'mud', 'Mud', T('mud'), [0x3d342d, 0x322a24, 0x4a3f37], 0.5, 'shovel'),
  { id: B.REEDS, key: 'reeds', name: 'Reeds', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('reeds'), palette: [0x7ea24a, 0x5d7d35], drops: null, sway: true },
  { id: B.SEAGRASS, key: 'seagrass', name: 'Seagrass', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('seagrass'), palette: [0x2f7d4a, 0x1f5e35], drops: null, sway: true },
  cube(B.MOSSY_STONE, 'mossy_stone', 'Mossy Stone', T('mossy_stone'), [0x6f7d63, 0x5a6a4e, 0x7d7d80], 1.5, 'pickaxe', { rock: true }),
  cube(B.CONCRETE, 'concrete', 'Concrete', T('concrete'), [0xb4b4b0, 0xa4a4a0, 0xc2c2be], 2.0, 'pickaxe'),
  { ...cube(B.CONCRETE_PAD, 'concrete_pad', 'Concrete Pad', T('concrete_pad'), [0x9d9d98, 0x8c8c87], 2.0, 'pickaxe'), shape: 'cube' },
  { ...cube(B.ASPHALT_ROAD, 'asphalt_road', 'Asphalt Road', { top: 'asphalt', side: 'asphalt', bottom: 'gravel' }, [0x2e2f31, 0x26272a, 0xe8c547], 1.5, 'pickaxe') },
  cube(B.STEEL_PLATE, 'steel_plate', 'Steel Plate', T('steel_plate'), [0x8b9299, 0x747b82, 0xa2a9b0], 3.0, 'pickaxe'),
  cube(B.STEEL_GRATE, 'steel_grate', 'Steel Grating', T('steel_grate'), [0x5d646b, 0x3c4146], 2.0, 'pickaxe', { transparent: true }),
  cube(B.BRICK, 'brick', 'Brick', T('brick'), [0x9a4a36, 0x7f3b2b, 0xc8c0b0], 2.0, 'pickaxe'),
  cube(B.GLASS, 'glass', 'Glass', T('glass'), [0xcfe8f2, 0xffffff], 0.3, 'hand', { transparent: true, drops: null }),
  cube(B.PLANKS, 'planks', 'Planks', T('planks'), [0xa3794a, 0x8c663d, 0xb88b58], 1.0, 'axe'),
  cube(B.HAZARD_STRIPE, 'hazard_stripe', 'Hazard Stripe', T('hazard_stripe'), [0xf2c12e, 0x1d1d1d], 2.0, 'pickaxe'),
  cube(B.LAMP, 'lamp', 'Industrial Lamp', T('lamp'), [0xffe7a8, 0xffcf66, 0x5d646b], 0.5, 'pickaxe', { light: 15 }),
  cube(B.GRAVEL_PAD, 'gravel_pad', 'Gravel Pad', T('gravel_pad'), [0x9a948c, 0x857f78, 0xada79f], 0.6, 'shovel'),
  cube(B.CONTAINER_RED, 'container_red', 'Shipping Container (Red)', { top: 'container_top', side: 'container_red', bottom: 'container_top' }, [0xa3342a, 0x82281f, 0x6b6b6b], 2.5, 'pickaxe'),
  cube(B.CONTAINER_BLUE, 'container_blue', 'Shipping Container (Blue)', { top: 'container_top', side: 'container_blue', bottom: 'container_top' }, [0x2a5aa3, 0x1f4582, 0x6b6b6b], 2.5, 'pickaxe'),
  { id: B.PIPE_OIL, key: 'pipe_oil', name: 'Crude Pipeline', shape: 'pipe', solid: true, transparent: true, hardness: 1.0, tool: 'pickaxe', tex: T('pipe_oil'), palette: [0x2b2b2b, 0x4a4a4a, 0xf2a31e], pipe: 'oil', placeable: true },
  { id: B.PIPE_GAS, key: 'pipe_gas', name: 'Gas Pipeline', shape: 'pipe', solid: true, transparent: true, hardness: 1.0, tool: 'pickaxe', tex: T('pipe_gas'), palette: [0xe8d23a, 0xc9b52c, 0x444444], pipe: 'gas', placeable: true },
  { id: B.PIPE_WATER, key: 'pipe_water', name: 'Water Line', shape: 'pipe', solid: true, transparent: true, hardness: 1.0, tool: 'pickaxe', tex: T('pipe_water'), palette: [0x2f79c9, 0x255f9e, 0xdddddd], pipe: 'water', placeable: true },
  { id: B.PIPE_PRODUCT, key: 'pipe_product', name: 'Product Pipeline', shape: 'pipe', solid: true, transparent: true, hardness: 1.0, tool: 'pickaxe', tex: T('pipe_product'), palette: [0x3e9e5a, 0x2e7a45, 0xdddddd], pipe: 'product', placeable: true },
  { id: B.CASING, key: 'casing', name: 'Well Casing', shape: 'pipe', solid: true, transparent: true, hardness: Infinity, tool: 'none', tex: T('casing'), palette: [0x9aa1a8, 0x6d747b], pipe: 'casing', drops: null },
  { id: B.OIL_POOL, key: 'oil_pool', name: 'Crude Spill', shape: 'liquid', solid: false, transparent: true, hardness: 0.3, tool: 'shovel', tex: T('oil_pool'), palette: [0x0e0c0a, 0x2a2118, 0x4a3a28], drops: null },
  cube(B.SCORCHED_EARTH, 'scorched_earth', 'Scorched Earth', T('scorched_earth'), [0x2c2622, 0x1c1815, 0x3d342e], 0.6, 'shovel', { drops: 'block:dirt' }),
  cube(B.ASH, 'ash', 'Ash', T('ash'), [0x5a5a5a, 0x484848, 0x6e6e6e], 0.3, 'shovel', { drops: null }),
  { id: B.FIRE, key: 'fire', name: 'Fire', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('fire'), palette: [0xffb02e, 0xff5a1f, 0xfff08a], light: 15, drops: null },
  cube(B.ORE_IRON, 'ore_iron', 'Iron Ore', T('ore_iron'), [0x7d7d80, 0xc9a27e, 0x6a6a6d], 2.5, 'pickaxe', { rock: true }),
  cube(B.ORE_COPPER, 'ore_copper', 'Copper Ore', T('ore_copper'), [0x7d7d80, 0x3fa38a, 0xc8743a], 2.5, 'pickaxe', { rock: true }),
  cube(B.LEAVES_AUTUMN, 'leaves_autumn', 'Autumn Leaves', T('leaves_autumn'), [0xd07a2a, 0xb85a1f, 0xe6a23a], 0.2, 'hand', { transparent: true, drops: null, sway: true }),
  cube(B.BIRCH_LOG, 'birch_log', 'Birch Log', { top: 'birch_log_top', side: 'birch_log', bottom: 'birch_log_top' }, [0xe8e4d8, 0x2a2a2a, 0xc9b58f], 1.0, 'axe'),
  cube(B.BIRCH_LEAVES, 'birch_leaves', 'Birch Leaves', T('birch_leaves'), [0x7fae4a, 0x6a9a3a, 0x93c25a], 0.2, 'hand', { transparent: true, drops: null, sway: true }),
  cube(B.SEABED_SILT, 'seabed_silt', 'Seabed Silt', T('seabed_silt'), [0x6f6a55, 0x5d5946, 0x817c66], 0.5, 'shovel'),
  cube(B.CORAL, 'coral', 'Coral', T('coral'), [0xe0607a, 0xf28a4a, 0xb04ad0], 0.5, 'pickaxe'),
  { id: B.KELP, key: 'kelp', name: 'Kelp', shape: 'cross', solid: false, transparent: true, hardness: 0, tool: 'hand', tex: T('kelp'), palette: [0x3a7a3a, 0x2a5a2a], drops: null, sway: true },
  cube(B.PERMAFROST, 'permafrost', 'Permafrost', T('permafrost'), [0x6d6a66, 0xcfdde8, 0x55524e], 1.2, 'pickaxe'),
];

/** Dense lookup by id (index = block id). */
export const BLOCKS: BlockDef[] = (() => {
  const arr: BlockDef[] = [];
  for (const d of BLOCK_DEFS) arr[d.id] = d;
  for (let i = 0; i < 256; i++) if (!arr[i]) arr[i] = { ...BLOCK_DEFS[0], id: i, key: `unknown_${i}` };
  return arr;
})();

export const BLOCK_BY_KEY: Record<string, BlockDef> = Object.fromEntries(BLOCK_DEFS.map((d) => [d.key, d]));

/** Fast property tables for hot loops (meshing, physics). */
export const IS_SOLID = new Uint8Array(256);
export const IS_TRANSPARENT = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const IS_OPAQUE_CUBE = new Uint8Array(256);
for (const d of BLOCKS) {
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  IS_TRANSPARENT[d.id] = d.transparent ? 1 : 0;
  IS_LIQUID[d.id] = d.shape === 'liquid' ? 1 : 0;
  IS_OPAQUE_CUBE[d.id] = d.shape === 'cube' && !d.transparent ? 1 : 0;
}

/** Inventory item id for a block. */
export const blockItemId = (id: number) => `block:${BLOCKS[id].key}`;
export const isPipeBlock = (id: number) => BLOCKS[id].shape === 'pipe';
