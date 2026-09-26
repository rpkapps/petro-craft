// A fixed pool of real point lights assigned each frame to the most important nearby light sources
// (fires, flares, blowouts, explosions, plant floodlights at night). The light count never changes so
// scene materials are never recompiled; unused lights simply get intensity 0.
import * as THREE from 'three';

interface Candidate {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  range: number;
  score: number;
}

interface Slot {
  light: THREE.PointLight;
  target: number;
  current: number;
  key: string;
}

const _c = new THREE.Color();

export class LightPool {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly cands: Candidate[] = [];
  private n = 0;

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 2);
      light.castShadow = false;
      light.position.set(0, -1000, 0);
      this.group.add(light);
      this.slots.push({ light, target: 0, current: 0, key: '' });
    }
  }

  /** Offer a light source for this frame. `priority` multiplies its importance score. */
  offer(x: number, y: number, z: number, color: number, intensity: number, range: number, camPos: THREE.Vector3, priority = 1): void {
    if (intensity <= 0.01) return;
    const d2 = (x - camPos.x) ** 2 + (y - camPos.y) ** 2 + (z - camPos.z) ** 2;
    if (d2 > (range * 5 + 60) ** 2) return;
    const score = (priority * intensity * range) / (1 + d2 / 400);
    let c = this.cands[this.n];
    if (!c) {
      c = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, intensity: 0, range: 0, score: 0 };
      this.cands.push(c);
    }
    _c.setHex(color);
    c.x = x;
    c.y = y;
    c.z = z;
    c.r = _c.r;
    c.g = _c.g;
    c.b = _c.b;
    c.intensity = intensity;
    c.range = range;
    c.score = score;
    this.n++;
  }

  update(dt: number): void {
    const list = this.cands.slice(0, this.n).sort((a, b) => b.score - a.score);
    const used = new Set<number>();
    const chosen = list.slice(0, this.slots.length);
    // keep lights on the candidate nearest to their previous position (prevents popping)
    const assign = new Array<Candidate | null>(this.slots.length).fill(null);
    for (let s = 0; s < this.slots.length; s++) {
      const L = this.slots[s].light.position;
      let best = -1;
      let bestD = 4;
      for (let i = 0; i < chosen.length; i++) {
        if (used.has(i)) continue;
        const c = chosen[i];
        const d = (c.x - L.x) ** 2 + (c.y - L.y) ** 2 + (c.z - L.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        used.add(best);
        assign[s] = chosen[best];
      }
    }
    for (let i = 0; i < chosen.length; i++) {
      if (used.has(i)) continue;
      const s = assign.findIndex((a, idx) => a === null && this.slots[idx].current < 0.05);
      const s2 = s >= 0 ? s : assign.findIndex((a) => a === null);
      if (s2 < 0) break;
      assign[s2] = chosen[i];
      used.add(i);
      this.slots[s2].current = 0;
    }
    const k = Math.min(1, dt * 8);
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      const c = assign[s];
      if (c) {
        slot.light.position.set(c.x, c.y, c.z);
        slot.light.color.setRGB(c.r, c.g, c.b);
        slot.light.distance = c.range;
        slot.target = c.intensity;
      } else slot.target = 0;
      slot.current += (slot.target - slot.current) * k;
      if (slot.current < 0.01 && slot.target === 0) slot.current = 0;
      slot.light.intensity = slot.current;
    }
    this.n = 0;
  }

  dispose(): void {
    for (const s of this.slots) s.light.dispose();
    this.group.removeFromParent();
  }
}
