// The render engine: owns the WebGL renderer, scene, camera, lights and all visual subsystems, and
// implements the RenderHost contract used by the entity layer, player controller and audio.
// Live settings (render scale, antialiasing, brightness, post effects, shadows, render distance) are
// polled every frame; AutoQuality may lower the effective values without touching the saved settings.
// `stats` exposes per-frame counters for the performance overlay (see RenderStats).
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
import { WorldBorder } from './chunks/WorldBorder';
import { Sky } from './sky/Sky';
import { Clouds } from './sky/Clouds';
import { Lightning } from './sky/Lightning';
import { createAtmosphere, updateAtmosphere, type Atmosphere } from './sky/atmosphere';
import { ShadowRig } from './ShadowRig';
import { PostFX, type PostSettings } from './post/PostFX';
import { AutoQuality, clampScale, type EffectiveQuality } from './quality/AutoQuality';
import { GpuTimer } from './quality/GpuTimer';
import { Overlays } from './overlay/Overlays';
import { BlockHighlight } from './helpers/BlockHighlight';
import { SelectionBox } from './helpers/SelectionBox';
import { CameraShake } from './helpers/CameraShake';

const UNDERWATER_FOG = new THREE.Color(0.018, 0.1, 0.12);
const WATER_SHALLOW = new THREE.Color(0.04, 0.26, 0.32);
const WATER_DEEP = new THREE.Color(0.008, 0.05, 0.12);
const WATER_SHALLOW_GREY = new THREE.Color(0.2, 0.26, 0.28);
const WATER_DEEP_GREY = new THREE.Color(0.05, 0.07, 0.09);
/** Device pixel ratio cap before the render-scale multiplier. */
const MAX_PIXEL_RATIO = 2;
const BASE_EXPOSURE = 0.82;
/** Streaming budgets per frame: while the loading screen is up / during play. */
const BUDGET_LOADING = { genMs: 12, dispatchMs: 6, uploadBytes: 32 * 1024 * 1024 };
const BUDGET_PLAY = { genMs: 4, dispatchMs: 2, uploadBytes: 2 * 1024 * 1024 };

