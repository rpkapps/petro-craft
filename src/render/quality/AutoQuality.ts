// Adaptive quality: watches smoothed frame times and walks a ladder of cheaper render settings when the
// game is too slow, and back up (with hysteresis, cooldowns and an exponential back-off against
// oscillation) when there is headroom. It never touches the user's saved settings — the renderer reads
// the effective values from `effective()`.
import type { Settings } from '../../core/types';

export type QualityStep = 'scale75' | 'scale60' | 'ssao' | 'shadow' | 'bloom' | 'rd1' | 'rd2';

export interface EffectiveQuality {
  renderScale: number;
  ssao: boolean;
  /** Shadow tiers below the user's shadow quality. */
  shadowDegrade: number;
  /** Bloom input resolution fraction (0.5 normal, 0.25 degraded). */
  bloomScale: number;
  renderDistance: number;
}

/** Frame interval above which the game counts as too slow (ms). */
const SLOW_MS = 20;
/** Frame cost below which there is headroom to step back up (ms). */
const FAST_MS = 12;
/** Length of one measurement window (s). */
const WINDOW_S = 1;
/** Consecutive slow windows before stepping down / fast windows before stepping up. */
const SLOW_WINDOWS = 2;
const FAST_WINDOWS = 6;
/** Minimum time between two changes, and after a change before stepping up (s). */
const DOWN_COOLDOWN_S = 2.5;
const UP_COOLDOWN_S = 8;
/** Samples are ignored this long after a (re)configuration or quality change (s). */
const GRACE_S = 1.5;
/** A single frame longer than this is a hitch (loading, GC, tab switch) and is ignored (ms). */
const HITCH_MS = 250;
/** Stepping up and falling back down within this time blocks that step for BLOCK_BASE_S, doubling each time. */
const BOUNCE_S = 20;
const BLOCK_BASE_S = 60;
const BLOCK_MAX_S = 600;

export class AutoQuality {
  /** Index into `ladder` of the next step to apply; 0 = user's settings unchanged. */
  level = 0;
  private ladder: QualityStep[] = [];
  private last = { auto: false, scale: NaN, ssao: false, shadows: false, shadowQuality: '', bloom: false, rd: NaN };
  private enabled = true;
  private time = 0;
  private graceUntil = 0;
  private lastChange = -1e9;
  private lastUp = { at: -1e9, to: -1 };
  private blockUntil: number[] = [];
  private blockLen: number[] = [];
  // current window
  private wT = 0;
  private wN = 0;
  private wInterval = 0;
  private wCost = 0;
  private slowRun = 0;
  private fastRun = 0;
  /** Shortest smoothed frame interval seen (≈ display refresh period). */
  private vsyncMs = 1000 / 60;
  /** Smoothed values (for display). */
  intervalMs = 16.7;
  costMs = 0;

  /** Rebuilds the ladder when relevant user settings change (and restarts from full quality). Returns true on change. */
  configure(s: Settings): boolean {
    const rd = Math.round(s.renderDistance || 8);
    const L = this.last;
    if (L.auto === !!s.autoQuality && L.scale === s.renderScale && L.ssao === !!s.ssao && L.shadows === !!s.shadows && L.shadowQuality === s.shadowQuality && L.bloom === !!s.bloom && L.rd === rd) return false;
    L.auto = !!s.autoQuality;
    L.scale = s.renderScale;
    L.ssao = !!s.ssao;
    L.shadows = !!s.shadows;
    L.shadowQuality = s.shadowQuality;
    L.bloom = !!s.bloom;
    L.rd = rd;
    this.enabled = !!s.autoQuality;
    const l: QualityStep[] = [];
    const scale = clampScale(s.renderScale);
    if (scale > 0.75) l.push('scale75');
    if (scale > 0.6) l.push('scale60');
    if (s.ssao) l.push('ssao');
    if (s.shadows) l.push('shadow');
    if (s.bloom) l.push('bloom');
    if (rd > 3) l.push('rd1');
    if (rd > 4) l.push('rd2');
    this.ladder = l;
    this.level = 0;
    this.blockUntil = l.map(() => 0);
    this.blockLen = l.map(() => 0);
    this.lastUp = { at: -1e9, to: -1 };
    this.resetWindow();
    this.graceUntil = this.time + GRACE_S;
    return true;
  }

