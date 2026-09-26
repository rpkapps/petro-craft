// Environmental ambience: realtime gusting wind (with high-wind whistle), rain / snow / waves / insect /
// underwater beds, and scheduled wildlife one-shots placed around the listener by biome & time of day.
import type { BiomeId, WeatherKind } from '../../core/types';
import type { AudioCore } from '../core';
import type { SoundBank } from '../bank';
import type { Listener, SfxPlayer } from '../voices';
import { clamp, lerp, smoothstep, weighted } from '../dsp';
import { noiseSet } from '../synth';

export interface EnvInfo {
  windSpeed: number; // m/s
  weather: WeatherKind;
  precipitation: number; // 0..1
  temperature: number; // °C
  /** Camera height above the ground surface (blocks). */
  altitude: number;
  /** Camera height above sea level (blocks). */
  aboveSea: number;
  /** 0..1 amount of open water around the camera. */
  nearWater: number;
  biome: BiomeId;
  /** 0 (night) .. 1 (noon). */
  daylight: number;
  minuteOfDay: number;
  underwater: boolean;
  /** Loudness of nearby machinery (thins wildlife). */
  industrial: number;
}

class Bed {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private silentFor = 0;
  level = 0;

  constructor(
    private readonly core: AudioCore,
    private readonly bank: SoundBank,
    readonly loop: string,
    private readonly tc = 1.2,
  ) {}

  set(target: number, rate: number, dt: number) {
    const ctx = this.core.ctx;
    const buses = this.core.buses;
    if (!ctx || !buses) return;
    this.level = target;
    if (target > 0.002 && !this.src) {
      const bufs = this.bank.get(this.loop);
      if (!bufs) return;
      this.src = ctx.createBufferSource();
      this.src.buffer = bufs[0];
      this.src.loop = true;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.src.connect(this.gain).connect(buses.ambience.dry);
      this.src.start(ctx.currentTime, Math.random() * bufs[0].duration);
    }
    if (!this.src || !this.gain) return;
    this.gain.gain.setTargetAtTime(target, ctx.currentTime, this.tc);
    this.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 1);
    this.silentFor = target <= 0.002 ? this.silentFor + dt : 0;
    if (this.silentFor > this.tc * 6) this.stop();
  }

  stop() {
    const ctx = this.core.ctx;
    if (!this.src || !ctx) return;
    const src = this.src;
    const g = this.gain!;
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    try {
      src.stop(ctx.currentTime + 1);
    } catch {
      /* ignore */
    }
    src.onended = () => {
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.src = null;
    this.gain = null;
    this.silentFor = 0;
  }
}

/** Two band-passed noise streams + low rumble + whistle, each driven by smooth random walks. */
class Wind {
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioBufferSourceNode[] = [];
  private readonly bp: BiquadFilterNode[] = [];
  private readonly g: GainNode[] = [];
  private readonly rumble: GainNode;
  private readonly whistle: GainNode;
  private readonly whistleBp: BiquadFilterNode;
  private walk = [0.5, 0.5, 0.5, 0.5];
  private vel = [0, 0, 0, 0];
  private gust = 1;
  private gustVel = 0;

  constructor(private readonly core: AudioCore) {
    const ctx = core.ctx!;
    const bus = core.buses!.ambience;
    const noise = noiseSet(ctx.sampleRate);
    const t = ctx.currentTime;
    for (const side of [-0.65, 0.65]) {
      const s = ctx.createBufferSource();
      s.buffer = noise.pink;
      s.loop = true;
      s.playbackRate.value = side < 0 ? 1 : 0.97;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = side;
      s.connect(bp).connect(g).connect(p).connect(bus.dry);
      s.start(t, Math.random() * 3);
      this.srcs.push(s);
      this.bp.push(bp);
      this.g.push(g);
      this.nodes.push(s, bp, g, p);
    }
    const r = ctx.createBufferSource();
    r.buffer = noise.brown;
    r.loop = true;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 140;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    r.connect(rl).connect(this.rumble).connect(bus.dry);
    r.start(t, Math.random() * 3);
    const w = ctx.createBufferSource();
    w.buffer = noise.white;
    w.loop = true;
    this.whistleBp = ctx.createBiquadFilter();
    this.whistleBp.type = 'bandpass';
    this.whistleBp.frequency.value = 1200;
    this.whistleBp.Q.value = 14;
    this.whistle = ctx.createGain();
    this.whistle.gain.value = 0;
    w.connect(this.whistleBp).connect(this.whistle).connect(bus.dry);
    w.start(t, Math.random() * 3);
    this.srcs.push(r, w);
    this.nodes.push(r, rl, this.rumble, w, this.whistleBp, this.whistle);
  }

