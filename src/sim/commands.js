// Player commands. Everything a player can change goes through applyCommand, so a game can be
// driven either directly (single player) or from a turn stream shared by every browser (multiplayer
// lockstep). Commands are plain JSON and are validated here: in multiplayer they arrive from other
// machines, and every client must reach the same verdict on the same command.
import { BUILDINGS, TOOLS } from './data.js';

const int = (v) => Number.isInteger(v) ? v : NaN;
const node = (game, v) => (Number.isInteger(v) && v >= 0 && v < game.grid.n ? v : -1);

// Returns what the underlying game call returned (a building, a flag, {ok, reason}, a count, a bool),
// or null when the command was refused.
export function applyCommand(game, p, c) {
  if (!c || typeof c !== 'object' || !game.players[p] || !game.players[p].alive) return null;
  const pl = game.players[p];
  switch (c.k) {
    case 'build': {
      const n = node(game, c.n);
      if (n < 0 || !BUILDINGS[c.t] || c.t === 'hq') return null;
      return game.placeBuilding(p, n, c.t);
    }
    case 'flag': {
      const n = node(game, c.n);
      return n < 0 ? null : game.placeFlag(p, n);
    }
    case 'road': {
      if (!Array.isArray(c.nodes) || c.nodes.length < 2 || c.nodes.length > 400) return { ok: false, reason: 'bad road' };
      const nodes = c.nodes.map(v => node(game, v));
      if (nodes.some(v => v < 0)) return { ok: false, reason: 'bad road' };
      return game.buildRoad(p, nodes);
    }
    case 'delFlag': {
      const f = game.flags.get(int(c.id));
      if (!f || f.owner !== p) return null;
      game.destroyFlag(f.id); return true;
    }
    case 'delRoad': {
      const r = game.roads.get(int(c.id));
      if (!r || r.owner !== p) return null;
      game.removeRoad(r.id); return true;
    }
    case 'delBld': {
      const b = game.buildings.get(int(c.id));
      if (!b || b.owner !== p || b.type === 'hq') return null;
      game.destroyBuilding(b.id); return true;
    }
    case 'stop': {
      const b = game.buildings.get(int(c.id));
      if (!b || b.owner !== p) return null;
      game.setStopped(b.id, !!c.v); return true;
    }
    case 'attack': {
      const n = int(c.n);
      if (!(n >= 1 && n <= 100)) return 0;
      return game.attack(p, int(c.id), n);
    }
    case 'geo': case 'scout': {
      const f = game.flags.get(int(c.id));
      if (!f || f.owner !== p) return false;
      return c.k === 'geo' ? game.sendGeologist(p, f.id) : game.sendScout(p, f.id);
    }
    case 'transport': {
      // move one entry of the transport priority list up (d = -1) or down (d = 1)
      const t = pl.transport, i = int(c.i), j = i + int(c.d);
      if (!(i >= 0 && i < t.length && j >= 0 && j < t.length && Math.abs(c.d) === 1)) return null;
      [t[i], t[j]] = [t[j], t[i]]; return true;
    }
    case 'tool': {
      const v = int(c.v);
      if (!TOOLS.includes(c.t) || !(v >= 0 && v <= 10)) return null;
      pl.toolPrio[c.t] = v; return true;
    }
    case 'military': {
      const v = c.v;
      switch (c.key) {
        case 'occupancy': if (!(int(v) >= 1 && v <= 10)) return null; pl.occupancy = v / 10; return true;
        case 'attackReserve': if (!(int(v) >= 1 && v <= 4)) return null; pl.attackReserve = v; return true;
        case 'hqReserve': if (!(int(v) >= 0 && v <= 20)) return null; pl.hqReserve = v; return true;
        case 'sendStrong': pl.sendStrong = !!v; return true;
        case 'promote': pl.promote = !!v; return true;
      }
      return null;
    }
  }
  return null;
}

// Commands the server injects into the turn stream on its own (player index -1).
export function applySystem(game, c) {
  if (!c || typeof c !== 'object') return null;
  if (c.k === 'ai') {
    // a player dropped out (the computer steward takes over their realm) or came back (v = null)
    const pl = game.players[int(c.s)]; if (!pl) return null;
    pl.ai = c.v === 'easy' || c.v === 'normal' || c.v === 'hard' ? c.v : null;
    return true;
  }
  return null;
}

// Cheap fingerprint of the simulation state, compared between clients to detect desyncs.
// Only reads state that the simulation itself uses; UI-only fields (winner, messages) are left out.
export function stateHash(game) {
  let h = 0x811c9dc5 | 0;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619); };
  mix(game.tickN); mix(game.nextId); mix(game.rng.s);
  mix(game.settlers.size); mix(game.wares.size); mix(game.buildings.size); mix(game.flags.size); mix(game.roads.size);
  for (const s of game.settlers.values()) { mix(s.id); mix(s.node); mix(s.next); mix(s.carry); mix(s.hp); mix(Math.round(s.t * 4096)); mix(s.path ? s.path.length : 0); }
  for (const b of game.buildings.values()) {
    mix(b.id); mix(b.owner); mix(b.soldiers.length); mix(Math.round(b.site.progress * 4096));
    if (b.stock) for (const k in b.stock) mix(b.stock[k]);
  }
  for (const w of game.wares.values()) { mix(w.id); mix(w.flag); mix(w.dest); }
  for (const pl of game.players) { mix(pl.alive ? 1 : 0); mix(pl.ai ? pl.ai.length : 0); mix(pl.killed); mix(pl.lost); }
  for (let i = 0; i < game.owner.length; i += 3) mix(game.owner[i]);
  mix(game.animals.length); mix(game.projectiles.length);
  return h >>> 0;
}
