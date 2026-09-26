// Canvas renderers for wells: side-view schematic (strata, casing & shoes, perforations, bit), wireline log
// tracks (GR, resistivity, porosity/density, lithology) and the pore/fracture mud-weight window.
import type { CasingString, IGeology, RockType, Vec3, WellState } from '../../core/types';
import { fitCanvas } from '../dom';
import { lengthValue, lengthUnit, int, type Units } from '../format';
import { niceTicks } from '../charts/LineChart';

export const ROCK_COLOR: Record<RockType, string> = {
  soil: '#6b4a2f', sand: '#d2bf7f', clay: '#8f95a1', sandstone: '#c9a86a', shale: '#4b4f55', limestone: '#b8b29c', dolomite: '#a8988a',
  salt: '#e8e2e6', granite: '#9c6f63', basalt: '#3a3a40', chalk: '#e6e1d4', coal: '#222', mudstone: '#6d5d4f', caprock: '#d6d0c8',
  bedrock: '#2b2b2e', water: '#2a6fb8', silt: '#8a8470',
};
const FLUID_FILL: Record<string, string> = { oil: 'rgba(61,220,132,0.55)', gas: 'rgba(255,90,90,0.55)', fresh: 'rgba(90,184,230,0.45)', brine: 'rgba(60,110,200,0.25)' };
const CASING_W: Record<CasingString['name'], number> = { conductor: 9, surface: 7.5, intermediate: 6, production: 4.5, liner: 3.5 };

/** Horizontal displacement of trajectory points along their dominant direction. */
function projectTrajectory(traj: Vec3[], x0: number, z0: number): { d: number; y: number }[] {
  const last = traj[traj.length - 1];
  let ax = last ? last.x - x0 : 1;
  let az = last ? last.z - z0 : 0;
  const L = Math.hypot(ax, az);
  if (L < 1e-3) { ax = 1; az = 0; } else { ax /= L; az /= L; }
  return traj.map((p) => ({ d: (p.x - x0) * ax + (p.z - z0) * az, y: p.y }));
}

export interface SchematicOpts { units: Units; planned?: Vec3[]; showStrata?: boolean; t?: number }

