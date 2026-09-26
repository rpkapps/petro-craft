// Mineral leases: the map is divided into PARCEL_SIZE² parcels. Prices hint at (but do not reveal)
// what lies beneath; known/surveyed ground is priced higher.
import type { GameContext, GameState, LeaseState, SurveyState } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { PARCEL_SIZE } from '../../core/constants';
import { hashFloat } from '../../core/rng';
import {
  LEASE_BASE_OFFSHORE, LEASE_BASE_ONSHORE, LEASE_MAX_ROYALTY, LEASE_MIN_ROYALTY, LEASE_RESALE_FRACTION, STARTING_LEASE_RADIUS,
} from './constants';
import { clamp01, fmtMoney } from './util';

export const leaseKey = (x: number, z: number) => `${Math.floor(x / PARCEL_SIZE)},${Math.floor(z / PARCEL_SIZE)}`;
export const parcelKey = (px: number, pz: number) => `${px},${pz}`;

export interface LeaseQuote { price: number; royalty: number; prospectivity: number }

export function parcelCount(ctx: GameContext): { nx: number; nz: number } {
  return { nx: Math.ceil(ctx.geology.sizeX / PARCEL_SIZE), nz: Math.ceil(ctx.geology.sizeZ / PARCEL_SIZE) };
}

export function parcelInBounds(ctx: GameContext, px: number, pz: number): boolean {
  const { nx, nz } = parcelCount(ctx);
  return Number.isInteger(px) && Number.isInteger(pz) && px >= 0 && pz >= 0 && px < nx && pz < nz;
}

function surveyTouches(sv: SurveyState, x0: number, z0: number, x1: number, z1: number): boolean {
  if (sv.kind === '3d') {
    const ax0 = Math.min(sv.x0, sv.x1), ax1 = Math.max(sv.x0, sv.x1), az0 = Math.min(sv.z0, sv.z1), az1 = Math.max(sv.z0, sv.z1);
    return ax0 < x1 && ax1 >= x0 && az0 < z1 && az1 >= z0;
  }
  const len = Math.hypot(sv.x1 - sv.x0, sv.z1 - sv.z0);
  const n = Math.max(1, Math.ceil(len / 4));
  for (let i = 0; i <= n; i++) {
    const x = sv.x0 + ((sv.x1 - sv.x0) * i) / n;
    const z = sv.z0 + ((sv.z1 - sv.z0) * i) / n;
    if (x >= x0 && x < x1 && z >= z0 && z < z1) return true;
  }
  return false;
}

/** Hidden truth: how much hydrocarbon lies under the parcel (0..1). */
function parcelTruth(ctx: GameContext, x0: number, z0: number, x1: number, z1: number): { truth: number; discovered: boolean } {
  let truth = 0;
  let discovered = false;
  const area = (x1 - x0) * (z1 - z0);
  for (const r of ctx.geology.reservoirs) {
    const ox = Math.min(x1, r.center.x + r.radiusX) - Math.max(x0, r.center.x - r.radiusX);
    const oz = Math.min(z1, r.center.z + r.radiusZ) - Math.max(z0, r.center.z - r.radiusZ);
    if (ox <= 0 || oz <= 0) continue;
    const frac = ((ox * oz) / area) * (Math.PI / 4);
    const boe = r.oilInPlace + r.gasInPlace / 6;
    const size = Math.min(1, Math.max(0.15, (Math.log10(Math.max(1, boe)) - 5.5) / 3.5));
    truth += frac * (0.4 + 0.6 * size);
    if (ctx.state.reservoirs[r.id]?.discovered) discovered = true;
  }
  return { truth: clamp01(truth * 1.25), discovered };
}

/** Quote for a parcel (deterministic; does not touch the RNG). */
export function computeLeaseQuote(ctx: GameContext, px: number, pz: number): LeaseQuote {
  if (!parcelInBounds(ctx, px, pz)) return { price: 0, royalty: LEASE_MIN_ROYALTY, prospectivity: 0 };
  const x0 = px * PARCEL_SIZE, z0 = pz * PARCEL_SIZE;
  const x1 = Math.min(ctx.geology.sizeX, x0 + PARCEL_SIZE), z1 = Math.min(ctx.geology.sizeZ, z0 + PARCEL_SIZE);
  const cx = Math.floor((x0 + x1) / 2), cz = Math.floor((z0 + z1) / 2);
  const offshore = ctx.geology.isOffshore(cx, cz);
  const { truth, discovered } = parcelTruth(ctx, x0, z0, x1, z1);
  let surveyed = false;
  for (const sv of Object.values(ctx.state.surveys)) {
    if (sv.status === 'complete' && surveyTouches(sv, x0, z0, x1, z1)) {
      surveyed = true;
      break;
    }
  }
  const known = discovered ? 1 : surveyed ? 0.5 : 0;
  const seed = ctx.geology.seed | 0;
  const noise = hashFloat(seed, px, pz, 77);
  const wTruth = 0.45 + 0.35 * known;
  const shown = clamp01(truth * wTruth + noise * (1 - wTruth) * 0.8);
  const base = offshore ? LEASE_BASE_OFFSHORE : LEASE_BASE_ONSHORE;
  const price = Math.round((base * (0.7 + 1.1 * shown) * (1 + 0.6 * known)) / 500) * 500;
  const royaltyRaw = LEASE_MIN_ROYALTY + (LEASE_MAX_ROYALTY - LEASE_MIN_ROYALTY) * clamp01(0.6 * shown + 0.4 * hashFloat(seed, px, pz, 91));
  const royalty = Math.round(royaltyRaw * 200) / 200;
  return { price, royalty, prospectivity: Math.round(shown * 100) / 100 };
}

