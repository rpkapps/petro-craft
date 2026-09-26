// Player avatars: a blocky field operator (hard hat, hi-vis vest in the player's colour, tool belt,
// boots) for every remote player and for the local player's body while the local player flies the
// drone camera (hidden in first person). Position/yaw are smoothed from the synced PlayerState;
// the pose blends between idle (breathing, glancing around), walk/run cycles and a flying pose.
// Remote players get a subtle, distance-faded name tag.
import * as THREE from 'three';
import type { GameContext, PlayerState } from '../../../core/types';
import { Builder, type ModelTemplate } from '../geom/Builder';
import type { MaterialLib } from '../materials';
import { instantiate, type ModelObject } from '../models/instantiate';
import { C } from '../palette';
import type { Terrain } from '../vehicles/terrain';

const HIDE_DIST = 200;
const TAG_DIST = 70;

const templates = new Map<string, ModelTemplate>();

/** Free cached avatar templates (layer dispose). */
export function clearAvatarTemplates(): void {
  for (const t of templates.values()) {
    const walk = (n: ModelTemplate['root']) => {
      for (const m of n.meshes) m.geometry.dispose();
      n.children.forEach(walk);
    };
    walk(t.root);
  }
  templates.clear();
}

/** Avatar facing +x, feet at y = 0; animated nodes: body, torso, head, armL/armR (shoulders), legL/legR (hips). */
function avatarTemplate(vest: string, company: string): ModelTemplate {
  const key = `${vest}|${company}`;
  let t = templates.get(key);
  if (t) return t;
  const b = new Builder(company);
  const v = new THREE.Color(vest).getHex();
  const reflect = 0xf4f1d0;
  const pants = 0x2b3a55;
  const boot = 0x3a2a1c;
  b.group('body', 0, 0.78, 0, () => {
    for (const [name, z] of [
      ['legL', -0.11],
      ['legR', 0.11],
    ] as const)
      b.group(name, 0, 0, z, () => {
        b.box(0, -0.33, 0, 0.19, 0.64, 0.2, pants, 'rough');
        b.box(0, -0.37, 0, 0.2, 0.05, 0.21, reflect, 'paint');
        b.box(0.04, -0.72, 0, 0.26, 0.12, 0.22, boot, 'rough');
        b.box(0.14, -0.66, 0, 0.06, 0.06, 0.2, C.STEEL_DARK, 'metal');
      });
    b.group('torso', 0, 0, 0, () => {
      // shirt, vest with reflective bands, belt with tools
      b.box(0, 0.32, 0, 0.26, 0.62, 0.44, 0x44576e, 'rough');
      b.box(0, 0.3, 0, 0.28, 0.5, 0.46, v, 'paint');
      b.box(0, 0.22, 0, 0.29, 0.05, 0.47, reflect, 'paint');
      b.box(0, 0.4, 0, 0.29, 0.05, 0.47, reflect, 'paint');
      for (const z of [-0.12, 0.12]) b.box(0.141, 0.47, z, 0.01, 0.2, 0.05, reflect, 'paint');
      b.box(0, 0.03, 0, 0.29, 0.07, 0.47, 0x2a2e36, 'rough');
      b.box(0.14, 0.03, 0, 0.02, 0.06, 0.07, C.STEEL_LIGHT, 'metal');
      b.box(-0.02, 0.0, 0.25, 0.1, 0.14, 0.05, C.HAZARD, 'paint');
      b.box(-0.1, 0.33, 0, 0.1, 0.36, 0.3, 0x3a3f46, 'rough');
      b.group('head', 0, 0.64, 0, () => {
        b.box(0, 0.15, 0, 0.27, 0.29, 0.27, C.SKIN, 'paint');
        b.box(0.136, 0.18, -0.06, 0.005, 0.04, 0.04, 0x1d1e20, 'paint');
        b.box(0.136, 0.18, 0.06, 0.005, 0.04, 0.04, 0x1d1e20, 'paint');
        b.box(0.136, 0.07, 0, 0.005, 0.02, 0.09, 0x8a5a44, 'paint');
        // safety glasses band + hard hat with company stripe
        b.box(0.137, 0.18, 0, 0.004, 0.06, 0.2, 0x2a3a48, 'glassDark');
        b.box(0, 0.33, 0, 0.3, 0.12, 0.3, 0xf4f1ea, 'paint');
        b.box(0, 0.4, 0, 0.24, 0.04, 0.24, 0xf4f1ea, 'paint');
        b.box(0.05, 0.28, 0, 0.42, 0.03, 0.34, 0xf4f1ea, 'paint');
        b.box(0, 0.345, 0, 0.305, 0.03, 0.305, b.company, 'paint');
      });
      for (const [name, z] of [
        ['armL', -0.3],
        ['armR', 0.3],
      ] as const)
        b.group(name, 0, 0.56, z, () => {
          b.box(0, -0.12, 0, 0.14, 0.26, 0.14, v, 'paint');
          b.box(0, -0.18, 0, 0.145, 0.04, 0.145, reflect, 'paint');
          b.box(0, -0.37, 0, 0.12, 0.26, 0.12, 0x44576e, 'rough');
          b.box(0, -0.54, 0, 0.13, 0.1, 0.13, C.HAZARD, 'rough');
        });
    });
  });
  t = b.build();
  templates.set(key, t);
  return t;
}

