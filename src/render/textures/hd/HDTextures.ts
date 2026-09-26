// Runtime owner of the HD ('high' / 'ultra') block textures: generates the layers in Web Workers
// (never blocking the frame loop), caches the result in IndexedDB keyed by (generator version, quality,
// layer signature) so later sessions load instantly, builds the two RGBA8 array textures (albedo, material)
// with trimmed CPU copies, and hands them to the renderer. Switching back to 'classic' disposes them.
import * as THREE from 'three';
import { LAYERS } from '../layers';
import { hashString } from '../../util/noise';
import type { HDJob, HDReply } from './hd.worker';

export type HDQuality = 'high' | 'ultra';
export type TextureQuality = 'classic' | HDQuality;

/** Bump when painters change so cached textures are regenerated. */
export const HD_GEN_VERSION = 3;
export const HD_SIZE: Record<HDQuality, number> = { high: 64, ultra: 256 };

export interface HDTextureSet {
  quality: HDQuality;
  size: number;
  albedo: THREE.DataArrayTexture;
  material: THREE.DataArrayTexture;
  /** Approximate GPU bytes (both arrays incl. mip chains). */
  gpuBytes: number;
  dispose(): void;
}

const DB_NAME = 'petrocraft-textures';
const STORE = 'layers';

function layerSignature(): string {
  let h = 0;
  for (const l of LAYERS) h = (Math.imul(h, 31) + hashString(`${l.key}:${l.source?.palette.join(',') ?? ''}`)) | 0;
  return `${LAYERS.length}-${(h >>> 0).toString(36)}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface CacheEntry {
  size: number;
  count: number;
  albedo: ArrayBuffer;
  material: ArrayBuffer;
}

async function cacheGet(key: string): Promise<CacheEntry | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        resolve((req.result as CacheEntry | undefined) ?? null);
        db.close();
      };
      req.onerror = () => {
        resolve(null);
        db.close();
      };
    } catch {
      resolve(null);
      db.close();
    }
  });
}

async function cachePut(key: string, entry: CacheEntry, keep: string[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    // drop stale generations / other layer sets so the cache never grows unbounded
    const keysReq = st.getAllKeys();
    keysReq.onsuccess = () => {
      for (const k of keysReq.result) if (!keep.includes(String(k))) st.delete(k);
      st.put(entry, key);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    db.close();
  }
}

const cacheKey = (q: HDQuality) => `${HD_GEN_VERSION}|${q}|${layerSignature()}`;

function buildSet(q: HDQuality, size: number, count: number, albedoBytes: Uint8Array, materialBytes: Uint8Array, maxAniso: number): HDTextureSet {
  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, size, size, count);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.name = `petro.blocks.${q}.${srgb ? 'albedo' : 'material'}`;
    // the pixels live on the GPU after the first upload: release the CPU copy
    t.onUpdate = () => {
      (t.image as { data: Uint8Array | null }).data = null;
    };
    t.needsUpdate = true;
    return t;
  };
  const albedo = make(albedoBytes, true);
  const material = make(materialBytes, false);
  const gpuBytes = Math.round(size * size * 4 * count * 2 * (4 / 3));
  return {
    quality: q,
    size,
    albedo,
    material,
    gpuBytes,
    dispose() {
      albedo.dispose();
      material.dispose();
    },
  };
}

interface Pending {
  quality: HDQuality;
  token: number;
  workers: Worker[];
  started: number;
}

/**
 * Loads (cache) or generates (workers) HD texture sets on request. `request()` can be called every frame;
 * only a change of quality starts work, and a newer request supersedes an unfinished one.
 */
export class HDTextureManager {
  /** Progress 0..1 of the current request (1 when idle). */
  progress = 1;
  /** Milliseconds the last completed set took (generation or cache load). */
  lastMs = 0;
  lastSource: 'cache' | 'generated' | 'none' = 'none';
  private wanted: TextureQuality = 'classic';
  private pending: Pending | null = null;
  private token = 0;
  private disposed = false;

  constructor(private maxAniso: number, private onReady: (set: HDTextureSet | null) => void) {}

  get busy() {
    return this.pending !== null;
  }

  request(q: TextureQuality) {
    if (this.disposed || q === this.wanted) return;
    this.wanted = q;
    this.cancel();
    if (q === 'classic') {
      this.progress = 1;
      this.onReady(null);
      return;
    }
    void this.load(q);
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }

  private cancel() {
    if (!this.pending) return;
    for (const w of this.pending.workers) w.terminate();
    this.pending = null;
  }

  private async load(q: HDQuality) {
    const token = ++this.token;
    const t0 = performance.now();
    this.pending = { quality: q, token, workers: [], started: t0 };
    this.progress = 0;
    const size = HD_SIZE[q];
    const count = LAYERS.length;
    const key = cacheKey(q);
    const cached = await cacheGet(key);
    if (this.disposed || token !== this.token) return;
    if (cached && cached.size === size && cached.count === count && cached.albedo.byteLength === size * size * 4 * count) {
      this.finish(q, token, new Uint8Array(cached.albedo), new Uint8Array(cached.material), 'cache', t0);
      return;
    }
    const layerBytes = size * size * 4;
    const albedo = new Uint8Array(layerBytes * count);
    const material = new Uint8Array(layerBytes * count);
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const nw = Math.max(1, Math.min(4, hc - 1));
    const jobs: HDJob['layers'][] = Array.from({ length: nw }, () => []);
    // expensive layers are spread evenly by interleaving
    LAYERS.forEach((l, index) => jobs[index % nw].push({ index, key: l.key, palette: l.source?.palette ?? [], seed: hashString(l.key) % 100000 }));
    let done = 0;
    let finished = 0;
    const pending = this.pending!;
    for (let w = 0; w < nw; w++) {
      const worker = new Worker(new URL('./hd.worker.ts', import.meta.url), { type: 'module', name: `petrocraft-textures-${w}` });
      pending.workers.push(worker);
      worker.onmessage = (e: MessageEvent<HDReply>) => {
        if (this.disposed || token !== this.token) return;
        const m = e.data;
        if (m.type === 'layer') {
          albedo.set(m.albedo, m.index * layerBytes);
          material.set(m.material, m.index * layerBytes);
          done++;
          this.progress = done / count;
        } else if (m.type === 'done') {
          worker.terminate();
          finished++;
          if (finished === nw) {
            this.finish(q, token, albedo, material, 'generated', t0);
            void cachePut(key, { size, count, albedo: albedo.buffer.slice(0), material: material.buffer.slice(0) }, [cacheKey('high'), cacheKey('ultra')]);
          }
        } else {
          console.error('[render] HD texture generation failed', m.message);
          this.cancel();
          this.progress = 1;
          this.wanted = 'classic';
          this.onReady(null);
        }
      };
      worker.onerror = (e) => console.error('[render] HD texture worker error', e.message);
      worker.postMessage({ type: 'paint', id: token, size, layers: jobs[w] } satisfies HDJob);
    }
  }

  private finish(q: HDQuality, token: number, albedo: Uint8Array, material: Uint8Array, source: 'cache' | 'generated', t0: number) {
    if (this.disposed || token !== this.token) return;
    this.pending = null;
    this.progress = 1;
    this.lastMs = performance.now() - t0;
    this.lastSource = source;
    this.onReady(buildSet(q, HD_SIZE[q], LAYERS.length, albedo, material, this.maxAniso));
  }
}
