// Processing recipes (OWNED BY the Facilities agent — fills RECIPES).
// Rates are per game day at 100% efficiency.
export interface Recipe {
  id: string;
  name: string;
  /** BuildingDef.id that runs this recipe. */
  building: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Extra power draw (MW) beyond the building's base draw. */
  power?: number;
  description?: string;
}

export const RECIPES: Record<string, Recipe> = {};

/** Recipes available for a building type (first one is the default). */
export function recipesFor(buildingType: string): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.building === buildingType);
}
