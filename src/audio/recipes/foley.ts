// Player foley: footsteps, block break / place / hit per material, body sounds and hand tools.
import { creak, vocal } from './common';
import type { Recipe, RecipeMap } from './types';
import type { Rend } from '../synth';

const step = (build: (r: Rend, t: number) => void, dur = 0.26): Recipe => ({ dur, variants: 4, priority: 1, peakDb: -20, build });

const FOOTSTEPS: RecipeMap = {
  footstep_grass: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 90, 0.45, 0.08, 0.6);
    r.burst(o, t, 0.09, 0.45, { freq: r.r(2400, 3800), q: 0.8, attack: 0.008 });
    r.grains(o, t + 0.005, 0.1, 10, 0.3, 2500, 6500, 0.01, 1.2);
  }),
  footstep_dirt: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 80, 0.6, 0.09, 0.6);
    r.burst(o, t, 0.07, 0.55, { type: 'lowpass', freq: r.r(1000, 1400), q: 0.8, attack: 0.004 });
    r.grains(o, t, 0.06, 5, 0.25, 800, 2600, 0.01, 1.5);
  }),
  footstep_sand: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 70, 0.3, 0.08, 0.6);
    r.burst(o, t, 0.15, 0.5, { freq: r.r(1500, 2100), q: 0.6, attack: 0.02, sweepTo: 1000 });
    r.grains(o, t, 0.12, 14, 0.14, 3000, 7000, 0.006, 2);
  }, 0.3),
  footstep_gravel: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 85, 0.45, 0.08, 0.6);
    r.grains(o, t, 0.13, 16, 0.5, 1500, 6000, 0.01, 2.5);
    r.burst(o, t, 0.05, 0.3, { type: 'lowpass', freq: 900, q: 0.7 });
  }),
  footstep_stone: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 110, 0.45, 0.05, 0.7);
    r.partial(o, t, r.r(360, 460), 0.1, 0.03);
    r.burst(o, t, 0.02, 0.7, { freq: r.r(2300, 2900), q: 2 });
    r.grains(o, t + 0.01, 0.04, 3, 0.15, 2000, 5000, 0.008, 2);
  }, 0.2),
  footstep_concrete: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 120, 0.4, 0.045, 0.7);
    r.partial(o, t, r.r(480, 560), 0.18, 0.035);
    r.burst(o, t, 0.015, 0.65, { type: 'highpass', freq: 1800, q: 0.8 });
    r.grains(o, t + 0.005, 0.05, 4, 0.12, 4000, 8000, 0.006, 2);
  }, 0.18),
  footstep_wood: step((r, t) => {
    const o = r.out;
    const f = r.r(165, 195);
    r.partial(o, t, f, 0.5, 0.09);
    r.partial(o, t, f * 1.87, 0.3, 0.06);
    r.partial(o, t, f * 3.4, 0.12, 0.04);
    r.burst(o, t, 0.03, 0.4, { freq: 1100, q: 1.5 });
  }, 0.22),
  footstep_metal: step((r, t) => {
    const o = r.out;
    r.metal(o, t, r.r(420, 540), 0.22, 0.3, [1, 2.43, 4.1, 6.8]);
    r.thump(o, t, 140, 0.35, 0.05, 0.7);
    r.burst(o, t, 0.015, 0.3, { freq: 3500, q: 1.5 });
  }, 0.42),
  footstep_snow: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 70, 0.3, 0.08, 0.6);
    r.burst(o, t, 0.12, 0.35, { type: 'lowpass', freq: 1500, q: 0.7, attack: 0.015 });
    r.grains(o, t, 0.12, 24, 0.22, 1200, 4000, 0.006, 3);
  }),
  footstep_water: step((r, t) => {
    const o = r.out;
    r.burst(o, t, 0.18, 0.6, { freq: 900, sweepTo: 2600, q: 0.9, attack: 0.01 });
    r.burst(o, t + 0.02, 0.12, 0.22, { type: 'highpass', freq: 3000, q: 0.7 });
    for (let i = 0; i < 4; i++) r.partial(o, t + r.r(0.03, 0.14), r.r(450, 900), 0.12, 0.05, { drop: 1.7, dropTime: 0.04 });
  }, 0.35),
  footstep_mud: step((r, t) => {
    const o = r.out;
    r.thump(o, t, 60, 0.5, 0.1, 0.6);
    r.burst(o, t, 0.15, 0.5, { type: 'bandpass', freq: 700, sweepTo: 280, q: 1.4, attack: 0.02 });
    r.partial(o, t + 0.06, 260, 0.15, 0.06, { drop: 1.5, dropTime: 0.05 });
  }, 0.3),
};

