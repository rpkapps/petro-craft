// RTS-style drone (management) camera: free cursor, WASD/arrow + screen-edge panning relative to heading,
// wheel zoom towards the cursor (height above terrain), right/middle-drag orbit & tilt, terrain following.
import * as THREE from 'three';
import { SEA_LEVEL } from '../core/constants';
import { B } from '../core/blocks';
import type { IWorld } from '../core/types';
import { DRONE } from './config';
import type { InputManager } from './input';

const approach = (v: number, t: number, rate: number, dt: number) => v + (t - v) * (1 - Math.exp(-rate * dt));
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmp = new THREE.Vector3();

export class DroneCamera {
  /** Smoothed and target focus point on the ground. */
  readonly focus = new THREE.Vector3();
  readonly targetFocus = new THREE.Vector3();
  yaw = 0;
  /** Tilt below the horizon (radians). */
  tilt: number = DRONE.startPitch;
  height: number = DRONE.startHeight;
  targetHeight: number = DRONE.startHeight;
  private groundY = 64;
  private vx = 0;
  private vz = 0;
  private orbiting = false;

  constructor(private readonly world: IWorld) {}

  /** Start above a point, looking along `yaw`. */
  enter(x: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.tilt = DRONE.startPitch;
    this.targetHeight = this.height = DRONE.startHeight;
    this.vx = this.vz = 0;
    const back = this.height / Math.tan(this.tilt);
    // Put the focus ahead of the player so the body is visible near the bottom of the view.
    const fx = x - Math.sin(yaw) * back * 0.35, fz = z - Math.cos(yaw) * back * 0.35;
    this.focus.set(fx, 0, fz);
    this.targetFocus.copy(this.focus);
    this.groundY = this.sampleGround(fx, fz);
    this.focus.y = this.targetFocus.y = this.groundY;
  }

  /** Smoothly move the focus to a world point (used by 'ui:focus'). */
  flyTo(x: number, z: number, height = 48): void {
    this.targetFocus.set(x, this.sampleGround(x, z), z);
    this.targetHeight = Math.max(this.targetHeight, height);
  }

  /** Whether the current right/middle drag is orbiting (so a release is not a click). */
  get isOrbiting(): boolean {
    return this.orbiting;
  }

