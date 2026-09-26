// Post-processing chain: scene → (GTAO) → bloom → colour grade (vignette, grain, underwater, x-ray,
// lightning) → tone mapping + sRGB → FXAA. When bloom and SSAO are both off the renderer bypasses the
// composer entirely (direct render fast path).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

const GradeShader = {
  name: 'PetroGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uSaturation: { value: 1.0 },
    uContrast: { value: 1.05 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uUnderwater: { value: 0 },
    uWaterTint: { value: new THREE.Color(0.2, 0.55, 0.6) },
    uXray: { value: 0 },
    uFlash: { value: 0 },
    uExposure: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform float uUnderwater;
    uniform vec3 uWaterTint;
    uniform float uXray;
    uniform float uFlash;
    uniform float uExposure;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = vUv;
      if (uUnderwater > 0.0) {
        uv += vec2(sin(uv.y * 22.0 + uTime * 2.1), cos(uv.x * 19.0 + uTime * 1.7)) * 0.0028 * uUnderwater;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb * uExposure;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18);
      c *= uTint;
      if (uUnderwater > 0.0) {
        c = mix(c, c * uWaterTint * 1.4 + uWaterTint * 0.02, 0.65 * uUnderwater);
      }
      if (uXray > 0.0) {
        float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * 0.9 - uTime * 6.0);
        c += vec3(0.0, 0.035, 0.05) * scan * uXray * 0.35;
        c = mix(c, c * vec3(0.8, 1.0, 1.15), uXray * 0.4);
      }
      c += uFlash * vec3(0.18, 0.2, 0.25);
      vec2 d = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      float vig = smoothstep(1.05, 0.25, length(d));
      c *= mix(1.0, vig, uVignette + uXray * 0.25 + uUnderwater * 0.3);
      float g = hash(uv * uResolution + fract(uTime * 7.13) * 100.0) - 0.5;
      c += g * uGrain * (0.04 + sqrt(max(l, 0.0)) * 0.12);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export interface PostSettings {
  bloom: boolean;
  ssao: boolean;
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly grade: ShaderPass;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private gtao: GTAOPass | null = null;
  private output: OutputPass;
  private fxaa: FXAAPass;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private cfg: PostSettings = { bloom: true, ssao: false };
  private depthTexture: THREE.DepthTexture;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.depthTexture = new THREE.DepthTexture(1, 1);
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: this.depthTexture, samples: 0 });
    rt.texture.name = 'petro.scene';
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 3.2);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.fxaa = new FXAAPass();
    this.rebuild();
  }

  get uniforms() {
    return this.grade.uniforms as typeof GradeShader.uniforms;
  }

  /** Whether any composer pass is required (otherwise render directly). */
  static wanted(s: PostSettings) {
    return s.bloom || s.ssao;
  }

  configure(s: PostSettings) {
    if (s.bloom === this.cfg.bloom && s.ssao === this.cfg.ssao) return;
    this.cfg = { ...s };
    this.rebuild();
  }

  private rebuild() {
    const c = this.composer;
    while (c.passes.length) c.removePass(c.passes[0]);
    c.addPass(this.renderPass);
    if (this.cfg.ssao) {
      if (!this.gtao) {
        this.gtao = new GTAOPass(this.scene, this.camera, Math.max(1, this.width), Math.max(1, this.height));
        this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
        this.gtao.blendIntensity = 0.75;
      }
      c.addPass(this.gtao);
    }
    if (this.cfg.bloom) c.addPass(this.bloom);
    c.addPass(this.grade);
    c.addPass(this.output);
    c.addPass(this.fxaa);
    this.setSize(this.width, this.height, this.pixelRatio);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.width = w;
    this.height = h;
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    const pw = Math.max(1, Math.floor(w * pixelRatio));
    const ph = Math.max(1, Math.floor(h * pixelRatio));
    this.fxaa.setSize(pw, ph);
    this.bloom.setSize(Math.floor(pw / 2), Math.floor(ph / 2));
    this.gtao?.setSize(pw, ph);
    this.uniforms.uResolution.value.set(pw, ph);
  }

  render(dt: number) {
    // keep GTAO pointed at the depth of whichever buffer the scene was rendered into
    if (this.gtao && this.cfg.ssao) {
      const depth = (this.composer.readBuffer as THREE.WebGLRenderTarget).depthTexture;
      if (depth) this.gtao.setGBuffer(depth, undefined);
    }
    this.composer.render(dt);
  }

  dispose() {
    this.bloom.dispose();
    this.gtao?.dispose();
    this.output.dispose();
    this.fxaa.dispose();
    this.grade.dispose();
    this.composer.dispose();
    this.depthTexture.dispose();
  }
}
