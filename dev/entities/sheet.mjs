// Dev helper: compose screenshots into a contact sheet. Usage: node dev/entities/sheet.mjs out.png a.png b.png ...
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [out, ...files] = process.argv.slice(2);
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const cols = 3, w = 640, h = 360;
const rows = Math.ceil(files.length / cols);
const p = await b.newPage({ viewport: { width: cols * w, height: rows * h } });
const imgs = files.map((f) => `<div style="position:relative;display:inline-block;width:${w}px;height:${h}px"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:${w}px;height:${h}px"><span style="position:absolute;left:4px;top:4px;color:#fff;background:#000a;font:12px sans-serif;padding:2px">${f.split('/').pop()}</span></div>`).join('');
await p.setContent(`<body style="margin:0;line-height:0">${imgs}</body>`);
await p.screenshot({ path: out });
await b.close();
