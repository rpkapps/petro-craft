// Vehicle geometry builders (front of the vehicle points to +x of the given frame). Used both for
// static props inside building models (fire truck, frac trucks, vac trucks) and for moving vehicles.
import type { Builder } from '../geom/Builder';
import { C } from '../palette';

const W = 1.3; // vehicle width

function wheels(b: Builder, xs: number[], r = 0.3, w = W): void {
  for (const x of xs)
    for (const s of [-1, 1]) {
      b.cylZ(x, r, (s * (w - 0.2)) / 2, r, 0.26, C.RUBBER, 'rough', 10);
      b.detail(() => b.cylZ(x, r, (s * (w - 0.2)) / 2 + s * 0.135, r * 0.55, 0.02, C.STEEL_LIGHT, 'metal', 8));
    }
}

/** Truck cab occupying x ∈ [x0, x0+1.4] (front at +x). */
export function cab(b: Builder, x0: number, color: number, h = 1.55): void {
  const x1 = x0 + 1.4;
  b.slab(x0, 0.45, -W / 2, x1, h, W / 2, color, 'paint');
  b.slab(x0 + 0.1, h, -W / 2 + 0.05, x1 - 0.35, h + 0.12, W / 2 - 0.05, color, 'paint');
  // windshield & side windows
  b.box(x1 + 0.01, h - 0.35, 0, 0.03, 0.5, W - 0.2, C.GLASS_DARK, 'glassDark');
  b.box(x1 - 0.45, h - 0.35, W / 2 + 0.01, 0.6, 0.45, 0.02, C.GLASS_DARK, 'glassDark');
  b.box(x1 - 0.45, h - 0.35, -W / 2 - 0.01, 0.6, 0.45, 0.02, C.GLASS_DARK, 'glassDark');
  // grille, bumper, lights
  b.box(x1 + 0.02, 0.8, 0, 0.04, 0.45, W * 0.55, C.STEEL_LIGHT, 'metal');
  b.box(x1 + 0.06, 0.45, 0, 0.12, 0.18, W + 0.04, C.STEEL, 'metal');
  b.box(x1 + 0.03, 0.72, W / 2 - 0.15, 0.03, 0.12, 0.16, C.LAMP_WHITE, 'lamp');
  b.box(x1 + 0.03, 0.72, -W / 2 + 0.15, 0.03, 0.12, 0.16, C.LAMP_WHITE, 'lamp');
  b.box(x1 - 0.8, h + 0.16, 0, 0.12, 0.07, 0.6, C.LAMP_AMBER, 'lamp');
  // mirrors & stack
  b.detail(() => {
    b.box(x1 - 0.05, h - 0.3, W / 2 + 0.12, 0.05, 0.3, 0.05, C.GUNMETAL, 'metal');
    b.box(x1 - 0.05, h - 0.3, -W / 2 - 0.12, 0.05, 0.3, 0.05, C.GUNMETAL, 'metal');
    b.cyl(x0 - 0.08, 0.6, W / 2 - 0.1, 0.06, h, C.STEEL_LIGHT, 'metal', 6);
  });
  b.box(x0 + 0.7, 0.9, W / 2 + 0.01, 0.9, 0.12, 0.02, b.company, 'paint');
  b.box(x0 + 0.7, 0.9, -W / 2 - 0.01, 0.9, 0.12, 0.02, b.company, 'paint');
}

function chassis(b: Builder, x0: number, x1: number): void {
  b.slab(x0, 0.35, -0.4, x1, 0.5, 0.4, C.GUNMETAL, 'paint');
}

/** Semi tanker (tractor + tank trailer), length ≈ 6.2, x ∈ [-3.1, 3.1]. */
export function tankerTruck(b: Builder, x: number, y0: number, z: number, ry: number, tankColor: number = C.STEEL_LIGHT, cabColor?: number): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -3.1, 3.1);
    cab(b, 1.7, cabColor ?? b.company);
    b.cylX(-0.8, 1.2, 0, 0.62, 4.3, tankColor, 'metal', 14);
    b.sphere(-2.95, 1.2, 0, 0.62, tankColor, 'metal', 12, 0.62).sphere(1.35, 1.2, 0, 0.62, tankColor, 'metal', 12, 0.62);
    b.cylX(-0.8, 1.2, 0, 0.635, 0.35, b.company, 'paint', 14);
    b.detail(() => {
      b.slab(-2.9, 1.82, -0.18, 1.2, 1.88, 0.18, C.STEEL_DARK, 'metal');
      for (const hx of [-2.2, -0.8, 0.6]) b.cyl(hx, 1.8, 0, 0.16, 0.08, C.STEEL, 'metal', 8);
      b.box(-3.15, 0.75, 0, 0.05, 0.12, 1.1, C.LAMP_RED, 'lamp');
    });
    wheels(b, [-2.7, -2.1, 1.0, 2.55]);
  });
}

