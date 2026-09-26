// The render engine: owns the WebGL renderer, scene, camera, lights and all visual subsystems, and
// implements the RenderHost contract used by the entity layer, player controller and audio.
import * as THREE from 'three';
import type { GameContext, Vec3 } from '../core/types';
import type { MapOverlay } from '../core/EventBus';
import { B } from '../core/blocks';
import { CHUNK_SIZE } from '../core/constants';
import type { Renderer } from './index';
import { createBlockAtlas, type BlockAtlas } from './textures/atlas';
import { createSharedUniforms, type SharedUniforms } from './materials/uniforms';
import { createTerrainMaterials, type TerrainMaterialSet } from './materials/TerrainMaterials';
import { ChunkManager } from './chunks/ChunkManager';
import { Sky } from './sky/Sky';
import { Clouds } from './sky/Clouds';
import { Lightning } from './sky/Lightning';
import { createAtmosphere, updateAtmosphere, type Atmosphere } from './sky/atmosphere';
import { ShadowRig } from './ShadowRig';
import { PostFX } from './post/PostFX';
import { Overlays } from './overlay/Overlays';
import { BlockHighlight } from './helpers/BlockHighlight';
import { SelectionBox } from './helpers/SelectionBox';
import { CameraShake } from './helpers/CameraShake';

const UNDERWATER_FOG = new THREE.Color(0.018, 0.1, 0.12);
const MAX_PIXEL_RATIO = 1.5;

