// Reusable musical/foley building blocks for recipes.
import { mtof } from '../dsp';
import type { Rend } from '../synth';

/** Two-operator FM bell/chime. `ratio` 3.5 = bell, 2 = warm chime, 1.4 = glassy. */
export function fmBell(r: Rend, dest: AudioNode, t: number, f: number, amp: number, decay: number, ratio = 3.5, index = 2) {
  const end = t + decay + 0.1;
  const car = r.osc('sine', f, t, end);
  const mod = r.osc('sine', f * ratio, t, end);
  const mg = r.gain(0);
  r.perc(mg.gain, t, f * index, 0.001, decay * 0.45);
  mod.connect(mg).connect(car.frequency);
  const g = r.gain(0);
  r.perc(g.gain, t, amp, 0.004, decay);
  car.connect(g).connect(dest);
  r.partial(dest, t, f * 2.001, amp * 0.1, decay * 0.35);
}

export interface EnsembleOpts {
  cutFrom?: number;
  cutPeak?: number;
  cutSus?: number;
  attack?: number;
  release?: number;
  spread?: number;
  drive?: number;
  shape?: 'warm' | 'reed' | 'hollow';
  detune?: number;
}

/** Warm brass/pad ensemble chord with a filter envelope — stings & fanfares. */
export function ensemble(r: Rend, dest: AudioNode, t: number, midis: number[], dur: number, amp: number, o: EnsembleOpts = {}) {
  const cutFrom = o.cutFrom ?? 450;
  const cutPeak = o.cutPeak ?? 2600;
  const cutSus = o.cutSus ?? 1400;
  const attack = o.attack ?? 0.06;
  const release = o.release ?? 0.8;
  const spread = o.spread ?? 0.7;
  const det = o.detune ?? 7;
  const f = r.filter('lowpass', cutFrom, 0.8);
  f.frequency.setValueAtTime(cutFrom, t);
  f.frequency.linearRampToValueAtTime(cutPeak, t + attack + 0.08);
  f.frequency.setTargetAtTime(cutSus, t + attack + 0.1, 0.35);
  f.frequency.setTargetAtTime(cutFrom, t + dur, release / 3);
  const env = r.gain(0);
  r.adsr(env.gain, t, amp, attack, 0.5, 0.8, dur, release);
  const end = t + dur + release + 0.3;
  midis.forEach((m, i) => {
    const pos = midis.length > 1 ? (i / (midis.length - 1)) * 2 - 1 : 0;
    const p = r.pan(pos * spread);
    const g = r.gain(1 / Math.sqrt(midis.length * 2));
    for (const d of [-det, det]) {
      const oN = r.osc(o.shape ?? 'warm', mtof(m), t, end, d + r.r(-2, 2));
      oN.connect(g);
    }
    g.connect(p).connect(f);
  });
  const sh = r.shaper(o.drive ?? 1.3);
  r.chain(f, sh, env, dest);
}

/** Orchestral-ish soft timpani / low drum. */
export function timpani(r: Rend, dest: AudioNode, t: number, freq: number, amp: number, decay = 1.2) {
  r.thump(dest, t, freq, amp, decay, 0.85);
  r.partial(dest, t, freq * 1.5, amp * 0.3, decay * 0.5);
  r.burst(dest, t, 0.25, amp * 0.35, { color: 'brown', type: 'lowpass', freq: 400, q: 0.7 });
  r.burst(dest, t, 0.03, amp * 0.25, { type: 'bandpass', freq: 900, q: 1 });
}

/** Soft plucked note (sine + decaying harmonics) — for stings where a realtime KS isn't available. */
export function softPluck(r: Rend, dest: AudioNode, t: number, midi: number, amp: number, decay = 1.2) {
  const f = mtof(midi);
  r.partial(dest, t, f, amp, decay);
  r.partial(dest, t, f * 2, amp * 0.35, decay * 0.5);
  r.partial(dest, t, f * 3, amp * 0.15, decay * 0.3);
  r.burst(dest, t, 0.02, amp * 0.15, { type: 'bandpass', freq: Math.min(8000, f * 4), q: 1 });
}

/** Stick-slip creak (rusty bearing, pumpjack, rope): resonant pulse train with a sweeping rate. */
export function creak(r: Rend, dest: AudioNode, t: number, dur: number, rateFrom: number, rateTo: number, formant: number, amp: number) {
  const o = r.osc('sawtooth', rateFrom, t, t + dur + 0.1);
  o.frequency.setValueAtTime(rateFrom, t);
  o.frequency.linearRampToValueAtTime(rateTo, t + dur);
  // jitter the rate so it sounds organic
  const jit = r.noiseSrc('brown', t, t + dur + 0.1, 0.5);
  const jg = r.gain(rateFrom * 0.25);
  jit.connect(jg).connect(o.frequency);
  const b1 = r.filter('bandpass', formant, 7);
  const b2 = r.filter('bandpass', formant * 1.9, 9);
  const mix = r.gain(1);
  o.connect(b1).connect(mix);
  o.connect(b2).connect(mix);
  const env = r.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + dur * 0.3);
  env.gain.linearRampToValueAtTime(amp * 0.8, t + dur * 0.75);
  env.gain.linearRampToValueAtTime(0, t + dur);
  mix.connect(env).connect(dest);
}

/** Formant "voice" burst — grunts, animal calls. */
export function vocal(r: Rend, dest: AudioNode, t: number, f0: number, f1: number, dur: number, formants: [number, number][], amp: number, kind: 'sawtooth' | 'reed' = 'sawtooth') {
  const o = r.osc(kind, f0, t, t + dur + 0.1);
  r.sweep(o.frequency, t, f0, f1, dur);
  const env = r.gain(0);
  r.adsr(env.gain, t, amp, Math.min(0.03, dur * 0.2), dur * 0.5, 0.7, dur * 0.7, dur * 0.3);
  const lp = r.filter('lowpass', 3500, 0.7);
  for (const [f, q] of formants) {
    const bp = r.filter('bandpass', f, q);
    o.connect(bp).connect(lp);
  }
  lp.connect(env).connect(dest);
}
