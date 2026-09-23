// Game state + command API + main update loop. Pure JS: runs in the browser and in node tests.
import { Grid, RNG, DIR } from './grid.js';
import { generateMap, RES, SEA } from './mapgen.js';
import { TERRAIN_INFO, TERRAIN as T, BUILDINGS, JOBS, WARES, TOOLS, DEFAULT_START, DEFAULT_TRANSPORT, PLAYER_COLORS, SIZE_RANK, FOODS } from './data.js';
import * as L from './logistics.js';
import { updateSettler, updateAnimal } from './jobs.js';
import { recomputeTerritory, updateMilitary, attack as milAttack } from './military.js';
import { aiTick } from './ai.js';

export const TICK = 0.05;

export class Game {
  constructor(setup) {
    this.setup = setup;
    this.map = setup.map || generateMap(setup.mapOpts);
    const m = this.map;
    this.grid = new Grid(m.w, m.h);
    this.rng = new RNG(setup.seed || m.seed || 1);
    this.time = 0; this.tickN = 0;
    this.nextId = 1;
    this.owner = new Uint8Array(this.grid.n);
    this.roadAt = new Int32Array(this.grid.n);
    this.buildings = new Map(); this.flags = new Map(); this.roads = new Map();
    this.settlers = new Map(); this.wares = new Map();
    this.animals = m.animals; delete m.animals;
    this.netVersion = 1; this._route = new Map();
    this.terrVersion = 1; this.objVersion = 1; this.roadVersion = 1;
    this.events = []; this.projectiles = [];
    this.players = [];
    this.winner = -1;
    const pcfg = setup.players || [{ name: 'You', human: true }, { name: 'Enemy', ai: 'normal' }];
    pcfg.forEach((c, i) => this.players.push(this.makePlayer(i, c)));
    // place headquarters
    this.players.forEach((pl, i) => {
      const s = m.starts[i];
      if (s === undefined || pl.cfg.noHQ) return;
      this.placeHQ(i, s, pl.cfg.start);
    });
    recomputeTerritory(this);
    this.updateVision(true);
  }

  makePlayer(i, c) {
    const explored = new Uint8Array(this.grid.n), visible = new Uint8Array(this.grid.n);
    return {
      id: i, cfg: c, name: c.name || `Player ${i + 1}`, nation: c.nation || 'romans', color: c.color ?? PLAYER_COLORS[i],
      human: !!c.human, ai: c.ai || null, team: c.team ?? i, alive: true,
      transport: DEFAULT_TRANSPORT.slice(), toolPrio: Object.fromEntries(TOOLS.map(t => [t, 1])), toolDemand: {},
      occupancy: 1, promote: true, sendStrong: false, attackReserve: 1,
      explored, visible, produced: {}, stats: [], messages: [], territory: 0, lostBuildings: 0,
      killed: 0, lost: 0,
    };
  }

  // ------------------------------------------------------------------ helpers
  id() { return this.nextId++; }
  flagAt(n) { const o = this.map.obj[n]; return o && o.t === 'flag' ? this.flags.get(o.id) : null; }
  buildingAt(n) { const o = this.map.obj[n]; return o && (o.t === 'bld' || o.t === 'foot') ? this.buildings.get(o.id) : null; }
  emit(type, node, extra) { if (this.events.length < 400) this.events.push(Object.assign({}, extra, { type, node })); }
  message(p, text, node = -1, kind = 'info') {
    const pl = this.players[p]; if (!pl) return;
    pl.messages.push({ text, node, kind, time: this.time });
    if (pl.messages.length > 60) pl.messages.shift();
    this.emit('msg', node, { p, text, kind });
  }
  isBorder(n) {
    const o = this.owner[n]; if (!o) return false;
    for (let d = 0; d < 6; d++) { const j = this.grid.neighbor(n, d); if (j < 0 || this.owner[j] !== o) return true; }
    return false;
  }
  totalStock(p) {
    const s = {}, people = {};
    for (const b of this.buildings.values()) {
      if (b.owner !== p || b.state !== 'done' || !b.stock) continue;
      for (const [k, v] of Object.entries(b.stock)) s[k] = (s[k] || 0) + v;
      for (const [k, v] of Object.entries(b.people)) people[k] = (people[k] || 0) + v;
    }
    return { wares: s, people };
  }