export function drawWellSchematic(canvas: HTMLCanvasElement, geo: IGeology, w: WellState, o: SchematicOpts) {
  const { w: W, h: H, ctx: g } = fitCanvas(canvas);
  g.clearRect(0, 0, W, H);
  const traj = w.trajectory.length ? w.trajectory : [{ x: w.x, y: w.surfaceY, z: w.z }];
  const plan = o.planned ?? [];
  const pts = projectTrajectory(traj, w.x, w.z);
  const ppts = plan.length ? projectTrajectory(plan, w.x, w.z) : [];
  const all = [...pts, ...ppts];
  const minY = Math.min(w.plan.targetY - 3, ...all.map((p) => p.y)) - 1;
  const top = w.surfaceY + 2;
  const minD = Math.min(0, ...all.map((p) => p.d));
  const maxD = Math.max(0, ...all.map((p) => p.d));
  const spanD = Math.max(10, maxD - minD);
  const padL = 44;
  const padR = 12;
  const padT = 10;
  const padB = 10;
  const gw = W - padL - padR;
  const gh = H - padT - padB;
  const sy = gh / (top - minY);
  const sx = Math.min(gw / (spanD * 1.25), sy * 3);
  const cxPix = padL + gw / 2 - ((minD + maxD) / 2) * sx;
  const X = (d: number) => cxPix + d * sx;
  const Y = (y: number) => padT + (top - y) * sy;
  // sky & strata
  g.fillStyle = '#0c131b';
  g.fillRect(padL, padT, gw, Y(w.surfaceY) - padT);
  if (o.showStrata !== false) {
    for (let y = w.surfaceY; y > minY; y--) {
      let rock: RockType = 'shale';
      let fluid = 'none';
      try {
        const p = geo.properties(Math.floor(w.x), y, Math.floor(w.z));
        rock = p.rock;
        fluid = p.fluid;
      } catch {
        /* geology unavailable */
      }
      g.fillStyle = ROCK_COLOR[rock] ?? '#444';
      g.globalAlpha = 0.55;
      g.fillRect(padL, Y(y), gw, sy + 0.6);
      g.globalAlpha = 1;
      const ff = FLUID_FILL[fluid];
      if (ff && fluid !== 'brine') {
        g.fillStyle = ff;
        g.fillRect(padL, Y(y), gw, sy + 0.6);
      }
    }
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(8,11,15,0.55)');
    grd.addColorStop(0.5, 'rgba(8,11,15,0.1)');
    grd.addColorStop(1, 'rgba(8,11,15,0.55)');
    g.fillStyle = grd;
    g.fillRect(padL, Y(w.surfaceY), gw, H);
  }
  // ground line
  g.strokeStyle = w.offshore ? '#3d85cf' : '#6a9a45';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(padL, Y(w.surfaceY)); g.lineTo(padL + gw, Y(w.surfaceY)); g.stroke();
  // depth axis
  g.font = '500 10px "JetBrains Mono", monospace';
  g.fillStyle = 'rgba(190,200,212,0.75)';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const dmax = lengthValue(w.surfaceY - minY, o.units);
  for (const t of niceTicks(0, dmax, 6)) {
    const y = Y(w.surfaceY) + (t / Math.max(1e-6, dmax)) * (Y(minY) - Y(w.surfaceY));
    g.fillText(int(t), padL - 6, y);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + gw, y); g.stroke();
  }
  g.save();
  g.translate(10, padT + gh / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillText(`TVD (${lengthUnit(o.units)})`, 0, 0);
  g.restore();
  // planned path
  if (ppts.length > 1) {
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([5, 4]);
    g.lineWidth = 1.5;
    g.beginPath(); ppts.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y)))); g.stroke();
    g.setLineDash([]);
  }
  // borehole (open hole)
  if (pts.length > 1) {
    g.strokeStyle = '#0a0a0a';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y)))); g.stroke();
    g.strokeStyle = '#8a6a4a';
    g.lineWidth = 3;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y)))); g.stroke();
  }
  // casing strings (drawn along the trajectory down to their shoe depth)
  const casing = [...w.casing].sort((a, b) => (CASING_W[b.name] ?? 4) - (CASING_W[a.name] ?? 4));
  for (const c of casing) {
    const seg = pts.filter((p) => p.y <= c.topY && p.y >= c.bottomY);
    if (seg.length < 1) continue;
    const half = (CASING_W[c.name] ?? 4) * 0.9;
    g.strokeStyle = c.cemented ? 'rgba(200,200,200,0.35)' : 'rgba(0,0,0,0)';
    g.lineWidth = half * 2 + 3;
    g.lineCap = 'butt';
    g.beginPath(); seg.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y)))); g.stroke();
    for (const side of [-1, 1]) {
      g.strokeStyle = '#c8d0d8';
      g.lineWidth = 1.6;
      g.beginPath();
      seg.forEach((p, i) => {
        const nx = X(p.d) + side * half;
        if (i) g.lineTo(nx, Y(p.y)); else g.moveTo(nx, Y(p.y));
      });
      g.stroke();
    }
    const shoe = seg[seg.length - 1];
    g.fillStyle = '#e8edf2';
    for (const side of [-1, 1]) {
      const sxp = X(shoe.d) + side * half;
      const syp = Y(shoe.y);
      g.beginPath(); g.moveTo(sxp, syp); g.lineTo(sxp + side * 5, syp); g.lineTo(sxp, syp - 6); g.closePath(); g.fill();
    }
  }
  // perforations at completed reservoirs
  for (const rid of w.completedReservoirs) {
    const r = geo.getReservoir(rid);
    if (!r) continue;
    for (const p of pts) {
      if (p.y > r.topY || p.y < r.bottomY) continue;
      g.strokeStyle = '#ff8a1f';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(p.d) - 10, Y(p.y)); g.lineTo(X(p.d) - 4, Y(p.y));
      g.moveTo(X(p.d) + 4, Y(p.y)); g.lineTo(X(p.d) + 10, Y(p.y));
      g.stroke();
    }
  }
  // reservoir tops from logs (first oil/gas sample per interval)
  let prevFluid = '';
  g.font = '600 9.5px Inter, system-ui, sans-serif';
  g.textAlign = 'left';
  for (const s of w.log) {
    const fl = s.fluid === 'oil' || s.fluid === 'gas' ? s.fluid : '';
    if (fl && fl !== prevFluid) {
      const y = Y(s.y);
      g.strokeStyle = fl === 'gas' ? '#ff5a5a' : '#3ddc84';
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + gw, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = g.strokeStyle;
      g.fillText(`${fl.toUpperCase()} TOP`, padL + 4, y - 3);
    }
    prevFluid = fl;
  }
  // wellhead
  g.fillStyle = '#d7dde4';
  g.fillRect(X(0) - 6, Y(w.surfaceY) - 10, 12, 10);
  g.fillStyle = '#ff8a1f';
  g.fillRect(X(0) - 9, Y(w.surfaceY) - 7, 18, 3);
  // bit
  if (['drilling', 'tripping', 'kick', 'casing'].includes(w.status) && pts.length) {
    const b = pts[pts.length - 1];
    const t = o.t ?? 0;
    const r = 5 + Math.sin(t * 6) * 1.2;
    const grd = g.createRadialGradient(X(b.d), Y(b.y), 0, X(b.d), Y(b.y), r * 2.5);
    grd.addColorStop(0, w.status === 'kick' ? 'rgba(255,77,79,1)' : 'rgba(255,200,120,1)');
    grd.addColorStop(1, 'rgba(255,138,31,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(X(b.d), Y(b.y), r * 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(X(b.d), Y(b.y), 2.5, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  g.strokeRect(padL + 0.5, padT + 0.5, gw - 1, gh - 1);
}

/** Wireline log tracks. Returns false when there is nothing to draw. */
export function drawLogTracks(canvas: HTMLCanvasElement, w: WellState, units: Units): boolean {
  const { w: W, h: H, ctx: g } = fitCanvas(canvas);
  g.clearRect(0, 0, W, H);
  const log = w.log.filter((s) => Number.isFinite(s.y));
  if (log.length < 2) return false;
  const padT = 26;
  const padB = 6;
  const depthW = 46;
  const litW = 26;
  const trackW = (W - depthW - litW - 8) / 3;
  const gh = H - padT - padB;
  const mdMin = log[0].md;
  const mdMax = log[log.length - 1].md;
  const Y = (md: number) => padT + ((md - mdMin) / Math.max(1e-6, mdMax - mdMin)) * gh;
  const tracks = [
    { x: depthW + litW + 4, title: 'GR (API)', color: '#3ddc84' },
    { x: depthW + litW + 4 + trackW, title: 'RES (Ω·m, log)', color: '#ff6a6a' },
    { x: depthW + litW + 4 + trackW * 2, title: 'NPHI / RHOB', color: '#4ea8ff' },
  ];
  g.font = '600 9.5px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const t of tracks) {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(t.x, padT, trackW - 3, gh);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(t.x + 0.5, padT + 0.5, trackW - 4, gh - 1);
    for (let k = 1; k < 4; k++) {
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath(); g.moveTo(t.x + (k * (trackW - 3)) / 4, padT); g.lineTo(t.x + (k * (trackW - 3)) / 4, padT + gh); g.stroke();
    }
    g.fillStyle = t.color;
    g.fillText(t.title, t.x + trackW / 2, 10);
  }
  g.fillStyle = 'rgba(190,200,212,0.8)';
  g.fillText('LITH', depthW + litW / 2, 10);
  // depth labels (MD)
  g.font = '500 9.5px "JetBrains Mono", monospace';
  g.textAlign = 'right';
  const dv0 = lengthValue(mdMin, units);
  const dv1 = lengthValue(mdMax, units);
  for (const t of niceTicks(dv0, dv1, 8)) {
    const y = padT + ((t - dv0) / Math.max(1e-6, dv1 - dv0)) * gh;
    if (y < padT || y > padT + gh) continue;
    g.fillStyle = 'rgba(190,200,212,0.75)';
    g.fillText(int(t), depthW - 6, y);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.moveTo(depthW + litW, y); g.lineTo(W - 4, y); g.stroke();
  }
  g.fillText(`MD ${lengthUnit(units)}`, depthW - 6, 10);
  // lithology column
  for (let i = 0; i < log.length; i++) {
    const s = log[i];
    const y0 = Y(s.md);
    const y1 = i + 1 < log.length ? Y(log[i + 1].md) : y0 + 2;
    g.fillStyle = ROCK_COLOR[s.rock] ?? '#555';
    g.fillRect(depthW, y0, litW - 2, Math.max(1, y1 - y0));
    const ff = FLUID_FILL[s.fluid];
    if (ff && s.fluid !== 'brine') {
      g.fillStyle = ff;
      g.fillRect(depthW, y0, litW - 2, Math.max(1, y1 - y0));
    }
  }
  const curve = (tx: number, val: (s: (typeof log)[number]) => number, color: string, fillLeft = false, dash = false) => {
    g.save();
    g.beginPath();
    g.rect(tx, padT, trackW - 3, gh);
    g.clip();
    const pts: [number, number][] = [];
    for (const s of log) {
      const v = val(s);
      if (!Number.isFinite(v)) continue;
      pts.push([tx + Math.max(0, Math.min(1, v)) * (trackW - 3), Y(s.md)]);
    }
    if (pts.length > 1) {
      if (fillLeft) {
        g.fillStyle = 'rgba(61,220,132,0.14)';
        g.beginPath();
        g.moveTo(tx, pts[0][1]);
        for (const [x, y] of pts) g.lineTo(x, y);
        g.lineTo(tx, pts[pts.length - 1][1]);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      if (dash) g.setLineDash([4, 3]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  };
  curve(tracks[0].x, (s) => s.gammaRay / 150, '#3ddc84', true);
  curve(tracks[1].x, (s) => (Number.isFinite(s.resistivity) && s.resistivity > 0 ? (Math.log10(s.resistivity) + 0.7) / 4 : NaN), '#ff6a6a');
  curve(tracks[2].x, (s) => (0.45 - s.porosity) / 0.6, '#4ea8ff');
  curve(tracks[2].x, (s) => (s.density - 1.95) / 1.0, '#ff8a1f', false, true);
  // mud gas shows as ticks on the lithology column
  for (const s of log) {
    if (!(s.gasShow > 20)) continue;
    g.fillStyle = '#ffc233';
    g.fillRect(depthW + litW - 5, Y(s.md) - 1, 4, 2);
  }
  return true;
}

/** Pore/fracture pressure window (ppg) with the current mud weight and bit depth. */
export function drawMudWindow(canvas: HTMLCanvasElement, profile: { y: number; pore: number; frac: number }[], surfaceY: number, mudWeight: number, bitY: number | null, units: Units, casingShoes: number[] = []) {
  const { w: W, h: H, ctx: g } = fitCanvas(canvas);
  g.clearRect(0, 0, W, H);
  if (profile.length < 2) {
    g.fillStyle = 'rgba(160,170,184,0.6)';
    g.font = '500 11px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('No pressure data', W / 2, H / 2);
    return;
  }
  const padL = 40;
  const padB = 20;
  const padT = 8;
  const padR = 8;
  const pmin = Math.max(7, Math.floor(Math.min(...profile.map((p) => p.pore)) - 0.5));
  const pmax = Math.ceil(Math.max(...profile.map((p) => p.frac), mudWeight) + 0.5);
  const ymax = Math.max(...profile.map((p) => p.y));
  const ymin = Math.min(...profile.map((p) => p.y));
  const X = (v: number) => padL + ((v - pmin) / Math.max(1e-6, pmax - pmin)) * (W - padL - padR);
  const Y = (y: number) => padT + ((ymax - y) / Math.max(1e-6, ymax - ymin)) * (H - padT - padB);
  // safe window
  g.fillStyle = 'rgba(61,220,132,0.1)';
  g.beginPath();
  profile.forEach((p, i) => (i ? g.lineTo(X(p.pore), Y(p.y)) : g.moveTo(X(p.pore), Y(p.y))));
  for (let i = profile.length - 1; i >= 0; i--) g.lineTo(X(profile[i].frac), Y(profile[i].y));
  g.closePath();
  g.fill();
  // kick / loss zones for current mud
  g.font = '500 9.5px "JetBrains Mono", monospace';
  g.fillStyle = 'rgba(190,200,212,0.7)';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const t of niceTicks(pmin, pmax, 5)) {
    const x = X(t);
    g.fillText(units === 'metric' ? (t / 8.345).toFixed(2) : String(t), x, H - padB + 5);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke();
  }
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const d0 = lengthValue(surfaceY - ymax, units);
  const d1 = lengthValue(surfaceY - ymin, units);
  for (const t of niceTicks(d0, d1, 5)) {
    const y = padT + ((t - d0) / Math.max(1e-6, d1 - d0)) * (H - padT - padB);
    g.fillText(int(t), padL - 4, y);
  }
  const line = (key: 'pore' | 'frac', color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    profile.forEach((p, i) => (i ? g.lineTo(X(p[key]), Y(p.y)) : g.moveTo(X(p[key]), Y(p.y))));
    g.stroke();
  };
  line('pore', '#4ea8ff');
  line('frac', '#ff4d4f');
  // casing shoes
  for (const shoe of casingShoes) {
    const y = Y(shoe);
    g.fillStyle = '#e8edf2';
    g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + 7, y); g.lineTo(padL, y - 7); g.closePath(); g.fill();
  }
  // mud weight
  const mx = X(mudWeight);
  g.strokeStyle = '#3ddc84';
  g.lineWidth = 2.5;
  g.setLineDash([6, 4]);
  g.beginPath(); g.moveTo(mx, padT); g.lineTo(mx, H - padB); g.stroke();
  g.setLineDash([]);
  if (bitY !== null) {
    const by = Y(bitY);
    g.strokeStyle = '#ffc233';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, by); g.lineTo(W - padR, by); g.stroke();
    // danger highlights at bit
    const p = profile.reduce((a, b) => (Math.abs(b.y - bitY) < Math.abs(a.y - bitY) ? b : a));
    const bad = mudWeight < p.pore ? 'KICK RISK' : mudWeight > p.frac ? 'LOSSES' : '';
    g.fillStyle = '#ffc233';
    g.beginPath(); g.arc(mx, by, 4, 0, Math.PI * 2); g.fill();
    if (bad) {
      g.font = '700 10px Rajdhani, "Liberation Sans", sans-serif';
      g.fillStyle = '#ff4d4f';
      g.textAlign = 'left';
      g.fillText(bad, Math.min(mx + 8, W - 60), by - 8);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.strokeRect(padL + 0.5, padT + 0.5, W - padL - padR - 1, H - padT - padB - 1);
}
