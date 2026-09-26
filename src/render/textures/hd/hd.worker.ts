// HD texture worker: paints the requested layers and streams them back one by one (transferred).
import { paintHDLayer } from './painters';

export interface HDJob {
  type: 'paint';
  id: number;
  size: number;
  layers: { index: number; key: string; palette: number[]; seed: number }[];
}
export type HDReply =
  | { type: 'layer'; id: number; index: number; albedo: Uint8Array; material: Uint8Array }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<HDJob>) => {
  const job = e.data;
  try {
    for (const l of job.layers) {
      const p = paintHDLayer(l.key, l.palette, job.size, l.seed);
      const msg: HDReply = { type: 'layer', id: job.id, index: l.index, albedo: p.albedo, material: p.material };
      scope.postMessage(msg, [p.albedo.buffer, p.material.buffer]);
    }
    scope.postMessage({ type: 'done', id: job.id } satisfies HDReply);
  } catch (err) {
    scope.postMessage({ type: 'error', id: job.id, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) } satisfies HDReply);
  }
};