const oneShot = (dur: number, peakDb: number, build: (r: Rend, t: number) => void, variants = 3): Recipe => ({ dur, variants, priority: 1, peakDb, build });

const BREAK: RecipeMap = {
  break_stone: oneShot(0.65, -14, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.02, 0.8, { type: 'highpass', freq: 2500, q: 0.7 });
    r.thump(o, t, 150, 0.6, 0.12, 0.6);
    r.grains(o, t + 0.01, 0.4, 30, 0.45, 400, 3500, 0.02, 1.4);
    r.burst(o, t + 0.02, 0.3, 0.3, { type: 'lowpass', freq: 800, q: 0.7, attack: 0.02 });
  }),
  break_dirt: oneShot(0.45, -15, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.18, 0.7, { type: 'lowpass', freq: 900, q: 0.8, attack: 0.005 });
    r.grains(o, t, 0.2, 14, 0.35, 700, 2500, 0.015, 1.4);
    r.thump(o, t, 80, 0.5, 0.1, 0.6);
  }),
  break_grass: oneShot(0.45, -15, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.15, 0.6, { type: 'lowpass', freq: 1000, q: 0.8, attack: 0.005 });
    r.grains(o, t, 0.25, 26, 0.3, 2500, 7000, 0.015, 1);
    r.thump(o, t, 85, 0.4, 0.08, 0.6);
  }),
  break_sand: oneShot(0.45, -16, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.28, 0.6, { freq: 1600, sweepTo: 800, q: 0.5, attack: 0.012 });
    r.grains(o, t, 0.25, 20, 0.15, 2000, 6000, 0.006, 2);
  }),
  break_gravel: oneShot(0.5, -15, (r, t) => {
    const o = r.out;
    r.grains(o, t, 0.32, 36, 0.5, 1200, 5000, 0.012, 2.2);
    r.thump(o, t, 90, 0.4, 0.1, 0.6);
    r.burst(o, t, 0.12, 0.3, { type: 'lowpass', freq: 700, q: 0.7 });
  }),
  break_snow: oneShot(0.4, -17, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.2, 0.5, { type: 'lowpass', freq: 1600, q: 0.7, attack: 0.01 });
    r.grains(o, t, 0.2, 30, 0.2, 1500, 4500, 0.006, 3);
  }),
  break_wood: oneShot(0.5, -14, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.03, 0.9, { freq: 2200, q: 1 });
    const f = r.r(220, 260);
    r.partial(o, t, f, 0.5, 0.15);
    r.partial(o, t, f * 2.2, 0.3, 0.1);
    r.partial(o, t, f * 4.9, 0.15, 0.06);
    r.grains(o, t + 0.01, 0.18, 12, 0.3, 2000, 7000, 0.01, 1.5);
  }),
  break_metal: oneShot(1.1, -14, (r, t) => {
    const o = r.out;
    r.metal(o, t, r.r(280, 340), 0.6, 0.85, [1, 2.32, 4.25, 6.63, 9.1]);
    r.thump(o, t, 100, 0.5, 0.12, 0.6);
    r.grains(o, t + 0.05, 0.35, 10, 0.18, 3000, 8000, 0.01, 3);
  }),
  break_glass: oneShot(0.8, -14, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.08, 0.7, { type: 'highpass', freq: 3000, q: 0.7 });
    for (let i = 0; i < 18; i++) {
      const u = r.rng();
      r.partial(o, t + u * u * 0.4, r.r(2500, 9000), r.r(0.08, 0.28), r.r(0.05, 0.25));
    }
  }),
  break_leaves: oneShot(0.5, -17, (r, t) => {
    const o = r.out;
    r.grains(o, t, 0.3, 40, 0.3, 2000, 7000, 0.02, 1);
    r.burst(o, t, 0.25, 0.25, { freq: 3000, q: 0.5, attack: 0.03 });
  }),
  splash: oneShot(0.9, -13, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.35, 0.9, { freq: 600, sweepTo: 3000, q: 0.8, attack: 0.01 });
    r.burst(o, t + 0.05, 0.6, 0.3, { type: 'highpass', freq: 2500, q: 0.7, attack: 0.03 });
    for (let i = 0; i < 7; i++) r.partial(o, t + r.r(0.08, 0.5), r.r(350, 1100), 0.12, 0.06, { drop: 1.8, dropTime: 0.05 });
  }),
};

