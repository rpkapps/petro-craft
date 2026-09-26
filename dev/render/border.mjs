// World-border visual check in the real game (headless Chromium, software GL).
// Usage: node dev/render/border.mjs [url=http://localhost:5212/] [outDir=dev-screens/border]
// Shots: the lead's drone repro (seed 4242, focus on the northern ocean edge), then fixed cameras at an ocean
// edge and a land edge, each at noon and at night, plus the x-ray view at the ocean edge.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:5212/', outDir = 'dev-screens/border'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT') && !m.text().includes('Failed to load')) console.log('[err]', m.text().slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => !!window.petrocraft);
await page.evaluate(() => window.petrocraft.applySettings({ autoQuality: false }));
await page.evaluate(() => window.petrocraft.newGame({ saveName: 'border', companyName: 'E', seed: 4242, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: false, creative: true }));
const settle = async () => {
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(1500);
    if (await page.evaluate(() => window.petrocraft.host.chunks.idle)) break;
  }
  await page.waitForTimeout(1500);
};

// 1) the lead's repro: drone view focused on the northern ocean edge
await page.keyboard.press('KeyV');
if (process.env.ONLY !== 'land') {
await page.waitForTimeout(500);
await page.evaluate(() => window.petrocraft.ctx.bus.emit('ui:focus', { at: { x: 128, y: 70, z: 40 } }));
await settle();
await page.screenshot({ path: `${outDir}/drone-north.png` });
}

// 2) fixed cameras (player/drone control frozen)
const edges = await page.evaluate(() => {
  const g = window.petrocraft.ctx.geology;
  const n = g.sizeX;
  const cands = [];
  for (let i = 16; i < n - 16; i += 4) {
    cands.push({ side: 'W', x: 0, z: i, h: g.surfaceHeight(0, i) });
    cands.push({ side: 'E', x: n - 1, z: i, h: g.surfaceHeight(n - 1, i) });
    cands.push({ side: 'N', x: i, z: 0, h: g.surfaceHeight(i, 0) });
    cands.push({ side: 'S', x: i, z: n - 1, h: g.surfaceHeight(i, n - 1) });
  }
  const land = cands.filter((c) => c.h > 66 && c.h < 90).sort((a, b) => Math.abs(a.h - 74) - Math.abs(b.h - 74))[0] ?? null;
  const ocean = cands.filter((c) => c.h < 58).sort((a, b) => a.h - b.h)[0] ?? null;
  return { land, ocean, size: n };
});
console.log('edges', JSON.stringify(edges));
await page.evaluate(() => {
  const app = window.petrocraft;
  app.player.update = () => {};
});
const shoot = async (name, e, minute, overlay = 'none', view = { back: 28, up: 22, pitch: -0.32, yaw: 0.35 }) => {
  if (!e) return;
  await page.evaluate(({ e, minute, overlay, size, view }) => {
    const app = window.petrocraft;
    const cam = app.host.camera;
    // stand 28 blocks inside the edge, above the surface, looking outward (and a little along the edge) and down
    const dir = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] }[e.side];
    const px = e.side === 'W' ? view.back : e.side === 'E' ? size - view.back : e.x;
    const pz = e.side === 'N' ? view.back : e.side === 'S' ? size - view.back : e.z;
    cam.position.set(px + 0.5, Math.max(e.h, 62) + view.up, pz + 0.5);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(view.pitch, Math.atan2(-dir[0], -dir[1]) + view.yaw, 0);
    cam.updateMatrixWorld();
    app.ctx.state.time.minuteOfDay = minute;
    app.ctx.bus.emit('ui:overlay', { overlay });
  }, { e, minute, overlay, size: edges.size, view });
  await settle();
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name, JSON.stringify(await page.evaluate(() => ({ stats: window.petrocraft.host.stats, cam: window.petrocraft.host.camera.position.toArray().map(Math.round) }))));
};
if (process.env.ONLY !== 'land') {
  await shoot('ocean-day', edges.ocean, 12 * 60);
  await shoot('ocean-night', edges.ocean, 23 * 60);
}
await shoot('land-day', edges.land, 12 * 60 + 30);
await shoot('land-overview', edges.land, 10 * 60, 'none', { back: 30, up: 70, pitch: -0.75, yaw: 0.2 });
await shoot('land-night', edges.land, 22 * 60 + 40);
if (process.env.ONLY !== 'land') await shoot('ocean-xray', edges.ocean, 13 * 60, 'xray');
await browser.close();
