// Support buildings: field office, worker camp, supply yard, research lab, maintenance depot,
// fire station, SCADA centre, weather station, helipad.
import type { Builder } from '../geom/Builder';
import { container, door, lampPost, ladder, latticeMast, pipeStack, prng, railing, shed, stairs } from '../geom/parts';
import { C } from '../palette';
import { fence, flagPole, pickup, spinY, turnToward, windSpeed, windYawLocal } from './common';
import type { ModelDef } from './types';
import { fireTruck, serviceTruck } from '../vehicles/props';

/** Portable modular building (site trailer) from (x0,z0) to (x1,z1). */
function trailer(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, h: number, wall: number, doorFace = 's', seed = 1): void {
  // cribbing blocks
  b.detail(() => {
    for (let x = x0 + 0.3; x < x1; x += 1.4) {
      b.box(x, y0 - 0.12, z0 + 0.25, 0.3, 0.24, 0.3, C.CONCRETE_DARK, 'rough');
      b.box(x, y0 - 0.12, z1 - 0.25, 0.3, 0.24, 0.3, C.CONCRETE_DARK, 'rough');
    }
  });
  b.slab(x0 + 0.05, y0 - 0.24, z0 + 0.05, x1 - 0.05, y0, z1 - 0.05, C.STEEL_DARK, 'paint');
  shed(b, { x0, z0, x1, z1, y0, h, wall, roof: C.STEEL, trim: b.company, windows: 'nsew', windowY: 0.9, windowH: 0.55, spacing: 1.2, door: doorFace, seed, roofUnits: false });
  b.detail(() => {
    // corrugated ribs
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.3) {
      b.box(x, y0 + h / 2, z0 - 0.015, 0.04, h - 0.3, 0.03, wall, 'paint');
      b.box(x, y0 + h / 2, z1 + 0.015, 0.04, h - 0.3, 0.03, wall, 'paint');
    }
    // AC unit
    b.box(x0 - 0.18, y0 + h * 0.62, (z0 + z1) / 2 + 0.3, 0.35, 0.45, 0.6, C.CREAM, 'paint');
    b.box(x0 - 0.36, y0 + h * 0.62, (z0 + z1) / 2 + 0.3, 0.02, 0.36, 0.5, C.GUNMETAL, 'metal');
  });
}

const field_office: ModelDef = {
  build(b) {
    // ground trailer (back), two-storey trailer stack (front-left), porch & stairs
    trailer(b, -2.45, -1.95, 2.45, -0.35, 0.25, 1.75, C.WHITE, 's', 3);
    trailer(b, -2.45, -1.95, 0.9, -0.35, 2.25, 1.6, C.CREAM, 's', 4);
    // front porch deck with steps
    b.slab(-2.2, 0.0, -0.35, 1.2, 0.25, 0.75, C.WOOD, 'rough');
    railing(b, -2.2, 0.75, 0.2, 0.75, 0.25, C.STEEL_LIGHT);
    b.box(0.7, 0.08, 0.95, 0.9, 0.16, 0.4, C.WOOD, 'rough');
    // upper walkway + stair to 2nd floor
    b.slab(-2.45, 2.1, -0.35, 0.9, 2.22, 0.4, C.STEEL_DARK, 'metal');
    railing(b, -2.45, 0.4, 0.9, 0.4, 2.22, C.HAZARD);
    stairs(b, 2.1, 0.25, 0.1, Math.PI, 1.95, 0.7);
    // company sign on the upper trailer roof, facing +z
    b.box(-0.8, 4.2, -0.9, 3.0, 0.8, 0.08, C.GUNMETAL, 'paint');
    b.sign(-0.8, 4.2, -0.85, 2.9, 0.72);
    b.box(-1.9, 3.95, -0.95, 0.08, 0.6, 0.08, C.STEEL_DARK, 'paint');
    b.box(0.3, 3.95, -0.95, 0.08, 0.6, 0.08, C.STEEL_DARK, 'paint');
    // satellite dish + mast
    b.detail(() => {
      b.cyl(1.6, 2.0, -1.4, 0.04, 0.6, C.STEEL, 'metal', 6);
      b.push().translate(1.6, 2.65, -1.4).rotZ(-0.6);
      b.dome(0, 0, 0, 0.35, C.WHITE, 'paint', 12, 0.12);
      b.pop();
    });
    flagPole(b, 2.25, 1.55, 0, 5.2);
    pickup(b, 1.15, 0, 1.4, 0, C.WHITE);
    lampPost(b, -2.3, 1.7, 0, 3.4, Math.PI / 4, 0.8);
  },
};

