// Dev helper: load a page headless, optionally run a setup script, wait, then print the entity harness
// stats (window.harness.stats) and/or the result of an expression, and optionally save a screenshot.
// Usage: node dev/entities/measure.mjs "<url>" [waitMs=8000] [--setup "js"] [--eval "js"] [--shot out.png]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [url, wait = '8000'] = process.argv.slice(2);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('[error]', m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: 'load' });
const run = async (label, js) => {
  if (!js) return;
  try {
    const r = await page.evaluate(js);
    if (r !== undefined) console.log(`[${label}]`, JSON.stringify(r).slice(0, 6000));
  } catch (e) {
    console.log(`[${label} error]`, e.message.slice(0, 600));
  }
};
await run('setup', arg('--setup'));
await page.waitForTimeout(Number(wait));
const stats = await page.evaluate(() => window.harness?.stats);
if (stats) console.log(JSON.stringify(stats));
await run('eval', arg('--eval'));
const shot = arg('--shot');
if (shot) {
  await page.screenshot({ path: shot });
  console.log('saved', shot);
}
await browser.close();
