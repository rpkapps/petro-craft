// Petrophysics: per-block rock property baselines (for well logs & seismic synthesis) and the
// pore/fracture pressure model.
import { B } from '../core/blocks';
import { FEET_PER_METER, METERS_PER_BLOCK } from '../core/constants';
import type { RockType } from '../core/types';
import { smoothstep } from '../core/rng';

export const FT_PER_BLOCK = METERS_PER_BLOCK * FEET_PER_METER;
export const HYDROSTATIC = 0.433; // psi/ft fresh-ish formation water
export const SEAWATER = 0.445; // psi/ft

export interface RockBase {
  rock: RockType;
  phi: number;
  perm: number;
  hard: number;
  /** Acoustic impedance (arbitrary units ~2..13). */
  imp: number;
  gr: number;
  rt: number;
  rho: number;
  /** Pore fluid when not otherwise specified. */
  fluid: 'none' | 'brine';
}

const R = (rock: RockType, phi: number, perm: number, hard: number, imp: number, gr: number, rt: number, rho: number, fluid: 'none' | 'brine' = 'brine'): RockBase => ({
  rock, phi, perm, hard, imp, gr, rt, rho, fluid,
});

/** Dense table indexed by block id (undefined for non-geological blocks). */
export const ROCK_BASE: (RockBase | undefined)[] = [];
ROCK_BASE[B.BEDROCK] = R('bedrock', 0.005, 0.001, 3.0, 12.4, 60, 200, 2.95, 'none');
ROCK_BASE[B.STONE] = R('granite', 0.02, 0.001, 2.2, 10.8, 110, 180, 2.65, 'none');
ROCK_BASE[B.MOSSY_STONE] = ROCK_BASE[B.STONE];
ROCK_BASE[B.DIRT] = R('soil', 0.4, 800, 0.3, 2.3, 60, 25, 1.7);
ROCK_BASE[B.GRASS] = ROCK_BASE[B.DIRT];
ROCK_BASE[B.PODZOL] = ROCK_BASE[B.DIRT];
ROCK_BASE[B.MUD] = R('soil', 0.5, 5, 0.3, 2.1, 80, 6, 1.6);
ROCK_BASE[B.PERMAFROST] = R('soil', 0.3, 0.01, 0.9, 4.2, 55, 150, 1.9, 'none');
ROCK_BASE[B.SNOW] = R('soil', 0.6, 100, 0.3, 1.2, 10, 200, 0.4, 'none');
ROCK_BASE[B.ICE] = R('water', 0.02, 0.001, 0.5, 3.4, 10, 200, 0.92, 'none');
ROCK_BASE[B.SAND] = R('sand', 0.36, 4000, 0.35, 2.9, 22, 30, 1.9);
ROCK_BASE[B.RED_SAND] = ROCK_BASE[B.SAND];
ROCK_BASE[B.GRAVEL] = R('sand', 0.3, 9000, 0.4, 3.3, 30, 40, 2.0);
ROCK_BASE[B.CLAY] = R('clay', 0.45, 0.01, 0.45, 3.1, 95, 3, 2.0);
ROCK_BASE[B.SEABED_SILT] = R('silt', 0.5, 0.5, 0.3, 2.6, 75, 1.2, 1.8);
ROCK_BASE[B.TERRACOTTA] = R('mudstone', 0.12, 0.05, 1.0, 5.2, 85, 12, 2.3);
ROCK_BASE[B.SANDSTONE] = R('sandstone', 0.11, 2, 1.1, 7.2, 34, 9, 2.42);
ROCK_BASE[B.SHALE] = R('shale', 0.06, 0.001, 1.0, 6.3, 122, 2.6, 2.5);
ROCK_BASE[B.LIMESTONE] = R('limestone', 0.07, 4, 1.6, 9.4, 18, 70, 2.62);
ROCK_BASE[B.DOLOMITE] = R('dolomite', 0.09, 15, 1.9, 10.4, 24, 90, 2.8);
ROCK_BASE[B.SALT] = R('salt', 0.005, 0.001, 0.9, 9.2, 8, 200, 2.16, 'none');
ROCK_BASE[B.GRANITE] = R('granite', 0.01, 0.001, 2.7, 11.2, 140, 200, 2.65, 'none');
ROCK_BASE[B.BASALT] = R('basalt', 0.02, 0.001, 3.0, 11.9, 40, 180, 2.95, 'none');
ROCK_BASE[B.CHALK] = R('chalk', 0.24, 1.5, 0.7, 7.4, 13, 14, 2.25);
ROCK_BASE[B.COAL_SEAM] = R('coal', 0.06, 5, 0.6, 3.5, 35, 150, 1.4);
ROCK_BASE[B.MUDSTONE] = R('mudstone', 0.1, 0.01, 0.8, 5.7, 96, 4, 2.4);
ROCK_BASE[B.OIL_SANDSTONE] = R('sandstone', 0.22, 200, 1.1, 5.9, 30, 70, 2.25);
ROCK_BASE[B.OIL_LIMESTONE] = R('limestone', 0.15, 40, 1.5, 8.3, 17, 90, 2.5);
ROCK_BASE[B.GAS_SANDSTONE] = R('sandstone', 0.22, 200, 1.1, 4.7, 27, 140, 2.1);
ROCK_BASE[B.GAS_SHALE] = R('shale', 0.06, 0.001, 1.3, 5.3, 150, 35, 2.4);
ROCK_BASE[B.TIGHT_OIL_SHALE] = R('shale', 0.07, 0.001, 1.3, 5.5, 145, 30, 2.45);
ROCK_BASE[B.BRINE_SANDSTONE] = R('sandstone', 0.23, 250, 1.05, 6.7, 28, 0.9, 2.3);
ROCK_BASE[B.CAPROCK] = R('caprock', 0.01, 0.001, 2.3, 12.6, 10, 180, 2.95, 'none');
ROCK_BASE[B.ORE_IRON] = R('granite', 0.02, 0.001, 2.4, 12.0, 60, 60, 3.4, 'none');
ROCK_BASE[B.ORE_COPPER] = R('granite', 0.02, 0.001, 2.4, 11.6, 80, 20, 3.1, 'none');

/** Block → rock type (for rockAt). */
export function rockOfBlock(id: number): RockType {
  if (id === B.WATER) return 'water';
  return ROCK_BASE[id]?.rock ?? 'soil';
}

/**
 * Background (non-reservoir) pore & overburden pressure model.
 * @param waterBlocks water column above the mudline (blocks)
 * @param sedBlocks depth below the mudline / ground surface (blocks)
 * @param lambda overpressure ratio 0..~0.65 (fraction of effective stress carried by pore fluid)
 */
export function pressureModel(waterBlocks: number, sedBlocks: number, lambda: number, out: { pp: number; sv: number; frac: number }): void {
  const wFt = Math.max(0, waterBlocks) * FT_PER_BLOCK;
  const sFt = Math.max(0, sedBlocks) * FT_PER_BLOCK;
  const ph = SEAWATER * wFt + HYDROSTATIC * sFt;
  const sedGrad = 0.86 + 0.12 * smoothstep(0, 60, sedBlocks);
  const sv = SEAWATER * wFt + sedGrad * sFt;
  const pp = ph + lambda * (sv - ph);
  // Eaton: Pf = Pp + K (Sv − Pp); K grows with depth of burial.
  const K = 0.58 + 0.27 * smoothstep(0, 60, sedBlocks);
  out.pp = pp;
  out.sv = sv;
  out.frac = pp + K * (sv - pp);
}
