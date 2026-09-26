// Internal geology model types shared by the generator, the column classifier and the trap scanner.
import type { Aquifer, Reservoir, TrapType } from '../core/types';
import { NUM_HORIZONS } from './strata';

/** Hydrocarbons are never closer than this many blocks to the surface / seabed. */
export const MIN_COVER = 8;
/** Upper bound on faults per world (per-column arrays are sized for it). */
export const MAX_FAULTS = 8;
/** Upper bound on sealing faults (compartment masks are 4 bits). */
export const MAX_SEALING = 4;
/** Spatial index cell size (blocks). */
export const CELL = 16;

/** Region shapes for traps. */
export const SHAPE = { ELLIPSE: 0, SECTOR: 1, WEDGE: 2, CIRCLE: 3 } as const;
/** Host body kinds. */
export const BODY = { UNIT: 0, REEF: 1, WEDGE: 2 } as const;

/** Region code bits stored per candidate trap in the column context. */
export const RC = { WATER_LEG: 1, HC: 2, RING: 4 } as const;

export interface TrapModel {
  kind: TrapType;
  /** Host stratigraphic unit (for BODY.UNIT) or the unit containing the body. */
  unit: number;
  body: number;
  /** Reef / wedge / diapir index depending on body/shape. */
  bodyIdx: number;
  shape: number;
  cx: number;
  cz: number;
  ra: number;
  rb: number;
  cos: number;
  sin: number;
  /** Water-leg region scale relative to the HC region. */
  wl: number;
  /** Sector (salt flank): centre angle & half-width (radians). */
  secMid: number;
  secHalf: number;
  /** Mask of relevant sealing-fault bits. */
  maskAnd: number;
  /** Compartment mask → reservoir model index (−1 = not charged). */
  comp: Int16Array;
  /** Host is sandstone → water leg rendered as BRINE_SANDSTONE. */
  brine: boolean;
  /** Bounding box of the water-leg region (inclusive, clamped to the map). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  // ---- plan data
  charged: boolean;
  desiredColumn: number;
  offshore: boolean;
  /** Preferred fluid (plays / starter) or null to derive from depth. */
  fluidHint: 'oil' | 'gas' | null;
  /** Base name (without compartment suffix). */
  name: string;
  /** Quality bonus (−1..1) applied to porosity/permeability. */
  quality: number;
  starter: boolean;
}

export interface ResModel {
  pub: Reservoir;
  owcY: number;
  /** Gas above this y (Infinity when no gas cap). */
  gocY: number;
  blockOil: number;
  blockGas: number;
  /** Always-gas reservoir (gas / condensate). */
  allGas: boolean;
  midY: number;
  /** Pressure gradient inside the reservoir (psi/ft). */
  grad: number;
  trap: number;
}

export interface AquiferModel {
  pub: Aquifer;
  unit: number;
  cx: number;
  cz: number;
  ra: number;
  rb: number;
  cos: number;
  sin: number;
  /** True once scanning found at least one voxel. */
  live: boolean;
}

/** Reusable per-column state for classification (no allocations in the hot path). */
export class ColumnCtx {
  key = -1;
  x = 0;
  z = 0;
  i = 0;
  ground = 0;
  waterTop = -1;
  biome = 0;
  flags = 0;
  slope = 0;
  temp = 0;
  patch = 0;
  hash = 0;
  // soil
  soilDepth = 0;
  soilMode = 0;
  top = 0;
  sub = 0;
  deep = 0;
  redDepth = 0;
  // strata
  readonly hz = new Float32Array(NUM_HORIZONS);
  readonly w = new Float32Array(4);
  readonly fy = new Float32Array(MAX_FAULTS);
  nF = 0;
  op = 0;
  saltPres = 0;
  dolo = false;
  dike = false;
  // features
  dIdx = -1;
  dR = 0;
  dMod = 1;
  reef = -1;
  reefTop = 0;
  wedge = -1;
  wBase = 0;
  wTop = 0;
  /** Local along-dip coordinate inside the wedge. */
  wU = 0;
  nT = 0;
  readonly tIdx = new Int16Array(12);
  readonly tCode = new Uint8Array(12);
  nA = 0;
  readonly aIdx = new Int16Array(6);
  // per-voxel outputs of classify()
  yr = 0;
  mask = 0;
  unit = 0;
  body = 0;
  hint = 1;
  res = -1;
  aq = -1;
  wl = false;
}
