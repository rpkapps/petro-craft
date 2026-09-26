// Offshore: jack-up rig, semi-submersible rig, fixed production platform, FPSO.
// Local y = 0 is the sea surface (offshore origin y = SEA_LEVEL + 1); legs, jackets, moorings and
// risers reach the seabed, whose depth is part of the model variant.
import type { BuildingState, GameContext } from '../../../core/types';
import type { Builder } from '../geom/Builder';
import { finFan, hVessel, ladder, latticeBoom, latticeLeg, latticeMast, pipeRackX, platform, railRect, vVessel } from '../geom/parts';
import { C } from '../palette';
import { spinY } from './common';
import { animateRig, bopStack, derrick, drillFloor } from './rigCommon';
import { RIG_FLOOR, RIG_TRAVEL } from './rigSpecs';
import type { AnimState, ModelDef } from './types';

/** Variant: seabed depth below the sea surface at the footprint centre (blocks). */
function seabedVariant(bs: BuildingState, ctx: GameContext): string {
  const cx = Math.floor(bs.x + bs.size[0] / 2);
  const cz = Math.floor(bs.z + bs.size[1] / 2);
  const depth = Math.max(2, Math.min(90, Math.round(bs.y - ctx.geology.surfaceHeight(cx, cz))));
  return `d${depth}`;
}
const depthOf = (v: string, def = 12) => Math.max(2, Number(v.slice(1)) || def);

/** Deck walkway polyline for NPC workers ('walk' anchors, in order; `loop` closes it). */
function walkway(b: Builder, line: number, y: number, pts: [number, number][], loop: boolean): void {
  pts.forEach(([x, z], i) => b.anchor('walk', x, y, z, { line, i, loop: loop && i === 0 ? 1 : 0 }));
}

/** Octagonal helideck at (x, y, z) with radius r (+ anchor for helicopters). */
function helideck(b: Builder, x: number, y: number, z: number, r: number): void {
  b.cyl(x, y - 0.25, z, r, 0.25, C.GUNMETAL, 'metal', 8);
  b.at(0, 0, 0, 0, () => {
    b.ring(x, y + 0.01, z, r * 0.62, 0.08, C.HAZARD, 'paint', 24);
    b.slab(x - 0.55, y, z - 0.75, x - 0.32, y + 0.02, z + 0.75, C.WHITE, 'paint');
    b.slab(x + 0.32, y, z - 0.75, x + 0.55, y + 0.02, z + 0.75, C.WHITE, 'paint');
    b.slab(x - 0.32, y, z - 0.1, x + 0.32, y + 0.02, z + 0.1, C.WHITE, 'paint');
  });
  b.ring(x, y + 0.02, z, r - 0.05, 0.06, C.WHITE, 'paint', 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.box(x + Math.cos(a) * (r - 0.15), y + 0.08, z + Math.sin(a) * (r - 0.15), 0.12, 0.1, 0.12, C.LAMP_GREEN, 'lamp');
  }
  b.detail(() => b.ring(x, y - 0.05, z, r + 0.35, 0.05, C.STEEL, 'metal', 8));
  b.anchor('helideck', x, y, z, {});
}

/** Pedestal crane with lattice boom pointing along `dir` (radians around Y). */
function crane(b: Builder, name: string, x: number, y0: number, z: number, dir: number, boom: number): void {
  b.cyl(x, y0, z, 0.45, 2.2, C.HAZARD, 'paint', 12);
  b.group(name, x, y0 + 2.2, z, () => {
    b.rotY(dir);
    b.box(0, 0.5, 0, 1.3, 1.0, 1.0, C.HAZARD, 'paint');
    b.box(0.35, 0.6, 0.5, 0.5, 0.5, 0.05, C.GLASS, 'glass');
    b.box(-0.8, 0.5, 0, 0.5, 0.8, 0.9, C.GUNMETAL, 'paint');
    latticeBoom(b, [0.5, 0.4, 0], [0.5 + boom * 0.82, 0.4 + boom * 0.57, 0], 0.45, C.HAZARD, 0.9, 0.5);
    const tx = 0.5 + boom * 0.82;
    const ty = 0.4 + boom * 0.57;
    b.pipe([-0.3, 1.2, 0], [tx, ty, 0], 0.02, C.GUNMETAL, 'metal', 4);
    b.box(tx, ty - 1.5, 0, 0.02, 3, 0.02, C.GUNMETAL, 'metal');
    b.box(tx, ty - 3.1, 0, 0.2, 0.25, 0.2, C.HAZARD, 'paint');
    b.box(tx + 0.1, ty + 0.1, 0, 0.12, 0.12, 0.12, C.LAMP_RED, 'blink');
  });
}

