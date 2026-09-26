// Processing: gas plant, crude distillation (refinery), FCC, hydrotreater & lube plant, LNG train.
import { column, controlRoom, deckRing, ringRail, exchanger, finFan, frame, furnace, hVessel, lampPost, pipeRackX, shed, stack, tank, vVessel } from '../geom/parts';
import { C } from '../palette';
import { spinY } from './common';
import { flareTower } from './production';
import type { AnimState, ModelDef } from './types';

const PIPES = [C.CRUDE_PIPE, C.STEEL_LIGHT, C.HAZARD, C.AMBER, C.SKY_BLUE, C.GREEN];

function fans(prefix: string, n: number) {
  return (a: AnimState) => {
    for (let i = 0; i < n; i++) spinY(a, `${prefix}${i}`, 2 + (i % 3) * 0.3);
  };
}

const gas_plant: ModelDef = {
  build(b) {
    b.slab(-4.48, 0, -3.98, 4.48, 0.05, 3.98, C.CONCRETE, 'rough');
    pipeRackX(b, -4.3, 4.3, -0.1, 0, 1.6, [2.2, 3.1], PIPES);
    // treating & dehydration columns
    column(b, -3.4, -2.6, 0, 8.6, 0.55, C.WHITE);
    column(b, -1.9, -2.8, 0, 7.0, 0.5, C.INSULATION);
    column(b, -0.55, -2.9, 0, 5.8, 0.4, C.WHITE);
    exchanger(b, -1.2, 0.7, -1.3, 0.3, 1.8, C.BLUE);
    // cryogenic cold box & turbo-expander
    b.slab(0.5, 0, -3.5, 2.3, 7.6, -1.6, C.STEEL_LIGHT, 'paint');
    b.slab(0.48, 6.9, -3.52, 2.32, 7.3, -1.58, b.company, 'paint');
    b.detail(() => {
      for (let y = 1; y < 7; y += 1.2) b.slab(0.47, y, -3.52, 2.33, y + 0.06, -1.58, C.STEEL, 'metal');
    });
    b.slab(2.8, 0, -3.4, 4.2, 1.2, -2.0, C.BLUE, 'paint');
    b.cylX(3.5, 1.5, -2.7, 0.35, 1.2, C.STEEL, 'metal', 12);
    b.pipe([2.3, 5.5, -2.5], [3.5, 5.5, -2.5], 0.12, C.STEEL_LIGHT, 'metal', 8);
    b.pipe([3.5, 5.5, -2.5], [3.5, 1.8, -2.6], 0.12, C.STEEL_LIGHT, 'metal', 8);
    // fin-fan cooler bank (south)
    finFan(b, -2.2, 2.4, 2.2, 3.8, 2.0, 3, 'fan');
    // sulfur recovery: reaction furnace + sulfur pit
    hVessel(b, 1.1, 0.9, 2.6, 0.55, 2.0, 'x', C.RED_DARK);
    b.slab(0.4, 0, 3.3, 2.2, 0.35, 3.95, C.HAZARD, 'rough');
    b.slab(0.5, 0.35, 3.4, 2.1, 0.37, 3.85, 0xf2e21e, 'paint');
    // control room & flare
    controlRoom(b, 2.6, 1.0, 4.4, 3.9, 2.6, 101, 'w');
    flareTower(b, 4.0, -3.6, 0, 9.4, 0.25);
    b.anchor('flare', 4.0, 9.45, -3.6, { scale: 0.7, pilot: 0.12 });
    b.anchor('light', 0, 3.5, 0, { intensity: 1.2, range: 14 });
    b.anchor('light', -3, 5, -2, { intensity: 0.8, range: 10 });
    lampPost(b, 4.3, 0.6, 0, 3.4, Math.PI, 1);
  },
  animate: fans('fan', 3),
};

