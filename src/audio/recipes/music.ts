// Pre-rendered percussion & texture hits for the score. Levels are normalised; the composer scales by velocity.
import type { RecipeMap } from './types';

export const MUSIC_RECIPES: RecipeMap = {
  m_kick: {
    dur: 0.7, priority: 2, peakDb: -3,
    build(r, t) {
      r.thump(r.out, t, 62, 1, 0.5, 0.5);
      r.burst(r.out, t, 0.012, 0.18, { type: 'lowpass', freq: 1500, q: 0.7 });
    },
  },
  m_shaker: {
    dur: 0.14, variants: 3, priority: 2, peakDb: -3,
    build(r, t) {
      r.burst(r.out, t, 0.07, 0.6, { freq: r.r(5500, 7000), q: 0.8, attack: r.r(0.008, 0.016) });
      r.burst(r.out, t, 0.04, 0.2, { type: 'highpass', freq: 8000, q: 0.7, attack: 0.01 });
    },
  },
  m_tick: {
    dur: 0.25, variants: 2, priority: 2, peakDb: -3,
    build(r, t) {
      r.metal(r.out, t, r.r(2300, 2500), 0.4, 0.12, [1, 1.73, 2.9]);
    },
  },
  m_rim: {
    dur: 0.12, priority: 2, peakDb: -3,
    build(r, t) {
      r.burst(r.out, t, 0.02, 0.6, { freq: 1800, q: 2 });
      r.partial(r.out, t, 900, 0.3, 0.04);
    },
  },
  m_taiko: {
    dur: 1.3, variants: 2, priority: 2, peakDb: -3,
    build(r, t) {
      r.thump(r.out, t, r.r(85, 95), 1, 0.9, 0.6);
      r.burst(r.out, t, 0.2, 0.35, { color: 'brown', type: 'lowpass', freq: 400, q: 0.7 });
      r.burst(r.out, t, 0.03, 0.3, { freq: 700, q: 1 });
    },
  },
  m_swell: {
    dur: 2.1, channels: 2, priority: 2, peakDb: -3,
    build(r, t) {
      for (const side of [-0.6, 0.6]) {
        const p = r.pan(side);
        p.connect(r.out);
        const n = r.noiseSrc('pink', t, t + 2.05);
        const f = r.filter('lowpass', 300, 1.2);
        r.sweep(f.frequency, t, 300, 4500, 1.85);
        const g = r.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08, t + 1.0);
        g.gain.exponentialRampToValueAtTime(0.8, t + 1.85);
        g.gain.linearRampToValueAtTime(0, t + 1.95);
        r.chain(n, f, g, p);
      }
    },
  },
  m_anvil: {
    // soft, distant industrial anvil; fundamental ≈ 1109 Hz (MIDI 85) for tuning by playbackRate
    dur: 2.2, priority: 2, peakDb: -3,
    build(r, t) {
      const lp = r.filter('lowpass', 3500, 0.7);
      lp.connect(r.out);
      r.metal(lp, t, 1108.7, 0.5, 1.8, [1, 2.61, 4.3, 5.9]);
    },
  },
  m_pulse: {
    // plucky analog bass at C2 (65.41 Hz); pitched by playbackRate
    dur: 0.7, priority: 2, peakDb: -3,
    build(r, t) {
      const o = r.osc('warm', 65.41, t, t + 0.65);
      const f = r.filter('lowpass', 1400, 4);
      r.sweep(f.frequency, t, 1400, 180, 0.25);
      const g = r.gain(0);
      r.perc(g.gain, t, 0.8, 0.004, 0.5);
      r.chain(o, f, g, r.out);
      r.partial(r.out, t, 65.41, 0.5, 0.45, { attack: 0.004 });
    },
  },
};
