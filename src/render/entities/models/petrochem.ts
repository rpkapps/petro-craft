// Petrochemicals: steam cracker (furnace bank), polymer plant (silos), ammonia & methanol plant.
import type { Builder } from '../geom/Builder';
import { column, controlRoom, frame, furnace, ladder, lampPost, latticeMast, pipeRackX, shed, vVessel } from '../geom/parts';
import { C } from '../palette';
import type { ModelDef } from './types';

const PIPES = [C.CRUDE_PIPE, C.STEEL_LIGHT, C.HAZARD, C.AMBER, C.SKY_BLUE, C.GREEN];

const steam_cracker: ModelDef = {
  build(b) {
    b.slab(-4.98, 0, -3.98, 4.98, 0.05, 3.98, C.CONCRETE, 'rough');
    // bank of cracking furnaces, one stack each
    for (let i = 0; i < 4; i++) {
      const x0 = -4.8 + i * 2.2;
      furnace(b, x0, -3.85, x0 + 1.9, -1.55, 4.6, 1, 5.8, i % 2 ? C.STEEL_LIGHT : C.WHITE);
    }
    // transfer line headers
    b.pipe([-4.6, 6.8, -1.3], [3.6, 6.8, -1.3], 0.2, C.STEEL, 'metal', 10);
    // quench tower
    column(b, 4.25, -2.9, 0, 9.4, 0.72, C.INSULATION, 3.0);
    pipeRackX(b, -4.8, 4.8, -0.3, 0, 1.6, [2.5, 3.5], PIPES);
    // cold-end columns
    column(b, -3.9, 2.6, 0, 13.8, 0.52, C.WHITE, 3.2);
    column(b, -2.5, 2.9, 0, 11.2, 0.6, C.INSULATION, 3.2);
    column(b, -1.1, 2.9, 0, 9.0, 0.48, C.WHITE, 3.0);
    // cracked gas compressor house
    shed(b, { x0: 0.4, z0: 1.3, x1: 4.8, z1: 3.9, h: 3.2, wall: C.STEEL_LIGHT, roof: C.STEEL, windows: 'ws', windowY: 2.0, windowH: 0.6, door: 'w', seed: 141 });
    b.box(2.6, 2.6, 3.93, 2.8, 0.45, 0.05, C.GUNMETAL, 'paint');
    b.sign(2.6, 2.6, 3.96, 2.7, 0.42);
    b.anchor('light', 0, 4, -1, { intensity: 1.4, range: 16 });
    b.anchor('light', -2.5, 7, 2, { intensity: 0.9, range: 12 });
    lampPost(b, 4.7, 0.9, 0, 4, Math.PI, 1);
  },
};

/** Pellet silo with cone bottom standing on the frame at y0. */
function silo(b: Builder, x: number, z: number, y0: number, r: number, h: number, band: number): void {
  b.cyl(x, y0 - r * 1.2, z, 0.09, r * 1.2, C.WHITE, 'paint', 14, r);
  b.cyl(x, y0, z, r, h, C.WHITE, 'paint', 16);
  b.cyl(x, y0 + h * 0.7, z, r + 0.01, 0.35, band, 'paint', 16);
  b.cyl(x, y0 + h, z, r + 0.03, r * 0.35, C.WHITE, 'paint', 16, 0.12);
  // reclaim cone valve
  b.pipe([x, y0 - r * 1.2, z], [x, y0 - r * 1.2 - 0.4, z], 0.08, C.STEEL, 'metal', 6);
}