const refinery: ModelDef = {
  build(b) {
    b.slab(-4.98, 0, -4.98, 4.98, 0.05, 4.98, C.CONCRETE, 'rough');
    // atmospheric column (tall) & vacuum column (fat, swaged)
    column(b, -3.3, -3.0, 0, 15.4, 0.78, C.INSULATION, 3.0);
    b.cyl(-1.0, 0, -3.3, 1.2, 0.9, C.CONCRETE_DARK, 'rough', 16);
    b.cyl(-1.0, 0.9, -3.3, 1.1, 5.2, C.STEEL_LIGHT, 'paint', 18);
    b.cyl(-1.0, 6.1, -3.3, 1.1, 1.0, C.STEEL_LIGHT, 'paint', 18, 0.7);
    b.cyl(-1.0, 7.1, -3.3, 0.7, 3.4, C.STEEL_LIGHT, 'paint', 16);
    b.dome(-1.0, 10.5, -3.3, 0.7, C.STEEL_LIGHT, 'paint', 16, 0.35);
    for (const y of [3.2, 6.4, 9.2]) {
      deckRing(b, -1.0, y, -3.3, y > 7 ? 1.35 : 1.75, 0.65);
      ringRail(b, -1.0, y, -3.3, y > 7 ? 1.3 : 1.7);
    }
    b.box(-1.0 + 1.5, 3.6, -3.3, 0.12, 0.12, 0.12, C.LAMP_WARM, 'lamp');
    // crude heater with two stacks
    furnace(b, 0.8, -4.7, 4.5, -2.4, 3.2, 2, 7.5);
    // main pipe rack
    pipeRackX(b, -4.8, 4.8, -1.2, 0, 1.8, [2.4, 3.4, 4.4], PIPES);
    finFan(b, 2.2, -1.2, 4.6, 4.2, 1.9, 3, 'fan');
    // exchanger structure
    frame(b, -4.7, 0.2, -0.6, 2.4, [2.0, 4.0]);
    exchanger(b, -2.6, 0.6, 0.8, 0.32, 3.0, C.BLUE);
    exchanger(b, -2.6, 0.6, 1.8, 0.32, 3.0, C.BLUE);
    exchanger(b, -2.6, 2.55, 1.3, 0.35, 3.2, C.GREEN);
    hVessel(b, -2.6, 4.55, 1.3, 0.4, 2.8, 'x', C.WHITE);
    // product tanks
    for (const x of [-3.8, -1.6]) tank(b, { x, z: 3.7, r: 1.0, h: 3.0, color: C.WHITE, seg: 16 });
    vVessel(b, 0.4, 3.8, 0, 0.55, 3.8, C.WHITE);
    // control room & flare
    controlRoom(b, 1.4, 1.2, 4.7, 3.0, 2.8, 111, 's');
    flareTower(b, 4.3, 4.3, 0, 16.4, 0.3);
    b.anchor('flare', 4.3, 16.45, 4.3, { scale: 0.85, pilot: 0.14 });
    // lots of night lighting
    for (const [x, y, z] of [
      [-3.3, 6, -1.8],
      [-1, 7, -1.9],
      [2.6, 3.6, -1.2],
      [-2.6, 4.5, 2.3],
      [2.6, 3.2, 4.2],
    ])
      b.anchor('light', x, y, z, { intensity: 1.1, range: 14 });
    for (const [x, z] of [
      [-4.7, -1.2],
      [4.7, -1.2],
      [0, 4.8],
    ])
      lampPost(b, x, z, 0, 4.2, x < 0 ? 0 : Math.PI, 1);
  },
  animate: fans('fan', 3),
};

