// Shared rig dimensions used by the models and the FX (mud spray from the rig floor, blowouts).

/** Drill-floor height above the building origin (offshore: above sea level) per rig type. */
export const RIG_FLOOR: Record<string, number> = {
  drilling_rig_land: 2.6,
  drilling_rig_heavy: 3.6,
  jackup_rig: 9.2,
  semi_sub_rig: 10.2,
};

/** Travelling-block travel range [min, max] above the drill floor per rig type. */
export const RIG_TRAVEL: Record<string, [number, number]> = {
  drilling_rig_land: [1.2, 11.2],
  drilling_rig_heavy: [1.4, 15.8],
  jackup_rig: [1.2, 10.4],
  semi_sub_rig: [1.2, 11.2],
};

/** Well statuses in which a rig counts as working on its well. */
export const RIG_BUSY = new Set(['drilling', 'tripping', 'casing', 'kick', 'blowout', 'completing', 'fracking']);
