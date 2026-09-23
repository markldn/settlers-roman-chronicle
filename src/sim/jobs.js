// Settler behaviour: movement along node paths and one state machine per profession.
import { DIR } from './grid.js';
import { BUILDINGS, TERRAIN_INFO, TERRAIN as T, FOODS, TOOLS, DEFAULT_TRANSPORT } from './data.js';
import { RES } from './mapgen.js';
import * as L from './logistics.js';
import { soldierUpdate } from './military.js';

const SPEED = { carrier: 1.35, donkey: 1.7, soldier: 1.45, scout: 1.5, geologist: 1.3 };

// advance along s.path; returns true when the settler is standing still at the end of its path
export function move(game, s, dt) {
  if (s.next < 0) {
    if (!s.path.length) return true;
    s.next = s.path.shift();
  }
  const m = game.map;
  let sp = SPEED[s.job] || 1.3;
  if (s.carry || s.carryType) sp *= 0.88;
  while (dt > 0 && s.next >= 0) {
    const dh = m.height[s.next] - m.height[s.node];
    const cost = 1 + Math.max(0, dh) * 0.16 + Math.max(0, -dh) * 0.04;
    const need = (1 - s.t) * cost / sp;
    if (dt < need) { s.t += dt * sp / cost; dt = 0; }
    else {
      dt -= need; s.face = game.grid.dirTo(s.node, s.next);
      s.node = s.next; s.t = 0;
      s.next = s.path.length ? s.path.shift() : -1;
      if (s.next >= 0) s.face = game.grid.dirTo(s.node, s.next);
    }
  }
  if (s.next >= 0) { const d = game.grid.dirTo(s.node, s.next); if (d >= 0) s.face = d; }
  return s.next < 0 && !s.path.length;
}

export function walkTo(s, path) { s.path = path ? path.slice() : []; if (s.next < 0 && s.path.length) s.next = -1; }

export function updateSettler(game, s, dt) {
  if (s.inside) return insideUpdate(game, s, dt);
  if (s.job === 'soldier' && s.state !== 'goHome' && s.state !== 'toPost' && s.state !== 'enterPost' && s.state !== 'lost') { soldierUpdate(game, s, dt); return; }
  const arrived = move(game, s, dt);
  if (!arrived) return;
  switch (s.state) {
    case 'goHome': return arriveHome(game, s);
    case 'lost': s.timer += dt; if (s.timer > 5) { s.timer = 0; game.sendHome(s); if (s.state === 'lost' && (s.lostT = (s.lostT || 0) + 5) > 90) game.removeSettler(s); } return;
  }
  if (s.job === 'carrier' || s.job === 'donkey') return carrierUpdate(game, s, dt);
  if (s.job === 'builder') return builderUpdate(game, s, dt);
  if (s.job === 'geologist' || s.job === 'scout') return explorerUpdate(game, s, dt);
  if (s.job === 'soldier') return soldierUpdate(game, s, dt);
  return workerOutsideUpdate(game, s, dt);
}

function arriveHome(game, s) {
  const wh = game.buildings.get(s.target);
  if (wh && wh.state === 'done' && wh.stock && wh.owner === s.owner && s.node === wh.node) { game.enterWarehouse(s, wh); return; }
  game.sendHome(s);
  if (s.state === 'goHome' && !s.path.length) s.state = 'lost';
}

// the settler reached a building's flag and now steps inside (1 edge NW of the flag)
function stepIn(game, s, b) { walkTo(s, [b.node]); }

// ------------------------------------------------------------------ carriers
function roadPathTo(r, from, to) {
  const i = r.nodes.indexOf(from), j = r.nodes.indexOf(to);
  if (i < 0 || j < 0) return null;
  const out = [];
  if (i < j) for (let k = i + 1; k <= j; k++) out.push(r.nodes[k]);
  else for (let k = i - 1; k >= j; k--) out.push(r.nodes[k]);
  return out;
}

