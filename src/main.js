// App orchestration: boot, title screen, dialogs, fixed-step loop, save/load.
import { Game, TICK } from './sim/game.js';
import { BUILDINGS, NATIONS } from './sim/data.js';
import { CAMPAIGN, makeSetup, freeSetup, initMission, checkMission, campaignProgress, unlockNext } from './sim/missions.js';
import { Renderer } from './render/renderer.js';
import { Audio } from './audio.js';
import { UI, fmtTime, esc } from './ui/ui.js';
import { getIconAtlas } from './render/icons.js';

const $ = (s) => document.querySelector(s);
const SPEEDS = [0.5, 1, 2, 4, 8];

const app = window.app = {
  state: 'boot', game: null, me: 0, speed: 1, speedIdx: 1, paused: false, acc: 0,
  portraits: {},
};

function setLoad(p, text) { $('#load-bar').style.width = Math.round(p * 100) + '%'; if (text) $('#load-text').textContent = text; }
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  setLoad(0.05, 'Drawing icons…'); await frame();
  getIconAtlas();
  setLoad(0.15, 'Lighting the forge…'); await frame();
  app.renderer = new Renderer($('#view'));
  app.audio = new Audio();
  app.ui = new UI(app);
  app.ui.bindInput($('#view'));
  setLoad(0.3, 'Carving the buildings…'); await frame();
  app.portraits = app.renderer.portraits('romans');
  setLoad(0.55, 'Shaping the land…'); await frame();
  await startDemo();
  setLoad(1, 'Ready'); await frame();
  $('#loading').classList.add('hidden');
  showTitle();
  document.addEventListener('pointerdown', () => app.audio.init(), { once: true });
  document.addEventListener('keydown', () => app.audio.init(), { once: true });
  requestAnimationFrame(loop);
}

// title background: two computer players building on a random map
async function startDemo() {
  const seed = 1 + Math.floor(Math.random() * 9999);
  const g = new Game({ seed, mapOpts: { w: 64, h: 60, seed, players: 2, theme: ['greenland', 'greenland', 'winter', 'wasteland'][seed % 4], forest: 0.6 }, players: [{ name: 'A', ai: 'hard' }, { name: 'B', ai: 'hard', nation: 'vikings' }] });
  for (let i = 0; i < 20 * 150; i++) { g.update(TICK); g.events.length = 0; } // let them build a bit first
  app.game = g; app.me = 0;
  app.renderer.setGame(g, 0);
  app.renderer.world.revealAll = true;
  app.renderer.cam.tdist = 20; app.renderer.cam.dist = 20;
  app.demoT = 0;
}

function showTitle() {
  app.state = 'title';
  $('#title').classList.remove('hidden'); $('#hud').classList.add('hidden');
  document.querySelectorAll('#title [data-act]').forEach(b => b.onclick = () => { app.audio.init(); app.audio.ui('click'); titleAction(b.dataset.act); });
}
function titleAction(a) {
  if (a === 'campaign') campaignDialog();
  else if (a === 'free') freeDialog();
  else if (a === 'load') loadDialog();
  else if (a === 'settings') optionsDialog();
  else if (a === 'help') helpDialog();
}

