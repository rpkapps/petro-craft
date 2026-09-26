// Unit trains shuttling at rail terminals: an extension track (with trestle piers over low ground)
// is laid along the terminal's track axis; a locomotive + tank cars roll in, stop under the loading
// rack, load, and depart. Service frequency ∝ terminal activity.
import * as THREE from 'three';
import type { BuildingView } from '../BuildingView';
import { Builder } from '../geom/Builder';
import { instantiate, type ModelObject } from '../models/instantiate';
import { C } from '../palette';
import { locoTemplate, tankCarTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const EXT = 70; // extension length each side from the terminal centre
const CARS = 6;
const LOCO_LEN = 7;
const CAR_LEN = 5.9;
const TRAIN_LEN = LOCO_LEN + CARS * CAR_LEN;
const VMAX = 7;
const ACC = 1.2;

interface Line {
  key: string;
  center: THREE.Vector3;
  dir: THREE.Vector3;
  track: ModelObject;
  trackGeoms: THREE.BufferGeometry[];
  cars: Vehicle[];
  head: number;
  speed: number;
  state: 'wait' | 'arrive' | 'load' | 'depart';
  timer: number;
}

export class TrainTraffic {
  private readonly lines = new Map<string, Line>();

  constructor(private readonly env: VehicleEnv) {}

  private buildTrack(center: THREE.Vector3, dir: THREE.Vector3): ModelObject {
    const b = new Builder(this.env.lib.company);
    const t = this.env.terrain;
    for (const side of [-1, 1]) {
      const s0 = side < 0 ? -EXT : 7;
      const s1 = side < 0 ? -7 : EXT;
      b.slab(s0, -0.3, -1.0, s1, 0.12, 1.0, C.GRAVEL, 'rough');
      for (let s = s0; s < s1; s += 0.9) b.box(s, 0.16, 0, 0.22, 0.08, 1.5, C.WOOD, 'rough');
      for (const z of [-0.55, 0.55]) b.slab(s0, 0.2, z - 0.05, s1, 0.3, z + 0.05, C.STEEL, 'metal');
      // trestle piers where the ground drops away
      for (let s = s0 + 2; s < s1; s += 4) {
        const gx = center.x + dir.x * s;
        const gz = center.z + dir.z * s;
        const g = t.ground(gx, gz) - center.y;
        if (g < -0.4) {
          b.box(s, (g - 0.3) / 2, -0.6, 0.35, -g + 0.3, 0.35, C.CONCRETE_DARK, 'rough');
          b.box(s, (g - 0.3) / 2, 0.6, 0.35, -g + 0.3, 0.35, C.CONCRETE_DARK, 'rough');
          b.box(s, -0.35, 0, 0.4, 0.3, 1.9, C.CONCRETE_DARK, 'rough');
        }
      }
    }
    const tpl = b.build();
    const m = instantiate(tpl, this.env.lib, true);
    m.root.position.copy(center);
    m.root.rotation.y = yawOf(dir.x, dir.z);
    return m;
  }

  update(dt: number, views: Map<string, BuildingView>): void {
    const state = this.env.ctx.state;
    const seen = new Set<string>();
    for (const v of views.values()) {
      if (v.type !== 'rail_terminal' || v.status === 'constructing' || v.status === 'destroyed') continue;
      const b = state.buildings[v.id];
      const ta = v.anchors.find((a) => a.def.kind === 'track');
      const td = v.anchors.find((a) => a.def.kind === 'trackDir');
      if (!b || !ta || !td) continue;
      const key = `${v.id}:${b.x},${b.y},${b.z},${b.rotation}`;
      seen.add(v.id);
      let line = this.lines.get(v.id);
      if (line && line.key !== key) {
        this.disposeLine(line);
        line = undefined;
      }
      if (!line) {
        const center = ta.pos.clone();
        center.y -= 0.3; // anchor sits at rail-top height
        const dir = new THREE.Vector3(td.pos.x - ta.pos.x, 0, td.pos.z - ta.pos.z).normalize();
        const track = this.buildTrack(center, dir);
        this.env.group.add(track.root);
        const cars: Vehicle[] = [new Vehicle(this.env, locoTemplate(this.env.lib.company))];
        for (let i = 0; i < CARS; i++) cars.push(new Vehicle(this.env, tankCarTemplate(this.env.lib.company, i)));
        line = { key, center, dir, track, trackGeoms: [], cars, head: -EXT, speed: 0, state: 'wait', timer: 3 + Math.random() * 5 };
        this.lines.set(v.id, line);
      }
      const act = v.status === 'active' ? Math.max(0.3, Math.min(1, b.utilization || 0.6)) : v.status === 'idle' ? 0.05 : 0;
      this.step(line, dt, act);
    }
    for (const [id, line] of this.lines)
      if (!seen.has(id)) {
        this.disposeLine(line);
        this.lines.delete(id);
      }
  }

  private step(l: Line, dt: number, act: number): void {
    const stopHead = TRAIN_LEN / 2;
    if (l.state === 'wait') {
      if (act > 0) l.timer -= dt;
      if (l.timer <= 0) {
        l.state = 'arrive';
        l.head = -EXT;
        l.speed = VMAX;
      }
    } else if (l.state === 'arrive') {
      const remain = stopHead - l.head;
      l.speed = Math.min(VMAX, Math.sqrt(2 * ACC * Math.max(0, remain)) + 0.15);
      l.head += l.speed * dt;
      if (l.head >= stopHead) {
        l.head = stopHead;
        l.state = 'load';
        l.timer = 22;
        l.speed = 0;
      }
    } else if (l.state === 'load') {
      l.timer -= dt;
      if (l.timer <= 0) l.state = 'depart';
    } else {
      l.speed = Math.min(VMAX, l.speed + ACC * dt);
      l.head += l.speed * dt;
      if (l.head - TRAIN_LEN > EXT) {
        l.state = 'wait';
        l.timer = 120 / (0.3 + 2.5 * Math.max(0.02, act)) * (0.7 + Math.random() * 0.6);
      }
    }
    const moving = l.state === 'arrive' || l.state === 'depart' || l.state === 'load';
    const yaw = yawOf(l.dir.x, l.dir.z);
    let off = LOCO_LEN / 2;
    for (let i = 0; i < l.cars.length; i++) {
      const car = l.cars[i];
      const s = l.head - off;
      const visible = moving && Math.abs(s) < EXT - 2;
      car.obj.visible = visible;
      if (visible) car.place(l.center.x + l.dir.x * s, l.center.y + 0.3, l.center.z + l.dir.z * s, yaw);
      off += i === 0 ? LOCO_LEN / 2 + CAR_LEN / 2 : CAR_LEN;
    }
    if (l.cars[0].obj.visible) l.cars[0].emit(dt, l.state === 'load' ? 0.3 : 1);
  }

  private disposeLine(l: Line): void {
    for (const c of l.cars) c.dispose();
    l.track.root.removeFromParent();
    const walk = (n: typeof l.track.template.root) => {
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
