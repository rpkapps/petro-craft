// The audio engine: glues the core (context/buses), sound bank, one-shot player, spatial loops,
// environment beds and the music director to the game (events, camera, state).
import type { AppShell, RenderHost } from '../core/client';
import type { GameContext, Vec3 } from '../core/types';
import { B } from '../core/blocks';
import { SEA_LEVEL } from '../core/constants';
import { AudioCore } from './core';
import { SoundBank } from './bank';
import { Listener, SfxPlayer, type PlayOptions } from './voices';
import { MusicDirector } from './music/director';
import type { Mood } from './music/composer';
import { SpatialLoops } from './ambience/spatial';
import { EnvironmentAmbience, type EnvInfo } from './ambience/environment';
import { wireEvents, type SoundActions } from './events';
import { clamp } from './dsp';
import { UI_SOUND_NAMES } from './recipes';
import { breakSound, footstepSound, placeSound } from './materials';

export type UiSound = 'click' | 'hover' | 'open' | 'close' | 'error' | 'success' | 'cash' | 'notify' | 'alarm';

const UI_LEVEL: Record<string, number> = {
  click: 0.8, hover: 0.55, open: 0.8, close: 0.75, error: 0.9, success: 0.85, cash: 0.85, notify: 0.8, alarm: 0.8,
  warn: 0.85, danger: 0.9, saved: 0.9, pickup: 0.8, stamp: 0.9,
};

/** Friendly aliases accepted by 'audio:play'. */
export const SOUND_ALIASES: Record<string, string> = {
  beep: 'detector_beep', detector: 'detector_beep', blip: 'scanner_blip', scanner: 'scanner_blip', scan: 'scanner_sweep',
  klaxon: 'alarm', bell: 'kick_alarm', alarm_bell: 'kick_alarm', fanfare: 'sting_complete', complete: 'sting_complete',
  discovery: 'sting_discovery', gusher: 'sting_discovery', dry_hole: 'sting_dry', research: 'sting_research',
  contract: 'sting_contract', construction: 'construct', build: 'construct', fire: 'fire_ignite', ignite: 'fire_ignite',
  extinguish: 'fire_out', coin: 'cash', money: 'cash', chime: 'notify', warning: 'warn', footstep: 'footstep_stone',
  break: 'break_stone', place: 'place_stone', demolition: 'demolish', leak: 'leak_hiss', ping: 'sonar', ratchet: 'wrench',
  roar: 'blowout_roar', drop: 'place_dirt', rustle: 'break_leaves', glass: 'break_glass', water: 'splash',
};

const MOOD_OF = (minute: number): Mood =>
  minute >= 300 && minute < 480 ? 'dawn' : minute >= 480 && minute < 1020 ? 'day' : minute >= 1020 && minute < 1260 ? 'dusk' : 'night';

/** Semitone distance −6..+5 from C to the key, for transposing stings. */
const transposeRate = (pc: number) => Math.pow(2, ((((pc + 6) % 12) + 12) % 12 - 6) / 12);

export class AudioEngineImpl implements SoundActions {
  readonly core = new AudioCore();
  readonly listener = new Listener();
  bank: SoundBank | null = null;
  sfx: SfxPlayer | null = null;
  music: MusicDirector | null = null;
  env: EnvironmentAmbience | null = null;
  spatial: SpatialLoops | null = null;
  game: GameContext | null = null;
  host: RenderHost | null = null;

  private unsub: (() => void) | null = null;
  private wantMenu = false;
  private envTimer = 0;
  private envDt = 0;
  private waterTimer = 0;
  private moodTimer = 0;
  private nearWater = 0;
  private envInfo: EnvInfo = {
    windSpeed: 4, weather: 'clear', precipitation: 0, temperature: 18, altitude: 2, aboveSea: 10, nearWater: 0,
    biome: 'plains', daylight: 1, minuteOfDay: 720, underwater: false, industrial: 0,
  };
  private hiss: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private hissLast = 0;
  private uiLast = new Map<string, number>();
  mood: Mood = 'day';
  tension = 0;

  constructor(app: AppShell | null) {
    if (app?.settings) this.core.setVolumes(app.settings.masterVolume, app.settings.musicVolume, app.settings.sfxVolume);
    this.core.onUnlock(() => this.onUnlocked());
  }

