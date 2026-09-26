// Minimal fake GameContext + RenderHost for exercising the audio engine without the real game.
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import { createInitialState } from '../../src/core/state';
import { rotatedSize } from '../../src/core/buildingUtil';
import { B } from '../../src/core/blocks';
import { SEA_LEVEL } from '../../src/core/constants';
import type { BiomeId, BuildingState, BuildingStatus, GameContext, IGeology, IWorld, WellState } from '../../src/core/types';
import type { RenderHost } from '../../src/core/client';

export interface FakeWorldOptions {
  biome: BiomeId;
  /** Water everywhere x < coastX. */
  coastX: number;
  groundY: number;
}

export interface FakeGame {
  ctx: GameContext;
  host: RenderHost;
  camera: THREE.PerspectiveCamera;
  opts: FakeWorldOptions;
  setCamera(x: number, y: number, z: number, yaw: number): void;
  addBuilding(type: string, x: number, z: number, status: BuildingStatus, extra?: Partial<BuildingState>): BuildingState;
  addWell(x: number, z: number, status: WellState['status'], extra?: Partial<WellState>): WellState;
}

export function createFakeGame(): FakeGame {
  const opts: FakeWorldOptions = { biome: 'forest', coastX: -40, groundY: 70 };
  const size = 512;
  const geology = {
    seed: 1, sizeX: size, sizeZ: size, reservoirs: [], faults: [], aquifers: [],
    surfaceHeight: (x: number) => (x < opts.coastX ? SEA_LEVEL - 6 : opts.groundY),
    waterDepth: (x: number) => (x < opts.coastX ? 6 : 0),
    isOffshore: (x: number) => x < opts.coastX,
    biomeAt: () => opts.biome,
  } as unknown as IGeology;
  const world = {
    sizeX: size, sizeZ: size, height: 160, seed: 1, geology,
    inBounds: (x: number, y: number, z: number) => x >= 0 && z >= 0 && x < size && z < size && y >= 0 && y < 160,
    getBlock: (x: number, y: number) => {
      const surf = x < opts.coastX ? SEA_LEVEL - 6 : opts.groundY;
      if (y < surf) return B.STONE;
      if (x < opts.coastX && y <= SEA_LEVEL) return B.WATER;
      return B.AIR;
    },
    getSurfaceY: (x: number) => (x < opts.coastX ? SEA_LEVEL + 1 : opts.groundY),
    isSolid: () => false,
  } as unknown as IWorld;
  const bus = new EventBus();
  const state = createInitialState(
    { saveName: 'audio', companyName: 'Test', seed: 1, worldSize: 'medium', difficulty: 'normal', tutorial: false, hazards: true, creative: false },
    'p1', { x: 256, y: 70, z: 256 },
  );
  let nextId = 1;
  const ctx = {
    state, world, geology, bus, settings: {} as never, localPlayerId: 'p1', isAuthority: true,
    commands: {} as never, services: {} as never,
    rng: Math.random, newId: (p: string) => `${p}${nextId++}`,
    notify: () => {}, transact: () => true, hasTech: () => true, modifier: () => 1,
  } as unknown as GameContext;

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1000);
  const host = {
    camera, daylight: 1, overlay: null, buildingPreview: null, fps: 60, loadProgress: 1,
    onFrame: () => () => {}, setBlockHighlight: () => {}, setSelectionBox: () => {}, shake: () => {},
  } as unknown as RenderHost;

  const setCamera = (x: number, y: number, z: number, yaw: number) => {
    camera.position.set(x, y, z);
    camera.rotation.set(0, yaw, 0, 'YXZ');
    camera.updateMatrixWorld(true);
  };
  setCamera(256, opts.groundY + 1.6, 256, 0);

  const addBuilding = (type: string, x: number, z: number, status: BuildingStatus, extra: Partial<BuildingState> = {}) => {
    const b: BuildingState = {
      id: `b${nextId++}`, type, x, y: opts.groundY, z, rotation: 0, size: rotatedSize(type, 0), status, enabled: true,
      constructionProgress: status === 'constructing' ? 0.3 : 1, condition: 100, fire: 0, builtDay: 1, lastMaintenanceDay: 1,
      storage: {}, throttle: 1, utilization: 0.8, io: {}, workers: [], config: {}, owner: 'p1', data: {}, ...extra,
    };
    state.buildings[b.id] = b;
    return b;
  };
  const addWell = (x: number, z: number, status: WellState['status'], extra: Partial<WellState> = {}) => {
    const w = {
      id: `w${nextId++}`, name: 'Test 1', x, z, surfaceY: opts.groundY, offshore: false, purpose: 'development', status,
      plan: { kind: 'vertical', targetY: 20, casingPoints: [], mudWeight: 9 }, trajectory: [], measuredDepth: 0, plannedDepth: 40,
      currentY: 60, casing: [], mudWeight: 9, bitCondition: 100, kickVolume: 0, penetrated: [], completedReservoirs: [],
      reservoirContact: 0, fracStages: 0, choke: 0.6, lift: 'natural', productivity: 1, rates: { oil: 0, gas: 0, water: 0 },
      bhp: 0, waterCut: 0, gor: 0, cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 1, cost: 0, owner: 'p1',
      ...extra,
    } as WellState;
    state.wells[w.id] = w;
    return w;
  };
  return { ctx, host, camera, opts, setCamera, addBuilding, addWell };
}
