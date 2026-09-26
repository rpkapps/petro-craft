// Midstream: pump station, compressor station (spinning fin-fan coolers), gas sales meter.
import { finFan, hVessel, lampPost, pumpSkid, railing, shed } from '../geom/parts';
import { C } from '../palette';
import { fence, spinY } from './common';
import type { ModelDef } from './types';

const pump_station: ModelDef = {
  build(b) {
    b.slab(-1.45, 0, -1.45, 1.45, 0.1, 1.45, C.CONCRETE, 'rough');
    // canopy on posts
    for (const x of [-1.3, 1.3]) for (const z of [-1.3, 0.4]) b.box(x, 1.25, z, 0.1, 2.3, 0.1, C.STEEL_DARK, 'paint');
    b.slab(-1.45, 2.35, -1.45, 1.45, 2.45, 0.55, C.STEEL_LIGHT, 'metal');
    b.slab(-1.46, 2.2, -1.46, 1.46, 2.35, 0.56, b.company, 'paint');
    pumpSkid(b, -0.35, 0.1, -0.85, 0, C.BLUE, 0.8);
    pumpSkid(b, -0.35, 0.1, 0.0, 0, C.GREEN, 0.8);
    // headers per commodity (oil / water / product)
    const cols = [0x3a2a1c, C.SKY_BLUE, C.AMBER];
    cols.forEach((c, i) => {
      const z = -1.2 + i * 0.35;
      b.pipe([1.0, 0.35 + i * 0.12, z], [1.45, 0.35 + i * 0.12, z], 0.08, c, 'metal', 8);
    });
    b.pipe([0.45, 0.55, -0.85], [1.0, 0.55, -0.85], 0.08, 0x3a2a1c, 'metal', 8);
    b.pipe([0.45, 0.55, 0.0], [1.0, 0.55, 0.0], 0.08, C.SKY_BLUE, 'metal', 8);
    b.pipe([1.0, 0.35, -1.3], [1.0, 0.8, 0.2], 0.1, C.STEEL, 'metal', 8);
    // pig launcher
    b.cylX(-0.2, 0.45, 1.05, 0.14, 2.2, C.HAZARD, 'metal', 10);
    b.cylX(-1.35, 0.45, 1.05, 0.2, 0.2, C.STEEL_DARK, 'metal', 10);
    for (const x of [-1.0, 0.6]) b.box(x, 0.2, 1.05, 0.12, 0.3, 0.3, C.STEEL_DARK, 'paint');
    // control cabinet
    b.slab(0.9, 0.1, 0.9, 1.4, 1.4, 1.4, C.CREAM, 'paint');
    b.box(1.15, 1.15, 0.89, 0.08, 0.08, 0.02, C.LAMP_GREEN, 'lamp');
    b.anchor('light', 0, 2.1, -0.4, { intensity: 0.5, range: 8 });
  },
};

