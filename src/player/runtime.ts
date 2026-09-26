// Shared client-side player runtime passed to every controller sub-module.
import * as THREE from 'three';
import type { AppShell, RenderHost } from '../core/client';
import type { Command, CommandResult, CommandType } from '../core/commands';
import type { BuildingState, GameContext, PlayerMode, PlayerState, Vec3 } from '../core/types';
import type { InputManager } from './input';
import type { Body } from './physics';
import type { VoxelHit } from './raycast';

export type TargetKind = 'none' | 'block' | 'building' | 'well';

export interface Target {
  kind: TargetKind;
  /** Voxel hit under the crosshair / cursor (set whenever something was hit, including buildings). */
  hit: VoxelHit | null;
  building?: BuildingState;
  /** Building id or well id. */
  id?: string;
}

/** Normalised mouse actions for the current frame (walk: immediate; drone: RMB acts on click-release, drag orbits). */
export interface Actions {
  primaryPressed: boolean;
  primaryHeld: boolean;
  secondaryPressed: boolean;
  secondaryHeld: boolean;
}

export const NO_ACTIONS: Actions = { primaryPressed: false, primaryHeld: false, secondaryPressed: false, secondaryHeld: false };

export interface PlayerRuntime {
  readonly ctx: GameContext;
  readonly host: RenderHost;
  readonly app: AppShell;
  readonly input: InputManager;
  readonly body: Body;
  yaw: number;
  pitch: number;
  mode: PlayerMode;
  /** Movement mode to return to when leaving the drone camera. */
  bodyMode: 'walk' | 'fly';
  dead: boolean;
  /** Pick ray for this frame (world space, dir normalised). */
  readonly rayOrigin: THREE.Vector3;
  readonly rayDir: THREE.Vector3;
  target: Target;
  player(): PlayerState | undefined;
  selectedSlot(): number;
  selectedItem(): string | null;
  creative(): boolean;
  /** Push the current position immediately (before reach-checked commands). */
  syncNow(): void;
  dispatch<K extends CommandType>(cmd: Command<K>): CommandResult;
  /** Eye position of the body. */
  eye(): Vec3;
  /** Swing the held item (viewmodel animation). */
  swing(): void;
}
