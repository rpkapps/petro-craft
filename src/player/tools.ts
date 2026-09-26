// Hand-held tools: wrench (hold to repair), extinguisher (hold to spray fires), geo scanner (column readout),
// gas detector (continuous hazard readout + beeps) and field tablet (long-range selection).
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { INTERACT } from './config';
import { compass, senseHazards } from './hazards';
import { pointSegmentDistance } from './raycast';
import { scanColumn } from './scanner';
import type { Actions, PlayerRuntime, Target } from './runtime';
import { toolOf } from './blockUtil';

export type ToolClass = 'pickaxe' | 'shovel' | 'axe' | 'wrench' | 'extinguisher' | 'scanner' | 'detector' | 'tablet';

export interface ToolFeedback {
  /** Whether the tool consumed the secondary action (no block placement / selection fallback). */
  handled: boolean;
  /** Hold progress 0..1 (wrench) for the highlight. */
  progress: number;
}

const aim = new THREE.Vector3();

export class Tools {
  private wrench: { id: string; t: number; swing: number } | null = null;
  private sprayT = 0;
  private sprayBackoff = 0;
  private scanCooldown = 0;
  private detectT = 0;
  private beepT = 0;
  private lastDetectorKey = '';

  constructor(private readonly rt: PlayerRuntime) {}

  static classOf(item: string | null): ToolClass | null {
    return (toolOf(item)?.toolClass as ToolClass | undefined) ?? null;
  }

  /** Range for the pick ray given the held tool. */
  static range(item: string | null): number {
    const c = Tools.classOf(item);
    if (c === 'tablet') return INTERACT.tabletReach;
    if (c === 'extinguisher') return INTERACT.extinguisherRange;
    if (c === 'scanner') return INTERACT.reach * 2;
    return INTERACT.reach;
  }

  reset(): void {
    this.wrench = null;
    this.sprayT = 0;
  }

  /** Secondary (RMB) behaviour for the held tool. */
  secondary(dt: number, act: Actions, target: Target): ToolFeedback {
    const rt = this.rt;
    const cls = Tools.classOf(rt.selectedItem());
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    this.sprayBackoff = Math.max(0, this.sprayBackoff - dt);
    if (cls !== 'wrench') this.wrench = null;
    switch (cls) {
      case 'wrench':
        return this.useWrench(dt, act, target);
      case 'extinguisher':
        if (act.secondaryHeld) this.spray(dt, target);
        else this.sprayT = 0;
        return { handled: true, progress: 0 };
      case 'scanner':
        if (act.secondaryPressed) this.scan(target);
        return { handled: true, progress: 0 };
      case 'tablet':
        if (act.secondaryPressed) {
          if (target.building) {
            const kind = target.kind === 'well' ? 'well' : 'building';
            rt.ctx.bus.emit('ui:select', { kind, id: target.id });
            rt.ctx.bus.emit('audio:play', { sound: 'tablet_beep' });
            rt.swing();
          } else if (target.hit) rt.ctx.bus.emit('ui:select', { kind: 'block', pos: { x: target.hit.x, y: target.hit.y, z: target.hit.z } });
        }
        return { handled: true, progress: 0 };
      case 'detector':
        // RMB on a building falls through to selection; elsewhere the detector does nothing on click.
        return { handled: !target.building, progress: 0 };
      default:
        return { handled: false, progress: 0 };
    }
  }

  private useWrench(dt: number, act: Actions, target: Target): ToolFeedback {
    const rt = this.rt;
    const b = target.building;
    if (!act.secondaryHeld || !b) {
      this.wrench = null;
      return { handled: true, progress: 0 };
    }
    if (!this.wrench || this.wrench.id !== b.id) this.wrench = { id: b.id, t: 0, swing: 0 };
    const w = this.wrench;
    w.t += dt;
    w.swing -= dt;
    if (w.swing <= 0) {
      w.swing = 0.38;
      rt.swing();
      if (target.hit) rt.ctx.bus.emit('player:toolUse', { tool: 'wrench', ...target.hit.point });
      rt.ctx.bus.emit('audio:play', { sound: 'wrench', at: target.hit?.point });
    }
    if (w.t >= INTERACT.wrenchHold) {
      w.t = 0;
      const res = rt.dispatch({ type: 'building/repair', buildingId: b.id, manual: true });
      if (res.ok) rt.ctx.bus.emit('audio:play', { sound: 'repair_done', at: target.hit?.point });
    }
    return { handled: true, progress: Math.min(1, w.t / INTERACT.wrenchHold) };
  }

