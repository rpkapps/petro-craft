// Chunk materials: opaque, alpha-tested cut-out (+ matching shadow depth material), translucent
// water/glass/oil, and the holographic x-ray "ghost" used by the subsurface overlay.
import * as THREE from 'three';
import type { SharedUniforms } from './uniforms';
import {
  COMMON_UNIFORMS_GLSL, FOG_GLSL, NOISE_GLSL, SKY_FN_GLSL, TERRAIN_LIGHTING_GLSL, TERRAIN_VERTEX_GLSL, SHADOW_FRAG_PARS_GLSL,
} from './shaderLib';

const SOLID_FRAGMENT = /* glsl */ `
${SHADOW_FRAG_PARS_GLSL}
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_GLSL}
${TERRAIN_LIGHTING_GLSL}
void main() {
  float layer = floor(vLayer + 0.5);
  vec4 props = texelFetch(uLayerProps, ivec2(int(layer), 0), 0);
  float kind = floor(props.b * 255.0 + 0.5);
  vec2 uv = vUv;
  if (kind == 5.0) {
    float lift = 1.0 - uv.y;
    uv.x += sin(uTime * 11.0 + uv.y * 9.0 + vWorldPos.x * 3.0) * 0.05 * lift;
    uv.y += sin(uTime * 7.0 + vWorldPos.z * 5.0) * 0.035 * lift;
  }
  vec4 tex = texture(uAtlas, vec3(uv, layer));
  #ifdef CUTOUT
  if (tex.a < 0.5) discard;
  #endif
  vec3 N = normalize(vNormal);
  #ifdef CUTOUT
  if (!gl_FrontFacing && abs(N.y) < 0.5) N = -N;
  #endif
  float direct;
  vec3 col = shadeSurface(tex.rgb, N, props, vAo, vSky, vBlock, direct);
  if (kind == 5.0) col = tex.rgb * (uEmissive * 1.3 + 0.8) * (0.85 + 0.15 * sin(uTime * 17.0 + vWorldPos.x * 5.0));
  col = overlayTint(col, tex.rgb, N, props);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const TRANSLUCENT_FRAGMENT = /* glsl */ `
${SHADOW_FRAG_PARS_GLSL}
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_GLSL}
${SKY_FN_GLSL}
${TERRAIN_LIGHTING_GLSL}
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;

vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.958, 0.287);
  vec2 d2 = vec2(-0.371, 0.928);
  vec2 d3 = vec2(0.659, -0.753);
  vec2 d4 = vec2(-0.976, -0.217);
  g += d1 * cos(dot(d1, p) * 1.3 + t * 1.6) * 0.065;
  g += d2 * cos(dot(d2, p) * 2.1 + t * 2.2) * 0.07;
  g += d3 * cos(dot(d3, p) * 3.7 + t * 3.1) * 0.06;
  g += d4 * cos(dot(d4, p) * 5.9 + t * 4.0) * 0.05;
  vec2 q = p * 2.6 + vec2(t * 0.5, t * 0.3);
  float n0 = vnoise(q);
  g += vec2(vnoise(q + vec2(0.15, 0.0)) - n0, vnoise(q + vec2(0.0, 0.15)) - n0) * 0.45;
  return g;
}

