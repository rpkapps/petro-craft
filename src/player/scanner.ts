// Geo-scanner readout: summarises the rock column under a surface cell into HUD lines.
// Hydrocarbons are only named for discovered reservoirs; otherwise a noisy "anomaly strength" hint is shown.
import type { GameState, IGeology, RockType } from '../core/types';
import { FEET_PER_METER, METERS_PER_BLOCK } from '../core/constants';

export interface ScanResult {
  lines: string[];
  level: 'info' | 'warning' | 'danger';
  /** Best anomaly 0..1 (for audio pitch / HUD bar). */
  anomaly: number;
}

interface Interval {
  rock: RockType;
  top: number; // y of the top cell
  bottom: number; // y of the bottom cell
  porosity: number;
  n: number;
  reservoirId?: string;
  fluid: 'none' | 'brine' | 'fresh' | 'oil' | 'gas';
  fresh: boolean;
  anomaly: number;
}

const ROCK_NAMES: Record<RockType, string> = {
  soil: 'Soil', sand: 'Sand', clay: 'Clay', sandstone: 'Sandstone', shale: 'Shale', limestone: 'Limestone', dolomite: 'Dolomite',
  salt: 'Salt', granite: 'Granite', basalt: 'Basalt', chalk: 'Chalk', coal: 'Coal', mudstone: 'Mudstone', caprock: 'Anhydrite',
  bedrock: 'Basement', water: 'Water', silt: 'Silt',
};

export function scanColumn(
  state: GameState, geology: IGeology, x: number, z: number, surfaceY: number, units: 'imperial' | 'metric', noise: () => number,
): ScanResult {
  const unit = units === 'imperial' ? 'ft' : 'm';
  const num = (blocks: number) => {
    const m = Math.max(0, blocks) * METERS_PER_BLOCK;
    return Math.round(units === 'imperial' ? m * FEET_PER_METER : m).toLocaleString('en-US');
  };
  const fmtDepth = (blocks: number) => `${num(blocks)} ${unit}`;
  const intervals: Interval[] = [];
  let basement: number | null = null;
  for (let y = surfaceY - 1; y >= 1; y--) {
    const p = geology.properties(x, y, z);
    if (p.rock === 'bedrock') {
      basement = y;
      break;
    }
    const cur = intervals[intervals.length - 1];
    const fresh = !!(p.aquiferId && geology.aquifers.find((a) => a.id === p.aquiferId)?.fresh);
    if (cur && cur.rock === p.rock && cur.reservoirId === p.reservoirId && cur.fresh === fresh) {
      cur.bottom = y;
      cur.porosity += p.porosity;
      cur.n++;
      if (p.fluid === 'oil' || p.fluid === 'gas') cur.fluid = p.fluid;
    } else {
      intervals.push({ rock: p.rock, top: y, bottom: y, porosity: p.porosity, n: 1, reservoirId: p.reservoirId, fluid: p.fluid, fresh, anomaly: 0 });
    }
  }
  for (const iv of intervals) iv.porosity /= iv.n;

  // Merge single-cell slivers into the interval above (keeps the readout legible), except reservoirs/aquifers.
  const merged: Interval[] = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.n < 2 && !iv.reservoirId && !iv.fresh && !prev.reservoirId) {
      prev.bottom = iv.bottom;
      prev.porosity = (prev.porosity * prev.n + iv.porosity * iv.n) / (prev.n + iv.n);
      prev.n += iv.n;
    } else merged.push({ ...iv });
  }

  // Anomaly strength: porosity + hydrocarbon response, noisier with depth (the scanner is a shallow tool).
  let best: Interval | null = null;
  for (const iv of merged) {
    const depthBlocks = surfaceY - iv.top;
    const blur = Math.min(0.45, 0.08 + depthBlocks / 160);
    const hc = iv.fluid === 'oil' || iv.fluid === 'gas' ? 0.5 : 0;
    const base = Math.min(1, iv.porosity / 0.3) * 0.35 + hc;
    iv.anomaly = Math.max(0, Math.min(1, base + (noise() - 0.5) * 2 * blur));
    if (!best || iv.anomaly > best.anomaly) best = iv;
  }

  const lines: string[] = [];
  lines.push(`Geo scan ${x}, ${z}${basement !== null ? ` · basement at ${fmtDepth(surfaceY - basement)}` : ''}`);
  const MAX_INTERVALS = 8;
  const shown = merged.length > MAX_INTERVALS ? pickIntervals(merged, MAX_INTERVALS) : merged;
  let level: ScanResult['level'] = 'info';
  for (const iv of shown) {
    const range = `${num(surfaceY - 1 - iv.top)}–${fmtDepth(surfaceY - iv.bottom)}`;
    let note = '';
    if (iv.reservoirId) {
      const res = geology.getReservoir(iv.reservoirId);
      const discovered = !!state.reservoirs[iv.reservoirId]?.discovered;
      if (discovered && res) note = ` · ${res.fluid.toUpperCase()} — ${res.name}`;
      else if (iv.anomaly > 0.55) note = ` · possible hydrocarbon indicator (${Math.round(iv.anomaly * 100)}%)`;
    } else if (iv.fresh) {
      note = ' · fresh-water aquifer';
    } else if (iv.anomaly > 0.62) {
      note = ` · weak anomaly (${Math.round(iv.anomaly * 100)}%)`;
    }
    lines.push(`${range}  ${ROCK_NAMES[iv.rock] ?? iv.rock}  φ ${Math.round(iv.porosity * 100)}%${note}`);
  }
  if (best && best.anomaly > 0.55) {
    level = 'warning';
    lines.push(`Strongest anomaly at ${fmtDepth(surfaceY - 1 - best.top)} (${Math.round(best.anomaly * 100)}%) — consider a seismic survey`);
  } else {
    lines.push('No significant anomaly in range');
  }
  return { lines, level, anomaly: best?.anomaly ?? 0 };
}

/** Keep the most informative intervals (reservoirs, aquifers, thick units) in depth order. */
function pickIntervals(list: Interval[], n: number): Interval[] {
  const score = (iv: Interval) => (iv.reservoirId ? 1000 : 0) + (iv.fresh ? 500 : 0) + iv.anomaly * 50 + iv.n;
  const keep = new Set([...list].sort((a, b) => score(b) - score(a)).slice(0, n));
  return list.filter((iv) => keep.has(iv));
}
