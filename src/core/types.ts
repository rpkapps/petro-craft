// ================================================================================================
//  PetroCraft core contracts. Every subsystem codes against these types.
//
//  Architecture (multiplayer-ready):
//   * GameState is a plain, JSON-serializable object — the single source of truth for the sim.
//   * ALL mutations of GameState made on behalf of a player go through Commands (see commands.ts),
//     which carry a playerId. A future server runs the same systems authoritatively and clients
//     send commands over a Transport (see net/).
//   * Systems (SimSystem) advance the state in fixed steps. They must only use ctx.rng() for
//     randomness so simulation is deterministic given the same command stream.
//   * Voxel data lives in IWorld (seed + per-chunk deltas are what get saved).
//   * The static subsurface model (reservoirs, faults, aquifers, rock properties) is IGeology,
//     derived deterministically from the seed. Dynamic reservoir state lives in GameState.
// ================================================================================================

import type { Difficulty, WorldSizeKey } from './constants';
import type { WorkerRole } from '../content/buildings';
import type { ModifierKey } from '../content/tech';
import type { EventBus } from './EventBus';
import type { CommandBus } from './commands';

export type { WorkerRole, ModifierKey, Difficulty, WorldSizeKey };

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; z: number }
export type Rotation = 0 | 1 | 2 | 3;
export type FluidCat = 'oil' | 'gas' | 'water' | 'product';

// ------------------------------------------------------------------------------------------------
// Geology (static, generated from seed by the world module)
// ------------------------------------------------------------------------------------------------
export type RockType =
  | 'soil' | 'sand' | 'clay' | 'sandstone' | 'shale' | 'limestone' | 'dolomite' | 'salt'
  | 'granite' | 'basalt' | 'chalk' | 'coal' | 'mudstone' | 'caprock' | 'bedrock' | 'water' | 'silt';

export type ReservoirFluid = 'oil' | 'gas' | 'condensate';
export type TrapType = 'anticline' | 'fault' | 'salt_dome' | 'stratigraphic' | 'reef' | 'shale_play';

export interface Reservoir {
  id: string;
  name: string; // e.g. "Eagle Sand A"
  fluid: ReservoirFluid;
  trap: TrapType;
  /** Rock that hosts the reservoir. */
  lithology: 'sandstone' | 'limestone' | 'dolomite' | 'shale';
  /** Geometry in block coordinates: an irregular lens approximated by centre + radii. */
  center: Vec3;
  radiusX: number;
  radiusZ: number;
  /** Y range (block coords). top > bottom. */
  topY: number;
  bottomY: number;
  /** Fault compartment index; reservoirs split by faults have different ids. */
  compartment: number;
  offshore: boolean;
  /** Rock & fluid properties. */
  porosity: number; // fraction 0.05..0.32
  permeability: number; // millidarcy 0.001 (shale) .. 2000
  netToGross: number; // 0..1
  waterSaturation: number; // initial Sw 0.15..0.5
  initialPressure: number; // psi
  temperature: number; // °C
  bubblePoint: number; // psi (oil) / dew point (condensate)
  apiGravity: number; // crude quality (oil)
  gasOilRatio: number; // scf/bbl initial solution GOR
  h2s: number; // mole fraction of H2S in gas (sour if > 0.01)
  co2: number; // mole fraction CO2
  /** Original volumes in place (stock tank). */
  oilInPlace: number; // bbl
  gasInPlace: number; // mcf
  /** Aquifer support 0 (depletion drive) .. 1 (strong water drive). */
  waterDrive: number;
  /** Gas cap present above oil leg. */
  gasCap: boolean;
  /** Oil-water contact / gas-oil contact Y (block coords). */
  owcY: number;
  gocY?: number;
  /** Discovered by the player (revealed via survey or drilling). */
  // (discovery state lives in GameState.reservoirs[id].discovered)
}