function prioIndex(game, p, type) { const i = game.players[p].transport.indexOf(type); return i < 0 ? 99 : i; }

function findCarrierJob(game, s, r) {
  let best = null, bk = Infinity;
  for (const fid of [r.a, r.b]) {
    const f = game.flags.get(fid); if (!f) continue;
    for (const wid of f.wares) {
      const w = game.wares.get(wid); if (!w || w.reserved || !w.dest) continue;
      const dest = game.buildings.get(w.dest); if (!dest) continue;
      let ok = false;
      if (dest.flag === fid) ok = true; // carry-in job
      else ok = L.nextHop(game, fid, dest.flag) === r.id;
      if (!ok) continue;
      let k = prioIndex(game, s.owner, w.type) + (s.node === f.node ? -0.5 : 0);
      if (k < bk) { bk = k; best = { w, fid }; }
    }
  }
  return best;
}

function carrierUpdate(game, s, dt) {
  const r = game.roads.get(s.road);
  if (!r) { game.sendHome(s); return; }
  const mid = r.nodes[r.nodes.length >> 1];
  switch (s.state) {
    case 'toRoad': {
      if (!r.nodes.includes(s.node)) { const p = L.findWalkPath(game, s.node, mid); if (p) walkTo(s, p); else game.sendHome(s); s.state = 'toMid'; return; }
      walkTo(s, roadPathTo(r, s.node, mid)); s.state = 'toMid'; return;
    }
    case 'toMid': s.state = 'idle'; s.timer = 0; return;
    case 'idle': {
      s.anim = 'idle';
      const job = findCarrierJob(game, s, r);
      if (job) {
        job.w.reserved = s.id; s.task = { ware: job.w.id, from: job.fid };
        const fnode = game.flags.get(job.fid).node;
        if (!r.nodes.includes(s.node)) { const p = L.findWalkPath(game, s.node, fnode); walkTo(s, p || []); }
        else walkTo(s, roadPathTo(r, s.node, fnode));
        s.state = 'toPickup'; return;
      }
      if (s.node !== mid) {
        if (r.nodes.includes(s.node)) walkTo(s, roadPathTo(r, s.node, mid));
        else { const p = L.findWalkPath(game, s.node, mid); walkTo(s, p || []); }
      }
      return;
    }
    case 'toPickup': {
      const w = game.wares.get(s.task.ware), f = game.flags.get(s.task.from);
      if (!w || !f || w.flag !== f.id) { if (w && w.reserved === s.id) w.reserved = 0; s.state = 'idle'; return; }
      f.wares.splice(f.wares.indexOf(w.id), 1);
      w.flag = 0; w.carrier = s.id; w.reserved = 0; s.carry = w.id;
      game.emit('pickup', f.node, { p: s.owner });
      const dest = game.buildings.get(w.dest);
      if (dest && dest.flag === f.id) { stepIn(game, s, dest); s.state = 'enterBld'; s.task.flag = f.id; return; }
      const other = r.a === f.id ? r.b : r.a;
      walkTo(s, roadPathTo(r, s.node, game.flags.get(other).node));
      s.task.to = other; s.state = 'delivering'; r.traffic++;
      return;
    }
    case 'delivering': {
      const w = game.wares.get(s.carry), f = game.flags.get(s.task.to);
      if (!w) { s.carry = 0; s.state = 'idle'; return; }
      if (!f) { game.destroyWare(w); s.carry = 0; s.state = 'idle'; return; }
      const dest = w.dest && game.buildings.get(w.dest);
      if (dest && dest.flag === f.id) { stepIn(game, s, dest); s.state = 'enterBld'; s.task.flag = f.id; return; }
      s.state = 'waitDrop'; s.timer = 0;
      // fallthrough into waitDrop immediately
    }
    // eslint-disable-next-line no-fallthrough
    case 'waitDrop': {
      const w = game.wares.get(s.carry), f = game.flags.get(s.task.to);
      if (!w || !f) { s.carry = 0; s.state = 'idle'; return; }
      s.timer += dt;
      // swap: another ware at this flag wants to go back along this road
      const back = f.wares.length >= 8 && findBackWare(game, s, r, f);
      if (f.wares.length < 8 || s.timer > 8 || back) {
        w.flag = f.id; w.carrier = 0; w.since = game.time; f.wares.push(w.id); s.carry = 0;
        game.emit('drop', f.node, { p: s.owner });
        s.state = 'idle';
        const job = findCarrierJob(game, s, r);
        if (job && job.fid === f.id) { job.w.reserved = s.id; s.task = { ware: job.w.id, from: f.id }; s.state = 'toPickup'; }
      }
      return;
    }
    case 'enterBld': {
      const w = game.wares.get(s.carry); const b = w && game.buildings.get(w.dest);
      if (w && b && s.node === b.node) deliverToBuilding(game, b, w);
      else if (w) { const f = game.flags.get(s.task.flag); if (f) { w.flag = f.id; w.carrier = 0; w.dest = 0; f.wares.push(w.id); } else game.destroyWare(w); }
      s.carry = 0;
      const f = game.flags.get(s.task.flag);
      walkTo(s, f ? [f.node] : []); s.state = 'exitBld';
      return;
    }
    case 'exitBld': s.state = 'idle'; return;
    default: s.state = 'idle';
  }
}

