// Minimal music theory for the generative score: modes, diatonic chords with extensions, a functional
// Markov chord walk, and voice-leading.
import { weighted, type Rng } from '../dsp';

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODES;

export type Extension = 'triad' | 'add9' | 'sus2' | 'sus4' | 'seventh' | 'sixth';

/** Semitone offset (from key root) of scale degree `d` (any integer; wraps with octaves). */
export function degreeSemis(mode: ModeName, d: number): number {
  const s = MODES[mode];
  const oct = Math.floor(d / 7);
  const i = ((d % 7) + 7) % 7;
  return s[i] + 12 * oct;
}

/** Perfect fifth above the degree root? (avoid diminished chords). */
export function isStable(mode: ModeName, degree: number): boolean {
  return degreeSemis(mode, degree + 4) - degreeSemis(mode, degree) === 7;
}

export interface Chord {
  degree: number;
  /** Root as semitones from key root (0..11). */
  root: number;
  /** Chord tones as semitones from key root (unsorted pitch classes, root first). */
  tones: number[];
  ext: Extension;
}

export function buildChord(mode: ModeName, degree: number, ext: Extension): Chord {
  const r = degreeSemis(mode, degree);
  const third = degreeSemis(mode, degree + 2);
  const fifth = degreeSemis(mode, degree + 4);
  let tones: number[];
  switch (ext) {
    case 'sus2':
      tones = [r, degreeSemis(mode, degree + 1), fifth];
      break;
    case 'sus4':
      tones = [r, degreeSemis(mode, degree + 3), fifth];
      break;
    case 'add9':
      tones = [r, third, fifth, degreeSemis(mode, degree + 8)];
      break;
    case 'seventh':
      tones = [r, third, fifth, degreeSemis(mode, degree + 6)];
      break;
    case 'sixth':
      tones = [r, third, fifth, degreeSemis(mode, degree + 5)];
      break;
    default:
      tones = [r, third, fifth];
  }
  return { degree: ((degree % 7) + 7) % 7, root: ((r % 12) + 12) % 12, tones: tones.map((t) => ((t % 12) + 12) % 12), ext };
}

/** Next scale degree via weighted root motion (4ths/5ths & 3rds favoured, gentle pull to tonic). */
export function nextDegree(rng: Rng, mode: ModeName, prev: number, avoid: number[] = []): number {
  const motion: [number, number][] = [[3, 3], [4, 2], [5, 2.5], [1, 1.5], [6, 1.5], [2, 1]];
  const cands: [number, number][] = [];
  for (const [step, w] of motion) {
    const d = (prev + step) % 7;
    if (!isStable(mode, d)) continue;
    let weight = w;
    if (d === 0) weight *= 1.5;
    if (avoid.includes(d)) weight *= 0.3;
    cands.push([d, weight]);
  }
  if (!cands.length) return 0;
  return weighted(rng, cands);
}

/**
 * Voice a chord inside [lo, hi] (MIDI) with `count` voices, minimising motion from `prev`.
 * `keyRoot` is the MIDI pitch class offset of the key (0 = C).
 */
export function voiceChord(chord: Chord, keyRoot: number, prev: number[] | null, lo: number, hi: number, count: number): number[] {
  const pcs = chord.tones.map((t) => (t + keyRoot) % 12);
  // candidate notes in range for each pitch class
  const pool: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) pool.push(m);
  if (!pool.length) return [];
  const center = (lo + hi) / 2;
  const targets = prev && prev.length ? [...prev].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / count);
  while (targets.length < count) targets.push(center);
  const chosen: number[] = [];
  const usedPc = new Set<number>();
  // first pass: ensure every chord tone appears (root, third, fifth prioritised)
  for (const pc of pcs) {
    if (chosen.length >= count) break;
    let best = -1;
    let bestCost = Infinity;
    for (const m of pool) {
      if (m % 12 !== pc || chosen.includes(m)) continue;
      const cost = Math.min(...targets.map((t) => Math.abs(t - m))) + Math.abs(m - center) * 0.15;
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    if (best >= 0) {
      chosen.push(best);
      usedPc.add(pc);
    }
  }
  // fill remaining voices with doublings near unused targets
  while (chosen.length < count) {
    let best = -1;
    let bestCost = Infinity;
    for (const m of pool) {
      if (chosen.includes(m)) continue;
      const cost = Math.min(...targets.map((t) => Math.abs(t - m))) + (chosen.some((c) => Math.abs(c - m) < 3) ? 6 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
}

/** All MIDI notes of the key/mode within [lo, hi]. */
export function scaleNotes(keyRoot: number, mode: ModeName, lo: number, hi: number): number[] {
  const out: number[] = [];
  const s = MODES[mode];
  for (let m = lo; m <= hi; m++) if ((s as readonly number[]).includes((((m - keyRoot) % 12) + 12) % 12)) out.push(m);
  return out;
}

/** Nearest MIDI note (≥ lo) with pitch class pc. */
export function noteAtOrAbove(pc: number, lo: number): number {
  let m = lo;
  while (((m % 12) + 12) % 12 !== ((pc % 12) + 12) % 12) m++;
  return m;
}