export interface Fault {
  id: string;
  /** Fault trace on the surface: line through p0-p1 (block coords, x/z) extended across the map. */
  p0: Vec2;
  p1: Vec2;
  /** Dip angle in degrees and dip direction sign (+1 / -1 relative to trace normal). */
  dip: number;
  dipSign: 1 | -1;
  /** Vertical throw in blocks (hanging wall down). */
  throw: number;
  /** Sealing faults split reservoirs into compartments. */
  sealing: boolean;
}

export interface Aquifer {
  id: string;
  center: Vec3;
  radiusX: number;
  radiusZ: number;
  topY: number;
  bottomY: number;
  salinity: number; // ppm
  fresh: boolean; // shallow freshwater aquifer — must be protected with surface casing!
}

export interface RockProperties {
  rock: RockType;
  porosity: number;
  permeability: number;
  /** Drilling hardness multiplier 0.3 (soft) .. 3 (basalt). */
  hardness: number;
  /** Acoustic impedance (arbitrary units ~ 2..12) → seismic reflectivity. */
  impedance: number;
  /** Wireline log responses. */
  gammaRay: number; // API units 10..150 (shale high)
  resistivity: number; // ohm·m 0.5 (brine) .. 200 (hydrocarbons / tight)
  density: number; // g/cc
  /** Pore fluid at this point. */
  fluid: 'none' | 'brine' | 'fresh' | 'oil' | 'gas';
  reservoirId?: string;
  aquiferId?: string;
}

export interface IGeology {
  readonly seed: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly reservoirs: Reservoir[];
  readonly faults: Fault[];
  readonly aquifers: Aquifer[];
  /** Natural terrain surface height (first air block above ground) before player edits. */
  surfaceHeight(x: number, z: number): number;
  /** Seabed height for ocean columns (== surfaceHeight), and water depth in blocks (0 on land). */
  waterDepth(x: number, z: number): number;
  isOffshore(x: number, z: number): boolean;
  biomeAt(x: number, z: number): BiomeId;
  rockAt(x: number, y: number, z: number): RockType;
  properties(x: number, y: number, z: number): RockProperties;
  reservoirAt(x: number, y: number, z: number): Reservoir | null;
  aquiferAt(x: number, y: number, z: number): Aquifer | null;
  /** Initial pore pressure (psi) — hydrostatic with overpressured zones. */
  porePressure(x: number, y: number, z: number): number;
  /** Fracture gradient pressure (psi) — mud above this causes losses. */
  fracturePressure(x: number, y: number, z: number): number;
  getReservoir(id: string): Reservoir | undefined;
}

export type BiomeId = 'plains' | 'forest' | 'birch_forest' | 'taiga' | 'desert' | 'badlands' | 'swamp' | 'tundra' | 'mountains' | 'beach' | 'ocean' | 'deep_ocean' | 'river';

// ------------------------------------------------------------------------------------------------
// Voxel world
// ------------------------------------------------------------------------------------------------
export interface IWorld {
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly height: number;
  readonly seed: number;
  readonly geology: IGeology;
  getBlock(x: number, y: number, z: number): number;
  /** Sets a block, records the delta for saving, emits 'world:blockChanged'. Returns false if out of bounds. */
  setBlock(x: number, y: number, z: number, id: number, source?: 'player' | 'system' | 'load'): boolean;
  inBounds(x: number, y: number, z: number): boolean;
  isSolid(x: number, y: number, z: number): boolean;
  /** Highest non-air, non-liquid block y + 1 (first free y) at a column, considering edits. */
  getSurfaceY(x: number, z: number): number;
  /** Generates chunk data if needed (synchronous). */
  ensureChunk(cx: number, cz: number): void;
  isChunkGenerated(cx: number, cz: number): boolean;
  /** Raw chunk data access for the mesher: Uint8Array of CHUNK_SIZE*CHUNK_SIZE*WORLD_HEIGHT,
   *  index = x + z*CHUNK_SIZE + y*CHUNK_SIZE*CHUNK_SIZE (local coords). Undefined if not generated. */
  getChunkData(cx: number, cz: number): Uint8Array | undefined;
  readonly chunksX: number;
  readonly chunksZ: number;
  /** Iterate every block that differs from generated terrain (player/system edits). Used to rebuild pipe networks on load. */
  forEachEdit(fn: (x: number, y: number, z: number, id: number) => void): void;
  /** Serialize edits (compressed per-chunk deltas) / restore them. */
  serializeEdits(): WorldEditsSave;
  loadEdits(save: WorldEditsSave): void;
}

