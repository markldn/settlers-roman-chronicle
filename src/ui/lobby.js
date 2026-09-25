// Multiplayer screens, which are also the front door of the site. A short assistant takes a new
// player through it: name → join a game or host one → (host) world size → landscape → computer
// opponents → name the game. Then the game room (players, settings, invite link, room chat) and,
// once the game runs, the in-game chat and the list of players.
import { NATIONS, PLAYER_COLORS } from '../sim/data.js';
import { MAX_PLAYERS, MP_DEFAULTS } from '../sim/missions.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const clock = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const AI_NAMES = ['Brennus', 'Ambiorix', 'Sigrid', 'Taharqa', 'Yoritomo', 'Ragnar'];

const SIZES = [
  ['small', 'Small', '56 × 56', 'A quick game for 2–3 realms', 0.45],
  ['medium', 'Medium', '80 × 72', 'The usual choice, up to 4 realms', 0.62],
  ['large', 'Large', '112 × 100', 'A long game, room for 6', 0.8],
  ['huge', 'Huge', '144 × 128', 'An epic that takes hours', 1],
];
const THEMES = [
  ['greenland', 'Greenland', 'Meadows, forests and rivers', 'linear-gradient(135deg, #6f9a3c, #3f6d2a 55%, #2f5f8a)'],
  ['winter', 'Winter world', 'Snow, ice and dark pines', 'linear-gradient(135deg, #f2f5f8, #b9c8d6 55%, #4d6478)'],
  ['wasteland', 'Wasteland', 'Sand, rock and palms', 'linear-gradient(135deg, #e3c68a, #b8864a 55%, #6b4a2a)'],
];
const LAYOUTS = [['continent', 'Continent'], ['lakes', 'Lakes'], ['valley', 'River valley'], ['islands', 'Islands'], ['pass', 'Mountain pass']];
const SKILLS = [['easy', 'Easy', 'Builds slowly, rarely attacks'], ['normal', 'Normal', 'A fair opponent'], ['hard', 'Hard', 'Expands fast and attacks early']];
const STARTS = [['low', 'Few'], ['normal', 'Normal'], ['high', 'Many']];
const label = (list, v) => (list.find(x => x[0] === v) || [])[1] || v;
const HOST_STEPS = ['World', 'Landscape', 'Opponents', 'Open'];

// the full form behind "Change settings" in the room
const SETTINGS_FORM = [
  ['size', 'Map size', 'select', SIZES.map(([v, n, d]) => [v, `${n} (${d})`])],
  ['theme', 'Landscape', 'select', THEMES.map(([v, n]) => [v, n])],
  ['layout', 'Layout', 'select', LAYOUTS],
  ['mountains', 'Mountains', 'range'], ['forest', 'Forests', 'range'], ['water', 'Water', 'range'],
  ['ai', 'Computer players', 'select', null],
  ['aiLevel', 'Computer skill', 'select', SKILLS.map(([v, n]) => [v, n])],
  ['aiTeam', 'Computers allied', 'check'],
  ['start', 'Starting goods', 'select', STARTS],
  ['seed', 'Map seed', 'number'],
];

export function describeSettings(st) {
  const s = Object.assign({}, MP_DEFAULTS, st || {});
  const ai = s.ai | 0;
  return [
    `${label(SIZES, s.size)} map`, label(THEMES, s.theme), label(LAYOUTS, s.layout),
    ai ? `${ai} computer${ai > 1 ? 's' : ''} (${label(SKILLS, s.aiLevel).toLowerCase()}${s.aiTeam && ai > 1 ? ', allied' : ''})` : 'no computers',
    `${label(STARTS, s.start).toLowerCase()} starting goods`,
  ];
}

