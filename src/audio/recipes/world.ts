// World event one-shots: construction, hazards, explosions, thunder, well control, and musical stings.
// Stings are written in C and transposed at playback to the current music key.
import { mtof } from '../dsp';
import { creak, ensemble, fmBell, softPluck, timpani } from './common';
import type { RecipeMap } from './types';

export const WORLD_RECIPES: RecipeMap = {
  construct: {
    dur: 1.4, variants: 3, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      [0, r.r(0.14, 0.2), r.r(0.32, 0.4)].forEach((dt, i) => {
        const tt = t + dt;
        r.thump(o, tt, r.r(55, 75), 0.9 - i * 0.15, 0.25, 0.55);
        r.burst(o, tt, 0.12, 0.4, { type: 'lowpass', freq: 420, q: 0.7 });
        r.metal(o, tt + 0.005, r.r(240, 420), 0.22, 0.45, [1, 2.3, 3.7, 5.9]);
      });
      r.grains(o, t + 0.05, 0.8, 22, 0.14, 600, 3000, 0.02, 1.2);
    },
  },
  demolish: {
    dur: 2.4, variants: 2, priority: 2, peakDb: -9,
    build(r, t) {
      const o = r.out;
      r.thump(o, t, 48, 1, 0.9, 0.6);
      r.burst(o, t, 1.6, 0.6, { color: 'brown', type: 'lowpass', freq: 380, q: 0.7, attack: 0.05 });
      r.grains(o, t, 1.6, 60, 0.4, 300, 3200, 0.03, 1.2);
      for (let i = 0; i < 4; i++) r.metal(o, t + r.r(0.1, 1.2), r.r(150, 420), 0.25, 0.8, [1, 2.2, 3.4, 5.3]);
      creak(r, o, t + 0.2, 1.2, 16, 9, 420, 0.35);
    },
  },
  breakdown: {
    dur: 1.8, variants: 2, priority: 2, peakDb: -11,
    build(r, t) {
      const o = r.out;
      const saw = r.osc('sawtooth', 90, t, t + 1.3);
      r.sweep(saw.frequency, t, 90, 32, 1.1);
      const sh = r.shaper(4);
      const lp = r.filter('lowpass', 700, 1.2);
      const g = r.gain(0);
      r.adsr(g.gain, t, 0.5, 0.02, 0.4, 0.8, 1.0, 0.25);
      r.chain(saw, sh, lp, g, o);
      // grinding noise, amplitude-modulated
      const n = r.noiseSrc('white', t, t + 1.2);
      const bp = r.filter('bandpass', 1400, 2);
      const am = r.gain(0.2);
      const lfo = r.osc('square', 23, t, t + 1.2);
      const lg = r.gain(0.18);
      lfo.connect(lg).connect(am.gain);
      const env = r.gain(0);
      r.adsr(env.gain, t, 1, 0.05, 0.5, 0.6, 0.9, 0.2);
      r.chain(n, bp, am, env, o);
      r.metal(o, t + 1.15, 210, 0.5, 0.6, [1, 2.5, 4.1]);
      r.thump(o, t + 1.15, 80, 0.6, 0.2, 0.6);
    },
  },
  fire_ignite: {
    dur: 1.4, variants: 3, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 0.55, 0.9, { color: 'pink', type: 'lowpass', freq: 300, sweepTo: 2600, q: 0.9, attack: 0.08 });
      r.thump(o, t + 0.04, 60, 0.7, 0.4, 0.6);
      r.grains(o, t + 0.15, 1.0, 22, 0.25, 1500, 5000, 0.008, 2);
    },
  },
  fire_out: {
    dur: 1.4, variants: 2, priority: 2, peakDb: -14,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 1.1, 0.5, { freq: 6000, sweepTo: 2200, q: 0.8, attack: 0.02 });
      r.grains(o, t, 0.9, 10, 0.2, 1200, 4000, 0.008, 2);
    },
  },
  explosion_near: {
    dur: 4.5, variants: 3, priority: 2, peakDb: -2,
    build(r, t) {
      const glue = r.shaper(1.6);
      glue.connect(r.out);
      r.burst(glue, t, 0.05, 1.0, { type: 'highpass', freq: 1200, q: 0.7, attack: 0.0005 });
      const body = r.gain(1);
      const sh = r.shaper(3);
      body.connect(sh).connect(glue);
      r.thump(body, t, r.r(52, 62), 1.0, 1.3, 0.45);
      r.burst(glue, t, 1.3, 0.8, { color: 'pink', type: 'lowpass', freq: 2600, sweepTo: 280, q: 0.7, attack: 0.002 });
      r.burst(glue, t + 0.02, 3.8, 1.0, { color: 'brown', type: 'lowpass', freq: 190, q: 0.8, attack: 0.04 });
      r.grains(glue, t + 0.3, 2.6, 40, 0.22, 800, 5000, 0.02, 1.2);
    },
  },
  explosion_far: {
    dur: 5, variants: 2, priority: 2, peakDb: -4, lowRate: true,
    build(r, t) {
      const o = r.out;
      r.thump(o, t, 40, 0.8, 1.6, 0.6);
      r.burst(o, t, 4.2, 1.0, { color: 'brown', type: 'lowpass', freq: 220, q: 0.8, attack: 0.15 });
      r.burst(o, t, 1.2, 0.3, { color: 'pink', type: 'lowpass', freq: 600, sweepTo: 150, q: 0.7, attack: 0.05 });
    },
  },
  thunder_near: {
    dur: 7, variants: 3, channels: 2, priority: 2, peakDb: -3,
    build(r, t) {
      const o = r.out;
      const c = r.pan(r.r(-0.3, 0.3));
      c.connect(o);
      r.burst(c, t, 0.25, 0.9, { type: 'highpass', freq: 2000, q: 0.7, attack: 0.002 });
      r.burst(c, t, 0.7, 0.35, { freq: 4000, q: 0.8, attack: 0.01 });
      r.grains(c, t, 0.18, 30, 0.6, 1000, 6000, 0.01, 1);
      r.thump(c, t + 0.02, 50, 1, 1.0, 0.6);
      const rolls = 5 + Math.floor(r.rng() * 4);
      for (let i = 0; i < rolls; i++) {
        const p = r.pan(r.r(-0.9, 0.9));
        p.connect(o);
        r.burst(p, t + r.r(0.2, 4.2), r.r(0.8, 2.2), r.r(0.4, 1), { color: 'brown', type: 'lowpass', freq: r.r(130, 320), q: 0.8, attack: r.r(0.05, 0.4) });
      }
    },
  },
  thunder_far: {
    dur: 8, variants: 3, channels: 2, priority: 3, peakDb: -5, lowRate: true,
    build(r, t) {
      const o = r.out;
      const rolls = 4 + Math.floor(r.rng() * 4);
      for (let i = 0; i < rolls; i++) {
        const p = r.pan(r.r(-0.8, 0.8));
        p.connect(o);
        r.burst(p, t + r.r(0, 4.5), r.r(1.2, 3), r.r(0.4, 1), { color: 'brown', type: 'lowpass', freq: r.r(90, 170), q: 0.8, attack: r.r(0.3, 0.9) });
      }
      r.thump(o, t + 0.1, 38, 0.4, 1.8, 0.8);
    },
  },
  blowout_roar: {
    dur: 5, variants: 1, priority: 2, peakDb: -4,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 4.2, 1, { color: 'brown', type: 'lowpass', freq: 260, q: 0.8, attack: 0.5 });
      r.burst(o, t, 4, 0.6, { color: 'pink', freq: 650, q: 0.5, attack: 0.3 });
      r.burst(o, t + 0.2, 3.5, 0.3, { type: 'highpass', freq: 3000, q: 0.7, attack: 0.2 });
      r.thump(o, t, 40, 0.8, 1.2, 0.7);
    },
  },
  kick_alarm: {
    // Electric alarm bell: fast striker on a bright bell.
    dur: 2.1, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      const lp = r.filter('lowpass', 6000, 0.7);
      lp.connect(o);
      for (let i = 0; i < 30; i++) {
        const tt = t + i / 17;
        const a = 0.35 * (i < 2 ? 0.6 : 1) * (i > 26 ? (30 - i) / 4 : 1);
        r.partial(lp, tt, 1250, a, 0.2);
        r.partial(lp, tt, 1250 * 2.12, a * 0.45, 0.12);
        r.partial(lp, tt, 1250 * 3.9, a * 0.2, 0.07);
        r.burst(lp, tt, 0.006, a * 0.4, { type: 'highpass', freq: 4000, q: 0.7 });
      }
    },
  },
  leak_hiss: {
    dur: 1.9, variants: 2, priority: 2, peakDb: -12,
    build(r, t) {
      r.burst(r.out, t, 1.6, 0.6, { type: 'highpass', freq: 2500, q: 0.7, attack: 0.05 });
      r.burst(r.out, t, 1.4, 0.3, { freq: 5000, q: 1.2, attack: 0.1 });
    },
  },
  spill: {
    dur: 1.3, variants: 2, priority: 2, peakDb: -13,
    build(r, t) {
      const o = r.out;
      for (let i = 0; i < 7; i++) r.partial(o, t + i * r.r(0.1, 0.16), r.r(160, 320), 0.3, 0.12, { drop: 1.6, dropTime: 0.08 });
      r.burst(o, t, 1.0, 0.4, { type: 'lowpass', freq: 600, q: 1.2, attack: 0.1, color: 'pink' });
    },
  },
  spud: {
    dur: 2.2, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      r.metal(o, t, 180, 0.5, 0.8, [1, 2.4, 3.8, 5.6]);
      r.thump(o, t, 70, 0.7, 0.3, 0.6);
      const saw = r.osc('sawtooth', 28, t + 0.2, t + 2.1);
      r.sweep(saw.frequency, t + 0.2, 28, 46, 1.2);
      const lp = r.filter('lowpass', 380, 1.5);
      const sh = r.shaper(2.5);
      const g = r.gain(0);
      r.adsr(g.gain, t + 0.2, 0.6, 0.4, 0.5, 0.8, 1.4, 0.3);
      r.chain(saw, lp, sh, g, o);
    },
  },
  sonar: {
    dur: 2.6, priority: 2, peakDb: -16,
    build(r, t) {
      const lp = r.filter('lowpass', 3000, 0.7);
      lp.connect(r.out);
      for (const [dt, a] of [[0, 0.5], [0.36, 0.18], [0.72, 0.07]] as const) fmBell(r, lp, t + dt, 1175, a, 1.2, 1.0, 0.3);
    },
  },

  // ---------------------------------------------------------------------------------------------
  // Musical stings (key of C; transposed at playback)
  // ---------------------------------------------------------------------------------------------
  sting_complete: {
    dur: 3.4, channels: 2, priority: 2, peakDb: -9,
    build(r, t) {
      const o = r.out;
      ensemble(r, o, t, [67], 0.1, 0.35, { shape: 'reed', attack: 0.02, release: 0.1, cutPeak: 2200 });
      ensemble(r, o, t + 0.14, [72], 0.1, 0.35, { shape: 'reed', attack: 0.02, release: 0.1, cutPeak: 2400 });
      ensemble(r, o, t + 0.28, [48, 55, 60, 64, 67, 72, 76], 1.3, 0.8, { attack: 0.05, release: 1.2, cutPeak: 3000, cutSus: 1600 });
      timpani(r, o, t + 0.28, 65, 0.6);
      const bp = r.pan(0.2);
      bp.connect(o);
      fmBell(r, bp, t + 0.3, mtof(84), 0.25, 2.2, 3.5, 1.2);
      [72, 76, 79, 84].forEach((m, i) => {
        const p = r.pan(-0.5 + i * 0.33);
        p.connect(o);
        softPluck(r, p, t + 0.6 + i * 0.09, m + 12, 0.1, 0.9);
      });
    },
  },
  sting_research: {
    dur: 3.8, channels: 2, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      [72, 76, 79, 83, 86, 90].forEach((m, i) => {
        const p = r.pan(-0.6 + i * 0.24);
        p.connect(o);
        fmBell(r, p, t + i * 0.085, mtof(m), 0.3, 1.9, 2, 1);
      });
      ensemble(r, o, t + 0.1, [48, 55, 64, 71, 74], 1.8, 0.45, { attack: 0.5, release: 1.4, cutFrom: 400, cutPeak: 1800, cutSus: 1400, drive: 1 });
      const sparkle = r.pan(0);
      sparkle.connect(o);
      for (let i = 0; i < 8; i++) r.partial(sparkle, t + 0.5 + i * 0.12, mtof(pickFrom(r.rng(), [96, 100, 103, 107])), 0.05, 0.4);
    },
  },
  sting_contract: {
    dur: 3.0, channels: 2, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      ensemble(r, o, t, [53, 60, 65, 69], 0.4, 0.6, { attack: 0.03, release: 0.3, cutPeak: 2200 });
      ensemble(r, o, t + 0.5, [48, 55, 64, 67, 72], 1.4, 0.7, { attack: 0.04, release: 1.1, cutPeak: 2600 });
      const p = r.pan(0.15);
      p.connect(o);
      fmBell(r, p, t, mtof(81), 0.22, 0.9, 2, 1);
      fmBell(r, p, t + 0.5, mtof(79), 0.26, 2, 2, 1);
      timpani(r, o, t + 0.5, 65, 0.45);
    },
  },
  sting_discovery: {
    dur: 6, channels: 2, priority: 2, peakDb: -7,
    build(r, t) {
      const o = r.out;
      // subterranean rumble building to the gush
      const rum = r.burst(o, t, 1.3, 0.9, { color: 'brown', type: 'lowpass', freq: 200, q: 0.8, attack: 0.85 });
      void rum;
      const gush = r.pan(0);
      gush.connect(o);
      r.burst(gush, t + 0.9, 2.2, 0.55, { color: 'pink', type: 'lowpass', freq: 400, sweepTo: 5200, q: 0.7, attack: 0.03 });
      r.burst(gush, t + 1.0, 1.8, 0.2, { type: 'highpass', freq: 4000, q: 0.7, attack: 0.1 });
      ensemble(r, o, t + 0.3, [67], 0.12, 0.35, { shape: 'reed', attack: 0.02, release: 0.1 });
      ensemble(r, o, t + 0.55, [67], 0.12, 0.35, { shape: 'reed', attack: 0.02, release: 0.1 });
      ensemble(r, o, t + 0.9, [36, 48, 55, 60, 64, 67, 72], 0.9, 0.85, { attack: 0.05, release: 0.4, cutPeak: 3200 });
      ensemble(r, o, t + 1.9, [41, 53, 57, 60, 65, 69, 72], 0.6, 0.75, { attack: 0.05, release: 0.3, cutPeak: 3000 });
      ensemble(r, o, t + 2.6, [36, 48, 55, 60, 64, 67, 76], 1.8, 0.85, { attack: 0.05, release: 1.4, cutPeak: 3400, cutSus: 1800 });
      timpani(r, o, t + 0.9, 65, 0.8);
      timpani(r, o, t + 1.9, 58, 0.6);
      timpani(r, o, t + 2.6, 65, 0.9, 1.6);
      const bp = r.pan(0.25);
      bp.connect(o);
      fmBell(r, bp, t + 2.62, mtof(88), 0.25, 2.6, 3.5, 1.3);
    },
  },
  sting_dry: {
    dur: 2.6, channels: 2, priority: 2, peakDb: -12,
    build(r, t) {
      const o = r.out;
      const notes: [number, number, number][] = [[0, 55, 0.3], [0.36, 54, 0.3], [0.72, 53, 0.3], [1.08, 52, 0.9]];
      for (const [dt, m, d] of notes) {
        const tt = t + dt;
        const osc = r.osc('reed', mtof(m), tt, tt + d + 0.3);
        if (d > 0.5) r.sweep(osc.frequency, tt + 0.3, mtof(m), mtof(m) * 0.94, d);
        const wah = r.filter('bandpass', 400, 3);
        wah.frequency.setValueAtTime(380, tt);
        wah.frequency.linearRampToValueAtTime(1100, tt + 0.1);
        wah.frequency.linearRampToValueAtTime(480, tt + d);
        const g = r.gain(0);
        r.adsr(g.gain, tt, 0.5, 0.04, 0.2, 0.75, d, 0.2);
        const lp = r.filter('lowpass', 1200, 0.7);
        r.chain(osc, wah, lp, g, o);
      }
      r.thump(o, t + 1.1, 55, 0.4, 0.5, 0.8);
    },
  },
  sting_relief: {
    dur: 3, channels: 2, priority: 2, peakDb: -12,
    build(r, t) {
      const o = r.out;
      ensemble(r, o, t, [48, 55, 62, 64, 69], 1.5, 0.5, { attack: 0.35, release: 1.2, cutFrom: 500, cutPeak: 1900, cutSus: 1400, drive: 1 });
      const p = r.pan(0.1);
      p.connect(o);
      fmBell(r, p, t + 0.2, mtof(79), 0.25, 1.8, 2, 1);
      fmBell(r, p, t + 0.45, mtof(84), 0.2, 2, 2, 1);
    },
  },
  sting_fail: {
    dur: 2.6, channels: 2, priority: 2, peakDb: -13,
    build(r, t) {
      const o = r.out;
      ensemble(r, o, t, [45, 52, 60, 64], 0.5, 0.5, { attack: 0.08, release: 0.4, cutPeak: 1300, cutSus: 900 });
      ensemble(r, o, t + 0.55, [44, 51, 59, 62], 1.2, 0.5, { attack: 0.1, release: 1.0, cutPeak: 1100, cutSus: 700 });
      const p = r.pan(0);
      p.connect(o);
      fmBell(r, p, t + 0.55, mtof(71), 0.15, 1.6, 2, 0.8);
    },
  },
  sting_death: {
    dur: 3.6, channels: 2, priority: 2, peakDb: -10,
    build(r, t) {
      const o = r.out;
      timpani(r, o, t, 48, 0.9, 2);
      ensemble(r, o, t + 0.05, [36, 43, 48, 51, 55], 2, 0.6, { attack: 0.4, release: 1.4, cutFrom: 300, cutPeak: 900, cutSus: 600 });
      r.burst(o, t, 2.5, 0.4, { color: 'brown', type: 'lowpass', freq: 160, q: 0.7, attack: 0.3 });
    },
  },
  sting_respawn: {
    dur: 2.6, channels: 2, priority: 2, peakDb: -14,
    build(r, t) {
      const o = r.out;
      r.burst(o, t, 1.0, 0.4, { color: 'pink', freq: 300, sweepTo: 4000, q: 0.8, attack: 0.9 });
      const p = r.pan(0);
      p.connect(o);
      fmBell(r, p, t + 0.95, mtof(79), 0.3, 1.5, 2, 0.8);
      fmBell(r, p, t + 1.05, mtof(84), 0.22, 1.5, 2, 0.8);
    },
  },
};

function pickFrom(u: number, arr: number[]): number {
  return arr[Math.floor(u * arr.length) % arr.length];
}