const PLACE: RecipeMap = {
  place_stone: oneShot(0.22, -16, (r, t) => {
    const o = r.out;
    r.thump(o, t, 140, 0.6, 0.07, 0.6);
    r.burst(o, t, 0.02, 0.5, { freq: 1800, q: 1.4 });
    r.partial(o, t, r.r(560, 640), 0.2, 0.04);
  }),
  place_dirt: oneShot(0.2, -17, (r, t) => {
    const o = r.out;
    r.thump(o, t, 90, 0.6, 0.08, 0.6);
    r.burst(o, t, 0.06, 0.5, { type: 'lowpass', freq: 1000, q: 0.7 });
  }),
  place_sand: oneShot(0.22, -18, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.1, 0.5, { freq: 1500, q: 0.6, attack: 0.01 });
    r.thump(o, t, 80, 0.3, 0.07, 0.6);
    r.grains(o, t, 0.06, 6, 0.15, 3000, 6000, 0.006, 2);
  }),
  place_wood: oneShot(0.22, -16, (r, t) => {
    const o = r.out;
    const f = r.r(190, 215);
    r.partial(o, t, f, 0.6, 0.09);
    r.partial(o, t, f * 2.1, 0.35, 0.06);
    r.burst(o, t, 0.02, 0.4, { freq: 1300, q: 1.2 });
  }),
  place_metal: oneShot(0.5, -15, (r, t) => {
    const o = r.out;
    r.thump(o, t, 130, 0.6, 0.08, 0.6);
    r.metal(o, t, r.r(360, 420), 0.3, 0.35, [1, 2.6, 4.9]);
  }),
  place_pipe: oneShot(0.65, -15, (r, t) => {
    const o = r.out;
    r.thump(o, t, 160, 0.5, 0.07, 0.6);
    const f = r.r(480, 560);
    // tube modes: nearly harmonic → hollow "tonk"
    r.metal(o, t, f, 0.4, 0.5, [1, 2.01, 3.03, 4.8]);
  }),
  place_glass: oneShot(0.3, -18, (r, t) => {
    const o = r.out;
    r.partial(o, t, r.r(2300, 2600), 0.35, 0.12);
    r.partial(o, t, r.r(5000, 5400), 0.15, 0.06);
    r.thump(o, t, 220, 0.2, 0.04, 0.8);
  }),
};

const BODY: RecipeMap = {
  jump: oneShot(0.22, -24, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.12, 0.35, { freq: 700, sweepTo: 1800, q: 0.7, attack: 0.02 });
    r.burst(o, t, 0.04, 0.3, { type: 'lowpass', freq: 1500, q: 0.7 });
  }),
  land: oneShot(0.4, -14, (r, t) => {
    const o = r.out;
    r.thump(o, t, 70, 0.9, 0.18, 0.55);
    r.burst(o, t, 0.12, 0.5, { type: 'lowpass', freq: 600, q: 0.7 });
    r.grains(o, t, 0.08, 6, 0.2, 800, 3000, 0.01, 1.4);
  }),
  damage: oneShot(0.4, -12, (r, t) => {
    const o = r.out;
    r.thump(o, t, 120, 0.9, 0.16, 0.45);
    const f0 = r.r(135, 170);
    vocal(r, o, t + 0.01, f0, f0 * 0.78, 0.17, [[620, 4], [1150, 5], [2400, 6]], 0.6);
    r.burst(o, t, 0.08, 0.25, { freq: 900, q: 0.8 });
  }),
  swing: oneShot(0.25, -24, (r, t) => {
    r.burst(r.out, t, 0.18, 0.5, { freq: 500, sweepTo: 2200, q: 1.2, attack: 0.07 });
  }),
};

