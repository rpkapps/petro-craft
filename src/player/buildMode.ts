// Build mode: translucent building ghost snapped to the targeted ground cell (footprint centred on the cursor),
// R to rotate, throttled validation tinting the ghost green/red, LMB to place (Shift keeps building), RMB cancels.
import * as THREE from 'three';
import type { Rotation } from '../core/types';
import type { Command } from '../core/commands';
import { BUILDINGS } from '../content/buildings';
import { rotatedSize } from '../core/buildingUtil';
import { formatMoney } from '../core/state';
import { BUILD } from './config';
import type { Actions, PlayerRuntime, Target } from './runtime';

const OK_COLOR = new THREE.Color(0x3ee07a);
const tmpV = new THREE.Vector3();
const BAD_COLOR = new THREE.Color(0xff3b30);
/** Same convention as the entity layer: rotation steps turn clockwise seen from above. */
const rotationYaw = (r: number) => (-r * Math.PI) / 2;

/**
 * 'build/place' carries the building type in a payload field named `type`, which collides with the command's own
 * discriminator (`Command<'build/place'>['type']` is the literal 'build/place'). Until the contract renames it, the
 * building type is sent in `buildingType` (and mirrored in `building`) — facilities must read one of those.
 */
export function buildPlaceCommand(buildingType: string, x: number, z: number, rotation: Rotation): Command<'build/place'> {
  const cmd = { type: 'build/place' as const, x, z, rotation, buildingType, building: buildingType };
  return cmd as unknown as Command<'build/place'>;
}

const approach = (v: number, t: number, rate: number, dt: number) => v + (t - v) * (1 - Math.exp(-rate * dt));

interface TintMat {
  mat: THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number; opacity: number };
  color: THREE.Color | null;
  opacity: number;
}

export class BuildMode {
  type: string | null = null;
  rotation: Rotation = 0;
  private container: THREE.Group | null = null;
  private holder: THREE.Group | null = null;
  private previewUnrotated: [number, number] = [1, 1];
  private fallback: THREE.Mesh | null = null;
  private pad: THREE.Mesh | null = null;
  private padEdges: THREE.LineSegments | null = null;
  private tints: TintMat[] = [];
  private owned: { dispose(): void }[] = [];
  private size: [number, number, number] = [1, 1, 1];
  private origin: { x: number; y: number; z: number } | null = null;
  private validateKey = '';
  private validateTimer = 0;
  private sinceValidate = 0;
  private result: { ok: boolean; reason?: string; y: number; cost: number } | null = null;
  private lastInfoKey = '';
  private visible = false;
  private pulse = 0;

  constructor(private readonly rt: PlayerRuntime) {}

  get active(): boolean {
    return this.type !== null;
  }

  /** Enter/leave/update from a 'ui:buildMode' event. */
  set(type: string | null, rotation?: number): void {
    if (!type || !BUILDINGS[type]) {
      this.clear();
      return;
    }
    const rot = (rotation === undefined ? this.rotation : ((Math.round(rotation) % 4) + 4) % 4) as Rotation;
    if (type === this.type && this.container) {
      if (rot !== this.rotation) this.applyRotation(rot);
      return;
    }
    this.clear();
    this.type = type;
    this.rotation = rot;
    this.createGhost();
  }

  /** Leave build mode and tell the UI. */
  exit(): void {
    if (!this.active) return;
    this.clear();
    this.rt.ctx.bus.emit('ui:buildMode', { type: null });
  }

  rotate(): void {
    if (!this.type) return;
    const rot = ((this.rotation + 1) % 4) as Rotation;
    this.applyRotation(rot);
    this.rt.ctx.bus.emit('ui:buildMode', { type: this.type, rotation: rot });
    this.rt.ctx.bus.emit('audio:play', { sound: 'ui_rotate', volume: 0.5 });
  }

