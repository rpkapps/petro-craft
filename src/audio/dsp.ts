// Low-level DSP helpers: seeded RNG, math, noise generation, impulse responses, Karplus-Strong plucks,
// band-limited periodic waves, waveshaper curves, loop crossfading and level analysis.
// Everything here is pure JS working on Float32Arrays so it runs identically on any AudioContext.

export type Rng = () => number;

/** mulberry32 — small, fast, good-enough PRNG for presentation randomness. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const randInt = (rng: Rng, lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * rng());
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
/** Pick from [value, weight] pairs. */
export function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += Math.max(0, w);
  let r = rng() * total;
  for (const [v, w] of items) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g <= 1e-9 ? -180 : 20 * Math.log10(g));
/** Perceptual volume slider taper (0..1 → gain). */
export const sliderToGain = (v: number) => {
  const x = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return x * x;
};

// ------------------------------------------------------------------------------------------------
// Noise
// ------------------------------------------------------------------------------------------------
export function whiteNoise(len: number, rng: Rng): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Pink noise (Paul Kellet's refined filter), roughly unit peak. */
export function pinkNoise(len: number, rng: Rng): Float32Array {
  const out = new Float32Array(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return normalizePeak(out, 0.95);
}

/** Brown (red) noise: leaky integrated white noise with DC blocking. */
export function brownNoise(len: number, rng: Rng): Float32Array {
  const out = new Float32Array(len);
  let last = 0;
  let dcIn = 0, dcOut = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    // DC blocker keeps long buffers centred.
    dcOut = last - dcIn + 0.9995 * dcOut;
    dcIn = last;
    out[i] = dcOut;
  }
  return normalizePeak(out, 0.95);
}

/** Crossfade the first `fadeLen` samples with the samples after `loopLen` so the buffer loops seamlessly. */
export function makeSeamless(data: Float32Array, loopLen: number, fadeLen: number): Float32Array {
  const out = data.slice(0, loopLen);
  const n = Math.min(fadeLen, data.length - loopLen, loopLen);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const a = Math.sin(x * Math.PI * 0.5); // equal power
    const b = Math.cos(x * Math.PI * 0.5);
    out[i] = data[i] * a + data[loopLen + i] * b;
  }
  return out;
}

export function peakOf(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > p) p = v;
  }
  return p;
}

export function rmsOf(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

export function normalizePeak(data: Float32Array, target: number): Float32Array {
  const p = peakOf(data);
  if (p > 1e-9) {
    const k = target / p;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  return data;
}

/** Short linear fades at both ends to kill clicks. */
export function fadeEdges(data: Float32Array, fadeIn: number, fadeOut: number): Float32Array {
  const n = data.length;
  for (let i = 0; i < fadeIn && i < n; i++) data[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < n; i++) data[n - 1 - i] *= i / fadeOut;
  return data;
}

// ------------------------------------------------------------------------------------------------
// AudioBuffer helpers
// ------------------------------------------------------------------------------------------------
export function makeBuffer(sampleRate: number, channels: Float32Array[]): AudioBuffer {
  const len = channels[0].length;
  const buf = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: channels.length, sampleRate });
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

export function bufferChannels(buf: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
  return out;
}

// ------------------------------------------------------------------------------------------------
// Procedural impulse responses
// ------------------------------------------------------------------------------------------------
export interface ImpulseOptions {
  /** Total length (s). */
  duration: number;
  /** Time to decay by 60 dB (s). */
  rt60: number;
  /** Pre-delay (s) before the diffuse tail. */
  preDelay: number;
  /** Lowpass cutoff at the start and end of the tail (Hz) — models air/HF damping. */
  brightStart: number;
  brightEnd: number;
  /** Discrete early reflections: [time s, gain] per channel pair (mirrored with jitter). */
  early?: [number, number][];
  /** Slow echo "slap" repeats for outdoor spaces (valleys, buildings). */
  slaps?: [number, number][];
  /** 0..1 fraction of decorrelation between L and R. */
  width: number;
  seed: number;
}

export function makeImpulse(sampleRate: number, o: ImpulseOptions): AudioBuffer {
  const len = Math.max(1, Math.floor(o.duration * sampleRate));
  const pre = Math.floor(o.preDelay * sampleRate);
  const rng = mulberry32(o.seed);
  const shared = whiteNoise(len, rng);
  const chans: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const own = whiteNoise(len, rng);
    const data = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.907755 * t) / o.rt60);
      const n = own[i] * o.width + shared[i] * (1 - o.width);
      const frac = Math.min(1, t / o.rt60);
      const fc = o.brightStart * Math.pow(o.brightEnd / o.brightStart, frac);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp += a * (n - lp);
      // soft onset of the diffuse field
      const onset = Math.min(1, t / 0.012);
      data[i] = lp * env * onset;
    }
    const taps = [...(o.early ?? []), ...(o.slaps ?? [])];
    for (const [time, g] of taps) {
      const jitter = (rng() - 0.5) * 0.004 * (c === 0 ? 1 : -1);
      const idx = Math.floor((time + jitter + o.preDelay * 0.5) * sampleRate);
      // smeared reflection: a short decaying noise burst rather than a single click
      const smear = Math.floor(0.004 * sampleRate);
      for (let k = 0; k < smear && idx + k < len; k++) {
        if (idx + k < 0) continue;
        data[idx + k] += g * (rng() * 2 - 1) * Math.exp(-k / (smear * 0.35)) * 0.8;
      }
    }
    fadeEdges(data, 16, Math.floor(0.05 * sampleRate));
    chans.push(data);
  }
  // energy normalise across both channels
  let e = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const k = 1 / Math.sqrt(Math.max(1e-9, e / 2));
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k * 0.9;
  return makeBuffer(sampleRate, chans);
}

