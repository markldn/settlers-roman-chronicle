// Territory, garrisons, promotions, attacks, 1-on-1 combat and catapults.
import { BUILDINGS, RANKS } from './data.js';
import * as L from './logistics.js';

const maxHp = (rank) => RANKS[rank].hp * 4;

export function isMilitary(b) { const k = BUILDINGS[b.type].kind; return k === 'military' || b.type === 'hq'; }

export function recomputeTerritory(game) {
  const g = game.grid, own = game.owner;
  for (let pass = 0; pass < 4; pass++) {
    own.fill(0);
    const mil = [...game.buildings.values()].filter(b => b.state === 'done' && isMilitary(b) && b.occupied).sort((a, b) => a.claimTime - b.claimTime);
    // every garrison keeps its own node and ring
    for (const b of mil) for (const j of g.within(b.node, 1)) own[j] = b.owner + 1;
    for (const b of mil) {
      const r = BUILDINGS[b.type].radius;
      for (const j of g.within(b.node, r)) if (!own[j]) own[j] = b.owner + 1;
    }
    // anything now standing on foreign land burns
    let milLost = false;
    for (const b of [...game.buildings.values()]) {
      if (own[b.node] === b.owner + 1) continue;
      if (b.state === 'done' && isMilitary(b) && b.occupied) milLost = true;
      game.destroyBuilding(b.id, 'territory');
    }
    for (const f of [...game.flags.values()]) if (own[f.node] !== f.owner + 1) game.destroyFlag(f.id);
    for (const r of [...game.roads.values()]) if (r.nodes.some(n => own[n] !== r.owner + 1)) game.removeRoad(r.id);
    if (!milLost) break;
  }
  game.terrVersion++;
}

export function availableAttackers(game, p, target) {
  const out = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p || b.state !== 'done' || BUILDINGS[b.type].kind !== 'military' || !b.occupied) continue;
    const d = game.grid.dist(b.node, target.node);
    if (d > BUILDINGS[b.type].radius + 9) continue;
    const spare = b.soldiers.length - (game.players[p].attackReserve ?? 1);
    for (let k = 0; k < spare; k++) out.push({ b, sid: b.soldiers[b.soldiers.length - 1 - k], d });
  }
  out.sort((x, y) => x.d - y.d);
  return out;
}

export function canAttack(game, p, target) {
  if (!target || target.owner === p || target.state !== 'done' || !isMilitary(target) || !target.occupied) return false;
  if (game.players[target.owner].team === game.players[p].team) return false;
  return true;
}

export function attack(game, p, targetId, count) {
  const target = game.buildings.get(targetId);
  if (!canAttack(game, p, target)) return 0;
  const av = availableAttackers(game, p, target).slice(0, count);
  const tflag = game.flags.get(target.flag);
  let sent = 0;
  for (const { b, sid } of av) {
    const s = game.settlers.get(sid); if (!s) continue;
    b.soldiers.splice(b.soldiers.indexOf(sid), 1);
    s.inside = false; s.node = b.node; s.next = -1; s.t = 0;
    const path = L.findWalkPath(game, s.node, tflag.node, { adjacentOk: true, allow: b.node, max: 12000 });
    if (!path) { b.soldiers.push(sid); s.inside = true; continue; }
    s.path = path; s.state = 'attack'; s.target = targetId; s.home = b.id; sent++;
  }
  if (sent) {
    target.underAttack = game.time;
    game.emit('attackLaunched', target.node, { p, target: target.owner });
    if (game.players[target.owner].human) game.message(target.owner, `${BUILDINGS[target.type].name} is under attack!`, target.node, 'war');
  }
  return sent;
}

function returnToBase(game, s) {
  const home = game.buildings.get(s.home);
  if (home && home.owner === s.owner && home.state === 'done' && BUILDINGS[home.type].kind === 'military') {
    const path = L.findWalkPath(game, s.node, home.node, { allow: home.node, max: 12000 });
    if (path) { s.path = path; s.next = -1; s.state = 'returnBase'; s.target = 0; return; }
  }
  game.sendHome(s);
}

function occupy(game, b, s) {
  b.soldiers.push(s.id); s.inside = true; s.state = 'garrison'; s.home = b.id; s.path = []; s.next = -1;
  if (!b.occupied) {
    b.occupied = true; b.claimTime = game.time;
    recomputeTerritory(game);
    game.emit('occupied', b.node, { p: b.owner });
    if (game.players[b.owner].human) game.message(b.owner, `${BUILDINGS[b.type].name} occupied — new land!`, b.node, 'build');
  }
}

