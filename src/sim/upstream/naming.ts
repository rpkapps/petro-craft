// Well & survey naming: "Eagle 3", "Eagle 4-H" — lease (parcel) name + sequence number within the parcel.
import { hash4 } from '../../core/rng';
import { PARCEL_SIZE } from '../../core/constants';
import type { GameContext, WellPlan } from '../../core/types';

const LEASE_NAMES = [
  'Eagle', 'Mesa', 'Coyote', 'Red Hawk', 'Bluebonnet', 'Sandhill', 'Longhorn', 'Cypress', 'Maverick', 'Pecos',
  'Wildcat', 'Sabine', 'Buckskin', 'Ironwood', 'Stockton', 'Cheyenne', 'Laramie', 'Bighorn', 'Prairie Dog', 'Tumbleweed',
  'Kestrel', 'Osage', 'Juniper', 'Granite Ridge', 'Silver Creek', 'Black Mesa', 'Copperhead', 'Falcon', 'Lone Pine', 'Badger',
  'Driftwood', 'Salt Flat', 'Thunder Butte', 'Cimarron', 'Rattlesnake', 'Whitetail', 'Sagebrush', 'Antelope', 'Dry Gulch', 'Horseshoe',
];

/** Deterministic lease name for the parcel containing (x, z). */
export function leaseName(ctx: GameContext, x: number, z: number): string {
  const px = Math.floor(x / PARCEL_SIZE);
  const pz = Math.floor(z / PARCEL_SIZE);
  const h = hash4(ctx.state.meta.seed | 0, px, pz, 0x77e11);
  return LEASE_NAMES[h % LEASE_NAMES.length];
}

/** Next well name in a parcel, e.g. "Eagle 3" or "Eagle 4-H" (H = horizontal, D = directional). */
export function nextWellName(ctx: GameContext, x: number, z: number, kind: WellPlan['kind']): string {
  const base = leaseName(ctx, x, z);
  const px = Math.floor(x / PARCEL_SIZE);
  const pz = Math.floor(z / PARCEL_SIZE);
  let n = 1;
  for (const w of Object.values(ctx.state.wells)) if (Math.floor(w.x / PARCEL_SIZE) === px && Math.floor(w.z / PARCEL_SIZE) === pz) n++;
  const taken = new Set(Object.values(ctx.state.wells).map((w) => w.name));
  const suffix = kind === 'horizontal' ? '-H' : kind === 'directional' ? '-D' : '';
  let name = `${base} ${n}${suffix}`;
  while (taken.has(name)) name = `${base} ${++n}${suffix}`;
  return name;
}

export function surveyName(ctx: GameContext, kind: '2d' | '3d', x: number, z: number): string {
  const n = Object.values(ctx.state.surveys).filter((s) => s.kind === kind).length + 1;
  return kind === '2d' ? `${leaseName(ctx, x, z)} 2D Line ${n}` : `${leaseName(ctx, x, z)} 3D Survey ${n}`;
}
