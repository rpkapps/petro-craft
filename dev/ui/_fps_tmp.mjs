import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
for (const q of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5215/dev/ui/?' + q, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
  console.log(q, 'fps', r);
  await page.close();
}
await browser.close();
