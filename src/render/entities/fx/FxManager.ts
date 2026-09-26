// World FX director: fires (state.hazards.fires & burning buildings), blowouts, kicks, fracking dust,
// pipeline leaks, explosions, the player's extinguisher foam, and per-building emitters declared as
// model anchors (flares, stacks, steam, exhaust, floodlights). Owns the particle system and the
// point-light pool.
import * as THREE from 'three';
import type { RenderHost } from '../../../core/client';
import type { BuildingState, Fire, GameContext, WellState } from '../../../core/types';
import type { BuildingView } from '../BuildingView';
import { EMISSION_SCALE, FX_DISTANCE, PARTICLE_CAPACITY, MAX_POINT_LIGHTS } from '../config';
import { RIG_FLOOR } from '../models/rigSpecs';
import { COL, count, dust, dustRing, exhaust, flames, flare, gasJet, jet, smoke, sparks, steam } from './emitters';
import { LightPool } from './LightPool';
import { PK, ParticleSystem, rgb } from './ParticleSystem';
import { Shockwaves } from './Shockwave';

interface Blast {
  x: number;
  y: number;
  z: number;
  power: number;
  t: number;
}

const FIRE_TINT = rgb(0xffb070);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const rnd = Math.random;
const sr = (a: number) => (rnd() - 0.5) * 2 * a;

export class FxManager {
  readonly group = new THREE.Group();
  readonly ps: ParticleSystem;
  readonly lights: LightPool;
  private readonly waves = new Shockwaves();
  private readonly blasts: Blast[] = [];
  private readonly offs: (() => void)[] = [];
  private foamUntil = -1;
  private readonly foamTarget = new THREE.Vector3();
  readonly wind = new THREE.Vector3();
  /** Emission multiplier from settings.particles. */
  q = 1;
  time = 0;

  constructor(private readonly host: RenderHost, private readonly ctx: GameContext) {
    const quality = ctx.settings.particles ?? 'high';
    this.ps = new ParticleSystem(PARTICLE_CAPACITY[quality]);
    this.lights = new LightPool(MAX_POINT_LIGHTS);
    this.group.name = 'fx';
    this.group.add(this.ps.mesh, this.lights.group, this.waves.group);
    this.offs.push(
      ctx.bus.on('hazard:explosion', (e) => this.explode(e.x, e.y, e.z, e.power)),
      ctx.bus.on('player:toolUse', (e) => {
        if (!e.tool.includes('extinguisher')) return;
        this.foamUntil = this.time + 0.35;
        this.foamTarget.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
      }),
    );
  }

  get cam(): THREE.Vector3 {
    return this.host.camera.position;
  }

