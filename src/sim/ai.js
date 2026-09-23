// Computer opponent: grows an economy in a sensible order, expands with military buildings,
// keeps roads short (flags every 2 nodes) and attacks weak enemy buildings.
import { BUILDINGS, SIZE_RANK, TERRAIN as T, TERRAIN_INFO, FOODS } from './data.js';
import { RES } from './mapgen.js';
import * as L from './logistics.js';
import { attack, availableAttackers, canAttack } from './military.js';

const LEVEL = {
  easy:   { think: 4.0, maxSites: 2, attackAfter: 1500, aggression: 0.5, milEvery: 70 },
  normal: { think: 2.5, maxSites: 3, attackAfter: 900, aggression: 1.0, milEvery: 45 },
  hard:   { think: 1.5, maxSites: 5, attackAfter: 600, aggression: 1.6, milEvery: 30 },
};

export function aiTick(game, p) {
  const pl = game.players[p];
  if (!pl.alive || !pl.ai) return;
  const lv = LEVEL[pl.ai] || LEVEL.normal;
  const st = pl.aiState || (pl.aiState = { next: game.time + 2 + p, lastMil: -999, lastAttack: 0, fails: {} });
  if (game.time < st.next) return;
  st.next = game.time + lv.think;
  const ctx = context(game, p);
  if (!ctx.hq) return;
  maintainRoads(game, p, ctx);
  cleanup(game, p, ctx);
  if (ctx.sites < lv.maxSites + Math.floor(ctx.count.total / 14)) {
    const want = chooseBuilding(game, p, ctx, lv, st);
    if (want) tryBuild(game, p, ctx, want, st);
  }
  if (game.time > lv.attackAfter) considerAttack(game, p, lv, st);
}

function context(game, p) {
  const count = { total: 0 }; let sites = 0, hq = null;
  const byType = {};
  for (const b of game.buildings.values()) {
    if (b.owner !== p) continue;
    count[b.type] = (count[b.type] || 0) + 1; count.total++;
    (byType[b.type] = byType[b.type] || []).push(b);
    if (b.state === 'site') sites++;
    if (b.type === 'hq') hq = b;
  }
  const stock = game.totalStock(p);
  const connected = hq ? L.flagDijkstra(game, hq.flag).dist : new Map();
  return { count, sites, hq, byType, stock: stock.wares, people: stock.people, connected };
}

function has(ctx, t) { return ctx.count[t] || 0; }

function chooseBuilding(game, p, ctx, lv, st) {
  const s = ctx.stock, c = (t) => has(ctx, t);
  const milSites = ['barracks', 'guardhouse', 'watchtower', 'fortress'].reduce((a, t) => a + (ctx.byType[t] || []).filter(b => b.state === 'site').length, 0);
  const wantMil = milSites === 0 && game.time - st.lastMil > lv.milEvery;
  const list = [];
  if (c('woodcutter') < 1) list.push('woodcutter');
  if (c('quarry') < 1 && nearStones(game, p)) list.push('quarry');
  if (c('sawmill') < 1) list.push('sawmill');
  if (c('forester') < 1) list.push('forester');
  if (wantMil && (s.boards || 0) > 6) list.push(game.time > 1200 && (s.stones || 0) > 12 ? 'watchtower' : (s.stones || 0) > 6 ? 'guardhouse' : 'barracks');
  if (c('woodcutter') < 3 || ((s.wood || 0) < 4 && (s.boards || 0) < 10 && c('woodcutter') < 5)) list.push('woodcutter');
  if (c('forester') < Math.ceil(c('woodcutter') / 1.5)) list.push('forester');
  if (c('forester') < 2) list.push('forester');
  if (c('fishery') < 1) list.push('fishery');
  if (c('hunter') < 1) list.push('hunter');
  if (c('quarry') < 2 && nearStones(game, p)) list.push('quarry');
  if (c('well') < 1) list.push('well');
  if (c('farm') < 2) list.push('farm');
  if (c('coalmine') < 1) list.push('coalmine');
  if (c('ironmine') < 1) list.push('ironmine');
  if (c('mill') < 1 && c('farm')) list.push('mill');
  if (c('bakery') < 1 && c('mill')) list.push('bakery');
  if (c('well') < 2 && c('bakery')) list.push('well');
  if (c('smelter') < 1 && (c('ironmine') || (s.ironore || 0) > 4)) list.push('smelter');
  if (c('metalworks') < 1 && c('smelter')) list.push('metalworks');
  if (c('brewery') < 1 && c('farm')) list.push('brewery');
  if (c('armory') < 1 && c('smelter')) list.push('armory');
  if (c('sawmill') < 2 && c('woodcutter') >= 3) list.push('sawmill');
  if (c('pigfarm') < 1 && c('farm') >= 2) list.push('pigfarm');
  if (c('slaughterhouse') < 1 && c('pigfarm')) list.push('slaughterhouse');
  if (c('coalmine') < 2 && c('armory')) list.push('coalmine');
  if (c('farm') < 4 && c('brewery')) list.push('farm');
  if (c('goldmine') < 1 && c('armory')) list.push('goldmine');
  if (c('mint') < 1 && c('goldmine')) list.push('mint');
  if (c('granitemine') < 1 && !nearStones(game, p) && (s.stones || 0) < 10) list.push('granitemine');
  if (c('storehouse') < Math.floor(ctx.count.total / 30)) list.push('storehouse');
  if (game.time - st.lastMil > lv.milEvery * 0.7 && milSites === 0) list.push('guardhouse');
  // skip things that failed placement recently
  return list.find(t => !(st.fails[t] > game.time) && (BUILDINGS[t].cost.boards || 0) <= (s.boards || 0) + 2) || null;
}

