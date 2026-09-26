// Installs ctx.services.seismic and ctx.services.wells (replacing the core no-op defaults).
import type { GameContext, SeismicImage, SurveyState, Vec3, WellPlan } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { SeismicService } from './seismic';
import { pressureProfile, quoteWell, suggestPlan, previewTrajectory } from './planning';

export function installServices(ctx: GameContext, rt: UpstreamRuntime): SeismicService {
  const seismic = new SeismicService(ctx);
  ctx.services.seismic = {
    getSection: (s: SurveyState, opts?: { inline?: number; crossline?: number; resolution?: number }): SeismicImage => seismic.getSection(s, opts),
    getDepthSlice: (s: SurveyState, y: number): SeismicImage => seismic.getDepthSlice(s, y),
    quote: (kind, x0, z0, x1, z1) => seismic.quote(kind, x0, z0, x1, z1),
  };
  ctx.services.wells = {
    quote: (x: number, z: number, plan: WellPlan, rigType: string) => quoteWell(ctx, rt, Math.floor(x), Math.floor(z), plan, rigType),
    suggestPlan: (x: number, z: number, targetY: number, kind: WellPlan['kind']) => suggestPlan(ctx, rt, Math.floor(x), Math.floor(z), targetY, kind),
    pressureProfile: (x: number, z: number) => pressureProfile(ctx, Math.floor(x), Math.floor(z)),
    planTrajectory: (x: number, y: number, z: number, plan: WellPlan): Vec3[] => previewTrajectory(x, y, z, plan),
  };
  return seismic;
}