function findBackWare(game, s, r, f) {
  for (const wid of f.wares) {
    const w = game.wares.get(wid); if (!w || w.reserved || !w.dest) continue;
    const dest = game.buildings.get(w.dest); if (!dest) continue;
    if (dest.flag !== f.id && L.nextHop(game, f.id, dest.flag) === r.id) return w;
  }
  return null;
}

export function deliverToBuilding(game, b, w) {
  game.wares.delete(w.id);
  if (b.inbound[w.type]) b.inbound[w.type]--;
  if (b.state === 'site') { b.site.have[w.type] = (b.site.have[w.type] || 0) + 1; }
  else if (b.stock) { b.stock[w.type] = (b.stock[w.type] || 0) + 1; }
  else b.inputs[w.type] = (b.inputs[w.type] || 0) + 1;
  game.emit('deliver', b.node, { p: b.owner, ware: w.type });
}

// ------------------------------------------------------------------ builder
function builderUpdate(game, s, dt) {
  const b = game.buildings.get(s.home);
  if (!b || b.state !== 'site') { game.sendHome(s); return; }
  const flag = game.flags.get(b.flag);
  switch (s.state) {
    case 'toSite': stepIn(game, s, b); s.state = 'arrive'; return;
    case 'arrive': s.state = b.site.leveled ? 'build' : 'level'; s.timer = 0; return;
    case 'level':
      s.timer += dt; s.anim = 'dig';
      if (Math.floor(s.timer * 1.2) !== Math.floor((s.timer - dt) * 1.2)) game.emit('dig', b.node, { p: s.owner });
      if (s.timer > 4) { b.site.leveled = true; s.state = 'build'; s.timer = 0; }
      return;
    case 'build': {
      const need = Object.values(b.site.need).reduce((a, c) => a + c, 0) || 1;
      if (s.timer > 0) {
        s.timer -= dt; s.anim = 'hammer';
        if (Math.floor(s.timer * 1.6) !== Math.floor((s.timer + dt) * 1.6)) game.emit('hammer', b.node, { p: s.owner });
        const used = Object.values(b.site.used).reduce((a, c) => a + c, 0);
        b.site.progress = Math.min(1, (used - Math.max(0, s.timer) / 3.2) / need);
        if (s.timer <= 0 && used >= need) {
          game.finishConstruction(b);
          s.home = 0; game.sendHome(s);
        }
        return;
      }
      s.anim = 'idle';
      for (const w of ['boards', 'stones']) {
        if ((b.site.have[w] || 0) > 0) { b.site.have[w]--; b.site.used[w] = (b.site.used[w] || 0) + 1; s.timer = 3.2; return; }
      }
      if (need === 0) { game.finishConstruction(b); game.sendHome(s); }
      return;
    }
    default: s.state = 'toSite';
  }
}