function nearStones(game, p) {
  const m = game.map;
  for (let i = 0; i < game.grid.n; i++) if (game.owner[i] === p + 1 && m.obj[i] && m.obj[i].t === 'stone') return true;
  return false;
}

function scoreSpot(game, p, n, type, ctx) {
  const g = game.grid, m = game.map, def = BUILDINGS[type];
  let s = -g.dist(n, ctx.hq.node) * 0.6;
  const near = (r, fn) => { let k = 0; for (const j of g.within(n, r)) k += fn(j) || 0; return k; };
  switch (type) {
    case 'woodcutter': s += near(5, j => m.obj[j] && m.obj[j].t === 'tree' ? (m.obj[j].g >= 1 ? 1 : 0.5) : 0) * 3 + near(4, j => { const b = game.buildingAt(j); return b && b.type === 'forester' ? 10 : 0; }) - 6; break;
    case 'forester': s += near(4, j => !m.obj[j] && TERRAIN_INFO[m.terrain[j]].trees && game.owner[j] === p + 1 ? 1 : 0) * 0.6 + near(4, j => { const b = game.buildingAt(j); return b && b.type === 'woodcutter' ? 6 : 0; }); break;
    case 'quarry': s += near(6, j => m.obj[j] && m.obj[j].t === 'stone' ? m.obj[j].a : 0) * 1.2 - 5; break;
    case 'fishery': s += near(6, j => m.res[j] === RES.FISH && m.terrain[j] === T.WATER ? m.resAmt[j] : 0) * 0.5 - 8; break;
    case 'hunter': s += near(8, j => game.animals.some(a => a.node === j && a.kind !== 'duck') ? 4 : 0) - 2; break;
    case 'well': s += m.res[n] === RES.WATER ? 5 : -5; break;
    case 'farm': s += near(2, j => !m.obj[j] && TERRAIN_INFO[m.terrain[j]].build ? 1 : 0) * 2 - 10; break;
    case 'coalmine': case 'ironmine': case 'goldmine': case 'granitemine': {
      const want = { coalmine: RES.COAL, ironmine: RES.IRON, goldmine: RES.GOLD, granitemine: RES.GRANITE }[type];
      const k = near(2, j => m.res[j] === want ? m.resAmt[j] : 0); if (k < 5) return -1e9; s += k * 2; break;
    }
    case 'barracks': case 'guardhouse': case 'watchtower': case 'fortress': {
      // near the border, away from other military, towards unclaimed land / enemies
      let border = 1e9;
      const ring = g.within(n, def.radius);
      let gain = 0; for (const j of ring) if (!game.owner[j]) gain += TERRAIN_INFO[m.terrain[j]].build ? 1.2 : m.terrain[j] === T.MOUNTAIN ? 1.5 : 0.3;
      for (const j of g.within(n, 4)) if (game.isBorder(j)) border = Math.min(border, g.dist(n, j));
      s = gain * 0.5 - border * 2 + g.dist(n, ctx.hq.node) * 0.3;
      let enemyNear = 0; for (const j of g.within(n, def.radius + 3)) if (game.owner[j] && game.owner[j] !== p + 1) enemyNear++;
      s += enemyNear * 0.15;
      // unclaimed mountains with ore are worth a lot
      for (const j of ring) if (!game.owner[j] && m.res[j] >= RES.COAL && m.res[j] <= RES.GOLD) s += 0.8;
      if (gain < 10 && enemyNear === 0) return -1e9;
      // later in the game, push the frontier towards the nearest enemy HQ
      if (game.time > 480) {
        let ed = 1e9; for (const o of game.buildings.values()) if (o.type === 'hq' && o.owner !== p && game.players[o.owner].alive) ed = Math.min(ed, g.dist(o.node, n));
        if (ed < 1e9) s -= ed * 0.9;
      }
      break;
    }
  }
  // don't waste large spots on small buildings
  const cap = game.buildCap(p, n);
  if (cap === 'large' && def.size !== 'large') s -= 3;
  if (cap === 'medium' && def.size === 'small') s -= 1;
  return s;
}

