// Model registry: BuildingDef.id → ModelDef, plus the baked-template cache (one template per
// type/variant/company colour; instances share its geometry).
import { BUILDINGS } from '../../../content/buildings';
import { Builder, type ModelTemplate } from '../geom/Builder';
import { C } from '../palette';
import type { ModelDef } from './types';

const MODELS: Record<string, ModelDef> = {};
const templates = new Map<string, ModelTemplate>();

export function registerModel(id: string, def: ModelDef): void {
  MODELS[id] = def;
}

export function registerModels(defs: Record<string, ModelDef>): void {
  for (const [id, d] of Object.entries(defs)) MODELS[id] = d;
}

export function getModelDef(type: string): ModelDef {
  return MODELS[type] ?? fallback;
}

export function hasModel(type: string): boolean {
  return type in MODELS;
}

export function registeredTypes(): string[] {
  return Object.keys(MODELS);
}

/** Unrotated catalogue size of a building type. */
export function defSize(type: string): [number, number, number] {
  return (BUILDINGS[type]?.size ?? [2, 2, 2]) as [number, number, number];
}

export function getTemplate(type: string, variant: string, company: string, fine = false): ModelTemplate {
  const key = `${type}|${variant}|${company}|${fine ? 1 : 0}`;
  let t = templates.get(key);
  if (!t) {
    const [w, d, h] = defSize(type);
    const b = new Builder(company, fine);
    getModelDef(type).build(b, { w, d, h, variant });
    t = b.build();
    templates.set(key, t);
  }
  return t;
}

/** Drop every cached template (company colour change, dispose). */
export function clearTemplates(): void {
  for (const t of templates.values()) {
    const walk = (n: ModelTemplate['root']) => {
      for (const m of n.meshes) m.geometry.dispose();
      n.children.forEach(walk);
    };
    walk(t.root);
  }
  templates.clear();
}

/** Generic crate model for unknown building ids (keeps the game playable if the catalogue grows). */
const fallback: ModelDef = {
  build(b, p) {
    const hw = p.w / 2 - 0.1;
    const hd = p.d / 2 - 0.1;
    const h = Math.max(1, p.h * 0.7);
    b.slab(-hw, 0, -hd, hw, h, hd, C.STEEL, 'paint');
    b.slab(-hw - 0.02, h - 0.3, -hd - 0.02, hw + 0.02, h, hd + 0.02, b.company, 'paint');
    b.slab(-hw, h, -hd, hw, h + 0.1, hd, C.STEEL_LIGHT, 'metal');
  },
};