/** Fire engine with ladder, length ≈ 3.6. */
export function fireTruck(b: Builder, x: number, y0: number, z: number, ry: number): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -1.8, 1.8);
    cab(b, 0.45, C.FIRE_RED, 1.6);
    b.slab(-1.8, 0.45, -W / 2, 0.4, 1.55, W / 2, C.FIRE_RED, 'paint');
    b.detail(() => {
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) b.box(-1.5 + i * 0.65, 1.0, s * (W / 2 + 0.01), 0.55, 0.8, 0.02, C.STEEL_LIGHT, 'metal');
      }
    });
    b.slab(-1.8, 0.62, -W / 2 - 0.02, 1.85, 0.72, W / 2 + 0.02, C.WHITE, 'paint');
    // ladder
    for (const s of [-0.28, 0.28]) b.box(-0.4, 1.72, s, 3.1, 0.08, 0.06, C.STEEL_LIGHT, 'metal');
    b.detail(() => {
      for (let i = 0; i < 10; i++) b.box(-1.85 + i * 0.32, 1.72, 0, 0.04, 0.04, 0.56, C.STEEL_LIGHT, 'metal');
    });
    b.box(1.35, 1.8, 0.28, 0.14, 0.08, 0.4, C.LAMP_RED, 'blink');
    b.box(1.35, 1.8, -0.28, 0.14, 0.08, 0.4, C.LAMP_WHITE, 'lamp');
    wheels(b, [-1.2, 1.2]);
  });
}

/** Utility / service truck with crane arm, length ≈ 3.2. */
export function serviceTruck(b: Builder, x: number, y0: number, z: number, ry: number, color: number = C.WHITE): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -1.6, 1.6);
    cab(b, 0.2, color, 1.5);
    b.slab(-1.6, 0.5, -W / 2, 0.15, 0.62, W / 2, C.STEEL_DARK, 'metal');
    for (const s of [-1, 1]) b.slab(-1.6, 0.62, s * (W / 2) - (s > 0 ? 0.35 : 0), 0.15, 1.2, s * (W / 2) + (s > 0 ? 0 : 0.35), color, 'paint');
    b.box(-1.2, 1.3, 0, 0.3, 0.3, 0.3, C.HAZARD, 'paint');
    b.beam([-1.2, 1.4, 0], [0.0, 1.9, 0], 0.14, C.HAZARD, 'paint');
    b.box(0.0, 1.55, 0, 0.03, 0.7, 0.03, C.STEEL_DARK, 'metal');
    wheels(b, [-1.0, 1.1]);
  });
}

/** Vacuum truck (spill response), length ≈ 3.6. */
export function vacTruck(b: Builder, x: number, y0: number, z: number, ry: number): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -1.8, 1.8);
    cab(b, 0.4, C.HAZARD, 1.55);
    b.cylX(-0.75, 1.15, 0, 0.58, 2.1, C.GUNMETAL, 'paint', 14);
    b.cylX(-1.85, 1.15, 0, 0.6, 0.1, C.STEEL, 'metal', 14);
    b.cylX(-0.75, 1.15, 0, 0.6, 0.25, b.company, 'paint', 14);
    b.cylX(-0.8, 1.85, 0.3, 0.1, 1.9, C.STEEL, 'metal', 8);
    b.box(0.25, 1.2, 0, 0.3, 0.9, 1.1, C.STEEL, 'metal');
    wheels(b, [-1.3, -0.7, 1.2]);
  });
}

