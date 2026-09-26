// Moving-vehicle model templates (built once per company colour, instanced per vehicle).
import { Builder, type ModelTemplate } from '../geom/Builder';
import { C } from '../palette';
import { locomotive, tankCar, tankerTruck, vibroseisBody } from './props';

const cache = new Map<string, ModelTemplate>();

function disposeTemplate(t: ModelTemplate): void {
  const walk = (n: ModelTemplate['root']) => {
    for (const m of n.meshes) m.geometry.dispose();
    n.children.forEach(walk);
  };
  walk(t.root);
}

/** Free every cached vehicle template (layer dispose). */
export function clearVehicleTemplates(): void {
  for (const t of cache.values()) disposeTemplate(t);
  cache.clear();
}

function cached(key: string, company: string, build: (b: Builder) => void): ModelTemplate {
  const k = `${key}|${company}`;
  let t = cache.get(k);
  if (!t) {
    const b = new Builder(company);
    build(b);
    t = b.build();
    cache.set(k, t);
  }
  return t;
}

export const truckTemplate = (company: string) => cached('truck', company, (b) => tankerTruck(b, 0, 0, 0, 0, C.STEEL_LIGHT));

export const locoTemplate = (company: string) => cached('loco', company, (b) => locomotive(b, 0, 0, 0, 0));

export const tankCarTemplate = (company: string, variant: number) =>
  cached(`car${variant}`, company, (b) => tankCar(b, 0, 0, 0, 0, [C.GUNMETAL, C.WHITE, C.BLACK][variant % 3]));

/** Crude tanker, bow at +x, waterline at y = 0. Length ≈ 26. */
export const shipTemplate = (company: string) =>
  cached('ship', company, (b) => {
    const L = 26;
    const hw = 2.4;
    const hull = C.NAVY;
    b.slab(-L / 2, -1.5, -hw, L / 2 - 3, 0, hw, C.RED_DARK, 'paint');
    b.slab(-L / 2, 0, -hw, L / 2 - 3, 2.2, hw, hull, 'paint');
    // bow (tapered)
    b.push().translate(L / 2 - 3, 0, 0).scale(1.6, 1, 1);
    b.cyl(0, -1.5, 0, hw, 1.5, C.RED_DARK, 'paint', 16);
    b.cyl(0, 0, 0, hw, 2.4, hull, 'paint', 16);
    b.cyl(0, 2.35, 0, hw - 0.05, 0.05, 0x5b3a33, 'rough', 16);
    b.pop();
    b.slab(-L / 2, 2.15, -hw + 0.05, L / 2 - 3, 2.2, hw - 0.05, 0x5b3a33, 'rough');
    b.slab(-L / 2 - 0.02, 1.6, -hw - 0.02, L / 2 - 3, 1.85, hw + 0.02, C.WHITE, 'paint');
    // deck piping, manifold, catwalk
    b.cylX(0.5, 2.5, 0.4, 0.12, L - 8, C.STEEL_LIGHT, 'metal', 6);
    b.cylX(0.5, 2.5, -0.4, 0.12, L - 8, C.STEEL_LIGHT, 'metal', 6);
    b.slab(-7, 2.7, -0.2, 9, 2.8, 0.2, C.STEEL_DARK, 'metal');
    b.slab(0.2, 2.2, -hw + 0.3, 1.4, 3.0, hw - 0.3, C.STEEL, 'metal');
    b.detail(() => {
      for (let x = -6; x < 9; x += 2.2) b.cyl(x, 2.2, 1.4, 0.18, 0.35, C.STEEL, 'metal', 8);
    });
    // stern superstructure, bridge, funnel
    b.slab(-L / 2 + 0.3, 2.2, -hw + 0.2, -L / 2 + 4.3, 7.0, hw - 0.2, C.WHITE, 'paint');
    for (let y = 3.0; y < 6.8; y += 1.1) {
      b.slab(-L / 2 + 4.31, y, -hw + 0.5, -L / 2 + 4.35, y + 0.4, hw - 0.5, C.GLASS, 'glass');
      b.slab(-L / 2 + 0.25, y, -hw + 0.5, -L / 2 + 0.29, y + 0.4, hw - 0.5, C.GLASS, 'glass');
    }
    b.slab(-L / 2 + 2.6, 7.0, -hw - 0.6, -L / 2 + 4.4, 7.8, hw + 0.6, C.WHITE, 'paint');
    b.slab(-L / 2 + 4.41, 7.15, -hw - 0.5, -L / 2 + 4.45, 7.6, hw + 0.5, C.GLASS, 'glass');
    b.cyl(-L / 2 + 1.4, 7.0, 0, 0.75, 2.0, C.WHITE, 'paint', 12);
    b.cyl(-L / 2 + 1.4, 8.1, 0, 0.77, 0.6, b.company, 'paint', 12);
    b.cyl(-L / 2 + 1.4, 9.0, 0, 0.78, 0.2, C.BLACK, 'paint', 12);
    b.box(-L / 2 + 3.2, 8.6, 0, 0.08, 1.4, 0.08, C.STEEL_LIGHT, 'metal');
    b.box(-L / 2 + 3.2, 9.35, 0, 0.14, 0.14, 0.14, C.LAMP_WHITE, 'lamp');
    b.box(L / 2 - 1.5, 3.6, 0, 0.08, 1.4, 0.08, C.STEEL_LIGHT, 'metal');
    b.box(L / 2 - 1.5, 4.35, 0, 0.14, 0.14, 0.14, C.LAMP_WHITE, 'lamp');
    b.box(-L / 2 + 3.5, 7.45, hw + 0.62, 0.12, 0.12, 0.05, C.LAMP_GREEN, 'lamp');
    b.box(-L / 2 + 3.5, 7.45, -hw - 0.62, 0.12, 0.12, 0.05, C.LAMP_RED, 'lamp');
    b.anchor('smoke', -L / 2 + 1.4, 9.2, 0, { r: 0.35, rate: 0.6, dark: 0.4 });
  });

