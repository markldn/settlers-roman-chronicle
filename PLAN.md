# Settlers — a Settlers II Gold–style economy game in the browser

Original code and art (all procedural — no ripped assets). Served on :8960 (`./run.sh`).

## Pillars (what makes it feel like Settlers II)
1. **Node grid with 6 neighbours** (odd-row offset). Buildings sit on a node, their flag on the SE neighbour.
   Building size (flag / small / medium / large / mine) comes from terrain, slope and neighbours.
2. **Roads between flags**, one carrier per road segment, flags hold 8 wares. Every ware is a real object
   carried flag to flag. More flags = more carriers = more throughput. Donkeys on busy roads.
3. **Economy chains**: wood→boards, stone, fish/meat/bread food→mines, coal+iron ore→iron, iron+boards→tools,
   iron+coal→swords/shields, gold+coal→coins, grain+water→beer/pigs/donkeys/flour→bread.
4. **Workers need tools**; metalworks makes them. Helpers are recruited in warehouses over time.
5. **Territory** from occupied military buildings; land is only buildable inside it. Conquest flips land
   and burns enemy buildings left outside their territory.
6. **Soldiers** = helper + sword + shield + beer; 5 ranks promoted with coins; 1-on-1 fights at the flag.
7. **Geologists** find coal/iron/gold/granite in mountains; mines deplete.

## Architecture
- `src/sim/*` — pure JS simulation (no DOM, no three). Deterministic seeded RNG, fixed 20 Hz tick.
  Runs headless in node for tests (`node tests/sim.test.mjs`).
- `src/render/*` — Three.js (vendored 0.185): GPU-baked terrain splat texture, water shader, instanced trees/
  figures/wares/icons, procedural building models, shadows, GTAO + bloom, fog of war texture.
- `src/ui/*` — S2-style windows: build menu (with 3D-rendered building portraits), building/flag windows,
  inventory, statistics, transport priority, tools, military, messages, minimap.
- `src/audio.js` — every sound synthesized (Web Audio): chop, saw, hammer, pick, anvil, swords, horn,
  ambience (birds/water/wind) and a procedural medieval music sequencer (lute/recorder/strings/drum).
- `src/missions.js` — Roman campaign (8 chapters with objectives + briefings) and Free Play setup.

## Phases
1. data tables + grid + mapgen + sim core (roads, carriers, routing, production) → headless test
2. renderer (terrain, water, objects, figures) + camera + picking
3. UI windows + build/road interaction
4. military, territory, fog, AI
5. audio + music
6. campaign/missions, save/load, settings
7. verification (headless sim soak + Playwright probe) and skill capture
