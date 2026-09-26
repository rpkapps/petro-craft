// Derrick, drill floor and travelling equipment shared by land and offshore rigs, plus the rig
// animation (top drive descending while drilling, fast tripping cycles, pipe connections).
import type { Builder } from '../geom/Builder';
import { latticeMast, railRect, ladder } from '../geom/parts';
import { C } from '../palette';
import { flagPole } from './common';
import type { AnimState } from './types';

export interface DerrickSpec {
  floorY: number;
  /** Derrick top (crown) height above origin. */
  topY: number;
  hw0: number;
  hw1: number;
  color: number;
  braceColor?: number;
  /** Travelling block travel above the floor [min, max]. */
  travel: [number, number];
  heavy?: boolean;
  windwalls?: number;
}

/** BOP stack + wellhead under the drill floor at (0, y0..floorY). */
export function bopStack(b: Builder, y0: number, floorY: number, s = 1): void {
  const top = floorY - 0.15;
  const h = top - y0;
  b.cyl(0, y0, 0, 0.42 * s, 0.18, C.STEEL_DARK, 'metal', 12);
  b.cyl(0, y0 + 0.18, 0, 0.26 * s, h * 0.18, C.STEEL, 'metal', 12);
  let y = y0 + 0.18 + h * 0.18;
  const ramH = h * 0.14;
  for (let i = 0; i < 3; i++) {
    b.box(0, y + ramH / 2, 0, 0.62 * s, ramH * 0.9, 0.5 * s, i === 1 ? C.HAZARD : C.RED, 'paint');
    b.cylX(0, y + ramH / 2, 0, 0.12 * s, 1.15 * s, C.STEEL_LIGHT, 'metal', 8);
    y += ramH;
  }
  b.cyl(0, y, 0, 0.38 * s, h * 0.16, C.RED, 'paint', 14);
  b.dome(0, y + h * 0.16, 0, 0.38 * s, C.RED, 'paint', 14, 0.18 * s);
  b.cyl(0, y + h * 0.16, 0, 0.15 * s, top - (y + h * 0.16), C.STEEL, 'metal', 10);
  // choke & kill lines
  b.pipe([0.3 * s, y0 + h * 0.45, 0], [0.9 * s, y0 + h * 0.45, 0.6 * s], 0.05, C.STEEL_LIGHT, 'metal');
  b.pipe([-0.3 * s, y0 + h * 0.45, 0], [-0.9 * s, y0 + h * 0.45, -0.6 * s], 0.05, C.STEEL_LIGHT, 'metal');
}

