// Shared material library. Models are baked with vertex colours and grouped by surface "kind", so
// every building shares a handful of materials. Status looks (lights off, broken, charred) are cached
// variants of the same kinds; only constructing / ghost / ruin instances clone materials (they need
// per-instance clipping planes or tints).
import * as THREE from 'three';
import { C } from './palette';
import { loadSurfaceTextures, type SurfaceTextureSet } from './textures/SurfaceTextures';
import { createSurfaceUniforms, solidPatch, type SurfaceQuality, type SurfaceUniforms } from './textures/surfaceShader';

/** Texture resolution per quality (px per surface tile). */
const TEX_SIZE: Record<Exclude<SurfaceQuality, 'classic'>, number> = { high: 128, ultra: 512 };

export type MatKind =
  | 'solid' // merged bucket: paint/metal/rough/glassDark with per-vertex roughness & metalness
  | 'paint' // painted steel, cladding
  | 'metal' // bare / galvanised steel, pipes
  | 'rough' // concrete, gravel, rubber, dirt
  | 'glass' // windows lit at night
  | 'glassDark' // windows that stay dark
  | 'lamp' // always-on bulbs, floodlights, LED strips
  | 'blink' // aviation obstruction lights (blinking)
  | 'hot' // furnace glow, flame cores (flickers, off when idle)
  | 'liquid' // open water / oil surfaces
  | 'flag' // waving company flag (unmerged attachment)
  | 'sign'; // company sign board (unmerged attachment)

export type MatMode = 'normal' | 'off' | 'broken' | 'charred';

export const LIGHT_KINDS: ReadonlySet<MatKind> = new Set(['lamp', 'blink', 'hot', 'glass']);

const ALL_KINDS: MatKind[] = ['solid', 'paint', 'metal', 'rough', 'glass', 'glassDark', 'lamp', 'blink', 'hot', 'liquid', 'flag', 'sign'];

function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
}

