// Realtime score instruments. They work on any BaseAudioContext, so the same code drives the live score
// and offline test renders. Every voice disconnects its nodes when its last source ends.
import { karplusStrong, mtof, mulberry32, periodicWave } from '../dsp';
import { noiseSet } from '../synth';

export interface InstrumentOutputs {
  /** Dry signal (stereo). */
  dry: AudioNode;
  /** Reverb send. */
  wet: AudioNode;
  /** Tempo-synced delay send. */
  delay: AudioNode;
}

export type HitProvider = (name: string) => AudioBuffer[] | null;

const PLUCK_REF_STEP = 4;
const pluckCache = new Map<string, AudioBuffer>();

function pluckBuffer(sampleRate: number, refMidi: number): AudioBuffer {
  const key = `${sampleRate}:${refMidi}`;
  let b = pluckCache.get(key);
  if (!b) {
    const rng = mulberry32(0x9100 + refMidi);
    const data = karplusStrong(sampleRate, mtof(refMidi), 2.6, { brightness: 0.5, sustain: refMidi > 76 ? 0.994 : 0.997, body: 0.45 }, rng);
    b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    pluckCache.set(key, b);
  }
  return b;
}

export interface PadOptions {
  vel: number;
  cutoff: number;
  attack?: number;
  release?: number;
  wet?: number;
  detune?: number;
  shape?: 'warm' | 'hollow' | 'soft';
}

