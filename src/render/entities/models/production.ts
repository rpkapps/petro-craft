// Production facilities: flare stack, evaporation pit, disposal well, water treatment plant.
import type { Builder } from '../geom/Builder';
import { deckRing, hVessel, ladder, lampPost, platform, pumpSkid, railing, ringRail, shed, tank } from '../geom/parts';
import { C } from '../palette';
import { fence, fillFraction } from './common';
import type { ModelDef } from './types';

/** Flare stack body: tapered stack, tip, platforms, pilot line, guy wires. Tip at (x, top, z). */
export function flareTower(b: Builder, x: number, z: number, y0: number, top: number, r = 0.32): void {
  const h = top - y0;
  b.cyl(x, y0, z, r * 1.6, 0.4, C.CONCRETE_DARK, 'rough', 12);
  b.cyl(x, y0 + 0.4, z, r, h - 1.2, C.STEEL_LIGHT, 'paint', 12, r * 0.7);
  for (const f of [0.35, 0.7]) b.cyl(x, y0 + h * f, z, r * 1.02, 0.4, C.RED, 'paint', 12);
  // tip: wider burner with wind shield
  b.cyl(x, top - 0.8, z, r * 0.72, 0.5, C.GUNMETAL, 'metal', 12, r * 0.95);
  b.cyl(x, top - 0.3, z, r * 0.95, 0.3, C.RUST, 'metal', 12, r * 1.05);
  b.pipe([x + r * 0.9, y0 + 0.5, z], [x + r * 0.9, top - 0.2, z], 0.04, C.STEEL, 'metal', 5);
  // platform & ladder near the top
  deckRing(b, x, top - 1.6, z, r + 0.8, 0.7);
  ringRail(b, x, top - 1.6, z, r + 0.75);
  ladder(b, x - r - 0.1, y0 + 0.4, z, h - 2.0, 0, true);
  b.box(x + r + 0.1, top - 0.9, z, 0.12, 0.12, 0.12, C.LAMP_RED, 'blink');
}

const flare_stack: ModelDef = {
  build(b, p) {
    const top = p.h + 0.6;
    flareTower(b, 0, 0, 0, top);
    // guy wires to the corners
    b.detail(() => {
      for (const [gx, gz] of [
        [-0.95, -0.95],
        [0.95, -0.95],
        [-0.95, 0.95],
        [0.95, 0.95],
      ]) {
        b.pipe([gx, 0.05, gz], [0, top * 0.62, 0], 0.012, C.STEEL_DARK, 'metal', 3);
        b.box(gx, 0.08, gz, 0.2, 0.16, 0.2, C.CONCRETE, 'rough');
      }
    });
    // knock-out drum and inlet
    hVessel(b, 0.35, 0.45, -0.55, 0.3, 1.0, 'x', C.STEEL_LIGHT);
    b.pipe([-0.1, 0.45, -0.55], [-0.1, 0.45, -1.0], 0.1, C.HAZARD, 'metal', 8);
    b.anchor('flare', 0, top + 0.05, 0, { scale: 1, pilot: 0.1 });
  },
  activity(bs) {
    let gas = 0;
    for (const [k, v] of Object.entries(bs.io)) if (k.includes('gas') && v < 0) gas -= v;
    const byIo = gas > 0 ? Math.min(1, 0.2 + gas / 4000) : 0;
    return Math.max(byIo, bs.utilization > 0.01 ? 0.15 + 0.85 * bs.utilization : 0);
  },
};

const water_pit: ModelDef = {
  build(b) {
    // earthen berm with liner, liquid surface animated with fill level
    const R = 2.45;
    const inner = 1.75;
    b.slab(-R, 0, -R, R, 0.25, R, 0x8a7a5a, 'rough');
    for (const [rx, rz, sx, sz] of [
      [0, -1, 2 * R, R - inner],
      [0, 1, 2 * R, R - inner],
      [-1, 0, R - inner, 2 * inner],
      [1, 0, R - inner, 2 * inner],
    ]) {
      const cx = rx * (R + inner) / 2;
      const cz = rz * (R + inner) / 2;
      b.box(cx, 0.45, cz, sx, 0.4, sz, 0x8a7a5a, 'rough');
    }
    // liner visible on the inner slopes
    b.slab(-inner, 0.2, -inner, inner, 0.26, inner, C.BLACK, 'rough');
    for (const s of [-1, 1]) {
      b.slab(-inner, 0.26, s * inner - 0.06, inner, 0.66, s * inner + 0.06, C.BLACK, 'rough');
      b.slab(s * inner - 0.06, 0.26, -inner, s * inner + 0.06, 0.66, inner, C.BLACK, 'rough');
    }
    b.group('surf', 0, 0.3, 0, () => {
      b.floor(0, 0, 0, inner * 2 - 0.1, inner * 2 - 0.1, C.BRINE, 'liquid');
    });
    // inlet pipe & fence
    b.pipe([-R + 0.1, 0.8, 0], [-inner + 0.2, 0.8, 0], 0.08, C.SKY_BLUE, 'metal', 8);
    b.pipe([-inner + 0.2, 0.8, 0], [-inner + 0.4, 0.5, 0], 0.08, C.SKY_BLUE, 'metal', 8);
    fence(b, -R + 0.05, -R + 0.05, R - 0.05, R - 0.05, 1.1);
    b.box(R - 0.3, 1.0, R - 0.05, 0.5, 0.35, 0.03, C.HAZARD, 'paint');
  },
  ambient: true,
  animate(a) {
    const s = a.node('surf');
    if (!s) return;
    const target = 0.28 + 0.36 * fillFraction(a.b, 6000);
    s.position.y += (target - s.position.y) * Math.min(1, a.dt * 0.5);
  },
  activity() {
    return 1;
  },
};

