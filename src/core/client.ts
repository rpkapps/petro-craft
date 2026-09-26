// Client-side (presentation) contracts: rendering host, app shell used by the UI, save metadata.
import type * as THREE from 'three';
import type { GameContext, Settings, Vec3 } from './types';
import type { MapOverlay } from './EventBus';
import type { NewGameOptions } from './state';

/** Implemented by render/Renderer. Shared by entity layer, player controller, audio. */
export interface RenderHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** Main directional light (sun or moon). */
  readonly sun: THREE.DirectionalLight;
  /** Normalized direction *towards* the sun. */
  readonly sunDirection: THREE.Vector3;
  /** 0 (night) .. 1 (noon) ambient daylight factor. */
  daylight: number;
  /** Active subsurface/map overlay (x-ray cutaway etc.). */
  overlay: MapOverlay | null;
  /** Set by the entity layer so the player controller can show building ghosts. */
  buildingPreview: { create(type: string): THREE.Object3D } | null;
  /** Register a per-frame callback (dt seconds). Returns unsubscribe. */
  onFrame(fn: (dt: number) => void): () => void;
  /** Highlight a block (wireframe cursor) or a box region (selection). null clears. */
  setBlockHighlight(pos: Vec3 | null, breakProgress?: number): void;
  setSelectionBox(min: Vec3 | null, max?: Vec3): void;
  /** Camera shake (explosions). */
  shake(intensity: number, duration?: number): void;
  /** Frames-per-second estimate. */
  readonly fps: number;
  /** Chunk load progress 0..1 around the player (for loading screen). */
  readonly loadProgress: number;
}

export interface SaveSlotInfo {
  slot: string;
  saveName: string;
  companyName: string;
  day: number;
  money: number;
  savedAt: number;
  playTimeSec: number;
  worldSize: string;
  difficulty: string;
  thumbnail?: string; // data URL (jpeg)
}

/** The application shell exposed to the UI (menus need this before a game exists). */
export interface AppShell {
  /** Current game context, or null while in the main menu. */
  readonly ctx: GameContext | null;
  readonly host: RenderHost | null;
  settings: Settings;
  applySettings(s: Partial<Settings>): void;
  newGame(opts: NewGameOptions): Promise<void>;
  loadGame(slot: string): Promise<void>;
  saveGame(slot?: string): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  listSaves(): Promise<SaveSlotInfo[]>;
  exportSave(slot: string): Promise<Blob>;
  importSave(file: File): Promise<string>;
  quitToMenu(): Promise<void>;
  /** Pointer lock helpers for the player controller / UI. */
  requestPointerLock(): void;
  exitPointerLock(): void;
  readonly pointerLocked: boolean;
  /** Loading state for the loading screen. */
  readonly loading: { active: boolean; progress: number; label: string };
  /** Whether a modal UI panel is open (player controls suspended). */
  uiCapturing: boolean;
  /** Take a jpeg thumbnail of the current frame. */
  screenshot(width?: number): string | null;
}
