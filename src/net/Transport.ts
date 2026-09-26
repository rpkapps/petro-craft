// Networking abstraction for future multiplayer.
//
// Model: authoritative host. The host runs GameSession with isAuthority = true and applies
// commands from all players (each tagged with playerId). Clients run GameSession with
// isAuthority = false: CommandBus.forward sends their commands to the host, and they apply
// state snapshots/patches received from the host. World block edits are replicated as
// 'world:blockChanged' events. Because every mutation is a serializable Command and all
// randomness goes through ctx.rng(), a lockstep mode is also possible.
import type { Command, CommandResult } from '../core/commands';
import type { GameState } from '../core/types';

export type NetMessage =
  | { t: 'hello'; playerId: string; name: string; version: number }
  | { t: 'welcome'; playerId: string; snapshot: GameState; worldEdits: unknown }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'cmdResult'; seq: number; result: CommandResult }
  | { t: 'patch'; tick: number; patch: StatePatch }
  | { t: 'block'; x: number; y: number; z: number; id: number }
  | { t: 'chat'; from: string; text: string }
  | { t: 'bye'; playerId: string };

/** Shallow keyed patch: top-level GameState slices that changed since the last patch. */
export type StatePatch = Partial<GameState>;

export interface Transport {
  readonly connected: boolean;
  send(msg: NetMessage): void;
  onMessage(fn: (msg: NetMessage) => void): () => void;
  close(): void;
}

/** In-process loopback transport (single player / tests). Two ends connected to each other. */
export class LocalTransport implements Transport {
  connected = true;
  peer: LocalTransport | null = null;
  private listeners = new Set<(m: NetMessage) => void>();
  static pair(): [LocalTransport, LocalTransport] {
    const a = new LocalTransport();
    const b = new LocalTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }
  send(msg: NetMessage) {
    const p = this.peer;
    if (!p) return;
    const copy = structuredClone(msg);
    queueMicrotask(() => p.listeners.forEach((fn) => fn(copy)));
  }
  onMessage(fn: (m: NetMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  close() {
    this.connected = false;
    this.listeners.clear();
  }
}

/** WebSocket transport (client side). A matching Node host can reuse GameSession headlessly. */
export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private listeners = new Set<(m: NetMessage) => void>();
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as NetMessage;
        this.listeners.forEach((fn) => fn(msg));
      } catch (err) {
        console.warn('[net] bad message', err);
      }
    };
  }
  get connected() {
    return this.ws.readyState === WebSocket.OPEN;
  }
  send(msg: NetMessage) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }
  onMessage(fn: (m: NetMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  close() {
    this.ws.close();
    this.listeners.clear();
  }
}