  // ------------------------------------------------------------ build rules
  canPlaceFlag(p, n, ignoreNode = -1) {
    const m = this.map, g = this.grid;
    if (this.owner[n] !== p + 1) return 'not your land';
    if (this.isBorder(n)) return 'border';
    if (!TERRAIN_INFO[m.terrain[n]].walk) return 'terrain';
    const o = m.obj[n];
    if (o && o.t !== 'sign') return 'occupied';
    for (let d = 0; d < 6; d++) {
      const j = g.neighbor(n, d); if (j < 0) return 'edge';
      if (j === ignoreNode) continue;
      const oj = m.obj[j]; if (oj && oj.t === 'flag') return 'flag too close';
    }
    return true;
  }

  // Returns 'none' | 'flag' | 'small' | 'medium' | 'large' | 'mine'
  buildCap(p, n) {
    const m = this.map, g = this.grid;
    if (this.owner[n] !== p + 1 || this.isBorder(n)) return 'none';
    const t = m.terrain[n];
    if (!TERRAIN_INFO[t].walk) return 'none';
    const o = m.obj[n];
    if (o && o.t !== 'sign') return 'none';
    const flagOk = this.canPlaceFlag(p, n) === true;
    if (this.roadAt[n]) return flagOk ? 'flag' : 'none';
    const se = g.neighbor(n, DIR.SE);
    if (se < 0) return flagOk ? 'flag' : 'none';
    const seFlag = this.flagAt(se);
    const seOk = seFlag ? seFlag.owner === p : (this.canPlaceFlag(p, se, n) === true && !this.roadAt[se] ? true : (this.roadAt[se] && this.canPlaceFlag(p, se, n) === true));
    if (!seOk) return flagOk ? 'flag' : 'none';
    if (Math.abs(m.height[n] - m.height[se]) > 2) return flagOk ? 'flag' : 'none';
    // neighbours
    let cap = 3, slope = 0, allMountain = true;
    for (let d = 0; d < 6; d++) {
      const j = g.neighbor(n, d); if (j < 0) return flagOk ? 'flag' : 'none';
      slope = Math.max(slope, Math.abs(m.height[j] - m.height[n]));
      const tj = m.terrain[j];
      if (tj !== T.MOUNTAIN) allMountain = false;
      if (d === DIR.SE) continue;
      const oj = m.obj[j];
      if (oj) {
        if (oj.t === 'flag' || oj.t === 'bld' || oj.t === 'foot') return flagOk ? 'flag' : 'none';
        if (oj.t === 'tree' || oj.t === 'stone' || oj.t === 'field') cap = Math.min(cap, 1);
      }
      if (!TERRAIN_INFO[tj].walk) cap = Math.min(cap, 1);
      else if (!TERRAIN_INFO[tj].build && tj !== T.MOUNTAIN) cap = Math.min(cap, 2);
      else if (tj === T.MOUNTAIN && TERRAIN_INFO[t].build) cap = Math.min(cap, 2);
    }
    if (t === T.MOUNTAIN) {
      if (!allMountain && !TERRAIN_INFO[t].build) {
        // mines need mountain around except where the flag sits
      }
      return slope <= 4 ? 'mine' : (flagOk ? 'flag' : 'none');
    }
    if (!TERRAIN_INFO[t].build) return flagOk ? 'flag' : 'none';
    if (slope > 4) return flagOk ? 'flag' : 'none';
    if (slope > 3) cap = Math.min(cap, 1);
    else if (slope > 2) cap = Math.min(cap, 2);
    if (cap === 3) {
      // large footprint: W, NW, NE must be free buildable land without roads
      for (const d of [DIR.W, DIR.NW, DIR.NE]) {
        const j = g.neighbor(n, d);
        if (j < 0 || this.roadAt[j] || m.obj[j] || !TERRAIN_INFO[m.terrain[j]].build || this.owner[j] !== p + 1) { cap = 2; break; }
        for (let e = 0; e < 6; e++) { const k = g.neighbor(j, e); if (k < 0) continue; const ok = m.obj[k]; if (ok && (ok.t === 'bld' || ok.t === 'foot' || (ok.t === 'flag' && k !== se))) { cap = 2; break; } }
        if (cap < 3) break;
      }
    }
    return cap >= 3 ? 'large' : cap === 2 ? 'medium' : 'small';
  }
  canBuildType(p, n, type) {
    const cap = this.buildCap(p, n), size = BUILDINGS[type].size;
    if (size === 'mine') return cap === 'mine';
    if (cap === 'mine' || cap === 'none' || cap === 'flag') return false;
    return SIZE_RANK[cap] >= SIZE_RANK[size];
  }

