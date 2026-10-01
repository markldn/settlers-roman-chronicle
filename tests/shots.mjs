// Regenerates docs/screenshots/*.png for the README (needs the server on :8960 and a GPU).
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8960/');
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + 'title.png' });
await page.click('[data-act=campaign]'); await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 'campaign.png' });
await page.click('.mf .btn:not(.green)'); await page.waitForTimeout(300);
// themed towns: free games with 1 hard AI opponent, fast-forwarded, whole map revealed
for (const [theme, seed, mins] of [['greenland', 1234, 14], ['winter', 777, 12], ['wasteland', 4321, 12]]) {
  await page.click('[data-act=free]'); await page.waitForTimeout(200);
  await page.selectOption('#f-size', 'small'); await page.selectOption('#f-theme', theme); await page.fill('#f-seed', String(seed)); await page.selectOption('#f-ai', 'hard');
  await page.click('.mf .btn.green');
  await page.waitForFunction(() => app.state === 'game', null, { timeout: 120000 });
  await page.evaluate((mins) => { const g = app.game; g.players[app.me].ai = 'hard'; for (let i = 0; i < 20 * 60 * mins; i++) g.update(0.05); g.events.length = 0; g.players[app.me].ai = null; app.renderer.world.revealAll = true; g.updateVision(true); }, mins);
  await page.evaluate(() => { const g = app.game; const hq = [...g.buildings.values()].find(b => b.owner === app.me && b.type === 'hq') || [...g.buildings.values()].find(b => b.type === 'hq'); app.renderer.centerOn(hq.node, true); app.renderer.cam.tdist = app.renderer.cam.dist = 13; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + `town-${theme}.png` });
  if (theme === 'greenland') {
    await page.evaluate(() => { app.renderer.cam.tdist = app.renderer.cam.dist = 7.5; const g = app.game; const b = [...g.buildings.values()].find(b => b.owner === app.me && (b.type === 'sawmill' || b.type === 'mill')); if (b) app.renderer.centerOn(b.node, true); });
    await page.waitForTimeout(2000); await page.screenshot({ path: OUT + 'closeup.png' });
    await page.evaluate(() => { app.renderer.cam.tdist = app.renderer.cam.dist = 11; const g = app.game; let n = -1; for (let i = 0; i < g.grid.n; i++) if (g.buildCap(app.me, i) === 'large') { n = i; break; } if (n >= 0) { app.renderer.centerOn(n, true); setTimeout(() => app.ui.openAction(n), 600); } app.ui.toggleBuildHelp(true); });
    await page.waitForTimeout(2200); await page.screenshot({ path: OUT + 'build-menu.png' });
    await page.evaluate(() => { app.ui.closeAll(); app.ui.toggleBuildHelp(false); app.ui.tool('stats'); const hq = [...app.game.buildings.values()].find(b => b.owner === app.me && b.type === 'hq'); if (hq) app.ui.openBuilding(hq); });
    await page.waitForTimeout(1200); await page.screenshot({ path: OUT + 'windows.png' });
    await page.evaluate(() => app.ui.closeAll());
  }
  await page.evaluate(() => { app.state = 'title'; document.querySelector('#hud').classList.add('hidden'); document.querySelector('#title').classList.remove('hidden'); });
}
console.log(errs.join('\n') || 'NO ERRORS');
await browser.close();