/** Accommodation block with window rows and company band. */
function quarters(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, levels: number): void {
  const h = levels * 1.25;
  b.slab(x0, y0, z0, x1, y0 + h, z1, C.WHITE, 'paint');
  for (let l = 0; l < levels; l++) {
    const y = y0 + 0.55 + l * 1.25;
    for (let x = x0 + 0.4; x < x1 - 0.2; x += 0.6) {
      const kind = (l * 7 + Math.round(x * 3)) % 4 === 0 ? 'glassDark' : 'glass';
      b.box(x, y, z0 - 0.02, 0.35, 0.35, 0.04, C.GLASS, kind);
      b.box(x, y, z1 + 0.02, 0.35, 0.35, 0.04, C.GLASS, kind);
    }
    for (let z = z0 + 0.4; z < z1 - 0.2; z += 0.6) {
      b.box(x0 - 0.02, y, z, 0.04, 0.35, 0.35, C.GLASS, 'glass');
      b.box(x1 + 0.02, y, z, 0.04, 0.35, 0.35, C.GLASS, 'glass');
    }
  }
  b.slab(x0 - 0.02, y0 + h - 0.3, z0 - 0.02, x1 + 0.02, y0 + h, z1 + 0.02, b.company, 'paint');
  b.slab(x0 - 0.05, y0 + h, z0 - 0.05, x1 + 0.05, y0 + h + 0.1, z1 + 0.05, C.STEEL, 'metal');
  b.anchor('light', (x0 + x1) / 2, y0 + h * 0.5, z1 + 0.6, { intensity: 0.6, range: 10 });
}

/** Orange lifeboat capsule along x at (x,y,z). */
function lifeboat(b: Builder, x: number, y: number, z: number): void {
  b.detail(() => {
    b.cylX(x, y, z, 0.32, 1.5, C.ORANGE, 'paint', 10);
    b.sphere(x + 0.75, y, z, 0.32, C.ORANGE, 'paint', 8, 0.32).sphere(x - 0.75, y, z, 0.32, C.ORANGE, 'paint', 8, 0.32);
    b.box(x, y + 0.3, z, 0.6, 0.2, 0.4, C.WHITE, 'paint');
  });
}

function slewCranes(a: AnimState, names: string[]): void {
  for (const [i, n] of names.entries()) {
    const node = a.node(n);
    if (!node) continue;
    a.mem[`c${i}`] = (a.mem[`c${i}`] ?? i * 2) + a.dt * 0.08 * a.speed;
    node.rotation.y = Math.sin(a.mem[`c${i}`]) * 0.9;
  }
}

