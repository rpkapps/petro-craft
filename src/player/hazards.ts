// Hazard sensing around a point: combustible gas (%LEL), H2S (ppm) and heat from leaks, blowouts, fires and sour wells.
// Used by the gas detector readout and by player damage. Pure: reads GameState + IGeology only.
import type { GameState, IGeology, Vec3 } from '../core/types';
import { BUILDINGS } from '../content/buildings';

export type HazardKind = 'leak' | 'blowout' | 'kick' | 'fire' | 'sour_well';

export interface HazardSource {
  kind: HazardKind;
  label: string;
  at: Vec3;
  dist: number;
  lel: number;
  h2s: number;
  heat: number;
}

export interface HazardReading {
  /** Combustible gas, % of lower explosive limit (0..100). */
  lel: number;
  /** Hydrogen sulphide, ppm. */
  h2s: number;
  /** Radiant heat 0..1 (1 = standing in flames). */
  heat: number;
  /** Overall danger 0..1 for alarms. */
  danger: number;
  nearest: HazardSource | null;
  sources: HazardSource[];
}

const falloff = (d: number, r: number) => (d >= r ? 0 : (1 - d / r) ** 2);

function wellSourness(state: GameState, geology: IGeology, wellId: string): number {
  const w = state.wells[wellId];
  if (!w) return 0;
  let h2s = 0;
  for (const rid of w.penetrated) h2s = Math.max(h2s, geology.getReservoir(rid)?.h2s ?? 0);
  return h2s;
}

export function senseHazards(state: GameState, geology: IGeology, p: Vec3): HazardReading {
  const sources: HazardSource[] = [];
  const add = (kind: HazardKind, label: string, at: Vec3, radius: number, lel: number, h2s: number, heat: number) => {
    const dist = Math.hypot(at.x - p.x, (at.y - p.y) * 0.7, at.z - p.z);
    const f = falloff(dist, radius);
    if (f <= 0) return;
    sources.push({ kind, label, at, dist, lel: lel * f, h2s: h2s * f, heat: heat * f });
  };

  for (const n of Object.values(state.networks)) {
    const l = n.leak;
    if (!l) continue;
    const strength = Math.min(1, 0.35 + Math.log10(1 + Math.max(0, l.rate)) / 6);
    const at = { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 };
    if (n.category === 'gas') add('leak', 'Gas leak', at, 26, 100 * strength, 0, 0);
    else if (n.category === 'oil' || n.category === 'product') add('leak', `${n.category === 'oil' ? 'Crude' : 'Product'} leak`, at, 16, 45 * strength, 0, 0);
  }

  for (const w of Object.values(state.wells)) {
    const at = { x: w.x + 0.5, y: w.surfaceY + 1, z: w.z + 0.5 };
    const sour = wellSourness(state, geology, w.id);
    if (w.status === 'blowout') {
      const onFire = !!w.blowout?.onFire;
      add('blowout', onFire ? 'Burning blowout' : 'Blowout', at, 48, onFire ? 30 : 100, onFire ? sour * 1e6 * 0.002 : Math.min(800, sour * 1e6 * 0.02), onFire ? 0.4 : 0);
    } else if (w.status === 'kick') {
      add('kick', 'Well kick', at, 16, 35, Math.min(200, sour * 1e6 * 0.004), 0);
    } else if (sour > 0.01 && (w.status === 'producing' || w.status === 'completing' || w.status === 'fracking')) {
      add('sour_well', 'Sour well', at, 9, 0, Math.min(60, sour * 1e6 * 0.0006), 0);
    }
  }

  for (const f of state.hazards.fires) {
    let at = { x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 };
    let radius = 10 + f.intensity * 14;
    if (f.buildingId) {
      const b = state.buildings[f.buildingId];
      if (b) {
        at = { x: b.x + b.size[0] / 2, y: b.y + b.size[2] / 3, z: b.z + b.size[1] / 2 };
        radius += Math.max(b.size[0], b.size[1]) / 2;
      }
    }
    const name = f.buildingId ? BUILDINGS[state.buildings[f.buildingId]?.type ?? '']?.name : undefined;
    add('fire', name ? `Fire: ${name}` : 'Fire', at, radius, 0, 0, Math.max(0.2, f.intensity));
  }

  let lel = 0, h2s = 0, heat = 0;
  for (const s of sources) {
    lel += s.lel;
    h2s += s.h2s;
    heat = Math.max(heat, s.heat);
  }
  lel = Math.min(100, lel);
  const danger = Math.min(1, Math.max(lel / 25, h2s / 50, heat));
  sources.sort((a, b) => a.dist - b.dist);
  return { lel, h2s, heat, danger, nearest: sources[0] ?? null, sources };
}

/** Compass bearing from p to q (north = −Z, east = +X). */
export function compass(p: Vec3, q: Vec3): string {
  const a = Math.atan2(q.x - p.x, -(q.z - p.z)); // 0 = north, clockwise
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
