// Tanker ships: routed over the water nav grid from the nearest open-sea map edge, around land and
// offshore structures, to a straight final approach into the export-terminal berth (or the FPSO's
// tandem-offloading station astern). They stay moored while the terminal is selling (economy
// `salesUtil`), then leave — forward if there is sea room ahead, otherwise backing out and turning.
import * as THREE from 'three';
import { SEA_LEVEL } from '../../../core/constants';
import type { BuildingState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { salesActivity } from './activity';
import type { Pt, SearchHandle, SearchResult } from './nav';
import { Route, type RouteSample } from './route';
import { shipTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const VMAX = 6;
const ACC = 0.35;
/** Straight final approach length (blocks). */
const APPROACH = [40, 30, 22, 14];
/** Max heading change rate (rad/s). */
const TURN_RATE = 0.35;
const RETRY = 30;

type Phase = 'idle' | 'arrive' | 'moored' | 'reverse' | 'turn' | 'depart';

interface Berth {
  key: string;
  pos: THREE.Vector3;
  /** Heading axis while moored. */
  dir: THREE.Vector3;
  arriveSign: number;
  forwardExit: boolean;
  /** Approach start (end of the straight final leg) and departure point. */
  a: Pt | null;
  d: Pt | null;
  inPts: Pt[] | null;
  outPts: Pt[] | null;
  ver: number;
  pending: SearchHandle[];
  failedAt: number;
  v: Vehicle | null;
  route: Route | null;
  s: number;
  sEnd: number;
  speed: number;
  phase: Phase;
  timer: number;
  bob: number;
  x: number;
  z: number;
  yaw: number;
}

const _smp: RouteSample = { x: 0, z: 0, dx: 1, dz: 0 };

export class ShipTraffic {
  private readonly berths = new Map<string, Berth>();
  private clock = 0;

  constructor(private readonly env: VehicleEnv) {}

  private selling(b: BuildingState, v: BuildingView): boolean {
    if (!v.operational) return false;
    if (typeof b.data?.salesUtil === 'number') return b.data.salesUtil > 0.03;
    if (b.type === 'fpso') return (b.storage.crude_oil ?? 0) + (b.storage.condensate ?? 0) > 20000 || b.utilization > 0.6;
    return salesActivity(b, v) > 0.02;
  }

  /** Open water score along a ray from p in direction d. */
  private water(p: THREE.Vector3, d: THREE.Vector3, sign: number): number {
    let n = 0;
    for (let s = 20; s <= 170; s += 15) if (this.env.terrain.isWater(p.x + d.x * s * sign, p.z + d.z * s * sign)) n++;
    return n;
  }

  update(dt: number, views: Map<string, BuildingView>): void {
    this.clock += dt;
    const state = this.env.ctx.state;
    const seen = new Set<string>();
    const jetties: { x0: number; z0: number; x1: number; z1: number; r: number }[] = [];
    for (const v of views.values()) {
      if (v.type !== 'export_terminal' && v.type !== 'fpso') continue;
      const b = state.buildings[v.id];
      const ba = v.anchors.find((a) => a.def.kind === 'berth');
      const bd = v.anchors.find((a) => a.def.kind === 'berthDir');
      if (!b || !ba || !bd || v.status === 'constructing') continue;
      seen.add(v.id);
      const key = `${b.x},${b.y},${b.z},${b.rotation},${v.variant}`;
      let berth = this.berths.get(v.id);
      if (berth && berth.key !== key) {
        this.release(berth);
        berth = undefined;
      }
      if (!berth) {
        berth = this.createBerth(key, ba.pos, bd.pos);
        this.berths.set(v.id, berth);
      }
      if (v.type === 'export_terminal') {
        // the jetty trestle and head reach beyond the footprint: keep ships off them
        const cx = b.x + b.size[0] / 2;
        const cz = b.z + b.size[1] / 2;
        const nx = berth.pos.x - cx;
        const nz = berth.pos.z - cz;
        const nl = Math.hypot(nx, nz) || 1;
        const hx = berth.pos.x - (nx / nl) * 5;
        const hz = berth.pos.z - (nz / nl) * 5;
        jetties.push({ x0: cx, z0: cz, x1: hx, z1: hz, r: 2 });
        jetties.push({ x0: hx - berth.dir.x * 4, z0: hz - berth.dir.z * 4, x1: hx + berth.dir.x * 4, z1: hz + berth.dir.z * 4, r: 2 });
      }
      this.step(berth, dt, this.selling(b, v));
    }
    if (seen.size) this.env.nav.water().setExtraObstacles(jetties);
    for (const [id, b] of this.berths)
      if (!seen.has(id)) {
        this.release(b);
        this.berths.delete(id);
      }
  }

  private createBerth(key: string, bp: THREE.Vector3, bdp: THREE.Vector3): Berth {
    const pos = bp.clone();
    pos.y = SEA_LEVEL + 1;
    const dir = new THREE.Vector3(bdp.x - bp.x, 0, bdp.z - bp.z).normalize();
    const back = this.water(pos, dir, -1);
    const fwd = this.water(pos, dir, 1);
    const arriveSign = back >= fwd ? 1 : -1;
    const forwardExit = (arriveSign > 0 ? fwd : back) >= 5;
    return {
      key, pos, dir, arriveSign, forwardExit, a: null, d: null, inPts: null, outPts: null, ver: -1, pending: [], failedAt: -Infinity,
      v: null, route: null, s: 0, sEnd: 0, speed: 0, phase: 'idle', timer: 5 + Math.random() * 10, bob: Math.random() * 10, x: pos.x, z: pos.z, yaw: 0,
    };
  }

  private release(b: Berth): void {
    b.v?.dispose();
    b.v = null;
    for (const h of b.pending) h.cancel();
    b.pending = [];
  }

  /** Straight-leg endpoints that lie on navigable water. */
  private legPoint(bt: Berth, sign: number): Pt | null {
    const nav = this.env.nav.water();
    for (const L of APPROACH) {
      const x = bt.pos.x + bt.dir.x * L * sign;
      const z = bt.pos.z + bt.dir.z * L * sign;
      if (x < 0 || z < 0 || x >= this.env.ctx.world.sizeX || z >= this.env.ctx.world.sizeZ) continue;
      if (nav.passable(nav.cellOf(x, z))) return [x, z];
    }
    return null;
  }

  /** Ensure approach/departure paths exist for the current nav version (async). */
  private prepare(bt: Berth): boolean {
    const nav = this.env.nav.water();
    nav.refreshBuildings();
    if (bt.pending.length) return false;
    if (bt.ver === nav.version && bt.inPts && bt.outPts) return true;
    if (bt.ver === nav.version && this.clock - bt.failedAt < RETRY) return false;
    bt.ver = nav.version;
    bt.a = this.legPoint(bt, -bt.arriveSign);
    bt.d = bt.forwardExit ? this.legPoint(bt, bt.arriveSign) : bt.a;
    if (!bt.a || !bt.d) {
      bt.failedAt = this.clock;
      bt.inPts = bt.outPts = null;
      return false;
    }
    let remaining = bt.d === bt.a ? 1 : 2;
    let failed = false;
    const got = (which: 'in' | 'out' | 'both') => (r: SearchResult | null) => {
      remaining--;
      if (!r) failed = true;
      else {
        if (which !== 'out') bt.inPts = r.points;
        if (which !== 'in') bt.outPts = r.points;
      }
      if (remaining > 0) return;
      bt.pending = [];
      if (failed) {
        bt.failedAt = this.clock;
        bt.inPts = bt.outPts = null;
      }
    };
    bt.inPts = bt.outPts = null;
    if (bt.d === bt.a) bt.pending.push(nav.search(bt.a[0], bt.a[1], got('both'), 60000));
    else {
      bt.pending.push(nav.search(bt.a[0], bt.a[1], got('in'), 60000));
      bt.pending.push(nav.search(bt.d[0], bt.d[1], got('out'), 60000));
    }
    return false;
  }

  private step(bt: Berth, dt: number, selling: boolean): void {
    bt.bob += dt;
    switch (bt.phase) {
      case 'idle': {
        if (!selling) return;
        const ready = this.prepare(bt);
        bt.timer -= dt;
        if (bt.timer > 0 || !ready || !bt.inPts || !bt.a) return;
        const pts: Pt[] = [...bt.inPts].reverse();
        const [ax, az] = bt.a;
        pts.push([ax + (bt.pos.x - ax) * 0.3, az + (bt.pos.z - az) * 0.3], [bt.pos.x, bt.pos.z]);
        bt.route = new Route(pts, 2);
        bt.s = 0;
        bt.sEnd = bt.route.length;
        bt.speed = VMAX;
        bt.v = new Vehicle(this.env, shipTemplate(this.env.lib.company));
        bt.route.sample(0, _smp);
        bt.x = _smp.x;
        bt.z = _smp.z;
        bt.yaw = yawOf(_smp.dx, _smp.dz);
        bt.phase = 'arrive';
        break;
      }
      case 'arrive': {
        const r = bt.route!;
        const remain = bt.sEnd - bt.s;
        const vTurn = VMAX * (1 - Math.min(0.6, r.turn(bt.s, 20) * 0.8));
        bt.speed = Math.min(vTurn, Math.sqrt(2 * ACC * Math.max(0, remain)) + 0.1, bt.speed + ACC * dt);
        bt.s = Math.min(bt.sEnd, bt.s + bt.speed * dt);
        this.follow(bt, dt);
        if (bt.s >= bt.sEnd - 0.01) {
          bt.phase = 'moored';
          bt.timer = 45;
          bt.speed = 0;
        }
        break;
      }
      case 'moored':
        bt.timer -= dt;
        if ((bt.timer <= 0 && !selling) || bt.timer < -120) this.leave(bt);
        break;
      case 'reverse': {
        // back straight out along the approach line, keeping the heading
        const r = bt.route!;
        const remain = bt.sEnd - bt.s;
        bt.speed = Math.min(2.2, Math.sqrt(2 * ACC * Math.max(0, remain)) + 0.1, bt.speed + ACC * dt);
        bt.s = Math.min(bt.sEnd, bt.s + bt.speed * dt);
        r.sample(bt.s, _smp);
        bt.x = _smp.x;
        bt.z = _smp.z;
        if (bt.s >= bt.sEnd - 0.01) this.beginDeparture(bt, bt.inPts ?? [], false);
        break;
      }
      case 'turn': {
        const r = bt.route!;
        r.sample(3, _smp);
        const want = yawOf(_smp.dx, _smp.dz);
        const d = Math.atan2(Math.sin(want - bt.yaw), Math.cos(want - bt.yaw));
        const stepA = Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * 0.6 * dt);
        bt.yaw += stepA;
        if (Math.abs(d) < 0.05) {
          bt.phase = 'depart';
          bt.speed = 0;
        }
        break;
      }
      case 'depart': {
        const r = bt.route!;
        bt.speed = Math.min(VMAX * (1 - Math.min(0.6, r.turn(bt.s, 20) * 0.8)), bt.speed + ACC * dt);
        bt.s += bt.speed * dt;
        if (bt.s >= r.length) {
          bt.v?.dispose();
          bt.v = null;
          bt.route = null;
          bt.phase = 'idle';
          bt.timer = 40 + Math.random() * 60;
          return;
        }
        this.follow(bt, dt);
        break;
      }
    }
    if (!bt.v) return;
    const y = bt.pos.y + Math.sin(bt.bob * 0.6) * 0.06;
    bt.v.place(bt.x, y, bt.z, bt.yaw, 0, Math.sin(bt.bob * 0.45) * 0.012);
    bt.v.obj.visible = bt.v.distanceTo(this.env.camera.position) < 320;
    bt.v.emit(dt, bt.phase === 'moored' ? 0.3 : 1);
  }

  /** Move along the route with a turn-rate limited heading. */
  private follow(bt: Berth, dt: number): void {
    bt.route!.sample(bt.s, _smp);
    bt.x = _smp.x;
    bt.z = _smp.z;
    const want = yawOf(_smp.dx, _smp.dz);
    const d = Math.atan2(Math.sin(want - bt.yaw), Math.cos(want - bt.yaw));
    bt.yaw += Math.sign(d) * Math.min(Math.abs(d), Math.max(TURN_RATE, Math.abs(d) * 1.5) * dt);
  }

  private leave(bt: Berth): void {
    if (bt.forwardExit && bt.outPts && bt.d && bt.d !== bt.a) {
      this.beginDeparture(bt, bt.outPts, true);
      return;
    }
    if (!bt.a || !bt.inPts) {
      // world changed under us and no way out is known: let the ship slip away out of sight
      bt.v?.dispose();
      bt.v = null;
      bt.route = null;
      bt.phase = 'idle';
      bt.timer = 60;
      return;
    }
    // back out along the approach line, then turn and follow the approach path out
    bt.route = new Route([[bt.pos.x, bt.pos.z], bt.a], 2);
    bt.s = 0;
    bt.sEnd = bt.route.length;
    bt.speed = 0;
    bt.phase = 'reverse';
  }

  /** Route from the current position out to the edge; `straight` = sail ahead from the berth first. */
  private beginDeparture(bt: Berth, out: Pt[], straight: boolean): void {
    const pts: Pt[] = [[bt.x, bt.z]];
    if (straight && bt.d) pts.push([bt.x + (bt.d[0] - bt.x) * 0.3, bt.z + (bt.d[1] - bt.z) * 0.3]);
    pts.push(...out);
    bt.route = new Route(pts, 2);
    bt.s = 0;
    bt.speed = straight ? 0.2 : 0;
    bt.phase = straight ? 'depart' : 'turn';
  }

  dispose(): void {
    for (const b of this.berths.values()) this.release(b);
    this.berths.clear();
  }
}