const TOOLS: RecipeMap = {
  wrench: oneShot(0.55, -16, (r, t) => {
    const o = r.out;
    for (let i = 0; i < 5; i++) {
      const tt = t + i * r.r(0.03, 0.04);
      r.burst(o, tt, 0.008, 0.35, { freq: 3500, q: 3 });
      r.partial(o, tt, r.r(2300, 2500), 0.08, 0.02);
    }
    r.metal(o, t + 0.22, r.r(820, 980), 0.4, 0.28, [1, 2.7, 5.1]);
    r.thump(o, t + 0.22, 180, 0.3, 0.05, 0.7);
  }),
  scanner_sweep: {
    dur: 1.3, priority: 1, peakDb: -18,
    build(r, t) {
      const o = r.out;
      const osc = r.osc('sine', 500, t, t + 0.6);
      r.sweep(osc.frequency, t, 500, 2600, 0.5);
      const vib = r.osc('sine', 18, t, t + 0.6);
      const vg = r.gain(40);
      vib.connect(vg).connect(osc.frequency);
      const g = r.gain(0);
      r.adsr(g.gain, t, 0.25, 0.08, 0.2, 0.7, 0.42, 0.1);
      osc.connect(g).connect(o);
      for (const [dt, a] of [[0.55, 0.4], [0.78, 0.14], [1.0, 0.05]] as const) r.partial(o, t + dt, 1760, a, 0.35, { attack: 0.003 });
    },
  },
  scanner_blip: oneShot(0.3, -20, (r, t) => {
    r.partial(r.out, t, 1320, 0.4, 0.07, { attack: 0.003 });
    r.partial(r.out, t + 0.07, 1760, 0.35, 0.09, { attack: 0.003 });
  }, 1),
  detector_beep: oneShot(0.14, -18, (r, t) => {
    const osc = r.osc('square', 2350, t, t + 0.1);
    const lp = r.filter('lowpass', 4500, 0.7);
    const g = r.gain(0);
    r.adsr(g.gain, t, 0.3, 0.003, 0.02, 0.8, 0.06, 0.02);
    r.chain(osc, lp, g, r.out);
  }, 1),
  detector_warn: oneShot(0.28, -16, (r, t) => {
    for (const dt of [0, 0.1]) {
      const osc = r.osc('square', 2640, t + dt, t + dt + 0.08);
      const lp = r.filter('lowpass', 5000, 0.7);
      const g = r.gain(0);
      r.adsr(g.gain, t + dt, 0.3, 0.003, 0.02, 0.8, 0.05, 0.015);
      r.chain(osc, lp, g, r.out);
    }
  }, 1),
  detector_danger: oneShot(0.3, -14, (r, t) => {
    for (const dt of [0, 0.07, 0.14]) {
      const osc = r.osc('square', 3100, t + dt, t + dt + 0.06);
      const lp = r.filter('lowpass', 6000, 0.7);
      const g = r.gain(0);
      r.adsr(g.gain, t + dt, 0.3, 0.002, 0.015, 0.8, 0.04, 0.012);
      r.chain(osc, lp, g, r.out);
    }
  }, 1),
  extinguisher_start: oneShot(0.4, -14, (r, t) => {
    const o = r.out;
    r.burst(o, t, 0.3, 0.8, { type: 'highpass', freq: 1500, q: 0.7, attack: 0.004 });
    r.metal(o, t, 2200, 0.15, 0.05, [1, 1.6]);
  }, 1),
  thump: oneShot(0.4, -12, (r, t) => {
    r.thump(r.out, t, 70, 0.9, 0.22, 0.55);
    r.burst(r.out, t, 0.08, 0.4, { type: 'lowpass', freq: 500, q: 0.7 });
  }, 2),
  clank: oneShot(0.6, -13, (r, t) => {
    r.metal(r.out, t, r.r(520, 680), 0.5, 0.45, [1, 2.42, 3.9, 6.1]);
    r.thump(r.out, t, 150, 0.4, 0.07, 0.6);
  }),
  hiss: oneShot(0.9, -16, (r, t) => {
    r.burst(r.out, t, 0.7, 0.6, { type: 'highpass', freq: 2000, q: 0.7, attack: 0.03 });
    r.burst(r.out, t, 0.5, 0.25, { freq: 5000, q: 1, attack: 0.05 });
  }, 2),
  whoosh: oneShot(0.7, -15, (r, t) => {
    r.burst(r.out, t, 0.5, 0.7, { color: 'pink', freq: 350, sweepTo: 2400, q: 1, attack: 0.18 });
  }, 2),
  creak: oneShot(1.2, -16, (r, t) => {
    creak(r, r.out, t, 1.0, r.r(20, 26), r.r(34, 42), r.r(900, 1300), 0.6);
  }, 2),
};

export const FOLEY_RECIPES: RecipeMap = { ...FOOTSTEPS, ...BREAK, ...PLACE, ...BODY, ...TOOLS };
