// Logistics: truck loading rack, rail terminal, marine export terminal (jetty toward the water).
import { SEA_LEVEL } from '../../../core/constants';
import type { BuildingState, GameContext } from '../../../core/types';
import type { Builder } from '../geom/Builder';
import { ladder, lampPost, latticeLeg, platform, railing, shed, stairs, tank } from '../geom/parts';
import { C } from '../palette';
import type { ModelDef } from './types';

/** Top-loading arm (riser, swivel arm, drop tube) at (x,z) reaching toward +z by `reach`. */
function loadingArm(b: Builder, x: number, y0: number, z: number, reach: number, h: number): void {
  b.cyl(x, y0, z, 0.07, h, C.STEEL, 'metal', 6);
  b.pipe([x, y0 + h, z], [x, y0 + h - 0.1, z + reach], 0.06, C.STEEL_LIGHT, 'metal', 6);
  b.pipe([x, y0 + h - 0.1, z + reach], [x, y0 + h - 1.0, z + reach], 0.06, C.STEEL_LIGHT, 'metal', 6);
  b.box(x, y0 + h - 1.05, z + reach, 0.14, 0.1, 0.14, C.HAZARD, 'paint');
  b.box(x, y0 + h + 0.08, z, 0.12, 0.16, 0.12, C.HAZARD, 'paint');
}

const truck_terminal: ModelDef = {
  build(b) {
    // two drive-through lanes along x (z = ±1.1) and a central loading island
    b.slab(-2.98, 0, -1.98, 2.98, 0.05, 1.98, C.ASPHALT, 'rough');
    b.at(0, 0, 0, 0, () => {
      for (const z of [-1.1, 1.1]) for (let x = -2.6; x < 2.8; x += 1.0) b.slab(x, 0.05, z - 0.03, x + 0.5, 0.06, z + 0.03, C.WHITE, 'paint');
      for (const z of [-1.95, -0.25, 0.25, 1.95]) b.slab(-2.95, 0.05, z - 0.03, 2.95, 0.06, z + 0.03, C.HAZARD, 'paint');
    });
    b.slab(-2.8, 0.05, -0.22, 2.8, 0.25, 0.22, C.CONCRETE, 'rough');
    // gantry columns & canopy
    for (const x of [-2.4, 0, 2.4]) {
      b.box(x, 1.8, 0, 0.2, 3.5, 0.2, C.STEEL_DARK, 'paint');
      b.slab(x - 0.08, 3.45, -1.9, x + 0.08, 3.6, 1.9, C.STEEL_DARK, 'paint');
    }
    b.slab(-2.98, 3.6, -1.98, 2.98, 3.72, 1.98, C.STEEL_LIGHT, 'metal');
    b.slab(-3.0, 3.35, -2.0, 3.0, 3.6, -1.9, b.company, 'paint');
    b.slab(-3.0, 3.35, 1.9, 3.0, 3.6, 2.0, b.company, 'paint');
    // loading platform on the island with stairs
    platform(b, -1.8, -0.35, 1.8, 0.35, 2.1, C.STEEL_DARK, true);
    stairs(b, -2.9, 0.25, 0, 0, 1.85, 0.6);
    for (const x of [-1.2, 1.2]) {
      loadingArm(b, x, 2.1, -0.2, -0.9, 0.9);
      loadingArm(b, x, 2.1, 0.2, 0.9, 0.9);
    }
    b.pipe([-2.4, 3.2, 0], [2.4, 3.2, 0], 0.1, C.CRUDE_PIPE, 'metal', 8);
    b.pipe([-2.4, 3.0, 0.15], [2.4, 3.0, 0.15], 0.08, C.AMBER, 'metal', 8);
    // canopy lights
    for (const x of [-1.8, 0, 1.8]) for (const z of [-1.1, 1.1]) b.box(x, 3.55, z, 0.5, 0.05, 0.2, C.LAMP_WHITE, 'lamp');
    b.anchor('light', 0, 3.2, -1.1, { intensity: 1, range: 10 });
    b.anchor('light', 0, 3.2, 1.1, { intensity: 1, range: 10 });
    // control booth at the +x end of the island
    b.slab(2.3, 0.25, -0.2, 2.9, 1.9, 0.2, C.CREAM, 'paint');
    b.box(2.29, 1.3, 0, 0.02, 0.4, 0.3, C.GLASS, 'glass');
    // bays for the traffic system: truck centre + a point ahead along the lane
    for (const [i, z] of [-1.1, 1.1].entries()) {
      b.anchor('bay', 0, 0, z, { i });
      b.anchor('bayDir', 1, 0, z, { i });
    }
  },
};