  update(dt: number, level: number, wind01: number) {
    const ctx = this.core.ctx!;
    const t = ctx.currentTime;
    // smooth random walks (critically damped-ish)
    for (let i = 0; i < this.walk.length; i++) {
      this.vel[i] += (Math.random() - 0.5) * dt * 1.4 - this.vel[i] * dt * 1.2 + (0.5 - this.walk[i]) * dt * 0.4;
      this.walk[i] = clamp(this.walk[i] + this.vel[i] * dt, 0, 1);
    }
    this.gustVel += (Math.random() - 0.5) * dt * (0.8 + wind01 * 2) - this.gustVel * dt * 0.9 + (1 - this.gust) * dt * 0.5;
    this.gust = clamp(this.gust + this.gustVel * dt, 0.45, 1.5);
    const gl = level * this.gust;
    for (let i = 0; i < 2; i++) {
      const f = 220 + 900 * wind01 * this.gust * (0.5 + this.walk[i]);
      this.bp[i].frequency.setTargetAtTime(f, t, 0.25);
      this.bp[i].Q.setTargetAtTime(0.7 + this.walk[i + 2] * 0.9, t, 0.4);
      this.g[i].gain.setTargetAtTime(gl * (0.6 + 0.6 * this.walk[(i + 1) % 4]), t, 0.25);
    }
    this.rumble.gain.setTargetAtTime(gl * 0.8 * smoothstep(0.3, 1, wind01), t, 0.3);
    const whistle = smoothstep(0.5, 1, wind01) * level * 0.18 * clamp(this.gust - 0.7, 0, 1);
    this.whistle.gain.setTargetAtTime(whistle, t, 0.3);
    this.whistleBp.frequency.setTargetAtTime(900 + 900 * this.walk[3] * this.gust, t, 0.5);
  }

