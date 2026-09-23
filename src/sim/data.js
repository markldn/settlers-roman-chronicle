// Static game data: terrain, wares, jobs, buildings, military ranks.
// Pure data — balance is done by editing these tables.

export const TERRAIN = {
  WATER: 0, MEADOW: 1, FLOWERS: 2, STEPPE: 3, MOUNTAIN_MEADOW: 4,
  MOUNTAIN: 5, SNOW: 6, DESERT: 7, SWAMP: 8, SAND: 9,
};
export const TERRAIN_INFO = [
  { id: 'water',    walk: false, build: false, mine: false, trees: false },
  { id: 'meadow',   walk: true,  build: true,  mine: false, trees: true },
  { id: 'flowers',  walk: true,  build: true,  mine: false, trees: true },
  { id: 'steppe',   walk: true,  build: true,  mine: false, trees: true },
  { id: 'mmeadow',  walk: true,  build: true,  mine: false, trees: true },
  { id: 'mountain', walk: true,  build: false, mine: true,  trees: false },
  { id: 'snow',     walk: false, build: false, mine: false, trees: false },
  { id: 'desert',   walk: true,  build: false, mine: false, trees: false },
  { id: 'swamp',    walk: false, build: false, mine: false, trees: false },
  { id: 'sand',     walk: true,  build: false, mine: false, trees: false },
];

export const WARES = [
  // id, name, group
  ['wood', 'Wood', 'build'], ['boards', 'Boards', 'build'], ['stones', 'Stones', 'build'],
  ['fish', 'Fish', 'food'], ['meat', 'Meat', 'food'], ['bread', 'Bread', 'food'],
  ['water', 'Water', 'food'], ['grain', 'Grain', 'food'], ['flour', 'Flour', 'food'],
  ['pig', 'Pig', 'food'], ['beer', 'Beer', 'food'],
  ['coal', 'Coal', 'metal'], ['ironore', 'Iron ore', 'metal'], ['goldore', 'Gold', 'metal'],
  ['iron', 'Iron', 'metal'], ['coins', 'Coins', 'metal'],
  ['sword', 'Sword', 'military'], ['shield', 'Shield', 'military'],
  ['axe', 'Axe', 'tool'], ['saw', 'Saw', 'tool'], ['pickaxe', 'Pick-axe', 'tool'],
  ['hammer', 'Hammer', 'tool'], ['shovel', 'Shovel', 'tool'], ['crucible', 'Crucible', 'tool'],
  ['rod', 'Fishing rod', 'tool'], ['scythe', 'Scythe', 'tool'], ['cleaver', 'Cleaver', 'tool'],
  ['rollingpin', 'Rolling pin', 'tool'], ['bow', 'Bow', 'tool'], ['tongs', 'Tongs', 'tool'],
].map(([id, name, group], idx) => ({ id, name, group, idx }));
export const WARE = Object.fromEntries(WARES.map(w => [w.id, w]));
export const TOOLS = WARES.filter(w => w.group === 'tool').map(w => w.id);
export const FOODS = ['fish', 'meat', 'bread'];

// Jobs: settler professions and the tool that turns a helper into one.
export const JOBS = {
  carrier:     { name: 'Helper',       tool: null },
  builder:     { name: 'Builder',      tool: 'hammer' },
  woodcutter:  { name: 'Woodcutter',   tool: 'axe' },
  forester:    { name: 'Forester',     tool: 'shovel' },
  stonemason:  { name: 'Stonemason',   tool: 'pickaxe' },
  fisher:      { name: 'Fisherman',    tool: 'rod' },
  hunter:      { name: 'Hunter',       tool: 'bow' },
  carpenter:   { name: 'Carpenter',    tool: 'saw' },
  miller:      { name: 'Miller',       tool: null },
  baker:       { name: 'Baker',        tool: 'rollingpin' },
  brewer:      { name: 'Brewer',       tool: null },
  butcher:     { name: 'Butcher',      tool: 'cleaver' },
  founder:     { name: 'Iron founder', tool: 'crucible' },
  metalworker: { name: 'Metalworker',  tool: 'tongs' },
  armorer:     { name: 'Armorer',      tool: 'hammer' },
  minter:      { name: 'Minter',       tool: 'crucible' },
  farmer:      { name: 'Farmer',       tool: 'scythe' },
  pigbreeder:  { name: 'Pig breeder',  tool: null },
  donkeybreeder: { name: 'Donkey breeder', tool: null },
  miner:       { name: 'Miner',        tool: 'pickaxe' },
  geologist:   { name: 'Geologist',    tool: 'hammer' },
  scout:       { name: 'Scout',        tool: null },
  lookout:     { name: 'Lookout',      tool: null },
  welldigger:  { name: 'Well digger',  tool: null },
  soldier:     { name: 'Soldier',      tool: null },
  donkey:      { name: 'Donkey',       tool: null },
};

