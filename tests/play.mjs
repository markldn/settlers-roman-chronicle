// Drives a real session in the browser: builds, lays roads, runs time, opens windows, save/load.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright').catch(() => import('/home/mark/scripts/tracker/node_modules/playwright/index.mjs'));
import fs from 'fs';
const OUT = process.env.OUT || '/tmp/settlers-shots'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
page.on('console', m => { if (m.type() === 'error') errs.push('ERROR ' + m.text().slice(0, 300)); });
await page.goto('http://localhost:8960/');
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 120000 });
await page.click('[data-act=free]'); await page.waitForTimeout(200);
await page.selectOption('#f-size', 'small'); await page.fill('#f-seed', '4242');
await page.click('.mf .btn.green');
await page.waitForFunction(() => app.state === 'game', null, { timeout: 120000 });
await page.waitForTimeout(1000);
const r1 = await page.evaluate(() => {
  const g = app.game, me = app.me, ui = app.ui;
  const hq = [...g.buildings.values()].find(b => b.owner === me && b.type === 'hq');
  const hqFlag = g.flags.get(hq.flag);
  const placed = [];
  const tryType = (type) => {
    const cands = [];
    for (let n = 0; n < g.grid.n; n++) if (g.owner[n] === me + 1 && g.canBuildType(me, n, type)) cands.push(n);
    cands.sort((a, b) => g.grid.dist(a, hq.node) - g.grid.dist(b, hq.node));
    for (const n of cands.slice(0, 12)) {
      ui.openAction(n);
      const card = document.querySelector(`.bcard[data-build=${type}]`);
      if (!card || card.classList.contains('dis')) { ui.closeAll(); continue; }
      card.click();
      // now in road mode: path to HQ flag via hover + click
      if (ui.road) {
        ui.onHover(hqFlag.node); ui.roadClick(hqFlag.node);
        if (ui.road) { ui.cancelRoad(); }
      }
      const b = g.buildingAt(n);
      if (b && g.flags.get(b.flag).roads.some(Boolean)) { placed.push(type); return true; }
      if (b) g.destroyFlag(b.flag);
    }
    return false;
  };
  for (const t of ['woodcutter', 'woodcutter', 'quarry', 'forester', 'sawmill', 'barracks', 'fishery', 'well']) tryType(t);
  app.setSpeed(4);
  return { placed, roads: g.roads.size };
});
console.log('placed', JSON.stringify(r1));
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT + '/4-early.png' });
// fast-forward the sim directly (render continues)
await page.evaluate(() => { for (let i = 0; i < 20 * 240; i++) { app.game.update(0.05); } app.game.events.length = 0; });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = app.game; const b = [...g.buildings.values()].find(b => b.owner === app.me && b.type === 'sawmill') || [...g.buildings.values()].find(b => b.owner === app.me && b.type !== 'hq'); if (b) { app.renderer.centerOn(b.node, true); app.renderer.cam.tdist = 9; } });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '/5-closeup.png' });
const st = await page.evaluate(() => { const g = app.game; const c = {}; for (const b of g.buildings.values()) if (b.owner === app.me) c[b.type + (b.state === 'site' ? '(site)' : '')] = (c[b.type + (b.state === 'site' ? '(site)' : '')] || 0) + 1; return { t: Math.round(g.time), c, produced: g.players[app.me].produced, settlers: g.settlers.size }; });
console.log('state', JSON.stringify(st));
// open all windows
await page.evaluate(() => { const ui = app.ui; ui.tool('stock'); ui.tool('stats'); ui.tool('economy'); ui.tool('buildings'); ui.tool('messages'); const hq = [...app.game.buildings.values()].find(b => b.type === 'hq' && b.owner === app.me); ui.openBuilding(hq); const saw = [...app.game.buildings.values()].find(b => b.type === 'sawmill'); if (saw) ui.openBuilding(saw); });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '/6-windows.png' });
await page.evaluate(() => app.ui.closeAll());
// save + load roundtrip
await page.evaluate(async () => { await app.quickSave(); });
await page.waitForTimeout(500);
await page.evaluate(async () => { await app.quickLoad(); });
await page.waitForTimeout(2000);
const after = await page.evaluate(() => ({ t: Math.round(app.game.time), b: app.game.buildings.size, state: app.state }));
console.log('after load', JSON.stringify(after));
await page.screenshot({ path: OUT + '/7-loaded.png' });
console.log(errs.length ? errs.slice(0, 20).join('\n') : 'NO ERRORS');
await browser.close();
