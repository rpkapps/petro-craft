// Player body physics: swept AABB vs voxel collision (per axis, MC-style), walking with coyote time & jump buffering,
// auto step-up, sneak edge protection, swimming and free flight. Pure — no three.js — so it can be unit-tested in node.
import { BODY, FLY, SWIM, WALK } from './config';

export interface VoxelQuery {
  /** Collidable cell (out-of-world cells should report solid on the sides/bottom). */
  solid(x: number, y: number, z: number): boolean;
  /** Liquid cell (water, oil). */
  liquid(x: number, y: number, z: number): boolean;
}

export interface Body {
  /** Feet position (centre of the footprint, bottom of the AABB). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** Body (waist) in liquid → swimming. */
  inLiquid: boolean;
  /** Eye in liquid → underwater (air timer, fog). */
  headInLiquid: boolean;
  /** Horizontal collision during the last step. */
  collidedH: boolean;
  /** Highest y since last touching ground (fall damage). */
  fallStartY: number;
  coyote: number;
  jumpBuffer: number;
}

export interface MoveIntent {
  /** World-space horizontal wish direction; magnitude 0..1 (analogue-friendly). */
  moveX: number;
  moveZ: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface StepEvents {
  jumped: boolean;
  /** Downward speed at touchdown (only set on the step that lands). */
  landed: number | null;
  /** Blocks fallen when landing (not counting water landings). */
  fallDistance: number;
  /** Total height gained by auto step-up (camera smoothing). */
  steppedUp: number;
  /** Entered / left liquid this step. */
  splashed: boolean;
  /** Touched the ground while flying (caller may leave flight). */
  flyTouchdown: boolean;
}

export const newStepEvents = (): StepEvents => ({ jumped: false, landed: null, fallDistance: 0, steppedUp: 0, splashed: false, flyTouchdown: false });

export function createBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, inLiquid: false, headInLiquid: false, collidedH: false, fallStartY: y, coyote: 0, jumpBuffer: 0 };
}

// ---- AABB helpers ----------------------------------------------------------------------------------
interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
const EPS = 1e-7;

function bodyBox(b: Body): Box {
  const hw = BODY.halfWidth;
  return { minX: b.x - hw, minY: b.y, minZ: b.z - hw, maxX: b.x + hw, maxY: b.y + BODY.height, maxZ: b.z + hw };
}

function offsetBox(a: Box, dx: number, dy: number, dz: number): Box {
  return { minX: a.minX + dx, minY: a.minY + dy, minZ: a.minZ + dz, maxX: a.maxX + dx, maxY: a.maxY + dy, maxZ: a.maxZ + dz };
}

/** Whether any solid cell overlaps the (open) box. */
export function boxOverlapsSolid(q: VoxelQuery, a: Box): boolean {
  const x0 = Math.floor(a.minX + EPS), x1 = Math.floor(a.maxX - EPS);
  const y0 = Math.floor(a.minY + EPS), y1 = Math.floor(a.maxY - EPS);
  const z0 = Math.floor(a.minZ + EPS), z1 = Math.floor(a.maxZ - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (q.solid(x, y, z)) return true;
  return false;
}

type Axis = 0 | 1 | 2;
const MIN: Array<'minX' | 'minY' | 'minZ'> = ['minX', 'minY', 'minZ'];
const MAX: Array<'maxX' | 'maxY' | 'maxZ'> = ['maxX', 'maxY', 'maxZ'];

/** Clip a movement `d` along `axis` against solid cells; returns the allowed movement. Cells already overlapped are ignored. */
function clipAxis(q: VoxelQuery, a: Box, axis: Axis, d: number): number {
  if (d === 0) return 0;
  const o1: Axis = axis === 0 ? 1 : 0;
  const o2: Axis = axis === 2 ? 1 : 2;
  const p0 = Math.floor(a[MIN[o1]] + EPS), p1 = Math.floor(a[MAX[o1]] - EPS);
  const q0 = Math.floor(a[MIN[o2]] + EPS), q1 = Math.floor(a[MAX[o2]] - EPS);
  const cell = (i: number, p: number, r: number) => {
    const c = [0, 0, 0];
    c[axis] = i;
    c[o1] = p;
    c[o2] = r;
    return q.solid(c[0], c[1], c[2]);
  };
  if (d > 0) {
    const from = Math.ceil(a[MAX[axis]] - EPS);
    const to = Math.floor(a[MAX[axis]] + d);
    for (let i = from; i <= to; i++) {
      const gap = i - a[MAX[axis]];
      if (gap >= d) break;
      for (let p = p0; p <= p1; p++) for (let r = q0; r <= q1; r++) if (cell(i, p, r)) return Math.max(0, gap);
    }
    return d;
  }
  const from = Math.floor(a[MIN[axis]] + EPS) - 1;
  const to = Math.floor(a[MIN[axis]] + d);
  for (let i = from; i >= to; i--) {
    const gap = i + 1 - a[MIN[axis]];
    if (gap <= d) break;
    for (let p = p0; p <= p1; p++) for (let r = q0; r <= q1; r++) if (cell(i, p, r)) return Math.min(0, gap);
  }
  return d;
}

function moveAxis(q: VoxelQuery, a: Box, axis: Axis, d: number): number {
  const m = clipAxis(q, a, axis, d);
  a[MIN[axis]] += m;
  a[MAX[axis]] += m;
  return m;
}

// ---- Stepping ----------------------------------------------------------------------------------------
const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));