const worker_camp: ModelDef = {
  build(b) {
    trailer(b, -2.95, -1.95, 1.15, -0.7, 0.25, 1.9, C.CREAM, 's', 11);
    trailer(b, -2.95, 0.7, 1.15, 1.95, 0.25, 1.9, C.CREAM, 'n', 12);
    // covered boardwalk
    b.slab(-2.95, 0.0, -0.7, 1.2, 0.2, 0.7, C.WOOD, 'rough');
    for (const x of [-2.8, -1.4, 0, 1.1]) for (const z of [-0.6, 0.6]) b.box(x, 1.25, z, 0.08, 2.1, 0.08, C.STEEL_DARK, 'paint');
    b.slab(-3.0, 2.3, -0.8, 1.25, 2.38, 0.8, b.company, 'paint');
    // canteen with big windows
    shed(b, { x0: 1.35, z0: -1.95, x1: 2.95, z1: 1.95, h: 2.6, wall: C.WHITE, roof: C.STEEL, windows: 'ews', windowY: 0.9, windowH: 0.9, spacing: 0.95, door: 'w', seed: 13 });
    b.cyl(2.5, 2.7, -1.2, 0.12, 0.7, C.STEEL, 'metal', 8);
    b.anchor('steam', 2.5, 3.5, -1.2, { r: 0.2, rate: 0.5 });
    // water tank on stand & genset
    b.detail(() => {
      for (const sx of [-0.35, 0.35]) for (const sz of [-0.35, 0.35]) b.box(-2.3 + sx, 2.55, -1.3 + sz, 0.06, 0.6, 0.06, C.STEEL_DARK, 'paint');
    });
    b.cyl(-2.3, 2.85, -1.3, 0.5, 0.9, C.WHITE, 'paint', 12);
    b.box(2.25, 0.5, 2.3, 1.2, 0.9, 0.6, C.GREEN, 'paint');
    b.anchor('exhaust', 2.6, 1.05, 2.3, { rate: 2 });
    lampPost(b, -3.2, 2.2, 0, 3, 0, 0.7);
    // picnic table
    b.detail(() => {
      b.box(-0.8, 0.75, 2.5, 1.4, 0.06, 0.6, C.WOOD, 'rough');
      b.box(-0.8, 0.45, 2.1, 1.4, 0.05, 0.25, C.WOOD, 'rough');
      b.box(-0.8, 0.45, 2.9, 1.4, 0.05, 0.25, C.WOOD, 'rough');
      b.box(-1.3, 0.37, 2.5, 0.06, 0.75, 0.5, C.WOOD, 'rough');
      b.box(-0.3, 0.37, 2.5, 0.06, 0.75, 0.5, C.WOOD, 'rough');
    });
  },
};

