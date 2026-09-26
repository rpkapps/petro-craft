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
import { InstanceBatcher } from './instancing/InstanceBatcher';
import { EnvLighting } from './textures/EnvLighting';
import { createGhost } from './ghost';
import { MaterialLib } from './materials';
import { RIG_BUSY } from './models/rigSpecs';
import { registerAllModels } from './models';
import { clearTemplates } from './models/registry';
import { clearConstructionTemplates } from './status/construction';
import { clearRuinTemplates } from './status/ruin';
import { clearVehicleTemplates } from './vehicles/templates';
import { DropLayer } from './items/Drops';
import { AvatarLayer, clearAvatarTemplates } from './npc/Avatars';
import { WorkerCrowd } from './npc/Workers';
import { TrafficManager } from './vehicles/TrafficManager';
import { Terrain } from './vehicles/terrain';
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
  readonly batcher: InstanceBatcher;
  readonly avatars: AvatarLayer;
  readonly drops: DropLayer;
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
  readonly terrain: Terrain;
  readonly batcher: InstanceBatcher;
  readonly avatars: AvatarLayer;
  readonly drops: DropLayer;
  private readonly buildingsGroup = new THREE.Group();
  private readonly env: ViewEnv;
  private readonly offs: (() => void)[] = [];
  private readonly dirty = new Set<string>();
  private readonly rigWells = new Map<string, WellState>();
  private readonly frustum = new THREE.Frustum();
  private readonly burning = new Set<string>();
  private readonly projScreen = new THREE.Matrix4();
  private time = 0;
  private simTime = 0;
  private env3: EnvLighting | null = null;
  private builtFine = false;
  private reconcileTimer = RECONCILE_INTERVAL;
  private disposed = false;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext) {
    registerAllModels();
    this.root.name = 'entities';
    this.buildingsGroup.name = 'buildings';
    host.renderer.localClippingEnabled = true;
    const company = ctx.state.company;
    this.lib = new MaterialLib(company.color || '#ff8a1f', company.name || ctx.state.meta.companyName);
    this.batcher = new InstanceBatcher(this.lib);
    this.env = {
      lib: this.lib,
      ctx,
      shadows: ctx.settings.shadows !== false,
      wellFor: (b) => this.wellFor(b),
      batcher: this.batcher,
    };
    this.fx = new FxManager(host, ctx);
    this.weather = new WeatherFx(host, ctx, this.fx);
    this.terrain = new Terrain(ctx);
    this.traffic = new TrafficManager(host, ctx, this.lib, this.fx, this.terrain, this.views);
    this.workers = new WorkerCrowd(host, ctx, this.lib, this.terrain, this.views);
    this.avatars = new AvatarLayer(ctx, this.lib, this.terrain, host.camera, this.env.shadows);
    this.drops = new DropLayer(ctx, this.terrain, host.camera);
    this.root.add(this.buildingsGroup, this.batcher.group, this.fx.group, this.weather.group, this.traffic.group, this.workers.group, this.avatars.group, this.drops.group);
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
    this.updateQuality(dt);
    this.lib.update(this.time, this.host.daylight);

    const cam = this.host.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const burning = this.burning;
    burning.clear();
    for (const f of s.hazards.fires) if (f.buildingId) burning.add(f.buildingId);
    const night = this.lib.night;
    const fog = this.host.scene.fog;
    const cull = fog instanceof THREE.Fog ? fog.far + 12 : Infinity;
    for (const v of this.views.values()) {
      const b = s.buildings[v.id];
      if (!b) continue;
      v.update(sdt, this.simTime, b, cam, this.frustum, cull);
      v.mem.hazardFire = burning.has(v.id) ? 1 : 0;
      this.fx.buildingFx(v, b, dt, night);
    }
    this.batcher.flush();
    this.terrain.tick(dt);
    this.traffic.update(sdt, this.simTime);
    this.workers.update(sdt, this.simTime);
    this.avatars.update(dt);
    this.drops.update(dt);
    this.weather.update(dt, this.time);
    this.fx.update(dt, this.time, this.views);
  }

  /** Follow settings.textureQuality: re-configure materials, env map for ultra, finer templates. */
  private updateQuality(dt: number): void {
    const lib = this.lib;
    lib.setQuality(this.ctx.settings.textureQuality ?? 'classic');
    if (lib.fine !== this.builtFine) {
      // ultra adds template geometry (chamfers, bolt rings): rebuild the building views once
      this.builtFine = lib.fine;
      for (const v of this.views.values()) v.dispose();
      this.views.clear();
      this.reconcile();
    }
    if (lib.quality === 'ultra') {
      this.env3 ??= new EnvLighting(this.host.renderer);
      const w = this.ctx.state.weather;
      if (this.env3.update(dt, this.host.daylight, this.host.sunDirection, w?.cloudCover ?? 0)) lib.setEnvMap(this.env3.texture);
    } else if (this.env3) {
      lib.setEnvMap(null);
      this.env3.dispose();
      this.env3 = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.batcher.dispose();
    this.traffic.dispose();
    this.workers.dispose();
    this.avatars.dispose();
    this.drops.dispose();
    this.weather.dispose();
    this.fx.dispose();
    this.root.removeFromParent();
    if (this.host.buildingPreview) this.host.buildingPreview = null;
    this.env3?.dispose();
    this.env3 = null;
    this.lib.dispose();
    clearTemplates();
    clearConstructionTemplates();
    clearRuinTemplates();
    clearVehicleTemplates();
    clearAvatarTemplates();
  }
}