  private near(x: number, y: number, z: number, dist = FX_DISTANCE): boolean {
    const c = this.cam;
    return (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2 < dist * dist;
  }

  /** Spawn an explosion (also used by the 'hazard:explosion' event). */
  explode(x: number, y: number, z: number, power: number): void {
    const pw = Math.max(0.3, Math.min(10, Number.isFinite(power) ? power : 1));
    const p = Math.sqrt(pw) * 1.15;
    this.blasts.push({ x, y, z, power: p, t: 0 });
    this.waves.spawn(x, y, z, p);
    const ps = this.ps;
    const sp = Math.sqrt(p);
    const n = Math.round(90 * p * Math.max(0.5, this.q));
    for (let i = 0; i < n; i++) {
      _v.set(sr(1), sr(1) * 0.6 + 0.35, sr(1)).normalize();
      const s = (1.4 + rnd() * 2.4) * sp;
      const v = (5 + rnd() * 10) * sp;
      ps.emit(PK.FIRE, x + _v.x * 0.6, y + 0.5 + _v.y * 0.6, z + _v.z * 0.6, _v.x * v, _v.y * v, _v.z * v, 0.8 + rnd() * 0.9, s, s * 1.8, COL.FIRE, 1, 1.5, 3.2, 0.3, sr(1));
    }
    ps.emit(PK.GLOW, x, y + 1, z, 0, 0, 0, 0.45, 8 * sp, 22 * sp, COL.GLOW_WHITE, 1, 0, 1, 0);
    ps.emit(PK.GLOW, x, y + 1, z, 0, 2, 0, 1.2, 10 * sp, 16 * sp, COL.GLOW_FIRE, 0.6, 0, 1, 0);
    for (let i = 0; i < Math.round(50 * p * this.q + 10); i++) {
      const a = rnd() * Math.PI * 2;
      const v = (6 + rnd() * 14) * sp;
      ps.emit(PK.DROP, x, y + 0.8, z, Math.cos(a) * v * 0.6, (0.5 + rnd()) * v, Math.sin(a) * v * 0.6, 2 + rnd() * 1.5, 0.12 + rnd() * 0.18, 0.12, COL.SMOKE_DARK, 1, -14, 0.15, 0);
    }
    sparks(ps, x, y + 1, z, Math.round(80 * this.q + 20), 12 * sp);
    for (let i = 0; i < Math.round(26 * p * this.q + 6); i++) {
      const s = (2 + rnd() * 2.5) * sp;
      ps.emit(PK.SMOKE, x + sr(2 * sp), y + 1 + rnd() * 3 * sp, z + sr(2 * sp), sr(3), 2 + rnd() * 4, sr(3), 7 + rnd() * 6, s, s * 3, COL.SMOKE_DARK, 0.8, 0.8, 0.6, 0.8, sr(0.5));
    }
    const d = this.cam.distanceTo(_v.set(x, y, z));
    const shake = (0.3 + pw * 0.14) * Math.max(0, 1 - d / (70 + 18 * pw));
    if (shake > 0.02) this.host.shake(Math.min(1.8, shake), 0.35 + 0.08 * pw);
  }

  /** Main per-frame update (world hazards). Building anchors are driven via buildingFx(). */
  update(dt: number, time: number, views: Map<string, BuildingView>): void {
    this.time = time;
    const s = this.ctx.state;
    this.q = EMISSION_SCALE[this.ctx.settings.particles ?? 'high'] ?? 1;
    const w = s.weather;
    const ws = Math.min(25, w?.windSpeed ?? 0) * 0.45;
    this.wind.set(Math.cos(w?.windDir ?? 0) * ws, 0, Math.sin(w?.windDir ?? 0) * ws);

    // ---- fires
    for (const f of s.hazards.fires) this.fireFx(f, views, dt);
    // ---- wells
    for (const well of Object.values(s.wells)) {
      if (well.status === 'blowout') this.blowoutFx(well, dt);
      else if (well.status === 'kick') this.kickFx(well, dt);
      else if (well.status === 'fracking') this.fracFx(well, dt);
    }
    // ---- pipeline leaks
    for (const n of Object.values(s.networks)) {
      if (!n.leak) continue;
      const L = n.leak;
      const x = L.x + 0.5;
      const y = L.y + 0.5;
      const z = L.z + 0.5;
      if (!this.near(x, y, z)) continue;
      const h = Math.sin(L.x * 12.9898 + L.z * 78.233) * 43758.5453;
      const a = (h - Math.floor(h)) * Math.PI * 2;
      const dx = Math.cos(a) * 0.8;
      const dz = Math.sin(a) * 0.8;
      const rate = 30 + Math.min(90, Math.sqrt(Math.max(0, L.rate)) * 3);
      if (n.category === 'gas') gasJet(this.ps, x, y, z, dx, 0.5, dz, 9, rate * 0.7, dt, this.q);
      else jet(this.ps, x, y, z, dx, 0.6, dz, 6, n.category === 'oil' ? COL.OIL : n.category === 'water' ? COL.WATER : COL.PRODUCT, rate, dt, this.q, 0.15, 0.09);
    }
    // ---- explosions (lingering light & fire)
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      if (b.t > 2.2) {
        this.blasts.splice(i, 1);
        continue;
      }
      const k = Math.max(0, 1 - b.t / 2.2);
      this.lights.offer(b.x, b.y + 3, b.z, 0xffa050, 900 * b.power * k * k, 40 + 20 * b.power, this.cam, 20);
      if (b.t < 1) flames(this.ps, b.x, b.y, b.z, 1.5 * Math.sqrt(b.power), 1 - b.t, dt, this.q, 1.6);
    }
    this.waves.update(dt);
    // ---- extinguisher foam
    if (time < this.foamUntil) this.foamFx(dt);

    const light = 0.25 + 0.75 * this.host.daylight;
    this.ps.update(time, this.wind, light, this.host.scene.fog as THREE.Fog | THREE.FogExp2 | null);
    this.lights.update(dt);
  }

