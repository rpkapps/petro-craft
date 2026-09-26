// Storage: bolted tank, floating-roof tank (roof rides with the fill level), gas sphere.
import type { Builder } from '../geom/Builder';
import { ladder, lampPost, spiralStair, tank } from '../geom/parts';
import { C } from '../palette';
import { fillFraction } from './common';
import type { ModelDef } from './types';

/** Low concrete bund wall around the footprint. */
function bund(b: Builder, hw: number, hd: number, h = 0.35): void {
  b.slab(-hw, 0, -hd, hw, h, -hd + 0.18, C.CONCRETE, 'rough');
  b.slab(-hw, 0, hd - 0.18, hw, h, hd, C.CONCRETE, 'rough');
  b.slab(-hw, 0, -hd, -hw + 0.18, h, hd, C.CONCRETE, 'rough');
  b.slab(hw - 0.18, 0, -hd, hw, h, hd, C.CONCRETE, 'rough');
  b.slab(-hw + 0.18, 0, -hd + 0.18, hw - 0.18, 0.04, hd - 0.18, C.GRAVEL, 'rough');
}

const oil_tank_small: ModelDef = {
  build(b) {
    bund(b, 1.98, 1.98);
    tank(b, { x: 0, z: 0, y0: 0.04, r: 1.62, h: 4.5, color: C.WHITE, roof: 'cone', bandY: 3.2 });
    // bolted panel seams
    b.detail(() => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box(Math.cos(a) * 1.63, 2.3, Math.sin(a) * 1.63, 0.04, 4.3, 0.04, C.STEEL_LIGHT, 'paint');
      }
    });
    // inlet/outlet nozzles and valve
    b.pipe([0, 0.45, -1.6], [0, 0.45, -1.98], 0.1, C.STEEL, 'metal', 8);
    b.wheel(0.18, 0.45, -1.8, 0.1, 'x', C.HAZARD);
    b.pipe([1.2, 0.45, 1.1], [1.7, 0.45, 1.6], 0.08, C.STEEL, 'metal', 8);
    b.box(-1.4, 0.25, 1.4, 0.4, 0.4, 0.05, C.HAZARD, 'paint');
  },
};

const oil_tank_large: ModelDef = {
  build(b) {
    bund(b, 3.98, 3.98, 0.45);
    const r = 3.35;
    const h = 5.8;
    const y0 = 0.04;
    b.cyl(0, y0, 0, r + 0.12, 0.15, C.CONCRETE, 'rough', 32);
    b.cyl(0, y0 + 0.15, 0, r, h, C.WHITE, 'paint', 32);
    // open top: inner wall visible
    b.cyl(0, y0 + 0.2, 0, r - 0.06, h - 0.05, C.STEEL, 'metal', 32);
    b.cyl(0, y0 + h * 0.62, 0, r + 0.03, 0.75, b.company, 'paint', 32);
    b.ring(0, y0 + h * 0.62 - 0.08, 0, r + 0.04, 0.05, C.GUNMETAL, 'metal', 32);
    // wind girder with walkway at the top
    b.ring(0, y0 + h - 0.35, 0, r + 0.25, 0.22, C.STEEL_DARK, 'metal', 32);
    b.detail(() => {
      b.ring(0, y0 + h + 0.6, 0, r + 0.45, 0.035, C.HAZARD, 'paint', 32);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        b.box(Math.cos(a) * (r + 0.45), y0 + h + 0.15, Math.sin(a) * (r + 0.45), 0.04, 0.9, 0.04, C.HAZARD, 'paint');
      }
      for (let y = 1; y < h; y += 1.2) b.ring(0, y0 + y, 0, r + 0.02, 0.025, C.WHITE, 'paint', 32);
    });
    // floating roof deck (animated)
    b.group('roof', 0, y0 + h * 0.5, 0, () => {
      b.cyl(0, 0, 0, r - 0.12, 0.2, C.STEEL_LIGHT, 'metal', 32);
      b.ring(0, 0.2, 0, r - 0.4, 0.08, C.STEEL, 'metal', 32);
      b.detail(() => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          b.cyl(Math.cos(a) * 1.6, 0.2, Math.sin(a) * 1.6, 0.12, 0.25, C.GUNMETAL, 'metal', 8);
        }
        b.box(0, 0.24, 0, 1.2, 0.06, 0.5, C.STEEL_DARK, 'metal');
      });
    });
    // rolling ladder pivot & foam chambers
    b.detail(() => {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        b.box(Math.cos(a) * (r + 0.15), y0 + h - 0.8, Math.sin(a) * (r + 0.15), 0.3, 0.45, 0.3, C.RED, 'paint');
      }
    });
    spiralStair(b, 0, 0, y0 + 0.15, y0 + h - 0.3, r, 0.5);
    b.pipe([0, 0.55, -r], [0, 0.55, -3.98], 0.14, C.STEEL, 'metal', 8);
    b.pipe([r * 0.7, 0.55, r * 0.7], [3.4, 0.55, 3.4], 0.12, C.STEEL, 'metal', 8);
    b.anchor('light', r + 0.5, y0 + h + 0.8, 0, { intensity: 0.5, range: 10 });
  },
  ambient: true,
  animate(a) {
    const roof = a.node('roof');
    if (!roof) return;
    const f = fillFraction(a.b, 60000 * 2);
    const target = 0.3 + (5.8 - 0.8) * Math.max(0.05, Math.min(1, f * 1.6));
    roof.position.y += (target - roof.position.y) * Math.min(1, a.dt * 0.4);
  },
  activity() {
    return 1;
  },
};