// ------------------------------------------------------------------ geologist / scout
function explorerUpdate(game, s, dt) {
  const g = game.grid, m = game.map;
  const f = game.flags.get(s.target);
  switch (s.state) {
    case 'toFlag': s.state = 'pick'; s.count = 0; s.origin = s.node; return;
    case 'pick': {
      const max = s.job === 'scout' ? 8 : 10;
      if (s.count >= max) { game.sendHome(s); return; }
      s.count++;
      const R = s.job === 'scout' ? 10 : 5;
      for (let tries = 0; tries < 12; tries++) {
        const cand = g.within(s.origin, R); const n = cand[game.rng.int(cand.length)];
        if (!TERRAIN_INFO[m.terrain[n]].walk) continue;
        if (s.job === 'geologist' && m.obj[n]) continue;
        const p = L.findWalkPath(game, s.node, n, { max: 1500 });
        if (p) { walkTo(s, p); s.state = s.job === 'scout' ? 'look' : 'probe'; s.probe = n; return; }
      }
      return;
    }
    case 'look': s.timer += dt; s.anim = 'idle'; if (s.timer > 1.5) { s.timer = 0; s.state = 'pick'; } return;
    case 'probe': {
      s.timer += dt; s.anim = 'hammer';
      if (Math.floor(s.timer * 1.5) !== Math.floor((s.timer - dt) * 1.5)) game.emit('pick', s.node, { p: s.owner, soft: true });
      if (s.timer > 3.5) {
        s.timer = 0; s.state = 'pick';
        const n = s.node;
        if (!m.obj[n] && !game.roadAt[n]) {
          let r = RES.NONE, a = 0;
          if (m.terrain[n] === T.MOUNTAIN) { r = m.res[n] >= RES.COAL && m.res[n] <= RES.GRANITE ? m.res[n] : RES.NONE; a = m.resAmt[n]; }
          else if (m.res[n] === RES.WATER) { r = RES.WATER; a = m.resAmt[n]; }
          m.obj[n] = { t: 'sign', r, a: a > 10 ? 3 : a > 5 ? 2 : a > 0 ? 1 : 0, ttl: 360 };
          game.objVersion++;
          game.emit('sign', n, { p: s.owner, r });
          if (r >= RES.COAL && r <= RES.GRANITE && game.players[s.owner].human && a > 5) {
            const nm = ['', 'Coal', 'Iron ore', 'Gold', 'Granite'][r];
            const pl = game.players[s.owner]; pl.foundMsg = pl.foundMsg || {};
            const key = r + ':' + Math.floor(g.x(n) / 8) + ':' + Math.floor(g.y(n) / 8);
            if (!pl.foundMsg[key]) { pl.foundMsg[key] = 1; game.message(s.owner, `Geologist found ${nm}`, n, 'geo'); }
          }
        }
      }
      return;
    }
    default: {
      if (!f) { game.sendHome(s); return; }
      s.state = 'toFlag';
    }
  }
}

// ------------------------------------------------------------------ workers
function outputFlagHasRoom(game, b) { const f = game.flags.get(b.flag); return f && f.wares.length < 8; }

function chooseTool(game, p) {
  const pl = game.players[p];
  let best = null, bs = 0;
  for (const t of TOOLS) { const d = pl.toolDemand[t] || 0; if (d > bs) { bs = d; best = t; } }
  if (best && bs > 0.5) { pl.toolDemand[best] = Math.max(0, bs - 1); return best; }
  // weighted by priority, favouring tools with low stock
  const st = game.totalStock(p).wares;
  let sum = 0; const w = TOOLS.map(t => { const v = (pl.toolPrio[t] || 0) / (1 + (st[t] || 0)); sum += v; return v; });
  if (sum <= 0) return null;
  let r = game.rng.next() * sum;
  for (let i = 0; i < TOOLS.length; i++) { r -= w[i]; if (r <= 0) return TOOLS[i]; }
  return TOOLS[0];
}

