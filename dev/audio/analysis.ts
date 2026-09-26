// Offline analysis for the audio harness: renders every recipe and a stretch of each music mood with
// OfflineAudioContext, then draws waveforms / spectra and reports peak & RMS levels.
import { SoundBank } from '../../src/audio/bank';
import { RECIPES } from '../../src/audio/recipes';
import { gainToDb, makeImpulse, peakOf, rmsOf } from '../../src/audio/dsp';
import { Performer, type Mood, type PerformerKind } from '../../src/audio/music/composer';
import { GAME_LEVEL, MENU_LEVEL } from '../../src/audio/music/director';

export interface SoundStat {
  name: string;
  variants: number;
  seconds: number;
  peakDb: number;
  rmsDb: number;
  ms: number;
  bad: string | null;
}

export interface MusicStat {
  label: string;
  peakDb: number;
  rmsDb: number;
  ms: number;
  bad: string | null;
}

const SR = 44100;

export async function analyzeBank(onProgress?: (p: number) => void): Promise<{ bank: SoundBank; stats: SoundStat[]; totalMs: number }> {
  const bank = new SoundBank(SR);
  const t0 = performance.now();
  const names = Object.keys(RECIPES);
  let done = 0;
  const stats: SoundStat[] = [];
  const timer = setInterval(() => onProgress?.(bank.progress), 100);
  await bank.prerenderAll();
  clearInterval(timer);
  for (const name of names) {
    done++;
    const bufs = bank.get(name);
    const st = bank.stats.filter((s) => s.name === name);
    if (!bufs) {
      stats.push({ name, variants: 0, seconds: 0, peakDb: -Infinity, rmsDb: -Infinity, ms: 0, bad: 'render failed' });
      continue;
    }
    let peak = 0;
    let rms = 0;
    let bad: string | null = null;
    for (const b of bufs) {
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) { bad = 'NaN'; break; }
        peak = Math.max(peak, peakOf(d));
        rms = Math.max(rms, rmsOf(d));
      }
    }
    if (!bad && peak < 1e-4) bad = 'silent';
    stats.push({
      name, variants: bufs.length, seconds: bufs[0].duration, peakDb: gainToDb(peak), rmsDb: gainToDb(rms),
      ms: st.reduce((a, s) => a + s.ms, 0), bad,
    });
  }
  void done;
  return { bank, stats, totalMs: performance.now() - t0 };
}

export async function renderMusic(bank: SoundBank, kind: PerformerKind, mood: Mood, tension: number, seconds: number, seed = 7): Promise<{ buffer: AudioBuffer; stat: MusicStat }> {
  const t0 = performance.now();
  const off = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
  const conv = off.createConvolver();
  conv.buffer = makeImpulse(SR, {
    duration: 4.4, rt60: 3.4, preDelay: 0.022, brightStart: 7000, brightEnd: 1600, width: 1, seed: 23,
    early: [[0.019, 0.3], [0.027, 0.25], [0.041, 0.2], [0.053, 0.15]],
  });
  const ret = off.createGain();
  ret.gain.value = 0.6;
  conv.connect(ret).connect(off.destination);
  const dry = off.createGain();
  dry.connect(off.destination);
  const wet = off.createGain();
  wet.connect(conv);
  const p = new Performer(off, kind, { dry, wet }, (n) => bank.get(n), seed, 0, kind === 'menu' ? MENU_LEVEL : GAME_LEVEL);
  p.setMood(mood, tension);
  p.fade(1, 0.05, 0);
  p.schedule(seconds);
  const buffer = await off.startRendering();
  let peak = 0, rms = 0, bad: string | null = null;
  for (let c = 0; c < 2; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i += 97) if (!Number.isFinite(d[i])) bad = 'NaN';
    peak = Math.max(peak, peakOf(d));
    rms = Math.max(rms, rmsOf(d));
  }
  return {
    buffer,
    stat: { label: `${kind}/${mood}/t${tension}`, peakDb: gainToDb(peak), rmsDb: gainToDb(rms), ms: performance.now() - t0, bad },
  };
}

// ---- drawing ----------------------------------------------------------------------------------------
export function drawWave(g: CanvasRenderingContext2D, buf: AudioBuffer, x: number, y: number, w: number, h: number, color = '#ff8a1f') {
  const d = buf.getChannelData(0);
  const mid = y + h / 2;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.beginPath();
  g.moveTo(x, mid);
  g.lineTo(x + w, mid);
  g.stroke();
  g.fillStyle = color;
  const per = Math.max(1, Math.floor(d.length / w));
  for (let i = 0; i < w; i++) {
    let lo = 0, hi = 0;
    const s0 = i * per;
    for (let j = 0; j < per && s0 + j < d.length; j++) {
      const v = d[s0 + j];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const top = mid - hi * (h / 2);
    const bot = mid - lo * (h / 2);
    g.fillRect(x + i, top, 1, Math.max(1, bot - top));
  }
}

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi, xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** Average log-frequency magnitude spectrum. */
export function drawSpectrum(g: CanvasRenderingContext2D, buf: AudioBuffer, x: number, y: number, w: number, h: number, color = '#4fc3f7') {
  const N = 2048;
  const d = buf.getChannelData(0);
  const mag = new Float32Array(N / 2);
  let frames = 0;
  for (let s = 0; s + N < d.length && frames < 64; s += Math.max(N, Math.floor(d.length / 64))) {
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = d[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let i = 0; i < N / 2; i++) mag[i] += Math.hypot(re[i], im[i]);
    frames++;
  }
  if (!frames) return;
  g.strokeStyle = color;
  g.beginPath();
  const fmin = 20, fmax = buf.sampleRate / 2;
  for (let px = 0; px < w; px++) {
    const f = fmin * Math.pow(fmax / fmin, px / w);
    const bin = Math.min(N / 2 - 1, Math.round((f / buf.sampleRate) * N));
    const db = 20 * Math.log10(mag[bin] / frames + 1e-9);
    const yy = y + h - ((db + 60) / 90) * h;
    if (px === 0) g.moveTo(x + px, yy);
    else g.lineTo(x + px, Math.max(y, Math.min(y + h, yy)));
  }
  g.stroke();
}
