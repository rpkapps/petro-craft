// Typed synchronous event bus. Events are *notifications* (fire-and-forget) used to decouple
// sim → render/audio/UI. Never mutate GameState in response to an event on a non-authority client.
import type { Notification, Vec3 } from './types';

export interface GameEvents {
  // lifecycle
  'game:started': { isNew: boolean };
  'game:saved': { slot: string };
  'game:loaded': { slot: string };
  'game:disposed': {};
  'game:paused': { paused: boolean };
  // time
  'time:newDay': { day: number };
  'time:newHour': { day: number; hour: number };
  // world
  'world:blockChanged': { x: number; y: number; z: number; prev: number; id: number; source: 'player' | 'system' | 'load' };
  'world:chunkGenerated': { cx: number; cz: number };
  // buildings
  'building:placed': { id: string };
  'building:completed': { id: string };
  'building:removed': { id: string; type: string; x: number; y: number; z: number };
  'building:statusChanged': { id: string; prev: string; status: string };
  // wells
  'well:created': { id: string };
  'well:spud': { id: string };
  'well:progress': { id: string; depth: number };
  'well:discovery': { id: string; reservoirId: string; fluid: string };
  'well:dryHole': { id: string };
  'well:kick': { id: string };
  'well:blowout': { id: string };
  'well:blowoutControlled': { id: string };
  'well:completed': { id: string };
  'well:statusChanged': { id: string; prev: string; status: string };
  // exploration
  'survey:started': { id: string };
  'survey:completed': { id: string };
  // networks
  'network:rebuilt': {};
  'network:leak': { networkId: string; x: number; y: number; z: number };
  // economy
  'money:changed': { amount: number; balance: number; category: string };
  'market:event': { id: string; title: string };
  'contract:offered': { id: string };
  'contract:completed': { id: string };
  'contract:failed': { id: string };
  'research:completed': { techId: string };
  'research:started': { techId: string };
  'lease:acquired': { key: string };
  'objective:completed': { id: string };
  'achievement:unlocked': { id: string; title: string };
  // hazards & weather
  'hazard:fireStarted': { id: string; x: number; y: number; z: number };
  'hazard:fireOut': { id: string };
  'hazard:explosion': { x: number; y: number; z: number; power: number };
  'hazard:spill': { x: number; y: number; z: number; volume: number };
  'weather:lightning': { x: number; z: number };
  'weather:changed': { kind: string };
  // player / interaction (client-side)
  'player:blockBroken': { x: number; y: number; z: number; id: number };
  'player:blockPlaced': { x: number; y: number; z: number; id: number };
  'player:footstep': { x: number; y: number; z: number; block: number };
  'player:jump': {};
  'player:land': { speed: number };
  'player:damage': { amount: number };
  'player:toolUse': { tool: string; x: number; y: number; z: number };
  /** Geo-scanner / gas-detector readout for the HUD. */
  'player:scan': { tool: string; at: Vec3; lines: string[]; level?: 'info' | 'warning' | 'danger' };
  /** What the crosshair (or drone cursor) is pointing at — for HUD tooltips. Emitted on change. */
  'player:target': { kind: 'none' | 'block' | 'building' | 'well'; id?: string; pos?: Vec3; block?: number };
  /** Player died / respawned. */
  'player:death': { cause: string };
  'player:respawn': {};
  // ui (client-side)
  'ui:open': { panel: UiPanelId; args?: Record<string, unknown> };
  'ui:close': { panel?: UiPanelId };
  'ui:select': { kind: 'building' | 'well' | 'block' | 'none'; id?: string; pos?: Vec3 };
  'ui:buildMode': { type: string | null; rotation?: number };
  'ui:pipeMode': { block: number | null };
  'ui:focus': { at: Vec3 };
  'ui:click': {};
  'ui:hover': {};
  'ui:error': { text: string };
  'ui:overlay': { overlay: MapOverlay | null };
  // notifications
  notify: Notification;
  // audio
  'audio:play': { sound: string; at?: Vec3; volume?: number };
}

export type UiPanelId =
  | 'mainMenu' | 'pause' | 'settings' | 'saveLoad' | 'build' | 'inventory' | 'research' | 'market'
  | 'contracts' | 'workforce' | 'finance' | 'map' | 'wells' | 'wellPlanner' | 'seismic' | 'inspector'
  | 'objectives' | 'help' | 'environment' | 'leases' | 'notifications';

export type MapOverlay = 'none' | 'xray' | 'reservoirs' | 'pipes' | 'leases' | 'pressure';

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  once<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
