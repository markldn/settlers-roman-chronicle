// Terrain rendering.
//  * The sim's triangle grid is resampled onto a fine world-aligned grid (4 samples / node) and
//    lightly blurred -> smooth hills; every height query in the renderer goes through heightAt().
//  * Terrain types become per-vertex splat weights; a GLSL shader bakes a large procedural colour
//    texture once on the GPU (grass blades, rock strata, sand ripples...) with noisy transitions.
//  * Runtime material = MeshStandardMaterial(baked map + tiled detail normal) patched for
//    fog-of-war and drifting cloud shadows. Water is a custom shader reading a height texture.
import * as THREE from 'three';
import { ROW_H, HEIGHT_SCALE } from '../sim/grid.js';
import { SEA } from '../sim/mapgen.js';
import { TERRAIN as T } from '../sim/data.js';

export const RES = 4; // fine samples per world unit
export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*vnoise(p); p = mat2(1.6,1.2,-1.2,1.6)*p; a *= .5; } return s; }
float fbm3(vec2 p){ float s = 0., a = .5; for(int i=0;i<3;i++){ s += a*vnoise(p); p = mat2(1.6,1.2,-1.2,1.6)*p; a *= .5; } return s; }
vec2 voronoi(vec2 x){ vec2 n = floor(x), f = fract(x); float md = 8., md2 = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g = vec2(float(i),float(j)); vec2 o = hash22(n+g); vec2 r = g + o - f; float d = dot(r,r);
    if(d < md){ md2 = md; md = d; } else if(d < md2) md2 = d; }
  return vec2(sqrt(md), sqrt(md2) - sqrt(md)); }
