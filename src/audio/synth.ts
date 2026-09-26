// Graph-building primitives shared by the offline sound recipes and the realtime music instruments.
// A `Rend` wraps a BaseAudioContext (realtime or OfflineAudioContext), an output node, a seeded RNG and
// a set of pre-generated noise buffers, and offers terse helpers for oscillators, noise, filters and
// envelopes. Every helper schedules against absolute context time.
import { mulberry32, periodicWave, saturationCurve, whiteNoise, pinkNoise, brownNoise, makeBuffer, type Rng, type WaveShape } from './dsp';

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface NoiseSet {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

const noiseCache = new Map<number, NoiseSet>();
/** Pre-rendered 4-second noise buffers per sample rate (shared by all voices). */
export function noiseSet(sampleRate: number): NoiseSet {
  let n = noiseCache.get(sampleRate);
  if (!n) {
    const len = Math.floor(sampleRate * 4);
    const rng = mulberry32(0x5eed + sampleRate);
    n = {
      white: makeBuffer(sampleRate, [whiteNoise(len, rng)]),
      pink: makeBuffer(sampleRate, [pinkNoise(len, rng)]),
      brown: makeBuffer(sampleRate, [brownNoise(len, rng)]),
    };
    noiseCache.set(sampleRate, n);
  }
  return n;
}

export type OscKind = OscillatorType | WaveShape;

export class Rend {
  readonly noise: NoiseSet;
  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: AudioNode,
    readonly rng: Rng,
  ) {
    this.noise = noiseSet(ctx.sampleRate);
  }

  r(lo: number, hi: number) {
    return lo + (hi - lo) * this.rng();
  }

  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  pan(p: number): StereoPannerNode {
    const s = this.ctx.createStereoPanner();
    s.pan.value = Math.max(-1, Math.min(1, p));
    return s;
  }

  shaper(drive: number, asym = 0): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = saturationCurve(drive, asym);
    w.oversample = '2x';
    return w;
  }

  delay(t: number, max = Math.max(1, t * 2)): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = t;
    return d;
  }

  osc(kind: OscKind, freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    if (kind === 'sine' || kind === 'square' || kind === 'sawtooth' || kind === 'triangle') o.type = kind;
    else if (kind !== 'custom') o.setPeriodicWave(periodicWave(this.ctx, kind));
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start(t0);
    o.stop(t1);
    return o;
  }

  noiseSrc(color: NoiseColor, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[color];
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t0, this.rng() * 3.5);
    s.stop(t1);
    return s;
  }

  /** Connect nodes in series; returns the last node. */
  chain<T extends AudioNode>(...nodes: [...AudioNode[], T]): T {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1] as T;
  }

  /** Percussive envelope: 0 → peak in `attack`, exponential decay reaching −60 dB after `decay`. */
  perc(p: AudioParam, t: number, peak: number, attack: number, decay: number) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.0005, attack));
    p.setTargetAtTime(0, t + attack, Math.max(0.001, decay / 6.9));
  }

  /** ADSR with hold: rises to peak, decays to sustain*peak, holds until t+hold, then releases. */
  adsr(p: AudioParam, t: number, peak: number, a: number, d: number, s: number, hold: number, r: number) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
    p.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
    const tr = t + Math.max(a + 0.001, hold);
    p.setTargetAtTime(0, tr, Math.max(0.001, r / 5));
  }

  /** Piecewise envelope: list of [time offset, value] with linear ramps. */
  ramp(p: AudioParam, t: number, pts: [number, number][]) {
    p.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
  }

  /** Exponential sweep of a frequency-like param. */
  sweep(p: AudioParam, t: number, from: number, to: number, dur: number) {
    p.setValueAtTime(Math.max(0.0001, from), t);
    p.exponentialRampToValueAtTime(Math.max(0.0001, to), t + Math.max(0.001, dur));
  }

  // ---- Composite building blocks ------------------------------------------------------------

  /** A decaying sine partial (optionally with pitch drop) → dest. */
  partial(dest: AudioNode, t: number, freq: number, amp: number, decay: number, opts: { attack?: number; drop?: number; dropTime?: number; kind?: OscKind } = {}) {
    const o = this.osc(opts.kind ?? 'sine', freq, t, t + decay + 0.05);
    if (opts.drop) this.sweep(o.frequency, t, freq, freq * opts.drop, opts.dropTime ?? decay);
    const g = this.gain(0);
    this.perc(g.gain, t, amp, opts.attack ?? 0.002, decay);
    o.connect(g).connect(dest);
    return o;
  }

  /** Filtered noise burst → dest. */
  burst(dest: AudioNode, t: number, dur: number, amp: number, opts: { color?: NoiseColor; type?: BiquadFilterType; freq?: number; q?: number; attack?: number; sweepTo?: number; rate?: number } = {}) {
    const n = this.noiseSrc(opts.color ?? 'white', t, t + dur + 0.05, opts.rate ?? 1);
    const f = this.filter(opts.type ?? 'bandpass', opts.freq ?? 2000, opts.q ?? 1);
    if (opts.sweepTo) this.sweep(f.frequency, t, opts.freq ?? 2000, opts.sweepTo, dur);
    const g = this.gain(0);
    this.perc(g.gain, t, amp, opts.attack ?? 0.001, dur);
    this.chain(n, f, g, dest);
    return g;
  }

  /** Inharmonic metallic strike (bell / clang / pipe). */
  metal(dest: AudioNode, t: number, base: number, amp: number, decay: number, ratios: number[] = [1, 2.76, 5.4, 8.93], spread = 0.02) {
    ratios.forEach((ratio, i) => {
      const f = base * ratio * (1 + (this.rng() - 0.5) * spread);
      const a = amp / (1 + i * 0.7);
      this.partial(dest, t, f, a, decay / (1 + i * 0.35));
    });
    // strike transient
    this.burst(dest, t, 0.012, amp * 0.5, { type: 'highpass', freq: 3000, q: 0.7 });
  }

  /** Scatter of tiny noise grains (gravel, crunch, crackle). */
  grains(dest: AudioNode, t: number, span: number, count: number, amp: number, fLo: number, fHi: number, grainDur = 0.012, q = 1.5) {
    for (let i = 0; i < count; i++) {
      const u = this.rng();
      const at = t + span * u * u; // denser at the start
      const a = amp * (0.35 + 0.65 * this.rng()) * (1 - 0.6 * u);
      this.burst(dest, at, grainDur * this.r(0.6, 1.5), a, { freq: this.r(fLo, fHi), q, type: 'bandpass' });
    }
  }

  /** Low body thump (sine with pitch drop). */
  thump(dest: AudioNode, t: number, freq: number, amp: number, decay: number, drop = 0.5) {
    this.partial(dest, t, freq, amp, decay, { drop, dropTime: decay * 0.6, attack: 0.003 });
  }
}
