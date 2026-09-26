// Pipe (line) mode: click a start cell, preview an L-shaped run to the cursor that follows the terrain (Shift keeps
// a constant elevation for pipe racks, R flips the L), click again to lay it with 'world/placeLine'. Runs chain from
// the last end point; RMB cancels the current run (or leaves the mode when no run is started).
import * as THREE from 'three';
import type { IWorld, Vec3 } from '../core/types';
import { METERS_PER_BLOCK } from '../core/constants';
import { formatMoney } from '../core/state';
import { blockColor, blockName, isPlaceableBlock, isPlant, isReplaceable, linePrice } from './blockUtil';
import { LINE } from './config';
import { Interaction } from './interaction';
import { planLine } from './linePath';
import { quoteLine } from './sim';
import type { Actions, PlayerRuntime, Target } from './runtime';

const CAP = LINE.maxCells + 1;
const BLOCKED = new THREE.Color(0xff3b30);
const EXISTING = new THREE.Color(0xd8dde3);
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

/** First free cell above the ground at a column, looking through plants (pipes lie on the grass, not on tufts). */
function groundY(w: IWorld, x: number, z: number): number {
  let y = w.getSurfaceY(x, z);
  while (y > 1 && isPlant(w.getBlock(x, y - 1, z))) y--;
  return y;
}

export class PipeMode {
  block: number | null = null;
  private start: Vec3 | null = null;
  private xFirst = true;
  private cells: Vec3[] = [];
  private blocked = new Set<string>();
  private truncated = false;
  private planKey = '';
  private infoKey = '';
  private quote: ReturnType<typeof quoteLine> | null = null;
  private readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly cursor: THREE.LineSegments;
  private readonly startMarker: THREE.LineSegments;
  private readonly group = new THREE.Group();
  private t = 0;
  private readonly color = new THREE.Color();

