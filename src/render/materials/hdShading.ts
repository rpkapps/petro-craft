// GLSL for the HD texture qualities (compiled in only with the TEX_HD / TEX_ULTRA defines, so the classic
// look is untouched). Tangent frames come from screen-space derivatives (works for axis-aligned faces,
// greedy-merged quads, crosses and pipes alike); the material texture packs normal.xy, roughness, height.
//   'high'  (TEX_HD):            per-block texture bombing, world-space macro variation, normal-mapped
//                                diffuse + the classic sheen
//   'ultra' (TEX_HD + TEX_ULTRA): + parallax occlusion mapping with height-field self-shadowing, close-range
//                                micro-detail normals, faked rounded block edges, GGX sun/moon specular,
//                                sky reflections, rain wetness & puddles, damp shorelines, foliage
//                                translucency and snow/ice glints
// Layer property rows (uLayerProps): row 2 = (bomb, pom depth /0.1, sparkle, porosity),
//                                    row 3 = (metal, translucency, macro variation, -).

export const HD_PARS_GLSL = /* glsl */ `
#ifdef TEX_HD
uniform sampler2DArray uMatTex;
uniform float uPom;
uniform float uWet;
uniform float uSeaLevel;
flat varying float vEdge;

struct HDSample {
  vec4 albedo;
  vec4 mat;
  vec2 uv;
  vec2 gx;
  vec2 gy;
  mat3 tbn;
  float dist;
  float selfShadow;
  vec4 hp;
  vec4 hp2;
  vec3 bc;
};

mat3 hdFrame(vec3 N, vec2 duv1, vec2 duv2) {
  vec3 dp1 = dFdx(vWorldPos);
  vec3 dp2 = dFdy(vWorldPos);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return mat3(T * invmax, B * invmax, N);
}

HDSample hdSample(float layer, vec2 uv0, vec3 Nf) {
  HDSample h;
  h.hp = texelFetch(uLayerProps, ivec2(int(layer), 2), 0);
  h.hp2 = texelFetch(uLayerProps, ivec2(int(layer), 3), 0);
  float bomb = floor(h.hp.r * 255.0 + 0.5);
  vec2 gx = dFdx(uv0);
  vec2 gy = dFdy(uv0);
  vec2 uv = uv0;
  h.bc = floor(vWorldPos - Nf * 0.02);
  if (bomb > 0.5) {
    // texture bombing: every block shows a different part of the tileable material (no visible repeats)
    float r1 = hash13(h.bc * 1.137 + 0.37);
    float r2 = hash13(h.bc * 0.913 + 17.1);
    float r3 = hash13(h.bc * 1.071 + 31.7);
    vec2 lp = fract(uv0) - 0.5;
    if (bomb > 1.5 && bomb < 2.5 && abs(Nf.y) > 0.5) {
      float k = floor(r3 * 4.0);
      mat2 R = k < 1.0 ? mat2(1.0, 0.0, 0.0, 1.0) : k < 2.0 ? mat2(0.0, -1.0, 1.0, 0.0) : k < 3.0 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, 1.0, -1.0, 0.0);
      lp = R * lp;
      gx = R * gx;
      gy = R * gy;
    }
    uv = lp + 0.5 + vec2(r1, bomb > 2.5 ? 0.0 : r2);
  }
  h.tbn = hdFrame(Nf, gx, gy);
  vec3 toCam = cameraPosition - vWorldPos;
  h.dist = length(toCam);
  h.selfShadow = 1.0;
  #ifdef TEX_ULTRA
  float pomD = h.hp.g * 0.1;
  if (uPom > 0.5 && pomD > 0.0 && h.dist < 22.0) {
    // parallax occlusion mapping: march the view ray through the height field (height 1 = surface)
    float fadeP = 1.0 - smoothstep(12.0, 22.0, h.dist);
    vec3 V = toCam / h.dist;
    vec3 vt = vec3(dot(V, h.tbn[0]), dot(V, h.tbn[1]), dot(V, Nf));
    vec2 dir = -vt.xy / max(vt.z, 0.22) * pomD * fadeP;
    const int STEPS = 14;
    float stepD = 1.0 / float(STEPS);
    float cur = 0.0;
    vec2 cuv = uv;
    float depth = 1.0 - textureGrad(uMatTex, vec3(cuv, layer), gx, gy).a;
    for (int i = 0; i < STEPS; i++) {
      if (cur >= depth) break;
      cuv += dir * stepD;
      cur += stepD;
      depth = 1.0 - textureGrad(uMatTex, vec3(cuv, layer), gx, gy).a;
    }
    vec2 prev = cuv - dir * stepD;
    float after = depth - cur;
    float before = (1.0 - textureGrad(uMatTex, vec3(prev, layer), gx, gy).a) - (cur - stepD);
    float w = after / (after - before + 1e-5);
    cuv = mix(cuv, prev, clamp(w, 0.0, 1.0));
    float hitDepth = mix(cur, cur - stepD, clamp(w, 0.0, 1.0));
    uv = cuv;
    // self-shadowing: march towards the sun/moon inside the height field
    vec3 lt = vec3(dot(uSunDir, h.tbn[0]), dot(uSunDir, h.tbn[1]), dot(uSunDir, Nf));
    if (lt.z > 0.02 && hitDepth > 0.02) {
      vec2 ldir = lt.xy / max(lt.z, 0.15) * pomD * fadeP;
      float occl = 0.0;
      float d = hitDepth;
      vec2 suv = cuv;
      for (int i = 0; i < 6; i++) {
        d -= hitDepth / 6.0;
        suv += ldir * (hitDepth / 6.0);
        float sd = 1.0 - textureGrad(uMatTex, vec3(suv, layer), gx, gy).a;
        occl = max(occl, clamp((d - sd) * 12.0, 0.0, 1.0));
      }
      h.selfShadow = 1.0 - occl * 0.8 * fadeP;
    }
  }
  #endif
  h.uv = uv;
  h.gx = gx;
  h.gy = gy;
  h.albedo = textureGrad(uAtlas, vec3(uv, layer), gx, gy);
  h.mat = textureGrad(uMatTex, vec3(uv, layer), gx, gy);
  // world-space macro variation: large soft tone / hue drift across natural surfaces
  float mv = h.hp2.b;
  if (mv > 0.0) {
    float n1 = vnoise(vWorldPos.xz * 0.043 + vWorldPos.y * 0.021);
    float n2 = vnoise(vWorldPos.zx * 0.17 + 13.7);
    h.albedo.rgb *= 1.0 + ((n1 - 0.5) * 0.24 + (n2 - 0.5) * 0.1) * mv;
    h.albedo.rgb = mix(h.albedo.rgb, h.albedo.rgb * vec3(1.06, 1.0, 0.9), (n1 - 0.5) * mv * 0.8);
  }
  return h;
}

/** Perturbed normal from the material texture (+ close-range micro detail and faked bevels in ultra). */
vec3 hdNormal(inout HDSample h, float layer, vec3 Nf) {
  vec2 nxy = h.mat.rg * 2.0 - 1.0;
  #ifdef TEX_ULTRA
  if (h.dist < 7.0) {
    vec2 d = textureGrad(uMatTex, vec3(h.uv * 3.7 + 0.31, layer), h.gx * 3.7, h.gy * 3.7).rg * 2.0 - 1.0;
    nxy += d * 0.45 * (1.0 - smoothstep(2.5, 7.0, h.dist));
  }
  #endif
  nxy *= 1.0 - smoothstep(20.0, 80.0, h.dist) * 0.6;
  float z = sqrt(max(0.04, 1.0 - dot(nxy, nxy)));
  vec3 n = normalize(h.tbn * vec3(nxy, z));
  #ifdef TEX_ULTRA
  if (vEdge > 0.5 && h.dist < 40.0) {
    // rounded block edges on exposed (convex) edges: bend the normal outward & wear the corner
    vec3 an = abs(Nf);
    int na = an.x > 0.5 ? 0 : an.y > 0.5 ? 1 : 2;
    int a1 = na == 0 ? 1 : 0;
    int a2 = na == 2 ? 1 : 2;
    vec3 e1 = vec3(a1 == 0 ? 1.0 : 0.0, a1 == 1 ? 1.0 : 0.0, 0.0);
    vec3 e2 = vec3(0.0, a2 == 1 ? 1.0 : 0.0, a2 == 2 ? 1.0 : 0.0);
    float f1 = fract(vWorldPos[a1]);
    float f2 = fract(vWorldPos[a2]);
    int bits = int(vEdge + 0.5);
    float W = 0.085;
    vec3 bend = vec3(0.0);
    float rim = 0.0;
    float t;
    if ((bits & 1) != 0) { t = 1.0 - smoothstep(0.0, W, 1.0 - f1); bend += e1 * t; rim = max(rim, t); }
    if ((bits & 2) != 0) { t = 1.0 - smoothstep(0.0, W, f1); bend -= e1 * t; rim = max(rim, t); }
    if ((bits & 4) != 0) { t = 1.0 - smoothstep(0.0, W, 1.0 - f2); bend += e2 * t; rim = max(rim, t); }
    if ((bits & 8) != 0) { t = 1.0 - smoothstep(0.0, W, f2); bend -= e2 * t; rim = max(rim, t); }
    float fadeE = 1.0 - smoothstep(20.0, 40.0, h.dist);
    n = normalize(n + bend * 1.1 * fadeE);
    h.albedo.rgb *= 1.0 + rim * (0.06 - rim * 0.14) * fadeE;
  }
  #endif
  return n;
}

#ifdef TEX_ULTRA
vec3 hdGGX(vec3 N, vec3 V, vec3 L, vec3 F0, float rough) {
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  float NdH = max(dot(N, H), 0.0);
  float a = max(0.045, rough * rough);
  float a2 = a * a;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = NdL / (NdL * (1.0 - k) + k) * NdV / (NdV * (1.0 - k) + k);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  return D * G * F / (4.0 * NdV + 1e-4);
}
#endif

/** HD lighting: the classic model with a perturbed normal, plus PBR-ish terms in ultra. */
vec3 hdShade(inout HDSample h, vec3 albedo, vec3 Nf, vec3 Np, vec4 props, out float directOut) {
  float kind = floor(props.b * 255.0 + 0.5);
  float sky = vSky;
  float ao = vAo;
  float rough = h.mat.b;
  float metal = h.hp2.r;
  vec3 V = normalize(cameraPosition - vWorldPos);
  #ifdef TEX_ULTRA
  // wetness: rain on exposed surfaces, damp shorelines; puddles collect in low spots on flat ground
  float por = h.hp.a;
  float up = smoothstep(0.3, 0.9, Nf.y);
  float exposed = smoothstep(0.55, 0.9, sky);
  float rain = uWet * exposed * mix(0.5, 1.0, up);
  float damp = (1.0 - smoothstep(uSeaLevel + 0.6, uSeaLevel + 2.6, vWorldPos.y)) * step(uSeaLevel - 8.0, vWorldPos.y) * 0.75;
  float wet = clamp(max(rain, damp), 0.0, 1.0) * por;
  float puddle = uWet * up * exposed * por * smoothstep(0.42, 0.18, h.mat.a);
  albedo *= mix(1.0, 0.52, wet);
  rough = mix(rough, 0.14, wet);
  rough = mix(rough, 0.03, puddle);
  Np = normalize(mix(Np, Nf, puddle));
  #endif
  float skyVis = smoothstep(0.3, 0.8, sky);
  vec3 L = uSunDir;
  float NdL = dot(Np, L);
  float geo = smoothstep(-0.1, 0.12, dot(Nf, L));
  if (kind == 8.0) {
    NdL = NdL * 0.6 + 0.4;
    geo = 1.0;
  }
  float sh = sunShadow() * cloudShadowAt(vWorldPos) * skyVis;
  float direct = max(NdL, 0.0) * geo * sh * h.selfShadow;
  directOut = direct;
  float faceShade = Nf.y > 0.5 ? 1.0 : (Nf.y < -0.5 ? 0.66 : (abs(Nf.x) > 0.5 ? 0.9 : 0.84));
  faceShade = mix(faceShade, 1.0, 0.35);
  vec3 hemi = mix(uGroundAmbient, uSkyAmbient, Np.y * 0.5 + 0.5);
  hemi += uSunColor * (0.16 * (1.0 - max(Np.y, 0.0)));
  vec3 ambient = hemi * (sky * sky * 0.92 + sky * 0.08) * faceShade;
  vec3 blockL = uBlockLightColor * pow(vBlock, 2.2) * 1.7;
  float diffK = 1.0 - metal * 0.7;
  vec3 light = (ambient + uCaveAmbient) * ao + uSunColor * direct * mix(1.0, ao, 0.4) + blockL * mix(1.0, ao, 0.6) * max(0.35, dot(Np, Nf));
  light += uFlash * vec3(0.55, 0.6, 0.75) * sky;
  vec3 col = albedo * light * diffK;
  #ifdef TEX_ULTRA
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  if (direct > 0.0) col += uSunColor * hdGGX(Np, V, L, F0, rough) * max(dot(Np, L), 0.0) * geo * sh * h.selfShadow * mix(1.0, ao, 0.5);
  float NdV = max(dot(Np, V), 0.0);
  vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, Np);
  vec3 env = R.y > 0.0 ? skyColor(R) : mix(uGroundAmbient, uFogColor, 0.3);
  col += env * Fe * (1.0 - rough) * (1.0 - rough) * sky * sky * ao;
  // thin foliage lets light through: back-lit leaves & grass glow
  float trans = h.hp2.g;
  if (trans > 0.0) {
    float back = pow(max(dot(V, -L), 0.0), 3.0);
    col += albedo * uSunColor * back * trans * sh * 0.9;
    col += albedo * uSkyAmbient * trans * 0.12 * sky;
  }
  // micro-facet glints (snow, ice, salt, quartz)
  float sparkle = h.hp.b;
  if (sparkle > 0.0 && direct > 0.0) {
    vec2 cell = floor(h.uv * 96.0) + h.bc.xz * 37.0 + h.bc.y * 11.0;
    float g = hash12(cell);
    float tw = hash12(cell + floor(dot(V, vec3(5.1, 7.3, 3.7)) * 6.0));
    col += uSunColor * direct * step(1.0 - 0.02 * sparkle, g) * step(0.45, tw) * 4.0 * (1.0 - smoothstep(6.0, 24.0, h.dist));
  }
  #else
  float spec = props.g;
  if (spec > 0.0 && direct > 0.0) {
    vec3 Hh = normalize(uSunDir + V);
    float sp = pow(max(dot(Np, Hh), 0.0), 40.0 + spec * 60.0);
    col += uSunColor * sp * spec * direct * 0.9;
  }
  #endif
  col += albedo * props.r * uEmissive;
  return col;
}
#endif
`;

/** Water surface detail normals from the water layer's material (translucent pass). */
export const HD_WATER_GLSL = /* glsl */ `
#ifdef TEX_HD
uniform sampler2DArray uMatTex;
uniform float uWaterLayer;
vec2 hdWaterDetail(vec3 wp, float t, float dist) {
  vec2 a = texture(uMatTex, vec3(wp.xz * 0.21 + vec2(t * 0.021, t * 0.013), uWaterLayer)).rg * 2.0 - 1.0;
  vec2 b = texture(uMatTex, vec3(wp.zx * 0.083 - vec2(t * 0.011, t * 0.017), uWaterLayer)).rg * 2.0 - 1.0;
  return (a + b * 0.8) * 0.22 * (1.0 - smoothstep(10.0, 60.0, dist));
}
#endif
`;
