// Batch screenshots of the render harness scenes in one headless browser.
// Usage: node dev/render/shots.mjs [baseUrl=http://localhost:5202/dev/render/] [waitMs=14000] scene[?extra] ...
// Example: node dev/render/shots.mjs http://localhost:5202/dev/render/ 14000 day sunset "xray&world=dev"
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const [base = 'http://localhost:5202/dev/render/', wait = '14000', ...scenes] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
mkdirSync('dev-screens', { recursive: true });
for (const sc of scenes.length ? scenes : ['day', 'sunset', 'night', 'xray', 'underwater']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) console.log(`[${sc}] [${m.type()}]`, m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => console.log(`[${sc}] [pageerror]`, e.message));
  await page.goto(`${base}?scene=${sc}`, { waitUntil: 'load' });
  await page.waitForTimeout(Number(wait));
  const name = sc.replace(/[^a-z0-9]+/gi, '-');
  await page.screenshot({ path: `dev-screens/render-${name}.png` });
  const stats = await page.evaluate(() => document.getElementById('stats')?.textContent);
  console.log(`[${sc}]`, stats);
  await page.close();
}
await browser.close();