export function soldierUpdate(game, s, dt) {
  // movement for all soldier states except fighting
  if (s.state !== 'fight' && s.state !== 'fightD') {
    const arrived = moveSoldier(game, s, dt);
    if (!arrived) return;
  }
  const b = game.buildings.get(s.home);
  switch (s.state) {
    case 'toPost':
      if (!b || b.owner !== s.owner) { if (b) b.soldiersComing = Math.max(0, b.soldiersComing - 1); game.sendHome(s); return; }
      s.path = [b.node]; s.state = 'enterPost'; return;
    case 'enterPost':
      if (!b || b.owner !== s.owner || s.node !== b.node) { if (b) b.soldiersComing = Math.max(0, b.soldiersComing - 1); game.sendHome(s); return; }
      b.soldiersComing = Math.max(0, b.soldiersComing - 1);
      if (b.soldiers.length >= BUILDINGS[b.type].soldiers) { game.sendHome(s); return; }
      occupy(game, b, s); return;
    case 'returnBase':
      if (!b || b.owner !== s.owner || s.node !== b.node || b.soldiers.length >= BUILDINGS[b.type].soldiers) { game.sendHome(s); return; }
      occupy(game, b, s); return;
    case 'attack': {
      const t = game.buildings.get(s.target);
      if (!t || t.owner === s.owner || t.state !== 'done') { returnToBase(game, s); return; }
      s.state = 'siege'; s.timer = 0; return;
    }
    case 'siege': {
      const t = game.buildings.get(s.target);
      if (!t || t.owner === s.owner || t.state !== 'done') { returnToBase(game, s); return; }
      s.anim = 'idle';
      const tflag = game.flags.get(t.flag);
      if (t.defender) {
        const d = game.settlers.get(t.defender);
        if (!d) { t.defender = 0; return; }
        if (!d.opponent && d.state === 'defend' && !s.opponent) {
          // step next to the defender and fight
          startFight(game, s, d); return;
        }
        return;
      }
      if (t.soldiers.length > 0 || (t.people && t.people.soldier > 0)) {
        // send out a defender (warehouses draw from their stored soldiers, strongest first)
        let d;
        if (t.soldiers.length) { d = game.settlers.get(t.soldiers.pop()); }
        else {
          let rk = 4; while (rk > 0 && !(t.ranks[rk] > 0)) rk--;
          t.ranks[rk] = Math.max(0, (t.ranks[rk] || 0) - 1); t.people.soldier--;
          d = game.spawnSettler(t.owner, 'soldier', t.node, rk); d.home = t.id;
        }
        if (!d) return;
        d.inside = false; d.node = tflag ? tflag.node : t.node; d.next = -1; d.t = 0; d.path = []; d.state = 'defend'; d.target = t.id;
        t.defender = d.id;
        return;
      }
      // nobody left inside: walk in and take it
      if (!t.capturing) { t.capturing = s.id; s.path = [t.node]; if (s.node !== (tflag && tflag.node)) { const p = L.findWalkPath(game, s.node, t.node, { allow: t.node, max: 3000 }); s.path = p || [t.node]; } s.state = 'capture'; }
      return;
    }
    case 'capture': {
      const t = game.buildings.get(s.target);
      if (!t || t.owner === s.owner) { returnToBase(game, s); return; }
      t.capturing = 0;
      if (t.soldiers.length || t.defender) { s.state = 'siege'; return; }
      capture(game, s, t); return;
    }
    case 'defend': {
      s.anim = 'idle'; s.timer = (s.timer || 0) + dt;
      if (s.timer < 3) return;
      s.timer = 0;
      const tid = s.target;
      let enemies = false;
      for (const o of game.settlers.values()) if (o.target === tid && o.owner !== s.owner && (o.state === 'siege' || o.state === 'attack' || o.state === 'fight' || o.state === 'capture')) { enemies = true; break; }
      if (!enemies) { const t = game.buildings.get(tid); s.path = t ? [t.node] : []; s.next = -1; s.state = 'returnPost'; if (!t) game.sendHome(s); }
      return;
    }
    case 'returnPost': {
      const t = game.buildings.get(s.home);
      if (!t || t.owner !== s.owner) { game.sendHome(s); return; }
      if (t.defender === s.id) t.defender = 0;
      if (t.stock) { game.enterWarehouse(s, t); return; }
      s.inside = true; s.state = 'garrison'; t.soldiers.push(s.id); s.path = []; return;
    }
    case 'garrison': return;
    default: game.sendHome(s);
  }
}

