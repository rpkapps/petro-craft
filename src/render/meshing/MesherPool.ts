// A small pool of mesher workers with per-worker in-flight limits.
import type { MeshJob, MeshResult, WorkerResponse } from './protocol';

export class MesherPool {
  private workers: Worker[] = [];
  private inflight: number[] = [];
  private jobWorker = new Map<number, number>();
  private readonly maxPerWorker = 2;
  private disposed = false;

  constructor(size: number, private onResult: (r: MeshResult) => void, private onError: (id: number, msg: string) => void) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module', name: `petrocraft-mesher-${i}` });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(i, e.data);
      w.onerror = (e) => {
        console.error('[render] mesher worker error', e.message);
      };
      this.workers.push(w);
      this.inflight.push(0);
    }
  }

  get size() {
    return this.workers.length;
  }

  /** Number of jobs that can be submitted right now. */
  get capacity(): number {
    let c = 0;
    for (const n of this.inflight) c += Math.max(0, this.maxPerWorker - n);
    return c;
  }

  get busy(): number {
    return this.inflight.reduce((a, b) => a + b, 0);
  }

  submit(job: MeshJob): boolean {
    if (this.disposed) return false;
    let best = -1;
    for (let i = 0; i < this.workers.length; i++) {
      if (this.inflight[i] >= this.maxPerWorker) continue;
      if (best < 0 || this.inflight[i] < this.inflight[best]) best = i;
    }
    if (best < 0) return false;
    this.inflight[best]++;
    this.jobWorker.set(job.id, best);
    this.workers[best].postMessage(job, [job.blocks.buffer, job.emitters.buffer]);
    return true;
  }

  private handle(worker: number, msg: WorkerResponse) {
    if (this.disposed) return;
    this.inflight[worker] = Math.max(0, this.inflight[worker] - 1);
    this.jobWorker.delete(msg.id);
    if (msg.type === 'error') this.onError(msg.id, msg.message);
    else this.onResult(msg);
  }

  dispose() {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.inflight = [];
    this.jobWorker.clear();
  }
}