export interface WorldEditsSave {
  /** chunkKey "cx,cz" → base64 of fflate-compressed list of (index:uint32, id:uint8). */
  chunks: Record<string, string>;
}

// ------------------------------------------------------------------------------------------------
// Game state
// ------------------------------------------------------------------------------------------------
export interface GameState {
  version: number;
  meta: GameMeta;
  time: TimeState;
  /** Deterministic RNG state (mulberry32 seed). Only advance via ctx.rng(). */
  rngState: number;
  company: CompanyState;
  players: Record<string, PlayerState>;
  buildings: Record<string, BuildingState>;
  wells: Record<string, WellState>;
  /** Dynamic reservoir state keyed by Reservoir.id. */
  reservoirs: Record<string, ReservoirState>;
  surveys: Record<string, SurveyState>;
  /** Pipe networks are derived (rebuilt from world pipe blocks) but their fluid buffers persist here. */
  networks: Record<string, NetworkState>;
  market: MarketState;
  contracts: ContractsState;
  workforce: WorkforceState;
  research: ResearchState;
  leases: Record<string, LeaseState>; // key "px,pz" parcel coords
  environment: EnvironmentState;
  weather: WeatherState;
  hazards: HazardsState;
  power: PowerState;
  objectives: ObjectivesState;
  notifications: Notification[];
  stats: StatsState;
  /** Items dropped in the world (player 'Q' drops); picked up by walking over them. */
  drops?: DroppedItem[];
  nextId: number;
  /** Economy module bookkeeping (plain JSON, owned by sim/economy). */
  economy?: unknown;
}

export interface GameMeta {
  saveName: string;
  companyName: string;
  seed: number;
  worldSize: WorldSizeKey;
  difficulty: Difficulty;
  createdAt: number; // epoch ms (real)
  lastSavedAt: number;
  playTimeSec: number;
  /** Rules toggles. */
  rules: { hazards: boolean; tutorial: boolean; creative: boolean };
}

export interface TimeState {
  tick: number;
  /** Total elapsed game minutes since start. */
  totalMinutes: number;
  day: number; // 1-based day counter
  minuteOfDay: number; // 0..1439
  speed: number; // one of GAME_SPEEDS
  paused: boolean;
  /** Calendar start (year/month) for display. */
  startYear: number;
}

export interface CompanyState {
  name: string;
  money: number;
  /** Credit rating & reputation (0..100). */
  reputation: number;
  loans: Loan[];
  /** Company warehouse (supplies + commodities held off-network). itemId → qty */
  warehouse: Record<string, number>;
  /** Recent ledger entries (capped ~500). */
  ledger: LedgerEntry[];
  /** Daily P&L history (capped ~365). */
  history: DailyFinance[];
  /** Today's running totals. */
  today: DailyFinance;
  /** Auto-sell rules: commodity → min price (sell when above) or null (never auto-sell). */
  autoSell: Record<string, { enabled: boolean; minPrice: number; keepReserve: number }>;
  color: string; // company colour for flags/liveries
}

export interface Loan { id: string; principal: number; balance: number; rate: number; takenDay: number; termDays: number; dailyPayment: number }
export type LedgerCategory = 'sales' | 'contracts' | 'construction' | 'drilling' | 'opex' | 'wages' | 'supplies' | 'research' | 'leases' | 'royalties' | 'fines' | 'interest' | 'loan' | 'repairs' | 'insurance' | 'transport' | 'fuel' | 'survey' | 'carbon' | 'misc';
export interface LedgerEntry { day: number; minute: number; amount: number; category: LedgerCategory; note: string }
export interface DailyFinance { day: number; revenue: number; expenses: number; byCategory: Partial<Record<LedgerCategory, number>>; production: Record<string, number> }