// ---- jack-up --------------------------------------------------------------------------------------
const jackup_rig: ModelDef = {
  variant: seabedVariant,
  ghostVariant: 'd10',
  build(b, p) {
    const depth = depthOf(p.variant, 10);
    const floorY = RIG_FLOOR.jackup_rig;
    const hullY0 = 4.8;
    const deckY = 7.4;
    const legs: [number, number][] = [
      [-3.3, -2.8],
      [-3.3, 2.8],
      [3.4, 0],
    ];
    for (const [x, z] of legs) {
      latticeLeg(b, x, z, -depth - 0.3, 19.5, 0.62, C.HAZARD, 3, 1.1, 0.14);
      b.cyl(x, -depth - 0.4, z, 1.3, 0.5, C.STEEL_DARK, 'paint', 12, 0.5);
      // jack house around the leg
      b.slab(x - 0.95, deckY, z - 0.95, x + 0.95, deckY + 2.2, z + 0.95, C.STEEL_LIGHT, 'paint');
      b.slab(x - 0.97, deckY + 1.8, z - 0.97, x + 0.97, deckY + 2.2, z + 0.97, b.company, 'paint');
      b.box(x, 19.7, z, 0.15, 0.15, 0.15, C.LAMP_RED, 'blink');
    }
    // hull (triangular-ish with chamfered bow at +x)
    b.slab(-4.3, hullY0, -3.8, 2.3, deckY, 3.8, b.company, 'paint');
    b.wedge(3.3, hullY0, 0, 2.0, deckY - hullY0, 7.6, b.company, 'paint');
    b.slab(-4.35, hullY0, -3.85, 2.35, hullY0 + 0.25, 3.85, C.STEEL_DARK, 'paint');
    b.slab(-4.3, deckY - 0.05, -3.8, 2.3, deckY, 3.8, C.GUNMETAL, 'metal');
    // cantilever / substructure + drill floor + derrick over the well (centre)
    b.slab(-1.6, deckY, -1.6, 1.6, floorY - 0.18, 1.6, C.STEEL_DARK, 'paint');
    bopStack(b, deckY - 1.2, floorY, 0.8);
    drillFloor(b, floorY, 1.7, false);
    derrick(b, { floorY, topY: 21.4, hw0: 1.2, hw1: 0.42, color: C.WHITE, braceColor: C.WHITE, travel: RIG_TRAVEL.jackup_rig });
    // quarters + helideck (cantilevered past +z)
    quarters(b, 0.2, 1.9, 2.4, 3.7, deckY, 3);
    helideck(b, 1.4, deckY + 4.2, 4.3, 2.0);
    for (const s of [-1, 1]) b.beam([1.4 + s * 0.9, deckY + 3.75, 3.5], [1.4 + s * 1.2, deckY + 2.0, 3.8], 0.12, C.STEEL_DARK, 'paint');
    // pipe deck, mud module, crane, lifeboats
    b.slab(-3.6, deckY, 0.9, -1.9, deckY + 1.8, 2.2, C.STEEL, 'paint');
    b.slab(-3.62, deckY + 1.5, 0.88, -1.88, deckY + 1.8, 2.22, C.GREEN, 'paint');
    pipeRackX(b, -2.2, 1.2, -3.0, deckY, 1.1, [0.6], [C.RUST, C.STEEL, C.RUST]);
    crane(b, 'crane0', -2.0, deckY, 3.1, -0.4, 7);
    lifeboat(b, 1.0, deckY + 0.6, -3.5);
    lifeboat(b, -1.0, deckY + 0.6, -3.5);
    railRect(b, -4.3, -3.8, 2.3, 3.8, deckY, C.HAZARD);
    b.anchor('light', 0, deckY + 2, 0, { intensity: 1.2, range: 16 });
    walkway(b, 0, deckY, [[-1.75, -2.05], [1.95, -2.05], [1.95, 1.75], [-1.75, 1.75]], true);
  },
  animate(a) {
    animateRig(a, RIG_FLOOR.jackup_rig, RIG_TRAVEL.jackup_rig, 21.4);
    slewCranes(a, ['crane0']);
  },
  activity(bs) {
    return bs.status === 'active' ? 1 : 0;
  },
};

