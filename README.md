# Settlers — A Roman Chronicle

A browser strategy game in the spirit of **The Settlers II Gold**, built with three.js. Every ware is carried by hand from flag to flag, every worker needs a tool, and the land only grows as far as your soldiers can hold it.

**Nothing is downloaded but code.** Terrain, buildings, settlers, textures, icons, sound effects and music are all generated in your browser at startup. There are no image or audio files in this repository apart from the README screenshots.

![Title screen with the AI demo running behind the menu](docs/screenshots/title.jpg)

## Screenshots

| | |
|---|---|
| ![A growing Roman town: headquarters, windmill, cobbled busy roads, carriers on every segment](docs/screenshots/town-greenland.jpg) | ![Close-up of a sawmill and workers](docs/screenshots/closeup.jpg) |
| **Greenland** — roads, flags, carriers, and cobbled roads where traffic is heavy | **Close-up** — every settler is animated and carries a real ware |
| ![Winter world settlement](docs/screenshots/town-winter.jpg) | ![Wasteland settlement with palms](docs/screenshots/town-wasteland.jpg) |
| **Winter world** | **Wasteland** |
| ![Build menu with 3D portraits and build-help markers](docs/screenshots/build-menu.jpg) | ![Statistics and headquarters inventory windows](docs/screenshots/windows.jpg) |
| **Build menu** — small / medium / large / mine tabs and the build-help overlay (Space) | **Windows** — statistics per player, warehouse stock, workers, soldiers |

![Campaign chapter selection](docs/screenshots/campaign.jpg)

## Play

