// Registers every economy command handler on the session's CommandBus.
import type { GameContext } from '../../core/types';
import type { CommandResult } from '../../core/commands';
import { cmdAbandon, cmdAccept } from './contracts';
import type { EconomyRuntime } from './ext';
import { cmdRepayLoan, cmdTakeLoan } from './finance';
import { cmdLeaseBuy, cmdLeaseSell, type LeaseQuote } from './leases';
import { cmdClaim } from './objectives';
import { cmdResearchQueue, cmdResearchStart } from './research';
import { cmdBuy, cmdHedge, cmdSell, cmdSetAutoSell } from './sales';
import { cmdAssign, cmdFire, cmdHire, cmdSetAutoAssign } from './workforce';

/** Every command type the economy module handles (for the UI / tests). */
export const ECONOMY_COMMANDS = [
  'market/sell', 'market/buy', 'market/setAutoSell', 'market/hedge', 'contract/accept', 'contract/abandon', 'worker/hire', 'worker/fire',
  'worker/assign', 'worker/setAutoAssign', 'research/start', 'research/queue', 'finance/takeLoan', 'finance/repayLoan', 'lease/buy',
  'lease/sell', 'objective/claim', 'company/rename',
] as const;

function rename(name: unknown, ctx: GameContext): CommandResult {
  // eslint-disable-next-line no-control-regex
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length < 2) return { ok: false, error: 'Company name is too short' };
  if (n.length > 40) return { ok: false, error: 'Company name is too long (max 40 characters)' };
  ctx.state.company.name = n;
  ctx.state.meta.companyName = n;
  return { ok: true };
}

export function registerEconomyCommands(ctx: GameContext, rt: EconomyRuntime, quote: (px: number, pz: number) => LeaseQuote) {
  const c = ctx.commands;
  const netWorth = () => ctx.services.economy.netWorth();
  const after = (res: CommandResult) => {
    rt.objectivesDirty = true;
    rt.invalidateNetWorth();
    return res;
  };
  c.register('market/sell', (cmd, cx) => after(cmdSell(cmd, cx, rt)));
  c.register('market/buy', (cmd, cx) => after(cmdBuy(cmd, cx)));
  c.register('market/setAutoSell', (cmd, cx) => cmdSetAutoSell(cmd, cx));
  c.register('market/hedge', (cmd, cx) => after(cmdHedge(cmd, cx, netWorth)));
  c.register('contract/accept', (cmd, cx) => after(cmdAccept(cmd, cx)));
  c.register('contract/abandon', (cmd, cx) => after(cmdAbandon(cmd, cx)));
  c.register('worker/hire', (cmd, cx) => after(cmdHire(cmd, cx, rt)));
  c.register('worker/fire', (cmd, cx) => after(cmdFire(cmd, cx, rt)));
  c.register('worker/assign', (cmd, cx) => cmdAssign(cmd, cx, rt));
  c.register('worker/setAutoAssign', (cmd, cx) => cmdSetAutoAssign(cmd, cx, rt));
  c.register('research/start', (cmd, cx) => after(cmdResearchStart(cmd, cx)));
  c.register('research/queue', (cmd, cx) => after(cmdResearchQueue(cmd, cx)));
  c.register('finance/takeLoan', (cmd, cx) => after(cmdTakeLoan(cmd, cx, netWorth)));
  c.register('finance/repayLoan', (cmd, cx) => after(cmdRepayLoan(cmd, cx)));
  c.register('lease/buy', (cmd, cx) => after(cmdLeaseBuy(cmd, cx, quote)));
  c.register('lease/sell', (cmd, cx) => after(cmdLeaseSell(cmd, cx)));
  c.register('objective/claim', (cmd, cx) => after(cmdClaim(cmd, cx)));
  c.register('company/rename', (cmd, cx) => rename(cmd.name, cx));
}
