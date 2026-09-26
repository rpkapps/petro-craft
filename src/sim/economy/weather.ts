// Weather: seasons, a planned sequence of weather spans (so forecasts are truthful), smoothly
// eased continuous variables for visuals, lightning strikes that can ignite tall structures.
import type { BuildingState, GameContext, GameState, WeatherKind } from '../../core/types';
import { BUILDINGS } from '../../content/buildings';
import { buildingCenter } from '../../core/buildingUtil';
import { DAYS_PER_YEAR, type Season } from './constants';
import { economyState, type EconomyRuntime, type WeatherSpan } from './ext';
import { MARKET_EVENT_BY_ID } from './marketEvents';
import { startMarketEvent } from './market';
import { chance, dayOfSeason, dayOfYear, difficulty, gauss, isWorking, ouStep, rand, randInt, seasonOfDay, weightedPick } from './util';

const KINDS: WeatherKind[] = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'heatwave', 'hurricane'];

const SEASON_WEIGHTS: Record<Season, Partial<Record<WeatherKind, number>>> = {
  spring: { clear: 3, cloudy: 3, overcast: 2, rain: 3, storm: 0.6, fog: 1.2 },
  summer: { clear: 5, cloudy: 3, overcast: 1, rain: 1.5, storm: 1.1, heatwave: 0.7, hurricane: 0.15 },
  autumn: { clear: 2.5, cloudy: 3, overcast: 3, rain: 3, storm: 0.6, fog: 2, hurricane: 0.15, snow: 0.4 },
  winter: { clear: 2.5, cloudy: 2.5, overcast: 3, snow: 3, blizzard: 0.5, fog: 1.5, rain: 0.6 },
};

const DURATION_HOURS: Record<WeatherKind, [number, number]> = {
  clear: [8, 30], cloudy: [6, 20], overcast: [6, 18], rain: [3, 12], storm: [2, 6], snow: [6, 20], blizzard: [6, 18],
  fog: [2, 5], heatwave: [48, 96], hurricane: [24, 72],
};

const INTENSITY: Record<WeatherKind, [number, number]> = {
  clear: [0, 0], cloudy: [0.3, 0.5], overcast: [0.4, 0.7], rain: [0.3, 1], storm: [0.6, 1], snow: [0.4, 1], blizzard: [0.7, 1],
  fog: [0.4, 0.9], heatwave: [0.5, 1], hurricane: [0.85, 1],
};

const SEVERE = new Set<WeatherKind>(['storm', 'blizzard', 'hurricane']);
/** Forecast "headline" weight: severe weather dominates a day even if brief. */
const SEVERITY: Record<WeatherKind, number> = { clear: 0, cloudy: 0, overcast: 0.1, fog: 0.2, rain: 0.5, snow: 0.5, heatwave: 0.6, storm: 2, blizzard: 2, hurricane: 5 };

const TEMP_OFFSET: Record<WeatherKind, number> = { clear: 0.5, cloudy: 0, overcast: -1.5, rain: -3, storm: -5, snow: -2, blizzard: -6, fog: -1, heatwave: 9, hurricane: -3 };
const WIND: Record<WeatherKind, number> = { clear: 3, cloudy: 5, overcast: 6, rain: 8, storm: 16, snow: 7, blizzard: 17, fog: 1.5, heatwave: 3, hurricane: 38 };
const CLOUD: Record<WeatherKind, number> = { clear: 0.08, cloudy: 0.45, overcast: 0.85, rain: 0.92, storm: 1, snow: 0.9, blizzard: 1, fog: 0.7, heatwave: 0.03, hurricane: 1 };
const PRECIP: Record<WeatherKind, number> = { clear: 0, cloudy: 0, overcast: 0, rain: 0.65, storm: 0.95, snow: 0.6, blizzard: 1, fog: 0, heatwave: 0, hurricane: 1 };

/** Season mean temperatures (°C) at the centre of each season. */
const SEASON_TEMP: Record<Season, number> = { spring: 15, summer: 26, autumn: 12, winter: -2 };
const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear', cloudy: 'Partly cloudy', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', blizzard: 'Blizzard',
  fog: 'Fog', heatwave: 'Heatwave', hurricane: 'Hurricane',
};