export class RenderEngine implements Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  daylight = 1;
  overlay: MapOverlay | null = null;
  buildingPreview: { create(type: string): THREE.Object3D } | null = null;

  private hemi: THREE.HemisphereLight;
  private atlas: BlockAtlas;
  private uniforms: SharedUniforms;
  private materials: TerrainMaterialSet;
  private chunks: ChunkManager;
  private sky: Sky;
  private clouds: Clouds;
  private lightning: Lightning;
  private atmosphere: Atmosphere = createAtmosphere();
  private shadows: ShadowRig;
  private post: PostFX;
  private overlays: Overlays;
  private highlight: BlockHighlight;
  private selection: SelectionBox;
  private shakeFx = new CameraShake();
  private frameCallbacks = new Set<(dt: number) => void>();
  private offBus: (() => void)[] = [];
  private time = 0;
  private lastDt = 1 / 60;
  private fpsValue = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastFov = -1;
  private lastRd = -1;
  private underwater = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private sunOnlyDir = new THREE.Vector3();
  private progressCache = 0;

  constructor(readonly canvas: HTMLCanvasElement, private ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.info.autoReset = true;

    const s = ctx.settings;
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.08, 1000);
    this.camera.position.set(ctx.world.sizeX / 2, 90, ctx.world.sizeZ / 2);
    this.scene.add(this.camera);
    this.scene.name = 'petrocraft';
    this.scene.fog = new THREE.Fog(0xa3c8ec, 60, 120);

    this.atlas = createBlockAtlas(this.renderer.capabilities.getMaxAnisotropy());
    this.uniforms = createSharedUniforms(this.atlas.texture, this.atlas.props);
    this.materials = createTerrainMaterials(this.uniforms);

    // lights (terrain uses the shared uniforms; these drive entity materials & the shadow map)
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.sun.name = 'sun';
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9cc4f2, 0x6a5a48, Math.PI * 0.6);
    this.scene.add(this.hemi);
    this.shadows = new ShadowRig(this.renderer, this.sun, this.uniforms);

    this.sky = new Sky(this.uniforms);
    this.scene.add(this.sky.mesh);
    this.clouds = new Clouds(this.uniforms, ctx.world.seed ?? 1);
    this.scene.add(this.clouds.group);
    this.lightning = new Lightning();
    this.scene.add(this.lightning.group);

    this.chunks = new ChunkManager(ctx.world, ctx.bus, this.materials);
    this.scene.add(this.chunks.group);

    this.overlays = new Overlays(ctx, this.uniforms);
    this.scene.add(this.overlays.group);

    this.highlight = new BlockHighlight(this.atlas.texture);
    this.selection = new SelectionBox();
    this.scene.add(this.highlight.group, this.selection.group);

    this.post = new PostFX(this.renderer, this.scene, this.camera);

    this.offBus.push(
      ctx.bus.on('weather:lightning', (e) => this.onLightning(e.x, e.z)),
      ctx.bus.on('hazard:explosion', (e) => {
        const d = this.camera.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
        const k = Math.max(0, 1 - d / (40 + e.power * 20));
        if (k > 0) this.shake(k * Math.min(3, 0.6 + e.power * 0.4), 0.4 + k * 0.8);
      }),
      ctx.bus.on('ui:overlay', (e) => {
        this.overlay = e.overlay === 'none' ? null : e.overlay;
      }),
    );
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  // ---- RenderHost ---------------------------------------------------------------------------

  get fps() {
    return this.fpsValue;
  }

  get loadProgress() {
    return this.progressCache;
  }

  onFrame(fn: (dt: number) => void): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  setBlockHighlight(pos: Vec3 | null, breakProgress?: number) {
    this.highlight.set(pos, breakProgress ?? 0);
  }

  setSelectionBox(min: Vec3 | null, max?: Vec3) {
    this.selection.set(min, max);
  }

  shake(intensity: number, duration?: number) {
    this.shakeFx.add(intensity, duration);
  }

  // ---- frame ----------------------------------------------------------------------------------

  update(dt: number) {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.lastDt = dt;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.trackFps(dt);
    const s = this.ctx.settings;
    const st = this.ctx.state;

    // live settings
    if (s.fov !== this.lastFov) {
      this.lastFov = s.fov;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    const rd = Math.max(2, Math.min(16, Math.round(s.renderDistance || 8)));
    if (rd !== this.lastRd) {
      this.lastRd = rd;
      this.camera.far = Math.max(600, rd * CHUNK_SIZE * 2.2);
      this.camera.updateProjectionMatrix();
    }
    this.post.configure({ bloom: s.bloom, ssao: s.ssao });

    // environment
    this.lightning.update(dt);
    const flash = this.lightning.flash;
    updateAtmosphere(this.atmosphere, st.time.minuteOfDay, st.time.day, st.weather, rd * CHUNK_SIZE, flash);
    this.detectUnderwater(dt);
    this.applyAtmosphere(flash);

    // world
    const loading = this.progressCache < 1;
    this.chunks.update(this.camera, rd, loading ? 12 : 5);
    this.progressCache = this.chunks.progress(this.camera.position, Math.min(rd, 4));
    this.clouds.update(dt, this.camera, st.weather.cloudCover, this.atmosphere.windDir, this.atmosphere.windStrength, s.clouds);
    this.shadows.update(this.camera, this.atmosphere.lightDir, s);

    // overlays & helpers
    const mode = this.overlays.update(dt, this.camera, this.overlay, s.units);
    this.chunks.setMode(mode);
    this.selection.update(dt);
    this.shakeFx.update(dt);

    for (const fn of this.frameCallbacks) {
      try {
        fn(dt);
      } catch (err) {
        console.error('[render] onFrame callback failed', err);
      }
    }
  }

  render() {
    if (this.disposed) return;
    const s = this.ctx.settings;
    this.shakeFx.apply(this.camera);
    const pu = this.post.uniforms;
    pu.uTime.value = this.time;
    pu.uUnderwater.value = this.underwater;
    pu.uXray.value = this.uniforms.uXray.value;
    pu.uFlash.value = this.uniforms.uFlash.value;
    try {
      if (PostFX.wanted({ bloom: s.bloom, ssao: s.ssao })) this.post.render(this.lastDt);
      else this.renderer.render(this.scene, this.camera);
    } finally {
      this.shakeFx.restore(this.camera);
    }
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.post.setSize(this.width, this.height, pr);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offBus) off();
    this.offBus = [];
    this.frameCallbacks.clear();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.chunks.dispose();
    this.overlays.dispose();
    this.sky.dispose();
    this.clouds.dispose();
    this.lightning.dispose();
    this.highlight.dispose();
    this.selection.dispose();
    this.post.dispose();
    this.materials.dispose();
    this.atlas.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  // ---- internals ----------------------------------------------------------------------------

  private onContextLost = (e: Event) => {
    e.preventDefault();
    console.warn('[render] WebGL context lost');
  };

  private trackFps(dt: number) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      const inst = this.fpsFrames / this.fpsAcc;
      this.fpsValue = this.fpsValue * 0.3 + inst * 0.7;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private onLightning(x: number, z: number) {
    let ground = 64;
    const w = this.ctx.world;
    try {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      if (w.inBounds(Math.floor(x), 0, Math.floor(z)) && w.isChunkGenerated(cx, cz)) ground = w.getSurfaceY(Math.floor(x), Math.floor(z));
      else ground = this.ctx.geology.surfaceHeight(Math.floor(x), Math.floor(z));
    } catch {
      /* keep default */
    }
    this.lightning.strike(x, z, ground);
    const d = Math.hypot(this.camera.position.x - x, this.camera.position.z - z);
    if (d < 60) this.shake(0.25 * (1 - d / 60), 0.4);
  }

  private detectUnderwater(dt: number) {
    const p = this.camera.position;
    const w = this.ctx.world;
    let under = false;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const z = Math.floor(p.z);
    try {
      if (w.inBounds(x, y, z) && w.isChunkGenerated(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))) {
        const id = w.getBlock(x, y, z);
        if (id === B.WATER || id === B.KELP || id === B.SEAGRASS) {
          const above = w.inBounds(x, y + 1, z) ? w.getBlock(x, y + 1, z) : B.AIR;
          under = p.y - y < 0.86 || above === B.WATER;
        }
      }
    } catch {
      under = false;
    }
    // snap in, ease out (avoids a frame of wrong fog when dipping)
    this.underwater = under ? 1 : Math.max(0, this.underwater - dt * 6);
  }

  private applyAtmosphere(flash: number) {
    const a = this.atmosphere;
    const u = this.uniforms;
    this.sunDirection.copy(a.sunDir);
    this.sunOnlyDir.copy(a.sunDir);
    this.daylight = a.daylight;
    u.uSunDir.value.copy(a.lightDir);
    u.uSunColor.value.copy(a.lightColor);
    u.uSkyAmbient.value.copy(a.skyAmbient);
    u.uGroundAmbient.value.copy(a.groundAmbient);
    u.uZenith.value.copy(a.zenith);
    u.uFogColor.value.copy(a.horizon);
    u.uFogSunColor.value.copy(a.fogSun);
    u.uFogNear.value = a.fogNear;
    u.uFogFar.value = a.fogFar;
    u.uFogDensity.value = a.fogDensity;
    u.uFlash.value = flash;
    u.uWind.value.set(a.windDir.x * a.windStrength, a.windDir.y * a.windStrength, a.windStrength);
    const nightGlow = 1 - a.daylight;
    u.uEmissive.value = 2.4 + nightGlow * 1.6;
    u.uCaveAmbient.value.setRGB(0.012, 0.014, 0.02);
    // water tint follows the sky a little (overcast → greyer)
    u.uWaterShallow.value.setRGB(0.08, 0.36, 0.4).lerp(new THREE.Color(0.2, 0.26, 0.28), a.overcast * 0.6);
    u.uWaterDeep.value.setRGB(0.015, 0.08, 0.16).lerp(new THREE.Color(0.05, 0.07, 0.09), a.overcast * 0.5);

    const sk = this.sky.uniforms;
    sk.uSunGlow.value.copy(a.sunGlow);
    sk.uSunDisk.value.copy(a.sunDisk);
    sk.uMoonDir.value.copy(a.moonDir);
    sk.uMoonPhase.value = a.moonPhase;
    sk.uMoonBright.value = a.moonBright * (1 - a.overcast * 0.85);
    sk.uStarVis.value = a.starVis;
    this.sky.setSunDirection(this.sunOnlyDir);
    this.sky.setStarRotation(this.ctx.state.time.minuteOfDay / 1440);
    this.clouds.uniforms.uCloudLit.value.copy(a.cloudLit);
    this.clouds.uniforms.uCloudShade.value.copy(a.cloudShade);
    this.clouds.uniforms.uCloudOpacity.value = 1;

    if (this.underwater > 0) {
      const k = this.underwater;
      const lightK = 0.25 + 0.75 * a.daylight;
      const fog = UNDERWATER_FOG.clone().multiplyScalar(lightK);
      u.uFogColor.value.lerp(fog, k);
      u.uFogSunColor.value.multiplyScalar(1 - k);
      u.uFogNear.value = THREE.MathUtils.lerp(a.fogNear, 0.5, k);
      u.uFogFar.value = THREE.MathUtils.lerp(a.fogFar, 26, k);
      u.uFogDensity.value = THREE.MathUtils.lerp(a.fogDensity, 0.07, k);
    }
    u.uUnderwater.value = this.underwater;

    // three.js lights for the entity layer's standard materials
    this.sun.color.copy(a.lightColor);
    const li = Math.max(a.lightColor.r, a.lightColor.g, a.lightColor.b);
    if (li > 0) this.sun.color.multiplyScalar(1 / li);
    this.sun.intensity = li * Math.PI;
    this.hemi.color.copy(a.skyAmbient);
    this.hemi.groundColor.copy(a.groundAmbient);
    this.hemi.intensity = Math.PI * 0.85;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(u.uFogColor.value);
    fog.near = u.uFogNear.value;
    fog.far = u.uFogFar.value;
    this.renderer.setClearColor(u.uFogColor.value, 1);
  }
}
