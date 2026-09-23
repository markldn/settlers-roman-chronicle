// Road network, flag graph routing, free-walk pathfinding and request dispatch.
import { Heap } from './grid.js';
import { TERRAIN_INFO, TERRAIN as T, BUILDINGS, JOBS, FOODS, TOOLS } from './data.js';

// ---------------------------------------------------------------------------
// Flag graph
// ---------------------------------------------------------------------------

// Dijkstra over a player's flag graph from one flag. Returns {dist: Map, prevRoad: Map}.
export function flagDijkstra(game, srcFlag, maxDist = Infinity) {
  const dist = new Map([[srcFlag, 0]]), prevRoad = new Map();
  const h = new Heap(); h.push(srcFlag, 0);
  while (h.size) {
    const f = h.pop(); const d = dist.get(f);
    if (d > maxDist) break;
    const flag = game.flags.get(f); if (!flag) continue;
    for (let k = 0; k < 6; k++) {
      const rid = flag.roads[k]; if (!rid) continue;
      const r = game.roads.get(rid); if (!r) continue;
      const other = r.a === f ? r.b : r.a;
      const nd = d + roadCost(r);
      if (nd < (dist.get(other) ?? Infinity)) { dist.set(other, nd); prevRoad.set(other, rid); h.push(other, nd); }
    }
  }
  return { dist, prevRoad };
}
export function roadCost(r) { return r.nodes.length - 1 + (r.slope || 0) * 0.15 + 0.5; }

// next road to take from `fromFlag` to reach `destFlag` (0 if unreachable / already there)
export function nextHop(game, fromFlag, destFlag) {
  if (fromFlag === destFlag) return 0;
  let c = game._route.get(destFlag);
  if (!c || c.v !== game.netVersion) {
    const { prevRoad } = flagDijkstra(game, destFlag);
    // prevRoad maps flag -> road that leads (one step) back towards destFlag
    c = { v: game.netVersion, next: prevRoad };
    game._route.set(destFlag, c);
  }
  return c.next.get(fromFlag) || 0;
}

export function flagDistance(game, a, b) {
  if (a === b) return 0;
  let steps = 0, f = a, d = 0;
  while (f !== b && steps++ < 500) {
    const rid = nextHop(game, f, b); if (!rid) return Infinity;
    const r = game.roads.get(rid); d += roadCost(r); f = r.a === f ? r.b : r.a;
  }
  return f === b ? d : Infinity;
}

