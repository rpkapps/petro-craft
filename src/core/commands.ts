// Command bus: the ONLY way player intent mutates GameState. Commands are plain serializable
// objects so they can be sent over the network to an authoritative host in multiplayer.
//
// Systems register handlers in their init(): ctx.commands.register('well/setChoke', (cmd, ctx) => {...}).
// UI / player code calls ctx.commands.dispatch({ type: 'well/setChoke', wellId, choke: 0.5 }).
import type { GameContext, Rotation, WellPlan, LiftType, WellPurpose, PlayerMode, Vec3 } from './types';

export interface CommandMap {
  // --- time
  'time/setSpeed': { speed: number };
  'time/setPaused': { paused: boolean };
  // --- world / player
  'world/breakBlock': { x: number; y: number; z: number };
  'world/placeBlock': { x: number; y: number; z: number; slot: number };
  /** Place a straight/L-shaped run of pipe (or road/other block) blocks; cost charged per block. */
  'world/placeLine': { block: number; points: Vec3[] };
  'player/setMode': { mode: PlayerMode };
  'player/selectSlot': { slot: number };
  'player/moveItem': { from: number; to: number };
  'player/sync': { position: Vec3; velocity: Vec3; yaw: number; pitch: number };
  // --- construction
  'build/place': { type: string; x: number; z: number; rotation: Rotation };
  'build/demolish': { buildingId: string };
  'build/cancel': { buildingId: string };
  'building/toggle': { buildingId: string; enabled: boolean };
  'building/configure': { buildingId: string; key: string; value: number | string | boolean };
  'building/setRecipe': { buildingId: string; recipeId: string };
  'building/setThrottle': { buildingId: string; throttle: number };
  'building/repair': { buildingId: string; manual?: boolean };
  'building/extinguish': { buildingId?: string; fireId?: string; amount: number };
  // --- exploration
  'survey/start': { kind: '2d' | '3d'; x0: number; z0: number; x1: number; z1: number };
  'survey/cancel': { surveyId: string };
  // --- drilling & wells
  'well/plan': { rigId: string; plan: WellPlan; purpose: WellPurpose; name?: string };
  'well/spud': { wellId: string };
  'well/setMudWeight': { wellId: string; mudWeight: number };
  'well/runCasing': { wellId: string };
  'well/controlKick': { wellId: string; method: 'drillers' | 'wait_weight' | 'bullhead' };
  'well/capBlowout': { wellId: string; method: 'cap' | 'relief_well' };
  'well/complete': { wellId: string; reservoirIds?: string[] };
  'well/frac': { wellId: string; stages: number };
  'well/plugAbandon': { wellId: string };
  'well/setChoke': { wellId: string; choke: number };
  'well/setLift': { wellId: string; lift: LiftType };
  'well/shutIn': { wellId: string; shutIn: boolean };
  'well/convert': { wellId: string; purpose: WellPurpose };
  'well/rename': { wellId: string; name: string };
  'rig/skid': { rigId: string; x: number; z: number };
  // --- economy
  'market/sell': { commodity: string; quantity: number; source?: 'warehouse' | 'network' };
  'market/buy': { item: string; quantity: number };
  'market/setAutoSell': { commodity: string; enabled: boolean; minPrice: number; keepReserve: number };
  'market/hedge': { commodity: string; volume: number; days: number };
  'contract/accept': { contractId: string };
  'contract/abandon': { contractId: string };
  'worker/hire': { candidateId: string };
  'worker/fire': { workerId: string };
  'worker/assign': { workerId: string; buildingId: string | null };
  'worker/setAutoAssign': { enabled: boolean };
  'research/start': { techId: string };
  'research/queue': { techIds: string[] };
  'finance/takeLoan': { amount: number; termDays: number };
  'finance/repayLoan': { loanId: string; amount: number };
  'lease/buy': { px: number; pz: number };
  'lease/sell': { px: number; pz: number };
  'objective/claim': { objectiveId: string };
  'company/rename': { name: string };
}

export type CommandType = keyof CommandMap;
export type Command<K extends CommandType = CommandType> = { type: K; playerId?: string } & CommandMap[K];
export interface CommandResult<T = unknown> { ok: boolean; error?: string; data?: T }
export type CommandHandler<K extends CommandType> = (cmd: Command<K>, ctx: GameContext) => CommandResult;

export class CommandBus {
  private handlers = new Map<CommandType, CommandHandler<any>>();
  private ctx: GameContext | null = null;
  /** Hook for networking: when set, non-authority clients forward commands here instead of executing. */
  forward: ((cmd: Command) => void) | null = null;
  /** Observers (e.g. replay recorder, network host broadcast). */
  private observers = new Set<(cmd: Command, res: CommandResult) => void>();

  bind(ctx: GameContext) {
    this.ctx = ctx;
  }

  register<K extends CommandType>(type: K, handler: CommandHandler<K>): void {
    if (this.handlers.has(type)) console.warn(`[CommandBus] handler for ${type} replaced`);
    this.handlers.set(type, handler);
  }

  has(type: CommandType) {
    return this.handlers.has(type);
  }

  observe(fn: (cmd: Command, res: CommandResult) => void) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  dispatch<K extends CommandType>(cmd: Command<K>): CommandResult {
    const ctx = this.ctx;
    if (!ctx) return { ok: false, error: 'Game not running' };
    if (!cmd.playerId) cmd.playerId = ctx.localPlayerId;
    if (!ctx.isAuthority && this.forward) {
      this.forward(cmd as Command);
      return { ok: true };
    }
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      console.warn(`[CommandBus] no handler for ${cmd.type}`);
      return { ok: false, error: `Not available: ${cmd.type}` };
    }
    let res: CommandResult;
    try {
      res = handler(cmd, ctx);
    } catch (err) {
      console.error(`[CommandBus] ${cmd.type} failed`, err);
      res = { ok: false, error: String((err as Error)?.message ?? err) };
    }
    if (!res.ok && res.error) ctx.bus.emit('ui:error', { text: res.error });
    for (const o of this.observers) o(cmd as Command, res);
    return res;
  }

  clear() {
    this.handlers.clear();
    this.observers.clear();
  }
}
