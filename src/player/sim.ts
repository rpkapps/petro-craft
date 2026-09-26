// STUB — owned by the Player agent. Authoritative handlers for world/* and player/* commands.
import type { SimSystem } from '../core/types';
export function createPlayerSimSystem(): SimSystem {
  return { id: 'player', init() {}, tick() {} };
}
