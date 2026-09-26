// Procedural voxel-style worker portraits (8×8 "blocky" faces with role-coloured hard hats), cached.
import { hashFloat } from '../../core/rng';
import type { WorkerRole } from '../../content/buildings';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a8704a', '#8a5636', '#6b3f26', '#f5d6bd'];
const HAIR = ['#2a1b12', '#4a2f1d', '#7a4b2a', '#b08040', '#d8c090', '#1a1a1a', '#6e6e6e', '#a33a1a'];
const EYES = ['#2b4a7a', '#3a5a2a', '#4a2f1d', '#1f1f1f', '#4a7a9a'];
export const ROLE_COLOR: Record<WorkerRole, string> = {
  roughneck: '#ff8a1f', driller: '#e84a3a', operator: '#f2d23a', engineer: '#f4f6f8', technician: '#3a8ae8',
  geoscientist: '#3ac48a', firefighter: '#c8261e', trucker: '#8a6a4a',
};

const cache = new Map<string, string>();

export function portraitUrl(seed: number, role: WorkerRole, size = 64): string {
  const key = `${seed}|${role}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const px = size / 10;
  const r = (k: number) => hashFloat(seed, k);
  const pick = <T,>(arr: T[], k: number) => arr[Math.floor(r(k) * arr.length) % arr.length];
  // background
  const g = ctx.createLinearGradient(0, 0, 0, size);
  const hat = ROLE_COLOR[role] ?? '#ff8a1f';
  g.addColorStop(0, shade(hat, 0.35));
  g.addColorStop(1, '#0b0f14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const skin = pick(SKIN, 1);
  const hair = pick(HAIR, 2);
  const eye = pick(EYES, 3);
  const beard = r(4) > 0.6;
  const moustache = !beard && r(5) > 0.7;
  const glasses = r(6) > 0.8;
  const cell = (x: number, y: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round((x + 1) * px), Math.round((y + 1.4) * px), Math.ceil(px), Math.ceil(px));
  };
  // shoulders / coveralls
  for (let x = -1; x < 9; x++) for (let y = 8; y < 10; y++) cell(x, y, y === 8 && (x === 3 || x === 4) ? shade(skin, 0.85) : shade(hat === '#f4f6f8' ? '#4a6a8a' : '#2d4a6a', y === 8 ? 1 : 0.8));
  // hi-vis stripe
  for (let x = -1; x < 9; x++) if (x !== 3 && x !== 4) cell(x, 9, '#d8e84a');
  // head
  for (let y = 1; y < 8; y++) for (let x = 0; x < 8; x++) cell(x, y, shade(skin, 0.94 + hashFloat(seed, x, y) * 0.12));
  // hair sides
  for (let y = 1; y < 3; y++) { cell(0, y, hair); cell(7, y, hair); }
  // eyes
  cell(1, 3, '#ffffff'); cell(2, 3, eye); cell(5, 3, eye); cell(6, 3, '#ffffff');
  if (glasses) for (const x of [1, 2, 5, 6]) cell(x, 3, x === 2 || x === 5 ? '#1a1a1a' : '#9ad0ff');
  // nose & mouth
  cell(3, 4, shade(skin, 0.8)); cell(4, 4, shade(skin, 0.8));
  cell(3, 6, '#7a3a2a'); cell(4, 6, '#7a3a2a');
  if (beard) {
    for (let x = 0; x < 8; x++) cell(x, 7, hair);
    for (const x of [0, 1, 2, 5, 6, 7]) cell(x, 6, hair);
    cell(0, 5, hair); cell(7, 5, hair);
  } else if (moustache) { for (let x = 2; x < 6; x++) cell(x, 5, hair); }
  // hard hat
  for (let x = -1; x < 9; x++) cell(x, 1, shade(hat, 0.82));
  for (let x = 0; x < 8; x++) cell(x, 0, hat);
  for (let x = 1; x < 7; x++) cell(x, -1, shade(hat, 1.12));
  cell(3, -1, shade(hat, 1.3)); cell(4, 0, shade(hat, 1.2));
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

function shade(hex: string, f: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