  // ------------------------------------------------------------- commands
  placeFlag(p, n, silent = false) {
    if (this.canPlaceFlag(p, n) !== true) return null;
    const f = { id: this.id(), owner: p, node: n, roads: [0, 0, 0, 0, 0, 0], wares: [], building: 0 };
    this.flags.set(f.id, f);
    this.map.obj[n] = { t: 'flag', id: f.id };
    this.objVersion++;
    if (this.roadAt[n]) this.splitRoad(this.roadAt[n], n, f);
    if (!silent) this.emit('flagPlaced', n, { p });
    return f;
  }

  splitRoad(rid, n, f) {
    const r = this.roads.get(rid); if (!r) return;
    const k = r.nodes.indexOf(n); if (k <= 0 || k >= r.nodes.length - 1) return;
    const n1 = r.nodes.slice(0, k + 1), n2 = r.nodes.slice(k);
    const carrier = r.carrier, donkey = r.donkey;
    this.removeRoad(rid, true);
    const r1 = this.addRoad(r.owner, n1), r2 = this.addRoad(r.owner, n2);
    // keep the carrier on whichever half he stands on
    const s = carrier && this.settlers.get(carrier);
    if (s && r1 && r2) {
      const onFirst = n1.includes(s.node);
      const keep = onFirst ? r1 : r2;
      keep.carrier = s.id; s.road = keep.id; if (s.state !== 'toRoad') s.state = 'idle'; s.path = []; s.next = -1;
      // re-route him to the middle if he was idle
    }
    const dk = donkey && this.settlers.get(donkey);
    if (dk) this.sendHome(dk);
  }

  addRoad(p, nodes) {
    const g = this.grid, m = this.map;
    const fa = this.flagAt(nodes[0]), fb = this.flagAt(nodes[nodes.length - 1]);
    if (!fa || !fb) return null;
    let slope = 0; for (let i = 1; i < nodes.length; i++) slope += Math.max(0, Math.abs(m.height[nodes[i]] - m.height[nodes[i - 1]]) - 1);
    const r = { id: this.id(), owner: p, nodes: nodes.slice(), a: fa.id, b: fb.id, carrier: 0, donkey: 0, traffic: 0, busy: false, slope };
    this.roads.set(r.id, r);
    for (let i = 1; i < nodes.length - 1; i++) {
      this.roadAt[nodes[i]] = r.id;
      const o = m.obj[nodes[i]]; if (o && o.t === 'sign') m.obj[nodes[i]] = null;
    }
    fa.roads[g.dirTo(nodes[0], nodes[1])] = r.id;
    fb.roads[g.dirTo(nodes[nodes.length - 1], nodes[nodes.length - 2])] = r.id;
    this.netVersion++; this.roadVersion++;
    return r;
  }

  // nodes: full node path starting at a flag; ending flag placed automatically
  buildRoad(p, nodes) {
    const v = L.validateRoad(this, p, nodes);
    if (v !== true) return { ok: false, reason: v };
    const last = nodes[nodes.length - 1];
    if (!this.flagAt(last)) { const f = this.placeFlag(p, last, true); if (!f) return { ok: false, reason: 'cannot end here' }; }
    const r = this.addRoad(p, nodes);
    // long roads get intermediate flags automatically? no — player decides (S2); AI does it.
    this.emit('roadBuilt', nodes[0], { p });
    return { ok: true, road: r };
  }

