// CPU-side atmosphere model: time of day + weather → sun/moon directions, sky gradient, light colours,
// ambient terms and fog. Colours are authored in sRGB and converted to the linear working space.
import * as THREE from 'three';
import type { WeatherState } from '../../core/types';
import { clamp, smoothstep, lerp } from '../util/noise';

interface Key {
  e: number; // sun elevation (sin)
  zenith: number;
  horizon: number;
  glow: number;
}

const SKY_KEYS: Key[] = [
  { e: -1.0, zenith: 0x040916, horizon: 0x101a33, glow: 0x000000 },
  { e: -0.3, zenith: 0x060c1e, horizon: 0x15213f, glow: 0x000000 },
  { e: -0.14, zenith: 0x0a1633, horizon: 0x252b4e, glow: 0x2a1c40 },
  { e: -0.05, zenith: 0x1a2c5a, horizon: 0x7a4c5c, glow: 0xb2442a },
  { e: 0.02, zenith: 0x33548f, horizon: 0xe8905a, glow: 0xff7a30 },
  { e: 0.1, zenith: 0x4474b8, horizon: 0xf2c49a, glow: 0xffa860 },
  { e: 0.28, zenith: 0x3d7bcc, horizon: 0xb9d5ee, glow: 0xffe8c8 },
  { e: 1.0, zenith: 0x2a66c2, horizon: 0xa3c8ec, glow: 0xfff6ea },
];

const SUN_KEYS: { e: number; c: number }[] = [
  { e: -0.02, c: 0xff5a20 },
  { e: 0.04, c: 0xff8a45 },
  { e: 0.14, c: 0xffc690 },
  { e: 0.35, c: 0xfff0dc },
  { e: 1.0, c: 0xfff6ec },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function keyColor(keys: { e: number }[], get: (k: any) => number, e: number, out: THREE.Color) {
  if (e <= keys[0].e) return out.setHex(get(keys[0]));
  for (let i = 1; i < keys.length; i++) {
    if (e <= keys[i].e) {
      const a = keys[i - 1];
      const b = keys[i];
      const t = (e - a.e) / (b.e - a.e);
      tmpA.setHex(get(a));
      tmpB.setHex(get(b));
      return out.copy(tmpA).lerp(tmpB, t);
    }
  }
  return out.setHex(get(keys[keys.length - 1]));
}

function desaturate(c: THREE.Color, amount: number, tint = [0.96, 0.98, 1.02]) {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.r = lerp(c.r, l * tint[0], amount);
  c.g = lerp(c.g, l * tint[1], amount);
  c.b = lerp(c.b, l * tint[2], amount);
  return c;
}

export interface Atmosphere {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunElev: number;
  /** Direction/colour of the active shadow-casting light (sun by day, moon by night). */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIsSun: boolean;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunGlow: THREE.Color;
  sunDisk: THREE.Color;
  fogSun: THREE.Color;
  skyAmbient: THREE.Color;
  groundAmbient: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  starVis: number;
  moonPhase: number;
  moonBright: number;
  daylight: number;
  overcast: number;
  storm: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
  windDir: THREE.Vector2;
  windStrength: number;
  precipitation: number;
  snow: boolean;
}

export function createAtmosphere(): Atmosphere {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, -1, 0),
    sunElev: 1,
    lightDir: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(),
    lightIsSun: true,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunGlow: new THREE.Color(),
    sunDisk: new THREE.Color(),
    fogSun: new THREE.Color(),
    skyAmbient: new THREE.Color(),
    groundAmbient: new THREE.Color(),
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
    starVis: 0,
    moonPhase: 0.5,
    moonBright: 1,
    daylight: 1,
    overcast: 0,
    storm: 0,
    fogNear: 60,
    fogFar: 120,
    fogDensity: 0.002,
    windDir: new THREE.Vector2(1, 0),
    windStrength: 0.3,
    precipitation: 0,
    snow: false,
  };
}

const WEATHER_OVERCAST: Record<string, number> = {
  clear: 0, cloudy: 0.25, overcast: 0.75, rain: 0.8, storm: 1, snow: 0.7, blizzard: 1, fog: 0.55, heatwave: 0, hurricane: 1,
};
const WEATHER_STORM: Record<string, number> = { storm: 0.75, hurricane: 1, blizzard: 0.6, rain: 0.2 };

