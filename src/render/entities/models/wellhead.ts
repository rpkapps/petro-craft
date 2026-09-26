// Wellhead: christmas tree + test separator, with artificial-lift variants:
// pumpjack (full four-bar kinematics), ESP (VSD panel + transformer), gas lift (compressor skid),
// injector skid, and a plugged/abandoned marker.
import type { Builder } from '../geom/Builder';
import { hVessel, railing } from '../geom/parts';
import { C } from '../palette';
import { spinY } from './common';
import type { AnimState, ModelDef } from './types';

/** Christmas tree centred at the origin. */
function xmasTree(b: Builder, color: number = C.RED): void {
  b.cyl(0, 0, 0, 0.55, 0.08, C.CONCRETE_DARK, 'rough', 14);
  b.cyl(0, 0.08, 0, 0.32, 0.22, C.STEEL_DARK, 'metal', 12); // casing head
  b.cyl(0, 0.3, 0, 0.26, 0.14, C.STEEL, 'metal', 12);
  b.cyl(0, 0.44, 0, 0.14, 0.14, C.STEEL, 'metal', 10);
  // master valves
  for (const y of [0.62, 0.95]) {
    b.box(0, y, 0, 0.3, 0.28, 0.3, color, 'paint');
    b.cylX(0.26, y, 0, 0.04, 0.24, C.STEEL_LIGHT, 'metal', 6);
    b.wheel(0.4, y, 0, 0.12, 'x', C.HAZARD);
  }
  // cross with wing valves
  b.box(0, 1.25, 0, 0.26, 0.26, 0.26, C.STEEL, 'metal');
  for (const s of [-1, 1]) {
    b.cylZ(0, 1.25, s * 0.28, 0.07, 0.3, C.STEEL, 'metal', 8);
    b.box(0, 1.25, s * 0.5, 0.24, 0.24, 0.2, color, 'paint');
    b.cyl(0, 1.37, s * 0.5, 0.03, 0.16, C.STEEL_LIGHT, 'metal', 6);
    b.wheel(0, 1.55, s * 0.5, 0.1, 'z', C.HAZARD);
  }
  // choke + flowline toward -z edge (port side), down to grade
  b.cylZ(0, 1.25, -0.8, 0.07, 0.4, C.STEEL, 'metal', 8);
  b.box(0, 1.25, -1.0, 0.18, 0.18, 0.16, C.HAZARD, 'paint');
  b.pipe([0, 1.25, -1.08], [0, 0.35, -1.08], 0.07, C.STEEL, 'metal', 8);
  b.pipe([0, 0.35, -1.08], [0, 0.35, -1.5], 0.07, C.STEEL, 'metal', 8);
  // swab valve & gauge
  b.box(0, 1.53, 0, 0.22, 0.24, 0.22, color, 'paint');
  b.wheel(0.26, 1.53, 0, 0.09, 'x', C.HAZARD);
  b.cyl(0, 1.65, 0, 0.06, 0.12, C.STEEL, 'metal', 8);
  b.detail(() => {
    b.cyl(0, 1.77, 0, 0.03, 0.12, C.STEEL, 'metal', 6);
    b.push().translate(0, 1.95, 0).rotX(Math.PI / 2);
    b.cyl(0, -0.02, 0, 0.08, 0.04, C.WHITE, 'paint', 10);
    b.pop();
  });
}

/** Rod-pumping wellhead: casing head, pumping tee, stuffing box (the polished rod slides in). */
function rodTree(b: Builder): void {
  b.cyl(0, 0, 0, 0.55, 0.08, C.CONCRETE_DARK, 'rough', 14);
  b.cyl(0, 0.08, 0, 0.3, 0.2, C.STEEL_DARK, 'metal', 12);
  b.cyl(0, 0.28, 0, 0.2, 0.14, C.STEEL, 'metal', 12);
  b.box(0, 0.55, 0, 0.26, 0.26, 0.26, C.RED, 'paint');
  b.cylZ(0, 0.55, -0.4, 0.07, 0.55, C.STEEL, 'metal', 8);
  b.box(0, 0.55, -0.55, 0.2, 0.2, 0.16, C.HAZARD, 'paint');
  b.wheel(0, 0.75, -0.55, 0.08, 'z', C.HAZARD);
  b.pipe([0, 0.55, -0.65], [0, 0.35, -1.0], 0.07, C.STEEL, 'metal', 8);
  b.pipe([0, 0.35, -1.0], [0, 0.35, -1.5], 0.07, C.STEEL, 'metal', 8);
  b.cyl(0, 0.68, 0, 0.1, 0.27, C.STEEL_LIGHT, 'metal', 10);
}

