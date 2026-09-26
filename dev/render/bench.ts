// Mesher/lighting micro-benchmark on real generated terrain (no browser):
//   node --experimental-transform-types --no-warnings --import ./dev/world/register.mjs dev/render/bench.ts [seed] [chunks]
import { createGeology, createWorld } from '../../src/world/index.ts';
import { EventBus } from '../../src/core/EventBus.ts';
import { CHUNK_SIZE } from '../../src/core/constants.ts';
import { Mesher } from '../../src/render/meshing/mesher.ts';
import { computeSkyLight } from '../../src/render/meshing/lighting.ts';
import { LPAD, LW, type MeshJob } from '../../src/render/meshing/protocol.ts';

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
  return { type: 'mesh', id, cx, cz, height: H, blocks, emitters: new Int16Array(0), skipPlants: false };
}

const jobs: MeshJob[] = [];
const c0 = Math.floor(world.chunksX / 2) - 2;
for (let i = 0; i < count; i++) jobs.push(job(c0 + (i % 5), c0 + Math.floor(i / 5), i));
const m = new Mesher();
// warm-up
for (const j of jobs.slice(0, 3)) m.mesh(j);
let tSky = 0;
for (const j of jobs) { const t = performance.now(); computeSkyLight(j.blocks, H); tSky += performance.now() - t; }
let tMesh = 0, tris = { opaque: 0, cutout: 0, plants: 0, translucent: 0 }, sections = 0, nonEmpty = 0;
for (const j of jobs) {
  const t = performance.now();
  const r = m.mesh(j);
  tMesh += performance.now() - t;
  for (const s of r.sections) {
    sections++;
    let any = false;
    for (const p of ['opaque', 'cutout', 'plants', 'translucent'] as const) {
      const d = s[p];
      if (d) { tris[p] += d.indices.length / 3; any = true; }
    }
    if (any) nonEmpty++;
  }
}
console.log(`chunks ${jobs.length}: sky ${(tSky / jobs.length).toFixed(2)} ms/chunk, full mesh ${(tMesh / jobs.length).toFixed(2)} ms/chunk`);
console.log('triangles', tris, `sections ${sections} (non-empty ${nonEmpty})`);
