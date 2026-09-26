// Seamless looping beds for machines, hazards and the environment. Each is rendered once (dur = loop +
// crossfade tail), the tail is crossfaded into the head, and the result is RMS-normalised. Periodic
// content uses `qf()` so every oscillator completes whole cycles within the loop.
import { creak } from './common';
import { qf, type Recipe, type RecipeMap } from './types';
import type { Rend } from '../synth';

const XF = 0.6; // crossfade tail length (s)

function loopRecipe(len: number, build: (r: Rend, t: number, len: number) => void, o: Partial<Recipe> = {}): Recipe {
  return { dur: len + XF, loop: len, priority: 3, rmsDb: -20, ...o, build: (r, t) => build(r, t, len) };
}

/** Amplitude-modulate `src` by an LFO: returns the modulated gain node. */
function am(r: Rend, src: AudioNode, base: number, depth: number, lfoHz: number, t: number, end: number, shape: OscillatorType = 'sine'): GainNode {
  const g = r.gain(base);
  const l = r.osc(shape, lfoHz, t, end);
  const lg = r.gain(depth);
  l.connect(lg).connect(g.gain);
  src.connect(g);
  return g;
}

/** Slow random amplitude flutter using very slowly played noise as a control signal. */
function flutter(r: Rend, src: AudioNode, base: number, depth: number, t: number, end: number, speed = 0.08): GainNode {
  const g = r.gain(base);
  const n = r.noiseSrc('brown', t, end, speed);
  const ng = r.gain(depth);
  n.connect(ng).connect(g.gain);
  src.connect(g);
  return g;
}

