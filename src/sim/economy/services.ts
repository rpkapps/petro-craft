// ctx.services.economy implementation.
import type { GameContext, Services } from '../../core/types';
import { computeNetWorth } from './finance';
import type { EconomyRuntime } from './ext';
import { leaseKey, type LeaseQuote } from './leases';

export function installEconomyServices(ctx: GameContext, rt: EconomyRuntime, quote: (px: number, pz: number) => LeaseQuote) {
  const economy: Services['economy'] = {
    netWorth: () => rt.cachedNetWorth(ctx.state, () => computeNetWorth(ctx.state)),
    leaseKey,
    leaseQuote: (px: number, pz: number) => quote(px, pz),
  };
  ctx.services.economy = economy;
}