const warehouse: ModelDef = {
  build(b) {
    // steel warehouse (back-left) with roll-up door
    shed(b, { x0: -2.95, z0: -2.95, x1: 0.6, z1: 0.4, h: 3.6, wall: C.STEEL_LIGHT, roof: C.STEEL, windows: 'w', windowY: 2.6, windowH: 0.5, gable: true, seed: 21 });
    b.detail(() => {
      for (let x = -2.8; x < 0.5; x += 0.35) b.box(x, 1.8, 0.42, 0.05, 3.4, 0.03, C.STEEL_LIGHT, 'paint');
    });
    b.box(-1.2, 1.35, 0.43, 2.0, 2.5, 0.06, C.GUNMETAL, 'paint');
    b.box(-1.2, 1.35, 0.46, 1.8, 2.3, 0.04, C.STEEL, 'metal');
    b.box(-1.2, 2.8, 0.5, 2.3, 0.18, 0.12, b.company, 'paint');
    door(b, 0.1, 0, 0.44, Math.PI, 1.9);
    // pipe racks with tubular stacks
    for (const z of [1.3, 2.4]) {
      for (const x of [-2.6, -0.2, 2.2]) {
        b.box(x, 0.45, z, 0.12, 0.9, 0.9, C.STEEL_DARK, 'paint');
      }
      pipeStack(b, -0.2, 0.9, z, 5, 3, 4, 0.1, z > 2 ? C.RUST : C.GREEN);
    }
    // containers
    container(b, 1.9, 0, -2.0, Math.PI / 2, b.company, 0.62);
    container(b, 1.9, 1.6, -2.0, Math.PI / 2, C.BLUE, 0.62);
    container(b, 1.9, 0, 0.2, Math.PI / 2, C.GREEN, 0.62);
    // forklift
    b.at(1.0, 0, 1.4, 0.3, () => {
      b.box(0, 0.4, 0, 1.0, 0.5, 0.7, C.HAZARD, 'paint');
      b.box(-0.2, 0.9, 0, 0.5, 0.05, 0.6, C.GUNMETAL, 'paint');
      for (const z of [-0.28, 0.28]) b.box(-0.4, 0.66, z, 0.05, 0.55, 0.05, C.GUNMETAL, 'paint');
      b.box(0.58, 0.9, 0, 0.08, 1.4, 0.5, C.GUNMETAL, 'metal');
      b.box(0.85, 0.2, 0.15, 0.5, 0.05, 0.08, C.GUNMETAL, 'metal');
      b.box(0.85, 0.2, -0.15, 0.5, 0.05, 0.08, C.GUNMETAL, 'metal');
      for (const x of [-0.3, 0.3]) for (const z of [-0.36, 0.36]) b.cylZ(x, 0.16, z, 0.16, 0.12, C.RUBBER, 'rough', 8);
    });
    fence(b, -2.98, -2.98, 2.98, 2.98, 1.2, 's');
    lampPost(b, 2.7, 2.7, 0, 3.8, Math.PI * 1.25, 1);
  },
};

const research_lab: ModelDef = {
  build(b) {
    // two-storey lab: white panels + glass curtain wall bands, orange accent fin
    b.slab(-2.9, 0, -2.4, 2.4, 0.2, 1.8, C.CONCRETE, 'rough');
    b.slab(-2.8, 0.2, -2.3, 2.3, 3.7, 1.4, C.WHITE, 'paint');
    for (const y of [0.55, 2.2]) {
      b.slab(-2.82, y, 1.4, 2.32, y + 1.15, 1.46, C.GLASS, 'glass');
      b.slab(-2.86, y, -2.3, -2.8, y + 1.15, 1.4, C.GLASS, 'glass');
      b.slab(2.3, y, -2.3, 2.36, y + 1.15, 1.4, C.GLASS, 'glass');
      b.slab(-2.82, y, -2.36, 2.32, y + 1.15, -2.3, C.GLASS, 'glassDark');
    }
    b.detail(() => {
      for (let x = -2.6; x < 2.3; x += 0.55) b.box(x, 1.9, 1.49, 0.05, 3.3, 0.05, C.STEEL_LIGHT, 'metal');
    });
    b.slab(-2.95, 3.7, -2.45, 2.45, 3.9, 1.55, C.STEEL_LIGHT, 'metal');
    b.slab(1.6, 0.2, 1.4, 2.0, 4.4, 1.9, b.company, 'paint');
    // entrance canopy
    b.slab(-1.4, 2.0, 1.4, 0.4, 2.1, 2.35, C.STEEL_LIGHT, 'metal');
    b.box(-0.5, 1.0, 1.47, 1.2, 1.8, 0.04, C.GLASS_DARK, 'glassDark');
    b.box(-0.5, 2.3, 1.55, 2.4, 0.5, 0.06, C.GUNMETAL, 'paint');
    b.sign(-0.5, 2.3, 1.59, 2.3, 0.46);
    // rooftop: HVAC & fume stacks
    b.box(-1.5, 4.25, -1.2, 1.4, 0.7, 1.0, C.STEEL, 'metal');
    b.cyl(0.6, 3.9, -1.6, 0.14, 1.1, C.STEEL_LIGHT, 'metal', 8);
    b.cyl(1.1, 3.9, -1.6, 0.14, 1.1, C.STEEL_LIGHT, 'metal', 8);
    b.anchor('steam', 0.85, 5.1, -1.6, { r: 0.15, rate: 0.4 });
    // core racks outside
    b.detail(() => {
      for (let i = 0; i < 3; i++) {
        b.box(-2.3 + i * 0.7, 0.45, 2.1, 0.55, 0.5, 0.45, C.WOOD, 'rough');
        for (let k = 0; k < 4; k++) b.cylX(-2.3 + i * 0.7, 0.75, 1.95 + k * 0.1, 0.04, 0.5, C.SAND, 'rough', 6);
      }
    });
    lampPost(b, 2.7, 2.2, 0, 3.2, Math.PI, 0.8);
  },
};