export type PlayerMode = 'walk' | 'fly' | 'drone';
export interface InventorySlot { item: string; count: number }
/** An item stack lying in the world. Position is the item's centre (block coords). */
export interface DroppedItem { id: string; item: string; count: number; x: number; y: number; z: number; droppedMinute: number; droppedBy?: string }
export interface PlayerState {
  id: string;
  name: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  mode: PlayerMode;
  health: number; // 0..100
  /** 36 slots; 0..8 are the hotbar. null = empty. */
  inventory: (InventorySlot | null)[];
  selectedSlot: number;
  color: string;
}

// ---- Buildings ------------------------------------------------------------------------------
export type BuildingStatus =
  | 'constructing' // under construction (constructionProgress < 1)
  | 'active' // running
  | 'idle' // built but nothing to do (no input / no work)
  | 'disabled' // switched off by player
  | 'unstaffed' // lacking crew
  | 'no_power'
  | 'broken' // failed; needs repair
  | 'fire' // on fire
  | 'destroyed'; // burnt out ruin — demolish to clear

export interface BuildingState {
  id: string;
  type: string; // BuildingDef.id
  x: number; y: number; z: number; // origin (min corner, ground level)
  rotation: Rotation;
  /** Actual footprint after rotation: [w, d, h]. */
  size: [number, number, number];
  status: BuildingStatus;
  enabled: boolean;
  constructionProgress: number; // 0..1
  /** Mechanical condition 0..100 — lower increases failure probability. */
  condition: number;
  /** Fire intensity 0..1 when status === 'fire'. */
  fire: number;
  builtDay: number;
  lastMaintenanceDay: number;
  /** Local storage buffers: itemId → qty (tanks, plant feed/product buffers). */
  storage: Record<string, number>;
  /** Selected recipe for processing buildings. */
  recipeId?: string;
  /** Throughput setpoint 0..1. */
  throttle: number;
  /** Measured utilisation 0..1 over the last hour (for UI/animations). */
  utilization: number;
  /** Live IO rates (units/day) for UI: itemId → rate (+produce / −consume). */
  io: Record<string, number>;
  /** Assigned worker ids. */
  workers: string[];
  /** Linked well (rigs drilling, wellheads, frac spreads). */
  wellId?: string;
  /** Per-type configuration (UI editable via 'building/configure'). */
  config: Record<string, number | string | boolean>;
  /** Owner player/company id (multiplayer). */
  owner: string;
  /** Free-form, type-specific sim data. */
  data: Record<string, unknown>;
}

// ---- Wells ----------------------------------------------------------------------------------
export type WellStatus =
  | 'planned'
  | 'drilling'
  | 'tripping' // pulling pipe to change bit
  | 'casing' // running & cementing casing
  | 'kick' // influx detected — well control event
  | 'blowout' // uncontrolled flow (often on fire)
  | 'drilled' // TD reached, awaiting completion
  | 'completing'
  | 'fracking'
  | 'producing'
  | 'injecting'
  | 'shut_in'
  | 'dry_hole' // plugged: no hydrocarbons
  | 'plugged'; // abandoned

export type WellPurpose = 'exploration' | 'appraisal' | 'development' | 'injector_water' | 'injector_gas' | 'injector_co2' | 'disposal';
export type LiftType = 'natural' | 'pumpjack' | 'esp' | 'gaslift';

