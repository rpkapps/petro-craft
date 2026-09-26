// Tanker trucks: routed over the land nav grid (roads preferred, around buildings, water and steep
// ground) from the nearest reachable map edge into a free bay of a selling truck terminal, load, and
// leave for the nearest edge. Drive-through when both lane ends are clear; when one end is blocked
// the truck enters from the open end, backs out after loading, turns and drives off.
// Spawn rate ∝ the terminal's sales utilisation. Routes are cached per (terminal, bay, lane end) and
// recomputed when buildings or roads change.
import * as THREE from 'three';
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { salesActivity } from './activity';
import type { Pt, SearchHandle, SearchResult } from './nav';
import { Route, type RouteSample } from './route';
import { truckTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const VMAX = 9;
const ACCEL = 3.2;
const DECEL = 2.6;
const REVERSE_SPEED = 2.2;
const PIVOT_RATE = 0.9;
const LOAD_TIME = 14;
/** Lateral offset to the right of travel outside the terminal (two-way traffic). */
const KEEP_RIGHT = 0.85;
/** Minimum gap to the truck ahead on the same route. */
const HEADWAY = 9;
const RETRY = 20;

/** One lane end: its approach point and the path from it to the map edge. */
interface LaneEnd {
  p: Pt;
  open: boolean;
  pts: Pt[] | null;
  ver: number;
  pending: SearchHandle | null;
  failedAt: number;
}

interface Lane {
  bay: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** Lane ends behind (−dir) and ahead (+dir) of the bay. */
  ends: [LaneEnd, LaneEnd];
  openVer: number;
  route: Route | null;
  routeKey: string;
  /** Exit route for back-out lanes (from the open end to the edge). */
  exit: Route | null;
  /** Which end trucks use when only one is open (0 = behind, 1 = ahead), −1 = drive-through. */
  single: number;
  sBay: number;
  sIn: number;
  sOut: number;
}

type TruckState = 'in' | 'load' | 'out' | 'reverse' | 'turn' | 'leave';

interface Truck {
  v: Vehicle;
  lane: Lane;
  route: Route;
  s: number;
  speed: number;
  state: TruckState;
  timer: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Lateral keep-right offset applied (smoothed). */
  off: number;
}

interface Terminal {
  key: string;
  timer: number;
  lanes: Lane[];
  trucks: Truck[];
}

const _smp: RouteSample = { x: 0, z: 0, dx: 1, dz: 0 };
const RING = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class TruckTraffic {
  private readonly terminals = new Map<string, Terminal>();
  private clock = 0;

  constructor(private readonly env: VehicleEnv) {}

  update(dt: number, views: Map<string, BuildingView>): void {
    this.clock += dt;
    const state = this.env.ctx.state;
    for (const [id, t] of this.terminals) {
      const b = state.buildings[id];
      if (!views.has(id) || !b || t.key !== placeKey(b)) this.drop(id, t);
    }
    for (const v of views.values()) {
      if (v.type !== 'truck_terminal') continue;
      const b = state.buildings[v.id];
      if (!b || v.status === 'constructing' || v.status === 'destroyed') continue;
      let t = this.terminals.get(v.id);
      if (!t) {
        const lanes = this.lanes(v, b);
        if (!lanes.length) continue;
        t = { key: placeKey(b), timer: 2 + Math.random() * 6, lanes, trucks: [] };
        this.terminals.set(v.id, t);
      }
      const act = salesActivity(b, v);
      if (act > 0.01) {
        for (const lane of t.lanes) this.prepare(lane);
        t.timer -= dt;
        if (t.timer <= 0) {
          t.timer = (60 / (0.4 + 3.2 * act)) * (0.7 + Math.random() * 0.6);
          this.spawn(t);
        }
      }
      for (let i = t.trucks.length - 1; i >= 0; i--) {
        if (!this.step(t, t.trucks[i], dt, act)) {
          t.trucks[i].v.dispose();
          t.trucks.splice(i, 1);
        }
      }
    }
  }

  private drop(id: string, t: Terminal): void {
    for (const tr of t.trucks) tr.v.dispose();
    for (const l of t.lanes) for (const e of l.ends) e.pending?.cancel();
    this.terminals.delete(id);
  }

  /** Lane geometry per loading bay (from the model anchors). */
  private lanes(v: BuildingView, b: BuildingState): Lane[] {
    const out: Lane[] = [];
    for (const a of v.anchors) {
      if (a.def.kind !== 'bay') continue;
      const d = v.anchors.find((x) => x.def.kind === 'bayDir' && x.def.data.i === a.def.data.i);
      if (!d) continue;
      const pos = a.pos.clone();
      const dir = new THREE.Vector3(d.pos.x - pos.x, 0, d.pos.z - pos.z).normalize();
      const half = Math.abs(dir.x) * (b.size[0] / 2) + Math.abs(dir.z) * (b.size[1] / 2);
      const e = half + 3.5;
      const end = (sg: number): LaneEnd => ({ p: [pos.x + dir.x * e * sg, pos.z + dir.z * e * sg], open: false, pts: null, ver: -1, pending: null, failedAt: -Infinity });
      out.push({ bay: a.def.data.i, pos, dir, ends: [end(-1), end(1)], openVer: -1, route: null, routeKey: '', exit: null, single: -1, sBay: 0, sIn: 0, sOut: 0 });
    }
    return out;
  }

  /** Re-evaluate which lane ends are usable and request stale paths (async). */
  private prepare(l: Lane): void {
    const nav = this.env.nav.land();
    if (l.openVer !== nav.version) {
      l.openVer = nav.version;
      // usable when the end cell is clear and there is room to turn away from the lane
      for (const e of l.ends) {
        const c = nav.cellOf(e.p[0], e.p[1]);
        let room = 0;
        for (const [ox, oz] of RING) if (nav.passable(nav.cellOf(e.p[0] + ox * nav.cell, e.p[1] + oz * nav.cell))) room++;
        e.open = nav.passable(c) && room >= 3;
      }
    }
    for (const e of l.ends) {
      if (!e.open || e.pending) continue;
      if (e.pts && e.ver === nav.version) continue;
      if (e.ver === nav.version && this.clock - e.failedAt < RETRY) continue;
      e.pending = nav.search(e.p[0], e.p[1], (r: SearchResult | null) => {
        e.pending = null;
        e.pts = r?.points ?? null;
        e.ver = r?.version ?? nav.version;
        if (!r) e.failedAt = this.clock;
        l.route = null;
      });
    }
  }

  /** Smoothed arrival route for a lane (null while unavailable). */
  private route(l: Lane): Route | null {
    const [a, b] = l.ends;
    const ready = (e: LaneEnd) => e.open && !!e.pts && !e.pending;
    const through = ready(a) && ready(b);
    const single = through ? -1 : ready(a) ? 0 : ready(b) ? 1 : -2;
    if (single === -2) return null;
    const key = `${single}:${a.ver}:${b.ver}`;
    if (l.route && l.routeKey === key) return l.route;
    const { pos, dir } = l;
    const inner = Math.hypot(a.p[0] - pos.x, a.p[1] - pos.z) - 2.5;
    const entry = single === 1 ? b : a;
    const sg = single === 1 ? 1 : -1;
    const pts: Pt[] = [...entry.pts!].reverse();
    pts.push([pos.x + dir.x * inner * sg, pos.z + dir.z * inner * sg], [pos.x, pos.z]);
    if (single === -1) pts.push([pos.x + dir.x * inner, pos.z + dir.z * inner], ...b.pts!);
    const r = new Route(pts, 1);
    l.route = r;
    l.routeKey = key;
    l.single = single;
    l.exit = single >= 0 ? new Route(entry.pts!, 1) : null;
    l.sBay = nearestS(r, pos.x, pos.z);
    l.sIn = nearestS(r, entry.p[0], entry.p[1]);
    l.sOut = single === -1 ? nearestS(r, b.p[0], b.p[1]) : l.sBay;
    return r;
  }

  private spawn(t: Terminal): void {
    const free = t.lanes.filter((l) => !t.trucks.some((tr) => tr.lane === l));
    if (free.length === 0) return;
    const lane = free[Math.floor(Math.random() * free.length)];
    const route = this.route(lane);
    if (!route) return;
    // terrain streamed in since the search (trees, edits) may have closed a path: recompute
    const nav = this.env.nav.land();
    for (const e of lane.ends)
      if (e.pts && !nav.validate(e.pts, 3)) {
        e.pts = null;
        e.ver = -1;
        lane.route = null;
        return;
      }
    // don't spawn on top of a truck still on the first stretch
    for (const tr of t.trucks) if (tr.route === route && tr.state === 'in' && tr.s < HEADWAY) return;
    const v = new Vehicle(this.env, truckTemplate(this.env.lib.company));
    route.sample(0, _smp);
    t.trucks.push({
      v, lane, route, s: 0, speed: VMAX * 0.7, state: 'in', timer: 0, x: _smp.x, z: _smp.z,
      y: this.env.terrain.smooth(_smp.x, _smp.z), yaw: yawOf(_smp.dx, _smp.dz), off: KEEP_RIGHT,
    });
  }

  /** Speed limit from the bend ahead and the truck in front on the same route. */
  private limit(t: Terminal, tr: Truck): number {
    const r = tr.route;
    const bend = r.turn(tr.s, 7);
    let vmax = VMAX * (1 - Math.min(0.65, bend * 0.9));
    const l = tr.lane;
    if (r === l.route && tr.s > l.sIn - 3 && tr.s < l.sOut + 3) vmax = Math.min(vmax, 4.5);
    for (const o of t.trucks) {
      if (o === tr || o.route !== r || o.s <= tr.s) continue;
      const gap = o.s - tr.s - HEADWAY;
      vmax = Math.min(vmax, Math.max(0, Math.sqrt(2 * DECEL * Math.max(0, gap))));
    }
    return vmax;
  }

  /** Advance one truck; false when it has left the map. */
  private step(t: Terminal, tr: Truck, dt: number, act: number): boolean {
    const l = tr.lane;
    switch (tr.state) {
      case 'in': {
        const vmax = this.limit(t, tr);
        const remain = l.sBay - tr.s;
        const target = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, remain)) + 0.2);
        tr.speed = tr.speed < target ? Math.min(target, tr.speed + ACCEL * dt) : target;
        tr.s = Math.min(l.sBay, tr.s + tr.speed * dt);
        if (tr.s >= l.sBay - 0.01) {
          tr.state = 'load';
          tr.timer = LOAD_TIME * (1.2 - act * 0.4);
          tr.speed = 0;
        }
        this.follow(tr, dt, true);
        break;
      }
      case 'load':
        tr.timer -= dt;
        if (tr.timer <= 0) {
          if (tr.route === l.route && l.single === -1) tr.state = 'out';
          else if (l.exit) {
            // back out along the lane to the open end
            l.exit.sample(0, _smp);
            tr.state = 'reverse';
            tr.route = new Route([[tr.x, tr.z], [_smp.x, _smp.z]], 1);
            tr.s = 0;
          } else return false;
        }
        break;
      case 'out': {
        const vmax = this.limit(t, tr);
        tr.speed = tr.speed < vmax ? Math.min(vmax, tr.speed + ACCEL * dt) : Math.max(vmax, tr.speed - DECEL * 2 * dt);
        tr.s += tr.speed * dt;
        if (tr.s >= tr.route.length) return false;
        this.follow(tr, dt, true);
        break;
      }
      case 'reverse': {
        const remain = tr.route.length - tr.s;
        tr.speed = Math.min(REVERSE_SPEED, Math.sqrt(2 * DECEL * Math.max(0, remain)) + 0.15);
        tr.s = Math.min(tr.route.length, tr.s + tr.speed * dt);
        this.follow(tr, dt, false);
        if (tr.s >= tr.route.length - 0.01) {
          tr.state = 'turn';
          tr.route = l.exit!;
          tr.s = 0;
          tr.speed = 0;
        }
        break;
      }
      case 'turn': {
        tr.route.sample(2, _smp);
        const want = yawOf(_smp.dx, _smp.dz);
        const d = Math.atan2(Math.sin(want - tr.yaw), Math.cos(want - tr.yaw));
        tr.yaw += Math.sign(d) * Math.min(Math.abs(d), PIVOT_RATE * dt);
        if (Math.abs(d) < 0.03) tr.state = 'leave';
        this.follow(tr, dt, true, true);
        break;
      }
      case 'leave': {
        const vmax = this.limit(t, tr);
        tr.speed = Math.min(vmax, tr.speed + ACCEL * dt);
        tr.s += tr.speed * dt;
        if (tr.s >= tr.route.length) return false;
        this.follow(tr, dt, true);
        break;
      }
    }
    this.pose(tr, dt);
    return true;
  }

  /** Position along the current route (+ keep-right offset outside the terminal); heading follows the tangent. */
  private follow(tr: Truck, dt: number, forward: boolean, holdYaw = false): void {
    const l = tr.lane;
    tr.route.sample(tr.s, _smp);
    let want = 0;
    if (tr.route === l.route) {
      want = KEEP_RIGHT * Math.max(smoothstep(l.sIn - tr.s, 0, 8), l.single === -1 ? smoothstep(tr.s - l.sOut, 0, 8) : 0);
    } else if (tr.route === l.exit) want = KEEP_RIGHT * smoothstep(tr.s, 0, 8);
    tr.off += (want - tr.off) * Math.min(1, dt * 3);
    tr.x = _smp.x - _smp.dz * tr.off;
    tr.z = _smp.z + _smp.dx * tr.off;
    if (holdYaw) return;
    const wantYaw = forward ? yawOf(_smp.dx, _smp.dz) : yawOf(-_smp.dx, -_smp.dz);
    tr.yaw += Math.atan2(Math.sin(wantYaw - tr.yaw), Math.cos(wantYaw - tr.yaw)) * Math.min(1, dt * 6);
  }

  private pose(tr: Truck, dt: number): void {
    const terrain = this.env.terrain;
    const fx = Math.cos(tr.yaw) * 2.2;
    const fz = -Math.sin(tr.yaw) * 2.2;
    const gf = terrain.smooth(tr.x + fx, tr.z + fz);
    const gb = terrain.smooth(tr.x - fx, tr.z - fz);
    const gc = terrain.smooth(tr.x, tr.z);
    // never sink into a bump: ride on the highest of the axle/centre samples
    const gy = Math.max(gc, (gf + gb) / 2, Math.min(gf, gb) + 0.35);
    tr.y += (gy - tr.y) * Math.min(1, dt * 8);
    if (tr.y < gy - 0.4) tr.y = gy - 0.4;
    const pitch = Math.atan2(gf - gb, 4.4) * 0.85;
    tr.v.place(tr.x, tr.y, tr.z, tr.yaw, pitch);
    const d = tr.v.distanceTo(this.env.camera.position);
    tr.v.obj.visible = d < 220;
    const moving = tr.state !== 'load' && tr.state !== 'turn';
    tr.v.emit(dt, moving ? 0.6 + (tr.speed < VMAX - 0.5 ? 0.8 : 0) : 0.4);
  }

  dispose(): void {
    for (const [id, t] of this.terminals) this.drop(id, t);
  }
}

function placeKey(b: BuildingState): string {
  return `${b.x},${b.y},${b.z},${b.rotation}`;
}

function smoothstep(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Arc length of the route sample nearest to (x, z). */
export function nearestS(r: Route, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < r.count; i++) {
    const d = (r.xs[i] - x) ** 2 + (r.zs[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return r.s[best];
}
