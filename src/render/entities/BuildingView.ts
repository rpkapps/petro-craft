// One rendered building: model instance, placement, status looks (construction site, damage, ruin),
// level of detail and per-frame animation.
import * as THREE from 'three';
import type { BuildingState, GameContext, WellState } from '../../core/types';
import { ANIM_DISTANCE, DETAIL_DISTANCE, DETAIL_RADIUS_FACTOR, INSTANCING } from './config';
import type { AnchorDef } from './geom/Builder';
import type { InstanceBatcher, InstanceMember } from './instancing/InstanceBatcher';
import type { MaterialLib, MatKind, MatMode } from './materials';
import { instantiate, type ModelObject } from './models/instantiate';
import { defSize, getModelDef, getTemplate } from './models/registry';
import type { AnimState, ModelDef } from './models/types';
import { ConstructionSite } from './status/construction';
import { Ruin } from './status/ruin';

export interface WorldAnchor {
  def: AnchorDef;
  /** World position (static anchors); refreshed for node anchors by worldPos(). */
  pos: THREE.Vector3;
  node: THREE.Object3D | null;
}

export interface ViewEnv {
  lib: MaterialLib;
  ctx: GameContext;
  shadows: boolean;
  /** Well linked to a building (rig → current well, wellhead → its well). */
  wellFor(b: BuildingState): WellState | undefined;
  /** Shared instanced renderer for distant buildings (null = always draw individually). */
  batcher: InstanceBatcher | null;
}

const _sphere = new THREE.Sphere();

export function statusMode(status: string): MatMode {
  switch (status) {
    case 'disabled':
    case 'no_power':
    case 'unstaffed':
    case 'constructing':
      return 'off';
    case 'broken':
    case 'fire':
      return 'broken';
    case 'destroyed':
      return 'charred';
    default:
      return 'normal';
  }
}

/** Yaw applied for a building rotation step (clockwise seen from above). */
export const rotationYaw = (r: number) => (-r * Math.PI) / 2;

export class BuildingView implements InstanceMember {
  readonly group = new THREE.Group();
  /** Instanced-batch membership (managed by the InstanceBatcher). */
  inst: InstanceMember['inst'] = null;
  readonly def: ModelDef;
  model!: ModelObject;
  variant = '';
  status = '';
  anchors: WorldAnchor[] = [];
  /** World-space centre (footprint centre at mid height) & bounding radius. */
  readonly center = new THREE.Vector3();
  radius = 1;
  /** Smoothed animation speed 0..1. */
  speed = 0;
  targetSpeed = 0;
  distance = Infinity;
  visible = true;
  hidden = false;
  readonly mem: Record<string, number> = {};
  private site: ConstructionSite | null = null;
  private ruin: Ruin | null = null;
  private mode: MatMode | null = null;
  private detailsOn = true;
  private placeKey = '';
  private readonly anim: AnimState;
  readonly size: [number, number, number];

  constructor(readonly id: string, readonly type: string, private readonly env: ViewEnv, private readonly parent: THREE.Object3D) {
    this.def = getModelDef(type);
    this.size = defSize(type);
    this.group.name = `building:${id}`;
    parent.add(this.group);
    const self = this;
    this.anim = {
      dt: 0,
      t: 0,
      speed: 0,
      b: null as unknown as BuildingState,
      ctx: env.ctx,
      well: undefined,
      mem: this.mem,
      node: (n: string) => self.model.nodes.get(n),
    };
  }

  /** Apply building state: placement, variant, status looks. Cheap when nothing changed. */
  sync(b: BuildingState): void {
    const variant = this.def.variant ? this.def.variant(b, this.env.ctx) : '';
    if (!this.model || variant !== this.variant) this.rebuild(b, variant);
    const pk = `${b.x},${b.y},${b.z},${b.rotation}`;
    if (pk !== this.placeKey) this.place(b, pk);
    this.applyStatus(b);
    if (this.site) this.site.setProgress(b.constructionProgress);
  }

  /** Whether this building is currently drawn through the shared instanced batches. */
  get instanced(): boolean {
    return this.inst !== null;
  }

  private uninstance(): void {
    if (!this.inst) return;
    this.env.batcher?.remove(this);
    if (this.group.parent !== this.parent) this.parent.add(this.group);
  }

  private rebuild(b: BuildingState, variant: string): void {
    this.uninstance();
    this.clearStatusLooks();
    if (this.model) this.model.root.removeFromParent();
    this.variant = variant;
    const t = getTemplate(this.type, variant, this.env.lib.company, this.env.lib.fine);
    this.model = instantiate(t, this.env.lib, this.env.shadows);
    this.group.add(this.model.root);
    this.mode = null;
    this.status = '';
    this.placeKey = '';
    this.detailsOn = true;
  }

  private place(b: BuildingState, key: string): void {
    this.uninstance();
    this.placeKey = key;
    this.group.position.set(b.x + b.size[0] / 2, b.y, b.z + b.size[1] / 2);
    this.group.rotation.set(0, rotationYaw(b.rotation), 0);
    this.group.updateMatrixWorld(true);
    const bb = this.model.template.bounds;
    bb.getBoundingSphere(_sphere);
    this.radius = Math.max(1, _sphere.radius);
    this.center.copy(_sphere.center).applyMatrix4(this.group.matrixWorld);
    this.anchors = this.model.template.anchors.map((def) => {
      const node = def.node ? (this.model.nodes.get(def.node) ?? null) : null;
      const pos = def.pos.clone();
      if (node) node.localToWorld(pos);
      else pos.applyMatrix4(this.group.matrixWorld);
      return { def, pos, node };
    });
    // status looks depend on world placement
    if (this.site || this.ruin) {
      this.clearStatusLooks();
      this.status = '';
      this.mode = null;
    }
  }