  update(dt: number, act: Actions, target: Target): void {
    if (!this.type || !this.container) return;
    const rt = this.rt;
    const [w, d] = this.size;
    const hit = target.hit;
    if (!hit) {
      this.setVisible(false);
      this.emitInfo();
      return;
    }
    // Ground cell: above a top face, else the neighbour cell across the hit face.
    const cx = hit.x + hit.nx, cz = hit.z + hit.nz;
    const cy = hit.ny === 1 ? hit.y + 1 : hit.y + hit.ny;
    const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
    const key = `${this.type}:${x0},${z0},${this.rotation}`;
    this.validateTimer -= dt;
    this.sinceValidate += dt;
    if ((key !== this.validateKey && this.validateTimer <= 0) || this.sinceValidate >= BUILD.revalidateInterval) {
      this.validate(x0, z0, key);
    }
    const y = this.result && this.validateKey === key ? this.result.y : cy;
    this.origin = { x: x0, y, z: z0 };
    const tx = x0 + w / 2, tz = z0 + d / 2;
    const c = this.container;
    if (!this.visible || c.position.distanceTo(tmpV.set(tx, y, tz)) > 16) c.position.set(tx, y, tz);
    else {
      c.position.x = approach(c.position.x, tx, BUILD.ghostFollowRate, dt);
      c.position.y = approach(c.position.y, y, BUILD.ghostFollowRate, dt);
      c.position.z = approach(c.position.z, tz, BUILD.ghostFollowRate, dt);
    }
    this.setVisible(true);
    this.pulse += dt;
    this.applyTint();
    this.emitInfo();

    if (act.primaryPressed) this.place();
    else if (act.secondaryPressed) this.exit();
  }

  private validate(x0: number, z0: number, key: string): void {
    const rt = this.rt;
    this.validateKey = key;
    this.validateTimer = BUILD.validateInterval;
    this.sinceValidate = 0;
    try {
      this.result = rt.ctx.services.construction.validate(this.type!, x0, z0, this.rotation, rt.body.y);
    } catch (err) {
      this.result = { ok: false, reason: String((err as Error)?.message ?? err), y: this.origin?.y ?? 0, cost: 0 };
    }
  }

  private place(): void {
    const rt = this.rt;
    if (!this.type || !this.origin) return;
    const type = this.type;
    const res = rt.dispatch(buildPlaceCommand(type, this.origin.x, this.origin.z, this.rotation));
    if (res.ok) {
      rt.swing();
      rt.ctx.bus.emit('audio:play', { sound: 'build_place', at: { x: this.origin.x + this.size[0] / 2, y: this.origin.y, z: this.origin.z + this.size[1] / 2 } });
      if (rt.input.shift()) {
        this.validateKey = '';
        this.sinceValidate = BUILD.revalidateInterval;
      } else this.exit();
    } else {
      rt.ctx.bus.emit('audio:play', { sound: 'ui_error', volume: 0.6 });
    }
  }

  private emitInfo(): void {
    const rt = this.rt;
    if (!this.type) return;
    const def = BUILDINGS[this.type];
    const r = this.visible ? this.result : null;
    const lines = [`${def.name} · ${formatMoney(r?.cost || def.cost)} · ${this.size[0]}×${this.size[1]}`];
    if (!this.visible) lines.push('Aim at the ground to place');
    else if (r && !r.ok) lines.push(`✖ ${r.reason ?? 'Cannot build here'}`);
    else lines.push('LMB place · R rotate · Shift+LMB place more · RMB cancel');
    const key = lines.join('|');
    if (key === this.lastInfoKey) return;
    this.lastInfoKey = key;
    rt.ctx.bus.emit('player:scan', {
      tool: 'build', at: this.origin ?? rt.eye(), lines, level: r && !r.ok ? 'warning' : 'info',
    });
  }

  // ---- ghost construction ------------------------------------------------------------------------------
  private footprint(rot: Rotation): [number, number, number] {
    const type = this.type!;
    let fp: [number, number, number] | null = null;
    try {
      fp = this.rt.ctx.services.construction.footprint(type, rot);
    } catch {
      fp = null;
    }
    const cat = rotatedSize(type, rot);
    // The default (no-op) service answers [1,1,1]; trust the catalogue in that case.
    if (!fp || (fp[0] === 1 && fp[1] === 1 && fp[2] === 1 && (cat[0] > 1 || cat[1] > 1))) return cat;
    return fp;
  }

