// Isometric inventory icons drawn from the very same procedural block textures the world uses
// (crisp pixel art, shaded faces). Pure 2D canvas — usable by the UI without a WebGL context.
import { BLOCKS } from '../../core/blocks';
import { paintLayer } from './atlas';
import { TEX } from './Pixmap';

const faceCache = new Map<string, HTMLCanvasElement>();
const iconCache = new Map<string, HTMLCanvasElement>();

function faceCanvas(key: string, palette: number[]): HTMLCanvasElement {
  const k = `${key}|${palette.join(',')}`;
  let c = faceCache.get(k);
  if (c) return c;
  const pix = paintLayer(key, palette);
  const bytes = new Uint8Array(TEX * TEX * 4);
  pix.toBytes(bytes, 0);
  c = document.createElement('canvas');
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TEX, TEX);
  img.data.set(bytes);
  g.putImageData(img, 0, 0);
  faceCache.set(k, c);
  return c;
}

/** Draw `src` into the parallelogram origin + (ux, uy) · [0..1]² with a flat shade overlay. */
function drawFace(g: CanvasRenderingContext2D, src: HTMLCanvasElement, ox: number, oy: number, ux: [number, number], uy: [number, number], shade: number, sy0 = 0, sh = TEX) {
  g.save();
  g.setTransform(ux[0] / TEX, ux[1] / TEX, uy[0] / sh, uy[1] / sh, ox, oy);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, sy0, TEX, sh, 0, 0, TEX, sh);
  if (shade < 1) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(0,0,0,${1 - shade})`;
    g.fillRect(0, 0, TEX, sh);
  }
  g.restore();
}

/**
 * An isometric icon for a block id (cached per id/size). Cubes/slabs/liquids are drawn as shaded
 * isometric blocks, plants & fire as flat sprites, pipes as a horizontal pipe segment.
 */
export function blockIconCanvas(id: number, size = 64): HTMLCanvasElement {
  const key = `${id}|${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const def = BLOCKS[id];
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const top = faceCanvas(def.tex.top, def.palette);
  const side = faceCanvas(def.tex.side, def.palette);
  const S = size;
  if (def.shape === 'cross') {
    g.drawImage(side, S * 0.1, S * 0.1, S * 0.8, S * 0.8);
  } else if (def.shape === 'pipe') {
    const h = S * 0.36;
    drawFace(g, side, S * 0.08, S * 0.5 - h / 2, [S * 0.84, 0], [0, h], 1);
    // flanges
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(S * 0.08, S * 0.5 - h * 0.62, S * 0.06, h * 1.24);
    g.fillRect(S * 0.86, S * 0.5 - h * 0.62, S * 0.06, h * 1.24);
  } else if (def.shape !== 'none') {
    const hgt = def.shape === 'slab' ? 0.5 : def.shape === 'liquid' ? 0.88 : 1;
    const cx = S / 2;
    const w = S * 0.42;
    const q = S * 0.23;
    const topY = S * 0.04 + (1 - hgt) * S * 0.48;
    const hs = S * 0.48 * hgt;
    if (def.shape === 'liquid') g.globalAlpha = 0.85;
    // top rhombus
    drawFace(g, top, cx, topY, [w, q], [-w, q], 1);
    // left & right sides (lower part of the side texture for partial blocks)
    const sy0 = Math.round(TEX * (1 - hgt));
    drawFace(g, side, cx - w, topY + q, [w, q], [0, hs], 0.78, sy0, TEX - sy0);
    drawFace(g, side, cx, topY + 2 * q, [w, -q], [0, hs], 0.6, sy0, TEX - sy0);
    g.globalAlpha = 1;
  }
  iconCache.set(key, c);
  return c;
}

/** Data URL variant for <img> tags. */
export function blockIconDataURL(id: number, size = 64): string {
  return blockIconCanvas(id, size).toDataURL('image/png');
}