  private fireFx(f: Fire, views: Map<string, BuildingView>, dt: number): void {
    const inten = Math.max(0.15, Math.min(1.5, f.intensity));
    if (f.wellId) {
      const well = this.ctx.state.wells[f.wellId];
      if (well && well.status === 'blowout') return; // drawn by blowoutFx
    }
    if (f.buildingId) {
      const v = views.get(f.buildingId);
      const b = this.ctx.state.buildings[f.buildingId];
      if (v && b) {
        this.buildingFire(v, b, inten, dt);
        return;
      }
    }
    const x = f.x + 0.5;
    const y = f.y;
    const z = f.z + 0.5;
    if (!this.near(x, y, z)) return;
    const r = 0.8 + inten * 1.2;
    flames(this.ps, x, y, z, r, inten, dt, this.q, 1);
    smoke(this.ps, x, y + 1.5 + inten * 2, z, r * 0.8, inten, 0.7, dt, this.q);
    const fl = 0.75 + 0.25 * Math.sin(this.time * 23 + f.x) * Math.sin(this.time * 13.7 + f.z);
    this.lights.offer(x, y + 1.5, z, 0xff7a2a, 60 * inten * fl, 18 + 10 * inten, this.cam, 4);
  }

  /** Flames distributed over a building's volume. */
  buildingFire(v: BuildingView, b: BuildingState, intensity: number, dt: number): void {
    if (!this.near(v.center.x, v.center.y, v.center.z)) return;
    const [w, d, h] = b.size;
    const area = Math.sqrt(w * d);
    const pts = Math.min(6, 1 + Math.round(area * 0.8));
    const seed = v.mem.fireSeed ?? (v.mem.fireSeed = rnd() * 1000);
    for (let i = 0; i < pts; i++) {
      const hx = Math.sin(seed + i * 12.9898) * 43758.5453;
      const hz = Math.sin(seed + i * 78.233) * 12543.113;
      const hy = Math.sin(seed + i * 39.425) * 24634.6345;
      const fx = b.x + (hx - Math.floor(hx)) * w;
      const fz = b.z + (hz - Math.floor(hz)) * d;
      const fy = b.y + (0.15 + (hy - Math.floor(hy)) * 0.75) * h * (v.status === 'destroyed' ? 0.3 : 1);
      flames(this.ps, fx, fy, fz, 0.6 + area * 0.18, intensity, dt / Math.sqrt(pts) * 1.6, this.q, 1.2);
    }
    smoke(this.ps, v.center.x, b.y + h * 0.9 + 1, v.center.z, 0.8 + area * 0.25, intensity * 1.6, 0.85, dt, this.q, 1.3);
    const fl = 0.7 + 0.3 * Math.sin(this.time * 19 + b.x) * Math.sin(this.time * 11.3 + b.z);
    this.lights.offer(v.center.x, b.y + h * 0.5 + 1, v.center.z, 0xff7a2a, (80 + area * 30) * intensity * fl, 24 + area * 3, this.cam, 6);
  }

  private wellBase(well: WellState): { x: number; y: number; z: number } {
    const x = well.x + 0.5;
    const z = well.z + 0.5;
    let y = well.surfaceY;
    const rig = well.rigId ? this.ctx.state.buildings[well.rigId] : undefined;
    if (rig && RIG_FLOOR[rig.type] !== undefined) y = rig.y + RIG_FLOOR[rig.type] + 0.3;
    else if (well.offshore) y = Math.max(y, 63.5);
    return { x, y, z };
  }

