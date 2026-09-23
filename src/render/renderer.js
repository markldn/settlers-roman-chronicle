// Three.js host: renderer, S2-style camera, sun + shadows, sky, post-processing, picking.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Terrain } from './terrain.js';
import { World } from './world.js';
import { buildingGeometry, buildingMaterial, patchBuildingShader } from './models.js';
import { BUILDINGS } from '../sim/data.js';
import { ROW_H } from '../sim/grid.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, sat: { value: 1.12 }, warm: { value: 0.03 }, tilt: { value: 0.0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float vignette; uniform float sat; uniform float warm; uniform float tilt; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // subtle tilt-shift: blur toward top and bottom edges (miniature look)
      if (tilt > 0.0) {
        float k = smoothstep(0.25, 0.5, abs(vUv.y - 0.55)) * tilt;
        if (k > 0.001) { vec4 acc = vec4(0.); float ws = 0.;
          for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) { vec2 o = vec2(float(i), float(j)) * k * 2.2 / res; float w = 1. / (1. + float(i*i + j*j)); acc += texture2D(tDiffuse, vUv + o) * w; ws += w; }
          c = mix(c, acc / ws, min(1., k * 3.)); }
      }
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb += vec3(warm, warm * 0.4, -warm);
      vec2 d = vUv - 0.5; c.rgb *= 1. - dot(d, d) * vignette * 1.6;
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.05;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.3, 400);
    this.cam = { x: 20, z: 20, dist: 16, yaw: 0, pitch: 0.95, tx: 20, tz: 20, tdist: 16, tyaw: 0 };
    this.quality = localStorage.getItem('settlers.quality') || 'high';
    this.setupLights();
    this.setupSky();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.clock = 0;
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a4a30, 0.95);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.sunDir = new THREE.Vector3(-0.55, 0.78, 0.35).normalize();
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }
  setupSky() {
    const geo = new THREE.SphereGeometry(300, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x4f86c6) }, horizon: { value: new THREE.Color(0xd8e6ee) }, sunDir: { value: new THREE.Vector3(-0.55, 0.78, 0.35) } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vD;
        void main(){ float h = clamp(vD.y, 0., 1.); vec3 c = mix(horizon, top, pow(h, 0.55)); float s = max(dot(normalize(vD), normalize(sunDir)), 0.); c += vec3(1., .9, .7) * pow(s, 200.) * 2. + vec3(1., .8, .6) * pow(s, 8.) * .15; gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat); this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xc9dbe6, 40, 140);
  }

  setTheme(theme) {
    const s = this.sky.material.uniforms;
    if (theme === 'winter') { s.top.value.set(0x7a9cc0); s.horizon.value.set(0xe8eef4); this.scene.fog.color.set(0xdde6ee); this.hemi.color.set(0xe0ecff); this.sun.color.set(0xfff6ee); }
    else if (theme === 'wasteland') { s.top.value.set(0x8a9ab0); s.horizon.value.set(0xe8d8c0); this.scene.fog.color.set(0xd8ccb8); this.hemi.color.set(0xf0e0c8); this.sun.color.set(0xffe2b8); }
    else { s.top.value.set(0x4f86c6); s.horizon.value.set(0xd8e6ee); this.scene.fog.color.set(0xc9dbe6); this.hemi.color.set(0xcfe4ff); this.sun.color.set(0xfff1dc); }
  }

  setGame(game, me = 0) {
    if (this.world) { this.scene.remove(this.world.group); this.scene.remove(this.terrain.group); }
    this.game = game; this.me = me;
    const theme = game.map.theme || 'greenland';
    this.setTheme(theme);
    this.terrain = new Terrain(this.r, game, theme);
    this.scene.add(this.terrain.group);
    this.world = new World(this.r, this.scene, game, this.terrain, me);
    this.terrain.waterUniforms.sunDir.value.copy(this.sunDir);
    const pl = game.players[me];
    this.terrain.updateFog(pl.visible, pl.explored);
    this.fogT = 0;
    const hq = [...game.buildings.values()].find(b => b.owner === me && b.type === 'hq');
    if (hq) this.centerOn(hq.node, true);
    this.buildComposer();
  }

  buildComposer() {
    const q = this.quality;
    this.r.shadowMap.enabled = q !== 'low';
    const sm = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(sm, sm);
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (q === 'low') return;
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (q === 'high') {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.aoPass = ao;
      this.composer.addPass(ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.res.value.set(size.x, size.y);
    this.grade.uniforms.tilt.value = q === 'high' ? 0.6 : 0;
    this.composer.addPass(this.grade);
  }
  setQuality(q) { this.quality = q; localStorage.setItem('settlers.quality', q); this.buildComposer(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.game) this.buildComposer();
  }

  centerOn(n, instant = false) {
    const g = this.game.grid;
    this.cam.tx = g.wx(n); this.cam.tz = g.wz(n);
    if (instant) { this.cam.x = this.cam.tx; this.cam.z = this.cam.tz; }
  }
  pan(dx, dz) {
    const c = this.cam, s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    c.tx += dx * co + dz * s; c.tz += -dx * s + dz * co;
    this.clampCam();
  }
  clampCam() {
    const g = this.game.grid, c = this.cam;
    c.tx = Math.max(-2, Math.min(g.w + 1, c.tx)); c.tz = Math.max(-2, Math.min(g.h * ROW_H + 1, c.tz));
  }
  zoom(f) { this.cam.tdist = Math.max(5, Math.min(60, this.cam.tdist * f)); }
  rotate(a) { this.cam.tyaw += a; }

  updateCamera(dt) {
    const c = this.cam, k = 1 - Math.exp(-dt * 10);
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.dist += (c.tdist - c.dist) * k; c.yaw += (c.tyaw - c.yaw) * k;
    const ty = this.terrain ? Math.max(this.terrain.seaY, this.terrain.heightAt(c.x, c.z)) : 0;
    this.camTargetY = (this.camTargetY ?? ty) + (ty - (this.camTargetY ?? ty)) * (1 - Math.exp(-dt * 4));
    const pitch = c.pitch + (c.dist - 16) * 0.004;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, this.camTargetY + sp * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, this.camTargetY, c.z);
    this.camera.far = c.dist * 6 + 60; this.camera.updateProjectionMatrix();
    this.scene.fog.near = c.dist * 1.6; this.scene.fog.far = c.dist * 5 + 30;
    // sun and shadow frustum follow the view
    const ext = c.dist * 0.95 + 4;
    this.sun.position.set(c.x + this.sunDir.x * 40, this.camTargetY + this.sunDir.y * 40, c.z + this.sunDir.z * 40);
    this.sun.target.position.set(c.x, this.camTargetY, c.z);
    const sc = this.sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
  }

  // world-space rectangle on the ground covered by the view (for culling)
  viewBox() {
    const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    const ray = new THREE.Ray(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.camTargetY ?? 2)), hit = new THREE.Vector3();
    for (const [sx, sy] of pts) {
      const v = new THREE.Vector3(sx, sy, 0.5).unproject(this.camera);
      ray.origin.copy(this.camera.position); ray.direction.copy(v.sub(this.camera.position).normalize());
      if (!ray.intersectPlane(plane, hit)) { hit.copy(ray.origin).addScaledVector(ray.direction, this.cam.dist * 4); }
      x0 = Math.min(x0, hit.x); x1 = Math.max(x1, hit.x); z0 = Math.min(z0, hit.z); z1 = Math.max(z1, hit.z);
    }
    return [x0 - 2, z0 - 3, x1 + 2, z1 + 2];
  }

  // screen -> terrain point by ray marching the height field
  pick(clientX, clientY) {
    if (!this.terrain) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    let t = 0, prev = 0, step = 0.08;
    for (let i = 0; i < 4000; i++) {
      t += step;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = Math.max(this.terrain.heightAt(x, z), this.terrain.seaY - 0.05);
      if (y <= h) {
        let a = prev, b = t;
        for (let k = 0; k < 12; k++) { const m = (a + b) / 2; const yy = o.y + d.y * m, hh = Math.max(this.terrain.heightAt(o.x + d.x * m, o.z + d.z * m), this.terrain.seaY - 0.05); if (yy <= hh) b = m; else a = m; }
        const p = new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
        return { point: p, node: this.game.grid.nearestNode(p.x, p.z) };
      }
      prev = t; step = Math.min(0.5, step * 1.02);
    }
    return null;
  }
  toScreen(n) {
    const g = this.game.grid, x = g.wx(n), z = g.wz(n);
    const v = new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.6, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top, vis: v.z < 1 };
  }

  frame(dt, events) {
    if (!this.game) return;
    this.clock += dt;
    this.updateCamera(dt);
    this.terrain.update(this.clock);
    this.fogT += dt;
    if (this.fogT > 0.5) { this.fogT = 0; const pl = this.game.players[this.me]; this.terrain.updateFog(pl.visible, pl.explored, this.world.revealAll); }
    if (events) for (const e of events) this.world.onEvent(e);
    this.world.update(dt, this.viewBox());
    if (this.composer) this.composer.render(dt); else this.r.render(this.scene, this.camera);
  }

  // 3D portrait of a building type for the UI (rendered once, cached as data URL)
  portraits(nation = 'romans', types = Object.keys(BUILDINGS)) {
    const out = {};
    const S = 96;
    const rt = new THREE.WebGLRenderTarget(S * 2, S * 2, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a40, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-2, 4, 3); scene.add(sun);
    const mat = buildingMaterial().clone();
    patchBuildingShader(mat, { uTime: { value: 0 } });
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    const buf = new Uint8Array(S * S * 16);
    const cv = document.createElement('canvas'); cv.width = cv.height = S * 2; const ctx = cv.getContext('2d');
    const prevTM = this.r.toneMapping;
    for (const t of types) {
      const geo = buildingGeometry(t, nation).clone();
      const n = geo.attributes.position.count;
      geo.setAttribute('instA', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1).map((v, i) => (i % 4 === 3 ? 1 : [0.2, 0.45, 0.9][i % 4])), 4));
      geo.setAttribute('instB', new THREE.BufferAttribute(new Float32Array(n * 4).map((v, i) => (i % 4 === 1 ? 99 : 0)), 4));
      const mesh = new THREE.Mesh(geo, mat); mesh.rotation.y = Math.PI / 6;
      scene.add(mesh);
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere; const r = bs.radius;
      cam.position.set(bs.center.x + r * 1.6, bs.center.y + r * 1.5, bs.center.z + r * 2.9); cam.lookAt(bs.center.x, bs.center.y * 0.9, bs.center.z);
      this.r.setRenderTarget(rt); this.r.setClearColor(0x000000, 0); this.r.clear(); this.r.render(scene, cam);
      this.r.readRenderTargetPixels(rt, 0, 0, S * 2, S * 2, buf);
      const img = ctx.createImageData(S * 2, S * 2);
      for (let y = 0; y < S * 2; y++) img.data.set(buf.subarray((S * 2 - 1 - y) * S * 8, (S * 2 - y) * S * 8), y * S * 8);
      ctx.clearRect(0, 0, S * 2, S * 2); ctx.putImageData(img, 0, 0);
      out[t] = cv.toDataURL();
      scene.remove(mesh); geo.dispose();
    }
    this.r.setRenderTarget(null); this.r.toneMapping = prevTM;
    rt.dispose();
    return out;
  }
}