  removeRoad(rid, keepSettlers = false) {
    const r = this.roads.get(rid); if (!r) return;
    const g = this.grid;
    this.roads.delete(rid);
    for (let i = 1; i < r.nodes.length - 1; i++) if (this.roadAt[r.nodes[i]] === rid) this.roadAt[r.nodes[i]] = 0;
    const fa = this.flags.get(r.a), fb = this.flags.get(r.b);
    if (fa) fa.roads[g.dirTo(r.nodes[0], r.nodes[1])] = 0;
    if (fb) fb.roads[g.dirTo(r.nodes[r.nodes.length - 1], r.nodes[r.nodes.length - 2])] = 0;
    this.netVersion++; this.roadVersion++;
    for (const sid of [r.carrier, r.donkey]) {
      const s = sid && this.settlers.get(sid); if (!s) continue;
      s.road = 0;
      if (keepSettlers) continue;
      if (s.carry) { const w = this.wares.get(s.carry); if (w) this.dropWareNear(s, w); s.carry = 0; }
      this.sendHome(s);
    }
    // reserved wares at the end flags are released
    for (const w of this.wares.values()) if (w.reserved && (w.reserved === r.carrier || w.reserved === r.donkey)) w.reserved = 0;
  }

  dropWareNear(s, w) {
    const f = this.flagAt(s.node) || (s.next >= 0 && this.flagAt(s.next));
    if (f && f.owner === w.owner && f.wares.length < 12) { w.flag = f.id; w.carrier = 0; w.reserved = 0; w.since = this.time; f.wares.push(w.id); }
    else this.destroyWare(w);
  }

  placeBuilding(p, n, type, opts = {}) {
    const def = BUILDINGS[type];
    if (!def) return null;
    if (!opts.force && !this.canBuildType(p, n, type)) return null;
    const g = this.grid, se = g.neighbor(n, DIR.SE);
    let f = this.flagAt(se);
    if (!f) f = this.placeFlag(p, se, true);
    if (!f) return null;
    const b = {
      id: this.id(), type, owner: p, node: n, flag: f.id, state: opts.done ? 'done' : 'site', t0: this.time,
      site: { need: Object.assign({}, def.cost), have: {}, used: {}, builder: 0, progress: 0, leveled: false },
      inputs: {}, inbound: {}, worker: 0, stopped: false, prod: [], soldiers: [], soldiersComing: 0,
      claimTime: 0, occupied: false, fire: 0, anim: 0, work: 0,
    };
    if (def.kind === 'warehouse') { b.stock = {}; b.people = {}; b.ranks = [0, 0, 0, 0, 0]; b.outbox = []; }
    this.buildings.set(b.id, b);
    f.building = b.id;
    this.map.obj[n] = { t: 'bld', id: b.id };
    if (def.size === 'large') for (const d of [DIR.W, DIR.NW, DIR.NE]) { const j = g.neighbor(n, d); if (j >= 0) this.map.obj[j] = { t: 'foot', id: b.id }; }
    this.objVersion++;
    // a building needs its door connected: the tiny road from the building to its flag is implicit
    if (opts.done) this.finishConstruction(b, true);
    else this.emit('sitePlaced', n, { p, btype: type });
    return b;
  }

  placeHQ(p, n, start) {
    // HQ territory must exist before placement: claim temporarily
    for (const j of this.grid.within(n, 9)) if (!this.owner[j]) this.owner[j] = p + 1;
    const b = this.placeBuilding(p, n, 'hq', { force: true, done: true });
    if (!b) return;
    const st = start || DEFAULT_START;
    Object.assign(b.stock, st.wares || DEFAULT_START.wares);
    Object.assign(b.people, st.people || DEFAULT_START.people);
    b.ranks = [0, 0, 0, 0, 0];
    b.ranks[0] = b.people.soldier || 0;
    if (st.ranks) { b.ranks = st.ranks.slice(); b.people.soldier = b.ranks.reduce((a, c) => a + c, 0); }
    b.occupied = true; b.claimTime = -1 - p;
  }

