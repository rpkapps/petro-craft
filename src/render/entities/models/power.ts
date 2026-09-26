// Power: diesel genset, gas turbine plant, solar farm (single-axis trackers), wind turbine.
import type { Builder } from '../geom/Builder';
import { lampPost, shed, stack } from '../geom/parts';
import { C } from '../palette';
import { fence, turnToward, windSpeed, windYawLocal } from './common';
import type { ModelDef } from './types';

function transformer(b: Builder, x: number, z: number, s = 1): void {
  b.slab(x - 0.6 * s, 0, z - 0.45 * s, x + 0.6 * s, 0.12, z + 0.45 * s, C.CONCRETE, 'rough');
  b.slab(x - 0.5 * s, 0.12, z - 0.35 * s, x + 0.5 * s, 1.1 * s, z + 0.35 * s, C.OLIVE, 'paint');
  b.detail(() => {
    for (let i = -3; i <= 3; i++) b.box(x + i * 0.13 * s, 0.6 * s, z + 0.4 * s, 0.04, 0.8 * s, 0.1, C.OLIVE, 'paint');
  });
  for (const dx of [-0.3, 0, 0.3]) {
    b.cyl(x + dx * s, 1.1 * s, z, 0.06, 0.45 * s, C.CREAM, 'paint', 8);
    b.cyl(x + dx * s, 1.55 * s, z, 0.03, 0.2, C.STEEL, 'metal', 5);
  }
  b.cyl(x - 0.35 * s, 1.1 * s, z - 0.15 * s, 0.14 * s, 0.5 * s, C.OLIVE, 'paint', 10);
}

const diesel_generator: ModelDef = {
  build(b) {
    b.slab(-1.45, 0, -0.95, 1.45, 0.3, 0.95, C.STEEL_DARK, 'paint'); // fuel day-tank base
    b.slab(-1.4, 0.3, -0.85, 1.25, 2.3, 0.85, C.GREEN, 'paint');
    b.slab(-1.42, 1.95, -0.87, 1.27, 2.2, 0.87, b.company, 'paint');
    b.detail(() => {
      for (let x = -1.3; x < 1.2; x += 0.22) {
        b.box(x, 1.3, 0.86, 0.04, 1.7, 0.03, C.GREEN, 'paint');
        b.box(x, 1.3, -0.86, 0.04, 1.7, 0.03, C.GREEN, 'paint');
      }
      b.box(-0.5, 1.1, 0.88, 0.7, 1.4, 0.02, C.OLIVE, 'paint');
      b.box(-0.3, 1.2, 0.9, 0.05, 0.12, 0.02, C.STEEL_LIGHT, 'metal');
    });
    // radiator end
    b.slab(1.25, 0.4, -0.8, 1.42, 2.2, 0.8, C.GUNMETAL, 'metal');
    b.detail(() => {
      for (let y = 0.5; y < 2.2; y += 0.12) b.box(1.43, y, 0, 0.02, 0.05, 1.5, C.STEEL, 'metal');
    });
    // exhaust stack with rain cap
    b.cyl(-0.6, 2.3, 0.3, 0.13, 0.9, C.STEEL_LIGHT, 'metal', 10);
    b.box(-0.6, 3.22, 0.3, 0.3, 0.03, 0.3, C.STEEL, 'metal');
    b.anchor('exhaust', -0.6, 3.25, 0.3, { rate: 7 });
    b.cylX(-0.2, 2.45, -0.3, 0.25, 1.2, C.STEEL, 'metal', 10);
    // breaker panel & cable
    b.slab(-1.45, 0.3, 0.87, -1.0, 1.4, 0.95, C.CREAM, 'paint');
    b.box(-1.22, 1.2, 0.96, 0.08, 0.08, 0.02, C.LAMP_GREEN, 'lamp');
  },
};

