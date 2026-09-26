// Dev helper: load a harness URL headless, wait, and print window.harness.stats (draw calls etc.).
// Usage: node dev/entities/measure.mjs "<url>" [waitMs=8000] [--eval "js evaluated after the wait"]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [url, wait = '8000'] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
const stats = await page.evaluate(() => window.harness?.stats);
console.log(JSON.stringify(stats));
const evalIdx = process.argv.indexOf('--eval');
if (evalIdx > 0) {
  try {
    console.log('[eval]', JSON.stringify(await page.evaluate(process.argv[evalIdx + 1])).slice(0, 4000));
  } catch (e) {
    console.log('[eval error]', e.message);
  }
}
await browser.close();
