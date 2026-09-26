// Debug helper: node dev/ui/dbg.mjs "<query>" "<js expr>"
import { chromium } from 'playwright-core';
const [q = 'screen=hud', expr = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (!m.text().includes('ERR_CERT') && !m.text().includes('404') && !m.text().includes('[vite]')) console.log(`[${m.type()}]`, m.text().slice(0, 600)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack));
await page.goto(`http://localhost:5209/dev/ui/?${q}`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
console.log(await page.evaluate(expr));
await browser.close();