// ------------------------------------------------------------------------------------------------
// Karplus-Strong plucked string (used for music plucks — rendered once per reference pitch)
// ------------------------------------------------------------------------------------------------
export interface PluckOptions {
  /** 0..1 excitation brightness. */
  brightness: number;
  /** Loop decay factor per period (0.990..0.9995). */
  sustain: number;
  /** 0..1 body resonance mix (adds a woody formant). */
  body: number;
}

export function karplusStrong(sampleRate: number, freq: number, dur: number, o: PluckOptions, rng: Rng): Float32Array {
  const len = Math.floor(dur * sampleRate);
  const out = new Float32Array(len);
  // Loop delay = N (line) + 0.5 (two-point average) + d (allpass) = sampleRate / freq.
  const period = sampleRate / freq;
  const N = Math.max(2, Math.floor(period - 0.6));
  const d = period - 0.5 - N;
  const C = (1 - d) / (1 + d);
  // Excitation: filtered noise burst (softer = darker pick), DC removed.
  const exLen = Math.min(len, N + 1);
  let lp = 0;
  const a = 0.08 + 0.85 * o.brightness;
  let mean = 0;
  for (let i = 0; i < exLen; i++) {
    lp += a * (rng() * 2 - 1 - lp);
    out[i] = lp;
    mean += lp;
  }
  mean /= Math.max(1, exLen);
  for (let i = 0; i < exLen; i++) out[i] -= mean;
  let apX1 = 0, apY1 = 0;
  for (let n = exLen; n < len; n++) {
    const avg = 0.5 * (out[n - N] + out[n - N - 1]) * o.sustain;
    const y = C * avg + apX1 - C * apY1;
    apX1 = avg;
    apY1 = y;
    out[n] = y;
  }
  // Body resonance: gentle bandpass around 250 & 900 Hz mixed in.
  if (o.body > 0) {
    const res = (f: number, q: number) => {
      const w0 = (2 * Math.PI * f) / sampleRate;
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = alpha, b2 = -alpha;
      const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const r = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const x0 = out[i];
        const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        r[i] = y0;
      }
      return r;
    };
    const r1 = res(260, 2.5);
    const r2 = res(920, 3);
    for (let i = 0; i < len; i++) out[i] = out[i] * (1 - o.body * 0.5) + (r1[i] + r2[i] * 0.6) * o.body;
  }
  fadeEdges(out, 24, Math.floor(0.08 * sampleRate));
  return normalizePeak(out, 0.9);
}

// ------------------------------------------------------------------------------------------------
// Periodic waves & shaping curves
// ------------------------------------------------------------------------------------------------
export type WaveShape = 'warm' | 'hollow' | 'soft' | 'reed' | 'organ';

export function waveSpectrum(shape: WaveShape, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    let amp = 0;
    switch (shape) {
      case 'warm': // saw with gentle high rolloff → analog-ish
        amp = (1 / n) * Math.exp(-n / 18);
        break;
      case 'hollow': // odd harmonics, clarinet-like
        amp = n % 2 === 1 ? (1 / n) * Math.exp(-n / 14) : (0.08 / n);
        break;
      case 'soft': // mostly fundamental, a touch of 2nd/3rd
        amp = n === 1 ? 1 : n === 2 ? 0.25 : n === 3 ? 0.12 : n === 4 ? 0.05 : 0;
        break;
      case 'reed': // formant-ish bump around 5th-8th harmonic
        amp = (1 / n) * (0.4 + Math.exp(-((n - 6) * (n - 6)) / 8)) * Math.exp(-n / 24);
        break;
      case 'organ':
        amp = [0, 1, 0.5, 0.3, 0.25, 0, 0.12, 0, 0.1][n] ?? 0;
        break;
    }
    imag[n] = amp;
  }
  return { real, imag };
}

const waveCache = new WeakMap<BaseAudioContext, Map<WaveShape, PeriodicWave>>();
export function periodicWave(ctx: BaseAudioContext, shape: WaveShape): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(shape);
  if (!w) {
    const { real, imag } = waveSpectrum(shape);
    w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    m.set(shape, w);
  }
  return w;
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();
/** tanh saturation curve normalised to unity at ±1. */
export function saturationCurve(drive: number, asym = 0): Float32Array<ArrayBuffer> {
  const key = `${drive.toFixed(3)}:${asym.toFixed(3)}`;
  let c = curveCache.get(key);
  if (!c) {
    const n = 2048;
    c = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
    }
    curveCache.set(key, c);
  }
  return c;
}