const maintenance_depot: ModelDef = {
  build(b) {
    shed(b, { x0: -2.45, z0: -2.45, x1: 2.45, z1: 0.9, h: 3.7, wall: C.SAND, roof: C.STEEL, windows: 'ew', windowY: 2.4, windowH: 0.6, gable: false, seed: 31 });
    // two roll-up bays, one open with lit interior
    b.box(-1.15, 1.4, 0.93, 1.9, 2.7, 0.06, C.GUNMETAL, 'paint');
    b.box(-1.15, 1.55, 0.96, 1.7, 2.3, 0.04, C.STEEL, 'metal');
    b.box(1.15, 1.4, 0.93, 1.9, 2.7, 0.06, C.GUNMETAL, 'paint');
    b.box(1.15, 1.25, 0.9, 1.7, 2.3, 0.04, 0x40362c, 'paint');
    b.box(1.15, 2.6, 0.85, 1.6, 0.06, 0.2, C.LAMP_WARM, 'lamp');
    b.box(1.15, 2.55, 0.97, 1.8, 0.3, 0.06, C.HAZARD, 'paint');
    b.box(-1.15, 2.95, 0.97, 1.9, 0.3, 0.06, b.company, 'paint');
    // overhead gantry crane in the yard
    for (const x of [-2.3, 2.3]) {
      b.box(x, 1.75, 2.2, 0.16, 3.5, 0.16, C.HAZARD, 'paint');
      b.box(x, 1.75, 1.2, 0.16, 3.5, 0.16, C.HAZARD, 'paint');
      b.box(x, 3.5, 1.7, 0.2, 0.25, 1.2, C.HAZARD, 'paint');
    }
    b.box(0, 3.55, 1.7, 4.8, 0.3, 0.3, C.HAZARD, 'paint');
    b.box(0.6, 3.25, 1.7, 0.4, 0.3, 0.4, C.STEEL_DARK, 'paint');
    b.box(0.6, 2.6, 1.7, 0.03, 1.1, 0.03, C.STEEL_DARK, 'metal');
    b.box(0.6, 2.0, 1.7, 0.2, 0.15, 0.2, C.HAZARD, 'paint');
    // parts & drums
    b.detail(() => {
      for (let i = 0; i < 4; i++) b.cyl(-2.0 + i * 0.45, 0, 2.25, 0.2, 0.6, i % 2 ? C.BLUE : C.RED, 'paint', 10);
    });
    serviceTruck(b, -0.8, 0, 1.85, 0);
    lampPost(b, 2.3, -2.3, 3.7, 1.2, Math.PI * 0.75, 0.8);
  },
};

