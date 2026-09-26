// Tunables for the entity layer (distances in blocks, caps per particle-quality setting).
import type { Settings } from '../../core/types';

export const RECONCILE_INTERVAL = 0.5;
/** Beyond this distance models stop animating (frozen). */
export const ANIM_DISTANCE = 150;
/** Detail meshes (railings, valves, flags) are hidden beyond base + radius * factor. */
export const DETAIL_DISTANCE = 55;
export const DETAIL_RADIUS_FACTOR = 2.2;
/**
 * Shared instanced rendering of buildings: beyond `near` blocks (camera → footprint edge) buildings are
 * drawn through per-(template, look, cell) InstancedMeshes instead of their own meshes. Mutable so dev
 * harnesses can compare draw calls with it switched off.
 */
export const INSTANCING = { enabled: true, near: 55, hysteresis: 6 };
/** FX emitters of buildings only run within this distance. */
export const FX_DISTANCE = 220;

export type Quality = Settings['particles'];

export const PARTICLE_CAPACITY: Record<Quality, number> = { low: 3000, medium: 7000, high: 14000 };
/** Emission multiplier per quality. */
export const EMISSION_SCALE: Record<Quality, number> = { low: 0.35, medium: 0.65, high: 1 };
export const RAIN_DROPS: Record<Quality, number> = { low: 1800, medium: 4000, high: 8000 };
export const SNOW_FLAKES: Record<Quality, number> = { low: 2500, medium: 5000, high: 9000 };
/** Real point lights kept in the scene per quality (constant count avoids shader recompiles). */
export const POINT_LIGHTS: Record<Quality, number> = { low: 3, medium: 5, high: 8 };
export const MAX_WORKERS = 60;