function hasInputs(b, def) {
  for (const k of Object.keys(def.inputs || {})) {
    if (k === 'food') { if (!FOODS.some(f => (b.inputs[f] || 0) > 0)) return false; }
    else if (!(b.inputs[k] > 0)) return false;
  }
  return true;
}
function consumeInputs(b, def) {
  for (const k of Object.keys(def.inputs || {})) {
    if (k === 'food') { const f = FOODS.find(f => (b.inputs[f] || 0) > 0); b.inputs[f]--; }
    else b.inputs[k]--;
  }
}

const WORK_SFX = { sawmill: 'saw', mill: 'mill', bakery: 'oven', brewery: 'brew', slaughterhouse: 'chop', smelter: 'fire', metalworks: 'anvil', armory: 'anvil', mint: 'coin', well: 'water', pigfarm: 'pig', donkeybreeder: 'hoof', coalmine: 'pick', ironmine: 'pick', goldmine: 'pick', granitemine: 'pick' };

function insideUpdate(game, s, dt) {
  if (s.job === 'soldier') return; // garrison soldiers handled by military.js
  const b = game.buildings.get(s.home);
  if (!b) { s.inside = false; game.sendHome(s); return; }
  const def = BUILDINGS[b.type];
  if (def.kind === 'lookout' || def.kind === 'catapult') { b.work = 1; return; }
  if (s.timer > 0 && s.state !== 'working') { s.timer -= dt; return; }
  switch (def.kind) {
    case 'convert': case 'mine': {
      if (s.state === 'working') {
        b.work = 1; s.timer -= dt;
        const sfx = WORK_SFX[b.type];
        if (sfx && Math.floor(s.timer / 1.7) !== Math.floor((s.timer + dt) / 1.7)) game.emit(sfx, b.node, { p: b.owner, bld: true });
        if (s.timer > 0) return;
        let out = def.outs ? def.outs[0] : def.out;
        if (b.type === 'armory') { b.alt = (b.alt || 0) ^ 1; out = def.outs[b.alt]; }
        if (out === 'tool') out = chooseTool(game, b.owner) || 'hammer';
        if (def.kind === 'mine') {
          const n = findResource(game, b, def);
          if (n >= 0) game.map.resAmt[n]--;
          if (n < 0) { s.state = 'rest'; s.timer = 2; return; }
        }
        if (out === 'donkey') {
          const d = game.spawnSettler(b.owner, 'donkey', game.flags.get(b.flag).node);
          game.sendHome(d); s.state = 'rest'; s.timer = 1;
          game.players[b.owner].produced.donkey = (game.players[b.owner].produced.donkey || 0) + 1;
          return;
        }
        s.carryType = out; s.inside = false; walkTo(s, [game.flags.get(b.flag).node]); s.state = 'toFlagOut';
        return;
      }
      if (b.stopped) return;
      if (!outputFlagHasRoom(game, b)) { s.timer = 1; return; }
      if (!hasInputs(b, def)) { s.timer = 1; return; }
      if (def.kind === 'mine' && findResource(game, b, def) < 0) {
        if (!b.exhausted) { b.exhausted = true; if (game.players[b.owner].human) game.message(b.owner, `${def.name}: no more resources`, b.node, 'warn'); }
        s.timer = 5; return;
      }
      consumeInputs(b, def);
      s.state = 'working'; s.timer = def.work * (b.type === 'well' && game.map.res[b.node] !== RES.WATER ? 1.8 : 1);
      return;
    }
    case 'gather': case 'forester': case 'farm': {
      if (b.stopped) return;
      const t = findGatherTarget(game, s, b, def);
      if (!t) { s.timer = 3; return; }
      s.task = t;
      s.inside = false;
      walkTo(s, t.path); s.state = 'toTarget'; s.timer = 0;
      return;
    }
  }
}

