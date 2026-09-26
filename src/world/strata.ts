// Stratigraphic column: the ordered rock units beneath the soil, with nominal thicknesses and
// seed-chosen formation names. Unit u occupies restored elevations [hz[u-1], hz[u]); unit 0 is the
// crystalline basement (below hz[0]) and the last unit is the banded overburden (above hz[NUM_HORIZONS-1]).
import { B } from '../core/blocks';
import type { Reservoir } from '../core/types';
import { pick, shuffled } from './noise';

export const U = {
  BASEMENT: 0,
  BASAL_SAND: 1,
  SOURCE: 2,
  SALT: 3,
  ANHYDRITE: 4,
  PLATFORM: 5,
  LOWER_SHALE: 6,
  DEEP_SAND: 7,
  COAL: 8,
  MID_SAND: 9,
  SEAL: 10,
  CHALK: 11,
  UPPER_SAND: 12,
  UPPER_MUD: 13,
  OVERBURDEN: 14,
} as const;

export const NUM_UNITS = 15;
/** Horizon k = top of unit k (k = 0 .. NUM_UNITS-2). */
export const NUM_HORIZONS = 14;

export type UnitRole = 'basement' | 'reservoir' | 'source' | 'salt' | 'seal' | 'carbonate' | 'coal' | 'overburden';

export interface UnitDef {
  role: UnitRole;
  /** Default block for the unit. */
  block: number;
  lith: Reservoir['lithology'] | 'salt' | 'anhydrite' | 'chalk' | 'mudstone' | 'granite' | 'mixed';
  /** Nominal thickness (blocks) at full sediment supply. */
  nominal: number;
  /** Relative lateral thickness variation (0..1). */
  variation: number;
  /** Minimum thickness as a fraction of nominal (0 allows pinch-out). */
  minFrac: number;
  pool: keyof typeof POOLS;
}

export const UNITS: readonly UnitDef[] = [
  { role: 'basement', block: B.GRANITE, lith: 'granite', nominal: 0, variation: 0, minFrac: 0, pool: 'basement' },
  { role: 'reservoir', block: B.SANDSTONE, lith: 'sandstone', nominal: 3.4, variation: 0.3, minFrac: 0.65, pool: 'basal' },
  { role: 'source', block: B.SHALE, lith: 'shale', nominal: 5.0, variation: 0.25, minFrac: 0.7, pool: 'source' },
  { role: 'salt', block: B.SALT, lith: 'salt', nominal: 4.2, variation: 0.35, minFrac: 0, pool: 'salt' },
  { role: 'seal', block: B.CAPROCK, lith: 'anhydrite', nominal: 1.1, variation: 0, minFrac: 0, pool: 'anhydrite' },
  { role: 'carbonate', block: B.LIMESTONE, lith: 'limestone', nominal: 4.8, variation: 0.25, minFrac: 0.7, pool: 'platform' },
  { role: 'seal', block: B.SHALE, lith: 'shale', nominal: 3.0, variation: 0.25, minFrac: 0.75, pool: 'lowerShale' },
  { role: 'reservoir', block: B.SANDSTONE, lith: 'sandstone', nominal: 3.8, variation: 0.3, minFrac: 0.65, pool: 'deepSand' },
  { role: 'coal', block: B.MUDSTONE, lith: 'mudstone', nominal: 4.0, variation: 0.25, minFrac: 0.7, pool: 'coal' },
  { role: 'reservoir', block: B.SANDSTONE, lith: 'sandstone', nominal: 3.8, variation: 0.3, minFrac: 0.65, pool: 'midSand' },
  { role: 'seal', block: B.SHALE, lith: 'shale', nominal: 4.4, variation: 0.25, minFrac: 0.8, pool: 'seal' },
  { role: 'carbonate', block: B.CHALK, lith: 'chalk', nominal: 3.0, variation: 0.45, minFrac: 0.3, pool: 'chalk' },
  { role: 'reservoir', block: B.SANDSTONE, lith: 'sandstone', nominal: 3.3, variation: 0.3, minFrac: 0.65, pool: 'upperSand' },
  { role: 'seal', block: B.MUDSTONE, lith: 'mudstone', nominal: 3.4, variation: 0.3, minFrac: 0.6, pool: 'upperMud' },
  { role: 'overburden', block: B.MUDSTONE, lith: 'mixed', nominal: 0, variation: 0, minFrac: 0, pool: 'overburden' },
];

/** Total nominal thickness of the sedimentary stack (units 1..13). */
export const STACK_NOMINAL = UNITS.reduce((s, u) => s + u.nominal, 0);

/** Units that can host conventional sandstone reservoirs, shallow → deep. */
export const SAND_UNITS = [U.UPPER_SAND, U.MID_SAND, U.DEEP_SAND, U.BASAL_SAND] as const;