const fire_station: ModelDef = {
  build(b) {
    shed(b, { x0: -2.45, z0: -2.45, x1: 1.4, z1: 0.9, h: 3.4, wall: C.RED, roof: C.STEEL_LIGHT, trim: C.WHITE, windows: 'e', windowY: 2.2, windowH: 0.6, seed: 41 });
    // two bays (one open with a truck half out)
    for (const [x, open] of [
      [-1.5, false],
      [0.45, true],
    ] as const) {
      b.box(x, 1.3, 0.93, 1.6, 2.5, 0.06, C.WHITE, 'paint');
      if (open) {
        b.box(x, 1.2, 0.88, 1.45, 2.3, 0.04, 0x2e2622, 'paint');
        b.box(x, 2.3, 0.8, 1.2, 0.05, 0.3, C.LAMP_WARM, 'lamp');
      } else {
        b.box(x, 1.2, 0.97, 1.45, 2.3, 0.04, C.STEEL_LIGHT, 'metal');
        b.detail(() => {
          for (let y = 0.3; y < 2.3; y += 0.3) b.box(x, y, 0.995, 1.45, 0.03, 0.02, C.STEEL, 'metal');
        });
      }
    }
    b.box(-0.5, 2.9, 0.97, 3.7, 0.4, 0.06, C.WHITE, 'paint');
    // hose drying tower
    shed(b, { x0: 1.5, z0: -2.45, x1: 2.45, z1: -1.2, h: 5.4, wall: C.RED, roof: C.STEEL_LIGHT, trim: C.WHITE, windows: 's', windowY: 3.6, windowH: 0.8, spacing: 0.9, seed: 42, roofUnits: false });
    b.box(1.97, 5.55, -1.8, 0.3, 0.15, 0.3, C.LAMP_RED, 'blink');
    b.cyl(1.97, 5.52, -1.8, 0.06, 0.8, C.STEEL, 'metal', 6);
    // siren & light bar
    b.box(-0.5, 3.6, 0.5, 0.8, 0.25, 0.3, C.STEEL, 'metal');
    b.box(-0.5, 3.78, 0.5, 0.6, 0.1, 0.2, C.LAMP_RED, 'blink');
    fireTruck(b, 0.45, 0, 1.3, -Math.PI / 2);
    // hydrant
    b.cyl(2.1, 0, 1.9, 0.14, 0.7, C.RED, 'paint', 8);
    b.dome(2.1, 0.7, 1.9, 0.14, C.RED, 'paint', 8);
    b.cylX(2.1, 0.45, 1.9, 0.06, 0.45, C.RED, 'paint', 6);
    flagPole(b, 2.2, 0.3, 0, 4.8, 1.0);
  },
};

const scada_center: ModelDef = {
  build(b) {
    // control building with dark glass band
    b.slab(-2.45, 0, -2.45, 0.9, 3.4, 1.4, C.WHITE, 'paint');
    b.slab(-2.48, 1.1, -2.48, 0.93, 2.2, 1.43, C.GLASS, 'glass');
    b.slab(-2.5, 3.4, -2.5, 0.95, 3.6, 1.45, b.company, 'paint');
    b.slab(-2.4, 3.6, -2.4, 0.85, 3.7, 1.4, C.STEEL_LIGHT, 'metal');
    b.box(-0.8, 0.95, 1.44, 1.0, 1.9, 0.05, C.GLASS_DARK, 'glassDark');
    b.box(-0.8, 2.65, 1.46, 2.3, 0.5, 0.05, C.GUNMETAL, 'paint');
    b.sign(-0.8, 2.65, 1.5, 2.2, 0.46);
    // rooftop dishes
    for (const [x, z, s] of [
      [-1.9, -1.6, 0.5],
      [-0.6, -1.8, 0.4],
    ] as const) {
      b.cyl(x, 3.7, z, 0.05, 0.4, C.STEEL, 'metal', 6);
      b.push().translate(x, 4.2, z).rotZ(-0.9).rotY(0.4);
      b.dome(0, 0, 0, s, C.WHITE, 'paint', 12, s * 0.35);
      b.pop();
    }
    // lattice antenna tower
    latticeMast(b, { x: 1.7, z: -1.6, y0: 0, y1: 10, hw0: 0.55, hw1: 0.18, panel: 1.1, leg: 0.08, brace: 0.035, color: C.RED, braceColor: C.WHITE });
    b.box(1.7, 10.1, -1.6, 0.14, 0.2, 0.14, C.LAMP_RED, 'blink');
    b.box(1.95, 6.0, -1.6, 0.1, 0.1, 0.1, C.LAMP_RED, 'blink');
    b.push().translate(1.7, 7.5, -1.35).rotX(Math.PI / 2);
    b.dome(0, 0, 0, 0.45, C.WHITE, 'paint', 12, 0.2);
    b.pop();
    for (const y of [4.5, 8.5]) b.box(1.45, y, -1.6, 0.06, 1.2, 0.06, C.STEEL_LIGHT, 'metal');
    // rotating radar on top
    b.group('radar', 1.7, 10.25, -1.6, () => {
      b.box(0, 0.05, 0, 0.1, 0.1, 0.1, C.GUNMETAL, 'metal');
      b.box(0, 0.18, 0, 1.3, 0.14, 0.06, C.WHITE, 'paint');
    });
    ladder(b, 1.7, 0, -1.05, 9.8, Math.PI / 2, true);
    // equipment cabinet & fence
    b.box(1.6, 0.7, 0.4, 1.2, 1.4, 0.8, C.CREAM, 'paint');
    b.box(1.6, 0.9, 0.81, 0.3, 0.15, 0.02, C.LAMP_GREEN, 'lamp');
    fence(b, 0.95, -2.45, 2.45, 1.2, 1.2, 'w');
    lampPost(b, -2.2, 2.1, 0, 3.2, 0, 0.8);
  },
  ambient: true,
  animate(a) {
    spinY(a, 'radar', 0.25);
  },
};