function findResource(game, b, def) {
  const want = { coal: RES.COAL, iron: RES.IRON, gold: RES.GOLD, granite: RES.GRANITE }[def.res];
  const m = game.map;
  for (const j of game.grid.within(b.node, 2)) if (m.res[j] === want && m.resAmt[j] > 0) return j;
  return -1;
}

function findGatherTarget(game, s, b, def) {
  const g = game.grid, m = game.map, p = b.owner;
  const cand = g.within(b.node, def.range).sort((x, y) => g.dist(x, b.node) - g.dist(y, b.node) || ((x * 7919 + game.tickN) % 13) - ((y * 7919 + game.tickN) % 13));
  const tryPath = (n, adj) => L.findWalkPath(game, b.node, n, { allow: b.node, adjacentOk: adj, max: 2500 });
  switch (b.type) {
    case 'woodcutter':
      for (const n of cand) { const o = m.obj[n]; if (o && o.t === 'tree' && o.g >= 1 && !o.res && o.sp !== 'dead') { const path = tryPath(n, false); if (path) { o.res = s.id; return { kind: 'tree', node: n, path }; } } }
      return null;
    case 'quarry':
      for (const n of cand) { const o = m.obj[n]; if (o && o.t === 'stone' && o.a > 0) { const path = tryPath(n, true); if (path) return { kind: 'stone', node: n, path }; } }
      return null;
    case 'fishery':
      for (const n of cand) {
        if (m.terrain[n] !== T.WATER || m.res[n] !== RES.FISH || m.resAmt[n] <= 0) continue;
        const path = tryPath(n, true); if (path) return { kind: 'fish', node: n, path };
      }
      return null;
    case 'hunter': {
      let best = null, bd = 1e9;
      for (const a of game.animals) { if (a.kind === 'duck' || a.dead || a.hunted) continue; const d = g.dist(a.node, b.node); if (d <= def.range && d < bd) { bd = d; best = a; } }
      if (!best) return null;
      const path = tryPath(best.node, true); if (!path) return null;
      best.hunted = s.id;
      return { kind: 'animal', id: best.id, node: best.node, path, tries: 0 };
    }
    case 'forester':
      for (let k = 0; k < 30; k++) {
        const n = cand[game.rng.int(cand.length)];
        if (m.obj[n] || game.roadAt[n] || !TERRAIN_INFO[m.terrain[n]].trees || game.owner[n] !== p + 1) continue;
        let near = false; for (let d = 0; d < 6; d++) { const j = g.neighbor(n, d); const o = j >= 0 && m.obj[j]; if (o && (o.t === 'bld' || o.t === 'flag' || o.t === 'foot')) near = true; }
        if (near) continue;
        const path = tryPath(n, false); if (path) return { kind: 'plant', node: n, path };
      }
      return null;
    case 'farm': {
      let fields = 0;
      for (const n of cand) { const o = m.obj[n]; if (o && o.t === 'field') { fields++; if (o.g >= 1 && !o.res) { const path = tryPath(n, false); if (path) { o.res = s.id; return { kind: 'harvest', node: n, path }; } } } }
      if (fields >= 8) return null;
      for (const n of cand) {
        if (n === b.node || m.obj[n] || game.roadAt[n] || !TERRAIN_INFO[m.terrain[n]].build || game.owner[n] !== p + 1) continue;
        let near = false; for (let d = 0; d < 6; d++) { const j = g.neighbor(n, d); const o = j >= 0 && m.obj[j]; if (o && o.t === 'flag') near = true; }
        if (near) continue;
        const path = tryPath(n, false); if (path) return { kind: 'sow', node: n, path };
      }
      return null;
    }
  }
  return null;
}

