// Sound bank: renders recipes into AudioBuffers with OfflineAudioContext (once per variant), crossfades
// loops seamlessly, normalises levels, and caches results. Rendering is prioritised and throttled so
// startup never stalls the main thread for long.
import { RECIPES, type Recipe } from './recipes';
import { dbToGain, fadeEdges, hashString, makeBuffer, makeSeamless, mulberry32, peakOf, rmsOf } from './dsp';
import { Rend } from './synth';

const LOW_RATE = 24000;
const CONCURRENCY = 3;

export interface RenderStats {
  name: string;
  variant: number;
  ms: number;
  peak: number;
  rms: number;
  seconds: number;
}

export class SoundBank {
  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly pending = new Map<string, Promise<AudioBuffer[] | null>>();
  private readonly queue: string[] = [];
  private active = 0;
  private disposed = false;
  readonly stats: RenderStats[] = [];
  onError: ((name: string, err: unknown) => void) | null = null;

  constructor(
    readonly sampleRate: number,
    readonly recipes: Record<string, Recipe> = RECIPES,
  ) {}

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  exists(name: string): boolean {
    return name in this.recipes;
  }

  /** Rendered variants, or null (and starts rendering with top priority) if not ready yet. */
  get(name: string): AudioBuffer[] | null {
    const b = this.buffers.get(name);
    if (b) return b;
    if (this.exists(name)) void this.load(name);
    return null;
  }

  /** Render (or return the cached) variants for `name`. Resolves null for unknown names or failures. */
  load(name: string): Promise<AudioBuffer[] | null> {
    const cached = this.buffers.get(name);
    if (cached) return Promise.resolve(cached);
    const p = this.pending.get(name);
    if (p) return p;
    const recipe = this.recipes[name];
    if (!recipe) return Promise.resolve(null);
    const job = this.renderAll(name, recipe)
      .then((bufs) => {
        if (!this.disposed) this.buffers.set(name, bufs);
        return bufs;
      })
      .catch((err) => {
        this.onError?.(name, err);
        return null;
      })
      .finally(() => this.pending.delete(name));
    this.pending.set(name, job);
    return job;
  }

  /** Queue every recipe for background rendering in priority order. */
  prerenderAll(filter?: (name: string) => boolean): Promise<void> {
    const names = Object.keys(this.recipes)
      .filter((n) => !filter || filter(n))
      .sort((a, b) => (this.recipes[a].priority ?? 2) - (this.recipes[b].priority ?? 2));
    for (const n of names) if (!this.buffers.has(n) && !this.queue.includes(n)) this.queue.push(n);
    return new Promise((resolve) => {
      const pump = () => {
        if (this.disposed) return resolve();
        while (this.active < CONCURRENCY && this.queue.length) {
          const n = this.queue.shift()!;
          if (this.buffers.has(n)) continue;
          this.active++;
          void this.load(n).finally(() => {
            this.active--;
            // yield to the main thread between renders
            setTimeout(pump, 0);
          });
        }
        if (!this.queue.length && this.active === 0) resolve();
      };
      pump();
    });
  }

  get progress(): number {
    const total = Object.keys(this.recipes).length;
    return total ? this.buffers.size / total : 1;
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    this.buffers.clear();
  }

  private async renderAll(name: string, recipe: Recipe): Promise<AudioBuffer[]> {
    const n = Math.max(1, recipe.variants ?? 1);
    const out: AudioBuffer[] = [];
    for (let v = 0; v < n; v++) out.push(await this.renderOne(name, recipe, v));
    return out;
  }

  private async renderOne(name: string, recipe: Recipe, variant: number): Promise<AudioBuffer> {
    const t0 = performance.now();
    const sr = recipe.lowRate ? Math.min(LOW_RATE, this.sampleRate) : this.sampleRate;
    const channels = recipe.channels ?? 1;
    const length = Math.max(1, Math.ceil(recipe.dur * sr));
    const off = new OfflineAudioContext(channels, length, sr);
    const r = new Rend(off, off.destination, mulberry32(hashString(name) ^ Math.imul(variant + 1, 0x9e3779b1)));
    recipe.build(r, 0, variant);
    const rendered = await off.startRendering();
    let data: Float32Array[] = [];
    for (let c = 0; c < channels; c++) data.push(rendered.getChannelData(c).slice());

    if (recipe.loop) {
      const loopLen = Math.floor(recipe.loop * sr);
      const fade = Math.max(1, length - loopLen);
      data = data.map((d) => makeSeamless(d, loopLen, fade));
      // RMS normalise (then guard the peak)
      const rms = Math.max(...data.map(rmsOf));
      let k = rms > 1e-9 ? dbToGain(recipe.rmsDb ?? -20) / rms : 1;
      const peak = Math.max(...data.map(peakOf)) * k;
      if (peak > 0.97) k *= 0.97 / peak;
      for (const d of data) for (let i = 0; i < d.length; i++) d[i] *= k;
    } else {
      const peak = Math.max(...data.map(peakOf));
      const k = peak > 1e-9 ? dbToGain(recipe.peakDb ?? -12) / peak : 1;
      for (const d of data) {
        for (let i = 0; i < d.length; i++) d[i] *= k;
        fadeEdges(d, 8, Math.min(Math.floor(sr * 0.03), d.length >> 2));
      }
    }
    const buf = makeBuffer(sr, data);
    this.stats.push({
      name, variant, ms: performance.now() - t0,
      peak: Math.max(...data.map(peakOf)), rms: Math.max(...data.map(rmsOf)), seconds: buf.duration,
    });
    return buf;
  }
}
