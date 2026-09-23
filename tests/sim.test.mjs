// Headless soak test: two AIs play for N minutes; check invariants and that the economy works.
import { Game } from '../src/sim/game.js';
import { BUILDINGS } from '../src/sim/data.js';
const MIN = +(process.argv[2] || 20), SEED = +(process.argv[3] || 7);
const game = new Game({ seed: SEED, mapOpts: { w: 72, h: 72, seed: SEED, players: 2 }, players: [{ name: 'A', ai: 'hard' }, { name: 'B', ai: 'hard' }] });
const t0 = Date.now(); let steps = 0;
function check() {
  for (const f of game.flags.values()) for (const wid of f.wares) { const w = game.wares.get(wid); if (!w || w.flag !== f.id) throw new Error('ware/flag mismatch ' + wid); }
  for (const r of game.roads.values()) { if (!game.flags.get(r.a) || !game.flags.get(r.b)) throw new Error('road without flag'); for (let i = 1; i < r.nodes.length - 1; i++) if (game.roadAt[r.nodes[i]] !== r.id) throw new Error('roadAt mismatch'); }
  for (const s of game.settlers.values()) { if (!Number.isInteger(s.node) || s.node < 0) throw new Error('bad settler node ' + JSON.stringify(s)); }
  for (const b of game.buildings.values()) { for (const [k, v] of Object.entries(b.inbound)) if (v < 0) throw new Error('neg inbound'); }
}
for (let m = 1; m <= MIN; m++) {
  for (let i = 0; i < 1200; i++) { game.update(0.05); steps++; game.events.length = 0; }
  check();
  const line = game.players.map(pl => {
    const c = {}; for (const b of game.buildings.values()) if (b.owner === pl.id) c[b.state === 'done' ? b.type : 'site'] = (c[b.state === 'done' ? b.type : 'site'] || 0) + 1;
    const st = game.totalStock(pl.id).wares;
    return `${pl.name}${pl.alive ? '' : '(dead)'} land=${pl.territory} bld=${JSON.stringify(c)} boards=${st.boards} stones=${st.stones} sold=${Object.values(game.buildings).length} k/l=${pl.killed}/${pl.lost} prod=${JSON.stringify(pl.produced)}`;
  }).join('\n   ');
  console.log(`min ${m}: settlers=${game.settlers.size} wares=${game.wares.size} roads=${game.roads.size}\n   ${line}`);
}
const ms = Date.now() - t0;
console.log(`sim ${MIN} min in ${ms} ms (${(steps / ms * 1000 / 20).toFixed(1)}x realtime)`);
const s = game.serialize(); const g2 = Game.deserialize(s); for (let i = 0; i < 200; i++) g2.update(0.05);
console.log('save size', (s.length / 1024).toFixed(0), 'KB; reload ok');
