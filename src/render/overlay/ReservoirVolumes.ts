// Discovered reservoirs as glowing translucent voxel volumes. The reservoir shape is sampled from
// IGeology.reservoirAt on a coarse grid (time-sliced, cached per reservoir), then meshed into boundary
// faces coloured by fluid zone (gas cap / oil / condensate / water leg) — contacts show as planes.
import * as THREE from 'three';
import type { GameContext, Reservoir, ReservoirState } from '../../core/types';
import { createHoloMaterial, createLabel, disposeLabel } from './holo';
import { METERS_PER_BLOCK, FEET_PER_METER } from '../../core/constants';

const ZONE_COLORS = {
  gas: new THREE.Color(0xff3d9a),
  oil: new THREE.Color(0xffa424),
  condensate: new THREE.Color(0xffe03a),
  water: new THREE.Color(0x2f8cff),
};
const ZONE_LIST = [ZONE_COLORS.gas, ZONE_COLORS.oil, ZONE_COLORS.condensate, ZONE_COLORS.water];
const Z_GAS = 0;
const Z_OIL = 1;
const Z_COND = 2;
const Z_WATER = 3;

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE: { o: number[]; u: number[]; v: number[] }[] = [
  { o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0] },
  { o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1] },
  { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
];

function heatColor(t: number, out: THREE.Color) {
  // depleted (blue) → mid (amber) → virgin pressure (red/white)
  const c0 = new THREE.Color(0x2a5cff);
  const c1 = new THREE.Color(0xffb020);
  const c2 = new THREE.Color(0xff3030);
  if (t < 0.5) return out.copy(c0).lerp(c1, t * 2);
  return out.copy(c1).lerp(c2, (t - 0.5) * 2);
}

class Volume {
  readonly group = new THREE.Group();
  private mask: Uint8Array;
  private cursor = 0;
  sampled = false;
  private mesh: THREE.Mesh | null = null;
  private label: THREE.Sprite | null = null;
  private material: THREE.ShaderMaterial;
  private builtKey = '';
  private readonly step: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  voxels = 0;

  constructor(readonly res: Reservoir, shared: { uTime: { value: number }; uXray: { value: number } }) {
    const maxR = Math.max(res.radiusX, res.radiusZ);
    this.step = Math.max(1, Math.ceil((maxR * 2) / 44));
    const s = this.step;
    this.x0 = Math.floor(res.center.x - res.radiusX - s);
    this.z0 = Math.floor(res.center.z - res.radiusZ - s);
    this.y0 = Math.floor(Math.min(res.bottomY, res.topY)) - 1;
    this.nx = Math.ceil((res.radiusX * 2 + s * 2) / s) + 1;
    this.nz = Math.ceil((res.radiusZ * 2 + s * 2) / s) + 1;
    this.ny = Math.ceil(Math.abs(res.topY - res.bottomY)) + 3;
    this.mask = new Uint8Array(this.nx * this.ny * this.nz);
    this.material = createHoloMaterial(shared, { vertexColors: true, fill: 0.14, rim: 0.75, grid: 0.35, gridScale: new THREE.Vector3(s, 1, s), scan: 0.08 });
    this.group.name = `reservoir-${res.id}`;
  }

  /** Sample until the deadline. Returns true when complete. */
  sample(ctx: GameContext, deadline: number): boolean {
    if (this.sampled) return true;
    const total = this.mask.length;
    const { nx, ny, step: s } = this;
    while (this.cursor < total) {
      const i = this.cursor++;
      const ix = i % nx;
      const iy = Math.floor(i / nx) % ny;
      const iz = Math.floor(i / (nx * ny));
      const x = this.x0 + ix * s + Math.floor(s / 2);
      const y = this.y0 + iy;
      const z = this.z0 + iz * s + Math.floor(s / 2);
      let inside = false;
      try {
        inside = ctx.geology.reservoirAt(x, y, z)?.id === this.res.id;
      } catch {
        inside = false;
      }
      if (inside) {
        this.mask[i] = 1;
        this.voxels++;
      }
      if ((i & 63) === 0 && performance.now() > deadline) return false;
    }
    this.sampled = true;
    return true;
  }

  private zoneAt(y: number, st: ReservoirState | undefined): number {
    const r = this.res;
    const owc = Math.max(r.owcY, st?.waterFrontY ?? -1e9);
    if (y < owc) return Z_WATER;
    if (r.fluid === 'gas') return Z_GAS;
    if (r.gasCap && r.gocY !== undefined && y >= r.gocY) return Z_GAS;
    return r.fluid === 'condensate' ? Z_COND : Z_OIL;
  }

