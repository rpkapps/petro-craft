// Auto-quality controller checks (no browser):
//   node --experimental-strip-types --no-warnings --import ./dev/world/register.mjs dev/render/quality.test.ts
import { AutoQuality, type EffectiveQuality } from '../../src/render/quality/AutoQuality';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Settings } from '../../src/core/types';

declare const process: { exitCode: number };
let failed = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failed++;
};

const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ssao: true, shadows: true, bloom: true, renderScale: 1, renderDistance: 8, autoQuality: true };
const eff: EffectiveQuality = { renderScale: 1, ssao: false, shadowDegrade: 0, bloomScale: 0.5, renderDistance: 8 };
/** Run `seconds` of frames at a fixed interval/cost; returns the levels seen at each change. */
function run(q: AutoQuality, seconds: number, intervalMs: number, costMs: number, gpuKnown = true, ignore = false) {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += intervalMs) if (q.sample(intervalMs, costMs, gpuKnown, ignore)) changes.push(q.level);
  return changes;
}

{
  const q = new AutoQuality();
  q.configure(settings);
  run(q, 1.2, 16.7, 8);
  check('starts at full quality', q.level === 0);
  const down = run(q, 60, 40, 38);
  check('slow frames walk the whole ladder', q.level === 7, `levels ${down.join(',')}`);
  check('steps are spaced by the cool-down', down.length === 7);
  q.effective(settings, eff);
  check('bottom: scale 0.6, no ssao, shadows -1, bloom 1/4, rd -2', eff.renderScale === 0.6 && !eff.ssao && eff.shadowDegrade === 1 && eff.bloomScale === 0.25 && eff.renderDistance === 6, JSON.stringify(eff));
  check('user settings untouched', settings.renderScale === 1 && settings.ssao && settings.renderDistance === 8);
  const up = run(q, 120, 16.7, 6);
  check('headroom steps back up to full quality', q.level === 0, `levels ${up.join(',')}`);
}
{
  const q = new AutoQuality();
  q.configure(settings);
  run(q, 1.2, 16.7, 8);
  let levels = 0;
  for (let i = 0; i < 30; i++) {
    const c = run(q, 1, 1000 / 60, 10);
    levels += c.length;
  }
  check('mid frame times (12..20 ms) never change quality', q.level === 0 && levels === 0);
  run(q, 3, 400, 400);
  check('isolated hitches (> 250 ms) are ignored', q.level === 0);
  run(q, 10, 40, 38, true, true);
  check('ignored frames (loading / hidden tab) are ignored', q.level === 0);
}
{
  // oscillation: stepping up makes it slow again → that step gets blocked with a growing back-off
  const q = new AutoQuality();
  q.configure({ ...settings, ssao: false, shadows: false, bloom: false, renderDistance: 3 });
  run(q, 1.2, 16.7, 8);
  run(q, 10, 40, 38);
  const bottom = q.level;
  let changes = 0;
  // at full quality it is slow (35 ms), one step down it is fine (8 ms)
  for (let t = 0; t < 600; t++) {
    const slow = q.level < bottom;
    if (q.sample(slow ? 35 : 16.7, slow ? 33 : 8, true, false)) changes++;
    for (let k = 0; k < 59; k++) if (q.sample(slow ? 35 : 16.7, slow ? 33 : 8, true, false)) changes++;
  }
  check('oscillation is damped by exponential back-off', changes <= 12, `${changes} changes in ~10 min (bottom level ${bottom})`);
}
{
  const q = new AutoQuality();
  q.configure({ ...settings, autoQuality: false });
  run(q, 20, 60, 58);
  check('auto quality off → never degrades', q.level === 0);
  q.configure(settings);
  run(q, 20, 60, 58);
  const lvl = q.level;
  q.configure({ ...settings, renderScale: 0.8 });
  check('changing a user setting restarts from full quality', lvl > 0 && q.level === 0);
  q.effective({ ...settings, renderScale: 0.8 }, eff);
  check('user render scale is respected', eff.renderScale === 0.8);
}
{
  // vsync-pinned (no GPU timer): 16.7 ms intervals with a light CPU load count as headroom
  const q = new AutoQuality();
  q.configure(settings);
  run(q, 1.2, 16.7, 4, false);
  run(q, 8, 40, 20, false);
  const l = q.level;
  run(q, 120, 16.7, 4, false);
  check('without GPU timer, vsync-pinned light frames step back up', l > 0 && q.level === 0, `from ${l}`);
}
if (failed) process.exitCode = 1;