const weather_station: ModelDef = {
  build(b) {
    b.slab(-0.95, 0, -0.95, 0.95, 0.12, 0.95, C.CONCRETE, 'rough');
    // triangular instrument mast
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.beam([Math.cos(a) * 0.22, 0.1, Math.sin(a) * 0.22], [Math.cos(a) * 0.12, 6, Math.sin(a) * 0.12], 0.04, C.GALV, 'metal');
    }
    for (let y = 0.6; y < 6; y += 0.6) b.ring(0, y, 0, 0.19 - y * 0.012, 0.015, C.GALV, 'metal', 6);
    // Stevenson screen
    b.box(0.55, 1.2, 0.5, 0.5, 0.5, 0.45, C.WHITE, 'paint');
    b.detail(() => {
      for (let y = 1.0; y < 1.42; y += 0.07) b.box(0.55, y, 0.73, 0.48, 0.02, 0.02, C.STEEL_LIGHT, 'paint');
    });
    for (const sx of [-0.2, 0.2]) b.box(0.55 + sx, 0.5, 0.5, 0.04, 1.0, 0.04, C.STEEL_LIGHT, 'metal');
    // solar panel + logger box
    b.push().translate(0, 2.4, -0.25).rotX(-0.6);
    b.box(0, 0, 0, 0.7, 0.04, 0.5, C.PANEL, 'metal');
    b.pop();
    b.box(0, 1.6, 0.2, 0.35, 0.45, 0.18, C.CREAM, 'paint');
    b.box(0, 1.75, 0.3, 0.06, 0.04, 0.02, C.LAMP_GREEN, 'lamp');
    // rain gauge
    b.cyl(-0.6, 0.12, 0.55, 0.1, 0.6, C.STEEL_LIGHT, 'metal', 8);
    // anemometer (spins) & wind vane
    b.box(0, 6.1, 0, 0.9, 0.04, 0.04, C.GALV, 'metal');
    b.group('anemo', 0.42, 6.15, 0, () => {
      b.cyl(0, 0, 0, 0.03, 0.2, C.STEEL, 'metal', 6);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.beam([0, 0.18, 0], [Math.cos(a) * 0.28, 0.18, Math.sin(a) * 0.28], 0.02, C.STEEL, 'metal');
        b.sphere(Math.cos(a) * 0.3, 0.18, Math.sin(a) * 0.3, 0.07, C.WHITE, 'paint', 8);
      }
    });
    b.group('vane', -0.42, 6.15, 0, () => {
      b.cyl(0, 0, 0, 0.025, 0.15, C.STEEL, 'metal', 6);
      b.box(0, 0.16, 0, 0.6, 0.02, 0.02, C.STEEL, 'metal');
      b.box(0.28, 0.2, 0, 0.18, 0.14, 0.01, b.company, 'paint');
      b.cone(-0.3, 0.16, 0, 0.04, 0.1, C.STEEL, 'metal', 6);
    });
    b.box(0, 6.3, 0, 0.1, 0.1, 0.1, C.LAMP_RED, 'blink');
    b.detail(() => {
      for (const [x0, z0, x1, z1] of [
        [-0.95, -0.95, 0.95, -0.95],
        [-0.95, 0.95, 0.95, 0.95],
        [-0.95, -0.95, -0.95, 0.95],
        [0.95, -0.95, 0.95, 0.95],
      ])
        railing(b, x0, z0, x1, z1, 0.12, C.GALV);
    });
  },
  ambient: true,
  animate(a) {
    const n = a.node('anemo');
    if (n) n.rotation.y -= a.dt * (0.5 + windSpeed(a.ctx) * 0.6) * a.speed;
    turnToward(a, 'vane', windYawLocal(a) + Math.PI, 1.2);
  },
};

