// Dev harness for the world module: top-down map with subsurface overlays, a vertical section of the
// ACTUAL generated voxels along a line, and a synthetic seismic section from geology.properties().
//
// URL params: seed, size (small|medium|large), line=x0,z0,x1,z1 | line=diapir | line=res:<id>,
//             y0, y1 (section depth window), fluids=0 (true block palette instead of fluid colours)
import { EventBus } from '../../src/core/EventBus';
import { B, BLOCKS } from '../../src/core/blocks';
import { SEA_LEVEL, WORLD_HEIGHT, type WorldSizeKey } from '../../src/core/constants';
import type { Reservoir } from '../../src/core/types';
import { createWorld, findSpawn, Geology, mapColor } from '../../src/world';

const qs = new URLSearchParams(location.search);
const seedIn = document.getElementById('seed') as HTMLInputElement;
const sizeIn = document.getElementById('size') as HTMLSelectElement;
seedIn.value = qs.get('seed') ?? '12345';
sizeIn.value = qs.get('size') ?? 'medium';
const fluidColors = qs.get('fluids') !== '0';

const mapCv = document.getElementById('map') as HTMLCanvasElement;
const secCv = document.getElementById('section') as HTMLCanvasElement;
const seisCv = document.getElementById('seis') as HTMLCanvasElement;
const statsEl = document.getElementById('stats')!;
const listEl = document.getElementById('list')!;
const secCap = document.getElementById('secCap')!;
const legendEl = document.getElementById('legend')!;

const MAP_PX = Number(qs.get('map') ?? 380);
const SEC_W = Math.max(400, window.innerWidth - MAP_PX - 40);
(document.querySelector('main') as HTMLElement).style.gridTemplateColumns = `${MAP_PX}px ${SEC_W}px`;
const SEC_H = Number(qs.get('sech') ?? 380);
const SEIS_H = Number(qs.get('seish') ?? 200);

const FLUID_RGB: Record<number, [number, number, number]> = {
  [B.OIL_SANDSTONE]: [40, 150, 60],
  [B.OIL_LIMESTONE]: [90, 190, 80],
  [B.TIGHT_OIL_SHALE]: [30, 110, 50],
  [B.GAS_SANDSTONE]: [230, 60, 50],
  [B.GAS_SHALE]: [180, 50, 70],
  [B.BRINE_SANDSTONE]: [70, 120, 210],
};

