// Browser probe: loads the game, captures errors, screenshots title + a started free game.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright').catch(() => import('/home/mark/scripts/tracker/node_modules/playwright/index.mjs'));
const URL = process.env.URL || 'http://localhost:8960/';
const OUT = process.env.OUT || '/tmp/settlers-shots';
import fs from 'fs'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 400)); });
page.on('requestfailed', r => errs.push('REQFAILED ' + r.url()));
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden') || /Failed/.test(document.querySelector('#load-text')?.textContent || ''), null, { timeout: 240000 });
console.log('loaded in', Date.now() - t0, 'ms;', await page.textContent('#load-text'));
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + '/1-title.png' });
if (process.env.STAGE !== 'title') {
  await page.click('[data-act=free]');
  await page.waitForTimeout(300);
  await page.selectOption('#f-size', 'small');
  await page.click('.mf .btn.green');
  await page.waitForFunction(() => window.app && window.app.state === 'game', null, { timeout: 60000 }).catch(e => { console.log(errs.join('\n')); throw e; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/2-game.png' });
  // toggle build help & zoom in
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/3-buildhelp.png' });
  const info = await page.evaluate(() => { const r = app.renderer.r.info; return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, settlers: app.game.settlers.size }; });
  console.log('render info', JSON.stringify(info));
}
console.log(errs.length ? errs.slice(0, 30).join('\n') : 'NO ERRORS');
await browser.close();
