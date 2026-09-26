// Visual-only terrain beyond the world border. A ring of MARGIN blocks around the map is synthesised
// from the natural (pre-edit) edge terrain of the geology: the edge profile is continued outward,
// progressively smoothed along the border (no extruded streaks) and eased down to an open-sea floor,
// with beaches where it crosses sea level and water up to sea level. The chunk streamer meshes these
// chunks like real ones (same lighting, water and fog), so the map reads as a coastline that continues
// into an endless ocean (see WorldBorder for the far ocean plane). Nothing here is part of the game
// state: it cannot be edited, collided with or picked.
import { B } from '../../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../../core/constants';
import type { IWorld } from '../../core/types';
import { hash3 } from '../util/noise';

const CS = CHUNK_SIZE;
/** Width of the synthesised ring (multiple of the chunk size). */
export const MARGIN_CHUNKS = 2;
export const MARGIN = MARGIN_CHUNKS * CS;
/** Open-sea floor the ring converges to at its outer edge (and the height of the far seabed plane). */
export const OUTER_FLOOR = SEA_LEVEL - 16;

interface EdgeProfile {
  /** Prefix sums of natural surface heights along the edge (length n + 1). */
  prefix: Float64Array;
  top: Uint8Array;
  sub: Uint8Array;
  ocean: Uint8Array;
}