/** Test separator & meter run on the +x/+z side. */
function testSeparator(b: Builder): void {
  b.slab(0.45, 0, 0.45, 1.45, 0.12, 1.45, C.STEEL_DARK, 'paint');
  b.cyl(0.95, 0.12, 0.95, 0.3, 1.25, C.WHITE, 'paint', 12);
  b.dome(0.95, 1.37, 0.95, 0.3, C.WHITE, 'paint', 12, 0.15);
  b.cyl(0.95, 0.12, 0.95, 0.31, 0.12, b.company, 'paint', 12);
  b.pipe([0.95, 1.1, 0.65], [0.95, 1.1, 0.3], 0.05, C.STEEL, 'metal', 6);
  b.pipe([0.95, 1.1, 0.3], [0.3, 1.1, 0.3], 0.05, C.STEEL, 'metal', 6);
  b.detail(() => {
    b.box(1.3, 0.9, 0.55, 0.15, 0.3, 0.1, C.CREAM, 'paint');
    b.box(1.3, 0.95, 0.5, 0.06, 0.06, 0.02, C.LAMP_GREEN, 'lamp');
  });
}

/** Small pad flare stack in the free (+x, −z) corner; lit by the FX layer from b.data.flareRate/ventRate. */
function padFlare(b: Builder): void {
  const x = 1.12;
  const z = -1.12;
  b.slab(x - 0.22, 0, z - 0.22, x + 0.22, 0.1, z + 0.22, C.CONCRETE, 'rough');
  b.cyl(x, 0.1, z, 0.055, 1.75, C.STEEL, 'metal', 8);
  b.cyl(x, 0.1, z, 0.09, 0.22, C.STEEL_DARK, 'metal', 8);
  b.cyl(x, 1.25, z, 0.058, 0.12, C.RED, 'paint', 8);
  b.cyl(x, 1.82, z, 0.08, 0.12, C.GUNMETAL, 'metal', 8, 0.06);
  b.pipe([x, 0.3, z], [0.45, 0.3, -0.45], 0.035, C.STEEL, 'metal', 6);
  b.anchor('wellFlare', x, 1.96, z, {});
}

function guardRail(b: Builder): void {
  b.detail(() => {
    for (const [x0, z0, x1, z1] of [
      [-0.75, -0.75, 0.75, -0.75],
      [-0.75, 0.75, 0.3, 0.75],
      [-0.75, -0.75, -0.75, 0.75],
    ])
      railing(b, x0, z0, x1, z1, 0.02, C.HAZARD);
  });
}

// ---- pumpjack geometry (frame: pumpjack extends toward -x, well at x = 0) -----------------------
const PJ = {
  P: { x: -0.95, y: 2.25 }, // walking beam pivot (samson post bearing)
  A: 0.95, // pivot → horsehead arc radius (horsehead hangs over the well)
  Cl: 0.85, // pivot → equaliser (tail)
  O: { x: -1.85, y: 0.85 }, // crank shaft centre
  R: 0.42, // crank radius
  L: 1.38, // pitman length
  zArm: 0.42,
  Lb: 0.85, // bridle length at θ = 0
};