export class Instruments {
  private readonly lfo: GainNode;
  private readonly lfoOsc: OscillatorNode;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: InstrumentOutputs,
    private readonly hits: HitProvider,
  ) {
    // Shared slow LFO for pad filter movement (adds ±220 Hz).
    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.frequency.value = 0.07;
    this.lfo = ctx.createGain();
    this.lfo.gain.value = 220;
    this.lfoOsc.connect(this.lfo);
    this.lfoOsc.start();
  }

  dispose(when: number) {
    try {
      this.lfoOsc.stop(when);
    } catch {
      /* ignore */
    }
  }

  private cleanup(last: AudioScheduledSourceNode, nodes: AudioNode[], params: [AudioNode, AudioParam][] = []) {
    last.onended = () => {
      for (const [src, p] of params) {
        try {
          src.disconnect(p);
        } catch {
          /* ignore */
        }
      }
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }

  /** Warm analog pad chord: detuned pairs split L/R, breathing lowpass, slow envelope. */
  pad(t: number, notes: number[], dur: number, o: PadOptions) {
    if (!notes.length) return;
    const c = this.ctx;
    const a = o.attack ?? 2.4;
    const rel = o.release ?? 4;
    const end = t + dur + rel * 1.2 + 0.2;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(o.vel, t + a);
    env.gain.setValueAtTime(o.vel, t + Math.max(a, dur));
    env.gain.setTargetAtTime(0, t + Math.max(a, dur), rel / 4);
    const nodes: AudioNode[] = [env];
    const params: [AudioNode, AudioParam][] = [];
    const sides: AudioNode[] = [];
    for (const side of [-0.55, 0.55]) {
      const g = c.createGain();
      g.gain.value = 0.5 / Math.sqrt(notes.length);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.6;
      f.frequency.setValueAtTime(o.cutoff * 0.55, t);
      f.frequency.linearRampToValueAtTime(o.cutoff, t + a * 1.4);
      this.lfo.connect(f.frequency);
      params.push([this.lfo, f.frequency]);
      const p = c.createStereoPanner();
      p.pan.value = side;
      g.connect(f).connect(p).connect(env);
      nodes.push(g, f, p);
      sides.push(g);
    }
    let last: OscillatorNode | null = null;
    const wave = periodicWave(c, o.shape ?? 'warm');
    const det = o.detune ?? 7;
    for (const m of notes) {
      sides.forEach((dest, i) => {
        const osc = c.createOscillator();
        osc.setPeriodicWave(wave);
        osc.frequency.value = mtof(m);
        osc.detune.value = (i === 0 ? -det : det) + (Math.random() - 0.5) * 3;
        osc.connect(dest);
        osc.start(t);
        osc.stop(end);
        nodes.push(osc);
        last = osc;
      });
    }
    env.connect(this.out.dry);
    const ws = c.createGain();
    ws.gain.value = o.wet ?? 0.55;
    env.connect(ws).connect(this.out.wet);
    nodes.push(ws);
    if (last) this.cleanup(last, nodes, params);
  }

  /** Sub drone: sine + soft octave, lowpassed. */
  sub(t: number, midi: number, dur: number, vel: number, attack = 1.6, release = 3) {
    const c = this.ctx;
    const end = t + dur + release * 1.2 + 0.1;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + attack);
    env.gain.setValueAtTime(vel, t + Math.max(attack, dur));
    env.gain.setTargetAtTime(0, t + Math.max(attack, dur), release / 4);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const o1 = c.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = mtof(midi);
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(midi + 12);
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(env).connect(this.out.dry);
    o1.start(t);
    o2.start(t);
    o1.stop(end);
    o2.stop(end);
    this.cleanup(o1, [o1, o2, g2, lp, env]);
  }

  /** Karplus-Strong pluck (pre-rendered per reference pitch, resampled). */
  pluck(t: number, midi: number, vel: number, pan: number, delaySend = 0.25, wet = 0.35, cutoff = 6000) {
    const c = this.ctx;
    const ref = Math.round(midi / PLUCK_REF_STEP) * PLUCK_REF_STEP;
    const src = c.createBufferSource();
    src.buffer = pluckBuffer(c.sampleRate, ref);
    src.playbackRate.value = Math.pow(2, (midi - ref) / 12);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = vel;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(lp).connect(g).connect(p).connect(this.out.dry);
    const ds = c.createGain();
    ds.gain.value = delaySend;
    p.connect(ds).connect(this.out.delay);
    const ws = c.createGain();
    ws.gain.value = wet;
    p.connect(ws).connect(this.out.wet);
    src.start(t);
    this.cleanup(src, [src, lp, g, p, ds, ws]);
  }

  /** FM bell / glass chime. */
  bell(t: number, midi: number, vel: number, pan: number, decay = 2.6, wet = 0.6, ratio = 3.5, index = 1.4) {
    const c = this.ctx;
    const f = mtof(midi);
    const end = t + decay + 0.2;
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.setTargetAtTime(0, t, decay * 0.12);
    mod.connect(mg).connect(car.frequency);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.005);
    env.gain.setTargetAtTime(0, t + 0.005, decay / 5);
    const oct = c.createOscillator();
    oct.frequency.value = f * 2.001;
    const og = c.createGain();
    og.gain.setValueAtTime(vel * 0.08, t);
    og.gain.setTargetAtTime(0, t, decay / 12);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    car.connect(env).connect(p);
    oct.connect(og).connect(p);
    p.connect(this.out.dry);
    const ws = c.createGain();
    ws.gain.value = wet;
    p.connect(ws).connect(this.out.wet);
    const ds = c.createGain();
    ds.gain.value = 0.18;
    p.connect(ds).connect(this.out.delay);
    for (const o of [car, mod, oct]) {
      o.start(t);
      o.stop(end);
    }
    this.cleanup(car, [car, mod, mg, env, oct, og, p, ws, ds]);
  }

  /** Breathy soft lead (ocarina / flute-like) with delayed vibrato. */
  lead(t: number, midi: number, dur: number, vel: number, pan = 0.1, wet = 0.6) {
    const c = this.ctx;
    const f = mtof(midi);
    const rel = 0.45;
    const end = t + dur + rel * 1.5 + 0.1;
    const osc = c.createOscillator();
    osc.setPeriodicWave(periodicWave(c, 'soft'));
    osc.frequency.value = f;
    const vib = c.createOscillator();
    vib.frequency.value = 4.8 + Math.random() * 0.6;
    const vg = c.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(11, t + Math.min(dur, 0.6) + 0.25);
    vib.connect(vg).connect(osc.detune);
    const breath = c.createBufferSource();
    breath.buffer = noiseSet(c.sampleRate).white;
    breath.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 1.5;
    const bg = c.createGain();
    bg.gain.value = 0.05;
    breath.connect(bp).connect(bg);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.12);
    env.gain.setValueAtTime(vel, t + Math.max(0.12, dur));
    env.gain.setTargetAtTime(0, t + Math.max(0.12, dur), rel / 4);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    osc.connect(lp);
    bg.connect(lp);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    lp.connect(env).connect(p).connect(this.out.dry);
    const ws = c.createGain();
    ws.gain.value = wet;
    p.connect(ws).connect(this.out.wet);
    const ds = c.createGain();
    ds.gain.value = 0.22;
    p.connect(ds).connect(this.out.delay);
    osc.start(t);
    vib.start(t);
    breath.start(t, Math.random() * 3);
    for (const s of [osc, vib, breath]) s.stop(end);
    this.cleanup(osc, [osc, vib, vg, breath, bp, bg, env, lp, p, ws, ds]);
  }

  /** Pre-rendered percussion / texture hit. */
  hit(name: string, t: number, vel: number, o: { rate?: number; pan?: number; wet?: number; delay?: number } = {}) {
    const bufs = this.hits(name);
    if (!bufs || !bufs.length) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    src.playbackRate.value = o.rate ?? 1;
    const g = c.createGain();
    g.gain.value = vel;
    const p = c.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    src.connect(g).connect(p).connect(this.out.dry);
    const nodes: AudioNode[] = [src, g, p];
    if (o.wet) {
      const ws = c.createGain();
      ws.gain.value = o.wet;
      p.connect(ws).connect(this.out.wet);
      nodes.push(ws);
    }
    if (o.delay) {
      const ds = c.createGain();
      ds.gain.value = o.delay;
      p.connect(ds).connect(this.out.delay);
      nodes.push(ds);
    }
    src.start(t);
    this.cleanup(src, nodes);
  }
}