/** Draws the company flag: company colour field, white chevron, flame emblem. */
function makeFlagTexture(color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 80;
  const g = cv.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = '#1d1f22';
  g.fillRect(0, 62, 128, 18);
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.moveTo(64, 12);
  g.bezierCurveTo(82, 32, 86, 42, 80, 52);
  g.bezierCurveTo(74, 62, 54, 62, 48, 52);
  g.bezierCurveTo(42, 42, 50, 30, 64, 12);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 48, 7, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Company sign board: dark panel, orange flame, company name. */
function makeSignTexture(name: string, color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#20252b';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = color;
  g.fillRect(0, 108, 512, 20);
  g.beginPath();
  g.moveTo(58, 16);
  g.bezierCurveTo(84, 44, 90, 60, 82, 76);
  g.bezierCurveTo(74, 92, 42, 92, 34, 76);
  g.bezierCurveTo(26, 60, 36, 40, 58, 16);
  g.fill();
  g.fillStyle = '#f4f1ea';
  let size = 58;
  g.font = `700 ${size}px Rajdhani, "Arial Narrow", Arial, sans-serif`;
  const text = (name || 'PetroCraft').toUpperCase();
  while (g.measureText(text).width > 390 && size > 20) {
    size -= 2;
    g.font = `700 ${size}px Rajdhani, "Arial Narrow", Arial, sans-serif`;
  }
  g.textBaseline = 'middle';
  g.fillText(text, 108, 60);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class MaterialLib {
  private readonly variants = new Map<string, THREE.Material>();
  /** Per-instance clones that must follow the shared day/night parameters. */
  private readonly clones = new Map<THREE.Material, THREE.Material>();
  /** Shared animation uniforms (flag waving). */
  readonly uTime = { value: 0 };
  /** 0 = day .. 1 = full night. */
  night = 0;
  private blinkOn = false;
  private companyColor: string;
  private companyName: string;
  private flagTex: THREE.CanvasTexture;
  private signTex: THREE.CanvasTexture;
  /** Applied texture quality (materials are configured for it). */
  private applied: SurfaceQuality = 'classic';
  private disposed = false;
  private requested: SurfaceQuality = 'classic';
  private surfTex: SurfaceTextureSet | null = null;
  private envMap: THREE.Texture | null = null;
  readonly surfUniforms: SurfaceUniforms = createSurfaceUniforms();
  /** GPU bytes held by the current surface textures (diagnostics). */
  get textureBytes(): number {
    return this.surfTex?.bytes ?? 0;
  }

  constructor(companyColor = '#ff8a1f', companyName = 'PetroCraft') {
    this.companyColor = companyColor;
    this.companyName = companyName;
    this.flagTex = makeFlagTexture(companyColor);
    this.signTex = makeSignTexture(companyName, companyColor);
  }

  get company(): string {
    return this.companyColor;
  }

  /** Texture quality the materials currently use. */
  get quality(): SurfaceQuality {
    return this.applied;
  }

  /** Extra geometric detail in templates (ultra). */
  get fine(): boolean {
    return this.applied === 'ultra';
  }

  /**
   * Request a texture quality. Classic applies at once; textured qualities apply when their procedural
   * textures are ready (generated off the main thread, cached). Existing materials are re-configured in
   * place, so meshes, instanced batches and clones keep their material objects.
   */
  setQuality(q: SurfaceQuality): void {
    if (q !== 'classic' && q !== 'high' && q !== 'ultra') q = 'classic';
    if (q === this.requested) return;
    this.requested = q;
    if (q === 'classic') {
      this.apply('classic', null);
      return;
    }
    loadSurfaceTextures(TEX_SIZE[q])
      .then((set) => {
        if (this.disposed || this.requested !== q) {
          set.detail.dispose();
          set.normal.dispose();
          return;
        }
        this.apply(q, set);
      })
      .catch((err) => console.error('[entities] surface texture generation failed', err));
  }

  /** Environment map for reflections (ultra; null clears). Swapping maps needs no recompile. */
  setEnvMap(tex: THREE.Texture | null): void {
    if (tex === this.envMap) return;
    const had = !!this.envMap;
    this.envMap = tex;
    for (const [key, m] of this.variants) this.configureEnv(m, key.slice(0, key.indexOf('|')) as MatKind, had !== !!tex);
    for (const [clone, base] of this.clones) {
      const b = base as THREE.MeshStandardMaterial;
      const c = clone as THREE.MeshStandardMaterial;
      if ('envMap' in c) {
        c.envMap = b.envMap;
        if (had !== !!tex) c.needsUpdate = true;
      }
    }
  }

  private apply(q: SurfaceQuality, set: SurfaceTextureSet | null): void {
    const old = this.surfTex;
    this.surfTex = set;
    this.applied = q;
    this.surfUniforms.uSurfDetail.value = set?.detail ?? null;
    this.surfUniforms.uSurfNormal.value = set?.normal ?? null;
    for (const [key, m] of this.variants) {
      const kind = key.slice(0, key.indexOf('|')) as MatKind;
      const mode = key.slice(key.indexOf('|') + 1) as MatMode;
      this.configure(m, kind, mode);
    }
    for (const [clone, base] of this.clones) {
      clone.onBeforeCompile = base.onBeforeCompile;
      clone.customProgramCacheKey = base.customProgramCacheKey;
      if ('envMap' in clone) (clone as THREE.MeshStandardMaterial).envMap = (base as THREE.MeshStandardMaterial).envMap;
      clone.needsUpdate = true;
    }
    if (q !== 'ultra') this.setEnvMap(null);
    if (old && old !== set) {
      old.detail.dispose();
      old.normal.dispose();
    }
  }

  /** (Re)apply the quality-dependent shader patch & parameters to a cached material variant. */
  private configure(m: THREE.Material, kind: MatKind, mode: MatMode): void {
    if (kind === 'solid') {
      const p = solidPatch(this.applied, mode === 'charred', this.surfUniforms);
      m.onBeforeCompile = p.onBeforeCompile;
      m.customProgramCacheKey = () => p.key;
      m.needsUpdate = true;
    }
    this.configureEnv(m, kind, true);
  }

  private configureEnv(m: THREE.Material, kind: MatKind, recompile: boolean): void {
    if (!(m instanceof THREE.MeshStandardMaterial) || kind === 'flag' || kind === 'sign') return;
    const env = this.applied === 'ultra' ? this.envMap : null;
    if (m.envMap === env) return;
    m.envMap = env;
    // the scene's own hemisphere/ambient lights already provide diffuse fill: keep the IBL modest
    m.envMapIntensity = kind === 'glass' || kind === 'glassDark' ? 1 : 0.5;
    // glass reads as glass once it has something to reflect
    if (kind === 'glass' || kind === 'glassDark') m.roughness = env ? 0.04 : (m.userData.baseRoughness ?? m.roughness);
    if (recompile) m.needsUpdate = true;
  }

  /** Update company branding (flag & sign textures are redrawn in place). */
  setCompany(color: string, name: string): void {
    if (color === this.companyColor && name === this.companyName) return;
    this.companyColor = color;
    this.companyName = name;
    const f = makeFlagTexture(color);
    const s = makeSignTexture(name, color);
    this.flagTex.image = f.image;
    this.flagTex.needsUpdate = true;
    this.signTex.image = s.image;
    this.signTex.needsUpdate = true;
  }

  get(kind: MatKind, mode: MatMode = 'normal'): THREE.Material {
    const key = `${kind}|${mode}`;
    let m = this.variants.get(key);
    if (!m) {
      m = this.create(kind, mode);
      if (m instanceof THREE.MeshStandardMaterial) m.userData.baseRoughness = m.roughness;
      this.configure(m, kind, mode);
      this.variants.set(key, m);
    }
    return m;
  }

  private create(kind: MatKind, mode: MatMode): THREE.Material {
    const dim = mode === 'broken' ? 0.52 : 1;
    const charred = mode === 'charred';
    const charColor = new THREE.Color(0.1, 0.088, 0.078);
    switch (kind) {
      case 'solid': {
        return std({
          color: charred ? charColor : new THREE.Color(dim, dim, dim),
          roughness: 1,
          metalness: charred ? 0.15 : 1,
        });
      }
      case 'paint':
        return charred ? std({ color: charColor, roughness: 1, metalness: 0 }) : std({ color: new THREE.Color(dim, dim, dim), roughness: 0.72, metalness: 0.08 });
      case 'metal':
        return charred ? std({ color: charColor, roughness: 0.95, metalness: 0.2 }) : std({ color: new THREE.Color(dim * 0.95, dim * 0.93, dim * 0.9), roughness: 0.4, metalness: 0.55 });
      case 'rough':
        return charred ? std({ color: charColor.clone().multiplyScalar(1.4), roughness: 1, metalness: 0 }) : std({ color: new THREE.Color(dim, dim, dim), roughness: 0.95, metalness: 0 });
      case 'glass':
      case 'glassDark': {
        const lit = kind === 'glass' && (mode === 'normal');
        const m = std({
          color: charred ? charColor : new THREE.Color(dim, dim, dim),
          roughness: charred ? 1 : 0.12,
          metalness: charred ? 0 : 0.45,
          emissive: new THREE.Color(C.LAMP_WARM),
          emissiveIntensity: 0,
        });
        m.userData.lit = lit;
        return m;
      }
      case 'lamp':
      case 'blink':
      case 'hot': {
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        m.userData.lightKind = kind;
        m.userData.lit = mode === 'normal';
        if (charred) m.color.copy(charColor);
        else if (mode !== 'normal') m.color.setScalar(0.18);
        return m;
      }
      case 'liquid':
        return std({
          color: charred ? charColor : new THREE.Color(dim, dim, dim),
          roughness: 0.06,
          metalness: 0.25,
          transparent: true,
          opacity: 0.9,
        });
      case 'flag': {
        const m = new THREE.MeshStandardMaterial({
          map: this.flagTex,
          side: THREE.DoubleSide,
          roughness: 0.85,
          color: charred ? charColor : new THREE.Color(dim, dim, dim),
        });
        const uTime = this.uTime;
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = uTime;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              float fx = uv.x;
              float ph = uTime * 5.0 + modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.3;
              transformed.z += (sin(fx * 5.5 - ph) * 0.09 + sin(fx * 11.0 - ph * 1.7) * 0.03) * fx;
              transformed.y += sin(fx * 3.0 - ph * 0.8) * 0.03 * fx;`,
            );
        };
        m.customProgramCacheKey = () => 'pc-flag';
        return m;
      }
      case 'sign':
        return new THREE.MeshStandardMaterial({
          map: charred ? null : this.signTex,
          color: charred ? charColor : new THREE.Color(dim, dim, dim),
          roughness: 0.5,
          metalness: 0.1,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: charred ? null : this.signTex,
          emissiveIntensity: 0,
        });
    }
  }

  /** Per-frame update of shared, time/daylight-driven material parameters. */
  update(time: number, daylight: number): void {
    this.uTime.value = time;
    const night = 1 - THREE.MathUtils.smoothstep(daylight, 0.12, 0.5);
    this.night = night;
    this.blinkOn = time % 1.6 < 0.28;
    const flick = 0.85 + 0.15 * Math.sin(time * 17.3) * Math.sin(time * 7.1 + 1.3);
    for (const [key, m] of this.variants) {
      const mode = key.slice(key.indexOf('|') + 1);
      if (mode !== 'normal') continue;
      const kind = key.slice(0, key.indexOf('|')) as MatKind;
      if (kind === 'glass') (m as THREE.MeshStandardMaterial).emissiveIntensity = 0.04 + 1.25 * night;
      else if (kind === 'sign') (m as THREE.MeshStandardMaterial).emissiveIntensity = 0.55 * night;
      else if (kind === 'lamp') (m as THREE.MeshBasicMaterial).color.setScalar(1.05 + 1.9 * night);
      else if (kind === 'blink') (m as THREE.MeshBasicMaterial).color.setScalar(this.blinkOn ? 1.6 + 2.4 * night : 0.28);
      else if (kind === 'hot') (m as THREE.MeshBasicMaterial).color.setScalar((1.2 + 1.2 * night) * flick);
    }
    for (const [clone, base] of this.clones) {
      if ('emissiveIntensity' in base && 'emissiveIntensity' in clone)
        (clone as THREE.MeshStandardMaterial).emissiveIntensity = (base as THREE.MeshStandardMaterial).emissiveIntensity;
      if (base instanceof THREE.MeshBasicMaterial && clone instanceof THREE.MeshBasicMaterial) clone.color.copy(base.color);
    }
  }

  /** Clone a material for per-instance use (clipping planes). Caller disposes. */
  cloneFor(kind: MatKind, mode: MatMode, planes: THREE.Plane[]): THREE.Material {
    const base = this.get(kind, mode);
    const m = base.clone();
    m.clippingPlanes = planes;
    m.clipShadows = true;
    // Material.clone() does not carry shader patches
    m.onBeforeCompile = base.onBeforeCompile;
    m.customProgramCacheKey = base.customProgramCacheKey;
    m.userData = { ...base.userData, clonedFrom: key(kind, mode) };
    this.clones.set(m, base);
    return m;
  }

  /** Dispose a material obtained from cloneFor(). */
  releaseClone(m: THREE.Material): void {
    if (this.clones.delete(m)) m.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.variants.values()) m.dispose();
    for (const m of this.clones.keys()) m.dispose();
    this.variants.clear();
    this.clones.clear();
    this.flagTex.dispose();
    this.signTex.dispose();
    if (this.surfTex) {
      this.surfTex.detail.dispose();
      this.surfTex.normal.dispose();
      this.surfTex = null;
    }
  }

  static readonly kinds = ALL_KINDS;
}

const key = (k: MatKind, m: MatMode) => `${k}|${m}`;

/** Translucent material used for build ghosts (one per mesh; the player module tints them). */
export function makeGhostMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9fe8a0,
    emissive: 0x1a3a1a,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    roughness: 0.6,
    metalness: 0,
  });
}

/** Blueprint look for the not-yet-built part of a construction site. */
export function makeBlueprintMaterial(planes: THREE.Plane[]): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x7cc4ff,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    clippingPlanes: planes,
  });
}
