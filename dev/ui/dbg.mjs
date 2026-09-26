import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack));
await page.goto('http://localhost:5209/dev/ui/?screen=hud', { waitUntil: 'load' });
await page.waitForTimeout(3000);
console.log(await page.evaluate(process.argv[2]));
await browser.close();
