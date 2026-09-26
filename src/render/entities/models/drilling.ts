// Land drilling rigs (standard & heavy) and the frac spread.
import type { Builder } from '../geom/Builder';
import { container, hVessel, lampPost, pipeStack, platform, pumpSkid, railing, stairs } from '../geom/parts';
import { C } from '../palette';
import { blenderTruck, fracPumpTruck, sandSilo } from '../vehicles/props';
import { animateRig, bopStack, derrick, drillFloor } from './rigCommon';
import { RIG_FLOOR, RIG_TRAVEL } from './rigSpecs';
import type { ModelDef } from './types';

/** Substructure: box-girder towers with X bracing holding the drill floor, open over the well. */
function substructure(b: Builder, hw: number, floorY: number): void {
  const y1 = floorY - 0.18;
  for (const sx of [-1, 1]) {
    // side box girders
    b.slab(sx * hw - 0.25 * sx - 0.25, 0, -hw, sx * hw - 0.25 * sx + 0.25, 0.35, hw, C.STEEL_DARK, 'paint');
    b.slab(sx * hw - 0.25 * sx - 0.25, y1 - 0.35, -hw, sx * hw - 0.25 * sx + 0.25, y1, hw, C.STEEL_DARK, 'paint');
    for (const sz of [-1, 0, 1]) b.box(sx * (hw - 0.25), y1 / 2, sz * (hw - 0.2), 0.22, y1, 0.22, C.STEEL_DARK, 'paint');
    // X braces on the long faces
    for (const sz of [-1, 1]) {
      const z0 = sz * (hw - 0.2);
      b.beam([sx * (hw - 0.25), 0.35, z0], [sx * (hw - 0.25), y1 - 0.35, 0], 0.09, b.company, 'paint');
      b.beam([sx * (hw - 0.25), y1 - 0.35, z0], [sx * (hw - 0.25), 0.35, 0], 0.09, b.company, 'paint');
    }
  }
  // spreader beams front/back
  for (const sz of [-1, 1]) b.slab(-hw, y1 - 0.3, sz * hw - 0.12, hw, y1, sz * hw + 0.12, C.STEEL_DARK, 'paint');
}

function mudTank(b: Builder, x0: number, x1: number, z: number, w: number, h: number): void {
  b.slab(x0, 0, z - w / 2, x1, h, z + w / 2, C.STEEL, 'paint');
  b.slab(x0 - 0.02, h - 0.2, z - w / 2 - 0.02, x1 + 0.02, h, z + w / 2 + 0.02, b.company, 'paint');
  b.detail(() => {
    for (let x = x0 + 0.5; x < x1; x += 0.9) {
      b.cyl(x, h, z, 0.12, 0.35, C.STEEL_DARK, 'metal', 8);
      b.box(x, h + 0.4, z, 0.25, 0.1, 0.25, C.GREEN, 'paint');
    }
    railing(b, x0, z - w / 2, x1, z - w / 2, h, C.HAZARD);
  });
}

function mudPump(b: Builder, x: number, z: number, ry: number, s = 1): void {
  b.at(x, 0, z, ry, () => {
    b.slab(-0.95 * s, 0, -0.45 * s, 0.95 * s, 0.2, 0.45 * s, C.STEEL_DARK, 'paint');
    b.slab(-0.2 * s, 0.2, -0.42 * s, 0.9 * s, 0.95 * s, 0.42 * s, C.RED, 'paint');
    for (const zz of [-0.25, 0, 0.25]) b.cylX(0.95 * s, 0.55 * s, zz * s, 0.1 * s, 0.25, C.STEEL_LIGHT, 'metal', 8);
    b.cylZ(-0.1 * s, 0.6 * s, 0, 0.35 * s, 0.8 * s, C.RED_DARK, 'paint', 12);
    b.slab(-0.95 * s, 0.2, -0.35 * s, -0.35 * s, 0.85 * s, 0.35 * s, C.GUNMETAL, 'paint');
    b.pipe([0.95 * s, 0.85 * s, 0], [0.95 * s, 1.35 * s, 0], 0.08, C.STEEL_LIGHT, 'metal');
    b.sphere(0.95 * s, 1.45 * s, 0, 0.13 * s, C.RED, 'paint', 8);
  });
}

function genset(b: Builder, x: number, z: number, ry: number, s = 0.5): void {
  container(b, x, 0, z, ry, C.GREEN, s);
  b.at(x, 0, z, ry, () => {
    b.slab(-3 * s + 0.05, 2.55 * s, -0.45 * s, -2.2 * s, 2.55 * s + 0.2, 0.45 * s, C.STEEL_DARK, 'metal');
    b.cyl(-1.2 * s, 2.55 * s, 0.4 * s, 0.07, 0.5, C.STEEL_LIGHT, 'metal', 6);
    b.anchor('exhaust', -1.2 * s, 2.55 * s + 0.55, 0.4 * s, { rate: 4 });
  });
}

