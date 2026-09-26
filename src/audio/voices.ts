// One-shot playback of pre-rendered sounds: variant selection, pitch variation, optional 3D positioning
// with distance-dependent air absorption and reverb send, per-name & global voice caps with stealing.
import type { AudioCore, BusName, ReverbKind } from './core';
import type { SoundBank } from './bank';
import { clamp } from './dsp';

export interface Vec3Like { x: number; y: number; z: number }

/** Listener pose, updated every frame from the camera. */
export class Listener {
  x = 0; y = 80; z = 0;
  fx = 0; fy = 0; fz = -1;
  ux = 0; uy = 1; uz = 0;
  valid = false;

  distanceTo(p: Vec3Like): number {
    const dx = p.x - this.x, dy = p.y - this.y, dz = p.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Stereo pan (-1..1) of a world point relative to the listener's right vector. */
  panOf(p: Vec3Like): number {
    const dx = p.x - this.x, dz = p.z - this.z;
    // right = forward × up
    const rx = this.fy * this.uz - this.fz * this.uy;
    const rz = this.fx * this.uy - this.fy * this.ux;
    const len = Math.hypot(dx, dz) || 1;
    const rl = Math.hypot(rx, rz) || 1;
    return clamp((dx * rx + dz * rz) / (len * rl), -1, 1);
  }
}

export interface PlayOptions {
  /** World position → 3D positioned via PannerNode. */
  at?: Vec3Like | null;
  /** Linear gain multiplier (default 1). */
  volume?: number;
  /** Playback-rate multiplier (pitch & speed). */
  rate?: number;
  /** Random pitch variation ± semitones (default 0.4 for positioned, 0 otherwise). */
  pitchVar?: number;
  /** Stereo pan for non-positioned sounds. */
  pan?: number;
  bus?: BusName;
  /** Reverb send amount (0..1) and kind. */
  reverb?: number;
  reverbKind?: ReverbKind;
  /** Start delay in seconds (e.g. speed-of-sound delay). */
  delay?: number;
  /** Extra lowpass (Hz). */
  lowpass?: number;
  /** PannerNode refDistance (blocks). */
  ref?: number;
  /** Cull beyond this distance (blocks). */
  maxDist?: number;
  /** Force variant index. */
  variant?: number;
  /** Max simultaneous voices with this name (default 4). */
  maxVoices?: number;
  /** Higher survives stealing (default 1). */
  priority?: number;
}

interface ActiveVoice {
  name: string;
  src: AudioBufferSourceNode;
  out: GainNode;
  nodes: AudioNode[];
  started: number;
  ends: number;
  priority: number;
}

const GLOBAL_CAP = 36;
const PENDING_MAX_AGE = 0.35;

export class SfxPlayer {
  private voices: ActiveVoice[] = [];
  private lastPlayed = new Map<string, number>();
  private lastVariant = new Map<string, number>();

  constructor(
    private core: AudioCore,
    private bank: SoundBank,
    private listener: Listener,
  ) {}

  get activeCount() {
    return this.voices.length;
  }

  /** Play a named one-shot. Returns false if culled/unknown. Never throws. */
  play(name: string, o: PlayOptions = {}): boolean {
    const ctx = this.core.ctx;
    if (!ctx || !this.core.buses || !this.bank.exists(name)) return false;
    // cull far-away sounds early
    let dist = 0;
    if (o.at) {
      dist = this.listener.distanceTo(o.at);
      if (dist > (o.maxDist ?? 160)) return false;
    }
    const bufs = this.bank.get(name);
    if (!bufs) {
      const requested = ctx.currentTime;
      void this.bank.load(name).then((b) => {
        if (b && this.core.ctx && this.core.ctx.currentTime - requested < PENDING_MAX_AGE) this.start(name, b, o, this.core.ctx);
      });
      return true;
    }
    return this.start(name, bufs, o, ctx);
  }

  /** Seconds since `name` last started (Infinity if never). */
  sinceLast(name: string): number {
    const t = this.lastPlayed.get(name);
    return t === undefined || !this.core.ctx ? Infinity : this.core.ctx.currentTime - t;
  }

  stopAll(fade = 0.1) {
    const ctx = this.core.ctx;
    if (!ctx) return;
    for (const v of this.voices) this.kill(v, fade, ctx);
    this.voices = [];
  }