function pumpjack(b: Builder): void {
  // rotate the whole unit so it lies along the footprint diagonal
  b.group('pj', 0, 0, 0, () => {
    b.rotY(-Math.PI / 4);
    b.group('pjFrame', 0, 0, 0, () => {
      const { P, O } = PJ;
      // base: concrete pad + steel skid
      b.slab(-2.35, 0, -0.6, 0.15, 0.12, 0.6, C.CONCRETE, 'rough');
      for (const z of [-0.4, 0.4]) b.slab(-2.3, 0.12, z - 0.08, -0.15, 0.3, z + 0.08, C.GUNMETAL, 'paint');
      for (const x of [-2.1, -1.2, -0.4]) b.slab(x - 0.07, 0.12, -0.45, x + 0.07, 0.28, 0.45, C.GUNMETAL, 'paint');
      // samson post (A-frame)
      for (const z of [-0.38, 0.38]) {
        b.beam([P.x - 0.45, 0.3, z], [P.x, P.y - 0.08, z * 0.25], 0.1, C.GUNMETAL, 'paint');
        b.beam([P.x + 0.4, 0.3, z], [P.x, P.y - 0.08, z * 0.25], 0.1, C.GUNMETAL, 'paint');
      }
      b.beam([P.x - 0.25, 1.2, -0.3], [P.x - 0.25, 1.2, 0.3], 0.06, C.GUNMETAL, 'paint');
      b.box(P.x, P.y - 0.08, 0, 0.22, 0.16, 0.34, C.STEEL_DARK, 'metal');
      // gear reducer on pedestal + prime mover with belt guard
      b.slab(O.x - 0.35, 0.28, -0.25, O.x + 0.35, 0.55, 0.25, C.GUNMETAL, 'paint');
      b.box(O.x, O.y, 0, 0.62, 0.62, 0.5, b.company, 'paint');
      b.cylZ(O.x, O.y, 0, 0.1, 1.0, C.STEEL, 'metal', 8);
      b.slab(O.x - 0.9, 0.28, -0.2, O.x - 0.45, 0.7, 0.2, C.BLUE, 'paint');
      b.slab(O.x - 0.72, 0.5, 0.22, O.x - 0.1, 0.95, 0.3, C.HAZARD, 'paint');
      // ladder on the samson post
      b.detail(() => {
        for (let y = 0.5; y < P.y - 0.3; y += 0.28) b.box(P.x + 0.36 - (y / P.y) * 0.36, y, 0, 0.04, 0.03, 0.3, C.STEEL_LIGHT, 'metal');
      });
      // walking beam + horsehead (animated about the pivot)
      b.group('beam', P.x, P.y, 0, () => {
        b.box((PJ.A - PJ.Cl) / 2 - 0.05, 0.12, 0, PJ.A + PJ.Cl - 0.1, 0.26, 0.2, b.company, 'paint');
        b.box((PJ.A - PJ.Cl) / 2 - 0.05, 0.26, 0, PJ.A + PJ.Cl - 0.1, 0.04, 0.32, b.company, 'paint');
        b.box((PJ.A - PJ.Cl) / 2 - 0.05, -0.01, 0, PJ.A + PJ.Cl - 0.1, 0.04, 0.32, b.company, 'paint');
        // equaliser bar at the tail
        b.box(-PJ.Cl, 0, 0, 0.14, 0.14, PJ.zArm * 2 + 0.16, C.GUNMETAL, 'paint');
        // horsehead: arc plate of radius A around the pivot
        const segs = 7;
        for (let i = 0; i < segs; i++) {
          const a0 = -0.55 + (i / segs) * 0.95;
          const a1 = -0.55 + ((i + 1) / segs) * 0.95;
          const r = PJ.A + 0.02;
          b.beam([Math.cos(a0) * r, Math.sin(a0) * r, 0], [Math.cos(a1) * r, Math.sin(a1) * r, 0], 0.08, C.GUNMETAL, 'paint', 0.3);
          b.beam([Math.cos(a0) * (r - 0.3), Math.sin(a0) * (r - 0.3), 0], [Math.cos(a1) * (r - 0.25), Math.sin(a1) * (r - 0.25), 0], 0.3, b.company, 'paint', 0.26);
        }
        b.beam([PJ.A - 0.35, 0.25, 0], [PJ.A - 0.3, -0.45, 0], 0.08, b.company, 'paint', 0.24);
      });
      // crank arms with counterweights (animated about the crank shaft)
      b.group('crank', O.x, O.y, 0, () => {
        for (const z of [-PJ.zArm - 0.06, PJ.zArm + 0.06]) {
          b.box(-PJ.R * 0.2, 0, z, PJ.R * 1.9, 0.16, 0.08, C.GUNMETAL, 'paint');
          b.box(-PJ.R * 0.95, 0, z, 0.5, 0.55, 0.14, C.STEEL_DARK, 'paint');
          b.box(-PJ.R * 0.95 - 0.26, 0, z, 0.03, 0.55, 0.15, C.HAZARD, 'paint');
          b.cylZ(PJ.R, 0, z, 0.06, 0.12, C.STEEL_LIGHT, 'metal', 8);
        }
      });
      // pitman arms (both sides share one transform; positioned each frame)
      b.group('pitman', O.x + PJ.R, O.y, 0, () => {
        for (const z of [-PJ.zArm, PJ.zArm]) b.box(0, PJ.L / 2, z, 0.07, PJ.L, 0.07, C.GUNMETAL, 'paint');
      });
      // bridle cables + carrier bar + polished rod
      b.group('bridle', PJ.P.x + PJ.A, PJ.P.y, 0, () => {
        for (const z of [-0.08, 0.08]) b.box(0, -0.5, z, 0.02, 1, 0.02, C.GUNMETAL, 'metal');
      });
      b.group('rod', 0, PJ.P.y - PJ.Lb, 0, () => {
        b.box(0, 0, 0, 0.1, 0.06, 0.3, C.STEEL_DARK, 'metal');
        b.cyl(0, -0.55, 0, 0.03, 0.58, C.STEEL_LIGHT, 'metal', 6);
      });
    });
  });
}

