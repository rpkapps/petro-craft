import { UI_RECIPES } from './ui';
import { FOLEY_RECIPES } from './foley';
import { WORLD_RECIPES } from './world';
import { NATURE_RECIPES } from './nature';
import { LOOP_RECIPES } from './loops';
import { MUSIC_RECIPES } from './music';
import type { RecipeMap } from './types';

export type { Recipe, RecipeMap } from './types';

/** Every procedural sound, keyed by name. Loops are prefixed `loop_`, score hits `m_`. */
export const RECIPES: RecipeMap = {
  ...UI_RECIPES,
  ...FOLEY_RECIPES,
  ...WORLD_RECIPES,
  ...NATURE_RECIPES,
  ...LOOP_RECIPES,
  ...MUSIC_RECIPES,
};

export const UI_SOUND_NAMES = Object.keys(UI_RECIPES);
export const LOOP_NAMES = Object.keys(LOOP_RECIPES);
/** One-shot names usable with the generic `audio:play` event (loops and score hits excluded). */
export const ONE_SHOT_NAMES = Object.keys(RECIPES).filter((n) => !n.startsWith('loop_') && !n.startsWith('m_'));
