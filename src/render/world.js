// Mirrors the simulation into the scene every frame using instanced meshes.
import * as THREE from 'three';
import { BUILDINGS, PLAYER_COLORS, TERRAIN as T, TERRAIN_INFO, RANKS } from '../sim/data.js';
import { ROW_H } from '../sim/grid.js';
import { buildingGeometry, buildingMaterial, patchBuildingShader, scaffoldGeometry, materialStackGeometry, treeGeometry, rockGeometry, bushGeometry, mushroomGeometry, cardGeometry, figureParts, sailsGeometry } from './models.js';
import { grassCardTexture, roadTexture, softSprite } from './textures.js';
import { getIconAtlas, iconUV } from './icons.js';
import { patchFog } from './terrain.js';

const DIRV = [[1, 0], [0.5, ROW_H], [-0.5, ROW_H], [-1, 0], [-0.5, -ROW_H], [0.5, -ROW_H]];
const YAW = DIRV.map(([x, z]) => Math.atan2(x, z));
const BUILD_ROT = Math.PI / 6; // doors face the flag (SE)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const JOB_COLORS = {
  carrier: 0x7a8f3a, builder: 0xb0602a, woodcutter: 0x4a6a2a, forester: 0x2f7a3a, stonemason: 0x8a8a80, fisher: 0x3a6a9a, hunter: 0x5a4a2a,
  carpenter: 0xa0784a, miller: 0xe8e0d0, baker: 0xf0e8d8, brewer: 0x8a5a2a, butcher: 0xd8d0c8, founder: 0x5a3a2a, metalworker: 0x4a4a52,
  armorer: 0x5a5a62, minter: 0xc8a040, farmer: 0xc8a050, pigbreeder: 0xd89aa0, donkeybreeder: 0x8a7a68, miner: 0x4a4038,
  geologist: 0x6a4a8a, scout: 0x3a7a6a, lookout: 0x6a6a3a, welldigger: 0x3a5a8a, soldier: 0xa83a2a,
};
const TOOL_OF = { woodcutter: 'axe', builder: 'hammer', stonemason: 'pick', miner: 'pick', geologist: 'hammer', fisher: 'rod', farmer: 'scythe', forester: 'shovel', hunter: 'bow', armorer: 'hammer', metalworker: 'hammer', soldier: 'sword' };
const RANK_PLUME = [0x888888, 0x3a8a3a, 0x2a5ad8, 0xd8a020, 0xd82a2a];
const SMOKE = new Set(['bakery', 'brewery', 'smelter', 'metalworks', 'armory', 'mint', 'slaughterhouse']);