/** Frac pump trailer + tractor, length ≈ 6. */
export function fracPumpTruck(b: Builder, x: number, y0: number, z: number, ry: number, color: number): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -3, 3);
    cab(b, 1.6, color, 1.55);
    // engine + radiator + transmission + triplex pump
    b.slab(-0.6, 0.5, -0.55, 1.4, 1.45, 0.55, C.GUNMETAL, 'paint');
    b.slab(0.9, 0.5, -0.62, 1.4, 1.75, 0.62, C.STEEL_DARK, 'paint');
    b.detail(() => {
      for (let y = 0.6; y < 1.7; y += 0.12) b.box(1.41, y, 0, 0.02, 0.05, 1.1, C.STEEL, 'metal');
    });
    b.slab(-1.2, 0.5, -0.45, -0.6, 1.1, 0.45, C.STEEL, 'metal');
    b.slab(-2.9, 0.5, -0.6, -1.2, 1.25, 0.6, color, 'paint');
    b.cylZ(-2.3, 0.85, 0, 0.28, 1.3, C.STEEL_LIGHT, 'metal', 10);
    b.pipe([-2.9, 0.75, 0.4], [-3.1, 0.75, 0.4], 0.1, C.RED, 'metal');
    b.cyl(0.2, 1.45, 0.35, 0.09, 0.5, C.STEEL_LIGHT, 'metal', 6);
    b.anchor('exhaust', 0.2, 2.0, 0.35, { rate: 7 });
    wheels(b, [-2.5, -1.9, 1.1, 2.4]);
  });
}

/** Blender trailer (hopper + tub), length ≈ 5. */
export function blenderTruck(b: Builder, x: number, y0: number, z: number, ry: number): void {
  b.at(x, y0, z, ry, () => {
    chassis(b, -2.6, 2.4);
    cab(b, 1.0, C.WHITE, 1.55);
    b.cyl(-1.6, 0.5, 0, 0.55, 1.1, C.STEEL_LIGHT, 'metal', 12);
    b.cyl(-0.3, 1.1, 0, 0.62, 0.8, b.company, 'paint', 12, 0.3);
    b.cyl(-0.3, 0.5, 0, 0.25, 0.6, C.STEEL_DARK, 'metal', 8);
    b.beam([-0.3, 1.6, 0], [-1.6, 1.8, 0], 0.18, C.STEEL, 'metal');
    b.slab(0.3, 0.5, -0.6, 1.0, 1.4, 0.6, C.GUNMETAL, 'paint');
    wheels(b, [-2.1, -1.5, 0.8, 1.9]);
  });
}

/** Sand silo unit ("sand king") — tall vertical proppant bin, ≈ 1.4 × 1.4 × 4. */
export function sandSilo(b: Builder, x: number, y0: number, z: number, ry: number): void {
  b.at(x, y0, z, ry, () => {
    b.slab(-0.75, 0, -0.7, 0.75, 0.5, 0.7, C.STEEL_DARK, 'paint');
    b.slab(-0.7, 0.5, -0.65, 0.7, 3.6, 0.65, C.WHITE, 'paint');
    b.slab(-0.72, 2.8, -0.67, 0.72, 3.15, 0.67, b.company, 'paint');
    b.cone(0, 0.5, 0, 0.5, -0.01, C.STEEL, 'metal', 8);
    b.slab(-0.7, 3.6, -0.65, 0.7, 3.7, 0.65, C.STEEL, 'metal');
    b.detail(() => {
      for (let y = 0.8; y < 3.5; y += 0.5) b.box(0.71, y, 0, 0.02, 0.05, 1.28, C.STEEL_LIGHT, 'paint');
    });
  });
}

/** Vibroseis truck body without the base plate (the plate is a separate animated node). */
export function vibroseisBody(b: Builder): void {
  chassis(b, -2.2, 2.2);
  cab(b, 0.8, C.HAZARD, 1.6);
  b.slab(-2.2, 0.5, -0.6, -0.9, 1.5, 0.6, C.HAZARD, 'paint');
  b.slab(-2.2, 1.5, -0.55, -1.0, 1.65, 0.55, C.STEEL, 'metal');
  // lift frame around the plate
  for (const s of [-1, 1]) {
    b.box(-0.05, 1.0, s * 0.62, 0.15, 1.2, 0.1, C.STEEL_DARK, 'metal');
    b.box(-0.05, 1.6, 0, 0.15, 0.1, 1.3, C.STEEL_DARK, 'metal');
  }
  b.cyl(-0.05, 0.5, 0, 0.18, 1.1, C.STEEL_LIGHT, 'metal', 8);
  b.cylZ(-1.6, 0.4, 0, 0.4, 1.4, C.RUBBER, 'rough', 12);
  b.cylZ(1.6, 0.4, 0, 0.4, 1.4, C.RUBBER, 'rough', 12);
  b.box(1.6, 0.9, 0.62, 0.9, 0.1, 0.06, C.GUNMETAL, 'paint');
  b.box(-1.6, 0.9, 0.62, 0.9, 0.1, 0.06, C.GUNMETAL, 'paint');
  b.box(1.0, 1.85, 0, 0.12, 0.07, 0.6, C.LAMP_AMBER, 'blink');
  b.anchor('exhaust', -0.9, 2.0, 0.5, { rate: 4 });
}

