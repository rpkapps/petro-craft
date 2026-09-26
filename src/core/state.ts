// Initial game-state factory and pure helpers shared by all systems.
import { DIFFICULTY_SETTINGS, INVENTORY_SLOTS, SAVE_VERSION, type Difficulty, type WorldSizeKey } from './constants';
import type { GameState, PlayerState, Vec3, DailyFinance, InventorySlot } from './types';
import { STARTING_TECHS, TECHS, type ModifierKey } from '../content/tech';
import { B, blockItemId } from './blocks';

export interface NewGameOptions {
  saveName: string;
  companyName: string;
  seed: number;
  worldSize: WorldSizeKey;
  difficulty: Difficulty;
  tutorial: boolean;
  hazards: boolean;
  creative: boolean;
}

export const emptyDaily = (day: number): DailyFinance => ({ day, revenue: 0, expenses: 0, byCategory: {}, production: {} });

export function createPlayer(id: string, name: string, spawn: Vec3): PlayerState {
  const inv: (InventorySlot | null)[] = new Array(INVENTORY_SLOTS).fill(null);
  const start: InventorySlot[] = [
    { item: 'tool:pickaxe', count: 1 },
    { item: 'tool:shovel', count: 1 },
    { item: 'tool:tablet', count: 1 },
    { item: 'tool:scanner', count: 1 },
    { item: 'tool:wrench', count: 1 },
    { item: 'tool:extinguisher', count: 1 },
    { item: blockItemId(B.PIPE_OIL), count: 64 },
    { item: blockItemId(B.PIPE_GAS), count: 64 },
    { item: blockItemId(B.CONCRETE), count: 64 },
    { item: 'tool:axe', count: 1 },
    { item: 'tool:detector', count: 1 },
    { item: blockItemId(B.PIPE_WATER), count: 64 },
    { item: blockItemId(B.PIPE_PRODUCT), count: 64 },
    { item: blockItemId(B.ASPHALT_ROAD), count: 64 },
    { item: blockItemId(B.LAMP), count: 16 },
  ];
  start.forEach((s, i) => (inv[i] = s));
  return {
    id, name, position: { ...spawn }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: -0.15, mode: 'walk', health: 100,
    inventory: inv, selectedSlot: 0, color: '#ff8a1f',
  };
}

export function createInitialState(opts: NewGameOptions, localPlayerId: string, spawn: Vec3): GameState {
  const diff = DIFFICULTY_SETTINGS[opts.difficulty];
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    meta: {
      saveName: opts.saveName, companyName: opts.companyName, seed: opts.seed, worldSize: opts.worldSize,
      difficulty: opts.difficulty, createdAt: now, lastSavedAt: now, playTimeSec: 0,
      rules: { hazards: opts.hazards, tutorial: opts.tutorial, creative: opts.creative },
    },
    time: { tick: 0, totalMinutes: 7 * 60, day: 1, minuteOfDay: 7 * 60, speed: 1, paused: false, startYear: 2026 },
    rngState: (opts.seed ^ 0x5bd1e995) | 0,
    company: {
      name: opts.companyName, money: diff.startMoney, reputation: 50, loans: [], warehouse: {},
      ledger: [], history: [], today: emptyDaily(1), autoSell: {}, color: '#ff8a1f',
    },
    players: { [localPlayerId]: createPlayer(localPlayerId, 'Player', spawn) },
    buildings: {},
    wells: {},
    reservoirs: {},
    surveys: {},
    networks: {},
    market: { prices: {}, history: {}, events: [], demand: {}, soldToday: {}, hedges: [] },
    contracts: { offers: [], active: [], completed: [] },
    workforce: { workers: [], candidates: [], lastRefreshDay: 0, autoAssign: true, housing: 0 },
    research: { completed: [...STARTING_TECHS], current: null, progress: 0, queue: [], pointsPerDay: 0, totalPoints: 0 },
    leases: {},
    environment: { score: 70, emissionsToday: 0, emissionsTotal: 0, flaredToday: 0, ventedToday: 0, spills: [], finesTotal: 0, carbonCredits: 0, violations: 0 },
    weather: { current: 'clear', intensity: 0, temperature: 18, windSpeed: 4, windDir: 0.6, cloudCover: 0.2, precipitation: 0, forecast: [], nextChangeMinute: 0, season: 'spring' },
    hazards: { fires: [], incidents: [], daysSinceIncident: 0 },
    power: { generation: 0, demand: 0, satisfaction: 1, gridImport: 0 },
    objectives: { list: [], chapter: 1, tutorialStep: 0, tutorialDone: !opts.tutorial, achievements: [] },
    notifications: [],
    stats: {
      totalOil: 0, totalGas: 0, totalWater: 0, totalRevenue: 0, totalExpenses: 0, wellsDrilled: 0, dryHoles: 0,
      blowouts: 0, fires: 0, blocksMined: 0, blocksPlaced: 0, peakOilRate: 0, companyValueHistory: [],
    },
    nextId: 1,
  };
}

// ---- Pure helpers ------------------------------------------------------------------------------------

export function hasTech(state: GameState, techId: string): boolean {
  return state.research.completed.includes(techId);
}

const modCache = new WeakMap<GameState, { n: number; mods: Map<ModifierKey, number> }>();
export function getModifier(state: GameState, key: ModifierKey): number {
  let c = modCache.get(state);
  if (!c || c.n !== state.research.completed.length) {
    const mods = new Map<ModifierKey, number>();
    for (const id of state.research.completed) {
      const t = TECHS[id];
      if (!t?.modifiers) continue;
      for (const [k, v] of Object.entries(t.modifiers)) mods.set(k as ModifierKey, (mods.get(k as ModifierKey) ?? 1) * (v as number));
    }
    c = { n: state.research.completed.length, mods };
    modCache.set(state, c);
  }
  return c.mods.get(key) ?? 1;
}

/** Game clock helpers. */
export const HOURS = (state: GameState) => Math.floor(state.time.minuteOfDay / 60);
export function formatGameDate(state: GameState): string {
  const d = new Date(Date.UTC(state.time.startYear, 3, 1));
  d.setUTCDate(d.getUTCDate() + state.time.day - 1);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function formatClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = Math.floor(minuteOfDay % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function formatMoney(v: number, digits = 1): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(digits)}k`;
  return `${s}$${a.toFixed(0)}`;
}
export function formatNumber(v: number, digits = 0): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(digits);
}