const polymer_plant: ModelDef = {
  build(b) {
    b.slab(-4.48, 0, -3.48, 4.48, 0.05, 3.48, C.CONCRETE, 'rough');
    // silo row on a steel table
    frame(b, -4.3, -3.3, 1.5, -1.7, [2.4]);
    for (let i = 0; i < 5; i++) silo(b, -3.75 + i * 1.12, -2.5, 3.1, 0.5, 6.0, i % 2 ? b.company : C.SKY_BLUE);
    b.slab(-4.3, 9.4, -2.8, 1.5, 9.6, -2.2, C.STEEL_DARK, 'metal');
    b.pipe([-4.0, 9.8, -2.5], [1.2, 9.8, -2.5], 0.1, C.STEEL_LIGHT, 'metal', 8);
    ladder(b, 1.7, 0, -2.5, 9.6, Math.PI, true);
    // loop reactor legs
    for (const x of [2.4, 3.1, 3.8]) b.cyl(x, 0, -2.6, 0.2, 8.6, C.STEEL_LIGHT, 'metal', 10);
    b.pipe([2.4, 8.6, -2.6], [3.8, 8.6, -2.6], 0.2, C.STEEL_LIGHT, 'metal', 10);
    b.pipe([2.4, 0.4, -2.6], [3.8, 0.4, -2.6], 0.2, C.STEEL_LIGHT, 'metal', 10);
    latticeMast(b, { x: 3.1, z: -2.6, y0: 0, y1: 8.8, hw0: 1.1, hw1: 1.1, hd0: 0.55, hd1: 0.55, panel: 2.2, leg: 0.1, brace: 0.04, color: C.STEEL_DARK });
    // degassing vessel & pellet conveying
    vVessel(b, 3.3, 0.9, 0, 0.62, 6.2, C.WHITE);
    for (const x of [-3.2, -1.0, 1.0]) b.pipe([x, 2.4, -1.7], [x, 3.8, 0.4], 0.07, C.STEEL, 'metal', 6);
    // extruder & bagging hall
    shed(b, { x0: -4.3, z0: 0.2, x1: 2.0, z1: 3.3, h: 4.0, wall: C.WHITE, roof: C.STEEL, trim: b.company, windows: 'e', windowY: 2.6, windowH: 0.7, door: 's', seed: 151 });
    b.box(-1.2, 3.3, 3.33, 3.4, 0.55, 0.05, C.GUNMETAL, 'paint');
    b.sign(-1.2, 3.3, 3.36, 3.3, 0.52);
    b.detail(() => {
      for (let i = 0; i < 3; i++) {
        b.box(2.8 + (i % 2) * 0.6, 0.35, 2.5 - Math.floor(i / 2) * 0.7, 0.55, 0.6, 0.55, C.WHITE, 'rough');
        b.box(2.8 + (i % 2) * 0.6, 0.06, 2.5 - Math.floor(i / 2) * 0.7, 0.6, 0.08, 0.6, C.WOOD, 'rough');
      }
    });
    b.anchor('steam', 3.3, 6.4, 0.9, { r: 0.3, rate: 0.5 });
    b.anchor('light', -1.5, 3, -1, { intensity: 1, range: 14 });
    lampPost(b, 4.3, 3.3, 0, 3.6, Math.PI * 1.25, 1);
  },
};

const ammonia_plant: ModelDef = {
  build(b) {
    b.slab(-3.98, 0, -3.98, 3.98, 0.05, 3.98, C.CONCRETE, 'rough');
    // primary reformer (tube box) with tall stack
    furnace(b, -3.8, -3.8, -0.4, -1.6, 4.0, 1, 7.2, C.STEEL_LIGHT);
    // secondary reformer & converter
    vVessel(b, 0.7, -2.8, 0, 0.55, 6.4, C.STEEL_LIGHT, 0.6);
    b.cyl(0.7, 3.0, -2.8, 0.57, 0.3, C.RED, 'paint', 14);
    vVessel(b, -1.5, 1.2, 0, 0.72, 5.5, C.GUNMETAL, 0.7);
    column(b, -3.1, 1.2, 0, 9.4, 0.55, C.WHITE, 3.0);
    pipeRackX(b, -3.8, 1.2, -0.6, 0, 1.2, [2.2, 3.0], PIPES);
    // prilling tower with head house & conveyor gallery
    b.cyl(2.6, 0, 1.9, 1.25, 0.6, C.CONCRETE_DARK, 'rough', 18);
    b.cyl(2.6, 0.6, 1.9, 1.15, 10.6, 0xdcd8cf, 'rough', 18);
    b.cyl(2.6, 8.0, 1.9, 1.17, 0.5, b.company, 'paint', 18);
    b.slab(1.6, 11.2, 0.9, 3.6, 12.2, 2.9, C.STEEL_LIGHT, 'paint');
    b.box(3.6, 11.7, 1.9, 0.04, 0.4, 1.4, C.GLASS, 'glass');
    b.box(2.6, 12.3, 1.9, 0.14, 0.14, 0.14, C.LAMP_RED, 'blink');
    b.orient([2.6, 1.2, -0.4], [2.6, 8.5, 0.8], (len) => {
      b.box(0, len / 2, 0, 0.8, len, 0.7, C.STEEL, 'paint');
    });
    b.anchor('steam', 2.6, 12.3, 1.9, { r: 0.8, rate: 1 });
    // ammonia storage bullet
    b.cylX(2.4, 0.9, -2.6, 0.55, 2.6, C.WHITE, 'paint', 14);
    b.sphere(1.1, 0.9, -2.6, 0.55, C.WHITE, 'paint', 12).sphere(3.7, 0.9, -2.6, 0.55, C.WHITE, 'paint', 12);
    controlRoom(b, -0.6, 2.4, 1.2, 3.9, 2.4, 161, 'w');
    b.anchor('light', -1, 3.5, 0, { intensity: 1, range: 12 });
    lampPost(b, 3.8, -0.8, 0, 3.6, Math.PI, 1);
  },
};

export const PETROCHEM_MODELS: Record<string, ModelDef> = { steam_cracker, polymer_plant, ammonia_plant };