export class Lobby {
  constructor(app) {
    this.app = app;
    this.el = $('#lobby');
    this.rooms = []; this.people = []; this.online = 0;
    this.room = null; // the room we sit in
    this.logs = { lobby: [], room: [] };
    this.bound = false;
    this.step = null; // name | choose | host | room
    this.hostStep = 0;
    this.draft = Object.assign({}, MP_DEFAULTS, { ai: 1 }, store.get('settlers.mp.draft') || {}, { seed: 0 });
    this.advanced = false;
    const m = /#join=([0-9a-f]{8})/.exec(location.hash);
    this.pendingJoin = m ? m[1] : null;
  }
  get net() { return this.app.net; }
  get inRoom() { return !!this.room; }
  mySeat() {
    if (!this.room) return null;
    const mp = this.app.mp;
    if (mp && this.room.state === 'playing') return this.room.seats.find(s => s.slot === mp.slot) || null;
    return this.room.seats.find(s => this.net.me && s.id === this.net.me.id) || null;
  }
  isHost() { const s = this.mySeat(); return !!(s && this.room && this.room.hostId === s.id); }
  saveDraft() { const d = Object.assign({}, this.draft); delete d.roomName; store.set('settlers.mp.draft', d); }

  // ------------------------------------------------------------------ wiring
  bind() {
    if (this.bound) return; this.bound = true;
    const net = this.net;
    net.on('status', () => { this.renderStatus(); if (this.step === 'choose') this.renderRooms(); });
    net.on('welcome', (m) => { this.online = m.online; this.renderStatus(); });
    net.on('lobby', (m) => {
      this.rooms = m.rooms; this.people = m.people; this.online = m.online;
      if (this.room && !this.app.mp) { this.room = null; this.logs.room = []; this.go('choose'); }
      this.renderStatus(); this.renderRooms(); this.renderPeople();
      this.tryPendingJoin();
      if (this.app.mp && !this.app.mp.offlineOffered) this.app.mpLost('The server no longer knows this game (it may have restarted).');
    });
    net.on('room', (m) => {
      const first = !this.room;
      this.room = m.room;
      if (first) { this.advanced = false; this.go('room'); } else this.renderRoom();
      this.renderRoster();
    });
    net.on('left', (m) => {
      const was = this.room; this.room = null; this.logs.room = [];
      if (this.app.mp) { this.app.mpLost(m.reason === 'closed' ? 'The game was closed.' : 'You are no longer in this game.'); return; }
      this.go('choose');
      if (was && m.reason === 'kicked') this.flash('The host removed you from the game.');
      if (was && m.reason === 'closed') this.flash('That game was closed.');
    });
    net.on('chatlog', (m) => { this.logs[m.scope] = m.lines.slice(-80); this.renderLog(); this.renderGameChat(); });
    net.on('chat', (m) => {
      const log = this.logs[m.scope]; log.push(m.line); if (log.length > 80) log.shift();
      this.renderLog();
      if (m.scope === 'room') this.renderGameChat(m.line);
      if (!m.line.sys && m.line.from !== this.net.name) this.app.audio.ui('click');
    });
    net.on('error', (m) => { this.flash(m.text); if (this.step !== 'room' && !this.room) this.go('choose'); });

    $('#lb-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#lb-input'); this.say(i.value); i.value = ''; });
    // Enter moves the assistant on (except while typing a chat line or choosing from a list)
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.id === 'lb-input' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      const b = $('#lb-foot [data-primary]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
    });
    $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); this.say(i.value); i.value = ''; this.closeChat(); });
    $('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); } e.stopPropagation(); });
    $('#chat-input').addEventListener('keyup', (e) => e.stopPropagation());
  }

  open() {
    this.bind();
    $('#title').classList.add('hidden');
    this.el.classList.remove('hidden');
    this.net.connect();
    this.go(this.room ? 'room' : this.net.named ? 'choose' : 'name');
  }
  close() { this.el.classList.add('hidden'); }
  // to the single player menu
  back() {
    if (this.room) this.net.send('leave');
    this.room = null;
    this.close();
    this.net.disconnect();
    this.app.showTitle();
  }
  go(step) { this.step = step; this.render(); }
  flash(text) {
    this.flashText = text; clearTimeout(this.flashT);
    this.flashT = setTimeout(() => { this.flashText = null; const f = $('#lb-flash'); if (f) f.remove(); }, 7000);
    const main = $('#lb-main'); if (!main) return;
    const old = $('#lb-flash'); if (old) old.remove();
    main.insertAdjacentHTML('afterbegin', `<div class="lb-flash" id="lb-flash">${esc(text)}</div>`);
  }
  notice(text) { this.logs[this.room ? 'room' : 'lobby'].push({ from: '', text, t: Date.now(), sys: true, local: true }); this.renderLog(); }
  say(text) { text = String(text || '').trim(); if (text) this.net.send('chat', { text: text.slice(0, 300) }); }

  // an invite link (#join=<room>) joins that game as soon as the player has a name and is online
  tryPendingJoin() {
    if (!this.pendingJoin || this.step === 'name' || this.room || this.net.status !== 'online') return;
    const id = this.pendingJoin; this.pendingJoin = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    this.net.send('join', { room: id });
  }

  // ------------------------------------------------------------------ rendering
  render() {
    if (this.el.classList.contains('hidden') || !this.step) return;
    const wide = this.step === 'choose' || this.step === 'room';
    const box = $('.lobby-box', this.el);
    box.classList.toggle('wide', wide); box.classList.toggle('narrow', !wide);
    this.el.classList.toggle('in-room', this.step === 'room');
    $('#lb-side').classList.toggle('hidden', !wide);
    const main = $('#lb-main'), foot = $('#lb-foot');
    const heading = { name: 'Welcome', choose: 'Multiplayer', host: 'Host a new game', room: 'Game room' }[this.step];
    $('#lb-heading').textContent = heading;
    if (this.step === 'name') this.renderName(main, foot);
    else if (this.step === 'choose') this.renderChoose(main, foot);
    else if (this.step === 'host') this.renderHost(main, foot);
    else if (this.step === 'room' && this.room) this.renderRoomView(main, foot);
    if (this.flashText) this.flash(this.flashText);
    $('#lb-chat-title').textContent = this.room ? 'Room chat' : 'Lobby chat';
    this.renderLog(); this.renderPeople(); this.renderStatus();
    const focus = $('[data-focus]', main); if (focus) setTimeout(() => { focus.focus(); if (focus.select) focus.select(); }, 30);
  }

  footer(left, right) {
    const foot = $('#lb-foot');
    foot.innerHTML = `<div class="lb-foot-l">${left}</div><div class="lb-foot-r">${right}</div>`;
    return foot;
  }
  singleLink() { return `<button class="btn small ghost" data-act="single" title="Play alone, the campaign, or load a saved game">Single player &amp; campaign</button>`; }
  wireFoot(handlers) {
    $('#lb-foot').querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      this.app.audio.ui('click');
      const a = b.dataset.act;
      if (a === 'single') this.back();
      else if (handlers[a]) handlers[a]();
    });
  }

  renderName(main) {
    main.innerHTML = `<div class="wz">
      <div class="wz-q">Ave! What shall we call you?</div>
      <p class="wz-sub">Other players see this name in the lobby, in the chat and on your realm.</p>
      <input type="text" class="wz-input" id="wz-name" maxlength="20" value="${esc(this.net.named ? this.net.name : '')}" placeholder="${esc(this.net.name)}" autocomplete="nickname" data-focus>
      <p class="wz-sub small">Settlers is a building game in the spirit of <i>The Settlers II</i>: grow an economy, carry every ware by hand, and push your borders with soldiers. Play together with up to 6 people, with or without computer opponents.</p></div>`;
    this.footer(this.singleLink(), `<button class="btn green" data-act="next" data-primary>Continue</button>`);
    this.wireFoot({
      next: () => {
        const v = $('#wz-name').value.trim() || this.net.name;
        this.net.setName(v);
        this.go('choose');
        this.tryPendingJoin();
      },
    });
  }

  renderChoose(main) {
    main.innerHTML = `<div class="wz-q small">Welcome, ${esc(this.net.name)}. What would you like to do?</div>
      <button class="lb-big" id="lb-host"><span class="lb-big-i">⚑</span><span><b>Host a new game</b><span>Choose a world and opponents in four quick steps. Then invite friends, or start right away.</span></span></button>
      <h3 class="lb-h3">…or join an open game</h3>
      <div class="lb-rooms" id="lb-rooms"></div>`;
    $('#lb-host').onclick = () => { this.app.audio.ui('click'); this.hostStep = 0; this.draft.roomName = ''; this.go('host'); };
    this.footer(this.singleLink(), `<button class="btn small" data-act="rename">Change name</button>`);
    this.wireFoot({ rename: () => this.go('name') });
    this.renderRooms();
  }

  renderRooms() {
    const el = $('#lb-rooms'); if (!el || this.step !== 'choose') return;
    if (this.net.status === 'offline') {
      el.innerHTML = `<div class="muted lb-empty">The multiplayer server does not answer. Multiplayer needs the hosted version of the game (or <code>npm run dev-server</code> when running it yourself). You can still play alone: <b>Single player &amp; campaign</b>, below.</div>`;
      return;
    }
    if (this.net.status !== 'online') { el.innerHTML = `<div class="muted lb-empty">Connecting…</div>`; return; }
    const open = this.rooms.filter(r => r.state === 'lobby' && r.players < r.max), busy = this.rooms.filter(r => !open.includes(r));
    let h = open.length ? '' : `<div class="muted lb-empty">Nobody is waiting for players right now. Host a game and others can join you here.</div>`;
    h += open.map(r => `<div class="lb-room">
      <div class="lb-rn"><b>${esc(r.name)}</b><span class="muted">hosted by ${esc(r.host)} · ${esc(describeSettings(r.settings).slice(0, 2).concat(describeSettings(r.settings)[3]).join(' · '))}</span></div>
      <div class="lb-rp" title="Players">${r.players}/${r.max}</div>
      <button class="btn small green" data-join="${esc(r.id)}">Join</button></div>`).join('');
    if (busy.length) h += `<div class="lb-busy muted">${busy.length} game${busy.length > 1 ? 's' : ''} in progress: ${busy.map(r => esc(r.name)).join(', ')}</div>`;
    el.innerHTML = h;
    el.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { this.app.audio.ui('click'); this.net.send('join', { room: b.dataset.join }); });
  }

  // ------------------------------------------------------------------ the host assistant
  renderHost(main) {
    const d = this.draft, k = this.hostStep;
    const steps = `<div class="wz-steps">${HOST_STEPS.map((s, i) => `<span class="${i === k ? 'on' : i < k ? 'done' : ''}" data-step="${i}">${i < k ? '✓ ' : `${i + 1}. `}${s}</span>`).join('')}</div>`;
    let h = '';
    if (k === 0) {
      h = `<div class="wz-q">How big should the world be?</div><p class="wz-sub">Bigger worlds take longer to fill and leave more room between the realms.</p>
        <div class="wz-cards four">${SIZES.map(([v, n, dim, hint, sc]) => `<button class="wz-card ${d.size === v ? 'on' : ''}" data-pick="size" data-v="${v}">
          <span class="wz-map" style="--s:${sc}"></span><b>${n}</b><span class="dim">${dim}</span><span class="hint">${hint}</span></button>`).join('')}</div>`;
    } else if (k === 1) {
      h = `<div class="wz-q">What kind of land?</div><p class="wz-sub">The landscape sets the look, the trees and the ground you build on.</p>
        <div class="wz-cards three">${THEMES.map(([v, n, hint, bg]) => `<button class="wz-card ${d.theme === v ? 'on' : ''}" data-pick="theme" data-v="${v}">
          <span class="wz-swatch" style="background:${bg}"></span><b>${n}</b><span class="hint">${hint}</span></button>`).join('')}</div>
        <div class="wz-row"><span class="wz-lbl">Shape of the land</span><div class="wz-pills">${LAYOUTS.map(([v, n]) => `<button class="wz-pill ${d.layout === v ? 'on' : ''}" data-pick="layout" data-v="${v}">${n}</button>`).join('')}</div></div>`;
    } else if (k === 2) {
      const ai = d.ai | 0;
      const seats = [`<span class="wz-seat you" title="You">You</span>`]
        .concat(Array.from({ length: ai }, (_, i) => `<span class="wz-seat ai" style="--c:${hex(PLAYER_COLORS[i + 1])}" title="Computer">${AI_NAMES[i]}</span>`))
        .concat(Array.from({ length: MAX_PLAYERS - 1 - ai }, () => `<span class="wz-seat free" title="A free seat for another player">free</span>`)).join('');
      h = `<div class="wz-q">How many computer opponents?</div><p class="wz-sub">Seats you do not give to the computer stay free for people who join. Up to 6 realms in all.</p>
        <div class="wz-stepper"><button class="btn" data-ai="-1" ${ai <= 0 ? 'disabled' : ''}>−</button><span class="wz-num">${ai}</span><button class="btn" data-ai="1" ${ai >= MAX_PLAYERS - 1 ? 'disabled' : ''}>+</button></div>
        <div class="wz-seats">${seats}</div>
        <div class="wz-row ${ai ? '' : 'faded'}"><span class="wz-lbl">How well they play</span><div class="wz-pills">${SKILLS.map(([v, n, hint]) => `<button class="wz-pill ${d.aiLevel === v ? 'on' : ''}" data-pick="aiLevel" data-v="${v}" title="${hint}">${n}</button>`).join('')}</div></div>
        <div class="wz-row ${ai > 1 ? '' : 'faded'}"><span class="wz-lbl">Computers fight together</span><div class="wz-pills"><button class="wz-pill ${!d.aiTeam ? 'on' : ''}" data-pick="aiTeam" data-v="">No, each for itself</button><button class="wz-pill ${d.aiTeam ? 'on' : ''}" data-pick="aiTeam" data-v="1">Yes, allied</button></div></div>`;
    } else {
      h = `<div class="wz-q">Name your game</div><p class="wz-sub">This is how the game appears in the lobby.</p>
        <input type="text" class="wz-input" id="wz-room" maxlength="32" value="${esc(d.roomName || `${this.net.name}'s game`)}" data-focus>
        <div class="wz-summary">${describeSettings(d).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
        <p class="wz-sub small">Next you get a room with an invite link to send to friends. Others can also join from the lobby. Start whenever you are ready; alone is fine too.</p>`;
    }
    main.innerHTML = steps + `<div class="wz">${h}</div>`;
    main.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      this.app.audio.ui('click');
      const key = b.dataset.pick;
      d[key] = key === 'aiTeam' ? !!b.dataset.v : b.dataset.v;
      this.saveDraft(); this.render();
    });
    main.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => { this.app.audio.ui('click'); d.ai = Math.max(0, Math.min(MAX_PLAYERS - 1, (d.ai | 0) + +b.dataset.ai)); this.saveDraft(); this.render(); });
    main.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const i = +b.dataset.step; if (i < k) { this.hostStep = i; this.render(); } });
    const last = k === HOST_STEPS.length - 1;
    this.footer(`<button class="btn" data-act="back">Back</button>`, last ? `<button class="btn green" data-act="open" data-primary>Open the game</button>` : `<button class="btn green" data-act="next" data-primary>Next</button>`);
    this.wireFoot({
      back: () => { if (k === 0) this.go('choose'); else { this.hostStep--; this.render(); } },
      next: () => { this.hostStep++; this.render(); },
      open: () => {
        d.roomName = $('#wz-room').value.trim();
        const settings = Object.assign({}, d); delete settings.roomName;
        this.net.send('create', { name: d.roomName });
        this.net.send('settings', { settings });
      },
    });
  }

  // ------------------------------------------------------------------ the game room
  renderRoomView(main) {
    main.innerHTML = `<div class="lb-room-head"><h2 class="lb-h" id="lb-room-title"></h2><button class="btn small" id="lb-invite" title="Send this link to friends: it brings them straight into this game">Copy invite link</button></div>
      <p class="lb-hint" id="lb-room-hint"></p>
      <div class="lb-seats" id="lb-seats"></div>
      <div class="lb-sumrow"><div class="wz-summary" id="lb-summary"></div><button class="btn small" id="lb-adv">Change settings</button></div>
      <div class="form lb-settings hidden" id="lb-settings"></div>`;
    this.buildSettings();
    $('#lb-invite').onclick = () => this.copyInvite();
    $('#lb-adv').onclick = () => { this.app.audio.ui('click'); this.advanced = !this.advanced; this.renderRoom(); };
    this.footer(`<button class="btn red" data-act="leave">Leave</button>`,
      `<button class="btn" data-act="ready" id="lb-ready">I'm ready</button><button class="btn green" data-act="start" id="lb-start" data-primary>Start the game</button>`);
    this.wireFoot({
      leave: () => this.net.send('leave'),
      ready: () => { const s = this.mySeat(); this.net.send('seat', { ready: !(s && s.ready) }); },
      start: () => {
        const unready = this.room.seats.filter(s => !s.ready && s.id !== this.room.hostId);
        if (unready.length && !confirm(`${unready.map(s => s.name).join(', ')} ${unready.length > 1 ? 'are' : 'is'} not ready yet. Start anyway?`)) return;
        this.net.send('start');
      },
    });
    this.renderRoom();
  }

  async copyInvite() {
    const url = location.href.split('#')[0] + '#join=' + this.room.id;
    const b = $('#lb-invite');
    try { await navigator.clipboard.writeText(url); if (b) { b.textContent = 'Link copied ✓'; setTimeout(() => { if ($('#lb-invite')) $('#lb-invite').textContent = 'Copy invite link'; }, 2500); } }
    catch { prompt('Send this link to your friends:', url); }
  }

  renderStatus() {
    const el = $('#lb-status'); if (!el) return;
    const s = this.net.status;
    el.textContent = s === 'online' ? (this.online ? `${this.online} online` : 'Connected') : s === 'connecting' ? 'Connecting…' : s === 'offline' ? 'Server not reachable — retrying…' : '';
    el.className = 'lb-status ' + s;
  }

  renderPeople() {
    const el = $('#lb-people'); if (!el) return;
    if (this.room) { el.innerHTML = ''; return; }
    el.innerHTML = this.people.length ? `<span class="muted">In the lobby:</span> ${this.people.map(esc).join(', ')}` : '';
  }

  renderRoom() {
    const r = this.room; if (!r || !$('#lb-seats')) return;
    const host = this.isHost(), me = this.mySeat();
    $('#lb-room-title').textContent = r.name;
    const settings = Object.assign({}, MP_DEFAULTS, r.settings || {});
    const aiN = Math.max(0, Math.min(MAX_PLAYERS - r.seats.length, settings.ai | 0));
    const free = MAX_PLAYERS - r.seats.length - aiN;
    const hostSeat = r.seats.find(s => s.id === r.hostId);
    const unready = r.seats.filter(s => !s.ready && s.id !== r.hostId).length;
    $('#lb-room-hint').innerHTML = host
      ? (r.seats.length === 1
        ? `Send the invite link to friends, or wait for players from the lobby${free ? ` (${free} free seat${free > 1 ? 's' : ''})` : ''}. You can also start right away${aiN ? ` against ${aiN} computer${aiN > 1 ? 's' : ''}` : ''}.`
        : unready ? `${unready} player${unready > 1 ? 's are' : ' is'} not ready yet. Start when everybody is set.` : 'Everybody is ready. Start the game when you like.')
      : `Waiting for ${esc(hostSeat ? hostSeat.name : 'the host')} to start the game. Meanwhile pick your people and team, then say you are ready.`;
    let h = r.seats.map((s, i) => {
      const mine = me && s.id === me.id;
      const nation = mine ? `<select data-seat="nation" title="Your people">${Object.entries(NATIONS).map(([k, n]) => `<option value="${k}" ${k === s.nation ? 'selected' : ''}>${n.name}</option>`).join('')}</select>` : esc((NATIONS[s.nation] || {}).name || s.nation);
      const teamLabel = (t) => t ? `Team ${t}` : 'No team';
      const team = mine ? `<select data-seat="team" title="Players in the same team cannot attack each other">${[0, 1, 2, 3, 4].map(t => `<option value="${t}" ${t === s.team ? 'selected' : ''}>${teamLabel(t)}</option>`).join('')}</select>` : teamLabel(s.team);
      return `<div class="lb-seat ${mine ? 'me' : ''}"><span class="sw" style="background:${hex(PLAYER_COLORS[i])}"></span>
        <span class="nm">${esc(s.name)}${s.id === r.hostId ? ' <span class="crown" title="Host">♛</span>' : ''}${mine ? ' <span class="muted">(you)</span>' : ''}${s.connected ? '' : ' <span class="muted">(away)</span>'}</span>
        <span>${nation}</span><span>${team}</span>
        <span class="rd ${s.ready || s.id === r.hostId ? 'on' : ''}">${s.id === r.hostId ? 'Host' : s.ready ? 'Ready ✓' : 'Not ready'}</span>
        ${host && !mine ? `<button class="btn small red" data-kick="${esc(s.id)}" title="Remove from the room">✕</button>` : '<span></span>'}</div>`;
    }).join('');
    for (let i = 0; i < aiN; i++) {
      h += `<div class="lb-seat ai"><span class="sw" style="background:${hex(PLAYER_COLORS[r.seats.length + i])}"></span><span class="nm">${AI_NAMES[i]} <span class="muted">· computer, ${esc(label(SKILLS, settings.aiLevel).toLowerCase())}</span></span><span></span><span>${settings.aiTeam && aiN > 1 ? 'Allied' : ''}</span><span class="rd"></span><span></span></div>`;
    }
    if (free > 0) h += `<div class="lb-seat free muted">${free} free seat${free > 1 ? 's' : ''} for players who join</div>`;
    $('#lb-seats').innerHTML = h;
    $('#lb-seats').querySelectorAll('[data-seat]').forEach(el => el.onchange = () => this.net.send('seat', { [el.dataset.seat]: el.dataset.seat === 'team' ? +el.value : el.value }));
    $('#lb-seats').querySelectorAll('[data-kick]').forEach(el => el.onclick = () => this.net.send('kick', { id: el.dataset.kick }));
    // settings: a readable summary for everybody; the host can open the full form
    $('#lb-summary').innerHTML = describeSettings(settings).map(x => `<span class="chip">${esc(x)}</span>`).join('');
    const adv = $('#lb-adv'); adv.classList.toggle('hidden', !host); adv.textContent = this.advanced ? 'Hide settings' : 'Change settings';
    const form = $('#lb-settings');
    form.classList.toggle('hidden', !(host && this.advanced));
    const aiSel = form.querySelector('[data-set=ai]');
    const aiMax = MAX_PLAYERS - r.seats.length;
    if (aiSel && aiSel.options.length !== aiMax + 1) {
      aiSel.innerHTML = Array.from({ length: aiMax + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join('');
      aiSel.value = String(Math.min(aiMax, settings.ai | 0));
    }
    form.querySelectorAll('[data-set]').forEach(el => {
      if (host && el.dataset.touched) return;
      const v = settings[el.dataset.set];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.dataset.set === 'seed') el.value = v ? v : '';
      else if (el.dataset.set === 'ai') el.value = String(Math.min(aiMax, v | 0));
      else el.value = v;
    });
    const ready = $('#lb-ready'), start = $('#lb-start');
    if (ready) { ready.classList.toggle('hidden', host); ready.textContent = me && me.ready ? 'Not ready after all' : "I'm ready"; ready.classList.toggle('green', !(me && me.ready)); }
    if (start) { start.classList.toggle('hidden', !host); if (!host) start.removeAttribute('data-primary'); else start.setAttribute('data-primary', ''); }
    if (ready && !host) ready.setAttribute('data-primary', ''); else if (ready) ready.removeAttribute('data-primary');
    $('#lb-chat-title').textContent = `Room chat · ${r.seats.length} player${r.seats.length > 1 ? 's' : ''}`;
  }

  buildSettings() {
    const form = $('#lb-settings');
    form.innerHTML = SETTINGS_FORM.map(([k, lbl, type, opts]) => {
      let input;
      if (type === 'select') input = `<select data-set="${k}">${(opts || []).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
      else if (type === 'range') input = `<input type="range" min="0" max="10" data-set="${k}">`;
      else if (type === 'check') input = `<input type="checkbox" data-set="${k}">`;
      else input = `<input type="number" min="0" max="99999" placeholder="random" data-set="${k}">`;
      return `<span>${lbl}</span>${input}`;
    }).join('');
    let timer = 0;
    form.querySelectorAll('[data-set]').forEach(el => {
      const send = () => {
        el.dataset.touched = '1';
        clearTimeout(timer);
        timer = setTimeout(() => {
          const s = this.readSettings();
          Object.assign(this.draft, s, { seed: 0 }); this.saveDraft();
          this.net.send('settings', { settings: s });
        }, 150);
      };
      el.addEventListener(el.type === 'range' ? 'input' : 'change', send);
    });
  }

  readSettings() {
    const s = {};
    $('#lb-settings').querySelectorAll('[data-set]').forEach(el => {
      const k = el.dataset.set;
      if (el.type === 'checkbox') s[k] = el.checked;
      else if (el.type === 'range' || k === 'ai' || k === 'seed') s[k] = Math.max(0, Math.floor(+el.value || 0));
      else s[k] = el.value;
    });
    return s;
  }

  renderLog() {
    const el = $('#lb-log'); if (!el) return;
    const lines = this.logs[this.room ? 'room' : 'lobby'];
    el.innerHTML = lines.length ? lines.map(l => l.sys ? `<div class="cl sys">${esc(l.text)}</div>` : `<div class="cl"><span class="t">${clock(l.t)}</span> <b>${esc(l.from)}</b> ${esc(l.text)}</div>`).join('')
      : `<div class="cl sys">${this.room ? 'Talk to the other players here.' : 'Say hello to everybody in the lobby.'}</div>`;
    el.scrollTop = el.scrollHeight;
  }

  // ------------------------------------------------------------------ in game
  showGameChat(on) {
    $('#chat').classList.toggle('hidden', !on);
    $('#roster').classList.toggle('hidden', !on);
    document.body.classList.toggle('mp', on);
    if (on) { this.renderGameChat(); this.renderRoster(); }
    else this.closeChat();
  }
  openChat() { $('#chat').classList.add('open'); $('#chat-form').classList.remove('hidden'); $('#chat-input').focus(); this.renderGameChat(); }
  closeChat() { $('#chat').classList.remove('open'); $('#chat-form').classList.add('hidden'); $('#chat-input').blur(); this.renderGameChat(); }
  get chatOpen() { return $('#chat').classList.contains('open'); }

  renderGameChat(fresh) {
    const el = $('#chat-log'); if (!el || !this.app.mp) return;
    const open = this.chatOpen, now = Date.now();
    const colorOf = (name) => { const s = this.room && this.room.seats.find(x => x.name === name); return s && s.slot >= 0 ? hex(PLAYER_COLORS[s.slot]) : '#f5d77a'; };
    const lines = this.logs.room.filter(l => open || now - l.t < 20000 || l === fresh).slice(open ? -40 : -6);
    el.innerHTML = lines.map(l => l.sys ? `<div class="cl sys">${esc(l.text)}</div>` : `<div class="cl"><b style="color:${colorOf(l.from)}">${esc(l.from)}:</b> ${esc(l.text)}</div>`).join('')
      + (open || lines.length ? '' : '');
    el.scrollTop = el.scrollHeight;
    clearTimeout(this.fadeT);
    if (!open && lines.length) this.fadeT = setTimeout(() => this.renderGameChat(), 5000);
  }

  renderRoster() {
    const el = $('#roster'); const mp = this.app.mp; if (!el || !mp || !this.room) return;
    const g = this.app.game;
    const seatBySlot = new Map(this.room.seats.map(s => [s.slot, s]));
    const rows = (g ? g.players : []).map(p => {
      const s = seatBySlot.get(p.id);
      const tag = !p.alive ? '† defeated' : s ? (s.left ? 'left · steward' : s.ai ? 'away · steward' : s.connected ? '' : 'away') : 'computer';
      return `<div class="rr"><span class="sw" style="background:${hex(p.color)}"></span><span class="nm">${esc(p.name)}${s && s.id === this.room.hostId ? ' ♛' : ''}${p.id === mp.slot ? ' <i>(you)</i>' : ''}</span><span class="tg">${tag}</span></div>`;
    }).join('');
    el.innerHTML = rows + `<div class="rr hint">Press <kbd>Enter</kbd> to chat</div>`;
  }
}
