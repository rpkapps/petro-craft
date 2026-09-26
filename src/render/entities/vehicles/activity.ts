// Terminal loading activity for traffic: the economy publishes a smoothed sales utilisation
// (`b.data.salesUtil`, 0..1) on every selling terminal. Falls back to utilisation / live IO for saves
// or harnesses that do not carry it yet.
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';

export function salesActivity(b: BuildingState, v: BuildingView): number {
  if (!v.operational) return 0;
  const u = b.data?.salesUtil;
  if (typeof u === 'number' && Number.isFinite(u)) return Math.max(0, Math.min(1, u));
  if (v.status === 'active' && b.utilization > 0.02) return Math.min(1, b.utilization);
  for (const val of Object.values(b.io)) if (val < 0) return 0.5;
  return 0;
}
