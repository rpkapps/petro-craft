// The open sea beyond the streamed terrain: a water ring at sea level and a seabed ring below it, from the
// outer edge of the synthesised border terrain (VirtualTerrain) out to the horizon. Both use the regular
// terrain materials (same waves, reflections, lighting and fog), so the ocean continues seamlessly and the
// map never ends in a raw cross-section. Hidden in the x-ray view.
import * as THREE from 'three';
import { B } from '../../core/blocks';
import { SEA_LEVEL } from '../../core/constants';
import type { IWorld } from '../../core/types';
import { FACE_LAYER, LIQUID_TOP } from '../meshing/blockTables';
import type { TerrainMaterialSet } from '../materials/TerrainMaterials';
import { MARGIN, OUTER_FLOOR } from './VirtualTerrain';
import type { TerrainMode } from './ChunkMeshes';

/** How far the rings reach beyond the domain (blocks) — well past the camera far plane / fog. */
const REACH = 6000;
/** Sky light under ~16 blocks of water (matches the flood-filled light of the border seabed). */
const SEABED_SKY = 77;

function ring(x0: number, z0: number, x1: number, z1: number, y: number, layer: number, ao: number, sky: number): THREE.BufferGeometry {
  const X0 = x0 - REACH;
  const Z0 = z0 - REACH;
  const X1 = x1 + REACH;
  const Z1 = z1 + REACH;
  // 8 vertices: inner rectangle 0..3, outer rectangle 4..7 (both counter-clockwise seen from above)
  const xz = [x0, z0, x1, z0, x1, z1, x0, z1, X0, Z0, X1, Z0, X1, Z1, X0, Z1];
  const pos = new Float32Array(8 * 3);
  const uv = new Float32Array(8 * 2);
  const nrm = new Int8Array(8 * 4);
  const info = new Uint8Array(8 * 4);
  for (let i = 0; i < 8; i++) {
    pos[i * 3] = xz[i * 2];
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = xz[i * 2 + 1];
    // world-aligned texture coordinates (textures repeat once per block, like greedy terrain quads)
    uv[i * 2] = xz[i * 2];
    uv[i * 2 + 1] = -xz[i * 2 + 1];
    nrm[i * 4 + 1] = 127;
    info[i * 4] = layer;
    info[i * 4 + 1] = ao;
    info[i * 4 + 2] = sky;
  }
  // four trapezoids between the rectangles, wound to face +Y
  const idx = new Uint16Array([0, 5, 4, 0, 1, 5, 1, 6, 5, 1, 2, 6, 2, 7, 6, 2, 3, 7, 3, 4, 7, 3, 0, 4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 4, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4, false));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export class WorldBorder {
  readonly group = new THREE.Group();
  private water: THREE.Mesh;
  private seabed: THREE.Mesh;

  constructor(world: IWorld, mats: TerrainMaterialSet) {
    this.group.name = 'world-border';
    const x0 = -MARGIN;
    const z0 = -MARGIN;
    const x1 = world.sizeX + MARGIN;
    const z1 = world.sizeZ + MARGIN;
    const waterY = SEA_LEVEL + LIQUID_TOP[B.WATER];
    // depth code 255 = 15+ blocks of water (deep colour, no shore foam)
    this.water = new THREE.Mesh(ring(x0, z0, x1, z1, waterY, FACE_LAYER[B.WATER * 3], 255, 255), mats.translucent);
    this.water.name = 'outer-ocean';
    this.water.renderOrder = -1; // farthest transparent surface: draw before chunk water, particles & clouds
    this.seabed = new THREE.Mesh(ring(x0, z0, x1, z1, OUTER_FLOOR, FACE_LAYER[B.SEABED_SILT * 3], 255, SEABED_SKY), mats.opaque);
    this.seabed.name = 'outer-seabed';
    for (const m of [this.water, this.seabed]) {
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.userData.pass = m === this.water ? 'translucent' : 'opaque';
      this.group.add(m);
    }
  }

  setMode(mode: TerrainMode) {
    this.group.visible = mode !== 'xray';
  }

  dispose() {
    this.water.geometry.dispose();
    this.seabed.geometry.dispose();
    this.group.clear();
  }
}