  finishConstruction(b, silent = false) {
    b.state = 'done'; b.site.progress = 1;
    const def = BUILDINGS[b.type];
    if (!silent) {
      this.emit('built', b.node, { p: b.owner, btype: b.type });
      if (this.players[b.owner].human) this.message(b.owner, `${def.name} completed`, b.node, 'build');
    }
    this.objVersion++;
  }

  destroyBuilding(bid, reason = 'destroyed') {
    const b = this.buildings.get(bid); if (!b) return;
    const g = this.grid, def = BUILDINGS[b.type];
    this.buildings.delete(bid);
    this.map.obj[b.node] = { t: 'ruin', ttl: 40, big: def.size === 'large' };
    if (def.size === 'large') for (const d of [DIR.W, DIR.NW, DIR.NE]) { const j = g.neighbor(b.node, d); const o = j >= 0 && this.map.obj[j]; if (o && o.t === 'foot' && o.id === bid) this.map.obj[j] = null; }
    this.objVersion++;
    const f = this.flags.get(b.flag); if (f && f.building === bid) f.building = 0;
    // people inside or heading here
    for (const s of this.settlers.values()) {
      if (s.home === bid || (s.target === bid && s.job === 'soldier' && s.state !== 'attack')) { s.home = 0; this.sendHome(s, b.node); }
    }
    for (const w of this.wares.values()) if (w.dest === bid) { w.dest = 0; }
    if (b.state === 'done' && def.kind === 'military' && b.occupied) recomputeTerritory(this);
    if (b.state === 'done' && def.kind === 'warehouse') this.checkDefeat(b.owner);
    this.emit('burn', b.node, { p: b.owner, btype: b.type, reason });
  }

  destroyFlag(fid) {
    const f = this.flags.get(fid); if (!f) return;
    if (f.building) { const b = this.buildings.get(f.building); if (b && b.type === 'hq') return; this.destroyBuilding(f.building); }
    for (let d = 0; d < 6; d++) if (f.roads[d]) this.removeRoad(f.roads[d]);
    for (const wid of f.wares) { const w = this.wares.get(wid); if (w) this.destroyWare(w); }
    this.flags.delete(fid);
    if (this.map.obj[f.node] && this.map.obj[f.node].t === 'flag') this.map.obj[f.node] = null;
    this.objVersion++; this.netVersion++;
  }

  sendSpecialist(p, fid, job) {
    const f = this.flags.get(fid); if (!f || f.owner !== p) return false;
    const s = L.dispatchSettler(this, p, job, fid);
    if (!s) return false;
    s.target = fid; s.state = 'toFlag'; return true;
  }
  sendGeologist(p, fid) { return this.sendSpecialist(p, fid, 'geologist'); }
  sendScout(p, fid) { return this.sendSpecialist(p, fid, 'scout'); }
  setStopped(bid, v) { const b = this.buildings.get(bid); if (b) b.stopped = v; }
  attack(p, bid, n) { return milAttack(this, p, bid, n); }

  // ------------------------------------------------------------ entities
  spawnSettler(p, job, node, rank = 0) {
    const s = { id: this.id(), owner: p, job, node, next: -1, t: 0, path: [], state: 'idle', timer: 0, carry: 0, carryType: null,
      home: 0, road: 0, inside: false, rank, hp: 0, target: 0, anim: 'walk', face: 0, workAnim: 0 };
    if (job === 'soldier') s.hp = maxHp(rank);
    this.settlers.set(s.id, s);
    return s;
  }
  removeSettler(s) { this.settlers.delete(s.id); if (s.carry) { const w = this.wares.get(s.carry); if (w) this.destroyWare(w); } }