  private createGhost(): void {
    const rt = this.rt;
    const type = this.type!;
    const c = new THREE.Group();
    c.name = `build-ghost:${type}`;
    const holder = new THREE.Group();
    c.add(holder);
    this.container = c;
    this.holder = holder;
    this.size = this.footprint(this.rotation);
    const unrot = rotatedSize(type, 0);
    this.previewUnrotated = [unrot[0], unrot[1]];

    let preview: THREE.Object3D | null = null;
    try {
      preview = rt.host.buildingPreview?.create(type) ?? null;
    } catch (err) {
      console.warn('[player] building preview failed', err);
    }
    if (preview) {
      // Normalise the preview origin: the entity layer may author models centred on the footprint or at its min corner.
      const bb = new THREE.Box3().setFromObject(preview);
      if (!bb.isEmpty()) {
        const ctr = bb.getCenter(new THREE.Vector3());
        const [W, D] = this.previewUnrotated;
        const dCentred = Math.hypot(ctr.x, ctr.z), dCorner = Math.hypot(ctr.x - W / 2, ctr.z - D / 2);
        if (dCorner < dCentred) preview.position.set(preview.position.x - W / 2, preview.position.y, preview.position.z - D / 2);
      }
      preview.traverse((o) => {
        const m = o as THREE.Mesh;
        o.castShadow = false;
        o.receiveShadow = false;
        if (!m.isMesh || !m.material) return;
        const clone = (mm: THREE.Material) => {
          const x = mm.clone() as TintMat['mat'];
          this.tints.push({ mat: x, color: x.color ? x.color.clone() : null, opacity: x.opacity ?? 1 });
          this.owned.push(x);
          x.transparent = true;
          x.depthWrite = false;
          return x;
        };
        m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
        m.renderOrder = 5;
      });
      holder.add(preview);
    } else {
      const [W, D, H] = rotatedSize(type, 0);
      const geo = new THREE.BoxGeometry(W - 0.04, H - 0.02, D - 0.04);
      geo.translate(0, H / 2, 0);
      const mat = new THREE.MeshLambertMaterial({ color: 0xff8a1f, emissive: 0x000000, transparent: true, opacity: 0.8, depthWrite: false });
      const box = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
      box.add(edges);
      this.fallback = box;
      this.tints.push({ mat: mat as TintMat['mat'], color: new THREE.Color(0xff8a1f), opacity: 0.8 });
      this.owned.push(geo, mat, edges.geometry, edges.material as THREE.Material);
      holder.add(box);
    }
    this.buildPad();
    holder.rotation.y = rotationYaw(this.rotation);
    c.visible = false;
    this.visible = false;
    rt.host.scene.add(c);
    this.validateKey = '';
    this.result = null;
    this.lastInfoKey = '';
  }

  private buildPad(): void {
    const c = this.container!;
    if (this.pad) {
      c.remove(this.pad);
      this.pad.geometry.dispose();
      (this.pad.material as THREE.Material).dispose();
    }
    if (this.padEdges) {
      c.remove(this.padEdges);
      this.padEdges.geometry.dispose();
      (this.padEdges.material as THREE.Material).dispose();
    }
    const [w, d] = this.size;
    const geo = new THREE.PlaneGeometry(w, d, w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.03, 0);
    const pad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    pad.renderOrder = 4;
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.04, 0.06, d + 0.04));
    edgeGeo.translate(0, 0.03, 0);
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.95 }));
    this.pad = pad;
    this.padEdges = edges;
    c.add(pad, edges);
  }

  private applyRotation(rot: Rotation): void {
    this.rotation = rot;
    if (!this.container || !this.holder) return;
    this.size = this.footprint(rot);
    this.holder.rotation.y = rotationYaw(rot);
    this.buildPad();
    this.validateKey = '';
    this.validateTimer = 0;
  }

  private applyTint(): void {
    const ok = this.result ? this.result.ok : true;
    const tint = ok ? OK_COLOR : BAD_COLOR;
    const k = 0.85 + Math.sin(this.pulse * 5) * 0.15;
    for (const t of this.tints) {
      const m = t.mat;
      m.opacity = Math.min(t.opacity, 1) * BUILD.ghostOpacity * k;
      if (m.emissive) {
        m.emissive.copy(tint);
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.45;
        if (m.color && t.color) m.color.copy(t.color).lerp(tint, 0.25);
      } else if (m.color && t.color) m.color.copy(t.color).lerp(tint, 0.55);
    }
    if (this.pad) {
      const pm = this.pad.material as THREE.MeshBasicMaterial;
      pm.color.copy(tint);
      pm.opacity = 0.22 * k;
    }
    if (this.padEdges) (this.padEdges.material as THREE.LineBasicMaterial).color.copy(tint);
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    if (this.container) this.container.visible = v;
  }

  private clear(): void {
    if (this.container) {
      this.rt.host.scene.remove(this.container);
      if (this.pad) {
        this.pad.geometry.dispose();
        (this.pad.material as THREE.Material).dispose();
      }
      if (this.padEdges) {
        this.padEdges.geometry.dispose();
        (this.padEdges.material as THREE.Material).dispose();
      }
    }
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.tints = [];
    this.container = null;
    this.holder = null;
    this.fallback = null;
    this.pad = null;
    this.padEdges = null;
    this.type = null;
    this.origin = null;
    this.result = null;
    this.visible = false;
    this.validateKey = '';
    this.lastInfoKey = '';
  }

  dispose(): void {
    this.clear();
  }
}
