// Game event → sound mapping. Subscribed in attach(), unsubscribed in detach().
import type { EventBus } from '../core/EventBus';
import type { GameContext, Vec3 } from '../core/types';
import { clamp } from './dsp';
import { breakSound, footstepSound, hitSound, materialOf, placeSound } from './materials';
import type { PlayOptions } from './voices';

/** What the event layer needs from the engine. */
export interface SoundActions {
  readonly game: GameContext | null;
  play(name: string, o?: PlayOptions): boolean;
  playAt(name: string, at: Vec3, o?: PlayOptions): boolean;
  uiSound(name: string, volume?: number): void;
  sting(name: string, volume?: number, duckDb?: number): void;
  explosion(at: Vec3, power: number): void;
  thunder(x: number, z: number, loud?: number): void;
  extinguisher(at: Vec3): void;
  duck(db: number, hold: number): void;
  firePosition(id: string): Vec3 | undefined;
  /** Seconds (audio clock) — for throttling. */
  now(): number;
  /** Generic named sound (aliases, special sounds). */
  playNamed(name: string, at?: Vec3, volume?: number): boolean;
}

export function wireEvents(bus: EventBus, a: SoundActions): () => void {
  const offs: (() => void)[] = [];
  const last = new Map<string, number>();
  /** True if `key` hasn't fired within `sec` seconds (and records it). */
  const gate = (key: string, sec: number) => {
    const t = a.now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < sec) return false;
    last.set(key, t);
    return true;
  };
  let lastMajor = -Infinity;
  const major = () => (lastMajor = a.now());
  const sinceMajor = () => a.now() - lastMajor;
  let lastFootMat = 0;

  const buildingPos = (id: string): Vec3 | undefined => {
    const b = a.game?.state.buildings[id];
    if (!b) return undefined;
    return { x: b.x + b.size[0] / 2, y: b.y + 1, z: b.z + b.size[1] / 2 };
  };
  const wellPos = (id: string): Vec3 | undefined => {
    const w = a.game?.state.wells[id];
    return w ? { x: w.x + 0.5, y: w.surfaceY + 1, z: w.z + 0.5 } : undefined;
  };
  const blockCenter = (p: { x: number; y: number; z: number }) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });

  // ---- player foley ------------------------------------------------------------------------------
  offs.push(bus.on('player:footstep', (e) => {
    lastFootMat = e.block;
    a.play(footstepSound(e.block), { volume: 0.55, pitchVar: 0.7, pan: (Math.random() - 0.5) * 0.2, maxVoices: 3, priority: 0 });
  }));
  offs.push(bus.on('player:jump', () => {
    a.play('jump', { volume: 0.5, pitchVar: 0.8, maxVoices: 1 });
  }));
  offs.push(bus.on('player:land', (e) => {
    const s = Math.abs(e.speed || 0);
    const v = clamp((s - 3) / 12, 0.12, 1);
    a.play('land', { volume: v, rate: 1.1 - 0.25 * v, pitchVar: 0.4, maxVoices: 2 });
    if (lastFootMat) a.play(footstepSound(lastFootMat), { volume: 0.4 + 0.3 * v, pitchVar: 0.5, maxVoices: 3, priority: 0 });
  }));
  offs.push(bus.on('player:blockBroken', (e) => {
    a.playAt(breakSound(e.id), blockCenter(e), { volume: 0.85, ref: 4, maxVoices: 4, reverb: 0.08 });
  }));
  offs.push(bus.on('player:blockPlaced', (e) => {
    a.playAt(placeSound(e.id), blockCenter(e), { volume: 0.8, ref: 4, maxVoices: 4, reverb: 0.06 });
  }));
  offs.push(bus.on('player:damage', (e) => {
    if (!gate('damage', 0.18)) return;
    const v = clamp((e.amount || 0) / 20, 0.45, 1);
    a.play('damage', { volume: v, pitchVar: 0.6, maxVoices: 2, priority: 2 });
  }));
  offs.push(bus.on('player:death', () => {
    a.sting('sting_death', 0.9, -10);
  }));
  offs.push(bus.on('player:respawn', () => {
    a.sting('sting_respawn', 0.7, -4);
  }));
  offs.push(bus.on('player:toolUse', (e) => {
    const tool = (e.tool || '').replace(/^tool:/, '');
    const at = blockCenter(e);
    switch (tool) {
      case 'extinguisher':
        a.extinguisher(at);
        break;
      case 'wrench':
        if (gate('wrench', 0.32)) a.playAt('wrench', at, { volume: 0.8, ref: 4, reverb: 0.1 });
        break;
      case 'scanner':
        if (gate('scanner', 1.0)) a.play('scanner_sweep', { volume: 0.7 });
        break;
      case 'detector':
        if (gate('detector', 0.25)) a.play('detector_beep', { volume: 0.6 });
        break;
      case 'pickaxe':
      case 'shovel':
      case 'axe': {
        if (!gate('hit', 0.2)) break;
        const block = a.game?.world.inBounds(e.x, e.y, e.z) ? a.game.world.getBlock(e.x, e.y, e.z) : 0;
        if (block) a.playAt(hitSound(block), at, { volume: 0.45, rate: 1.15, ref: 4, maxVoices: 3 });
        else a.play('swing', { volume: 0.5, pitchVar: 1 });
        break;
      }
      case 'tablet':
        if (gate('tablet', 0.2)) a.uiSound('click', 0.7);
        break;
      default:
        break;
    }
  }));
  offs.push(bus.on('player:scan', (e) => {
    const tool = (e.tool || '').replace(/^tool:/, '');
    if (tool === 'detector') {
      const name = e.level === 'danger' ? 'detector_danger' : e.level === 'warning' ? 'detector_warn' : 'detector_beep';
      if (gate('scan-detector', e.level === 'danger' ? 0.12 : 0.2)) a.play(name, { volume: 0.7, maxVoices: 2 });
    } else if (gate('scan-scanner', 0.15)) {
      a.play('scanner_blip', { volume: e.level === 'danger' ? 0.8 : 0.6, rate: e.level === 'warning' ? 1.12 : e.level === 'danger' ? 1.26 : 1, maxVoices: 2 });
    }
  }));

  // ---- buildings ---------------------------------------------------------------------------------
  offs.push(bus.on('building:placed', (e) => {
    const p = buildingPos(e.id);
    if (p) a.playAt('construct', p, { volume: 0.9, ref: 8, maxDist: 220, reverb: 0.25 });
    else a.play('construct', { volume: 0.7 });
  }));
  offs.push(bus.on('building:completed', (e) => {
    const b = a.game?.state.buildings[e.id];
    if (b?.type === 'wellhead') return; // auto-spawned; well completion is covered elsewhere
    if (!gate('completed', 1.5)) return;
    major();
    a.sting('sting_complete', 0.75, -6);
  }));
  offs.push(bus.on('building:removed', (e) => {
    a.playAt('demolish', { x: e.x + 1, y: e.y + 1, z: e.z + 1 }, { volume: 0.9, ref: 8, maxDist: 220, reverb: 0.3 });
  }));
  offs.push(bus.on('building:statusChanged', (e) => {
    if (e.status !== 'broken' || e.prev === 'broken') return;
    const p = buildingPos(e.id);
    if (p) a.playAt('breakdown', p, { volume: 0.9, ref: 8, maxDist: 200, reverb: 0.2 });
  }));

  // ---- economy & progress ------------------------------------------------------------------------
  offs.push(bus.on('money:changed', (e) => {
    if (!(e.amount >= 25_000) || e.category === 'loan') return;
    if (!gate('cash', 3)) return;
    const v = clamp(0.35 + Math.log10(e.amount / 25_000) * 0.2, 0.35, 0.8);
    a.uiSound('cash', v);
  }));
  offs.push(bus.on('notify', (n) => {
    // a major sting/alarm already covers the moment
    if (sinceMajor() < 1.5) return;
    const name = n.level === 'success' ? 'success' : n.level === 'warning' ? 'warn' : n.level === 'danger' ? 'danger' : 'notify';
    if (!gate(`notify-${n.level}`, 0.6)) return;
    a.uiSound(name, n.level === 'info' ? 0.7 : 0.85);
  }));
  offs.push(bus.on('research:completed', () => {
    if (!gate('research', 1)) return;
    major();
    a.sting('sting_research', 0.75, -6);
  }));
  offs.push(bus.on('contract:completed', () => {
    major();
    a.sting('sting_contract', 0.75, -6);
    a.uiSound('cash', 0.55);
  }));
  offs.push(bus.on('contract:failed', () => {
    major();
    a.sting('sting_fail', 0.7, -5);
  }));
  offs.push(bus.on('objective:completed', () => {
    if (sinceMajor() < 1) return;
    major();
    a.sting('sting_relief', 0.65, -4);
  }));
  offs.push(bus.on('lease:acquired', () => {
    a.uiSound('stamp', 0.8);
  }));
  offs.push(bus.on('survey:completed', () => {
    a.play('sonar', { volume: 0.6, reverb: 0.3, reverbKind: 'hall' });
  }));
  offs.push(bus.on('game:saved', () => {
    if (gate('saved', 2)) a.uiSound('saved', 0.8);
  }));

  // ---- wells -------------------------------------------------------------------------------------
  offs.push(bus.on('well:spud', (e) => {
    const p = wellPos(e.id);
    if (p) a.playAt('spud', p, { volume: 0.9, ref: 8, maxDist: 220, reverb: 0.2 });
  }));
  offs.push(bus.on('well:discovery', (e) => {
    major();
    a.sting('sting_discovery', 0.85, -9);
    const p = wellPos(e.id);
    if (p) a.playAt('blowout_roar', p, { volume: 0.35, ref: 10, maxDist: 250, rate: 1.3, reverb: 0.3 });
  }));
  offs.push(bus.on('well:dryHole', () => {
    major();
    a.sting('sting_dry', 0.75, -5);
  }));
  offs.push(bus.on('well:kick', (e) => {
    major();
    a.play('kick_alarm', { volume: 0.75, priority: 3, maxVoices: 1 });
    a.duck(-6, 2);
    const p = wellPos(e.id);
    if (p) a.playAt('hiss', p, { volume: 0.8, ref: 6, maxDist: 200, reverb: 0.2 });
  }));
  offs.push(bus.on('well:blowout', (e) => {
    major();
    const p = wellPos(e.id);
    if (p) a.playAt('blowout_roar', p, { volume: 1, ref: 20, maxDist: 600, reverb: 0.5, priority: 3 });
    a.play('alarm', { volume: 0.75, priority: 3, maxVoices: 2 });
    a.play('alarm', { volume: 0.6, delay: 1.45, priority: 3, maxVoices: 2 });
    a.duck(-10, 4);
  }));
  offs.push(bus.on('well:blowoutControlled', () => {
    major();
    a.sting('sting_relief', 0.8, -5);
  }));

  // ---- hazards & weather -------------------------------------------------------------------------
  offs.push(bus.on('hazard:fireStarted', (e) => {
    a.playAt('fire_ignite', blockCenter(e), { volume: 0.95, ref: 8, maxDist: 250, reverb: 0.3 });
  }));
  offs.push(bus.on('hazard:fireOut', (e) => {
    const p = a.firePosition(e.id);
    if (p) a.playAt('fire_out', p, { volume: 0.8, ref: 6, maxDist: 150, reverb: 0.2 });
  }));
  offs.push(bus.on('hazard:explosion', (e) => {
    a.explosion(blockCenter(e), e.power);
  }));
  offs.push(bus.on('hazard:spill', (e) => {
    a.playAt('spill', blockCenter(e), { volume: 0.8, ref: 5, maxDist: 140 });
  }));
  offs.push(bus.on('network:leak', (e) => {
    a.playAt('leak_hiss', blockCenter(e), { volume: 0.8, ref: 5, maxDist: 150, reverb: 0.15 });
  }));
  offs.push(bus.on('weather:lightning', (e) => {
    a.thunder(e.x, e.z);
  }));

  // ---- UI ---------------------------------------------------------------------------------------
  offs.push(bus.on('ui:error', () => a.uiSound('error')));
  offs.push(bus.on('ui:click', () => a.uiSound('click')));
  offs.push(bus.on('ui:hover', () => a.uiSound('hover')));
  offs.push(bus.on('ui:open', (e) => {
    if (e.panel !== 'mainMenu' && e.panel !== 'notifications') a.uiSound('open', 0.8);
  }));
  offs.push(bus.on('ui:close', () => a.uiSound('close', 0.8)));

  // ---- generic -----------------------------------------------------------------------------------
  offs.push(bus.on('audio:play', (e) => {
    if (typeof e?.sound !== 'string') return;
    a.playNamed(e.sound, e.at, e.volume);
  }));

  return () => {
    for (const off of offs) off();
    offs.length = 0;
  };
}

/** Material helper re-exported for other modules that want consistent naming. */
export { materialOf };
