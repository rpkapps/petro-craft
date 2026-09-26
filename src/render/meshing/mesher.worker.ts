// Mesher worker entry: receives padded chunk volumes, returns vertex streams (transferred, zero-copy).
import { Mesher } from './mesher';
import type { WorkerRequest, WorkerResponse, PassData, MeshResult } from './protocol';

const mesher = new Mesher();
const scope = self as unknown as DedicatedWorkerGlobalScope;

function transferables(r: MeshResult): Transferable[] {
  const out: Transferable[] = [];
  const add = (p: PassData | null) => {
    if (!p) return;
    out.push(p.positions.buffer, p.normals.buffer, p.uvs.buffer, p.info.buffer, p.indices.buffer);
  };
  add(r.opaque);
  add(r.cutout);
  add(r.translucent);
  if (r.quadCenters) out.push(r.quadCenters.buffer);
  out.push(r.opaqueRanges.buffer, r.cutoutRanges.buffer, r.sectionMinY.buffer, r.sectionMaxY.buffer, r.vis.buffer, r.hashes.buffer);
  return out;
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const job = e.data;
  try {
    const result = mesher.mesh(job);
    scope.postMessage(result satisfies WorkerResponse, transferables(result));
  } catch (err) {
    const msg: WorkerResponse = { type: 'error', id: job.id, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) };
    scope.postMessage(msg);
  }
};
