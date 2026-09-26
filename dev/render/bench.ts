// Mesher/lighting micro-benchmark on real generated terrain (no browser):
//   node --experimental-strip-types --no-warnings --import ./dev/world/register.mjs dev/render/bench.ts [seed] [chunks]
import { createGeology, createWorld } from '../../src/world';
import { EventBus } from '../../src/core/EventBus';
import { CHUNK_SIZE } from '../../src/core/constants';
import { Mesher } from '../../src/render/meshing/mesher';
import { computeSkyLight } from '../../src/render/meshing/lighting';
import { LPAD, LW, type MeshJob } from '../../src/render/meshing/protocol';

declare const process: { argv: string[] };

const seed = Number(process.argv[2] ?? 424242);
const count = Number(process.argv[3] ?? 24);
const geology = createGeology(seed, 'small');
const world = createWorld(geology, new EventBus() as never);
const CS = CHUNK_SIZE;
const H = world.height;

function job(cx: number, cz: number, id: number): MeshJob {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, z = cz + dz;
    if (x >= 0 && z >= 0 && x < world.chunksX && z < world.chunksZ) world.ensureChunk(x, z);
  }
  const blocks = new Uint8Array(LW * LW * H);
  for (let lz = 0; lz < LW; lz++) for (let lx = 0; lx < LW; lx++) {
    const wx = cx * CS + lx - LPAD, wz = cz * CS + lz - LPAD;
    if (wx < 0 || wz < 0 || wx >= world.sizeX || wz >= world.sizeZ) continue;
    const data = world.getChunkData(Math.floor(wx / CS), Math.floor(wz / CS))!;
    const tx = wx % CS, tz = wz % CS;
    for (let y = 0; y < H; y++) blocks[lx + lz * LW + y * LW * LW] = data[tx + tz * CS + y * CS * CS];
  }
  return { type: 'mesh', id, cx, cz, height: H, blocks, emitters: new Int16Array(0), skipPlants: false, outside: 0 };
}

const jobs: MeshJob[] = [];
const c0 = Math.floor(world.chunksX / 2) - 2;
for (let i = 0; i < count; i++) jobs.push(job(c0 + (i % 5), c0 + Math.floor(i / 5), i));
const m = new Mesher();
// warm-up
for (const j of jobs.slice(0, 3)) m.mesh(j);
let tSky = 0;
for (const j of jobs) { const t = performance.now(); computeSkyLight(j.blocks, H); tSky += performance.now() - t; }
let tMesh = 0;
const tris = { opaque: 0, cutout: 0, translucent: 0 };
for (const j of jobs) {
  const t = performance.now();
  const r = m.mesh(j);
  tMesh += performance.now() - t;
  for (const p of ['opaque', 'cutout', 'translucent'] as const) tris[p] += (r[p]?.indices.length ?? 0) / 3;
}
console.log(`chunks ${jobs.length}: sky light ${(tSky / jobs.length).toFixed(2)} ms/chunk, full mesh ${(tMesh / jobs.length).toFixed(2)} ms/chunk`);
console.log('triangles', tris);