export interface WellPlan {
  kind: 'vertical' | 'directional' | 'horizontal';
  /** Target true vertical depth (block y of TD / landing point). */
  targetY: number;
  /** For directional/horizontal: kickoff y, build toward azimuth (radians, 0 = +x, PI/2 = +z). */
  kickoffY?: number;
  azimuth?: number;
  /** Directional: horizontal offset to target (blocks). Horizontal: lateral length (blocks). */
  offset?: number;
  lateralLength?: number;
  /** Casing program: y depths where casing strings are set (surface, intermediate, production). */
  casingPoints: number[];
  /** Mud weight setpoint (ppg). */
  mudWeight: number;
}

export interface CasingString { name: 'conductor' | 'surface' | 'intermediate' | 'production' | 'liner'; topY: number; bottomY: number; cemented: boolean }

export interface WellLogSample {
  /** Measured depth index along trajectory (blocks). */
  md: number;
  y: number; // TVD block y
  gammaRay: number;
  resistivity: number;
  porosity: number;
  density: number;
  fluid: RockProperties['fluid'];
  rock: RockType;
  /** Mud gas show (units), a drilling-time hydrocarbon indicator. */
  gasShow: number;
}

export interface WellState {
  id: string;
  name: string; // e.g. "Eagle 3-H"
  x: number; z: number; // surface location (block coords, centre of wellhead)
  surfaceY: number;
  offshore: boolean;
  purpose: WellPurpose;
  status: WellStatus;
  plan: WellPlan;
  /** Drilled trajectory points (block coords, from surface down). Updated as drilling progresses. */
  trajectory: Vec3[];
  /** Measured depth drilled (blocks along path) & planned total. */
  measuredDepth: number;
  plannedDepth: number;
  currentY: number;
  rigId?: string;
  wellheadId?: string;
  casing: CasingString[];
  mudWeight: number; // ppg (live)
  bitCondition: number; // 0..100
  /** Well control: influx volume (bbl) & kick intensity. */
  kickVolume: number;
  /** Blowout flow & fire. */
  blowout?: { startedDay: number; onFire: boolean; flowRate: number; capProgress: number };
  /** Reservoirs penetrated & completed (perforated) intervals. */
  penetrated: string[];
  completedReservoirs: string[];
  /** Contact length with reservoir in blocks (horizontal wells ≫ vertical). */
  reservoirContact: number;
  fracStages: number;
  /** Production controls. */
  choke: number; // 0..1 open fraction
  lift: LiftType;
  /** Productivity index multiplier (skin, fracs, damage). */
  productivity: number;
  /** Live rates (per day). Negative = injection. */
  rates: { oil: number; gas: number; water: number };
  /** Bottom-hole flowing pressure (psi). */
  bhp: number;
  waterCut: number; // 0..1
  gor: number; // scf/bbl
  cumulative: { oil: number; gas: number; water: number };
  /** Daily production history (capped ~720 entries): [day, oil, gas, water]. */
  history: [number, number, number, number][];
  /** Wireline / drilling logs. */
  log: WellLogSample[];
  spudDay: number;
  completedDay?: number;
  cost: number; // total spent
  owner: string;
  /** Upstream-module extra data (plain JSON): op {kind,label,hoursLeft,hoursTotal}, limit (string), potential, lostCirc, kickHours, res… */
  up?: Record<string, any>;
}

export interface ReservoirState {
  id: string;
  discovered: boolean;
  /** Seismic/drilling knowledge level 0..1 (how well the player "sees" it on maps). */
  knowledge: number;
  pressure: number; // psi (current average)
  cumulative: { oil: number; gas: number; water: number };
  injected: { water: number; gas: number; co2: number };
  /** Remaining recoverable estimates for UI. */
  remainingOil: number;
  remainingGas: number;
  waterFrontY: number; // rising OWC as water sweeps
  /** Upstream-module extra data (plain JSON), e.g. urf (current ultimate recovery factor). */
  up?: Record<string, any>;
}

