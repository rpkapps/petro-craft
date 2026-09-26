// Music director: owns the active performer(s), crossfades between menu and in-game scores, relays mood
// and tension, and runs the look-ahead scheduler on a timer (independent of the render loop, so the
// menu keeps playing while no game is running).
import type { AudioCore } from '../core';
import type { SoundBank } from '../bank';
import { Performer, type Mood } from './composer';

export type MusicMode = 'off' | 'menu' | 'game';

const LOOKAHEAD = 1.4; // seconds scheduled ahead of the audio clock
const TIMER_MS = 120;
const CROSSFADE = 4;
/** Score gain staging: the menu theme sits forward, the in-game score stays behind gameplay. */
export const MENU_LEVEL = 0.6;
export const GAME_LEVEL = 0.5;

export class MusicDirector {
  private mode: MusicMode = 'off';
  private current: Performer | null = null;
  private fading: Performer[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private mood: Mood = 'day';
  private tension = 0;
  private seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

  constructor(
    private readonly core: AudioCore,
    private readonly bank: SoundBank,
  ) {}

  get currentMode(): MusicMode {
    return this.mode;
  }

  /** Pitch class of the current key (for transposing stings). */
  get keyRoot(): number {
    return this.current?.keyRoot ?? 0;
  }

  get performer(): Performer | null {
    return this.current;
  }

  setMode(mode: MusicMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const ctx = this.core.ctx;
    const buses = this.core.buses;
    if (!ctx || !buses) return;
    if (this.current) {
      this.current.stop(CROSSFADE * 0.8);
      this.fading.push(this.current);
      this.current = null;
    }
    if (mode !== 'off') {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      const p = new Performer(
        ctx, mode, { dry: buses.music.dry, wet: buses.music.sends.hall },
        (name) => this.bank.get(name), this.seed, ctx.currentTime + 0.15, mode === 'menu' ? MENU_LEVEL : GAME_LEVEL,
      );
      p.setMood(this.mood, this.tension);
      p.fade(1, mode === 'menu' ? 2.5 : CROSSFADE, ctx.currentTime + 0.1);
      this.current = p;
      // make sure the score's percussion hits are rendered
      for (const n of ['m_pulse', 'm_kick', 'm_shaker', 'm_tick', 'm_taiko', 'm_swell', 'm_anvil', 'm_rim']) void this.bank.load(n);
    }
    this.ensureTimer();
  }

  setMood(mood: Mood, tension: number) {
    this.mood = mood;
    this.tension = tension;
    this.current?.setMood(mood, tension);
  }

  /** Re-apply the mode after the context has been (re)created. */
  resume() {
    const m = this.mode;
    if (m !== 'off' && !this.current) {
      this.mode = 'off';
      this.setMode(m);
    }
    this.ensureTimer();
  }

  private ensureTimer() {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(this.tick, TIMER_MS);
  }

  private tick = () => {
    const ctx = this.core.ctx;
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') return;
      const until = ctx.currentTime + LOOKAHEAD;
      this.current?.schedule(until);
      for (const p of this.fading) p.schedule(until);
      // release performers whose tails have finished
      const now = ctx.currentTime;
      this.fading = this.fading.filter((p) => {
        if (now > p.stopAt + 9) {
          p.disconnect();
          return false;
        }
        return true;
      });
      if (!this.current && !this.fading.length && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    } catch (err) {
      console.warn('[audio] music scheduler error', err);
    }
  };

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current?.stop(0.5);
    this.current = null;
  }
}