function updateLiquid(b: Body, q: VoxelQuery): void {
  const hw = BODY.halfWidth - 0.05;
  const y0 = Math.floor(b.y + 0.2), y1 = Math.floor(b.y + 1.0);
  const x0 = Math.floor(b.x - hw), x1 = Math.floor(b.x + hw);
  const z0 = Math.floor(b.z - hw), z1 = Math.floor(b.z + hw);
  let wet = false;
  for (let y = y0; y <= y1 && !wet; y++) for (let z = z0; z <= z1 && !wet; z++) for (let x = x0; x <= x1 && !wet; x++) if (q.liquid(x, y, z)) wet = true;
  b.inLiquid = wet;
  b.headInLiquid = q.liquid(Math.floor(b.x), Math.floor(b.y + BODY.eyeHeight), Math.floor(b.z));
}

/** Advance the body by dt seconds (internally sub-stepped for stability). Events accumulate into `ev`. */
export function stepBody(b: Body, it: MoveIntent, flying: boolean, q: VoxelQuery, dt: number, ev: StepEvents): void {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) subStep(b, it, flying, q, h, ev);
}

function subStep(b: Body, it: MoveIntent, flying: boolean, q: VoxelQuery, dt: number, ev: StepEvents): void {
  const wasGround = b.onGround;
  const wasWet = b.inLiquid;
  updateLiquid(b, q);
  if (wasWet !== b.inLiquid && (b.inLiquid ? b.vy < -4 : false)) ev.splashed = true;
  const mag = Math.min(1, Math.hypot(it.moveX, it.moveZ));
  const hasInput = mag > 0.01;

  if (flying) {
    const sp = it.sprint ? FLY.sprintSpeed : FLY.speed;
    b.vx = approach(b.vx, it.moveX * sp, FLY.accel, dt);
    b.vz = approach(b.vz, it.moveZ * sp, FLY.accel, dt);
    const vs = it.sprint ? FLY.sprintVerticalSpeed : FLY.verticalSpeed;
    const vt = it.jump && !it.sneak ? vs : it.sneak && !it.jump ? -vs : 0;
    b.vy = approach(b.vy, vt, FLY.verticalAccel, dt);
    b.coyote = 0;
    b.fallStartY = b.y;
  } else if (b.inLiquid) {
    const sp = it.sprint ? SWIM.sprintSpeed : SWIM.speed;
    b.vx = approach(b.vx, it.moveX * sp, SWIM.accel, dt);
    b.vz = approach(b.vz, it.moveZ * sp, SWIM.accel, dt);
    if (it.jump) {
      b.vy = approach(b.vy, SWIM.swimUpSpeed, SWIM.verticalAccel, dt);
      if (b.collidedH) b.vy = Math.max(b.vy, SWIM.climbOutVelocity);
    } else if (it.sneak) {
      b.vy = approach(b.vy, -SWIM.swimDownSpeed, SWIM.verticalAccel, dt);
    } else {
      b.vy -= SWIM.sink * dt;
      b.vy *= Math.exp(-SWIM.drag * dt);
    }
    b.coyote = 0;
    b.jumpBuffer = 0;
    b.fallStartY = b.y;
  } else {
    const sp = it.sneak ? WALK.sneakSpeed : it.sprint ? WALK.sprintSpeed : WALK.walkSpeed;
    const rate = b.onGround ? (hasInput ? WALK.groundAccel : WALK.groundFriction) : WALK.airAccel;
    b.vx = approach(b.vx, it.moveX * sp, rate, dt);
    b.vz = approach(b.vz, it.moveZ * sp, rate, dt);
    b.coyote = b.onGround ? WALK.coyoteTime : Math.max(0, b.coyote - dt);
    if (b.jumpBuffer > 0) b.jumpBuffer = Math.max(0, b.jumpBuffer - dt);
    if ((b.jumpBuffer > 0 || (it.jump && b.onGround)) && b.coyote > 0) {
      b.vy = WALK.jumpVelocity;
      b.coyote = 0;
      b.jumpBuffer = 0;
      b.onGround = false;
      ev.jumped = true;
    }
    b.vy = Math.max(-WALK.terminalVelocity, b.vy - WALK.gravity * dt);
  }

  // Sneak edge protection (walk mode, on the ground): never step off a ledge deeper than the probe.
  let dx = b.vx * dt, dy = b.vy * dt, dz = b.vz * dt;
  const box = bodyBox(b);
  if (!flying && !b.inLiquid && it.sneak && wasGround) {
    const probe = -WALK.sneakEdgeProbe;
    const unsupported = (ox: number, oz: number) => !boxOverlapsSolid(q, offsetBox(box, ox, probe, oz));
    const shrink = (v: number) => (Math.abs(v) < 0.02 ? 0 : v - Math.sign(v) * 0.02);
    while (dx !== 0 && unsupported(dx, 0)) dx = shrink(dx);
    while (dz !== 0 && unsupported(0, dz)) dz = shrink(dz);
    while (dx !== 0 && dz !== 0 && unsupported(dx, dz)) {
      dx = shrink(dx);
      dz = shrink(dz);
    }
    if (dx !== b.vx * dt) b.vx = dx / dt;
    if (dz !== b.vz * dt) b.vz = dz / dt;
  }

  const start = { ...box };
  const my = moveAxis(q, box, 1, dy);
  const mx = moveAxis(q, box, 0, dx);
  const mz = moveAxis(q, box, 2, dz);
  let result = box;
  let clippedY = my !== dy;
  const hitX = mx !== dx, hitZ = mz !== dz;
  let stepped = 0;

  // Auto step-up onto ledges (only when grounded or wading).
  const stepH = it.sneak ? WALK.sneakStepHeight : WALK.stepHeight;
  if ((hitX || hitZ) && !flying && (wasGround || (dy < 0 && clippedY) || b.inLiquid)) {
    const alt = { ...start };
    const up = moveAxis(q, alt, 1, stepH);
    const ax = moveAxis(q, alt, 0, dx);
    const az = moveAxis(q, alt, 2, dz);
    const downWanted = -up + Math.min(0, dy);
    const down = moveAxis(q, alt, 1, downWanted);
    const landedOnLedge = down > downWanted + 1e-9;
    if (landedOnLedge && Math.hypot(ax, az) > Math.hypot(mx, mz) + 1e-4 && alt.minY > box.minY + 1e-4) {
      stepped = alt.minY - box.minY;
      result = alt;
      clippedY = true;
    }
  }

  const movedDown = dy < 0 && clippedY;
  b.x = (result.minX + result.maxX) / 2;
  b.y = result.minY;
  b.z = (result.minZ + result.maxZ) / 2;
  if (stepped > 0) {
    ev.steppedUp += stepped;
    b.vy = Math.max(0, b.vy);
  } else {
    if (hitX) b.vx = 0;
    if (hitZ) b.vz = 0;
  }
  b.collidedH = (hitX || hitZ) && stepped === 0;
  const impact = -b.vy;
  if (clippedY) b.vy = dy < 0 || stepped > 0 ? Math.max(0, b.vy) : Math.min(0, b.vy);
  b.onGround = movedDown || stepped > 0;

  if (flying) {
    if (b.onGround && it.sneak) ev.flyTouchdown = true;
    b.fallStartY = b.y;
    return;
  }
  if (!b.onGround) {
    if (!b.inLiquid) b.fallStartY = Math.max(b.fallStartY, b.y);
  } else if (!wasGround) {
    ev.landed = Math.max(ev.landed ?? 0, impact);
    ev.fallDistance = Math.max(ev.fallDistance, b.fallStartY - b.y);
    b.fallStartY = b.y;
  } else {
    b.fallStartY = b.y;
  }
  if (b.inLiquid) b.fallStartY = b.y;
}
