// Player controller (client side): input, walk/fly/swim physics, first-person & drone cameras, picking,
// block breaking/placing, tools, build & pipe modes, health, viewmodel and state sync.
//
// Conventions: body position = feet (centre of the 0.6-wide AABB). yaw 0 looks towards −Z, positive yaw turns left
// (three.js 'YXZ' Euler); pitch > 0 looks up. Compass north = −Z, east = +X.
import * as THREE from 'three';
import type { AppShell, RenderHost } from '../core/client';
import type { Command, CommandResult, CommandType } from '../core/commands';
import type { GameContext, PlayerMode, PlayerState, Vec3 } from '../core/types';
import { BLOCKS, IS_LIQUID } from '../core/blocks';
import { CHUNK_SIZE, HOTBAR_SLOTS } from '../core/constants';
import { BODY, DRONE, FLY, INTERACT, LOOK, WALK } from './config';
import { InputManager } from './input';
import { boxOverlapsSolid, createBody, newStepEvents, stepBody, type Body, type MoveIntent, type VoxelQuery } from './physics';
import { FirstPersonCamera } from './firstPerson';
import { DroneCamera } from './drone';
import { ViewModel } from './viewmodel';
import { Targeting } from './targeting';
import { Tools } from './tools';
import { Interaction } from './interaction';
import { BuildMode } from './buildMode';
import { PipeMode } from './pipeMode';
import { HealthModel } from './health';
import { NO_ACTIONS, type Actions, type PlayerRuntime, type Target } from './runtime';

export interface PlayerController {
  update(dt: number): void;
  dispose(): void;
}

export type { PlayerRuntime, Target } from './runtime';
export { raycastVoxels } from './raycast';
export { buildPlaceCommand } from './buildMode';

const HOTBAR_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
const NUMPAD_CODES = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9'];
const fwd = new THREE.Vector3();

/** Concrete controller; exposes internals (input, body, modes) for the dev harness and tests. */
export class PlayerControllerImpl implements PlayerController, PlayerRuntime {
  readonly input: InputManager;
  readonly body: Body;
  yaw = 0;
  pitch = 0;
  mode: PlayerMode = 'walk';
  bodyMode: 'walk' | 'fly' = 'walk';
  dead = false;
  readonly rayOrigin = new THREE.Vector3();
  readonly rayDir = new THREE.Vector3(0, 0, -1);
  target: Target = { kind: 'none', hit: null };

  readonly fp = new FirstPersonCamera();
  readonly drone: DroneCamera;
  readonly viewmodel: ViewModel;
  readonly targeting: Targeting;
  readonly tools: Tools;
  readonly interaction: Interaction;
  readonly build: BuildMode;
  readonly pipe: PipeMode;
  readonly health: HealthModel;

  private readonly query: VoxelQuery;
  private readonly offs: (() => void)[] = [];
  private syncTimer = 0;
  private lastSyncKey = '';
  private sprintLatched = false;
  private wheelAcc = 0;
  private lookDX = 0;
  private lookDY = 0;
  private strafe = 0;
  private disposed = false;