// ---- Exploration ----------------------------------------------------------------------------
export interface SurveyState {
  id: string;
  kind: '2d' | '3d';
  /** 2D: line from (x0,z0) to (x1,z1). 3D: rectangle corners. */
  x0: number; z0: number; x1: number; z1: number;
  status: 'in_progress' | 'processing' | 'complete';
  progress: number; // 0..1
  /** Resolution multiplier from tech at time of shooting. */
  quality: number;
  fluidIndicators: boolean;
  startedDay: number;
  completedDay?: number;
  cost: number;
  name: string;
}

/** Seismic image produced deterministically from geology (not stored in state). */
export interface SeismicImage {
  width: number; // traces along line (or x for 3D slices)
  height: number; // samples in depth (block y from top to bottom)
  /** Amplitude −1..1, row-major [row * width + col], row 0 = shallowest. */
  data: Float32Array;
  /** Optional fluid-indicator overlay 0 none, 1 brine, 2 oil, 3 gas. */
  fluid?: Uint8Array;
  topY: number;
  bottomY: number;
  /** World coords per column. */
  columns: Vec2[];
}

// ---- Pipe networks ------------------------------------------------------------------------------
export interface NetworkState {
  id: string;
  category: FluidCat;
  /** Number of pipe blocks & connected building ids (derived; recomputed on topology change). */
  pipeCount: number;
  buildings: string[];
  /** Fluid in the pipes themselves (line pack): itemId → qty. */
  linepack: Record<string, number>;
  /** Throughput capacity (units/day) and current flow. */
  capacity: number;
  flow: number;
  /** Boosters (pump/compressor stations) connected. */
  boosters: number;
  /** Representative pipe block (for locating the network in the world). */
  anchor: Vec3;
  leak?: { x: number; y: number; z: number; rate: number; startedDay: number };
}

// ---- Markets --------------------------------------------------------------------------------
export interface MarketState {
  /** Current price per commodity (USD/unit). */
  prices: Record<string, number>;
  /** Daily price history per commodity (capped ~365). */
  history: Record<string, number[]>;
  /** Active market events (e.g. OPEC cut, hurricane). */
  events: MarketEvent[];
  /** Regional demand multiplier per commodity (affects how much the market absorbs). */
  demand: Record<string, number>;
  /** Units sold per commodity today (price impact). */
  soldToday: Record<string, number>;
  /** Futures hedges. */
  hedges: Hedge[];
}
export interface MarketEvent { defId?: string; icon?: string; id: string; title: string; description: string; startDay: number; endDay: number; effects: Record<string, number> /* commodity → price multiplier */; severity: 'minor' | 'major' | 'crisis' }
export interface Hedge { id: string; commodity: string; volume: number; price: number; expiryDay: number; remaining: number }

export interface Contract {
  id: string;
  client: string;
  title: string;
  commodity: string;
  quantity: number;
  delivered: number;
  pricePerUnit: number; // agreed price
  bonus: number; // paid on completion
  penalty: number; // charged on failure
  offeredDay: number;
  deadlineDay: number;
  status: 'offered' | 'active' | 'completed' | 'failed' | 'expired';
  /** Minimum reputation required to accept. */
  minReputation: number;
  description?: string;
  clientKind?: string;
  premium?: boolean;
  acceptedDay?: number;
}
export interface ContractsState { offers: Contract[]; active: Contract[]; completed: Contract[] }

// ---- Workforce ------------------------------------------------------------------------------
export interface Worker {
  id: string;
  name: string;
  role: WorkerRole;
  skill: number; // 1..5
  xp: number;
  wage: number; // USD/day
  morale: number; // 0..100
  fatigue: number; // 0..100
  assignedTo?: string; // building id
  hiredDay: number;
  injured?: number; // day until recovered
  portraitSeed: number;
  /** Manually assigned (auto-assign won't move them). */
  pinned?: boolean;
  daysWorked?: number;
}
export interface WorkforceState { workers: Worker[]; candidates: Worker[]; lastRefreshDay: number; autoAssign: boolean; housing: number }

// ---- Research ---------------------------------------------------------------------------------
export interface ResearchState {
  completed: string[];
  current: string | null;
  progress: number; // points accumulated in current
  queue: string[];
  pointsPerDay: number;
  totalPoints: number;
}