`;

export class Terrain {
  constructor(renderer, game, theme = 'greenland') {
    this.renderer = renderer; this.game = game; this.theme = theme;
    const g = game.grid, m = game.map;
    this.W = g.w; this.H = g.h;
    this.x0 = -3; this.z0 = -3;
    this.x1 = g.w + 2.5; this.z1 = (g.h - 1) * ROW_H + 3;
    this.nx = Math.ceil((this.x1 - this.x0) * RES) + 1;
    this.nz = Math.ceil((this.z1 - this.z0) * RES) + 1;
    this.seaY = SEA * HEIGHT_SCALE;
    this.buildHeights();
    this.buildMesh();
    this.bake();
    this.buildMaterial();
    this.buildWater();
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.water, this.seabed);
  }

  // barycentric sample of a per-node field at world (wx, wz) using the sim's triangle layout
  sampleNodes(wx, wz, fn) {
    const g = this.game.grid, W = g.w, H = g.h;
    let fy = wz / ROW_H;
    fy = Math.max(0, Math.min(H - 1.0001, fy));
    const y0 = Math.floor(fy), t = fy - y0, y1 = y0 + 1;
    const odd = y0 & 1;
    let u = odd ? wx - 0.5 + 0.5 * t : wx - 0.5 * t;
    u = Math.max(0, Math.min(W - 1.0001, u));
    const x = Math.floor(u), fu = u - x;
    const i00 = y0 * W + x, i10 = i00 + 1, i01 = y1 * W + x, i11 = i01 + 1;
    if (!odd) {
      if (fu + t <= 1) return [[i00, 1 - fu - t], [i10, fu], [i01, t]];
      return [[i11, fu + t - 1], [i10, 1 - t], [i01, 1 - fu]];
    }
    if (fu >= t) return [[i00, 1 - fu], [i10, fu - t], [i11, t]];
    return [[i00, 1 - t], [i11, fu], [i01, t - fu]];
  }

  buildHeights() {
    const m = this.game.map, nx = this.nx, nz = this.nz, HS = HEIGHT_SCALE;
    const h = new Float32Array(nx * nz);
    const W = this.game.grid.w, Wz = (this.game.grid.h - 1) * ROW_H;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const wx = this.x0 + i / RES, wz = this.z0 + j / RES;
      let v = 0; for (const [n, w] of this.sampleNodes(wx, wz)) v += m.height[n] * w;
      // outside the map sink smoothly into the sea
      const out = Math.max(0, -wx, wx - (W - 0.5), -wz, wz - Wz);
      v = v - out * 2.2;
      h[j * nx + i] = v * HS;
    }
    // two passes of a 3x3 binomial blur -> rounded hills
    const tmp = new Float32Array(h.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        let s = 0, ws = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(nz - 1, Math.max(0, j + dj));
          const w = (di ? 1 : 2) * (dj ? 1 : 2); s += h[jj * nx + ii] * w; ws += w;
        }
        tmp[j * nx + i] = s / ws;
      }
      h.set(tmp);
    }
    this.h = h;
  }

  heightAt(wx, wz) {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (wx - this.x0) * RES)), fz = Math.max(0, Math.min(this.nz - 1.001, (wz - this.z0) * RES));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, nx = this.nx, h = this.h;
    const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  nodeY(n) { const g = this.game.grid; return this.heightAt(g.wx(n), g.wz(n)); }
  normalAt(wx, wz, out = new THREE.Vector3()) {
    const e = 0.25;
    out.set(this.heightAt(wx - e, wz) - this.heightAt(wx + e, wz), 2 * e, this.heightAt(wx, wz - e) - this.heightAt(wx, wz + e));
    return out.normalize();
  }

  buildMesh() {
    const nx = this.nx, nz = this.nz, m = this.game.map;
    const N = nx * nz;
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), uv1 = new Float32Array(N * 2);
    const s0 = new Float32Array(N * 4), s1 = new Float32Array(N * 4), s2 = new Float32Array(N * 4), extra = new Float32Array(N * 4);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, wx = this.x0 + i / RES, wz = this.z0 + j / RES;
      pos[k * 3] = wx; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = wz;
      uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = 1 - j / (nz - 1);
      uv1[k * 2] = wx * 0.9; uv1[k * 2 + 1] = wz * 0.9;
      const w = new Float32Array(12);
      for (const [n, bw] of this.sampleNodes(wx, wz)) w[m.terrain[n]] += bw;
      s0.set(w.subarray(0, 4), k * 4); s1.set(w.subarray(4, 8), k * 4); s2.set(w.subarray(8, 12), k * 4);
      // slope and concavity for the bake
      const hc = this.h[k];
      const hl = this.h[j * nx + Math.max(0, i - 1)], hr = this.h[j * nx + Math.min(nx - 1, i + 1)];
      const hu = this.h[Math.max(0, j - 1) * nx + i], hd = this.h[Math.min(nz - 1, j + 1) * nx + i];
      const slope = Math.hypot(hr - hl, hd - hu) * RES * 0.5;
      const conc = (hl + hr + hu + hd) / 4 - hc;
      extra[k * 4] = slope; extra[k * 4 + 1] = conc * 6; extra[k * 4 + 2] = hc; extra[k * 4 + 3] = 0;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geo.setAttribute('splat0', new THREE.BufferAttribute(s0, 4));
    geo.setAttribute('splat1', new THREE.BufferAttribute(s1, 4));
    geo.setAttribute('splat2', new THREE.BufferAttribute(s2, 4));
    geo.setAttribute('extra', new THREE.BufferAttribute(extra, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    this.geo = geo;
  }

  bake() {
    const r = this.renderer;
    const maxT = Math.min(8192, r.capabilities.maxTextureSize);
    const want = Math.pow(2, Math.ceil(Math.log2(Math.max(this.x1 - this.x0, this.z1 - this.z0) * 56)));
    const size = Math.min(maxT, want);
    const rt = new THREE.WebGLRenderTarget(size, size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
    rt.texture.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    const themeId = { greenland: 0, winter: 1, wasteland: 2 }[this.theme] ?? 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { theme: { value: themeId }, seaY: { value: this.seaY } },
      vertexShader: /* glsl */`
        attribute vec4 splat0; attribute vec4 splat1; attribute vec4 splat2; attribute vec4 extra;
        varying vec4 vS0; varying vec4 vS1; varying vec4 vS2; varying vec4 vEx; varying vec2 vW;
        void main(){ vS0 = splat0; vS1 = splat1; vS2 = splat2; vEx = extra; vW = position.xz;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform int theme; uniform float seaY;
        varying vec4 vS0; varying vec4 vS1; varying vec4 vS2; varying vec4 vEx; varying vec2 vW;
        ${GLSL_NOISE}
        vec3 grass(vec2 p, vec3 a, vec3 b){
          float n = fbm(p * .35); float d = fbm3(p * 2.3);
          vec3 c = mix(a, b, smoothstep(.3,.7,n));
          // blades: stretched high-frequency noise in two directions
          float bl = vnoise(vec2(p.x * 22., p.y * 5.)) * vnoise(vec2(p.x * 6., p.y * 24.));
          c *= .82 + .36 * bl + .18 * (d - .5);
          float clump = smoothstep(.62,.8, fbm3(p * 1.4 + 7.));
          c = mix(c, c * vec3(.8,.9,.7), clump * .5);
          return c; }
        vec3 rock(vec2 p, float h){
          vec2 v = voronoi(p * 3.1 + fbm3(p * 1.7) * 1.5);
          vec2 v2 = voronoi(p * 7.3);
          float strata = sin(h * 9. + fbm3(p * .6) * 6.) * .5 + .5;
          vec3 c = mix(vec3(.43,.40,.36), vec3(.62,.58,.52), fbm(p * .8));
          c *= .8 + .2 * strata;
          c *= .88 + .14 * smoothstep(.0, .08, v.y) + .06 * (v.x - .5);   // cracks
          c *= .94 + .08 * smoothstep(.0, .06, v2.y);
          c = mix(c, c * vec3(.9,.95,.8), smoothstep(.55,.75, fbm3(p*3.)) * .4);
          return c; }
        vec3 snow(vec2 p){ float n = fbm(p * .7); vec3 c = mix(vec3(.84,.88,.95), vec3(.98,.99,1.), n); c *= .93 + .07 * vnoise(p * 30.); return c; }
        vec3 sand(vec2 p, vec3 a){ float rip = sin(p.x * 3. + p.y * 1.3 + fbm3(p * .7) * 7.) * .5 + .5; vec3 c = a * (.9 + .12 * rip); c *= .92 + .14 * vnoise(p * 40.);
          float peb = step(.93, vnoise(p * 18.)); c = mix(c, c * .6, peb * .6); return c; }
        vec3 swamp(vec2 p){ vec3 c = mix(vec3(.24,.28,.14), vec3(.32,.30,.16), fbm(p * .6));
          float pud = smoothstep(.56,.6, fbm(p * .9 + 3.)); c = mix(c, vec3(.13,.18,.16), pud); c *= .85 + .3 * vnoise(p*14.); return c; }
        vec3 seabed(vec2 p){ return mix(vec3(.55,.5,.36), vec3(.34,.38,.28), fbm(p * .5)) * (.85 + .2 * vnoise(p * 12.)); }
        void main(){
          vec2 p = vW;
          float w[12];
          w[0]=vS0.x; w[1]=vS0.y; w[2]=vS0.z; w[3]=vS0.w; w[4]=vS1.x; w[5]=vS1.y; w[6]=vS1.z; w[7]=vS1.w; w[8]=vS2.x; w[9]=vS2.y; w[10]=vS2.z; w[11]=vS2.w;
          // organic transitions: perturb each weight with its own noise, then sharpen
          float sum = 0.;
          for (int i = 0; i < 10; i++) { float n = fbm3(p * 1.1 + float(i) * 17.3); w[i] = pow(max(w[i] + (n - .5) * .55 * w[i] * (1. - w[i]) * 4., 0.), 3.); sum += w[i]; }
          sum = max(sum, 1e-4);
          vec3 meadowA = vec3(.29,.46,.13), meadowB = vec3(.40,.55,.17);
          vec3 steppeA = vec3(.55,.52,.26), steppeB = vec3(.63,.58,.30);
          vec3 mmA = vec3(.26,.38,.14), mmB = vec3(.34,.42,.18);
          if (theme == 1) { meadowA = vec3(.72,.78,.80); meadowB = vec3(.86,.9,.93); steppeA = vec3(.62,.64,.6); steppeB = vec3(.74,.76,.72); mmA = vec3(.6,.66,.68); mmB = vec3(.75,.8,.82); }
          if (theme == 2) { meadowA = vec3(.45,.40,.22); meadowB = vec3(.55,.48,.26); steppeA = vec3(.58,.44,.26); steppeB = vec3(.66,.5,.3); mmA = vec3(.4,.36,.24); mmB = vec3(.48,.42,.28); }
          vec3 c = vec3(0);
          c += w[0] * seabed(p);
          c += w[1] * grass(p, meadowA, meadowB);
          vec3 fl = grass(p, meadowA * 1.05, meadowB);
          float fdot = step(.86, vnoise(p * 9.)) * step(.5, vnoise(p * 2.3));
          fl = mix(fl, mix(vec3(.95,.9,.35), vec3(.9,.45,.7), vnoise(p * 3.)), fdot * .8);
          c += w[2] * fl;
          c += w[3] * grass(p * 1.2, steppeA, steppeB);
          c += w[4] * mix(grass(p, mmA, mmB), rock(p, vEx.z), smoothstep(.55,.8, fbm3(p * .9)) * .6);
          c += w[5] * rock(p, vEx.z);
          c += w[6] * snow(p);
          c += w[7] * sand(p, theme == 1 ? vec3(.8,.8,.82) : vec3(.78,.64,.40));
          c += w[8] * swamp(p);
          c += w[9] * sand(p * 1.4, vec3(.82,.74,.54));
          c /= sum;
          // steep slopes show rock, valleys darker, crests lighter
          float slope = vEx.x;
          float rk = smoothstep(.55, 1.1, slope) * (1. - w[6] / sum) * (1. - w[0] / sum);
          c = mix(c, rock(p * 1.3, vEx.z) * vec3(1.,.98,.95), rk * .75);
          c *= clamp(1. - vEx.y * .9, .72, 1.12);
          // wet shoreline
          float shore = 1. - smoothstep(0., .35, vEx.z - seaY);
          c = mix(c, c * vec3(.62,.6,.55), shore * .8 * (1. - w[0] / sum));
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.); // linear out; the sRGB target encodes on write
        }`,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.geo, mat); mesh.frustumCulled = false;
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam); r.setRenderTarget(prev);
    mat.dispose();
    this.bakeRT = rt;
  }

  detailNormal() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'), img = c.createImageData(S, S), d = img.data;
    const hgt = new Float32Array(S * S);
    let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const grid = []; for (let i = 0; i < 32 * 32; i++) grid.push(rnd());
    const vn = (x, y, f) => { const X = x * f / S, Y = y * f / S; const xi = Math.floor(X), yi = Math.floor(Y), u = X - xi, v = Y - yi; const G = (a, b) => grid[((b % f + f) % f) * 32 + ((a % f + f) % f)]; const sm = t => t * t * (3 - 2 * t); return G(xi, yi) * (1 - sm(u)) * (1 - sm(v)) + G(xi + 1, yi) * sm(u) * (1 - sm(v)) + G(xi, yi + 1) * (1 - sm(u)) * sm(v) + G(xi + 1, yi + 1) * sm(u) * sm(v); };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = vn(x, y, 8) * 0.5 + vn(x, y, 16) * 0.3 + vn(x, y, 32) * 0.2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const L = (xx, yy) => hgt[((yy + S) % S) * S + ((xx + S) % S)];
      const dx = (L(x + 1, y) - L(x - 1, y)) * 6, dy = (L(x, y + 1) - L(x, y - 1)) * 6, nz = 1 / Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4; d[i] = (-dx * nz * .5 + .5) * 255; d[i + 1] = (dy * nz * .5 + .5) * 255; d[i + 2] = nz * 255; d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.channel = 1; t.anisotropy = 8;
    return t;
  }

  buildMaterial() {
    const g = this.game.grid;
    // fog-of-war texture: 2 texels per node horizontally so the odd-row offset lines up
    this.fogW = g.w * 2; this.fogH = g.h;
    this.fogData = new Uint8Array(this.fogW * this.fogH).fill(255);
    this.fogTex = new THREE.DataTexture(this.fogData, this.fogW, this.fogH, THREE.RedFormat, THREE.UnsignedByteType);
    this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
    this.fogUniforms = {
      fogTex: { value: this.fogTex }, fogScale: { value: new THREE.Vector4(1 / g.w, 1 / (ROW_H * g.h), 0.5 / g.h, 0) },
      uTime: { value: 0 }, cloudAmt: { value: 0.28 },
    };
    const mat = new THREE.MeshStandardMaterial({ map: this.bakeRT.texture, roughness: 0.93, metalness: 0, normalMap: this.detailNormal(), normalScale: new THREE.Vector2(0.55, 0.55) });
    patchFog(mat, this.fogUniforms, true);
    this.material = mat;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
  }

  buildWater() {
    const g = this.game.grid;
    // height texture for water depth (in the same fine grid)
    const data = new Uint16Array(this.nx * this.nz);
    for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(this.h[i]);
    this.hTex = new THREE.DataTexture(data, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    this.hTex.magFilter = this.hTex.minFilter = THREE.LinearFilter; this.hTex.needsUpdate = true;
    const pad = 60;
    const geo = new THREE.PlaneGeometry(this.x1 - this.x0 + pad * 2, this.z1 - this.z0 + pad * 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((this.x0 + this.x1) / 2, this.seaY - 0.05, (this.z0 + this.z1) / 2);
    this.waterUniforms = Object.assign({
      hTex: { value: this.hTex }, hMap: { value: new THREE.Vector4(this.x0, this.z0, RES / this.nx, RES / this.nz) }, hOff: { value: new THREE.Vector2(0.5 / this.nx, 0.5 / this.nz) },
      seaY: { value: this.seaY - 0.05 }, sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      skyTop: { value: new THREE.Color(0x6fa3d8) }, skyHorizon: { value: new THREE.Color(0xcfe3ee) },
      deep: { value: new THREE.Color(0x0e3b52) }, shallow: { value: new THREE.Color(0x3e9a9a) },
      winter: { value: this.theme === 'winter' ? 1 : 0 },
    }, this.fogUniforms);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D hTex; uniform vec4 hMap; uniform vec2 hOff; uniform float seaY; uniform vec3 sunDir; uniform vec3 skyTop; uniform vec3 skyHorizon;
        uniform vec3 deep; uniform vec3 shallow; uniform float uTime; uniform sampler2D fogTex; uniform vec4 fogScale; uniform float winter;
        varying vec3 vW;
        ${GLSL_NOISE}
        float wave(vec2 p){ return fbm3(p * .9 + vec2(uTime * .05, uTime * .03)) + .5 * fbm3(p * 2.3 - vec2(uTime * .08, -uTime * .04)); }
        void main(){
          vec2 huv = (vW.xz - hMap.xy) * hMap.zw + hOff;
          float ground = texture2D(hTex, clamp(huv, 0., 1.)).r;
          if (huv.x < 0. || huv.y < 0. || huv.x > 1. || huv.y > 1.) ground = -4.;
          float depth = seaY - ground;
          if (depth < -0.02) discard;
          float e = .06;
          vec2 p = vW.xz;
          float h0 = wave(p), hx = wave(p + vec2(e, 0.)), hz = wave(p + vec2(0., e));
          vec3 n = normalize(vec3((h0 - hx) * 1.3, e * 4., (h0 - hz) * 1.3));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1. - max(dot(n, V), 0.), 4.) * .85 + .08;
          vec3 R = reflect(-V, n);
          vec3 sky = mix(skyHorizon, skyTop, clamp(R.y * 1.4, 0., 1.));
          float dcol = 1. - exp(-depth * 1.4);
          vec3 water = mix(shallow, deep, dcol);
          vec3 c = mix(water, sky, fres);
          vec3 H = normalize(sunDir + V);
          c += vec3(1., .95, .85) * pow(max(dot(n, H), 0.), 220.) * 2.2;
          // shoreline foam
          float foamN = fbm3(p * 3. + vec2(uTime * .2, uTime * .13));
          float foam = (1. - smoothstep(0., .22 + foamN * .15, depth)) * smoothstep(.35, .6, foamN + sin(depth * 30. - uTime * 2.) * .15);
          c = mix(c, vec3(.92,.96,.97), foam * .85);
          if (winter > .5) { float ice = smoothstep(.55,.62, fbm(p * .3)) * (1. - dcol * .6); c = mix(c, vec3(.85,.92,.97), ice * .7); }
          float a = clamp(.35 + dcol * .75 + fres * .3 + foam, 0., .96);
          // fog of war
          vec2 fuv = vec2(vW.x * fogScale.x, vW.z * fogScale.y + fogScale.z);
          float fw = texture2D(fogTex, fuv).r;
          c *= fw;
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.renderOrder = 2;
    // dark deep seabed under the open ocean around the map
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x0b2433 }));
    sb.rotation.x = -Math.PI / 2; sb.position.set((this.x0 + this.x1) / 2, this.seaY - 6, (this.z0 + this.z1) / 2);
    this.seabed = sb;
  }

  // vis/exp are the human player's visible/explored arrays (per node)
  updateFog(vis, exp, reveal = false) {
    const g = this.game.grid, W = g.w, d = this.fogData;
    for (let y = 0; y < g.h; y++) {
      const off = (y & 1) ? 0.5 : 0;
      for (let c = 0; c < this.fogW; c++) {
        const x = Math.max(0, Math.min(W - 1, Math.round((c + 0.5) / 2 - off)));
        const n = y * W + x;
        d[y * this.fogW + c] = reveal || vis[n] ? 255 : exp[n] ? 150 : 0;
      }
    }
    this.fogTex.needsUpdate = true;
  }
  update(t) { this.fogUniforms.uTime.value = t; }
}

// Patch any built-in material so it darkens with fog of war (and optionally gets cloud shadows).
export function patchFog(mat, uniforms, clouds = false) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFogW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        vFogW = (modelMatrix * fwp).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D fogTex; uniform vec4 fogScale; uniform float cloudAmt; varying vec3 vFogW;
        ${sh.fragmentShader.includes('uniform float uTime') ? '' : 'uniform float uTime;'}
        ${clouds ? GLSL_NOISE : ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float fw = texture2D(fogTex, vec2(vFogW.x * fogScale.x, vFogW.z * fogScale.y + fogScale.z)).r;
        gl_FragColor.rgb *= fw;`);
    if (clouds) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float cl = smoothstep(.45, .75, fbm3(vFogW.xz * .045 + vec2(uTime * .012, uTime * .007)));
        reflectedLight.directDiffuse *= 1. - cl * cloudAmt;
        reflectedLight.directSpecular *= 1. - cl * cloudAmt;`);
  };
  const base = prevKey ? prevKey.call(mat) : '';
  mat.customProgramCacheKey = () => base + 'fog' + (clouds ? 'c' : '');
}