// ---- semi-submersible --------------------------------------------------------------------------------
const semi_sub_rig: ModelDef = {
  variant: seabedVariant,
  ghostVariant: 'd30',
  build(b, p) {
    const depth = depthOf(p.variant, 30);
    const floorY = RIG_FLOOR.semi_sub_rig;
    const deckY = 9.0;
    // pontoons (submerged) and columns
    for (const z of [-3.8, 3.8]) {
      b.slab(-4.9, -4.2, z - 0.95, 4.9, -2.2, z + 0.95, b.company, 'paint');
      b.sphere(-4.9, -3.2, z, 1.0, b.company, 'paint', 10, 1.0);
      b.sphere(4.9, -3.2, z, 1.0, b.company, 'paint', 10, 1.0);
    }
    const cols: [number, number][] = [
      [-3.8, -3.8],
      [3.8, -3.8],
      [-3.8, 3.8],
      [3.8, 3.8],
    ];
    for (const [x, z] of cols) {
      b.cyl(x, -2.2, z, 1.0, deckY - 2.5 + 2.2, b.company, 'paint', 16);
      b.cyl(x, -0.4, z, 1.02, 0.8, C.WHITE, 'paint', 16);
      b.detail(() => {
        for (let y = -1.5; y < 2.5; y += 0.5) b.box(x + (x > 0 ? 1.02 : -1.02), y, z, 0.02, 0.05, 0.3, C.WHITE, 'paint');
      });
    }
    // bracing
    for (const x of [-3.8, 3.8]) b.cylZ(x, -1.2, 0, 0.3, 7.6, C.STEEL_LIGHT, 'paint', 8);
    b.cylX(0, -1.2, 0, 0.3, 7.6, C.STEEL_LIGHT, 'paint', 8);
    // box deck
    b.slab(-5.3, deckY - 2.5, -5.3, 5.3, deckY, 5.3, C.STEEL_LIGHT, 'paint');
    b.slab(-5.32, deckY - 0.5, -5.32, 5.32, deckY - 0.2, 5.32, b.company, 'paint');
    b.slab(-5.3, deckY - 0.05, -5.3, 5.3, deckY, 5.3, C.GUNMETAL, 'metal');
    // moorings: two lines per column to anchors on the seabed
    const spread = Math.max(14, depth * 1.2);
    for (const [x, z] of cols) {
      const a0 = Math.atan2(z, x);
      for (const da of [-0.3, 0.3]) {
        const a = a0 + da;
        b.pipe([x + Math.cos(a) * 1.0, -1.8, z + Math.sin(a) * 1.0], [x + Math.cos(a) * spread, -depth, z + Math.sin(a) * spread], 0.05, C.GUNMETAL, 'metal', 4);
      }
    }
    // drill floor + derrick
    b.slab(-1.8, deckY, -1.8, 1.8, floorY - 0.18, 1.8, C.STEEL_DARK, 'paint');
    drillFloor(b, floorY, 1.9, true);
    derrick(b, { floorY, topY: 23.4, hw0: 1.45, hw1: 0.45, color: C.WHITE, braceColor: C.WHITE, travel: RIG_TRAVEL.semi_sub_rig, heavy: true });
    // riser down through the moonpool
    b.cyl(0, -depth, 0, 0.18, depth + deckY - 2.4, C.STEEL_LIGHT, 'metal', 8);
    bopStack(b, -depth, -depth + 3, 1);
    // quarters, helideck, cranes, lifeboats
    quarters(b, 1.9, -5.2, 5.2, -2.5, deckY, 3);
    helideck(b, 3.6, deckY + 4.3, -5.2, 2.3);
    crane(b, 'crane0', -4.5, deckY, 4.5, Math.PI * 0.75, 7);
    crane(b, 'crane1', 4.5, deckY, 4.5, Math.PI * 0.25, 7);
    b.slab(-4.8, deckY, -4.8, -2.4, deckY + 2.0, -2.2, C.STEEL, 'paint');
    b.slab(-4.82, deckY + 1.7, -4.82, -2.38, deckY + 2.0, -2.18, C.GREEN, 'paint');
    pipeRackX(b, -4.5, -2.2, 0.8, deckY, 1.8, [0.7], [C.RUST, C.STEEL, C.RUST]);
    lifeboat(b, 0.5, deckY + 0.5, -5.6);
    lifeboat(b, -1.5, deckY + 0.5, -5.6);
    railRect(b, -5.3, -5.3, 5.3, 5.3, deckY, C.HAZARD);
    b.anchor('light', 0, deckY + 2, 0, { intensity: 1.4, range: 18 });
    walkway(b, 0, deckY, [[-2.0, -2.1], [4.9, -2.1], [4.9, 2.2], [-2.0, 2.2]], true);
  },
  animate(a) {
    animateRig(a, RIG_FLOOR.semi_sub_rig, RIG_TRAVEL.semi_sub_rig, 23.4);
    slewCranes(a, ['crane0', 'crane1']);
  },
  activity(bs) {
    return bs.status === 'active' ? 1 : 0;
  },
};

