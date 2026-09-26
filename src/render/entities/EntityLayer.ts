// The entity layer: everything that moves or is built on top of the voxel terrain.
// Keeps one BuildingView per building (event-driven + periodic reconcile), drives animation, FX,
// weather particles, vehicles and NPC workers.
import * as THREE from 'three';
import type { RenderHost } from '../../core/client';
import type { BuildingState, GameContext, WellState } from '../../core/types';
import { RIG_TYPES } from '../../core/buildingUtil';
import { BuildingView, type ViewEnv } from './BuildingView';
import { RECONCILE_INTERVAL } from './config';
import { FxManager } from './fx/FxManager';
import { createGhost } from './ghost';
import { MaterialLib } from './materials';
import { RIG_BUSY } from './models/rigSpecs';
import { registerAllModels } from './models';
import { WorkerCrowd } from './npc/Workers';
import { TrafficManager } from './vehicles/TrafficManager';
import { WeatherFx } from './weather/WeatherFx';

export interface EntityLayer {
  update(dt: number): void;
  dispose(): void;
}

export interface EntityLayerDebug {
  readonly root: THREE.Group;
  readonly views: Map<string, BuildingView>;
  readonly fx: FxManager;
  readonly lib: MaterialLib;
  readonly traffic: TrafficManager;
  readonly workers: WorkerCrowd;
  readonly weather: WeatherFx;
  /** Force a full reconcile now. */
  reconcile(): void;
}

export class EntityLayerImpl implements EntityLayer, EntityLayerDebug {
  readonly root = new THREE.Group();
  readonly views = new Map<string, BuildingView>();
  readonly lib: MaterialLib;
  readonly fx: FxManager;
  readonly weather: WeatherFx;
  readonly traffic: TrafficManager;
  readonly workers: WorkerCrowd;
  private readonly buildingsGroup = new THREE.Group();
  private readonly env: ViewEnv;
  private readonly offs: (() => void)[] = [];
  private readonly dirty = new Set<string>();
  private readonly rigWells = new Map<string, WellState>();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private time = 0;
  private simTime = 0;
  private reconcileTimer = RECONCILE_INTERVAL;
  private disposed = false;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext) {
    registerAllModels();
    this.root.name = 'entities';
    this.buildingsGroup.name = 'buildings';
    host.renderer.localClippingEnabled = true;
    const company = ctx.state.company;
    this.lib = new MaterialLib(company.color || '#ff8a1f', company.name || ctx.state.meta.companyName);
    this.env = {
      lib: this.lib,
      ctx,
      shadows: ctx.settings.shadows !== false,
      wellFor: (b) => this.wellFor(b),
    };
    this.fx = new FxManager(host, ctx);
    this.weather = new WeatherFx(host, ctx, this.fx);
    this.traffic = new TrafficManager(host, ctx, this.lib, this.fx, this.views);
    this.workers = new WorkerCrowd(host, ctx, this.lib, this.views);
    this.root.add(this.buildingsGroup, this.fx.group, this.weather.group, this.traffic.group, this.workers.group);
    host.scene.add(this.root);
    host.buildingPreview = { create: (type: string) => createGhost(type, this.lib) };

    const bus = ctx.bus;
    const mark = (e: { id: string }) => this.dirty.add(e.id);
    this.offs.push(
      bus.on('building:placed', mark),
      bus.on('building:completed', mark),
      bus.on('building:statusChanged', mark),
      bus.on('building:removed', (e) => this.removeView(e.id)),
      bus.on('well:statusChanged', () => (this.reconcileTimer = Math.min(this.reconcileTimer, 0.05))),
      bus.on('game:loaded', () => this.reconcile()),
    );
    this.reconcile();
  }

  /** Link a building to its well: wellheads/frac spreads via wellId, rigs via the well's rigId. */
  wellFor(b: BuildingState): WellState | undefined {
    const wells = this.ctx.state.wells;
    if (RIG_TYPES.has(b.type)) {
      const w = b.wellId ? wells[b.wellId] : undefined;
      if (w && (w.rigId === b.id || RIG_BUSY.has(w.status))) return w;
      return this.rigWells.get(b.id) ?? w;
    }
    return b.wellId ? wells[b.wellId] : undefined;
  }

  private removeView(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.dispose();
    this.views.delete(id);
  }

  /** Full sync of views with state.buildings (cheap: per-view sync is change-driven). */
  reconcile(): void {
    const s = this.ctx.state;
    const c = s.company;
    if (c.color && c.color !== this.lib.company) {
      // company colour change → rebuild models with the new livery
      this.lib.setCompany(c.color, c.name);
      for (const v of this.views.values()) v.dispose();
      this.views.clear();
    } else this.lib.setCompany(this.lib.company, c.name || s.meta.companyName);
    this.rigWells.clear();
    for (const w of Object.values(s.wells)) if (w.rigId && RIG_BUSY.has(w.status)) this.rigWells.set(w.rigId, w);
    for (const [id, v] of this.views) if (!s.buildings[id] || s.buildings[id].type !== v.type) this.removeView(id);
    for (const b of Object.values(s.buildings)) this.syncBuilding(b);
    this.dirty.clear();
  }

  private syncBuilding(b: BuildingState): void {
    let v = this.views.get(b.id);
    if (!v) {
      v = new BuildingView(b.id, b.type, this.env, this.buildingsGroup);
      this.views.set(b.id, v);
    }
    try {
      v.sync(b);
    } catch (err) {
      console.error('[entities] failed to sync building', b.type, b.id, err);
    }
    // wellheads hide beneath the rig that drilled them while it still stands there
    if (b.type === 'wellhead') {
      const rigId = b.data?.underRig as string | undefined;
      const rig = rigId ? this.ctx.state.buildings[rigId] : undefined;
      v.setHidden(!!rig && rig.status !== 'destroyed');
    }
  }

  update(rawDt: number): void {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(0.25, Number.isFinite(rawDt) ? rawDt : 0));
    const s = this.ctx.state;
    const paused = s.time.paused;
    const sdt = paused ? 0 : dt;
    this.time += dt;
    this.simTime += sdt;
    this.reconcileTimer -= dt;
    if (this.reconcileTimer <= 0) {
      this.reconcileTimer = RECONCILE_INTERVAL;
      this.reconcile();
    } else if (this.dirty.size) {
      for (const id of this.dirty) {
        const b = s.buildings[id];
        if (b) this.syncBuilding(b);
      }
      this.dirty.clear();
    }
    this.lib.update(this.time, this.host.daylight);

    const cam = this.host.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const burning = new Set<string>();
    for (const f of s.hazards.fires) if (f.buildingId) burning.add(f.buildingId);
    const night = this.lib.night;
    for (const v of this.views.values()) {
      const b = s.buildings[v.id];
      if (!b) continue;
      v.update(sdt, this.simTime, b, cam, this.frustum);
      v.mem.hazardFire = burning.has(v.id) ? 1 : 0;
      this.fx.buildingFx(v, b, dt, night);
    }
    this.traffic.update(sdt, this.simTime);
    this.workers.update(sdt, this.simTime);
    this.weather.update(dt, this.time);
    this.fx.update(dt, this.time, this.views);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.traffic.dispose();
    this.workers.dispose();
    this.weather.dispose();
    this.fx.dispose();
    this.root.removeFromParent();
    if (this.host.buildingPreview) this.host.buildingPreview = null;
    this.lib.dispose();
  }
}