function workerOutsideUpdate(game, s, dt) {
  const b = game.buildings.get(s.home);
  const m = game.map;
  if (s.state === 'toWork') {
    if (!b) { game.sendHome(s); return; }
    stepIn(game, s, b); s.state = 'enterWork'; return;
  }
  if (s.state === 'enterWork') {
    if (!b || s.node !== b.node) { game.sendHome(s); return; }
    s.inside = true; s.state = 'rest'; s.timer = 1;
    if (b.type === 'lookout' || b.type === 'catapult') b.work = 1;
    return;
  }
  if (!b) { if (s.task && s.task.kind === 'tree') { const o = m.obj[s.task.node]; if (o && o.res === s.id) o.res = 0; } game.sendHome(s); return; }
  const def = BUILDINGS[b.type];
  switch (s.state) {
    case 'toFlagOut': {
      const f = game.flags.get(b.flag);
      if (!f) { game.sendHome(s); return; }
      if (f.wares.length >= 8) { s.anim = 'idle'; return; }
      if (s.carryType) {
        game.createWare(b.owner, s.carryType, f.id, 0);
        const pl = game.players[b.owner]; pl.produced[s.carryType] = (pl.produced[s.carryType] || 0) + 1;
        game.emit('produce', f.node, { p: b.owner, ware: s.carryType });
        s.carryType = null;
      }
      walkTo(s, [b.node]); s.state = 'backIn'; return;
    }
    case 'backIn': s.inside = true; s.state = 'rest'; s.timer = def.rest || 1.5; return;
    case 'toTarget': {
      const t = s.task;
      if (t.kind === 'animal') {
        const a = game.animals.find(x => x.id === t.id);
        if (!a || a.dead) { goBack(game, s, b); return; }
        if (game.grid.dist(a.node, s.node) > 2) {
          if (++t.tries > 4) { a.hunted = 0; goBack(game, s, b); return; }
          const p = L.findWalkPath(game, s.node, a.node, { adjacentOk: true, max: 2000 }); if (!p) { a.hunted = 0; goBack(game, s, b); return; }
          walkTo(s, p); return;
        }
        s.face = faceDir(game, s.node, a.node);
        a.dead = true; a.deadT = 0; a.path = []; a.next = -1; a.t = 0;
        game.emit('bow', s.node, { p: s.owner });
        s.state = 'work'; s.timer = def.work; return;
      }
      s.face = faceDir(game, s.node, t.node);
      s.state = 'work'; s.timer = def.work;
      if (t.kind === 'plant' || t.kind === 'sow') s.timer = 4;
      if (t.kind === 'harvest') s.timer = 5;
      return;
    }
    case 'work': {
      const t = s.task;
      s.timer -= dt;
      const sfx = { tree: 'chop', stone: 'pick', fish: 'fish', animal: 'cut', plant: 'dig', sow: 'sow', harvest: 'scythe' }[t.kind];
      s.anim = { tree: 'chop', stone: 'hammer', fish: 'fish', animal: 'kneel', plant: 'dig', sow: 'sow', harvest: 'scythe' }[t.kind];
      if (Math.floor(s.timer / 0.9) !== Math.floor((s.timer + dt) / 0.9)) game.emit(sfx, t.node, { p: s.owner });
      b.work = 1;
      if (s.timer > 0) return;
      s.anim = 'walk';
      const o = m.obj[t.node];
      switch (t.kind) {
        case 'tree':
          if (o && o.t === 'tree') { m.obj[t.node] = null; game.objVersion++; game.emit('treeFall', t.node, { p: s.owner, sp: o.sp, v: o.v, face: s.face }); s.carryType = 'wood'; }
          break;
        case 'stone':
          if (o && o.t === 'stone') { o.a--; if (o.a <= 0) m.obj[t.node] = null; game.objVersion++; s.carryType = 'stones'; }
          break;
        case 'fish':
          if (m.resAmt[t.node] > 0 && game.rng.chance(0.8)) { m.resAmt[t.node]--; s.carryType = 'fish'; game.emit('splash', t.node, {}); }
          break;
        case 'animal': {
          const i = game.animals.findIndex(x => x.id === t.id);
          if (i >= 0) game.animals.splice(i, 1);
          s.carryType = 'meat'; break;
        }
        case 'plant':
          if (!m.obj[t.node] && !game.roadAt[t.node]) { m.obj[t.node] = { t: 'tree', sp: plantSpecies(game, t.node), g: 0.05, v: game.rng.int(1000) }; game.objVersion++; }
          break;
        case 'sow':
          if (!m.obj[t.node] && !game.roadAt[t.node]) { m.obj[t.node] = { t: 'field', g: 0, v: game.rng.int(1000) }; game.objVersion++; }
          break;
        case 'harvest':
          if (o && o.t === 'field') { m.obj[t.node] = null; game.objVersion++; s.carryType = 'grain'; }
          break;
      }
      goBack(game, s, b);
      return;
    }
    case 'return': {
      if (s.node !== b.node) { goBack(game, s, b); return; }
      if (s.carryType) { walkTo(s, [game.flags.get(b.flag).node]); s.state = 'toFlagOut'; return; }
      s.inside = true; s.state = 'rest'; s.timer = def.rest || 3; return;
    }
    default:
      goBack(game, s, b);
  }
}

