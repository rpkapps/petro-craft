// First-person camera: eye height, head-bob with footstep cadence, lateral sway, landing dip spring,
// smoothed auto step-up, sneak crouch, sprint FOV kick and death roll.
import * as THREE from 'three';
import { BODY, CAMERA } from './config';
import type { Body } from './physics';

export interface FirstPersonInput {
  speedH: number;
  grounded: boolean;
  flying: boolean;
  sprinting: boolean;
  sneaking: boolean;
  swimming: boolean;
  /** −1..1 strafe input (right positive). */
  strafe: number;
  steppedUp: number;
  landed: number | null;
  dead: boolean;
}

const approach = (v: number, t: number, rate: number, dt: number) => v + (t - v) * (1 - Math.exp(-rate * dt));
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const right = new THREE.Vector3();

export class FirstPersonCamera {
  bobPhase = 0;
  bobAmount = 0;
  private stepOffset = 0;
  private dip = 0;
  private dipVel = 0;
  private roll = 0;
  private sneakDrop = 0;
  private fovMul = 1;
  private deathT = 0;
  private swimT = 0;
  private swimAmt = 0;

  /** Advance camera effects. Returns true when a footstep lands this frame. */
  update(dt: number, s: FirstPersonInput): boolean {
    let footstep = false;
    const walking = s.grounded && !s.flying && !s.dead && s.speedH > 0.4;
    this.bobAmount = approach(this.bobAmount, walking ? Math.min(1.2, s.speedH / 4.3) : 0, 10, dt);
    if (walking) {
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += (s.speedH * dt * Math.PI) / CAMERA.strideLength;
      if (Math.floor(this.bobPhase / Math.PI) !== before) footstep = true;
    } else if (this.bobAmount < 0.02) {
      // Settle the phase to the nearest footfall so the next step starts cleanly.
      this.bobPhase = Math.round(this.bobPhase / Math.PI) * Math.PI;
    }
    this.swimT += dt;
    this.swimAmt = approach(this.swimAmt, s.swimming ? 1 : 0, 3, dt);

    this.stepOffset = Math.max(-1.2, this.stepOffset - s.steppedUp);
    this.stepOffset = approach(this.stepOffset, 0, CAMERA.stepSmoothRate, dt);

    if (s.landed !== null && s.landed > 3) this.dipVel -= Math.min(5, s.landed * 0.3);
    const acc = -CAMERA.landSpring * this.dip - CAMERA.landDamping * this.dipVel;
    this.dipVel += acc * dt;
    this.dip = Math.max(-0.5, Math.min(0.2, this.dip + this.dipVel * dt));

    this.sneakDrop = approach(this.sneakDrop, s.sneaking && !s.flying ? BODY.sneakEyeDrop : 0, 14, dt);
    this.roll = approach(this.roll, -s.strafe * CAMERA.strafeRoll * (s.flying ? 2.5 : 1), 6, dt);
    const moving = s.speedH > 1;
    const fovTarget = s.dead ? 0.95 : s.sprinting && moving ? (s.flying ? CAMERA.flySprintFovKick : CAMERA.sprintFovKick) : s.swimming ? 0.94 : 1;
    this.fovMul = approach(this.fovMul, fovTarget, CAMERA.fovRate, dt);
    this.deathT = s.dead ? this.deathT + dt : 0;
    return footstep;
  }

  /** Write position, orientation and FOV into the camera. */
  apply(camera: THREE.PerspectiveCamera, body: Body, yaw: number, pitch: number, baseFov: number): void {
    const a = this.bobAmount;
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * CAMERA.bobVertical * a + Math.sin(this.swimT * 1.7) * 0.035 * this.swimAmt;
    const bobX = Math.sin(this.bobPhase) * CAMERA.bobLateral * a;
    const death = Math.min(1, this.deathT / 0.6);
    const deathEase = 1 - (1 - death) ** 3;
    let eyeY = body.y + BODY.eyeHeight - this.sneakDrop + this.stepOffset + this.dip + bobY;
    eyeY -= deathEase * (BODY.eyeHeight - 0.3);
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    camera.position.set(body.x + right.x * bobX, eyeY, body.z + right.z * bobX);
    const roll = this.roll + Math.sin(this.bobPhase) * CAMERA.bobRoll * a + deathEase * 1.1;
    euler.set(pitch + this.dip * 0.12, yaw, roll, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    const fov = baseFov * this.fovMul;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}

/** Unit forward vector for yaw/pitch (three.js convention: yaw 0 looks towards −Z). */
export function lookDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
