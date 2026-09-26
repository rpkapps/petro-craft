// Stand-in construction/facilities behaviour for the player dev harness (the real systems are built elsewhere).
import type { SimSystem, Rotation, GameContext } from '../../src/core/types';
import type { Command } from '../../src/core/commands';
import { BUILDINGS } from '../../src/content/buildings';
import { addBuilding, createBuildingState, findBuildingAt, rotatedSize } from '../../src/core/buildingUtil';
import { B } from '../../src/core/blocks';
import { SEA_LEVEL } from '../../src/core/constants';

function validate(ctx: GameContext, type: string, x: number, z: number, rot: Rotation) {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Unknown building', y: 0, cost: 0 };
  const [w, d, h] = rotatedSize(type, rot);
  const wd = ctx.world;
  if (x < 0 || z < 0 || x + w > wd.sizeX || z + d > wd.sizeZ) return { ok: false, reason: 'Outside the map', y: 0, cost: def.cost };
  let lo = Infinity, hi = -Infinity;
  for (let zz = z; zz < z + d; zz++)
    for (let xx = x; xx < x + w; xx++) {
      const s = wd.getSurfaceY(xx, zz);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      if (s <= SEA_LEVEL + 1 && wd.getBlock(xx, SEA_LEVEL, zz) === B.WATER) return { ok: false, reason: 'Needs dry land', y: s, cost: def.cost };
    }
  const y = Math.round((lo + hi) / 2);
  if (hi - lo > 4) return { ok: false, reason: 'Ground too steep', y, cost: def.cost };
  for (const b of Object.values(ctx.state.buildings)) {
    if (x < b.x + b.size[0] && b.x < x + w && z < b.z + b.size[1] && b.z < z + d) return { ok: false, reason: 'Overlaps another building', y, cost: def.cost };
  }
  if (ctx.state.company.money < def.cost) return { ok: false, reason: 'Not enough money', y, cost: def.cost };
  void h;
  return { ok: true, y, cost: def.cost };
}

export function createFakeConstructionSystem(log: (s: string) => void): SimSystem {
  return {
    id: 'fake-construction',
    init(ctx) {
      ctx.services.construction = {
        footprint: (type, rot) => rotatedSize(type, rot),
        buildingAt: (x, y, z) => findBuildingAt(ctx.state, x, y, z)?.id,
        validate: (type, x, z, rot) => validate(ctx, type, x, z, rot),
      };
      ctx.commands.register('build/place', (cmd: Command<'build/place'>, c) => {
        const type = (cmd as unknown as { buildingType?: string }).buildingType ?? '';
        const v = validate(c, type, cmd.x, cmd.z, cmd.rotation);
        if (!v.ok) return { ok: false, error: v.reason };
        const [w, d] = rotatedSize(type, cmd.rotation);
        for (let zz = cmd.z; zz < cmd.z + d; zz++)
          for (let xx = cmd.x; xx < cmd.x + w; xx++) {
            for (let yy = v.y; yy < v.y + 12; yy++) c.world.setBlock(xx, yy, zz, B.AIR, 'system');
            c.world.setBlock(xx, v.y - 1, zz, B.CONCRETE_PAD, 'system');
          }
        const b = createBuildingState(c, type, cmd.x, v.y, cmd.z, cmd.rotation, { prebuilt: true });
        addBuilding(c, b);
        c.transact(-v.cost, 'construction', type, true);
        log(`placed ${type} at ${cmd.x},${v.y},${cmd.z} r${cmd.rotation}`);
        return { ok: true };
      });
      ctx.commands.register('building/repair', (cmd) => {
        log(`repair ${cmd.buildingId} manual=${cmd.manual}`);
        return { ok: true };
      });
      ctx.commands.register('building/extinguish', (cmd, c) => {
        const f = c.state.hazards.fires.find((x) => x.id === cmd.fireId);
        if (f) {
          f.intensity -= cmd.amount;
          if (f.intensity <= 0) c.state.hazards.fires = c.state.hazards.fires.filter((x) => x !== f);
        }
        log(`extinguish ${cmd.fireId ?? cmd.buildingId} ${cmd.amount}`);
        return { ok: true };
      });
    },
    tick() {},
  };
}
