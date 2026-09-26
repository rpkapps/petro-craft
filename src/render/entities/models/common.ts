// Helpers shared by model definitions (animation math, wind orientation, recurring props).
import type { BuildingState, GameContext } from '../../../core/types';
import type { Builder } from '../geom/Builder';
import { C } from '../palette';
import type { AnimState } from './types';

/** Local yaw (radians, rotation.y) that makes a +x-pointing part face the wind's downwind direction. */
export function windYawLocal(a: AnimState): number {
  const dir = a.ctx.state.weather?.windDir ?? 0;
  return -dir + (a.b.rotation * Math.PI) / 2;
}

export function windSpeed(ctx: GameContext): number {
  return ctx.state.weather?.windSpeed ?? 4;
}

/** Spin a node around its local Y axis at `rps` revolutions per second (scaled by speed). */
export function spinY(a: AnimState, node: string, rps: number): void {
  const n = a.node(node);
  if (n) n.rotation.y = (n.rotation.y + a.dt * rps * Math.PI * 2 * a.speed) % (Math.PI * 2);
}

export function spinX(a: AnimState, node: string, rps: number): void {
  const n = a.node(node);
  if (n) n.rotation.x = (n.rotation.x + a.dt * rps * Math.PI * 2 * a.speed) % (Math.PI * 2);
}

export function spinZ(a: AnimState, node: string, rps: number): void {
  const n = a.node(node);
  if (n) n.rotation.z = (n.rotation.z + a.dt * rps * Math.PI * 2 * a.speed) % (Math.PI * 2);
}

/** Ease a node's yaw toward a target angle. */
export function turnToward(a: AnimState, node: string, target: number, rate = 1.5): void {
  const n = a.node(node);
  if (!n) return;
  const d = Math.atan2(Math.sin(target - n.rotation.y), Math.cos(target - n.rotation.y));
  n.rotation.y += d * Math.min(1, a.dt * rate);
}

/** Flag pole with company flag at (x,z), pole height h. */
export function flagPole(b: Builder, x: number, z: number, y0: number, h: number, flagW = 1.1): void {
  b.cyl(x, y0, z, 0.06, h, C.STEEL_LIGHT, 'metal', 6);
  b.sphere(x, y0 + h + 0.05, z, 0.08, C.HAZARD, 'paint', 6);
  b.flag(x + 0.05, y0 + h - 0.05, z, flagW, flagW * 0.62);
}

/** Pickup truck (≈2.6 long along x) parked at (x,z). */
export function pickup(b: Builder, x: number, y0: number, z: number, ry: number, color: number = C.WHITE): void {
  b.at(x, y0, z, ry, () => {
    b.box(0, 0.42, 0, 2.6, 0.45, 1.15, color, 'paint');
    b.box(-0.25, 0.88, 0, 1.0, 0.5, 1.05, color, 'paint');
    b.box(0.26, 0.9, 0, 0.04, 0.38, 0.9, C.GLASS_DARK, 'glassDark');
    b.box(-0.25, 0.9, 0.53, 0.8, 0.3, 0.02, C.GLASS_DARK, 'glassDark');
    b.box(-0.25, 0.9, -0.53, 0.8, 0.3, 0.02, C.GLASS_DARK, 'glassDark');
    b.box(1.31, 0.45, 0, 0.04, 0.12, 1.0, C.STEEL_LIGHT, 'metal');
    b.box(1.31, 0.58, 0.4, 0.03, 0.08, 0.18, C.LAMP_WHITE, 'lamp');
    b.box(1.31, 0.58, -0.4, 0.03, 0.08, 0.18, C.LAMP_WHITE, 'lamp');
    b.box(-1.31, 0.58, 0.45, 0.03, 0.1, 0.12, C.LAMP_RED, 'lamp');
    b.box(-1.31, 0.58, -0.45, 0.03, 0.1, 0.12, C.LAMP_RED, 'lamp');
    b.box(-0.25, 1.16, 0, 0.35, 0.08, 0.9, C.LAMP_AMBER, 'lamp');
    b.box(0.1, 0.5, 0.585, 0.9, 0.1, 0.02, b.company, 'paint');
    b.box(0.1, 0.5, -0.585, 0.9, 0.1, 0.02, b.company, 'paint');
    for (const wx of [-0.8, 0.85]) for (const wz of [-0.55, 0.55]) b.cylZ(wx, 0.24, wz, 0.24, 0.2, C.RUBBER, 'rough', 10);
  });
}

/** Default activity helper: storage fill fraction for tanks. */
export function fillFraction(b: BuildingState, cap: number): number {
  let t = 0;
  for (const v of Object.values(b.storage)) t += v;
  return Math.max(0, Math.min(1, t / Math.max(1, cap)));
}

/** Low perimeter fence posts with chain-link rails around a rectangle. */
export function fence(b: Builder, x0: number, z0: number, x1: number, z1: number, h = 1.1, gap = ''): void {
  b.detail(() => {
    const side = (ax: number, az: number, bx: number, bz: number, key: string) => {
      if (gap.includes(key)) return;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= n; i++) b.box(ax + ((bx - ax) * i) / n, h / 2, az + ((bz - az) * i) / n, 0.05, h, 0.05, C.GALV, 'metal');
      b.beam([ax, h, az], [bx, h, bz], 0.03, C.GALV, 'metal');
      b.beam([ax, 0.1, az], [bx, 0.1, bz], 0.03, C.GALV, 'metal');
    };
    side(x0, z0, x1, z0, 'n');
    side(x0, z1, x1, z1, 's');
    side(x0, z0, x0, z1, 'w');
    side(x1, z0, x1, z1, 'e');
  });
}

/** Concrete / gravel pad covering the footprint. */
export function pad(b: Builder, w: number, d: number, color: number = C.CONCRETE, inset = 0.02): void {
  b.slab(-w / 2 + inset, 0, -d / 2 + inset, w / 2 - inset, 0.06, d / 2 - inset, color, 'rough');
}
