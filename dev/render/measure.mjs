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
    if (typeof c.idle === 'boolean') return c.idle ? 0 : 1;
    return c.stats.meshing + c.stats.pendingGen + (c.results?.length ?? 0) + c.wanted.filter((e) => e.meshedVersion < e.version || e.meshedVersion < 0).length;
  });
  if (busy === 0) break;
}
const r = await page.evaluate(() => {
  const app = window.petrocraft;
  const host = app.host;
  // fixed, reproducible view: 20 blocks above the spawn surface looking north-east and slightly down
  const cam = host.camera;
  cam.position.set(163.5, 92, 143.5);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(-0.25, -0.8, 0);
  cam.updateMatrixWorld();
  window.petrocraft.player && (window.petrocraft.player.update = () => {});
  const t = [];
  for (let i = 0; i < 8; i++) {
    const a = performance.now();
    host.update(1 / 60);
    const b = performance.now();
    host.render();
    const c = performance.now();
    t.push([b - a, c - b]);
  }
  const info = host.renderer.info;
  let meshes = 0, tris = 0, visible = 0;
  const byPass = {};
  host.chunks.forEachMesh((m) => {
    meshes++;
    const g = m.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n;
    const pass = m.userData.pass;
    const b = (byPass[pass] ??= { meshes: 0, tris: 0, visibleMeshes: 0, visibleTris: 0 });
    b.meshes++;
    b.tris += n;
    if (m.visible) { visible++; b.visibleMeshes++; b.visibleTris += n; }
  });
  const full = { calls: host.renderer.info.render.calls, triangles: host.renderer.info.render.triangles };
  // main view only (no shadow map, no post): one plain render
  const sh = host.renderer.shadowMap.enabled;
  host.renderer.shadowMap.enabled = false;
  host.renderer.info.reset();
  host.renderer.render(host.scene, host.camera);
  const mainOnly = { calls: host.renderer.info.render.calls, triangles: host.renderer.info.render.triangles };
  host.renderer.shadowMap.enabled = sh;
  return {
    cam: host.camera.position.toArray().map((v) => +v.toFixed(1)),
    full, programs: info.programs?.length,
    geometries: info.memory.geometries, textures: info.memory.textures,
    chunkEntries: host.chunks.entries.size, terrainMeshes: meshes, terrainTrianglesLoaded: tris, visibleMeshes: visible, byPass, mainOnly,
    updateMs: t.map((x) => +x[0].toFixed(2)), renderMs: t.map((x) => +x[1].toFixed(1)),
    stats: host.stats ?? null,
    culledSections: host.chunks.stats?.culledSections,
  };
});
// streaming while moving: camera flies 1.5 blocks per frame across the map (worker meshing runs in parallel);
// records the main-thread cost of the chunk manager and of the whole renderer update per frame
r.walk = await page.evaluate(async () => {
  const host = window.petrocraft.host;
  const cm = host.chunks;
  const orig = cm.update.bind(cm);
  const times = [];
  cm.update = (...args) => {
    const t = performance.now();
    orig(...args);
    times.push(performance.now() - t);
  };
  const upd = [];
  const cam = host.camera;
  const frame = () => new Promise((res) => requestAnimationFrame(res));
  for (let i = 0; i < 120; i++) {
    cam.position.x = 40 + i * 1.5;
    cam.position.z = 60 + i * 0.8;
    cam.updateMatrixWorld();
    const t = performance.now();
    host.update(1 / 60);
    upd.push(performance.now() - t);
    host.render();
    await frame();
  }
  cm.update = orig;
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { avg: +(a.reduce((p, c) => p + c, 0) / a.length).toFixed(2), p50: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
  };
  return { chunkUpdateMs: stat(times), rendererUpdateMs: stat(upd) };
});
console.log(JSON.stringify(r, null, 1));
if (out) await page.screenshot({ path: out });
await browser.close();
