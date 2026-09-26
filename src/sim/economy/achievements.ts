// Achievements: one-off badges stored in state.objectives.achievements.
import type { GameContext } from '../../core/types';
import { STARTING_TECHS } from '../../content/tech';
import { builtOf, soldOf, type Snapshot } from './snapshot';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  /** Icon hint for the UI. */
  icon: string;
  /** Hidden until unlocked. */
  secret?: boolean;
  check(sn: Snapshot): boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_oil', title: 'First Oil', description: 'Bring your first oil well on production.', icon: 'barrel', check: (sn) => sn.cumOil > 0 || sn.wellsProducing > 0 },
  { id: 'first_sale', title: 'Open for Business', description: 'Sell your first barrel.', icon: 'truck', check: (sn) => sn.salesRevenue > 0 },
  { id: 'first_gas_sale', title: 'Molecules to Market', description: 'Sell natural gas through a sales meter.', icon: 'flame', check: (sn) => soldOf(sn, 'natural_gas', 'dry_gas') > 0 },
  { id: 'first_contract', title: 'Handshake Deal', description: 'Fulfil a supply contract.', icon: 'handshake', check: (sn) => sn.contractsCompleted >= 1 },
  { id: 'millionaire', title: 'Millionaire', description: 'Earn $1M in lifetime sales.', icon: 'money', check: (sn) => sn.salesRevenue >= 1e6 },
  { id: 'ten_wells', title: 'Pincushion', description: 'Spud 10 wells.', icon: 'drill', check: (sn) => sn.wellsSpudded >= 10 },
  { id: 'hundred_k_bbl', title: '100k Barrels', description: 'Produce 100,000 barrels of oil.', icon: 'barrel', check: (sn) => sn.cumOil >= 100_000 },
  { id: 'million_bbl', title: 'Million-Barrel Field', description: 'Produce 1,000,000 barrels of oil.', icon: 'barrel', check: (sn) => sn.cumOil >= 1_000_000 },
  { id: 'gusher', title: 'Gusher', description: 'Have a single well flow over 2,000 bbl/day.', icon: 'fountain', check: (sn) => sn.maxOilRate >= 2_000 },
  { id: 'survive_blowout', title: 'Wild Well Control', description: 'Bring a blowout back under control.', icon: 'fire', check: (sn) => (sn.counters.blowoutsControlled ?? 0) >= 1 },
  { id: 'zero_incident_30', title: 'Safety First', description: 'Go 30 days without an incident while producing.', icon: 'shield', check: (sn) => sn.s.hazards.daysSinceIncident >= 30 && sn.wellsProducing > 0 },
  { id: 'dry_hole_club', title: 'Dry Hole Club', description: 'Drill three dry holes. Every wildcatter has.', icon: 'cactus', secret: true, check: (sn) => sn.dryHoles >= 3 },
  { id: 'first_refinery', title: 'Cracking On', description: 'Build a crude distillation unit.', icon: 'factory', check: (sn) => builtOf(sn, 'refinery') > 0 },
  { id: 'offshore_pioneer', title: 'Offshore Pioneer', description: 'Produce from an offshore well.', icon: 'platform', check: (sn) => sn.offshoreProducing > 0 },
  { id: 'lng_exporter', title: 'Cold Cargo', description: 'Export a cargo of LNG.', icon: 'ship', check: (sn) => soldOf(sn, 'lng') > 0 },
  { id: 'plastic_fantastic', title: 'Plastic Fantastic', description: 'Sell polymers.', icon: 'pellet', check: (sn) => soldOf(sn, 'polyethylene', 'polypropylene') > 0 },
  { id: 'contract_king', title: 'Contract King', description: 'Fulfil 10 supply contracts.', icon: 'crown', check: (sn) => sn.contractsCompleted >= 10 },
  { id: 'green_operator', title: 'Social Licence', description: 'Reach an environmental score of 90.', icon: 'leaf', check: (sn) => sn.s.environment.score >= 90 },
  { id: 'company_town', title: 'Company Town', description: 'Employ 50 workers.', icon: 'people', check: (sn) => sn.s.workforce.workers.length >= 50 },
  { id: 'think_tank', title: 'Think Tank', description: 'Research 15 technologies.', icon: 'flask', check: (sn) => sn.techsResearched - STARTING_TECHS.length >= 15 },
  { id: 'storm_chaser', title: 'Weathered the Storm', description: 'Ride out a hurricane.', icon: 'storm', check: (sn) => (sn.counters.hurricanes ?? 0) >= 1 },
  { id: 'tycoon', title: 'Tycoon', description: 'Reach a net worth of $100M.', icon: 'tower', check: (sn) => sn.netWorth >= 100e6 },
  { id: 'billionaire', title: 'Billionaire', description: 'Reach a net worth of $1B.', icon: 'diamond', check: (sn) => sn.netWorth >= 1e9 },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export function checkAchievements(ctx: GameContext, sn: Snapshot) {
  const list = ctx.state.objectives.achievements;
  for (const a of ACHIEVEMENTS) {
    if (list.includes(a.id)) continue;
    if (!a.check(sn)) continue;
    list.push(a.id);
    ctx.notify('success', `Achievement unlocked: ${a.title}`, a.description);
    ctx.bus.emit('audio:play', { sound: 'achievement' });
  }
}
