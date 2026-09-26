// Maps game state (buildings by type/status, wells, fires, blowouts) to positioned looping sound layers.
import type { BuildingState, GameContext, WellState } from '../../core/types';
import { clamp } from '../dsp';

export interface LoopLayer {
  loop: string;
  /** Linear gain at the reference distance. */
  gain: number;
  /** Playback-rate multiplier. */
  rate: number;
  /** PannerNode refDistance (blocks). */
  ref: number;
  /** Beyond this the layer is inaudible / culled. */
  maxDist: number;
}

export interface Emitter {
  key: string;
  x: number;
  y: number;
  z: number;
  layers: LoopLayer[];
}

const L = (loop: string, gain: number, ref = 6, maxDist = 140, rate = 1): LoopLayer => ({ loop, gain, rate, ref, maxDist });

const RIGS = new Set(['drilling_rig_land', 'drilling_rig_heavy', 'jackup_rig', 'semi_sub_rig']);
const PLANTS = new Set(['gas_plant', 'refinery', 'fcc_unit', 'lube_plant', 'lng_plant', 'steam_cracker', 'polymer_plant', 'ammonia_plant', 'ccs_unit']);
const QUIET_HVAC = new Set(['field_office', 'worker_camp', 'research_lab', 'scada_center', 'maintenance_depot']);

/** Nominal pumpjack stroke rate (strokes/min) — matches the pumpjack loop at rate 1 (12 spm). */
export function pumpjackSpm(b: BuildingState, well: WellState | undefined): number {
  const d = b.data as Record<string, unknown>;
  for (const k of ['strokesPerMinute', 'spm', 'strokeRate']) {
    const v = d?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return clamp(v, 2, 20);
  }
  const choke = well ? clamp(well.choke, 0, 1) : 0.6;
  return 6 + 6 * choke;
}

