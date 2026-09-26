// Command handlers owned by facilities (construction & building operation).
import { RECIPES, recipesFor } from '../../content/recipes';
import { BUILDINGS } from '../../content/buildings';
import type { GameContext, Rotation } from '../../core/types';
import type { Command } from '../../core/commands';
import { validateConfig } from './config';
import type { ConstructionSystem } from './construction';
import type { FireSystem } from './fires';
import type { MaintenanceSystem } from './maintenance';
import type { FacilityRuntime } from './runtime';
import type { SpillSystem } from './spills';

export interface CommandDeps {
  rt: FacilityRuntime;
  construction: ConstructionSystem;
  maintenance: MaintenanceSystem;
  fires: FireSystem;
  spills: SpillSystem;
}

/**
 * The building type of a 'build/place' command: `buildingType` (contract), with `building` or a bare building id
 * in `type` accepted as fallbacks for older callers.
 */
export function placeType(cmd: Command<'build/place'>): string | undefined {
  if (typeof cmd.buildingType === 'string' && BUILDINGS[cmd.buildingType]) return cmd.buildingType;
  const c = cmd as unknown as { type?: unknown; building?: unknown };
  for (const v of [c.building, c.type]) if (typeof v === 'string' && BUILDINGS[v]) return v;
  return undefined;
}

/** Build a well-formed 'build/place' command. */
export function buildPlaceCommand(buildingType: string, x: number, z: number, rotation: Rotation): Command<'build/place'> {
  return { type: 'build/place', buildingType, x, z, rotation };
}

export function registerFacilityCommands(ctx: GameContext, deps: CommandDeps): void {
  const { rt, construction, maintenance, fires, spills } = deps;
  const c = ctx.commands;

  c.register('build/place', (cmd, cx) => {
    const type = placeType(cmd);
    if (!type) return { ok: false, error: 'Unknown building' };
    if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return { ok: false, error: 'Invalid position' };
    return construction.place(type, cmd.x, cmd.z, cmd.rotation, cmd.playerId ?? cx.localPlayerId);
  });
  c.register('build/demolish', (cmd) => construction.demolish(cmd.buildingId, false));
  c.register('build/cancel', (cmd) => construction.demolish(cmd.buildingId, true));

  c.register('building/toggle', (cmd, cx) => {
    const b = cx.state.buildings[cmd.buildingId];
    if (!b) return { ok: false, error: 'Building not found' };
    if (b.status === 'destroyed') return { ok: false, error: 'This building is destroyed' };
    b.enabled = !!cmd.enabled;
    return { ok: true, data: { enabled: b.enabled } };
  });

  c.register('building/configure', (cmd, cx) => {
    const b = cx.state.buildings[cmd.buildingId];
    if (!b) return { ok: false, error: 'Building not found' };
    const v = validateConfig(b, cmd.key, cmd.value);
    if (!v.ok) return { ok: false, error: v.error };
    b.config[cmd.key] = v.value;
    return { ok: true, data: { key: cmd.key, value: v.value } };
  });

  c.register('building/setRecipe', (cmd, cx) => {
    const b = cx.state.buildings[cmd.buildingId];
    if (!b) return { ok: false, error: 'Building not found' };
    const r = RECIPES[cmd.recipeId];
    if (!r || r.building !== b.type) {
      const opts = recipesFor(b.type);
      return { ok: false, error: opts.length ? 'That recipe is not available for this building' : 'This building has no recipes' };
    }
    b.recipeId = r.id;
    return { ok: true, data: { recipeId: r.id } };
  });

  c.register('building/setThrottle', (cmd, cx) => {
    const b = cx.state.buildings[cmd.buildingId];
    if (!b) return { ok: false, error: 'Building not found' };
    const t = Number(cmd.throttle);
    if (!Number.isFinite(t)) return { ok: false, error: 'Invalid throttle' };
    b.throttle = Math.max(0, Math.min(1, t));
    return { ok: true, data: { throttle: b.throttle } };
  });

  c.register('building/repair', (cmd, cx) => {
    const manual = !!cmd.manual;
    if (cx.state.networks[cmd.buildingId]) {
      if (rt.topology.dirty) rt.topology.rebuild();
      const res = spills.repairLeak(cmd.buildingId, manual);
      if (res.ok && manual) maintenance.consumeParts(1);
      return res;
    }
    const b = cx.state.buildings[cmd.buildingId];
    if (!b) return { ok: false, error: 'Nothing to repair' };
    return maintenance.repair(b, manual);
  });

  c.register('building/extinguish', (cmd) => fires.extinguish({ fireId: cmd.fireId, buildingId: cmd.buildingId, amount: cmd.amount }));
}
