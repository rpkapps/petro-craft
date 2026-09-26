// Tanker trucks: routed over the land nav grid (roads preferred, around buildings, water and steep
// ground) from the nearest reachable map edge into a free bay of a selling truck terminal, load, drive
// out through the lane and on to the nearest edge. Spawn rate ∝ the terminal's sales utilisation.
// Routes are cached per (terminal, bay) and recomputed when buildings or roads change.
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
const LOAD_TIME = 14;
/** Lateral offset to the right of travel outside the terminal (two-way traffic). */
const KEEP_RIGHT = 0.85;
/** Minimum gap to the truck ahead on the same route. */
const HEADWAY = 9;
const RETRY = 20;

interface Lane {
  bay: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  pin: Pt;
  pout: Pt;
  inPts: Pt[] | null;
  outPts: Pt[] | null;
  inVer: number;
  outVer: number;
  pending: SearchHandle[];
  route: Route | null;
  routeKey: string;
  sBay: number;
  sIn: number;
  sOut: number;
  failedAt: number;
}

interface Truck {
  v: Vehicle;
  lane: Lane;
  route: Route;
  s: number;
  speed: number;
  state: 'in' | 'load' | 'out';
  timer: number;
  y: number;
  yaw: number;
}

interface Terminal {
  key: string;
  timer: number;
  lanes: Lane[];
  trucks: Truck[];
}

