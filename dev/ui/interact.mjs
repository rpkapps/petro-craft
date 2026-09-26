// Scripted interaction smoke test for the UI harness (keyboard, clicks, drag & drop, dialogs).
// Usage: node dev/ui/interact.mjs  (expects the dev server on :5209)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const base = process.env.BASE ?? 'http://localhost:5209/dev/ui/';
mkdirSync('dev-screens/ui-int', { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT') && !m.text().includes('404')) errors.push(m.text()); });
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
const topPanel = () => page.evaluate(() => [...document.querySelectorAll('.pc-panel:not(.closing)')].pop()?.querySelector('.ph-title')?.textContent ?? null);
const settle = (ms = 400) => page.waitForTimeout(ms);

await page.goto(`${base}?screen=hud&live=0`, { waitUntil: 'load' });
await settle(1200);

// hotkeys
await page.keyboard.press('KeyB');
await settle();
check('B opens build', (await topPanel()) === 'Construction');
await page.keyboard.press('KeyM');
await settle();
check('M switches to market', (await topPanel()) === 'Commodity Market');
await page.keyboard.press('Escape');
await settle();
check('Esc closes panel', (await topPanel()) === null);
await page.keyboard.press('Escape');
await settle();
check('Esc with nothing open → pause', (await topPanel()) === 'Paused');
check('pause menu pauses time', await page.evaluate(() => window.ui.ctx.state.time.paused));
await page.keyboard.press('Escape');
await settle();
check('closing pause resumes time', !(await page.evaluate(() => window.ui.ctx.state.time.paused)));

// speed keys
await page.keyboard.press('Period');
await settle(100);
check('. speeds up', (await page.evaluate(() => window.ui.ctx.state.time.speed)) === 5);
await page.keyboard.press('Backquote');
await settle(100);
check('` toggles pause', await page.evaluate(() => window.ui.ctx.state.time.paused));
await page.keyboard.press('Backquote');

// hotbar click
await page.click('.hb-slot:nth-child(6)');
await settle(200);
check('hotbar click selects slot', (await page.evaluate(() => window.ui.ctx.state.players.p1.selectedSlot)) === 5);

// build card → build mode
const modes = await page.evaluate(() => { const log = []; window.ui.ctx.bus.on('ui:buildMode', (e) => log.push(e.type)); window.__modes = log; return true; });
await page.keyboard.press('KeyB');
await settle();
await page.click('.bd-card:not(.locked)');
await settle();
check('build card emits ui:buildMode and closes', (await page.evaluate(() => window.__modes.at(-1))) === 'drilling_rig_land' && (await topPanel()) === null);
await page.screenshot({ path: 'dev-screens/ui-int/buildmode.png' });

// inventory drag & drop
await page.keyboard.press('KeyE');
await settle();
const before = await page.evaluate(() => JSON.stringify([window.ui.ctx.state.players.p1.inventory[0], window.ui.ctx.state.players.p1.inventory[30]]));
await page.dragAndDrop('.inv-grid.hotbar .inv-slot:nth-child(1)', '.inv-grid:not(.hotbar) .inv-slot:nth-child(22)');
await settle();
const after = await page.evaluate(() => JSON.stringify([window.ui.ctx.state.players.p1.inventory[0], window.ui.ctx.state.players.p1.inventory[30]]));
check('inventory drag & drop moves item', before !== after, after);
await page.keyboard.press('Escape');

// market sell dialog
await page.keyboard.press('KeyM');
await settle();
const cash0 = await page.evaluate(() => window.ui.ctx.state.company.money);
await page.click('.mk-selhead .btn.primary');
await settle();
check('sell dialog opens', await page.evaluate(() => !!document.querySelector('.pc-modal')));
await page.screenshot({ path: 'dev-screens/ui-int/sell.png' });
await page.click('.pc-modal .md-actions .btn.primary');
await settle();
check('sell dispatches market/sell', (await page.evaluate(() => window.ui.ctx.state.company.money)) > cash0);
await page.keyboard.press('Escape');

// research start
await page.keyboard.press('KeyT');
await settle();
await page.evaluate(() => [...document.querySelectorAll('.rs-node')].find((n) => n.dataset.status === 'available')?.click());
await settle();
await page.click('.rs-detail .btn.primary');
await settle();
check('research start changes current', (await page.evaluate(() => window.ui.ctx.state.research.current)) !== 'horizontal_drilling');
await page.keyboard.press('Escape');

// map seismic tool
await page.keyboard.press('KeyN');
await settle(700);
await page.click('.map-tool');
const box = await page.locator('.map-canvas').boundingBox();
await page.mouse.move(box.x + 200, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x + 400, box.y + 260, { steps: 6 });
await page.mouse.up();
await settle();
check('seismic drag shows quote', await page.evaluate(() => !!document.querySelector('.map-quote')));
await page.screenshot({ path: 'dev-screens/ui-int/seismic-quote.png' });
const nSurveys = await page.evaluate(() => Object.keys(window.ui.ctx.state.surveys).length);
await page.click('.map-quote .btn.primary');
await settle();
check('survey/start creates survey', (await page.evaluate(() => Object.keys(window.ui.ctx.state.surveys).length)) === nSurveys + 1);
await page.keyboard.press('Escape');
await settle();

// planner flow from rig inspector
await page.evaluate(() => { const b = Object.values(window.ui.ctx.state.buildings).find((x) => x.type === 'drilling_rig_heavy'); window.ui.ctx.bus.emit('ui:select', { kind: 'building', id: b.id }); });
await settle();
check('ui:select opens inspector', (await topPanel()) === 'Heavy Drilling Rig');
await page.click('.ins-grid .btn.primary');
await settle(800);
check('plan new well opens planner', (await topPanel()) === 'Well Planner');
await page.screenshot({ path: 'dev-screens/ui-int/planner.png' });
const nWells = await page.evaluate(() => Object.keys(window.ui.ctx.state.wells).length);
await page.evaluate(() => document.querySelector('.pl-quotecard .btn.primary').click());
await settle(600);
check('approve & spud creates a drilling well', (await page.evaluate(() => Object.values(window.ui.ctx.state.wells).filter((w) => w.status === 'drilling').length)) >= 2 && (await page.evaluate(() => Object.keys(window.ui.ctx.state.wells).length)) === nWells + 1);
check('planner hands over to well detail', /Heavy|Well|Coyote|Eagle|Bravo|Mesa/.test((await topPanel()) ?? ''), await topPanel());
await page.keyboard.press('Escape');

// settings keybind remap
await page.keyboard.press('Escape');
await settle();
await page.evaluate(() => window.ui.open('settings', { tab: 'controls' }));
await settle();
await page.evaluate(() => [...document.querySelectorAll('.st-bind')].find((b) => b.textContent.startsWith('Build menu')).querySelector('button').click());
await page.keyboard.press('KeyZ');
await settle();
check('keybind remap', (await page.evaluate(() => window.app.settings.keybinds.build)) === 'KeyZ');
await page.evaluate(() => window.ui.closeAll());

// objective claim from tracker
const cash1 = await page.evaluate(() => window.ui.ctx.state.company.money);
await page.click('.ob-claim');
await settle();
check('objective claim', (await page.evaluate(() => window.ui.ctx.state.company.money)) > cash1);

// main menu → new game → loading → hud
await page.goto(`${base}?screen=menu`, { waitUntil: 'load' });
await settle(1000);
await page.click('.mn-item:nth-child(2)');
await settle();
check('New Game dialog opens', (await topPanel()) === 'New Game');
await page.click('.ng-foot .btn.primary');
await settle(800);
check('loading screen shows', await page.evaluate(() => document.querySelector('.pc-loading').classList.contains('show')));
await page.screenshot({ path: 'dev-screens/ui-int/loading.png' });
await settle(3200);
check('HUD after loading', await page.evaluate(() => !!document.querySelector('.pc-topbar') && !document.querySelector('.pc-loading').classList.contains('show')));

console.log(results.join('\n'));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
