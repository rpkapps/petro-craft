// Loader/cache for the procedural surface texture arrays (see texgen.ts). Generation runs in a worker;
// if workers are unavailable it is time-sliced on the main thread (a few ms per frame) so it never
// hitches. Results are cached per resolution for the session.
import * as THREE from 'three';
import { SURF_LAYERS, normalsFromHeight, paintRows, type SurfaceTextureData } from './texgen';

export interface SurfaceTextureSet {
  size: number;
  detail: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  /** GPU bytes incl. mip chains. */
  bytes: number;
}

const pending = new Map<number, Promise<SurfaceTextureData>>();

function viaWorker(size: number): Promise<SurfaceTextureData> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./texgen.worker.ts', import.meta.url), { type: 'module', name: 'petrocraft-texgen' });
    } catch (err) {
      reject(err);
      return;
    }
    w.onmessage = (e: MessageEvent<SurfaceTextureData>) => {
      w.terminate();
      resolve(e.data);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(e);
    };
    w.postMessage({ size });
  });
}

/** Main-thread fallback: paint a few rows per animation frame within a small time budget. */
function sliced(size: number, budgetMs = 4): Promise<SurfaceTextureData> {
  return new Promise((resolve) => {
    const detail = new Uint8Array(size * size * 4 * SURF_LAYERS);
    const normal = new Uint8Array(size * size * 2 * SURF_LAYERS);
    const height = new Float32Array(size * size);
    let layer = 0;
    let row = 0;
    const tick = () => {
      const t0 = performance.now();
      while (layer < SURF_LAYERS && performance.now() - t0 < budgetMs) {
        const rows = Math.max(1, Math.floor(8192 / size));
        const y1 = Math.min(size, row + rows);
        paintRows(layer, size, row, y1, height, detail);
        row = y1;
        if (row >= size) {
          normalsFromHeight(layer, size, height, normal);
          layer++;
          row = 0;
        }
      }
      if (layer < SURF_LAYERS) requestAnimationFrame(tick);
      else resolve({ size, layers: SURF_LAYERS, detail, normal });
    };
    requestAnimationFrame(tick);
  });
}

function generate(size: number): Promise<SurfaceTextureData> {
  let p = pending.get(size);
  if (!p) {
    p = typeof Worker !== 'undefined' ? viaWorker(size).catch(() => sliced(size)) : sliced(size);
    pending.set(size, p);
  }
  return p;
}

/** Build GPU texture arrays at `size` px (async; data is cached, textures are new each call). */
export async function loadSurfaceTextures(size: number): Promise<SurfaceTextureSet> {
  const d = await generate(size);
  const mk = (data: Uint8Array, format: THREE.PixelFormat, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, d.size, d.size, d.layers);
    t.format = format;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const px = d.size * d.size * d.layers;
  return {
    size: d.size,
    detail: mk(d.detail, THREE.RGBAFormat, false),
    normal: mk(d.normal, THREE.RGFormat, false),
    bytes: Math.round(px * 6 * 1.334),
  };
}