function nameTag(name: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = '600 30px Rajdhani, "Arial Narrow", Arial, sans-serif';
  const text = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const w = Math.min(248, g.measureText(text).width + 34);
  const x0 = (256 - w) / 2;
  g.fillStyle = 'rgba(14,16,20,0.62)';
  g.beginPath();
  g.roundRect(x0, 12, w, 40, 8);
  g.fill();
  g.fillStyle = color;
  g.fillRect(x0, 12, 5, 40);
  g.fillStyle = '#f4f1ea';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(text, 128 + 3, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.9, 0.475, 1);
  s.renderOrder = 10;
  return s;
}

interface Avatar {
  id: string;
  key: string;
  model: ModelObject;
  obj: THREE.Group;
  tag: THREE.Sprite | null;
  tagKey: string;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  phase: number;
  air: number;
  idleT: number;
  glance: number;
  glanceTarget: number;
  seen: boolean;
}

const _t = new THREE.Vector3();

export class AvatarLayer {
  readonly group = new THREE.Group();
  private readonly avatars = new Map<string, Avatar>();

  constructor(
    private readonly ctx: GameContext,
    private readonly lib: MaterialLib,
    private readonly terrain: Terrain,
    private readonly camera: THREE.Camera,
    private readonly shadows: boolean,
  ) {
    this.group.name = 'avatars';
  }

  /** Whether a player's body is drawn (remote players always; the local one only in drone view). */
  private shown(p: PlayerState): boolean {
    if (p.id !== this.ctx.localPlayerId) return true;
    return p.mode === 'drone';
  }

  update(dt: number): void {
    const players = this.ctx.state.players ?? {};
    for (const a of this.avatars.values()) a.seen = false;
    for (const id in players) {
      const p = players[id];
      if (!p || !this.shown(p)) continue;
      const vest = p.color || this.ctx.state.company.color || '#ff8a1f';
      const key = `${vest}|${this.lib.company}`;
      let a = this.avatars.get(id);
      if (a && a.key !== key) {
        this.remove(a);
        a = undefined;
      }
      if (!a) a = this.create(p, key, vest);
      a.seen = true;
      this.animate(a, p, dt);
    }
    for (const a of this.avatars.values()) if (!a.seen) this.remove(a);
  }

  private create(p: PlayerState, key: string, vest: string): Avatar {
    const model = instantiate(avatarTemplate(vest, this.lib.company), this.lib, this.shadows);
    const obj = new THREE.Group();
    obj.name = `avatar:${p.id}`;
    obj.add(model.root);
    this.group.add(obj);
    const a: Avatar = {
      id: p.id, key, model, obj, tag: null, tagKey: '', pos: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
      yaw: p.yaw, speed: 0, phase: 0, air: 0, idleT: Math.random() * 10, glance: 0, glanceTarget: 0, seen: true,
    };
    this.avatars.set(p.id, a);
    return a;
  }

  private remove(a: Avatar): void {
    a.obj.removeFromParent();
    if (a.tag) {
      a.tag.material.map?.dispose();
      a.tag.material.dispose();
    }
    this.avatars.delete(a.id);
  }