  constructor(private readonly rt: PlayerRuntime) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.74, 0.74, 0.74), this.mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    const unit = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.cursor = new THREE.LineSegments(unit, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.startMarker = new THREE.LineSegments(unit, new THREE.LineBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 1 }));
    this.group.add(this.mesh, this.cursor, this.startMarker);
    this.group.name = 'pipe-mode-ghost';
    this.group.visible = false;
  }

  get active(): boolean {
    return this.block !== null;
  }

  /** Enter/leave from a 'ui:pipeMode' event. */
  set(block: number | null): void {
    if (block === null || !isPlaceableBlock(block)) {
      this.clear();
      return;
    }
    if (this.block === block) return;
    this.block = block;
    this.start = null;
    this.planKey = '';
    this.infoKey = '';
    if (!this.group.parent) this.rt.host.scene.add(this.group);
  }

  exit(): void {
    if (!this.active) return;
    this.clear();
    this.rt.ctx.bus.emit('ui:pipeMode', { block: null });
  }

  toggleOrder(): void {
    this.xFirst = !this.xFirst;
    this.planKey = '';
    this.rt.ctx.bus.emit('audio:play', { sound: 'ui_rotate', volume: 0.5 });
  }

  update(dt: number, act: Actions, target: Target): void {
    if (this.block === null) return;
    this.t += dt;
    const rt = this.rt;
    const cell = Interaction.placementCell(target);
    const w = rt.ctx.world;
    const color = this.color.setHex(blockColor(this.block));

    if (act.secondaryPressed) {
      if (this.start) {
        this.start = null;
        this.planKey = '';
      } else {
        this.exit();
        return;
      }
    }

    if (!cell || !w.inBounds(cell.x, cell.y, cell.z)) {
      this.cursor.visible = false;
      this.mesh.count = this.start ? this.mesh.count : 0;
      this.group.visible = !!this.start;
      this.startMarker.visible = !!this.start;
      this.emitInfo();
      return;
    }
    this.group.visible = true;
    this.cursor.visible = true;
    this.cursor.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);

    if (!this.start) {
      // Single-cell preview at the cursor.
      const cur = w.getBlock(cell.x, cell.y, cell.z);
      const ok = isReplaceable(cur) || cur === this.block;
      this.cells = [cell];
      this.blocked = ok ? new Set() : new Set([`${cell.x},${cell.y},${cell.z}`]);
      this.quote = null;
      this.writeInstances(color);
      this.startMarker.visible = false;
      (this.cursor.material as THREE.LineBasicMaterial).color.copy(ok ? color : BLOCKED);
      this.emitInfo();
      if (act.primaryPressed && ok) {
        this.start = { ...cell };
        this.planKey = '';
        rt.swing();
        rt.ctx.bus.emit('audio:play', { sound: 'ui_click', volume: 0.6 });
      }
      return;
    }

    const constantY = rt.input.shift();
    const key = `${this.start.x},${this.start.y},${this.start.z}>${cell.x},${cell.y},${cell.z}:${this.xFirst}:${constantY}:${this.block}`;
    if (key !== this.planKey) {
      this.planKey = key;
      const plan = planLine(this.start, cell, {
        xFirst: this.xFirst, constantY, maxCells: LINE.maxCells,
        surfaceY: (x, z) => (w.inBounds(x, 0, z) ? groundY(w, x, z) : this.start!.y),
      });
      this.cells = plan.cells;
      this.truncated = plan.truncated;
      this.quote = quoteLine(rt.ctx, rt.player(), this.block, this.cells);
      this.blocked = new Set(this.quote.blocked.map((c) => `${c.x},${c.y},${c.z}`));
    }
    this.writeInstances(color);
    this.startMarker.visible = true;
    this.startMarker.position.set(this.start.x + 0.5, this.start.y + 0.5, this.start.z + 0.5);
    this.startMarker.scale.setScalar(1 + Math.sin(this.t * 6) * 0.05);
    (this.cursor.material as THREE.LineBasicMaterial).color.copy(this.blocked.size ? BLOCKED : color);
    this.emitInfo();

    if (act.primaryPressed) this.commit();
  }

  private commit(): void {
    const rt = this.rt;
    const q = this.quote;
    if (!q || this.block === null) return;
    if (q.blocked.length > 0) {
      rt.ctx.bus.emit('ui:error', { text: `${q.blocked.length} cell${q.blocked.length > 1 ? 's are' : ' is'} blocked — reroute (R flips the corner, Shift keeps height)` });
      return;
    }
    const end = this.cells[this.cells.length - 1];
    if (q.cells.length === 0) {
      this.start = { ...end };
      this.planKey = '';
      return;
    }
    const res = rt.dispatch({ type: 'world/placeLine', block: this.block, points: this.cells.map((c) => ({ x: c.x, y: c.y, z: c.z })) });
    if (res.ok) {
      rt.swing();
      const last = q.cells[q.cells.length - 1];
      rt.ctx.bus.emit('player:blockPlaced', { x: last.x, y: last.y, z: last.z, id: this.block });
      rt.ctx.bus.emit('audio:play', { sound: 'pipe_place', at: { x: last.x + 0.5, y: last.y + 0.5, z: last.z + 0.5 } });
      this.start = { ...end };
      this.planKey = '';
    }
  }

  private writeInstances(color: THREE.Color): void {
    const n = Math.min(this.cells.length, CAP);
    const w = this.rt.ctx.world;
    const pulse = 0.9 + Math.sin(this.t * 5) * 0.1;
    for (let i = 0; i < n; i++) {
      const c = this.cells[i];
      tmpM.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5);
      this.mesh.setMatrixAt(i, tmpM);
      const k = `${c.x},${c.y},${c.z}`;
      if (this.blocked.has(k)) tmpC.copy(BLOCKED);
      else if (w.inBounds(c.x, c.y, c.z) && w.getBlock(c.x, c.y, c.z) === this.block) tmpC.copy(EXISTING);
      else tmpC.copy(color).multiplyScalar(pulse);
      this.mesh.setColorAt(i, tmpC);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private emitInfo(): void {
    const rt = this.rt;
    if (this.block === null) return;
    const name = blockName(this.block);
    const lines: string[] = [];
    if (!this.start) {
      lines.push(`${name} — click to set the start point`);
      lines.push('R flip corner · Shift constant height · RMB exit');
    } else {
      const q = this.quote;
      const n = q ? q.cells.length : 0;
      const km = (this.cells.length * METERS_PER_BLOCK) / 1000;
      lines.push(`${name}: ${n} new block${n === 1 ? '' : 's'} · ${km.toFixed(km < 10 ? 2 : 1)} km${this.truncated ? ` (max ${LINE.maxCells})` : ''}`);
      if (q) {
        if (q.fromInventory > 0) lines.push(`From inventory: ${q.fromInventory}`);
        if (q.bought > 0) lines.push(`Purchase ${q.bought} × ${formatMoney(linePrice(this.block))} = ${formatMoney(q.cost)}`);
        if (q.blocked.length > 0) lines.push(`✖ ${q.blocked.length} blocked cell${q.blocked.length > 1 ? 's' : ''}`);
      }
      lines.push('LMB lay run · R flip corner · Shift constant height · RMB cancel');
    }
    const key = lines.join('|');
    if (key === this.infoKey) return;
    this.infoKey = key;
    const blocked = !!this.quote && this.quote.blocked.length > 0;
    const unaffordable = !!this.quote && this.quote.cost > rt.ctx.state.company.money && !rt.creative();
    rt.ctx.bus.emit('player:scan', { tool: 'pipe', at: this.start ?? rt.eye(), lines, level: blocked || unaffordable ? 'warning' : 'info' });
  }

  private clear(): void {
    this.block = null;
    this.start = null;
    this.cells = [];
    this.quote = null;
    this.planKey = '';
    this.infoKey = '';
    this.mesh.count = 0;
    this.group.visible = false;
    this.group.removeFromParent();
  }

  dispose(): void {
    this.clear();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    (this.startMarker.material as THREE.Material).dispose();
  }
}
