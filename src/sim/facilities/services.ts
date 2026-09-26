// Query services installed on ctx.services for UI / player / render.
import { rotatedSize } from '../../core/buildingUtil';
import type { GameContext, Rotation } from '../../core/types';
import { BUILDINGS } from '../../content/buildings';
import { validatePlacement } from './placement';
import type { FacilityRuntime } from './runtime';

export function installFacilityServices(ctx: GameContext, rt: FacilityRuntime): void {
  ctx.services.construction = {
    validate(type: string, x: number, z: number, rotation: Rotation, _playerY?: number) {
      rt.refreshBuildings();
      return validatePlacement(rt, type, x, z, rotation);
    },
    buildingAt(x: number, y: number, z: number) {
      rt.refreshBuildings();
      return rt.buildingAt(Math.floor(x), Math.floor(y), Math.floor(z))?.id;
    },
    footprint(type: string, rotation: Rotation) {
      if (!BUILDINGS[type]) return [1, 1, 1];
      return rotatedSize(type, rotation);
    },
  };
  ctx.services.networks = {
    networkAt(x: number, y: number, z: number) {
      return rt.topology.networkAt(Math.floor(x), Math.floor(y), Math.floor(z))?.id;
    },
    rebuild() {
      rt.refreshBuildings();
      rt.topology.invalidate();
      rt.topology.rebuild();
    },
  };
}
