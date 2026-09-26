// Shared uniform objects. Every terrain / water / cloud / sky material references the SAME {value}
// objects, so the environment updates them once per frame.
import * as THREE from 'three';

export function createSharedUniforms(atlas: THREE.DataArrayTexture, props: THREE.Texture) {
  return {
    uAtlas: { value: atlas as THREE.Texture },
    uLayerProps: { value: props },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyAmbient: { value: new THREE.Color(0.5, 0.6, 0.8) },
    uGroundAmbient: { value: new THREE.Color(0.3, 0.28, 0.24) },
    uCaveAmbient: { value: new THREE.Color(0.012, 0.014, 0.02) },
    uBlockLightColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
    uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uFogSunColor: { value: new THREE.Color(0.2, 0.15, 0.1) },
    uFogNear: { value: 60 },
    uFogFar: { value: 120 },
    uFogDensity: { value: 0.002 },
    uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
    uUnderwater: { value: 0 },
    uFlash: { value: 0 },
    uWind: { value: new THREE.Vector3(0.6, 0.3, 0.3) },
    uCloudMap: { value: null as THREE.Texture | null },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudScale: { value: 1 / 1536 },
    uCloudHeight: { value: 138 },
    uCloudShadow: { value: 0.5 },
    uCloudThreshold: { value: 0.6 },
    uShadowCenter: { value: new THREE.Vector3() },
    uShadowRadius: { value: 60 },
    uEmissive: { value: 3.2 },
    uOverlay: { value: 0 },
    uLeaseMap: { value: null as THREE.Texture | null },
    uLeaseInfo: { value: new THREE.Vector4(32, 8, 8, 0) },
    uWaterShallow: { value: new THREE.Color(0.1, 0.42, 0.45) },
    uWaterDeep: { value: new THREE.Color(0.02, 0.1, 0.2) },
    uXray: { value: 0 },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;
