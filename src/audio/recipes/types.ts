import type { Rend } from '../synth';

/**
 * A procedural sound recipe. Recipes build a WebAudio graph against `r` starting at time `t`; the sound
 * bank renders them once into AudioBuffers via OfflineAudioContext (per variant), then normalises levels.
 */
export interface Recipe {
  /** Rendered length in seconds (for loops: loop length + crossfade tail). */
  dur: number;
  /** 1 = mono (default, spatialised sounds), 2 = stereo (stings, beds). */
  channels?: 1 | 2;
  /** Number of distinct renders (different RNG seeds). */
  variants?: number;
  /** Target peak after render (dBFS). One-shots only. Default −12. */
  peakDb?: number;
  /** Seamless loop length in seconds. The remaining (dur − loop) seconds are crossfaded into the head. */
  loop?: number;
  /** Target RMS for loops (dBFS). Default −20. */
  rmsDb?: number;
  /** Render at a reduced rate (24 kHz) for low-frequency material — halves memory & render cost. */
  lowRate?: boolean;
  /** Render order: lower first. UI 0, foley 1, events 2, music 2, loops 3, nature 4. */
  priority?: number;
  build(r: Rend, t: number, variant: number): void;
}

export type RecipeMap = Record<string, Recipe>;

/** Quantise a frequency to complete an integer number of cycles within a loop of `len` seconds. */
export const qf = (f: number, len: number) => Math.max(1, Math.round(f * len)) / len;
