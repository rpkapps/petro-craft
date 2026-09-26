// Batch screenshots of the render harness scenes (one fresh page per scene).
// Waits until terrain streaming around the camera has settled (or `maxWaitMs` passed), then a short settle.
// Usage: node dev/render/shots.mjs [baseUrl=http://localhost:5202/dev/render/] [maxWaitMs=90000] scene[&extra] ...
// Example: node dev/render/shots.mjs http://localhost:5202/dev/render/ 90000 day sunset "xray&world=dev"
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const [base = 'http://localhost:5202/dev/render/', wait = '90000', ...scenes] = process.argv.slice(2);
const outDir = process.env.SHOTS_DIR ?? 'dev-screens';
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
mkdirSync(outDir, { recursive: true });
for (const sc of scenes.length ? scenes : ['day', 'sunset', 'night', 'xray', 'underwater', 'shore']) {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) console.log(`[${sc}] [${m.type()}]`, m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => console.log(`[${sc}] [pageerror]`, e.message));
  await page.goto(`${base}?scene=${sc}`, { waitUntil: 'load' });
  const t0 = Date.now();
  let settled = 0;
  while (Date.now() - t0 < Number(wait)) {
    await page.waitForTimeout(1500);
    const busy = await page.evaluate(() => {
      const r = window.__r;
      if (!r) return 1;
      const c = r.chunks;
      const idle = typeof c.idle === 'boolean' ? c.idle : c.stats.meshing === 0 && c.stats.pendingGen === 0;
      return r.loadProgress >= 1 && idle ? 0 : 1;
    }).catch(() => 1);
    settled = busy ? 0 : settled + 1;
    if (settled >= 2) break;
  }
  await page.waitForTimeout(2500);
  const name = sc.replace(/[^a-z0-9]+/gi, '-');
  await page.screenshot({ path: `${outDir}/render-${name}.png` });
  const stats = await page.evaluate(() => document.getElementById('stats')?.textContent);
  console.log(`[${sc}] ${((Date.now() - t0) / 1000).toFixed(0)}s`, stats);
  await browser.close();
}
