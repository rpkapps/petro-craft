// Texture-array layer registry. Pure (no DOM / three) so the mesher worker can import it and
// compute exactly the same layer indices as the main-thread atlas painter.
import { BLOCK_DEFS, type BlockDef } from '../../core/blocks';

export const CRACK_STAGES = 10;

export interface LayerEntry {
  key: string;
  /** Block that first references this key — its palette drives the painter. */
  source: BlockDef | null;
}

function buildLayers(): LayerEntry[] {
  const out: LayerEntry[] = [];
  const seen = new Set<string>();
  const add = (key: string, source: BlockDef | null) => {
    if (key === 'none' || seen.has(key)) return;
    seen.add(key);
    out.push({ key, source });
  };
  // Layer 0 is a neutral fallback so a zero layer attribute never samples garbage.
  add('missing', null);
  for (const d of BLOCK_DEFS) {
    add(d.tex.top, d);
    add(d.tex.side, d);
    add(d.tex.bottom, d);
  }
  for (let i = 0; i < CRACK_STAGES; i++) add(`crack_${i}`, null);
  return out;
}

export const LAYERS: LayerEntry[] = buildLayers();
export const LAYER_INDEX: Record<string, number> = Object.fromEntries(LAYERS.map((l, i) => [l.key, i]));
export const layerOf = (key: string): number => LAYER_INDEX[key] ?? 0;
export const crackLayer = (stage: number): number => layerOf(`crack_${Math.max(0, Math.min(CRACK_STAGES - 1, stage | 0))}`);

/** Material classes stored per layer in the layer-properties texture (blue channel). */
export const LAYER_KIND = {
  generic: 0,
  water: 1,
  oil: 2,
  pipe: 3,
  glass: 4,
  fire: 5,
  lamp: 6,
  metal: 7,
  foliage: 8,
} as const;

export interface LayerProps {
  /** Emissive strength 0..1 (scaled in shader). */
  emissive: number;
  /** Specular strength 0..1. */
  specular: number;
  kind: number;
}

export function layerProps(key: string): LayerProps {
  if (key === 'water') return { emissive: 0, specular: 1, kind: LAYER_KIND.water };
  if (key === 'oil_pool') return { emissive: 0, specular: 1, kind: LAYER_KIND.oil };
  if (key.startsWith('pipe_') || key === 'casing') return { emissive: 0, specular: 0.55, kind: LAYER_KIND.pipe };
  if (key === 'glass' || key === 'ice') return { emissive: 0, specular: 0.9, kind: LAYER_KIND.glass };
  if (key === 'fire') return { emissive: 1, specular: 0, kind: LAYER_KIND.fire };
  if (key === 'lamp') return { emissive: 0.85, specular: 0.2, kind: LAYER_KIND.lamp };
  if (key === 'steel_plate' || key === 'steel_grate' || key.startsWith('container_')) return { emissive: 0, specular: 0.45, kind: LAYER_KIND.metal };
  if (key.startsWith('leaves') || key.endsWith('_leaves') || key === 'tall_grass' || key === 'reeds' || key === 'seagrass' || key === 'kelp')
    return { emissive: 0, specular: 0.05, kind: LAYER_KIND.foliage };
  if (key === 'coal_seam' || key === 'mud' || key === 'oil_sandstone' || key === 'tight_oil_shale') return { emissive: 0, specular: 0.3, kind: LAYER_KIND.generic };
  if (key === 'snow' || key === 'salt') return { emissive: 0, specular: 0.15, kind: LAYER_KIND.generic };
  return { emissive: 0, specular: 0, kind: LAYER_KIND.generic };
}