interface LandRigSpec {
  hw: number; // half footprint
  subHw: number;
  heavy: boolean;
}

function landRig(b: Builder, type: string, spec: LandRigSpec): void {
  const floorY = RIG_FLOOR[type];
  const topY = spec.heavy ? 20.6 : 15.1;
  const hw = spec.hw;
  const sh = spec.subHw;
  // gravel & mats
  b.slab(-hw + 0.02, 0, -hw + 0.02, hw - 0.02, 0.05, hw - 0.02, C.GRAVEL, 'rough');
  b.slab(-sh - 0.3, 0.05, -sh - 0.3, sh + 0.3, 0.1, sh + 0.3, C.WOOD, 'rough');
  // cellar & wellhead + BOP under the floor
  b.cyl(0, 0.02, 0, 0.7, 0.06, C.CONCRETE_DARK, 'rough', 14);
  bopStack(b, 0.08, floorY, spec.heavy ? 1.2 : 1);
  substructure(b, sh, floorY);
  drillFloor(b, floorY, sh, spec.heavy);
  derrick(b, {
    floorY,
    topY,
    hw0: spec.heavy ? 1.75 : 1.35,
    hw1: spec.heavy ? 0.55 : 0.45,
    color: spec.heavy ? C.WHITE : b.company,
    braceColor: spec.heavy ? C.WHITE : b.company,
    travel: RIG_TRAVEL[type],
    heavy: spec.heavy,
    windwalls: spec.heavy ? 3.2 : 0,
  });
  // stairs from ground to drill floor on the -z side
  stairs(b, sh - 0.5 - (floorY - 0.1), 0.1, -sh - 0.45, 0, floorY - 0.1, 0.7);
  platform(b, sh - 0.5, -sh - 0.9, sh + 0.2, -sh, floorY, C.STEEL_DARK, true, 'e');
  // V-door ramp & catwalk (+x)
  b.push();
  b.beam([sh, floorY - 0.1, -0.35], [hw - 0.05, 0.9, -0.35], 0.1, C.HAZARD, 'paint');
  b.beam([sh, floorY - 0.1, 0.35], [hw - 0.05, 0.9, 0.35], 0.1, C.HAZARD, 'paint');
  b.pop();
  b.orient([sh + 0.05, floorY - 0.12, 0], [hw - 0.05, 0.85, 0], (len) => b.box(0, len / 2, 0, 0.7, len, 0.05, C.STEEL_DARK, 'metal'));
  b.slab(sh + 0.3, 0, -0.45, hw - 0.02, 0.85, 0.45, C.STEEL, 'paint');
  if (spec.heavy) {
    // pipe racks beside the catwalk
    for (const sz of [-1, 1]) {
      pipeStack(b, (sh + hw) / 2 + 0.3, 0.1, sz * 1.7, hw - sh + 0.9, 3, 4, 0.09, C.RUST);
    }
    // three mud pumps on the -z side, gensets and VFD house on -x, mud tanks on +z
    mudPump(b, -1.3, -hw + 0.6, 0, 1);
    mudPump(b, 0.9, -hw + 0.6, 0, 1);
    genset(b, -hw + 0.55, -1.2, Math.PI / 2, 0.42);
    genset(b, -hw + 0.55, 1.4, Math.PI / 2, 0.42);
    mudTank(b, -hw + 1.2, sh + 0.8, hw - 0.55, 0.9, 1.5);
    // shale shakers on the tank
    b.slab(-1.2, 1.5, hw - 0.9, 0.2, 2.2, hw - 0.2, C.STEEL_LIGHT, 'metal');
    b.slab(-1.1, 2.2, hw - 0.85, 0.1, 2.3, hw - 0.25, C.GREEN, 'paint');
    // diesel tank & choke manifold
    hVessel(b, 2.6, 0.6, -hw + 1.8, 0.45, 1.6, 'x', C.RED);
    b.anchor('light', hw - 0.5, 2.5, hw - 0.5, { intensity: 0.8, range: 12 });
    lampPost(b, hw - 0.3, -hw + 0.3, 0, 3.4, Math.PI * 0.75, 1);
  } else {
    // mud pumps (-z), mud tanks (+z), generator (-x), pipe rack (+x beside catwalk)
    mudPump(b, -0.9, -hw + 0.5, 0, 0.8);
    mudTank(b, -hw + 0.2, sh + 0.2, hw - 0.45, 0.8, 1.2);
    b.slab(-0.9, 1.2, hw - 0.8, 0.1, 1.75, hw - 0.15, C.STEEL_LIGHT, 'metal');
    genset(b, -hw + 0.45, -0.3, Math.PI / 2, 0.36);
    pipeStack(b, hw - 0.4, 0.05, -1.55, 1.1, 2, 3, 0.08, C.RUST);
    lampPost(b, hw - 0.25, hw - 0.25, 0, 3, Math.PI * 1.25, 1);
  }
}

