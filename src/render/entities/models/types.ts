import type * as THREE from 'three';
import type { Builder } from '../geom/Builder';
import type { BuildingState, GameContext, WellState } from '../../../core/types';

export interface BuildParams {
  /** Unrotated catalogue size [w, d, h] in blocks (model local x = w, z = d). */
  w: number;
  d: number;
  h: number;
  /** Variant key returned by ModelDef.variant (or '' / default). */
  variant: string;
}

/** Per-frame animation input for a visible, nearby building model. */
export interface AnimState {
  dt: number;
  /** Layer time in seconds. */
  t: number;
  /** Smoothed activity 0..1 (0 = stopped). Scale animation rates by this. */
  speed: number;
  /** Building state (read-only). May be a placeholder in the dev harness / ghosts. */
  b: BuildingState;
  ctx: GameContext;
  /** Linked well (rigs: the well being drilled; wellheads: their well). */
  well: WellState | undefined;
  /** Persistent per-instance scratch values (phases, positions). */
  mem: Record<string, number>;
  node(name: string): THREE.Object3D | undefined;
}

export interface ModelDef {
  build(b: Builder, p: BuildParams): void;
  /** Instance-specific variant key (e.g. lift type, leg length). Changing it rebuilds the model. */
  variant?(bs: BuildingState, ctx: GameContext): string;
  /** Default variant used for build ghosts. */
  ghostVariant?: string;
  animate?(a: AnimState): void;
  /** Animate at full speed whenever operational even if 'idle' (anemometers, antennas, turbines). */
  ambient?: boolean;
  /** Custom activity 0..1 (defaults to status/utilisation). */
  activity?(bs: BuildingState, ctx: GameContext): number;
}