// ---- fixed production platform --------------------------------------------------------------------
const production_platform: ModelDef = {
  variant: seabedVariant,
  ghostVariant: 'd12',
  build(b, p) {
    const depth = depthOf(p.variant, 12);
    const topJ = 3.2;
    const L = 3.7;
    const batter = 0.09;
    const legAt = (y: number) => L + (topJ - y) * batter;
    // jacket legs with splash-zone band
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.pipe([sx * legAt(-depth), -depth - 0.5, sz * legAt(-depth)], [sx * L, topJ, sz * L], 0.32, C.HAZARD, 'paint', 10);
        b.pipe([sx * legAt(-1), -1, sz * legAt(-1)], [sx * legAt(1.4), 1.4, sz * legAt(1.4)], 0.36, C.GUNMETAL, 'paint', 10);
      }
    // horizontal frames & X braces
    const levels: number[] = [];
    for (let y = topJ - 0.3; y > -depth; y -= 4.5) levels.push(y);
    levels.push(-depth + 0.5);
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i];
      const w = legAt(y);
      for (const [ax, az, bx, bz] of [
        [-1, -1, 1, -1],
        [1, -1, 1, 1],
        [1, 1, -1, 1],
        [-1, 1, -1, -1],
      ])
        b.pipe([ax * w, y, az * w], [bx * w, y, bz * w], 0.12, C.HAZARD, 'paint', 6);
      if (i + 1 < levels.length) {
        const y2 = levels[i + 1];
        const w2 = legAt(y2);
        for (const [ax, az, bx, bz] of [
          [-1, -1, 1, -1],
          [1, -1, 1, 1],
          [1, 1, -1, 1],
          [-1, 1, -1, -1],
        ]) {
          b.pipe([ax * w, y, az * w], [bx * w2, y2, bz * w2], 0.09, C.HAZARD, 'paint', 6);
          b.pipe([bx * w, y, bz * w], [ax * w2, y2, az * w2], 0.09, C.HAZARD, 'paint', 6);
        }
      }
    }
    // well-bay conductors
    for (let i = 0; i < 6; i++) b.cyl(-4.3 + (i % 2) * 0.55, -depth, -1.2 + Math.floor(i / 2) * 0.9, 0.15, depth + 4.2, C.STEEL, 'metal', 8);
    // decks
    const cellar = 3.6;
    const main = 7.2;
    const top = 10.4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * L, (cellar + top) / 2, sz * L, 0.35, top - cellar, 0.35, C.STEEL_DARK, 'paint');
    platform(b, -4.9, -4.9, 4.9, 4.9, cellar, C.GUNMETAL, true);
    platform(b, -4.9, -4.9, 4.9, 4.9, main, C.GUNMETAL, true);
    platform(b, -4.9, -4.9, 1.4, 1.4, top, C.GUNMETAL, true);
    for (const x of [-4.9, 4.9]) b.slab(x - 0.05, main - 0.6, -4.9, x + 0.05, main - 0.12, 4.9, b.company, 'paint');
    // cellar deck: separators & wellheads
    hVessel(b, 0.6, cellar + 0.7, -2.6, 0.6, 3.0, 'x', C.WHITE);
    hVessel(b, 0.6, cellar + 0.6, -0.6, 0.5, 2.6, 'x', C.WHITE);
    for (let i = 0; i < 6; i++) {
      const x = -4.3 + (i % 2) * 0.55;
      const z = -1.2 + Math.floor(i / 2) * 0.9;
      b.box(x, cellar + 0.35, z, 0.25, 0.5, 0.25, C.RED, 'paint');
    }
    // main deck: compression & power modules with exhausts
    b.slab(-4.6, main, -4.6, -1.0, main + 2.6, -1.6, C.STEEL_LIGHT, 'paint');
    b.slab(-4.62, main + 2.2, -4.62, -0.98, main + 2.6, -1.58, b.company, 'paint');
    for (const x of [-3.8, -2.0]) {
      b.cyl(x, main + 2.6, -3.1, 0.28, 3.2, C.STEEL, 'paint', 10);
      b.anchor('exhaust', x, main + 5.9, -3.1, { rate: 3 });
    }
    finFan(b, -2.2, 0.0, top, 3.2, 1.6, 2, 'fan', 'x');
    vVessel(b, 0.2, 3.2, main, 0.45, 2.6, C.WHITE);
    vVessel(b, -0.9, 3.2, main, 0.4, 2.2, C.WHITE);
    // living quarters + helideck on top
    quarters(b, 1.8, 1.8, 4.8, 4.8, main, 4);
    helideck(b, 3.3, main + 5.6, 3.3, 2.5);
    lifeboat(b, 3.3, main + 0.7, 5.2);
    // crane & flare boom
    crane(b, 'crane0', 4.2, main, -4.2, -Math.PI * 0.25, 8);
    latticeBoom(b, [-4.6, top, -4.6], [-10.6, top + 7.5, -10.6], 0.8, C.STEEL_LIGHT, 1.1, 0.7);
    b.cyl(-10.6, top + 7.5, -10.6, 0.22, 0.6, C.GUNMETAL, 'metal', 10, 0.3);
    b.anchor('flare', -10.6, top + 8.15, -10.6, { scale: 1.35, pilot: 0.2 });
    ladder(b, 4.9, 0, 0, cellar, Math.PI, false);
    b.slab(4.2, -0.05, -1.2, 5.6, 0.25, 1.2, C.GUNMETAL, 'metal'); // boat landing
    b.anchor('light', 0, main + 1.5, 0, { intensity: 1.4, range: 18 });
    b.anchor('light', -2, cellar + 1.5, -2, { intensity: 1, range: 12 });
    walkway(b, 0, main, [[-4.2, -1.1], [4.3, -1.1], [4.3, 1.3], [-4.2, 1.3]], true);
    walkway(b, 1, cellar, [[-3.2, -3.6], [3.0, -3.6], [3.0, 1.2], [-3.2, 1.2]], true);
  },
  animate(a) {
    slewCranes(a, ['crane0']);
    spinY(a, 'fan0', 2);
    spinY(a, 'fan1', 2.3);
  },
};

