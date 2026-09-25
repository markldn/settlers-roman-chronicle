// Campaign chapters and objective tracking. Story and maps are original (procedural, seeded).
import { BUILDINGS, DEFAULT_START } from './data.js';

const START_LOW = {
  wares: { wood: 10, boards: 28, stones: 32, fish: 2, meat: 2, bread: 2, water: 4, grain: 4, beer: 4, coal: 4, ironore: 4, iron: 4,
    axe: 3, saw: 1, pickaxe: 2, hammer: 8, shovel: 2, crucible: 1, rod: 1, scythe: 2, cleaver: 1, rollingpin: 1, bow: 1, tongs: 1 },
  people: { carrier: 28, builder: 4, woodcutter: 1, stonemason: 1, forester: 1, geologist: 2, soldier: 6 },
};
const START_HIGH = {
  wares: Object.fromEntries(Object.entries(DEFAULT_START.wares).map(([k, v]) => [k, Math.round(v * 1.6) + 2])),
  people: Object.fromEntries(Object.entries(DEFAULT_START.people).map(([k, v]) => [k, Math.round(v * 1.5)])),
};
export const START_PRESETS = { low: START_LOW, normal: DEFAULT_START, high: START_HIGH };

export const CAMPAIGN = [
  {
    id: 'c1', title: 'I. Landfall',
    brief: `The storm broke our fleet on an unknown coast. Of the legion only a few hundred souls reached the shore with what the waves spared — tools, planks, a handful of soldiers.\n\nBefore anything else we need timber and stone. Cut wood, saw it into boards, quarry the rocks and push our border outwards so there is room to build.`,
    map: { w: 56, h: 56, seed: 101, players: 1, theme: 'greenland', water: 0.45, mountains: 0.3, forest: 0.6, layout: 'continent' },
    players: [{ name: 'Legatus', human: true }],
    objectives: [
      { kind: 'build', type: 'woodcutter', count: 2, text: 'Build 2 woodcutters' },
      { kind: 'build', type: 'sawmill', count: 1, text: 'Build a sawmill' },
      { kind: 'build', type: 'quarry', count: 1, text: 'Build a quarry' },
      { kind: 'build', type: 'forester', count: 1, text: 'Build a forester' },
      { kind: 'produce', ware: 'boards', count: 20, text: 'Saw 20 boards' },
      { kind: 'land', count: 420, text: 'Extend your land to 420 nodes (build barracks near the border)' },
    ],
    hints: [
      [3, 'Click an empty spot of your land to open the build menu. Press SPACE to show where each size of building fits.'],
      [25, 'Every building needs a road from its flag to your network. After placing a building you are put straight into road mode: click your way to another flag.'],
      [70, 'Long roads are slow — click on a road and place extra flags. Each road segment gets its own carrier.'],
      [140, 'Woodcutters need trees nearby; a forester replants them. Build them close together.'],
      [220, 'Barracks and guardhouses extend your border once a soldier moves in.'],
    ],
  },
  {
    id: 'c2', title: 'II. Fields of Plenty',
    brief: `Our people are hungry, and hungry hands build nothing. The valley past the woods is fertile — sow grain, grind it to flour, and with water from the wells bake bread.\n\nFish from the lakes and game from the forests will feed the miners we will need soon.`,
    map: { w: 64, h: 64, seed: 202, players: 1, theme: 'greenland', water: 0.55, mountains: 0.35, forest: 0.5, layout: 'lakes' },
    players: [{ name: 'Legatus', human: true, start: 'normal' }],
    objectives: [
      { kind: 'build', type: 'farm', count: 2, text: 'Build 2 farms' },
      { kind: 'build', type: 'well', count: 1, text: 'Dig a well' },
      { kind: 'build', type: 'mill', count: 1, text: 'Build a mill' },
      { kind: 'build', type: 'bakery', count: 1, text: 'Build a bakery' },
      { kind: 'produce', ware: 'bread', count: 12, text: 'Bake 12 loaves of bread' },
      { kind: 'produce', ware: 'fish', count: 8, text: 'Catch 8 fish' },
    ],
    hints: [[4, 'Farms are large buildings: they need flat, open ground. Watch the build-help icons (SPACE).'], [60, 'A fishery must be placed near a shore with fish; a hunter near forests with deer.']],
  },
  {
    id: 'c3', title: 'III. Iron in the Hills',
    brief: `Scouts report dark mountains to the north. Where there are mountains there may be coal and iron — send geologists to find out.\n\nMiners must be fed, and ore must be smelted. With iron and boards our metalworks can forge the tools our new workers need.`,
    map: { w: 72, h: 64, seed: 303, players: 1, theme: 'greenland', water: 0.4, mountains: 0.75, forest: 0.5, layout: 'continent' },
    players: [{ name: 'Legatus', human: true, start: 'normal' }],
    objectives: [
      { kind: 'build', type: 'coalmine', count: 1, text: 'Open a coal mine' },
      { kind: 'build', type: 'ironmine', count: 1, text: 'Open an iron mine' },
      { kind: 'build', type: 'smelter', count: 1, text: 'Build an iron smelter' },
      { kind: 'build', type: 'metalworks', count: 1, text: 'Build a metalworks' },
      { kind: 'produce', ware: 'iron', count: 12, text: 'Smelt 12 iron bars' },
    ],
    hints: [[5, 'Click a flag on the mountain and choose "Send geologist". Signs show what lies beneath: black = coal, red = iron, yellow = gold, grey = granite.'], [80, 'Mines consume fish, meat or bread for each load of ore.']],
  },
  {
    id: 'c4', title: 'IV. The First Blades',
    brief: `Smoke on the eastern horizon: we are not alone. A tribe has settled beyond the hills, and their scouts have been watching us.\n\nForge swords and shields, brew beer for the recruits, and train an army. When we are ready, take their headquarters.`,
    map: { w: 72, h: 72, seed: 404, players: 2, theme: 'greenland', water: 0.45, mountains: 0.55, forest: 0.55, layout: 'continent' },
    players: [{ name: 'Legatus', human: true, start: 'normal' }, { name: 'Brennus', ai: 'easy', nation: 'vikings' }],
    objectives: [
      { kind: 'build', type: 'armory', count: 1, text: 'Build an armory' },
      { kind: 'build', type: 'brewery', count: 1, text: 'Build a brewery' },
      { kind: 'soldiers', count: 20, text: 'Command 20 soldiers' },
      { kind: 'conquer', text: 'Defeat Brennus' },
    ],
    hints: [[5, 'Soldiers are recruited automatically in the headquarters from a helper, a sword, a shield and a beer.'], [300, 'Click an enemy military building to attack it with soldiers from your nearby garrisons.']],
  },
  {
    id: 'c5', title: 'V. The River Crossing',
    brief: `A broad river divides the land. On the far bank a warlord commands a disciplined army and he knows these lands better than we do.\n\nSecure the fords, build a strong economy, and train officers — send gold coins to your garrisons to promote their soldiers.`,
    map: { w: 80, h: 72, seed: 505, players: 2, theme: 'greenland', water: 0.5, mountains: 0.5, forest: 0.5, layout: 'valley', starts: [[0.5, 0.2], [0.5, 0.82]] },
    players: [{ name: 'Legatus', human: true, start: 'normal' }, { name: 'Ambiorix', ai: 'normal', nation: 'vikings' }],
    objectives: [
      { kind: 'build', type: 'mint', count: 1, text: 'Build a mint' },
      { kind: 'conquer', text: 'Defeat Ambiorix' },
    ],
    hints: [[10, 'Military buildings accept coins and promote their soldiers. Higher ranks win far more fights.']],
  },
  {
    id: 'c6', title: 'VI. Winter\'s Grip',
    brief: `Winter has come to the northern coast. Two clans hold the frozen passes and will not let us through.\n\nFood will be scarce and the mountains treacherous. Break both of them before the snows bury us.`,
    map: { w: 84, h: 76, seed: 606, players: 3, theme: 'winter', water: 0.45, mountains: 0.6, forest: 0.45, layout: 'continent' },
    players: [{ name: 'Legatus', human: true, start: 'normal' }, { name: 'Harald', ai: 'easy', nation: 'vikings' }, { name: 'Sigrid', ai: 'normal', nation: 'vikings' }],
    objectives: [{ kind: 'conquer', text: 'Defeat Harald and Sigrid' }],
    hints: [[10, 'On snowy maps, meadows are rare: plan farms carefully.']],
  },
  {
    id: 'c7', title: 'VII. The Burning Sands',
    brief: `Beyond the sea lies a land of dust and heat, ruled by a queen whose warriors are as hard as the stone they live on.\n\nWe arrive with little. Every board counts.`,
    map: { w: 80, h: 80, seed: 707, players: 2, theme: 'wasteland', water: 0.35, mountains: 0.55, forest: 0.35, layout: 'continent' },
    players: [{ name: 'Legatus', human: true, start: 'low' }, { name: 'Amanirenas', ai: 'hard', nation: 'nubians' }],
    objectives: [{ kind: 'conquer', text: 'Defeat Amanirenas' }],
    hints: [[10, 'Starting goods are scarce: a sawmill and quarry come first.']],
  },
  {
    id: 'c8', title: 'VIII. The Last Legion',
    brief: `The road home leads through the lands of three kings. They have heard of us, and they have made an alliance.\n\nThis is the last campaign. Win it, and we sail for Rome.`,
    map: { w: 104, h: 96, seed: 808, players: 4, theme: 'greenland', water: 0.45, mountains: 0.55, forest: 0.55, layout: 'continent' },
    players: [{ name: 'Legatus', human: true, start: 'high' }, { name: 'Yoritomo', ai: 'normal', nation: 'japanese', team: 1 }, { name: 'Taharqa', ai: 'normal', nation: 'nubians', team: 1 }, { name: 'Ragnar', ai: 'hard', nation: 'vikings', team: 1 }],
    objectives: [{ kind: 'conquer', text: 'Defeat the three kings' }],
    hints: [],
  },
];

