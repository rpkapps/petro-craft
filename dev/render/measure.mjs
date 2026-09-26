// Real-game renderer measurement: starts a new game in headless Chromium, waits for terrain streaming to
// settle at a render distance, then reports draw calls / triangles / chunk counts / CPU timings.
// Usage: node dev/render/measure.mjs [url=http://localhost:5212/] [rd=8] [settleMs=40000] [out.png]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [url = 'http://localhost:5212/', rd = '8', settle = '40000', out] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (['error'].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.petrocraft, null, { timeout: 30000 });
await page.evaluate(async (rd) => {
  const app = window.petrocraft;
  app.applySettings({ renderDistance: rd, autoQuality: false });
  await app.newGame({ saveName: 'measure', companyName: 'M', seed: 424242, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: false, creative: true });
}, Number(rd));
const t0 = Date.now();
while (Date.now() - t0 < Number(settle)) {
  await page.waitForTimeout(2000);
  const busy = await page.evaluate(() => {
    const c = window.petrocraft.host.chunks;
    return c.stats.meshing + c.stats.pendingGen + (c.results?.length ?? 0) + c.wanted.filter((e) => e.meshedVersion < e.version || e.meshedVersion < 0).length;
  });
  if (busy === 0) break;
}
const r = await page.evaluate(() => {
  const app = window.petrocraft;
  const host = app.host;
  // freeze the camera where the player put it
  const t = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    host.update(1 / 60);
    const b = performance.now();
    host.render();
    const c = performance.now();
    t.push([b - a, c - b]);
  }
  const info = host.renderer.info;
  let meshes = 0, tris = 0, visible = 0;
  host.chunks.forEachMesh((m) => {
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (m.visible) visible++;
  });
  return {
    cam: host.camera.position.toArray().map((v) => +v.toFixed(1)),
    calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length,
    geometries: info.memory.geometries, textures: info.memory.textures,
    chunkEntries: host.chunks.entries.size, terrainMeshes: meshes, terrainTrianglesLoaded: tris,
    updateMs: t.map((x) => +x[0].toFixed(2)), renderMs: t.map((x) => +x[1].toFixed(1)),
    stats: host.stats ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
if (out) await page.screenshot({ path: out });
await browser.close();
