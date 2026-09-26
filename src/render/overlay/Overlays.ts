// Map/subsurface overlay orchestration: x-ray (ghost terrain + reservoirs + wells + geo cues),
// 'reservoirs' / 'pressure' variants, and the cheap shader-only 'pipes' and 'leases' overlays.
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { MapOverlay } from '../../core/EventBus';
import { PARCEL_SIZE } from '../../core/constants';
import type { SharedUniforms } from '../materials/uniforms';
import { ReservoirVolumes } from './ReservoirVolumes';
import { WellPaths } from './WellPaths';
import { GeoFeatures } from './GeoFeatures';
import type { TerrainMode } from '../chunks/ChunkMeshes';

const XRAY_LIKE = new Set<MapOverlay>(['xray', 'reservoirs', 'pressure']);

export class Overlays {
  readonly group = new THREE.Group();
  private reservoirs: ReservoirVolumes;
  private wells: WellPaths;
  private geo: GeoFeatures;
  private leaseTex: THREE.DataTexture;
  private leaseData: Uint8Array;
  private leaseTimer = 0;
  private parcelsX: number;
  private parcelsZ: number;
  private fade = 0;

  constructor(private ctx: GameContext, private shared: SharedUniforms) {
    this.group.name = 'overlays';
    this.reservoirs = new ReservoirVolumes(ctx, shared);
    this.wells = new WellPaths(ctx, shared);
    this.geo = new GeoFeatures(ctx, shared);
    this.group.add(this.geo.group, this.reservoirs.group, this.wells.group);
    this.group.visible = false;
    this.parcelsX = Math.max(1, Math.ceil(ctx.world.sizeX / PARCEL_SIZE));
    this.parcelsZ = Math.max(1, Math.ceil(ctx.world.sizeZ / PARCEL_SIZE));
    this.leaseData = new Uint8Array(this.parcelsX * this.parcelsZ * 4);
    this.leaseTex = new THREE.DataTexture(this.leaseData, this.parcelsX, this.parcelsZ, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.leaseTex.magFilter = this.leaseTex.minFilter = THREE.NearestFilter;
    this.leaseTex.colorSpace = THREE.SRGBColorSpace;
    this.leaseTex.needsUpdate = true;
    shared.uLeaseMap.value = this.leaseTex;
    shared.uLeaseInfo.value.set(PARCEL_SIZE, this.parcelsX, this.parcelsZ, 0);
  }

  /** Returns the terrain mode the chunk meshes should use. */
  update(dt: number, camera: THREE.Camera, overlay: MapOverlay | null, units: 'imperial' | 'metric'): TerrainMode {
    const xray = !!overlay && XRAY_LIKE.has(overlay);
    this.fade = THREE.MathUtils.clamp(this.fade + (xray ? dt * 2.2 : -dt * 4), 0, 1);
    this.shared.uXray.value = this.fade * this.fade * (3 - 2 * this.fade);
    this.shared.uOverlay.value = overlay === 'pipes' ? 1 : overlay === 'leases' ? 2 : 0;
    this.group.visible = this.fade > 0.001;
    if (overlay === 'leases') {
      this.leaseTimer -= dt;
      if (this.leaseTimer <= 0) {
        this.leaseTimer = 1;
        this.refreshLeases();
      }
    }
    if (this.group.visible) {
      this.reservoirs.update(overlay === 'pressure' ? 'pressure' : 'fluid', units, xray ? 4 : 1);
      this.wells.update(this.shared.uTime.value);
      this.geo.update(camera, units);
    }
    return xray ? 'xray' : 'normal';
  }

  private refreshLeases() {
    const d = this.leaseData;
    d.fill(0);
    const own = new THREE.Color(this.ctx.state.company.color || '#ff8a1f');
    const other = new THREE.Color(0x7a7f8a);
    for (const l of Object.values(this.ctx.state.leases)) {
      if (l.px < 0 || l.pz < 0 || l.px >= this.parcelsX || l.pz >= this.parcelsZ) continue;
      const c = l.owner === this.ctx.localPlayerId || l.owner === 'company' || l.owner === this.ctx.state.company.name ? own : other;
      const i = (l.px + l.pz * this.parcelsX) * 4;
      const srgb = c.clone().convertLinearToSRGB();
      d[i] = Math.round(srgb.r * 255);
      d[i + 1] = Math.round(srgb.g * 255);
      d[i + 2] = Math.round(srgb.b * 255);
      d[i + 3] = 255;
    }
    this.leaseTex.needsUpdate = true;
  }

  dispose() {
    this.reservoirs.dispose();
    this.wells.dispose();
    this.geo.dispose();
    this.leaseTex.dispose();
  }
}