/** Helicopter, nose at +x; rotor nodes 'rotor' (Y axis) and 'tail' (Z axis). */
export const heliTemplate = (company: string) =>
  cached('heli', company, (b) => {
    b.box(0.1, 0.95, 0, 2.3, 1.05, 1.1, C.WHITE, 'paint');
    b.box(0.1, 0.6, 0, 2.32, 0.35, 1.12, b.company, 'paint');
    b.push().translate(1.25, 0.95, 0).scale(0.9, 0.55, 0.55);
    b.sphere(0, 0, 0, 1, C.WHITE, 'paint', 12);
    b.pop();
    b.push().translate(1.45, 1.15, 0).scale(0.55, 0.35, 0.5);
    b.sphere(0, 0, 0, 1, C.GLASS_DARK, 'glassDark', 10);
    b.pop();
    b.box(0.3, 1.1, 0.56, 1.1, 0.4, 0.02, C.GLASS_DARK, 'glassDark');
    b.box(0.3, 1.1, -0.56, 1.1, 0.4, 0.02, C.GLASS_DARK, 'glassDark');
    b.box(-0.3, 1.6, 0, 1.2, 0.3, 0.8, C.WHITE, 'paint');
    b.pipe([-1.0, 1.05, 0], [-3.6, 1.35, 0], 0.26, C.WHITE, 'paint', 8, 0.12);
    b.box(-3.5, 1.75, 0, 0.55, 0.9, 0.06, b.company, 'paint');
    b.box(-3.2, 1.35, 0, 0.3, 0.05, 1.1, C.WHITE, 'paint');
    for (const s of [-1, 1]) {
      b.pipe([-0.9, 0.08, s * 0.55], [1.1, 0.08, s * 0.55], 0.045, C.GUNMETAL, 'metal', 6);
      b.pipe([-0.5, 0.08, s * 0.55], [-0.4, 0.5, s * 0.4], 0.035, C.GUNMETAL, 'metal', 5);
      b.pipe([0.6, 0.08, s * 0.55], [0.5, 0.5, s * 0.4], 0.035, C.GUNMETAL, 'metal', 5);
    }
    b.box(-0.3, 1.82, 0, 0.14, 0.14, 0.14, C.LAMP_RED, 'blink');
    b.box(0.2, 0.42, 0, 0.12, 0.1, 0.12, C.LAMP_RED, 'blink');
    b.box(1.95, 0.8, 0, 0.06, 0.1, 0.12, C.LAMP_WHITE, 'lamp');
    b.cyl(-0.3, 1.75, 0, 0.07, 0.35, C.GUNMETAL, 'metal', 6);
    b.group('rotor', -0.3, 2.12, 0, () => {
      b.cyl(0, -0.05, 0, 0.16, 0.12, C.GUNMETAL, 'metal', 8);
      for (let i = 0; i < 4; i++) {
        b.push().rotY((i * Math.PI) / 2);
        b.box(1.35, 0.02, 0, 2.6, 0.03, 0.2, C.GUNMETAL, 'paint');
        b.box(2.55, 0.02, 0, 0.2, 0.035, 0.21, C.HAZARD, 'paint');
        b.pop();
      }
    });
    b.group('tail', -3.55, 1.6, 0.1, () => {
      for (let i = 0; i < 2; i++) {
        b.push().rotZ((i * Math.PI) / 2);
        b.box(0, 0, 0.02, 0.07, 0.8, 0.02, C.GUNMETAL, 'paint');
        b.pop();
      }
    });
  });

/** Vibroseis truck with animated base plate node 'plate'. */
export const vibroTemplate = (company: string) =>
  cached('vibro', company, (b) => {
    vibroseisBody(b);
    b.group('plate', -0.05, 0.45, 0, () => {
      b.box(0, 0, 0, 1.1, 0.12, 1.0, C.GUNMETAL, 'metal');
      b.box(0, 0.12, 0, 0.5, 0.15, 0.5, C.STEEL, 'metal');
    });
  });

