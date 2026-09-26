// Side-by-side comparison image (A | B, each scaled to half width). Usage: node dev/render/compare.mjs out.png a.png b.png [labelA] [labelB]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [out, a, b, la = 'classic', lb = 'ultra'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 360 } });
const img = (f, l) => `<div style="position:relative;width:640px;height:360px;overflow:hidden"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:640px;height:360px;display:block"><span style="position:absolute;left:8px;top:6px;font:bold 15px sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:4px">${l}</span></div>`;
await page.setContent(`<body style="margin:0;display:flex">${img(a, la)}${img(b, lb)}</body>`);
await page.screenshot({ path: out });
await browser.close();