const gas_sphere: ModelDef = {
  build(b) {
    const cy = 3.85;
    const r = 2.65;
    b.slab(-2.95, 0, -2.95, 2.95, 0.12, 2.95, C.CONCRETE, 'rough');
    b.sphere(0, cy, 0, r, C.WHITE, 'paint', 28);
    b.cyl(0, cy - 0.2, 0, r + 0.02, 0.4, b.company, 'paint', 28);
    // legs with X bracing
    const n = 8;
    const legR = r * 0.92;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * legR;
      const z = Math.sin(a) * legR;
      b.cyl(x, 0.12, z, 0.14, cy - 0.12, C.WHITE, 'paint', 10);
      b.cyl(x, 0.12, z, 0.24, 0.25, C.CONCRETE_DARK, 'rough', 8);
      const a2 = ((i + 1) / n) * Math.PI * 2;
      const x2 = Math.cos(a2) * legR;
      const z2 = Math.sin(a2) * legR;
      b.detail(() => {
        b.pipe([x, 0.5, z], [x2, cy * 0.7, z2], 0.03, C.STEEL, 'metal', 4);
        b.pipe([x2, 0.5, z2], [x, cy * 0.7, z], 0.03, C.STEEL, 'metal', 4);
      });
    }
    // top platform + stair column
    b.cyl(0, cy + r - 0.05, 0, 0.8, 0.12, C.STEEL_DARK, 'metal', 16);
    b.detail(() => b.ring(0, cy + r + 0.95, 0, 0.8, 0.035, C.HAZARD, 'paint', 16));
    b.cyl(0.4, cy + r + 0.05, 0.2, 0.12, 0.45, C.STEEL, 'metal', 8);
    b.box(0.4, cy + r + 0.55, 0.2, 0.3, 0.14, 0.3, C.RED, 'paint');
    // stair tower on the side to the top
    const sx = -r - 0.3;
    for (const dz of [-0.35, 0.35]) b.box(sx, (cy + r) / 2, dz, 0.08, cy + r, 0.08, C.STEEL_DARK, 'paint');
    b.detail(() => {
      for (let y = 0.5; y < cy + r; y += 0.3) b.box(sx, y, 0, 0.28, 0.04, 0.7, C.STEEL, 'metal');
    });
    b.beam([sx, cy + r, 0], [-0.7, cy + r + 0.05, 0], 0.18, C.STEEL_DARK, 'metal', 0.6);
    ladder(b, sx - 0.3, 0, 0, cy + r, Math.PI, true);
    // bottom nozzle & pipe
    b.pipe([0, cy - r + 0.1, 0], [0, 0.5, 0], 0.12, C.HAZARD, 'metal', 8);
    b.pipe([0, 0.5, 0], [0, 0.5, 2.95], 0.12, C.HAZARD, 'metal', 8);
    lampPost(b, 2.7, -2.7, 0.12, 3.5, Math.PI * 0.75, 0.8);
  },
};

export const STORAGE_MODELS: Record<string, ModelDef> = { oil_tank_small, oil_tank_large, gas_sphere };
