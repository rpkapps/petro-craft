// Wildlife one-shots, synthesised with FM chirps and formant pulse trains.
import { vocal } from './common';
import type { Rend } from '../synth';
import type { RecipeMap } from './types';

/** One bird syllable: a sine with a fast pitch glide and FM warble. */
function syllable(r: Rend, dest: AudioNode, t: number, f0: number, f1: number, dur: number, amp: number, warbleHz = 0, warbleDepth = 0) {
  const o = r.osc('sine', f0, t, t + dur + 0.02);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(50, f1), t + dur);
  if (warbleHz > 0) {
    const m = r.osc('sine', warbleHz, t, t + dur + 0.02);
    const mg = r.gain(warbleDepth);
    m.connect(mg).connect(o.frequency);
  }
  const g = r.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + dur * 0.25);
  g.gain.linearRampToValueAtTime(amp * 0.7, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(dest);
  // faint 2nd harmonic for realism
  const o2 = r.osc('sine', f0 * 2, t, t + dur + 0.02);
  o2.frequency.setValueAtTime(f0 * 2, t);
  o2.frequency.exponentialRampToValueAtTime(Math.max(100, f1 * 2), t + dur);
  const g2 = r.gain(0);
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(amp * 0.08, t + dur * 0.3);
  g2.gain.linearRampToValueAtTime(0, t + dur);
  o2.connect(g2).connect(dest);
}

const bird = (dur: number, build: (r: Rend, t: number) => void, variants = 3) => ({ dur, variants, priority: 4, peakDb: -14, build });

export const NATURE_RECIPES: RecipeMap = {
  bird_song: bird(2.2, (r, t) => {
    const o = r.out;
    let tt = t;
    const base = r.r(2600, 4200);
    const trillN = 3 + Math.floor(r.rng() * 4);
    const sd = r.r(0.05, 0.1);
    const ratio = r.r(0.65, 1.5);
    for (let i = 0; i < trillN; i++) {
      const j = r.r(0.96, 1.04);
      syllable(r, o, tt, base * j, base * ratio * j, sd * r.r(0.9, 1.1), r.r(0.38, 0.5), r.r(30, 70), r.r(80, 300));
      tt += sd + r.r(0.02, 0.05);
    }
    tt += r.r(0.05, 0.12);
    const endN = 2 + Math.floor(r.rng() * 3);
    for (let i = 0; i < endN; i++) {
      const f = r.r(2200, 5200);
      const d = r.r(0.06, 0.16);
      syllable(r, o, tt, f, f * r.r(0.5, 1.7), d, 0.45, r.r(0, 60), r.r(0, 200));
      tt += d + r.r(0.02, 0.07);
    }
  }),
  bird_chirp: bird(0.7, (r, t) => {
    let tt = t;
    const n = 2 + Math.floor(r.rng() * 2);
    for (let i = 0; i < n; i++) {
      const f = r.r(3500, 6000);
      syllable(r, r.out, tt, f, f * r.r(0.45, 0.7), r.r(0.04, 0.07), 0.5);
      tt += r.r(0.09, 0.16);
    }
  }),
  bird_whistle: bird(2.0, (r, t) => {
    let tt = t;
    const f = r.r(2800, 3600);
    const n = 2 + Math.floor(r.rng() * 2);
    for (let i = 0; i < n; i++) {
      const d = r.r(0.28, 0.45);
      const f0 = f * (i === 0 ? 1 : r.r(0.82, 0.9));
      syllable(r, r.out, tt, f0, f0 * r.r(0.92, 0.98), d, 0.5, 6, 15);
      tt += d + r.r(0.08, 0.2);
    }
  }),
  lark: bird(2.4, (r, t) => {
    let tt = t;
    while (tt < t + 1.9) {
      const f = r.r(3000, 6500);
      const d = r.r(0.025, 0.06);
      syllable(r, r.out, tt, f, f * r.r(0.7, 1.4), d, r.r(0.25, 0.5), r.r(0, 90), r.r(0, 400));
      tt += d + r.r(0.005, 0.03);
    }
  }, 3),
  gull: bird(1.8, (r, t) => {
    const n = 2 + Math.floor(r.rng() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.r(0.26, 0.34);
      const f0 = r.r(1300, 1600);
      vocal(r, r.out, tt, f0, f0 * r.r(0.55, 0.7), r.r(0.18, 0.26), [[1600, 3], [2600, 4], [3600, 5]], 0.6, 'reed');
    }
  }, 3),
  hawk: bird(1.6, (r, t) => {
    const f0 = r.r(2100, 2400);
    vocal(r, r.out, t, f0, f0 * 0.75, r.r(0.9, 1.2), [[2500, 2], [3800, 3]], 0.5, 'reed');
    r.burst(r.out, t, 1.0, 0.15, { freq: 3000, q: 2, attack: 0.1 });
  }, 2),
  raven: bird(1.3, (r, t) => {
    const n = 2 + Math.floor(r.rng() * 2);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.r(0.3, 0.4);
      vocal(r, r.out, tt, r.r(480, 560), r.r(400, 450), 0.2, [[1100, 3], [1800, 4]], 0.6, 'sawtooth');
      r.burst(r.out, tt, 0.18, 0.2, { freq: 1300, q: 2, attack: 0.02 });
    }
  }, 3),
  owl: bird(2.6, (r, t) => {
    const f = r.r(340, 400);
    const pattern: [number, number][] = r.rng() < 0.5 ? [[0, 0.32], [0.55, 0.22], [0.85, 0.6]] : [[0, 0.5], [0.8, 0.3], [1.2, 0.3]];
    const lp = r.filter('lowpass', 1400, 0.7);
    lp.connect(r.out);
    for (const [dt, d] of pattern) {
      const tt = t + dt;
      const o = r.osc('sine', f, tt, tt + d + 0.1);
      o.frequency.setValueAtTime(f * 1.03, tt);
      o.frequency.linearRampToValueAtTime(f * 0.95, tt + d);
      const g = r.gain(0);
      r.adsr(g.gain, tt, 0.5, 0.07, 0.1, 0.85, d * 0.8, 0.12);
      o.connect(g).connect(lp);
      r.burst(lp, tt, d, 0.05, { freq: 700, q: 1, attack: 0.05 });
    }
  }, 3),
  frog: bird(1.0, (r, t) => {
    const n = 1 + Math.floor(r.rng() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.r(0.25, 0.32);
      const pulse = r.osc('sawtooth', r.r(18, 28), tt, tt + 0.25);
      const bp = r.filter('bandpass', r.r(480, 850), 6);
      const bp2 = r.filter('bandpass', r.r(1300, 1700), 8);
      const g = r.gain(0);
      r.adsr(g.gain, tt, 0.8, 0.02, 0.1, 0.7, 0.16, 0.05);
      pulse.connect(bp).connect(g);
      pulse.connect(bp2).connect(g);
      g.connect(r.out);
    }
  }),
};