/** Solve walking-beam angle for crank angle phi (four-bar linkage). */
function beamAngle(phi: number): number {
  const kx = PJ.O.x + PJ.R * Math.cos(phi);
  const ky = PJ.O.y + PJ.R * Math.sin(phi);
  const f = (th: number) => {
    const tx = PJ.P.x - PJ.Cl * Math.cos(th);
    const ty = PJ.P.y - PJ.Cl * Math.sin(th);
    return Math.hypot(tx - kx, ty - ky) - PJ.L;
  };
  let lo = -1.1;
  let hi = 1.1;
  let flo = f(lo);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

function animatePumpjack(a: AnimState): void {
  const beam = a.node('beam');
  const crank = a.node('crank');
  if (!beam || !crank) return;
  // stroke rate: upstream's data.strokesPerMinute, else 6 + 6 × choke (stopped unless producing)
  const w = a.well;
  const spmData = a.b.data?.strokesPerMinute;
  const producing = !w || w.status === 'producing';
  const spm = typeof spmData === 'number' ? spmData : producing ? 6 + 6 * (w?.choke ?? 0.5) : 0;
  const m = a.mem;
  m.phi = ((m.phi ?? 0) - a.dt * (spm / 60) * Math.PI * 2 * a.speed) % (Math.PI * 2);
  const phi = m.phi;
  crank.rotation.z = phi;
  const th = beamAngle(phi);
  beam.rotation.z = th;
  const tx = PJ.P.x - PJ.Cl * Math.cos(th);
  const ty = PJ.P.y - PJ.Cl * Math.sin(th);
  const kx = PJ.O.x + PJ.R * Math.cos(phi);
  const ky = PJ.O.y + PJ.R * Math.sin(phi);
  const ang = Math.atan2(ty - ky, tx - kx) - Math.PI / 2;
  const p = a.node('pitman');
  if (p) {
    p.position.x = kx;
    p.position.y = ky;
    p.rotation.z = ang;
  }
  // horsehead wire wraps the arc: carrier bar rises by A·θ
  const carrier = PJ.P.y - PJ.Lb + PJ.A * th;
  const rod = a.node('rod');
  if (rod) rod.position.y = carrier;
  const bridle = a.node('bridle');
  if (bridle) bridle.scale.y = Math.max(0.1, PJ.P.y - carrier);
}

function espKit(b: Builder): void {
  // VSD control panel on a stand, pad-mount transformer, cable tray to the tree
  b.slab(-1.45, 0, -1.4, -0.35, 0.1, -0.5, C.CONCRETE, 'rough');
  b.slab(-1.35, 0.1, -1.3, -0.45, 1.5, -0.8, C.CREAM, 'paint');
  b.slab(-1.33, 1.5, -1.35, -0.47, 1.6, -0.75, C.STEEL, 'metal');
  b.box(-0.9, 0.85, -0.79, 0.8, 1.2, 0.02, C.STEEL_LIGHT, 'paint');
  b.box(-1.15, 1.25, -0.77, 0.08, 0.08, 0.02, C.LAMP_GREEN, 'lamp');
  b.box(-1.0, 1.25, -0.77, 0.08, 0.08, 0.02, C.LAMP_AMBER, 'lamp');
  b.box(-0.9, 1.0, -0.77, 0.3, 0.2, 0.02, C.GLASS, 'glass');
  b.box(-0.9, 0.55, -0.765, 0.5, 0.08, 0.02, b.company, 'paint');
  // transformer
  b.slab(-1.45, 0, 0.5, -0.45, 1.05, 1.4, C.GREEN, 'paint');
  b.detail(() => {
    for (let z = 0.6; z < 1.35; z += 0.15) b.box(-0.43, 0.55, z, 0.05, 0.8, 0.05, C.GREEN, 'paint');
    for (const z of [0.7, 0.95, 1.2]) b.cyl(-0.95, 1.05, z, 0.05, 0.25, C.CREAM, 'paint', 6);
  });
  b.box(-0.95, 0.7, 1.41, 0.3, 0.3, 0.02, C.HAZARD, 'paint');
  // cable tray
  b.slab(-0.45, 0.25, -1.05, 0.0, 0.32, -0.95, C.GALV, 'metal');
  b.pipe([0, 0.3, -1.0], [0.05, 0.9, -0.2], 0.04, C.RUBBER, 'rough', 6);
}

function gasliftKit(b: Builder): void {
  // small compressor skid with fin-fan cooler, scrubber and injection line
  b.slab(-1.45, 0, 0.4, -0.2, 0.15, 1.45, C.STEEL_DARK, 'paint');
  b.slab(-1.4, 0.15, 0.5, -0.8, 0.8, 1.4, C.BLUE, 'paint');
  b.cylX(-0.55, 0.55, 0.95, 0.22, 0.5, C.STEEL, 'metal', 10);
  b.slab(-1.4, 0.8, 0.45, -0.8, 1.35, 1.45, C.STEEL, 'metal');
  b.group('fan', -1.1, 1.36, 0.95, () => {
    b.box(0, 0.02, 0, 0.8, 0.03, 0.12, C.GUNMETAL, 'paint');
    b.box(0, 0.02, 0, 0.12, 0.03, 0.8, C.GUNMETAL, 'paint');
  });
  b.ring(-1.1, 1.38, 0.95, 0.44, 0.03, C.STEEL_LIGHT, 'metal', 16);
  b.cyl(-0.4, 0.15, 1.25, 0.16, 1.1, C.WHITE, 'paint', 10);
  b.dome(-0.4, 1.25, 1.25, 0.16, C.WHITE, 'paint', 10, 0.08);
  b.cyl(-1.3, 0.8, 0.55, 0.05, 0.6, C.STEEL_LIGHT, 'metal', 6);
  b.anchor('exhaust', -1.3, 1.45, 0.55, { rate: 3 });
  b.pipe([-0.2, 0.5, 0.9], [0.3, 0.5, 0.35], 0.05, C.STEEL, 'metal', 6);
  b.pipe([0.3, 0.5, 0.35], [0.3, 0.2, 0.1], 0.05, C.STEEL, 'metal', 6);
}

function injectorKit(b: Builder): void {
  b.slab(-1.45, 0, 0.45, -0.3, 0.12, 1.4, C.STEEL_DARK, 'paint');
  b.cylX(-0.9, 0.45, 0.9, 0.24, 0.9, C.BLUE, 'paint', 12);
  b.box(-0.35, 0.45, 0.9, 0.3, 0.4, 0.4, C.SKY_BLUE, 'paint');
  b.pipe([-0.3, 0.5, 0.9], [0.25, 0.9, 0.2], 0.05, C.SKY_BLUE, 'metal', 6);
  b.box(-1.2, 1.0, 0.6, 0.3, 0.4, 0.1, C.CREAM, 'paint');
}

/** Offshore satellite well: caisson from the seabed, small deck with the tree, nav light, boat landing. */
function wellCaisson(b: Builder, depth: number, plugged: boolean): void {
  const deck = 2.3;
  b.cyl(0, -depth - 0.3, 0, 0.5, depth + deck + 0.3, C.HAZARD, 'paint', 12);
  b.cyl(0, -0.6, 0, 0.53, 1.4, C.GUNMETAL, 'paint', 12);
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3])
    b.pipe([Math.cos(a) * 0.4, deck - 0.2, Math.sin(a) * 0.4], [Math.cos(a) * 1.3, deck - 1.4, Math.sin(a) * 1.3], 0.07, C.HAZARD, 'paint', 6);
  b.slab(-1.35, deck, -1.35, 1.35, deck + 0.18, 1.35, C.GUNMETAL, 'metal');
  railRectLocal(b, deck + 0.18);
  if (!plugged) {
    b.push().translate(0, deck + 0.18, 0);
    xmasTree(b, C.RED);
    b.pop();
  } else b.cyl(0, deck + 0.18, 0, 0.25, 0.3, C.STEEL_DARK, 'metal', 10);
  // navigation light mast & solar panel
  b.cyl(-1.1, deck + 0.18, -1.1, 0.05, 1.8, C.STEEL_LIGHT, 'metal', 6);
  b.box(-1.1, deck + 2.05, -1.1, 0.18, 0.18, 0.18, C.LAMP_AMBER, 'blink');
  b.push().translate(1.0, deck + 0.9, -1.0).rotX(-0.5);
  b.box(0, 0, 0, 0.6, 0.04, 0.45, C.PANEL, 'metal');
  b.pop();
  // boat landing at the waterline
  b.slab(0.5, -0.3, -0.6, 1.3, 0.05, 0.6, C.GUNMETAL, 'metal');
  ladderRungs(b, 0.55, 0.05, 0, deck);
  b.anchor('light', 0, deck + 1.5, 0, { intensity: 0.4, range: 8 });
}

