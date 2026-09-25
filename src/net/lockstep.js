// Multiplayer lockstep. The server closes a turn every 100 ms: the commands every player sent in
// that time plus how many simulation ticks the turn lasts (depends on game speed, 0 when paused).
// Every browser applies the same commands at the start of the same turn and then runs the same
// ticks, so all of them compute the same game. This class queues the turns, runs them at an even
// pace, reports a state fingerprint every 20 turns and swaps in a snapshot when the server says so
// (after a desync, or when this page (re)joins a running game).
import { Game, TICK } from '../sim/game.js';
import { applyCommand, applySystem, stateHash } from '../sim/commands.js';
import { mpSetup, initMission } from '../sim/missions.js';

export const TICKS_PER_TURN = [1, 2, 4, 8, 16]; // per speed index, as on the server
export const HASH_EVERY = 20;

async function gzipBytes(str) { return new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzipText(buf) { return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }

export class Lockstep {
  // start: the server's start message; hooks: { onGame(game, reason), onSystem(cmd), onError(text) }
  constructor(net, start, hooks) {
    this.net = net; this.hooks = hooks;
    this.room = start.room; this.slot = start.you;
    this.seats = start.seats.slice().sort((a, b) => a.slot - b.slot);
    this.setup = mpSetup(start.settings || {}, this.seats, start.seed);
    this.speed = start.speed ?? 1; this.paused = !!start.paused;
    this.queue = []; this.cur = null;
    this.recv = start.turn || 0; // last turn received
    this.done = start.turn || 0; // last turn fully simulated
    this.game = null; this.loading = true;
    this.acc = 0;
    this.pending = new Map(); this.seq = Math.floor(Math.random() * 1e6) * 1000;
    this.snapWanted = false; this.ownSnap = null; this.snapGen = 0;
  }

  freshGame() {
    const g = new Game(JSON.parse(JSON.stringify(this.setup)));
    initMission(g);
    return g;
  }

  // a new game: everybody builds it from the same setup
  begin() {
    this.game = this.freshGame();
    this.loading = false; this.done = 0;
    return this.game;
  }

  // ------------------------------------------------------------------ from the server
  onTurn(t) {
    if (t.n <= this.recv) return;
    if (t.n !== this.recv + 1) console.warn(`lockstep: turn ${t.n} after ${this.recv}`);
    this.recv = t.n;
    this.queue.push(t);
  }
  onTurns(list) { for (const t of list) this.onTurn(t); }
  onSpeed(m) { this.speed = m.speed; this.paused = m.paused; }

  onSnapRequest() { if (this.cur || this.loading) this.snapWanted = true; else this.uploadSnapshot(); }

  async uploadSnapshot() {
    this.snapWanted = false;
    if (!this.game || this.loading) return;
    const turn = this.done, json = this.game.serialize();
    this.ownSnap = { turn, json };
    try {
      const body = await gzipBytes(json);
      await fetch(`api/snap?room=${encodeURIComponent(this.room)}&token=${encodeURIComponent(this.net.token)}&turn=${turn}`, { method: 'POST', body });
    } catch (e) { console.warn('snapshot upload failed', e); }
  }

  // load snapshot `turn` (0: build from setup), then play the turns the server sent along
  async onSnap(m) {
    const gen = ++this.snapGen;
    this.loading = true; this.cur = null; this.acc = 0; this.snapWanted = false;
    this.queue = m.turns.slice();
    this.recv = m.turns.length ? m.turns[m.turns.length - 1].n : m.turn;
    this.pending.clear();
    let game;
    try {
      if (m.turn === 0) game = this.freshGame();
      else if (this.ownSnap && this.ownSnap.turn === m.turn) game = Game.deserialize(this.ownSnap.json);
      else {
        const r = await fetch(`api/snap?room=${encodeURIComponent(this.room)}&token=${encodeURIComponent(this.net.token)}&turn=${m.turn}`);
        if (!r.ok) throw new Error(`snapshot ${m.turn}: HTTP ${r.status}`);
        game = Game.deserialize(await gunzipText(await r.arrayBuffer()));
      }
    } catch (e) {
      console.error(e);
      if (gen === this.snapGen) this.hooks.onError && this.hooks.onError('Could not load the game from the server: ' + e.message);
      return;
    }
    if (gen !== this.snapGen) return; // a newer snapshot is already on its way
    this.game = game; this.done = m.turn; this.loading = false;
    this.hooks.onGame(game, m.reason);
  }

  // ------------------------------------------------------------------ commands
  send(c, done) {
    const i = ++this.seq;
    if (done) this.pending.set(i, done);
    if (!this.net.send('cmd', { i, c })) { this.pending.delete(i); return false; }
    return true;
  }

  applyTurn(t) {
    const g = this.game;
    for (const x of t.c || []) {
      let r = null;
      try { r = x.p < 0 ? applySystem(g, x.c) : applyCommand(g, x.p, x.c); }
      catch (e) { console.error('command failed', x, e); }
      if (x.p < 0) { this.hooks.onSystem && this.hooks.onSystem(x.c); continue; }
      if (x.p === this.slot && this.pending.has(x.i)) {
        const cb = this.pending.get(x.i); this.pending.delete(x.i);
        try { cb(r); } catch (e) { console.error(e); }
      }
    }
  }

  finishTurn(t) {
    this.done = t.n;
    if (t.n % HASH_EVERY === 0) this.net.send('hash', { n: t.n, h: stateHash(this.game) });
    if (this.snapWanted) this.uploadSnapshot();
  }

  backlog() { let n = this.cur ? this.cur.left : 0; for (const t of this.queue) n += t.k; return n; }

  // Runs the simulation forward by the real time since the last call, but never past the turns
  // received. Keeps about one turn in hand to ride out network jitter; when it has fallen behind
  // (slow machine, hidden tab, reconnect) it catches up, spending more of each frame the further back it is.
  advance(budgetMs = 30) {
    const now = performance.now();
    const dt = Math.min(1, (now - (this.lastT ?? now)) / 1000); this.lastT = now;
    if (this.loading || !this.game) return 0;
    const t0 = now;
    const perTurn = (this.cur ? this.cur.t.k : this.queue.length ? this.queue[0].k : TICKS_PER_TURN[this.speed]) || 0;
    const backlog = this.backlog();
    if (backlog > perTurn * 30) budgetMs *= 2; // more than 3 s behind
    this.acc += dt * perTurn * 10;
    const hold = perTurn * 1.5;
    if (backlog > hold + 2) this.acc += (backlog - hold) * Math.min(1, dt * 4);
    let ran = 0;
    for (;;) {
      if (!this.cur) {
        const t = this.queue[0];
        if (!t || (t.k > 0 && this.acc < 1)) break;
        this.queue.shift();
        this.applyTurn(t);
        this.cur = { t, left: t.k };
      }
      while (this.cur.left > 0 && this.acc >= 1) {
        this.game.update(TICK); this.cur.left--; this.acc--; ran++;
        if ((ran & 7) === 0 && performance.now() - t0 > budgetMs) break;
      }
      if (this.cur.left > 0) break;
      const t = this.cur.t; this.cur = null;
      this.finishTurn(t);
      if (performance.now() - t0 > budgetMs) break;
    }
    if (!this.cur && !this.queue.length) this.acc = Math.min(this.acc, 1); // starved: do not bank time
    return ran;
  }
}