  private animate(a: Avatar, p: PlayerState, dt: number): void {
    const target = _t.set(p.position.x, p.position.y, p.position.z);
    const jump = a.pos.distanceTo(target);
    const prevX = a.pos.x;
    const prevZ = a.pos.z;
    if (jump > 12) a.pos.copy(target);
    else a.pos.lerp(target, 1 - Math.exp(-dt * 12));
    // speed from the smoothed motion (falls back to the synced velocity when frames stall)
    const moved = dt > 0 ? Math.hypot(a.pos.x - prevX, a.pos.z - prevZ) / dt : 0;
    const vel = Math.hypot(p.velocity?.x ?? 0, p.velocity?.z ?? 0);
    const sp = Math.min(9, jump > 12 ? 0 : Math.max(moved, vel * 0.5));
    a.speed += (sp - a.speed) * Math.min(1, dt * 8);
    const wantYaw = p.yaw;
    a.yaw += Math.atan2(Math.sin(wantYaw - a.yaw), Math.cos(wantYaw - a.yaw)) * Math.min(1, dt * 10);
    // grounded when standing on any solid block (roofs, pads, terrain) just below the feet
    const t = this.terrain;
    const grounded = t.solidAt(a.pos.x, a.pos.y - 0.2, a.pos.z) || t.solidAt(a.pos.x, a.pos.y - 0.9, a.pos.z) || a.pos.y - t.ground(a.pos.x, a.pos.z) < 0.4;
    const airborne = !grounded && (p.mode === 'fly' || p.mode === 'drone' || Math.abs(p.velocity?.y ?? 0) < 1.5);
    a.air += ((airborne ? 1 : 0) - a.air) * Math.min(1, dt * 5);

    const n = a.model.nodes;
    const body = n.get('body');
    const torso = n.get('torso');
    const head = n.get('head');
    const armL = n.get('armL');
    const armR = n.get('armR');
    const legL = n.get('legL');
    const legR = n.get('legR');
    if (!body || !torso || !head || !armL || !armR || !legL || !legR) return;
    const walk = Math.min(1, a.speed / 4.3) * (1 - a.air);
    a.phase += dt * (2.2 + a.speed * 1.9) * (walk > 0.05 ? 1 : 0);
    a.idleT += dt;
    const swing = Math.sin(a.phase) * 0.75 * walk;
    const breath = Math.sin(a.idleT * 1.7) * 0.012 * (1 - walk);
    // idle glances
    if (walk < 0.1 && a.air < 0.5) {
      if (Math.abs(a.glance - a.glanceTarget) < 0.02 && Math.random() < dt * 0.35) a.glanceTarget = (Math.random() - 0.5) * 1.1;
    } else a.glanceTarget = 0;
    a.glance += (a.glanceTarget - a.glance) * Math.min(1, dt * 3);
    const dead = p.health <= 0;
    // legs & arms (rotation about z swings them fore/aft for a +x-facing body)
    const flyLeg = a.air * 0.35;
    legL.rotation.z = swing - flyLeg;
    legR.rotation.z = -swing - flyLeg * 0.6;
    armL.rotation.z = -swing * 0.9 + a.air * 0.5;
    armR.rotation.z = swing * 0.9 + a.air * 0.5;
    armL.rotation.x = a.air * 0.5 + 0.04;
    armR.rotation.x = -a.air * 0.5 - 0.04;
    torso.position.y = breath + Math.abs(Math.cos(a.phase)) * 0.05 * walk;
    torso.rotation.z = -walk * 0.08 - a.air * 0.25;
    head.rotation.y = a.glance;
    head.rotation.z = Math.max(-0.6, Math.min(0.6, p.pitch * 0.6)) + a.air * 0.2;
    body.rotation.z = dead ? Math.PI / 2 : 0;
    body.position.y = dead ? 0.2 : 0.78;

    const hover = a.air * Math.sin(a.idleT * 2.2) * 0.06;
    a.obj.position.set(a.pos.x, a.pos.y + hover, a.pos.z);
    // PlayerState yaw 0 looks along −Z; the model faces +x
    a.obj.rotation.set(0, a.yaw + Math.PI / 2, 0);
    const dist = this.camera.position.distanceTo(a.obj.position);
    a.obj.visible = dist < HIDE_DIST;
    this.updateTag(a, p, dist);
  }

  private updateTag(a: Avatar, p: PlayerState, dist: number): void {
    const remote = p.id !== this.ctx.localPlayerId;
    if (!remote) {
      if (a.tag) a.tag.visible = false;
      return;
    }
    const color = p.color || this.ctx.state.company.color || '#ff8a1f';
    const key = `${p.name}|${color}`;
    if (!a.tag || a.tagKey !== key) {
      if (a.tag) {
        a.tag.removeFromParent();
        a.tag.material.map?.dispose();
        a.tag.material.dispose();
      }
      a.tag = nameTag(p.name || 'Player', color);
      a.tagKey = key;
      this.group.add(a.tag);
    }
    const fade = Math.max(0, Math.min(1, (TAG_DIST - dist) / 20));
    a.tag.visible = fade > 0.01 && a.obj.visible;
    a.tag.material.opacity = 0.85 * fade;
    a.tag.position.set(a.obj.position.x, a.obj.position.y + 2.3, a.obj.position.z);
  }

  dispose(): void {
    for (const a of [...this.avatars.values()]) this.remove(a);
    this.group.removeFromParent();
  }
}
