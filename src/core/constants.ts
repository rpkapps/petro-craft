// Global constants shared by every subsystem. Changing these affects save compatibility.

export const SAVE_VERSION = 1;

/** Horizontal chunk size in blocks (chunks are full-height columns). */
export const CHUNK_SIZE = 16;
/** World height in blocks (y = 0 .. WORLD_HEIGHT-1). */
export const WORLD_HEIGHT = 160;
/** Water surface level: water fills air at y <= SEA_LEVEL in ocean/lake basins. */
export const SEA_LEVEL = 62;
/** Selectable world sizes (in blocks, square). */
export const WORLD_SIZES = { small: 256, medium: 512, large: 768 } as const;
export type WorldSizeKey = keyof typeof WORLD_SIZES;

/**
 * Engineering scale: 1 block = 40 m for all subsurface / engineering displays
 * (depths, lateral lengths, pipeline lengths). Surface buildings are nominal.
 */
export const METERS_PER_BLOCK = 40;
export const FEET_PER_METER = 3.28084;

/** Fixed simulation step (real milliseconds). */
export const SIM_STEP_MS = 100;
/** At speed 1x: game minutes that elapse per real second. 1 game day = 10 real minutes. */
export const GAME_MINUTES_PER_REAL_SECOND = 2.4;
export const MINUTES_PER_DAY = 1440;
/** Allowed game speed multipliers. */
export const GAME_SPEEDS = [1, 2, 5, 10, 25] as const;

/** Player physics (blocks, seconds). */
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_REACH = 8;

/** Lease parcels: the land is divided into square parcels for mineral rights. */
export const PARCEL_SIZE = 32;

/** Hotbar slot count and inventory size. */
export const HOTBAR_SLOTS = 9;
export const INVENTORY_SLOTS = 36;

export const DIFFICULTY_SETTINGS = {
  easy: { startMoney: 8_000_000, priceVolatility: 0.6, failureRate: 0.5, hazardRate: 0.5, loanRate: 0.04 },
  normal: { startMoney: 4_000_000, priceVolatility: 1.0, failureRate: 1.0, hazardRate: 1.0, loanRate: 0.07 },
  hard: { startMoney: 2_000_000, priceVolatility: 1.4, failureRate: 1.5, hazardRate: 1.6, loanRate: 0.11 },
  sandbox: { startMoney: 1_000_000_000, priceVolatility: 1.0, failureRate: 0.2, hazardRate: 0.2, loanRate: 0.0 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY_SETTINGS;
