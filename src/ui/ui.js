// In-game UI: S2-style windows, build menu, road building, minimap, input.
import { BUILDINGS, BUILD_MENU, WARES, WARE, TOOLS, JOBS, RANKS, SIZE_RANK, FOODS, TERRAIN as T } from '../sim/data.js';
import { iconURL } from '../render/icons.js';
import * as L from '../sim/logistics.js';
import { availableAttackers, canAttack, isMilitary } from '../sim/military.js';
import { CAMPAIGN, objectiveProgress } from '../sim/missions.js';
import { RES_NAMES } from '../sim/mapgen.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = (n, cls = 'ico') => `<img class="${cls}" src="${iconURL(n)}" alt="">`;
const fmtTime = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
const TERRAIN_COL = [[40, 90, 140], [86, 130, 50], [100, 140, 60], [150, 140, 80], [80, 110, 60], [120, 112, 100], [235, 240, 245], [200, 170, 110], [70, 80, 50], [210, 190, 140]];

export class UI {
  constructor(app) {
    this.app = app;
    this.wins = new Map();
    this.z = 30;
    this.road = null;
    this.toastsEl = $('#toasts');
    this.hoverNode = -1;
    this.bindStatic();
  }
  get game() { return this.app.game; }
  get me() { return this.app.me; }
  get R() { return this.app.renderer; }