const compressor_station: ModelDef = {
  build(b) {
    b.slab(-2.45, 0, -1.95, 2.45, 0.1, 1.95, C.CONCRETE, 'rough');
    // open-sided compressor shelter
    for (const x of [-2.35, -0.5]) for (const z of [-1.85, 0.35]) b.box(x, 1.8, z, 0.14, 3.4, 0.14, C.STEEL_DARK, 'paint');
    b.gable(-1.42, 3.4, -0.75, 2.3, 0.6, 2.6, C.STEEL_LIGHT, 'metal');
    b.slab(-2.42, 3.2, -1.92, -0.43, 3.42, 0.42, b.company, 'paint');
    b.slab(-2.4, 1.2, -1.9, -0.45, 3.2, -1.82, C.STEEL_LIGHT, 'paint');
    // reciprocating compressors (frame + cylinders) with driver engines
    for (const z of [-1.2, -0.25]) {
      b.slab(-2.2, 0.1, z - 0.35, -0.6, 0.3, z + 0.35, C.STEEL_DARK, 'paint');
      b.slab(-2.1, 0.3, z - 0.3, -1.4, 1.0, z + 0.3, C.RED, 'paint');
      b.slab(-1.4, 0.3, z - 0.22, -0.7, 0.85, z + 0.22, C.GUNMETAL, 'paint');
      for (const s of [-1, 1]) b.cylZ(-1.05, 0.6, z + s * 0.35, 0.16, 0.3, C.STEEL_LIGHT, 'metal', 10);
      b.cyl(-1.8, 1.0, z, 0.06, 2.7, C.STEEL_LIGHT, 'metal', 6);
      b.anchor('exhaust', -1.8, 3.8, z, { rate: 4 });
    }
    // fin-fan cooler with spinning fans
    finFan(b, 1.1, -0.85, 1.4, 2.4, 1.8, 3, 'fan', 'z');
    // scrubbers and discharge piping
    for (const [x, z] of [
      [0.1, 1.2],
      [0.7, 1.4],
    ]) {
      b.cyl(x, 0.1, z, 0.3, 1.8, C.WHITE, 'paint', 12);
      b.dome(x, 1.9, z, 0.3, C.WHITE, 'paint', 12, 0.15);
    }
    b.pipe([-0.6, 0.7, -0.25], [0.1, 0.7, 1.2], 0.09, C.HAZARD, 'metal', 8);
    b.pipe([-0.6, 0.9, -1.2], [0.7, 0.9, 1.4], 0.09, C.HAZARD, 'metal', 8);
    b.pipe([1.9, 0.5, 1.2], [2.45, 0.5, 1.2], 0.12, C.HAZARD, 'metal', 8);
    b.pipe([0.7, 1.6, 1.4], [1.9, 1.6, 1.4], 0.08, C.HAZARD, 'metal', 8);
    b.pipe([1.9, 1.6, 1.4], [1.9, 0.5, 1.2], 0.08, C.HAZARD, 'metal', 8);
    railing(b, -2.45, 1.95, 2.45, 1.95, 0.1, C.GALV);
    lampPost(b, 2.3, 1.8, 0.1, 3.3, Math.PI * 1.25, 1);
  },
  animate(a) {
    for (let i = 0; i < 3; i++) spinY(a, `fan${i}`, 2.2);
  },
};

const gas_sales_meter: ModelDef = {
  build(b) {
    b.slab(-1.45, 0, -0.95, 1.45, 0.1, 0.95, C.GRAVEL, 'rough');
    // twin meter runs with flanges
    for (const z of [-0.45, 0.05]) {
      b.cylX(-0.1, 0.55, z, 0.12, 2.3, C.HAZARD, 'metal', 10);
      b.detail(() => {
        for (const x of [-1.0, -0.4, 0.3, 0.9]) b.cylX(x, 0.55, z, 0.17, 0.06, C.STEEL, 'metal', 10);
      });
      b.box(0.0, 0.55, z, 0.3, 0.3, 0.3, C.STEEL_DARK, 'metal');
      b.box(0.0, 0.85, z, 0.12, 0.3, 0.12, C.STEEL_LIGHT, 'metal');
      for (const x of [-0.9, 0.8]) b.box(x, 0.25, z, 0.1, 0.4, 0.1, C.STEEL_DARK, 'paint');
    }
    hVessel(b, -0.2, 0.5, 0.65, 0.2, 0.7, 'x', C.WHITE);
    // analyser shelter
    shed(b, { x0: 0.6, z0: 0.3, x1: 1.4, z1: 0.9, h: 1.5, wall: C.CREAM, roof: C.STEEL, trim: b.company, windows: '', seed: 71, roofUnits: false });
    b.box(1.0, 1.25, 0.91, 0.08, 0.08, 0.02, C.LAMP_GREEN, 'lamp');
    b.cyl(1.2, 1.5, 0.45, 0.03, 0.7, C.STEEL, 'metal', 5);
    b.box(-1.25, 0.5, 0.85, 0.35, 0.25, 0.02, C.HAZARD, 'paint');
    fence(b, -1.45, -0.95, 1.45, 0.95, 1.0, 'n');
  },
};

export const MIDSTREAM_MODELS: Record<string, ModelDef> = { pump_station, compressor_station, gas_sales_meter };
