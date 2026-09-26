import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
const [url, out, sx = '490', sy = '410', clicks = '6', w = '1280', hgt = '720'] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +hgt } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load')) console.log('[err]', m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.addStyleTag({ content: '*, *::before, *::after { backdrop-filter: none !important; }' });
await page.waitForTimeout(9000);
await page.mouse.move(+sx, +sy);
for (let i = 0; i < +clicks; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(80); }
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await browser.close();