/** Smooth seasonal mean temperature for a fractional day of year (0..120). */
export function seasonalMeanTemp(doy: number): number {
  const pos = (((doy - 15) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR; // 0 at spring centre
  const i = Math.floor(pos / 30);
  const f = (pos - i * 30) / 30;
  const a = SEASON_TEMP[SEASON_ORDER[i % 4]];
  const b = SEASON_TEMP[SEASON_ORDER[(i + 1) % 4]];
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

const minuteToDay = (m: number) => 1 + Math.floor(m / 1440);

function allowed(kind: WeatherKind, startMinute: number, prev: WeatherKind | null, ext: { lastHurricaneDay: number }): boolean {
  const day = minuteToDay(startMinute);
  const season = seasonOfDay(day);
  const ds = dayOfSeason(day);
  const hour = (startMinute % 1440) / 60;
  if (prev && kind === prev && kind !== 'clear' && kind !== 'cloudy') return false;
  if (prev && SEVERE.has(prev) && SEVERE.has(kind)) return false;
  switch (kind) {
    case 'fog':
      return hour >= 3 && hour < 8;
    case 'hurricane':
      return ((season === 'summer' && ds >= 15) || (season === 'autumn' && ds < 20)) && day - ext.lastHurricaneDay >= 25;
    case 'snow':
      return season === 'winter' || (season === 'autumn' && ds >= 20);
    case 'heatwave':
      return season === 'summer' && prev !== 'heatwave';
    default:
      return true;
  }
}

function nextSpan(ctx: GameContext, start: number, prev: WeatherKind | null): WeatherSpan {
  const ext = economyState(ctx.state).weather;
  const season = seasonOfDay(minuteToDay(start));
  const w = SEASON_WEIGHTS[season];
  const kind = weightedPick(ctx, KINDS, (k) => (allowed(k, start, prev, ext) ? w[k] ?? 0 : 0)) ?? 'cloudy';
  const [h0, h1] = DURATION_HOURS[kind];
  const hours = rand(ctx, h0, h1);
  const [i0, i1] = INTENSITY[kind];
  if (kind === 'hurricane') ext.lastHurricaneDay = minuteToDay(start);
  return { kind, start, end: start + hours * 60, intensity: rand(ctx, i0, i1) };
}

/** Keep the plan covering at least 8 days ahead. */
function ensurePlan(ctx: GameContext) {
  const s = ctx.state;
  const plan = economyState(s).weather.plan;
  const now = s.time.totalMinutes;
  while (plan.length > 1 && plan[0].end <= now) plan.shift();
  if (plan.length === 0) plan.push(nextSpan(ctx, now, null));
  while (plan[plan.length - 1].end < now + 8 * 1440) {
    const last = plan[plan.length - 1];
    plan.push(nextSpan(ctx, last.end, last.kind));
  }
}

// ---- Forecast -------------------------------------------------------------------------------------

export function forecastDays(ctx: GameContext, rt: EconomyRuntime): number {
  return rt.index.count(ctx.state, 'weather_station', isWorking) > 0 ? 7 : 3;
}

function updateForecast(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  const ext = economyState(s).weather;
  const n = forecastDays(ctx, rt);
  ext.forecastDays = n;
  const out: GameState['weather']['forecast'] = [];
  for (let d = s.time.day; d < s.time.day + n; d++) {
    const d0 = (d - 1) * 1440;
    const d1 = d0 + 1440;
    let best: WeatherKind = 'clear';
    let bestScore = -1;
    let wind = 0;
    for (const sp of ext.plan) {
      const ov = Math.min(d1, sp.end) - Math.max(d0, sp.start);
      if (ov <= 0) continue;
      const score = ov * (1 + SEVERITY[sp.kind] * (ov >= 60 ? 1 : 0));
      if (score > bestScore) {
        bestScore = score;
        best = sp.kind;
      }
      wind = Math.max(wind, WIND[sp.kind] * (0.6 + 0.4 * sp.intensity));
    }
    const mean = seasonalMeanTemp(dayOfYear(d) + 0.5) + TEMP_OFFSET[best] + ext.tempAnomaly * Math.exp(-0.3 * (d - s.time.day));
    const amp = best === 'clear' || best === 'heatwave' ? 7 : best === 'overcast' || best === 'rain' || best === 'storm' ? 3 : 5;
    out.push({ day: d, kind: best, tempHigh: Math.round(mean + amp), tempLow: Math.round(mean - amp), wind: Math.round(wind) });
  }
  s.weather.forecast = out;
}

// ---- Tick -----------------------------------------------------------------------------------------

function targetTemp(s: GameState, kind: WeatherKind, intensity: number, anomaly: number): number {
  const doy = dayOfYear(s.time.day) + s.time.minuteOfDay / 1440;
  const hour = s.time.minuteOfDay / 60;
  const amp = kind === 'clear' || kind === 'heatwave' ? 7 : kind === 'cloudy' || kind === 'fog' ? 5 : 3;
  return seasonalMeanTemp(doy) + TEMP_OFFSET[kind] * (0.5 + 0.5 * intensity) + amp * Math.cos((2 * Math.PI * (hour - 15)) / 24) + anomaly;
}

export function initWeather(ctx: GameContext, rt: EconomyRuntime, isNew: boolean) {
  const s = ctx.state;
  const ext = economyState(s).weather;
  const w = s.weather;
  w.season = seasonOfDay(s.time.day);
  if (isNew || ext.plan.length === 0) {
    ext.plan = [];
    const now = s.time.totalMinutes;
    // A pleasant first day to get oriented.
    ext.plan.push({ kind: 'clear', start: now, end: now + randInt(ctx, 18, 30) * 60, intensity: 0 });
    ensurePlan(ctx);
    const sp = ext.plan[0];
    w.current = sp.kind;
    w.intensity = sp.intensity;
    w.temperature = targetTemp(s, sp.kind, sp.intensity, ext.tempAnomaly);
    w.windSpeed = WIND[sp.kind];
    w.cloudCover = CLOUD[sp.kind];
    w.precipitation = 0;
    w.nextChangeMinute = sp.end;
  } else ensurePlan(ctx);
  updateForecast(ctx, rt);
}

export function tickWeather(ctx: GameContext, rt: EconomyRuntime, stepMinutes: number, newHour: boolean) {
  const s = ctx.state;
  const ext = economyState(s).weather;
  const w = s.weather;
  const dt = stepMinutes / 1440;
  ensurePlan(ctx);
  const now = s.time.totalMinutes;
  const sp = ext.plan[0];
  w.season = seasonOfDay(s.time.day);
  if (sp.kind !== w.current) changeWeather(ctx, sp);
  w.nextChangeMinute = sp.end;

  // Smooth continuous variables (eased toward targets; rates in game hours).
  const ease = (hours: number) => 1 - Math.exp(-stepMinutes / (60 * hours));
  const fadeOut = sp.end - now < 45 ? (sp.end - now) / 45 : 1; // soften the tail into the next span
  const intensity = sp.intensity * Math.max(0, fadeOut);
  w.intensity += (intensity - w.intensity) * ease(0.75);
  ext.tempAnomaly = ouStep(ext.tempAnomaly, 0, 0.3, 1.5, dt, gauss(ctx));
  w.temperature += (targetTemp(s, w.current, w.intensity, ext.tempAnomaly) - w.temperature) * ease(1);
  const windTarget = WIND[w.current] * (0.6 + 0.4 * w.intensity);
  w.windSpeed = Math.max(0, ouStep(w.windSpeed, windTarget, 6, SEVERE.has(w.current) ? 8 : 3, dt, gauss(ctx)));
  w.windDir = (w.windDir + gauss(ctx) * Math.sqrt(dt) * (SEVERE.has(w.current) ? 1.6 : 0.6) + Math.PI * 2) % (Math.PI * 2);
  w.cloudCover += (CLOUD[w.current] * (w.current === 'clear' ? 1 : 0.7 + 0.3 * w.intensity) - w.cloudCover) * ease(1.5);
  w.precipitation += (PRECIP[w.current] * w.intensity - w.precipitation) * ease(0.5);

  if (newHour) {
    updateForecast(ctx, rt);
    warnAhead(ctx, rt);
  }
  if ((w.current === 'storm' || w.current === 'hurricane') && w.precipitation > 0.3) lightning(ctx, rt, stepMinutes);
}

function changeWeather(ctx: GameContext, sp: WeatherSpan) {
  const s = ctx.state;
  const kind = sp.kind;
  // Storms/blizzards the weather station already warned about start quietly.
  const prewarned = !!economyState(s).weather.warned[`${kind}@${Math.round(sp.start)}`];
  if (s.weather.current === 'hurricane') {
    const c = economyState(s).objectives.counters;
    c.hurricanes = (c.hurricanes ?? 0) + 1;
  }
  s.weather.current = kind;
  ctx.bus.emit('weather:changed', { kind });
  if (kind === 'storm' && !prewarned) ctx.notify('warning', 'Thunderstorm', 'Lightning is striking the field. Tall structures — rigs, flare stacks, turbines — may catch fire.');
  else if (kind === 'blizzard' && !prewarned) ctx.notify('warning', 'Blizzard', 'Whiteout conditions and freezing temperatures. Crews tire quickly.');
  else if (kind === 'hurricane') {
    ctx.notify('danger', 'Hurricane landfall', 'Hurricane-force winds and torrential rain. Offshore operations are at severe risk.');
    const def = MARKET_EVENT_BY_ID.gulf_hurricane;
    if (def && !s.market.events.some((e) => e.id.startsWith('gulf_hurricane:'))) startMarketEvent(ctx, def, s.time.day);
  } else if (kind === 'heatwave') ctx.notify('info', 'Heatwave', 'Scorching temperatures for days. Crews tire faster in the heat.');
}

function warnAhead(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  const ext = economyState(s).weather;
  const now = s.time.totalMinutes;
  const station = rt.index.count(s, 'weather_station', isWorking) > 0;
  for (const sp of ext.plan) {
    if (sp.start <= now) continue;
    const key = `${sp.kind}@${Math.round(sp.start)}`;
    if (ext.warned[key]) continue;
    const hoursAhead = (sp.start - now) / 60;
    if (sp.kind === 'hurricane' && hoursAhead <= 48) {
      ext.warned[key] = true;
      ctx.notify('danger', 'Hurricane warning', `A hurricane is forecast to make landfall in about ${Math.round(hoursAhead)} hours. Secure offshore assets and fill storage.`);
    } else if (station && (sp.kind === 'storm' || sp.kind === 'blizzard') && hoursAhead <= 6) {
      ext.warned[key] = true;
      ctx.notify('warning', `${sp.kind === 'storm' ? 'Storm' : 'Blizzard'} approaching`, `The weather station expects ${sp.kind === 'storm' ? 'a thunderstorm' : 'a blizzard'} in about ${Math.max(1, Math.round(hoursAhead))} hours.`);
    }
  }
  // Forget old warnings.
  for (const k of Object.keys(ext.warned)) {
    const t = Number(k.split('@')[1]);
    if (t < now - 1440) delete ext.warned[k];
  }
}

// ---- Lightning ------------------------------------------------------------------------------------

function tallStructures(s: GameState, rt: EconomyRuntime): BuildingState[] {
  return rt.index.all(s).filter((b) => b.size[2] >= 10 && b.status !== 'destroyed' && b.constructionProgress > 0.3);
}

function lightning(ctx: GameContext, rt: EconomyRuntime, stepMinutes: number) {
  const s = ctx.state;
  const w = s.weather;
  const perHour = (w.current === 'hurricane' ? 1.5 : 4) * w.intensity;
  if (!chance(ctx, Math.min(0.9, (perHour * stepMinutes) / 60))) return;
  economyState(s).weather.strikes++;
  const tall = tallStructures(s, rt);
  if (tall.length && chance(ctx, 0.45)) {
    const b = weightedPick(ctx, tall, (t) => t.size[2] * t.size[2])!;
    const c = buildingCenter(b);
    ctx.bus.emit('weather:lightning', { x: c.x, z: c.z });
    maybeIgnite(ctx, b);
    return;
  }
  const p = s.players[ctx.localPlayerId] ?? Object.values(s.players)[0];
  const cx = p ? p.position.x : ctx.geology.sizeX / 2;
  const cz = p ? p.position.z : ctx.geology.sizeZ / 2;
  const ang = rand(ctx, 0, Math.PI * 2);
  const dist = rand(ctx, 20, 140);
  const x = Math.max(0, Math.min(ctx.geology.sizeX - 1, cx + Math.cos(ang) * dist));
  const z = Math.max(0, Math.min(ctx.geology.sizeZ - 1, cz + Math.sin(ang) * dist));
  ctx.bus.emit('weather:lightning', { x, z });
}

function maybeIgnite(ctx: GameContext, b: BuildingState) {
  const s = ctx.state;
  if (!s.meta.rules.hazards) return;
  if (b.status === 'fire' || b.status === 'destroyed' || b.constructionProgress < 1) return;
  const flam = BUILDINGS[b.type]?.flammability ?? 0.3;
  if (!chance(ctx, 0.08 * flam * difficulty(s).hazardRate)) return;
  const c = buildingCenter(b);
  const x = Math.floor(c.x), y = b.y + b.size[2] - 1, z = Math.floor(c.z);
  const fire = { id: ctx.newId('fire'), x, y, z, intensity: 0.3, buildingId: b.id, startedMinute: s.time.totalMinutes, spreadTimer: 0 };
  s.hazards.fires.push(fire);
  const prev = b.status;
  b.status = 'fire';
  b.fire = Math.max(b.fire, 0.3);
  s.stats.fires++;
  const name = BUILDINGS[b.type]?.name ?? b.type;
  s.hazards.incidents.push({ day: s.time.day, kind: 'fire', text: `Lightning set the ${name} on fire`, x, z });
  ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: 'fire' });
  ctx.bus.emit('hazard:fireStarted', { id: fire.id, x, y, z });
  ctx.notify('danger', 'Lightning fire!', `Lightning struck the ${name} and started a fire.`, { x, y, z });
}

export function weatherNewDay(ctx: GameContext, day: number) {
  if (dayOfSeason(day) === 0) {
    const season = seasonOfDay(day);
    const text: Record<Season, string> = {
      spring: 'Thawing ground and spring rains. Fertilizer demand picks up.',
      summer: 'Long days, thunderstorms and the driving season. Hurricanes are possible late in the season.',
      autumn: 'Cooler days and morning fog. Hurricane season peaks early in autumn.',
      winter: 'Snow, blizzards and a winter premium on gas and heating fuels.',
    };
    ctx.notify('info', `${season[0].toUpperCase()}${season.slice(1)} has arrived`, text[season]);
  }
}
