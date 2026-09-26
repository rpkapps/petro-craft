// Boots the real game (all modules) and opens every UI panel against live state, screenshotting each.
// Usage: node dev/ui/realgame.mjs [base=http://localhost:5209/] [outDir=dev-screens/ui-real]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const [base = 'http://localhost:5209/', out = 'dev-screens/ui-real'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message} ${e.stack?.split('\n').slice(1, 3).join(' | ')}`));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|404|WebGL|GPU/.test(m.text())) errors.push(`[console] ${m.text().slice(0, 300)}`); });
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.petrocraft.newGame({ saveName: 'UI Test', companyName: 'Test Petroleum', seed: 4242, worldSize: 'small', difficulty: 'normal', tutorial: true, hazards: true, creative: false }));
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const ok = await page.evaluate(() => !!window.petrocraft.ctx && !window.petrocraft.loading.active);
  if (ok) break;
}
await page.waitForTimeout(1500);
// Speed things up a little so the sim produces history.
await page.evaluate(() => window.petrocraft.ctx.commands.dispatch({ type: 'time/setSpeed', speed: 25 }));
await page.waitForTimeout(4000);
const panels = ['build', 'inventory', 'research', 'market', 'contracts', 'workforce', 'finance', 'map', 'wells', 'environment', 'objectives', 'notifications', 'settings', 'help', 'pause'];
for (const p of panels) {
  const alive = await page.evaluate(() => !!window.petrocraft?.ctx);
  if (!alive) { errors.push(`[harness] page reloaded before ${p} (dev-server HMR from concurrent edits?)`); break; }
  await page.evaluate((id) => window.petrocraft.ctx.bus.emit('ui:open', { panel: id, args: {} }), p);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${p}.png` });
  await page.evaluate(() => window.petrocraft.ctx?.bus.emit('ui:close', {}));
  await page.waitForTimeout(200);
}
// inspector on the field office
await page.evaluate(() => { const c = window.petrocraft?.ctx; const b = c && Object.values(c.state.buildings)[0]; if (b) c.bus.emit('ui:select', { kind: 'building', id: b.id }); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/inspector.png` });
console.log(errors.length ? errors.slice(0, 30).join('\n') : 'no page errors');
await browser.close();