function buildingLayers(ctx: GameContext, b: BuildingState): LoopLayer[] {
  const st = b.status;
  if (st === 'constructing') return [L('loop_construction', 0.55, 5, 110)];
  if (st === 'destroyed' || st === 'disabled' || st === 'no_power' || st === 'broken' || st === 'fire' || st === 'unstaffed') return [];
  const active = st === 'active';
  const util = clamp(Number.isFinite(b.utilization) ? b.utilization : 0.5, 0, 1);
  const load = active ? 0.55 + 0.45 * util : 0.3;
  const [w, d] = b.size;
  const big = clamp(Math.sqrt(w * d) / 6, 0.6, 2.2);
  const t = b.type;

  if (RIGS.has(t)) {
    const well = b.wellId ? ctx.state.wells[b.wellId] : undefined;
    const ws = well?.status;
    if (ws === 'drilling' || ws === 'kick') return [L('loop_diesel', 0.9, 9, 200), L('loop_rotary', 0.8, 7, 150)];
    if (ws === 'tripping') return [L('loop_diesel', 0.8, 9, 200, 0.95), L('loop_tripping', 0.75, 7, 150)];
    if (ws === 'casing' || ws === 'completing' || ws === 'fracking') return [L('loop_diesel', 0.7, 9, 180, 0.92), L('loop_rotary', 0.35, 6, 110, 0.8)];
    return [L('loop_diesel', 0.3, 7, 120, 0.82)];
  }
  switch (t) {
    case 'frac_spread':
      return active ? [L('loop_diesel', 1.0, 10, 220, 1.15), L('loop_plant', 0.35, 8, 150, 1.2)] : [L('loop_diesel', 0.3, 6, 100, 0.85)];
    case 'wellhead': {
      const well = b.wellId ? ctx.state.wells[b.wellId] : undefined;
      if (!well) return [];
      if (well.status === 'producing') {
        if (well.lift === 'pumpjack') return [L('loop_pumpjack', 0.7, 5, 90, pumpjackSpm(b, well) / 12)];
        if (well.lift === 'esp') return [L('loop_pump', 0.25, 3, 60, 1.05), L('loop_wellflow', 0.3, 3, 60)];
        if (well.lift === 'gaslift') return [L('loop_wellflow', 0.45, 4, 70), L('loop_compressor', 0.2, 3, 60, 1.1)];
        return [L('loop_wellflow', 0.35 + 0.35 * clamp(well.choke, 0, 1), 3, 60)];
      }
      if (well.status === 'injecting') return [L('loop_pump', 0.3, 3, 60)];
      return [];
    }
    case 'pump_station':
    case 'disposal_well':
    case 'water_treatment':
      return [L('loop_pump', 0.55 * load, 5, 100)];
    case 'compressor_station':
      return [L('loop_compressor', 0.9 * load, 7, 160, active ? 1 : 0.9)];
    case 'gas_sales_meter':
      return [L('loop_wellflow', 0.3, 3, 50, 1.1)];
    case 'flare_stack': {
      const flaring = active ? 0.2 + 0.8 * util : 0.07;
      return [L('loop_flare', flaring, 6 + 8 * flaring, 200, 0.85 + 0.3 * flaring)];
    }
    case 'gas_turbine_power':
      return [L('loop_turbine', 0.8 * load, 8, 200)];
    case 'diesel_generator':
      return [L('loop_diesel', 0.6 * load, 5, 110, 1.35)];
    case 'wind_turbine': {
      const wind = clamp(ctx.state.weather.windSpeed / 14, 0.15, 1.4);
      return [L('loop_windturbine', 0.55 * clamp(wind, 0.2, 1), 10, 130, clamp(0.6 + 0.5 * wind, 0.5, 1.4))];
    }
    case 'production_platform':
    case 'fpso':
      return [L('loop_plant', 0.8 * load * big, 10, 260), L('loop_turbine', 0.35 * load, 8, 180)];
    case 'truck_terminal':
    case 'rail_terminal':
    case 'export_terminal':
      return [L('loop_pump', 0.4 * load, 5, 110), L('loop_diesel', 0.2 * load, 6, 110, 0.8)];
    case 'lng_plant':
      return [L('loop_plant', 1.0 * load * big, 12, 320), L('loop_turbine', 0.45 * load, 10, 220, 0.9)];
    case 'steam_cracker':
      return [L('loop_plant', 0.95 * load * big, 12, 300), L('loop_flare', 0.25 * load, 8, 180, 0.7)];
    default:
      if (PLANTS.has(t)) return [L('loop_plant', 0.9 * load * big, 10, 280, 0.9 + 0.2 * util)];
      if (QUIET_HVAC.has(t)) return [L('loop_hvac', 0.25, 3, 45)];
      return [];
  }
}

/** Collect every sounding emitter in the world. `firePos` receives fire positions (for 'hazard:fireOut'). */
export function collectEmitters(ctx: GameContext, out: Emitter[], firePos: Map<string, { x: number; y: number; z: number }>) {
  out.length = 0;
  const s = ctx.state;
  for (const id in s.buildings) {
    const b = s.buildings[id];
    const layers = buildingLayers(ctx, b);
    if (!layers.length) continue;
    const [w, d, h] = b.size;
    out.push({ key: `b:${id}`, x: b.x + w / 2, y: b.y + Math.min(h * 0.35, 4), z: b.z + d / 2, layers });
  }
  firePos.clear();
  for (const f of s.hazards.fires) {
    firePos.set(f.id, { x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 });
    if (f.wellId && s.wells[f.wellId]?.status === 'blowout') continue; // blowout layer covers it
    const i = clamp(f.intensity, 0, 1);
    const layers = [L('loop_fire', 0.35 + 0.75 * i, 3 + 6 * i, 120)];
    if (i > 0.5) layers.push(L('loop_flare', (i - 0.5) * 1.6, 6 + 6 * i, 180, 0.7));
    out.push({ key: `f:${f.id}`, x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5, layers });
  }
  for (const id in s.wells) {
    const w = s.wells[id];
    if (w.status !== 'blowout') continue;
    const layers = [L('loop_blowout', 1.2, 16, 420)];
    if (w.blowout?.onFire) layers.push(L('loop_flare', 1.0, 14, 380, 0.75), L('loop_fire', 0.8, 10, 250));
    out.push({ key: `w:${id}`, x: w.x + 0.5, y: w.surfaceY + 2, z: w.z + 0.5, layers });
  }
}