  // ---- lifecycle -----------------------------------------------------------------------------------
  private onUnlocked() {
    const ctx = this.core.ctx!;
    this.bank = new SoundBank(ctx.sampleRate);
    this.bank.onError = (name, err) => console.warn(`[audio] failed to render "${name}"`, err);
    this.sfx = new SfxPlayer(this.core, this.bank, this.listener);
    this.music = new MusicDirector(this.core, this.bank);
    this.spatial = new SpatialLoops(this.core, this.bank);
    this.env = new EnvironmentAmbience(this.core, this.bank, this.sfx, this.listener);
    // UI sounds first (they're tiny), then everything else in the background.
    const bank = this.bank;
    void bank.prerenderAll((n) => UI_SOUND_NAMES.includes(n)).then(() => setTimeout(() => void bank.prerenderAll(), 30));
    this.music.setMode(this.game ? 'game' : this.wantMenu ? 'menu' : 'off');
  }

  /** Force-create the AudioContext (normally done by the first user gesture). */
  unlock(): boolean {
    return this.core.unlock();
  }

  attach(ctx: GameContext, host: RenderHost) {
    this.detachEvents();
    this.game = ctx;
    this.host = host;
    this.unsub = wireEvents(ctx.bus, this);
    this.music?.setMode('game');
  }

  detach() {
    this.detachEvents();
    this.spatial?.stopAll();
    this.env?.stopAll();
    this.stopHiss(0.1);
    this.sfx?.stopAll(0.3);
    this.game = null;
    this.host = null;
    this.tension = 0;
    this.music?.setMood(this.mood, 0);
    this.music?.setMode(this.wantMenu ? 'menu' : 'off');
  }

  private detachEvents() {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.core.setVolumes(master, music, sfx);
  }

  menuMusic(on: boolean) {
    this.wantMenu = on;
    this.music?.setMode(on ? 'menu' : this.game ? 'game' : 'off');
  }

  ui(sound: UiSound) {
    this.uiSound(sound);
  }

  // ---- per frame -----------------------------------------------------------------------------------
  update(dt: number) {
    if (!this.core.ready || !this.game) return;
    const d = Math.min(0.25, Math.max(0, dt || 0));
    this.updateListener();
    const game = this.game;

    this.moodTimer -= d;
    if (this.moodTimer <= 0) {
      this.moodTimer = 0.5;
      this.computeMood(game);
    }

    this.spatial?.update(d, game, this.listener);

    this.envDt += d;
    this.envTimer -= d;
    if (this.envTimer <= 0) {
      this.envTimer = 0.1;
      this.computeEnv(game, this.envDt);
      this.env?.update(this.envDt, this.envInfo);
      this.envDt = 0;
    }

    if (this.hiss && performance.now() / 1000 - this.hissLast > 0.3) this.stopHiss(0.15);
  }

