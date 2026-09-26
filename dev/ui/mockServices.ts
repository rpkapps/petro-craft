// Mock services, world and recipes for the UI dev harness.
import type { GameState, IGeology, IWorld, SeismicImage, Services, SurveyState, Vec2, Vec3, WellPlan } from '../../src/core/types';
import { B } from '../../src/core/blocks';
import { rotatedSize } from '../../src/core/buildingUtil';
import { SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/constants';
import { trajectory } from './mockState';

// ---- seismic synthetic ---------------------------------------------------------------------------
function ricker(t: number) {
  const a = Math.PI * Math.PI * t * t;
  return (1 - 2 * a) * Math.exp(-a);
}
function amplitudeAt(geo: IGeology, x: number, y: number, z: number, q: number): number {
  // Horizons follow the same structure the geology uses (uplift over reservoirs + fault throw).
  let u = 0;
  for (const r of geo.reservoirs) {
    const dx = (x - r.center.x) / (r.radiusX * 1.4);
    const dz = (z - r.center.z) / (r.radiusZ * 1.4);
    u += 5 * Math.exp(-(dx * dx + dz * dz) * 2);
  }
  for (const f of geo.faults) {
    const side = (f.p1.x - f.p0.x) * (z - f.p0.z) - (f.p1.z - f.p0.z) * (x - f.p0.x);
    if (side * f.dipSign > 0) u -= f.throw;
  }
  const yy = y - u;
  let a = 0;
  for (let k = 0; k < 18; k++) {
    const hy = 6 + k * 5 + Math.sin(k * 1.7) * 1.2;
    const refl = (k % 2 ? 1 : -0.8) * (0.35 + 0.65 * Math.abs(Math.sin(k * 2.3)));
    a += refl * ricker((yy - hy) / 1.6);
  }
  const res = geo.reservoirAt(Math.floor(x), Math.floor(y), Math.floor(z));
  if (res) a += (res.fluid === 'gas' ? -1.4 : -0.6) * (0.6 + 0.4 * Math.sin(y * 2));
  a += (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453 % 1) * 0.25 / q;
  return Math.max(-1, Math.min(1, a * 0.6));
}

export function createMockServices(getState: () => GameState, geo: IGeology): Services {
  const section = (s: SurveyState, opts?: { inline?: number; crossline?: number; resolution?: number }): SeismicImage => {
    let p0: Vec2 = { x: s.x0, z: s.z0 };
    let p1: Vec2 = { x: s.x1, z: s.z1 };
    if (s.kind === '3d') {
      if (opts?.crossline !== undefined) {
        const x = Math.min(s.x0, s.x1) + opts.crossline;
        p0 = { x, z: Math.min(s.z0, s.z1) };
        p1 = { x, z: Math.max(s.z0, s.z1) };
      } else {
        const z = Math.min(s.z0, s.z1) + (opts?.inline ?? Math.floor(Math.abs(s.z1 - s.z0) / 2));
        p0 = { x: Math.min(s.x0, s.x1), z };
        p1 = { x: Math.max(s.x0, s.x1), z };
      }
    }
    const len = Math.max(2, Math.round(Math.hypot(p1.x - p0.x, p1.z - p0.z)));
    const res = opts?.resolution ?? 2;
    const width = Math.round(len * res * (s.kind === '2d' ? s.progress : 1)) || 1;
    const topY = SEA_LEVEL + 8;
    const bottomY = 4;
    const height = Math.round((topY - bottomY) * res);
    const data = new Float32Array(width * height);
    const fluid = s.fluidIndicators ? new Uint8Array(width * height) : undefined;
    const columns: Vec2[] = [];
    for (let c = 0; c < width; c++) {
      const t = c / Math.max(1, len * res - 1);
      const x = p0.x + (p1.x - p0.x) * t;
      const z = p0.z + (p1.z - p0.z) * t;
      columns.push({ x, z });
      const surf = geo.surfaceHeight(Math.floor(x), Math.floor(z));
      for (let r = 0; r < height; r++) {
        const y = topY - r / res;
        const i = r * width + c;
        if (y > surf) { data[i] = 0; continue; }
        data[i] = amplitudeAt(geo, x, y, z, s.quality);
        if (fluid) {
          const rr = geo.reservoirAt(Math.floor(x), Math.floor(y), Math.floor(z));
          fluid[i] = rr ? (rr.fluid === 'gas' ? 3 : 2) : 0;
        }
      }
    }
    return { width, height, data, fluid, topY, bottomY, columns };
  };
  return {
    seismic: {
      getSection: section,
      getDepthSlice(s, y) {
        const w = Math.abs(s.x1 - s.x0);
        const hh = Math.abs(s.z1 - s.z0);
        const data = new Float32Array(w * hh);
        const fluid = new Uint8Array(w * hh);
        for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
          const x = Math.min(s.x0, s.x1) + i;
          const z = Math.min(s.z0, s.z1) + j;
          data[j * w + i] = amplitudeAt(geo, x, y, z, s.quality);
          const rr = geo.reservoirAt(x, y, z);
          fluid[j * w + i] = rr ? (rr.fluid === 'gas' ? 3 : 2) : 0;
        }
        return { width: w, height: hh, data, fluid: s.fluidIndicators ? fluid : undefined, topY: y, bottomY: y, columns: [] };
      },
      quote(kind, x0, z0, x1, z1) {
        if (kind === '2d') {
          const len = Math.hypot(x1 - x0, z1 - z0);
          return { cost: Math.round(len * 1800), days: Math.max(1, Math.round(len / 25)) };
        }
        const area = Math.abs(x1 - x0) * Math.abs(z1 - z0);
        return { cost: Math.round(area * 260), days: Math.max(2, Math.round(area / 900)) };
      },
    },
    wells: {
      quote(x, z, plan, rigType) {
        const surf = geo.surfaceHeight(x, z);
        const tvd = surf - plan.targetY;
        const md = tvd + (plan.lateralLength ?? 0) + (plan.offset ?? 0) * 0.4;
        const warnings: string[] = [];
        if (plan.mudWeight < 9.2) warnings.push('Mud weight below pore pressure in the Eagle Sand — high kick risk');
        if (plan.mudWeight > 14.5) warnings.push('Mud weight exceeds fracture gradient near surface casing shoe — lost circulation likely');
        if (!plan.casingPoints.some((c) => c < surf - 8)) warnings.push('No surface casing below the fresh-water aquifer (y 62)');
        if (plan.kind === 'horizontal' && rigType === 'drilling_rig_land') warnings.push('Long laterals are slow with a land rig');
        return { cost: Math.round(md * 42_000 * (rigType.includes('heavy') ? 1.3 : 1)), days: Math.max(2, Math.round(md / 5)), warnings };
      },
      suggestPlan(x, z, targetY, kind) {
        const surf = geo.surfaceHeight(x, z);
        return { kind, targetY, kickoffY: kind === 'vertical' ? undefined : targetY + 12, azimuth: 0, offset: kind === 'directional' ? 16 : undefined, lateralLength: kind === 'horizontal' ? 28 : undefined, casingPoints: [surf - 10, Math.round((surf + targetY) / 2), targetY], mudWeight: 10.4 };
      },
      pressureProfile(x, z) {
        const surf = geo.surfaceHeight(x, z);
        const out: { y: number; pore: number; frac: number }[] = [];
        for (let y = surf; y >= 4; y -= 1) {
          const over = y < 40 ? (40 - y) * 0.11 : 0;
          const d = surf - y;
          out.push({ y, pore: 8.6 + over + Math.sin(y * 0.4) * 0.08, frac: 12.2 + d * 0.045 + over * 0.8 });
        }
        return out;
      },
      planTrajectory(x, y, z, plan: WellPlan): Vec3[] {
        return trajectory(x, y, z, plan);
      },
    },
    construction: {
      validate: (type, _x, _z, rotation) => ({ ok: true, y: 68, cost: 0, reason: rotatedSize(type, rotation).join('×') }),
      buildingAt: () => undefined,
      footprint: (type, rotation) => rotatedSize(type, rotation),
    },
    networks: { networkAt: () => undefined, rebuild: () => {} },
    economy: {
      netWorth: () => {
        const st = getState();
        return st.company.money + Object.keys(st.buildings).length * 850_000 + Object.keys(st.wells).length * 1_500_000 - st.company.loans.reduce((a, l) => a + l.balance, 0);
      },
      leaseKey: (x, z) => `${Math.floor(x / 32)},${Math.floor(z / 32)}`,
      leaseQuote(px, pz) {
        const cx = px * 32 + 16;
        const cz = pz * 32 + 16;
        let prospect = 0;
        for (const r of geo.reservoirs) prospect = Math.max(prospect, Math.exp(-(((cx - r.center.x) / (r.radiusX * 1.6)) ** 2 + ((cz - r.center.z) / (r.radiusZ * 1.6)) ** 2)));
        return { price: Math.round(60_000 + prospect * 700_000), royalty: 0.125 + prospect * 0.06, prospectivity: prospect };
      },
    },
  };
}