// ------------------------------------------------------------------ dialogs
function modal(title, body, buttons, { onMount } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box"><div class="mh">${esc(title)}</div><div class="mb">${body}</div><div class="mf">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.text)}</button>`).join('')}</div></div>`;
  m.classList.remove('hidden');
  m.querySelectorAll('.mf button').forEach(el => el.onclick = () => { app.audio.ui('click'); const b = buttons[+el.dataset.i]; const pre = b.pre ? b.pre() : undefined; if (!b.keep) closeModal(); b.fn && b.fn(pre); });
  if (onMount) onMount(m);
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

function campaignDialog() {
  const prog = campaignProgress();
  let sel = Math.min(prog.unlocked, CAMPAIGN.length) - 1;
  const body = () => `<div class="chapters"><div class="cl">${CAMPAIGN.map((c, i) => `<div class="ch ${i === sel ? 'sel' : ''} ${i >= prog.unlocked ? 'lock' : ''}" data-i="${i}">${esc(c.title)}${prog['won_' + c.id] ? '<span class="won">✓</span>' : ''}</div>`).join('')}</div>
    <div class="brief"><h2>${esc(CAMPAIGN[sel].title)}</h2>${esc(CAMPAIGN[sel].brief)}<h3 style="font-family:Cinzel;margin:14px 0 4px">Objectives</h3><ul>${CAMPAIGN[sel].objectives.map(o => `<li>${esc(o.text)}</li>`).join('')}</ul></div></div>`;
  const mount = (m) => m.querySelectorAll('.ch').forEach(el => el.onclick = () => { const i = +el.dataset.i; if (i >= prog.unlocked) return; sel = i; app.audio.ui('click'); m.querySelector('.mb').innerHTML = body(); mount(m); });
  modal('Campaign', body(), [{ text: 'Back' }, { text: 'Begin chapter', cls: 'green', fn: () => startGame(makeSetup(CAMPAIGN[sel])) }], { onMount: mount });
}

function freeDialog() {
  const body = `<div class="form">
    <span>Your name</span><input type="text" id="f-name" value="Legatus">
    <span>Your people</span><select id="f-nation">${Object.entries(NATIONS).map(([k, n]) => `<option value="${k}">${n.name}</option>`).join('')}</select>
    <span>Map size</span><select id="f-size"><option value="small">Small (56×56)</option><option value="medium" selected>Medium (80×72)</option><option value="large">Large (112×100)</option><option value="huge">Huge (144×128)</option></select>
    <span>Landscape</span><select id="f-theme"><option value="greenland">Greenland</option><option value="winter">Winter world</option><option value="wasteland">Wasteland</option></select>
    <span>Layout</span><select id="f-layout"><option value="continent">Continent</option><option value="lakes">Lakes</option><option value="valley">River valley</option><option value="islands">Islands</option><option value="pass">Mountain pass</option></select>
    <span>Mountains</span><input type="range" id="f-mount" min="0" max="10" value="5">
    <span>Forests</span><input type="range" id="f-forest" min="0" max="10" value="5">
    <span>Water</span><input type="range" id="f-water" min="0" max="10" value="5">
    <span>Opponents</span><select id="f-opp"><option>0</option><option selected>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
    <span>Computer skill</span><select id="f-ai"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select>
    <span>Opponents allied</span><input type="checkbox" id="f-teams">
    <span>Starting goods</span><select id="f-start"><option value="low">Few</option><option value="normal" selected>Normal</option><option value="high">Many</option></select>
    <span>Map seed</span><input type="number" id="f-seed" value="${1 + Math.floor(Math.random() * 99999)}"></div>`;
  modal('Unlimited Play', body, [{ text: 'Back' }, { text: 'Start', cls: 'green', fn: (setup) => startGame(setup), pre: () => {
    const v = (id) => document.getElementById(id);
    return (freeSetup({ name: v('f-name').value, nation: v('f-nation').value, size: v('f-size').value, theme: v('f-theme').value, layout: v('f-layout').value,
      mountains: +v('f-mount').value / 10, forest: +v('f-forest').value / 10, water: +v('f-water').value / 10, opponents: +v('f-opp').value, ai: v('f-ai').value,
      teams: v('f-teams').checked, start: v('f-start').value, seed: +v('f-seed').value || 1 }));
  } }]);
}

function optionsDialog(inGame = false) {
  const a = app.audio.vol, q = app.renderer.quality;
  const body = `<div class="form">
    <span>Graphics quality</span><select id="o-q"><option value="high" ${q === 'high' ? 'selected' : ''}>High (AO, bloom, 4K shadows, tilt-shift)</option><option value="medium" ${q === 'medium' ? 'selected' : ''}>Medium (bloom, 2K shadows)</option><option value="low" ${q === 'low' ? 'selected' : ''}>Low (no post-processing, no shadows)</option></select>
    <span>Master volume</span><input type="range" id="o-master" min="0" max="100" value="${a.master * 100}">
    <span>Music</span><input type="range" id="o-music" min="0" max="100" value="${a.music * 100}">
    <span>Sound effects</span><input type="range" id="o-sfx" min="0" max="100" value="${a.sfx * 100}">
    <span>Ambience</span><input type="range" id="o-amb" min="0" max="100" value="${a.amb * 100}"></div>`;
  modal('Options', body, [{ text: 'Close', fn: () => inGame && app.gameMenu() }], {
    onMount: (m) => {
      m.querySelector('#o-q').onchange = (e) => app.renderer.setQuality(e.target.value);
      for (const k of ['master', 'music', 'sfx', 'amb']) m.querySelector('#o-' + k).oninput = (e) => { app.audio.init(); app.audio.setVolume(k, e.target.value / 100); };
    },
  });
}

function helpDialog() {
  modal('How to Play', `<div class="help">
    <h3>The idea</h3><p>Everything in your realm is carried by hand. Buildings stand on a node and have a <b>flag</b> in front of them; flags are joined by <b>roads</b>, and every road between two flags gets its own carrier who moves one ware at a time. A good road network is the heart of your economy.</p>
    <h3>Building</h3><ul><li>Click your land to open the build menu. <kbd>Space</kbd> shows what fits where: flag, small, medium, large house, mine.</li>
    <li>After placing a building you are in <b>road mode</b>: click nodes to lay the road and finish on an existing flag.</li>
    <li>Click a road to put extra flags on it — shorter segments mean more carriers and faster transport.</li>
    <li>Materials (boards, stones) are carried to the site; a builder levels the ground and builds.</li></ul>
    <h3>Economy chains</h3><ul><li>Woodcutter → wood → Sawmill → boards · Forester replants · Quarry → stones</li>
    <li>Farm → grain → Mill → flour + Well water → Bakery → bread · Fishery, Hunter, Pig farm + Slaughterhouse → food</li>
    <li>Food feeds mines: coal, iron ore, gold, granite · Smelter: iron ore + coal → iron</li>
    <li>Metalworks: iron + boards → tools · Armory: iron + coal → swords &amp; shields · Mint: gold + coal → coins · Brewery: grain + water → beer</li>
    <li>Workers need tools. Helpers become soldiers with a sword, a shield and a beer. Coins promote soldiers.</li></ul>
    <h3>Land and war</h3><p>Military buildings claim land once a soldier moves in. Click an enemy military building near your border to attack. Captured buildings flip their land; buildings left on foreign land burn.</p>
    <h3>Controls</h3><p><kbd>W A S D</kbd>/arrows or right-drag: scroll · wheel: zoom · <kbd>Q</kbd>/<kbd>R</kbd> or middle-drag: rotate · <kbd>Space</kbd> build help · <kbd>H</kbd> headquarters · <kbd>I</kbd> inventory · <kbd>T</kbd> statistics · <kbd>E</kbd> economy · <kbd>B</kbd> buildings · <kbd>N</kbd> messages · <kbd>+</kbd>/<kbd>-</kbd> speed · <kbd>P</kbd> pause · <kbd>F5</kbd>/<kbd>F9</kbd> quick save/load · <kbd>Esc</kbd> menu</p></div>`, [{ text: 'Close' }]);
}

// ------------------------------------------------------------------ save / load (gzip + base64 in localStorage)
async function gz(str) { const s = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip')); const buf = new Uint8Array(await new Response(s).arrayBuffer()); let b = ''; for (let i = 0; i < buf.length; i += 0x8000) b += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(b); }
async function gunz(b64) { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const s = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(s).text(); }
function saveIndex() { try { return JSON.parse(localStorage.getItem('settlers.saves') || '[]'); } catch { return []; } }
async function saveGame(name) {
  const data = await gz(app.game.serialize());
  const idx = saveIndex().filter(s => s.name !== name);
  idx.unshift({ name, time: Date.now(), game: fmtTime(app.game.time), mission: app.game.setup.mission || 'free' });
  try { localStorage.setItem('settlers.save.' + name, data); localStorage.setItem('settlers.saves', JSON.stringify(idx.slice(0, 12))); app.ui.toast(`Game saved: ${name}`, 'goal'); }
  catch (e) { app.ui.toast('Save failed: storage full', 'war'); }
}
async function loadGame(name) {
  const data = localStorage.getItem('settlers.save.' + name); if (!data) return;
  const g = Game.deserialize(await gunz(data));
  enterGame(g);
  app.ui.toast(`Loaded: ${name}`, 'goal');
}
function loadDialog(inGame = false) {
  const idx = saveIndex();
  const body = idx.length ? `<div class="list">${idx.map((s, i) => `<div class="li link" data-i="${i}"><b>${esc(s.name)}</b><span class="muted">${esc(s.mission === 'free' ? 'Unlimited play' : (CAMPAIGN.find(c => c.id === s.mission) || {}).title || '')} · ${s.game}</span><span style="margin-left:auto" class="muted">${new Date(s.time).toLocaleString()}</span></div>`).join('')}</div>` : '<p class="muted">No saved games yet.</p>';
  modal('Load Game', body, [{ text: 'Back', fn: () => inGame && app.gameMenu() }], { onMount: (m) => m.querySelectorAll('.li').forEach(el => el.onclick = () => { closeModal(); loadGame(idx[+el.dataset.i].name); }) });
}

app.quickSave = () => saveGame('Quick save');
app.quickLoad = () => loadGame('Quick save');

app.gameMenu = () => {
  const wasPaused = app.paused; app.paused = true;
  modal('Game Menu', `<div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;max-width:320px;margin:0 auto">
    <button class="btn" id="gm-save">Save game</button><button class="btn" id="gm-load">Load game</button><button class="btn" id="gm-opt">Options</button><button class="btn" id="gm-help">How to play</button>
    <button class="btn" id="gm-restart">Restart</button><button class="btn red" id="gm-quit">Quit to title</button></div>`,
  [{ text: 'Resume', cls: 'green', fn: () => { app.paused = wasPaused && false; } }], {
    onMount: (m) => {
      m.querySelector('#gm-save').onclick = () => { const n = prompt('Save name', app.game.setup.mission ? (CAMPAIGN.find(c => c.id === app.game.setup.mission) || {}).title : 'My realm'); if (n) saveGame(n); closeModal(); app.paused = false; };
      m.querySelector('#gm-load').onclick = () => loadDialog(true);
      m.querySelector('#gm-opt').onclick = () => optionsDialog(true);
      m.querySelector('#gm-help').onclick = () => helpDialog();
      m.querySelector('#gm-restart').onclick = () => { if (confirm('Restart this game?')) { closeModal(); startGame(app.game.setup); } };
      m.querySelector('#gm-quit').onclick = () => { if (confirm('Quit to the title screen? Unsaved progress is lost.')) { closeModal(); quitToTitle(); } };
    },
  });
};

// ------------------------------------------------------------------ game lifecycle
async function startGame(setup) {
  closeModal();
  $('#title').classList.add('hidden');
  $('#loading').classList.remove('hidden'); setLoad(0.2, 'Surveying the land…'); await frame();
  const s = JSON.parse(JSON.stringify(Object.assign({}, setup, { map: undefined })));
  const g = new Game(s);
  initMission(g);
  setLoad(0.6, 'Baking the terrain…'); await frame();
  enterGame(g);
  $('#loading').classList.add('hidden');
  const ch = CAMPAIGN.find(c => c.id === g.setup.mission);
  if (ch) { app.paused = true; modal(ch.title, `<div class="brief">${esc(ch.brief)}<h3 style="font-family:Cinzel;margin:14px 0 4px">Objectives</h3><ul>${ch.objectives.map(o => `<li>${esc(o.text)}</li>`).join('')}</ul></div>`, [{ text: 'To work!', cls: 'green', fn: () => { app.paused = false; } }]); }
}
function enterGame(g) {
  app.ui.closeAll(); app.ui.cancelRoad && app.ui.road && app.ui.cancelRoad();
  app.game = g; app.me = g.players.findIndex(p => p.human); if (app.me < 0) app.me = 0;
  app.renderer.setGame(g, app.me);
  app.renderer.world.revealAll = false;
  app.renderer.cam.tdist = 14;
  app.state = 'game'; app.paused = false; app.acc = 0; app.ended = false;
  app.ui.readMsgs = g.players[app.me].messages.length;
  $('#title').classList.add('hidden'); $('#hud').classList.remove('hidden');
  app.setSpeed(1);
  app.ui.updateHud();
}
function quitToTitle() {
  app.ui.closeAll(); $('#hud').classList.add('hidden');
  startDemo().then(showTitle);
}
app.setSpeed = (i) => { app.speedIdx = i; app.speed = SPEEDS[i]; $('#speed').textContent = (app.paused ? '❚❚ ' : '') + app.speed + '×'; };
app.cycleSpeed = (d = 1) => { let i = app.speedIdx + d; if (i >= SPEEDS.length) i = 0; if (i < 0) i = 0; app.setSpeed(i); };
app.togglePause = () => { app.paused = !app.paused; app.setSpeed(app.speedIdx); };

function endGame(won) {
  if (app.ended) return; app.ended = true;
  const g = app.game, ch = CAMPAIGN.find(c => c.id === g.setup.mission);
  app.audio.play(won ? 'victory' : 'defeat', 0.8);
  if (won && ch) unlockNext(ch.id);
  const next = ch && CAMPAIGN[CAMPAIGN.indexOf(ch) + 1];
  const pl = g.players[app.me];
  const body = `<div class="bigmsg"><h1>${won ? 'Victory!' : 'Defeat'}</h1><p>${won ? (ch ? `${esc(ch.title)} is complete.` : 'All your enemies have been defeated.') : 'Your realm has fallen.'}</p>
    <p class="muted">Time ${fmtTime(g.time)} · land ${pl.territory} · enemies slain ${pl.killed} · boards sawn ${pl.produced.boards || 0}</p></div>`;
  const btns = [{ text: 'Keep playing', fn: () => {} }, { text: 'Title screen', fn: quitToTitle }];
  if (won && next) btns.push({ text: 'Next chapter', cls: 'green', fn: () => startGame(makeSetup(next)) });
  if (!won) btns.push({ text: 'Try again', cls: 'green', fn: () => startGame(g.setup) });
  modal(won ? 'Victory' : 'Defeat', body, btns);
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), uiT = 0, mmT = 0, slowT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const g = app.game; if (!g) return;
  const R = app.renderer;
  if (app.state === 'title') {
    // demo: sim runs, camera drifts slowly around the settlements
    app.acc += dt * 1.5;
    while (app.acc >= TICK) { g.update(TICK); app.acc -= TICK; }
    app.demoT += dt;
    const hqs = [...g.buildings.values()].filter(b => b.type === 'hq');
    if (hqs.length) { const t = app.demoT * 0.03, h = hqs[Math.floor(app.demoT / 40) % hqs.length]; R.cam.tx = g.grid.wx(h.node) + Math.cos(t * 3) * 4; R.cam.tz = g.grid.wz(h.node) + Math.sin(t * 3) * 3; R.cam.tyaw = Math.sin(t) * 0.5; }
    const ev = g.events.splice(0);
    R.frame(dt, ev);
    return;
  }
  if (app.state !== 'game') return;
  if (!app.paused && $('#modal').classList.contains('hidden')) {
    app.acc += dt * app.speed;
    let steps = 0;
    while (app.acc >= TICK && steps++ < 40) { g.update(TICK); app.acc -= TICK; }
    if (steps >= 40) app.acc = 0;
  }
  const ev = g.events.splice(0);
  app.ui.onEvents(ev);
  app.audio.onEvents(ev, g, app.me);
  // combat music mood
  if (ev.some(e => (e.type === 'attackLaunched' || e.type === 'fightStart') && (e.target === app.me || e.p === app.me))) app.warT = g.time;
  app.audio.setMood(app.warT && g.time - app.warT < 90 ? 'war' : 'peace');
  app.ui.tick(dt);
  R.frame(dt, ev);
  app.audio.listener = { x: R.cam.x, z: R.cam.z, dist: R.cam.dist };
  uiT += dt; mmT += dt; slowT += dt;
  if (uiT > 0.25) { uiT = 0; app.ui.refresh(); }
  if (mmT > 1) { mmT = 0; app.ui.drawMinimap(); }
  if (slowT > 1) {
    slowT = 0;
    app.audio.updateAmbience(1, viewMix(g, R));
    const r = checkMission(g, app.me);
    if (r.hint) app.ui.toast(r.hint, 'hint', -1, 14000);
    if (r.won) endGame(true); else if (r.lost || !g.players[app.me].alive) endGame(false);
  }
}
function viewMix(g, R) {
  const vb = R.viewBox(), gr = g.grid; let n = 0, grass = 0, water = 0, mt = 0;
  for (let k = 0; k < 60; k++) {
    const x = vb[0] + Math.random() * (vb[2] - vb[0]), z = vb[1] + Math.random() * (vb[3] - vb[1]);
    const i = gr.nearestNode(Math.max(0, Math.min(gr.w - 1, x)), Math.max(0, Math.min((gr.h - 1) * 0.866, z))); if (i < 0) continue;
    const t = g.map.terrain[i]; n++;
    if (t === 0) water++; else if (t === 5 || t === 6) mt++; else if (t <= 4) grass++;
  }
  n = Math.max(1, n);
  return { grass: grass / n, water: water / n, mountain: mt / n, winter: g.map.theme === 'winter' };
}

boot().catch((e) => { console.error(e); $('#load-text').textContent = 'Failed to start: ' + e.message; });