/** Derrick with crown, racking board, lights, flag and the animated travelling equipment. */
export function derrick(b: Builder, s: DerrickSpec): void {
  const { floorY, topY } = s;
  latticeMast(b, {
    x: 0,
    z: 0,
    y0: floorY,
    y1: topY,
    hw0: s.hw0,
    hw1: s.hw1,
    panel: s.heavy ? 1.55 : 1.35,
    leg: s.heavy ? 0.2 : 0.16,
    brace: s.heavy ? 0.065 : 0.055,
    color: s.color,
    braceColor: s.braceColor,
    openSide: '+x',
    openPanels: 2,
  });
  // windwalls on the lower derrick
  if (s.windwalls) {
    const wy = floorY + s.windwalls;
    for (const side of [-1, 1]) b.slab(-s.hw0, floorY + 0.4, side * s.hw0 - 0.03, s.hw0, wy, side * s.hw0 + 0.03, b.company, 'paint');
    b.slab(-s.hw0 - 0.03, floorY + 0.4, -s.hw0, -s.hw0 + 0.03, wy, s.hw0, b.company, 'paint');
  }
  // crown block
  const crownY = topY;
  b.slab(-s.hw1 - 0.25, crownY, -s.hw1 - 0.25, s.hw1 + 0.25, crownY + 0.18, s.hw1 + 0.25, C.STEEL_DARK, 'metal');
  b.box(0, crownY + 0.5, 0, s.hw1 * 1.6, 0.6, s.hw1 * 1.2, C.HAZARD, 'paint');
  for (let i = -1; i <= 1; i++) b.cylX(0, crownY + 0.55, i * s.hw1 * 0.35, 0.28, 0.12, C.STEEL_LIGHT, 'metal', 12);
  b.box(0, crownY + 0.9, 0, s.hw1 * 1.8, 0.12, s.hw1 * 1.8, C.STEEL_DARK, 'metal');
  railRect(b, -s.hw1 - 0.25, -s.hw1 - 0.25, s.hw1 + 0.25, s.hw1 + 0.25, crownY + 0.18);
  // aviation light & flag
  b.box(0, crownY + 1.1, 0, 0.18, 0.18, 0.18, C.LAMP_RED, 'blink');
  flagPole(b, s.hw1 + 0.15, s.hw1 + 0.15, crownY + 0.18, 1.8, s.heavy ? 1.5 : 1.25);
  // racking board (monkey board) on the -x side
  const rbY = floorY + (topY - floorY) * 0.62;
  const rbW = s.hw0 + (s.hw1 - s.hw0) * 0.62;
  b.slab(-rbW - 1.0, rbY - 0.1, -rbW * 0.8, -rbW + 0.05, rbY, rbW * 0.8, C.STEEL_DARK, 'metal');
  b.detail(() => {
    for (let i = 0; i < 6; i++) b.box(-rbW - 0.9 + i * 0.16, rbY + 0.4, 0, 0.04, 0.8, rbW * 1.5, C.HAZARD, 'paint');
  });
  // racked pipe stands leaning in the derrick
  b.detail(() => {
    for (let i = 0; i < 7; i++) {
      const z = -rbW * 0.6 + i * rbW * 0.2;
      b.pipe([-rbW + 0.35, floorY + 0.1, z], [-rbW - 0.35, rbY + 0.7, z], 0.05, C.RUST, 'metal', 6);
    }
  });
  // mast floodlights + anchors
  const lamps = s.heavy ? [0.3, 0.55, 0.8] : [0.35, 0.7];
  for (const f of lamps) {
    const y = floorY + (topY - floorY) * f;
    const w = s.hw0 + (s.hw1 - s.hw0) * f;
    for (const [x, z] of [
      [w + 0.08, w + 0.08],
      [-w - 0.08, -w - 0.08],
    ])
      b.box(x, y, z, 0.18, 0.14, 0.18, C.LAMP_WHITE, 'lamp');
  }
  b.anchor('light', 0, floorY + (topY - floorY) * 0.5, 0, { intensity: s.heavy ? 1.6 : 1.2, color: 0xfff0d8, range: 22 });
  b.anchor('light', 0, floorY + 1.8, 0, { intensity: 1, color: 0xffe8c0, range: 14 });
  // guide rails for the top drive (inside, -x)
  b.box(-0.45, (floorY + topY) / 2 + 0.5, 0, 0.08, topY - floorY - 2, 0.08, C.STEEL_DARK, 'metal');
  // travelling block + top drive (animated)
  const [tMin, tMax] = s.travel;
  const mid = floorY + (tMin + tMax) / 2;
  b.group('block', 0, mid, 0, () => {
    const k = s.heavy ? 1.2 : 1;
    b.box(0, 0.55 * k, 0, 0.5 * k, 0.7 * k, 0.36 * k, C.HAZARD, 'paint');
    b.cylX(0, 0.72 * k, 0, 0.2 * k, 0.4 * k, C.STEEL_LIGHT, 'metal', 10);
    // top drive motor & body
    b.box(0, -0.1, 0, 0.62 * k, 0.8 * k, 0.55 * k, b.company, 'paint');
    b.box(-0.38 * k, 0, 0, 0.16, 0.6 * k, 0.4 * k, C.STEEL_DARK, 'paint');
    b.cyl(0.05, 0.3 * k, 0.15, 0.08, 0.35, C.STEEL, 'metal', 6);
    b.pipe([0.05, 0.62 * k, 0.15], [0.35, 0.8 * k, 0.15], 0.06, C.RUBBER, 'rough', 6);
    b.box(0, -0.62 * k, 0, 0.32, 0.25, 0.32, C.STEEL_DARK, 'metal');
  });
  b.group('lines', 0, crownY, 0, () => {
    for (const z of [-0.12, -0.04, 0.04, 0.12]) b.box(0, -0.5, z, 0.02, 1, 0.02, C.GUNMETAL, 'metal');
  });
  b.group('string', 0, floorY, 0, () => {
    b.cyl(0, 0, 0, 0.07, 1, C.STEEL_LIGHT, 'metal', 8);
    b.box(0.07, 0.5, 0, 0.02, 1, 0.04, b.company, 'paint');
  });
  // pipe on the floor rotary + iron roughneck
  b.cyl(0, floorY, 0, 0.45, 0.14, C.GUNMETAL, 'metal', 14);
  b.box(0.95, floorY + 0.45, -0.7, 0.4, 0.9, 0.4, C.HAZARD, 'paint');
}