// ---- Leases -----------------------------------------------------------------------------------
export interface LeaseState { px: number; pz: number; owner: string; acquiredDay: number; price: number; royalty: number; expiresDay?: number }

// ---- Environment, weather, hazards, power ------------------------------------------------------
export interface EnvironmentState {
  /** 0..100 — community & regulator standing (social licence to operate). */
  score: number;
  emissionsToday: number; // t CO2e
  emissionsTotal: number;
  flaredToday: number; // mcf
  ventedToday: number; // mcf
  spills: Spill[];
  finesTotal: number;
  carbonCredits: number;
  /** Warnings issued by regulator; at 3 → operations suspended for some days. */
  violations: number;
  suspendedUntilDay?: number;
  /** Daily score history (end-of-day score, capped ~365). */
  history?: number[];
}
export interface Spill { id: string; x: number; y: number; z: number; volume: number; cleaned: number; day: number; kind: 'oil' | 'water' | 'chemical' }

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'blizzard' | 'fog' | 'heatwave' | 'hurricane';
export interface WeatherState {
  current: WeatherKind;
  intensity: number; // 0..1
  temperature: number; // °C
  windSpeed: number; // m/s
  windDir: number; // radians
  cloudCover: number; // 0..1
  precipitation: number; // 0..1
  /** Day forecasts. */
  forecast: { day: number; kind: WeatherKind; tempHigh: number; tempLow: number; wind: number }[];
  /** Transition progress to next weather. */
  nextChangeMinute: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
}

export interface Fire { id: string; x: number; y: number; z: number; intensity: number; buildingId?: string; wellId?: string; startedMinute: number; spreadTimer: number }
export interface HazardsState {
  fires: Fire[];
  /** Recent incidents log for the UI. */
  incidents: { day: number; kind: 'fire' | 'blowout' | 'explosion' | 'spill' | 'failure' | 'injury' | 'leak' | 'lightning' | 'h2s'; text: string; x?: number; z?: number }[];
  daysSinceIncident: number;
}

export interface PowerState { generation: number; demand: number; satisfaction: number /* 0..1 */; gridImport: number /* MW bought from utility */ }

// ---- Objectives / tutorial / stats --------------------------------------------------------------
export interface Objective { id: string; title: string; description: string; progress: number; target: number; reward: number; done: boolean; claimed: boolean; chapter: number }
export interface ObjectivesState { list: Objective[]; chapter: number; tutorialStep: number; tutorialDone: boolean; achievements: string[] }