const gas_turbine_power: ModelDef = {
  build(b) {
    b.slab(-2.98, 0, -2.48, 2.98, 0.05, 2.48, C.CONCRETE, 'rough');
    // turbine hall
    shed(b, { x0: -2.9, z0: -2.4, x1: 1.0, z1: 0.9, h: 3.8, wall: C.STEEL_LIGHT, roof: C.STEEL, windows: 'w', windowY: 2.6, windowH: 0.6, door: 's', seed: 171 });
    b.detail(() => {
      for (let x = -2.8; x < 1.0; x += 0.3) b.box(x, 1.9, 0.92, 0.04, 3.4, 0.03, C.STEEL_LIGHT, 'paint');
    });
    b.box(-0.9, 1.4, 0.93, 1.8, 2.6, 0.05, C.GUNMETAL, 'paint');
    b.box(-0.9, 3.35, 0.95, 3.4, 0.45, 0.05, C.GUNMETAL, 'paint');
    b.sign(-0.9, 3.35, 0.98, 3.3, 0.42);
    // air-intake filter houses on the roof
    for (const z of [-1.7, -0.3]) {
      b.slab(-2.6, 3.9, z - 0.55, -1.0, 5.1, z + 0.55, C.STEEL, 'paint');
      b.detail(() => {
        for (let y = 4.0; y < 5.1; y += 0.15) b.box(-2.62, y, z, 0.02, 0.05, 1.0, C.STEEL_LIGHT, 'metal');
      });
    }
    // exhaust stacks (hot, clear plume)
    for (const z of [-1.7, -0.3]) {
      b.slab(1.0, 1.5, z - 0.4, 1.8, 2.5, z + 0.4, C.STEEL, 'paint');
      stack(b, 2.2, z, 0, 6.2, 0.42, C.STEEL_LIGHT, false);
      b.anchor('steam', 2.2, 6.3, z, { r: 0.3, rate: 0.35 });
    }
    // transformer yard
    transformer(b, -1.8, 1.7, 0.9);
    transformer(b, 0.2, 1.7, 0.9);
    fence(b, -2.8, 1.1, 1.3, 2.4, 1.4, 'n');
    b.box(2.2, 1.5, 1.8, 0.1, 3, 0.1, C.STEEL_DARK, 'paint');
    b.box(2.2, 3.0, 1.8, 1.4, 0.08, 0.08, C.STEEL_DARK, 'paint');
    lampPost(b, 2.8, 2.3, 0, 3.4, Math.PI * 1.25, 0.8);
  },
};

const ROWS = 4;

const solar_farm: ModelDef = {
  build(b) {
    b.slab(-3.98, 0, -3.98, 3.98, 0.04, 3.98, C.GRAVEL, 'rough');
    for (let i = 0; i < ROWS; i++) {
      const x = -2.9 + i * 1.95;
      for (let z = -3.4; z <= 3.4; z += 1.7) {
        b.box(x, 0.5, z, 0.1, 1.0, 0.1, C.GALV, 'metal');
        b.box(x, 0.12, z, 0.25, 0.08, 0.25, C.CONCRETE, 'rough');
      }
      b.group(`row${i}`, x, 1.02, 0, () => {
        b.cylZ(0, 0, 0, 0.06, 7.4, C.GALV, 'metal', 6);
        for (let k = 0; k < 6; k++) {
          const z = -3.1 + k * 1.24;
          b.box(0, 0.08, z, 1.65, 0.05, 1.18, C.PANEL, 'metal');
          b.detail(() => {
            b.box(0, 0.11, z, 0.02, 0.01, 1.1, C.STEEL_LIGHT, 'metal');
            b.box(0.41, 0.11, z, 0.02, 0.01, 1.1, C.STEEL_LIGHT, 'metal');
            b.box(-0.41, 0.11, z, 0.02, 0.01, 1.1, C.STEEL_LIGHT, 'metal');
          });
        }
      });
    }
    // inverter skid
    b.slab(2.95, 0.04, -3.9, 3.9, 1.2, -3.2, C.WHITE, 'paint');
    b.box(3.4, 0.9, -3.19, 0.1, 0.1, 0.02, C.LAMP_GREEN, 'lamp');
    fence(b, -3.98, -3.98, 3.98, 3.98, 1.1, '');
  },
  ambient: true,
  animate(a) {
    // single-axis trackers follow the sun east → west (stow flat at night)
    const m = a.ctx.state.time.minuteOfDay;
    const day = m > 360 && m < 1140;
    const target = day ? Math.max(-0.85, Math.min(0.85, ((m - 750) / 390) * 0.85)) : 0;
    for (let i = 0; i < ROWS; i++) {
      const n = a.node(`row${i}`);
      if (n) n.rotation.z += (target - n.rotation.z) * Math.min(1, a.dt * 0.3);
    }
  },
};