// node path along roads from flag a to flag b (inclusive of both flag nodes)
export function roadNodePath(game, a, b) {
  const fa = game.flags.get(a); if (!fa) return null;
  const out = [fa.node];
  let f = a, steps = 0;
  while (f !== b) {
    if (steps++ > 500) return null;
    const rid = nextHop(game, f, b); if (!rid) return null;
    const r = game.roads.get(rid);
    const nodes = r.a === f ? r.nodes : r.nodes.slice().reverse();
    for (let i = 1; i < nodes.length; i++) out.push(nodes[i]);
    f = r.a === f ? r.b : r.a;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Free walking (cross-country) A*
// ---------------------------------------------------------------------------
export function walkable(game, n, allow) {
  const m = game.map;
  if (!TERRAIN_INFO[m.terrain[n]].walk) return false;
  const o = m.obj[n];
  if (o && (o.t === 'bld' || o.t === 'foot' || o.t === 'stone') && n !== allow) return false;
  return true;
}

export function findWalkPath(game, from, to, opts = {}) {
  if (from === to) return [];
  const g = game.grid, m = game.map, maxN = opts.max || 9000;
  const goalOk = opts.adjacentOk ? (n) => n === to || g.dirTo(n, to) >= 0 : (n) => n === to;
  const came = new Map(), cost = new Map([[from, 0]]);
  const h = new Heap(); h.push(from, 0); let exp = 0;
  while (h.size) {
    const c = h.pop();
    if (goalOk(c)) {
      const path = []; let n = c; while (n !== from) { path.push(n); n = came.get(n); } path.reverse(); return path;
    }
    if (++exp > maxN) break;
    const cc = cost.get(c);
    for (let d = 0; d < 6; d++) {
      const nb = g.neighbor(c, d); if (nb < 0) continue;
      if (nb !== to && !walkable(game, nb, opts.allow)) continue;
      if (nb === to && !TERRAIN_INFO[m.terrain[nb]].walk && !opts.adjacentOk) continue;
      const dh = m.height[nb] - m.height[c];
      if (Math.abs(dh) > 5) continue;
      const nc = cc + 1 + Math.max(0, dh) * 0.25;
      if (nc < (cost.get(nb) ?? Infinity)) { cost.set(nb, nc); came.set(nb, c); h.push(nb, nc + g.dist(nb, to)); }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

// can a road pass through (interior) node n for player p
export function roadNodeFree(game, p, n) {
  const m = game.map;
  if (game.owner[n] !== p + 1) return false;
  if (!TERRAIN_INFO[m.terrain[n]].walk) return false;
  if (game.roadAt[n]) return false;
  const o = m.obj[n];
  if (o && o.t !== 'sign') return false;
  return true;
}

export function validateRoad(game, p, nodes) {
  if (nodes.length < 2) return 'too short';
  const g = game.grid, m = game.map;
  const f0 = game.flagAt(nodes[0]);
  if (!f0 || f0.owner !== p) return 'must start at your flag';
  const seen = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (seen.has(n)) return 'road crosses itself';
    seen.add(n);
    if (i > 0) {
      const d = g.dirTo(nodes[i - 1], n); if (d < 0) return 'not contiguous';
      if (Math.abs(m.height[n] - m.height[nodes[i - 1]]) > 4) return 'too steep';
    }
    if (i > 0 && i < nodes.length - 1 && !roadNodeFree(game, p, n)) return 'blocked';
  }
  const last = nodes[nodes.length - 1];
  const fl = game.flagAt(last);
  if (fl) { if (fl.owner !== p) return 'enemy flag'; if (fl.id === f0.id) return 'loop'; }
  else if (game.canPlaceFlag(p, last, nodes[nodes.length - 2]) !== true) return 'cannot end here';
  // duplicate edge at flags
  const d0 = g.dirTo(nodes[0], nodes[1]); if (f0.roads[d0]) return 'direction in use';
  if (fl) { const d1 = g.dirTo(last, nodes[nodes.length - 2]); if (fl.roads[d1]) return 'direction in use'; }
  return true;
}

// A* for road building: interior nodes must be road-free; the end can be a flag or a flag-able node
export function findRoadPath(game, p, from, to, opts = {}) {
  const g = game.grid, m = game.map;
  const toFlag = game.flagAt(to);
  const endOk = (n) => n === to && (toFlag ? toFlag.owner === p : game.canPlaceFlag(p, n) === true);
  const startFlag = game.flagAt(from);
  const came = new Map(), cost = new Map([[from, 0]]);
  const h = new Heap(); h.push(from, 0); let exp = 0;
  const maxN = opts.max || 6000;
  while (h.size) {
    const c = h.pop();
    if (c === to && endOk(c)) { const path = [c]; let n = c; while (n !== from) { n = came.get(n); path.push(n); } path.reverse(); return path; }
    if (++exp > maxN) break;
    for (let d = 0; d < 6; d++) {
      const nb = g.neighbor(c, d); if (nb < 0) continue;
      if (c === from && startFlag && startFlag.roads[d]) continue;
      if (Math.abs(m.height[nb] - m.height[c]) > 4) continue;
      if (nb === to) {
        if (toFlag) { const back = g.dirTo(nb, c); if (toFlag.roads[back]) continue; }
      } else if (!roadNodeFree(game, p, nb) || (game.flagAt(nb))) continue;
      const nc = cost.get(c) + 1 + Math.abs(m.height[nb] - m.height[c]) * 0.2;
      if (nc < (cost.get(nb) ?? Infinity)) { cost.set(nb, nc); came.set(nb, c); h.push(nb, nc + g.dist(nb, to)); }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dispatch: assign wares to requests, send settlers where needed
// ---------------------------------------------------------------------------

function warehousesOf(game, p) {
  const out = [];
  for (const b of game.buildings.values()) if (b.owner === p && b.state === 'done' && BUILDINGS[b.type].kind === 'warehouse') out.push(b);
  return out;
}

// nearest warehouse (by roads) to a flag that satisfies pred(warehouse)
export function nearestWarehouse(game, p, flagId, pred = () => true) {
  let best = null, bd = Infinity;
  const whs = warehousesOf(game, p);
  if (!whs.length) return null;
  const { dist } = flagDijkstra(game, flagId);
  for (const w of whs) { if (!pred(w)) continue; const d = dist.get(w.flag); if (d !== undefined && d < bd) { bd = d; best = w; } }
  return best;
}

// Build the list of ware requests for a player.
function collectRequests(game, p) {
  const reqs = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p) continue;
    const def = BUILDINGS[b.type];
    if (b.state === 'site') {
      if (!b.site.leveled) continue;
      for (const w of ['boards', 'stones']) {
        const need = (b.site.need[w] || 0) - (b.site.have[w] || 0) - (b.site.used[w] || 0) - (b.inbound[w] || 0);
        if (need > 0) reqs.push({ b, ware: w, n: need, prio: 0 });
      }
    } else if (b.state === 'done') {
      if (def.inputs && (b.worker || def.kind === 'catapult') && !b.stopped) {
        for (const [w, cap] of Object.entries(def.inputs)) {
          if (w === 'food') {
            const have = FOODS.reduce((s, f) => s + (b.inputs[f] || 0) + (b.inbound[f] || 0), 0);
            if (have < cap) reqs.push({ b, ware: 'food', n: cap - have, prio: 2 });
          } else {
            const have = (b.inputs[w] || 0) + (b.inbound[w] || 0);
            if (have < cap) reqs.push({ b, ware: w, n: cap - have, prio: 2 });
          }
        }
      }
      if (def.kind === 'military' && b.soldiers.length && game.players[p].promote) {
        const have = (b.inputs.coins || 0) + (b.inbound.coins || 0);
        if (have < def.coins) reqs.push({ b, ware: 'coins', n: def.coins - have, prio: 1 });
      }
    }
  }
  // construction sites first (in placement order), then by stable rotation
  reqs.sort((x, y) => x.prio - y.prio || x.b.id - y.b.id);
  const rot = game.players[p].reqRot = ((game.players[p].reqRot || 0) + 1) % 997;
  if (reqs.length > 1) { const k = rot % reqs.length; const firstSites = reqs.filter(r => r.prio === 0); const rest = reqs.filter(r => r.prio !== 0); const kk = rest.length ? rot % rest.length : 0; return firstSites.concat(rest.slice(kk), rest.slice(0, kk)); }
  return reqs;
}

// Try to satisfy each request with the nearest free ware or warehouse stock.
function assignWares(game, p) {
  const reqs = collectRequests(game, p);
  if (!reqs.length) return;
  // free wares: lying at a flag, no destination, or heading to a warehouse
  const free = [];
  for (const w of game.wares.values()) {
    if (w.owner !== p || !w.flag || w.reserved) continue;
    const dest = w.dest ? game.buildings.get(w.dest) : null;
    if (!dest || BUILDINGS[dest.type].kind === 'warehouse') free.push(w);
  }
  const whs = warehousesOf(game, p);
  let budget = 40;
  for (const r of reqs) {
    if (budget <= 0) break;
    const types = r.ware === 'food' ? FOODS : [r.ware];
    const { dist } = flagDijkstra(game, r.b.flag);
    for (let k = 0; k < r.n && budget > 0; k++) {
      let best = null, bd = Infinity, bestWh = null, bestType = null;
      for (const w of free) {
        if (!types.includes(w.type) || w.dest === r.b.id) continue;
        const d = dist.get(w.flag); if (d !== undefined && d < bd) { bd = d; best = w; bestWh = null; }
      }
      for (const wh of whs) {
        if (wh === r.b) continue;
        for (const t of types) {
          if ((wh.stock[t] || 0) <= 0) continue;
          const d = dist.get(wh.flag); if (d !== undefined && d + 1 < bd) { bd = d + 1; best = null; bestWh = wh; bestType = t; }
        }
      }
      if (best) {
        if (best.dest) { const od = game.buildings.get(best.dest); if (od) od.inbound[best.type] = Math.max(0, (od.inbound[best.type] || 0) - 1); }
        best.dest = r.b.id; r.b.inbound[best.type] = (r.b.inbound[best.type] || 0) + 1;
        free.splice(free.indexOf(best), 1); budget--;
      } else if (bestWh) {
        bestWh.stock[bestType]--;
        bestWh.outbox.push({ type: bestType, dest: r.b.id });
        r.b.inbound[bestType] = (r.b.inbound[bestType] || 0) + 1; budget--;
      } else break;
    }
  }
}

// wares without destination go to the nearest warehouse (after lying for a moment)
function storeLooseWares(game, p) {
  for (const w of game.wares.values()) {
    if (w.owner !== p || !w.flag || w.dest || w.reserved) continue;
    if (game.time - (w.since || 0) < 3) continue;
    const wh = nearestWarehouse(game, p, w.flag);
    if (wh) { w.dest = wh.id; }
  }
}

// Spawn a settler of `job` from the nearest warehouse able to supply it. Returns settler or null.
export function dispatchSettler(game, p, job, targetFlag, opts = {}) {
  const tool = JOBS[job] ? JOBS[job].tool : null;
  const reserve = (wh) => job === 'soldier' && wh.type === 'hq' ? (game.players[p].hqReserve ?? 3) : 0;
  const canSupply = (wh) => (wh.people[job] || 0) > reserve(wh) || (job !== 'soldier' && job !== 'donkey' && (wh.people.carrier || 0) > (opts.keepCarriers ?? 0) && (!tool || (wh.stock[tool] || 0) > 0));
  const wh = nearestWarehouse(game, p, targetFlag, canSupply);
  if (!wh) {
    if (tool && job !== 'soldier') game.players[p].toolDemand[tool] = (game.players[p].toolDemand[tool] || 0) + 1;
    return null;
  }
  const path = roadNodePath(game, wh.flag, targetFlag);
  if (!path) return null;
  let rank = 0;
  if ((wh.people[job] || 0) > reserve(wh)) {
    wh.people[job]--;
    if (job === 'soldier') {
      const strong = game.players[p].sendStrong;
      for (let k = 0; k < 5; k++) { const rk = strong ? 4 - k : k; if (wh.ranks[rk] > 0) { wh.ranks[rk]--; rank = rk; break; } }
    }
  } else { wh.people.carrier--; if (tool) wh.stock[tool]--; }
  const s = game.spawnSettler(p, job, wh.node, rank);
  s.path = path; // building node -> its flag is path[0]
  return s;
}

// Called ~2x per second per player.
export function dispatch(game, p) {
  const pl = game.players[p];
  if (!pl.alive) return;
  // warehouse outboxes: put requested wares onto the warehouse flag
  for (const wh of warehousesOf(game, p)) {
    const flag = game.flags.get(wh.flag);
    while (wh.outbox.length && flag.wares.length < 8) {
      const o = wh.outbox.shift();
      const dest = game.buildings.get(o.dest);
      if (!dest) { wh.stock[o.type] = (wh.stock[o.type] || 0) + 1; continue; }
      game.createWare(p, o.type, flag.id, o.dest);
    }
  }
  assignWares(game, p);
  storeLooseWares(game, p);

  // carriers for roads (and donkeys for busy roads)
  let sent = 0;
  for (const r of game.roads.values()) {
    if (r.owner !== p || sent > 6) continue;
    if (!r.carrier) {
      const s = dispatchSettler(game, p, 'carrier', r.a);
      if (s) { r.carrier = s.id; s.road = r.id; s.state = 'toRoad'; sent++; }
    } else if (r.busy && !r.donkey && r.nodes.length > 2) {
      const s = dispatchSettler(game, p, 'donkey', r.a);
      if (s) { r.donkey = s.id; s.road = r.id; s.state = 'toRoad'; sent++; }
    }
  }
  // workers, builders, soldiers
  for (const b of game.buildings.values()) {
    if (b.owner !== p) continue;
    const def = BUILDINGS[b.type];
    if (b.state === 'site') {
      if (!b.site.builder) {
        const s = dispatchSettler(game, p, 'builder', b.flag);
        if (s) { b.site.builder = s.id; s.home = b.id; s.state = 'toSite'; }
      }
    } else if (b.state === 'done') {
      if (def.job && !b.worker) {
        const s = dispatchSettler(game, p, def.job, b.flag);
        if (s) { b.worker = s.id; s.home = b.id; s.state = 'toWork'; }
      }
      if (def.kind === 'military') {
        const want = Math.max(1, Math.round(def.soldiers * pl.occupancy));
        const have = b.soldiers.length + b.soldiersComing;
        if (have < want) {
          const s = dispatchSettler(game, p, 'soldier', b.flag);
          if (s) { s.home = b.id; s.state = 'toPost'; b.soldiersComing++; }
        }
      }
    }
  }
}
