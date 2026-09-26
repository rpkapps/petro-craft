// Per-type building configuration keys (b.config), their defaults and validation for 'building/configure'.
import type { BuildingState } from '../../core/types';

export type ConfigValue = number | string | boolean;
export interface ConfigSpec {
  kind: 'bool' | 'enum' | 'number';
  default: ConfigValue;
  options?: string[];
  min?: number;
  max?: number;
  label: string;
}

const FLARE: Record<string, ConfigSpec> = {
  flareExcessGas: { kind: 'bool', default: true, label: 'Flare excess gas (otherwise vent)' },
};
const SELL_POWER: Record<string, ConfigSpec> = {
  sellPower: { kind: 'bool', default: true, label: 'Run at full output and sell surplus power' },
};
const TANK: Record<string, ConfigSpec> = {
  fill: { kind: 'bool', default: true, label: 'Accept inflow' },
  discharge: { kind: 'bool', default: true, label: 'Supply downstream consumers' },
};
const TERMINAL: Record<string, ConfigSpec> = {
  accept: { kind: 'enum', default: 'all', options: ['all', 'oil', 'product'], label: 'Accepted streams' },
};

/** Known config keys per building type. Unknown keys are still stored (other modules may use them). */
export const CONFIG_SCHEMA: Record<string, Record<string, ConfigSpec>> = {
  wellhead: FLARE,
  production_platform: FLARE,
  fpso: FLARE,
  gas_turbine_power: SELL_POWER,
  solar_farm: SELL_POWER,
  wind_turbine: SELL_POWER,
  diesel_generator: {
    priority: { kind: 'enum', default: 'base', options: ['base', 'backup'], label: 'Dispatch (base: before grid import, backup: after)' },
    useWarehouse: { kind: 'bool', default: true, label: 'Burn diesel from the company warehouse' },
    truckDiesel: { kind: 'bool', default: true, label: 'Buy trucked diesel when out of fuel (1.5× price)' },
  },
  gas_sales_meter: { acceptRaw: { kind: 'bool', default: true, label: 'Accept raw (wet) gas at a discount' } },
  truck_terminal: TERMINAL,
  rail_terminal: TERMINAL,
  export_terminal: TERMINAL,
  oil_tank_small: TANK,
  oil_tank_large: TANK,
  gas_sphere: TANK,
  water_pit: TANK,
  ccs_unit: { mode: { kind: 'enum', default: 'auto', options: ['auto', 'credits', 'eor'], label: 'CO₂ destination' } },
};

/** Fill missing config keys with defaults (idempotent). */
export function applyConfigDefaults(b: BuildingState): void {
  const schema = CONFIG_SCHEMA[b.type];
  if (!b.config) b.config = {};
  if (!schema) return;
  for (const k in schema) if (b.config[k] === undefined) b.config[k] = schema[k].default;
}

/** Validate & normalise a config value. Returns an error string or the value to store. */
export function validateConfig(b: BuildingState, key: string, value: ConfigValue): { ok: true; value: ConfigValue } | { ok: false; error: string } {
  if (typeof key !== 'string' || key.length === 0 || key.length > 40) return { ok: false, error: 'Invalid setting' };
  const t = typeof value;
  if (t !== 'number' && t !== 'string' && t !== 'boolean') return { ok: false, error: 'Invalid value' };
  const spec = CONFIG_SCHEMA[b.type]?.[key];
  if (!spec) {
    if (t === 'string' && (value as string).length > 200) return { ok: false, error: 'Value too long' };
    if (t === 'number' && !Number.isFinite(value as number)) return { ok: false, error: 'Invalid number' };
    return { ok: true, value };
  }
  switch (spec.kind) {
    case 'bool':
      if (t !== 'boolean') return { ok: false, error: `${spec.label}: expected on/off` };
      return { ok: true, value };
    case 'enum':
      if (t !== 'string' || !spec.options!.includes(value as string)) return { ok: false, error: `${spec.label}: choose ${spec.options!.join(' / ')}` };
      return { ok: true, value };
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Invalid number' };
      return { ok: true, value: Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n)) };
    }
  }
}
