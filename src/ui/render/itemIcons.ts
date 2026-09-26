// Item icons: block items are drawn as tiny isometric voxel cubes from the block palette (with a
// deterministic pixel texture); pipes as pipe segments; plants as sprites. Tools/supplies/commodities use
// SVG icons tinted with the item colour. Rendered once per item and cached as data URLs.
import { BLOCK_BY_KEY, type BlockDef } from '../../core/blocks';
import { ITEMS } from '../../content/items';
import { h } from '../dom';
import { icon, itemIcon } from '../icons';
import { titleCase } from '../format';
import { hashFloat } from '../../core/rng';

const urlCache = new Map<string, string>();

function hex(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function rgb([r, g, b]: [number, number, number], f = 1, a = 1) {
  return `rgba(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0},${a})`;
}

/** Paint one isometric face as a skewed 8×8 pixel grid. */
function face(
  ctx: CanvasRenderingContext2D, ox: number, oy: number, ux: [number, number], uy: [number, number], base: [number, number, number],
  alt: [number, number, number], shade: number, seed: number, pattern: (i: number, j: number) => number,
) {
  const N = 8;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const n = hashFloat(seed, i, j);
      const mix = pattern(i, j);
      const c: [number, number, number] = [
        base[0] + (alt[0] - base[0]) * mix,
        base[1] + (alt[1] - base[1]) * mix,
        base[2] + (alt[2] - base[2]) * mix,
      ];
      const f = shade * (0.9 + n * 0.2);
      ctx.fillStyle = rgb(c, f);
      const x = ox + ux[0] * (i / N) + uy[0] * (j / N);
      const y = oy + ux[1] * (i / N) + uy[1] * (j / N);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ux[0] / N, y + ux[1] / N);
      ctx.lineTo(x + ux[0] / N + uy[0] / N, y + ux[1] / N + uy[1] / N);
      ctx.lineTo(x + uy[0] / N, y + uy[1] / N);
      ctx.closePath();
      ctx.fill();
    }
}

