// Usage: node scripts/shot.mjs <url> <out.png> [waitMs=4000] [--eval "js to run after load"]
// Headless Chromium screenshot with software WebGL. Prints console errors from the page.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [url, out = 'shot.png', wait = '4000'] = process.argv.slice(2);
const evalIdx = process.argv.indexOf('--eval');
const evalJs = evalIdx > 0 ? process.argv[evalIdx + 1] : null;
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 500)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
await page.goto(url, { waitUntil: 'load' });
if (evalJs) {
  try { const r = await page.evaluate(evalJs); if (r !== undefined) console.log('[eval]', JSON.stringify(r).slice(0, 2000)); } catch (e) { console.log('[eval error]', e.message); }
}
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
