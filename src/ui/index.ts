// STUB — owned by the UI agent.
import type { AppShell } from '../core/client';
import type { GameContext } from '../core/types';
import type { AudioEngine } from '../audio';

export interface UI {
  /** Show main menu (no game running). */
  showMainMenu(): void;
  /** A game session started: build HUD & subscribe to its bus. */
  attachGame(ctx: GameContext): void;
  /** Game session ended. */
  detachGame(): void;
  /** Loading screen control. */
  setLoading(active: boolean, progress: number, label: string): void;
  /** Called every animation frame (throttle internally). */
  update(dt: number): void;
  /** True when a modal panel is open (player input suspended, pointer unlocked). */
  readonly capturing: boolean;
}

export function createUI(root: HTMLElement, app: AppShell, audio: AudioEngine): UI {
  return { showMainMenu() {}, attachGame() {}, detachGame() {}, setLoading() {}, update() {}, capturing: false };
}
