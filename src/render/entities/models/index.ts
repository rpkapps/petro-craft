import { DRILLING_MODELS } from './drilling';
import { ENVIRONMENT_MODELS } from './environment';
import { LOGISTICS_MODELS } from './logistics';
import { MIDSTREAM_MODELS } from './midstream';
import { OFFSHORE_MODELS } from './offshore';
import { PETROCHEM_MODELS } from './petrochem';
import { POWER_MODELS } from './power';
import { PROCESSING_MODELS } from './processing';
import { PRODUCTION_MODELS } from './production';
import { registerModels } from './registry';
import { STORAGE_MODELS } from './storage';
import { SUPPORT_MODELS } from './support';
import { WELLHEAD_MODELS } from './wellhead';

let registered = false;

/** Register every building model (idempotent). */
export function registerAllModels(): void {
  if (registered) return;
  registered = true;
  for (const set of [
    SUPPORT_MODELS,
    DRILLING_MODELS,
    WELLHEAD_MODELS,
    PRODUCTION_MODELS,
    STORAGE_MODELS,
    MIDSTREAM_MODELS,
    LOGISTICS_MODELS,
    PROCESSING_MODELS,
    PETROCHEM_MODELS,
    POWER_MODELS,
    ENVIRONMENT_MODELS,
    OFFSHORE_MODELS,
  ])
    registerModels(set);
}
