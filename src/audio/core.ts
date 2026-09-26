// AudioCore: lazy AudioContext lifecycle (unlocked on the first user gesture), mixing buses, procedural
// reverbs, master dynamics, volume ramps and the underwater "world" filter.
//
//   music.dry ─► duck ───────────────────────────────┐
//   sfx.dry / ambience.dry ─► world LPF ─────────────┤
//   ui.dry ──────────────────────────────────────────┤
//   *.send.room ─► room IR ──────────────────────────┤──► sum ─► glue comp ─► limiter ─► clip ─► master vol ─► out
//   *.send.hall ─► hall IR (music, stings) ──────────┤
//   *.send.outdoor ─► outdoor IR ─► world LPF ───────┘
import { clamp, makeImpulse, sliderToGain } from './dsp';

export type ReverbKind = 'room' | 'hall' | 'outdoor';
export type BusName = 'music' | 'sfx' | 'ambience' | 'ui';

export class Bus {
  readonly dry: GainNode;
  readonly sends: Record<ReverbKind, GainNode>;
  constructor(ctx: AudioContext) {
    this.dry = ctx.createGain();
    this.sends = { room: ctx.createGain(), hall: ctx.createGain(), outdoor: ctx.createGain() };
  }
  setVolume(g: number, t: number, tc: number) {
    this.dry.gain.setTargetAtTime(g, t, tc);
    for (const s of Object.values(this.sends)) s.gain.setTargetAtTime(g, t, tc);
  }
  disconnect() {
    try {
      this.dry.disconnect();
      for (const s of Object.values(this.sends)) s.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

type UnlockListener = (ctx: AudioContext) => void;

// Events that grant (or follow) transient user activation; touchstart alone does not, so touchend/click are included.
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'pointerup', 'click', 'touchend'] as const;

export class AudioCore {
  ctx: AudioContext | null = null;
  buses: Record<BusName, Bus> | null = null;
  private sum: GainNode | null = null;
  private masterOut: GainNode | null = null;
  private duck: GainNode | null = null;
  private world: BiquadFilterNode | null = null;
  private worldGain: GainNode | null = null;
  private returns: Record<ReverbKind, GainNode> | null = null;
  private listeners: UnlockListener[] = [];
  private gestureBound = false;
  private failed = false;
  private volumes = { master: 0.8, music: 0.5, sfx: 0.8 };
  private underwater = 0;
  private hiddenSuspended = false;

  constructor() {
    this.bindGestures();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** True once the graph exists (context may still be suspended until a gesture). */
  get ready(): boolean {
    return !!this.ctx && !!this.buses;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  onUnlock(fn: UnlockListener) {
    this.listeners.push(fn);
    if (this.ready) fn(this.ctx!);
  }

  /** Create (if needed) and resume the context. Safe to call anytime; never throws. */
  unlock(): boolean {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined =
          typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
        if (!Ctor) {
          this.failed = true;
          return false;
        }
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.build(this.ctx);
        this.ctx.addEventListener('statechange', () => {
          if (this.ctx && this.ctx.state !== 'running' && !this.hiddenSuspended) this.bindGestures();
        });
        for (const fn of this.listeners) {
          try {
            fn(this.ctx);
          } catch (err) {
            console.error('[audio] unlock listener failed', err);
          }
        }
      }
      if (this.ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) {
        void this.ctx.resume().catch(() => {});
      }
      return true;
    } catch (err) {
      this.failed = true;
      console.warn('[audio] WebAudio unavailable:', err);
      return false;
    }
  }

  private onGesture = () => {
    this.unlock();
    if (this.ctx && this.ctx.state === 'running') this.unbindGestures();
    else if (this.ctx) {
      // resume() resolves asynchronously; unbind once it is running.
      void this.ctx.resume().then(() => {
        if (this.ctx?.state === 'running') this.unbindGestures();
      }).catch(() => {});
    }
  };

  private bindGestures() {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    for (const g of GESTURES) window.addEventListener(g, this.onGesture, { capture: true, passive: true });
  }

  private unbindGestures() {
    if (!this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = false;
    for (const g of GESTURES) window.removeEventListener(g, this.onGesture, { capture: true });
  }

  private onVisibility = () => {
    const ctx = this.ctx;
    if (!ctx || !this.masterOut) return;
    try {
      if (document.hidden) {
        this.masterOut.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        this.hiddenSuspended = true;
        setTimeout(() => {
          if (document.hidden && this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {});
        }, 250);
      } else {
        this.hiddenSuspended = false;
        void ctx.resume().catch(() => {});
        this.masterOut.gain.setTargetAtTime(sliderToGain(this.volumes.master), ctx.currentTime, 0.15);
      }
    } catch {
      /* ignore */
    }
  };

  private build(ctx: AudioContext) {
    const sum = ctx.createGain();
    sum.gain.value = 0.85;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.012;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.2;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    const masterOut = ctx.createGain();
    masterOut.gain.value = sliderToGain(this.volumes.master);
    sum.connect(glue).connect(limiter).connect(makeup).connect(clip).connect(masterOut).connect(ctx.destination);

    const world = ctx.createBiquadFilter();
    world.type = 'lowpass';
    world.frequency.value = 20000;
    world.Q.value = 0.5;
    const worldGain = ctx.createGain();
    world.connect(worldGain).connect(sum);

    const duck = ctx.createGain();
    duck.connect(sum);

    const sr = ctx.sampleRate;
    const room = ctx.createConvolver();
    room.buffer = makeImpulse(sr, {
      duration: 0.9, rt60: 0.55, preDelay: 0.004, brightStart: 9000, brightEnd: 3000, width: 0.9, seed: 11,
      early: [[0.007, 0.5], [0.011, 0.35], [0.017, 0.3], [0.023, 0.2]],
    });
    const hall = ctx.createConvolver();
    hall.buffer = makeImpulse(sr, {
      duration: 4.4, rt60: 3.4, preDelay: 0.022, brightStart: 7000, brightEnd: 1600, width: 1, seed: 23,
      early: [[0.019, 0.3], [0.027, 0.25], [0.041, 0.2], [0.053, 0.15]],
    });
    const outdoor = ctx.createConvolver();
    outdoor.buffer = makeImpulse(sr, {
      duration: 3.8, rt60: 2.6, preDelay: 0.03, brightStart: 3500, brightEnd: 600, width: 1, seed: 37,
      early: [[0.045, 0.2], [0.09, 0.12]],
      slaps: [[0.35, 0.25], [0.8, 0.15], [1.45, 0.08]],
    });
    const returns: Record<ReverbKind, GainNode> = { room: ctx.createGain(), hall: ctx.createGain(), outdoor: ctx.createGain() };
    returns.room.gain.value = 0.5;
    returns.hall.gain.value = 0.6;
    returns.outdoor.gain.value = 0.75;
    room.connect(returns.room).connect(sum);
    hall.connect(returns.hall).connect(sum);
    outdoor.connect(returns.outdoor).connect(world);

    const buses: Record<BusName, Bus> = { music: new Bus(ctx), sfx: new Bus(ctx), ambience: new Bus(ctx), ui: new Bus(ctx) };
    buses.music.dry.connect(duck);
    buses.sfx.dry.connect(world);
    buses.ambience.dry.connect(world);
    buses.ui.dry.connect(sum);
    for (const b of Object.values(buses)) {
      b.sends.room.connect(room);
      b.sends.hall.connect(hall);
      b.sends.outdoor.connect(outdoor);
    }

    this.sum = sum;
    this.masterOut = masterOut;
    this.duck = duck;
    this.world = world;
    this.worldGain = worldGain;
    this.returns = returns;
    this.buses = buses;
    this.applyVolumes(0);
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master: clamp(master, 0, 1), music: clamp(music, 0, 1), sfx: clamp(sfx, 0, 1) };
    this.applyVolumes(0.08);
  }

  getVolumes() {
    return { ...this.volumes };
  }

  private applyVolumes(tc: number) {
    const ctx = this.ctx;
    if (!ctx || !this.buses || !this.masterOut) return;
    const t = ctx.currentTime;
    const time = Math.max(0.001, tc);
    if (!(typeof document !== 'undefined' && document.hidden)) this.masterOut.gain.setTargetAtTime(sliderToGain(this.volumes.master), t, time);
    const mus = sliderToGain(this.volumes.music);
    const sfx = sliderToGain(this.volumes.sfx);
    this.buses.music.setVolume(mus, t, time);
    this.buses.sfx.setVolume(sfx, t, time);
    this.buses.ambience.setVolume(sfx * 0.9, t, time);
    this.buses.ui.setVolume(sfx, t, time);
  }

  /** Temporarily lower the music (dB, negative) — for stings, explosions, alarms. */
  duckMusic(db: number, hold: number, release = 1.2) {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const t = ctx.currentTime;
    const g = Math.pow(10, Math.min(0, db) / 20);
    const p = this.duck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(Math.min(g, p.value), t, 0.08);
    p.setTargetAtTime(1, t + 0.25 + hold, release / 3);
  }

  /** 0 = dry air, 1 = fully submerged (lowpass the world, soften music). */
  setUnderwater(amount: number) {
    const ctx = this.ctx;
    if (!ctx || !this.world || !this.worldGain) return;
    const a = clamp(amount, 0, 1);
    if (Math.abs(a - this.underwater) < 0.01) return;
    this.underwater = a;
    const t = ctx.currentTime;
    this.world.frequency.setTargetAtTime(20000 * Math.pow(550 / 20000, a), t, 0.12);
    this.world.Q.setTargetAtTime(0.5 + a * 1.5, t, 0.12);
    this.worldGain.gain.setTargetAtTime(1 + a * 0.4, t, 0.12);
    if (this.returns) this.returns.hall.gain.setTargetAtTime(0.6 * (1 - a * 0.5), t, 0.2);
  }
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const c = new Float32Array(n);
  const knee = 0.85;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // WaveShaper maps [-1, 1] across the curve
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(x) * Math.min(1, y);
  }
  return c;
}