  createWare(p, type, flagId, dest = 0) {
    const f = this.flags.get(flagId); if (!f) return null;
    const w = { id: this.id(), owner: p, type, flag: flagId, carrier: 0, dest, reserved: 0, since: this.time };
    this.wares.set(w.id, w); f.wares.push(w.id);
    return w;
  }
  destroyWare(w) {
    if (w.flag) { const f = this.flags.get(w.flag); if (f) { const i = f.wares.indexOf(w.id); if (i >= 0) f.wares.splice(i, 1); } }
    if (w.dest) { const b = this.buildings.get(w.dest); if (b && b.inbound[w.type]) b.inbound[w.type]--; }
    this.wares.delete(w.id);
  }

  // walk a settler back to the nearest warehouse (roads if possible, else cross-country)
  sendHome(s, fromNode = -1) {
    s.state = 'goHome'; s.road = 0; s.home = 0; s.inside = false; s.target = 0;
    if (fromNode >= 0 && s.inside !== false) s.node = fromNode;
    if (s.next >= 0) { s.node = s.t > 0.5 ? s.next : s.node; s.next = -1; s.t = 0; }
    s.path = [];
    const whs = [...this.buildings.values()].filter(b => b.owner === s.owner && b.state === 'done' && BUILDINGS[b.type].kind === 'warehouse');
    if (!whs.length) { s.state = 'lost'; return; }
    whs.sort((a, b) => this.grid.dist(a.node, s.node) - this.grid.dist(b.node, s.node));
    const wh = whs[0];
    const path = L.findWalkPath(this, s.node, wh.node, { allow: wh.node, max: 20000 });
    if (path) { s.path = path; s.target = wh.id; }
    else { s.state = 'lost'; }
  }

  enterWarehouse(s, wh) {
    if (s.carry) { const w = this.wares.get(s.carry); if (w) { wh.stock[w.type] = (wh.stock[w.type] || 0) + 1; this.wares.delete(w.id); } s.carry = 0; }
    if (s.carryType) { wh.stock[s.carryType] = (wh.stock[s.carryType] || 0) + 1; s.carryType = null; }
    wh.people[s.job] = (wh.people[s.job] || 0) + 1;
    if (s.job === 'soldier') wh.ranks[s.rank] = (wh.ranks[s.rank] || 0) + 1;
    this.settlers.delete(s.id);
  }

  checkDefeat(p) {
    const pl = this.players[p]; if (!pl.alive) return;
    const any = [...this.buildings.values()].some(b => b.owner === p && b.state === 'done' && (BUILDINGS[b.type].kind === 'warehouse' || (BUILDINGS[b.type].kind === 'military' && b.occupied)));
    if (!any) {
      pl.alive = false;
      this.emit('defeated', -1, { p });
      for (const q of this.players) if (q.human) this.message(q.id, `${pl.name} has been defeated!`, -1, 'war');
    }
  }

  // ------------------------------------------------------------ vision
  updateVision(force = false) {
    const g = this.grid;
    const tmp = [];
    for (const pl of this.players) {
      if (!pl.human && !force) continue;
      const vis = pl.visible; vis.fill(0);
      for (let i = 0; i < g.n; i++) if (this.owner[i] === pl.id + 1) vis[i] = 1;
      for (const b of this.buildings.values()) {
        if (b.owner !== pl.id) continue;
        const def = BUILDINGS[b.type];
        const r = b.state === 'done' ? (def.kind === 'military' ? (def.radius + 3) : def.vision) : 3;
        for (const j of g.within(b.node, r, tmp)) vis[j] = 1;
      }
      for (const s of this.settlers.values()) {
        if (s.owner !== pl.id || s.inside || this.owner[s.node] === pl.id + 1) continue;
        for (const j of g.within(s.node, s.job === 'scout' ? 5 : 2, tmp)) vis[j] = 1;
      }
      const ex = pl.explored; for (let i = 0; i < g.n; i++) if (vis[i]) ex[i] = 1;
    }
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.time += dt; this.tickN++;
    for (const s of this.settlers.values()) updateSettler(this, s, dt);
    updateMilitary(this, dt);
    const tk = this.tickN;
    if (tk % 10 === 0) for (let p = 0; p < this.players.length; p++) L.dispatch(this, p);
    if (tk % 20 === 5) this.slowUpdate();
    if (tk % 20 === 12) this.updateVision();
    for (const a of this.animals) updateAnimal(this, a, dt);
    if (tk % 4 === 1) for (let p = 0; p < this.players.length; p++) if (this.players[p].ai) aiTick(this, p);
    for (let i = this.projectiles.length - 1; i >= 0; i--) { const pr = this.projectiles[i]; pr.t += dt / pr.dur; if (pr.t >= 1) { this.projectiles.splice(i, 1); pr.onHit && pr.onHit(); } }
  }