// Building definitions. size: small | medium | large | mine
// kind drives the worker logic: gather/forester/farm/convert/mine/military/warehouse/lookout/catapult
export const BUILDINGS = {
  hq:          { name: 'Headquarters', size: 'large', kind: 'warehouse', cost: {}, radius: 9, vision: 12, buildable: false, hp: 0 },
  storehouse:  { name: 'Storehouse',   size: 'medium', kind: 'warehouse', cost: { boards: 4, stones: 3 }, vision: 4 },
  woodcutter:  { name: 'Woodcutter',   size: 'small', kind: 'gather', job: 'woodcutter', cost: { boards: 2 }, out: 'wood', range: 6, work: 9, rest: 8 },
  forester:    { name: 'Forester',     size: 'small', kind: 'forester', job: 'forester', cost: { boards: 2 }, range: 5, work: 5, rest: 10 },
  quarry:      { name: 'Quarry',       size: 'small', kind: 'gather', job: 'stonemason', cost: { boards: 2 }, out: 'stones', range: 7, work: 8, rest: 8 },
  fishery:     { name: 'Fishery',      size: 'small', kind: 'gather', job: 'fisher', cost: { boards: 2 }, out: 'fish', range: 7, work: 10, rest: 10 },
  hunter:      { name: 'Hunter',       size: 'small', kind: 'gather', job: 'hunter', cost: { boards: 2 }, out: 'meat', range: 9, work: 4, rest: 12 },
  well:        { name: 'Well',         size: 'small', kind: 'convert', job: 'welldigger', cost: { boards: 2 }, inputs: {}, outs: ['water'], work: 14 },
  lookout:     { name: 'Lookout tower', size: 'small', kind: 'lookout', job: 'lookout', cost: { boards: 4 }, vision: 14 },
  sawmill:     { name: 'Sawmill',      size: 'medium', kind: 'convert', job: 'carpenter', cost: { boards: 2, stones: 2 }, inputs: { wood: 6 }, outs: ['boards'], work: 12 },
  mill:        { name: 'Mill',         size: 'medium', kind: 'convert', job: 'miller', cost: { boards: 2, stones: 2 }, inputs: { grain: 6 }, outs: ['flour'], work: 14 },
  bakery:      { name: 'Bakery',       size: 'medium', kind: 'convert', job: 'baker', cost: { boards: 2, stones: 2 }, inputs: { flour: 6, water: 6 }, outs: ['bread'], work: 16 },
  brewery:     { name: 'Brewery',      size: 'medium', kind: 'convert', job: 'brewer', cost: { boards: 2, stones: 2 }, inputs: { grain: 6, water: 6 }, outs: ['beer'], work: 16 },
  slaughterhouse: { name: 'Slaughterhouse', size: 'medium', kind: 'convert', job: 'butcher', cost: { boards: 2, stones: 2 }, inputs: { pig: 6 }, outs: ['meat'], work: 14 },
  smelter:     { name: 'Iron smelter', size: 'medium', kind: 'convert', job: 'founder', cost: { boards: 2, stones: 2 }, inputs: { ironore: 6, coal: 6 }, outs: ['iron'], work: 18 },
  metalworks:  { name: 'Metalworks',   size: 'medium', kind: 'convert', job: 'metalworker', cost: { boards: 2, stones: 2 }, inputs: { iron: 6, boards: 6 }, outs: ['tool'], work: 18 },
  armory:      { name: 'Armory',       size: 'medium', kind: 'convert', job: 'armorer', cost: { boards: 2, stones: 2 }, inputs: { iron: 6, coal: 6 }, outs: ['sword', 'shield'], work: 18 },
  mint:        { name: 'Mint',         size: 'medium', kind: 'convert', job: 'minter', cost: { boards: 2, stones: 2 }, inputs: { goldore: 6, coal: 6 }, outs: ['coins'], work: 20 },
  farm:        { name: 'Farm',         size: 'large', kind: 'farm', job: 'farmer', cost: { boards: 3, stones: 3 }, out: 'grain', range: 2, work: 6, rest: 6 },
  pigfarm:     { name: 'Pig farm',     size: 'large', kind: 'convert', job: 'pigbreeder', cost: { boards: 3, stones: 3 }, inputs: { grain: 6, water: 6 }, outs: ['pig'], work: 22 },
  donkeybreeder: { name: 'Donkey breeder', size: 'large', kind: 'convert', job: 'donkeybreeder', cost: { boards: 3, stones: 3 }, inputs: { grain: 6, water: 6 }, outs: ['donkey'], work: 30 },
  coalmine:    { name: 'Coal mine',    size: 'mine', kind: 'mine', job: 'miner', cost: { boards: 4 }, inputs: { food: 6 }, out: 'coal', res: 'coal', work: 14 },
  ironmine:    { name: 'Iron mine',    size: 'mine', kind: 'mine', job: 'miner', cost: { boards: 4 }, inputs: { food: 6 }, out: 'ironore', res: 'iron', work: 16 },
  goldmine:    { name: 'Gold mine',    size: 'mine', kind: 'mine', job: 'miner', cost: { boards: 4 }, inputs: { food: 6 }, out: 'goldore', res: 'gold', work: 18 },
  granitemine: { name: 'Granite mine', size: 'mine', kind: 'mine', job: 'miner', cost: { boards: 4 }, inputs: { food: 6 }, out: 'stones', res: 'granite', work: 12 },
  barracks:    { name: 'Barracks',     size: 'small', kind: 'military', cost: { boards: 2 }, soldiers: 2, radius: 8, vision: 11, coins: 1 },
  guardhouse:  { name: 'Guardhouse',   size: 'small', kind: 'military', cost: { boards: 2, stones: 3 }, soldiers: 3, radius: 9, vision: 12, coins: 2 },
  watchtower:  { name: 'Watchtower',   size: 'medium', kind: 'military', cost: { boards: 3, stones: 5 }, soldiers: 6, radius: 10, vision: 14, coins: 4 },
  fortress:    { name: 'Fortress',     size: 'large', kind: 'military', cost: { boards: 4, stones: 7 }, soldiers: 9, radius: 11, vision: 15, coins: 6 },
  catapult:    { name: 'Catapult',     size: 'medium', kind: 'catapult', job: 'lookout', cost: { boards: 4, stones: 2 }, inputs: { stones: 4 }, range: 13, work: 12 },
};
for (const [id, b] of Object.entries(BUILDINGS)) {
  b.id = id;
  if (b.buildable === undefined) b.buildable = true;
  if (!b.vision) b.vision = b.size === 'large' ? 5 : 4;
}