const rail_terminal: ModelDef = {
  build(b) {
    const tz = -1.2;
    // ballast, sleepers & rails along x (extended by the traffic system beyond the footprint)
    b.slab(-6.98, 0, tz - 1.0, 6.98, 0.12, tz + 1.0, C.GRAVEL, 'rough');
    b.detail(() => {
      for (let x = -6.8; x < 7; x += 0.55) b.box(x, 0.16, tz, 0.22, 0.08, 1.5, C.WOOD, 'rough');
    });
    for (const s of [-0.55, 0.55]) b.slab(-6.98, 0.2, tz + s - 0.05, 6.98, 0.3, tz + s + 0.05, C.STEEL, 'metal');
    // elevated loading rack with arms over the track
    for (let x = -6; x <= 6; x += 2) {
      b.box(x, 1.2, 0.1, 0.16, 2.4, 0.16, C.STEEL_DARK, 'paint');
      b.box(x, 1.2, 0.9, 0.16, 2.4, 0.16, C.STEEL_DARK, 'paint');
      b.box(x, 3.4, 0.5, 0.14, 2.0, 0.14, C.STEEL_DARK, 'paint');
    }
    platform(b, -6.3, -0.05, 6.3, 1.05, 2.4, C.STEEL_DARK, true);
    b.slab(-6.4, 4.4, -0.8, 6.4, 4.5, 1.3, C.STEEL_LIGHT, 'metal');
    b.slab(-6.42, 4.2, -0.82, 6.42, 4.4, -0.72, b.company, 'paint');
    for (let x = -5; x <= 5; x += 2) {
      b.cyl(x, 2.4, 0.2, 0.06, 1.2, C.STEEL, 'metal', 6);
      b.pipe([x, 3.6, 0.2], [x, 3.4, tz], 0.06, C.STEEL_LIGHT, 'metal', 6);
      b.pipe([x, 3.4, tz], [x, 2.45, tz], 0.06, C.STEEL_LIGHT, 'metal', 6);
      b.box(x, 2.4, tz, 0.14, 0.1, 0.14, C.HAZARD, 'paint');
      b.box(x, 4.3, 0.2, 0.4, 0.05, 0.3, C.LAMP_WHITE, 'lamp');
    }
    b.pipe([-6.3, 3.1, 0.8], [6.3, 3.1, 0.8], 0.12, C.CRUDE_PIPE, 'metal', 8);
    b.pipe([-6.3, 2.85, 0.95], [6.3, 2.85, 0.95], 0.09, C.AMBER, 'metal', 8);
    stairs(b, -6.95, 0, 0.5, 0, 2.3, 0.6);
    // control building & product tank
    shed(b, { x0: 3.4, z0: 1.3, x1: 6.9, z1: 2.45, h: 2.6, wall: C.CREAM, roof: C.STEEL, windows: 'sw', windowY: 1.1, door: 's', seed: 81 });
    b.box(5.15, 2.25, 2.48, 2.6, 0.45, 0.05, C.GUNMETAL, 'paint');
    b.sign(5.15, 2.25, 2.51, 2.5, 0.42);
    tank(b, { x: -5.4, z: 1.5, r: 0.9, h: 3.4, color: C.WHITE, seg: 16 });
    tank(b, { x: -3.2, z: 1.5, r: 0.9, h: 3.4, color: C.WHITE, seg: 16 });
    b.anchor('light', 0, 4, 0.2, { intensity: 1.2, range: 16 });
    b.anchor('light', -4.3, 4, 1.5, { intensity: 0.7, range: 10 });
    // track axis for trains
    b.anchor('track', 0, 0.3, tz, {});
    b.anchor('trackDir', 1, 0.3, tz, {});
  },
};

// ---- export terminal ---------------------------------------------------------------------------
const JETTY_EXT = 10;

/** Water depth with out-of-map samples treated as open sea. */
function safeDepth(ctx: GameContext, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= ctx.world.sizeX || iz >= ctx.world.sizeZ) return 12;
  return ctx.geology.waterDepth(ix, iz);
}