export interface StatsState {
  totalOil: number; totalGas: number; totalWater: number;
  totalRevenue: number; totalExpenses: number;
  wellsDrilled: number; dryHoles: number; blowouts: number; fires: number;
  blocksMined: number; blocksPlaced: number; peakOilRate: number;
  companyValueHistory: number[];
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';
export interface Notification { id: string; day: number; minute: number; level: NotificationLevel; title: string; text?: string; /** optional world position to focus. */ at?: Vec3; read: boolean; icon?: string }

// ------------------------------------------------------------------------------------------------
// Runtime context & systems
// ------------------------------------------------------------------------------------------------
export interface Settings {
  renderDistance: number; // chunks
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  shadows: boolean;
  shadowQuality: 'low' | 'medium' | 'high';
  bloom: boolean;
  ssao: boolean;
  clouds: boolean;
  particles: 'low' | 'medium' | 'high';
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  uiScale: number;
  units: 'imperial' | 'metric';
  autosaveMinutes: number;
  showFps: boolean;
  /** Internal render resolution multiplier (0.5..1; pixel ratio is also capped by the device). */
  renderScale: number;
  /** Automatically lower render scale / effects when frame time is too high. */
  autoQuality: boolean;
  /** Post-process antialiasing (FXAA/SMAA). */
  antialias: boolean;
  /** Exposure/brightness multiplier (0.6..1.6). */
  brightness: number;
  keybinds: Record<string, string>;
}

/** Services exposed by systems for UI/render/player queries (non-mutating or command helpers). */
export interface Services {
  seismic: {
    /** Build a 2D section image for a completed/in-progress survey (for 3D surveys, `sliceZ`/`sliceX` choose an inline/crossline, or depthY for a time slice). */
    getSection(survey: SurveyState, opts?: { inline?: number; crossline?: number; resolution?: number }): SeismicImage;
    /** Depth slice (map view) at block y for a 3D survey: returns width=|x1-x0|, height=|z1-z0|. */
    getDepthSlice(survey: SurveyState, y: number): SeismicImage;
    /** Estimated cost & days for a survey. */
    quote(kind: '2d' | '3d', x0: number, z0: number, x1: number, z1: number): { cost: number; days: number };
  };
  wells: {
    /** Cost/time estimate for a well plan at a location. */
    quote(x: number, z: number, plan: WellPlan, rigType: string): { cost: number; days: number; warnings: string[] };
    /** Suggested default plan (casing points, mud weight) for a surface location & target y. */
    suggestPlan(x: number, z: number, targetY: number, kind: WellPlan['kind']): WellPlan;
    /** Pore/fracture pressure profile at a location for the mud-weight window chart (ppg). */
    pressureProfile(x: number, z: number): { y: number; pore: number; frac: number }[];
    /** Compute the planned trajectory polyline for preview. */
    planTrajectory(x: number, y: number, z: number, plan: WellPlan): Vec3[];
  };
  construction: {
    /** Validate a placement; returns the pad height (y) that will be used. */
    validate(type: string, x: number, z: number, rotation: Rotation, playerY?: number): { ok: boolean; reason?: string; y: number; cost: number };
    /** Building id at a block position (via structure occupancy), if any. */
    buildingAt(x: number, y: number, z: number): string | undefined;
    footprint(type: string, rotation: Rotation): [number, number, number];
  };
  networks: {
    /** Network id that a pipe block belongs to. */
    networkAt(x: number, y: number, z: number): string | undefined;
    /** Force a topology rebuild (after loads). */
    rebuild(): void;
  };
  economy: {
    /** Company net worth estimate. */
    netWorth(): number;
    leaseKey(x: number, z: number): string;
    leaseQuote(px: number, pz: number): { price: number; royalty: number; prospectivity: number };
  };
}

export interface GameContext {
  state: GameState;
  world: IWorld;
  geology: IGeology;
  bus: EventBus;
  commands: CommandBus;
  services: Services;
  settings: Settings;
  localPlayerId: string;
  /** Deterministic RNG in [0,1) that advances state.rngState. */
  rng(): number;
  /** Allocate a unique id with prefix. */
  newId(prefix: string): string;
  /** Push a notification into state and emit 'notify'. */
  notify(level: NotificationLevel, title: string, text?: string, at?: Vec3): void;
  /** Record money movement in the ledger (negative = expense). Returns false if insufficient funds when `requireFunds`. */
  transact(amount: number, category: LedgerCategory, note: string, requireFunds?: boolean): boolean;
  /** Tech helpers. */
  hasTech(techId: string): boolean;
  modifier(key: ModifierKey): number;
  /** Whether this process is the simulation authority (host/single-player) or a replica client. */
  isAuthority: boolean;
}

export interface SimStep {
  /** Game minutes advanced this step (already multiplied by speed). */
  minutes: number;
  /** Same in days (minutes / 1440). */
  days: number;
}

export interface SimSystem {
  id: string;
  /** Called once after state is created or loaded (fill missing state slices, register commands, services). */
  init(ctx: GameContext): void;
  /** Fixed-step update. */
  tick(ctx: GameContext, step: SimStep): void;
  /** Optional: called when a new game day begins (after tick). */
  onNewDay?(ctx: GameContext, day: number): void;
  /** Optional: cleanup when a game is unloaded. */
  dispose?(): void;
}
