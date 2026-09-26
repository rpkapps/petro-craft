// Stylised blocky cloud layer: a tileable density map of 12-block cells, extruded as instanced boxes
// around the camera and drifting with the wind. The same map (linear-filtered) casts soft cloud
// shadows in the terrain shader.
import * as THREE from 'three';
import { fbm2 } from '../util/noise';
import type { SharedUniforms } from '../materials/uniforms';
import { COMMON_UNIFORMS_GLSL, FOG_GLSL } from '../materials/shaderLib';

const CELLS = 128;
const CELL = 12;
const RADIUS = 24; // cells drawn around the camera
const HEIGHT = 138;

const VERT = /* glsl */ `
attribute float aThick;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalY;
void main() {
  vec3 p = position;
  vLocalY = p.y + 0.5;
  p.y = (p.y + 0.5) * aThick;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${FOG_GLSL}
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudFar;
uniform float uCloudOpacity;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalY;
void main() {
  vec3 N = normalize(vNormal);
  float sun = max(dot(N, uSunDir), 0.0);
  float up = N.y * 0.5 + 0.5;
  vec3 col = mix(uCloudShade, uCloudLit, clamp(up * 0.75 + sun * 0.35, 0.0, 1.0));
  if (abs(N.y) < 0.5) col = mix(uCloudShade, col, 0.55 + 0.45 * vLocalY);
  vec3 d = vWorldPos - cameraPosition;
  float dist = length(d.xz);
  vec3 dir = normalize(d);
  vec3 sky = mix(fogTint(dir), uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.48));
  float fade = smoothstep(uCloudFar * 0.45, uCloudFar, dist);
  col = mix(col, sky, max(fade, 1.0 - uCloudOpacity));
  col += uFlash * vec3(0.6, 0.65, 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Clouds {
  readonly group = new THREE.Group();
  readonly map: THREE.DataTexture;
  private density: Float32Array;
  private mesh: THREE.InstancedMesh;
  private thick: THREE.InstancedBufferAttribute;
  private material: THREE.ShaderMaterial;
  readonly uniforms = {
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uCloudFar: { value: RADIUS * CELL },
    uCloudOpacity: { value: 1 },
  };
  private drift = new THREE.Vector2();
  private lastCell = new THREE.Vector2(1e9, 1e9);
  private lastThreshold = -1;
  private threshold = 0.6;

  constructor(private shared: SharedUniforms, seed: number) {
    this.density = new Float32Array(CELLS * CELLS);
    const bytes = new Uint8Array(CELLS * CELLS);
    for (let z = 0; z < CELLS; z++)
      for (let x = 0; x < CELLS; x++) {
        const big = fbm2(x / 16, z / 16, CELLS / 16, 3, seed);
        const small = fbm2(x / 4, z / 4, CELLS / 4, 2, seed + 99);
        const d = Math.min(1, Math.max(0, big * 0.78 + small * 0.32 - 0.05));
        this.density[x + z * CELLS] = d;
        bytes[x + z * CELLS] = Math.round(d * 255);
      }
    this.map = new THREE.DataTexture(bytes, CELLS, CELLS, THREE.RedFormat, THREE.UnsignedByteType);
    this.map.wrapS = this.map.wrapT = THREE.RepeatWrapping;
    this.map.magFilter = THREE.LinearFilter;
    this.map.minFilter = THREE.LinearFilter;
    this.map.needsUpdate = true;

    const box = new THREE.BoxGeometry(1, 1, 1);
    const max = (RADIUS * 2 + 1) ** 2;
    this.thick = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    box.setAttribute('aThick', this.thick);
    this.material = new THREE.ShaderMaterial({
      name: 'clouds',
      uniforms: { ...shared, ...this.uniforms } as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.InstancedMesh(box, this.material, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'clouds';
    this.group.add(this.mesh);
    shared.uCloudMap.value = this.map;
    shared.uCloudScale.value = 1 / (CELLS * CELL);
    shared.uCloudHeight.value = HEIGHT;
  }

  /** Coverage threshold for a cloud cover fraction. */
  static thresholdFor(cover: number) {
    return 0.78 - Math.max(0, Math.min(1, cover)) * 0.52;
  }

  update(dt: number, camera: THREE.Camera, cover: number, windDir: THREE.Vector2, windStrength: number, enabled: boolean) {
    const speed = 1.2 + windStrength * 6;
    this.drift.x += windDir.x * speed * dt;
    this.drift.y += windDir.y * speed * dt;
    this.shared.uCloudOffset.value.copy(this.drift);
    // ease coverage changes
    const target = Clouds.thresholdFor(cover);
    this.threshold += (target - this.threshold) * Math.min(1, dt * 0.5);
    this.shared.uCloudThreshold.value = this.threshold;
    this.shared.uCloudShadow.value = enabled ? 0.55 : 0;
    this.group.visible = enabled && this.shared.uXray.value < 0.5;
    if (!enabled) return;
    this.group.position.set(this.drift.x, HEIGHT, this.drift.y);
    const cx = Math.floor((camera.position.x - this.drift.x) / CELL);
    const cz = Math.floor((camera.position.z - this.drift.y) / CELL);
    const thq = Math.round(this.threshold * 100) / 100;
    if (cx === this.lastCell.x && cz === this.lastCell.y && thq === this.lastThreshold) return;
    this.lastCell.set(cx, cz);
    this.lastThreshold = thq;
    this.rebuild(cx, cz, thq);
  }

  private rebuild(cx: number, cz: number, th: number) {
    const m = new THREE.Matrix4();
    let n = 0;
    const r2 = RADIUS * RADIUS;
    for (let dz = -RADIUS; dz <= RADIUS; dz++)
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        const d = this.density[(((gx % CELLS) + CELLS) % CELLS) + (((gz % CELLS) + CELLS) % CELLS) * CELLS];
        if (d < th) continue;
        m.makeScale(CELL, 1, CELL);
        m.setPosition(gx * CELL + CELL / 2, 0, gz * CELL + CELL / 2);
        this.mesh.setMatrixAt(n, m);
        this.thick.array[n] = 4 + Math.min(1, (d - th) * 6) * 3;
        n++;
      }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.thick.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.map.dispose();
    this.mesh.dispose();
  }
}