  private start(name: string, bufs: AudioBuffer[], o: PlayOptions, ctx: AudioContext): boolean {
    try {
      const buses = this.core.buses!;
      const bus = buses[o.bus ?? 'sfx'];
      this.reap(ctx.currentTime);
      this.enforceCaps(name, o.maxVoices ?? 4, o.priority ?? 1, ctx);

      // choose a variant, avoiding immediate repeats
      let vi = o.variant ?? 0;
      if (o.variant === undefined && bufs.length > 1) {
        const last = this.lastVariant.get(name) ?? -1;
        vi = Math.floor(Math.random() * (bufs.length - 1));
        if (vi >= last) vi++;
        vi = Math.min(vi, bufs.length - 1);
      }
      this.lastVariant.set(name, vi);
      const buf = bufs[vi];

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const pv = o.pitchVar ?? (o.at ? 0.4 : 0);
      const semis = pv > 0 ? (Math.random() * 2 - 1) * pv : 0;
      src.playbackRate.value = clamp((o.rate ?? 1) * Math.pow(2, semis / 12), 0.1, 8);

      const nodes: AudioNode[] = [src];
      const g = ctx.createGain();
      g.gain.value = Math.max(0, o.volume ?? 1);
      nodes.push(g);
      let head: AudioNode = g;
      src.connect(g);

      let lp = o.lowpass ?? 22050;
      let sendScale = 1;
      if (o.at) {
        const d = this.listener.distanceTo(o.at);
        // air absorption: high frequencies die off with distance
        lp = Math.min(lp, clamp(22000 * Math.exp(-d / 140), 500, 22000));
        const ref = o.ref ?? 4;
        const direct = ref / (ref + Math.max(0, d - ref));
        // reverb falls off slower than the direct sound → distant sounds are more reverberant
        sendScale = Math.sqrt(direct);
      }
      if (lp < 20000) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = Math.min(lp, ctx.sampleRate * 0.45);
        f.Q.value = 0.5;
        head.connect(f);
        head = f;
        nodes.push(f);
      }

      if (o.at) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = o.ref ?? 4;
        p.rolloffFactor = 1;
        p.maxDistance = 10000;
        setPannerPosition(p, o.at.x, o.at.y, o.at.z);
        head.connect(p);
        p.connect(bus.dry);
        nodes.push(p);
      } else if (o.pan) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = clamp(o.pan, -1, 1);
        head.connect(sp);
        sp.connect(bus.dry);
        nodes.push(sp);
      } else {
        head.connect(bus.dry);
      }

      const send = o.reverb ?? 0;
      if (send > 0) {
        const sg = ctx.createGain();
        sg.gain.value = send * sendScale;
        head.connect(sg);
        sg.connect(bus.sends[o.reverbKind ?? (o.bus === 'ui' ? 'room' : 'outdoor')]);
        nodes.push(sg);
      }

      const when = ctx.currentTime + Math.max(0, o.delay ?? 0);
      src.start(when);
      const dur = buf.duration / src.playbackRate.value;
      const voice: ActiveVoice = { name, src, out: g, nodes, started: when, ends: when + dur, priority: o.priority ?? 1 };
      src.onended = () => this.release(voice);
      this.voices.push(voice);
      this.lastPlayed.set(name, when);
      return true;
    } catch (err) {
      console.warn('[audio] play failed', name, err);
      return false;
    }
  }

  private enforceCaps(name: string, perName: number, priority: number, ctx: AudioContext) {
    const same = this.voices.filter((v) => v.name === name);
    while (same.length >= perName) {
      const oldest = same.shift()!;
      this.kill(oldest, 0.04, ctx);
      this.voices = this.voices.filter((v) => v !== oldest);
    }
    if (this.voices.length >= GLOBAL_CAP) {
      // steal the oldest voice of the lowest priority not above ours
      let victim: ActiveVoice | null = null;
      for (const v of this.voices) {
        if (v.priority > priority) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.started < victim.started)) victim = v;
      }
      if (victim) {
        this.kill(victim, 0.05, ctx);
        this.voices = this.voices.filter((v) => v !== victim);
      }
    }
  }

  private reap(now: number) {
    if (this.voices.length < 8) return;
    this.voices = this.voices.filter((v) => v.ends + 0.5 > now);
  }

  private kill(v: ActiveVoice, fade: number, ctx: AudioContext) {
    try {
      const t = ctx.currentTime;
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(v.out.gain.value, t);
      v.out.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.01);
    } catch {
      /* already stopped */
    }
  }

  private release(v: ActiveVoice) {
    this.voices = this.voices.filter((x) => x !== v);
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

export function setPannerPosition(p: PannerNode, x: number, y: number, z: number) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}
