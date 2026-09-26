// Global power grid: demand from operational consumers, merit-order dispatch of generators
// (renewables → gas turbines → diesel (base) → utility import ≤ 5 MW → diesel (backup)), fuel burn,
// surplus export and hourly money settlement. Writes ctx.state.power and runtime.powerFactor.
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import type { BuildingState, SimStep } from '../../core/types';
import {
  BBL_DIESEL_PER_MWH, GRID_EXPORT_PRICE, GRID_IMPORT_MAX, GRID_IMPORT_PRICE, MCF_PER_MWH, TRUCKED_DIESEL_PREMIUM,
} from './catalog';
import type { FacilityRuntime } from './runtime';
import { recipeOf, takeStorage } from './storage';

/** Daylight 0..1 from minute of day (sunrise 06:00, sunset 19:00). */
export function daylight(minuteOfDay: number): number {
  const h = minuteOfDay / 60;
  if (h <= 6 || h >= 19) return 0;
  return Math.sin((Math.PI * (h - 6)) / 13);
}

/** Wind turbine power curve 0..1 (cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s). */
export function windCurve(v: number): number {
  if (v < 3 || v >= 25) return 0;
  if (v >= 12) return 1;
  const t = (v - 3) / 9;
  return t * t * t;
}

export class PowerSystem {
  /** Scratch lists reused every step. */
  private turbines: BuildingState[] = [];
  private diesels: BuildingState[] = [];
  constructor(private readonly rt: FacilityRuntime) {}

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = ctx.state;
    const w = st.weather;
    const effMod = ctx.modifier('power_efficiency');
    const hours = step.minutes / 60;

    // ---- demand
    let demand = 0;
    for (const b of rt.list) {
      const d = BUILDINGS[b.type];
      if (!d || d.power <= 0 || !rt.operational(b)) continue;
      if (rt.needsCrew(b) && rt.crew(b) <= 0) continue;
      demand += d.power;
      const r = recipeOf(b);
      if (r?.power) demand += r.power * b.utilization;
    }

    // ---- renewables (must-run)
    let renew = 0;
    let renewSellable = 0;
    this.turbines.length = 0;
    this.diesels.length = 0;
    const sun = daylight(st.time.minuteOfDay) * (1 - 0.7 * Math.min(1, Math.max(0, w.cloudCover)));
    const wind = windCurve(w.windSpeed);
    for (const b of rt.list) {
      const d = BUILDINGS[b.type];
      if (!d || d.power >= 0) continue;
      if (!rt.operational(b)) {
        this.setOutput(b, 0, -d.power);
        continue;
      }
      const rated = -d.power;
      if (b.type === 'solar_farm' || b.type === 'wind_turbine') {
        const out = rated * (b.type === 'solar_farm' ? sun : wind) * rt.conditionFactor(b);
        renew += out;
        if (b.config.sellPower !== false) renewSellable += out;
        this.setOutput(b, out, rated);
      } else if (b.type === 'gas_turbine_power') this.turbines.push(b);
      else if (b.type === 'diesel_generator') this.diesels.push(b);
    }

    let supply = renew;
    let need = Math.max(0, demand - supply);
    let exportable = Math.max(0, renewSellable - Math.max(0, demand - (renew - renewSellable)));

    // ---- gas turbines (fuel-limited; run flat out when selling surplus)
    for (const b of this.turbines) {
      const rated = -BUILDINGS[b.type].power;
      const crew = rt.needsCrew(b) ? Math.min(1, rt.crew(b)) : 1;
      const cond = rt.conditionFactor(b);
      const avail = rated * crew * cond * Math.max(0, Math.min(1, b.throttle));
      const fuel = (b.storage.dry_gas ?? 0) + (b.storage.natural_gas ?? 0);
      const mcfPerMw = (MCF_PER_MWH * hours) / effMod; // mcf per MW over this step
      const fuelCap = mcfPerMw > 0 ? fuel / mcfPerMw : avail;
      const maxOut = Math.min(avail, fuelCap);
      const sell = b.config.sellPower !== false;
      const out = sell ? maxOut : Math.min(maxOut, need);
      let burn = out * mcfPerMw;
      const dry = takeStorage(b, 'dry_gas', burn);
      burn -= dry;
      const raw = takeStorage(b, 'natural_gas', burn);
      if (dry > 0) rt.io(b, 'dry_gas', -dry);
      if (raw > 0) rt.io(b, 'natural_gas', -raw);
      const used = Math.min(out, need);
      need -= used;
      supply += out;
      if (sell) exportable += out - used;
      this.setOutput(b, out, rated);
    }

    // ---- diesel gensets: base-load ones before grid import, backup ones after
    const runDiesel = (backup: boolean) => {
      for (const b of this.diesels) {
        const isBackup = b.config.priority === 'backup';
        if (isBackup !== backup) continue;
        const rated = -BUILDINGS[b.type].power;
        const avail = rated * rt.conditionFactor(b) * Math.max(0, Math.min(1, b.throttle));
        const out = Math.min(avail, need);
        let fuel = out * BBL_DIESEL_PER_MWH * hours / effMod;
        const fromTank = takeStorage(b, 'diesel', fuel);
        fuel -= fromTank;
        if (fromTank > 0) rt.io(b, 'diesel', -fromTank);
        let produced = out;
        if (fuel > 0 && b.config.useWarehouse !== false) {
          const wh = st.company.warehouse;
          const t = Math.min(wh.diesel ?? 0, fuel);
          if (t > 0) {
            wh.diesel = (wh.diesel ?? 0) - t;
            if (wh.diesel <= 1e-6) delete wh.diesel;
            fuel -= t;
            rt.io(b, 'diesel', -t);
          }
        }
        if (fuel > 0) {
          if (b.config.truckDiesel !== false) {
            const price = (st.market.prices.diesel ?? ITEMS.diesel.basePrice) * TRUCKED_DIESEL_PREMIUM;
            rt.pending.truckedDiesel += fuel * price;
            rt.io(b, 'diesel', -fuel);
          } else {
            // Out of fuel: only what was burnt is produced.
            const perMw = (BBL_DIESEL_PER_MWH * hours) / effMod;
            produced = perMw > 0 ? Math.max(0, out - fuel / perMw) : 0;
          }
        }
        need -= produced;
        supply += produced;
        this.setOutput(b, produced, rated);
      }
    };
    runDiesel(false);

    // ---- utility import
    const imp = Math.min(GRID_IMPORT_MAX, need);
    need -= imp;
    rt.pending.gridImport += imp * hours * GRID_IMPORT_PRICE;
    runDiesel(true);

    // ---- surplus export
    rt.pending.gridExport += exportable * hours * GRID_EXPORT_PRICE;

    const served = Math.max(0, demand - need);
    const satisfaction = demand > 1e-6 ? Math.min(1, served / demand) : 1;
    st.power.generation = Math.round(supply * 100) / 100;
    st.power.demand = Math.round(demand * 100) / 100;
    st.power.gridImport = Math.round(imp * 100) / 100;
    st.power.satisfaction = satisfaction;
    rt.powerFactor = satisfaction;
  }

  private setOutput(b: BuildingState, mw: number, rated: number) {
    const u = rated > 0 ? Math.min(1, mw / rated) : 0;
    b.utilization += (u - b.utilization) * Math.min(1, this.rt.stepMinutes / 30);
    b.data.outputMW = Math.round(mw * 100) / 100;
  }
}