function blockRGB(id: number): [number, number, number] {
  if (fluidColors && FLUID_RGB[id]) return FLUID_RGB[id];
  const c = BLOCKS[id].palette[0] ?? 0;
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

let geo: Geology;
let world: ReturnType<typeof createWorld>;
let line = { x0: 0, z0: 0, x1: 0, z1: 0 };
let clickA: { x: number; z: number } | null = null;

function run() {
  const seed = Number(seedIn.value) | 0;
  const size = sizeIn.value as WorldSizeKey;
  const t0 = performance.now();
  geo = new Geology(seed, size);
  const t1 = performance.now();
  world = createWorld(geo, new EventBus());
  const spawn = findSpawn(geo);
  line = chooseLine();
  drawMap(spawn);
  const t2 = performance.now();
  const chunks0 = performance.now();
  drawSection();
  const t3 = performance.now();
  drawSeismic();
  const t4 = performance.now();
  const oil = geo.reservoirs.reduce((s, r) => s + r.oilInPlace, 0) / 1e6;
  const gas = geo.reservoirs.reduce((s, r) => s + r.gasInPlace, 0) / 1e6;
  const stats = {
    geologyMs: Math.round(t1 - t0), timings: geo.timings, reservoirs: geo.reservoirs.length, faults: geo.faults.length, aquifers: geo.aquifers.length,
    sectionMs: Math.round(t3 - chunks0), seismicMs: Math.round(t4 - t3), mapMs: Math.round(t2 - t1), totalOilMMbbl: Math.round(oil), totalGasBcf: Math.round(gas),
  };
  listEl.style.width = `${MAP_PX}px`;
  statsEl.textContent = `geology ${stats.geologyMs} ms · ${stats.reservoirs} reservoirs · ${stats.faults} faults · ${stats.aquifers} aquifers · STOIIP ${stats.totalOilMMbbl} MMbbl · GIIP ${stats.totalGasBcf} Bcf · section ${stats.sectionMs} ms`;
  (window as unknown as Record<string, unknown>).__viewer = { geo, world, stats };
  listEl.innerHTML = geo.reservoirs
    .map((r) => `<div class="${r.fluid}">${r.id} ${pad(r.name, 30)} ${pad(r.trap, 12)} ${pad(r.fluid, 10)} ${r.offshore ? 'OFF' : 'on '} y${r.bottomY}-${r.topY} ${fmtVol(r)}</div>`)
    .join('');
  legendEl.innerHTML = [['oil', '#28963c'], ['gas', '#e63c32'], ['water leg / aquifer', '#4678d2'], ['fault (sealing)', '#ff3b30'], ['fault (open)', '#ffb030'], ['fresh aquifer', '#5ee0ff'], ['section', '#ff8a1f']]
    .map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`)
    .join('');
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + '&nbsp;'.repeat(n - s.length));
const fmtVol = (r: Reservoir) =>
  r.fluid === 'oil' ? `${(r.oilInPlace / 1e6).toFixed(1)} MMbbl · ${(r.gasInPlace / 1e6).toFixed(0)} Bcf` : `${(r.gasInPlace / 1e6).toFixed(0)} Bcf · ${(r.oilInPlace / 1e6).toFixed(1)} MMbbl cond`;

function chooseLine() {
  const s = geo.sizeX;
  const p = qs.get('line');
  if (p && /^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/.test(p)) {
    const [x0, z0, x1, z1] = p.split(',').map(Number);
    return { x0, z0, x1, z1 };
  }
  if (p === 'diapir' && geo.diapirs.length) {
    const d = geo.diapirs[0];
    return { x0: Math.max(0, d.cx - 60), z0: d.cz, x1: Math.min(s - 1, d.cx + 60), z1: d.cz };
  }
  if (p && p.startsWith('res:')) {
    const r = geo.getReservoir(p.slice(4));
    if (r) {
      const L = Math.max(40, r.radiusX * 3);
      return { x0: Math.max(0, r.center.x - L), z0: r.center.z, x1: Math.min(s - 1, r.center.x + L), z1: r.center.z };
    }
  }
  const od = geo.terrain.oceanDir;
  const c = s / 2;
  const L = s * 0.5;
  return { x0: c - od.x * L, z0: c - od.z * L, x1: Math.min(s - 1, c + od.x * L), z1: Math.min(s - 1, c + od.z * L) };
}

// ------------------------------------------------------------------------------------------------ map
function drawMap(spawn: { x: number; z: number }) {
  const s = geo.sizeX;
  const off = document.createElement('canvas');
  off.width = s;
  off.height = s;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(s, s);
  for (let z = 0; z < s; z++) {
    for (let x = 0; x < s; x++) {
      const c = mapColor(geo, x, z);
      const o = (x + z * s) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  // reservoir footprints from the actual classifier
  for (const r of geo.reservoirs) {
    const col = r.fluid === 'oil' ? [40, 150, 60] : r.fluid === 'gas' ? [230, 60, 50] : [200, 200, 60];
    const x0 = Math.max(0, Math.floor(r.center.x - r.radiusX - 2));
    const x1 = Math.min(s - 1, Math.ceil(r.center.x + r.radiusX + 2));
    const z0 = Math.max(0, Math.floor(r.center.z - r.radiusZ - 2));
    const z1 = Math.min(s - 1, Math.ceil(r.center.z + r.radiusZ + 2));
    const step = r.trap === 'shale_play' ? 2 : 1;
    for (let z = z0; z <= z1; z += step) {
      for (let x = x0; x <= x1; x += step) {
        let hit = false;
        for (let y = r.bottomY; y <= r.topY && !hit; y++) if (geo.reservoirAt(x, y, z)?.id === r.id) hit = true;
        if (!hit) continue;
        const a = r.trap === 'shale_play' ? 0.28 : 0.6;
        for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
          const o = (x + dx + (z + dz) * s) * 4;
          img.data[o] = img.data[o] * (1 - a) + col[0] * a;
          img.data[o + 1] = img.data[o + 1] * (1 - a) + col[1] * a;
          img.data[o + 2] = img.data[o + 2] * (1 - a) + col[2] * a;
        }
      }
    }
  }
  octx.putImageData(img, 0, 0);

  mapCv.width = MAP_PX;
  mapCv.height = MAP_PX;
  const ctx = mapCv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, MAP_PX, MAP_PX);
  const k = MAP_PX / s;
  ctx.lineWidth = 1.2;
  for (const a of geo.aquifers) {
    ctx.strokeStyle = a.fresh ? '#5ee0ff' : '#8a6cff';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.ellipse(a.center.x * k, a.center.z * k, a.radiusX * k, a.radiusZ * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const f of geo.faults) {
    ctx.strokeStyle = f.sealing ? '#ff3b30' : '#ffb030';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(f.p0.x * k, f.p0.z * k);
    ctx.lineTo(f.p1.x * k, f.p1.z * k);
    ctx.stroke();
    // hanging-wall ticks
    const dx = f.p1.x - f.p0.x;
    const dz = f.p1.z - f.p0.z;
    const L = Math.hypot(dx, dz);
    const nx = (-dz / L) * f.dipSign;
    const nz = (dx / L) * f.dipSign;
    for (let t = 0.1; t < 1; t += 0.1) {
      const px = (f.p0.x + dx * t) * k;
      const pz = (f.p0.z + dz * t) * k;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(px + nx * 5, pz + nz * 5);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#ffffff';
  for (const d of geo.diapirs) {
    ctx.beginPath();
    ctx.arc(d.cx * k, d.cz * k, Math.max(2, d.rTop * k), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px ui-monospace, monospace';
  for (const r of geo.reservoirs) ctx.fillText(r.id, r.center.x * k + 3, r.center.z * k - 3);
  ctx.strokeStyle = '#ff8a1f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(line.x0 * k, line.z0 * k);
  ctx.lineTo(line.x1 * k, line.z1 * k);
  ctx.stroke();
  ctx.fillStyle = '#ff8a1f';
  ctx.beginPath();
  ctx.arc(spawn.x * k, spawn.z * k, 4, 0, Math.PI * 2);
  ctx.fill();
}

mapCv.addEventListener('click', (e) => {
  const k = geo.sizeX / MAP_PX;
  const x = e.offsetX * k;
  const z = e.offsetY * k;
  if (!clickA) {
    clickA = { x, z };
    return;
  }
  line = { x0: clickA.x, z0: clickA.z, x1: x, z1: z };
  clickA = null;
  drawMap(findSpawn(geo));
  drawSection();
  drawSeismic();
});

// ------------------------------------------------------------------------------------------------ section
function sectionWindow() {
  const y0 = Number(qs.get('y0') ?? 0);
  const y1 = Number(qs.get('y1') ?? 130);
  return { y0, y1 };
}

function drawSection() {
  const { y0, y1 } = sectionWindow();
  const len = Math.hypot(line.x1 - line.x0, line.z1 - line.z0);
  secCv.width = SEC_W;
  secCv.height = SEC_H;
  const ctx = secCv.getContext('2d')!;
  const img = ctx.createImageData(SEC_W, SEC_H);
  const rows = y1 - y0;
  for (let px = 0; px < SEC_W; px++) {
    const t = px / (SEC_W - 1);
    const x = Math.floor(line.x0 + (line.x1 - line.x0) * t);
    const z = Math.floor(line.z0 + (line.z1 - line.z0) * t);
    for (let py = 0; py < SEC_H; py++) {
      const y = Math.floor(y1 - (py / SEC_H) * rows);
      const id = world.getBlock(x, y, z);
      let c: [number, number, number];
      if (id === B.AIR) c = y > SEA_LEVEL ? [150 + (y - 60) * 0.6, 185 + (y - 60) * 0.3, 225] : [30, 30, 36];
      else c = blockRGB(id);
      const o = (px + py * SEC_W) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // depth ticks
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = '10px ui-monospace, monospace';
  for (let y = Math.ceil(y0 / 20) * 20; y <= y1; y += 20) {
    const py = ((y1 - y) / rows) * SEC_H;
    ctx.fillRect(0, py, 6, 1);
    ctx.fillText(`y${y}`, 8, py + 3);
  }
  secCap.textContent = `Section (${line.x0.toFixed(0)},${line.z0.toFixed(0)}) → (${line.x1.toFixed(0)},${line.z1.toFixed(0)}), ${len.toFixed(0)} blocks, y ${y0}–${y1} · vertical exaggeration ×${((SEC_H / rows) / (SEC_W / len)).toFixed(1)} · ${fluidColors ? 'fluid colours' : 'block palette'}`;
}

function drawSeismic() {
  const { y0, y1 } = sectionWindow();
  const W = Math.floor(SEC_W / 2);
  const rows = y1 - y0;
  const n = rows * 2;
  const imp = new Float32Array(n);
  const refl = new Float32Array(n);
  const out = new Float32Array(W * n);
  const wav: number[] = [];
  const f = 0.16;
  for (let i = -8; i <= 8; i++) {
    const a = (Math.PI * f * i) ** 2;
    wav.push((1 - 2 * a) * Math.exp(-a));
  }
  let maxA = 1e-6;
  for (let c = 0; c < W; c++) {
    const t = c / (W - 1);
    const x = line.x0 + (line.x1 - line.x0) * t;
    const z = line.z0 + (line.z1 - line.z0) * t;
    for (let k = 0; k < n; k++) {
      const y = y1 - k / 2;
      imp[k] = y >= WORLD_HEIGHT ? 0.4 : geo.properties(x, y, z).impedance;
    }
    for (let k = 0; k < n - 1; k++) refl[k] = (imp[k + 1] - imp[k]) / (imp[k + 1] + imp[k] + 1e-6);
    refl[n - 1] = 0;
    // suppress the air/ground contact
    for (let k = 0; k < n - 1; k++) if (imp[k] < 1) refl[k] = 0;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let j = 0; j < wav.length; j++) {
        const kk = k + j - 8;
        if (kk >= 0 && kk < n) s += refl[kk] * wav[j];
      }
      out[c + k * W] = s;
      if (Math.abs(s) > maxA) maxA = Math.abs(s);
    }
  }
  seisCv.width = W;
  seisCv.height = n;
  seisCv.style.width = `${SEC_W}px`;
  seisCv.style.height = `${SEIS_H}px`;
  const ctx = seisCv.getContext('2d')!;
  const img = ctx.createImageData(W, n);
  const gain = 2.2 / maxA;
  for (let i = 0; i < W * n; i++) {
    const v = Math.max(-1, Math.min(1, out[i] * gain));
    const o = i * 4;
    if (v >= 0) {
      img.data[o] = 255 - v * 235;
      img.data[o + 1] = 255 - v * 200;
      img.data[o + 2] = 255 - v * 60;
    } else {
      img.data[o] = 255 + v * 40;
      img.data[o + 1] = 255 + v * 215;
      img.data[o + 2] = 255 + v * 225;
    }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

document.getElementById('go')!.addEventListener('click', run);
run();