// ---- world ------------------------------------------------------------------------------------------
export function createMockWorld(geo: IGeology, st: GameState): IWorld {
  const edits = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const line = (id: number, a: [number, number], b: [number, number]) => {
    let [x, z] = a;
    while (x !== b[0]) { edits.set(key(x, geo.surfaceHeight(x, z), z), id); x += Math.sign(b[0] - x); }
    while (z !== b[1]) { edits.set(key(x, geo.surfaceHeight(x, z), z), id); z += Math.sign(b[1] - z); }
  };
  const bs = Object.values(st.buildings);
  const tank = bs.find((b) => b.type === 'oil_tank_small')!;
  const truck = bs.find((b) => b.type === 'truck_terminal')!;
  for (const b of bs.filter((x) => x.type === 'wellhead')) line(B.PIPE_OIL, [b.x + 1, b.z + 3], [tank.x, tank.z + 2]);
  line(B.PIPE_OIL, [tank.x + 2, tank.z], [truck.x + 2, truck.z + 4]);
  const plant = bs.find((b) => b.type === 'gas_plant')!;
  const meter = bs.find((b) => b.type === 'gas_sales_meter')!;
  for (const b of bs.filter((x) => x.type === 'wellhead').slice(0, 3)) line(B.PIPE_GAS, [b.x + 3, b.z + 1], [plant.x, plant.z + 3]);
  line(B.PIPE_GAS, [plant.x + 4, plant.z], [meter.x + 1, meter.z + 2]);
  const pit = bs.find((b) => b.type === 'water_pit')!;
  for (const b of bs.filter((x) => x.type === 'wellhead').slice(0, 4)) line(B.PIPE_WATER, [b.x, b.z + 1], [pit.x + 2, pit.z]);
  line(B.PIPE_PRODUCT, [plant.x + 8, plant.z + 4], [plant.x + 30, plant.z + 20]);
  line(B.ASPHALT_ROAD, [170, 210], [300, 210]);
  const sizeX = geo.sizeX;
  const sizeZ = geo.sizeZ;
  return {
    sizeX, sizeZ, height: WORLD_HEIGHT, seed: geo.seed, geology: geo, chunksX: sizeX / 16, chunksZ: sizeZ / 16,
    getBlock: (x, y, z) => edits.get(key(x, y, z)) ?? (y < geo.surfaceHeight(x, z) ? B.STONE : 0),
    setBlock: (x, y, z, id) => { edits.set(key(x, y, z), id); return true; },
    inBounds: (x, y, z) => x >= 0 && z >= 0 && x < sizeX && z < sizeZ && y >= 0 && y < WORLD_HEIGHT,
    isSolid: (x, y, z) => y < geo.surfaceHeight(x, z),
    getSurfaceY: (x, z) => geo.surfaceHeight(x, z),
    ensureChunk: () => {},
    isChunkGenerated: () => true,
    getChunkData: () => undefined,
    forEachEdit(fn) {
      for (const [k, id] of edits) {
        const [x, y, z] = k.split(',').map(Number);
        fn(x, y, z, id);
      }
    },
    serializeEdits: () => ({ chunks: {} }),
    loadEdits: () => {},
  };
}