  private blowoutFx(well: WellState, dt: number): void {
    const { x, y, z } = this.wellBase(well);
    if (!this.near(x, y, z, FX_DISTANCE * 1.5)) return;
    const ps = this.ps;
    const q = Math.max(0.45, this.q);
    const flow = Math.max(0.4, Math.min(1.6, (well.blowout?.flowRate ?? 3000) / 4000 + 0.5));
    if (well.blowout?.onFire) {
      const H = 16 + 10 * flow;
      const n = count(120 * q * flow, dt);
      for (let i = 0; i < n; i++) {
        const t = Math.pow(rnd(), 0.8);
        const s = (1.0 + rnd() * 1.4) * (0.7 + t * 1.3) * flow;
        const spread = 0.5 + t * 2.2;
        ps.emit(PK.FIRE, x + sr(spread), y + t * H * 0.5, z + sr(spread), sr(1.6), 8 + rnd() * 8, sr(1.6), 0.8 + rnd() * 0.8, s, s * 0.8, FIRE_TINT, 0.45 + (1 - t) * 0.25, 2, 0.8, 0.7, sr(1.5));
      }
      flames(ps, x, y, z, 1.6, 1, dt, q, 1.4);
      smoke(ps, x, y + H * 0.85, z, 2.8 * flow, 2.6 * flow, 1, dt, q, 2.6);
      if (rnd() < dt * 10) ps.emit(PK.SPARK, x + sr(1), y + rnd() * H * 0.6, z + sr(1), sr(4), 8 + rnd() * 8, sr(4), 1.5 + rnd(), 0.09, 0.05, COL.SPARK, 1, -4, 0.4, 0.8);
      if (rnd() < dt * 3) ps.emit(PK.GLOW, x, y + H * 0.25, z, 0, 2, 0, 1, H * 0.45, H * 0.55, COL.GLOW_FIRE, 0.12, 0, 1, 0.4);
      const fl = 0.8 + 0.2 * Math.sin(this.time * 17) * Math.sin(this.time * 9.3 + 1);
      this.lights.offer(x, y + H * 0.35, z, 0xff8030, 1400 * flow * fl, 80, this.cam, 30);
      this.lights.offer(x, y + 3, z, 0xff6a20, 500 * flow * fl, 40, this.cam, 10);
    } else {
      // dark crude geyser arcing up and raining down, gas plume above
      const n = count(260 * q * flow, dt);
      for (let i = 0; i < n; i++) {
        const v = (12 + rnd() * 9) * Math.sqrt(flow);
        const a = rnd() * Math.PI * 2;
        const lat = 0.5 + rnd() * 4.5;
        const s = 0.16 + rnd() * 0.3;
        ps.emit(PK.DROP, x + sr(0.25), y, z + sr(0.25), Math.cos(a) * lat, v, Math.sin(a) * lat, 3.4 + rnd() * 1.2, s, s * 1.8, COL.OIL_DROP, 1, -11, 0.12, 0.35);
      }
      // dense crude column core + drifting brown mist
      const c = count(60 * q, dt);
      for (let i = 0; i < c; i++) {
        const s = 0.7 + rnd() * 0.6;
        const h = rnd();
        ps.emit(PK.SMOKE, x + sr(0.3 + h * 0.5), y + h * 10, z + sr(0.3 + h * 0.5), sr(0.6), 8 + rnd() * 5, sr(0.6), 0.8 + rnd() * 0.4, s, s * 1.8, COL.OIL_MIST, 0.4, -6, 0.3, 0.2, sr(0.5));
      }
      const m = count(20 * q, dt);
      for (let i = 0; i < m; i++) {
        const s = 1 + rnd() * 1.5;
        ps.emit(PK.SMOKE, x + sr(0.5), y + 2 + rnd() * 12, z + sr(0.5), sr(1.5), 4 + rnd() * 5, sr(1.5), 4 + rnd() * 3, s, s * 4, COL.OIL_MIST, 0.35, -0.2, 0.7, 0.8, sr(0.5));
      }
      // pooled crude splashing on the ground around the well
      if (rnd() < dt * 20) jet(ps, x + sr(4), y + 0.1, z + sr(4), 0, 1, 0, 2, COL.OIL, 30, dt * 3, q, 0.6, 0.12);
      const g = count(18 * q, dt);
      for (let i = 0; i < g; i++) {
        const s = 1.5 + rnd();
        ps.emit(PK.STEAM, x + sr(0.4), y + 12 + rnd() * 6, z + sr(0.4), sr(1.5), 5 + rnd() * 3, sr(1.5), 4 + rnd() * 2, s, s * 5, COL.GAS_DIRTY, 0.13, 0.5, 0.5, 1, sr(0.3));
      }
    }
  }