function drawCube(ctx: CanvasRenderingContext2D, S: number, def: BlockDef) {
  const pal = def.palette.map(hex);
  const top = pal[0];
  const side = pal[1] ?? pal[0];
  const accent = pal[2] ?? pal[1] ?? pal[0];
  const cx = S / 2;
  const w = S * 0.43;
  const hh = S * 0.25;
  const topY = S * 0.12;
  const seed = def.id * 97;
  const grassSide = def.tex.side !== def.tex.top && def.tex.side.includes('side');
  const striped = def.key === 'hazard_stripe';
  const road = def.key === 'asphalt_road';
  const glow = (def.light ?? 0) > 0;
  const topPattern = (i: number, j: number) => (striped ? ((i + j) % 4 < 2 ? 1 : 0) : road ? (i === 3 || i === 4 ? (j % 3 === 0 ? 1 : 0) : 0) : hashFloat(seed + 1, i, j) > 0.72 ? 0.6 : 0);
  // top face (rhombus): origin at left corner
  face(ctx, cx - w, topY + hh, [w, -hh], [w, hh], top, road ? accent : side, glow ? 1.25 : 1.12, seed, topPattern);
  // left face
  const sideBase = grassSide ? accent : side;
  const sidePat = (i: number, j: number) => (grassSide ? (j < 2 + (hashFloat(seed, i) > 0.5 ? 1 : 0) ? 1 : 0) : striped ? ((i + j) % 4 < 2 ? 1 : 0) : hashFloat(seed + 3, i, j) > 0.75 ? 0.5 : 0);
  const sideAlt = grassSide ? top : striped ? side : accent;
  face(ctx, cx - w, topY + hh, [w, hh], [0, S * 0.5], sideBase, sideAlt, glow ? 0.95 : 0.78, seed + 5, sidePat);
  // right face
  face(ctx, cx, topY + hh * 2, [w, -hh], [0, S * 0.5], sideBase, sideAlt, glow ? 0.85 : 0.6, seed + 9, sidePat);
  // edge highlights
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - w, topY + hh);
  ctx.lineTo(cx, topY);
  ctx.lineTo(cx + w, topY + hh);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, topY + hh * 2);
  ctx.lineTo(cx, topY + hh * 2 + S * 0.5);
  ctx.stroke();
  if (glow) {
    const g = ctx.createRadialGradient(cx, S * 0.5, 2, cx, S * 0.5, S * 0.6);
    g.addColorStop(0, 'rgba(255,220,140,0.35)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
}

function drawPipe(ctx: CanvasRenderingContext2D, S: number, def: BlockDef) {
  const pal = def.palette.map(hex);
  const body = pal[0];
  const band = pal[2] ?? pal[1];
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 5);
  const L = S * 0.42;
  const R = S * 0.17;
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, rgb(body, 1.5));
  g.addColorStop(0.35, rgb(body, 1.15));
  g.addColorStop(1, rgb(body, 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(-L, -R, L * 2, R * 2);
  // flanges
  for (const fx of [-L, L - S * 0.08]) {
    const fg = ctx.createLinearGradient(0, -R * 1.35, 0, R * 1.35);
    fg.addColorStop(0, rgb(pal[1] ?? body, 1.6));
    fg.addColorStop(1, rgb(pal[1] ?? body, 0.6));
    ctx.fillStyle = fg;
    ctx.fillRect(fx, -R * 1.35, S * 0.08, R * 2.7);
  }
  // colour band
  ctx.fillStyle = rgb(band, 1);
  ctx.fillRect(-S * 0.08, -R, S * 0.16, R * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-L, -R * 0.75, L * 2, R * 0.25);
  // open end
  ctx.fillStyle = rgb(body, 0.3);
  ctx.beginPath();
  ctx.ellipse(L, 0, S * 0.03, R * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlant(ctx: CanvasRenderingContext2D, S: number, def: BlockDef) {
  const pal = def.palette.map(hex);
  const stem = pal[1] ?? pal[0];
  const head = pal[0];
  ctx.strokeStyle = rgb(stem, 1);
  ctx.lineWidth = S * 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(S * 0.5, S * 0.92);
  ctx.quadraticCurveTo(S * 0.46, S * 0.6, S * 0.52, S * 0.36);
  ctx.moveTo(S * 0.49, S * 0.7);
  ctx.quadraticCurveTo(S * 0.3, S * 0.62, S * 0.26, S * 0.5);
  ctx.moveTo(S * 0.5, S * 0.78);
  ctx.quadraticCurveTo(S * 0.7, S * 0.66, S * 0.74, S * 0.56);
  ctx.stroke();
  if (def.key.startsWith('flower')) {
    ctx.fillStyle = rgb(head, 1.1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(S * 0.52 + Math.cos(a) * S * 0.08, S * 0.3 + Math.sin(a) * S * 0.08, S * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3a2a10';
    ctx.beginPath();
    ctx.arc(S * 0.52, S * 0.3, S * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Data URL of a block item's icon. */
export function blockIconUrl(key: string, size = 48): string {
  const ck = `${key}@${size}`;
  const hit = urlCache.get(ck);
  if (hit) return hit;
  const def = BLOCK_BY_KEY[key];
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (def) {
    if (def.shape === 'pipe') drawPipe(ctx, size, def);
    else if (def.shape === 'cross') drawPlant(ctx, size, def);
    else drawCube(ctx, size, def);
  }
  const url = c.toDataURL();
  urlCache.set(ck, url);
  return url;
}

export function itemName(id: string): string {
  if (id.startsWith('block:')) return BLOCK_BY_KEY[id.slice(6)]?.name ?? titleCase(id);
  return ITEMS[id]?.name ?? titleCase(id);
}

export function itemColor(id: string): string {
  if (id.startsWith('block:')) {
    const p = BLOCK_BY_KEY[id.slice(6)]?.palette[0] ?? 0x888888;
    return `#${p.toString(16).padStart(6, '0')}`;
  }
  return ITEMS[id]?.color ?? '#9aa1a8';
}

/** Element showing an item's icon (img for blocks, tinted SVG otherwise). */
export function itemIconEl(id: string, cls = 'item-ic'): HTMLElement {
  if (id.startsWith('block:')) {
    return h(`span.${cls}.blk`, h('img', { src: blockIconUrl(id.slice(6)), alt: '', draggable: false }));
  }
  const color = itemColor(id);
  const el = h(`span.${cls}.svg`, { style: { '--ic-c': brighten(color) } }, icon(itemIcon(id)));
  return el;
}

/** Make very dark item colours readable on dark UI. */
export function brighten(color: string): string {
  if (!color.startsWith('#') || color.length !== 7) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 110) return color;
  if (lum < 40) return '#c98b3a';
  const f = 150 / Math.max(1, lum);
  return `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
}