  /** Ignore samples for a moment (resize, context restore, big streaming burst…). */
  hold(seconds = GRACE_S) {
    this.graceUntil = Math.max(this.graceUntil, this.time + seconds);
    this.resetWindow();
  }

  /**
   * Feed one frame. `intervalMs` = real time since the previous frame, `costMs` = measured work
   * (max of CPU frame time and GPU time when known), `gpuKnown` whether costMs includes the GPU.
   * Returns true when the effective quality changed.
   */
  sample(intervalMs: number, costMs: number, gpuKnown: boolean, ignore: boolean): boolean {
    const dt = Math.min(intervalMs, HITCH_MS) / 1000;
    this.time += dt;
    if (!this.enabled) {
      if (this.level !== 0) {
        this.level = 0;
        return true;
      }
      return false;
    }
    if (ignore || intervalMs > HITCH_MS || intervalMs <= 0 || this.time < this.graceUntil) return false;
    this.intervalMs += (intervalMs - this.intervalMs) * 0.1;
    this.costMs += (costMs - this.costMs) * 0.1;
    if (this.intervalMs < this.vsyncMs) this.vsyncMs = Math.max(4, this.intervalMs);
    this.wT += dt;
    this.wN++;
    this.wInterval += intervalMs;
    this.wCost += costMs;
    if (this.wT < WINDOW_S) return false;
    const avgInterval = this.wInterval / this.wN;
    const avgCost = this.wCost / this.wN;
    this.resetWindow();

    const slow = avgInterval > SLOW_MS;
    // Frame intervals are pinned to the display refresh when vsynced, so headroom is judged from the
    // measured cost when the GPU time is known, otherwise from "hitting refresh with a light CPU load".
    const fast = gpuKnown ? avgCost < FAST_MS && avgInterval < SLOW_MS * 0.9 : avgInterval < FAST_MS || (avgInterval <= this.vsyncMs * 1.12 && avgCost < FAST_MS * 0.6);
    this.slowRun = slow ? this.slowRun + 1 : 0;
    this.fastRun = fast ? this.fastRun + 1 : 0;

    if (this.slowRun >= SLOW_WINDOWS && this.level < this.ladder.length && this.time - this.lastChange > DOWN_COOLDOWN_S) {
      // falling back right after stepping up → block that step for a while (exponential back-off)
      if (this.lastUp.to === this.level && this.time - this.lastUp.at < BOUNCE_S) {
        const i = this.level;
        this.blockLen[i] = Math.min(BLOCK_MAX_S, this.blockLen[i] ? this.blockLen[i] * 2 : BLOCK_BASE_S);
        this.blockUntil[i] = this.time + this.blockLen[i];
      }
      this.level++;
      this.changed();
      return true;
    }
    if (this.fastRun >= FAST_WINDOWS && this.level > 0 && this.time - this.lastChange > UP_COOLDOWN_S && this.time >= this.blockUntil[this.level - 1]) {
      this.level--;
      this.lastUp = { at: this.time, to: this.level };
      this.changed();
      return true;
    }
    return false;
  }

  /** Effective quality for the user's settings at the current level. */
  effective(s: Settings, out: EffectiveQuality): EffectiveQuality {
    const on = (step: QualityStep) => {
      const i = this.ladder.indexOf(step);
      return i >= 0 && i < this.level;
    };
    let scale = clampScale(s.renderScale);
    if (on('scale75')) scale = Math.min(scale, 0.75);
    if (on('scale60')) scale = Math.min(scale, 0.6);
    const rd = Math.max(2, Math.min(16, Math.round(s.renderDistance || 8)));
    out.renderScale = scale;
    out.ssao = s.ssao && !on('ssao');
    out.shadowDegrade = on('shadow') ? 1 : 0;
    out.bloomScale = on('bloom') ? 0.25 : 0.5;
    out.renderDistance = Math.max(2, rd - (on('rd2') ? 2 : on('rd1') ? 1 : 0));
    return out;
  }

  /** Steps currently applied (for diagnostics). */
  get applied(): readonly QualityStep[] {
    return this.ladder.slice(0, this.level);
  }

  private changed() {
    this.lastChange = this.time;
    this.slowRun = 0;
    this.fastRun = 0;
    this.hold();
  }

  private resetWindow() {
    this.wT = 0;
    this.wN = 0;
    this.wInterval = 0;
    this.wCost = 0;
  }
}

export function clampScale(v: number) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0.5, v)) : 1;
}