const fcc_unit: ModelDef = {
  build(b) {
    b.slab(-3.48, 0, -3.48, 3.48, 0.05, 3.48, C.CONCRETE, 'rough');
    frame(b, -3.3, -3.3, 0.9, 0.9, [3.0, 6.0, 9.0]);
    // regenerator (fat) & reactor (slim, higher), with riser & standpipes
    b.cyl(-2.1, 3.0, -2.1, 1.15, 5.8, C.STEEL_LIGHT, 'paint', 18);
    b.dome(-2.1, 8.8, -2.1, 1.15, C.STEEL_LIGHT, 'paint', 18, 0.6);
    b.cyl(-2.1, 9.3, -2.1, 0.3, 1.8, C.STEEL, 'metal', 10);
    b.cyl(-0.1, 9.0, -1.0, 0.72, 5.2, C.STEEL_LIGHT, 'paint', 16);
    b.dome(-0.1, 14.2, -1.0, 0.72, C.STEEL_LIGHT, 'paint', 16, 0.4);
    b.cyl(-0.1, 9.0, -1.0, 0.74, 0.5, b.company, 'paint', 16);
    b.pipe([-1.2, 4.0, -1.5], [-0.3, 9.1, -1.0], 0.22, C.STEEL, 'metal', 10);
    b.pipe([-0.1, 9.0, -1.0], [-1.4, 5.0, -2.0], 0.2, C.STEEL, 'metal', 10);
    b.pipe([-0.1, 14.6, -1.0], [2.4, 14.6, -1.0], 0.22, C.STEEL, 'metal', 10);
    b.pipe([2.4, 14.6, -1.0], [2.4, 12.6, -1.8], 0.22, C.STEEL, 'metal', 10);
    // main fractionator
    column(b, 2.4, -2.2, 0, 12.6, 0.7, C.INSULATION, 3.0);
    // CO boiler / precipitator + flue gas stack
    b.slab(-3.2, 0, 1.4, 0.8, 3.6, 3.3, C.STEEL, 'paint');
    b.slab(-3.22, 3.2, 1.38, 0.82, 3.6, 3.32, b.company, 'paint');
    b.detail(() => {
      for (let x = -3.0; x < 0.8; x += 0.5) b.box(x, 1.8, 3.31, 0.06, 3.2, 0.03, C.STEEL_LIGHT, 'paint');
    });
    b.slab(0.8, 2.4, 2.0, 2.0, 3.2, 2.8, C.STEEL, 'paint');
    stack(b, 2.6, 2.4, 0, 18, 0.55);
    b.anchor('smoke', 2.6, 18.1, 2.4, { r: 0.6, rate: 1.2, dark: 0.25 });
    b.pipe([-2.1, 10.5, -2.1], [-2.1, 11.2, 0.5], 0.3, C.STEEL, 'metal', 10);
    b.pipe([-2.1, 11.2, 0.5], [-1.5, 3.6, 2.2], 0.3, C.STEEL, 'metal', 10);
    b.anchor('light', -1, 9.5, 0.9, { intensity: 1.2, range: 14 });
    b.anchor('light', 1.5, 3.5, -1.5, { intensity: 0.9, range: 10 });
    lampPost(b, 3.2, 0.3, 0, 4, Math.PI, 1);
  },
};

const lube_plant: ModelDef = {
  build(b) {
    b.slab(-3.48, 0, -2.98, 3.48, 0.05, 2.98, C.CONCRETE, 'rough');
    vVessel(b, -2.6, -1.9, 0, 0.72, 7.2, C.STEEL_LIGHT, 0.8);
    vVessel(b, -0.95, -1.9, 0, 0.72, 6.6, C.STEEL_LIGHT, 0.8);
    for (const x of [-2.6, -0.95]) b.cyl(x, 3.2, -1.9, 0.74, 0.35, b.company, 'paint', 14);
    furnace(b, 0.4, -2.85, 2.5, -1.25, 2.4, 1, 5);
    column(b, 3.0, -2.0, 0, 9.6, 0.42, C.INSULATION, 3.0);
    pipeRackX(b, -3.3, 3.3, -0.3, 0, 1.2, [2.2, 3.1], PIPES);
    // drum filling hall with drums on pallets
    shed(b, { x0: -3.3, z0: 0.6, x1: 0.1, z1: 2.8, h: 2.6, wall: C.SAND, roof: C.STEEL, windows: 'n', windowY: 1.6, door: 'e', seed: 121 });
    b.box(-1.6, 1.9, 2.83, 2.4, 0.45, 0.05, C.GUNMETAL, 'paint');
    b.sign(-1.6, 1.9, 2.86, 2.3, 0.42);
    b.detail(() => {
      for (let i = 0; i < 3; i++)
        for (let k = 0; k < 2; k++) {
          const x = 0.6 + i * 0.5;
          const z = 2.1 + k * 0.45;
          b.box(x, 0.08, z, 0.45, 0.1, 0.42, C.WOOD, 'rough');
          b.cyl(x, 0.13, z, 0.17, 0.5, (i + k) % 2 ? C.BLUE : C.AMBER, 'paint', 10);
        }
    });
    for (const x of [2.1, 3.0]) tank(b, { x, z: 1.4, r: 0.42, h: 2.4, color: C.WHITE, band: null, ladder: false, seg: 12 });
    b.slab(1.6, 0, 2.3, 3.4, 0.3, 2.9, 0xf2e21e, 'rough');
    b.anchor('light', 0, 3.4, -0.3, { intensity: 1, range: 12 });
    lampPost(b, 3.3, 0.5, 0, 3.4, Math.PI, 0.8);
  },
};