/**
 * Update the atmosphere in place.
 * @param minuteOfDay 0..1440
 * @param day game day (moon phase)
 * @param viewDistance terrain view distance in blocks
 */
export function updateAtmosphere(a: Atmosphere, minuteOfDay: number, day: number, w: WeatherState, viewDistance: number, flash: number) {
  // ---- celestial geometry -------------------------------------------------------------------
  const t = minuteOfDay / 1440; // 0 = midnight
  const ang = t * Math.PI * 2 - Math.PI / 2; // 06:00 → 0 (east horizon), 12:00 → π/2 (zenith)
  const tilt = 0.42; // sun path leans south so noon shadows have direction
  a.sunDir.set(Math.cos(ang), Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt) * 0.55 + 0.18).normalize();
  const mAng = ang + Math.PI + 0.25;
  a.moonDir.set(Math.cos(mAng), Math.sin(mAng) * Math.cos(tilt * 0.8), -0.22 + Math.sin(mAng) * 0.2).normalize();
  const e = a.sunDir.y;
  a.sunElev = e;
  a.moonPhase = (((day - 1) % 12) + 12) % 12 / 12 + (t * 1) / 12; // 12-day lunar cycle, 0 = new, 0.5 = full
  a.moonPhase %= 1;
  a.moonBright = 0.25 + 0.75 * (1 - Math.abs(a.moonPhase - 0.5) * 2);

  // ---- weather factors ------------------------------------------------------------------------
  const kind = w.current;
  const inten = clamp(w.intensity, 0, 1);
  const cover = clamp(w.cloudCover, 0, 1);
  a.overcast = clamp(Math.max(smoothstep(0.35, 1, cover), (WEATHER_OVERCAST[kind] ?? 0) * (0.6 + 0.4 * inten)), 0, 1);
  a.storm = clamp((WEATHER_STORM[kind] ?? 0) * (0.5 + 0.5 * inten), 0, 1);
  a.precipitation = clamp(w.precipitation, 0, 1);
  a.snow = kind === 'snow' || kind === 'blizzard' || (a.precipitation > 0 && w.temperature < 0.5);
  a.windDir.set(Math.cos(w.windDir), Math.sin(w.windDir));
  a.windStrength = clamp(w.windSpeed / 18, 0, 1.5);
  const oc = a.overcast;
  const dark = 1 - a.storm * 0.55;

  // ---- sky gradient -----------------------------------------------------------------------------
  keyColor(SKY_KEYS, (k: Key) => k.zenith, e, a.zenith);
  keyColor(SKY_KEYS, (k: Key) => k.horizon, e, a.horizon);
  keyColor(SKY_KEYS, (k: Key) => k.glow, e, a.sunGlow);
  desaturate(a.zenith, oc * 0.85).multiplyScalar(lerp(1, 0.72, oc) * dark);
  desaturate(a.horizon, oc * 0.8).multiplyScalar(lerp(1, 0.9, oc) * dark);
  // overcast skies are brighter near the horizon and flatter overall
  if (oc > 0) a.zenith.lerp(a.horizon, oc * 0.55);
  a.sunGlow.multiplyScalar((1 - oc * 0.8) * dark);
  a.fogSun.copy(a.sunGlow).multiplyScalar(0.55 * smoothstep(-0.2, 0.05, e) * (1 - smoothstep(0.35, 0.9, e) * 0.6));

  keyColor(SUN_KEYS, (k: { c: number }) => k.c, e, a.sunDisk);
  const sunI = smoothstep(-0.03, 0.22, e) * 2.25 * (1 - oc * 0.82) * dark;
  const sunCol = tmpA.copy(a.sunDisk).multiplyScalar(sunI);
  a.sunDisk.multiplyScalar(1 - oc * 0.92);

  // ---- lights -------------------------------------------------------------------------------
  const moonE = a.moonDir.y;
  const moonI = smoothstep(-0.02, 0.2, moonE) * 0.42 * a.moonBright * (1 - oc * 0.7) * dark;
  const moonCol = tmpB.setRGB(0.55, 0.68, 1.0).multiplyScalar(moonI);
  if (e > -0.035) {
    a.lightIsSun = true;
    a.lightDir.copy(a.sunDir);
    if (a.lightDir.y < 0.02) a.lightDir.y = 0.02; // keep shadows sane right at the horizon
    a.lightDir.normalize();
    a.lightColor.copy(sunCol);
  } else {
    a.lightIsSun = false;
    a.lightDir.copy(a.moonDir);
    if (a.lightDir.y < 0.05) a.lightDir.y = 0.05;
    a.lightDir.normalize();
    a.lightColor.copy(moonCol);
  }

  // ambient: sky dome irradiance
  const dayF = smoothstep(-0.18, 0.3, e);
  a.daylight = clamp(smoothstep(-0.12, 0.25, e) * (1 - 0.45 * oc) * dark, 0, 1);
  const skyDay = new THREE.Color(0x9cc4f2).multiplyScalar(1.1);
  const skyNight = new THREE.Color(0x3a4c7c).multiplyScalar(0.22 + 0.14 * a.moonBright);
  a.skyAmbient.copy(skyNight).lerp(skyDay, dayF);
  // warm the ambient during golden hour
  const golden = smoothstep(-0.08, 0.05, e) * (1 - smoothstep(0.08, 0.3, e));
  a.skyAmbient.lerp(new THREE.Color(0xd8a080).multiplyScalar(0.6), golden * 0.35);
  desaturate(a.skyAmbient, oc * 0.6);
  a.skyAmbient.multiplyScalar(lerp(1, 1.12, oc * dayF) * dark);
  const gDay = new THREE.Color(0x8a7a62).multiplyScalar(0.62);
  const gNight = new THREE.Color(0x141a28).multiplyScalar(0.5);
  a.groundAmbient.copy(gNight).lerp(gDay, dayF).multiplyScalar(dark);

  if (flash > 0) {
    a.skyAmbient.addScalar(flash * 0.9);
    a.zenith.lerp(new THREE.Color(0.75, 0.8, 1.0), flash * 0.7);
    a.horizon.lerp(new THREE.Color(0.8, 0.82, 0.95), flash * 0.6);
  }

  // clouds: lit tops / shaded bellies
  a.cloudLit.copy(a.horizon).lerp(new THREE.Color(1, 1, 1), 0.55 * dayF).multiplyScalar(0.55 + 0.6 * dayF);
  a.cloudLit.add(tmpA.copy(sunCol).multiplyScalar(0.28));
  a.cloudShade.copy(a.zenith).lerp(a.horizon, 0.6).multiplyScalar(0.8);
  desaturate(a.cloudLit, oc * 0.7).multiplyScalar(lerp(1, 0.72, oc) * dark);
  desaturate(a.cloudShade, oc * 0.7).multiplyScalar(lerp(1, 0.6, oc) * dark);

  a.starVis = smoothstep(-0.04, -0.22, e) * (1 - oc);

  // ---- fog -------------------------------------------------------------------------------------
  let far = viewDistance * 0.96;
  let near = viewDistance * 0.5;
  let density = 0.0011 + oc * 0.003;
  if (kind === 'fog') {
    far = Math.min(far, lerp(140, 40, inten));
    near = 2;
    density = lerp(0.02, 0.06, inten);
  } else if (kind === 'blizzard') {
    far = Math.min(far, lerp(80, 30, inten));
    near = 2;
    density = 0.04;
  } else if (kind === 'storm' || kind === 'hurricane') {
    far = Math.min(far, lerp(far, 70, inten));
    near = Math.min(near, far * 0.3);
    density += 0.008 * inten;
  } else if (kind === 'rain' || kind === 'snow') {
    far = Math.min(far, lerp(far, 110, inten));
    near = Math.min(near, far * 0.4);
    density += 0.005 * inten;
  } else if (kind === 'heatwave') {
    density += 0.002;
    a.horizon.lerp(new THREE.Color(0xe8d8b8), 0.25);
  }
  a.fogNear = near;
  a.fogFar = Math.max(near + 8, far);
  a.fogDensity = density;
}