  constructor(readonly host: RenderHost, readonly ctx: GameContext, readonly app: AppShell) {
    const world = ctx.world;
    this.query = {
      solid: (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return true;
        if (y >= world.height) return false;
        return world.isSolid(x, y, z);
      },
      liquid: (x, y, z) => world.inBounds(x, y, z) && IS_LIQUID[world.getBlock(x, y, z)] === 1,
    };
    this.input = new InputManager(host.canvas, () => this.ctx.settings.keybinds, () => this.app.pointerLocked, FLY.doubleTapWindow);
    this.input.onCanvasPress = () => {
      if (this.mode !== 'drone' && !this.app.pointerLocked && !this.app.uiCapturing) {
        this.app.requestPointerLock();
        return true;
      }
      return false;
    };
    this.input.attach();

    // Restore from state (loaded games).
    const p = this.player();
    const pos = p?.position ?? { x: world.sizeX / 2, y: 80, z: world.sizeZ / 2 };
    this.body = createBody(pos.x, pos.y, pos.z);
    this.yaw = p?.yaw ?? 0;
    this.pitch = THREE.MathUtils.clamp(p?.pitch ?? 0, -LOOK.maxPitch, LOOK.maxPitch);
    this.ensureChunks();
    this.unstick();

    this.drone = new DroneCamera(world);
    this.viewmodel = new ViewModel(host.scene);
    this.targeting = new Targeting(this);
    this.tools = new Tools(this);
    this.interaction = new Interaction(this, this.tools);
    this.build = new BuildMode(this);
    this.pipe = new PipeMode(this);
    this.health = new HealthModel(this);
    this.health.onDeath = () => this.handleDeath();
    this.health.onRespawn = (at) => this.handleRespawn(at);
    this.health.onDamage = (a) => host.shake(Math.min(0.5, 0.08 + a / 40), 0.25);

    const mode = p?.mode ?? 'walk';
    if (mode === 'drone') {
      this.bodyMode = 'walk';
      this.mode = 'drone';
      this.drone.enter(this.body.x, this.body.z, this.yaw);
    } else {
      this.mode = mode;
      this.bodyMode = mode;
    }

    const bus = ctx.bus;
    this.offs.push(
      bus.on('ui:buildMode', (e) => {
        if (e.type) this.pipe.set(null);
        this.build.set(e.type, e.rotation);
      }),
      bus.on('ui:pipeMode', (e) => {
        if (e.block !== null) this.build.set(null);
        this.pipe.set(e.block);
      }),
      // "Locate" from notifications / panels: swoop the drone camera to the location.
      bus.on('ui:focus', (e) => {
        if (this.dead || !e.at) return;
        if (this.mode !== 'drone') this.enterDrone();
        this.drone.flyTo(e.at.x, e.at.z);
      }),
    );
    const onLockChange = () => {
      if (!this.app.pointerLocked && this.mode !== 'drone') this.input.releaseAll();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.offs.push(() => document.removeEventListener('pointerlockchange', onLockChange));

    // Place the camera immediately so terrain streaming starts around the player during loading.
    this.updateCamera(0, false);
  }

  // ---- PlayerRuntime ----------------------------------------------------------------------------------
  player(): PlayerState | undefined {
    return this.ctx.state.players[this.ctx.localPlayerId];
  }
  selectedSlot(): number {
    return this.player()?.selectedSlot ?? 0;
  }
  selectedItem(): string | null {
    const p = this.player();
    return p?.inventory[p.selectedSlot]?.item ?? null;
  }
  creative(): boolean {
    return !!this.ctx.state.meta.rules.creative;
  }
  dispatch<K extends CommandType>(cmd: Command<K>): CommandResult {
    return this.ctx.commands.dispatch(cmd);
  }
  eye(): Vec3 {
    return { x: this.body.x, y: this.body.y + BODY.eyeHeight, z: this.body.z };
  }
  swing(): void {
    this.viewmodel.swing();
  }
  syncNow(): void {
    this.syncTimer = 0;
    this.sendSync(true);
  }

  // ---- frame ------------------------------------------------------------------------------------------
  update(dt: number): void {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const capturing = this.app.uiCapturing;
    this.input.setEnabled(!capturing);
    const inputOn = !capturing && !this.dead;
    if (inputOn) this.handleKeys();
    else this.input.takeWheel();

    this.ensureChunks();
    const ev = this.updateMovement(dt, inputOn);
    this.updateCamera(dt, inputOn, ev);
    this.updatePick();
    this.updateInteraction(dt, inputOn);
    this.tools.passive(dt);
    this.health.update(dt);
    this.viewmodel.update(dt, this.host.camera, {
      item: this.selectedItem(), bobPhase: this.fp.bobPhase, bobAmount: this.fp.bobAmount,
      lookDX: this.lookDX, lookDY: this.lookDY, drone: this.mode === 'drone' || this.dead,
    });
    this.syncTimer += dt;
    if (this.syncTimer >= INTERACT.syncInterval) {
      this.syncTimer = 0;
      this.sendSync(false);
    }
    this.input.endFrame();
  }

  private handleKeys(): void {
    const inp = this.input;
    const bus = this.ctx.bus;
    if (inp.pressed('xray')) {
      this.host.overlay = this.host.overlay === 'xray' ? null : 'xray';
      bus.emit('ui:overlay', { overlay: this.host.overlay });
    }
    if (inp.pressed('drone')) {
      if (this.mode === 'drone') this.exitDrone();
      else this.enterDrone();
    }
    if (this.mode !== 'drone' && (inp.pressed('fly') || inp.doubleTapped('jump'))) this.setMode(this.mode === 'fly' ? 'walk' : 'fly');
    if (inp.pressed('rotate')) {
      if (this.build.active) this.build.rotate();
      else if (this.pipe.active) this.pipe.toggleOrder();
    }
    if (inp.pressed('inspect')) {
      const t = this.target;
      if (t.building) bus.emit('ui:select', { kind: t.kind === 'well' ? 'well' : 'building', id: t.id });
      else if (t.hit) bus.emit('ui:select', { kind: 'block', pos: { x: t.hit.x, y: t.hit.y, z: t.hit.z } });
      else bus.emit('ui:select', { kind: 'none' });
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (inp.codePressed(HOTBAR_CODES[i]) || inp.codePressed(NUMPAD_CODES[i])) this.selectSlot(i);
    }
    if (this.mode !== 'drone') {
      this.wheelAcc += inp.takeWheel();
      const steps = Math.trunc(this.wheelAcc / 50);
      if (steps !== 0) {
        this.wheelAcc -= steps * 50;
        this.selectSlot((((this.selectedSlot() + Math.sign(steps)) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS);
      }
    }
  }

  private selectSlot(slot: number): void {
    if (slot === this.selectedSlot()) return;
    this.dispatch({ type: 'player/selectSlot', slot });
    this.interaction.cancel();
  }

  // ---- movement ---------------------------------------------------------------------------------------
  private updateMovement(dt: number, inputOn: boolean) {
    const inp = this.input;
    const b = this.body;
    const flying = this.mode === 'fly' || (this.mode === 'drone' && this.bodyMode === 'fly');
    const it: MoveIntent = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };
    this.lookDX = this.lookDY = 0;
    if (this.mode !== 'drone') {
      const m = inp.takeMouse();
      if (inputOn && this.app.pointerLocked) {
        const k = LOOK.radiansPerPixel * (this.ctx.settings.mouseSensitivity || 1);
        this.yaw -= m.dx * k;
        this.pitch -= m.dy * k * (this.ctx.settings.invertY ? -1 : 1);
        this.pitch = THREE.MathUtils.clamp(this.pitch, -LOOK.maxPitch, LOOK.maxPitch);
        this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        this.lookDX = m.dx;
        this.lookDY = m.dy;
      }
      if (inputOn) {
        const f = (inp.down('forward') ? 1 : 0) - (inp.down('back') ? 1 : 0);
        const s = (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0);
        it.jump = inp.down('jump');
        it.sneak = inp.down('sneak');
        // MC-style sprint: tap sprint (or double-tap forward) latches until you stop, sneak or run into a wall.
        if (inp.pressed('sprint') || inp.doubleTapped('forward')) this.sprintLatched = true;
        const moving = flying ? f !== 0 || s !== 0 : f > 0;
        const groundSneak = it.sneak && !flying;
        if (!moving || groundSneak || (b.collidedH && !flying && !b.inLiquid)) this.sprintLatched = false;
        it.sprint = moving && !groundSneak && (this.sprintLatched || inp.down('sprint'));
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        let mx = -sin * f + cos * s;
        let mz = -cos * f - sin * s;
        const l = Math.hypot(mx, mz);
        if (l > 1) {
          mx /= l;
          mz /= l;
        }
        it.moveX = mx;
        it.moveZ = mz;
        this.strafe = s;
        if (inp.pressed('jump')) b.jumpBuffer = WALK.jumpBuffer;
      } else {
        this.sprintLatched = false;
        this.strafe = 0;
      }
    }
    const ev = newStepEvents();
    stepBody(b, it, flying, this.query, dt, ev);
    // Clamp inside the world.
    const w = this.ctx.world;
    const hw = BODY.halfWidth;
    b.x = THREE.MathUtils.clamp(b.x, hw, w.sizeX - hw);
    b.z = THREE.MathUtils.clamp(b.z, hw, w.sizeZ - hw);
    if (b.y > w.height + 48) {
      b.y = w.height + 48;
      b.vy = Math.min(0, b.vy);
    }
    if (b.y < -24 && !this.dead) {
      this.health.damage(1e6, 'void');
      if (!this.dead) this.handleRespawn(this.respawnFallback());
    }

    const bus = this.ctx.bus;
    if (ev.jumped) bus.emit('player:jump', {});
    if (ev.landed !== null && ev.landed > 2) {
      bus.emit('player:land', { speed: ev.landed });
      const under = this.blockUnderFeet();
      bus.emit('player:footstep', { x: b.x, y: b.y, z: b.z, block: under });
    }
    if (ev.landed !== null) this.health.landed(ev.fallDistance, b.inLiquid);
    if (ev.splashed) bus.emit('audio:play', { sound: 'splash', at: { x: b.x, y: b.y, z: b.z } });
    if (ev.flyTouchdown && this.mode === 'fly') this.setMode('walk');
    return ev;
  }

  private blockUnderFeet(): number {
    const b = this.body;
    const w = this.ctx.world;
    const y = Math.floor(b.y - 0.05);
    const hw = BODY.halfWidth - 0.05;
    const probes: [number, number][] = [[b.x, b.z], [b.x - hw, b.z - hw], [b.x + hw, b.z - hw], [b.x - hw, b.z + hw], [b.x + hw, b.z + hw]];
    for (const [x, z] of probes) {
      const ix = Math.floor(x), iz = Math.floor(z);
      if (!w.inBounds(ix, y, iz)) continue;
      const id = w.getBlock(ix, y, iz);
      if (BLOCKS[id].solid) return id;
    }
    return 0;
  }

  // ---- camera -----------------------------------------------------------------------------------------
  private updateCamera(dt: number, inputOn: boolean, ev = newStepEvents()): void {
    const cam = this.host.camera;
    const baseFov = this.ctx.settings.fov || 75;
    if (this.mode === 'drone') {
      const inp = this.input;
      const canvas = this.host.canvas;
      this.drone.update(dt, inp, inputOn, {
        forward: inputOn && inp.down('forward'), back: inputOn && inp.down('back'), left: inputOn && inp.down('left'), right: inputOn && inp.down('right'),
        sprint: inputOn && inp.down('sprint'),
      }, { w: canvas.clientWidth || canvas.width, h: canvas.clientHeight || canvas.height }, () => this.cursorGround());
      this.drone.apply(cam, baseFov);
    } else {
      const b = this.body;
      const footstep = this.fp.update(dt, {
        speedH: Math.hypot(b.vx, b.vz), grounded: b.onGround, flying: this.mode === 'fly', sprinting: this.isSprinting(),
        sneaking: inputOn && this.input.down('sneak') && this.mode === 'walk', swimming: b.inLiquid, strafe: this.strafe,
        steppedUp: ev.steppedUp, landed: ev.landed, dead: this.dead,
      });
      this.fp.apply(cam, b, this.yaw, this.pitch, baseFov);
      if (footstep && !b.inLiquid) {
        const under = this.blockUnderFeet();
        if (under) this.ctx.bus.emit('player:footstep', { x: b.x, y: b.y, z: b.z, block: under });
      }
    }
    cam.updateMatrixWorld();
  }

  private isSprinting(): boolean {
    const b = this.body;
    if (this.mode === 'fly') return this.input.down('sprint') || this.sprintLatched;
    return (this.sprintLatched || this.input.down('sprint')) && Math.hypot(b.vx, b.vz) > WALK.walkSpeed + 0.2;
  }

  /** Ground point under the drone cursor (for zoom-to-cursor). */
  private cursorGround(): THREE.Vector3 | null {
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    const c = this.host.canvas;
    DroneCamera.cursorRay(this.host.camera, this.input.cursorX, this.input.cursorY, c.clientWidth || c.width, c.clientHeight || c.height, o, d);
    const saveO = this.rayOrigin.clone(), saveD = this.rayDir.clone();
    this.rayOrigin.copy(o);
    this.rayDir.copy(d);
    const t = this.targeting.pick(DRONE.pickRange);
    this.rayOrigin.copy(saveO);
    this.rayDir.copy(saveD);
    return t.hit ? new THREE.Vector3(t.hit.point.x, t.hit.point.y, t.hit.point.z) : null;
  }

  // ---- picking & interaction --------------------------------------------------------------------------
  private updatePick(): void {
    const cam = this.host.camera;
    let valid = true;
    if (this.mode === 'drone') {
      const c = this.host.canvas;
      valid = this.input.cursorInside;
      DroneCamera.cursorRay(cam, this.input.cursorX, this.input.cursorY, c.clientWidth || c.width, c.clientHeight || c.height, this.rayOrigin, this.rayDir);
    } else {
      this.rayOrigin.copy(cam.position);
      this.rayDir.copy(fwd.set(0, 0, -1).applyQuaternion(cam.quaternion));
    }
    const range = this.mode === 'drone' ? DRONE.pickRange : this.build.active || this.pipe.active ? INTERACT.buildReach : Tools.range(this.selectedItem());
    this.target = valid && !this.dead ? this.targeting.pick(range) : { kind: 'none', hit: null };
    this.targeting.publish(this.target);
  }

  private actions(inputOn: boolean): Actions {
    if (!inputOn) return NO_ACTIONS;
    const inp = this.input;
    if (this.mode === 'drone') {
      const click = inp.dragDistance(2) <= DRONE.dragThreshold;
      return {
        primaryPressed: inp.buttonPressed(0) && inp.cursorInside,
        primaryHeld: inp.button(0) && inp.cursorInside,
        secondaryPressed: inp.buttonReleased(2) && click && inp.cursorInside,
        secondaryHeld: inp.button(2) && click && inp.cursorInside,
      };
    }
    if (!this.app.pointerLocked) return NO_ACTIONS;
    return { primaryPressed: inp.buttonPressed(0), primaryHeld: inp.button(0), secondaryPressed: inp.buttonPressed(2), secondaryHeld: inp.button(2) };
  }

  private updateInteraction(dt: number, inputOn: boolean): void {
    const act = this.actions(inputOn);
    const t = this.target;
    if (this.build.active) {
      this.interaction.cancel();
      this.build.update(dt, act, t);
      this.targeting.highlight(null, 0, null);
      return;
    }
    if (this.pipe.active) {
      this.interaction.cancel();
      this.pipe.update(dt, act, t);
      this.targeting.highlight(null, 0, null);
      return;
    }
    if (!inputOn) this.interaction.cancel();
    else this.interaction.update(dt, act, t);
    const prog = this.interaction.progress;
    if (t.kind === 'block' && t.hit) this.targeting.highlight({ x: t.hit.x, y: t.hit.y, z: t.hit.z }, prog, null);
    else if (t.building && t.hit) this.targeting.highlight(prog > 0 ? { x: t.hit.x, y: t.hit.y, z: t.hit.z } : null, prog, t.building);
    else this.targeting.highlight(null, 0, null);
  }

  // ---- modes ------------------------------------------------------------------------------------------
  private setMode(mode: PlayerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'drone') this.bodyMode = mode;
    if (mode === 'fly') {
      this.body.vy = Math.max(this.body.vy, 0);
      this.ctx.bus.emit('audio:play', { sound: 'fly_toggle', volume: 0.5 });
    }
    this.dispatch({ type: 'player/setMode', mode });
    this.syncNow();
  }

  private enterDrone(): void {
    if (this.dead) return;
    this.bodyMode = this.mode === 'fly' ? 'fly' : 'walk';
    this.interaction.cancel();
    this.drone.enter(this.body.x, this.body.z, this.yaw);
    this.setMode('drone');
    this.body.vx = this.body.vz = 0;
    this.app.exitPointerLock();
    this.ctx.bus.emit('audio:play', { sound: 'drone_on', volume: 0.6 });
  }

  private exitDrone(): void {
    this.setMode(this.bodyMode);
    this.interaction.cancel();
    if (!this.app.uiCapturing) this.app.requestPointerLock();
    this.ctx.bus.emit('audio:play', { sound: 'drone_off', volume: 0.6 });
  }

  // ---- health -------------------------------------------------------------------------------------------
  private handleDeath(): void {
    this.dead = true;
    if (this.mode === 'drone') this.setMode(this.bodyMode);
    this.interaction.cancel();
    this.viewmodel.setFade(0.92, 0x1a0000);
    this.syncNow();
  }

  private handleRespawn(at: Vec3): void {
    const b = this.body;
    b.x = at.x;
    b.y = at.y;
    b.z = at.z;
    b.vx = b.vy = b.vz = 0;
    b.fallStartY = at.y;
    b.onGround = false;
    this.ensureChunks();
    this.unstick();
    this.dead = false;
    this.viewmodel.setFade(0);
    this.syncNow();
  }

  private respawnFallback(): Vec3 {
    const w = this.ctx.world;
    const x = Math.floor(w.sizeX / 2), z = Math.floor(w.sizeZ / 2);
    return { x: x + 0.5, y: w.getSurfaceY(x, z), z: z + 0.5 };
  }

  // ---- world helpers ----------------------------------------------------------------------------------
  /** Make sure the chunks under the body exist so physics never falls through ungenerated terrain. */
  private ensureChunks(): void {
    const w = this.ctx.world;
    const b = this.body;
    const hw = BODY.halfWidth + 1;
    for (const [x, z] of [[b.x - hw, b.z - hw], [b.x + hw, b.z - hw], [b.x - hw, b.z + hw], [b.x + hw, b.z + hw]]) {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      if (cx < 0 || cz < 0 || cx >= w.chunksX || cz >= w.chunksZ) continue;
      if (!w.isChunkGenerated(cx, cz)) w.ensureChunk(cx, cz);
    }
  }

  /** Lift the body out of solid blocks (bad saves, terrain edits, respawn points). */
  private unstick(): void {
    const b = this.body;
    const hw = BODY.halfWidth;
    let guard = 0;
    while (guard++ < 256 && boxOverlapsSolid(this.query, { minX: b.x - hw, minY: b.y, minZ: b.z - hw, maxX: b.x + hw, maxY: b.y + BODY.height, maxZ: b.z + hw })) {
      b.y = Math.floor(b.y) + 1;
    }
  }

  private sendSync(force: boolean): void {
    const b = this.body;
    const health = Math.round(this.health.health * 10) / 10;
    const key = `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)},${this.yaw.toFixed(3)},${this.pitch.toFixed(3)},${health}`;
    if (!force && key === this.lastSyncKey) return;
    this.lastSyncKey = key;
    const cmd = {
      type: 'player/sync' as const,
      position: { x: b.x, y: b.y, z: b.z },
      velocity: { x: b.vx, y: b.vy, z: b.vz },
      yaw: this.yaw,
      pitch: this.pitch,
      health,
    };
    this.dispatch(cmd as Command<'player/sync'>);
  }

  // ---- automation hooks (dev harness) -----------------------------------------------------------------
  /** Teleport the body (feet position) and optionally set the view. */
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    const b = this.body;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = b.vy = b.vz = 0;
    b.fallStartY = y;
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    this.unstick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.input.dispose();
    this.build.dispose();
    this.pipe.dispose();
    this.viewmodel.dispose();
    this.targeting.clear();
    this.app.exitPointerLock();
  }
}

export function createPlayerController(host: RenderHost, ctx: GameContext, app: AppShell): PlayerController {
  return new PlayerControllerImpl(host, ctx, app);
}