  /**
   * Update from input. `pickGround` returns the ground point under the cursor (for zoom-to-cursor) or null.
   * `enabled` is false while UI captures input.
   */
  update(dt: number, input: InputManager, enabled: boolean, keys: { forward: boolean; back: boolean; left: boolean; right: boolean; sprint: boolean },
    viewport: { w: number; h: number }, pickGround: () => THREE.Vector3 | null): void {
    // --- orbit / tilt (right or middle drag)
    const { dx, dy } = input.takeMouse();
    const dragBtn = input.button(2) ? 2 : input.button(1) ? 1 : -1;
    if (enabled && dragBtn >= 0 && input.dragDistance(dragBtn) > DRONE.dragThreshold) {
      this.orbiting = true;
      this.yaw -= dx * DRONE.rotatePerPixel;
      this.tilt = THREE.MathUtils.clamp(this.tilt + dy * DRONE.tiltPerPixel, DRONE.minPitch, DRONE.maxPitch);
    } else if (dragBtn < 0) this.orbiting = false;

    // --- zoom towards the cursor
    const wheel = enabled ? input.takeWheel() : 0;
    if (wheel !== 0) {
      const oldH = this.targetHeight;
      const newH = THREE.MathUtils.clamp(oldH * Math.exp(wheel * DRONE.zoomPerPixel), DRONE.minHeight, DRONE.maxHeight);
      const g = input.cursorInside ? pickGround() : null;
      if (g && newH !== oldH) {
        const f = 1 - newH / oldH;
        this.targetFocus.x += (g.x - this.targetFocus.x) * f;
        this.targetFocus.z += (g.z - this.targetFocus.z) * f;
      }
      this.targetHeight = newH;
    }

    // --- panning: keys + screen edges
    let mx = 0, mz = 0;
    if (enabled) {
      if (keys.forward || input.codeDown('ArrowUp')) mz -= 1;
      if (keys.back || input.codeDown('ArrowDown')) mz += 1;
      if (keys.left || input.codeDown('ArrowLeft')) mx -= 1;
      if (keys.right || input.codeDown('ArrowRight')) mx += 1;
      if (input.cursorInside && dragBtn < 0 && document.hasFocus()) {
        const e = DRONE.edgePixels;
        if (input.cursorX <= e) mx -= 1;
        else if (input.cursorX >= viewport.w - e) mx += 1;
        if (input.cursorY <= e) mz -= 1;
        else if (input.cursorY >= viewport.h - e) mz += 1;
      }
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = (DRONE.panSpeedBase + this.height * DRONE.panSpeedPerHeight) * (keys.sprint ? DRONE.sprintMultiplier : 1);
    // Local (right, back) → world using heading.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (mx * cos + mz * sin) * speed;
    const wz = (-mx * sin + mz * cos) * speed;
    this.vx = approach(this.vx, wx, DRONE.panAccel, dt);
    this.vz = approach(this.vz, wz, DRONE.panAccel, dt);
    this.targetFocus.x += this.vx * dt;
    this.targetFocus.z += this.vz * dt;
    this.targetFocus.x = THREE.MathUtils.clamp(this.targetFocus.x, 0, this.world.sizeX);
    this.targetFocus.z = THREE.MathUtils.clamp(this.targetFocus.z, 0, this.world.sizeZ);

    // --- smoothing & terrain following
    this.height = approach(this.height, this.targetHeight, DRONE.zoomRate, dt);
    this.focus.x = approach(this.focus.x, this.targetFocus.x, 14, dt);
    this.focus.z = approach(this.focus.z, this.targetFocus.z, 14, dt);
    this.groundY = approach(this.groundY, this.sampleGround(this.focus.x, this.focus.z), DRONE.followRate, dt);
    this.focus.y = this.groundY;
  }

  /** Write the camera transform. */
  apply(camera: THREE.PerspectiveCamera, baseFov: number): void {
    const back = this.height / Math.tan(this.tilt);
    let cx = this.focus.x + Math.sin(this.yaw) * back;
    let cz = this.focus.z + Math.cos(this.yaw) * back;
    let cy = this.focus.y + this.height;
    cx = THREE.MathUtils.clamp(cx, -64, this.world.sizeX + 64);
    cz = THREE.MathUtils.clamp(cz, -64, this.world.sizeZ + 64);
    const minY = this.sampleGround(cx, cz) + DRONE.cameraClearance;
    if (cy < minY) cy = minY;
    camera.position.set(cx, cy, cz);
    euler.set(-this.tilt, this.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    if (Math.abs(camera.fov - baseFov) > 0.01) {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    }
  }

  /** World-space ray through a canvas pixel. */
  static cursorRay(camera: THREE.PerspectiveCamera, px: number, py: number, w: number, h: number, origin: THREE.Vector3, dir: THREE.Vector3): void {
    camera.updateMatrixWorld();
    const nx = (px / Math.max(1, w)) * 2 - 1, ny = -(py / Math.max(1, h)) * 2 + 1;
    origin.copy(camera.position);
    tmp.set(nx, ny, 0.5).unproject(camera);
    dir.copy(tmp).sub(origin).normalize();
  }

  /** Ground reference height (water surface over seas and lakes). */
  sampleGround(x: number, z: number): number {
    const w = this.world;
    const ix = THREE.MathUtils.clamp(Math.floor(x), 0, w.sizeX - 1);
    const iz = THREE.MathUtils.clamp(Math.floor(z), 0, w.sizeZ - 1);
    let g = w.getSurfaceY(ix, iz);
    if (g <= SEA_LEVEL && w.getBlock(ix, SEA_LEVEL, iz) === B.WATER) g = SEA_LEVEL + 1;
    return g;
  }
}
