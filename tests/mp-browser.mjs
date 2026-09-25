// Two browsers play a multiplayer game against the server: the lobby front page, the host assistant,
// an invite link, room chat and settings, lockstep commands, in-game chat, a reload that rejoins the game.
//   URL=http://localhost:8961/ node tests/mp-browser.mjs      (server: npm run build && npm run dev-server)
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8961/';
const OUT = process.env.OUT || '/tmp/settlers-mp';
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: +(process.env.W || 640), height: +(process.env.H || 420) } }); // small: software WebGL is slow
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(`${name}: ${e.message}`); console.log('    pageerror', name, e.message); });
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
  page.on('dialog', d => d.accept());
  // software rendering in CI is slow: low graphics quality keeps frames coming
  await page.addInitScript((n) => { try { localStorage.setItem('settlers.quality', 'low'); if (!sessionStorage.getItem('named')) { localStorage.setItem('settlers.mp.name', n); sessionStorage.setItem('named', 1); } } catch {} }, name);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 400000, polling: 500 });
  return { name, ctx, page };
}
const until = (p, fn, arg, timeout = 90000) => p.page.waitForFunction(fn, arg, { timeout, polling: 250 });

const a = await player('Aurelia'), b = await player('Brutus');
console.log('lobby');
// the site opens on the multiplayer lobby; a returning player (name stored) skips the name step
for (const p of [a, b]) await until(p, () => /online|Connected/.test(document.querySelector('#lb-status').textContent) && !!document.querySelector('#lb-host'));
ok(true, 'both land in the lobby and are connected');
await a.page.fill('#lb-input', 'Salvete!'); await a.page.press('#lb-input', 'Enter');
await until(b, () => /Salvete!/.test(document.querySelector('#lb-log').textContent));
ok(true, 'lobby chat reaches the other player');

// the host assistant: size → landscape → opponents → name
await a.page.click('#lb-host');
await a.page.click('[data-pick=size][data-v=small]'); await a.page.click('[data-act=next]');
await a.page.click('[data-pick=theme][data-v=wasteland]'); await a.page.click('[data-act=next]');
for (let i = 0; i < 6; i++) if (await a.page.isEnabled('[data-ai="-1"]')) await a.page.click('[data-ai="-1"]');
await a.page.click('[data-ai="1"]'); await a.page.click('[data-act=next]');
await a.page.fill('#wz-room', 'Test of arms');
await a.page.click('[data-act=open]');
await until(a, () => /Small map/.test(document.querySelector('#lb-summary')?.textContent || '') && /Wasteland/.test(document.querySelector('#lb-summary').textContent));
ok(true, 'the host assistant opened a room with its choices (small wasteland, 1 computer)');
await until(b, () => [...document.querySelectorAll('#lb-rooms .lb-room')].some(r => /Test of arms/.test(r.textContent) && /Small map/.test(r.textContent)));
ok(true, 'the new game shows up, with its settings, in the lobby of the other player');

// the guest comes in through the invite link
const roomId = await a.page.evaluate(() => app.lobby.room.id);
await b.page.goto(URL + '#join=' + roomId); await b.page.reload();
await until(a, () => document.querySelectorAll('#lb-seats .lb-seat:not(.ai):not(.free)').length === 2, null, 400000);
ok(true, 'second player joined through the invite link');
await until(b, () => /Small map/.test(document.querySelector('#lb-summary')?.textContent || '') && document.querySelectorAll('#lb-seats .lb-seat.ai').length === 1);
ok(true, 'the guest sees the settings and the computer player');
await b.page.fill('#lb-input', 'Ave, host'); await b.page.press('#lb-input', 'Enter');
await until(a, () => /Ave, host/.test(document.querySelector('#lb-log').textContent));
ok(true, 'room chat works');

// the host changes a setting in the room; the guest sees it
await a.page.click('#lb-adv');
await a.page.fill('[data-set=seed]', '321'); await a.page.dispatchEvent('[data-set=seed]', 'change');
await a.page.selectOption('[data-set=theme]', 'greenland');
await until(b, () => /Greenland/.test(document.querySelector('#lb-summary')?.textContent || ''));
ok(true, 'changed settings reach the guest');
await b.page.selectOption('#lb-seats .lb-seat.me select[data-seat=nation]', 'japanese');
await b.page.click('#lb-ready');
await until(a, () => /Ready/.test([...document.querySelectorAll('#lb-seats .lb-seat')][1]?.textContent));
await a.page.screenshot({ path: OUT + '/1-room.png', timeout: 120000 });
await a.page.click('#lb-start');