  bindStatic() {
    for (const img of document.querySelectorAll('img[data-icon]')) img.src = iconURL(img.dataset.icon);
    document.querySelectorAll('#toolbar button').forEach(b => b.addEventListener('click', () => { this.app.audio.ui('click'); this.tool(b.dataset.tool); }));
    $('#speed').addEventListener('click', () => this.app.cycleSpeed());
    const mm = $('#minimap');
    const mmMove = (e) => { const r = mm.getBoundingClientRect(); const g = this.game.grid; const x = (e.clientX - r.left) / r.width * g.w, y = (e.clientY - r.top) / r.height * g.h; this.R.cam.tx = x; this.R.cam.tz = y * 0.866; this.R.clampCam(); };
    mm.addEventListener('mousedown', (e) => { mmMove(e); const mv = (ev) => mmMove(ev); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); });
  }

  // ------------------------------------------------------------------ toolbar
  tool(t) {
    switch (t) {
      case 'buildhelp': this.toggleBuildHelp(); break;
      case 'minimap': $('#minimap-wrap').classList.toggle('hidden'); break;
      case 'stock': this.toggleWin('stock', () => this.winStock()); break;
      case 'stats': this.toggleWin('stats', () => this.winStats()); break;
      case 'economy': this.toggleWin('economy', () => this.winEconomy()); break;
      case 'buildings': this.toggleWin('buildings', () => this.winBuildings()); break;
      case 'messages': this.toggleWin('messages', () => this.winMessages()); break;
      case 'menu': this.app.gameMenu(); break;
    }
  }
  toggleBuildHelp(v) {
    const w = this.R.world; w.buildHelp = v ?? !w.buildHelp;
    document.querySelector('#toolbar [data-tool=buildhelp]').classList.toggle('on', w.buildHelp);
  }

  // ------------------------------------------------------------------ windows
  toggleWin(id, open) { if (this.wins.has(id)) this.closeWin(id); else open(); }
  openWin(id, title, render, { x, y, live = true, width } = {}) {
    let w = this.wins.get(id);
    if (!w) {
      const el = document.createElement('div'); el.className = 'win';
      el.innerHTML = `<div class="wt"><span class="wtt"></span><div class="wx" title="Close">✕</div></div><div class="wb"></div>`;
      $('#windows').appendChild(el);
      const n = this.wins.size;
      el.style.left = (x ?? (70 + n * 26)) + 'px'; el.style.top = (y ?? (80 + n * 22)) + 'px';
      if (width) el.style.width = width + 'px';
      el.querySelector('.wx').onclick = () => { this.app.audio.ui('click'); this.closeWin(id); };
      el.addEventListener('mousedown', () => { el.style.zIndex = ++this.z; });
      dragWin(el);
      w = { el, render, live, title };
      this.wins.set(id, w);
    }
    w.render = render; w.live = live; w.el.style.zIndex = ++this.z;
    w.el.querySelector('.wtt').textContent = title;
    this.renderWin(id);
    // keep inside the viewport
    const r = w.el.getBoundingClientRect();
    if (r.right > innerWidth - 8) w.el.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 80) w.el.style.top = Math.max(8, innerHeight - r.height - 80) + 'px';
    return w;
  }
  renderWin(id) {
    const w = this.wins.get(id); if (!w) return;
    const body = w.el.querySelector('.wb');
    const st = body.scrollTop;
    const html = w.render(body);
    if (html === false) { this.closeWin(id); return; }
    if (typeof html === 'string') { if (html !== w.last) { body.innerHTML = html; w.last = html; wire(body, this); } }
    body.scrollTop = st;
  }
  closeWin(id) { const w = this.wins.get(id); if (!w) return; w.el.remove(); this.wins.delete(id); if (id.startsWith('b') && this.R.world) this.R.world.selected = 0; }
  closeAll() { for (const id of [...this.wins.keys()]) this.closeWin(id); }
  refresh() { for (const [id, w] of this.wins) if (w.live) this.renderWin(id); this.updateHud(); }

  // ------------------------------------------------------------------ HUD
  updateHud() {
    const g = this.game; if (!g) return;
    $('#clock').textContent = fmtTime(g.time);
    const pl = g.players[this.me];
    const unread = pl.messages.length - (this.readMsgs || 0);
    $('#msgcount').textContent = unread > 0 ? Math.min(99, unread) : '';
    const ms = g.missionState;
    const ob = $('#objectives');
    if (ms) {
      const ch = CAMPAIGN.find(c => c.id === ms.id);
      ob.classList.remove('hidden');
      ob.innerHTML = `<h3>${esc(ch.title)}</h3>` + ch.objectives.map((o, i) => { const [a, b] = objectiveProgress(g, this.me, o); return `<div class="obj ${ms.done[i] ? 'done' : ''}"><span>${esc(o.text)}</span><b>${Math.min(a, b)}/${b}</b></div>`; }).join('');
    } else ob.classList.add('hidden');
    const np = this.app.audio.musicPlayer; $('#nowplaying').textContent = np && np.running && this.app.audio.vol.music > 0 ? '♪ ' + (np.nowName || '') : '';
  }
  toast(text, kind = 'info', node = -1, ttl = 7000) {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
    if (node >= 0) el.onclick = () => { this.R.centerOn(node); };
    this.toastsEl.prepend(el);
    while (this.toastsEl.children.length > 6) this.toastsEl.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), ttl); setTimeout(() => el.remove(), ttl + 900);
  }
  onEvents(events) {
    for (const e of events) {
      if (e.type === 'msg' && e.p === this.me) this.toast(e.text, e.kind, e.node);
    }
  }

  // ------------------------------------------------------------------ minimap
  drawMinimap() {
    const g = this.game, cv = $('#minimap'); if (!g || cv.offsetParent === null) return;
    const gr = g.grid, W = gr.w, H = gr.h, ctx = cv.getContext('2d');
    if (!this.mmImg || this.mmImg.width !== W) { this.mmImg = ctx.createImageData(W, H); this.mmCv = document.createElement('canvas'); this.mmCv.width = W; this.mmCv.height = H; }
    const d = this.mmImg.data, m = g.map, pl = g.players[this.me], reveal = this.R.world && this.R.world.revealAll;
    const pc = g.players.map(p => [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255]);
    for (let i = 0; i < gr.n; i++) {
      let [r, gg, b] = TERRAIN_COL[m.terrain[i]];
      const sh = 0.75 + (m.height[i] - 8) * 0.03; r *= sh; gg *= sh; b *= sh;
      const o = m.obj[i];
      if (o && o.t === 'tree') { r *= 0.65; gg *= 0.8; b *= 0.6; }
      const ow = g.owner[i];
      if (ow) { const c = pc[ow - 1]; const k = g.isBorder(i) ? 0.8 : 0.28; r = r * (1 - k) + c[0] * k; gg = gg * (1 - k) + c[1] * k; b = b * (1 - k) + c[2] * k; }
      if (o && (o.t === 'bld' || o.t === 'foot')) { r = 250; gg = 245; b = 230; if (ow) { const c = pc[ow - 1]; r = c[0] * 0.5 + 125; gg = c[1] * 0.5 + 120; b = c[2] * 0.5 + 115; } }
      else if (o && o.t === 'flag' || g.roadAt[i]) { r = 190; gg = 160; b = 110; }
      if (!reveal) { if (!pl.explored[i]) { r = gg = b = 12; } else if (!pl.visible[i]) { r *= 0.6; gg *= 0.6; b *= 0.6; } }
      const k = i * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
    }
    this.mmCv.getContext('2d').putImageData(this.mmImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mmCv, 0, 0, cv.width, cv.height);
    // camera frustum
    const vb = this.R.viewBox(); const sx = cv.width / W, sy = cv.height / (H * 0.866);
    ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 1.5; ctx.strokeRect((vb[0] + 2) * sx, (vb[1] + 3) * sy, (vb[2] - vb[0] - 4) * sx, (vb[3] - vb[1] - 5) * sy);
  }

  // ------------------------------------------------------------------ input
  bindInput(canvas) {
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.app.audio.init();
      if (e.button === 2 || e.button === 1) { drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button }; return; }
      if (e.button === 0) this.clickAt(e.clientX, e.clientY, e);
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const k = this.R.cam.dist / innerHeight * 1.6;
        if (drag.btn === 1) this.R.rotate(-dx * 0.005);
        else this.R.pan(-dx * k, -dy * k * 1.4);
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (drag && drag.btn === 2 && !drag.moved) this.rightClick();
      drag = null;
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.R.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => { this.keys && this.keys.delete(e.code); });
    this.keys = new Set();
  }
  key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!this.game || this.app.state !== 'game') return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Space': e.preventDefault(); this.toggleBuildHelp(); break;
      case 'Escape': if (this.road) this.cancelRoad(); else if (this.wins.size) this.closeAll(); else this.app.gameMenu(); break;
      case 'KeyM': this.tool('minimap'); break;
      case 'KeyI': this.tool('stock'); break;
      case 'KeyT': this.tool('stats'); break;
      case 'KeyE': this.tool('economy'); break;
      case 'KeyB': this.tool('buildings'); break;
      case 'KeyN': this.tool('messages'); break;
      case 'KeyP': case 'Pause': this.app.togglePause(); break;
      case 'KeyH': { const hq = [...this.game.buildings.values()].find(b => b.owner === this.me && b.type === 'hq'); if (hq) this.R.centerOn(hq.node); break; }
      case 'Equal': case 'NumpadAdd': this.app.cycleSpeed(1); break;
      case 'Minus': case 'NumpadSubtract': this.app.cycleSpeed(-1); break;
      case 'Enter': if (this.road) this.finishRoad(); else if (this.app.mp) { e.preventDefault(); this.app.lobby.openChat(); } break;
      case 'F5': e.preventDefault(); this.app.quickSave(); break;
      case 'F9': e.preventDefault(); this.app.quickLoad(); break;
    }
  }
  // continuous keyboard pan/rotate (called every frame)
  tick(dt) {
    if (!this.keys || !this.R.game) return;
    const k = this.R.cam.dist * dt * 0.9;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.R.pan(0, -k);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.R.pan(0, k);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.R.pan(-k, 0);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.R.pan(k, 0);
    if (this.keys.has('KeyQ')) this.R.rotate(dt * 1.2);
    if (this.keys.has('KeyR')) this.R.rotate(-dt * 1.2);
    if (this.keys.has('PageUp')) this.R.zoom(1 - dt);
    if (this.keys.has('PageDown')) this.R.zoom(1 + dt);
    // hover
    if (this.mouse && this.app.state === 'game') {
      const el = document.elementFromPoint(this.mouse.x, this.mouse.y);
      if (el && el.id === 'view') {
        const p = this.R.pick(this.mouse.x, this.mouse.y);
        const n = p ? p.node : -1;
        if (n !== this.hoverNode) { this.hoverNode = n; this.onHover(n); }
      }
    }
  }

  onHover(n) {
    this.R.world.setHover(n);
    if (this.road && n >= 0) {
      const last = this.road.nodes[this.road.nodes.length - 1];
      if (n === last) { this.R.world.setPreview(this.road.nodes, true); return; }
      const path = L.findRoadPath(this.game, this.me, last, n, { max: 2500 });
      if (path && !path.slice(1).some(x => this.road.nodes.includes(x))) { this.road.preview = this.road.nodes.concat(path.slice(1)); this.R.world.setPreview(this.road.preview, true); }
      else { this.road.preview = null; this.R.world.setPreview(this.road.nodes, false); }
    }
  }

  rightClick() { if (this.road) this.cancelRoad(); else this.closeAll(); }

  clickAt(x, y) {
    const p = this.R.pick(x, y); if (!p) return;
    const n = p.node, g = this.game;
    if (this.road) { this.roadClick(n); return; }
    this.app.audio.ui('click');
    const b = g.buildingAt(n);
    if (b && (b.owner === this.me || this.visible(n))) { this.openBuilding(b); return; }
    const f = g.flagAt(n);
    if (f && f.owner === this.me) { this.openFlag(f); return; }
    if (f && this.visible(n)) { const fb = f.building && g.buildings.get(f.building); if (fb) this.openBuilding(fb); return; }
    const rid = g.roadAt[n];
    if (rid) { const r = g.roads.get(rid); if (r && r.owner === this.me) { this.openRoad(r, n); return; } }
    if (g.owner[n] === this.me + 1) { this.openAction(n); return; }
    // show node info (resources seen by geologists, terrain)
    const o = g.map.obj[n];
    if (o && o.t === 'sign') this.toast(`Geologist sign: ${o.r ? RES_NAMES[o.r] : 'nothing found'}${o.r ? ' (' + ['', 'little', 'some', 'plenty'][o.a] + ')' : ''}`, 'info', -1, 3500);
  }
  visible(n) { return this.R.world.revealAll || this.game.players[this.me].visible[n]; }

  // ------------------------------------------------------------------ road building
  startRoad(flagNode) {
    this.closeAll();
    this.road = { nodes: [flagNode], preview: null };
    $('#roadhint').classList.remove('hidden');
    this.R.world.setPreview(null);
  }
  roadClick(n) {
    const r = this.road, g = this.game;
    const last = r.nodes[r.nodes.length - 1];
    if (n === last && r.nodes.length > 1) { this.finishRoad(); return; }
    if (n === r.nodes[0] && r.nodes.length === 1) { this.cancelRoad(); return; }
    if (!r.preview || r.preview[r.preview.length - 1] !== n) { this.app.audio.ui('error'); return; }
    r.nodes = r.preview.slice(); r.preview = null;
    const f = g.flagAt(n);
    if (f && f.owner === this.me) { this.finishRoad(); return; }
    this.app.audio.ui('click');
    this.R.world.setPreview(r.nodes, true);
  }
  finishRoad() {
    const r = this.road; if (!r || r.nodes.length < 2) { this.cancelRoad(); return; }
    const nodes = r.nodes.slice();
    const v = L.validateRoad(this.game, this.me, nodes);
    if (v !== true) { this.toast('Cannot build road: ' + v, 'warn', -1, 3000); this.app.audio.ui('error'); return; }
    this.cancelRoad();
    this.app.cmd({ k: 'road', nodes }, (res) => { if (!res || !res.ok) { this.toast('Cannot build road: ' + (res ? res.reason : 'refused'), 'warn', -1, 3000); this.app.audio.ui('error'); } });
  }
  cancelRoad() { this.road = null; $('#roadhint').classList.add('hidden'); this.R.world.setPreview(null); }

  // ------------------------------------------------------------------ action window (empty own node)
  openAction(n) {
    const g = this.game, cap = g.buildCap(this.me, n);
    if (cap === 'none') { this.toast(g.isBorder(n) ? 'Cannot build on the border' : 'Nothing can be built here', 'info', -1, 2200); return; }
    const tabs = cap === 'mine' ? ['mine'] : cap === 'flag' ? [] : ['small', 'medium', 'large'].filter(s => SIZE_RANK[s] <= SIZE_RANK[cap]);
    let tab = this.lastTab && tabs.includes(this.lastTab) ? this.lastTab : tabs[tabs.length - 1];
    const pos = this.R.toScreen(n);
    const render = () => {
      let h = '';
      if (tabs.length > 1) h += `<div class="tabs">${tabs.map(t => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
      if (tab) {
        h += `<div class="grid-build">` + BUILD_MENU[tab].map(t => {
          const d = BUILDINGS[t], ok = g.canBuildType(this.me, n, t);
          const cost = Object.entries(d.cost).map(([w, c]) => `${c}${ico(w, '')}`).join(' ');
          return `<div class="bcard ${ok ? '' : 'dis'}" data-build="${t}" title="${esc(d.name)}${d.job ? ' — worker: ' + JOBS[d.job].name + (JOBS[d.job].tool ? ' (needs ' + WARE[JOBS[d.job].tool].name + ')' : '') : ''}"><img src="${this.app.portraits[t] || ''}"><div class="nm">${esc(d.name)}</div><div class="cost">${cost}</div></div>`;
        }).join('') + `</div>`;
      }
      const flagOk = g.canPlaceFlag(this.me, n) === true;
      h += `<div class="row" style="margin-top:8px">${flagOk ? `<button class="btn small" data-act="flag">${ico('bh_flag', 'ico s')} Place flag</button>` : ''}</div>`;
      return h;
    };
    const w = this.openWin('action', cap === 'flag' ? 'Flag' : 'Build', render, { x: Math.min(innerWidth - 400, pos.x + 30), y: Math.max(10, pos.y - 160), live: false, width: 380 });
    w.onAct = (a, el) => {
      if (a === 'tab') { tab = el.dataset.tab; this.lastTab = tab; w.last = null; this.renderWin('action'); return; }
      if (a === 'build') {
        if (!g.canBuildType(this.me, n, el.dataset.build)) { this.app.audio.ui('error'); return; }
        this.closeWin('action');
        this.app.cmd({ k: 'build', n, t: el.dataset.build }, (b) => {
          if (!b) { this.app.audio.ui('error'); return; }
          // S2: after placing a building you immediately lay its road
          const f = this.game.flags.get(b.flag);
          if (f && !f.roads.some(Boolean) && !this.road) this.startRoad(f.node);
        });
        return;
      }
      if (a === 'flag') {
        this.closeWin('action');
        this.app.cmd({ k: 'flag', n }, (f) => { if (f && !f.roads.some(Boolean) && !this.road) this.startRoad(f.node); });
      }
    };
  }

  // ------------------------------------------------------------------ flag window
  openFlag(f) {
    const g = this.game;
    const render = () => {
      if (!g.flags.has(f.id)) return false;
      let h = `<div class="row">${f.wares.length ? f.wares.map(wid => { const w = g.wares.get(wid); return w ? ico(w.type) : ''; }).join('') : '<span class="muted">No wares waiting</span>'}</div>`;
      const b = f.building && g.buildings.get(f.building);
      if (b) h += `<div class="row"><button class="btn small" data-act="openb">${esc(BUILDINGS[b.type].name)}…</button></div>`;
      h += `<div class="row" style="flex-wrap:wrap">
        <button class="btn small" data-act="road">${ico('road', 'ico s')} Build road</button>
        <button class="btn small" data-act="geo" title="Sends a geologist to search the area around this flag">${ico('geologist', 'ico s')} Geologist</button>
        <button class="btn small" data-act="scout" title="Sends a scout to explore around this flag">${ico('eye', 'ico s')} Scout</button>
        ${b && b.type === 'hq' ? '' : `<button class="btn small red" data-act="del">${ico('destroy', 'ico s')} Remove</button>`}</div>`;
      return h;
    };
    const pos = this.R.toScreen(f.node);
    const w = this.openWin('flag', 'Flag', render, { x: pos.x + 30, y: pos.y - 60, width: 330 });
    w.onAct = (a) => {
      if (a === 'road') this.startRoad(f.node);
      else if (a === 'geo') this.app.cmd({ k: 'geo', id: f.id }, (ok) => { if (!ok) this.toast('No geologist available (needs a helper and a hammer)', 'warn'); else this.app.audio.ui('click'); });
      else if (a === 'scout') this.app.cmd({ k: 'scout', id: f.id }, (ok) => { if (!ok) this.toast('No scout available', 'warn'); });
      else if (a === 'del') { this.app.cmd({ k: 'delFlag', id: f.id }); this.closeWin('flag'); }
      else if (a === 'openb') { const b = g.buildings.get(f.building); if (b) this.openBuilding(b); }
    };
  }

  openRoad(r, n) {
    const g = this.game;
    const render = () => {
      if (!g.roads.has(r.id)) return false;
      const c = r.carrier && g.settlers.get(r.carrier);
      let h = `<div class="row">${ico('carrier')} ${c ? (c.carry ? 'Carrier is carrying goods' : 'Carrier is waiting') : '<span class="muted">Waiting for a carrier…</span>'}</div>`;
      h += `<div class="row">${ico('donkey')} ${r.donkey ? 'Donkey helps on this busy road' : r.busy ? '<span class="muted">Busy road — a donkey is requested</span>' : '<span class="muted">Normal traffic</span>'}</div>`;
      h += `<div class="row">Length: ${r.nodes.length - 1} steps</div>`;
      const flagOk = g.canPlaceFlag(this.me, n) === true;
      h += `<div class="row">${flagOk ? `<button class="btn small" data-act="flag">${ico('bh_flag', 'ico s')} Place flag here</button>` : ''}<button class="btn small red" data-act="del">${ico('destroy', 'ico s')} Remove road</button></div>`;
      return h;
    };
    const pos = this.R.toScreen(n);
    const w = this.openWin('road', 'Road', render, { x: pos.x + 30, y: pos.y - 60, width: 300 });
    w.onAct = (a) => { if (a === 'flag') { this.app.cmd({ k: 'flag', n }); this.closeWin('road'); } else if (a === 'del') { this.app.cmd({ k: 'delRoad', id: r.id }); this.closeWin('road'); } };
  }

  // ------------------------------------------------------------------ building window
  openBuilding(b) {
    const g = this.game, id = 'b' + b.id;
    this.closeWin(id);
    this.R.world.selected = b.id;
    const def = BUILDINGS[b.type];
    let tab = 'main', attackN = 3;
    const render = () => {
      if (!g.buildings.has(b.id) || (b.owner !== this.me && !canAttack(g, this.me, b) && !isMilitary(b))) return false;
      const own = b.owner === this.me;
      let h = `<img class="portrait" src="${this.app.portraits[b.type] || ''}">`;
      h += `<div><b>${esc(def.name)}</b>${own ? '' : ` — <span style="color:#${g.players[b.owner].color.toString(16).padStart(6, '0')}">${esc(g.players[b.owner].name)}</span>`}</div>`;
      if (b.state === 'site') {
        const need = Object.values(def.cost).reduce((a, c) => a + c, 0);
        h += `<div class="row">Under construction</div><div class="row"><div class="meter"><div style="width:${Math.round(b.site.progress * 100)}%"></div></div>${Math.round(b.site.progress * 100)}%</div>`;
        for (const [w, c] of Object.entries(def.cost)) h += `<div class="row">${ico(w, 'ico s')} ${(b.site.have[w] || 0) + (b.site.used[w] || 0)} / ${c} delivered</div>`;
        const bl = b.site.builder && g.settlers.get(b.site.builder);
        h += `<div class="row muted">${!bl ? 'Waiting for a builder' : !b.site.leveled ? 'The builder is levelling the ground' : 'The builder is at work'}</div>`;
        if (!g.flags.get(b.flag).roads.some(Boolean)) h += `<div class="row" style="color:#a8352a">⚠ Not connected to a road</div>`;
      } else if (own) {
        h += this.buildingBody(b, tab);
      } else {
        h += this.enemyBody(b, attackN);
      }
      h += `<div style="clear:both"></div>`;
      if (own && b.type !== 'hq') {
        h += `<div class="row" style="margin-top:8px">`;
        if (b.state === 'done' && def.job && def.kind !== 'lookout') h += `<button class="btn small" data-act="stop">${ico(b.stopped ? 'play' : 'stop', 'ico s')} ${b.stopped ? 'Resume' : 'Stop'} production</button>`;
        h += `<button class="btn small red" data-act="destroy">${ico('destroy', 'ico s')} Destroy</button></div>`;
      }
      return h;
    };
    const pos = this.R.toScreen(b.node);
    const w = this.openWin(id, def.name, render, { x: Math.min(innerWidth - 420, pos.x + 40), y: Math.max(10, pos.y - 150), width: 400 });
    w.onAct = (a, el) => {
      if (a === 'destroy') { if (confirm(`Destroy the ${def.name}?`)) { this.app.cmd({ k: 'delBld', id: b.id }); this.closeWin(id); } }
      else if (a === 'stop') { this.app.cmd({ k: 'stop', id: b.id, v: !b.stopped }, () => { if (this.wins.has(id)) { w.last = null; this.renderWin(id); } }); }
      else if (a === 'tab') { tab = el.dataset.tab; }
      else if (a === 'attackN') { attackN = +el.value; }
      else if (a === 'attack') {
        this.closeWin(id);
        this.app.cmd({ k: 'attack', id: b.id, n: attackN }, (n) => {
          if (n) { this.toast(`${n} soldier${n > 1 ? 's' : ''} sent to attack`, 'war', b.node, 3000); this.app.audio.play('horn', 0.5); }
          else this.toast('No soldiers available in range', 'warn');
        });
        return;
      }
      w.last = null; this.renderWin(id);
    };
  }

  buildingBody(b, tab) {
    const g = this.game, def = BUILDINGS[b.type];
    let h = '';
    if (def.kind === 'warehouse') {
      h += `<div class="tabs" style="clear:none">${['wares', 'people', 'soldiers'].map(t => `<button data-tab="${t}" class="${(tab === 'main' ? 'wares' : tab) === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
      const t = tab === 'main' ? 'wares' : tab;
      if (t === 'wares') h += `<div class="stock" style="clear:both">${WARES.map(w => `<div class="it ${b.stock[w.id] ? '' : 'zero'}" title="${w.name}"><img src="${iconURL(w.id)}">${b.stock[w.id] || 0}</div>`).join('')}</div>`;
      else if (t === 'people') h += `<div class="list" style="clear:both">${Object.entries(JOBS).filter(([k]) => k !== 'soldier').map(([k, j]) => `<div class="li">${esc(j.name)}<span style="margin-left:auto"><b>${b.people[k] || 0}</b></span></div>`).join('')}</div>`;
      else h += `<div class="list" style="clear:both">${RANKS.map((r, i) => `<div class="li">${ico('soldier', 'ico s')} ${r.name}<span style="margin-left:auto"><b>${b.ranks[i] || 0}</b></span></div>`).join('')}</div>` + (b.type === 'hq' ? `<div class="row muted">Soldiers kept in reserve for defence: ${g.players[this.me].hqReserve ?? 3} (Economy → Military)</div>` : '');
      return h;
    }
    if (def.kind === 'military') {
      h += `<div class="row">${b.occupied ? 'Occupied' : '<span class="muted">Waiting for soldiers…</span>'} · ${b.soldiers.length}/${def.soldiers}</div>`;
      h += `<div class="row">${ico('coins', 'ico s')} ${(b.inputs.coins || 0)} / ${def.coins} coins ${g.players[this.me].promote ? '' : '<span class="muted">(promotion disabled)</span>'}</div>`;
      h += `<div class="soldiers">${b.soldiers.map(sid => { const s = g.settlers.get(sid); if (!s) return ''; const mx = RANKS[s.rank].hp * 4; return `<div class="sold" title="${RANKS[s.rank].name}">${ico('soldier', '')}<div>${['I', 'II', 'III', 'IV', 'V'][s.rank]}</div><div class="hpbar"><div style="width:${Math.round(s.hp / mx * 100)}%"></div></div></div>`; }).join('')}</div>`;
      if (b.underAttack) h += `<div class="row" style="color:#a8352a"><b>⚔ Under attack!</b></div>`;
      return h;
    }
    // workers / production
    const wk = b.worker && g.settlers.get(b.worker);
    const job = def.job && JOBS[def.job];
    if (job) {
      let st = !wk ? `<span class="muted">No ${job.name.toLowerCase()} available${job.tool ? ` — needs a ${WARE[job.tool].name.toLowerCase()} (metalworks)` : ''}</span>` : wk.inside ? `${job.name} at work` : wk.state === 'toWork' || wk.state === 'enterWork' ? `${job.name} is on the way` : `${job.name} is outside`;
      h += `<div class="row">${st}</div>`;
    }
    if (b.prod && b.prod.length > 5) { const p = Math.round(b.prod.reduce((a, c) => a + c, 0) / b.prod.length * 100); h += `<div class="row">Productivity <div class="meter ${p < 40 ? 'red' : ''}"><div style="width:${p}%"></div></div><b>${p}%</b></div>`; }
    if (def.inputs) {
      for (const [w, cap] of Object.entries(def.inputs)) {
        if (w === 'food') { const n = FOODS.reduce((a, f) => a + (b.inputs[f] || 0), 0); h += `<div class="row">${FOODS.map(f => ico(f, 'ico s')).join('')} <div class="meter"><div style="width:${n / cap * 100}%"></div></div> ${n}/${cap}</div>`; }
        else h += `<div class="row">${ico(w, 'ico s')} ${WARE[w].name} <div class="meter"><div style="width:${(b.inputs[w] || 0) / cap * 100}%"></div></div> ${b.inputs[w] || 0}/${cap}</div>`;
      }
    }
    if (def.out || def.outs) h += `<div class="row">Produces: ${(def.outs || [def.out]).map(o => o === 'tool' ? 'tools' : o === 'donkey' ? ico('donkey', 'ico s') : ico(o, 'ico s')).join(' ')}</div>`;
    if (def.kind === 'mine') {
      let left = 0; const want = { coal: 1, iron: 2, gold: 3, granite: 4 }[def.res];
      for (const j of g.grid.within(b.node, 2)) if (g.map.res[j] === want) left += g.map.resAmt[j];
      h += `<div class="row ${left < 8 ? '' : 'muted'}">Resources left in the mountain: ~${left}</div>`;
    }
    if (def.kind === 'forester') h += `<div class="row muted">Plants trees within ${def.range} steps.</div>`;
    if (def.kind === 'lookout') h += `<div class="row muted">Watches the land far around.</div>`;
    return h;
  }

  enemyBody(b, attackN) {
    const g = this.game, def = BUILDINGS[b.type];
    let h = '';
    if (isMilitary(b)) {
      const vis = this.visible(b.node);
      h += `<div class="row">${vis ? `Garrison: ${b.soldiers.length || (b.people ? b.people.soldier : 0)} soldiers` : 'Garrison unknown'}</div>`;
      if (canAttack(g, this.me, b)) {
        const av = availableAttackers(g, this.me, b).length;
        if (!av) h += `<div class="row muted" style="clear:both">None of your garrisons is close enough, or they have no soldiers to spare.</div>`;
        else {
          const n = Math.min(attackN, av);
          h += `<div class="row" style="clear:both">${ico('swords')} Attack with <input type="range" min="1" max="${av}" value="${n}" data-act="attackN"> <b>${n}</b> / ${av}</div>`;
          h += `<div class="row"><button class="btn red" data-act="attack">⚔ Attack!</button></div>`;
        }
      }
    }
    return h;
  }

  // ------------------------------------------------------------------ overview windows
  winStock() {
    const g = this.game;
    this.openWin('stock', 'Inventory', () => {
      const st = g.totalStock(this.me);
      let h = `<div class="stock">${WARES.map(w => `<div class="it ${st.wares[w.id] ? '' : 'zero'}" title="${w.name}"><img src="${iconURL(w.id)}">${st.wares[w.id] || 0}</div>`).join('')}</div>`;
      let out = 0; const byJob = {};
      for (const s of g.settlers.values()) if (s.owner === this.me) { byJob[s.job] = (byJob[s.job] || 0) + 1; out++; }
      h += `<h4 style="margin:10px 0 4px;font-family:Cinzel">Population</h4><div class="list">` + Object.entries(JOBS).map(([k, j]) => { const a = st.people[k] || 0, b = byJob[k] || 0; return a + b ? `<div class="li">${esc(j.name)}<span style="margin-left:auto">${a} in store · ${b} at work</span></div>` : ''; }).join('') + '</div>';
      return h;
    }, { width: 430, x: 60, y: 70 });
  }

  winStats() {
    let metric = 'land';
    const g = this.game;
    const labels = { land: 'Land', bld: 'Buildings', mil: 'Military strength', pop: 'Population', goods: 'Goods in store', prod: 'Productivity %' };
    const w = this.openWin('stats', 'Statistics', (body) => {
      const h = `<div class="tabs">${Object.entries(labels).map(([k, v]) => `<button data-tab="${k}" class="${k === metric ? 'on' : ''}">${v}</button>`).join('')}</div><canvas class="chart" width="520" height="190"></canvas>
        <div class="legend">${g.players.map(p => `<span style="--c:#${p.color.toString(16).padStart(6, '0')}">${esc(p.name)}${p.alive ? '' : ' †'}</span>`).join('')}</div>
        <h4 style="margin:10px 0 4px;font-family:Cinzel">Produced so far</h4><div class="stock">${WARES.filter(x => g.players[this.me].produced[x.id]).map(x => `<div class="it" title="${x.name}"><img src="${iconURL(x.id)}">${g.players[this.me].produced[x.id]}</div>`).join('') || '<span class="muted">Nothing yet</span>'}</div>
        <div class="row" style="margin-top:6px">Enemies defeated in battle: <b>${g.players[this.me].killed}</b> · soldiers lost: <b>${g.players[this.me].lost}</b></div>`;
      queueMicrotask(() => { const cv = w.el.querySelector('canvas'); if (cv) drawChart(cv, g, metric, this.me); });
      return h;
    }, { width: 560, x: 80, y: 60 });
    w.onAct = (a, el) => { if (a === 'tab') { metric = el.dataset.tab; w.last = null; this.renderWin('stats'); } };
  }

  winEconomy() {
    const g = this.game, pl = g.players[this.me];
    let tab = 'transport';
    const w = this.openWin('economy', 'Economy', () => {
      let h = `<div class="tabs">${['transport', 'tools', 'military'].map(t => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
      if (tab === 'transport') {
        h += `<div class="muted">Carriers pick up wares higher in this list first.</div><div class="list">` + pl.transport.map((t, i) => `<div class="li">${ico(t, 'ico s')} ${WARE[t].name}<span style="margin-left:auto"><button class="btn small" data-act="up" data-i="${i}">▲</button><button class="btn small" data-act="down" data-i="${i}">▼</button></span></div>`).join('') + '</div>';
      } else if (tab === 'tools') {
        const d = pl.toolDemand;
        h += `<div class="muted">The metalworks makes tools that are missing first, then follows these weights.</div>` + TOOLS.map(t => `<div class="row sp">${ico(t, 'ico s')} <span style="flex:1">${WARE[t].name}${d[t] > 0.5 ? ' <b style="color:#a8352a">needed</b>' : ''}</span><input type="range" min="0" max="10" value="${pl.toolPrio[t]}" data-act="tool" data-t="${t}"></div>`).join('');
      } else {
        h += `<div class="form" style="grid-template-columns:200px 1fr">
          <span>Garrison strength</span><span><input type="range" min="1" max="10" value="${Math.round(pl.occupancy * 10)}" data-act="occ"> ${Math.round(pl.occupancy * 100)}%</span>
          <span>Soldiers kept at home when attacking</span><span><input type="range" min="1" max="4" value="${pl.attackReserve}" data-act="reserve"> ${pl.attackReserve}</span>
          <span>Defenders kept in headquarters</span><span><input type="range" min="0" max="20" value="${pl.hqReserve ?? 3}" data-act="hqres"> ${pl.hqReserve ?? 3}</span>
          <span>Send strongest soldiers first</span><span><input type="checkbox" ${pl.sendStrong ? 'checked' : ''} data-act="strong"></span>
          <span>Promote with gold coins</span><span><input type="checkbox" ${pl.promote ? 'checked' : ''} data-act="promote"></span></div>`;
      }
      return h;
    }, { width: 420, x: 100, y: 70, live: false });
    const redraw = () => { if (this.wins.has('economy')) { w.last = null; this.renderWin('economy'); } };
    const mil = (key, v) => this.app.cmd({ k: 'military', key, v }, redraw);
    w.onAct = (a, el) => {
      const i = +el.dataset.i;
      if (a === 'tab') tab = el.dataset.tab;
      else if (a === 'up') this.app.cmd({ k: 'transport', i, d: -1 }, redraw);
      else if (a === 'down') this.app.cmd({ k: 'transport', i, d: 1 }, redraw);
      else if (a === 'tool') this.app.cmd({ k: 'tool', t: el.dataset.t, v: +el.value }, redraw);
      else if (a === 'occ') mil('occupancy', +el.value);
      else if (a === 'reserve') mil('attackReserve', +el.value);
      else if (a === 'hqres') mil('hqReserve', +el.value);
      else if (a === 'strong') mil('sendStrong', el.checked);
      else if (a === 'promote') mil('promote', el.checked);
      redraw();
    };
  }

  winBuildings() {
    const g = this.game;
    this.cycleIdx = this.cycleIdx || {};
    const w = this.openWin('buildings', 'Buildings', () => {
      const c = {};
      for (const b of g.buildings.values()) if (b.owner === this.me) { const e = c[b.type] = c[b.type] || [0, 0]; e[b.state === 'done' ? 0 : 1]++; }
      return `<div class="grid-build">` + Object.keys(BUILDINGS).filter(t => c[t]).map(t => `<div class="bcard" data-act="goto" data-t="${t}" title="Click to cycle through them"><img src="${this.app.portraits[t] || ''}" style="width:56px;height:56px"><div class="nm">${esc(BUILDINGS[t].name)}</div><div class="cost">${c[t][0]}${c[t][1] ? ` <span class="muted">(+${c[t][1]})</span>` : ''}</div></div>`).join('') + `</div>`;
    }, { width: 420, x: 90, y: 60 });
    w.onAct = (a, el) => {
      if (a !== 'goto') return;
      const t = el.dataset.t, list = [...g.buildings.values()].filter(b => b.owner === this.me && b.type === t);
      if (!list.length) return;
      const i = (this.cycleIdx[t] = ((this.cycleIdx[t] ?? -1) + 1) % list.length);
      this.R.centerOn(list[i].node);
    };
  }

  winMessages() {
    const g = this.game, pl = g.players[this.me];
    this.readMsgs = pl.messages.length;
    const w = this.openWin('messages', 'Messages', () => {
      this.readMsgs = pl.messages.length;
      return `<div class="list">` + pl.messages.slice().reverse().map((m, i) => `<div class="li ${m.node >= 0 ? 'link' : ''}" data-act="goto" data-n="${m.node}"><span style="color:${m.kind === 'war' ? '#a8352a' : m.kind === 'goal' ? '#4f7a2a' : 'inherit'}">${esc(m.text)}</span><span class="muted" style="margin-left:auto">${fmtTime(m.time)}</span></div>`).join('') + (pl.messages.length ? '' : '<span class="muted">No messages</span>') + '</div>';
    }, { width: 420, x: 120, y: 90 });
    w.onAct = (a, el) => { const n = +el.dataset.n; if (n >= 0) this.R.centerOn(n); };
  }
}

// ------------------------------------------------------------------ helpers
function wire(body, ui) {
  const w = [...ui.wins.values()].find(x => x.el.contains(body));
  body.querySelectorAll('[data-act],[data-tab],[data-build]').forEach(el => {
    const handler = (ev) => {
      if (!w || !w.onAct) return;
      if (el.dataset.tab) w.onAct('tab', el);
      else if (el.dataset.build) w.onAct('build', el);
      else w.onAct(el.dataset.act, el, ev);
    };
    if (el.tagName === 'INPUT') el.addEventListener(el.type === 'range' ? 'input' : 'change', handler);
    else el.addEventListener('click', (ev) => { ui.app.audio.ui('click'); handler(ev); });
  });
}
function dragWin(el) {
  const t = el.querySelector('.wt');
  t.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('wx')) return;
    const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
    const mv = (ev) => { el.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 30, ev.clientY - oy)) + 'px'; };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
}
function drawChart(cv, g, metric, me) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const series = g.players.map(p => p.stats.map(s => s[metric]));
  let max = 1, n = 0; for (const s of series) { for (const v of s) max = Math.max(max, v); n = Math.max(n, s.length); }
  ctx.strokeStyle = 'rgba(90,58,28,.25)'; ctx.lineWidth = 1; ctx.font = '11px Alegreya, serif'; ctx.fillStyle = '#6b4a26';
  for (let k = 0; k <= 4; k++) { const y = H - 16 - (H - 26) * k / 4; ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 6, y); ctx.stroke(); ctx.fillText(Math.round(max * k / 4), 2, y + 4); }
  if (n < 2) { ctx.fillText('Collecting data…', W / 2 - 40, H / 2); return; }
  g.players.forEach((p, i) => {
    const s = series[i]; if (s.length < 2) return;
    ctx.strokeStyle = '#' + p.color.toString(16).padStart(6, '0'); ctx.lineWidth = i === me ? 3 : 2; ctx.beginPath();
    s.forEach((v, k) => { const x = 30 + (W - 36) * k / (n - 1), y = H - 16 - (H - 26) * v / max; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  });
  const t1 = g.players[0].stats.at(-1)?.t || 0; ctx.fillText(fmtTime(t1), W - 44, H - 2); ctx.fillText('0:00', 30, H - 2);
}
export { fmtTime, esc, ico };