  private clearStatusLooks(): void {
    if (this.site) {
      this.site.dispose();
      this.site = null;
    }
    if (this.ruin) {
      this.ruin.dispose();
      this.ruin = null;
    }
  }

  private applyStatus(b: BuildingState): void {
    const constructing = b.status === 'constructing' || b.constructionProgress < 1;
    const status = constructing ? 'constructing' : b.status;
    if (status === this.status) return;
    this.clearStatusLooks();
    this.status = status;
    if (status === 'constructing' || status === 'destroyed') this.uninstance();
    const [w, d, h] = this.size;
    if (status === 'constructing') {
      this.site = new ConstructionSite(this.env.lib, this.model, w, d, h, b.y);
      this.group.add(this.site.group);
      this.site.setProgress(b.constructionProgress);
      this.mode = null;
      return;
    }
    if (status === 'destroyed') {
      const c = new THREE.Vector3(this.group.position.x, b.y, this.group.position.z);
      let seed = 0;
      for (let i = 0; i < this.id.length; i++) seed = (seed * 31 + this.id.charCodeAt(i)) | 0;
      this.ruin = new Ruin(this.env.lib, this.model, w, d, h, c, seed);
      this.group.add(this.ruin.group);
      this.mode = null;
      return;
    }
    this.setMode(statusMode(status));
  }

  private setMode(mode: MatMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const m of this.model.meshes) m.material = this.env.lib.get(m.userData.kind as MatKind, mode);
    if (this.inst) this.env.batcher?.add(this, mode);
  }

  /** Whether lights/emissive FX should run (not off, not ruined, not under construction). */
  get lightsOn(): boolean {
    return this.status === 'active' || this.status === 'idle' || this.status === 'fire' || this.status === 'broken';
  }

  get operational(): boolean {
    return this.status === 'active' || this.status === 'idle';
  }

  /** World position of an anchor (follows animated nodes). */
  anchorPos(a: WorldAnchor, out: THREE.Vector3): THREE.Vector3 {
    if (!a.node) return out.copy(a.pos);
    return a.node.localToWorld(out.copy(a.def.pos));
  }

  /** Target activity from building status/utilisation (0..1). */
  computeTarget(b: BuildingState): number {
    if (this.def.activity) return this.operational ? Math.max(0, Math.min(1, this.def.activity(b, this.env.ctx))) : 0;
    if (this.def.ambient && this.operational) return 1;
    if (this.status !== 'active') return 0;
    return b.utilization > 0.02 ? 0.3 + 0.7 * Math.min(1, b.utilization) : 0.75;
  }

  /** Per-frame: LOD, animation. */
  update(dt: number, t: number, b: BuildingState, cam: THREE.Camera, frustum: THREE.Frustum, cullDistance = Infinity): void {
    if (this.hidden) return;
    this.distance = cam.position.distanceTo(this.center);
    // beyond the fog nothing is visible: skip rendering entirely
    const inRange = this.distance - this.radius < cullDistance;
    // distant buildings in a plain look are drawn through the shared instanced batches
    const batcher = this.env.batcher;
    if (batcher) {
      // small equipment switches closer than large plants (its detail is only noticeable up close)
      const near = Math.min(INSTANCING.near, INSTANCING.minNear + this.radius * INSTANCING.nearPerRadius);
      const edge = this.distance - this.radius;
      const far = edge > near + (this.inst ? -INSTANCING.hysteresis : INSTANCING.hysteresis);
      const want = INSTANCING.enabled && far && inRange && this.mode !== null && !this.site && !this.ruin;
      if (want && !this.inst) {
        batcher.add(this, this.mode!);
        if (this.inst) this.group.removeFromParent();
      } else if (!want && this.inst) this.uninstance();
    }
    if (!this.inst && inRange !== this.group.visible) this.group.visible = inRange;
    _sphere.center.copy(this.center);
    _sphere.radius = this.radius;
    this.visible = inRange && frustum.intersectsSphere(_sphere);
    const wantDetails = this.distance < DETAIL_DISTANCE + this.radius * DETAIL_RADIUS_FACTOR;
    if (wantDetails !== this.detailsOn) {
      this.detailsOn = wantDetails;
      for (const m of this.model.details) m.visible = wantDetails;
    }
    this.targetSpeed = this.computeTarget(b);
    const k = Math.min(1, dt * 1.2);
    this.speed += (this.targetSpeed - this.speed) * k;
    if (this.speed < 0.002 && this.targetSpeed === 0) this.speed = 0;
    if (this.site) this.site.update(dt, this.visible && this.distance < ANIM_DISTANCE);
    if (!this.def.animate || !this.visible || this.distance > ANIM_DISTANCE + this.radius) return;
    if (this.status === 'constructing' || this.status === 'destroyed') return;
    const a = this.anim;
    a.dt = dt;
    a.t = t;
    a.speed = this.speed;
    a.b = b;
    a.well = this.env.wellFor(b);
    this.def.animate(a);
    if (this.inst) this.env.batcher?.animated(this);
  }

  setHidden(h: boolean): void {
    if (h === this.hidden) return;
    this.hidden = h;
    if (h) this.uninstance();
    this.group.visible = !h;
  }

  dispose(): void {
    this.env.batcher?.remove(this);
    this.clearStatusLooks();
    this.group.removeFromParent();
  }
}