void main() {
  float layer = floor(vLayer + 0.5);
  vec4 props = texelFetch(uLayerProps, ivec2(int(layer), 0), 0);
  float kind = floor(props.b * 255.0 + 0.5);
  vec3 N = normalize(vNormal);
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec4 outc;
  if (kind == 1.0 || kind == 2.0) {
    bool top = N.y > 0.5;
    float facing = gl_FrontFacing ? 1.0 : -1.0;
    vec3 n = N * facing;
    if (top) {
      float fade = 1.0 - smoothstep(24.0, 110.0, dist);
      vec2 g = waveGrad(vWorldPos.xz, uTime) * (kind == 2.0 ? 0.2 : 1.0) * (0.35 + 0.65 * fade);
      n = normalize(vec3(-g.x, 1.0, -g.y)) * facing;
    }
    float depth = vAo * 15.0;
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    vec3 refl = skyColor(R);
    float shadow = sunShadow() * cloudShadowAt(vWorldPos);
    float skyL = vSky;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, 0.85) * skyL + uCaveAmbient;
    vec3 lightC = ambient + uSunColor * max(uSunDir.y, 0.0) * shadow * 0.55 + uBlockLightColor * pow(vBlock, 2.2) * 1.5;
    if (kind == 1.0) {
      float dd = 1.0 - exp(-depth * 0.35);
      vec3 body = mix(uWaterShallow, uWaterDeep, dd) * lightC * 0.85;
      float alpha = mix(0.5, 0.9, dd);
      if (top && gl_FrontFacing) {
        float foamN = vnoise(vWorldPos.xz * 2.3 + vec2(uTime * 0.35, -uTime * 0.2)) + 0.3 * sin(uTime * 1.4 + depth * 2.5 + vWorldPos.x);
        float shore = 1.0 - smoothstep(0.0, 1.4, depth - 1.0);
        float foam = shore * smoothstep(0.55, 0.9, foamN);
        body = mix(body, vec3(0.9, 0.95, 1.0) * lightC * 1.15, foam * 0.8);
        alpha = max(alpha, foam * 0.9);
      }
      vec3 col = mix(body, refl * mix(0.35, 1.0, skyL), fres * 0.92 * skyL);
      float rs = max(dot(R, uSunDir), 0.0);
      col += uSunColor * (pow(rs, 380.0) * 10.0 + pow(rs, 42.0) * 0.22) * shadow * skyL;
      alpha = clamp(alpha + fres * 0.55, 0.0, 0.97);
      if (!gl_FrontFacing) {
        // seen from below: Snell's window onto the sky, total internal reflection outside it
        vec3 up = refract(-V, n, 1.33);
        float window = smoothstep(0.58, 0.74, ndv);
        vec3 sky = skyColor(normalize(vec3(up.x, abs(up.y) + 0.05, up.z))) * 1.25;
        vec3 tir = uFogColor * 1.6 + uWaterShallow * lightC * 0.4;
        float shimmer = 0.8 + 0.4 * vnoise(vWorldPos.xz * 1.7 + uTime * 0.6);
        col = mix(tir, sky, window) * shimmer;
        col += uSunColor * pow(max(dot(up, uSunDir), 0.0), 60.0) * 2.0 * window;
        float fogK = fogFactor(dist * 0.5, vWorldPos.y);
        gl_FragColor = vec4(mix(col, uFogColor, fogK), 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }
      outc = vec4(col, alpha);
    } else {
      float th = vnoise(vWorldPos.xz * 1.3 + uTime * 0.05) * 2.0 + ndv * 1.5;
      vec3 irid = 0.5 + 0.5 * cos(6.2831 * (th + vec3(0.0, 0.33, 0.67)));
      vec3 col = vec3(0.012, 0.01, 0.008) * lightC + irid * 0.06 * skyL * (0.4 + fres);
      col += refl * fres * 0.45 * skyL;
      float rs = max(dot(R, uSunDir), 0.0);
      col += uSunColor * pow(rs, 200.0) * 5.0 * shadow;
      outc = vec4(col, 0.94);
    }
  } else {
    vec4 tex = texture(uAtlas, vec3(vUv, layer));
    vec3 n = N * (gl_FrontFacing ? 1.0 : -1.0);
    float direct;
    vec3 col = shadeSurface(tex.rgb, n, props, vAo, vSky, vBlock, direct);
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    col = mix(col, skyColor(R) * vSky, fres * 0.6);
    outc = vec4(col, clamp(tex.a + fres * 0.35, 0.0, 1.0));
  }
  outc.rgb = applyFog(outc.rgb, vWorldPos);
  gl_FragColor = outc;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DEPTH_VERTEX = /* glsl */ `
attribute vec4 aNormal;
attribute vec4 aInfo;
uniform float uTime;
uniform vec3 uWind;
varying vec2 vUv;
flat varying float vLayer;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  float sway = aNormal.w;
  if (sway > 0.001) {
    float ph = dot(worldPosition.xz, vec2(0.37, 0.61)) + worldPosition.y * 0.2;
    float s = sin(uTime * 1.9 + ph) * 0.55 + sin(uTime * 3.3 + ph * 1.7) * 0.25 + sin(uTime * 0.8 + ph * 0.3) * 0.45;
    float amp = 0.035 + uWind.z * 0.07;
    worldPosition.xz += (uWind.xy * 0.6 + vec2(0.4, 0.25)) * s * sway * amp;
  }
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  vUv = uv;
  vLayer = aInfo.x;
}
`;

const DEPTH_FRAGMENT = /* glsl */ `
uniform sampler2DArray uAtlas;
varying vec2 vUv;
flat varying float vLayer;
void main() {
  if (texture(uAtlas, vec3(vUv, floor(vLayer + 0.5))).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

const GHOST_VERTEX = /* glsl */ `
attribute vec4 aNormal;
attribute vec4 aInfo;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vSky;
flat varying float vLayer;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  vWorldPos = worldPosition.xyz;
  vNormal = aNormal.xyz;
  vLayer = aInfo.x;
  vSky = aInfo.z / 255.0;
}
`;

const GHOST_FRAGMENT = /* glsl */ `
uniform sampler2D uLayerProps;
uniform float uXray;
uniform float uTime;
uniform float uGhostStrength;
uniform vec3 uGhostTint;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vSky;
flat varying float vLayer;
void main() {
  vec3 avg = texelFetch(uLayerProps, ivec2(int(floor(vLayer + 0.5)), 1), 0).rgb;
  avg = pow(avg, vec3(2.2));
  vec3 N = normalize(vNormal);
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec3 f = fract(vWorldPos + 1e-3);
  vec3 e = min(f, 1.0 - f);
  vec3 an = abs(N);
  float ed = an.x > 0.5 ? min(e.y, e.z) : (an.y > 0.5 ? min(e.x, e.z) : min(e.x, e.y));
  float w = fwidth(ed) * 1.5 + 0.012;
  float line = 1.0 - smoothstep(0.0, w, ed);
  float lineFade = 1.0 - smoothstep(20.0, 80.0, dist);
  float rim = pow(1.0 - abs(dot(N, V)), 3.0);
  float below = clamp((64.0 - vWorldPos.y) / 90.0, 0.0, 1.0);
  vec3 tint = mix(uGhostTint, vec3(0.32, 0.3, 1.0), below);
  vec3 col = mix(tint, avg * 1.8 + tint * 0.25, 0.3);
  float a = 0.018 + line * 0.16 * lineFade + rim * 0.05;
  if (N.y > 0.5) a += 0.02;
  a *= smoothstep(1.5, 7.0, dist);
  float ring = fract((dist - uTime * 26.0) / 140.0);
  a += smoothstep(0.965, 1.0, ring) * 0.12 * (1.0 - smoothstep(40.0, 220.0, dist));
  // the sky-lit surface shell reads clearly; cave walls stay a faint whisper
  a *= mix(0.16, 1.0, smoothstep(0.15, 0.6, vSky));
  a *= uXray * uGhostStrength;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export interface TerrainMaterialSet {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  cutoutDepth: THREE.ShaderMaterial;
  translucent: THREE.ShaderMaterial;
  ghost: THREE.ShaderMaterial;
  ghostWater: THREE.ShaderMaterial;
  dispose(): void;
}

export function createTerrainMaterials(u: SharedUniforms): TerrainMaterialSet {
  const lightUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
  const withShared = (extra: Record<string, THREE.IUniform>) => ({ ...lightUniforms(), ...u, ...extra }) as Record<string, THREE.IUniform>;

  const opaque = new THREE.ShaderMaterial({
    name: 'terrain-opaque',
    uniforms: withShared({}),
    vertexShader: TERRAIN_VERTEX_GLSL,
    fragmentShader: SOLID_FRAGMENT,
    lights: true,
    side: THREE.FrontSide,
  });
  opaque.shadowSide = THREE.BackSide;

  const cutout = new THREE.ShaderMaterial({
    name: 'terrain-cutout',
    uniforms: withShared({}),
    vertexShader: TERRAIN_VERTEX_GLSL,
    fragmentShader: SOLID_FRAGMENT,
    defines: { CUTOUT: 1 },
    lights: true,
    side: THREE.DoubleSide,
  });

  const cutoutDepth = new THREE.ShaderMaterial({
    name: 'terrain-cutout-depth',
    uniforms: { uAtlas: u.uAtlas, uTime: u.uTime, uWind: u.uWind },
    vertexShader: DEPTH_VERTEX,
    fragmentShader: DEPTH_FRAGMENT,
    side: THREE.DoubleSide,
  });

  const translucent = new THREE.ShaderMaterial({
    name: 'terrain-translucent',
    uniforms: withShared({}),
    vertexShader: TERRAIN_VERTEX_GLSL,
    fragmentShader: TRANSLUCENT_FRAGMENT,
    lights: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const ghostUniforms = (strength: number, tint: THREE.Color) => ({
    uLayerProps: u.uLayerProps,
    uXray: u.uXray,
    uTime: u.uTime,
    uGhostStrength: { value: strength },
    uGhostTint: { value: tint },
  });
  const ghost = new THREE.ShaderMaterial({
    name: 'terrain-xray-ghost',
    uniforms: ghostUniforms(1, new THREE.Color(0.25, 0.85, 1.0)),
    vertexShader: GHOST_VERTEX,
    fragmentShader: GHOST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const ghostWater = new THREE.ShaderMaterial({
    name: 'terrain-xray-water',
    uniforms: ghostUniforms(0.6, new THREE.Color(0.2, 0.5, 1.0)),
    vertexShader: GHOST_VERTEX,
    fragmentShader: GHOST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  return {
    opaque,
    cutout,
    cutoutDepth,
    translucent,
    ghost,
    ghostWater,
    dispose() {
      opaque.dispose();
      cutout.dispose();
      cutoutDepth.dispose();
      translucent.dispose();
      ghost.dispose();
      ghostWater.dispose();
    },
  };
}
