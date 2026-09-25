// Multiplayer lockstep checks, headless: several "browsers" build the same game from the same room
// settings, apply the same command stream and must stay identical; a snapshot must load into the
// same state everywhere; commands for things a player does not own are refused.
//   node tests/mp.test.mjs
import { Game, TICK } from '../src/sim/game.js';
import { mpSetup, initMission } from '../src/sim/missions.js';
import { applyCommand, applySystem, stateHash } from '../src/sim/commands.js';
import { BUILD_MENU } from '../src/sim/data.js';
import * as L from '../src/sim/logistics.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };

const seats = [{ slot: 0, name: 'Ann', nation: 'romans', team: 0 }, { slot: 1, name: 'Ben', nation: 'vikings', team: 0 }, { slot: 2, name: 'Cy', nation: 'nubians', team: 1 }];
const settings = { size: 'small', theme: 'winter', layout: 'lakes', ai: 2, aiLevel: 'hard', start: 'normal' };
const make = () => { const g = new Game(JSON.parse(JSON.stringify(mpSetup(settings, seats, 4242)))); initMission(g); return g; };

// a scripted human: every few turns, plays a building and a road from the state of its own copy
function* humanCommands(g, p, rng) {
  for (;;) {
    const hq = [...g.buildings.values()].find(b => b.owner === p && b.type === 'hq');
    if (!hq) { yield null; continue; }
    const around = g.grid.within(hq.node, 8);
    const n = around[Math.floor(rng() * around.length)];
    const cap = g.buildCap(p, n);
    if (cap === 'small' || cap === 'medium' || cap === 'large') {
      const list = BUILD_MENU[cap];
      yield { k: 'build', n, t: list[Math.floor(rng() * list.length)] };
      const b = g.buildingAt(n);
      if (b && b.owner === p) {
        const f = g.flags.get(b.flag), hf = g.flags.get(hq.flag);
        const path = f && hf && L.findRoadPath(g, p, f.node, hf.node, { max: 3000 });
        yield path ? { k: 'road', nodes: path } : null;
      }
    } else yield rng() < 0.2 ? { k: 'military', key: 'occupancy', v: 1 + Math.floor(rng() * 10) } : null;
  }
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

console.log('lockstep: three clients, same commands');
const clients = [make(), make(), make()];
ok(clients.every(g => stateHash(g) === stateHash(clients[0])), 'identical after generating the map');
ok(clients[0].players.length === 5 && clients[0].players[3].ai === 'hard' && clients[0].players[2].team === 101, 'setup: 3 humans + 2 computer players, teams');

// the "server": turns of 2 ticks; commands come from client 0's view (any client's view would do)
const gens = seats.map(s => humanCommands(clients[0], s.slot, mulberry(s.slot + 7)));
const turns = [];
let lastHash = 0;
for (let n = 1; n <= 3000; n++) {
  const c = [];
  if (n % 5 === 0) for (const s of seats) { const cmd = gens[s.slot].next().value; if (cmd) c.push({ p: s.slot, i: n, c: cmd }); }
  if (n === 1500) c.push({ p: -1, i: 0, c: { k: 'ai', s: 1, v: 'normal' } }); // Ben drops, a steward takes over
  const k = n > 2000 ? 8 : 2;
  const t = { n, k, c }; turns.push(t);
  if (n === 1000 || n === 2600) clients[2] = Game.deserialize(clients[1].serialize()); // client 2 reloads the page and rejoins from a snapshot
  for (const g of clients) {
    for (const x of c) x.p < 0 ? applySystem(g, x.c) : applyCommand(g, x.p, x.c);
    for (let i = 0; i < k; i++) { g.update(TICK); g.events.length = 0; }
  }
  if (n % 500 === 0) {
    const h = clients.map(stateHash);
    ok(h.every(x => x === h[0]), `turn ${n}: hashes agree (${h[0].toString(16)}), buildings ${clients[0].buildings.size}, settlers ${clients[0].settlers.size}`);
    lastHash = h[0];
  }
}
ok(clients[0].players[1].ai === 'normal', 'system command handed a dropped player to the computer');
ok(clients[2].serialize() === clients[0].serialize(), 'a client that rejoined from snapshots (turns 1000 and 2600) ends byte-identical to one that never reloaded');
const humanBuildings = [...clients[0].buildings.values()].filter(b => b.owner <= 2 && b.type !== 'hq').length;
ok(humanBuildings > 3, `scripted humans built things (${humanBuildings} buildings)`);

console.log('snapshots');
const json = clients[0].serialize();
const a = Game.deserialize(json), b = Game.deserialize(json);
ok(stateHash(a) === lastHash, 'a snapshot loads to the same fingerprint');
for (let i = 0; i < 20 * 120; i++) { a.update(TICK); b.update(TICK); a.events.length = b.events.length = 0; }
ok(stateHash(a) === stateHash(b), 'two loads of one snapshot stay identical for 2 more minutes');

console.log('validation');
const g = make();
const hq1 = [...g.buildings.values()].find(x => x.owner === 1 && x.type === 'hq');
ok(applyCommand(g, 0, { k: 'delBld', id: hq1.id }) === null, 'cannot destroy another player\'s headquarters');
ok(applyCommand(g, 1, { k: 'delBld', id: hq1.id }) === null, 'cannot destroy your own headquarters');
ok(applyCommand(g, 0, { k: 'delFlag', id: hq1.flag }) === null, 'cannot remove another player\'s flag');
ok(applyCommand(g, 0, { k: 'build', n: hq1.node + 2, t: 'woodcutter' }) === null, 'cannot build on another player\'s land');
ok(applyCommand(g, 0, { k: 'build', n: 1e9, t: 'woodcutter' }) === null && applyCommand(g, 0, { k: 'build', n: 5, t: 'nope' }) === null, 'bad nodes and types are refused');
ok(applyCommand(g, 0, { k: 'road', nodes: 'x' }).ok === false && applyCommand(g, 0, { k: 'road', nodes: [1, 2, 3.5] }).ok === false, 'malformed roads are refused');
ok(applyCommand(g, 0, { k: 'tool', t: 'axe', v: 99 }) === null && applyCommand(g, 0, { k: 'tool', t: 'axe', v: 3 }) === true && g.players[0].toolPrio.axe === 3, 'tool priorities validated');
ok(applyCommand(g, 0, { k: 'transport', i: 0, d: 5 }) === null && applyCommand(g, 0, { k: 'transport', i: 1, d: -1 }) === true, 'transport order moves one step at a time');
ok(applyCommand(g, 0, { k: '__proto__' }) === null && applyCommand(g, 0, null) === null && applyCommand(g, 9, { k: 'flag', n: 5 }) === null, 'junk is ignored');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