const helipad: ModelDef = {
  build(b) {
    // raised deck on stub columns
    for (const x of [-2, 0, 2]) for (const z of [-2, 0, 2]) b.box(x, 0.15, z, 0.3, 0.3, 0.3, C.STEEL_DARK, 'paint');
    b.slab(-2.45, 0.3, -2.45, 2.45, 0.5, 2.45, C.GUNMETAL, 'rough');
    b.noShadow(() => {
      // touchdown circle, H, border
      b.ring(0, 0.51, 0, 1.75, 0.09, C.HAZARD, 'paint', 32);
      b.slab(-0.6, 0.5, -0.8, -0.35, 0.525, 0.8, C.WHITE, 'paint');
      b.slab(0.35, 0.5, -0.8, 0.6, 0.525, 0.8, C.WHITE, 'paint');
      b.slab(-0.35, 0.5, -0.12, 0.35, 0.525, 0.12, C.WHITE, 'paint');
      for (const s of [-1, 1]) {
        b.slab(-2.4, 0.5, s * 2.4 - 0.08, 2.4, 0.52, s * 2.4 + 0.08, C.WHITE, 'paint');
        b.slab(s * 2.4 - 0.08, 0.5, -2.4, s * 2.4 + 0.08, 0.52, 2.4, C.WHITE, 'paint');
      }
    });
    // edge lights (green)
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * 4;
      const side = Math.floor(t);
      const f = t - side;
      const p = -2.3 + f * 4.6;
      const [x, z] = side === 0 ? [p, -2.3] : side === 1 ? [2.3, p] : side === 2 ? [-p, 2.3] : [-2.3, -p];
      b.box(x, 0.58, z, 0.12, 0.1, 0.12, C.LAMP_GREEN, 'lamp');
    }
    // perimeter safety net frame
    b.detail(() => {
      for (const s of [-1, 1]) {
        b.slab(-2.5, 0.35, s * 2.5 - 0.02, 2.5, 0.45, s * 2.5 + 0.02, C.STEEL, 'metal');
        b.slab(s * 2.5 - 0.02, 0.35, -2.5, s * 2.5 + 0.02, 0.45, 2.5, C.STEEL, 'metal');
      }
    });
    // windsock
    b.cyl(2.2, 0.5, 2.2, 0.04, 2.2, C.STEEL_LIGHT, 'metal', 6);
    b.group('sock', 2.2, 2.6, 2.2, () => {
      b.cylX(0.35, 0, 0, 0.14, 0.3, b.company, 'paint', 8);
      b.pipe([0.5, 0, 0], [1.1, -0.08, 0], 0.13, C.WHITE, 'paint', 8, 0.07);
      b.pipe([0.5, 0, 0], [0.8, -0.04, 0], 0.135, b.company, 'paint', 8, 0.11);
    });
    b.anchor('helideck', 0, 0.5, 0, {});
    b.anchor('light', 0, 1.2, 0, { intensity: 0.4, color: 0xc8ffd8, range: 8 });
  },
  ambient: true,
  animate(a) {
    turnToward(a, 'sock', windYawLocal(a), 2);
    const s = a.node('sock');
    if (s) s.rotation.z = -0.5 * (1 - Math.min(1, windSpeed(a.ctx) / 12)) + Math.sin(a.t * 3) * 0.04;
  },
};

export const SUPPORT_MODELS: Record<string, ModelDef> = {
  field_office,
  worker_camp,
  warehouse,
  research_lab,
  maintenance_depot,
  fire_station,
  scada_center,
  weather_station,
  helipad,
};

export { prng };