function plantSpecies(game, n) {
  const th = game.map.theme, t = game.map.terrain[n];
  const opts = th === 'winter' ? ['pine', 'fir', 'birch'] : th === 'wasteland' ? ['palm', 'pine'] : t === T.MOUNTAIN_MEADOW ? ['pine', 'fir'] : ['oak', 'pine', 'birch', 'beech', 'fir'];
  return opts[game.rng.int(opts.length)];
}

function faceDir(game, from, to) { const d = game.grid.dirTo(from, to); if (d >= 0) return d; const g = game.grid; const dx = g.wx(to) - g.wx(from), dz = g.wz(to) - g.wz(from); const a = Math.atan2(dz, dx); return ((Math.round(a / (Math.PI / 3)) % 6) + 6) % 6; }

function goBack(game, s, b) {
  const p = L.findWalkPath(game, s.node, b.node, { allow: b.node, max: 4000 });
  if (!p) { game.sendHome(s); return; }
  walkTo(s, p); s.state = 'return';
}

// ------------------------------------------------------------------ animals
export function updateAnimal(game, a, dt) {
  if (a.dead) { a.deadT = (a.deadT || 0) + dt; return; }
  if (a.next >= 0 || a.path.length) {
    const sp = a.kind === 'rabbit' ? 1.6 : a.kind === 'duck' ? 0.5 : 1.2;
    if (a.next < 0) a.next = a.path.shift();
    a.t += dt * sp;
    if (a.t >= 1) { a.face = game.grid.dirTo(a.node, a.next); a.node = a.next; a.t = 0; a.next = a.path.length ? a.path.shift() : -1; }
    if (a.next >= 0) { const d = game.grid.dirTo(a.node, a.next); if (d >= 0) a.face = d; }
    return;
  }
  a.wait -= dt;
  if (a.wait > 0) return;
  a.wait = 2 + game.rng.next() * 8;
  const g = game.grid, m = game.map;
  let n = a.node;
  const steps = 1 + game.rng.int(4);
  for (let k = 0; k < steps; k++) {
    const j = g.neighbor(n, game.rng.int(6)); if (j < 0) break;
    const water = m.terrain[j] === T.WATER;
    if (a.kind === 'duck' ? !water : (!TERRAIN_INFO[m.terrain[j]].walk || (m.obj[j] && m.obj[j].t !== 'tree' && m.obj[j].t !== 'sign'))) break;
    if (g.dist(j, a.home) > 7) break;
    a.path.push(j); n = j;
  }
}
