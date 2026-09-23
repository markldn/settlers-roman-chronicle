// Procedural 3D models. Buildings are merged geometries sampling a shared texture atlas
// (per-vertex tile rect + fract() tiling with textureGrad -> no seams), tinted by nation,
// with team-coloured cloth parts and emissive furnace parts. Trees, rocks, figures and
// animals are vertex-coloured low-poly meshes meant for InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, tileRect, buildMaterialAtlas } from './textures.js';
import { NATIONS } from '../sim/data.js';

const C = (hex) => new THREE.Color(hex);

// ------------------------------------------------------------------ builder
class MB {
  constructor() { this.parts = []; }
  add(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, uvs = 1, tint = 0xffffff, team = 0, emit = 0, uvsx, uvsy } = {}) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    geo.applyMatrix4(m);
    const n = geo.attributes.position.count;
    const uv = geo.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) { uv[i] *= uvsx ?? uvs; uv[i + 1] *= uvsy ?? uvs; }
    const rect = tileRect(mat), rr = new Float32Array(n * 4), col = new Float32Array(n * 3), tm = new Float32Array(n * 2);
    const c = C(tint);
    for (let i = 0; i < n; i++) { rr.set(rect, i * 4); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; tm[i * 2] = team; tm[i * 2 + 1] = emit; }
    geo.setAttribute('uvRect', new THREE.BufferAttribute(rr, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('teamEmit', new THREE.BufferAttribute(tm, 2));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'uvRect', 'color', 'teamEmit'].includes(k)) geo.deleteAttribute(k);
    this.parts.push(geo);
    return this;
  }
  box(w, h, d, mat, o = {}) { const g = new THREE.BoxGeometry(w, h, d); boxUV(g, w, h, d, o.uvs ?? 1); return this.add(g, mat, Object.assign({}, o, { y: (o.y || 0) + h / 2, uvs: 1 })); }
  cyl(rt, rb, h, seg, mat, o = {}) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open); scaleUV(g, Math.PI * 2 * rb, h, o.uvs ?? 1); return this.add(g, mat, Object.assign({}, o, { y: (o.y || 0) + h / 2, uvs: 1 })); }
  cone(r, h, seg, mat, o = {}) { const g = new THREE.ConeGeometry(r, h, seg); scaleUV(g, Math.PI * 2 * r, Math.hypot(r, h), o.uvs ?? 1); return this.add(g, mat, Object.assign({}, o, { y: (o.y || 0) + h / 2, uvs: 1 })); }
  sphere(r, mat, o = {}) { const g = new THREE.SphereGeometry(r, o.seg || 10, o.seg2 || 7, 0, Math.PI * 2, 0, o.half ? Math.PI / 2 : Math.PI); scaleUV(g, Math.PI * 2 * r, Math.PI * r, o.uvs ?? 1); return this.add(g, mat, Object.assign({}, o, { uvs: 1 })); }
  // gable roof: ridge along x, width w (x), depth d (z), height h, placed at y
  gable(w, d, h, mat, o = {}) {
    const hw = w / 2, hd = d / 2;
    const v = [
      // two slopes
      -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
      hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
      // gables
      hw, 0, hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
    ];
    const s = Math.hypot(hd, h) * (o.uvs ?? 1), ww = w * (o.uvs ?? 1);
    const uv = [0, 0, ww, 0, ww, s, 0, 0, ww, s, 0, s, 0, 0, ww, 0, ww, s, 0, 0, ww, s, 0, s, 0, 0, d, 0, d / 2, h, 0, 0, d, 0, d / 2, h];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const gm = o.gableMat ?? mat;
    if (gm !== mat) {
      // split: slopes with roof material, gable ends with wall material
      const a = g.clone(); a.setDrawRange(0, 12);
      const slopes = new THREE.BufferGeometry(); slopes.setAttribute('position', new THREE.Float32BufferAttribute(v.slice(0, 36), 3)); slopes.setAttribute('uv', new THREE.Float32BufferAttribute(uv.slice(0, 24), 2)); slopes.computeVertexNormals();
      const ends = new THREE.BufferGeometry(); ends.setAttribute('position', new THREE.Float32BufferAttribute(v.slice(36), 3)); ends.setAttribute('uv', new THREE.Float32BufferAttribute(uv.slice(24), 2)); ends.computeVertexNormals();
      this.add(slopes, mat, Object.assign({}, o, { uvs: 1 }));
      return this.add(ends, gm, Object.assign({}, o, { uvs: 1, tint: o.gableTint ?? 0xffffff }));
    }
    return this.add(g, mat, Object.assign({}, o, { uvs: 1 }));
  }
  pyramid(w, d, h, mat, o = {}) { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w, h, d); g.translate(0, h / 2, 0); scaleUV(g, w * 2, h, o.uvs ?? 1); return this.add(g, mat, Object.assign({}, o, { uvs: 1 })); }
  build() { const g = mergeGeometries(this.parts, false); g.computeBoundingBox(); g.computeBoundingSphere(); return g; }
}
function scaleUV(g, su, sv, k) { const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i += 2) { uv[i] *= su * k; uv[i + 1] *= sv * k; } }
function boxUV(g, w, h, d, k) {
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.attributes.uv.array;
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 2; uv[i] *= dims[f][0] * k; uv[i + 1] *= dims[f][1] * k; }
}