  private kickFx(well: WellState, dt: number): void {
    const { x, y, z } = this.wellBase(well);
    if (!this.near(x, y, z)) return;
    const n = count(70 * Math.max(0.5, this.q), dt);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const lat = 0.6 + rnd() * 2.2;
      ps_emitMud(this.ps, x + sr(0.2), y + 0.4, z + sr(0.2), Math.cos(a) * lat, 5 + rnd() * 6, Math.sin(a) * lat);
    }
    if (rnd() < dt * 3) gasJet(this.ps, x, y + 1, z, 0, 1, 0, 4, 12, dt, this.q);
  }

  private fracFx(well: WellState, dt: number): void {
    const x = well.x + 0.5;
    const z = well.z + 0.5;
    const y = well.surfaceY;
    if (!this.near(x, y, z, 120)) return;
    dust(this.ps, x, y, z, 5, 6, dt, this.q);
  }

  private foamFx(dt: number): void {
    const cam = this.host.camera;
    cam.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, cam.up).normalize();
    _up.crossVectors(_right, _fwd).normalize();
    _v.copy(cam.position).addScaledVector(_fwd, 0.7).addScaledVector(_right, 0.32).addScaledVector(_up, -0.3);
    _v2.copy(this.foamTarget).sub(_v);
    const dist = _v2.length();
    _v2.normalize();
    const speed = Math.min(16, 4 + dist * 1.6);
    const n = count(150 * Math.max(0.5, this.q), dt);
    for (let i = 0; i < n; i++) {
      const s = 0.07 + rnd() * 0.08;
      this.ps.emit(PK.FOAM, _v.x, _v.y, _v.z, (_v2.x + sr(0.1)) * speed, (_v2.y + sr(0.1)) * speed + 1.5, (_v2.z + sr(0.1)) * speed, 0.7 + rnd() * 0.5, s, 0.6 + rnd() * 0.5, COL.FOAM, 0.75, -6, 0.9, 0.05, sr(2));
    }
  }

  /** Emitters declared on a building model (called for nearby views each frame). */
  buildingFx(v: BuildingView, b: BuildingState, dt: number, night: number): void {
    if (v.hidden || v.distance > FX_DISTANCE + v.radius) return;
    const ps = this.ps;
    const act = v.speed;
    const lit = v.lightsOn;
    for (const a of v.anchors) {
      const k = a.def.kind;
      if (k === 'light') {
        if (lit && night > 0.2 && v.distance < 110) {
          const p = v.anchorPos(a, _v);
          this.lights.offer(p.x, p.y, p.z, a.def.data.color ?? 0xffe2b0, (a.def.data.intensity ?? 1) * 14 * night, a.def.data.range ?? 14, this.cam, 0.6);
        }
        continue;
      }
      if (!v.visible && v.distance > 40) continue;
      if (k === 'flare') {
        const f = v.status === 'active' || v.status === 'idle' ? Math.max(act, a.def.data.pilot ?? 0.12) : 0;
        if (f <= 0) continue;
        const p = v.anchorPos(a, _v);
        const sc = a.def.data.scale ?? 1;
        flare(ps, p.x, p.y, p.z, f, dt, this.q, sc);
        const fl = 0.8 + 0.2 * Math.sin(this.time * 21 + p.x) * Math.sin(this.time * 12.7);
        this.lights.offer(p.x, p.y + 1.5 * sc, p.z, 0xff8a3a, (40 + 260 * f) * sc * fl, 22 + 30 * f * sc, this.cam, 3);
      } else if (act > 0.02) {
        const p = v.anchorPos(a, _v);
        const r = a.def.data.r ?? 0.4;
        if (k === 'smoke') smoke(ps, p.x, p.y, p.z, r, act * (a.def.data.rate ?? 1), a.def.data.dark ?? 0.1, dt, this.q);
        else if (k === 'steam') steam(ps, p.x, p.y, p.z, r, act * (a.def.data.rate ?? 1), dt, this.q);
        else if (k === 'exhaust') exhaust(ps, p.x, p.y, p.z, (a.def.data.rate ?? 4) * act, dt, this.q);
        else if (k === 'dust') dust(ps, p.x, p.y, p.z, r, (a.def.data.rate ?? 4) * act, dt, this.q);
      }
    }
    // status effects
    const burningHazard = v.mem.hazardFire === 1;
    if (v.status === 'fire' && !burningHazard) this.buildingFire(v, b, Math.max(0.35, Math.min(1.5, b.fire || 0.7)), dt);
    else if (v.status === 'broken') {
      if (rnd() < dt * 0.8) {
        const [w, d, h] = b.size;
        sparks(ps, b.x + rnd() * w, b.y + (0.3 + rnd() * 0.6) * h, b.z + rnd() * d, 14 + Math.round(rnd() * 16), 4);
      }
      smoke(ps, v.center.x, b.y + b.size[2] * 0.8, v.center.z, 0.4, 0.5, 0.4, dt, this.q);
    } else if (v.status === 'destroyed') {
      smoke(ps, v.center.x + Math.sin(this.time * 0.3) * b.size[0] * 0.25, b.y + 0.6, v.center.z, 0.6, 0.45, 0.6, dt, this.q, 0.7);
      if (rnd() < dt * 0.6) ps.emit(PK.GLOW, b.x + rnd() * b.size[0], b.y + 0.3, b.z + rnd() * b.size[1], 0, 0.2, 0, 1.5, 0.8, 0.6, COL.GLOW_FIRE, 0.5, 0, 1, 0);
    }
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.ps.dispose();
    this.lights.dispose();
    this.waves.dispose();
    this.group.removeFromParent();
  }
}

function ps_emitMud(ps: ParticleSystem, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
  const s = 0.12 + Math.random() * 0.14;
  ps.emit(PK.DROP, x, y, z, vx, vy, vz, 1.4 + Math.random() * 0.6, s, s * 1.3, COL.MUD, 0.95, -11, 0.2, 0.2);
}

export { dustRing };