/** Tank rail car, length ≈ 5.6, on bogies (rails at y=0). */
export function tankCar(b: Builder, x: number, y0: number, z: number, ry: number, color: number): void {
  b.at(x, y0, z, ry, () => {
    for (const bx of [-2.0, 2.0]) {
      b.slab(bx - 0.6, 0.15, -0.45, bx + 0.6, 0.45, 0.45, C.GUNMETAL, 'paint');
      for (const wx of [-0.35, 0.35]) for (const s of [-0.38, 0.38]) b.cylZ(bx + wx, 0.26, s, 0.26, 0.1, C.STEEL_DARK, 'metal', 10);
    }
    b.slab(-2.8, 0.45, -0.5, 2.8, 0.6, 0.5, C.GUNMETAL, 'paint');
    b.cylX(0, 1.25, 0, 0.72, 5.0, color, 'paint', 14);
    b.sphere(-2.5, 1.25, 0, 0.72, color, 'paint', 12, 0.72).sphere(2.5, 1.25, 0, 0.72, color, 'paint', 12, 0.72);
    b.cyl(0, 1.9, 0, 0.3, 0.25, C.STEEL_DARK, 'metal', 10);
    b.detail(() => {
      b.box(0, 1.25, 0.73, 1.4, 0.3, 0.02, b.company, 'paint');
      b.box(0, 1.25, -0.73, 1.4, 0.3, 0.02, b.company, 'paint');
      b.box(2.9, 0.55, 0, 0.3, 0.1, 0.2, C.GUNMETAL, 'metal');
      b.box(-2.9, 0.55, 0, 0.3, 0.1, 0.2, C.GUNMETAL, 'metal');
    });
  });
}

/** Diesel locomotive, length ≈ 7. */
export function locomotive(b: Builder, x: number, y0: number, z: number, ry: number): void {
  b.at(x, y0, z, ry, () => {
    for (const bx of [-2.4, 2.4]) {
      b.slab(bx - 0.9, 0.15, -0.5, bx + 0.9, 0.5, 0.5, C.GUNMETAL, 'paint');
      for (const wx of [-0.55, 0, 0.55]) for (const s of [-0.42, 0.42]) b.cylZ(bx + wx, 0.28, s, 0.28, 0.1, C.STEEL_DARK, 'metal', 10);
    }
    b.slab(-3.5, 0.5, -0.7, 3.5, 0.75, 0.7, C.GUNMETAL, 'paint');
    b.slab(-3.3, 0.75, -0.55, 1.8, 2.1, 0.55, b.company, 'paint');
    b.slab(1.8, 0.75, -0.7, 3.3, 2.55, 0.7, b.company, 'paint');
    b.slab(1.78, 2.55, -0.72, 3.32, 2.65, 0.72, C.GUNMETAL, 'paint');
    b.box(3.31, 2.1, 0, 0.03, 0.4, 1.1, C.GLASS_DARK, 'glassDark');
    b.box(2.5, 2.1, 0.71, 0.8, 0.35, 0.02, C.GLASS, 'glass');
    b.box(2.5, 2.1, -0.71, 0.8, 0.35, 0.02, C.GLASS, 'glass');
    b.slab(-3.3, 1.2, -0.56, 3.3, 1.35, 0.56, C.HAZARD, 'paint');
    b.box(3.36, 1.4, 0, 0.04, 0.2, 0.3, C.LAMP_WHITE, 'lamp');
    b.box(-3.36, 1.4, 0, 0.04, 0.2, 0.3, C.LAMP_RED, 'lamp');
    b.detail(() => {
      for (let i = 0; i < 6; i++) b.box(-2.8 + i * 0.7, 2.12, 0, 0.5, 0.05, 0.8, C.STEEL, 'metal');
      b.cyl(-0.4, 2.1, 0, 0.12, 0.3, C.STEEL_DARK, 'metal', 6);
    });
    b.anchor('exhaust', -0.4, 2.45, 0, { rate: 6 });
  });
}
