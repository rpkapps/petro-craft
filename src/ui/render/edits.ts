// Top-down raster of player/system world edits for the minimap and the field map (1 px per block).
// Two layers on top of the natural-terrain image:
//   * ground — what the edit left on the surface: concrete/gravel pads, oil spills (OIL_POOL), scorched earth, ash,
//              and any block a player placed on top of a column (BLOCKS palette colours);
//   * lines  — pipelines (by network category) and asphalt roads, also when buried.
// Built once from `world.forEachEdit`, then kept current incrementally from 'world:blockChanged'. Changed columns are
// queued, re-evaluated in small time slices and flushed to the canvases as dirty rectangles (throttled).
import { B, BLOCKS, isPipeBlock } from '../../core/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../../core/constants';
import type { GameContext, IWorld } from '../../core/types';

const LINE_RGB: Record<string, [number, number, number]> = {
  oil: [242, 163, 30], gas: [232, 210, 58], water: [47, 121, 201], product: [62, 158, 90], road: [66, 68, 72],
};

/** Blocks that are always man-made / hazard residue when seen on the surface. */
const MANMADE = new Uint8Array(256);
for (let id = B.CONCRETE; id <= B.CONTAINER_BLUE; id++) MANMADE[id] = 1;
MANMADE[B.ASPHALT_ROAD] = 0; // drawn on the lines layer
MANMADE[B.OIL_POOL] = 1;
MANMADE[B.SCORCHED_EARTH] = 1;
MANMADE[B.ASH] = 1;

/** Blocks a top-down view looks through (air, invisible structure, plants, fire, casing). */
const SEE_THROUGH = new Uint8Array(256);
for (const d of BLOCKS) if (d.shape === 'none' || d.shape === 'cross' || d.pipe === 'casing') SEE_THROUGH[d.id] = 1;
SEE_THROUGH[B.FIRE] = 1;

/** Map colour per block id (rgb triplets). */
const GROUND_RGB = new Uint8Array(256 * 3);
for (const d of BLOCKS) {
  const c = d.palette?.[0] ?? 0x808080;
  GROUND_RGB[d.id * 3] = (c >> 16) & 255;
  GROUND_RGB[d.id * 3 + 1] = (c >> 8) & 255;
  GROUND_RGB[d.id * 3 + 2] = c & 255;
}
const setRgb = (id: number, r: number, g: number, b: number) => GROUND_RGB.set([r, g, b], id * 3);
setRgb(B.OIL_POOL, 18, 14, 10);
setRgb(B.SCORCHED_EARTH, 46, 38, 32);
setRgb(B.CONCRETE_PAD, 168, 168, 162);
setRgb(B.GRAVEL_PAD, 150, 141, 126);

const LINE_OF = new Uint8Array(256); // 0 none, 1 road, 2 pipe
for (const d of BLOCKS) if (isPipeBlock(d.id) && d.pipe !== 'casing') LINE_OF[d.id] = 2;
LINE_OF[B.ASPHALT_ROAD] = 1;
const LINE_COLOR = new Uint8Array(256 * 3);
for (const d of BLOCKS) {
  const rgb = LINE_OF[d.id] === 2 ? LINE_RGB[d.pipe!] : LINE_OF[d.id] === 1 ? LINE_RGB.road : undefined;
  if (rgb) LINE_COLOR.set(rgb, d.id * 3);
}

/** A column counts toward the "top edit" when an edit left a visible, non-line block there. */
const groundable = (id: number) => id !== B.AIR && !SEE_THROUGH[id] && LINE_OF[id] === 0;

export class EditRaster {
  readonly ground: HTMLCanvasElement;
  readonly lines: HTMLCanvasElement;
  /** Increments whenever pixels changed (consumers redraw when it changes). */
  version = 0;
  private readonly W: number;
  private readonly H: number;
  private gctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private gImg: ImageData;
  private lImg: ImageData;
  private edited: Uint8Array;
  private topY: Int16Array;
  private topId: Uint8Array;
  private lineId: Uint8Array;
  private lineScan: Uint8Array;
  private queued: Uint8Array;
  private queue: number[] = [];
  private qHead = 0;
  private bulk = false;
  private acc = 0;
  private sinceFlush = 0;
  private dx0 = Infinity;
  private dz0 = Infinity;
  private dx1 = -1;
  private dz1 = -1;
  private offs: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {
    const w = ctx.world;
    this.W = w.sizeX;
    this.H = w.sizeZ;
    const n = this.W * this.H;
    this.ground = document.createElement('canvas');
    this.lines = document.createElement('canvas');
    for (const c of [this.ground, this.lines]) {
      c.width = this.W;
      c.height = this.H;
    }
    this.gctx = this.ground.getContext('2d')!;
    this.lctx = this.lines.getContext('2d')!;
    this.gImg = this.gctx.createImageData(this.W, this.H);
    this.lImg = this.lctx.createImageData(this.W, this.H);
    this.edited = new Uint8Array(n);
    this.topY = new Int16Array(n);
    this.topId = new Uint8Array(n);
    this.lineId = new Uint8Array(n);
    this.lineScan = new Uint8Array(n);
    this.queued = new Uint8Array(n);
    this.offs.push(
      ctx.bus.on('world:blockChanged', (e) => this.onBlock(e.x, e.y, e.z, e.prev, e.id)),
      ctx.bus.on('world:chunkGenerated', (e) => this.onChunk(e.cx, e.cz)),
      ctx.bus.on('game:loaded', () => this.rebuild()),
    );
    this.rebuild();
  }