/** Local direction index (0:+z, 1:+x, 2:-z, 3:-x) that faces the most water. */
function waterDirection(bs: BuildingState, ctx: GameContext): number {
  const cx = bs.x + bs.size[0] / 2;
  const cz = bs.z + bs.size[1] / 2;
  const yaw = (-bs.rotation * Math.PI) / 2;
  const [w, d] = [10, 14];
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < 4; k++) {
    const lx = k === 1 ? 1 : k === 3 ? -1 : 0;
    const lz = k === 0 ? 1 : k === 2 ? -1 : 0;
    const wx = lx * Math.cos(yaw) + lz * Math.sin(yaw);
    const wz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
    const ext = (k % 2 === 0 ? d : w) / 2;
    let score = 0;
    for (let s = 0; s <= 12; s += 3) score += safeDepth(ctx, cx + wx * (ext + s), cz + wz * (ext + s));
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

const export_terminal: ModelDef = {
  variant(bs, ctx) {
    const dir = waterDirection(bs, ctx);
    const cx = bs.x + bs.size[0] / 2;
    const cz = bs.z + bs.size[1] / 2;
    const yaw = (-bs.rotation * Math.PI) / 2;
    const lx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    const lz = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    const wx = lx * Math.cos(yaw) + lz * Math.sin(yaw);
    const wz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
    const ext = (dir % 2 === 0 ? 14 : 10) / 2 + JETTY_EXT;
    const depth = Math.round(Math.min(40, safeDepth(ctx, cx + wx * ext, cz + wz * ext)));
    return `w${dir}:${depth}:${SEA_LEVEL + 1 - bs.y}`;
  },
  ghostVariant: 'w0:8:-1',
  build(b, p) {
    const [wd, dStr, wyStr] = p.variant ? p.variant.split(':') : ['w0', '8', '-1'];
    const dir = Number(wd.slice(1)) || 0;
    const depth = Math.max(3, Number(dStr) || 8);
    const waterY = Number(wyStr) || -1;
    const L = dir % 2 === 0 ? p.d : p.w; // length toward the water
    const W = dir % 2 === 0 ? p.w : p.d; // lateral width
    b.push().rotY((dir * Math.PI) / 2);
    const deckY = Math.max(waterY + 2.2, 0.6);
    const z0 = -L / 2;
    // land: tank farm, pumps, control building
    b.slab(-W / 2 + 0.05, 0, z0 + 0.05, W / 2 - 0.05, 0.05, -0.2, C.CONCRETE, 'rough');
    const tr = Math.min(1.9, W / 5.2);
    for (const sx of [-1, 1]) tank(b, { x: sx * (W / 4 + 0.1), z: z0 + tr + 0.35, r: tr, h: 4.4, color: C.WHITE, bandY: 3.2, seg: 20 });
    shed(b, { x0: -W / 2 + 0.3, z0: z0 + 2 * tr + 0.8, x1: -W / 2 + 3.2, z1: z0 + 2 * tr + 2.6, h: 2.6, wall: C.CREAM, roof: C.STEEL, windows: 'se', windowY: 1.1, door: 'e', seed: 91 });
    b.box(-W / 2 + 1.75, 2.3, z0 + 2 * tr + 2.63, 2.6, 0.45, 0.05, C.GUNMETAL, 'paint');
    b.sign(-W / 2 + 1.75, 2.3, z0 + 2 * tr + 2.66, 2.5, 0.42);
    for (const x of [0.6, 1.6]) {
      b.slab(x - 0.35, 0.05, z0 + 2 * tr + 1.2, x + 0.35, 0.2, z0 + 2 * tr + 2.2, C.STEEL_DARK, 'paint');
      b.cylZ(x, 0.5, z0 + 2 * tr + 1.7, 0.25, 0.8, C.BLUE, 'paint', 10);
    }
    // pipeline down the middle to the jetty
    const zEnd = L / 2 + JETTY_EXT;
    for (const [i, c] of [C.CRUDE_PIPE, C.AMBER, C.HAZARD].entries()) {
      const x = -0.35 + i * 0.35;
      b.pipe([x, 0.4, z0 + 2 * tr + 0.5], [x, 0.4, -0.3], 0.1, c, 'metal', 8);
      b.pipe([x, 0.4, -0.3], [x, deckY + 0.35, 0.4], 0.1, c, 'metal', 8);
      b.pipe([x, deckY + 0.35, 0.4], [x, deckY + 0.35, zEnd], 0.1, c, 'metal', 8);
    }
    // trestle
    b.slab(-1.0, deckY - 0.15, -0.2, 1.0, deckY, zEnd, C.CONCRETE, 'rough');
    railing(b, -1.0, -0.2, -1.0, zEnd, deckY, C.HAZARD);
    railing(b, 1.0, -0.2, 1.0, zEnd, deckY, C.HAZARD);
    const bottom = waterY - depth;
    for (let z = 1; z < zEnd; z += 2.5) {
      for (const x of [-0.8, 0.8]) b.cyl(x, bottom, z, 0.14, deckY - 0.15 - bottom, C.CONCRETE_DARK, 'rough', 8);
      b.box(0, deckY - 0.25, z, 2.0, 0.2, 0.3, C.CONCRETE_DARK, 'rough');
    }
    // jetty head
    const hz0 = zEnd;
    const hz1 = zEnd + 3.2;
    b.slab(-4.5, deckY - 0.3, hz0, 4.5, deckY, hz1, C.CONCRETE, 'rough');
    for (const x of [-4, -2, 0, 2, 4])
      for (const z of [hz0 + 0.4, hz1 - 0.4]) b.cyl(x, bottom, z, 0.2, deckY - 0.3 - bottom, C.CONCRETE_DARK, 'rough', 8);
    railing(b, -4.5, hz0, -1.0, hz0, deckY, C.HAZARD);
    railing(b, 1.0, hz0, 4.5, hz0, deckY, C.HAZARD);
    // fenders & bollards on the berth face
    for (const x of [-3.8, -1.3, 1.3, 3.8]) {
      b.box(x, deckY - 0.6, hz1 + 0.18, 0.7, 1.0, 0.36, C.RUBBER, 'rough');
      b.cyl(x + 0.5, deckY, hz1 - 0.3, 0.12, 0.3, C.GUNMETAL, 'metal', 8);
    }
    // marine loading arms
    for (const x of [-2.2, 0, 2.2]) {
      b.box(x, deckY + 0.1, hz1 - 1.0, 0.6, 0.2, 0.6, C.STEEL_DARK, 'metal');
      b.cyl(x, deckY + 0.2, hz1 - 1.0, 0.12, 3.2, C.WHITE, 'paint', 8);
      b.pipe([x, deckY + 3.4, hz1 - 1.0], [x, deckY + 4.2, hz1 + 0.3], 0.1, C.WHITE, 'paint', 8);
      b.pipe([x, deckY + 4.2, hz1 + 0.3], [x, deckY + 1.6, hz1 + 1.0], 0.1, C.WHITE, 'paint', 8);
      b.box(x, deckY + 3.3, hz1 - 1.3, 0.35, 0.35, 0.5, b.company, 'paint');
    }
    shed(b, { x0: 2.9, z0: hz0 + 0.2, x1: 4.3, z1: hz0 + 1.4, h: 2.0, y0: deckY, wall: C.WHITE, roof: C.STEEL, windows: 'sw', windowY: 0.9, windowH: 0.5, seed: 92, roofUnits: false });
    lampPost(b, -4.2, hz0 + 0.3, deckY, 4, 0, 1);
    lampPost(b, 4.2, hz1 - 0.3, deckY, 4, Math.PI, 1);
    // navigation light pile
    latticeLeg(b, -5.4, hz1 + 0.5, bottom, deckY + 2, 0.3, C.HAZARD, 3, 1.4, 0.08);
    b.box(-5.4, deckY + 2.2, hz1 + 0.5, 0.2, 0.2, 0.2, C.LAMP_GREEN, 'blink');
    ladder(b, 3.8, bottom + depth - 0.5, hz1 + 0.05, deckY - (bottom + depth - 0.5), Math.PI / 2, false);
    // berth for tankers (centre + heading point), alongside the jetty head
    b.anchor('berth', 0, waterY, hz1 + 3.6, {});
    b.anchor('berthDir', 1, waterY, hz1 + 3.6, {});
    b.anchor('light', 0, deckY + 3.5, hz1 - 1, { intensity: 1.4, range: 18 });
    b.pop();
  },
};

export const LOGISTICS_MODELS: Record<string, ModelDef> = { truck_terminal, rail_terminal, export_terminal };