// ---- FPSO -----------------------------------------------------------------------------------------
const fpso: ModelDef = {
  variant: seabedVariant,
  ghostVariant: 'd40',
  build(b, p) {
    const depth = depthOf(p.variant, 40);
    const deck = 3.0;
    const keel = -2.4;
    const hullDark = C.NAVY;
    // hull: antifouling below the waterline, dark topsides, bow ellipse
    b.slab(-3.9, keel, -10.4, 3.9, -0.1, 8.6, C.RED_DARK, 'paint');
    b.slab(-3.9, -0.1, -10.4, 3.9, deck, 8.6, hullDark, 'paint');
    b.push().translate(0, 0, 8.6).scale(1, 1, 0.62);
    b.cyl(0, keel, 0, 3.9, -0.1 - keel, C.RED_DARK, 'paint', 20);
    b.cyl(0, -0.1, 0, 3.9, deck + 0.3, hullDark, 'paint', 20);
    b.cyl(0, deck + 0.3 - 0.05, 0, 3.85, 0.05, C.GUNMETAL, 'metal', 20);
    b.pop();
    b.slab(-3.92, deck - 0.5, -10.42, 3.92, deck - 0.25, 8.6, b.company, 'paint');
    b.slab(-3.9, deck - 0.05, -10.4, 3.9, deck, 8.6, 0x4f5f52, 'rough');
    railRect(b, -3.9, -10.4, 3.9, 8.6, deck, C.HAZARD, 's');
    // turret with risers & mooring legs to the seabed
    b.cyl(0, deck, 7.0, 1.3, 2.4, C.STEEL_LIGHT, 'paint', 16);
    b.cyl(0, deck + 2.4, 7.0, 1.5, 0.3, b.company, 'paint', 16);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const reach = Math.max(10, depth * 0.9);
      b.pipe([Math.cos(a) * 1.0, keel, 7.0 + Math.sin(a) * 1.0], [Math.cos(a) * reach, -depth, 7.0 + Math.sin(a) * reach], i % 3 === 0 ? 0.1 : 0.05, i % 3 === 0 ? C.HAZARD : C.GUNMETAL, 'metal', 4);
    }
    // process modules on stilts + central pipe rack
    for (let i = 0; i < 4; i++) {
      const z0 = -5.6 + i * 3.1;
      for (const x of [-3.2, -0.4, 0.4, 3.2]) b.box(x, deck + 1.0, z0 + 1.35, 0.2, 2.0, 0.2, C.STEEL_DARK, 'paint');
      b.slab(-3.4, deck + 2.0, z0, 3.4, deck + 2.2, z0 + 2.7, C.GUNMETAL, 'metal');
      if (i % 2 === 0) {
        hVessel(b, -1.8, deck + 2.9, z0 + 1.35, 0.55, 2.4, 'z', C.WHITE);
        vVessel(b, 1.8, z0 + 1.35, deck + 2.2, 0.6, 3.2, C.WHITE);
      } else {
        b.slab(-3.2, deck + 2.2, z0 + 0.2, -0.3, deck + 4.4, z0 + 2.5, C.STEEL_LIGHT, 'paint');
        b.slab(-3.22, deck + 4.0, z0 + 0.18, -0.28, deck + 4.4, z0 + 2.52, b.company, 'paint');
        finFan(b, 1.8, z0 + 1.35, deck + 2.2, 2.4, 2.4, 2, `fan${i}_`, 'z');
      }
    }
    pipeRackX(b, -1.5, 1.5, 0, deck, 0.1, [1.0], [C.STEEL]);
    b.pipe([0, deck + 1.3, -6], [0, deck + 1.3, 6], 0.22, C.HAZARD, 'metal', 8);
    b.pipe([0.35, deck + 1.3, -6], [0.35, deck + 1.3, 6], 0.16, C.STEEL_LIGHT, 'metal', 8);
    // flare tower at the bow
    latticeMast(b, { x: 0, z: 9.6, y0: deck + 0.3, y1: 12.2, hw0: 0.9, hw1: 0.35, panel: 1.3, leg: 0.12, brace: 0.05, color: C.STEEL_LIGHT });
    b.cyl(0, 12.2, 9.6, 0.25, 0.6, C.GUNMETAL, 'metal', 10, 0.3);
    b.anchor('flare', 0, 12.85, 9.6, { scale: 1.3, pilot: 0.2 });
    // accommodation block, bridge, funnel and helideck at the stern
    quarters(b, -3.4, -10.2, 3.4, -7.4, deck, 4);
    b.slab(-3.9, deck + 5.0, -8.6, 3.9, deck + 5.9, -7.5, C.WHITE, 'paint');
    b.box(0, deck + 5.45, -7.48, 7.6, 0.45, 0.05, C.GLASS, 'glass');
    b.cyl(2.6, deck + 5.0, -9.4, 0.4, 2.2, b.company, 'paint', 12);
    b.cyl(2.6, deck + 7.2, -9.4, 0.42, 0.25, C.BLACK, 'paint', 12);
    b.anchor('exhaust', 2.6, deck + 7.5, -9.4, { rate: 3 });
    helideck(b, -0.8, deck + 5.6, -11.3, 2.6);
    for (const s of [-1, 1]) b.beam([-0.8 + s * 1.6, deck + 5.3, -10.3], [-0.8 + s * 2.0, deck + 2.2, -10.3], 0.14, C.STEEL_DARK, 'paint');
    lifeboat(b, -2.8, deck + 1.0, -6.9);
    lifeboat(b, 2.8, deck + 1.0, -6.9);
    crane(b, 'crane0', 3.5, deck, -3.4, 0.6, 7);
    crane(b, 'crane1', -3.5, deck, 3.6, Math.PI + 0.6, 7);
    // offloading reel at the stern
    b.cylX(2.8, deck + 0.8, -10.6, 0.55, 0.9, C.HAZARD, 'paint', 12);
    b.anchor('berth', 0, 0, -32, {});
    b.anchor('berthDir', 0, 0, -33, {});
    b.anchor('light', 0, deck + 3, 0, { intensity: 1.4, range: 18 });
    b.anchor('light', 0, deck + 3, -7, { intensity: 1, range: 14 });
    walkway(b, 0, deck, [[-2.3, -6.4], [-2.3, 6.2]], false);
    walkway(b, 1, deck, [[2.3, -6.4], [2.3, 6.2]], false);
  },
  animate(a) {
    slewCranes(a, ['crane0', 'crane1']);
    for (const i of [1, 3]) for (let k = 0; k < 2; k++) spinY(a, `fan${i}_${k}`, 2.2);
    // gentle swell
    const root = a.node('crane0')?.parent;
    if (root) {
      root.rotation.z = Math.sin(a.t * 0.35) * 0.008;
      root.rotation.x = Math.sin(a.t * 0.27 + 1) * 0.005;
      root.position.y = Math.sin(a.t * 0.5) * 0.05;
    }
  },
  ambient: true,
};

export const OFFSHORE_MODELS: Record<string, ModelDef> = { jackup_rig, semi_sub_rig, production_platform, fpso };
