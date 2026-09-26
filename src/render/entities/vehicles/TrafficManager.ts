// Life on the map: tanker trucks, trains, tanker ships, helicopters and vibroseis convoys.
// Owns the lazily-built navigation grids (land for trucks, water for ships), keeps them in sync with
// world edits / building changes, and pumps their incremental path searches with a per-frame budget.
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import type { FxManager } from '../fx/FxManager';
import type { MaterialLib } from '../materials';
import { HeliTraffic } from './Helicopters';
import { LandNav, WaterNav } from './nav';
import { ShipTraffic } from './Ships';
import type { Terrain } from './terrain';
import { TrainTraffic } from './Trains';
import { TruckTraffic } from './Trucks';
import type { VehicleEnv } from './Vehicle';
import { VibroseisTraffic } from './Vibroseis';

/** A* node expansions per frame across all queued searches. */
const LAND_BUDGET = 9000;
const WATER_BUDGET = 6000;

export class TrafficManager {
  readonly group = new THREE.Group();
  private readonly trucks: TruckTraffic;
  private readonly trains: TrainTraffic;
  private readonly ships: ShipTraffic;
  private readonly helis: HeliTraffic;
  private readonly vibro: VibroseisTraffic;
  private land: LandNav | null = null;
  private water: WaterNav | null = null;
  private structVersion = 1;
  private readonly offs: (() => void)[] = [];

  constructor(host: RenderHost, private readonly ctx: GameContext, lib: MaterialLib, fx: FxManager, readonly terrain: Terrain, private readonly views: Map<string, BuildingView>) {
    this.group.name = 'traffic';
    const env: VehicleEnv = {
      ctx,
      lib,
      fx,
      terrain,
      group: this.group,
      camera: host.camera,
      nav: { land: () => this.landNav(), water: () => this.waterNav() },
      structVersion: () => this.structVersion,
    };
    this.trucks = new TruckTraffic(env);
    this.trains = new TrainTraffic(env);
    this.ships = new ShipTraffic(env);
    this.helis = new HeliTraffic(env);
    this.vibro = new VibroseisTraffic(env);
    const structural = () => {
      this.structVersion++;
      this.land?.markBuildingsDirty();
      this.water?.markBuildingsDirty();
    };
    this.offs.push(
      ctx.bus.on('building:placed', structural),
      ctx.bus.on('building:removed', structural),
      ctx.bus.on('game:loaded', () => {
        // edits were replaced wholesale: rebuild grids from scratch on next use
        this.land = null;
        this.water = null;
        this.structVersion++;
      }),
      ctx.bus.on('world:blockChanged', (e) => {
        if (e.source === 'load') return;
        this.land?.onBlockChanged(e.x, e.z, e.prev, e.id);
      }),
      ctx.bus.on('world:chunkGenerated', (e) => this.land?.invalidateChunk(e.cx, e.cz)),
    );
  }

  /** Land navigation grid (created on first use). */
  landNav(): LandNav {
    return (this.land ??= new LandNav(this.ctx, this.terrain));
  }

  /** Water navigation grid (created on first use). */
  waterNav(): WaterNav {
    return (this.water ??= new WaterNav(this.ctx, this.terrain));
  }

  update(dt: number, _t: number): void {
    this.land?.pump(LAND_BUDGET);
    this.water?.pump(WATER_BUDGET);
    this.trucks.update(dt, this.views);
    this.trains.update(dt, this.views);
    this.ships.update(dt, this.views);
    this.helis.update(dt, this.views);
    this.vibro.update(dt);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.trucks.dispose();
    this.trains.dispose();
    this.ships.dispose();
    this.helis.dispose();
    this.vibro.dispose();
    this.group.removeFromParent();
  }
}
