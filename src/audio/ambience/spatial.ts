// Spatial ambience: picks the (up to) 8 loudest positioned loop layers around the listener and runs them
// as looping, panned voices with smooth fades, rate glides, distance-based air absorption and a reverb send.
import type { GameContext } from '../../core/types';
import type { AudioCore } from '../core';
import type { SoundBank } from '../bank';
import { clamp } from '../dsp';
import { setPannerPosition, type Listener } from '../voices';
import { collectEmitters, type Emitter, type LoopLayer } from './emitters';

export const MAX_LOOP_VOICES = 8;
const SELECT_INTERVAL = 0.25;
const FADE_TC = 0.35;

interface Candidate {
  key: string;
  layer: LoopLayer;
  x: number;
  y: number;
  z: number;
  dist: number;
  score: number;
}

class LoopVoice {
  readonly src: AudioBufferSourceNode;
  readonly lp: BiquadFilterNode;
  readonly gain: GainNode;
  readonly send: GainNode;
  readonly panner: PannerNode;
  dyingSince = -1;

  constructor(core: AudioCore, buf: AudioBuffer, c: Candidate) {
    const ctx = core.ctx!;
    const bus = core.buses!.ambience;
    this.src = ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src.playbackRate.value = c.layer.rate;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.rolloffFactor = 1;
    this.panner.maxDistance = 10000;
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    this.src.connect(this.lp).connect(this.gain).connect(this.panner).connect(bus.dry);
    this.gain.connect(this.send).connect(bus.sends.outdoor);
    this.src.start(ctx.currentTime, Math.random() * buf.duration);
  }

  apply(ctx: BaseAudioContext, c: Candidate) {
    const t = ctx.currentTime;
    this.dyingSince = -1;
    this.panner.refDistance = c.layer.ref;
    setPannerPosition(this.panner, c.x, c.y, c.z);
    this.gain.gain.setTargetAtTime(c.layer.gain, t, FADE_TC);
    this.src.playbackRate.setTargetAtTime(c.layer.rate, t, 0.6);
    const air = clamp(22000 * Math.exp(-c.dist / 140), 600, 20000);
    this.lp.frequency.setTargetAtTime(air, t, 0.2);
    const direct = c.layer.ref / (c.layer.ref + Math.max(0, c.dist - c.layer.ref));
    this.send.gain.setTargetAtTime(0.18 * Math.sqrt(direct), t, 0.3);
  }

  fadeOut(ctx: BaseAudioContext) {
    if (this.dyingSince >= 0) return;
    this.dyingSince = ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_TC);
  }

  dispose(ctx: BaseAudioContext) {
    try {
      this.src.stop(ctx.currentTime + 0.05);
    } catch {
      /* ignore */
    }
    this.src.onended = () => {
      for (const n of [this.src, this.lp, this.gain, this.panner, this.send]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }
}

export class SpatialLoops {
  private voices = new Map<string, LoopVoice>();
  private emitters: Emitter[] = [];
  private cands: Candidate[] = [];
  private timer = 0;
  readonly firePositions = new Map<string, { x: number; y: number; z: number }>();
  /** Summed loudness estimate of nearby machinery (0..~2) — used to thin out wildlife. */
  industrialLoudness = 0;

  constructor(
    private readonly core: AudioCore,
    private readonly bank: SoundBank,
  ) {}

  get voiceCount() {
    return this.voices.size;
  }

  activeKeys(): string[] {
    return [...this.voices.entries()].filter(([, v]) => v.dyingSince < 0).map(([k]) => k);
  }

  update(dt: number, game: GameContext, listener: Listener) {
    const ctx = this.core.ctx;
    if (!ctx || !this.core.buses) return;
    this.timer -= dt;
    if (this.timer > 0) {
      this.reap(ctx);
      return;
    }
    this.timer = SELECT_INTERVAL;
    collectEmitters(game, this.emitters, this.firePositions);

    const cands = this.cands;
    cands.length = 0;
    let industrial = 0;
    for (const e of this.emitters) {
      const dx = e.x - listener.x, dy = e.y - listener.y, dz = e.z - listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e.layers.forEach((layer, i) => {
        if (dist > layer.maxDist || layer.gain <= 0.001) return;
        const direct = layer.ref / (layer.ref + Math.max(0, dist - layer.ref));
        const score = layer.gain * direct;
        if (score < 0.004) return;
        industrial += score;
        cands.push({ key: `${e.key}#${i}:${layer.loop}`, layer, x: e.x, y: e.y, z: e.z, dist, score });
      });
    }
    this.industrialLoudness = industrial;
    cands.sort((a, b) => b.score - a.score);
    const chosen = new Set<string>();
    for (const c of cands) {
      if (chosen.size >= MAX_LOOP_VOICES) break;
      const buf = this.bank.get(c.layer.loop);
      if (!buf) continue; // still rendering; picked up next round
      chosen.add(c.key);
      let v = this.voices.get(c.key);
      if (!v) {
        try {
          v = new LoopVoice(this.core, buf[0], c);
          this.voices.set(c.key, v);
        } catch (err) {
          console.warn('[audio] loop voice failed', err);
          continue;
        }
      }
      v.apply(ctx, c);
    }
    for (const [k, v] of this.voices) if (!chosen.has(k)) v.fadeOut(ctx);
    this.reap(ctx);
  }

  private reap(ctx: BaseAudioContext) {
    const now = ctx.currentTime;
    for (const [k, v] of this.voices) {
      if (v.dyingSince >= 0 && now - v.dyingSince > FADE_TC * 6) {
        v.dispose(ctx);
        this.voices.delete(k);
      }
    }
  }

  stopAll() {
    const ctx = this.core.ctx;
    if (!ctx) return;
    for (const v of this.voices.values()) {
      v.fadeOut(ctx);
      const vv = v;
      setTimeout(() => vv.dispose(ctx), 1500);
    }
    this.voices.clear();
    this.firePositions.clear();
  }
}
