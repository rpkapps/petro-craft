// Shader patches for the merged 'solid' entity material.
//  classic: per-vertex roughness/metalness only (today's look).
//  high/ultra: object-space triplanar detail from the procedural surface texture arrays, selected per
//  part by its surface class — albedo micro-variation, paint wear to bare steel / primer, rust & dirt
//  streaks, roughness/metalness response, detail normals (weld seams, bolts, corrugation, pores ...),
//  ground-contact dirt & occlusion, oil stains on pads. Ultra adds weathered (desaturated) colours and
//  stronger relief; the environment map for reflections is assigned by the material library.
import type * as THREE from 'three';
import { SURFACE_PARAMS, SURF_LAYERS } from './texgen';

export interface SurfaceUniforms {
  uSurfDetail: { value: THREE.Texture | null };
  uSurfNormal: { value: THREE.Texture | null };
  uSurfTile: { value: Float32Array };
  uSurfDetailK: { value: Float32Array };
  uSurfWear: { value: Float32Array };
  uSurfGrime: { value: Float32Array };
  uSurfNormalK: { value: Float32Array };
  uSurfWearTint: { value: Float32Array };
  uSurfGrimeTint: { value: Float32Array };
}

export function createSurfaceUniforms(): SurfaceUniforms {
  const arr = (f: (p: (typeof SURFACE_PARAMS)[number]) => number) => Float32Array.from(SURFACE_PARAMS.map(f));
  return {
    uSurfDetail: { value: null },
    uSurfNormal: { value: null },
    uSurfTile: { value: arr((p) => p.tile) },
    uSurfDetailK: { value: arr((p) => p.detail) },
    uSurfWear: { value: arr((p) => p.wear) },
    uSurfGrime: { value: arr((p) => p.grime) },
    uSurfNormalK: { value: arr((p) => p.normal) },
    uSurfWearTint: { value: arr((p) => p.wearTint) },
    uSurfGrimeTint: { value: arr((p) => p.grimeTint) },
  };
}

export type SurfaceQuality = 'classic' | 'high' | 'ultra';

const N = SURF_LAYERS;

const VERT_HEAD = /* glsl */ `
attribute vec4 surf;
varying vec4 vSurf;
#ifdef SURF_TEX
varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vNM0;
varying vec3 vNM1;
varying vec3 vNM2;
#endif
`;

const VERT_BODY = /* glsl */ `
vSurf = surf;
#ifdef SURF_TEX
vObjPos = position;
vObjN = normal;
mat3 surfNM = normalMatrix;
#ifdef USE_INSTANCING
surfNM = normalMatrix * mat3(instanceMatrix);
#endif
vNM0 = surfNM[0];
vNM1 = surfNM[1];
vNM2 = surfNM[2];
#endif
`;

const FRAG_HEAD = /* glsl */ `
varying vec4 vSurf;
#ifdef SURF_TEX
precision highp sampler2DArray;
uniform sampler2DArray uSurfDetail;
uniform sampler2DArray uSurfNormal;
uniform float uSurfTile[${N}];
uniform float uSurfDetailK[${N}];
uniform float uSurfWear[${N}];
uniform float uSurfGrime[${N}];
uniform float uSurfNormalK[${N}];
uniform float uSurfWearTint[${N}];
uniform float uSurfGrimeTint[${N}];
varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vNM0;
varying vec3 vNM1;
varying vec3 vNM2;
vec4 surfD;
vec3 surfNObj;
float surfWear;
float surfGrime;
float surfOil;
float surfGround;
float surfPaintWear;
#endif
`;