/** Per-frame renderer statistics for the performance overlay (`host.stats`). */
export interface RenderStats {
  /** CPU time of the presentation frame (renderer update → render end, incl. entity/audio updates), smoothed ms. */
  frameMs: number;
  /** GPU time of the frame from EXT_disjoint_timer_query_webgl2, smoothed ms; NaN when unavailable. */
  gpuMs: number;
  /** Draw calls of the last frame (main view + shadow map + post passes). */
  drawCalls: number;
  /** Triangles of the last frame (same scope as drawCalls). */
  triangles: number;
  /** Chunk columns with meshes. */
  chunks: number;
  /** Effective render distance in chunks (after auto quality). */
  renderDistance: number;
  /** Number of auto-quality steps currently applied (0 = full user settings). */
  autoQualityStep: number;
}

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
  private border: WorldBorder;
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
  private tmpColor = new THREE.Color();
  private tmpVec = new THREE.Vector3();
  private auto = new AutoQuality();
  private eff: EffectiveQuality = { renderScale: 1, ssao: false, shadowDegrade: 0, bloomScale: 0.5, renderDistance: 8 };
  private postCfg: PostSettings = { bloom: true, ssao: false, antialias: true, bloomScale: 0.5 };
  private gpuTimer: GpuTimer;
  private pixelRatio = 1;
  private dpr = 1;
  private frameStart = 0;
  private lastFrameAt = 0;
  private cpuMs = 0;
  private inFrame = false;
  private plantFar = -1;
  readonly stats: RenderStats = { frameMs: 0, gpuMs: NaN, drawCalls: 0, triangles: 0, chunks: 0, renderDistance: 8, autoQualityStep: 0 };

  constructor(readonly canvas: HTMLCanvasElement, private ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = BASE_EXPOSURE;
    this.renderer.info.autoReset = false;
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);

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
    this.border = new WorldBorder(ctx.world, this.materials);
    this.scene.add(this.border.group);

    this.overlays = new Overlays(ctx, this.uniforms);
    this.scene.add(this.overlays.group);

    this.highlight = new BlockHighlight(this.atlas.texture);
    this.selection = new SelectionBox();
    this.scene.add(this.highlight.group, this.selection.group);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.auto.configure(s);
    this.auto.effective(s, this.eff);

    this.offBus.push(
      ctx.bus.on('weather:lightning', (e) => this.onLightning(e.x, e.z)),
      ctx.bus.on('hazard:explosion', (e) => {
        const d = this.camera.position.distanceTo(this.tmpVec.set(e.x, e.y, e.z));
        const k = Math.max(0, 1 - d / (40 + e.power * 20));
        if (k > 0) this.shake(k * Math.min(3, 0.6 + e.power * 0.4), 0.4 + k * 0.8);
      }),
      ctx.bus.on('ui:overlay', (e) => {
        this.overlay = e.overlay === 'none' ? null : e.overlay;
      }),
      // settings are also polled each frame; a change is a moment of hitching (rebuilds), not slowness
      ctx.bus.on('settings:changed', () => this.auto.hold()),
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

  /** First y with open sky above at a world column: terrain, foliage and building volume block the sky (0 if the chunk is not loaded). */
  skyHeightAt(x: number, z: number): number {
    return this.chunks.columnTop(Math.floor(x), Math.floor(z));
  }

  /** True when the camera is below a water surface (underwater post-processing is active). */
  get isUnderwater(): boolean {
    return this.underwater > 0.5;
  }

  /** Render scale actually used (user setting, possibly lowered by auto quality). */
  get effectiveRenderScale(): number {
    return this.eff.renderScale;
  }

  // ---- frame ----------------------------------------------------------------------------------

  update(dt: number) {
    if (this.disposed) return;
    const now = performance.now();
    const interval = this.lastFrameAt > 0 ? now - this.lastFrameAt : 1000 / 60;
    this.lastFrameAt = now;
    this.frameStart = now;
    this.inFrame = true;
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.lastDt = dt;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.trackFps(dt);
    const s = this.ctx.settings;
    const st = this.ctx.state;

    // adaptive quality (never mutates the user's settings)
    this.gpuTimer.poll();
    const gpu = this.gpuTimer.ms;
    const gpuKnown = Number.isFinite(gpu);
    const hidden = typeof document !== 'undefined' && document.hidden;
    const reconfigured = this.auto.configure(s);
    const stepped = this.auto.sample(interval, gpuKnown ? Math.max(this.cpuMs, gpu) : this.cpuMs, gpuKnown, hidden || this.progressCache < 1);
    if (reconfigured || stepped) this.auto.effective(s, this.eff);
    this.stats.autoQualityStep = this.auto.level;
    this.applyPixelRatio();

    // live settings
    if (s.fov !== this.lastFov) {
      this.lastFov = s.fov;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    const rd = this.eff.renderDistance;
    if (rd !== this.lastRd) {
      this.lastRd = rd;
      this.camera.far = Math.max(600, rd * CHUNK_SIZE * 2.2);
      this.camera.updateProjectionMatrix();
      // plants dissolve towards ~62% of the view distance and are not meshed beyond it
      const far = Math.min(96, Math.max(40, rd * CHUNK_SIZE * 0.62));
      if (far !== this.plantFar) {
        this.plantFar = far;
        this.materials.plantFade.value.set(far * 0.7, far);
        this.chunks.setPlantLod(far);
      }
    }
    this.stats.renderDistance = rd;
    const pc = this.postCfg;
    pc.bloom = s.bloom;
    pc.ssao = this.eff.ssao;
    pc.antialias = s.antialias !== false;
    pc.bloomScale = this.eff.bloomScale;
    this.post.configure(pc);

    // environment
    this.lightning.update(dt);
    const flash = this.lightning.flash;
    updateAtmosphere(this.atmosphere, st.time.minuteOfDay, st.time.day, st.weather, rd * CHUNK_SIZE, flash);
    this.detectUnderwater(dt);
    this.applyAtmosphere(flash);

    // world
    const loading = this.progressCache < 1;
    this.chunks.update(this.camera, rd, loading ? BUDGET_LOADING : BUDGET_PLAY);
    this.progressCache = this.chunks.progress(this.camera.position, Math.min(rd, 4));
    this.stats.chunks = this.chunks.stats.meshed;
    this.clouds.update(dt, this.camera, st.weather.cloudCover, this.atmosphere.windDir, this.atmosphere.windStrength, s.clouds);
    this.shadows.update(this.camera, this.atmosphere.lightDir, s, this.eff.shadowDegrade);

    // overlays & helpers
    const mode = this.overlays.update(dt, this.camera, this.overlay, s.units);
    this.chunks.setMode(mode);
    this.border.setMode(mode);
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
    this.renderer.info.reset();
    this.shakeFx.apply(this.camera);
    const pu = this.post.uniforms;
    pu.uTime.value = this.time;
    pu.uUnderwater.value = this.underwater;
    pu.uXray.value = this.uniforms.uXray.value;
    pu.uFlash.value = this.uniforms.uFlash.value;
    const timed = this.inFrame;
    if (timed) this.gpuTimer.begin();
    try {
      if (PostFX.wanted(this.postCfg)) this.post.render(this.lastDt);
      else this.renderer.render(this.scene, this.camera);
    } finally {
      if (timed) this.gpuTimer.end();
      this.shakeFx.restore(this.camera);
    }
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    if (timed) {
      // a render() outside the frame loop (e.g. a save thumbnail) is not a frame
      this.inFrame = false;
      const cpu = performance.now() - this.frameStart;
      this.cpuMs += (cpu - this.cpuMs) * 0.1;
      this.stats.frameMs = this.cpuMs;
      this.stats.gpuMs = this.gpuTimer.ms;
    }
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.pixelRatio = -1; // force
    this.applyPixelRatio();
    this.auto.hold();
  }

  /** Drawing-buffer pixel ratio = min(devicePixelRatio, 2) × effective render scale. */
  private applyPixelRatio() {
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, MAX_PIXEL_RATIO);
    const pr = dpr * clampScale(this.eff.renderScale);
    if (pr === this.pixelRatio && dpr === this.dpr) return;
    this.pixelRatio = pr;
    this.dpr = dpr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
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
    this.border.dispose();
    this.overlays.dispose();
    this.sky.dispose();
    this.clouds.dispose();
    this.lightning.dispose();
    this.highlight.dispose();
    this.selection.dispose();
    this.post.dispose();
    this.gpuTimer.dispose();
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
    u.uWaterShallow.value.copy(WATER_SHALLOW).lerp(WATER_SHALLOW_GREY, a.overcast * 0.6);
    u.uWaterDeep.value.copy(WATER_DEEP).lerp(WATER_DEEP_GREY, a.overcast * 0.5);

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
      this.tmpColor.copy(UNDERWATER_FOG).multiplyScalar(lightK);
      u.uFogColor.value.lerp(this.tmpColor, k);
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

    // brightness: tone-mapping exposure multiplier (applies to the direct and the composer path). Nights
    // respond less to darkening (never unreadable) and a little more to brightening.
    const b = Number.isFinite(this.ctx.settings.brightness) ? Math.min(1.6, Math.max(0.6, this.ctx.settings.brightness)) : 1;
    const night = 1 - a.daylight;
    const mult = b >= 1 ? b + (b - 1) * 0.5 * night : b + (1 - b) * 0.6 * night;
    this.renderer.toneMappingExposure = BASE_EXPOSURE * mult;
  }
}
