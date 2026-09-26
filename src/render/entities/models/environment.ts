// Environment: carbon capture unit, spill response base.
import { column, container, finFan, lampPost, pipeRackX, shed } from '../geom/parts';
import { C } from '../palette';
import { spinY } from './common';
import type { ModelDef } from './types';
import { vacTruck } from '../vehicles/props';

const ccs_unit: ModelDef = {
  build(b) {
    b.slab(-2.98, 0, -2.98, 2.98, 0.05, 2.98, C.CONCRETE, 'rough');
    // rectangular absorber tower with packing sections
    b.slab(-2.7, 0, -2.7, -0.9, 9.4, -0.9, C.STEEL_LIGHT, 'paint');
    for (const y of [2.5, 5.0, 7.5]) b.slab(-2.75, y, -2.75, -0.85, y + 0.25, -0.85, C.GREEN, 'paint');
    b.slab(-2.75, 9.4, -2.75, -0.85, 9.6, -0.85, C.STEEL_DARK, 'metal');
    b.cyl(-1.8, 9.6, -1.8, 0.35, 0.6, C.STEEL, 'metal', 10);
    b.anchor('steam', -1.8, 10.3, -1.8, { r: 0.5, rate: 0.9 });
    // flue-gas duct
    b.slab(-2.98, 1.4, -2.3, -2.7, 2.6, -1.3, C.STEEL, 'paint');
    b.slab(-3.0, 1.35, -2.35, -2.9, 2.65, -1.25, C.STEEL_DARK, 'paint');
    // stripper & reboiler
    column(b, 1.2, -2.0, 0, 8.2, 0.55, C.WHITE, 2.8);
    b.cylX(0.1, 0.8, -0.6, 0.35, 1.6, C.STEEL_LIGHT, 'paint', 12);
    pipeRackX(b, -2.8, 2.8, 0.2, 0, 1.0, [2.0], [C.GREEN, C.STEEL_LIGHT, C.SKY_BLUE]);
    finFan(b, -1.6, 1.9, 1.8, 2.4, 1.6, 2, 'fan');
    // CO2 compressor skid & export line (green)
    b.slab(0.6, 0, 1.0, 2.8, 0.2, 2.7, C.STEEL_DARK, 'paint');
    b.slab(0.8, 0.2, 1.2, 2.0, 1.2, 2.5, C.GREEN, 'paint');
    b.cylX(2.35, 0.75, 1.85, 0.3, 0.8, C.STEEL, 'metal', 10);
    b.pipe([2.8, 0.75, 1.85], [2.98, 0.75, 1.85], 0.12, C.GREEN, 'metal', 8);
    b.box(2.2, 2.2, 2.9, 1.2, 0.4, 0.04, C.GREEN, 'paint');
    b.anchor('light', 0, 3, 0, { intensity: 0.9, range: 12 });
    lampPost(b, 2.7, -0.2, 0, 3.4, Math.PI, 0.8);
  },
  animate(a) {
    spinY(a, 'fan0', 2.1);
    spinY(a, 'fan1', 2.4);
  },
};

const spill_response: ModelDef = {
  build(b) {
    b.slab(-2.48, 0, -1.98, 2.48, 0.05, 1.98, C.CONCRETE, 'rough');
    shed(b, { x0: -2.4, z0: -1.9, x1: 0.9, z1: 0.3, h: 2.8, wall: C.HAZARD, roof: C.STEEL, trim: C.GUNMETAL, windows: 'w', windowY: 1.8, windowH: 0.5, seed: 181 });
    for (const x of [-1.5, 0.0]) {
      b.box(x, 1.1, 0.32, 1.2, 2.0, 0.05, C.GUNMETAL, 'paint');
      b.box(x, 1.05, 0.3, 1.05, 1.85, 0.04, 0x3a342c, 'paint');
    }
    b.box(-0.75, 2.45, 0.34, 2.8, 0.35, 0.05, C.GUNMETAL, 'paint');
    b.sign(-0.75, 2.45, 0.37, 2.7, 0.32);
    b.push().translate(-1.0, 0, 1.2).scale(0.75);
    vacTruck(b, 0, 0, 0, 0);
    b.pop();
    // boom reels
    for (const z of [-1.3, -0.1]) {
      for (const s of [-0.35, 0.35]) b.box(1.8, 0.45, z + s, 0.1, 0.9, 0.1, C.STEEL_DARK, 'paint');
      b.cylZ(1.8, 0.75, z, 0.5, 0.6, C.HAZARD, 'paint', 14);
      b.cylZ(1.8, 0.75, z, 0.2, 0.7, C.STEEL, 'metal', 8);
    }
    // work boat on trailer
    b.push().translate(1.6, 0, 1.35);
    b.slab(-0.9, 0.25, -0.35, 0.9, 0.35, 0.35, C.GUNMETAL, 'paint');
    b.box(0, 0.62, 0, 1.6, 0.45, 0.6, C.WHITE, 'paint');
    b.box(0.1, 0.62, 0, 1.62, 0.1, 0.62, b.company, 'paint');
    b.box(-0.3, 1.0, 0, 0.5, 0.35, 0.45, C.WHITE, 'paint');
    b.cylZ(0, 0.18, 0, 0.17, 0.75, C.RUBBER, 'rough', 8);
    b.pop();
    container(b, 1.9, 0, -1.6, 0, C.BLUE, 0.35);
    lampPost(b, 2.3, 1.8, 0, 3, Math.PI * 1.25, 0.8);
  },
};

export const ENVIRONMENT_MODELS: Record<string, ModelDef> = { ccs_unit, spill_response };
