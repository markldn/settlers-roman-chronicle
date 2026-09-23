// Procedural map generation. Produces the static world (terrain, heights, resources) plus
// initial trees, stone piles, animals and player start nodes.
import { Grid, RNG, makeNoise } from './grid.js';
import { TERRAIN as T, TERRAIN_INFO } from './data.js';

export const RES = { NONE: 0, COAL: 1, IRON: 2, GOLD: 3, GRANITE: 4, WATER: 5, FISH: 6 };
export const RES_NAMES = ['none', 'coal', 'iron', 'gold', 'granite', 'water', 'fish'];
export const SEA = 6; // height level of the water surface

/**
 * opts: { w, h, seed, players, theme, water (0..1), mountains (0..1), forest (0..1),
 *         layout: 'continent'|'islands'|'valley'|'pass'|'lakes', starts?: [[fx,fy],...] }
 */
export function generateMap(opts) {
  const o = Object.assign({ w: 64, h: 64, seed: 1, players: 2, theme: 'greenland', water: 0.5, mountains: 0.5, forest: 0.5, layout: 'continent' }, opts);
  const g = new Grid(o.w, o.h);
  const rng = new RNG(o.seed * 9301 + 49297);
  const nH = makeNoise(o.seed), nM = makeNoise(o.seed + 11), nR = makeNoise(o.seed + 23), nF = makeNoise(o.seed + 37), nX = makeNoise(o.seed + 51);
  const N = g.n;
  const hf = new Float32Array(N);
  const terrain = new Uint8Array(N), height = new Uint8Array(N);
  const res = new Uint8Array(N), resAmt = new Uint8Array(N);

  // ---- height field -------------------------------------------------------
  const sc = 1 / 18;
  for (let i = 0; i < N; i++) {
    const x = g.wx(i), y = g.wz(i);
    const u = x / o.w, v = y / (o.h * 0.866);
    let e = nH(x * sc, y * sc, 5) * 0.9 + 0.35;
    // edge falloff so the map is surrounded by sea
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const fall = Math.min(1, edge / 0.12);
    if (o.layout === 'islands') e = e * 0.8 + (nX(x / 10, y / 10, 3) * 0.5) - 0.05;
    if (o.layout === 'lakes') e += 0.12 - Math.max(0, -nX(x / 9, y / 9, 3)) * 0.9;
    if (o.layout === 'valley') { const river = Math.abs(v - 0.5 + nX(x / 14, 0.5, 2) * 0.18); e = Math.min(e + 0.1, e * 0.4 + river * 2.4 - 0.08); }
    e = e * (0.35 + 0.65 * fall) - (1 - fall) * 0.4;
    e += (0.5 - o.water) * 0.35;
    // ridged mountains
    const ridge = 1 - Math.abs(nR(x / 16, y / 16, 4));
    let m = Math.max(0, ridge - (1.02 - o.mountains * 0.45)) * 5.5;
    if (o.layout === 'pass') { const band = Math.abs(u - 0.5); m = Math.max(m, band < 0.09 && Math.abs(v - 0.5) > 0.1 ? 1.2 - band * 6 : 0); }
    hf[i] = e + m * fall;
  }
  // map continuous field to levels
  for (let i = 0; i < N; i++) {
    const e = hf[i];
    let h;
    if (e < 0.18) h = Math.max(0, Math.round(SEA - 1 - (0.18 - e) * 14));
    else h = SEA + 1 + Math.round((e - 0.18) * 17);
    height[i] = Math.max(0, Math.min(40, h));
  }

  // ---- terrain classes ----------------------------------------------------
  for (let i = 0; i < N; i++) {
    const h = height[i], x = g.wx(i), y = g.wz(i), e = hf[i];
    if (h <= SEA - 1) { terrain[i] = T.WATER; continue; }
    const moist = nM(x / 12, y / 12, 3);
    if (h >= SEA + 13 + (moist > 0.1 ? 0 : 1)) terrain[i] = T.SNOW;
    else if (h >= SEA + 9) terrain[i] = T.MOUNTAIN;
    else if (h >= SEA + 7) terrain[i] = moist > -0.1 ? T.MOUNTAIN_MEADOW : T.MOUNTAIN;
    else if (moist < -0.32 && o.theme !== 'winter') terrain[i] = T.DESERT;
    else if (moist < -0.18) terrain[i] = T.STEPPE;
    else if (moist > 0.36 && h <= SEA + 2) terrain[i] = T.SWAMP;
    else terrain[i] = moist > 0.12 && nF(x / 5, y / 5, 2) > 0.1 ? T.FLOWERS : T.MEADOW;
    if (e < 0.26 && h === SEA + 1 && rng.chance(0.55) && terrain[i] !== T.SWAMP) terrain[i] = T.SAND;
  }
  // water nodes that touch land stay slightly deeper for nice shores
  for (let i = 0; i < N; i++) if (terrain[i] === T.WATER) height[i] = Math.min(height[i], SEA - 1);

  // ---- player start positions --------------------------------------------
  const starts = [];
  const suitable = (i, r) => {
    for (const j of g.within(i, r)) {
      const t = terrain[j];
      if (!TERRAIN_INFO[t].build) return false;
    }
    return true;
  };
  if (o.starts) {
    for (const [fx, fy] of o.starts) {
      let c = g.idx(Math.round(fx * (o.w - 1)), Math.round(fy * (o.h - 1)));
      starts.push(c);
    }
  } else {
    let cand = [];
    // prefer fully buildable surroundings, relax until enough spots exist (deserts, islands)
    for (const r of [3, 2, 1, 0]) {
      cand = [];
      for (let i = 0; i < N; i++) {
        const x = g.x(i), y = g.y(i);
        if (x < 8 || y < 8 || x > o.w - 9 || y > o.h - 9) continue;
        if (r > 0 ? suitable(i, r) : TERRAIN_INFO[terrain[i]].walk) cand.push(i);
      }
      if (cand.length >= o.players * 12) break;
    }
    // farthest-point sampling
    if (cand.length) {
      starts.push(cand[rng.int(cand.length)]);
      while (starts.length < o.players) {
        let best = -1, bd = -1;
        for (const c of cand) { let d = 1e9; for (const s of starts) d = Math.min(d, g.dist(c, s)); if (d > bd) { bd = d; best = c; } }
        if (best < 0) break; starts.push(best);
      }
    }
  }
  // carve winding valleys between starts so every pair of players can reach each other
  if (!o.noValleys) for (let a = 0; a < starts.length; a++) {
    const b = (a + 1) % starts.length; if (b === a || (starts.length === 2 && a === 1)) continue;
    const ax = g.wx(starts[a]), az = g.wz(starts[a]), bx = g.wx(starts[b]), bz = g.wz(starts[b]);
    const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len * 2);
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, wob = nX(t * 3 + a * 7, 0.5, 2) * len * 0.22 * Math.sin(Math.PI * t);
      const cx = ax + (bx - ax) * t + nx * wob, cz = az + (bz - az) * t + nz * wob;
      const c = g.nearestNode(cx, cz); if (c < 0) continue;
      for (const j of g.within(c, 3)) {
        const d = g.dist(c, j);
        if (terrain[j] === T.WATER && d > 1) continue;
        if (terrain[j] === T.MOUNTAIN || terrain[j] === T.SNOW || terrain[j] === T.SWAMP || terrain[j] === T.WATER || terrain[j] === T.DESERT)
          terrain[j] = d <= 1 ? T.MEADOW : T.MOUNTAIN_MEADOW;
        if (height[j] > SEA + 7) height[j] = SEA + 7 - (d <= 1 ? 1 : 0);
        if (height[j] < SEA + 1) height[j] = SEA + 1;
      }
    }
  }
  // make every start flat, green and dry
  for (const s of starts) {
    const base = Math.max(SEA + 2, Math.min(SEA + 5, height[s]));
    for (const j of g.within(s, 6)) {
      const d = g.dist(s, j);
      const t = d <= 3 ? 1 : (6 - d) / 3;
      height[j] = Math.round(height[j] * (1 - t) + base * t);
      if (d <= 4 || terrain[j] === T.WATER || terrain[j] === T.SWAMP || terrain[j] === T.SNOW || terrain[j] === T.DESERT || terrain[j] === T.SAND)
        terrain[j] = d <= 5 ? (terrain[j] === T.FLOWERS ? T.FLOWERS : T.MEADOW) : terrain[j] === T.WATER ? T.WATER : T.MEADOW;
      if (terrain[j] !== T.WATER && height[j] <= SEA) height[j] = SEA + 1;
    }
  }
  // limit slopes so the terrain is walkable: neighbour height diff <= 4
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < N; i++) {
    if (terrain[i] === T.WATER) continue;
    for (let d = 0; d < 6; d++) { const j = g.neighbor(i, d); if (j < 0 || terrain[j] === T.WATER) continue; if (height[i] - height[j] > 4) height[i] = height[j] + 4; }
  }

  // ---- resources ----------------------------------------------------------
  const nC = makeNoise(o.seed + 71);
  for (let i = 0; i < N; i++) {
    const t = terrain[i], x = g.wx(i), y = g.wz(i);
    if (t === T.MOUNTAIN) {
      const v = nC(x / 6, y / 6, 2), w = nC(x / 6 + 40, y / 6 + 17, 2);
      if (v > 0.18) { res[i] = RES.COAL; resAmt[i] = 6 + rng.int(8); }
      else if (v < -0.2) { res[i] = RES.IRON; resAmt[i] = 6 + rng.int(8); }
      else if (w > 0.33) { res[i] = RES.GOLD; resAmt[i] = 4 + rng.int(6); }
      else if (w < -0.1) { res[i] = RES.GRANITE; resAmt[i] = 6 + rng.int(8); }
    } else if (t === T.WATER) {
      // fish near shore
      let shore = false; for (let d = 0; d < 6; d++) { const j = g.neighbor(i, d); if (j >= 0 && terrain[j] !== T.WATER) shore = true; }
      if (shore || rng.chance(0.3)) { res[i] = RES.FISH; resAmt[i] = 4 + rng.int(8); }
    } else if (TERRAIN_INFO[t].build) {
      if (nC(x / 8 + 90, y / 8, 2) > -0.35) { res[i] = RES.WATER; resAmt[i] = 8 + rng.int(8); }
    }
  }
  // starting mountains near each HQ get a guaranteed mix (S2 maps are designed this way)
  for (const s of starts) {
    const mts = g.within(s, 16).filter(j => terrain[j] === T.MOUNTAIN).sort((a, b) => g.dist(a, s) - g.dist(b, s));
    const kinds = [RES.COAL, RES.IRON, RES.COAL, RES.GRANITE, RES.GOLD];
    let k = 0;
    for (const m of mts) { if (res[m] === 0 && rng.chance(0.4)) { res[m] = kinds[k++ % kinds.length]; resAmt[m] = 6 + rng.int(6); } }
  }

  // ---- objects: trees, stones ---------------------------------------------
  const obj = new Array(N).fill(null);
  const treeSpecies = o.theme === 'wasteland' ? ['palm', 'dead', 'pine'] : o.theme === 'winter' ? ['pine', 'fir', 'birch'] : ['oak', 'pine', 'birch', 'fir', 'beech'];
  for (let i = 0; i < N; i++) {
    const t = terrain[i]; if (!TERRAIN_INFO[t].trees) continue;
    if (starts.some(s => g.dist(s, i) <= 3)) continue;
    const x = g.wx(i), y = g.wz(i);
    const f = nF(x / 9, y / 9, 4) + (o.forest - 0.5) * 0.5;
    const p = f > 0.12 ? 0.62 : f > 0.0 ? 0.18 : 0.025;
    if (rng.chance(p)) {
      let sp = t === T.MOUNTAIN_MEADOW ? (rng.chance(0.7) ? 'pine' : 'fir') : rng.pick(treeSpecies);
      if (t === T.STEPPE && o.theme !== 'winter') sp = rng.chance(0.5) ? 'palm' : sp;
      obj[i] = { t: 'tree', sp, g: 1, v: rng.int(1000) };
    }
  }
  // stone piles: clusters near mountains + a few scattered
  const nS = makeNoise(o.seed + 91);
  for (let i = 0; i < N; i++) {
    if (obj[i] || !TERRAIN_INFO[terrain[i]].walk || terrain[i] === T.MOUNTAIN) continue;
    if (starts.some(s => g.dist(s, i) <= 3)) continue;
    const x = g.wx(i), y = g.wz(i);
    let nearMt = false; for (let d = 0; d < 6; d++) { const j = g.neighbor(i, d); if (j >= 0 && terrain[j] === T.MOUNTAIN) nearMt = true; }
    const v = nS(x / 7, y / 7, 2);
    if ((v > 0.34 && rng.chance(0.55)) || (nearMt && rng.chance(0.12)) || rng.chance(0.004)) obj[i] = { t: 'stone', a: 3 + rng.int(5), v: rng.int(1000) };
  }
  // guarantee wood and stone within reach of every start
  for (const s of starts) {
    const ring = g.within(s, 9).filter(j => g.dist(s, j) >= 5 && !obj[j] && TERRAIN_INFO[terrain[j]].build);
    let trees = ring.filter(j => g.dist(s, j) >= 5).sort(() => rng.next() - 0.5);
    for (let k = 0; k < 14 && k < trees.length; k++) obj[trees[k]] = { t: 'tree', sp: rng.pick(treeSpecies), g: 1, v: rng.int(1000) };
    const free = ring.filter(j => !obj[j]);
    if (free.length) {
      const c = free[rng.int(free.length)];
      for (const j of g.within(c, 1)) if (!obj[j] && TERRAIN_INFO[terrain[j]].walk && terrain[j] !== T.MOUNTAIN) obj[j] = { t: 'stone', a: 4 + rng.int(4), v: rng.int(1000) };
    }
  }

  // ---- animals -----------------------------------------------------------
  const animals = [];
  let aid = 1;
  for (let k = 0; k < (o.w * o.h) / 160; k++) {
    const i = rng.int(N);
    if (!TERRAIN_INFO[terrain[i]].walk || terrain[i] === T.MOUNTAIN) continue;
    if (starts.some(s => g.dist(s, i) <= 5)) continue;
    animals.push({ id: aid++, kind: rng.chance(0.55) ? 'deer' : rng.chance(0.5) ? 'rabbit' : 'fox', node: i, next: -1, t: 0, path: [], wait: rng.range(0, 8), home: i });
  }
  // ducks on the water (decorative, not huntable)
  for (let k = 0; k < (o.w * o.h) / 700; k++) {
    const i = rng.int(N); if (terrain[i] !== T.WATER) continue;
    animals.push({ id: aid++, kind: 'duck', node: i, next: -1, t: 0, path: [], wait: rng.range(0, 8), home: i });
  }

  return { w: o.w, h: o.h, seed: o.seed, theme: o.theme, terrain, height, res, resAmt, obj, animals, starts, nextAnimalId: aid };
}
