// Unit primitive geometries shared by the model builder. Each part is cloned from one of these,
// transformed and colour-baked, then merged per material. Prototypes are never disposed.
import * as THREE from 'three';

const cache = new Map<string, THREE.BufferGeometry>();

function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  return g;
}

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = strip(make());
    cache.set(key, g);
  }
  return g;
}

/** 1×1×1 box centred on the origin. */
export const boxProto = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1));

/** 1×1×1 box spanning y ∈ [0, 1] (for beams between two points). */
export const beamProto = () => cached('beam', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

/** Cylinder of radius 1 (top radius `taper`), y ∈ [0, 1]. */
export const cylProto = (seg: number, taper = 1, open = false) =>
  cached(`cyl:${seg}:${taper.toFixed(3)}:${open}`, () => new THREE.CylinderGeometry(taper, 1, 1, seg, 1, open).translate(0, 0.5, 0));

/** Unit sphere. */
export const sphereProto = (seg: number) => cached(`sph:${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.6))));

/** Upper hemisphere of radius 1 (y ∈ [0, 1]). */
export const domeProto = (seg: number) =>
  cached(`dome:${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(3, Math.round(seg * 0.3)), 0, Math.PI * 2, 0, Math.PI / 2));

/** Torus in the XZ plane (ring around +Y), major radius 1, tube radius `tube`. */
export const torusProto = (tube: number, seg: number) =>
  cached(`tor:${tube.toFixed(3)}:${seg}`, () => new THREE.TorusGeometry(1, tube, 5, seg).rotateX(Math.PI / 2));

/** Unit plane in XY facing +Z. */
export const planeProto = () => cached('plane', () => new THREE.PlaneGeometry(1, 1));

/** Horizontal plane in XZ facing +Y. */
export const floorProto = () => cached('floor', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

/** Triangular prism (gable roof): base x ∈ [-.5,.5] at y=0, ridge at y=1, extruded z ∈ [-.5,.5]. */
export const prismProto = () =>
  cached('prism', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0, 1);
    shape.lineTo(-0.5, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g.index ? g : indexify(g);
  });

/** Wedge (ramp): full height at x=-.5, zero at x=.5; y ∈ [0,1], z ∈ [-.5,.5]. */
export const wedgeProto = () =>
  cached('wedge', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(-0.5, 1);
    shape.lineTo(-0.5, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g.index ? g : indexify(g);
  });

/** Convert a non-indexed geometry into an indexed one (trivial index) so it merges with the rest. */
function indexify(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}
