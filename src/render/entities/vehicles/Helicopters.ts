// Crew-change helicopters: one per operational helipad. It spins up, climbs, cruises to a random
// operational offshore helideck (rig, platform or FPSO), lands, waits, and flies back.
import * as THREE from 'three';
import type { BuildingView } from '../BuildingView';
import { COL, dust } from '../fx/emitters';
import { heliTemplate } from './templates';
import { Vehicle, yawOf, type VehicleEnv } from './Vehicle';

const OFFSHORE = new Set(['jackup_rig', 'semi_sub_rig', 'production_platform', 'fpso']);
const CRUISE = 20;
const CLIMB = 3.2;

type Phase = 'parked' | 'spinup' | 'climb' | 'cruise' | 'descend' | 'onDeck' | 'spindown';

interface Heli {
  v: Vehicle;
  home: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  targetId: string | null;
  returning: boolean;
  phase: Phase;
  t: number;
  timer: number;
  rotor: number;
  yaw: number;
  alt: number;
  pos: THREE.Vector3;
}

const _d = new THREE.Vector3();

export class HeliTraffic {
  private readonly helis = new Map<string, Heli>();

  constructor(private readonly env: VehicleEnv) {}

  private deckOf(v: BuildingView): THREE.Vector3 | null {
    const a = v.anchors.find((x) => x.def.kind === 'helideck');
    return a ? v.anchorPos(a, new THREE.Vector3()) : null;
  }

  update(dt: number, views: Map<string, BuildingView>): void {
    const seen = new Set<string>();
    const targets: BuildingView[] = [];
    for (const v of views.values()) if (OFFSHORE.has(v.type) && v.operational) targets.push(v);
    for (const v of views.values()) {
      if (v.type !== 'helipad' || v.status === 'constructing' || v.status === 'destroyed') continue;
      const home = this.deckOf(v);
      if (!home) continue;
      seen.add(v.id);
      let h = this.helis.get(v.id);
      if (!h || h.home.distanceToSquared(home) > 0.01) {
        h?.v.dispose();
        const heli = new Vehicle(this.env, heliTemplate(this.env.lib.company));
        h = { v: heli, home: home.clone(), from: home.clone(), to: home.clone(), targetId: null, returning: false, phase: 'parked', t: 0, timer: 8 + Math.random() * 20, rotor: 0, yaw: Math.random() * 6, alt: 0, pos: home.clone() };
        this.helis.set(v.id, h);
      }
      this.step(h, dt, v.operational, targets, views);
    }
    for (const [id, h] of this.helis)
      if (!seen.has(id)) {
        h.v.dispose();
        this.helis.delete(id);
      }
  }

  private step(h: Heli, dt: number, padOk: boolean, targets: BuildingView[], views: Map<string, BuildingView>): void {
    const rotorTarget = h.phase === 'parked' || h.phase === 'spindown' ? 0 : 1;
    h.rotor += (rotorTarget - h.rotor) * Math.min(1, dt * (rotorTarget ? 0.7 : 0.35));
    // refresh the destination if the target platform moved or vanished
    if (h.targetId && !h.returning) {
      const tv = views.get(h.targetId);
      const deck = tv && tv.operational ? this.deckOf(tv) : null;
      if (deck) h.to.copy(deck);
      else if (h.phase !== 'parked') {
        h.returning = true;
        h.from.copy(h.pos);
        h.to.copy(h.home);
        if (h.phase === 'onDeck' || h.phase === 'descend') h.phase = 'climb';
      }
    }
    switch (h.phase) {
      case 'parked':
        h.pos.copy(h.home);
        if (padOk && targets.length) {
          h.timer -= dt;
          if (h.timer <= 0) {
            const tv = targets[Math.floor(Math.random() * targets.length)];
            const deck = this.deckOf(tv);
            if (deck) {
              h.targetId = tv.id;
              h.returning = false;
              h.from.copy(h.home);
              h.to.copy(deck);
              h.phase = 'spinup';
              h.t = 0;
            }
          }
        }
        break;
      case 'spinup':
        h.t += dt;
        if (h.t > 3.5) h.phase = 'climb';
        break;
      case 'climb': {
        const cruiseY = Math.max(h.from.y, h.to.y) + 22;
        h.pos.y = Math.min(cruiseY, h.pos.y + CLIMB * dt * (0.4 + Math.min(1, (h.pos.y - h.from.y) / 4)));
        h.pos.x += (h.from.x - h.pos.x) * Math.min(1, dt);
        h.pos.z += (h.from.z - h.pos.z) * Math.min(1, dt);
        if (h.pos.y >= cruiseY - 0.05) h.phase = 'cruise';
        break;
      }
      case 'cruise': {
        _d.set(h.to.x - h.pos.x, 0, h.to.z - h.pos.z);
        const dist = _d.length();
        const speed = Math.min(CRUISE, 1.5 + dist * 0.5);
        if (dist < 0.3) {
          h.phase = 'descend';
          break;
        }
        _d.normalize();
        h.pos.addScaledVector(_d, Math.min(dist, speed * dt));
        const want = yawOf(_d.x, _d.z);
        h.yaw += Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw)) * Math.min(1, dt * 1.5);
        break;
      }
      case 'descend': {
        const gap = h.pos.y - h.to.y;
        h.pos.y -= Math.max(0.4, Math.min(CLIMB, gap * 0.6)) * dt;
        h.pos.x += (h.to.x - h.pos.x) * Math.min(1, dt * 2);
        h.pos.z += (h.to.z - h.pos.z) * Math.min(1, dt * 2);
        if (h.pos.y <= h.to.y + 0.01) {
          h.pos.copy(h.to);
          if (h.returning) {
            h.phase = 'spindown';
            h.t = 0;
          } else {
            h.phase = 'onDeck';
            h.timer = 14;
          }
        }
        break;
      }
      case 'onDeck':
        h.pos.copy(h.to);
        h.timer -= dt;
        if (h.timer <= 0) {
          h.returning = true;
          h.from.copy(h.to);
          h.to.copy(h.home);
          h.phase = 'climb';
        }
        break;
      case 'spindown':
        h.t += dt;
        h.pos.copy(h.home);
        if (h.t > 5) {
          h.phase = 'parked';
          h.targetId = null;
          h.returning = false;
          h.timer = 40 + Math.random() * 50;
        }
        break;
    }
    const flying = h.phase === 'climb' || h.phase === 'cruise' || h.phase === 'descend';
    const pitch = h.phase === 'cruise' ? -0.12 : 0;
    const hover = flying ? Math.sin(performance.now() * 0.002) * 0.05 : 0;
    h.v.place(h.pos.x, h.pos.y + hover, h.pos.z, h.yaw, pitch);
    const rotor = h.v.node('rotor');
    const tail = h.v.node('tail');
    if (rotor) rotor.rotation.y += dt * h.rotor * 38;
    if (tail) tail.rotation.z += dt * h.rotor * 60;
    const d = h.v.distanceTo(this.env.camera.position);
    h.v.obj.visible = d < 360;
    // rotor downwash near the ground
    if (h.rotor > 0.5 && d < 120) {
      const ground = this.env.terrain.ground(h.pos.x, h.pos.z);
      const agl = h.pos.y - ground;
      if (agl < 8 && !this.env.terrain.isWater(h.pos.x, h.pos.z)) dust(this.env.fx.ps, h.pos.x, ground, h.pos.z, 3, 25 * (1 - agl / 8) * h.rotor, dt, this.env.fx.q, COL.DUST);
    }
  }

  dispose(): void {
    for (const h of this.helis.values()) h.v.dispose();
    this.helis.clear();
  }
}