console.log('game');
for (const p of [a, b]) await until(p, () => window.app.state === 'game' && window.app.mp && !window.app.mp.loading, null, 120000);
ok(true, 'both are in the game');
const info = (p) => p.page.evaluate(() => ({ me: app.me, players: app.game.players.map(q => [q.name, q.nation, q.human, q.ai]), turn: app.mp.done, w: app.game.map.w }));
const ia = await info(a), ib = await info(b);
ok(ia.me === 0 && ib.me === 1, `seats: host is player ${ia.me}, guest player ${ib.me}`);
ok(JSON.stringify(ia.players) === JSON.stringify(ib.players) && ia.players.length === 3 && ia.w === 56, 'both built the same setup: ' + JSON.stringify(ia.players));

// the guest builds a woodcutter near their headquarters through the normal command path
const placed = await b.page.evaluate(() => new Promise((resolve) => {
  const g = app.game, hq = [...g.buildings.values()].find(x => x.owner === app.me && x.type === 'hq');
  const n = g.grid.within(hq.node, 6).find(i => g.canBuildType(app.me, i, 'woodcutter'));
  app.cmd({ k: 'build', n, t: 'woodcutter' }, (bld) => resolve({ n, ok: !!bld }));
}));
ok(placed.ok, 'guest placed a woodcutter (command came back through the server)');
await until(a, (n) => { const b = window.app.game.buildingAt(n); return b && b.type === 'woodcutter' && b.owner === 1; }, placed.n);
ok(true, 'the host sees the guest\'s new woodcutter');

// in-game chat
await b.page.keyboard.press('Enter');
await b.page.keyboard.type('Wood for the legion!');
await b.page.keyboard.press('Enter');
await until(a, () => /Wood for the legion!/.test(document.querySelector('#chat-log').textContent));
ok(true, 'in-game chat reaches the other player');

// speed: only the host may change it
await a.page.evaluate(() => app.cycleSpeed(1));
await until(b, () => window.app.mp.speed === 2);
ok(true, 'host set speed 2x for everybody');

// let the game run and compare fingerprints at the same turn
await a.page.waitForTimeout(6000);
// each page keeps up with the turns it has received (loose bound: software WebGL renders ~2 fps here)
const sync = await Promise.all([a, b].map(p => p.page.evaluate(() => ({ lag: app.mp.recv - app.mp.done, turn: app.mp.done, tick: app.game.tickN }))));
ok(sync.every(x => x.lag < 50 && x.turn > 20), `both keep up with the server: ${JSON.stringify(sync)}`);
await a.page.screenshot({ path: OUT + '/2-host.png' });
await b.page.screenshot({ path: OUT + '/3-guest.png' });

console.log('rejoin');
await b.page.reload(); // no clicks: the front page reconnects and puts the player back in the game
await until(b, () => window.app.state === 'game' && window.app.mp && !window.app.mp.loading, null, 400000);
await b.page.waitForTimeout(3000);
const after = await Promise.all([a, b].map(p => p.page.evaluate(() => ({ lag: app.mp.recv - app.mp.done, me: app.me, wc: [...app.game.buildings.values()].filter(x => x.type === 'woodcutter' && x.owner === 1).length }))));
ok(after[1].me === 1 && after[1].wc >= 1 && after[1].wc === after[0].wc && after[1].lag < 50, `reloaded page rejoined its seat from a snapshot: ${JSON.stringify(after)}`);
await b.page.screenshot({ path: OUT + '/4-rejoined.png' });

// wait past a hash check and make sure nobody had to resync
await a.page.waitForTimeout(4000);
const toasts = await Promise.all([a, b].map(p => p.page.evaluate(() => document.querySelector('#toasts').textContent)));
ok(!toasts.some(t => /Resynchronised/.test(t)), 'no desync reported');

console.log('leave');
await b.page.evaluate(() => { app.gameMenu(); });
await b.page.click('#gm-quit');
await until(a, () => /left the game/.test(document.querySelector('#chat-log').textContent) || window.app.lobby.logs.room.some(l => /left the game/.test(l.text)));
await until(a, () => window.app.game.players[1].ai === 'normal');
ok(true, 'a player who leaves is replaced by a computer steward, in lockstep');

ok(!errors.length, 'no page errors' + (errors.length ? ':\n    ' + errors.slice(0, 10).join('\n    ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