export function makeSetup(ch, extra = {}) {
  const players = ch.players.map(p => Object.assign({}, p, { start: START_PRESETS[p.start || 'normal'] }));
  return { seed: ch.map.seed, mapOpts: Object.assign({}, ch.map, { players: players.length }), players, mission: ch.id, ...extra };
}

export function freeSetup(o) {
  const sizes = { small: [56, 56], medium: [80, 72], large: [112, 100], huge: [144, 128] };
  const [w, h] = sizes[o.size] || sizes.medium;
  const nations = ['vikings', 'nubians', 'japanese', 'romans', 'vikings', 'nubians'];
  const names = ['Brennus', 'Ambiorix', 'Sigrid', 'Taharqa', 'Yoritomo', 'Ragnar'];
  const players = [{ name: o.name || 'You', human: true, nation: o.nation || 'romans', start: START_PRESETS[o.start || 'normal'] }];
  for (let i = 0; i < o.opponents; i++) players.push({ name: names[i], ai: o.ai || 'normal', nation: nations[i], start: START_PRESETS[o.aiStart || o.start || 'normal'], team: o.teams ? 1 : i + 1 });
  return { seed: o.seed, mapOpts: { w, h, seed: o.seed, players: players.length, theme: o.theme, water: o.water ?? 0.5, mountains: o.mountains ?? 0.5, forest: o.forest ?? 0.5, layout: o.layout || 'continent' }, players, mission: null };
}