  private updateListener() {
    const cam = this.host?.camera;
    const ctx = this.core.ctx;
    if (!cam || !ctx) return;
    const e = cam.matrixWorld.elements;
    const L = this.listener;
    L.x = e[12];
    L.y = e[13];
    L.z = e[14];
    let fx = -e[8], fy = -e[9], fz = -e[10];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let ux = e[4], uy = e[5], uz = e[6];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    if (![L.x, L.y, L.z, fx, fy, fz, ux, uy, uz].every(Number.isFinite)) return;
    L.fx = fx; L.fy = fy; L.fz = fz;
    L.ux = ux; L.uy = uy; L.uz = uz;
    L.valid = true;
    const l = ctx.listener;
    try {
      if (l.positionX) {
        l.positionX.value = L.x;
        l.positionY.value = L.y;
        l.positionZ.value = L.z;
        l.forwardX.value = fx;
        l.forwardY.value = fy;
        l.forwardZ.value = fz;
        l.upX.value = ux;
        l.upY.value = uy;
        l.upZ.value = uz;
      } else {
        l.setPosition(L.x, L.y, L.z);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch {
      /* ignore */
    }
  }

  private computeMood(game: GameContext) {
    const s = game.state;
    this.mood = MOOD_OF(s.time?.minuteOfDay ?? 720);
    let fireSum = 0;
    for (const f of s.hazards?.fires ?? []) fireSum += clamp(f.intensity, 0, 1);
    let t = 0.55 * (1 - Math.exp(-fireSum * 0.7));
    for (const id in s.wells) {
      const st = s.wells[id].status;
      if (st === 'kick') t += 0.45;
      else if (st === 'blowout') t += 0.85;
    }
    this.tension = clamp(t, 0, 1);
    this.music?.setMood(this.mood, this.tension);
  }

  private computeEnv(game: GameContext, dt: number) {
    const L = this.listener;
    const info = this.envInfo;
    const s = game.state;
    info.windSpeed = s.weather?.windSpeed ?? 4;
    info.weather = s.weather?.current ?? 'clear';
    info.precipitation = s.weather?.precipitation ?? 0;
    info.temperature = s.weather?.temperature ?? 18;
    info.minuteOfDay = s.time?.minuteOfDay ?? 720;
    info.daylight = clamp(this.host?.daylight ?? 1, 0, 1);
    info.industrial = this.spatial?.industrialLoudness ?? 0;
    info.aboveSea = L.y - SEA_LEVEL;
    try {
      const w = game.world;
      const ix = Math.floor(L.x), iy = Math.floor(L.y), iz = Math.floor(L.z);
      const cx = clamp(ix, 0, w.sizeX - 1), cz = clamp(iz, 0, w.sizeZ - 1);
      info.altitude = Math.max(0, L.y - w.getSurfaceY(cx, cz));
      info.underwater = w.inBounds(ix, iy, iz) && w.getBlock(ix, iy, iz) === B.WATER;
      info.biome = game.geology.biomeAt(cx, cz);
      this.waterTimer -= dt;
      if (this.waterTimer <= 0) {
        this.waterTimer = 1;
        this.nearWater = this.sampleWater(game, L.x, L.z);
      }
      info.nearWater = this.nearWater;
    } catch {
      info.underwater = false;
    }
  }

  private sampleWater(game: GameContext, x: number, z: number): number {
    const g = game.geology;
    const sx = g.sizeX, sz = g.sizeZ;
    let sum = 0, wsum = 0;
    const probe = (px: number, pz: number, w: number) => {
      const cx = clamp(Math.floor(px), 0, sx - 1), cz = clamp(Math.floor(pz), 0, sz - 1);
      sum += (g.waterDepth(cx, cz) > 0 ? 1 : 0) * w;
      wsum += w;
    };
    probe(x, z, 3);
    for (const [r, w] of [[8, 0.35], [20, 0.25], [36, 0.15]] as const) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        probe(x + Math.cos(a) * r, z + Math.sin(a) * r, w);
      }
    }
    return wsum ? clamp((sum / wsum) * 1.6, 0, 1) : 0;
  }

  // ---- SoundActions --------------------------------------------------------------------------------
  now(): number {
    return performance.now() / 1000;
  }

  play(name: string, o: PlayOptions = {}): boolean {
    try {
      return this.sfx?.play(name, o) ?? false;
    } catch {
      return false;
    }
  }

  playAt(name: string, at: Vec3, o: PlayOptions = {}): boolean {
    return this.play(name, { reverb: 0.15, ...o, at });
  }

  uiSound(name: string, volume = 1) {
    const t = this.now();
    const prev = this.uiLast.get(name);
    if (prev !== undefined && t - prev < 0.045) return;
    this.uiLast.set(name, t);
    this.play(name, { bus: 'ui', volume: volume * (UI_LEVEL[name] ?? 0.8), reverb: 0.12, reverbKind: 'room', maxVoices: name === 'hover' ? 2 : 3, priority: 2 });
  }

  sting(name: string, volume = 0.8, duckDb = -6) {
    const rate = this.music && this.music.currentMode !== 'off' ? transposeRate(this.music.keyRoot) : 1;
    const ok = this.play(name, { volume, rate, reverb: 0.3, reverbKind: 'hall', priority: 3, maxVoices: 2 });
    if (ok) this.duck(duckDb, 1.6);
  }

  duck(db: number, hold: number) {
    this.core.duckMusic(db, hold);
  }

  explosion(at: Vec3, power: number) {
    const p = clamp(Math.log2(1 + Math.max(0, Number(power) || 0)) / 3, 0.25, 1.5);
    const d = this.listener.distanceTo(at);
    const delay = Math.min(3, (d * 3) / 343);
    const near = clamp(1 - d / 140, 0, 1);
    if (near > 0.02) {
      this.play('explosion_near', { at, volume: p * Math.sqrt(near), ref: 14 * Math.sqrt(p), maxDist: 900, delay, reverb: 0.6, priority: 4, pitchVar: 0.6, rate: 1.05 - 0.12 * Math.min(1, p), maxVoices: 3 });
    }
    this.play('explosion_far', { at, volume: 0.9 * p * (0.45 + 0.55 * (1 - near)), ref: 40 * Math.sqrt(p), maxDist: 1500, delay, reverb: 0.7, priority: 4, maxVoices: 3 });
    const ctx = this.core.ctx;
    if (ctx) {
      const db = -10 * Math.min(1, p * (near + 0.3));
      setTimeout(() => this.duck(db, 2.5), delay * 1000);
    }
  }

