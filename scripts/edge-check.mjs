// Visual check of the world border: enters drone view and flies to the northern ocean edge, then screenshots.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message)); page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) console.log('[err]', m.text().slice(0, 400)); });
await page.goto('http://localhost:5190/');
await page.waitForTimeout(1500);
await page.evaluate(() => window.petrocraft.applySettings({ autoQuality: false }));
await page.evaluate(() => window.petrocraft.newGame({ saveName: 'I', companyName: 'E', seed: 4242, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: false, creative: true }));
await page.keyboard.press('KeyV'); await page.waitForTimeout(500);
await page.evaluate(() => window.petrocraft.ctx.bus.emit('ui:focus', { at: { x: 128, y: 70, z: 40 } }));
await page.waitForTimeout(12000);
await page.screenshot({ path: 'dev-screens/edge.png' });
const info = await page.evaluate(() => { const c = window.petrocraft.host.camera; return { p: c.position.toArray().map(Math.round) }; });
console.log(JSON.stringify(info), await page.evaluate(() => window.petrocraft.ctx.state.players.p1.mode));
await browser.close();
