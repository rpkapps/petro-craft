// Entity layer entry point (owned by the Entities & FX module).
// Renders every building model, animates them, and draws FX, weather particles, vehicles and workers.
import type { RenderHost } from '../../core/client';
import type { GameContext } from '../../core/types';
import { EntityLayerImpl, type EntityLayer } from './EntityLayer';

export type { EntityLayer, EntityLayerDebug } from './EntityLayer';
export { EntityLayerImpl } from './EntityLayer';
export { BuildingGhost } from './ghost';
export { rotationYaw } from './BuildingView';
export { registerAllModels } from './models';
export { hasModel, registeredTypes } from './models/registry';

export function createEntityLayer(host: RenderHost, ctx: GameContext): EntityLayer {
  return new EntityLayerImpl(host, ctx);
}