const wind_turbine: ModelDef = {
  build(b) {
    b.cyl(0, 0, 0, 1.4, 0.3, C.CONCRETE, 'rough', 16);
    b.cyl(0, 0.3, 0, 0.5, 19.9, C.WHITE, 'paint', 16, 0.3);
    b.box(0.46, 1.1, 0, 0.06, 1.3, 0.55, C.STEEL_LIGHT, 'paint');
    b.cyl(0, 0.3, 0, 0.51, 0.5, b.company, 'paint', 16);
    b.detail(() => {
      b.slab(0.7, 0.3, -0.35, 1.2, 1.1, 0.35, C.OLIVE, 'paint');
      b.box(0.8, 0.5, 0.52, 0.5, 0.35, 0.3, C.CONCRETE, 'rough');
    });
    b.group('nacelle', 0, 20.2, 0, () => {
      b.cyl(0, -0.1, 0, 0.35, 0.2, C.STEEL_LIGHT, 'metal', 12);
      b.box(-0.2, 0.35, 0, 2.0, 0.85, 0.85, C.WHITE, 'paint');
      b.box(-0.3, 0.35, 0.43, 1.2, 0.18, 0.02, b.company, 'paint');
      b.box(-0.3, 0.35, -0.43, 1.2, 0.18, 0.02, b.company, 'paint');
      b.box(-0.8, 0.88, 0.2, 0.1, 0.2, 0.1, C.LAMP_RED, 'blink');
      b.box(-0.9, 0.9, -0.2, 0.25, 0.04, 0.04, C.STEEL, 'metal');
      b.group('rotor', 0.95, 0.35, 0, () => {
        b.sphere(0.12, 0, 0, 0.45, C.WHITE, 'paint', 12, 0.45);
        b.cylX(0, 0, 0, 0.42, 0.3, C.WHITE, 'paint', 12);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          b.push().rotX(a);
          b.beam([0.05, 0.3, 0], [0.05, 7.2, 0], 0.08, C.WHITE, 'paint', 0.36);
          b.beam([0.05, 0.3, 0.12], [0.05, 3.5, 0.2], 0.07, C.WHITE, 'paint', 0.2);
          b.beam([0.05, 6.4, 0], [0.05, 7.2, 0], 0.085, C.RED, 'paint', 0.3);
          b.pop();
        }
      });
    });
  },
  ambient: true,
  animate(a) {
    const ws = windSpeed(a.ctx);
    turnToward(a, 'nacelle', windYawLocal(a) + Math.PI, 0.3);
    const rotor = a.node('rotor');
    if (!rotor) return;
    const rps = ws < 2.5 ? 0.02 : Math.min(0.32, 0.05 + ws * 0.022);
    rotor.rotation.x = (rotor.rotation.x + a.dt * rps * Math.PI * 2 * a.speed) % (Math.PI * 2);
  },
};

export const POWER_MODELS: Record<string, ModelDef> = { diesel_generator, gas_turbine_power, solar_farm, wind_turbine };
