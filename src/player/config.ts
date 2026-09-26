// Tuning constants for the player controller (blocks, seconds, radians). Pure data — no imports from three.
import { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_REACH, PLAYER_WIDTH } from '../core/constants';

export const BODY = {
  halfWidth: PLAYER_WIDTH / 2,
  height: PLAYER_HEIGHT,
  eyeHeight: PLAYER_EYE_HEIGHT,
  /** Eye drop while sneaking. */
  sneakEyeDrop: 0.2,
} as const;

export const WALK = {
  gravity: 32,
  terminalVelocity: 60,
  jumpVelocity: 9,
  walkSpeed: 4.3,
  sprintSpeed: 5.6,
  sneakSpeed: 1.3,
  /** Exponential approach rates (1/s) of horizontal velocity towards the wish velocity. */
  groundAccel: 16,
  groundFriction: 14,
  airAccel: 2.6,
  /** Auto step-up height when walking into a ledge (smoothed by the camera). */
  stepHeight: 1.0,
  sneakStepHeight: 0.6,
  /** Probe depth used by sneak edge protection. */
  sneakEdgeProbe: 0.6,
  /** Grace windows that make jumping feel responsive. */
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  /** Fall height (blocks) that starts hurting. */
  safeFall: 4,
  fallDamagePerBlock: 6,
} as const;

export const SWIM = {
  speed: 2.2,
  sprintSpeed: 3.3,
  accel: 6,
  /** Net downward acceleration when submerged (gravity minus buoyancy). */
  sink: 5,
  drag: 3.2,
  swimUpSpeed: 4,
  swimDownSpeed: 3.5,
  verticalAccel: 12,
  /** Upward kick when pushing against a ledge while swimming up (climb out of water). */
  climbOutVelocity: 6.5,
  /** Air supply in seconds and drowning damage per second once exhausted. */
  airSeconds: 12,
  drownDamage: 10,
} as const;

export const FLY = {
  speed: 10.9,
  sprintSpeed: 24,
  verticalSpeed: 8,
  sprintVerticalSpeed: 14,
  accel: 7,
  verticalAccel: 10,
  /** Max seconds between two Space taps to toggle flight. */
  doubleTapWindow: 0.3,
} as const;

export const LOOK = {
  /** Radians per pixel at sensitivity 1. */
  radiansPerPixel: 0.0022,
  maxPitch: Math.PI / 2 - 0.01,
  /** Pointer-lock movement spikes (Chrome bug) larger than this are ignored. */
  maxEventDelta: 350,
} as const;

export const CAMERA = {
  sprintFovKick: 1.12,
  flySprintFovKick: 1.22,
  fovRate: 9,
  bobVertical: 0.055,
  bobLateral: 0.035,
  bobRoll: 0.0045,
  strideLength: 1.45,
  strafeRoll: 0.012,
  stepSmoothRate: 14,
  landSpring: 170,
  landDamping: 22,
} as const;

export const DRONE = {
  minHeight: 8,
  maxHeight: 220,
  startHeight: 42,
  startPitch: 0.95,
  minPitch: 0.3,
  maxPitch: 1.5,
  panSpeedBase: 10,
  panSpeedPerHeight: 1.05,
  sprintMultiplier: 2.6,
  panAccel: 9,
  zoomPerPixel: 0.0016,
  zoomRate: 9,
  followRate: 5,
  rotatePerPixel: 0.005,
  tiltPerPixel: 0.004,
  edgePixels: 10,
  dragThreshold: 5,
  pickRange: 300,
  cameraClearance: 2.5,
} as const;

export const INTERACT = {
  reach: PLAYER_REACH,
  /** Reach used for placing buildings / pipe runs on foot. */
  buildReach: 64,
  tabletReach: 64,
  handPenalty: 3.3,
  breakCooldown: 0.25,
  creativeBreakCooldown: 0.2,
  placeCooldown: 0.2,
  wrenchHold: 1.5,
  extinguisherInterval: 0.1,
  extinguisherRange: 12,
  extinguisherRadius: 4,
  extinguisherAmount: 0.06,
  scannerCooldown: 1.2,
  detectorInterval: 0.5,
  syncInterval: 0.2,
  hitSoundInterval: 0.24,
  /** In drone view LMB must be held this long before digging starts (clicks select / deselect). */
  droneDigDelay: 0.3,
} as const;

export const HEALTH = {
  max: 100,
  regenDelay: 6,
  regenPerSecond: 1.5,
  fireRadius: 2.5,
  fireRadiusPerIntensity: 3,
  fireDamage: 14,
  h2sRadius: 28,
  h2sDamage: 9,
  damageTick: 0.5,
  respawnDelay: 3,
} as const;

export const BUILD = {
  validateInterval: 0.1,
  revalidateInterval: 0.6,
  ghostFollowRate: 28,
  ghostOpacity: 0.55,
} as const;

export const LINE = {
  maxCells: 400,
  /** Hard cap enforced by the authoritative handler. */
  maxCellsAuthoritative: 600,
} as const;
