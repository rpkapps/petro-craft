// Produced-water handling that is not recipe-driven: evaporation pits (evaporation, rain inflow, overflow spills)
// and saltwater disposal wells (inject up to 8,000 bbl/day).
import type { SimStep } from '../../core/types';
import { emaAlpha } from './catalog';
import { daylight } from './power';
import { centerOf, type FacilityRuntime } from './runtime';
import type { SpillSystem } from './spills';
import { addStorage, capacityOf, fillFraction, takeStorage, usedOf } from './storage';

export const DISPOSAL_RATE = 8000; // bbl/day
const PIT_EVAPORATION = 220; // bbl/day for a 5×5 pit at ~25 °C in full sun
const PIT_RAIN_INFLOW = 450; // bbl/day at full precipitation

export class WaterSystem {
  constructor(private readonly rt: FacilityRuntime, private readonly spills: SpillSystem) {}

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const w = ctx.state.weather;
    const alpha = emaAlpha(step.minutes);
    const rainy = w.current === 'rain' || w.current === 'storm' || w.current === 'hurricane';
    for (const b of rt.list) {
      if (b.constructionProgress < 1 || b.status === 'destroyed') continue;
      if (b.type === 'water_pit') {
        const cap = capacityOf(ctx, b, 'water');
        let used = usedOf(b, 'water');
        if (used > 0) {
          const temp = Math.max(0, Math.min(1.6, (w.temperature + 5) / 30));
          const sun = daylight(ctx.state.time.minuteOfDay) * (1 - 0.7 * w.cloudCover);
          let evap = PIT_EVAPORATION * temp * (0.35 + 0.65 * sun) * (rainy ? 0.2 : 1) * step.days;
          const t1 = takeStorage(b, 'produced_water', evap);
          evap -= t1;
          const t2 = takeStorage(b, 'fresh_water', evap);
          if (t1 + t2 > 0) rt.io(b, 'produced_water', -(t1 + t2));
          used -= t1 + t2;
        }
        if (rainy && w.precipitation > 0) {
          const rain = PIT_RAIN_INFLOW * w.precipitation * (w.current === 'rain' ? 0.6 : 1) * step.days;
          addStorage(b, 'produced_water', rain);
          used += rain;
        }
        if (used > cap) {
          const over = used - cap;
          const t = takeStorage(b, 'produced_water', over);
          takeStorage(b, 'fresh_water', over - t);
          const c = centerOf(b);
          this.spills.addSpill('water', Math.floor(c.x), b.y, Math.floor(c.z), over);
          if (b.data.overflowDay !== ctx.state.time.day) {
            b.data.overflowDay = ctx.state.time.day;
            ctx.notify('warning', 'Evaporation pit overflowing', 'Brine is spilling over the berm. Pipe water to a disposal well or build more capacity.', { x: c.x, y: b.y, z: c.z });
          }
        }
        b.utilization = fillFraction(ctx, b);
      } else if (b.type === 'disposal_well') {
        let rate = 0;
        const eff = rt.efficiency(b);
        if (eff > 0 && step.days > 0) {
          const q = takeStorage(b, 'produced_water', DISPOSAL_RATE * eff * step.days);
          if (q > 0) rt.io(b, 'produced_water', -q);
          rate = q / step.days;
        }
        b.utilization += (Math.min(1, rate / DISPOSAL_RATE) - b.utilization) * alpha;
      }
    }
  }
}