type BlockAtFn = (x: number, y: number, z: number) => number;

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Smooth value noise (period-free) in [0, 1] from the shared hash. */
function vnoise(x: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = smooth01(x - xi);
  const fz = smooth01(z - zi);
  const a = hash3(xi, zi, seed);
  const b = hash3(xi + 1, zi, seed);
  const c = hash3(xi, zi + 1, seed);
  const d = hash3(xi + 1, zi + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export class VirtualTerrain {
  private cache = new Map<number, { cx: number; cz: number; data: Uint8Array }>();
  /** Edge profiles: 0 west (x=0, along z), 1 east (x=max, along z), 2 north (z=0, along x), 3 south (z=max, along x). */
  private edges: EdgeProfile[] = [];
  private readonly sx: number;
  private readonly sz: number;
  private readonly seed: number;

  constructor(private world: IWorld) {
    this.sx = world.sizeX;
    this.sz = world.sizeZ;
    this.seed = (world.seed | 0) ^ 0x5bd1;
    const geo = world.geology;
    const blockAt = (geo as unknown as { blockAt?: BlockAtFn }).blockAt?.bind(geo) ?? null;
    const build = (n: number, at: (i: number) => [number, number]): EdgeProfile => {
      const prefix = new Float64Array(n + 1);
      const top = new Uint8Array(n);
      const sub = new Uint8Array(n);
      const ocean = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const [x, z] = at(i);
        const h = geo.surfaceHeight(x, z);
        prefix[i + 1] = prefix[i] + h;
        const isOcean = h <= SEA_LEVEL;
        ocean[i] = isOcean ? 1 : 0;
        let t = blockAt ? blockAt(x, h - 1, z) : 0;
        let s = blockAt ? blockAt(x, h - 2, z) : 0;
        if (!t || t === B.WATER || t === B.STRUCTURE) t = isOcean ? B.SAND : B.GRASS;
        if (!s || s === B.WATER || s === B.STRUCTURE) s = isOcean ? B.SAND : B.DIRT;
        top[i] = t;
        sub[i] = s;
      }
      return { prefix, top, sub, ocean };
    };
    this.edges = [
      build(this.sz, (i) => [0, i]),
      build(this.sz, (i) => [this.sx - 1, i]),
      build(this.sx, (i) => [i, 0]),
      build(this.sx, (i) => [i, this.sz - 1]),
    ];
  }

  /** Voxel data (CS×CS×height, index x + z*CS + y*CS*CS) of a chunk outside the world; cached. */
  data(cx: number, cz: number): Uint8Array {
    const k = (cx + 4096) * 8192 + (cz + 4096);
    let d = this.cache.get(k);
    if (!d) {
      d = { cx, cz, data: this.synth(cx, cz) };
      this.cache.set(k, d);
    }
    return d.data;
  }

  /** Drop cached chunks outside a square around a chunk (memory bound while travelling). */
  prune(ccx: number, ccz: number, radius: number) {
    for (const [k, v] of this.cache) if (Math.abs(v.cx - ccx) > radius || Math.abs(v.cz - ccz) > radius) this.cache.delete(k);
  }

  /** Mean natural height along an edge over [i - r, i + r]. */
  private edgeMean(e: EdgeProfile, i: number, r: number) {
    const n = e.prefix.length - 1;
    const a = Math.max(0, Math.min(n - 1, i - r));
    const b = Math.max(a + 1, Math.min(n, i + r + 1));
    return (e.prefix[b] - e.prefix[a]) / (b - a);
  }

  /** Surface (first air) height and materials of a column outside the map. */
  private column(wx: number, wz: number): { h: number; top: number; sub: number; ocean: boolean } {
    const ex = Math.min(this.sx - 1, Math.max(0, wx));
    const ez = Math.min(this.sz - 1, Math.max(0, wz));
    const dx = Math.abs(wx - ex);
    const dz = Math.abs(wz - ez);
    const d = Math.hypot(dx, dz);
    // smoothed source height: blend of the edges we are outside of, smoothing radius grows with distance
    const r = Math.floor(d * 0.6);
    let hs = 0;
    let wsum = 0;
    let top: number = B.GRASS;
    let sub: number = B.DIRT;
    let ocean = false;
    const use = (e: EdgeProfile, i: number, w: number) => {
      hs += this.edgeMean(e, i, r) * w;
      wsum += w;
      top = e.top[i];
      sub = e.sub[i];
      ocean = e.ocean[i] === 1;
    };
    if (dx > 0) use(this.edges[wx < 0 ? 0 : 1], ez, dx);
    if (dz > 0) use(this.edges[wz < 0 ? 2 : 3], ex, dz);
    hs /= wsum || 1;
    // ease from the edge profile to the open-sea floor, with a little relief in between
    const t = Math.min(1, d / (MARGIN - 2));
    const f = smooth01(t);
    const relief = (vnoise(wx / 9, wz / 9, this.seed) - 0.5) * 6 * 4 * t * (1 - t);
    const floorN = OUTER_FLOOR + (t >= 1 ? 0 : (vnoise(wx / 5, wz / 5, this.seed + 7) - 0.5) * 2 * (1 - f));
    const h = Math.round(hs + (floorN - hs) * f + relief);
    return { h: Math.max(2, Math.min(this.world.height - 2, h)), top, sub, ocean };
  }

  private synth(cx: number, cz: number): Uint8Array {
    const H = this.world.height;
    const plane = CS * CS;
    const out = new Uint8Array(plane * H);
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const wx = cx * CS + x;
        const wz = cz * CS + z;
        const c = this.column(wx, wz);
        const yTop = c.h - 1; // highest solid block
        let top = c.top;
        let sub = c.sub;
        if (yTop <= SEA_LEVEL + 1 && !c.ocean) {
          // land dipping into the sea: beach, then sandy / silty shelf
          top = yTop < SEA_LEVEL - 5 ? B.SEABED_SILT : B.SAND;
          sub = B.SAND;
        } else if (yTop < SEA_LEVEL - 8 && top !== B.SEABED_SILT && top !== B.GRAVEL && top !== B.CLAY) {
          top = B.SEABED_SILT;
          sub = B.SAND;
        }
        let i = x + z * CS;
        out[i] = B.BEDROCK;
        for (let y = 1; y <= yTop; y++) {
          i += plane;
          const depth = yTop - y;
          out[i] = depth === 0 ? top : depth < 4 ? sub : B.STONE;
        }
        for (let y = yTop + 1; y <= SEA_LEVEL; y++) out[x + z * CS + y * plane] = B.WATER;
      }
    return out;
  }
}