const drilling_rig_land: ModelDef = {
  build(b) {
    landRig(b, 'drilling_rig_land', { hw: 2.5, subHw: 1.6, heavy: false });
  },
  animate(a) {
    animateRig(a, RIG_FLOOR.drilling_rig_land, RIG_TRAVEL.drilling_rig_land, 15.1);
  },
  activity(bs) {
    return bs.status === 'active' ? 1 : 0;
  },
};

const drilling_rig_heavy: ModelDef = {
  build(b) {
    landRig(b, 'drilling_rig_heavy', { hw: 3.5, subHw: 2.2, heavy: true });
  },
  animate(a) {
    animateRig(a, RIG_FLOOR.drilling_rig_heavy, RIG_TRAVEL.drilling_rig_heavy, 20.6);
  },
  activity(bs) {
    return bs.status === 'active' ? 1 : 0;
  },
};

const frac_spread: ModelDef = {
  build(b) {
    // U-shaped layout around the wellhead (centre 3×3 left free)
    const s = 0.55;
    for (const [i, x] of [0.35, 1.5, 2.65].entries()) {
      const col = i % 2 ? C.RED : b.company;
      b.push().translate(x, 0, -2.5 + 3.1 * s).rotY(Math.PI / 2).scale(s);
      fracPumpTruck(b, 0, 0, 0, 0, col);
      b.pop();
      b.push().translate(x, 0, 2.5 - 3.1 * s).rotY(-Math.PI / 2).scale(s);
      fracPumpTruck(b, 0, 0, 0, 0, i % 2 ? b.company : C.RED);
      b.pop();
    }
    // sand silos + blender on the -x side
    b.push().translate(-2.75, 0, -1.55).scale(0.75);
    sandSilo(b, 0, 0, 0, 0);
    b.pop();
    b.push().translate(-2.75, 0, 1.55).scale(0.75);
    sandSilo(b, 0, 0, 0, 0);
    b.pop();
    b.push().translate(-2.6, 0, 0).rotY(Math.PI / 2).scale(0.5);
    blenderTruck(b, 0, 0, 0, 0);
    b.pop();
    // missile (manifold trailer) and frac iron to the wellhead
    b.slab(0.2, 0.2, -0.3, 3.3, 0.45, 0.3, C.GUNMETAL, 'paint');
    b.cylX(1.75, 0.65, 0.12, 0.13, 3.0, C.STEEL_LIGHT, 'metal', 10);
    b.cylX(1.75, 0.65, -0.12, 0.13, 3.0, C.STEEL_LIGHT, 'metal', 10);
    for (const x of [0.35, 1.5, 2.65])
      for (const sz of [-1, 1]) b.pipe([x, 0.65, sz * 0.15], [x, 0.4, sz * 0.75], 0.06, C.RED, 'metal', 6);
    b.pipe([0.2, 0.65, 0], [-0.1, 0.9, 0], 0.08, C.STEEL_LIGHT, 'metal');
    b.pipe([-0.1, 0.9, 0], [-0.1, 1.4, 0], 0.08, C.STEEL_LIGHT, 'metal');
    // frac tree goat head over the wellhead
    b.cyl(0, 0, 0, 0.18, 1.6, C.RED, 'paint', 10);
    b.box(0, 1.7, 0, 0.5, 0.35, 0.5, C.RED, 'paint');
    b.box(0, 1.2, 0, 0.36, 0.3, 0.36, C.HAZARD, 'paint');
    b.anchor('dust', 0.5, 0.2, 0, { r: 3, rate: 3 });
    b.anchor('light', 0, 3, 0, { intensity: 1.2, range: 16 });
    lampPost(b, -3.3, -2.3, 0, 3.5, Math.PI / 4, 1);
  },
  activity(bs) {
    return bs.status === 'active' ? 1 : 0;
  },
};

export const DRILLING_MODELS: Record<string, ModelDef> = { drilling_rig_land, drilling_rig_heavy, frac_spread };
export { pumpSkid };
