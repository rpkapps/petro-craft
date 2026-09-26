// Real-game texture-quality check: live switching classic → ultra → high → classic, generation vs IndexedDB
// cache timing, GPU texture memory release, and screenshots. Usage: node dev/render/texswitch.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:5212/', outDir = 'dev-screens/texgame'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/CERT|Failed to load/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => !!window.petrocraft);
const newGame = () => page.evaluate(() => window.petrocraft.newGame({ saveName: 'tex', companyName: 'T', seed: 4242, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: false, creative: true }));
await page.evaluate(() => window.petrocraft.applySettings({ autoQuality: false, textureQuality: 'classic' }));
await newGame();
const status = () => page.evaluate(() => ({ ...window.petrocraft.host.textureStatus, gpuTextures: window.petrocraft.host.renderer.info.memory.textures }));
const waitQuality = async (q) => {
  const t0 = Date.now();
  await page.waitForFunction((q) => window.petrocraft.host.textureStatus.quality === q && !window.petrocraft.host.textureStatus.pending, q, { timeout: 240000, polling: 500 });
  return Date.now() - t0;
};
const shot = async (name) => {
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/${name}.png` });
};
console.log('classic', JSON.stringify(await status()));
await shot('classic');
for (const q of ['ultra', 'high', 'classic']) {
  await page.evaluate((q) => window.petrocraft.applySettings({ textureQuality: q }), q);
  const ms = await waitQuality(q);
  console.log(q, `switch ${ms} ms`, JSON.stringify(await status()));
  await shot(q);
}
// second session with ultra: must come from the IndexedDB cache
await page.evaluate(() => window.petrocraft.applySettings({ textureQuality: 'ultra' }));
await page.evaluate(() => window.petrocraft.quitToMenu());
const t0 = Date.now();
await newGame();
await waitQuality('ultra');
console.log('ultra (new session, startup incl.)', `${Date.now() - t0} ms`, JSON.stringify(await status()));
await page.evaluate(() => window.petrocraft.applySettings({ textureQuality: 'classic' }));
console.log('errors', errors.length ? errors : 'none');
await browser.close();
