// End-to-end smoke test: boots the real game, starts a new world, runs scripted steps, screenshots.
// Usage: node scripts/play.mjs [baseUrl=http://localhost:5190/] [outPrefix=dev-screens/play] [seconds=20]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [base = 'http://localhost:5190/', prefix = 'dev-screens/play', secs = '20'] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const seen = new Map();
const log = (k, s) => { const key = k + s.slice(0, 160); const n = (seen.get(key) ?? 0) + 1; seen.set(key, n); if (n <= 2) console.log(k, s.slice(0, 700)); };
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log(`[${m.type()}]`, m.text()); else if (m.text().startsWith('[play]')) console.log(m.text()); });
page.on('pageerror', (e) => log('[pageerror]', `${e.message} ${e.stack?.split('\n').slice(0, 5).join(' | ')}`));
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-0-menu.png` });
const t0 = Date.now();
await page.evaluate(() => {
  const app = window.petrocraft;
  app.newGame({ saveName: 'Test', companyName: 'Test Petroleum', seed: 12345, worldSize: 'small', difficulty: 'normal', tutorial: true, hazards: true, creative: false })
    .then(() => console.log('[play] newGame resolved'))
    .catch((e) => console.error('[play] newGame failed', e?.stack || e));
});
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({ loading: window.petrocraft.loading, ctx: !!window.petrocraft.ctx }));
  if (i % 5 === 0) console.log('[play] t=', i, JSON.stringify(st));
  if (st.ctx && !st.loading.active) break;
}
console.log('[play] load time', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.screenshot({ path: `${prefix}-1-ingame.png` });
const extra = process.env.PLAY_EVAL;
if (extra) { try { console.log('[play] eval ->', JSON.stringify(await page.evaluate(extra)).slice(0, 2000)); } catch (e) { console.log('[play] eval error', e.message); } }
await page.waitForTimeout(Number(secs) * 1000);
await page.screenshot({ path: `${prefix}-2-later.png` });
const summary = await page.evaluate(() => {
  const c = window.petrocraft.ctx; if (!c) return null;
  const s = c.state;
  return { day: s.time.day, min: Math.round(s.time.minuteOfDay), money: Math.round(s.company.money), buildings: Object.values(s.buildings).map(b => `${b.type}:${b.status}`), wells: Object.keys(s.wells).length, fps: window.petrocraft.host?.fps, notes: s.notifications.slice(-6).map(n => n.title) };
});
console.log('[play] summary', JSON.stringify(summary));
await browser.close();
