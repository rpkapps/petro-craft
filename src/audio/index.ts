// PetroCraft procedural audio — public entry point.
//
// Everything is synthesised with WebAudio at runtime (no asset files):
//   core.ts      AudioContext lifecycle (unlocked on first gesture), buses, reverbs, limiter, volumes
//   bank.ts      offline pre-rendering of recipes (recipes/*) into AudioBuffers
//   voices.ts    one-shot playback (3D, caps, stealing)
//   ambience/    spatial machine/hazard loops + environment beds & wildlife
//   music/       generative score (theory, instruments, composer, director)
//   events.ts    game event → sound mapping
import type { AppShell, RenderHost } from '../core/client';
import type { GameContext } from '../core/types';
import { AudioEngineImpl } from './engine';

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
  const impl = new AudioEngineImpl(app);
  // Every entry point is guarded: audio must never break the game.
  const safe = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    try {
      fn(...a);
    } catch (err) {
      console.warn('[audio]', err);
    }
  };
  return {
    attach: safe((ctx: GameContext, host: RenderHost) => impl.attach(ctx, host)),
    detach: safe(() => impl.detach()),
    update: safe((dt: number) => impl.update(dt)),
    ui: safe((sound: Parameters<AudioEngine['ui']>[0]) => impl.ui(sound)),
    setVolumes: safe((m: number, mu: number, s: number) => impl.setVolumes(m, mu, s)),
    menuMusic: safe((on: boolean) => impl.menuMusic(on)),
  };
}

/** Full engine (for tools / dev harness): exposes unlock(), playNamed(), debugInfo(), etc. */
export function createAudioEngineImpl(app: AppShell | null): AudioEngineImpl {
  return new AudioEngineImpl(app);
}

export { AudioEngineImpl, SOUND_ALIASES } from './engine';
export { ONE_SHOT_NAMES, LOOP_NAMES, UI_SOUND_NAMES, RECIPES } from './recipes';
export { materialOf, footstepSound, breakSound, placeSound, type Material } from './materials';