It's a static site with no build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```bash
git clone https://github.com/markldn/settlers-roman-chronicle.git
cd settlers-roman-chronicle
./run.sh            # python3 http.server on 0.0.0.0:8960
# open http://localhost:8960/  (or http://<your-lan-ip>:8960/ from another machine)
```

Any static server works (`npx serve`, nginx, and so on). It needs a WebGL2 browser. Chrome, Edge and Firefox on a desktop GPU are recommended. If frames drop, set **Options → Graphics quality** to Medium or Low.

## What's in it

### Economy, as in Settlers II
- **Hex node grid.** Buildings stand on a node with their flag on the south-east neighbour. Each node fits a flag, a small, medium or large house, or a mine, depending on terrain, slope and neighbours.
- **Roads between flags, one carrier per segment.** Flags hold up to 8 wares. Put more flags on a road to get more carriers and faster transport. Busy roads turn to cobblestone and get a donkey.
- **31 buildings and 30 wares** in the classic chains:
  - Wood → sawmill → boards, with a forester to replant. A quarry or granite mine for stone.
  - Grain + water → flour → bread. Fish, game and pigs also give food, and food feeds the mines.
  - Coal and iron ore → iron. Iron + boards → tools. Iron + coal → swords and shields. Gold + coal → coins. Grain + water → beer.
- **Tools make workers.** A helper becomes a woodcutter only when there is an axe in stock. The metalworks makes whatever tool is missing, then follows your priority sliders.
- **Transport priority, tool priority and military settings** match S2's economy windows.
- **Geologists** search mountains and leave signs for coal, iron, gold and granite. Mines run out.

### Land and war
- Occupied military buildings (barracks, guardhouse, watchtower, fortress) claim territory. Border stones mark the edge.
- Soldiers are recruited from a helper, a sword, a shield and a beer. They have 5 ranks and are promoted with gold coins.
- Attack enemy buildings in range. Defenders come out one at a time and fight 1-on-1 at the flag. A conquered building flips its land, and enemy buildings left on your land burn.
- Catapults, lookout towers and scouts, plus fog of war.

### Computer opponents
Easy, normal and hard AIs build a full economy, keep their roads short, expand toward resources and enemies, and attack when they are stronger.

### Campaign and unlimited play
- **8-chapter Roman campaign.** The story and maps are original. It goes from *Landfall* to *The Last Legion* against three allied kings, with objectives, briefings and tutorial hints.
- **Unlimited play.** Pick the map size (up to 144×128), the landscape (greenland, winter, wasteland), the layout (continent, lakes, river valley, islands, mountain pass), up to 5 opponents, alliances, starting goods and a seed.
- Save and load (gzip-compressed in localStorage), plus F5/F9 quick save and load.

### Graphics
- **Terrain.** A smoothed heightfield with a procedural splat texture baked once on the GPU: grass blades, rock strata and cracks, sand ripples, snow and swamp, with organic blends between terrain types. It adds slope-based rock, darker valleys, wet shorelines and drifting cloud shadows.
- **Water.** Depth-based colour, animated normals, fresnel sky reflection, sun glints and shoreline foam.
- **Buildings.** Procedural models built from a generated material atlas (plaster, stone, tiles, thatch, timber and more) with a derived normal map. Each nation has its own palette, and team-coloured banners wave. Construction rises out of scaffolding with material piles next to it. Buildings burn and collapse, and windmills turn.
- **Everything else is instanced.** Settlers are animated body-part meshes with tools and poses (walk, chop, hammer, scythe, fish, fight, carry overhead). There are deer, rabbits, foxes and ducks, trees that sway in the wind and fall when cut, fields that ripen, and smoke, fire, sparks and dust.
- **Post-processing.** Soft shadows, GTAO ambient occlusion, bloom, colour grading, vignette and a subtle tilt-shift.

### Sound
All sound is synthesized with the Web Audio API. Sound effects are rendered once offline: axes, saws, hammers, pickaxes, anvils, falling trees, splashes, bows, sword clashes, war horns and fanfares. They play positionally relative to the camera. Ambience (birds, wind and surf) follows what you are looking at. The music is a scheduled medieval ensemble of lute, recorder, bowed drone, pad and frame drum. It plays four composed themes plus seeded variations, and switches to a march when fighting is near.

## Controls

| Input | Action |
|---|---|
| Left click | Build menu on your land · open a building / flag / road |
| Right-drag / `WASD` / arrows | Scroll |
| Mouse wheel / `PgUp` `PgDn` | Zoom |
| Middle-drag / `Q` `R` | Rotate |
| `Space` | Build help (what fits where) |
| `H` | Jump to headquarters |
| `I` `T` `E` `B` `N` | Inventory, statistics, economy settings, buildings, messages |
| `+` `-` · `P` | Game speed · pause |
| `F5` / `F9` | Quick save / quick load |
| `Esc` | Cancel road · close windows · game menu |

After you place a building you are in **road mode** straight away. Click nodes to lay the road and finish on a flag. Click the last node again to end with a new flag.

## Code layout

```
src/sim/        pure-JS simulation (no DOM): runs in the browser and headless in node
  data.js       buildings, wares, jobs, ranks, nations: all balance lives here
  grid.js       hex grid geometry, seeded RNG, binary heap, noise
  mapgen.js     procedural maps, resources, start positions (with carved valleys)
  logistics.js  road validation, flag-graph routing (next-hop tables), request dispatch
  jobs.js       settler state machines: carriers, builders, gatherers, producers, geologists
  military.js   territory, garrisons, promotions, attacks, combat, catapults
  ai.js         computer opponents
  missions.js   campaign chapters and objectives
  game.js       state, commands, fixed 20 Hz update, save/load
src/render/     three.js: terrain bake + water, models, instanced world sync, icons, post
src/ui/ui.js    windows, build menu, road building, minimap, input
src/audio.js    synthesized SFX, ambience and music
vendor/three/   three.js r185 (MIT), vendored so the game works offline
tests/          headless soak test + Playwright browser probes
```

## Tests

```bash
node tests/sim.test.mjs 30 5   # 2 hard AIs for 30 game-minutes: invariants, economy, combat, save/load
./run.sh & node tests/play.mjs # browser: builds through the real UI, runs time, opens windows, save/load
node tests/shots.mjs           # regenerates the README screenshots
```

The headless sim runs about 400× realtime. The browser probes need Playwright and a GPU. They launch Chromium with `--use-angle=vulkan`.

## Credits and license

The game code is under the MIT license (see `LICENSE`). three.js is © three.js authors, under the MIT license (`vendor/three/LICENSE`). Fonts are Cinzel and Alegreya, loaded from Google Fonts (SIL OFL), with serif fallbacks when offline.

This is a fan-made tribute and is not affiliated with Ubisoft or Blue Byte. *The Settlers* is their trademark. The repository contains none of the original game's assets, story or maps.
