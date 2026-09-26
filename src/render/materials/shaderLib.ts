// GLSL snippets shared by the terrain, water, cloud and sky shaders. Keeping fog and the sky gradient
// in one place guarantees the far terrain dissolves exactly into the horizon colour.

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uCaveAmbient;
uniform vec3 uBlockLightColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogDensity;
uniform vec3 uZenith;
uniform float uUnderwater;
uniform float uFlash;
`;

export const FOG_GLSL = /* glsl */ `
vec3 fogTint(vec3 dir) {
  float s = max(dot(dir, uSunDir), 0.0);
  return uFogColor + uFogSunColor * (s * s * s * s * s * s * s * s);
}
float fogFactor(float dist, float worldY) {
  float edge = smoothstep(uFogNear, uFogFar, dist);
  float aerial = 1.0 - exp(-dist * uFogDensity * (0.55 + 0.45 * exp(-max(worldY - 62.0, 0.0) * 0.03)));
  return clamp(max(edge, aerial), 0.0, 1.0);
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  return mix(col, fogTint(dir), fogFactor(dist, wp.y));
}
`;

/** Analytic sky colour used by water reflections (matches the sky dome's main gradient). */
export const SKY_FN_GLSL = /* glsl */ `
vec3 skyColor(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(fogTint(d), uZenith, pow(h, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  col += uFogSunColor * pow(s, 48.0) * 0.6;
  return col;
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** Shared per-vertex attributes → varyings for all chunk passes (incl. wind sway). */
export const TERRAIN_VERTEX_GLSL = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
attribute vec4 aNormal;
attribute vec4 aInfo;
uniform float uTime;
uniform vec3 uWind;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
flat varying float vLayer;
varying float vAo;
varying float vSky;
varying float vBlock;
#ifndef HAS_NORMAL
#define HAS_NORMAL
#endif
void main() {
  vec3 objectNormal = aNormal.xyz;
  float sway = aNormal.w;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  if (sway > 0.001) {
    float ph = dot(worldPosition.xz, vec2(0.37, 0.61)) + worldPosition.y * 0.2;
    float s = sin(uTime * 1.9 + ph) * 0.55 + sin(uTime * 3.3 + ph * 1.7) * 0.25 + sin(uTime * 0.8 + ph * 0.3) * 0.45;
    float amp = 0.035 + uWind.z * 0.07;
    worldPosition.xz += (uWind.xy * 0.6 + vec2(0.4, 0.25)) * s * sway * amp;
    worldPosition.y += s * sway * amp * 0.2;
  }
  vec3 transformedNormal = normalMatrix * objectNormal;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
  vWorldPos = worldPosition.xyz;
  vNormal = objectNormal;
  vUv = uv;
  vLayer = aInfo.x;
  vAo = aInfo.y / 255.0;
  vSky = aInfo.z / 255.0;
  vBlock = aInfo.w / 255.0;
}
`;

/** Shadow-map plumbing for fragment shaders (three's chunks + the receiveShadow flag they expect). */
export const SHADOW_FRAG_PARS_GLSL = /* glsl */ `
#include <common>
#include <packing>
uniform bool receiveShadow;
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
`;

/** Lighting model shared by opaque, cut-out and glass surfaces. */
export const TERRAIN_LIGHTING_GLSL = /* glsl */ `
uniform sampler2DArray uAtlas;
uniform sampler2D uLayerProps;
uniform sampler2D uCloudMap;
uniform vec2 uCloudOffset;
uniform float uCloudScale;
uniform float uCloudHeight;
uniform float uCloudShadow;
uniform float uCloudThreshold;
uniform vec3 uShadowCenter;
uniform float uShadowRadius;
uniform float uEmissive;
uniform float uOverlay;
uniform sampler2D uLeaseMap;
uniform vec4 uLeaseInfo;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
flat varying float vLayer;
varying float vAo;
varying float vSky;
varying float vBlock;

float cloudShadowAt(vec3 p) {
  if (uCloudShadow <= 0.0) return 1.0;
  float sy = max(uSunDir.y, 0.12);
  vec2 q = p.xz + uSunDir.xz / sy * (uCloudHeight - p.y);
  float d = texture2D(uCloudMap, (q - uCloudOffset) * uCloudScale).r;
  return 1.0 - uCloudShadow * smoothstep(uCloudThreshold - 0.06, uCloudThreshold + 0.1, d);
}

float sunShadow() {
  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
  shadow = getShadowMask();
  vec2 sd = abs(vWorldPos.xz - uShadowCenter.xz);
  float edge = max(sd.x, sd.y) / uShadowRadius;
  shadow = mix(shadow, 1.0, smoothstep(0.82, 0.98, edge));
  #endif
  return shadow;
}

vec3 shadeSurface(vec3 albedo, vec3 N, vec4 props, float ao, float sky, float blk, out float directOut) {
  float kind = floor(props.b * 255.0 + 0.5);
  float aoF = ao;
  float skyVis = smoothstep(0.3, 0.8, sky);
  float NdotL = dot(N, uSunDir);
  if (kind == 8.0) NdotL = NdotL * 0.6 + 0.4; // foliage: light wraps through leaves
  float direct = max(NdotL, 0.0) * sunShadow() * cloudShadowAt(vWorldPos) * skyVis;
  directOut = direct;
  float faceShade = N.y > 0.5 ? 1.0 : (N.y < -0.5 ? 0.62 : (abs(N.x) > 0.5 ? 0.84 : 0.76));
  vec3 hemi = mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5);
  vec3 ambient = hemi * (sky * sky * 0.92 + sky * 0.08) * faceShade;
  vec3 blockL = uBlockLightColor * pow(blk, 2.2) * 1.7;
  vec3 light = (ambient + uCaveAmbient) * aoF + uSunColor * direct * mix(1.0, aoF, 0.4) + blockL * mix(1.0, aoF, 0.6);
  light += uFlash * vec3(0.55, 0.6, 0.75) * sky;
  vec3 col = albedo * light;
  // specular sheen for metal, glass, wet surfaces
  float spec = props.g;
  if (spec > 0.0 && direct > 0.0) {
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 Hh = normalize(uSunDir + V);
    float sp = pow(max(dot(N, Hh), 0.0), 40.0 + spec * 60.0);
    col += uSunColor * sp * spec * direct * 0.9;
  }
  col += albedo * props.r * uEmissive;
  return col;
}

vec3 overlayTint(vec3 col, vec3 albedo, vec3 N, vec4 props) {
  if (uOverlay < 0.5) return col;
  float kind = floor(props.b * 255.0 + 0.5);
  if (uOverlay < 1.5) {
    // pipes overlay: dim & desaturate the world, make pipe runs glow
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    if (kind == 3.0) return col * 1.2 + albedo * (1.6 + 0.6 * sin(uTime * 4.0 + dot(vWorldPos, vec3(0.7, 0.3, 0.5))));
    return mix(col, vec3(l) * vec3(0.55, 0.62, 0.72), 0.85) * 0.45;
  }
  // leases overlay: parcel grid + owned parcel tint on upward faces
  vec2 cell = vWorldPos.xz / uLeaseInfo.x;
  vec2 f = fract(cell);
  vec2 e = min(f, 1.0 - f) * uLeaseInfo.x;
  float line = 1.0 - smoothstep(0.0, 0.18, min(e.x, e.y));
  vec2 luv = (floor(cell) + 0.5) / uLeaseInfo.yz;
  vec4 lease = texture2D(uLeaseMap, luv);
  float up = step(0.5, N.y);
  col = mix(col, col * 0.7 + lease.rgb * 0.35, lease.a * up * 0.8);
  col = mix(col, vec3(1.0, 0.55, 0.15) * 1.4, line * up * 0.7);
  return col;
}
`;