function moveSoldier(game, s, dt) {
  // reuse the generic mover without importing jobs.js (avoids a cycle)
  if (s.next < 0) { if (!s.path.length) return true; s.next = s.path.shift(); }
  const m = game.map, sp = 1.45;
  while (dt > 0 && s.next >= 0) {
    const dh = m.height[s.next] - m.height[s.node];
    const cost = 1 + Math.max(0, dh) * 0.16;
    const need = (1 - s.t) * cost / sp;
    if (dt < need) { s.t += dt * sp / cost; dt = 0; }
    else { dt -= need; s.face = game.grid.dirTo(s.node, s.next); s.node = s.next; s.t = 0; s.next = s.path.length ? s.path.shift() : -1; }
  }
  if (s.next >= 0) { const d = game.grid.dirTo(s.node, s.next); if (d >= 0) s.face = d; }
  s.anim = 'walk';
  return s.next < 0 && !s.path.length;
}

function startFight(game, a, d) {
  a.opponent = d.id; d.opponent = a.id;
  a.state = 'fight'; d.state = 'fightD';
  // face each other; the attacker stands on a neighbouring node
  const g = game.grid;
  if (a.node === d.node || g.dist(a.node, d.node) > 1) {
    for (let k = 0; k < 6; k++) { const j = g.neighbor(d.node, k); if (j >= 0 && L.walkable(game, j)) { a.node = j; break; } }
  }
  a.next = -1; a.path = []; a.t = 0;
  a.face = g.dirTo(a.node, d.node); d.face = g.dirTo(d.node, a.node);
  game.fights = game.fights || [];
  game.fights.push({ a: a.id, d: d.id, t: 0, turn: 0 });
  game.emit('fightStart', d.node, { p: a.owner });
}

function capture(game, s, t) {
  const old = t.owner, def = BUILDINGS[t.type];
  const oldPl = game.players[old], pl = game.players[s.owner];
  if (def.kind === 'warehouse' || t.type === 'hq') {
    game.emit('capture', t.node, { p: s.owner, from: old });
    game.message(s.owner, `Enemy ${def.name} destroyed!`, t.node, 'war');
    if (oldPl.human) game.message(old, `Your ${def.name} has been destroyed!`, t.node, 'war');
    // any soldiers stored inside are lost
    game.destroyBuilding(t.id, 'captured');
    recomputeTerritory(game);
    game.checkDefeat(old);
    returnToBase(game, s);
    return;
  }
  // take over the building
  const f = game.flags.get(t.flag);
  if (f) {
    for (let d = 0; d < 6; d++) if (f.roads[d]) game.removeRoad(f.roads[d]);
    for (const wid of f.wares.slice()) { const w = game.wares.get(wid); if (w) game.destroyWare(w); }
    f.owner = s.owner;
  }
  t.owner = s.owner; t.inputs = {}; t.inbound = {}; t.soldiersComing = 0; t.defender = 0; t.soldiers = []; t.claimTime = game.time; t.occupied = true;
  for (const w of game.wares.values()) if (w.dest === t.id) w.dest = 0;
  s.inside = true; s.home = t.id; s.state = 'garrison'; t.soldiers.push(s.id);
  game.emit('capture', t.node, { p: s.owner, from: old });
  if (pl.human) game.message(s.owner, `${def.name} conquered!`, t.node, 'war');
  if (oldPl.human) game.message(old, `Your ${def.name} was conquered!`, t.node, 'war');
  recomputeTerritory(game);
  game.checkDefeat(old);
  // other besiegers of the same building move in (up to capacity) or go back
  for (const o of game.settlers.values()) {
    if (o.owner !== s.owner || o.target !== t.id || o.id === s.id) continue;
    if (o.state !== 'siege' && o.state !== 'attack') continue;
    if (t.soldiers.length < def.soldiers) { o.home = t.id; const p = L.findWalkPath(game, o.node, t.node, { allow: t.node, max: 3000 }); o.path = p || [t.node]; o.next = -1; o.state = 'returnBase'; }
    else returnToBase(game, o);
  }
}