const disposal_well: ModelDef = {
  build(b) {
    // gun-barrel tanks, injection pump house, wellhead
    tank(b, { x: -0.85, z: -0.8, r: 0.6, h: 3.2, color: C.BEIGE, band: null, ladder: false, seg: 14 });
    tank(b, { x: -0.85, z: 0.75, r: 0.6, h: 3.2, color: C.BEIGE, band: null, ladder: false, seg: 14 });
    b.pipe([-0.85, 3.0, -0.8], [-0.85, 3.0, 0.75], 0.06, C.STEEL, 'metal', 6);
    shed(b, { x0: 0.2, z0: -1.45, x1: 1.45, z1: 0.2, h: 1.9, wall: C.CREAM, roof: C.STEEL, windows: 'e', windowY: 1.0, windowH: 0.4, door: 's', seed: 51, roofUnits: false });
    pumpSkid(b, 0.8, 0, 0.8, 0, C.BLUE, 0.6);
    // injection wellhead
    b.cyl(0.9, 0, 1.0, 0.25, 0.06, C.CONCRETE_DARK, 'rough', 10);
    b.cyl(0.35, 0, 1.1, 0.12, 0.8, C.BLUE, 'paint', 8);
    b.box(0.35, 0.9, 1.1, 0.25, 0.22, 0.25, C.BLUE, 'paint');
    b.wheel(0.35, 1.1, 1.26, 0.09, 'z', C.HAZARD);
    b.pipe([0.8, 0.8, 0.8], [0.35, 0.8, 1.1], 0.05, C.SKY_BLUE, 'metal', 6);
    b.pipe([-0.25, 0.5, 0.75], [0.35, 0.5, 0.75], 0.07, C.SKY_BLUE, 'metal', 6);
    b.cyl(1.2, 1.9, -1.1, 0.06, 0.8, C.STEEL, 'metal', 6);
    lampPost(b, 1.3, 1.3, 0, 2.8, Math.PI * 1.25, 0.6);
  },
};

const water_treatment: ModelDef = {
  build(b) {
    // two open clarifiers with rotating bridges
    for (const [i, [x, z]] of [
      [-1.5, -1.5],
      [1.5, -1.5],
    ].entries()) {
      b.cyl(x, 0, z, 1.35, 1.1, C.CONCRETE, 'rough', 24);
      b.cyl(x, 0.95, z, 1.22, 0.02, C.WATER, 'liquid', 24);
      b.cyl(x, 0, z, 0.15, 1.35, C.STEEL, 'metal', 8);
      b.group(`bridge${i}`, x, 1.3, z, () => {
        b.box(0.65, 0.05, 0, 1.35, 0.1, 0.35, C.STEEL_DARK, 'metal');
        railing(b, 0, -0.17, 1.35, -0.17, 0.1, C.HAZARD);
        b.box(1.3, -0.15, 0, 0.2, 0.35, 0.3, C.BLUE, 'paint');
        b.box(0.6, -0.3, 0, 1.2, 0.04, 0.04, C.STEEL_LIGHT, 'metal');
      });
    }
    // treatment building
    shed(b, { x0: -2.9, z0: 0.3, x1: 0.5, z1: 2.9, h: 3.0, wall: C.WHITE, roof: C.STEEL, trim: C.SKY_BLUE, windows: 'se', windowY: 1.2, door: 's', seed: 61 });
    b.box(-1.2, 2.5, 2.93, 2.4, 0.4, 0.05, C.GUNMETAL, 'paint');
    b.sign(-1.2, 2.5, 2.96, 2.3, 0.38);
    // filter vessels & chemical tanks
    for (const z of [0.6, 1.5, 2.4]) {
      b.cyl(1.4, 0, z, 0.35, 2.2, C.SKY_BLUE, 'paint', 12);
      b.dome(1.4, 2.2, z, 0.35, C.SKY_BLUE, 'paint', 12, 0.18);
    }
    b.cyl(2.45, 0, 1.9, 0.4, 1.4, C.WHITE, 'paint', 12);
    b.cyl(2.45, 0, 0.8, 0.4, 1.4, C.HAZARD, 'paint', 12);
    b.pipe([1.05, 1.8, 0.6], [1.05, 1.8, 2.4], 0.07, C.SKY_BLUE, 'metal', 8);
    b.pipe([-1.5, 0.9, -0.15], [1.05, 0.9, -0.15], 0.08, C.SKY_BLUE, 'metal', 8);
    b.pipe([-1.5, 0.9, -0.15], [-1.5, 0.9, 0.3], 0.08, C.SKY_BLUE, 'metal', 8);
    lampPost(b, 2.8, -2.8, 0, 3.2, Math.PI * 0.75, 0.8);
  },
  animate(a) {
    for (const n of ['bridge0', 'bridge1']) {
      const g = a.node(n);
      if (g) g.rotation.y += a.dt * 0.12 * a.speed;
    }
  },
};

export const PRODUCTION_MODELS: Record<string, ModelDef> = { flare_stack, water_pit, disposal_well, water_treatment };