  // once per second: growth, warehouses, recruitment, stats, fire
  slowUpdate() {
    const m = this.map, g = this.grid;
    let changed = false;
    for (let i = 0; i < g.n; i++) {
      const o = m.obj[i]; if (!o) continue;
      if (o.t === 'tree' && o.g < 1) { o.g = Math.min(1, o.g + 1 / 150); if (o.g >= 1) changed = true; }
      else if (o.t === 'field') { if (o.g < 1) o.g = Math.min(1, o.g + 1 / 110); else if ((o.rot = (o.rot || 0) + 1) > 400) { m.obj[i] = null; changed = true; } }
      else if (o.t === 'sign') { if (--o.ttl <= 0) { m.obj[i] = null; changed = true; } }
      else if (o.t === 'ruin') { if (--o.ttl <= 0) { m.obj[i] = null; changed = true; } }
    }
    if (changed) this.objVersion++;
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      // productivity history (1 entry per second, 120 s window)
      if (b.state === 'done' && def.job) { b.prod.push(b.work ? 1 : 0); if (b.prod.length > 120) b.prod.shift(); b.work = 0; }
      if (b.state !== 'done' || def.kind !== 'warehouse') continue;
      // new helpers slowly appear in warehouses
      b.growT = (b.growT || 0) + 1;
      if (b.growT >= (b.type === 'hq' ? 18 : 30) && (b.people.carrier || 0) < 12) { b.growT = 0; b.people.carrier = (b.people.carrier || 0) + 1; }
      // recruit soldiers: helper + sword + shield + beer
      b.recT = (b.recT || 0) + 1;
      if (b.recT >= 6 && (b.people.carrier || 0) > 2 && b.stock.sword > 0 && b.stock.shield > 0 && b.stock.beer > 0) {
        b.recT = 0; b.people.carrier--; b.stock.sword--; b.stock.shield--; b.stock.beer--;
        b.people.soldier = (b.people.soldier || 0) + 1; b.ranks[0]++;
        this.emit('recruit', b.node, { p: b.owner });
      }
    }
    // busy roads get a donkey
    if (Math.floor(this.time) % 60 === 0) for (const r of this.roads.values()) { if (r.traffic >= 14) r.busy = true; r.traffic = 0; }
    // tool demand decays
    for (const pl of this.players) for (const k in pl.toolDemand) pl.toolDemand[k] = Math.max(0, pl.toolDemand[k] * 0.97 - 0.01);
    // animals respawn
    if (this.animals.length < (g.n / 200) && this.rng.chance(0.05)) {
      const i = this.rng.int(g.n);
      if ((m.terrain[i] === T.MEADOW || m.terrain[i] === T.FLOWERS) && !m.obj[i] && !this.owner[i])
        this.animals.push({ id: this.id(), kind: this.rng.chance(0.6) ? 'deer' : 'rabbit', node: i, next: -1, t: 0, path: [], wait: 3, home: i });
    }
    // stats every 15 s
    if (Math.floor(this.time) % 15 === 0) this.recordStats();
  }

  recordStats() {
    for (const pl of this.players) {
      let land = 0; for (let i = 0; i < this.grid.n; i++) if (this.owner[i] === pl.id + 1) land++;
      pl.territory = land;
      let bld = 0, mil = 0, prodSum = 0, prodN = 0;
      for (const b of this.buildings.values()) {
        if (b.owner !== pl.id) continue; bld++;
        if (b.prod.length) { prodSum += b.prod.reduce((a, c) => a + c, 0) / b.prod.length; prodN++; }
        if (BUILDINGS[b.type].kind === 'military') for (const sid of b.soldiers) { const s = this.settlers.get(sid); if (s) mil += s.rank + 1; }
      }
      const st = this.totalStock(pl.id);
      mil += (st.wares.sword ? 0 : 0);
      for (const b of this.buildings.values()) if (b.owner === pl.id && b.ranks) b.ranks.forEach((c, r) => mil += c * (r + 1));
      let pop = 0; for (const s of this.settlers.values()) if (s.owner === pl.id) pop++;
      for (const v of Object.values(st.people)) pop += v;
      const goods = Object.values(st.wares).reduce((a, c) => a + c, 0);
      pl.stats.push({ t: Math.round(this.time), land, bld, mil, pop, goods, prod: prodN ? Math.round(prodSum / prodN * 100) : 0 });
      if (pl.stats.length > 400) pl.stats.splice(0, pl.stats.length - 400);
    }
  }

  // ------------------------------------------------------------ save/load
  serialize() {
    const m = this.map;
    const players = this.players.map(pl => Object.assign({}, pl, { explored: Array.from(pl.explored), visible: undefined }));
    return JSON.stringify({
      v: 1, setup: Object.assign({}, this.setup, { map: undefined }),
      map: { w: m.w, h: m.h, seed: m.seed, theme: m.theme, terrain: Array.from(m.terrain), height: Array.from(m.height), res: Array.from(m.res), resAmt: Array.from(m.resAmt), obj: m.obj, starts: m.starts },
      time: this.time, tickN: this.tickN, nextId: this.nextId, rng: this.rng.s,
      owner: Array.from(this.owner), roadAt: Array.from(this.roadAt),
      buildings: [...this.buildings.values()], flags: [...this.flags.values()], roads: [...this.roads.values()],
      settlers: [...this.settlers.values()], wares: [...this.wares.values()], animals: this.animals, players, winner: this.winner,
      mission: this.missionState || null,
    });
  }
  static deserialize(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    const m = d.map;
    const map = { w: m.w, h: m.h, seed: m.seed, theme: m.theme, terrain: Uint8Array.from(m.terrain), height: Uint8Array.from(m.height), res: Uint8Array.from(m.res), resAmt: Uint8Array.from(m.resAmt), obj: m.obj, starts: m.starts, animals: d.animals };
    const setup = Object.assign({}, d.setup, { map });
    const game = Object.create(Game.prototype);
    game.setup = setup; game.map = map; game.grid = new Grid(m.w, m.h);
    game.rng = new RNG(1); game.rng.s = d.rng;
    game.time = d.time; game.tickN = d.tickN; game.nextId = d.nextId;
    game.owner = Uint8Array.from(d.owner); game.roadAt = Int32Array.from(d.roadAt);
    game.buildings = new Map(d.buildings.map(b => [b.id, b])); game.flags = new Map(d.flags.map(f => [f.id, f]));
    game.roads = new Map(d.roads.map(r => [r.id, r])); game.settlers = new Map(d.settlers.map(s => [s.id, s]));
    game.wares = new Map(d.wares.map(w => [w.id, w])); game.animals = d.animals;
    delete map.animals;
    game.netVersion = 1; game._route = new Map(); game.terrVersion = 1; game.objVersion = 1; game.roadVersion = 1;
    game.events = []; game.projectiles = []; game.winner = d.winner ?? -1;
    game.players = d.players.map(pl => Object.assign(pl, { explored: Uint8Array.from(pl.explored), visible: new Uint8Array(m.w * m.h) }));
    game.missionState = d.mission;
    game.updateVision(true);
    return game;
  }
}

export function maxHp(rank) { return [3, 4, 5, 6, 8][rank] * 4; }
export { RES, SEA };