/** Drill floor deck with drawworks, doghouse, stairs and V-door ramp. */
export function drillFloor(b: Builder, floorY: number, hw: number, heavy = false): void {
  // deck
  b.slab(-hw, floorY - 0.18, -hw, hw, floorY, hw, C.STEEL_DARK, 'metal');
  railRect(b, -hw, -hw, hw, hw, floorY, C.HAZARD, 'e');
  // drawworks (-x side)
  const dx = -hw + 0.55;
  b.slab(dx - 0.45, floorY, -0.8, dx + 0.45, floorY + 0.8, 0.8, C.STEEL, 'paint');
  b.cylZ(dx, floorY + 0.55, 0, 0.38, 1.3, b.company, 'paint', 14);
  b.box(dx - 0.35, floorY + 0.55, 0.9, 0.5, 0.6, 0.3, C.GUNMETAL, 'paint');
  // driller's cabin on the floor edge (+z side)
  const cab = heavy ? 1.6 : 1.2;
  b.slab(-hw + 0.1, floorY, hw - cab, -hw + 0.1 + cab, floorY + 1.3, hw, C.WHITE, 'paint');
  b.slab(-hw + 0.08, floorY + 0.55, hw - cab - 0.02, -hw + 0.12 + cab, floorY + 1.05, hw - cab + 0.02, C.GLASS, 'glass');
  b.slab(-hw + 0.1 + cab - 0.02, floorY + 0.55, hw - cab + 0.1, -hw + 0.12 + cab, floorY + 1.05, hw - 0.1, C.GLASS, 'glass');
  b.slab(-hw + 0.05, floorY + 1.3, hw - cab - 0.05, -hw + 0.15 + cab, floorY + 1.42, hw + 0.05, C.STEEL, 'metal');
  // mouse hole / kelly rack
  b.cyl(0.7, floorY - 0.6, 0.7, 0.12, 0.9, C.STEEL, 'metal', 8);
}

/** Travelling equipment animation for any rig. */
export function animateRig(a: AnimState, floorY: number, travel: [number, number], crownY: number): void {
  const block = a.node('block');
  const lines = a.node('lines');
  const str = a.node('string');
  if (!block || !lines || !str) return;
  const [tMin, tMax] = travel;
  const status = a.well?.status ?? '';
  const m = a.mem;
  if (m.pos === undefined) {
    m.pos = (tMin + tMax) / 2;
    m.phase = 0;
  }
  let spin = 0;
  const sp = a.speed;
  const dt = a.dt;
  if (sp > 0.01 && (status === 'drilling' || status === 'completing')) {
    // drill down slowly while rotating, then pull up quickly to make a connection
    if (m.phase === 0) {
      m.pos -= dt * sp * 0.75;
      spin = 1.6 * sp;
      if (m.pos <= tMin) m.phase = 1;
    } else {
      m.pos += dt * sp * 3.5;
      if (m.pos >= tMax) m.phase = 0;
    }
  } else if (sp > 0.01 && (status === 'tripping' || status === 'casing')) {
    const rate = status === 'casing' ? 1.6 : 3.2;
    if (m.phase === 0) {
      m.pos += dt * sp * rate;
      if (m.pos >= tMax) m.phase = 1;
    } else {
      m.pos -= dt * sp * rate;
      if (m.pos <= tMin) m.phase = 0;
    }
  } else {
    const rest = tMin + (tMax - tMin) * 0.35;
    m.pos += (rest - m.pos) * Math.min(1, dt * 0.8);
  }
  m.pos = Math.max(tMin, Math.min(tMax, m.pos));
  const y = floorY + m.pos;
  block.position.y = y;
  lines.scale.y = Math.max(0.1, crownY + 0.4 - (y + 0.8));
  str.scale.y = Math.max(0.05, y - 0.7 - floorY);
  if (spin > 0) str.rotation.y = (str.rotation.y + dt * spin * Math.PI * 2) % (Math.PI * 2);
}