export const LOOP_RECIPES: RecipeMap = {
  // --------------------------------------------------------------------------------- machines
  loop_diesel: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const fire = r.osc('sawtooth', qf(28, L), t, end);
    const lp = r.filter('lowpass', 230, 2);
    const sh = r.shaper(2.5);
    const g1 = r.gain(0.6);
    r.chain(fire, lp, sh, g1, o);
    const h2 = r.osc('warm', qf(56, L), t, end);
    const lp2 = r.filter('lowpass', 520, 0.8);
    const g2 = r.gain(0.22);
    r.chain(h2, lp2, g2, o);
    const clat = r.noiseSrc('white', t, end);
    const bp = r.filter('bandpass', 1400, 1.2);
    clat.connect(bp);
    const clg = am(r, bp, 0.07, 0.07, qf(28, L), t, end, 'square');
    clg.connect(o);
    const rumble = r.noiseSrc('brown', t, end);
    const rlp = r.filter('lowpass', 120, 0.7);
    const rg = r.gain(0.35);
    r.chain(rumble, rlp, rg, o);
    const turbo = r.osc('sine', qf(2350, L), t, end);
    const tg = r.gain(0.012);
    r.chain(turbo, tg, o);
  }, { lowRate: true }),

  loop_rotary: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    // mud pump chuffs (2 Hz)
    for (let k = 0; k * 0.5 < L + XF; k++) {
      const tt = t + k * 0.5;
      r.thump(o, tt, 55, 0.45, 0.25, 0.7);
      r.burst(o, tt, 0.15, 0.22, { type: 'lowpass', freq: 420, q: 0.8 });
    }
    // top-drive hydraulic whine, slowly beating
    const w1 = r.osc('sine', qf(310, L), t, end);
    const w2 = r.osc('sine', qf(465, L), t, end);
    const wg = r.gain(0.05);
    w1.connect(wg);
    w2.connect(wg);
    am(r, wg, 0.6, 0.4, qf(0.75, L), t, end).connect(o);
    // pipe / tong clanks
    let tt = t + r.r(0.1, 0.4);
    while (tt < t + L + XF - 0.2) {
      r.metal(o, tt, r.r(180, 320), r.r(0.04, 0.13), 0.45, [1, 2.4, 3.9, 6.2]);
      tt += r.r(0.45, 1.1);
    }
    // drill-string rotation: low grinding band, pulsing with the rotary table (~100 rpm)
    const grind = r.noiseSrc('brown', t, end, 1.5);
    const gbp = r.filter('bandpass', 260, 1.5);
    grind.connect(gbp);
    am(r, gbp, 0.25, 0.12, qf(1.75, L), t, end).connect(o);
    // chain rattle
    r.grains(o, t + r.r(0.5, 1.5), 0.4, 18, 0.1, 2000, 6000, 0.01, 2);
    r.grains(o, t + r.r(2.3, 3.2), 0.4, 18, 0.1, 2000, 6000, 0.01, 2);
  }, { lowRate: true }),

  loop_tripping: loopRecipe(6, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const m = r.osc('sawtooth', 150, t, end);
    r.ramp(m.frequency, t, [[0, 150], [2, 260], [3.5, 260], [5.5, 150], [L + XF, 150]]);
    const lp = r.filter('lowpass', 800, 1.2);
    const mg = r.gain(0.18);
    r.chain(m, lp, mg, o);
    const hum = r.osc('sawtooth', qf(28, L), t, end);
    const hlp = r.filter('lowpass', 160, 1);
    const hg = r.gain(0.3);
    r.chain(hum, hlp, hg, o);
    r.metal(o, t + 2.8, 240, 0.35, 0.7, [1, 2.4, 3.9, 6.2]);
    r.metal(o, t + 5.8, 300, 0.3, 0.6, [1, 2.4, 3.9, 6.2]);
    r.grains(o, t + 0.5, 1.2, 25, 0.08, 2000, 6000, 0.01, 2);
  }, { lowRate: true }),

  loop_pumpjack: loopRecipe(5, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    // one stroke = 5 s (12 strokes/min at rate 1)
    const cycle = (c: number) => {
      creak(r, o, c + 0.6, 1.3, 24, 38, 1100, 0.5);
      r.thump(o, c + 2.3, 90, 0.35, 0.15, 0.7);
      r.metal(o, c + 2.3, 260, 0.18, 0.3, [1, 2.5, 4.2]);
      creak(r, o, c + 3.0, 1.1, 30, 20, 850, 0.4);
      r.thump(o, c + 4.6, 60, 0.55, 0.25, 0.6);
      r.burst(o, c + 4.6, 0.1, 0.2, { type: 'lowpass', freq: 300, q: 0.7 });
    };
    cycle(t);
    cycle(t + L);
    const hum = r.osc('sine', qf(60, L), t, end);
    const hum2 = r.osc('sine', qf(120, L), t, end);
    const hg = r.gain(0.022);
    hum.connect(hg);
    const hg2 = r.gain(0.012);
    hum2.connect(hg2);
    hg.connect(o);
    hg2.connect(o);
    const belt = r.noiseSrc('pink', t, end);
    const bbp = r.filter('bandpass', 900, 2);
    belt.connect(bbp);
    am(r, bbp, 0.035, 0.015, qf(0.2, L), t, end).connect(o);
  }, { lowRate: true }),

  loop_compressor: loopRecipe(2, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const th = r.osc('warm', qf(90, L), t, end);
    const lp = r.filter('lowpass', 600, 0.8);
    th.connect(lp);
    am(r, lp, 0.3, 0.2, qf(15, L), t, end).connect(o);
    const n = r.noiseSrc('white', t, end);
    const bp = r.filter('bandpass', 3200, 2);
    n.connect(bp);
    am(r, bp, 0.05, 0.05, qf(15, L), t, end, 'square').connect(o);
    const wh = r.osc('sine', qf(1180, L), t, end);
    const wg = r.gain(0.025);
    r.chain(wh, wg, o);
    const rb = r.noiseSrc('brown', t, end);
    const rlp = r.filter('lowpass', 150, 0.7);
    const rg = r.gain(0.3);
    r.chain(rb, rlp, rg, o);
  }, { lowRate: true }),

  loop_pump: loopRecipe(2, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const m = r.osc('organ', qf(120, L), t, end);
    const mg = r.gain(0.18);
    r.chain(m, mg, o);
    const w1 = r.osc('sine', qf(780, L), t, end);
    const w2 = r.osc('sine', qf(783.5, L), t, end);
    const wg = r.gain(0.035);
    w1.connect(wg);
    w2.connect(wg);
    wg.connect(o);
    const f = r.noiseSrc('pink', t, end);
    const flp = r.filter('lowpass', 1200, 0.7);
    const fg = r.gain(0.2);
    r.chain(f, flp, fg, o);
    const h = r.noiseSrc('white', t, end);
    const hhp = r.filter('highpass', 3000, 0.7);
    const hg = r.gain(0.025);
    r.chain(h, hhp, hg, o);
  }),

  loop_plant: loopRecipe(6, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const roar = r.noiseSrc('brown', t, end);
    const rlp = r.filter('lowpass', 350, 0.7);
    const rg = r.gain(0.8);
    r.chain(roar, rlp, rg, o);
    const mid = r.noiseSrc('pink', t, end);
    const mbp = r.filter('bandpass', 700, 0.6);
    const mg = r.gain(0.3);
    r.chain(mid, mbp, mg, o);
    const hiss = r.noiseSrc('white', t, end);
    const hbp = r.filter('bandpass', 5000, 0.8);
    hiss.connect(hbp);
    am(r, hbp, 0.1, 0.04, qf(0.333, L), t, end).connect(o);
    for (const [f, a, kind] of [[100, 0.07, 'sine'], [150, 0.045, 'sine'], [217, 0.025, 'organ']] as const) {
      const osc = r.osc(kind, qf(f, L), t, end);
      const g = r.gain(a);
      r.chain(osc, g, o);
    }
    r.burst(o, t + r.r(0.5, 1.5), 1.6, 0.22, { type: 'highpass', freq: 2500, q: 0.7, attack: 0.3 });
    r.burst(o, t + r.r(3.5, 4.5), 1.4, 0.18, { type: 'highpass', freq: 2800, q: 0.7, attack: 0.3 });
    for (let i = 0; i < 3; i++) r.metal(o, t + r.r(0.3, L), r.r(300, 700), 0.04, 0.5, [1, 2.4, 3.9]);
  }, { lowRate: true }),

  loop_flare: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const n = r.noiseSrc('pink', t, end);
    const bp = r.filter('bandpass', 420, 0.5);
    n.connect(bp);
    flutter(r, bp, 0.6, 0.5, t, end, 0.1).connect(o);
    const b = r.noiseSrc('brown', t, end);
    const blp = r.filter('lowpass', 200, 0.7);
    b.connect(blp);
    flutter(r, blp, 0.7, 0.4, t, end, 0.06).connect(o);
    const h = r.noiseSrc('white', t, end);
    const hhp = r.filter('highpass', 2500, 0.7);
    const hg = r.gain(0.08);
    r.chain(h, hhp, hg, o);
  }, { lowRate: true }),

  loop_turbine: loopRecipe(2, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    for (const [f, a] of [[3150, 0.05], [6300, 0.015], [1050, 0.02]] as const) {
      const osc = r.osc('sine', qf(f, L), t, end);
      const g = r.gain(a);
      r.chain(osc, g, o);
    }
    const roar = r.noiseSrc('pink', t, end);
    const lp = r.filter('lowpass', 1500, 0.7);
    const g = r.gain(0.4);
    r.chain(roar, lp, g, o);
    const low = r.noiseSrc('brown', t, end);
    const llp = r.filter('lowpass', 120, 0.7);
    const lg = r.gain(0.4);
    r.chain(low, llp, lg, o);
    const hiss = r.noiseSrc('white', t, end);
    const hp = r.filter('highpass', 6000, 0.7);
    const hg = r.gain(0.04);
    r.chain(hiss, hp, hg, o);
  }, { lowRate: true }),

  loop_windturbine: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const n = r.noiseSrc('pink', t, end);
    const bp = r.filter('bandpass', 600, 0.8);
    n.connect(bp);
    am(r, bp, 0.25, 0.22, qf(0.75, L), t, end).connect(o);
    for (const [f, a] of [[180, 0.03], [360, 0.012]] as const) {
      const osc = r.osc('sine', qf(f, L), t, end);
      const g = r.gain(a);
      r.chain(osc, g, o);
    }
    for (let k = 0; k * (1 / 0.75) < L + XF; k++) r.thump(o, t + k / 0.75 + 0.3, 45, 0.12, 0.3, 0.8);
  }, { lowRate: true }),

  loop_hvac: loopRecipe(3, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const n = r.noiseSrc('pink', t, end);
    const lp = r.filter('lowpass', 700, 0.7);
    const g = r.gain(0.3);
    r.chain(n, lp, g, o);
    const hum = r.osc('sine', qf(120, L), t, end);
    const hg = r.gain(0.04);
    r.chain(hum, hg, o);
    const blade = r.osc('triangle', qf(47, L), t, end);
    const bg = r.gain(0.03);
    r.chain(blade, bg, o);
  }, { lowRate: true }),

  loop_construction: loopRecipe(8, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const hammer = (tt: number) => {
      r.metal(o, tt, r.r(650, 800), 0.35, 0.18, [1, 2.7, 4.4]);
      r.thump(o, tt, 180, 0.3, 0.05, 0.7);
    };
    [0.4, 0.75, 1.1, 5.8, 6.1, 6.4, 6.7].forEach((dt) => hammer(t + dt + r.r(-0.03, 0.03)));
    // impact wrench
    const iw = r.osc('sawtooth', 40, t + 3.0, t + 3.7);
    const ibp = r.filter('bandpass', 1500, 2);
    const ish = r.shaper(3);
    const ig = r.gain(0);
    r.adsr(ig.gain, t + 3.0, 0.22, 0.02, 0.1, 0.8, 0.55, 0.05);
    r.chain(iw, ish, ibp, ig, o);
    r.metal(o, t + 4.6, 260, 0.35, 0.7, [1, 2.3, 3.7, 5.9]);
    const gen = r.osc('sawtooth', qf(30, L), t, end);
    const glp = r.filter('lowpass', 150, 1);
    const gg = r.gain(0.12);
    r.chain(gen, glp, gg, o);
  }, { lowRate: true }),

  loop_wellflow: loopRecipe(3, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const n = r.noiseSrc('white', t, end);
    const bp = r.filter('bandpass', 1800, 0.9);
    const g = r.gain(0.14);
    r.chain(n, bp, g, o);
    const p = r.noiseSrc('pink', t, end);
    const lp = r.filter('lowpass', 500, 0.7);
    p.connect(lp);
    flutter(r, lp, 0.2, 0.12, t, end, 0.15).connect(o);
    const b = r.noiseSrc('brown', t, end, 2);
    const gbp = r.filter('bandpass', 350, 5);
    const gg = r.gain(0.25);
    r.chain(b, gbp, gg, o);
  }, { lowRate: true }),

  loop_hiss: loopRecipe(2, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const n = r.noiseSrc('white', t, end);
    const hp = r.filter('highpass', 1400, 0.7);
    n.connect(hp);
    flutter(r, hp, 0.55, 0.2, t, end, 0.4).connect(o);
    const n2 = r.noiseSrc('white', t, end);
    const bp = r.filter('bandpass', 4200, 0.8);
    const g = r.gain(0.25);
    r.chain(n2, bp, g, o);
  }, { priority: 2 }),

  // --------------------------------------------------------------------------------- hazards
  loop_fire: loopRecipe(5, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const b = r.noiseSrc('brown', t, end);
    const lp = r.filter('lowpass', 400, 0.7);
    b.connect(lp);
    flutter(r, lp, 0.45, 0.35, t, end, 0.2).connect(o);
    for (let i = 0; i < 130; i++) {
      const u = r.rng();
      r.burst(o, t + r.r(0, L + XF - 0.05), r.r(0.004, 0.014), 0.05 + 0.55 * u * u * u, { freq: r.r(1400, 6000), q: 2 });
    }
    for (let i = 0; i < 6; i++) {
      const tt = t + r.r(0, L);
      r.thump(o, tt, r.r(200, 420), 0.3, 0.05, 0.6);
      r.burst(o, tt, 0.03, 0.4, { freq: 2500, q: 0.8 });
    }
    const h = r.noiseSrc('white', t, end);
    const hp = r.filter('highpass', 4000, 0.7);
    const hg = r.gain(0.04);
    r.chain(h, hp, hg, o);
  }, { rmsDb: -22 }),

  loop_blowout: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const p = r.noiseSrc('pink', t, end);
    const lp = r.filter('lowpass', 2500, 0.7);
    p.connect(lp);
    flutter(r, lp, 0.7, 0.4, t, end, 0.12).connect(o);
    const w = r.noiseSrc('white', t, end);
    const bp = r.filter('bandpass', 4000, 0.7);
    const wg = r.gain(0.3);
    r.chain(w, bp, wg, o);
    const b = r.noiseSrc('brown', t, end);
    const blp = r.filter('lowpass', 150, 0.7);
    b.connect(blp);
    flutter(r, blp, 0.9, 0.5, t, end, 0.07).connect(o);
    const g = r.noiseSrc('brown', t, end, 3);
    const gbp = r.filter('bandpass', 500, 3);
    const gg = r.gain(0.2);
    r.chain(g, gbp, gg, o);
  }, { rmsDb: -18 }),

  // --------------------------------------------------------------------------------- environment (stereo)
  loop_rain: loopRecipe(6, (r, t, L) => {
    const end = t + L + XF + 0.1;
    for (const side of [-0.85, 0.85]) {
      const pan = r.pan(side);
      pan.connect(r.out);
      const n = r.noiseSrc('pink', t, end);
      const hp = r.filter('highpass', 700, 0.7);
      const lp = r.filter('lowpass', 7000, 0.7);
      const g = r.gain(0.3);
      r.chain(n, hp, lp, g, pan);
      for (let i = 0; i < 170; i++) {
        const u = r.rng();
        r.burst(pan, t + r.r(0, L + XF - 0.02), 0.004, 0.04 + 0.3 * u * u, { freq: r.r(2000, 7500), q: r.r(2, 6) });
      }
      for (let i = 0; i < 18; i++) r.partial(pan, t + r.r(0, L), r.r(1000, 3000), r.r(0.03, 0.08), 0.03);
    }
  }, { channels: 2, priority: 3, rmsDb: -20 }),

  loop_waves: loopRecipe(12, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const base = r.noiseSrc('brown', t, end);
    const blp = r.filter('lowpass', 320, 0.7);
    const bg = r.gain(0.3);
    r.chain(base, blp, bg, r.out);
    const starts = [0.3, 4.2 + r.r(-0.4, 0.4), 8.1 + r.r(-0.4, 0.4)];
    for (const s of starts) {
      const pan = r.pan(r.r(-0.7, 0.7));
      pan.connect(r.out);
      const tt = t + s;
      // swell
      const sw = r.noiseSrc('brown', tt, tt + 2.2);
      const swf = r.filter('lowpass', 200, 0.8);
      r.sweep(swf.frequency, tt, 200, 900, 1.6);
      const swg = r.gain(0);
      r.ramp(swg.gain, tt, [[0, 0], [1.5, 0.6], [2.1, 0]]);
      r.chain(sw, swf, swg, pan);
      // crash & wash
      const cr = r.noiseSrc('pink', tt + 1.4, tt + 4.5);
      const crf = r.filter('lowpass', 3200, 0.7);
      r.sweep(crf.frequency, tt + 1.4, 3200, 600, 2.8);
      const crg = r.gain(0);
      r.ramp(crg.gain, tt, [[1.4, 0], [1.6, 0.65], [4.3, 0]]);
      r.chain(cr, crf, crg, pan);
      const foam = r.noiseSrc('white', tt + 1.6, tt + 4);
      const ff = r.filter('highpass', 3000, 0.7);
      const fg = r.gain(0);
      r.ramp(fg.gain, tt, [[1.6, 0], [1.9, 0.12], [3.8, 0]]);
      r.chain(foam, ff, fg, pan);
    }
  }, { channels: 2, priority: 3, lowRate: true }),

  loop_crickets: loopRecipe(6, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const count = 5;
    for (let c = 0; c < count; c++) {
      const pan = r.pan(r.r(-0.85, 0.85));
      pan.connect(r.out);
      const f = r.r(3800, 5200);
      const osc = r.osc('sine', f, t, end);
      const g = r.gain(0);
      osc.connect(g).connect(pan);
      const amp = r.r(0.1, 0.3);
      if (c === 0) {
        // tree cricket: continuous pulsed trill with slow swell
        const lfo = r.osc('square', qf(48, L), t, end);
        const lg = r.gain(amp * 0.4);
        lfo.connect(lg).connect(g.gain);
        g.gain.value = amp * 0.4;
        continue;
      }
      const period = r.r(0.45, 0.9);
      const pulses = 3 + Math.floor(r.rng() * 2);
      for (let tt = t + r.r(0, period); tt < t + L + XF - 0.2; tt += period * r.r(0.95, 1.05)) {
        for (let p = 0; p < pulses; p++) {
          const ps = tt + p * 0.032;
          g.gain.setValueAtTime(0, ps);
          g.gain.linearRampToValueAtTime(amp, ps + 0.004);
          g.gain.setValueAtTime(amp, ps + 0.014);
          g.gain.linearRampToValueAtTime(0, ps + 0.02);
        }
      }
    }
  }, { channels: 2, priority: 4, lowRate: true }),

  loop_cicadas: loopRecipe(8, (r, t, L) => {
    const end = t + L + XF + 0.1;
    for (let c = 0; c < 3; c++) {
      const pan = r.pan(r.r(-0.8, 0.8));
      pan.connect(r.out);
      const n = r.noiseSrc('white', t, end);
      const bp = r.filter('bandpass', r.r(4500, 6500), 4);
      n.connect(bp);
      const buzz = am(r, bp, 0.3, 0.3, qf(r.r(80, 140), L), t, end, 'square');
      const env = r.gain(0);
      const s = r.r(0, 3);
      r.ramp(env.gain, t, [[0, 0.15], [s, 0.15], [s + 1.5, 0.9], [s + 3.5, 0.9], [s + 4.5, 0.15], [L + XF, 0.15]]);
      buzz.connect(env).connect(pan);
    }
    const hum = r.noiseSrc('pink', t, end);
    const hbp = r.filter('bandpass', 3000, 1);
    const hg = r.gain(0.05);
    r.chain(hum, hbp, hg, r.out);
  }, { channels: 2, priority: 4, lowRate: true }),

  loop_snow: loopRecipe(4, (r, t, L) => {
    const end = t + L + XF + 0.1;
    for (const side of [-0.7, 0.7]) {
      const pan = r.pan(side);
      pan.connect(r.out);
      const n = r.noiseSrc('pink', t, end);
      const lp = r.filter('lowpass', 500, 0.7);
      n.connect(lp);
      flutter(r, lp, 0.4, 0.2, t, end, 0.1).connect(pan);
    }
  }, { channels: 2, priority: 4, lowRate: true }),

  loop_underwater: loopRecipe(6, (r, t, L) => {
    const end = t + L + XF + 0.1;
    const o = r.out;
    const b = r.noiseSrc('brown', t, end);
    const lp = r.filter('lowpass', 300, 0.7);
    b.connect(lp);
    flutter(r, lp, 0.6, 0.3, t, end, 0.05).connect(o);
    for (let i = 0; i < 16; i++) r.partial(o, t + r.r(0, L), r.r(300, 1200), r.r(0.05, 0.15), 0.06, { drop: 1.5, dropTime: 0.05 });
  }, { priority: 4, lowRate: true }),
};