export const POOLS = {
  basement: ['Precambrian Basement', 'Llano Granite', 'Wichita Granite'],
  basal: ['Hosston Sand', 'Travis Peak', 'Morrow Sand', 'Tensleep Sand', 'Nugget Sand', 'Simpson Sand', 'Granite Wash', 'Bromide Sand'],
  source: ['Wolfcamp', 'Eagle Ford', 'Haynesville', 'Barnett', 'Marcellus', 'Woodford', 'Bakken', 'Vaca Muerta', 'Duvernay', 'Kimmeridge'],
  salt: ['Louann Salt', 'Zechstein Salt', 'Hith Salt', 'Castile Salt', 'Paradox Salt'],
  anhydrite: ['Buckner Anhydrite', 'Ferry Lake Anhydrite', 'Werra Anhydrite', 'Cotton Anhydrite'],
  platform: ['Smackover Lime', 'Edwards Lime', 'Ellenburger', 'Arab-D', 'Mishrif Lime', 'Sligo Lime', 'Glen Rose', 'Leduc Lime'],
  lowerShale: ['Bossier Shale', 'Mancos Shale', 'Kiamichi Shale', 'Pierre Shale', 'Pearsall Shale'],
  deepSand: ['Cotton Valley', 'Tuscaloosa Sand', 'Woodbine Sand', 'Brent Sand', 'Statfjord Sand', 'Dakota Sand', 'Muddy Sand'],
  coal: ['Olmos Coal Measures', 'Fruitland Coal', 'Ferron Coal Measures', 'Mesaverde Group'],
  midSand: ['Frio Sand', 'Wilcox Sand', 'Vicksburg Sand', 'Yegua Sand', 'Forties Sand', 'Frontier Sand', 'Red Fork Sand', 'Miocene Sand'],
  seal: ['Anahuac Shale', 'Jackson Shale', 'Midway Shale', 'Kimmeridge Clay', 'Lewis Shale'],
  chalk: ['Austin Chalk', 'Ekofisk Chalk', 'Niobrara Chalk', 'Tor Chalk', 'Annona Chalk'],
  upperSand: ['Eagle Sand', 'Carrizo Sand', 'Sparta Sand', 'Catahoula Sand', 'Oakville Sand', 'Queen City Sand', 'Goliad Sand'],
  upperMud: ['Fleming Clay', 'Lissie Formation', 'Beaumont Clay', 'Lagarto Mudstone'],
  overburden: ['Surface Formations'],
} as const;

export const REEF_NAMES = ['Maverick', 'Horseshoe', 'Capitan', 'Pecos', 'Golden Lane', 'Scurry', 'Redwater', 'Swan Hills', 'Rainbow', 'Kelly-Snyder', 'Diamond M', 'Jumping Pound', 'Zama', 'Nisku'];
export const DOME_NAMES = ['Spindletop', 'Avery Island', 'Jennings', 'Humble', 'Sour Lake', 'Batson', 'Barbers Hill', 'Hockley', 'Boling', 'Sulphur Mines', 'Damon Mound', 'Belle Isle'];
export const OFFSHORE_NAMES = ['Brent', 'Forties', 'Ninian', 'Piper', 'Magnus', 'Thistle', 'Cormorant', 'Tern', 'Thunder Horse', 'Mars', 'Ursa', 'Auger', 'Tahiti', 'Atlantis', 'Mad Dog', 'Troll', 'Gullfaks', 'Snorre', 'Heidrun', 'Draugen', 'Kraken', 'Clair', 'Buzzard', 'Schiehallion', 'Foinaven', 'Claymore', 'Montrose'];
export const WEDGE_NAMES = ['Hackberry Wedge', 'Bol Mex Lobe', 'Marg Tex Sand', 'Nodosaria Sand', 'Camerina Sand', 'Het Sand', 'Siph Davisi Sand', 'Discorbis Lobe', 'Tex Miss Sand'];

/** Seed-chosen formation names for every unit (index = unit). */
export function chooseUnitNames(rng: () => number): string[] {
  const used = new Set<string>();
  return UNITS.map((u) => {
    const pool = shuffled(rng, POOLS[u.pool] as readonly string[]);
    const name = pool.find((n) => !used.has(n)) ?? pick(rng, pool);
    used.add(name);
    return name;
  });
}

/** Overburden bedding: a long random sequence of thin beds indexed by restored height above the stack top. */
export function buildOverburdenBands(rng: () => number, length = 256): Uint8Array {
  const out = new Uint8Array(length);
  const liths = [B.SANDSTONE, B.MUDSTONE, B.SHALE, B.LIMESTONE, B.MUDSTONE, B.SANDSTONE, B.CHALK, B.DOLOMITE];
  const weights = [0.26, 0.24, 0.14, 0.14, 0.08, 0.06, 0.04, 0.04];
  let y = 0;
  let prev = -1;
  while (y < length) {
    let r = rng();
    let li = 0;
    for (; li < weights.length - 1; li++) {
      if (r < weights[li]) break;
      r -= weights[li];
    }
    let block = liths[li];
    if (block === prev) block = li % 2 === 0 ? B.MUDSTONE : B.SANDSTONE;
    // occasional thin coal bed
    if (rng() < 0.05 && y > 3) {
      out[y++] = B.COAL_SEAM;
      if (y >= length) break;
    }
    const thick = 1 + Math.floor(rng() * (block === B.CHALK || block === B.DOLOMITE ? 2 : 4));
    for (let i = 0; i < thick && y < length; i++) out[y++] = block;
    prev = block;
  }
  return out;
}

/** Badlands terracotta banding by absolute y (period 24). */
export const TERRACOTTA_BANDS: Uint8Array = (() => {
  const seq = [
    B.TERRACOTTA, B.TERRACOTTA, B.RED_SAND, B.TERRACOTTA, B.SANDSTONE, B.TERRACOTTA, B.TERRACOTTA, B.CLAY, B.TERRACOTTA,
    B.MUDSTONE, B.TERRACOTTA, B.TERRACOTTA, B.RED_SAND, B.TERRACOTTA, B.TERRACOTTA, B.SANDSTONE, B.SANDSTONE, B.TERRACOTTA,
    B.MUDSTONE, B.TERRACOTTA, B.TERRACOTTA, B.CLAY, B.TERRACOTTA, B.TERRACOTTA,
  ];
  return Uint8Array.from(seq);
})();
