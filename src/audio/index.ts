// STUB — owned by the Audio agent.
import type { AppShell, RenderHost } from '../core/client';
import type { GameContext } from '../core/types';

export interface AudioEngine {
  /** Attach to a running game (subscribe to events, start ambience). */
  attach(ctx: GameContext, host: RenderHost): void;
  detach(): void;
  update(dt: number): void;
  /** UI sounds usable from menus (no game required). */
  ui(sound: 'click' | 'hover' | 'open' | 'close' | 'error' | 'success' | 'cash' | 'notify' | 'alarm'): void;
  setVolumes(master: number, music: number, sfx: number): void;
  /** Start menu music. */
  menuMusic(on: boolean): void;
}

export function createAudioEngine(app: AppShell): AudioEngine {
  return { attach() {}, detach() {}, update() {}, ui() {}, setVolumes() {}, menuMusic() {} };
}
