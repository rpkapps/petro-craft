// Life on the map: tanker trucks, trains, tanker ships, helicopters and vibroseis convoys.
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { GameContext } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import type { FxManager } from '../fx/FxManager';
import type { MaterialLib } from '../materials';
import { HeliTraffic } from './Helicopters';
import { ShipTraffic } from './Ships';
import { Terrain } from './terrain';
import { TrainTraffic } from './Trains';
import { TruckTraffic } from './Trucks';
import type { VehicleEnv } from './Vehicle';
import { VibroseisTraffic } from './Vibroseis';

export class TrafficManager {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  private readonly trucks: TruckTraffic;
  private readonly trains: TrainTraffic;
  private readonly ships: ShipTraffic;
  private readonly helis: HeliTraffic;
  private readonly vibro: VibroseisTraffic;

  constructor(host: RenderHost, ctx: GameContext, lib: MaterialLib, fx: FxManager, private readonly views: Map<string, BuildingView>) {
    this.group.name = 'traffic';
    this.terrain = new Terrain(ctx);
    const env: VehicleEnv = { ctx, lib, fx, terrain: this.terrain, group: this.group, camera: host.camera };
    this.trucks = new TruckTraffic(env);
    this.trains = new TrainTraffic(env);
    this.ships = new ShipTraffic(env);
    this.helis = new HeliTraffic(env);
    this.vibro = new VibroseisTraffic(env);
  }

  update(dt: number, _t: number): void {
    this.terrain.tick(dt);
    this.trucks.update(dt, this.views);
    this.trains.update(dt, this.views);
    this.ships.update(dt, this.views);
    this.helis.update(dt, this.views);
    this.vibro.update(dt);
  }

  dispose(): void {
    this.trucks.dispose();
    this.trains.dispose();
    this.ships.dispose();
    this.helis.dispose();
    this.vibro.dispose();
    this.group.removeFromParent();
  }
}
