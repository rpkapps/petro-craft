import { DRILLING_MODELS } from './drilling';
import { registerModels } from './registry';
import { SUPPORT_MODELS } from './support';
import { WELLHEAD_MODELS } from './wellhead';

let registered = false;

/** Register every building model (idempotent). */
export function registerAllModels(): void {
  if (registered) return;
  registered = true;
  registerModels(SUPPORT_MODELS);
  registerModels(DRILLING_MODELS);
  registerModels(WELLHEAD_MODELS);
}
