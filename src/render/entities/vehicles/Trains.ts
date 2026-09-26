// Unit trains at rail terminals. The terminal's track is extended along its long axis to the map edges
// (stopping short of other buildings) with a grade-limited profile: gravel embankments over dips,
// concrete-pier bridges over water and deep valleys, buffer stops on dead-end stubs. Trains (a
// locomotive at each end and tank cars) run in from the nearest open edge, stop under the loading
// rack, load, and leave forward through the far edge — or back out when the far side is a stub.
// Service frequency ∝ the terminal's sales utilisation.
import * as THREE from 'three';
import { SEA_LEVEL } from '../../../core/constants';
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { Builder } from '../geom/Builder';
import { instantiate, type ModelObject } from '../models/instantiate';
import { C } from '../palette';
import { salesActivity } from './activity';
import { locoTemplate, tankCarTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const CARS = 6;
const LOCO_LEN = 7;
const CAR_LEN = 5.9;
const TRAIN_LEN = 2 * LOCO_LEN + CARS * CAR_LEN;
const VMAX = 10;
const VYARD = 5;
const ACC = 0.9;
/** Max track grade (rise per block). */
const GRADE = 0.07;
/** Rail top above the track base. */
const RAIL_TOP = 0.3;
/** Deck clearance over water / gap that switches embankment → bridge. */
const BRIDGE_GAP = 3.5;
/** Hide cars farther than this from the camera. */
const VIEW_DIST = 260;

interface Line {
  key: string;
  structVersion: number;
  center: THREE.Vector3;
  dir: THREE.Vector3;
  /** Track extent along the axis: s ∈ [sMin, sMax]; open = reaches the map edge. */
  sMin: number;
  sMax: number;
  openMin: boolean;
  openMax: boolean;
  /** Track base height per block from sMin. */
  profile: Float32Array;
  track: ModelObject | null;
  cars: Vehicle[];
  /** Train centre along the axis. */
  sc: number;
  from: number;
  to: number;
  /** Arrival side (+1: arrives from sMax). */
  side: number;
  speed: number;
  state: 'wait' | 'arrive' | 'load' | 'depart';
  timer: number;
}

export class TrainTraffic {
  private readonly lines = new Map<string, Line>();

  constructor(private readonly env: VehicleEnv) {}

  update(dt: number, views: Map<string, BuildingView>): void {
    const state = this.env.ctx.state;
    const seen = new Set<string>();
    const sv = this.env.structVersion();
    for (const v of views.values()) {
      if (v.type !== 'rail_terminal' || v.status === 'constructing' || v.status === 'destroyed') continue;
      const b = state.buildings[v.id];
      const ta = v.anchors.find((a) => a.def.kind === 'track');
      const td = v.anchors.find((a) => a.def.kind === 'trackDir');
      if (!b || !ta || !td) continue;
      const key = `${b.x},${b.y},${b.z},${b.rotation}`;
      seen.add(v.id);
      let line = this.lines.get(v.id);
      if (line && (line.key !== key || (line.structVersion !== sv && line.state === 'wait'))) {
        this.disposeLine(line);
        line = undefined;
      }
      if (!line) {
        line = this.createLine(key, sv, b, ta.pos, td.pos);
        this.lines.set(v.id, line);
      }
      this.step(line, dt, salesActivity(b, v));
    }
    for (const [id, line] of this.lines)
      if (!seen.has(id)) {
        this.disposeLine(line);
        this.lines.delete(id);
      }
  }

  private createLine(key: string, sv: number, b: BuildingState, anchor: THREE.Vector3, ahead: THREE.Vector3): Line {
    const center = anchor.clone();
    center.y -= RAIL_TOP;
    const dir = new THREE.Vector3(ahead.x - anchor.x, 0, ahead.z - anchor.z).normalize();
    const halfT = Math.abs(dir.x) * (b.size[0] / 2) + Math.abs(dir.z) * (b.size[1] / 2);
    const [sMax, openMax] = this.extent(b, center, dir, 1, halfT);
    const [negMax, openMin] = this.extent(b, center, dir, -1, halfT);
    const sMin = -negMax;
    const profile = this.profile(center, dir, sMin, sMax, halfT);
    const line: Line = {
      key, structVersion: sv, center, dir, sMin, sMax, openMin, openMax, profile, track: null, cars: [],
      sc: 0, from: 0, to: 0, side: 1, speed: 0, state: 'wait', timer: 3 + Math.random() * 5,
    };
    line.track = this.buildTrack(line, halfT);
    this.env.group.add(line.track.root);
    const company = this.env.lib.company;
    line.cars.push(new Vehicle(this.env, locoTemplate(company)));
    for (let i = 0; i < CARS; i++) line.cars.push(new Vehicle(this.env, tankCarTemplate(company, i)));
    line.cars.push(new Vehicle(this.env, locoTemplate(company)));
    for (const c of line.cars) c.obj.visible = false;
    return line;
  }

  /** Distance along ±dir to the map edge (open) or to just before the first other building (stub). */
  private extent(self: BuildingState, c: THREE.Vector3, dir: THREE.Vector3, sign: number, halfT: number): [number, boolean] {
    const w = this.env.ctx.world;
    const dx = dir.x * sign;
    const dz = dir.z * sign;
    // distance to the map boundary along the ray
    let edge = Infinity;
    if (dx > 1e-6) edge = Math.min(edge, (w.sizeX - c.x) / dx);
    if (dx < -1e-6) edge = Math.min(edge, -c.x / dx);
    if (dz > 1e-6) edge = Math.min(edge, (w.sizeZ - c.z) / dz);
    if (dz < -1e-6) edge = Math.min(edge, -c.z / dz);
    edge = Math.max(halfT + 4, edge);
    // buildings whose footprint (+1 clearance) the corridor crosses
    const bs = this.env.ctx.state.buildings;
    let stop = edge;
    for (const id in bs) {
      const o = bs[id];
      if (o.id === self.id) continue;
      const x0 = o.x - 1.6;
      const x1 = o.x + o.size[0] + 1.6;
      const z0 = o.z - 1.6;
      const z1 = o.z + o.size[1] + 1.6;
      // ray/box slab test
      let t0 = halfT;
      let t1 = stop;
      for (const [p, d, lo, hi] of [
        [c.x, dx, x0, x1],
        [c.z, dz, z0, z1],
      ]) {
        if (Math.abs(d) < 1e-6) {
          if (p < lo || p > hi) t0 = Infinity;
        } else {
          const a = (lo - p) / d;
          const bb = (hi - p) / d;
          t0 = Math.max(t0, Math.min(a, bb));
          t1 = Math.min(t1, Math.max(a, bb));
        }
      }
      if (t0 <= t1 && t0 < stop) stop = t0;
    }
    if (stop < edge) return [Math.max(halfT + 3, stop - 2), false];
    return [edge, true];
  }

  /** Grade-limited upper envelope of the ground (never below terrain, bridged over water). */
  private profile(c: THREE.Vector3, dir: THREE.Vector3, sMin: number, sMax: number, halfT: number): Float32Array {
    const n = Math.max(2, Math.ceil(sMax - sMin) + 1);
    const p = new Float32Array(n);
    const pinned = new Uint8Array(n);
    const t = this.env.terrain;
    for (let i = 0; i < n; i++) {
      const s = sMin + i;
      if (Math.abs(s) <= halfT + 0.5) {
        p[i] = c.y;
        pinned[i] = 1;
        continue;
      }
      const x = c.x + dir.x * s;
      const z = c.z + dir.z * s;
      p[i] = t.isWater(x, z) ? SEA_LEVEL + 1 + BRIDGE_GAP * 0.7 : t.ground(x, z);
    }
    const ground = Float32Array.from(p);
    // light smoothing of the raw terrain before the envelope (voxel steps)
    for (let pass = 0; pass < 2; pass++)
      for (let i = 1; i < n - 1; i++) if (!pinned[i]) p[i] = Math.max(ground[i], (p[i - 1] + 2 * p[i] + p[i + 1]) / 4);
    for (let i = 1; i < n; i++) if (!pinned[i]) p[i] = Math.max(p[i], p[i - 1] - GRADE);
    for (let i = n - 2; i >= 0; i--) if (!pinned[i]) p[i] = Math.max(p[i], p[i + 1] - GRADE);
    // ease the climb away from the terminal's rail level (a short cut is preferable to a step)
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const d = Math.abs(sMin + i) - halfT;
      p[i] = Math.min(p[i], c.y + d * GRADE * 1.5);
    }
    return p;
  }

  private height(l: Line, s: number): number {
    const f = Math.max(0, Math.min(l.profile.length - 1.001, s - l.sMin));
    const i = Math.floor(f);
    const k = f - i;
    return l.profile[i] * (1 - k) + l.profile[i + 1] * k;
  }

  /** Track, embankments, bridges and buffer stops in a frame whose +x runs along the axis (absolute y). */
  private buildTrack(l: Line, halfT: number): ModelObject {
    const b = new Builder(this.env.lib.company);
    const t = this.env.terrain;
    const geo = this.env.ctx.geology;
    const w = this.env.ctx.world;
    const H = (s: number) => this.height(l, s);
    const worldAt = (s: number): [number, number] => [l.center.x + l.dir.x * s, l.center.z + l.dir.z * s];
    const ranges: [number, number][] = [
      [l.sMin, -halfT],
      [halfT, l.sMax],
    ];
    const STEP = 3;
    for (const [a, z] of ranges) {
      if (z - a < 0.5) continue;
      for (let s = a; s < z - 1e-3; s += STEP) {
        const s1 = Math.min(z, s + STEP);
        const y0 = H(s);
        const y1 = H(s1);
        const [gx, gz] = worldAt((s + s1) / 2);
        const inMap = gx >= 0 && gz >= 0 && gx < w.sizeX && gz < w.sizeZ;
        const water = inMap && t.isWater(gx, gz);
        const ground = inMap ? (water ? geo.surfaceHeight(Math.floor(gx), Math.floor(gz)) : t.ground(gx, gz)) : Math.min(y0, y1);
        const gap = Math.min(y0, y1) - ground;
        const bridge = water || gap > BRIDGE_GAP;
        // ballast bed / bridge deck
        if (bridge) {
          b.beam([s, y0 - 0.25, 0], [s1, y1 - 0.25, 0], 0.5, C.STEEL_DARK, 'paint', 2.2);
          b.beam([s, y0 + 0.02, 0], [s1, y1 + 0.02, 0], 0.08, C.GRAVEL, 'rough', 2.0);
        } else {
          b.beam([s, y0 - 0.05, 0], [s1, y1 - 0.05, 0], 0.34, C.GRAVEL, 'rough', 2.0);
          if (gap > 0.35) {
            // embankment: stepped fill down to the ground
            const top = Math.min(y0, y1) - 0.2;
            const hgt = top - ground + 0.3;
            b.box((s + s1) / 2, ground - 0.3 + hgt / 2, 0, s1 - s + 0.05, hgt, 2.6 + hgt * 0.9, 0x7a6f5c, 'rough');
          }
        }
        // rails
        for (const zz of [-0.55, 0.55]) b.beam([s, y0 + RAIL_TOP - 0.05, zz], [s1, y1 + RAIL_TOP - 0.05, zz], 0.1, C.STEEL, 'metal');
        // sleepers
        for (let q = s; q < s1 - 1e-3; q += 1) b.box(q + 0.3, H(q + 0.3) + 0.16, 0, 0.22, 0.08, 1.5, C.WOOD, 'rough');
        // bridge piers
        if (bridge && Math.round(s / STEP) % 2 === 0) {
          const pierTop = y0 - 0.5;
          const base = Math.min(ground, pierTop - 0.5) - 0.5;
          b.box(s, (pierTop + base) / 2, 0, 0.7, pierTop - base, 2.0, C.CONCRETE_DARK, 'rough');
          b.box(s, pierTop - 0.15, 0, 0.9, 0.3, 2.6, C.CONCRETE, 'rough');
        }
        if (bridge)
          b.detail(() => {
            for (const zz of [-1.05, 1.05]) {
              b.beam([s, y0 + 0.7, zz], [s1, y1 + 0.7, zz], 0.05, C.HAZARD, 'paint');
              b.box(s, y0 + 0.35, zz, 0.05, 0.7, 0.05, C.HAZARD, 'paint');
            }
          });
      }
    }
    // buffer stops on dead ends
    for (const [s, open, sg] of [
      [l.sMin, l.openMin, -1],
      [l.sMax, l.openMax, 1],
    ] as [number, boolean, number][]) {
      if (open) continue;
      const y = H(s);
      b.box(s - sg * 0.3, y + 0.55, 0, 0.5, 0.7, 1.6, C.RED, 'paint');
      b.box(s - sg * 0.3, y + 0.75, 0, 0.52, 0.12, 1.62, C.WHITE, 'paint');
      b.box(s - sg * 0.1, y + 0.35, 0, 0.6, 0.4, 2.2, C.CONCRETE, 'rough');
    }
    const tpl = b.build();
    const m = instantiate(tpl, this.env.lib, true);
    m.root.position.set(l.center.x, 0, l.center.z);
    m.root.rotation.y = yawOf(l.dir.x, l.dir.z);
    return m;
  }

  private startArrival(l: Line): void {
    // arrive from the nearest open edge (or the longer stub when neither side is open)
    const dMax = l.openMax ? l.sMax : Infinity;
    const dMin = l.openMin ? -l.sMin : Infinity;
    if (Number.isFinite(dMax) || Number.isFinite(dMin)) l.side = dMax <= dMin ? 1 : -1;
    else l.side = l.sMax >= -l.sMin ? 1 : -1;
    const endS = l.side > 0 ? l.sMax : l.sMin;
    const open = l.side > 0 ? l.openMax : l.openMin;
    l.from = endS + l.side * (open ? TRAIN_LEN / 2 + 2 : -TRAIN_LEN / 2);
    l.to = 0;
    l.sc = l.from;
    l.speed = VMAX;
    l.state = 'arrive';
  }

  private startDeparture(l: Line): void {
    const far = -l.side;
    const farOpen = far > 0 ? l.openMax : l.openMin;
    const dirSide = farOpen ? far : l.side; // forward through, or back out the way it came
    const endS = dirSide > 0 ? l.sMax : l.sMin;
    const open = dirSide > 0 ? l.openMax : l.openMin;
    l.from = l.sc;
    l.to = endS + dirSide * (open ? TRAIN_LEN / 2 + 2 : -TRAIN_LEN / 2);
    l.speed = 0;
    l.state = 'depart';
  }

  private step(l: Line, dt: number, act: number): void {
    if (l.state === 'wait') {
      if (act > 0.01) l.timer -= dt;
      if (l.timer <= 0) this.startArrival(l);
    } else if (l.state === 'arrive') {
      const remain = Math.abs(l.to - l.sc);
      const lim = remain < 60 ? VYARD + (VMAX - VYARD) * (remain / 60) : VMAX;
      l.speed = Math.min(lim, Math.sqrt(2 * ACC * remain) + 0.15);
      const d = Math.sign(l.to - l.sc);
      l.sc += d * Math.min(remain, l.speed * dt);
      if (Math.abs(l.to - l.sc) < 0.01) {
        l.sc = l.to;
        l.state = 'load';
        l.timer = 22 + 10 * act;
        l.speed = 0;
      }
    } else if (l.state === 'load') {
      l.timer -= dt;
      if (l.timer <= 0) this.startDeparture(l);
    } else {
      const remain = Math.abs(l.to - l.sc);
      const travelled = Math.abs(l.sc - l.from);
      const lim = travelled < 40 ? VYARD + (VMAX - VYARD) * (travelled / 40) : VMAX;
      l.speed = Math.min(lim, l.speed + ACC * dt, Math.sqrt(2 * ACC * remain) + 0.5);
      l.sc += Math.sign(l.to - l.sc) * Math.min(remain, l.speed * dt);
      if (Math.abs(l.to - l.sc) < 0.01) {
        l.state = 'wait';
        l.timer = (120 / (0.3 + 2.5 * Math.max(0.02, act))) * (0.7 + Math.random() * 0.6);
      }
    }
    this.place(l, dt);
  }

  /** Position every car along the profile (lead loco faces the arrival travel direction). */
  private place(l: Line, dt: number): void {
    const moving = l.state !== 'wait';
    const cam = this.env.camera.position;
    const yawPos = yawOf(l.dir.x, l.dir.z);
    const yawNeg = yawOf(-l.dir.x, -l.dir.z);
    // offsets from the train centre along the arrival travel direction (-side): index 0 leads
    let off = TRAIN_LEN / 2 - LOCO_LEN / 2;
    const travel = -l.side;
    for (let i = 0; i < l.cars.length; i++) {
      const car = l.cars[i];
      const s = l.sc + travel * off;
      const inTrack = s >= l.sMin - 0.5 && s <= l.sMax + 0.5;
      let visible = moving && inTrack;
      if (visible) {
        const x = l.center.x + l.dir.x * s;
        const z = l.center.z + l.dir.z * s;
        const y = this.height(l, s) + RAIL_TOP;
        const pitchAlong = Math.atan2(this.height(l, s + 2) - this.height(l, s - 2), 4);
        // lead loco faces the arrival direction; the rear loco faces the other way
        const faceSign = i === l.cars.length - 1 ? -travel : travel;
        const yaw = faceSign > 0 ? yawPos : yawNeg;
        car.place(x, y, z, yaw, pitchAlong * faceSign);
        visible = car.distanceTo(cam) < VIEW_DIST;
      }
      car.obj.visible = visible;
      const len = i === 0 || i === l.cars.length - 1 ? LOCO_LEN : CAR_LEN;
      const next = i + 1 < l.cars.length ? (i + 1 === l.cars.length - 1 ? LOCO_LEN : CAR_LEN) : 0;
      off -= len / 2 + next / 2;
    }
    const lead = l.state === 'depart' && Math.sign(l.to - l.sc) === l.side ? l.cars[l.cars.length - 1] : l.cars[0];
    const trail = lead === l.cars[0] ? l.cars[l.cars.length - 1] : l.cars[0];
    if (lead.obj.visible) lead.emit(dt, l.state === 'load' ? 0.3 : 1);
    if (trail.obj.visible && l.state === 'load') trail.emit(dt, 0.2);
  }

  private disposeLine(l: Line): void {
    for (const c of l.cars) c.dispose();
    if (!l.track) return;
    l.track.root.removeFromParent();
    const walk = (n: ModelObject['template']['root']) => {
      for (const m of n.meshes) m.geometry.dispose();
      n.children.forEach(walk);
    };
    walk(l.track.template.root);
  }

  dispose(): void {
    for (const l of this.lines.values()) this.disposeLine(l);
    this.lines.clear();
  }
}