/** Dark sustained cluster (root, ♭2, fifth) for the tension layer. Long-lived; level is automated. */
export class TensionDrone {
  private readonly oscs: OscillatorNode[] = [];
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly lfo: OscillatorNode;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, wet: AudioNode, rootMidi: number, t: number) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 380;
    this.filter.Q.value = 2;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 160;
    this.lfo.connect(lg).connect(this.filter.frequency);
    const wave = periodicWave(ctx, 'warm');
    [[0, 0.5, -6], [1, 0.28, 5], [7, 0.3, 3], [12, 0.15, -4]].forEach(([iv, a, det]) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = mtof(rootMidi + iv);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.filter);
      o.start(t);
      this.oscs.push(o);
    });
    this.lfo.start(t);
    this.filter.connect(this.gain);
    this.gain.connect(dest);
    const ws = ctx.createGain();
    ws.gain.value = 0.5;
    this.gain.connect(ws).connect(wet);
  }

  setRoot(rootMidi: number, t: number) {
    const ivs = [0, 1, 7, 12];
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(mtof(rootMidi + ivs[i]), t, 1.5));
  }

  private level = -1;

  setLevel(level: number, t: number) {
    if (Math.abs(level - this.level) < 0.004) return;
    this.level = level;
    this.gain.gain.setTargetAtTime(level, t, 1.2);
    this.filter.Q.setTargetAtTime(1.5 + level * 6, t, 1.5);
  }

  stop(t: number) {
    for (const o of [...this.oscs, this.lfo]) {
      try {
        o.stop(t);
      } catch {
        /* ignore */
      }
    }
    this.lfo.onended = () => {
      try {
        this.gain.disconnect();
        this.filter.disconnect();
      } catch {
        /* ignore */
      }
    };
  }
}
