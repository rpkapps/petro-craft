// Recipe processing for plants (gas plant, refinery, crackers, LNG, water treatment ...).
// Run fraction = efficiency (crew × power × condition × throttle × process_speed), limited by feed stock and
// by room for outputs; outputs scaled by yield modifiers.
import type { ModifierKey } from '../../content/tech';
import { ITEMS } from '../../content/items';
import type { BuildingState, FluidCat, SimStep } from '../../core/types';
import { PROCESSING_TYPES, emaAlpha } from './catalog';
import type { FacilityRuntime } from './runtime';
import { addStorage, capacityOf, recipeOf, takeStorage, usedOf } from './storage';

const YIELD_MOD: Record<string, ModifierKey> = {
  refinery: 'refinery_yield',
  fcc_unit: 'refinery_yield',
  lube_plant: 'refinery_yield',
  steam_cracker: 'petrochem_yield',
  polymer_plant: 'petrochem_yield',
  ammonia_plant: 'petrochem_yield',
};

export class ProcessingSystem {
  private readonly catNeed: Record<FluidCat, number> = { oil: 0, gas: 0, water: 0, product: 0 };
  constructor(private readonly rt: FacilityRuntime) {}

  tick(step: SimStep): void {
    const rt = this.rt;
    const alpha = emaAlpha(step.minutes);
    for (const b of rt.list) {
      if (!PROCESSING_TYPES.has(b.type) || b.constructionProgress < 1) continue;
      const x = step.days > 0 ? this.run(b, step.days) : 0;
      b.utilization += (Math.min(1, x) - b.utilization) * alpha;
      if (b.utilization < 1e-4) b.utilization = 0;
    }
  }

  /** Process one step; returns the achieved run fraction 0..1.25. */
  run(b: BuildingState, days: number): number {
    const rt = this.rt;
    const ctx = rt.ctx;
    const r = recipeOf(b);
    if (!r) return 0;
    let speed = ctx.modifier('process_speed');
    if (b.type === 'water_treatment') speed *= ctx.modifier('water_treatment');
    let x = rt.efficiency(b) * speed;
    if (x <= 0) return 0;
    for (const item in r.inputs) {
      const need = r.inputs[item] * days;
      if (need > 0) x = Math.min(x, (b.storage[item] ?? 0) / need);
    }
    if (x <= 1e-9) return 0;
    const ym = YIELD_MOD[b.type] ? ctx.modifier(YIELD_MOD[b.type]) : 1;
    // Output room per category: inputs consumed this step free room in shared categories.
    const need = this.catNeed;
    need.oil = need.gas = need.water = need.product = 0;
    for (const item in r.outputs) {
      const c = ITEMS[item]?.category;
      if (c) need[c] += r.outputs[item] * ym * days;
    }
    for (const c of ['oil', 'gas', 'water', 'product'] as FluidCat[]) {
      if (need[c] <= 0) continue;
      let freed = 0;
      for (const item in r.inputs) if (ITEMS[item]?.category === c) freed += r.inputs[item] * days;
      const room = capacityOf(ctx, b, c) - usedOf(b, c);
      // room + freed*x ≥ need*x  →  x ≤ room / (need − freed)
      const net = need[c] - freed;
      if (net > 0) x = Math.min(x, Math.max(0, room) / net);
    }
    if (x <= 1e-9) return 0;
    for (const item in r.inputs) {
      const q = r.inputs[item] * days * x;
      takeStorage(b, item, q);
      rt.io(b, item, -q);
    }
    for (const item in r.outputs) {
      const q = r.outputs[item] * ym * days * x;
      addStorage(b, item, q);
      rt.io(b, item, q);
    }
    return x;
  }
}