  update(ctx: GameContext, mode: 'fluid' | 'pressure', units: 'imperial' | 'metric') {
    if (!this.sampled) return;
    const st = ctx.state.reservoirs[this.res.id];
    const knowledge = Math.max(st?.knowledge ?? 0, st?.discovered ? 0.35 : 0);
    const pr = st && this.res.initialPressure > 0 ? Math.max(0, Math.min(1, st.pressure / this.res.initialPressure)) : 1;
    const wf = Math.round(st?.waterFrontY ?? -999);
    const key = `${mode}|${wf}|${mode === 'pressure' ? Math.round(pr * 20) : 0}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      this.build(st, mode, pr);
      this.makeLabel(ctx, st, units);
    }
    this.material.uniforms.uOpacity.value = 0.35 + 0.65 * Math.min(1, knowledge);
  }

  private build(st: ReservoirState | undefined, mode: 'fluid' | 'pressure', pressureRatio: number) {
    const { nx, ny, nz, step: s } = this;
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const inside = (ix: number, iy: number, iz: number) =>
      ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && this.mask[ix + iy * nx + iz * nx * ny] === 1;
    const c = new THREE.Color();
    const pColor = heatColor(pressureRatio, new THREE.Color());
    for (let iz = 0; iz < nz; iz++)
      for (let iy = 0; iy < ny; iy++)
        for (let ix = 0; ix < nx; ix++) {
          if (!inside(ix, iy, iz)) continue;
          const y = this.y0 + iy;
          const zone = this.zoneAt(y, st);
          for (let d = 0; d < 6; d++) {
            const [dx, dy, dz] = DIRS[d];
            const nIn = inside(ix + dx, iy + dy, iz + dz);
            let contact = false;
            if (nIn) {
              // internal fluid contact: draw once (upward face of the lower zone)
              if (d !== 2) continue;
              const zUp = this.zoneAt(y + 1, st);
              if (zUp === zone) continue;
              contact = true;
            }
            if (mode === 'pressure') c.copy(pColor);
            else c.copy(ZONE_LIST[zone]);
            if (mode === 'fluid' && zone !== Z_WATER) c.multiplyScalar(0.55 + 0.45 * pressureRatio);
            if (contact) c.multiplyScalar(1.8);
            const f = FACE[d];
            const base = pos.length / 3;
            const ox = this.x0 + ix * s;
            const oz = this.z0 + iz * s;
            for (let k = 0; k < 4; k++) {
              const su = k === 1 || k === 2 ? 1 : 0;
              const sv = k === 2 || k === 3 ? 1 : 0;
              pos.push(
                ox + (f.o[0] + f.u[0] * su + f.v[0] * sv) * s,
                y + f.o[1] + f.u[1] * su + f.v[1] * sv,
                oz + (f.o[2] + f.u[2] * su + f.v[2] * sv) * s,
              );
              nrm.push(dx, dy, dz);
              col.push(c.r, c.g, c.b);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 20;
    this.group.add(this.mesh);
  }

  private makeLabel(ctx: GameContext, st: ReservoirState | undefined, units: 'imperial' | 'metric') {
    if (this.label) {
      this.group.remove(this.label);
      disposeLabel(this.label);
    }
    const r = this.res;
    let surface = 64;
    try {
      surface = ctx.geology.surfaceHeight(r.center.x, r.center.z);
    } catch {
      /* geology unavailable */
    }
    const depthM = Math.max(0, (surface - r.topY) * METERS_PER_BLOCK);
    const depth = units === 'imperial' ? `${Math.round(depthM * FEET_PER_METER).toLocaleString()} ft` : `${Math.round(depthM).toLocaleString()} m`;
    const fluid = r.fluid === 'oil' ? 'Oil' : r.fluid === 'gas' ? 'Gas' : 'Condensate';
    const vol = r.fluid === 'gas' ? `${((st?.remainingGas ?? r.gasInPlace) / 1e6).toFixed(1)} Bcf` : `${((st?.remainingOil ?? r.oilInPlace) / 1e6).toFixed(1)} MMbbl`;
    const accent = r.fluid === 'oil' ? '#ffa424' : r.fluid === 'gas' ? '#ff3d9a' : '#ffe03a';
    this.label = createLabel([r.name, `${fluid} · ${depth} · ${vol}`], accent);
    this.label.position.set(r.center.x, Math.max(r.topY, r.bottomY) + 2.5, r.center.z);
    this.group.add(this.label);
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    if (this.label) disposeLabel(this.label);
    this.material.dispose();
  }
}

export class ReservoirVolumes {
  readonly group = new THREE.Group();
  private volumes = new Map<string, Volume>();
  private queue: Volume[] = [];

  constructor(private ctx: GameContext, private shared: { uTime: { value: number }; uXray: { value: number } }) {
    this.group.name = 'xray-reservoirs';
  }

  update(mode: 'fluid' | 'pressure', units: 'imperial' | 'metric', budgetMs: number) {
    const ctx = this.ctx;
    let list: Reservoir[] = [];
    try {
      list = ctx.geology.reservoirs;
    } catch {
      return;
    }
    for (const r of list) {
      const st = ctx.state.reservoirs[r.id];
      const known = !!st && (st.discovered || st.knowledge > 0);
      let v = this.volumes.get(r.id);
      if (known && !v) {
        v = new Volume(r, this.shared);
        this.volumes.set(r.id, v);
        this.group.add(v.group);
        this.queue.push(v);
      }
      if (v) v.group.visible = known;
    }
    const deadline = performance.now() + budgetMs;
    while (this.queue.length && performance.now() < deadline) {
      if (this.queue[0].sample(ctx, deadline)) this.queue.shift();
    }
    for (const v of this.volumes.values()) if (v.group.visible) v.update(ctx, mode, units);
  }

  dispose() {
    for (const v of this.volumes.values()) v.dispose();
    this.volumes.clear();
  }
}
