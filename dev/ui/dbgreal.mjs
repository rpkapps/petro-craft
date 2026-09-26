// Debug helper against the real game: node dev/ui/dbgreal.mjs <base> "<js after load>"
import { chromium } from 'playwright-core';
const [base, expr] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (/UI|error/i.test(m.type() + m.text()) && !/ERR_CERT|404/.test(m.text())) console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.evaluate(() => window.petrocraft.newGame({ saveName: 'Dbg', companyName: 'Dbg Oil', seed: 4242, worldSize: 'small', difficulty: 'normal', tutorial: true, hazards: true, creative: false }));
for (let i = 0; i < 90; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => !!window.petrocraft.ctx && !window.petrocraft.loading.active)) break; }
await page.waitForTimeout(1000);
console.log(await page.evaluate(expr));
await page.screenshot({ path: 'dev-screens/ui-real/dbg.png' });
await browser.close();