  dispose() {
    const ctx = this.core.ctx;
    if (!ctx) return;
    for (const g of [...this.g, this.rumble, this.whistle]) g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    for (const s of this.srcs) {
      try {
        s.stop(ctx.currentTime + 1.2);
      } catch {
        /* ignore */
      }
    }
    this.srcs[0].onended = () => {
      for (const n of this.nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }
}

type Critter = 'bird_song' | 'bird_chirp' | 'bird_whistle' | 'lark' | 'gull' | 'hawk' | 'raven' | 'owl' | 'frog';

const DAY_CRITTERS: Partial<Record<BiomeId, { mean: number; pool: [Critter, number][] }>> = {
  forest: { mean: 6, pool: [['bird_song', 5], ['bird_chirp', 3], ['bird_whistle', 2]] },
  birch_forest: { mean: 6, pool: [['bird_song', 5], ['bird_chirp', 3], ['lark', 1]] },
  taiga: { mean: 11, pool: [['bird_whistle', 5], ['bird_chirp', 3], ['raven', 2]] },
  plains: { mean: 8, pool: [['lark', 4], ['bird_chirp', 4], ['bird_song', 2]] },
  desert: { mean: 26, pool: [['hawk', 5], ['raven', 3], ['bird_chirp', 2]] },
  badlands: { mean: 24, pool: [['hawk', 5], ['raven', 4]] },
  swamp: { mean: 7, pool: [['frog', 5], ['bird_song', 3], ['bird_chirp', 2]] },
  beach: { mean: 9, pool: [['gull', 7], ['bird_chirp', 2]] },
  ocean: { mean: 14, pool: [['gull', 1]] },
  deep_ocean: { mean: 25, pool: [['gull', 1]] },
  river: { mean: 8, pool: [['bird_song', 3], ['bird_chirp', 3], ['frog', 2]] },
  tundra: { mean: 30, pool: [['raven', 4], ['bird_whistle', 3], ['hawk', 1]] },
  mountains: { mean: 28, pool: [['hawk', 4], ['raven', 3], ['bird_whistle', 2]] },
};

const NIGHT_CRITTERS: Partial<Record<BiomeId, { mean: number; pool: [Critter, number][] }>> = {
  forest: { mean: 22, pool: [['owl', 1]] },
  birch_forest: { mean: 24, pool: [['owl', 1]] },
  taiga: { mean: 20, pool: [['owl', 1]] },
  plains: { mean: 35, pool: [['owl', 2], ['frog', 1]] },
  swamp: { mean: 4, pool: [['frog', 6], ['owl', 1]] },
  river: { mean: 6, pool: [['frog', 5], ['owl', 1]] },
  beach: { mean: 40, pool: [['frog', 1]] },
};

const CRICKET_BIOMES = new Set<BiomeId>(['plains', 'forest', 'birch_forest', 'swamp', 'river', 'beach', 'desert', 'badlands']);
const CICADA_BIOMES = new Set<BiomeId>(['plains', 'desert', 'badlands', 'swamp', 'forest', 'birch_forest', 'river']);

export class EnvironmentAmbience {
  private wind: Wind | null = null;
  private readonly rain: Bed;
  private readonly snow: Bed;
  private readonly waves: Bed;
  private readonly crickets: Bed;
  private readonly cicadas: Bed;
  private readonly under: Bed;
  private nextCritter = 3;
  private nextNight = 8;
  private underwater = 0;

  constructor(
    private readonly core: AudioCore,
    private readonly bank: SoundBank,
    private readonly sfx: SfxPlayer,
    private readonly listener: Listener,
  ) {
    this.rain = new Bed(core, bank, 'loop_rain', 1.5);
    this.snow = new Bed(core, bank, 'loop_snow', 2);
    this.waves = new Bed(core, bank, 'loop_waves', 1.5);
    this.crickets = new Bed(core, bank, 'loop_crickets', 3);
    this.cicadas = new Bed(core, bank, 'loop_cicadas', 3);
    this.under = new Bed(core, bank, 'loop_underwater', 0.25);
  }

  update(dt: number, e: EnvInfo) {
    const ctx = this.core.ctx;
    if (!ctx || !this.core.buses) return;
    if (!this.wind) this.wind = new Wind(this.core);

    this.underwater = lerp(this.underwater, e.underwater ? 1 : 0, clamp(dt * 6, 0, 1));
    this.core.setUnderwater(this.underwater);
    const dry = 1 - this.underwater;

    const wind01 = clamp(e.windSpeed / 20, 0, 1);
    const altF = 1 + clamp(e.altitude / 40, 0, 1) * 0.9;
    const windLevel = (0.05 + 0.75 * Math.pow(wind01, 1.3)) * altF * dry * (e.weather === 'blizzard' || e.weather === 'hurricane' ? 1.3 : 1);
    this.wind.update(dt, windLevel, clamp(wind01 * altF, 0, 1));

    const isSnow = e.weather === 'snow' || e.weather === 'blizzard';
    const precip = clamp(e.precipitation, 0, 1);
    const storm = e.weather === 'storm' || e.weather === 'hurricane' ? 1.2 : 1;
    // rain is muffled high above the ground only slightly (it's all around)
    this.rain.set(isSnow ? 0 : precip * 0.8 * storm * dry, 0.9 + precip * 0.2, dt);
    this.snow.set(isSnow ? precip * 0.35 * dry : 0, 1, dt);

    const heightF = clamp(1 - (e.aboveSea - 3) / 60, 0, 1);
    this.waves.set(e.nearWater * heightF * (0.35 + 0.5 * clamp(e.windSpeed / 15, 0, 1)) * dry, 0.9 + 0.2 * wind01, dt);

    // wildlife / insects fade with altitude, weather and noisy industry
    const altLife = clamp(1 - (e.altitude - 18) / 50, 0, 1);
    const weatherLife = clamp(1 - precip * 1.2, 0, 1) * clamp(1 - Math.max(0, e.windSpeed - 10) / 12, 0, 1) * (isSnow ? 0.2 : 1);
    const industryLife = clamp(1 - e.industrial * 0.35, 0.25, 1);
    const life = altLife * weatherLife * industryLife * dry;
    const night = 1 - smoothstep(0.12, 0.4, e.daylight);
    const day = smoothstep(0.25, 0.55, e.daylight);
    const warm = smoothstep(4, 14, e.temperature);
    const hot = smoothstep(18, 28, e.temperature);
    this.crickets.set(CRICKET_BIOMES.has(e.biome) ? night * life * warm * 0.35 : 0, 1, dt);
    this.cicadas.set(CICADA_BIOMES.has(e.biome) ? day * life * hot * 0.28 : 0, 1, dt);
    this.under.set(this.underwater * 0.9, 1, dt);

    // one-shot critters
    const dawn = e.minuteOfDay >= 300 && e.minuteOfDay < 480 ? 2 : 1;
    this.nextCritter -= dt * dawn;
    if (this.nextCritter <= 0) {
      const spec = DAY_CRITTERS[e.biome];
      const mean = spec?.mean ?? 20;
      this.nextCritter = mean * (0.4 + Math.random() * 1.2);
      if (spec && day > 0.3 && Math.random() < life) this.critter(weighted(Math.random, spec.pool), 0.75 * life);
    }
    this.nextNight -= dt;
    if (this.nextNight <= 0) {
      const spec = NIGHT_CRITTERS[e.biome] ?? (e.nearWater > 0.3 ? { mean: 10, pool: [['frog', 1]] as [Critter, number][] } : undefined);
      const mean = spec?.mean ?? 30;
      this.nextNight = mean * (0.4 + Math.random() * 1.2);
      if (spec && night > 0.5 && Math.random() < life) this.critter(weighted(Math.random, spec.pool), 0.7 * life);
    }
  }

  private critter(name: Critter, vol: number) {
    const L = this.listener;
    const ang = Math.random() * Math.PI * 2;
    const dist = name === 'hawk' || name === 'gull' ? 25 + Math.random() * 40 : 12 + Math.random() * 30;
    const up = name === 'frog' ? -1 : name === 'hawk' || name === 'gull' ? 12 + Math.random() * 20 : 3 + Math.random() * 10;
    this.sfx.play(name, {
      at: { x: L.x + Math.cos(ang) * dist, y: L.y + up, z: L.z + Math.sin(ang) * dist },
      bus: 'ambience', volume: vol, ref: 10, maxDist: 200, reverb: 0.25, reverbKind: 'outdoor', pitchVar: 0.8, maxVoices: 2, priority: 0,
    });
  }

  stopAll() {
    this.wind?.dispose();
    this.wind = null;
    for (const b of [this.rain, this.snow, this.waves, this.crickets, this.cicadas, this.under]) b.stop();
    this.core.setUnderwater(0);
    this.underwater = 0;
  }
}
