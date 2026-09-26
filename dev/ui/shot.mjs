// Batch screenshots of UI harness pages in one browser session.
// Usage: node dev/ui/shot.mjs <outDir> <WxH> <wait> name=query [name=query ...]
// e.g.   node dev/ui/shot.mjs dev-screens 1280x720 1500 menu="screen=menu" market="screen=hud&panel=market"
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const [outDir = 'dev-screens', size = '1280x720', wait = '1500', ...pairs] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const base = process.env.BASE ?? 'http://localhost:5209/dev/ui/';
mkdirSync(outDir, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
for (const pair of pairs) {
  const i = pair.indexOf('=');
  const name = pair.slice(0, i);
  const q = pair.slice(i + 1);
  await page.goto(`${base}?${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(Number(wait));
  const overflow = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#ui-root *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.pc-panel.covered')) continue;
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1) {
        if (el.closest('.mn-bghost, .mn-grain, .pc-tooltip, .tb-pops')) continue;
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if ((el.scrollWidth > el.clientWidth + 2) && cs.overflowX === 'hidden' && !['ellipsis'].includes(cs.textOverflow) && el.children.length > 0) {
        out.push(`clip-x ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    return out.slice(0, 12);
  });
  if (overflow.length) console.log(`[overflow:${name}]`, overflow.join(' ; '));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', `${outDir}/${name}.png`);
}
await browser.close();