  get pending(): boolean {
    return this.qHead < this.queue.length;
  }

  /** Full rebuild from the world's edit journal (initial build / after a load). */
  rebuild() {
    this.edited.fill(0);
    this.topY.fill(-1);
    this.topId.fill(0);
    this.lineId.fill(0);
    this.lineScan.fill(0);
    this.queued.fill(0);
    this.queue = [];
    this.qHead = 0;
    this.gImg.data.fill(0);
    this.lImg.data.fill(0);
    this.gctx.clearRect(0, 0, this.W, this.H);
    this.lctx.clearRect(0, 0, this.W, this.H);
    const W = this.W;
    const H = this.H;
    this.ctx.world.forEachEdit((x, y, z, id) => {
      if (x < 0 || z < 0 || x >= W || z >= H) return;
      const c = z * W + x;
      this.edited[c] = 1;
      if (groundable(id) && y > this.topY[c]) {
        this.topY[c] = y;
        this.topId[c] = id;
      }
      const lt = LINE_OF[id];
      if (lt && lt >= LINE_OF[this.lineId[c]]) this.lineId[c] = id;
    });
    for (let c = 0; c < this.edited.length; c++) if (this.edited[c]) this.enqueue(c);
    this.bulk = true;
    this.version++;
  }

  /** Process queued columns for up to `budgetMs`. Incremental changes are batched ~150 ms; bulk builds run every frame. */
  pump(dt: number, budgetMs: number) {
    this.acc += dt;
    if (!this.pending) return;
    if (!this.bulk && this.acc < 0.15) return;
    this.acc = 0;
    const t0 = performance.now();
    let n = 0;
    while (this.qHead < this.queue.length) {
      const c = this.queue[this.qHead++];
      this.queued[c] = 0;
      this.evaluate(c);
      if ((++n & 63) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.sinceFlush += dt;
    if (this.qHead >= this.queue.length) {
      this.queue = [];
      this.qHead = 0;
      this.bulk = false;
    }
    // While bulk-building, upload at most ~4×/s (the dirty rect can span the whole map).
    if (!this.bulk || this.sinceFlush >= 0.25) this.flush();
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  // ---- internals ------------------------------------------------------------------------------
  private enqueue(c: number) {
    if (this.queued[c]) return;
    this.queued[c] = 1;
    this.queue.push(c);
  }

  private onBlock(x: number, y: number, z: number, prev: number, id: number) {
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) return;
    const c = z * this.W + x;
    this.edited[c] = 1;
    if (groundable(id)) {
      if (y >= this.topY[c]) {
        this.topY[c] = y;
        this.topId[c] = id;
      }
    } else if (y === this.topY[c]) {
      // The top edit was removed; the column scan still finds man-made blocks below it.
      this.topY[c] = -1;
      this.topId[c] = 0;
    }
    const lt = LINE_OF[id];
    if (lt) {
      if (lt >= LINE_OF[this.lineId[c]]) this.lineId[c] = id;
    } else if (LINE_OF[prev]) {
      this.lineScan[c] = 1;
    }
    this.enqueue(c);
  }

  private onChunk(cx: number, cz: number) {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (let dz = 0; dz < CHUNK_SIZE; dz++) {
      const z = z0 + dz;
      if (z >= this.H) break;
      for (let dx = 0; dx < CHUNK_SIZE; dx++) {
        const x = x0 + dx;
        if (x >= this.W) break;
        const c = z * this.W + x;
        if (this.edited[c]) this.enqueue(c);
      }
    }
  }

  /** Recompute the ground and line pixels of one column. */
  private evaluate(c: number) {
    const W = this.W;
    const x = c % W;
    const z = (c - x) / W;
    const world: IWorld = this.ctx.world;
    const data = world.getChunkData(x >> 4, z >> 4);
    let gid = 0;
    let line = this.lineId[c];
    if (data) {
      const li = (x & 15) + ((z & 15) << 4);
      const layer = CHUNK_SIZE * CHUNK_SIZE;
      const rescan = this.lineScan[c] === 1;
      if (rescan) line = 0;
      let top = -1;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const id = data[li + y * layer];
        if (id === B.AIR) continue;
        const lt = LINE_OF[id];
        if (lt === 2) {
          if (rescan && LINE_OF[line] < 2) line = id;
          continue;
        }
        if (SEE_THROUGH[id]) continue;
        if (top < 0) {
          top = id;
          if (lt === 1) {
            if (!line) line = id;
          } else if (MANMADE[id] || (y === this.topY[c] && id === this.topId[c])) gid = id;
          if (!rescan) break;
        } else if (rescan && lt === 1 && !line) line = id;
      }
      if (rescan) {
        this.lineScan[c] = 0;
        this.lineId[c] = line;
      }
    } else if (this.topY[c] >= 0) {
      // Chunk not generated yet (edits restored from a save): trust the journal, ignoring deep underground edits.
      let surface = this.topY[c];
      try {
        surface = world.geology.surfaceHeight(x, z);
      } catch {
        /* geology unavailable */
      }
      if (this.topY[c] >= surface - 12) gid = this.topId[c];
    }
    const i = c * 4;
    const gd = this.gImg.data;
    if (gid) {
      gd[i] = GROUND_RGB[gid * 3];
      gd[i + 1] = GROUND_RGB[gid * 3 + 1];
      gd[i + 2] = GROUND_RGB[gid * 3 + 2];
      gd[i + 3] = 235;
    } else gd[i + 3] = 0;
    const ld = this.lImg.data;
    if (line && LINE_OF[line]) {
      ld[i] = LINE_COLOR[line * 3];
      ld[i + 1] = LINE_COLOR[line * 3 + 1];
      ld[i + 2] = LINE_COLOR[line * 3 + 2];
      ld[i + 3] = 255;
    } else ld[i + 3] = 0;
    if (x < this.dx0) this.dx0 = x;
    if (x > this.dx1) this.dx1 = x;
    if (z < this.dz0) this.dz0 = z;
    if (z > this.dz1) this.dz1 = z;
  }

  private flush() {
    this.sinceFlush = 0;
    if (this.dx1 < 0) return;
    const x = this.dx0;
    const z = this.dz0;
    const w = this.dx1 - x + 1;
    const hh = this.dz1 - z + 1;
    this.gctx.putImageData(this.gImg, 0, 0, x, z, w, hh);
    this.lctx.putImageData(this.lImg, 0, 0, x, z, w, hh);
    this.dx0 = this.dz0 = Infinity;
    this.dx1 = this.dz1 = -1;
    this.version++;
  }
}

const cache = new WeakMap<IWorld, EditRaster>();
const active = new Set<EditRaster>();

/** Shared edit raster for a game's world (created on first use, disposed with the game). */
export function editsFor(ctx: GameContext): EditRaster {
  let r = cache.get(ctx.world);
  if (!r) {
    const raster = new EditRaster(ctx);
    r = raster;
    cache.set(ctx.world, raster);
    active.add(raster);
    const off = ctx.bus.on('game:disposed', () => {
      off();
      raster.dispose();
      active.delete(raster);
    });
  }
  return r;
}

/** Advance queued edit-raster work (called once per frame by the UI). */
export function pumpEdits(dt: number, budgetMs = 2) {
  for (const r of active) r.pump(dt, budgetMs);
}

/**
 * Draw a world-aligned layer image (`blocksPerPx` blocks per source pixel) at screen offset (ox, oz) with `s` screen px
 * per block, copying only the part visible in a w×h viewport.
 */
export function drawWorldLayer(g: CanvasRenderingContext2D, img: CanvasImageSource, imgW: number, imgH: number, blocksPerPx: number, ox: number, oz: number, s: number, w: number, hh: number) {
  const k = blocksPerPx * s; // screen px per source px
  const sx0 = Math.max(0, Math.floor(-ox / k));
  const sz0 = Math.max(0, Math.floor(-oz / k));
  const sx1 = Math.min(imgW, Math.ceil((w - ox) / k));
  const sz1 = Math.min(imgH, Math.ceil((hh - oz) / k));
  if (sx1 <= sx0 || sz1 <= sz0) return;
  g.drawImage(img, sx0, sz0, sx1 - sx0, sz1 - sz0, ox + sx0 * k, oz + sz0 * k, (sx1 - sx0) * k, (sz1 - sz0) * k);
}
