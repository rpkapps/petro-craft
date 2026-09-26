// Block cursor: thin dark wireframe cube plus a multiplied crack overlay showing break progress.
import * as THREE from 'three';
import type { Vec3 } from '../../core/types';
import { crackLayer, CRACK_STAGES } from '../textures/layers';

const CRACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const CRACK_FRAG = /* glsl */ `
uniform sampler2DArray uAtlas;
uniform float uLayer;
varying vec2 vUv;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv, uLayer));
  gl_FragColor = vec4(mix(vec3(1.0), t.rgb * 0.6, t.a), 1.0);
}
`;

export class BlockHighlight {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackMat: THREE.ShaderMaterial;

  /** Swap the texture array the crack overlay samples (texture quality switch). */
  setAtlas(atlas: THREE.Texture) {
    this.crackMat.uniforms.uAtlas.value = atlas;
  }

  constructor(atlas: THREE.Texture) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.7, depthWrite: false }));
    this.lines.renderOrder = 30;
    this.crackMat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uLayer: { value: crackLayer(0) } },
      vertexShader: CRACK_VERT,
      fragmentShader: CRACK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendEquation: THREE.AddEquation,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.003, 1.003, 1.003), this.crackMat);
    this.crack.renderOrder = 29;
    this.group.add(this.lines, this.crack);
    this.group.visible = false;
    this.group.name = 'block-highlight';
  }

  set(pos: Vec3 | null, progress = 0) {
    if (!pos) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + 0.5, Math.floor(pos.z) + 0.5);
    const p = Math.max(0, Math.min(1, progress));
    this.crack.visible = p > 0.001;
    this.crackMat.uniforms.uLayer.value = crackLayer(Math.min(CRACK_STAGES - 1, Math.floor(p * CRACK_STAGES)));
  }

  dispose() {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.crack.geometry.dispose();
    this.crackMat.dispose();
  }
}
