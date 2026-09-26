// Headless checks for the world module: timings, determinism, geology/voxel consistency, edits round-trip.
//   node --experimental-strip-types --import ./dev/world/register.mjs dev/world/test.ts [seed] [size]
import { EventBus } from '../../src/core/EventBus';
import { B, BLOCKS } from '../../src/core/blocks';
import { createGeology, createWorld, findSpawn, Geology, generateChunkData } from '../../src/world';

declare const process: { argv: string[] };

const seed = Number(process.argv[2] ?? 12345);
const size = (process.argv[3] ?? 'medium') as 'small' | 'medium' | 'large';

const t0 = performance.now();
const geo = new Geology(seed, size);
const t1 = performance.now();
console.log(`geology ${size} seed=${seed}: ${(t1 - t0).toFixed(0)} ms`, JSON.stringify(geo.timings, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
console.log(`reservoirs=${geo.reservoirs.length} faults=${geo.faults.length} aquifers=${geo.aquifers.length} diapirs=${geo.diapirs.length} traps=${geo.traps.length}`);
for (const r of geo.reservoirs) {
  console.log(
    `${r.id} ${r.name.padEnd(34)} ${r.trap.padEnd(13)} ${r.fluid.padEnd(10)} ${r.lithology.padEnd(9)} off=${r.offshore ? 'Y' : 'n'} c=${r.compartment} ` +
      `y=${r.bottomY}-${r.topY} owc=${r.owcY} goc=${r.gocY ?? '-'} rx=${r.radiusX} rz=${r.radiusZ} phi=${r.porosity} k=${r.permeability} P=${r.initialPressure} T=${r.temperature} ` +
      `OOIP=${(r.oilInPlace / 1e6).toFixed(1)}MMbbl GIIP=${(r.gasInPlace / 1e6).toFixed(0)}Bcf H2S=${r.h2s}`,
  );
}
for (const a of geo.aquifers) console.log(`${a.id} fresh=${a.fresh} sal=${a.salinity} y=${a.bottomY}-${a.topY} c=(${a.center.x},${a.center.z}) r=${a.radiusX}x${a.radiusZ}`);
for (const f of geo.faults) console.log(`${f.id} throw=${f.throw} dip=${f.dip} sealing=${f.sealing} p0=(${f.p0.x},${f.p0.z}) p1=(${f.p1.x},${f.p1.z})`);

// determinism
const geo2 = createGeology(seed, size) as Geology;
const same = JSON.stringify(geo.reservoirs) === JSON.stringify(geo2.reservoirs);
console.log('deterministic reservoirs:', same);

// chunk timing
const bus = new EventBus();
const world = createWorld(geo, bus);
const n = geo.sizeX / 16;
const t2 = performance.now();
let count = 0;
const cc = n >> 1;
for (let dz = -8; dz < 8; dz++) for (let dx = -8; dx < 8; dx++) {
  world.ensureChunk(cc + dx, cc + dz);
  count++;
}
const t3 = performance.now();
console.log(`chunks: ${count} in ${(t3 - t2).toFixed(0)} ms → ${((t3 - t2) / count).toFixed(2)} ms/chunk`);

// consistency: every hydrocarbon block matches reservoirAt, and vice versa, in generated chunks
let hcBlocks = 0;
let mismatch = 0;
const check = (cx: number, cz: number) => {
  world.ensureChunk(cx, cz);
  const d = world.getChunkData(cx, cz)!;
  for (let y = 0; y < 160; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const id = d[lx + lz * 16 + y * 256];
    const x = cx * 16 + lx;
    const z = cz * 16 + lz;
    const isHc = BLOCKS[id].hydrocarbon !== undefined;
    const r = geo.reservoirAt(x, y, z);
    if (isHc) hcBlocks++;
    if (isHc !== (r !== null)) {
      if (mismatch < 5) console.log('MISMATCH', x, y, z, BLOCKS[id].key, r?.id);
      mismatch++;
    }
  }
};
for (const r of geo.reservoirs.slice(0, 8)) check(Math.floor(r.center.x / 16), Math.floor(r.center.z / 16));
console.log(`consistency: hcBlocks=${hcBlocks} mismatches=${mismatch}`);

// worker path identical
const a = world.getChunkData(cc, cc)!;
const b = generateChunkData(seed, size, cc, cc);
let diff = 0;
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
console.log('pure generator identical:', diff === 0, diff);

// query timing
const t4 = performance.now();
let s = 0;
for (let i = 0; i < 40000; i++) {
  const x = 100 + (i % 200);
  const y = 5 + ((i * 7) % 70);
  const p = geo.properties(x, y, 256);
  s += p.impedance + geo.porePressure(x, y, 256);
}
const t5 = performance.now();
console.log(`40k properties+porePressure: ${(t5 - t4).toFixed(0)} ms`, s > 0);

// edits round-trip
let events = 0;
bus.on('world:blockChanged', () => events++);
world.setBlock(cc * 16 + 3, 70, cc * 16 + 4, B.CONCRETE, 'player');
world.setBlock(3, 40, 3, B.CASING, 'system');
const save = world.serializeEdits();
const w2 = createWorld(geo, new EventBus());
w2.loadEdits(save);
let edits = 0;
w2.forEachEdit(() => edits++);
console.log('edits serialized chunks:', Object.keys(save.chunks).length, 'reloaded (pending) edits:', edits, 'block after gen:', w2.getBlock(3, 40, 3) === B.CASING, 'events:', events);

const sp = findSpawn(geo);
console.log('spawn', sp, 'block below', BLOCKS[world.getBlock(sp.x, sp.y - 1, sp.z)].key, 'at', BLOCKS[world.getBlock(sp.x, sp.y, sp.z)].key, 'surfaceY', world.getSurfaceY(sp.x, sp.z));