export function updateMilitary(game, dt) {
  // fights
  const fights = game.fights || (game.fights = []);
  for (let i = fights.length - 1; i >= 0; i--) {
    const f = fights[i];
    const a = game.settlers.get(f.a), d = game.settlers.get(f.d);
    if (!a || !d) {
      fights.splice(i, 1);
      if (a) { a.opponent = 0; a.state = 'siege'; }
      if (d) { d.opponent = 0; d.state = 'defend'; }
      continue;
    }
    a.anim = 'fight'; d.anim = 'fight';
    f.t += dt;
    if (f.t < 0.9) continue;
    f.t = 0; f.turn ^= 1;
    const atk = f.turn ? a : d, vic = f.turn ? d : a;
    const R = RANKS[atk.rank], V = RANKS[vic.rank];
    atk.swing = game.time;
    if (game.rng.next() > V.def + 0.15) {
      const dmg = R.atk[0] + game.rng.int(R.atk[1] - R.atk[0] + 1);
      vic.hp -= dmg * 2;
      game.emit('hit', vic.node, { p: vic.owner });
    } else game.emit('parry', vic.node, { p: vic.owner });
    if (vic.hp <= 0) {
      fights.splice(i, 1);
      game.emit('death', vic.node, { p: vic.owner, rank: vic.rank });
      game.players[atk.owner].killed++; game.players[vic.owner].lost++;
      const tb = game.buildings.get(d.target || d.home);
      if (vic === d) { if (tb && tb.defender === d.id) tb.defender = 0; }
      game.corpses = game.corpses || [];
      game.corpses.push({ node: vic.node, owner: vic.owner, face: vic.face, t: game.time });
      game.settlers.delete(vic.id);
      atk.opponent = 0;
      if (atk === a) { a.state = 'siege'; a.anim = 'idle'; }
      else {
        // defender won: go back in
        d.state = 'returnPost'; d.path = tb ? [tb.node] : []; d.next = -1; d.t = 0;
      }
    }
  }
  if (game.corpses) game.corpses = game.corpses.filter(c => game.time - c.t < 20);

  // once per second: healing, promotions, catapults
  if (game.tickN % 20 !== 3) return;
  for (const b of game.buildings.values()) {
    if (b.state !== 'done') continue;
    const def = BUILDINGS[b.type];
    if (def.kind === 'military') {
      for (const sid of b.soldiers) { const s = game.settlers.get(sid); if (s && s.hp < maxHp(s.rank) && game.tickN % 80 === 3) s.hp++; }
      if ((b.inputs.coins || 0) > 0 && game.players[b.owner].promote) {
        b.promoT = (b.promoT || 0) + 1;
        if (b.promoT >= 15) {
          let low = null; for (const sid of b.soldiers) { const s = game.settlers.get(sid); if (s && s.rank < 4 && (!low || s.rank < low.rank)) low = s; }
          if (low) { b.promoT = 0; b.inputs.coins--; low.rank++; low.hp = maxHp(low.rank); game.emit('promote', b.node, { p: b.owner, rank: low.rank }); }
        }
      }
      // under-attack flag expires
      if (b.underAttack && game.time - b.underAttack > 30) b.underAttack = 0;
    } else if (def.kind === 'catapult' && b.worker) {
      const w = game.settlers.get(b.worker);
      if (!w || !w.inside || (b.inputs.stones || 0) <= 0 || b.stopped) continue;
      b.catT = (b.catT || 0) + 1;
      if (b.catT < def.work) continue;
      let best = null, bd = 1e9;
      for (const t of game.buildings.values()) {
        if (t.owner === b.owner || t.state !== 'done' || BUILDINGS[t.type].kind !== 'military' || !t.occupied) continue;
        if (game.players[t.owner].team === game.players[b.owner].team) continue;
        const d = game.grid.dist(t.node, b.node); if (d <= def.range && d < bd) { bd = d; best = t; }
      }
      if (!best) continue;
      b.catT = 0; b.inputs.stones--;
      game.emit('catapult', b.node, { p: b.owner, to: best.node });
      const tid = best.id;
      game.projectiles.push({ from: b.node, to: best.node, t: 0, dur: 1.6, kind: 'stone', onHit: () => {
        game.emit('impact', best.node, {});
        const t = game.buildings.get(tid); if (!t || t.soldiers.length <= 1) return;
        if (game.rng.chance(0.5)) { const sid = t.soldiers.pop(); game.settlers.delete(sid); game.emit('death', t.node, { p: t.owner }); game.players[t.owner].lost++; }
      } });
    }
  }
}
