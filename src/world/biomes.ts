// Biome registry: compact numeric ids for typed-array storage + presentation colours.
import type { BiomeId } from '../core/types';

/** Numeric biome ids (index into BIOME_IDS). */
export const BI = {
  PLAINS: 0,
  FOREST: 1,
  BIRCH: 2,
  TAIGA: 3,
  DESERT: 4,
  BADLANDS: 5,
  SWAMP: 6,
  TUNDRA: 7,
  MOUNTAINS: 8,
  BEACH: 9,
  OCEAN: 10,
  DEEP_OCEAN: 11,
  RIVER: 12,
} as const;

export const BIOME_IDS: readonly BiomeId[] = [
  'plains', 'forest', 'birch_forest', 'taiga', 'desert', 'badlands', 'swamp', 'tundra', 'mountains', 'beach', 'ocean',
  'deep_ocean', 'river',
];

export const BIOME_INDEX: Record<BiomeId, number> = Object.fromEntries(BIOME_IDS.map((b, i) => [b, i])) as Record<BiomeId, number>;

export const BIOME_NAMES: Record<BiomeId, string> = {
  plains: 'Plains',
  forest: 'Forest',
  birch_forest: 'Birch Forest',
  taiga: 'Taiga',
  desert: 'Desert',
  badlands: 'Badlands',
  swamp: 'Swamp',
  tundra: 'Tundra',
  mountains: 'Mountains',
  beach: 'Beach',
  ocean: 'Ocean',
  deep_ocean: 'Deep Ocean',
  river: 'River',
};

/** Representative map colours (RGB) per biome, used by the minimap & UI legends. */
export const BIOME_RGB: readonly [number, number, number][] = [
  [118, 168, 74], // plains
  [58, 118, 48], // forest
  [104, 150, 70], // birch
  [54, 96, 70], // taiga
  [222, 202, 142], // desert
  [190, 104, 58], // badlands
  [74, 98, 62], // swamp
  [226, 234, 240], // tundra
  [128, 126, 124], // mountains
  [230, 214, 160], // beach
  [38, 104, 170], // ocean
  [18, 52, 108], // deep ocean
  [52, 126, 196], // river
];

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** CSS hex colour for a biome (legend chips, tooltips). */
export function biomeColor(biome: BiomeId): string {
  const c = BIOME_RGB[BIOME_INDEX[biome] ?? 0];
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
}