// Multiplayer: the room's settings plus its seats (in slot order) become a setup that every client
// builds identically. Humans take the first slots, computer players the rest; at most MAX_PLAYERS.
export const MAX_PLAYERS = 6;
export const MP_DEFAULTS = { size: 'medium', theme: 'greenland', layout: 'continent', mountains: 5, forest: 5, water: 5, ai: 0, aiLevel: 'normal', aiTeam: false, start: 'normal', seed: 0 };
export function mpSetup(settings, seats, seed) {
  const o = Object.assign({}, MP_DEFAULTS, settings);
  const sizes = { small: [56, 56], medium: [80, 72], large: [112, 100], huge: [144, 128] };
  const [w, h] = sizes[o.size] || sizes.medium;
  const start = START_PRESETS[o.start] ? o.start : 'normal';
  const ai = ['easy', 'normal', 'hard'].includes(o.aiLevel) ? o.aiLevel : 'normal';
  const clamp01 = (v) => Math.max(0, Math.min(1, (+v || 0) / 10));
  const players = seats.slice(0, MAX_PLAYERS).map((s, i) => {
    const p = { name: String(s.name || `Player ${i + 1}`).slice(0, 20), human: true, nation: NATIONS_OK.includes(s.nation) ? s.nation : 'romans', start: START_PRESETS[start] };
    if (s.team >= 1 && s.team <= 4) p.team = 100 + s.team;
    return p;
  });
  const names = ['Brennus', 'Ambiorix', 'Sigrid', 'Taharqa', 'Yoritomo', 'Ragnar'];
  const nations = ['vikings', 'nubians', 'japanese', 'romans', 'vikings', 'nubians'];
  const aiN = Math.max(0, Math.min(MAX_PLAYERS - players.length, o.ai | 0));
  for (let i = 0; i < aiN; i++) {
    const p = { name: names[i], ai, nation: nations[i], start: START_PRESETS[start] };
    if (o.aiTeam) p.team = 99;
    players.push(p);
  }
  return {
    seed, players, mission: null, mp: true,
    mapOpts: { w, h, seed, players: players.length, theme: ['greenland', 'winter', 'wasteland'].includes(o.theme) ? o.theme : 'greenland',
      water: clamp01(o.water), mountains: clamp01(o.mountains), forest: clamp01(o.forest), layout: ['continent', 'lakes', 'valley', 'islands', 'pass'].includes(o.layout) ? o.layout : 'continent' },
  };
}
const NATIONS_OK = ['romans', 'vikings', 'nubians', 'japanese'];

