// Research: points accrue continuously from the company office and staffed research labs; techs
// complete in order (current + queue). Partial progress is kept when switching projects.
import type { GameContext, GameState } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { TECHS } from '../../content/tech';
import { BUILDINGS } from '../../content/buildings';
import { crewFactor } from '../../core/buildingUtil';
import { RESEARCH_BASE_POINTS, RESEARCH_LAB_POINTS } from './constants';
import { economyState, type EconomyRuntime } from './ext';
import { isWorking } from './util';

export function prereqsMet(s: GameState, techId: string, extra: Iterable<string> = []): boolean {
  const t = TECHS[techId];
  if (!t) return false;
  const have = new Set([...s.research.completed, ...extra]);
  return t.requires.every((r) => have.has(r));
}

export function researchPointsPerDay(ctx: GameContext, rt: EconomyRuntime): number {
  const s = ctx.state;
  let pts = RESEARCH_BASE_POINTS;
  for (const b of rt.index.ofType(s, 'research_lab')) if (isWorking(b)) pts += RESEARCH_LAB_POINTS * crewFactor(s, b);
  return pts * ctx.modifier('research_speed');
}

function techName(id: string) {
  return TECHS[id]?.name ?? id;
}

function startTech(ctx: GameContext, id: string) {
  const s = ctx.state;
  const ext = economyState(s).research;
  if (s.research.current && s.research.current !== id) ext.partial[s.research.current] = s.research.progress;
  s.research.current = id;
  s.research.progress = ext.partial[id] ?? 0;
  delete ext.partial[id];
  if (ext.bank > 0) {
    s.research.progress += ext.bank;
    ext.bank = 0;
  }
  s.research.queue = s.research.queue.filter((q) => q !== id);
  ctx.bus.emit('research:started', { techId: id });
}

/** Pick the next queued tech whose prerequisites are met. */
function advanceQueue(ctx: GameContext) {
  const s = ctx.state;
  s.research.queue = s.research.queue.filter((q) => TECHS[q] && !s.research.completed.includes(q));
  const next = s.research.queue.find((q) => prereqsMet(s, q));
  if (next) startTech(ctx, next);
  else s.research.current = null;
}

function completeTech(ctx: GameContext, id: string) {
  const s = ctx.state;
  const t = TECHS[id];
  const overflow = Math.max(0, s.research.progress - (t?.cost ?? 0));
  if (!s.research.completed.includes(id)) s.research.completed.push(id);
  s.research.current = null;
  s.research.progress = 0;
  ctx.bus.emit('research:completed', { techId: id });
  const unlocks = (t?.unlocks ?? []).map((b) => BUILDINGS[b]?.name ?? b);
  const parts: string[] = [];
  if (unlocks.length) parts.push(`Unlocks: ${unlocks.join(', ')}.`);
  if (t?.features?.length && !unlocks.length) parts.push(t.description);
  ctx.notify('success', `Research complete: ${techName(id)}`, parts.join(' ') || t?.description);
  economyState(s).research.bank += overflow;
  advanceQueue(ctx);
}

export function tickResearch(ctx: GameContext, rt: EconomyRuntime, dt: number) {
  const s = ctx.state;
  const ppd = researchPointsPerDay(ctx, rt);
  s.research.pointsPerDay = ppd;
  const gain = ppd * dt;
  s.research.totalPoints += gain;
  if (!s.research.current) {
    if (s.research.queue.length) advanceQueue(ctx);
    if (!s.research.current) {
      // Nothing selected: bank a little so idle time isn't fully wasted (capped).
      const ext = economyState(s).research;
      ext.bank = Math.min(ext.bank + gain * 0.5, 60);
      return;
    }
  }
  const id = s.research.current!;
  const t = TECHS[id];
  if (!t || s.research.completed.includes(id)) {
    s.research.current = null;
    return;
  }
  s.research.progress += gain;
  if (s.research.progress >= t.cost) completeTech(ctx, id);
}

/** One-off research points (discoveries, surveys). */
export function grantResearch(ctx: GameContext, points: number) {
  const s = ctx.state;
  if (s.research.current) s.research.progress += points;
  else economyState(s).research.bank += points;
  s.research.totalPoints += points;
}

/** Research time estimate in days for a tech at the current rate. */
export function researchEta(s: GameState, techId: string): number {
  const t = TECHS[techId];
  if (!t) return Infinity;
  const done = s.research.current === techId ? s.research.progress : economyState(s).research.partial[techId] ?? 0;
  const ppd = Math.max(0.01, s.research.pointsPerDay || RESEARCH_BASE_POINTS);
  return Math.max(0, t.cost - done) / ppd;
}

export function cmdResearchStart(cmd: Command<'research/start'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const t = TECHS[cmd.techId];
  if (!t) return { ok: false, error: 'Unknown technology' };
  if (s.research.completed.includes(t.id)) return { ok: false, error: `${t.name} is already researched` };
  if (!prereqsMet(s, t.id)) {
    const missing = t.requires.filter((r) => !s.research.completed.includes(r)).map(techName);
    return { ok: false, error: `Requires ${missing.join(', ')}` };
  }
  if (s.research.current === t.id) return { ok: true };
  startTech(ctx, t.id);
  if (t.cost <= 0 || s.research.progress >= t.cost) completeTech(ctx, t.id);
  return { ok: true };
}

export function cmdResearchQueue(cmd: Command<'research/queue'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const planned = new Set<string>(s.research.current ? [s.research.current] : []);
  const queue: string[] = [];
  const rejected: string[] = [];
  for (const id of cmd.techIds ?? []) {
    if (!TECHS[id] || s.research.completed.includes(id) || planned.has(id)) continue;
    if (prereqsMet(s, id, planned)) {
      queue.push(id);
      planned.add(id);
    } else rejected.push(techName(id));
  }
  s.research.queue = queue;
  if (!s.research.current) advanceQueue(ctx);
  if (rejected.length && queue.length === 0) return { ok: false, error: `Prerequisites missing for ${rejected.join(', ')}` };
  return { ok: true, data: { queued: queue, rejected } };
}