/** After <color_fragment>: sample the layer triplanar, weather the base colour. */
const FRAG_COLOR = /* glsl */ `
#ifdef SURF_TEX
{
  int L = int(vSurf.z + 0.5);
  float lay = float(L);
  vec3 p = vObjPos / uSurfTile[L];
  vec3 n = normalize(vObjN);
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  vec4 dX = texture(uSurfDetail, vec3(p.zy, lay));
  vec4 dY = texture(uSurfDetail, vec3(p.xz, lay));
  vec4 dZ = texture(uSurfDetail, vec3(p.xy, lay));
  surfD = dX * w.x + dY * w.y + dZ * w.z;
  // whiteout-blended triplanar detail normals (object space)
  float k = uSurfNormalK[L] * SURF_RELIEF;
  vec2 tX = (texture(uSurfNormal, vec3(p.zy, lay)).rg * 2.0 - 1.0) * k;
  vec2 tY = (texture(uSurfNormal, vec3(p.xz, lay)).rg * 2.0 - 1.0) * k;
  vec2 tZ = (texture(uSurfNormal, vec3(p.xy, lay)).rg * 2.0 - 1.0) * k;
  vec3 nX = vec3(tX + n.zy, n.x);
  vec3 nY = vec3(tY + n.xz, n.y);
  vec3 nZ = vec3(tZ + n.xy, n.z);
  surfNObj = normalize(nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z);

  vec3 col = diffuseColor.rgb;
#ifdef SURF_ULTRA
  // weathered, slightly desaturated industrial colours
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 0.86) * 0.95;
#endif
  col *= mix(1.0, surfD.r * 2.0, uSurfDetailK[L]);
  surfWear = clamp(surfD.g * uSurfWear[L], 0.0, 1.0);
  surfPaintWear = surfWear * (1.0 - uSurfWearTint[L]);
  vec3 bare = vec3(0.34, 0.34, 0.35) * (0.75 + 0.5 * surfD.r);
  vec3 primer = vec3(0.075, 0.07, 0.065);
  col = mix(col, mix(bare, primer, uSurfWearTint[L]), surfWear);
  surfGrime = clamp(surfD.b * uSurfGrime[L], 0.0, 1.0);
  vec3 rust = mix(col * 0.45, vec3(0.2, 0.085, 0.03), 0.7);
  vec3 dirt = col * vec3(0.52, 0.48, 0.42);
  col = mix(col, mix(rust, dirt, uSurfGrimeTint[L]), surfGrime);
  // dirt splashed up from the ground / waterline grime (height above the model origin)
  float h = vSurf.w;
  surfGround = (1.0 - smoothstep(0.0, 0.85, h)) * step(-1.5, h);
  col = mix(col, col * vec3(0.6, 0.53, 0.45), surfGround * (0.35 + 0.35 * surfD.b));
  // oil stains on pads and yards around the equipment
  surfOil = 0.0;
  if ((L == 2 || L == 12) && n.y > 0.7 && h < 0.4) {
    float o = texture(uSurfDetail, vec3(vObjPos.xz * 0.11, 2.0)).b;
    surfOil = smoothstep(0.45, 0.7, o) * 0.8;
    col = mix(col, col * 0.28, surfOil);
  }
  diffuseColor.rgb = col;
}
#endif
`;

const FRAG_ROUGH_TEX = /* glsl */ `
float roughnessFactor = roughness * vSurf.x * surfD.a * 2.0;
roughnessFactor = mix(roughnessFactor, 0.42, surfPaintWear);
roughnessFactor = mix(roughnessFactor, 0.95, surfGrime * 0.6);
roughnessFactor = mix(roughnessFactor, 0.18, surfOil);
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
`;

const FRAG_METAL_TEX = /* glsl */ `
float metalnessFactor = metalness * vSurf.y;
metalnessFactor = mix(metalnessFactor, 0.7, surfPaintWear);
metalnessFactor *= 1.0 - surfGrime * 0.75;
`;

const FRAG_NORMAL_TEX = /* glsl */ `
#ifdef SURF_TEX
normal = normalize(mat3(vNM0, vNM1, vNM2) * surfNObj);
#endif
`;

/** Cavity & ground-contact occlusion on the indirect light. */
const FRAG_AO_TEX = /* glsl */ `
#ifdef SURF_TEX
{
  float cav = clamp(0.55 + surfD.r * 0.9, 0.0, 1.0);
  float ao = cav * (1.0 - 0.45 * surfGround);
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= mix(1.0, ao, 0.7);
}
#endif
`;

/**
 * onBeforeCompile / program key for the solid material at a quality. `charred` ruins stay untextured.
 */
export function solidPatch(quality: SurfaceQuality, charred: boolean, uniforms: SurfaceUniforms): { onBeforeCompile: (sh: THREE.WebGLProgramParametersWithUniforms) => void; key: string } {
  const textured = quality !== 'classic' && !charred && !!uniforms.uSurfDetail.value;
  const ultra = textured && quality === 'ultra';
  const key = `pc-solid${charred ? '-charred' : ''}${textured ? (ultra ? '-ultra' : '-high') : ''}`;
  return {
    key,
    onBeforeCompile: (sh) => {
      const defs = textured ? `#define SURF_TEX\n#define SURF_RELIEF ${ultra ? '1.6' : '0.9'}\n${ultra ? '#define SURF_ULTRA\n' : ''}` : '';
      if (textured) Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `${defs}#include <common>\n${VERT_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
      let fs = sh.fragmentShader.replace('#include <common>', `${defs}#include <common>\n${FRAG_HEAD}`);
      if (textured) {
        fs = fs
          .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
          .replace('#include <roughnessmap_fragment>', FRAG_ROUGH_TEX)
          .replace('#include <metalnessmap_fragment>', FRAG_METAL_TEX)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL_TEX}`)
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO_TEX}`);
      } else {
        fs = fs
          .replace('#include <roughnessmap_fragment>', charred ? 'float roughnessFactor = 1.0;' : 'float roughnessFactor = roughness * vSurf.x;')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vSurf.y;');
      }
      sh.fragmentShader = fs;
    },
  };
}