  thunder(x: number, z: number, loud = 1) {
    const L = this.listener;
    const d = Math.hypot(x - L.x, z - L.z);
    const delay = Math.min(9, (d * 3) / 343);
    const pan = L.panOf({ x, y: L.y, z }) * 0.6;
    if (d < 90) {
      this.play('thunder_near', { delay, volume: 0.9 * loud, pan, reverb: 0.4, reverbKind: 'outdoor', priority: 3, maxVoices: 2 });
    } else {
      const v = clamp(1.4 / (1 + d / 200), 0.22, 0.9) * loud;
      this.play('thunder_far', { delay, volume: v, pan, reverb: 0.5, reverbKind: 'outdoor', lowpass: clamp(9000 * Math.exp(-d / 400), 400, 9000), priority: 3, maxVoices: 3 });
    }
    setTimeout(() => this.duck(-4, 2), delay * 1000);
  }

  extinguisher(_at: Vec3) {
    this.hissLast = this.now();
    if (this.hiss || !this.core.ctx || !this.core.buses || !this.bank) return;
    const bufs = this.bank.get('loop_hiss');
    if (!bufs) return;
    const ctx = this.core.ctx;
    const src = ctx.createBufferSource();
    src.buffer = bufs[0];
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.55, ctx.currentTime, 0.04);
    src.connect(gain).connect(this.core.buses.sfx.dry);
    src.start(ctx.currentTime, Math.random() * bufs[0].duration);
    this.hiss = { src, gain };
    this.play('extinguisher_start', { volume: 0.6, maxVoices: 1 });
  }

  private stopHiss(fade: number) {
    const h = this.hiss;
    const ctx = this.core.ctx;
    if (!h || !ctx) return;
    this.hiss = null;
    h.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    try {
      h.src.stop(ctx.currentTime + fade * 2 + 0.05);
    } catch {
      /* ignore */
    }
    h.src.onended = () => {
      try {
        h.src.disconnect();
        h.gain.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  firePosition(id: string): Vec3 | undefined {
    return this.spatial?.firePositions.get(id);
  }

  /** Generic sound by name (see SOUND_ALIASES & ONE_SHOT_NAMES). */
  playNamed(raw: string, at?: Vec3, volume?: number): boolean {
    const vol = Number.isFinite(volume) ? Math.max(0, volume as number) : 1;
    let name = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
    // "footstep:<blockId>", "break:<blockId>", "place:<blockId>"
    const m = /^(footstep|break|place|hit):(\d+)$/.exec(name);
    if (m) {
      const id = Number(m[2]);
      name = m[1] === 'footstep' ? footstepSound(id) : m[1] === 'break' ? breakSound(id) : placeSound(id);
    }
    name = SOUND_ALIASES[name] ?? name;
    if (name === 'explosion') {
      this.explosion(at ?? { x: this.listener.x, y: this.listener.y, z: this.listener.z }, 5 * vol);
      return true;
    }
    if (name === 'thunder') {
      this.thunder(at?.x ?? this.listener.x, at?.z ?? this.listener.z, vol);
      return true;
    }
    if (!this.bank?.exists(name) || name.startsWith('loop_')) return false;
    if (name.startsWith('sting_')) {
      this.sting(name, 0.8 * vol);
      return true;
    }
    if (!at && UI_SOUND_NAMES.includes(name)) {
      this.uiSound(name, vol);
      return true;
    }
    return at ? this.playAt(name, at, { volume: vol, ref: 6, maxDist: 220 }) : this.play(name, { volume: vol });
  }

  debugInfo() {
    return {
      state: this.core.ctx?.state ?? 'none',
      voices: this.sfx?.activeCount ?? 0,
      loops: this.spatial?.voiceCount ?? 0,
      loopKeys: this.spatial?.activeKeys() ?? [],
      music: this.music?.currentMode ?? 'off',
      key: this.music?.keyRoot ?? 0,
      mood: this.mood,
      pieceMood: this.music?.performer?.currentMood ?? null,
      resting: this.music?.performer?.isResting ?? null,
      tension: this.tension,
      bank: this.bank ? Math.round(this.bank.progress * 100) : 0,
      env: { ...this.envInfo },
    };
  }
}
