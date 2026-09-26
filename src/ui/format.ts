// Formatting helpers for the UI: money, quantities with unit conversion (imperial ↔ metric), dates.
import { formatClock, formatGameDate, formatMoney, formatNumber } from '../core/state';
import { FEET_PER_METER, METERS_PER_BLOCK } from '../core/constants';
import { ITEMS } from '../content/items';
import type { GameState } from '../core/types';

export { formatClock, formatGameDate, formatMoney, formatNumber };
export type Units = 'imperial' | 'metric';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BBL_TO_M3 = 0.158987;
export const MCF_TO_M3 = 28.3168;
export const PSI_TO_BAR = 0.0689476;
export const PPG_TO_SG = 1 / 8.345;

/** Integer with thousands separators. */
export function int(v: number): string {
  return Number.isFinite(v) ? nf0.format(Math.round(v)) : '—';
}
export function fixed(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return digits === 1 ? nf1.format(v) : digits === 2 ? nf2.format(v) : v.toFixed(digits);
}
/** Compact number: 12.3k, 4.5M. */
export function compact(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e4) return formatNumber(v, digits);
  if (a >= 100) return int(v);
  if (a >= 10) return v.toFixed(Math.min(digits, 1));
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.max(digits, a < 1 ? 2 : 1));
}

export function money(v: number, digits = 1): string {
  return Number.isFinite(v) ? formatMoney(v, digits) : '—';
}
export function moneyFull(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${v < 0 ? '-' : ''}$${nf0.format(Math.abs(Math.round(v)))}`;
}
export function signedMoney(v: number, digits = 1): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMoney(Math.abs(v), digits)}`;
}
/** Unit price with cents when small. */
export function price(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return `$${nf0.format(v)}`;
  if (a >= 100) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}
export function pct(v: number, digits = 0): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
}
export function signedPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
}

// ---- engineering units -------------------------------------------------------------------------
export function metersFromBlocks(blocks: number) {
  return blocks * METERS_PER_BLOCK;
}
/** Depth/length expressed in blocks → "8,530 ft" / "2,600 m". */
export function lengthBlocks(blocks: number, units: Units): string {
  const m = blocks * METERS_PER_BLOCK;
  return units === 'metric' ? `${int(m)} m` : `${int(m * FEET_PER_METER)} ft`;
}
export function lengthValue(blocks: number, units: Units): number {
  const m = blocks * METERS_PER_BLOCK;
  return units === 'metric' ? m : m * FEET_PER_METER;
}
export const lengthUnit = (units: Units) => (units === 'metric' ? 'm' : 'ft');
/** Depth below a surface elevation (both block y). */
export function depth(surfaceY: number, y: number, units: Units): string {
  return lengthBlocks(Math.max(0, surfaceY - y), units);
}

/** Convert a quantity in its native unit to display units. */
export function convertQty(qty: number, unit: string, units: Units): { v: number; unit: string } {
  if (units === 'metric') {
    if (unit === 'bbl') return { v: qty * BBL_TO_M3, unit: 'm³' };
    if (unit === 'mcf') return { v: qty * MCF_TO_M3, unit: 'm³' };
  }
  return { v: qty, unit };
}
export function qty(v: number, unit: string, units: Units, digits = 0): string {
  const c = convertQty(v, unit, units);
  return `${compact(c.v, digits)} ${c.unit}`;
}
export function itemUnit(itemId: string, units: Units): string {
  return convertQty(1, ITEMS[itemId]?.unit ?? 'u', units).unit;
}
export function itemQty(itemId: string, v: number, units: Units, digits = 0): string {
  return qty(v, ITEMS[itemId]?.unit ?? '', units, digits);
}
export function itemRate(itemId: string, v: number, units: Units): string {
  return `${itemQty(itemId, v, units)}/d`;
}
export function oilRate(bpd: number, units: Units) {
  return `${compact(convertQty(bpd, 'bbl', units).v)} ${units === 'metric' ? 'm³/d' : 'bbl/d'}`;
}
export function gasRate(mcfd: number, units: Units) {
  return `${compact(convertQty(mcfd, 'mcf', units).v)} ${units === 'metric' ? 'm³/d' : 'mcf/d'}`;
}
/** Price per display unit, e.g. "$72.40/bbl" or "$455/m³". */
export function unitPrice(itemId: string, p: number, units: Units): string {
  const unit = ITEMS[itemId]?.unit ?? 'u';
  const c = convertQty(1, unit, units);
  return `${price(p / c.v)}/${c.unit}`;
}
export function mudWeight(ppg: number, units: Units): string {
  return units === 'metric' ? `${(ppg * PPG_TO_SG).toFixed(2)} SG` : `${ppg.toFixed(1)} ppg`;
}
export function pressure(psi: number, units: Units): string {
  return units === 'metric' ? `${int(psi * PSI_TO_BAR)} bar` : `${int(psi)} psi`;
}
export function temperature(c: number, units: Units): string {
  return units === 'metric' ? `${Math.round(c)}°C` : `${Math.round(c * 1.8 + 32)}°F`;
}
export function windSpeed(ms: number, units: Units): string {
  return units === 'metric' ? `${Math.round(ms)} m/s` : `${Math.round(ms * 2.23694)} mph`;
}
export function power(mw: number): string {
  return `${Math.abs(mw) >= 100 ? int(mw) : mw.toFixed(1)} MW`;
}

// ---- time --------------------------------------------------------------------------------------
export function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
}
export function timeAgo(epochMs: number): string {
  const d = (Date.now() - epochMs) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function daysLeft(n: number): string {
  if (n < 0) return 'overdue';
  if (n < 1) return `${Math.max(1, Math.round(n * 24))} h`;
  return `${Math.ceil(n)} d`;
}
/** Short date for game day N ("Apr 12"). */
export function dayLabel(state: GameState, day: number, withYear = false): string {
  const d = new Date(Date.UTC(state.time.startYear, 3, 1));
  d.setUTCDate(d.getUTCDate() + day - 1);
  return d.toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function gameDateTime(state: GameState): string {
  return `${formatGameDate(state)} · ${formatClock(state.time.minuteOfDay)}`;
}

// ---- text --------------------------------------------------------------------------------------
export function titleCase(id: string): string {
  return id
    .replace(/^tool:|^block:/, '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out || String(n);
}
export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${int(n)} ${n === 1 ? word : pluralWord}`;
}
/** Human readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const map: Record<string, string> = {
    Escape: 'Esc', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'Alt', AltRight: 'R-Alt', Backquote: '`', Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps', MetaLeft: 'Meta',
  };
  return map[code] ?? code;
}

/** "Q drop · Ctrl+Q drop stack" for the current keybinds. */
export function dropHint(keybinds: Record<string, string>): string {
  const k = keyLabel(keybinds.drop);
  return `${k} drop · Ctrl+${k} drop stack`;
}