/** Per-session memoised quoter (invalidated when surveys/discoveries/day change). */
export function createLeaseQuoter(getCtx: () => GameContext | null) {
  const cache = new Map<string, LeaseQuote>();
  let stamp = '';
  return (px: number, pz: number): LeaseQuote => {
    const ctx = getCtx();
    if (!ctx) return { price: 0, royalty: LEASE_MIN_ROYALTY, prospectivity: 0 };
    const s = ctx.state;
    let disc = 0;
    for (const id in s.reservoirs) if (s.reservoirs[id].discovered) disc++;
    let done = 0;
    for (const id in s.surveys) if (s.surveys[id].status === 'complete') done++;
    const st = `${s.meta.seed}|${disc}|${done}`;
    if (st !== stamp) {
      cache.clear();
      stamp = st;
    }
    const k = parcelKey(px, pz);
    let q = cache.get(k);
    if (!q) cache.set(k, (q = computeLeaseQuote(ctx, px, pz)));
    return q;
  };
}

/** New game: free leases on the parcels around the spawn. */
export function grantStartingLeases(ctx: GameContext, quote: (px: number, pz: number) => LeaseQuote) {
  const s = ctx.state;
  const p = s.players[ctx.localPlayerId] ?? Object.values(s.players)[0];
  if (!p) return;
  const cpx = Math.floor(p.position.x / PARCEL_SIZE);
  const cpz = Math.floor(p.position.z / PARCEL_SIZE);
  for (let dz = -STARTING_LEASE_RADIUS; dz <= STARTING_LEASE_RADIUS; dz++)
    for (let dx = -STARTING_LEASE_RADIUS; dx <= STARTING_LEASE_RADIUS; dx++) {
      const px = cpx + dx, pz = cpz + dz;
      if (!parcelInBounds(ctx, px, pz)) continue;
      const k = parcelKey(px, pz);
      if (s.leases[k]) continue;
      const q = quote(px, pz);
      s.leases[k] = { px, pz, owner: p.id, acquiredDay: s.time.day, price: 0, royalty: Math.min(q.royalty, 0.15) };
      ctx.bus.emit('lease:acquired', { key: k });
    }
}

/** Wells that still hold the lease (anything not plugged/dry). */
export function activeWellsOnParcel(s: GameState, px: number, pz: number): number {
  let n = 0;
  const k = parcelKey(px, pz);
  for (const w of Object.values(s.wells)) if (leaseKey(w.x, w.z) === k && w.status !== 'plugged' && w.status !== 'dry_hole') n++;
  return n;
}

export function ownsLeaseAt(s: GameState, x: number, z: number, playerId?: string): boolean {
  const l = s.leases[leaseKey(x, z)];
  return !!l && (!playerId || l.owner === playerId || !(l.owner in s.players));
}

export function cmdLeaseBuy(cmd: Command<'lease/buy'>, ctx: GameContext, quote: (px: number, pz: number) => LeaseQuote): CommandResult {
  const s = ctx.state;
  const { px, pz } = cmd;
  if (!parcelInBounds(ctx, px, pz)) return { ok: false, error: 'That parcel is outside the basin' };
  const k = parcelKey(px, pz);
  if (s.leases[k]) return { ok: false, error: s.leases[k].owner === cmd.playerId ? 'You already hold this lease' : 'Parcel already leased by someone else' };
  const q = quote(px, pz);
  if (!ctx.transact(-q.price, 'leases', `Lease bonus: parcel ${k}`, true)) return { ok: false, error: `Not enough money (${fmtMoney(q.price)})` };
  const lease: LeaseState = { px, pz, owner: cmd.playerId ?? ctx.localPlayerId, acquiredDay: s.time.day, price: q.price, royalty: q.royalty };
  s.leases[k] = lease;
  ctx.bus.emit('lease:acquired', { key: k });
  ctx.notify('success', 'Lease acquired', `Parcel ${k} for ${fmtMoney(q.price)} at a ${(q.royalty * 100).toFixed(1)}% royalty.`, { x: px * PARCEL_SIZE + PARCEL_SIZE / 2, y: 0, z: pz * PARCEL_SIZE + PARCEL_SIZE / 2 });
  return { ok: true, data: { key: k, price: q.price } };
}

export function cmdLeaseSell(cmd: Command<'lease/sell'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const k = parcelKey(cmd.px, cmd.pz);
  const l = s.leases[k];
  if (!l) return { ok: false, error: 'You do not hold that lease' };
  if (l.owner !== (cmd.playerId ?? ctx.localPlayerId)) return { ok: false, error: 'That lease belongs to someone else' };
  const wells = activeWellsOnParcel(s, cmd.px, cmd.pz);
  if (wells > 0) return { ok: false, error: `Plug and abandon the ${wells} active well${wells > 1 ? 's' : ''} on this parcel first` };
  const refund = Math.round(l.price * LEASE_RESALE_FRACTION);
  delete s.leases[k];
  if (refund > 0) ctx.transact(refund, 'leases', `Lease relinquished: parcel ${k}`);
  return { ok: true, data: { refund } };
}