  private spray(dt: number, target: Target): void {
    const rt = this.rt;
    this.sprayT -= dt;
    if (this.sprayT > 0) return;
    this.sprayT = INTERACT.extinguisherInterval;
    const eye = rt.rayOrigin;
    if (target.hit) aim.set(target.hit.point.x, target.hit.point.y, target.hit.point.z);
    else aim.copy(rt.rayDir).multiplyScalar(INTERACT.extinguisherRange).add(eye);
    rt.ctx.bus.emit('player:toolUse', { tool: 'extinguisher', x: aim.x, y: aim.y, z: aim.z });
    if (Math.random() < 0.35) rt.swing();
    if (this.sprayBackoff > 0 || !rt.ctx.commands.has('building/extinguish')) return;
    const st = rt.ctx.state;
    const a: Vec3 = { x: aim.x, y: aim.y, z: aim.z };
    const e: Vec3 = { x: eye.x, y: eye.y, z: eye.z };
    let hitAny = false;
    for (const f of st.hazards.fires) {
      let p: Vec3 = { x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 };
      let extra = 0;
      if (f.buildingId && st.buildings[f.buildingId]) {
        const b = st.buildings[f.buildingId];
        // Closest point of the building box to the aim point.
        p = {
          x: Math.max(b.x, Math.min(a.x, b.x + b.size[0])),
          y: Math.max(b.y, Math.min(a.y, b.y + b.size[2])),
          z: Math.max(b.z, Math.min(a.z, b.z + b.size[1])),
        };
        extra = 0.5;
      }
      const d = Math.min(pointSegmentDistance(p, e, a), Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z));
      if (d > INTERACT.extinguisherRadius + extra) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) > INTERACT.extinguisherRange + INTERACT.extinguisherRadius) continue;
      hitAny = true;
      const res = rt.dispatch({ type: 'building/extinguish', fireId: f.id, buildingId: f.buildingId, amount: INTERACT.extinguisherAmount });
      if (!res.ok) {
        this.sprayBackoff = 1;
        return;
      }
    }
    if (!hitAny && target.building && target.building.status === 'fire') {
      const res = rt.dispatch({ type: 'building/extinguish', buildingId: target.building.id, amount: INTERACT.extinguisherAmount });
      if (!res.ok) this.sprayBackoff = 1;
    }
  }

  private scan(target: Target): void {
    const rt = this.rt;
    if (this.scanCooldown > 0) return;
    this.scanCooldown = INTERACT.scannerCooldown;
    const w = rt.ctx.world;
    const x = target.hit ? target.hit.x : Math.floor(rt.body.x);
    const z = target.hit ? target.hit.z : Math.floor(rt.body.z);
    if (!w.inBounds(x, 1, z)) return;
    const surface = w.getSurfaceY(x, z);
    const res = scanColumn(rt.ctx.state, rt.ctx.geology, x, z, surface, rt.ctx.settings.units, Math.random);
    const at = { x: x + 0.5, y: surface, z: z + 0.5 };
    rt.swing();
    rt.ctx.bus.emit('player:toolUse', { tool: 'scanner', ...at });
    rt.ctx.bus.emit('player:scan', { tool: 'scanner', at, lines: res.lines, level: res.level });
    rt.ctx.bus.emit('audio:play', { sound: res.anomaly > 0.55 ? 'scanner_hit' : 'scanner_ping', at, volume: 0.7 });
  }

  /** Continuous behaviour while a tool is held (gas detector readout & beeps). */
  passive(dt: number): void {
    const rt = this.rt;
    if (Tools.classOf(rt.selectedItem()) !== 'detector' || rt.dead) {
      this.detectT = 0;
      this.lastDetectorKey = '';
      return;
    }
    const eye = rt.eye();
    this.detectT -= dt;
    this.beepT -= dt;
    const r = senseHazards(rt.ctx.state, rt.ctx.geology, eye);
    if (this.detectT <= 0) {
      this.detectT = INTERACT.detectorInterval;
      const lines = [`LEL ${r.lel.toFixed(0)}%   H₂S ${r.h2s.toFixed(0)} ppm${r.heat > 0.05 ? `   Heat ${Math.round(r.heat * 100)}%` : ''}`];
      if (r.nearest) lines.push(`${r.nearest.label}: ${Math.round(r.nearest.dist)} m ${compass(eye, r.nearest.at)}`);
      else lines.push('No hazards detected');
      if (r.h2s >= 10) lines.push(r.h2s >= 50 ? 'H₂S IDLH — evacuate upwind!' : 'H₂S above 10 ppm — limit exposure');
      else if (r.lel >= 10) lines.push(r.lel >= 25 ? 'Explosive atmosphere — no ignition sources!' : 'Combustible gas present');
      const level = r.danger >= 0.6 ? 'danger' : r.danger >= 0.15 ? 'warning' : 'info';
      const key = lines.join('|');
      if (key !== this.lastDetectorKey) {
        this.lastDetectorKey = key;
        rt.ctx.bus.emit('player:scan', { tool: 'detector', at: eye, lines, level });
      }
    }
    if (r.danger > 0.04 && this.beepT <= 0) {
      this.beepT = THREE.MathUtils.lerp(1.6, 0.1, Math.min(1, r.danger));
      rt.ctx.bus.emit('audio:play', { sound: 'detector_beep', volume: 0.35 + 0.65 * Math.min(1, r.danger) });
    }
  }
}
