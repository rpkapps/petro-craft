// Interface sounds: tactile, soft, harmonically consistent (built around E / B / G so they sit together).
import { mtof } from '../dsp';
import { fmBell } from './common';
import type { RecipeMap } from './types';

export const UI_RECIPES: RecipeMap = {
  click: {
    dur: 0.12, priority: 0, peakDb: -22, variants: 2,
    build(r, t) {
      const o = r.out;
      r.partial(o, t, r.r(1750, 1900), 0.5, 0.035, { drop: 0.72, dropTime: 0.03 });
      r.partial(o, t, 3650, 0.12, 0.018);
      r.burst(o, t, 0.008, 0.35, { freq: 4200, q: 1.2 });
      r.thump(o, t, 230, 0.22, 0.045, 0.8);
    },
  },
  hover: {
    dur: 0.07, priority: 0, peakDb: -36,
    build(r, t) {
      const o = r.out;
      r.partial(o, t, 2640, 0.4, 0.028, { attack: 0.004 });
      r.burst(o, t, 0.012, 0.15, { freq: 6000, q: 1.5, attack: 0.002 });
    },
  },
  open: {
    dur: 0.5, priority: 0, peakDb: -21,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 0.16, 0.35, { color: 'pink', type: 'bandpass', freq: 500, sweepTo: 3200, q: 1.1, attack: 0.06 });
      const lp = r.filter('lowpass', 3500, 0.7);
      lp.connect(o);
      for (const [dt, m] of [[0.02, 76], [0.075, 83]] as const) {
        const osc = r.osc('triangle', mtof(m), t + dt, t + dt + 0.4);
        const g = r.gain(0);
        r.perc(g.gain, t + dt, 0.28, 0.006, 0.28);
        osc.connect(g).connect(lp);
      }
    },
  },
  close: {
    dur: 0.45, priority: 0, peakDb: -22,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 0.14, 0.3, { color: 'pink', type: 'bandpass', freq: 2600, sweepTo: 450, q: 1.1, attack: 0.03 });
      const lp = r.filter('lowpass', 2800, 0.7);
      lp.connect(o);
      for (const [dt, m] of [[0.0, 83], [0.06, 76]] as const) {
        const osc = r.osc('triangle', mtof(m), t + dt, t + dt + 0.35);
        const g = r.gain(0);
        r.perc(g.gain, t + dt, 0.25, 0.005, 0.22);
        osc.connect(g).connect(lp);
      }
    },
  },
  error: {
    dur: 0.5, priority: 0, peakDb: -18,
    build(r, t) {
      const o = r.out;
      const lp = r.filter('lowpass', 1300, 0.8);
      lp.connect(o);
      for (const [dt, f] of [[0, 220], [0.13, 174.6]] as const) {
        const osc = r.osc('hollow', f, t + dt, t + dt + 0.25);
        const g = r.gain(0);
        r.adsr(g.gain, t + dt, 0.5, 0.008, 0.06, 0.6, 0.1, 0.06);
        osc.connect(g).connect(lp);
      }
      r.thump(o, t, 120, 0.3, 0.12, 0.7);
    },
  },
  success: {
    dur: 1.3, priority: 0, peakDb: -16, channels: 2,
    build(r, t) {
      const notes = [84, 88, 91];
      notes.forEach((m, i) => {
        const p = r.pan(-0.3 + i * 0.3);
        p.connect(r.out);
        fmBell(r, p, t + i * 0.07, mtof(m), 0.35, 0.8, 2, 0.8);
      });
      const p = r.pan(0.1);
      p.connect(r.out);
      fmBell(r, p, t + 0.24, mtof(96), 0.12, 0.9, 3.5, 0.6);
    },
  },
  cash: {
    dur: 1.7, priority: 0, peakDb: -13, channels: 2,
    build(r, t) {
      const o = r.out;
      // "cha": drawer slam & mechanism
      r.burst(o, t, 0.06, 0.55, { freq: 2600, q: 0.9, attack: 0.002 });
      r.thump(o, t, 140, 0.45, 0.09, 0.7);
      r.metal(o, t + 0.005, 3200, 0.12, 0.06, [1, 1.5, 2.3]);
      // coins
      for (let i = 0; i < 7; i++) {
        const p = r.pan(r.r(-0.6, 0.6));
        p.connect(o);
        r.metal(p, t + 0.04 + r.r(0, 0.3), r.r(4200, 6800), r.r(0.05, 0.12), r.r(0.08, 0.2), [1, 1.34, 2.08]);
      }
      // "ching": two bells
      const bl = r.pan(-0.2);
      const br = r.pan(0.25);
      bl.connect(o);
      br.connect(o);
      r.metal(bl, t + 0.11, 1568, 0.45, 1.2, [1, 2.01, 2.76, 4.07, 5.4]);
      r.metal(br, t + 0.17, 2093, 0.3, 1.0, [1, 2.01, 2.76, 4.07]);
    },
  },
  notify: {
    dur: 1.9, priority: 0, peakDb: -17, channels: 2,
    build(r, t) {
      const a = r.pan(-0.2);
      const b = r.pan(0.2);
      a.connect(r.out);
      b.connect(r.out);
      fmBell(r, a, t, mtof(79), 0.4, 1.3, 2, 1.1);
      fmBell(r, b, t + 0.11, mtof(86), 0.32, 1.5, 2, 0.9);
    },
  },
  warn: {
    dur: 1.2, priority: 0, peakDb: -16, channels: 2,
    build(r, t) {
      const lp = r.filter('lowpass', 2600, 0.7);
      lp.connect(r.out);
      for (const [dt, m] of [[0, 76], [0.16, 73]] as const) {
        fmBell(r, lp, t + dt, mtof(m), 0.35, 0.7, 1.5, 1.4);
        const osc = r.osc('hollow', mtof(m - 12), t + dt, t + dt + 0.3);
        const g = r.gain(0);
        r.adsr(g.gain, t + dt, 0.12, 0.01, 0.08, 0.5, 0.12, 0.1);
        osc.connect(g).connect(lp);
      }
    },
  },
  danger: {
    dur: 1.1, priority: 0, peakDb: -14, channels: 2,
    build(r, t) {
      const lp = r.filter('lowpass', 3000, 0.8);
      lp.connect(r.out);
      const notes = [81, 77, 74];
      notes.forEach((m, i) => {
        const tt = t + i * 0.12;
        const osc = r.osc('reed', mtof(m), tt, tt + 0.3);
        const trem = r.osc('sine', 22, tt, tt + 0.3);
        const tg = r.gain(0.3);
        const g = r.gain(0);
        r.adsr(g.gain, tt, 0.45, 0.006, 0.05, 0.7, 0.09, 0.08);
        trem.connect(tg).connect(g.gain);
        osc.connect(g).connect(lp);
      });
      r.thump(r.out, t, 90, 0.4, 0.25, 0.7);
    },
  },
  alarm: {
    // Industrial klaxon: two buzzy blasts with a formant horn body.
    dur: 1.35, priority: 0, peakDb: -12,
    build(r, t) {
      const o = r.out;
      for (const tb of [0, 0.62]) {
        const tt = t + tb;
        const sum = r.gain(1);
        for (const [f, kind, a] of [[196, 'sawtooth', 0.5], [293.7, 'square', 0.25], [98, 'sawtooth', 0.3]] as const) {
          const osc = r.osc(kind, f, tt, tt + 0.55);
          osc.frequency.setValueAtTime(f * 0.82, tt);
          osc.frequency.exponentialRampToValueAtTime(f, tt + 0.07);
          const g = r.gain(a);
          osc.connect(g).connect(sum);
        }
        const sh = r.shaper(3);
        const bp = r.filter('peaking', 1150, 1.4, 9);
        const lp = r.filter('lowpass', 3600, 0.7);
        const hp = r.filter('highpass', 140, 0.7);
        const env = r.gain(0);
        r.adsr(env.gain, tt, 0.6, 0.035, 0.1, 0.9, 0.44, 0.06);
        r.chain(sum, sh, bp, lp, hp, env, o);
      }
    },
  },
  saved: {
    dur: 0.6, priority: 0, peakDb: -26,
    build(r, t) {
      const o = r.out;
      r.partial(o, t, mtof(76), 0.3, 0.25, { attack: 0.01 });
      r.partial(o, t + 0.09, mtof(83), 0.26, 0.35, { attack: 0.01 });
      r.thump(o, t, 180, 0.08, 0.1, 0.9);
    },
  },
  pickup: {
    dur: 0.25, priority: 1, peakDb: -20,
    build(r, t) {
      r.partial(r.out, t, 900, 0.4, 0.12, { drop: 1.9, dropTime: 0.06 });
      r.partial(r.out, t + 0.03, 1500, 0.2, 0.1, { drop: 1.4, dropTime: 0.05 });
    },
  },
  stamp: {
    dur: 0.4, priority: 2, peakDb: -15,
    build(r, t) {
      const o = r.out;
      r.thump(o, t, 170, 0.8, 0.07, 0.6);
      r.burst(o, t, 0.035, 0.5, { freq: 1500, q: 0.9 });
      r.burst(o, t + 0.02, 0.12, 0.25, { freq: 3200, q: 0.6, attack: 0.01 });
    },
  },
};