function tryBuild(game, p, ctx, type, st) {
  const g = game.grid, def = BUILDINGS[type];
  const cands = [];
  for (let i = 0; i < g.n; i++) {
    if (game.owner[i] !== p + 1) continue;
    if (!game.canBuildType(p, i, type)) continue;
    cands.push(i);
  }
  if (!cands.length) { st.fails[type] = game.time + 60; return false; }
  while (cands.length > 160) cands.splice(game.rng.int(cands.length), 1);
  let scored = cands.map(n => [n, scoreSpot(game, p, n, type, ctx)]).filter(x => x[1] > -1e8).sort((a, b) => b[1] - a[1]);
  for (const [n] of scored.slice(0, 5)) {
    const b = game.placeBuilding(p, n, type);
    if (!b) continue;
    if (connectFlag(game, p, b.flag, ctx)) {
      if (def.kind === 'military') st.lastMil = game.time;
      return true;
    }
    game.destroyFlag(b.flag);
  }
  st.fails[type] = game.time + 45;
  return false;
}

// connect a flag to the network (the HQ-connected component) with the shortest road
export function connectFlag(game, p, fid, ctx) {
  const f = game.flags.get(fid); if (!f) return false;
  const conn = ctx ? ctx.connected : null;
  if (conn && conn.has(fid)) return true;
  const g = game.grid;
  const flags = [...game.flags.values()].filter(o => o.owner === p && o.id !== fid && (!conn || conn.has(o.id)))
    .sort((a, b) => g.dist(a.node, f.node) - g.dist(b.node, f.node)).slice(0, 5);
  let best = null;
  for (const o of flags) {
    const path = L.findRoadPath(game, p, f.node, o.node, { max: 3000 });
    if (path && (!best || path.length < best.length)) best = path;
  }
  if (!best) return false;
  const r = game.buildRoad(p, best);
  if (!r.ok) return false;
  if (conn) conn.set(fid, 0);
  splitRoad(game, p, r.road);
  return true;
}

function splitRoad(game, p, r) {
  if (!r) return;
  const nodes = r.nodes.slice();
  for (let i = 2; i < nodes.length - 1; i += 2) game.placeFlag(p, nodes[i], true);
}

function maintainRoads(game, p, ctx) {
  // throughput: long roads get extra flags
  for (const r of [...game.roads.values()]) {
    if (r.owner !== p || r.nodes.length < 4) continue;
    for (let i = 2; i < r.nodes.length - 1; i += 2) if (game.canPlaceFlag(p, r.nodes[i]) === true) { game.placeFlag(p, r.nodes[i], true); break; }
  }
  // lonely flags (their building got destroyed): remove
  for (const f of [...game.flags.values()]) {
    if (f.owner !== p || f.building || f.wares.length) continue;
    const deg = f.roads.filter(Boolean).length;
    if (deg === 0) game.destroyFlag(f.id);
  }
}

function cleanup(game, p, ctx) {
  for (const b of [...game.buildings.values()]) {
    if (b.owner !== p || b.state !== 'done') continue;
    if ((b.type === 'woodcutter' || b.type === 'quarry' || b.type === 'fishery' || b.type === 'hunter') && b.prod.length >= 120 && b.prod.every(v => !v) && game.time - b.t0 > 300) {
      if (b.type === 'woodcutter' && game.grid.within(b.node, 6).some(j => { const o = game.map.obj[j]; return o && o.t === 'tree'; })) continue;
      game.destroyBuilding(b.id);
    }
    if (BUILDINGS[b.type].kind === 'mine' && b.exhausted) game.destroyBuilding(b.id);
  }
  // unconnected sites for too long get removed
  for (const b of [...game.buildings.values()]) if (b.owner === p && b.state === 'site' && !ctx.connected.has(b.flag) && game.time - b.t0 > 30) connectFlag(game, p, b.flag, ctx) || game.destroyFlag(b.flag);
}

function considerAttack(game, p, lv, st) {
  if (game.time - st.lastAttack < 60 / lv.aggression) return;
  let best = null, bs = -1e9;
  for (const t of game.buildings.values()) {
    if (!canAttack(game, p, t)) continue;
    const av = availableAttackers(game, p, t);
    if (!av.length) continue;
    const defStrength = t.soldiers.reduce((a, sid) => { const s = game.settlers.get(sid); return a + (s ? s.rank + 1 : 0); }, 0) + (t.people ? t.people.soldier || 0 : 0);
    const myStrength = av.reduce((a, x) => { const s = game.settlers.get(x.sid); return a + (s ? s.rank + 1 : 0); }, 0);
    const score = myStrength - defStrength * 1.3 * (2 - Math.min(1.5, lv.aggression) * 0.5);
    if (score > bs) { bs = score; best = t; }
  }
  if (best && bs > 0) {
    const n = Math.min(12, availableAttackers(game, p, best).length);
    if (attack(game, p, best.id, n)) st.lastAttack = game.time;
  }
}