// ------------------------------------------------------------------ objectives
export function initMission(game) {
  const ch = CAMPAIGN.find(c => c.id === game.setup.mission);
  if (!ch) { game.missionState = null; return; }
  game.missionState = { id: ch.id, done: ch.objectives.map(() => false), won: false, lost: false, hintsShown: 0 };
}

export function checkMission(game, me = 0) {
  const ms = game.missionState;
  const pl = game.players[me];
  const res = { changed: false, won: false, lost: false, hint: null };
  if (!pl.alive && !(ms && ms.lost)) { if (ms) ms.lost = true; res.lost = true; return res; }
  if (!ms) {
    // free play: last one standing
    const enemies = game.players.filter(p => p.id !== me && p.team !== pl.team);
    if (enemies.length && enemies.every(p => !p.alive) && game.winner < 0) { game.winner = me; res.won = true; }
    return res;
  }
  if (ms.won || ms.lost) return res;
  const ch = CAMPAIGN.find(c => c.id === ms.id);
  ch.objectives.forEach((o, i) => {
    if (ms.done[i]) return;
    if (evalObjective(game, me, o)) { ms.done[i] = true; res.changed = true; game.message(me, `Objective complete: ${o.text}`, -1, 'goal'); }
  });
  while (ms.hintsShown < ch.hints.length && game.time >= ch.hints[ms.hintsShown][0]) { res.hint = ch.hints[ms.hintsShown][1]; ms.hintsShown++; }
  if (ms.done.every(Boolean)) { ms.won = true; res.won = true; }
  return res;
}

export function objectiveProgress(game, me, o) {
  const pl = game.players[me];
  switch (o.kind) {
    case 'build': { let n = 0; for (const b of game.buildings.values()) if (b.owner === me && b.type === o.type && b.state === 'done') n++; return [n, o.count]; }
    case 'produce': return [pl.produced[o.ware] || 0, o.count];
    case 'land': { let n = 0; for (let i = 0; i < game.grid.n; i++) if (game.owner[i] === me + 1) n++; return [n, o.count]; }
    case 'soldiers': { let n = 0; for (const s of game.settlers.values()) if (s.owner === me && s.job === 'soldier') n++; for (const b of game.buildings.values()) if (b.owner === me && b.people) n += b.people.soldier || 0; return [n, o.count]; }
    case 'conquer': { const en = game.players.filter(p => p.id !== me && p.team !== pl.team); return [en.filter(p => !p.alive).length, en.length]; }
  }
  return [0, 1];
}
function evalObjective(game, me, o) { const [a, b] = objectiveProgress(game, me, o); return a >= b; }

export function campaignProgress() {
  try { return JSON.parse(localStorage.getItem('settlers.campaign') || '{"unlocked":1}'); } catch { return { unlocked: 1 }; }
}
export function unlockNext(id) {
  const p = campaignProgress(); const i = CAMPAIGN.findIndex(c => c.id === id);
  p.unlocked = Math.max(p.unlocked, i + 2); p['won_' + id] = true;
  try { localStorage.setItem('settlers.campaign', JSON.stringify(p)); } catch { /* ignore */ }
}
export { BUILDINGS };