function instanced(geo, mat, cap, { shadow = true, receive = false } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = receive;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

// Camera-facing icon quads (wares, build help, signs) — one draw call.
class Billboards {
  constructor(tex, cap, { additive = false, soft = false } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.off = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOff', this.off); g.setAttribute('iRect', this.rect); g.setAttribute('iCol', this.col);
    g.instanceCount = 0;
    this.cap = cap; this.n = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogTex: { value: null }, fogScale: { value: new THREE.Vector4() } },
      transparent: true, depthWrite: !soft, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec4 iOff; attribute vec4 iRect; attribute vec4 iCol; varying vec2 vUv; varying vec4 vCol; varying vec3 vW;
        void main(){
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = iOff.xyz + (right * position.x + up * position.y) * iOff.w;
          vW = p; vUv = iRect.xy + uv * iRect.zw; vCol = iCol;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform sampler2D fogTex; uniform vec4 fogScale; varying vec2 vUv; varying vec4 vCol; varying vec3 vW;
        void main(){ vec4 c = texture2D(map, vUv) * vCol; ${soft ? '' : 'if (c.a < 0.35) discard;'}
          float fw = texture2D(fogTex, vec2(vW.x * fogScale.x, vW.z * fogScale.y + fogScale.z)).r;
          gl_FragColor = vec4(c.rgb * ${additive ? 'fw * c.a' : 'max(fw, 0.0)'}, c.a * step(0.01, fw));
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 5 : 3;
    this.geo = g;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, rect, r = 1, g = 1, b = 1, a = 1) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.off.array.set([x, y, z, size], i * 4); this.rect.array.set(rect, i * 4); this.col.array.set([r, g, b, a], i * 4);
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const a of [this.off, this.rect, this.col]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
  }
}

export class World {
  constructor(renderer, scene, game, terrain, humanId = 0) {
    this.r = renderer; this.scene = scene; this.game = game; this.terrain = terrain; this.me = humanId;
    this.group = new THREE.Group(); scene.add(this.group);
    this.fogU = terrain.fogUniforms;
    this.time = 0;
    this.revealAll = false;
    this.teamCol = game.players.map(p => new THREE.Color(p.color));
    this.initMaterials();
    this.initBuildings();
    this.initNature();
    this.initFigures();
    this.initMisc();
    this.effects = []; this.fallingTrees = []; this.burning = [];
    this.lastObjV = -1; this.lastRoadV = -1; this.lastTerrV = -1; this.natureT = 0;
    this.viewBox = [0, 0, 1e9, 1e9];
  }

  initMaterials() {
    const fogU = this.fogU;
    this.bldMat = buildingMaterial();
    patchBuildingShader(this.bldMat, { uTime: fogU.uTime });
    patchFog(this.bldMat, fogU);
    // vertex-coloured nature with wind sway
    this.natureMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    windPatch(this.natureMat, fogU.uTime, 0.05);
    patchFog(this.natureMat, fogU);
    this.figMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    patchFog(this.figMat, fogU);
    const card = (kind) => { const m = new THREE.MeshStandardMaterial({ map: grassCardTexture(kind), alphaTest: 0.45, side: THREE.FrontSide, roughness: 1 }); windPatch(m, fogU.uTime, 0.06); patchFog(m, fogU); return m; };
    this.grassMat = card('grass'); this.flowerMat = card('flower'); this.wheatMat = card('wheat');
    const atlas = getIconAtlas();
    this.iconTex = new THREE.CanvasTexture(atlas.canvas); this.iconTex.colorSpace = THREE.SRGBColorSpace; this.iconTex.anisotropy = 4;
  }

  // ------------------------------------------------------------ buildings
  initBuildings() {
    this.bmeshes = new Map(); // key -> {mesh, a, b}
    this.scaffold = {}; for (const s of ['small', 'medium', 'large', 'mine']) { this.scaffold[s] = instanced(scaffoldGeometry(s), this.bldMat, 64); addInstAttrs(this.scaffold[s], 64); this.group.add(this.scaffold[s]); }
    this.stackBoards = instanced(materialStackGeometry('boards'), this.bldMat, 256); addInstAttrs(this.stackBoards, 256);
    this.stackStones = instanced(materialStackGeometry('stones'), this.bldMat, 256); addInstAttrs(this.stackStones, 256);
    this.sails = instanced(sailsGeometry(), this.bldMat, 32); addInstAttrs(this.sails, 32);
    this.group.add(this.stackBoards, this.stackStones, this.sails);
  }
  bmesh(type, nation) {
    const key = type + ':' + nation;
    let e = this.bmeshes.get(key);
    if (!e || e.cap < e.need) {
      const cap = Math.max(16, e ? e.need * 2 : 16);
      if (e) { this.group.remove(e.mesh); e.mesh.dispose(); }
      const geo = buildingGeometry(type, nation);
      const mesh = instanced(geo, this.bldMat, cap, { shadow: true, receive: true });
      addInstAttrs(mesh, cap);
      this.group.add(mesh);
      e = { mesh, cap, need: e ? e.need : 0, h: geo.userData.height, n: 0 };
      this.bmeshes.set(key, e);
    }
    return e;
  }

  nodePos(n, out = _v) { const g = this.game.grid; const x = g.wx(n), z = g.wz(n); return out.set(x, this.terrain.heightAt(x, z), z); }
  inView(x, z, pad = 2) { const b = this.viewBox; return x > b[0] - pad && x < b[2] + pad && z > b[1] - pad && z < b[3] + pad; }

  syncBuildings(dt) {
    const game = this.game, g = game.grid;
    const list = [];
    for (const b of game.buildings.values()) list.push({ b, burn: 0, sink: 0 });
    for (const f of this.burning) list.push({ b: f, burn: Math.min(1, f.t / 3), sink: Math.max(0, (f.t - 4) / 4) });
    // make sure every type:nation mesh has room
    const need = new Map();
    for (const { b } of list) { const key = b.type + ':' + game.players[b.owner].nation; need.set(key, (need.get(key) || 0) + 1); }
    for (const [key, n] of need) {
      const e = this.bmeshes.get(key);
      if (e && e.cap >= n) continue;
      if (e) { this.group.remove(e.mesh); e.mesh.dispose(); }
      const [type, nat] = key.split(':');
      const geo = buildingGeometry(type, nat);
      const cap = Math.max(16, n * 2);
      const mesh = instanced(geo, this.bldMat, cap, { shadow: true, receive: true });
      addInstAttrs(mesh, cap); this.group.add(mesh);
      this.bmeshes.set(key, { mesh, cap, h: geo.userData.height, n: 0 });
    }
    for (const e of this.bmeshes.values()) e.n = 0;
    const scaff = { small: 0, medium: 0, large: 0, mine: 0 };
    let nb = 0, ns = 0, nsails = 0;
    const rotQ = new THREE.Quaternion().setFromAxisAngle(UP, BUILD_ROT);
    for (const { b, burn, sink } of list) {
      const x = g.wx(b.node), z = g.wz(b.node);
      if (!this.inView(x, z, 4)) continue;
      const pl = game.players[b.owner];
      if (!this.revealAll && pl.id !== this.me && !game.players[this.me].explored[b.node]) continue;
      const e = this.bmeshes.get(b.type + ':' + pl.nation); if (!e) continue;
      const y = this.terrain.heightAt(x, z) - sink * 1.2;
      _m.compose(_v.set(x, y - 0.02, z), rotQ, _s.set(1, 1, 1));
      const i = e.n++;
      e.mesh.setMatrixAt(i, _m);
      const tc = this.teamCol[b.owner];
      const site = b.state === 'site';
      const prog = site ? (b.site.leveled ? Math.max(0.02, b.site.progress) : 0) : 1;
      const def = BUILDINGS[b.type];
      const working = b.state === 'done' && b.prod && b.prod.length && (b.work || b.prod[b.prod.length - 1]) ? 1 : 0;
      const flash = this.selected === b.id ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
      e.mesh.geometry.getAttribute('instA').setXYZW(i, tc.r, tc.g, tc.b, prog);
      e.mesh.geometry.getAttribute('instB').setXYZW(i, burn, e.h, working, flash);
      if (site) {
        const sz = def.size, sm = this.scaffold[sz];
        if (scaff[sz] < 64) { const k = scaff[sz]++; sm.setMatrixAt(k, _m); sm.geometry.getAttribute('instA').setXYZW(k, 1, 1, 1, 1); sm.geometry.getAttribute('instB').setXYZW(k, 0, 9, 0, 0); }
        const hb = b.site.have.boards || 0, hs = b.site.have.stones || 0;
        for (let k = 0; k < Math.min(4, hb); k++) { if (nb >= 256) break; this.placeStack(this.stackBoards, nb++, x, z, 0.38, -0.12 + k * 0.08, k * 0.05); }
        for (let k = 0; k < Math.min(4, hs); k++) { if (ns >= 256) break; this.placeStack(this.stackStones, ns++, x, z, -0.3 + (k % 2) * 0.2, 0.38 + Math.floor(k / 2) * 0.12, 0); }
      }
      if (b.type === 'mill' && b.state === 'done' && nsails < 32) {
        b._sail = (b._sail || 0) + dt * (working ? 1.8 : 0.12);
        const off = new THREE.Vector3(0, 0, 0.4).applyAxisAngle(UP, BUILD_ROT);
        const rot = new THREE.Matrix4().makeRotationY(BUILD_ROT).multiply(new THREE.Matrix4().makeRotationZ(b._sail));
        rot.setPosition(x + off.x, y + 1.15, z + off.z);
        this.sails.setMatrixAt(nsails, rot); this.sails.geometry.getAttribute('instA').setXYZW(nsails, 1, 1, 1, 1); this.sails.geometry.getAttribute('instB').setXYZW(nsails, burn, 9, 0, 0); nsails++;
      }
      if (working && SMOKE.has(b.type) && Math.random() < dt * 4) this.puff(x + 0.1, y + (def.size === 'medium' ? 1.05 : 0.9), z - 0.08, 'smoke');
      if (burn > 0 && Math.random() < dt * 30) this.puff(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.8, z + (Math.random() - 0.5) * 0.8, Math.random() < 0.6 ? 'fire' : 'smokeDark');
    }
    for (const e of this.bmeshes.values()) { e.mesh.count = e.n; flagInst(e.mesh); }
    for (const [k, m] of Object.entries(this.scaffold)) { m.count = scaff[k]; flagInst(m); }
    this.stackBoards.count = nb; this.stackStones.count = ns; this.sails.count = nsails;
    flagInst(this.stackBoards); flagInst(this.stackStones); flagInst(this.sails);
    for (const f of this.burning) f.t += dt;
    this.burning = this.burning.filter(f => f.t < 8);
  }
  placeStack(mesh, i, x, z, dx, dz, ry) {
    const o = new THREE.Vector3(dx, 0, dz).applyAxisAngle(UP, BUILD_ROT);
    const px = x + o.x, pz = z + o.z;
    _q.setFromAxisAngle(UP, BUILD_ROT + ry);
    _m.compose(_v.set(px, this.terrain.heightAt(px, pz), pz), _q, _s.set(1, 1, 1));
    mesh.setMatrixAt(i, _m); mesh.geometry.getAttribute('instA').setXYZW(i, 1, 1, 1, 1); mesh.geometry.getAttribute('instB').setXYZW(i, 0, 9, 0, 0);
  }

  // ------------------------------------------------------------ nature
  initNature() {
    this.species = ['oak', 'pine', 'birch', 'fir', 'beech', 'palm', 'dead'];
    this.treeMesh = {};
    for (const sp of this.species) { this.treeMesh[sp] = instanced(treeGeometry(sp), this.natureMat, 4096); this.treeMesh[sp].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4096 * 3).fill(1), 3); this.group.add(this.treeMesh[sp]); }
    this.rocks = [0, 1, 2].map(k => { const m = instanced(rockGeometry(k + 1), this.natureMat, 2048, { receive: true }); this.group.add(m); return m; });
    this.rubble = instanced(rockGeometry(9), this.natureMat, 512); this.rubble.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3).fill(0.35), 3); this.group.add(this.rubble);
    this.wheat = instanced(cardGeometry(0.3, 0.26, 3), this.wheatMat, 4096, { shadow: false }); this.wheat.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4096 * 3).fill(1), 3); this.group.add(this.wheat);
    const soilGeo = new THREE.CircleGeometry(0.46, 6).rotateX(-Math.PI / 2);
    this.soilMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); patchFog(this.soilMat, this.fogU);
    this.soil = instanced(soilGeo, this.soilMat, 1024, { shadow: false, receive: true }); this.group.add(this.soil);
    // decor (static positions, visibility refreshed when objects change)
    this.buildDecor();
  }

  buildDecor() {
    const game = this.game, g = game.grid, m = game.map;
    const rnd = mulberry(m.seed * 13 + 5);
    const items = { grass: [], flower: [], bush: [], mush: [], pebble: [] };
    for (let n = 0; n < g.n; n++) {
      const t = m.terrain[n];
      if (!TERRAIN_INFO[t].walk) continue;
      const k = t === T.MEADOW ? 3 : t === T.FLOWERS ? 4 : t === T.MOUNTAIN_MEADOW ? 2 : t === T.STEPPE ? 2 : t === T.SWAMP ? 3 : t === T.MOUNTAIN ? 1 : 0;
      for (let i = 0; i < k; i++) {
        const x = g.wx(n) + (rnd() - 0.5) * 0.9, z = g.wz(n) + (rnd() - 0.5) * 0.8, r = rnd();
        const e = { n, x, z, ry: rnd() * 6.28, s: 0.7 + rnd() * 0.6 };
        if (t === T.MOUNTAIN) { if (r < 0.6) items.pebble.push(e); continue; }
        if (r < 0.55) items.grass.push(e);
        else if (r < 0.7 && (t === T.FLOWERS || t === T.MEADOW)) items.flower.push(e);
        else if (r < 0.8) items.bush.push(e);
        else if (r < 0.84 && t !== T.STEPPE) items.mush.push(e);
        else if (r < 0.9) items.pebble.push(e);
      }
    }
    this.decor = items;
    const mk = (geo, mat, n, sh) => { const im = instanced(geo, mat, Math.max(1, n), { shadow: sh, receive: false }); this.group.add(im); return im; };
    this.decorMesh = {
      grass: mk(cardGeometry(0.36, 0.2, 3), this.grassMat, items.grass.length, false),
      flower: mk(cardGeometry(0.3, 0.2, 2), this.flowerMat, items.flower.length, false),
      bush: mk(bushGeometry(), this.natureMat, items.bush.length, true),
      mush: mk(mushroomGeometry(), this.natureMat, items.mush.length, false),
      pebble: mk(rockGeometry(5), this.natureMat, items.pebble.length, false),
    };
    this.decorMesh.grass.receiveShadow = true;
    if (this.terrain.theme === 'winter') { this.grassMat.color.set(0xb8c8c0); }
    if (this.terrain.theme === 'wasteland') { this.grassMat.color.set(0xc8b070); }
  }

  syncDecor() {
    const game = this.game, m = game.map;
    const blocked = (n) => { const o = m.obj[n]; return (o && o.t !== 'tree') || game.roadAt[n]; };
    for (const [k, list] of Object.entries(this.decor)) {
      const im = this.decorMesh[k]; let c = 0;
      for (const e of list) {
        if (blocked(e.n)) continue;
        const y = this.terrain.heightAt(e.x, e.z);
        _q.setFromAxisAngle(UP, e.ry); const s = k === 'pebble' ? e.s * 0.35 : k === 'mush' ? e.s : e.s;
        _m.compose(_v.set(e.x, y - 0.01, e.z), _q, _s.set(s, s, s));
        im.setMatrixAt(c++, _m);
      }
      im.count = c; flagInst(im);
    }
  }

  syncNature() {
    const game = this.game, g = game.grid, m = game.map;
    const counts = {}; for (const sp of this.species) counts[sp] = 0;
    let rc = [0, 0, 0], wc = 0, sc = 0, ru = 0;
    const exp = game.players[this.me].explored;
    for (let n = 0; n < g.n; n++) {
      const o = m.obj[n]; if (!o) continue;
      if (!this.revealAll && !exp[n]) continue;
      const x0 = g.wx(n), z0 = g.wz(n);
      if (o.t === 'tree') {
        const mesh = this.treeMesh[o.sp] || this.treeMesh.oak; const i = counts[o.sp] ?? 0; if (i >= 4096) continue;
        const v = o.v || 0, jx = ((v % 17) / 17 - 0.5) * 0.3, jz = ((v % 23) / 23 - 0.5) * 0.3;
        const x = x0 + jx, z = z0 + jz, s = (0.25 + 0.75 * Math.min(1, o.g)) * (0.85 + (v % 13) / 40);
        _q.setFromAxisAngle(UP, v * 0.7);
        _m.compose(_v.set(x, this.terrain.heightAt(x, z) - 0.03, z), _q, _s.set(s, s * (0.9 + (v % 7) / 25), s));
        mesh.setMatrixAt(i, _m);
        const tint = 0.82 + (v % 11) / 30; mesh.setColorAt(i, _c.setRGB(tint, tint * (0.95 + (v % 5) / 40), tint * 0.9));
        counts[o.sp] = i + 1;
      } else if (o.t === 'stone') {
        const v = o.v || 0;
        for (let k = 0; k < o.a; k++) {
          const a = k * 2.4 + v, r = k === 0 ? 0 : 0.14 + 0.06 * (k % 3);
          const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r, s = (k === 0 ? 1.25 : 0.95) * (0.8 + ((v + k * 7) % 9) / 20);
          const mi = (v + k) % 3, mesh = this.rocks[mi];
          if (rc[mi] >= 2048) continue;
          _q.setFromAxisAngle(UP, a * 3.1);
          _m.compose(_v.set(x, this.terrain.heightAt(x, z) - 0.03, z), _q, _s.set(s, s * (k === 0 ? 1.15 : 0.9), s));
          mesh.setMatrixAt(rc[mi]++, _m);
        }
      } else if (o.t === 'field') {
        const v = o.v || 0, gr = Math.min(1, o.g);
        if (sc < 1024) { _m.compose(_v.set(x0, this.terrain.heightAt(x0, z0) + 0.01, z0), _q.identity(), _s.set(1, 1, 1)); this.soil.setMatrixAt(sc++, _m); }
        if (gr > 0.05) for (let k = 0; k < 7; k++) {
          if (wc >= 4096) break;
          const a = k * 0.9 + v, r = k === 0 ? 0 : 0.26;
          const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r, s = 0.35 + gr * 0.8;
          _q.setFromAxisAngle(UP, a);
          _m.compose(_v.set(x, this.terrain.heightAt(x, z), z), _q, _s.set(s, s, s));
          this.wheat.setMatrixAt(wc, _m);
          _c.setRGB(0.55 + 0.45 * gr, 0.85 - 0.05 * gr, 0.45 - 0.2 * gr); if (gr < 1) _c.lerp(new THREE.Color(0.45, 0.8, 0.3), 1 - gr); this.wheat.setColorAt(wc++, _c);
        }
      } else if (o.t === 'ruin') {
        for (let k = 0; k < (o.big ? 9 : 5); k++) {
          if (ru >= 512) break;
          const a = k * 1.7, r = 0.1 + (k % 3) * 0.12, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
          _q.setFromAxisAngle(UP, a * 2); _m.compose(_v.set(x, this.terrain.heightAt(x, z) - 0.03, z), _q, _s.set(1.3, 0.7, 1.3));
          this.rubble.setMatrixAt(ru++, _m);
        }
      }
    }
    for (const sp of this.species) { const mesh = this.treeMesh[sp]; mesh.count = counts[sp]; flagInst(mesh); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.rocks.forEach((mesh, k) => { mesh.count = rc[k]; flagInst(mesh); });
    this.wheat.count = wc; flagInst(this.wheat); if (this.wheat.instanceColor) this.wheat.instanceColor.needsUpdate = true;
    this.soil.count = sc; flagInst(this.soil);
    this.rubble.count = ru; flagInst(this.rubble);
  }

  // ------------------------------------------------------------ figures
  initFigures() {
    const P = figureParts();
    this.parts = {};
    const cap = 3000;
    for (const k of ['torso', 'head', 'leg', 'arm', 'hat', 'helmet', 'plume', 'shield', 'sword', 'axe', 'hammer', 'pick', 'rod', 'scythe', 'shovel', 'bow', 'donkeyBody', 'animalLeg', 'deer', 'rabbit', 'fox', 'duck']) {
      const c = k === 'leg' || k === 'arm' || k === 'animalLeg' ? cap * 2 : k === 'torso' || k === 'head' ? cap : 800;
      const m = instanced(P[k], this.figMat, c);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c * 3).fill(1), 3);
      this.parts[k] = m; this.group.add(m);
    }
    this.pc = {};
  }
  putPart(k, mat, col) {
    const m = this.parts[k]; const i = this.pc[k] = (this.pc[k] || 0); if (i >= m.instanceMatrix.count) return;
    m.setMatrixAt(i, mat); if (col !== undefined) m.setColorAt(i, typeof col === 'number' ? _c.set(col) : col);
    this.pc[k] = i + 1;
  }

  // world position of a settler/animal between nodes (smoothed heights)
  moverPos(s, out) {
    const g = this.game.grid;
    let x = g.wx(s.node), z = g.wz(s.node);
    if (s.next >= 0) { const t = s.t || 0; x += (g.wx(s.next) - x) * t; z += (g.wz(s.next) - z) * t; }
    return out.set(x, this.terrain.heightAt(x, z), z);
  }

  drawFigure(base, pose, colors) {
    // base: Matrix4 at feet facing +z. pose: {legA, armL, armR, bob, tool, kind}
    const M = new THREE.Matrix4(), L = new THREE.Matrix4();
    const at = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => { L.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s, s, s)); return M.multiplyMatrices(base, L); };
    const b = pose.bob || 0;
    this.putPart('leg', at(0.03, 0.13 + b, 0, pose.legA), colors.legs);
    this.putPart('leg', at(-0.03, 0.13 + b, 0, -pose.legA), colors.legs);
    this.putPart('torso', at(0, 0.13 + b, 0, pose.lean || 0), colors.body);
    this.putPart('head', at(0, 0.325 + b, (pose.lean || 0) * 0.15), 0xe3b690);
    if (colors.helmet !== undefined) { this.putPart('helmet', at(0, 0.33 + b, 0), 0xb8c0c8); this.putPart('plume', at(0, 0.33 + b, 0), colors.helmet); }
    else if (colors.hat !== undefined) this.putPart('hat', at(0, 0.355 + b, 0), colors.hat);
    this.putPart('arm', at(0.072, 0.27 + b, 0, pose.armR || 0, 0, pose.armRz || -0.12), colors.body);
    this.putPart('arm', at(-0.072, 0.27 + b, 0, pose.armL || 0, 0, pose.armLz || 0.12), colors.body);
    if (pose.tool) {
      // tool hangs from the right hand
      L.compose(_v.set(0.072, 0.27 + b, 0), _q.setFromEuler(_e.set(pose.armR || 0, 0, pose.armRz || -0.12)), _s.set(1, 1, 1));
      const hand = new THREE.Matrix4().makeTranslation(0, -0.11, 0.0);
      const tr = new THREE.Matrix4().makeRotationX(pose.toolRx ?? Math.PI / 2);
      M.multiplyMatrices(base, L).multiply(hand).multiply(tr);
      this.putPart(pose.tool, M, 0xffffff);
    }
    if (pose.shield) { this.putPart('shield', at(-0.09, 0.2 + b, 0.03, 0, 0.2, 0), colors.team); }
  }

  syncFigures(dt) {
    const game = this.game, g = game.grid;
    this.pc = {};
    const base = new THREE.Matrix4(), pos = new THREE.Vector3();
    const exp = game.players[this.me].visible;
    const t = this.time;
    this.carried = [];
    for (const s of game.settlers.values()) {
      if (s.inside) continue;
      this.moverPos(s, pos);
      if (!this.inView(pos.x, pos.z)) continue;
      if (!this.revealAll && s.owner !== this.me && !exp[s.node]) continue;
      // smooth yaw
      let yaw = YAW[s.face ?? 1] ?? 0;
      if (s._yaw === undefined) s._yaw = yaw;
      let dy = yaw - s._yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      s._yaw += dy * Math.min(1, dt * 10);
      const moving = s.next >= 0;
      const anim = moving ? 'walk' : (s.anim || 'idle');
      const ph = t * 9 + s.id;
      const pose = { legA: 0, armL: 0, armR: 0, bob: 0 };
      let px = pos.x, pz = pos.z;
      // builders circle the site while working
      if (s.job === 'builder' && !moving && (s.state === 'build' || s.state === 'level')) {
        const a = t * 0.25 + s.id; px += Math.cos(a) * 0.5; pz += Math.sin(a) * 0.45; s._yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
      }
      const team = this.teamCol[s.owner];
      if (s.job === 'donkey') {
        base.compose(_v.set(px, this.terrain.heightAt(px, pz), pz), _q.setFromAxisAngle(UP, s._yaw), _s.set(1, 1, 1));
        this.putPart('donkeyBody', base, 0xffffff);
        const sw = moving ? Math.sin(ph) * 0.5 : 0;
        for (const [lx, lz, k] of [[0.04, 0.08, 1], [-0.04, 0.08, -1], [0.04, -0.08, -1], [-0.04, -0.08, 1]]) { const L = new THREE.Matrix4().compose(_v.set(lx, 0.11, lz), _q.setFromEuler(_e.set(sw * k, 0, 0)), _s.set(1, 1, 1)); this.putPart('animalLeg', new THREE.Matrix4().multiplyMatrices(base, L), 0x6a5a48); }
        if (s.carry) { const w = game.wares.get(s.carry); if (w) this.carried.push([px, this.terrain.heightAt(px, pz) + 0.3, pz, w.type]); }
        continue;
      }
      const carrying = !!(s.carry || s.carryType);
      if (anim === 'walk') { const sw = Math.sin(ph) * 0.55; pose.legA = sw; pose.armL = -sw * 0.8; pose.armR = sw * 0.8; pose.bob = Math.abs(Math.cos(ph)) * 0.012; }
      else if (anim === 'chop' || anim === 'hammer' || anim === 'dig') { const k = Math.sin(t * (anim === 'dig' ? 5 : 7) + s.id); pose.armR = -1.4 - k * 0.9; pose.armL = -1.2 - k * 0.8; pose.lean = 0.15 + k * 0.1; }
      else if (anim === 'scythe' || anim === 'sow') { const k = Math.sin(t * 4 + s.id); pose.armR = -0.8; pose.armRz = k * 0.8 - 0.3; pose.armL = -0.6; pose.lean = 0.25; }
      else if (anim === 'fish') { pose.armR = -1.0; pose.armL = -0.8; pose.toolRx = 0.4; }
      else if (anim === 'kneel') { pose.bob = -0.05; pose.lean = 0.5; pose.armR = -0.8; }
      else if (anim === 'fight') { const sw = Math.max(0, Math.sin(t * 7 + s.id)); pose.armR = -2.2 + sw * 1.8; pose.lean = sw * 0.2; pose.armL = -0.8; pose.legA = 0.3; }
      if (carrying && anim === 'walk') { pose.armL = -2.9; pose.armR = -2.9; pose.armLz = 0.35; pose.armRz = -0.35; }
      if (s.job === 'soldier') { pose.shield = true; pose.tool = 'sword'; if (anim !== 'fight') pose.toolRx = 0.3; }
      else if (!carrying && TOOL_OF[s.job] && (anim !== 'walk' || s.job === 'geologist' || s.job === 'builder')) { pose.tool = TOOL_OF[s.job]; if (pose.tool === 'pick') pose.tool = 'pick'; }
      const y = this.terrain.heightAt(px, pz);
      base.compose(_v.set(px, y, pz), _q.setFromAxisAngle(UP, s._yaw), _s.set(1, 1, 1));
      const colors = { body: JOB_COLORS[s.job] ?? 0x888888, legs: 0x5a4632, team };
      if (s.job === 'soldier') { colors.body = team; colors.legs = 0x4a4038; colors.helmet = RANK_PLUME[s.rank || 0]; }
      else if (s.job === 'carrier') colors.hat = team;
      else colors.hat = new THREE.Color(JOB_COLORS[s.job] ?? 0x888888).multiplyScalar(0.7);
      this.drawFigure(base, pose, colors);
      if (carrying) {
        const w = s.carry ? game.wares.get(s.carry) : null;
        const type = w ? w.type : s.carryType;
        if (type) this.carried.push([px, y + 0.47, pz, type]);
      }
    }
    // corpses
    for (const c of game.corpses || []) {
      const p = this.nodePos(c.node, pos); if (!this.inView(p.x, p.z)) continue;
      base.compose(_v.set(p.x + 0.15, p.y + 0.04, p.z), _q.setFromEuler(_e.set(-Math.PI / 2, YAW[c.face ?? 0], 0, 'YXZ')), _s.set(1, 1, 1));
      this.drawFigure(base, { legA: 0.2, armL: -2.5, armR: 0.4 }, { body: this.teamCol[c.owner], legs: 0x4a4038, helmet: 0x777777 });
    }
    // animals
    for (const a of game.animals) {
      this.moverPos(a, pos); if (!this.inView(pos.x, pos.z)) continue;
      if (!this.revealAll && !game.players[this.me].visible[a.node]) continue;
      const yaw = YAW[a.face ?? 0];
      if (a._yaw === undefined) a._yaw = yaw;
      let dy = yaw - a._yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; a._yaw += dy * Math.min(1, dt * 6);
      const moving = a.next >= 0;
      let y = pos.y;
      if (a.kind === 'duck') y = Math.max(y, this.terrain.seaY - 0.05) + Math.sin(t * 2 + a.id) * 0.01;
      if (a.kind === 'rabbit' && moving) y += Math.abs(Math.sin(t * 12 + a.id)) * 0.05;
      if (a.dead) { base.compose(_v.set(pos.x, y + 0.03, pos.z), _q.setFromEuler(_e.set(0, a._yaw, Math.PI / 2, 'YXZ')), _s.set(1, 1, 1)); }
      else base.compose(_v.set(pos.x, y, pos.z), _q.setFromAxisAngle(UP, a._yaw), _s.set(1, 1, 1));
      this.putPart(a.kind, base, 0xffffff);
      if (a.kind === 'deer' && !a.dead) {
        const sw = moving ? Math.sin(t * 10 + a.id) * 0.6 : 0;
        for (const [lx, lz, k] of [[0.03, 0.08, 1], [-0.03, 0.08, -1], [0.03, -0.08, -1], [-0.03, -0.08, 1]]) { const L = new THREE.Matrix4().compose(_v.set(lx, 0.12, lz), _q.setFromEuler(_e.set(sw * k, 0, 0)), _s.set(1, 1.1, 1)); this.putPart('animalLeg', new THREE.Matrix4().multiplyMatrices(base, L), 0x9a6a3a); }
      }
    }
    for (const [k, m] of Object.entries(this.parts)) { m.count = this.pc[k] || 0; flagInst(m); if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // ------------------------------------------------------------ flags, roads, borders, icons
  initMisc() {
    // flags: pole + waving cloth (team colour)
    const pole = new THREE.CylinderGeometry(0.012, 0.016, 0.5, 5).translate(0, 0.25, 0);
    const cloth = new THREE.PlaneGeometry(0.2, 0.13, 6, 2).translate(0.1, 0.42, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 }); patchFog(poleMat, this.fogU);
    const clothMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    clothMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.fogU.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3][0] * 3.1 + instanceMatrix[3][2] * 1.7;
        float k = position.x / 0.2;
        transformed.z += sin(uTime * 6.0 + ph + position.x * 18.0) * 0.03 * k;
        transformed.y += sin(uTime * 5.0 + ph + position.x * 12.0) * 0.008 * k;`);
    };
    clothMat.customProgramCacheKey = () => 'cloth';
    patchFog(clothMat, this.fogU);
    this.flagPole = instanced(pole, poleMat, 2048); this.flagCloth = instanced(cloth, clothMat, 2048);
    this.flagCloth.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2048 * 3), 3);
    this.group.add(this.flagPole, this.flagCloth);
    // border stones
    const bgeo = new THREE.CylinderGeometry(0.035, 0.045, 0.16, 6).translate(0, 0.08, 0);
    const bmat = new THREE.MeshStandardMaterial({ roughness: 0.6 }); patchFog(bmat, this.fogU);
    this.border = instanced(bgeo, bmat, 8192, { shadow: false }); this.border.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(8192 * 3), 3);
    this.group.add(this.border);
    // roads
    this.roadTex = roadTexture();
    this.roadMat = new THREE.MeshStandardMaterial({ map: this.roadTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    patchFog(this.roadMat, this.fogU);
    this.roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.roadMat); this.roadMesh.receiveShadow = true; this.roadMesh.renderOrder = 1;
    this.previewMat = new THREE.MeshBasicMaterial({ map: this.roadTex, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, color: 0xfff0a0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMat); this.previewMesh.renderOrder = 2;
    this.group.add(this.roadMesh, this.previewMesh);
    // icons
    this.icons = new Billboards(this.iconTex, 12000);
    this.icons.mat.uniforms.fogTex = this.fogU.fogTex; this.icons.mat.uniforms.fogScale = this.fogU.fogScale;
    this.group.add(this.icons.mesh);
    // particles
    const soft = softSprite();
    this.smoke = new Billboards(soft, 3000, { soft: true }); this.fire = new Billboards(soft, 3000, { additive: true, soft: true });
    for (const b of [this.smoke, this.fire]) { b.mat.uniforms.fogTex = this.fogU.fogTex; b.mat.uniforms.fogScale = this.fogU.fogScale; this.group.add(b.mesh); }
    this.particles = [];
    // hover ring / selection
    const ring = new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2);
    this.hover = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe070, transparent: true, opacity: 0.85, depthTest: false }));
    this.hover.renderOrder = 10; this.hover.visible = false; this.group.add(this.hover);
    // catapult stones
    this.projMesh = instanced(new THREE.IcosahedronGeometry(0.07, 0), this.natureMat, 64); this.group.add(this.projMesh);
    // birds
    const bird = new THREE.BufferGeometry(); bird.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, -0.12, 0.02, -0.02, 0, 0, -0.03, 0, 0, 0.05, 0.12, 0.02, -0.02, 0, 0, -0.03], 3)); bird.computeVertexNormals();
    this.birdMesh = instanced(bird, new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide }), 40, { shadow: false });
    this.group.add(this.birdMesh);
    const rnd = mulberry(77); const g = this.game.grid;
    this.birds = Array.from({ length: Math.min(40, Math.round(g.n / 250)) }, () => ({ cx: rnd() * g.w, cz: rnd() * g.h * ROW_H, r: 3 + rnd() * 8, h: 5 + rnd() * 4, sp: 0.15 + rnd() * 0.2, ph: rnd() * 6.28 }));
    this.buildHelp = false; this.previewNodes = null;
  }

  rebuildRoads() {
    const game = this.game, g = game.grid;
    const pos = [], uv = [], idx = [];
    const exp = game.players[this.me].explored;
    for (const r of game.roads.values()) {
      if (!this.revealAll && !exp[r.nodes[0]]) continue;
      this.ribbon(r.nodes, r.busy ? 1 : 0, pos, uv, idx, 0.2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.roadMesh.geometry.dispose(); this.roadMesh.geometry = geo;
  }
  // road ribbon along node path, subdivided to hug the smoothed terrain
  ribbon(nodes, kind, pos, uv, idx, width) {
    const g = this.game.grid, SUB = 6;
    const pts = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const ax = g.wx(nodes[i]), az = g.wz(nodes[i]), bx = g.wx(nodes[i + 1]), bz = g.wz(nodes[i + 1]);
      for (let k = 0; k < SUB; k++) pts.push([ax + (bx - ax) * k / SUB, az + (bz - az) * k / SUB]);
    }
    const l = nodes[nodes.length - 1]; pts.push([g.wx(l), g.wz(l)]);
    const base = pos.length / 3; let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz * width, nz = dx * width;
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      for (const sgn of [-1, 1]) { const x = p[0] + nx * sgn, z = p[1] + nz * sgn; pos.push(x, this.terrain.heightAt(x, z) + 0.025, z); uv.push(kind * 0.5 + (sgn > 0 ? 0.499 : 0.001), acc * 0.9); }
      if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  setPreview(nodes, ok = true) {
    const pos = [], uv = [], idx = [];
    if (nodes && nodes.length > 1) this.ribbon(nodes, 0, pos, uv, idx, 0.17);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (idx.length) geo.setIndex(idx);
    this.previewMesh.geometry.dispose(); this.previewMesh.geometry = geo;
    this.previewMat.color.set(ok ? 0xfff0a0 : 0xff6050);
  }

  syncFlagsBorders() {
    const game = this.game, g = game.grid;
    let fc = 0;
    const exp = game.players[this.me].explored;
    for (const f of game.flags.values()) {
      const p = this.nodePos(f.node); if (!this.inView(p.x, p.z)) continue;
      if (!this.revealAll && !exp[f.node]) continue;
      _m.compose(_v.set(p.x + 0.05, p.y, p.z - 0.03), _q.setFromAxisAngle(UP, -0.4), _s.set(1, 1, 1));
      this.flagPole.setMatrixAt(fc, _m); this.flagCloth.setMatrixAt(fc, _m); this.flagCloth.setColorAt(fc, this.teamCol[f.owner]); fc++;
    }
    this.flagPole.count = fc; this.flagCloth.count = fc; flagInst(this.flagPole); flagInst(this.flagCloth); this.flagCloth.instanceColor.needsUpdate = true;
  }
  rebuildBorders() {
    const game = this.game, g = game.grid, own = game.owner;
    let bc = 0;
    const exp = game.players[this.me].explored;
    for (let n = 0; n < g.n; n++) {
      const o = own[n]; if (!o) continue;
      if (!this.revealAll && !exp[n]) continue;
      for (let d = 0; d < 3; d++) {
        const j = g.neighbor(n, d);
        if (j >= 0 && own[j] === o) continue;
        // marker halfway towards the foreign neighbour (and on the border node itself for map edges)
        const x = j >= 0 ? (g.wx(n) * 0.62 + g.wx(j) * 0.38) : g.wx(n), z = j >= 0 ? (g.wz(n) * 0.62 + g.wz(j) * 0.38) : g.wz(n);
        if (bc >= 8192) break;
        _m.compose(_v.set(x, this.terrain.heightAt(x, z) - 0.01, z), _q.identity(), _s.set(1, 1, 1));
        this.border.setMatrixAt(bc, _m); this.border.setColorAt(bc, this.teamCol[o - 1]); bc++;
      }
      for (let d = 3; d < 6; d++) {
        const j = g.neighbor(n, d);
        if (j >= 0 && own[j]) continue; // foreign-owned handled from the other side
        if (bc >= 8192) break;
        const x = j >= 0 ? (g.wx(n) * 0.62 + g.wx(j) * 0.38) : g.wx(n), z = j >= 0 ? (g.wz(n) * 0.62 + g.wz(j) * 0.38) : g.wz(n);
        _m.compose(_v.set(x, this.terrain.heightAt(x, z) - 0.01, z), _q.identity(), _s.set(1, 1, 1));
        this.border.setMatrixAt(bc, _m); this.border.setColorAt(bc, this.teamCol[o - 1]); bc++;
      }
    }
    this.border.count = bc; flagInst(this.border); this.border.instanceColor.needsUpdate = true;
  }

  syncIcons() {
    const game = this.game, g = game.grid, ic = this.icons;
    ic.begin();
    const exp = game.players[this.me].explored, vis = game.players[this.me].visible;
    // wares waiting at flags
    for (const f of game.flags.values()) {
      if (!this.revealAll && !vis[f.node]) continue;
      const p = this.nodePos(f.node); if (!this.inView(p.x, p.z)) continue;
      f.wares.forEach((wid, k) => {
        const w = game.wares.get(wid); if (!w) return;
        const a = k * 0.785 + 2.2, r = 0.2;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        ic.add(x, this.terrain.heightAt(x, z) + 0.01, z, 0.15, iconUV(w.type));
      });
    }
    for (const [x, y, z, type] of this.carried) ic.add(x, y, z, 0.15, iconUV(type));
    // geologist signs
    for (let n = 0; n < g.n; n++) {
      const o = game.map.obj[n]; if (!o || o.t !== 'sign' || (!this.revealAll && !exp[n])) continue;
      const p = this.nodePos(n); if (!this.inView(p.x, p.z)) continue;
      const nm = ['res_none', 'res_coal', 'res_iron', 'res_gold', 'res_granite', 'res_water', 'res_none'][o.r] || 'res_none';
      ic.add(p.x, p.y, p.z, o.a === 3 ? 0.36 : o.a === 2 ? 0.3 : 0.24, iconUV(nm));
    }
    // build help
    if (this.buildHelp) {
      const me = this.me;
      if (!this._bh || this._bhV !== game.objVersion + game.roadVersion * 7 + game.terrVersion * 131) {
        this._bhV = game.objVersion + game.roadVersion * 7 + game.terrVersion * 131;
        this._bh = [];
        for (let n = 0; n < g.n; n++) { if (game.owner[n] !== me + 1) continue; const c = game.buildCap(me, n); if (c !== 'none') this._bh.push([n, c]); }
      }
      for (const [n, c] of this._bh) {
        const p = this.nodePos(n); if (!this.inView(p.x, p.z)) continue;
        const sz = c === 'flag' ? 0.2 : c === 'small' ? 0.26 : c === 'medium' ? 0.3 : c === 'large' ? 0.36 : 0.3;
        ic.add(p.x, p.y + 0.01, p.z, sz, iconUV('bh_' + c), 1, 1, 1, 0.95);
      }
    }
    ic.end();
  }

  // ------------------------------------------------------------ effects
  puff(x, y, z, kind, n = 1) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 2800) return;
      const p = { x, y, z, vx: (Math.random() - 0.5) * 0.15, vy: 0.3 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.15, t: 0, life: 3, size: 0.15, kind };
      if (kind === 'fire') { p.life = 0.9; p.vy = 0.7 + Math.random() * 0.5; p.size = 0.22; }
      if (kind === 'smokeDark') { p.life = 3.5; p.size = 0.3; }
      if (kind === 'dust') { p.life = 1.4; p.vy = 0.15; p.vx *= 5; p.vz *= 5; p.size = 0.25; }
      if (kind === 'spark') { p.life = 0.5; p.vy = 1.2; p.vx *= 12; p.vz *= 12; p.size = 0.05; }
      if (kind === 'splash') { p.life = 0.6; p.vy = 0.9; p.vx *= 6; p.vz *= 6; p.size = 0.07; }
      if (kind === 'leaf') { p.life = 2; p.vy = -0.1; p.vx *= 3; p.vz *= 3; p.size = 0.06; }
      this.particles.push(p);
    }
  }
  syncParticles(dt) {
    this.smoke.begin(); this.fire.begin();
    const wind = 0.12;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt; if (p.t > p.life) { this.particles.splice(i, 1); continue; }
      const k = p.t / p.life;
      if (p.kind === 'spark' || p.kind === 'splash') p.vy -= 3 * dt;
      p.x += (p.vx + wind * (p.kind.startsWith('smoke') ? 1 : 0)) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.kind === 'smoke' || p.kind === 'smokeDark') { const s = p.size * (1 + k * 3); const c = p.kind === 'smoke' ? 0.85 : 0.25; this.smoke.add(p.x, p.y, p.z, s, [0, 0, 1, 1], c, c, c * 1.02, 0.45 * (1 - k)); }
      else if (p.kind === 'dust') this.smoke.add(p.x, p.y, p.z, p.size * (1 + k * 2), [0, 0, 1, 1], 0.72, 0.62, 0.48, 0.5 * (1 - k));
      else if (p.kind === 'leaf') this.smoke.add(p.x, p.y, p.z, p.size, [0, 0, 1, 1], 0.3, 0.55, 0.15, 1 - k);
      else if (p.kind === 'splash') this.smoke.add(p.x, p.y, p.z, p.size, [0, 0, 1, 1], 0.8, 0.9, 1, 0.8 * (1 - k));
      else { const s = p.size * (1 - k * 0.6); this.fire.add(p.x, p.y, p.z, s, [0, 0, 1, 1], 1, 0.55 - k * 0.3, 0.15, 1 - k); }
    }
    this.smoke.end(); this.fire.end();
  }

  onEvent(e) {
    const game = this.game, g = game.grid;
    if (e.node < 0 && e.type !== 'defeated') return;
    const p = e.node >= 0 ? this.nodePos(e.node, new THREE.Vector3()) : null;
    if (p && !this.inView(p.x, p.z, 6)) return;
    switch (e.type) {
      case 'treeFall': this.fallingTrees.push({ node: e.node, sp: e.sp, v: e.v, t: 0, dir: (YAW[e.face ?? 0] ?? 0) + Math.PI / 2 }); break;
      case 'burn': if (e.btype) this.burning.push({ type: e.btype, node: e.node, owner: e.p, t: 0 }); break;
      case 'built': this.puff(p.x, p.y + 0.3, p.z, 'dust', 14); break;
      case 'chop': if (Math.random() < 0.5) this.puff(p.x, p.y + 0.6, p.z, 'leaf', 2); break;
      case 'pick': case 'hammer': this.puff(p.x, p.y + 0.15, p.z, 'dust', 1); break;
      case 'anvil': this.puff(p.x + 0.3, p.y + 0.2, p.z + 0.3, 'spark', 6); break;
      case 'splash': this.puff(p.x, this.terrain.seaY, p.z, 'splash', 8); break;
      case 'hit': this.puff(p.x, p.y + 0.2, p.z, 'dust', 3); break;
      case 'death': this.puff(p.x, p.y + 0.1, p.z, 'dust', 10); break;
      case 'impact': this.puff(p.x, p.y + 0.4, p.z, 'dust', 16); this.puff(p.x, p.y + 0.4, p.z, 'spark', 8); break;
      case 'capture': this.puff(p.x, p.y + 0.8, p.z, 'spark', 20); break;
    }
  }

  syncFalling(dt) {
    // falling trees use the per-species instanced mesh with extra instances appended
    for (const f of this.fallingTrees) {
      f.t += dt;
      const mesh = this.treeMesh[f.sp] || this.treeMesh.oak; const i = mesh.count; if (i >= 4096) continue;
      const g = this.game.grid, x = g.wx(f.node), z = g.wz(f.node);
      const k = Math.min(1, (f.t / 1.4) ** 2), ang = k * Math.PI * 0.48, sink = Math.max(0, f.t - 2.2) * 0.5;
      _q.setFromEuler(_e.set(0, f.dir, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang));
      _m.compose(_v.set(x, this.terrain.heightAt(x, z) - sink, z), _q, _s.set(1, 1, 1));
      mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.setRGB(0.9, 0.9, 0.85)); mesh.count = i + 1; flagInst(mesh);
      if (f.t > 1.3 && !f.dusted) { f.dusted = true; const d = new THREE.Vector3(Math.sin(f.dir), 0, Math.cos(f.dir)); this.puff(x + d.x * 0.6, this.terrain.heightAt(x, z) + 0.1, z + d.z * 0.6, 'dust', 10); }
    }
    this.fallingTrees = this.fallingTrees.filter(f => f.t < 3.6);
  }

  syncProjectiles() {
    const game = this.game, g = game.grid; let c = 0;
    for (const pr of game.projectiles) {
      const ax = g.wx(pr.from), az = g.wz(pr.from), bx = g.wx(pr.to), bz = g.wz(pr.to);
      const x = ax + (bx - ax) * pr.t, z = az + (bz - az) * pr.t;
      const y = this.terrain.heightAt(ax, az) * (1 - pr.t) + this.terrain.heightAt(bx, bz) * pr.t + 0.6 + Math.sin(Math.PI * pr.t) * 3;
      _m.compose(_v.set(x, y, z), _q.identity(), _s.set(1, 1, 1)); this.projMesh.setMatrixAt(c++, _m);
      if (Math.random() < 0.4) this.puff(x, y, z, 'dust', 1);
    }
    this.projMesh.count = c; flagInst(this.projMesh);
  }

  syncBirds(dt) {
    let c = 0;
    for (const b of this.birds) {
      const a = this.time * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
      if (!this.inView(x, z, 6)) continue;
      const flap = Math.sin(this.time * 12 + b.ph) * 0.5;
      _q.setFromEuler(_e.set(0, -a, flap * 0.3));
      _m.compose(_v.set(x, this.terrain.heightAt(x, z) + b.h, z), _q, _s.set(1.4, 1 + flap, 1.4));
      this.birdMesh.setMatrixAt(c++, _m);
    }
    this.birdMesh.count = c; flagInst(this.birdMesh);
  }

  // ------------------------------------------------------------ per frame
  update(dt, viewBox) {
    this.time += dt; this.viewBox = viewBox;
    const game = this.game;
    this.bldMat.userData.uniforms.uTime.value = this.time;
    if (game.objVersion !== this.lastObjV) { this.lastObjV = game.objVersion; this.syncDecor(); this.syncNature(); this.natureT = 0; }
    this.natureT += dt; if (this.natureT > 1.5) { this.natureT = 0; this.syncNature(); }
    if (game.roadVersion !== this.lastRoadV) { this.lastRoadV = game.roadVersion; this.rebuildRoads(); this.syncDecor(); }
    if (game.terrVersion !== this.lastTerrV) { this.lastTerrV = game.terrVersion; this.rebuildBorders(); }
    this.syncBuildings(dt);
    this.syncFigures(dt);
    this.syncFalling(dt);
    this.syncFlagsBorders();
    this.syncIcons();
    this.syncParticles(dt);
    this.syncProjectiles();
    this.syncBirds(dt);
  }
  setHover(n) {
    if (n < 0) { this.hover.visible = false; return; }
    const p = this.nodePos(n); this.hover.position.set(p.x, p.y + 0.03, p.z); this.hover.visible = true;
  }
}

function flagInst(m) { m.instanceMatrix.needsUpdate = true; for (const k of ['instA', 'instB']) { const a = m.geometry.getAttribute(k); if (a) a.needsUpdate = true; } }
function addInstAttrs(mesh, cap) {
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.setAttribute('instA', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage));
  mesh.geometry.setAttribute('instB', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
}
function windPatch(mat, timeU, amp) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = timeU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float wind;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float wph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.5;
      #else
        float wph = 0.0;
      #endif
      float wv = sin(uTime * 1.7 + wph) * 0.6 + sin(uTime * 3.1 + wph * 1.3) * 0.4;
      transformed.x += wv * wind * ${amp.toFixed(3)};
      transformed.z += wv * wind * ${(amp * 0.6).toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => 'wind' + amp;
}
function mulberry(a) { return () => { let t = (a = (a + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
