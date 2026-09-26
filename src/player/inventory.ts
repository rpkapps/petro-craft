// Pure inventory operations on PlayerState.inventory (36 slots, 0..8 hotbar, null = empty).
import type { InventorySlot } from '../core/types';
import { maxStack } from './blockUtil';

export type Inventory = (InventorySlot | null)[];

/** Total count of an item across all slots. */
export function countItem(inv: Inventory, item: string): number {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.count;
  return n;
}

/**
 * Add items: first merge into existing stacks (up to the stack limit), then fill empty slots.
 * Returns the number of items that did not fit.
 */
export function addItem(inv: Inventory, item: string, count: number): number {
  const max = maxStack(item);
  let left = Math.max(0, Math.floor(count));
  for (let i = 0; i < inv.length && left > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && s.count < max) {
      const n = Math.min(left, max - s.count);
      s.count += n;
      left -= n;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const n = Math.min(left, max);
      inv[i] = { item, count: n };
      left -= n;
    }
  }
  return left;
}

/** Remove up to `count` items (preferring `preferSlot` first, then the last stacks). Returns the number removed. */
export function removeItem(inv: Inventory, item: string, count: number, preferSlot = -1): number {
  let left = Math.max(0, Math.floor(count));
  const take = (i: number) => {
    const s = inv[i];
    if (!s || s.item !== item || left <= 0) return;
    const n = Math.min(left, s.count);
    s.count -= n;
    left -= n;
    if (s.count <= 0) inv[i] = null;
  };
  if (preferSlot >= 0 && preferSlot < inv.length) take(preferSlot);
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) take(i);
  return count - left;
}

/** Move/merge/swap between two slots. Returns false if indices are invalid. */
export function moveItem(inv: Inventory, from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || to < 0 || from >= inv.length || to >= inv.length) return false;
  if (from === to) return true;
  const a = inv[from];
  const b = inv[to];
  if (!a) return true;
  if (b && b.item === a.item) {
    const max = maxStack(a.item);
    const n = Math.min(a.count, max - b.count);
    if (n > 0) {
      b.count += n;
      a.count -= n;
      if (a.count <= 0) inv[from] = null;
      return true;
    }
  }
  inv[from] = b ?? null;
  inv[to] = a;
  return true;
}

/** Normalise an inventory loaded from a save: fixed length, drop invalid/empty stacks. */
export function normaliseInventory(inv: unknown, size: number): Inventory {
  const out: Inventory = new Array(size).fill(null);
  if (!Array.isArray(inv)) return out;
  for (let i = 0; i < size && i < inv.length; i++) {
    const s = inv[i] as InventorySlot | null;
    if (s && typeof s.item === 'string' && typeof s.count === 'number' && s.count > 0) out[i] = { item: s.item, count: Math.floor(s.count) };
  }
  return out;
}
