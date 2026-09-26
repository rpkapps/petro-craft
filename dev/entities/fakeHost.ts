// Minimal RenderHost for the entity showcase (independent of src/render).
import * as THREE from 'three';
import type { RenderHost } from '../../src/core/client';
import type { MapOverlay } from '../../src/core/EventBus';
import type { Vec3 } from '../../src/core/types';

export class FakeHost implements RenderHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly sunDirection = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  readonly hemi: THREE.HemisphereLight;
  daylight = 1;
  overlay: MapOverlay | null = null;
  buildingPreview: { create(type: string): THREE.Object3D } | null = null;
  readonly fps = 60;
  readonly loadProgress = 1;
  private frameFns = new Set<(dt: number) => void>();
  private shakeT = 0;
  private shakeI = 0;
  readonly shakeOffset = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement, night: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = night ? 1.1 : 1.0;
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1200);
    this.daylight = night ? 0.02 : 1;
    const sky = night ? 0x0b1224 : 0xa9cbe6;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 140, 520);
    this.hemi = new THREE.HemisphereLight(night ? 0x34406a : 0xdfeeff, night ? 0x10131a : 0x6b5a45, night ? 0.35 : 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(night ? 0x8fa6ff : 0xfff1dc, night ? 0.25 : 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -160;
    sc.right = 160;
    sc.top = 160;
    sc.bottom = -160;
    sc.near = 1;
    sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
  }

  setSunCenter(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.copy(this.sunDirection).multiplyScalar(250).add(this.sun.target.position);
  }

  onFrame(fn: (dt: number) => void): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }
  setBlockHighlight(_pos: Vec3 | null, _p?: number): void {}
  setSelectionBox(_min: Vec3 | null, _max?: Vec3): void {}
  shake(intensity: number, duration = 0.5): void {
    this.shakeI = Math.max(this.shakeI, intensity);
    this.shakeT = Math.max(this.shakeT, duration);
  }

  update(dt: number): void {
    for (const f of this.frameFns) f(dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeI * Math.max(0, this.shakeT) * 0.6;
      this.shakeOffset.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    } else this.shakeOffset.set(0, 0, 0);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