// What the build menu shows per tab (S2 order).
export const BUILD_MENU = {
  small: ['woodcutter', 'forester', 'quarry', 'fishery', 'hunter', 'well', 'lookout', 'barracks', 'guardhouse'],
  medium: ['sawmill', 'mill', 'bakery', 'brewery', 'slaughterhouse', 'smelter', 'metalworks', 'armory', 'mint', 'storehouse', 'watchtower', 'catapult'],
  large: ['farm', 'pigfarm', 'donkeybreeder', 'fortress'],
  mine: ['coalmine', 'ironmine', 'goldmine', 'granitemine'],
};
export const SIZE_RANK = { flag: 0, small: 1, medium: 2, large: 3, mine: 9 };

// Soldier ranks (S2: Private .. General). hp and attack scale with rank.
export const RANKS = [
  { name: 'Private',        hp: 3, atk: [1, 2], def: 0.25 },
  { name: 'Private 1st cl.', hp: 4, atk: [1, 3], def: 0.3 },
  { name: 'Sergeant',       hp: 5, atk: [2, 3], def: 0.35 },
  { name: 'Officer',        hp: 6, atk: [2, 4], def: 0.4 },
  { name: 'General',        hp: 8, atk: [3, 5], def: 0.45 },
];

// Default transport priority (S2 "transport" window). Lower index = carried first.
export const DEFAULT_TRANSPORT = [
  'coins', 'sword', 'shield', 'beer', 'axe', 'saw', 'pickaxe', 'hammer', 'shovel', 'crucible', 'rod', 'scythe',
  'cleaver', 'rollingpin', 'bow', 'tongs', 'boards', 'stones', 'wood', 'iron', 'goldore', 'ironore', 'coal',
  'fish', 'meat', 'bread', 'grain', 'flour', 'water', 'pig',
];

export const NATIONS = {
  romans:   { name: 'Romans',   roof: 0xa8452f, wall: 0xe6dcc4, trim: 0x8b6b43, banner: 'eagle' },
  vikings:  { name: 'Vikings',  roof: 0x5a4632, wall: 0x9b7b56, trim: 0x3b2c1e, banner: 'raven' },
  nubians:  { name: 'Nubians',  roof: 0xc9a25a, wall: 0xd7b98a, trim: 0x7a5a30, banner: 'sun' },
  japanese: { name: 'Japanese', roof: 0x3d4a5a, wall: 0xf0ece0, trim: 0x6a2a20, banner: 'wave' },
};
export const PLAYER_COLORS = [0x2f6fdc, 0xd8352b, 0xe8c12a, 0x8a3fc9, 0x2aa84a, 0xe07b1f, 0x1fb3b3];
export const PLAYER_COLOR_NAMES = ['Blue', 'Red', 'Yellow', 'Purple', 'Green', 'Orange', 'Cyan'];

export const DEFAULT_START = {
  wares: { wood: 24, boards: 44, stones: 68, fish: 4, meat: 6, bread: 8, water: 12, grain: 10, flour: 0, pig: 0, beer: 12,
    coal: 16, ironore: 16, goldore: 0, iron: 16, coins: 0, sword: 0, shield: 0,
    axe: 6, saw: 2, pickaxe: 4, hammer: 12, shovel: 2, crucible: 2, rod: 2, scythe: 5, cleaver: 1, rollingpin: 1, bow: 2, tongs: 1 },
  people: { carrier: 40, builder: 6, woodcutter: 2, stonemason: 2, forester: 1, geologist: 3, soldier: 12, donkey: 0 },
};