// ------------------------------------------------------------------ building material
let bldMat = null;
export function buildingMaterial() {
  if (bldMat) return bldMat;
  const { map, normalMap } = buildMaterialAtlas();
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 0.85, metalness: 0.0 });
  mat.userData.uniforms = { uTime: { value: 0 } };
  bldMat = mat;
  return mat;
}
// Patch: atlas tiling, team colour + construction progress per instance, emissive parts, burn.
// Instance attributes: instA = (teamR, teamG, teamB, progress), instB = (burn, height, working, flash)
export function patchBuildingShader(mat, extraUniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms, extraUniforms || {});
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 uvRect; attribute vec2 teamEmit; attribute vec4 instA; attribute vec4 instB;
      varying vec4 vUvRect; varying vec2 vTeamEmit; varying vec4 vInstA; varying vec4 vInstB; varying float vLocalY; varying vec2 vTileUv;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vUvRect = uvRect; vTeamEmit = teamEmit; vInstA = instA; vInstB = instB; vLocalY = position.y; vTileUv = uv;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
      vColor.rgb = mix(vColor.rgb, instA.rgb, teamEmit.x);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vUvRect; varying vec2 vTeamEmit; varying vec4 vInstA; varying vec4 vInstB; varying float vLocalY; varying vec2 vTileUv;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (vLocalY > vInstA.w * vInstB.y + 0.001) discard;`)
      .replace('#include <map_fragment>', `
      vec2 tuvA = vUvRect.xy + fract(vTileUv) * vUvRect.zw;
      tuvA = clamp(tuvA, vUvRect.xy + 0.002, vUvRect.xy + vUvRect.zw - 0.002);
      vec4 sampledDiffuseColor = textureGrad(map, tuvA, dFdx(vTileUv) * vUvRect.zw, dFdy(vTileUv) * vUvRect.zw);
      diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <normal_fragment_maps>', `
      vec3 mapN = textureGrad(normalMap, tuvA, dFdx(vTileUv) * vUvRect.zw, dFdy(vTileUv) * vUvRect.zw).xyz * 2.0 - 1.0;
      mapN.xy *= normalScale;
      normal = normalize(tbn * mapN);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * vTeamEmit.y * (0.4 + 1.8 * vInstB.z) * (0.85 + 0.15 * sin(uTime * 9.0 + vLocalY * 5.0));
      diffuseColor.rgb *= 1.0 - vInstB.x * 0.8;
      totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * vInstB.w * 0.3;`)
      .replace('#include <common>', '#include <common>\n#define HAS_UTIME\nuniform float uTime;');
    // normal_fragment_maps needs tbn; ensure the tangent-space code path uses derivatives
  };
  mat.customProgramCacheKey = () => 'bld';
}

// ------------------------------------------------------------------ building designs
// front of every building faces +z; the renderer rotates by 30deg so the door faces the flag
const W = (n) => NATIONS[n] || NATIONS.romans;

function door(b, x, z, w = 0.22, h = 0.34, ry = 0) { b.box(w, h, 0.03, MAT.door, { x, z, ry, uvsx: 1 / w, uvsy: 1 / h }); }
function win(b, x, y, z, s = 0.14, ry = 0) { b.box(s, s, 0.03, MAT.window, { x, y, z, ry, uvsx: 1 / s, uvsy: 1 / s }); }
function banner(b, x, y, z, h = 0.5) {
  b.cyl(0.015, 0.015, h + 0.2, 5, MAT.timber, { x, y, z, tint: 0x6b4a2a });
  b.box(0.2, 0.13, 0.01, MAT.cloth, { x: x + 0.1, y: y + h - 0.02, z, team: 1 });
}
function crenel(b, w, d, y, mat = MAT.stone, ox = 0, oz = 0) {
  const n = Math.max(2, Math.round(w / 0.13));
  for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 0.5) * w / n; if (i % 2) continue; b.box(w / n, 0.08, 0.07, mat, { x: ox + x, y, z: oz + d / 2 - 0.035 }); if (d > 0.2) b.box(w / n, 0.08, 0.07, mat, { x: ox + x, y, z: oz - d / 2 + 0.035 }); }
  if (d <= 0.2) return;
  const m = Math.max(2, Math.round(d / 0.13));
  for (let i = 0; i < m; i++) { const z = -d / 2 + (i + 0.5) * d / m; if (i % 2) continue; b.box(0.07, 0.08, d / m, mat, { x: ox + w / 2 - 0.035, y, z: oz + z }); b.box(0.07, 0.08, d / m, mat, { x: ox - w / 2 + 0.035, y, z: oz + z }); }
}
function house(b, nat, { w = 0.8, d = 0.62, h = 0.5, rh = 0.36, x = 0, z = 0, ry = 0, wall = MAT.plaster, roof = MAT.roof, base = true, windows = true, doorOn = true, chimney = false }) {
  const N = W(nat), rt = roof === MAT.roof ? N.roof : roof === MAT.thatch ? 0xe0c080 : 0xffffff;
  const g = new MB();
  if (base) g.box(w + 0.04, 0.1, d + 0.04, MAT.fieldstone, { uvs: 1.5 });
  g.box(w, h, d, wall, { y: base ? 0.1 : 0, tint: wall === MAT.plaster ? N.wall : 0xffffff, uvs: 1.2 });
  // timber corner posts & beam
  if (wall === MAT.plaster) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(0.05, h, 0.05, MAT.timber, { x: sx * (w / 2 - 0.01), y: 0.1, z: sz * (d / 2 - 0.01), tint: N.trim });
  if (wall === MAT.plaster) g.box(w + 0.02, 0.05, d + 0.02, MAT.timber, { y: (base ? 0.1 : 0) + h - 0.03, tint: N.trim });
  g.gable(w + 0.14, d + 0.2, rh, roof, { y: (base ? 0.1 : 0) + h, tint: rt, gableMat: wall, gableTint: wall === MAT.plaster ? N.wall : 0xffffff, uvs: 1.4 });
  if (doorOn) door(g, 0, d / 2 + 0.012, 0.2, 0.3);
  if (windows) { win(g, -w * 0.3, (base ? 0.1 : 0) + h * 0.45, d / 2 + 0.012); win(g, w * 0.3, (base ? 0.1 : 0) + h * 0.45, d / 2 + 0.012); win(g, 0, (base ? 0.1 : 0) + h * 0.45, -d / 2 - 0.012); }
  if (chimney) g.box(0.12, rh + 0.25, 0.12, MAT.brick, { x: w * 0.28, y: (base ? 0.1 : 0) + h, z: -d * 0.15, uvs: 3 });
  for (const p of g.parts) { p.rotateY(ry); p.translate(x, 0, z); b.parts.push(p); }
}
function logPile(b, x, z, n = 3, ry = 0) {
  for (let i = 0; i < n; i++) b.cyl(0.05, 0.05, 0.4, 7, MAT.timber, { x: x + (i % 2) * 0.05, y: 0.05 + Math.floor(i / 2) * 0.09, z: z + (i - n / 2) * 0.09, rz: Math.PI / 2, ry, tint: 0xa07850 });
}
function barrel(b, x, z, y = 0) { b.cyl(0.07, 0.065, 0.16, 8, MAT.planks, { x, y, z, tint: 0x9a6a3a, uvs: 3 }); }
function fence(b, pts, h = 0.14) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
    b.box(len, 0.025, 0.02, MAT.timber, { x: (x0 + x1) / 2, y: h * 0.45, z: (z0 + z1) / 2, ry: -a, tint: 0xb08858 });
    b.box(len, 0.025, 0.02, MAT.timber, { x: (x0 + x1) / 2, y: h * 0.85, z: (z0 + z1) / 2, ry: -a, tint: 0xb08858 });
    b.box(0.03, h, 0.03, MAT.timber, { x: x0, z: z0, tint: 0x8a6a40 });
  }
}
function tower(b, nat, { r = 0.26, h = 1.1, x = 0, z = 0, roofH = 0.45, cren = false, mat = MAT.stone }) {
  const N = W(nat);
  b.cyl(r, r * 1.06, h, 12, mat, { x, z, uvs: 1.6 });
  if (cren) { b.cyl(r * 1.12, r * 1.12, 0.1, 12, mat, { x, y: h, z, uvs: 1.6 }); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.box(0.08, 0.1, 0.06, mat, { x: x + Math.cos(a) * r * 1.05, y: h + 0.1, z: z + Math.sin(a) * r * 1.05, ry: -a }); } }
  else b.cone(r * 1.25, roofH, 12, MAT.roof, { x, y: h, z, tint: N.roof, uvs: 1.6 });
  win(b, x, h * 0.7, z + r + 0.01, 0.1);
}

const DESIGNS = {
  hq(nat) {
    const b = new MB(), N = W(nat);
    b.box(2.0, 0.12, 1.7, MAT.fieldstone, { x: -0.35, z: -0.3, uvs: 1.2 });
    // curtain walls
    b.box(1.8, 0.55, 0.14, MAT.stone, { x: -0.35, y: 0.1, z: 0.45, uvs: 1.4 }); crenel(b, 1.8, 0.14, 0.65, MAT.stone, -0.35, 0.45);
    b.box(1.8, 0.55, 0.14, MAT.stone, { x: -0.35, y: 0.1, z: -1.0, uvs: 1.4 });
    b.box(0.14, 0.55, 1.4, MAT.stone, { x: -1.22, y: 0.1, z: -0.28, uvs: 1.4 });
    b.box(0.14, 0.55, 1.4, MAT.stone, { x: 0.52, y: 0.1, z: -0.28, uvs: 1.4 });
    // keep
    b.box(0.9, 1.25, 0.8, MAT.stone, { x: -0.35, y: 0.1, z: -0.3, uvs: 1.4 });
    b.pyramid(1.05, 0.95, 0.5, MAT.roof, { x: -0.35, y: 1.35, z: -0.3, tint: N.roof, uvs: 1.4 });
    win(b, -0.55, 0.95, 0.105); win(b, -0.15, 0.95, 0.105); win(b, -0.35, 0.65, 0.105);
    // corner towers
    for (const [x, z] of [[-1.2, 0.42], [0.5, 0.42], [-1.2, -0.98], [0.5, -0.98]]) tower(b, nat, { r: 0.2, h: 0.95, x, z, roofH: 0.42 });
    // gate
    b.box(0.34, 0.42, 0.05, MAT.door, { x: -0.1, y: 0.1, z: 0.53, uvsx: 1 / 0.34, uvsy: 1 / 0.42 });
    banner(b, -0.35, 1.8, -0.3, 0.45);
    banner(b, 0.5, 1.35, 0.42, 0.3);
    return b.build();
  },
  storehouse(nat) {
    const b = new MB(), N = W(nat);
    b.box(1.2, 0.1, 0.9, MAT.fieldstone, { uvs: 1.3 });
    b.box(1.1, 0.6, 0.8, MAT.planks, { y: 0.1, tint: 0xd8b890, uvs: 1.8 });
    b.box(1.14, 0.22, 0.84, MAT.stone, { y: 0.1, uvs: 1.6 });
    b.gable(1.3, 1.0, 0.5, MAT.shingle, { y: 0.7, tint: 0xc09070, gableMat: MAT.planks, uvs: 1.5 });
    b.box(0.4, 0.42, 0.03, MAT.door, { y: 0.1, z: 0.415, uvsx: 2.5, uvsy: 2.4 });
    barrel(b, 0.45, 0.5); barrel(b, 0.3, 0.55); b.box(0.16, 0.14, 0.16, MAT.planks, { x: -0.45, z: 0.5, tint: 0xb08858, uvs: 4 });
    banner(b, 0.5, 0.9, 0.1, 0.4);
    return b.build();
  },
  woodcutter(nat) { const b = new MB(); house(b, nat, { w: 0.7, d: 0.55, h: 0.42, rh: 0.34, roof: MAT.thatch, wall: MAT.planks }); logPile(b, 0.52, 0.1, 5); b.cyl(0.09, 0.1, 0.12, 8, MAT.timber, { x: 0.35, z: 0.45, tint: 0xa07850 }); return b.build(); },
  forester(nat) { const b = new MB(); house(b, nat, { w: 0.7, d: 0.55, h: 0.42, rh: 0.34, roof: MAT.thatch }); for (let i = 0; i < 3; i++) { b.cyl(0.05, 0.04, 0.07, 6, MAT.brick, { x: 0.45, z: 0.3 - i * 0.14 }); b.cone(0.06, 0.16, 6, MAT.white, { x: 0.45, y: 0.07, z: 0.3 - i * 0.14, tint: 0x3f7a2a }); } return b.build(); },
  quarry(nat) {
    const b = new MB(); house(b, nat, { w: 0.62, d: 0.5, h: 0.38, rh: 0.3, roof: MAT.shingle, wall: MAT.fieldstone });
    for (let i = 0; i < 4; i++) b.box(0.14, 0.12, 0.14, MAT.stone, { x: 0.5 + (i % 2) * 0.16, y: Math.floor(i / 2) * 0.12, z: 0.1 - (i % 2) * 0.05, ry: i * 0.3, uvs: 5 });
    b.cyl(0.02, 0.02, 0.7, 5, MAT.timber, { x: -0.45, z: 0.3, tint: 0x8a6a40 }); b.box(0.5, 0.03, 0.03, MAT.timber, { x: -0.25, y: 0.68, z: 0.3, tint: 0x8a6a40 });
    return b.build();
  },
  fishery(nat) {
    const b = new MB(); house(b, nat, { w: 0.66, d: 0.52, h: 0.4, rh: 0.32, roof: MAT.thatch, wall: MAT.planks });
    for (const x of [0.4, 0.75]) b.cyl(0.015, 0.015, 0.35, 5, MAT.timber, { x, z: 0.35, tint: 0x8a6a40 });
    b.box(0.35, 0.25, 0.01, MAT.cloth, { x: 0.575, y: 0.08, z: 0.35, tint: 0x9aa89a, uvs: 6 });
    b.box(0.45, 0.06, 0.16, MAT.planks, { x: -0.3, z: 0.5, tint: 0x8a5a30, uvs: 4 });
    return b.build();
  },
  hunter(nat) {
    const b = new MB(); house(b, nat, { w: 0.66, d: 0.52, h: 0.4, rh: 0.32, roof: MAT.shingle, wall: MAT.timber });
    b.box(0.03, 0.12, 0.03, MAT.white, { x: -0.06, y: 0.5, z: 0.29, rz: 0.5, tint: 0xd8cbb0 }); b.box(0.03, 0.12, 0.03, MAT.white, { x: 0.06, y: 0.5, z: 0.29, rz: -0.5, tint: 0xd8cbb0 });
    b.box(0.2, 0.26, 0.01, MAT.cloth, { x: 0.46, y: 0.12, z: 0.1, ry: 1.2, tint: 0x8a5a3a, uvs: 5 });
    return b.build();
  },
  well(nat) {
    const b = new MB(), N = W(nat);
    b.cyl(0.22, 0.24, 0.26, 12, MAT.fieldstone, { uvs: 2.5 });
    b.cyl(0.18, 0.18, 0.02, 12, MAT.white, { y: 0.24, tint: 0x2a4a6a });
    for (const x of [-0.2, 0.2]) b.box(0.04, 0.5, 0.04, MAT.timber, { x, y: 0.2, tint: 0x7a5a38 });
    b.cyl(0.03, 0.03, 0.44, 6, MAT.timber, { y: 0.55, rz: Math.PI / 2, tint: 0x7a5a38 });
    b.gable(0.56, 0.42, 0.2, MAT.roof, { y: 0.7, tint: N.roof });
    b.cyl(0.05, 0.04, 0.08, 7, MAT.planks, { x: 0.05, y: 0.35, tint: 0x9a6a3a });
    return b.build();
  },
  lookout(nat) {
    const b = new MB(), N = W(nat);
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) b.box(0.05, 1.5, 0.05, MAT.timber, { x, z, tint: 0x8a6a40 });
    for (const y of [0.4, 0.85]) { b.box(0.42, 0.03, 0.03, MAT.timber, { y, z: 0.18, tint: 0x8a6a40 }); b.box(0.03, 0.03, 0.42, MAT.timber, { x: 0.18, y, tint: 0x8a6a40 }); }
    b.box(0.56, 0.05, 0.56, MAT.planks, { y: 1.3, tint: 0xb08858, uvs: 3 });
    b.box(0.56, 0.14, 0.02, MAT.planks, { y: 1.35, z: 0.27, tint: 0xa07850, uvs: 3 }); b.box(0.56, 0.14, 0.02, MAT.planks, { y: 1.35, z: -0.27, tint: 0xa07850, uvs: 3 });
    b.pyramid(0.7, 0.7, 0.3, MAT.shingle, { y: 1.6, tint: 0xb08060 });
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) b.box(0.03, 0.3, 0.03, MAT.timber, { x, y: 1.32, z, tint: 0x8a6a40 });
    return b.build();
  },
  barracks(nat) {
    const b = new MB();
    house(b, nat, { w: 0.72, d: 0.56, h: 0.42, rh: 0.3, wall: MAT.timber, roof: MAT.shingle, windows: false });
    for (let i = 0; i < 9; i++) { const a = -0.9 + i * 0.22; b.cyl(0.03, 0.03, 0.34, 5, MAT.timber, { x: Math.cos(a) * 0.52 + 0.1, z: Math.sin(a) * 0.52 * 0.2 + 0.45, tint: 0x8a6a40 }); b.cone(0.03, 0.05, 5, MAT.timber, { x: Math.cos(a) * 0.52 + 0.1, y: 0.34, z: Math.sin(a) * 0.52 * 0.2 + 0.45, tint: 0x8a6a40 }); }
    banner(b, -0.4, 0.8, 0.2, 0.35);
    return b.build();
  },
  guardhouse(nat) {
    const b = new MB();
    b.box(0.72, 0.1, 0.72, MAT.fieldstone, { uvs: 1.5 });
    b.box(0.62, 0.9, 0.62, MAT.stone, { y: 0.1, uvs: 1.6 });
    b.box(0.7, 0.06, 0.7, MAT.stone, { y: 1.0, uvs: 1.6 }); crenel(b, 0.7, 0.7, 1.06);
    door(b, 0, 0.32, 0.18, 0.28); win(b, 0, 0.7, 0.32, 0.1); win(b, 0.32, 0.7, 0, 0.1, Math.PI / 2);
    banner(b, 0, 1.1, 0, 0.45);
    return b.build();
  },
  watchtower(nat) {
    const b = new MB();
    b.box(1.0, 0.1, 0.9, MAT.fieldstone, { uvs: 1.4 });
    b.box(0.9, 0.5, 0.8, MAT.stone, { y: 0.1, uvs: 1.5 });
    crenel(b, 0.9, 0.8, 0.6);
    tower(b, nat, { r: 0.3, h: 1.6, x: 0.05, z: -0.1, roofH: 0.55 });
    door(b, -0.15, 0.415, 0.2, 0.3);
    banner(b, 0.05, 2.1, -0.1, 0.45);
    return b.build();
  },
  fortress(nat) {
    const b = new MB();
    b.box(1.9, 0.12, 1.7, MAT.fieldstone, { x: -0.35, z: -0.3, uvs: 1.2 });
    b.box(1.7, 0.7, 1.5, MAT.stone, { x: -0.35, y: 0.1, z: -0.3, uvs: 1.4 }); crenel(b, 1.7, 1.5, 0.8, MAT.stone, -0.35, -0.3);
    b.box(0.8, 1.2, 0.7, MAT.stone, { x: -0.45, y: 0.8, z: -0.45, uvs: 1.4 });
    crenel(b, 0.8, 0.7, 2.0, MAT.stone, -0.45, -0.45);
    for (const [x, z] of [[-1.15, 0.4], [0.45, 0.4], [-1.15, -1.0], [0.45, -1.0]]) tower(b, nat, { r: 0.24, h: 1.2, x, z, cren: true });
    b.box(0.36, 0.46, 0.05, MAT.door, { x: -0.2, y: 0.1, z: 0.46, uvsx: 1 / 0.36, uvsy: 1 / 0.46 });
    banner(b, -0.45, 2.1, -0.45, 0.5); banner(b, 0.45, 1.3, 0.4, 0.3);
    return b.build();
  },
  sawmill(nat) {
    const b = new MB(); house(b, nat, { w: 0.8, d: 0.62, h: 0.5, rh: 0.36, x: -0.12, roof: MAT.shingle });
    for (const [x, z] of [[0.35, 0.35], [0.75, 0.35], [0.35, -0.2], [0.75, -0.2]]) b.box(0.04, 0.46, 0.04, MAT.timber, { x, z, tint: 0x8a6a40 });
    b.box(0.5, 0.03, 0.66, MAT.planks, { x: 0.55, y: 0.46, z: 0.08, rz: -0.12, tint: 0xa88050, uvs: 3 });
    b.box(0.34, 0.08, 0.12, MAT.planks, { x: 0.55, y: 0.18, z: 0.1, tint: 0xa88050, uvs: 3 });
    b.cyl(0.1, 0.1, 0.01, 14, MAT.metal, { x: 0.55, y: 0.26, z: 0.1, rx: Math.PI / 2, tint: 0xdddddd });
    logPile(b, 0.6, 0.55, 3, 0);
    return b.build();
  },
  mill(nat) {
    const b = new MB(), N = W(nat);
    b.cyl(0.3, 0.38, 1.1, 12, MAT.plaster, { tint: N.wall, uvs: 1.4 });
    b.cyl(0.39, 0.39, 0.12, 12, MAT.fieldstone, { uvs: 2 });
    b.cone(0.38, 0.45, 12, MAT.thatch, { y: 1.1, tint: 0xe0c080 });
    door(b, 0, 0.36, 0.18, 0.3); win(b, 0, 0.75, 0.33, 0.1);
    b.cyl(0.03, 0.03, 0.2, 6, MAT.timber, { y: 1.15, z: 0.35, rx: Math.PI / 2, tint: 0x5a3a1a });
    return b.build();
  },
  bakery(nat) { const b = new MB(); house(b, nat, { w: 0.8, d: 0.62, h: 0.5, rh: 0.36, chimney: true }); b.sphere(0.2, MAT.brick, { x: 0.52, z: 0.12, half: true, uvs: 3 }); b.box(0.08, 0.08, 0.02, MAT.white, { x: 0.52, y: 0.05, z: 0.32, tint: 0xff8a2a, emit: 1 }); return b.build(); },
  brewery(nat) { const b = new MB(); house(b, nat, { w: 0.82, d: 0.62, h: 0.5, rh: 0.38, chimney: true, roof: MAT.shingle }); barrel(b, 0.5, 0.35); barrel(b, 0.62, 0.2); barrel(b, 0.56, 0.28, 0.16); return b.build(); },
  slaughterhouse(nat) { const b = new MB(); house(b, nat, { w: 0.8, d: 0.6, h: 0.48, rh: 0.34, wall: MAT.brick }); b.box(0.5, 0.02, 0.3, MAT.cloth, { x: 0, y: 0.52, z: 0.44, rx: 0.35, tint: 0xa83a2a, uvs: 4 }); fence(b, [[0.45, 0.4], [0.75, 0.4], [0.75, -0.1]]); return b.build(); },
  smelter(nat) {
    const b = new MB(); house(b, nat, { w: 0.78, d: 0.6, h: 0.5, rh: 0.3, wall: MAT.fieldstone, roof: MAT.shingle, windows: false });
    b.box(0.26, 1.2, 0.26, MAT.brick, { x: 0.25, z: -0.1, uvs: 3 });
    b.box(0.16, 0.14, 0.03, MAT.white, { x: -0.22, y: 0.14, z: 0.315, tint: 0xff6a18, emit: 1.5 });
    b.cyl(0.14, 0.18, 0.3, 8, MAT.brick, { x: 0.55, z: 0.3, uvs: 3 }); b.cyl(0.1, 0.1, 0.02, 8, MAT.white, { x: 0.55, y: 0.3, z: 0.3, tint: 0xff7a20, emit: 2 });
    return b.build();
  },
  metalworks(nat) {
    const b = new MB(); house(b, nat, { w: 0.8, d: 0.62, h: 0.5, rh: 0.36, chimney: true, roof: MAT.shingle });
    b.box(0.16, 0.1, 0.08, MAT.metal, { x: 0.5, y: 0.1, z: 0.4, tint: 0x555a60 }); b.box(0.08, 0.1, 0.06, MAT.timber, { x: 0.5, z: 0.4, tint: 0x6a4a2a });
    b.box(0.1, 0.06, 0.02, MAT.white, { x: 0.2, y: 0.2, z: 0.32, tint: 0xff7a20, emit: 1 });
    return b.build();
  },
  armory(nat) {
    const b = new MB(); house(b, nat, { w: 0.82, d: 0.62, h: 0.52, rh: 0.36, wall: MAT.stone, chimney: true });
    b.box(0.3, 0.3, 0.03, MAT.timber, { x: 0.55, y: 0.05, z: 0.3, ry: 1.2, tint: 0x6a4a2a });
    for (let i = 0; i < 3; i++) b.box(0.02, 0.26, 0.01, MAT.metal, { x: 0.53 + i * 0.03, y: 0.08, z: 0.22 + i * 0.07, ry: 1.2, tint: 0xdddddd });
    b.cyl(0.1, 0.1, 0.02, 10, MAT.cloth, { x: 0.62, y: 0.22, z: 0.4, rx: Math.PI / 2, ry: 1.2, team: 1 });
    return b.build();
  },
  mint(nat) {
    const b = new MB(); house(b, nat, { w: 0.8, d: 0.62, h: 0.52, rh: 0.36, wall: MAT.stone, roof: MAT.roof });
    b.sphere(0.13, MAT.metal, { y: 0.98, half: true, tint: 0xf2c84a }); b.cyl(0.02, 0.02, 0.16, 6, MAT.metal, { y: 1.1, tint: 0xf2c84a });
    b.box(0.2, 0.06, 0.2, MAT.metal, { x: 0.52, z: 0.35, tint: 0xd8b040 });
    return b.build();
  },
  farm(nat) {
    const b = new MB();
    house(b, nat, { w: 0.9, d: 0.66, h: 0.5, rh: 0.4, x: -0.1, z: 0.1, roof: MAT.thatch });
    house(b, nat, { w: 1.0, d: 0.6, h: 0.55, rh: 0.42, x: -0.75, z: -0.7, ry: 0.2, roof: MAT.thatch, wall: MAT.planks, windows: false });
    fence(b, [[0.45, 0.5], [0.45, -0.3], [-0.2, -0.75]]);
    b.box(0.2, 0.14, 0.12, MAT.thatch, { x: 0.3, z: -0.35, tint: 0xf0d080 });
    return b.build();
  },
  pigfarm(nat) {
    const b = new MB();
    house(b, nat, { w: 0.9, d: 0.62, h: 0.48, rh: 0.36, x: -0.55, z: -0.6, roof: MAT.shingle, wall: MAT.planks });
    b.box(1.0, 0.01, 0.7, MAT.soil, { x: 0.05, z: 0.05, tint: 0x8a6a4a, uvs: 2 });
    fence(b, [[-0.45, 0.4], [0.55, 0.4], [0.55, -0.3], [-0.2, -0.3]]);
    for (const [x, z, r] of [[-0.1, 0.1, 0.4], [0.25, 0.2, 2.2], [0.1, -0.1, 1.0]]) { b.sphere(0.07, MAT.white, { x, y: 0.07, z, sx: 1.4, tint: 0xf2b4b8 }); b.sphere(0.04, MAT.white, { x: x + 0.1 * Math.cos(r), y: 0.08, z: z + 0.1 * Math.sin(r), tint: 0xf2b4b8 }); }
    return b.build();
  },
  donkeybreeder(nat) {
    const b = new MB();
    house(b, nat, { w: 1.1, d: 0.6, h: 0.5, rh: 0.38, x: -0.5, z: -0.6, roof: MAT.thatch, wall: MAT.timber });
    fence(b, [[-0.45, 0.45], [0.55, 0.45], [0.55, -0.35], [0.0, -0.35]]);
    b.box(0.3, 0.12, 0.1, MAT.thatch, { x: 0.3, z: 0.1, tint: 0xf0d080 });
    return b.build();
  },
  mine(nat, ore = 0x333333) {
    const b = new MB();
    b.sphere(0.62, MAT.rock, { y: -0.1, z: -0.25, sy: 0.8, half: true, uvs: 1.2, seg: 12, seg2: 6 });
    b.box(0.34, 0.36, 0.06, MAT.white, { z: 0.3, tint: 0x0a0806 });
    for (const x of [-0.19, 0.19]) b.box(0.06, 0.42, 0.06, MAT.timber, { x, z: 0.33, tint: 0x6a4a2a });
    b.box(0.5, 0.06, 0.08, MAT.timber, { y: 0.42, z: 0.33, tint: 0x6a4a2a });
    b.gable(0.56, 0.3, 0.14, MAT.shingle, { y: 0.46, z: 0.36, tint: 0xa07050 });
    b.box(0.22, 0.1, 0.14, MAT.planks, { x: 0.42, y: 0.04, z: 0.45, tint: 0x7a5530, uvs: 4 });
    b.sphere(0.1, MAT.rock, { x: 0.42, y: 0.12, z: 0.45, sy: 0.5, tint: ore });
    for (const x of [0.34, 0.5]) b.cyl(0.035, 0.035, 0.02, 8, MAT.timber, { x, y: 0.03, z: 0.53, rx: Math.PI / 2, tint: 0x3a2a1a });
    return b.build();
  },
  catapult(nat) {
    const b = new MB();
    house(b, nat, { w: 0.6, d: 0.5, h: 0.38, rh: 0.28, x: -0.3, z: -0.3, roof: MAT.shingle, wall: MAT.planks });
    b.box(0.5, 0.08, 0.34, MAT.planks, { x: 0.3, y: 0.06, z: 0.25, tint: 0x8a6036, uvs: 3 });
    for (const [x, z] of [[0.1, 0.1], [0.5, 0.1], [0.1, 0.4], [0.5, 0.4]]) b.cyl(0.06, 0.06, 0.03, 10, MAT.timber, { x, y: 0.06, z, rx: Math.PI / 2, rz: Math.PI / 2, tint: 0x4a3420 });
    for (const z of [0.15, 0.35]) b.box(0.05, 0.3, 0.05, MAT.timber, { x: 0.3, y: 0.12, z, tint: 0x6a4a2a });
    b.box(0.6, 0.05, 0.05, MAT.timber, { x: 0.35, y: 0.38, z: 0.25, rz: 0.5, tint: 0x7a5a38 });
    b.sphere(0.07, MAT.white, { x: 0.58, y: 0.55, z: 0.25, tint: 0x6a4a2a, half: true });
    return b.build();
  },
};
DESIGNS.coalmine = (n) => DESIGNS.mine(n, 0x1a1a1a);
DESIGNS.ironmine = (n) => DESIGNS.mine(n, 0x8a5038);
DESIGNS.goldmine = (n) => DESIGNS.mine(n, 0xe8c040);
DESIGNS.granitemine = (n) => DESIGNS.mine(n, 0xbdbdb5);

const geoCache = new Map();
export function buildingGeometry(type, nation) {
  const key = type + ':' + nation;
  if (!geoCache.has(key)) {
    const g = (DESIGNS[type] || DESIGNS.woodcutter)(nation);
    g.userData.height = g.boundingBox.max.y + 0.01;
    geoCache.set(key, g);
  }
  return geoCache.get(key);
}

// windmill sails (animated separately)
export function sailsGeometry() {
  const b = new MB();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    b.box(0.03, 0.62, 0.02, MAT.timber, { rz: a, x: -Math.sin(a) * 0.0, tint: 0x6a4a2a, y: -0.31 });
    const p = b.parts[b.parts.length - 1]; p.translate(0, 0, 0);
    const s = new MB(); s.box(0.12, 0.46, 0.005, MAT.cloth, { x: 0.07, y: 0.12, tint: 0xeee6d6, uvs: 3 });
    for (const q of s.parts) { q.rotateZ(a); b.parts.push(q); }
    // rotate the spar around the hub
    p.rotateZ(0);
  }
  const g = b.build();
  return g;
}

// scaffolding around construction sites, by size
export function scaffoldGeometry(size) {
  const b = new MB();
  const s = size === 'large' ? 1.6 : size === 'medium' ? 1.0 : size === 'mine' ? 0.7 : 0.8;
  const h = size === 'large' ? 1.3 : 0.9;
  const ox = size === 'large' ? -0.35 : 0, oz = size === 'large' ? -0.3 : 0;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.035, h, 0.035, MAT.timber, { x: ox + x * s / 2, z: oz + z * s / 2, tint: 0xa88050 });
  for (const y of [0.35, 0.75]) { b.box(s, 0.03, 0.12, MAT.planks, { x: ox, y, z: oz + s / 2, tint: 0xc09060, uvs: 4 }); b.box(0.12, 0.03, s, MAT.planks, { x: ox + s / 2, y, z: oz, tint: 0xc09060, uvs: 4 }); }
  b.box(s + 0.1, 0.03, s + 0.1, MAT.soil, { x: ox, z: oz, tint: 0x9a7a5a, uvs: 2 });
  return b.build();
}
export function materialStackGeometry(kind) {
  const b = new MB();
  if (kind === 'boards') for (let i = 0; i < 3; i++) b.box(0.3, 0.025, 0.07, MAT.planks, { y: i * 0.027, z: (i % 2) * 0.01, tint: 0xd8a868, uvs: 4 });
  else for (let i = 0; i < 3; i++) b.box(0.1, 0.07, 0.1, MAT.stone, { x: (i - 1) * 0.1, ry: i, uvs: 6 });
  return b.build();
}

// ------------------------------------------------------------------ vertex-coloured nature
function colorize(geo, fn) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, n = p.count, c = new Float32Array(n * 3), wind = new Float32Array(n);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) { fn(col, p.getX(i), p.getY(i), p.getZ(i), i); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'wind'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
function jitter(geo, amt, seed) {
  const p = geo.attributes.position; let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, [rnd() * amt, rnd() * amt, rnd() * amt]);
    const d = map.get(k); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}
function mergeNature(parts) {
  const g = mergeGeometries(parts, false);
  // wind weight = normalised height
  g.computeBoundingBox();
  const p = g.attributes.position, w = g.attributes.wind, top = g.boundingBox.max.y;
  for (let i = 0; i < p.count; i++) w.setX(i, Math.max(0, p.getY(i) / top) ** 1.5);
  g.computeBoundingSphere();
  return g;
}
function trunk(h, r, col, seg = 6) { const g = new THREE.CylinderGeometry(r * 0.7, r, h, seg); g.translate(0, h / 2, 0); return colorize(g, (c, x, y) => c.set(col).multiplyScalar(0.75 + 0.25 * y / h)); }
function blob(r, x, y, z, col, seed, detail = 1) {
  let g = new THREE.IcosahedronGeometry(r, detail); g = jitter(g.toNonIndexed(), r * 0.35, seed); g.translate(x, y, z);
  const base = new THREE.Color(col);
  return colorize(g, (c, px, py, pz) => { const k = 0.65 + 0.45 * (py - y + r) / (2 * r); c.copy(base).multiplyScalar(k); });
}

export function treeGeometry(species) {
  const parts = [];
  switch (species) {
    case 'pine': {
      parts.push(trunk(0.5, 0.05, 0x5a3a22));
      for (let i = 0; i < 4; i++) { let g = new THREE.ConeGeometry(0.34 - i * 0.07, 0.42, 8); g = jitter(g.toNonIndexed(), 0.03, 11 + i); g.translate(0, 0.42 + i * 0.22, 0); parts.push(colorize(g, (c, x, y) => c.set(0x1f4a26).multiplyScalar(0.7 + 0.5 * ((y - 0.2) / 1.2)))); }
      break;
    }
    case 'fir': {
      parts.push(trunk(0.4, 0.05, 0x4a3020));
      for (let i = 0; i < 5; i++) { let g = new THREE.ConeGeometry(0.3 - i * 0.05, 0.36, 7); g = jitter(g.toNonIndexed(), 0.025, 21 + i); g.translate(0, 0.35 + i * 0.2, 0); parts.push(colorize(g, (c, x, y) => c.set(0x2a4f36).multiplyScalar(0.7 + 0.4 * (y / 1.3)))); }
      break;
    }
    case 'birch': {
      parts.push(colorize(new THREE.CylinderGeometry(0.03, 0.045, 0.9, 6).translate(0, 0.45, 0), (c, x, y) => c.set((Math.floor(y * 14) % 3 === 0) ? 0x2a2a2a : 0xe8e4da)));
      parts.push(blob(0.2, 0.02, 0.85, 0.02, 0x7ab040, 3), blob(0.16, -0.1, 0.72, 0.06, 0x88bc48, 4), blob(0.15, 0.1, 0.68, -0.08, 0x6fa438, 5), blob(0.13, 0, 1.02, 0, 0x90c450, 6));
      break;
    }
    case 'palm': {
      for (let i = 0; i < 5; i++) { const g = new THREE.CylinderGeometry(0.035, 0.045, 0.2, 6); g.translate(i * 0.025, 0.1 + i * 0.19, 0); parts.push(colorize(g, (c) => c.set(i % 2 ? 0x8a6a42 : 0x6e5234))); }
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; let g = new THREE.ConeGeometry(0.06, 0.55, 4); g.scale(1, 1, 0.25); g.rotateZ(Math.PI / 2 + 0.5); g.rotateY(a); g.translate(0.12 + Math.cos(a) * 0.22, 0.95, -Math.sin(a) * 0.22); parts.push(colorize(g.toNonIndexed(), (c) => c.set(0x4a8a2a))); }
      break;
    }
    case 'dead': {
      parts.push(trunk(0.7, 0.05, 0x4a3a2a));
      for (let i = 0; i < 4; i++) { const g = new THREE.CylinderGeometry(0.01, 0.025, 0.35, 4); g.translate(0, 0.17, 0); g.rotateZ(0.7 * (i % 2 ? 1 : -1)); g.rotateY(i * 1.6); g.translate(0, 0.4 + i * 0.08, 0); parts.push(colorize(g.toNonIndexed(), (c) => c.set(0x4a3a2a))); }
      break;
    }
    case 'beech': {
      parts.push(trunk(0.45, 0.06, 0x6a5540));
      parts.push(blob(0.3, 0, 0.72, 0, 0x3f7a2a, 7), blob(0.22, 0.18, 0.6, 0.1, 0x4a8a30, 8), blob(0.22, -0.18, 0.62, -0.06, 0x3a7026, 9), blob(0.2, 0.02, 0.95, 0.04, 0x55942f, 10));
      break;
    }
    default: { // oak
      parts.push(trunk(0.42, 0.07, 0x5b4128));
      parts.push(blob(0.32, 0, 0.7, 0, 0x3c6e22, 12), blob(0.24, 0.22, 0.58, 0.05, 0x467a26, 13), blob(0.24, -0.2, 0.6, -0.1, 0x35651e, 14), blob(0.22, 0.05, 0.62, 0.24, 0x4a7f2a, 15), blob(0.2, 0, 0.98, 0, 0x528a30, 16));
    }
  }
  return mergeNature(parts);
}

export function rockGeometry(seed = 1) {
  let g = new THREE.IcosahedronGeometry(0.14, 1);
  g = jitter(g.toNonIndexed(), 0.06, seed * 7 + 3); g.scale(1.2, 0.8, 1); g.translate(0, 0.07, 0);
  return mergeNature([colorize(g, (c, x, y) => { const v = 0.3 + y * 0.75 + ((x * 37.1 + y * 11.3) % 1) * 0.04; c.setRGB(v * 0.92, v * 0.89, v * 0.84); })]);
}
export function bushGeometry() { return mergeNature([blob(0.14, 0, 0.1, 0, 0x3a6a24, 31), blob(0.11, 0.1, 0.08, 0.05, 0x44782a, 32), blob(0.1, -0.08, 0.07, -0.04, 0x32601f, 33)]); }
export function mushroomGeometry() {
  const s = colorize(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 5).translate(0, 0.025, 0), (c) => c.set(0xeee6d0));
  const cap = colorize(new THREE.SphereGeometry(0.03, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.045, 0), (c) => c.set(0xc0302a));
  return mergeNature([s, cap]);
}
// crossed quads for grass / flowers / wheat
export function cardGeometry(w = 0.34, h = 0.22, n = 3) {
  const parts = [];
  for (let i = 0; i < n; i++) for (const back of [0, 1]) {
    const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); if (back) g.rotateY(Math.PI); g.rotateY(i * Math.PI / n); parts.push(g);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false);
  const p = g.attributes.position, wind = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) wind[i] = p.getY(i) / h;
  g.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
  // up-facing normals so cards light like the ground
  const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

// ------------------------------------------------------------------ figures
// body parts are separate geometries so an InstancedMesh per part can be animated with matrices.
export function figureParts() {
  const P = {};
  const mk = (g, col) => colorize(g, (c) => c.set(col));
  P.torso = mk(new THREE.CylinderGeometry(0.055, 0.07, 0.15, 7).translate(0, 0.075, 0), 0xffffff);   // tinted per job
  P.head = mk(new THREE.SphereGeometry(0.045, 8, 6), 0xe0b08a);
  P.leg = mk(new THREE.CylinderGeometry(0.022, 0.02, 0.13, 5).translate(0, -0.065, 0), 0xffffff);     // pivot at hip
  P.arm = mk(new THREE.CylinderGeometry(0.018, 0.016, 0.12, 5).translate(0, -0.06, 0), 0xffffff);     // pivot at shoulder
  P.hat = mk(new THREE.CylinderGeometry(0.03, 0.055, 0.05, 8).translate(0, 0.025, 0), 0xffffff);
  P.helmet = mk(new THREE.SphereGeometry(0.052, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xb8c0c8);
  P.plume = mk(new THREE.BoxGeometry(0.012, 0.05, 0.06).translate(0, 0.07, 0), 0xffffff);
  P.shield = mk(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 10).rotateZ(Math.PI / 2), 0xffffff);
  P.sword = mk(new THREE.BoxGeometry(0.012, 0.14, 0.006).translate(0, -0.08, 0), 0xdde2e8);
  P.axe = mergeGeometries([mk(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4).translate(0, -0.06, 0), 0x7a5230), mk(new THREE.BoxGeometry(0.01, 0.04, 0.05).translate(0, -0.13, 0.025), 0xcfd4d8)]);
  P.hammer = mergeGeometries([mk(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 4).translate(0, -0.05, 0), 0x7a5230), mk(new THREE.BoxGeometry(0.05, 0.025, 0.025).translate(0, -0.11, 0), 0x777c82)]);
  P.pick = mergeGeometries([mk(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4).translate(0, -0.06, 0), 0x7a5230), mk(new THREE.BoxGeometry(0.1, 0.014, 0.014).translate(0, -0.13, 0), 0x777c82)]);
  P.rod = mk(new THREE.CylinderGeometry(0.004, 0.007, 0.4, 4).translate(0, -0.1, 0).rotateX(0.9), 0x9a7a40);
  P.scythe = mergeGeometries([mk(new THREE.CylinderGeometry(0.007, 0.007, 0.28, 4).translate(0, -0.1, 0), 0x7a5230), mk(new THREE.BoxGeometry(0.12, 0.012, 0.01).translate(0.05, -0.23, 0), 0xcfd4d8)]);
  P.shovel = mergeGeometries([mk(new THREE.CylinderGeometry(0.007, 0.007, 0.22, 4).translate(0, -0.08, 0), 0x7a5230), mk(new THREE.BoxGeometry(0.04, 0.05, 0.008).translate(0, -0.2, 0), 0x777c82)]);
  P.bow = mk(new THREE.TorusGeometry(0.08, 0.006, 4, 10, Math.PI).rotateZ(Math.PI / 2).translate(0, -0.06, 0), 0x6a4020);
  P.donkeyBody = mergeGeometries([mk(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 7).rotateX(Math.PI / 2).translate(0, 0.15, 0), 0x8a7a68), mk(new THREE.BoxGeometry(0.05, 0.1, 0.05).translate(0, 0.22, 0.11).rotateX(-0.4), 0x8a7a68), mk(new THREE.BoxGeometry(0.045, 0.045, 0.1).translate(0, 0.3, 0.16), 0x7a6a58), mk(new THREE.BoxGeometry(0.012, 0.06, 0.02).translate(0.018, 0.35, 0.13), 0x6a5a48), mk(new THREE.BoxGeometry(0.012, 0.06, 0.02).translate(-0.018, 0.35, 0.13), 0x6a5a48), mk(new THREE.BoxGeometry(0.1, 0.06, 0.12).translate(0, 0.21, -0.01), 0x6a4a2a)]);
  P.animalLeg = mk(new THREE.CylinderGeometry(0.012, 0.01, 0.11, 4).translate(0, -0.055, 0), 0xffffff);
  P.deer = mergeGeometries([mk(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 7).rotateX(Math.PI / 2).translate(0, 0.15, 0), 0xb07a48), mk(new THREE.BoxGeometry(0.035, 0.1, 0.04).translate(0, 0.22, 0.1).rotateX(-0.3), 0xb07a48), mk(new THREE.BoxGeometry(0.04, 0.04, 0.08).translate(0, 0.28, 0.15), 0xa06a3a), mk(new THREE.BoxGeometry(0.01, 0.08, 0.01).translate(0.02, 0.34, 0.13).rotateZ(-0.3), 0xd8c8a8), mk(new THREE.BoxGeometry(0.01, 0.08, 0.01).translate(-0.02, 0.34, 0.13).rotateZ(0.3), 0xd8c8a8), mk(new THREE.SphereGeometry(0.02, 5, 4).translate(0, 0.17, -0.11), 0xf0e8d8)]);
  P.rabbit = mergeGeometries([mk(new THREE.SphereGeometry(0.04, 7, 5).scale(1, 0.9, 1.3).translate(0, 0.05, 0), 0x9a8a78), mk(new THREE.SphereGeometry(0.025, 6, 5).translate(0, 0.08, 0.05), 0x9a8a78), mk(new THREE.BoxGeometry(0.01, 0.05, 0.015).translate(0.01, 0.12, 0.045), 0x8a7a68), mk(new THREE.BoxGeometry(0.01, 0.05, 0.015).translate(-0.01, 0.12, 0.045), 0x8a7a68), mk(new THREE.SphereGeometry(0.015, 5, 4).translate(0, 0.05, -0.05), 0xffffff)]);
  P.fox = mergeGeometries([mk(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6).rotateX(Math.PI / 2).translate(0, 0.08, 0), 0xc86a28), mk(new THREE.ConeGeometry(0.03, 0.08, 5).rotateX(Math.PI / 2).translate(0, 0.1, 0.12), 0xc86a28), mk(new THREE.ConeGeometry(0.025, 0.14, 5).rotateX(-Math.PI / 2 - 0.3).translate(0, 0.09, -0.14), 0xd87a38)]);
  P.duck = mergeGeometries([mk(new THREE.SphereGeometry(0.04, 7, 5).scale(1, 0.7, 1.4).translate(0, 0.02, 0), 0x8a7a5a), mk(new THREE.SphereGeometry(0.022, 6, 5).translate(0, 0.06, 0.05), 0x2a6a3a), mk(new THREE.BoxGeometry(0.015, 0.008, 0.025).translate(0, 0.055, 0.075), 0xe8a020)]);
  P.pig = mergeGeometries([mk(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.8, 1.4).translate(0, 0.07, 0), 0xf2b4b8), mk(new THREE.SphereGeometry(0.035, 6, 5).translate(0, 0.08, 0.08), 0xf2b4b8)]);
  return P;
}

// A tree falling (a single mesh reused for chop animations)
export { MB };