const _smp: RouteSample = { x: 0, z: 0, dx: 1, dz: 0 };

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
    for (const l of t.lanes) for (const h of l.pending) h.cancel();
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
      const e = half + 4.5;
      out.push({
        bay: a.def.data.i,
        pos,
        dir,
        pin: [pos.x - dir.x * e, pos.z - dir.z * e],
        pout: [pos.x + dir.x * e, pos.z + dir.z * e],
        inPts: null,
        outPts: null,
        inVer: -1,
        outVer: -1,
        pending: [],
        route: null,
        routeKey: '',
        sBay: 0,
        sIn: 0,
        sOut: 0,
        failedAt: -Infinity,
      });
    }
    return out;
  }

  /** Request (re)computation of a lane's approach/departure paths when stale. */
  private prepare(l: Lane): void {
    const nav = this.env.nav.land();
    if (l.pending.length) return;
    const needIn = !l.inPts || l.inVer !== nav.version;
    const needOut = !l.outPts || l.outVer !== nav.version;
    if (!needIn && !needOut) return;
    if (this.clock - l.failedAt < RETRY && l.inVer === nav.version && l.outVer === nav.version) return;
    const done = (which: 'in' | 'out') => (r: SearchResult | null) => {
      l.pending = l.pending.filter((h) => h !== handle[which]);
      if (which === 'in') {
        l.inPts = r?.points ?? null;
        l.inVer = r?.version ?? nav.version;
      } else {
        l.outPts = r?.points ?? null;
        l.outVer = r?.version ?? nav.version;
      }
      if (!r) l.failedAt = this.clock;
      l.route = null;
    };
    const handle: Partial<Record<'in' | 'out', SearchHandle>> = {};
    if (needIn) l.pending.push((handle.in = nav.search(l.pin[0], l.pin[1], done('in'))));
    if (needOut) l.pending.push((handle.out = nav.search(l.pout[0], l.pout[1], done('out'))));
  }

  /** Full smoothed route edge → lane → edge (null while unavailable). */
  private route(l: Lane): Route | null {
    if (!l.inPts || !l.outPts || l.pending.length) return null;
    const key = `${l.inVer}:${l.outVer}`;
    if (l.route && l.routeKey === key) return l.route;
    const { pos, dir } = l;
    const half = Math.hypot(l.pin[0] - pos.x, l.pin[1] - pos.z) - 3;
    const pts: Pt[] = [...l.inPts].reverse();
    pts.push([pos.x - dir.x * half, pos.z - dir.z * half], [pos.x, pos.z], [pos.x + dir.x * half, pos.z + dir.z * half]);
    pts.push(...l.outPts);
    const r = new Route(pts, 1);
    l.route = r;
    l.routeKey = key;
    l.sBay = nearestS(r, pos.x, pos.z);
    l.sIn = nearestS(r, l.pin[0], l.pin[1]);
    l.sOut = nearestS(r, l.pout[0], l.pout[1]);
    return r;
  }

  private spawn(t: Terminal): void {
    const free = t.lanes.filter((l) => !t.trucks.some((tr) => tr.lane === l));
    if (free.length === 0) return;
    const lane = free[Math.floor(Math.random() * free.length)];
    const route = this.route(lane);
    if (!route) return;
    // terrain streamed in since the search (trees, edits) may have closed the path: recompute
    const nav = this.env.nav.land();
    if ((lane.inPts && !nav.validate(lane.inPts, 3)) || (lane.outPts && !nav.validate(lane.outPts, 3))) {
      lane.inVer = lane.outVer = -1;
      lane.failedAt = -Infinity;
      return;
    }
    // don't spawn on top of a truck still leaving on the same stretch
    for (const tr of t.trucks) if (tr.route === route && tr.s < HEADWAY) return;
    const v = new Vehicle(this.env, truckTemplate(this.env.lib.company));
    route.sample(0, _smp);
    const tr: Truck = { v, lane, route, s: 0, speed: VMAX * 0.7, state: 'in', timer: 0, y: this.env.terrain.smooth(_smp.x, _smp.z), yaw: yawOf(_smp.dx, _smp.dz) };
    t.trucks.push(tr);
  }

  /** Advance one truck; false when it has left the map. */
  private step(t: Terminal, tr: Truck, dt: number, act: number): boolean {
    const r = tr.route;
    const l = tr.lane;
    // speed limit from the bend ahead and the truck in front
    const bend = r.turn(tr.s, 7);
    let vmax = VMAX * (1 - Math.min(0.65, bend * 0.9));
    if (tr.s > l.sIn - 3 && tr.s < l.sOut + 3) vmax = Math.min(vmax, 4.5);
    for (const o of t.trucks) {
      if (o === tr || o.route !== r || o.s <= tr.s) continue;
      const gap = o.s - tr.s - HEADWAY;
      vmax = Math.min(vmax, Math.max(0, Math.sqrt(2 * DECEL * Math.max(0, gap))));
    }
    if (tr.state === 'in') {
      const remain = l.sBay - tr.s;
      const target = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, remain)) + 0.2);
      tr.speed = tr.speed < target ? Math.min(target, tr.speed + ACCEL * dt) : target;
      tr.s = Math.min(l.sBay, tr.s + tr.speed * dt);
      if (tr.s >= l.sBay - 0.01) {
        tr.state = 'load';
        tr.timer = LOAD_TIME * (1.2 - act * 0.4);
        tr.speed = 0;
      }
    } else if (tr.state === 'load') {
      tr.timer -= dt;
      if (tr.timer <= 0) tr.state = 'out';
    } else {
      tr.speed = tr.speed < vmax ? Math.min(vmax, tr.speed + ACCEL * dt) : Math.max(vmax, tr.speed - DECEL * 2 * dt);
      tr.s += tr.speed * dt;
      if (tr.s >= r.length) return false;
    }
    r.sample(tr.s, _smp);
    // keep right outside the loading lanes
    const off = KEEP_RIGHT * Math.max(smoothstep(l.sIn - tr.s, 0, 8), smoothstep(tr.s - l.sOut, 0, 8));
    const x = _smp.x - _smp.dz * off;
    const z = _smp.z + _smp.dx * off;
    const terrain = this.env.terrain;
    const fx = _smp.dx * 2.2;
    const fz = _smp.dz * 2.2;
    const gf = terrain.smooth(x + fx, z + fz);
    const gb = terrain.smooth(x - fx, z - fz);
    const gc = terrain.smooth(x, z);
    // never sink into a bump: ride on the highest of the axle/centre samples
    const gy = Math.max(gc, (gf + gb) / 2, Math.min(gf, gb) + 0.35);
    tr.y += (gy - tr.y) * Math.min(1, dt * 8);
    if (tr.y < gy - 0.4) tr.y = gy - 0.4;
    const pitch = Math.atan2(gf - gb, 4.4) * 0.85;
    const want = yawOf(_smp.dx, _smp.dz);
    tr.yaw += Math.atan2(Math.sin(want - tr.yaw), Math.cos(want - tr.yaw)) * Math.min(1, dt * 6);
    tr.v.place(x, tr.y, z, tr.yaw, pitch);
    const d = tr.v.distanceTo(this.env.camera.position);
    tr.v.obj.visible = d < 220;
    tr.v.emit(dt, tr.state === 'load' ? 0.4 : 0.6 + (tr.speed < vmax - 0.5 ? 0.8 : 0));
    return true;
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