function railRectLocal(b: Builder, y: number): void {
  b.detail(() => {
    for (const [x0, z0, x1, z1] of [
      [-1.35, -1.35, 1.35, -1.35],
      [-1.35, 1.35, 1.35, 1.35],
      [-1.35, -1.35, -1.35, 1.35],
      [1.35, -1.35, 1.35, 1.35],
    ])
      railing(b, x0, z0, x1, z1, y, C.HAZARD);
  });
}

function ladderRungs(b: Builder, x: number, y0: number, z: number, y1: number): void {
  b.detail(() => {
    for (const dz of [-0.2, 0.2]) b.box(x, (y0 + y1) / 2, z + dz, 0.05, y1 - y0, 0.05, C.STEEL_LIGHT, 'metal');
    for (let y = y0 + 0.3; y < y1; y += 0.35) b.box(x, y, z, 0.04, 0.04, 0.4, C.STEEL_LIGHT, 'metal');
  });
}

const wellhead: ModelDef = {
  variant(bs, ctx) {
    const w = bs.wellId ? ctx.state.wells[bs.wellId] : undefined;
    const cx = Math.floor(bs.x + bs.size[0] / 2);
    const cz = Math.floor(bs.z + bs.size[1] / 2);
    if (w?.offshore || ctx.geology.waterDepth(cx, cz) > 0.5) {
      const depth = Math.max(1, Math.min(90, Math.round(bs.y - ctx.geology.surfaceHeight(cx, cz))));
      return `offshore:${depth}:${w && (w.status === 'plugged' || w.status === 'dry_hole') ? 1 : 0}`;
    }
    if (!w) return 'natural';
    if (w.status === 'plugged' || w.status === 'dry_hole') return 'plugged';
    if (w.purpose.startsWith('injector') || w.purpose === 'disposal') return 'injector';
    return w.lift;
  },
  ghostVariant: 'natural',
  build(b, p) {
    const v = p.variant || 'natural';
    if (v.startsWith('offshore')) {
      const [, dStr, plugged] = v.split(':');
      wellCaisson(b, Number(dStr) || 10, plugged === '1');
      return;
    }
    if (v === 'plugged') {
      b.cyl(0, 0, 0, 0.6, 0.1, C.CONCRETE, 'rough', 14);
      b.cyl(0, 0.1, 0, 0.25, 0.25, C.STEEL_DARK, 'metal', 10);
      b.cyl(0.6, 0, 0.6, 0.05, 1.1, C.HAZARD, 'paint', 6);
      b.box(0.6, 1.0, 0.62, 0.35, 0.25, 0.03, C.STEEL_LIGHT, 'metal');
      return;
    }
    if (v === 'pumpjack') {
      rodTree(b);
      pumpjack(b);
    } else {
      xmasTree(b, v === 'injector' ? C.BLUE : C.RED);
      guardRail(b);
      testSeparator(b);
    }
    b.anchor('light', 0, 2.5, 0, { intensity: 0.3, range: 8 });
    if (v !== 'injector') padFlare(b);
    if (v === 'esp') espKit(b);
    if (v === 'gaslift') gasliftKit(b);
    if (v === 'injector') injectorKit(b);
  },
  activity(bs, ctx) {
    const w = bs.wellId ? ctx.state.wells[bs.wellId] : undefined;
    if (typeof bs.data?.strokesPerMinute === 'number') return bs.data.strokesPerMinute > 0 ? 1 : 0;
    if (!w) return bs.status === 'active' ? 1 : 0;
    return w.status === 'producing' || w.status === 'injecting' ? 1 : 0;
  },
  animate(a) {
    if (a.node('beam')) animatePumpjack(a);
    if (a.node('fan')) spinY(a, 'fan', 2.5);
  },
};

export const WELLHEAD_MODELS: Record<string, ModelDef> = { wellhead };