const lng_plant: ModelDef = {
  build(b) {
    b.slab(-5.98, 0, -4.98, 5.98, 0.05, 4.98, C.CONCRETE, 'rough');
    // full-containment LNG tank
    const tx = 3.1;
    const tz = -1.4;
    b.cyl(tx, 0, tz, 2.75, 0.35, C.CONCRETE_DARK, 'rough', 32);
    b.cyl(tx, 0.35, tz, 2.6, 6.6, 0xdad7cf, 'rough', 32);
    b.dome(tx, 6.95, tz, 2.6, 0xdad7cf, 'rough', 32, 1.0);
    b.cyl(tx, 5.2, tz, 2.62, 0.5, b.company, 'paint', 32);
    b.detail(() => {
      for (let y = 1.2; y < 6.9; y += 1.1) b.ring(tx, y, tz, 2.61, 0.02, 0xc4c0b7, 'rough', 32);
    });
    b.slab(tx - 0.8, 7.7, tz - 0.6, tx + 0.8, 8.0, tz + 0.6, C.STEEL_DARK, 'metal');
    for (const dx of [-0.4, 0, 0.4]) b.cyl(tx + dx, 8.0, tz, 0.1, 0.6, C.STEEL, 'metal', 6);
    b.pipe([tx - 0.4, 8.2, tz], [tx - 3.6, 8.2, tz], 0.14, C.WHITE, 'paint', 8);
    b.pipe([tx - 3.6, 8.2, tz], [tx - 3.6, 3.6, tz + 0.5], 0.14, C.WHITE, 'paint', 8);
    // stair tower up the tank
    for (const dz of [-0.35, 0.35]) b.box(tx + 2.9, 3.8, tz + dz, 0.08, 7.6, 0.08, C.STEEL_DARK, 'paint');
    b.detail(() => {
      for (let y = 0.4; y < 7.6; y += 0.4) b.box(tx + 2.9, y, tz, 0.3, 0.04, 0.7, C.STEEL, 'metal');
    });
    // main cryogenic heat exchanger + cold boxes + acid gas removal
    column(b, -1.3, -3.4, 0, 13.6, 0.8, C.WHITE, 3.4);
    b.slab(-3.4, 0, -4.7, -2.2, 9.2, -3.3, C.STEEL_LIGHT, 'paint');
    b.slab(-3.42, 8.4, -4.72, -2.18, 8.8, -3.28, b.company, 'paint');
    column(b, -4.9, -3.9, 0, 9.2, 0.55, C.INSULATION, 3.0);
    // air-cooler bank on a pipe rack
    pipeRackX(b, -5.8, 0.4, -0.8, 0, 1.8, [2.4, 3.4], PIPES);
    finFan(b, -2.7, -0.8, 3.6, 6.0, 1.9, 5, 'fan');
    // refrigerant compressor hall with turbine exhausts
    shed(b, { x0: -5.8, z0: 1.4, x1: -1.2, z1: 4.8, h: 3.6, wall: C.STEEL_LIGHT, roof: C.STEEL, windows: 'e', windowY: 2.4, windowH: 0.6, door: 'e', seed: 131 });
    for (const x of [-4.8, -2.4]) {
      b.cyl(x, 3.6, 3.8, 0.4, 3.6, C.STEEL, 'paint', 12);
      b.anchor('steam', x, 7.3, 3.8, { r: 0.4, rate: 0.7 });
      b.slab(x - 0.6, 3.6, 1.8, x + 0.6, 4.6, 2.8, C.STEEL, 'metal');
    }
    // loading line & flare
    b.pipe([0.4, 2.9, 3.8], [5.9, 2.9, 3.8], 0.14, C.WHITE, 'paint', 8);
    flareTower(b, 5.3, 4.3, 0, 14.4, 0.3);
    b.anchor('flare', 5.3, 14.45, 4.3, { scale: 0.85, pilot: 0.12 });
    controlRoom(b, 0.4, 2.4, 3.8, 4.7, 2.6, 132, 'w');
    b.anchor('light', -2.7, 5, -0.8, { intensity: 1.2, range: 16 });
    b.anchor('light', 3, 8.5, -1.4, { intensity: 0.8, range: 12 });
    lampPost(b, 0.8, -4.7, 0, 4.2, Math.PI / 2, 1);
  },
  animate: fans('fan', 5),
};

export const PROCESSING_MODELS: Record<string, ModelDef> = { gas_plant, refinery, fcc_unit, lube_plant, lng_plant };
