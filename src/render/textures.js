// Procedural canvas textures: the building material atlas (+ derived normal map), road strips,
// vegetation cards and particle sprites. Everything is generated at startup — no image files.
import * as THREE from 'three';
import { makeNoise, RNG } from '../sim/grid.js';

export const ATLAS = { size: 2048, tile: 512, cols: 4 };
export const MAT = { plaster: 0, stone: 1, roof: 2, thatch: 3, planks: 4, timber: 5, fieldstone: 6, window: 7, door: 8, metal: 9, cloth: 10, soil: 11, shingle: 12, brick: 13, rock: 14, white: 15 };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const noise = makeNoise(4242);

// fills a region with fbm-modulated colour; col(n, x, y) returns [r,g,b]
function paintNoise(ctx, x0, y0, w, h, col, scale = 0.02, oct = 4) {
  const img = ctx.getImageData(x0, y0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // tileable: blend 4 samples
    const u = x / w, v = y / h;
    const s = (xx, yy) => noise(xx * scale * w / 512 * 512 / w, yy * scale, oct);
    const n = (s(x, y) * (1 - u) * (1 - v) + s(x - w, y) * u * (1 - v) + s(x, y - h) * (1 - u) * v + s(x - w, y - h) * u * v);
    const [r, g, b] = col(n, x, y);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}
function grain(ctx, x0, y0, w, h, amt, rng) {
  const img = ctx.getImageData(x0, y0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const k = (rng.next() - 0.5) * amt; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  ctx.putImageData(img, x0, y0);
}

const TILE_PAINTERS = {
  plaster(c, T, r) {
    paintNoise(c, 0, 0, T, T, (n) => { const v = 222 + n * 26; return [v + 6, v, v - 14]; }, 0.012);
    c.globalAlpha = 0.18; for (let k = 0; k < 40; k++) { c.fillStyle = r.chance(0.5) ? '#8a7a60' : '#fff8e8'; c.beginPath(); c.ellipse(r.next() * T, r.next() * T, 8 + r.next() * 40, 4 + r.next() * 20, r.next() * 3, 0, 7); c.fill(); }
    c.globalAlpha = 1; grain(c, 0, 0, T, T, 14, r);
  },
  stone(c, T, r) {
    c.fillStyle = '#7d766b'; c.fillRect(0, 0, T, T);
    const rows = 8, rh = T / rows;
    for (let y = 0; y < rows; y++) {
      let x = (y % 2) * -rh * 0.9;
      while (x < T) {
        const w = rh * (1.3 + r.next() * 1.2);
        const v = 150 + r.next() * 50, t = r.next() * 14;
        c.fillStyle = `rgb(${v + t},${v + t * 0.6},${v - 8})`;
        c.beginPath(); c.roundRect(x + 3, y * rh + 3, w - 6, rh - 6, 6); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 5, y * rh + 5, w - 10, 4);
        c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(x + 5, y * rh + rh - 9, w - 10, 4);
        // wrap
        if (x + w > T) { c.fillStyle = `rgb(${v + t},${v + t * 0.6},${v - 8})`; c.beginPath(); c.roundRect(x + 3 - T, y * rh + 3, w - 6, rh - 6, 6); c.fill(); }
        x += w;
      }
    }
    grain(c, 0, 0, T, T, 22, r);
  },
  roof(c, T, r) {
    // terracotta pan tiles, drawn light so the nation tint can colour them
    c.fillStyle = '#6b5a50'; c.fillRect(0, 0, T, T);
    const cols = 8, rows = 10, cw = T / cols, rh = T / rows;
    for (let y = rows; y >= -1; y--) for (let x = 0; x <= cols; x++) {
      const ox = (y % 2) * cw * 0.5, px = x * cw + ox - cw * 0.5, py = y * rh;
      const v = 205 + r.next() * 40;
      const g = c.createLinearGradient(px, 0, px + cw, 0);
      g.addColorStop(0, `rgb(${v * 0.7},${v * 0.66},${v * 0.64})`); g.addColorStop(0.45, `rgb(${v},${v * 0.96},${v * 0.93})`); g.addColorStop(1, `rgb(${v * 0.62},${v * 0.58},${v * 0.56})`);
      c.fillStyle = g; c.beginPath(); c.moveTo(px + 2, py); c.lineTo(px + cw - 2, py); c.lineTo(px + cw - 4, py + rh * 1.25); c.quadraticCurveTo(px + cw / 2, py + rh * 1.45, px + 4, py + rh * 1.25); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px + 3, py + rh * 1.2, cw - 6, 3);
    }
    grain(c, 0, 0, T, T, 18, r);
  },
  thatch(c, T, r) {
    c.fillStyle = '#8a6a32'; c.fillRect(0, 0, T, T);
    for (let k = 0; k < 5200; k++) {
      const x = r.next() * T, y = r.next() * T, l = 20 + r.next() * 40, v = 150 + r.next() * 90;
      c.strokeStyle = `rgba(${v},${v * 0.8},${v * 0.42},0.85)`; c.lineWidth = 1 + r.next() * 1.5;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r.next() - 0.5) * 6, y + l); c.stroke();
    }
    for (let y = 0; y < T; y += T / 6) { c.fillStyle = 'rgba(40,25,10,0.35)'; c.fillRect(0, y, T, 5); }
  },
  planks(c, T, r) {
    const n = 6, pw = T / n;
    for (let i = 0; i < n; i++) {
      const v = 140 + r.next() * 50;
      paintNoise(c, i * pw, 0, pw, T, (nn, x, y) => { const s = Math.sin((x * 0.06 + nn * 6 + y * 0.004) * 3) * 10; return [v + s + 20, v * 0.72 + s, v * 0.45 + s * 0.5]; }, 0.03, 2);
      c.fillStyle = 'rgba(30,15,5,0.55)'; c.fillRect(i * pw, 0, 3, T);
      for (let k = 0; k < 2; k++) { c.fillStyle = '#3a2412'; c.beginPath(); c.arc(i * pw + pw / 2, r.next() * T, 3.5, 0, 7); c.fill(); }
    }
    grain(c, 0, 0, T, T, 10, r);
  },
  timber(c, T, r) {
    paintNoise(c, 0, 0, T, T, (n, x, y) => { const s = Math.sin((y * 0.05 + n * 8) * 2) * 12; return [92 + s, 60 + s * 0.7, 36 + s * 0.4]; }, 0.02, 3);
    grain(c, 0, 0, T, T, 12, r);
  },
  fieldstone(c, T, r) {
    c.fillStyle = '#5f5a52'; c.fillRect(0, 0, T, T);
    for (let k = 0; k < 90; k++) {
      const x = r.next() * T, y = r.next() * T, rx = 18 + r.next() * 34, ry = 14 + r.next() * 22, v = 120 + r.next() * 70;
      for (const [dx, dy] of [[0, 0], [T, 0], [-T, 0], [0, T], [0, -T]]) {
        const g = c.createRadialGradient(x + dx - rx * 0.3, y + dy - ry * 0.3, 2, x + dx, y + dy, rx);
        g.addColorStop(0, `rgb(${v + 30},${v + 26},${v + 18})`); g.addColorStop(1, `rgb(${v * 0.6},${v * 0.58},${v * 0.54})`);
        c.fillStyle = g; c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, r.next() * 3, 0, 7); c.fill();
      }
    }
    grain(c, 0, 0, T, T, 20, r);
  },
  window(c, T) {
    c.fillStyle = '#5a3a1e'; c.fillRect(0, 0, T, T);
    const g = c.createLinearGradient(0, 0, T, T); g.addColorStop(0, '#2c3a48'); g.addColorStop(0.5, '#56708a'); g.addColorStop(1, '#1a232e');
    c.fillStyle = g; c.fillRect(T * 0.12, T * 0.12, T * 0.76, T * 0.76);
    c.fillStyle = 'rgba(255,220,150,0.18)'; c.fillRect(T * 0.12, T * 0.5, T * 0.76, T * 0.38);
    c.fillStyle = '#5a3a1e'; c.fillRect(T * 0.47, T * 0.1, T * 0.06, T * 0.8); c.fillRect(T * 0.1, T * 0.47, T * 0.8, T * 0.06);
  },
  door(c, T, r) {
    c.fillStyle = '#2a1a0c'; c.fillRect(0, 0, T, T);
    for (let i = 0; i < 5; i++) { const v = 110 + r.next() * 30; c.fillStyle = `rgb(${v},${v * 0.66},${v * 0.38})`; c.fillRect(T * 0.1 + i * T * 0.16, T * 0.08, T * 0.15, T * 0.92); }
    c.fillStyle = '#2c2c2c'; c.fillRect(T * 0.1, T * 0.28, T * 0.8, T * 0.05); c.fillRect(T * 0.1, T * 0.7, T * 0.8, T * 0.05);
    c.fillStyle = '#c9a23a'; c.beginPath(); c.arc(T * 0.72, T * 0.52, T * 0.03, 0, 7); c.fill();
  },
  metal(c, T, r) { paintNoise(c, 0, 0, T, T, (n) => { const v = 120 + n * 60; return [v, v + 4, v + 10]; }, 0.03, 3); grain(c, 0, 0, T, T, 16, r); },
  cloth(c, T, r) { paintNoise(c, 0, 0, T, T, (n) => { const v = 235 + n * 20; return [v, v, v]; }, 0.05, 2); for (let y = 0; y < T; y += 4) { c.fillStyle = 'rgba(0,0,0,0.04)'; c.fillRect(0, y, T, 1); } },
  soil(c, T, r) { paintNoise(c, 0, 0, T, T, (n) => [110 + n * 40, 82 + n * 30, 54 + n * 20], 0.02, 4); grain(c, 0, 0, T, T, 26, r); },
  shingle(c, T, r) {
    c.fillStyle = '#3d2b1c'; c.fillRect(0, 0, T, T);
    const rows = 12, rh = T / rows;
    for (let y = 0; y < rows; y++) for (let x = -1; x < 10; x++) { const w = T / 8, ox = (y % 2) * w / 2, v = 120 + r.next() * 60; c.fillStyle = `rgb(${v},${v * 0.72},${v * 0.5})`; c.fillRect(x * w + ox + 2, y * rh + 2, w - 4, rh * 1.3); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x * w + ox + 2, y * rh + rh * 1.2, w - 4, 3); }
    grain(c, 0, 0, T, T, 16, r);
  },
  brick(c, T, r) {
    c.fillStyle = '#d8d0c0'; c.fillRect(0, 0, T, T);
    const rows = 16, rh = T / rows, bw = T / 6;
    for (let y = 0; y < rows; y++) for (let x = -1; x < 7; x++) { const v = 150 + r.next() * 50; c.fillStyle = `rgb(${v + 30},${v * 0.55},${v * 0.4})`; c.fillRect(x * bw + (y % 2) * bw / 2 + 2, y * rh + 2, bw - 4, rh - 4); }
    grain(c, 0, 0, T, T, 18, r);
  },
  rock(c, T, r) { paintNoise(c, 0, 0, T, T, (n, x, y) => { const s = Math.abs(Math.sin(y * 0.03 + n * 5)) * 30; return [110 + n * 50 + s, 104 + n * 46 + s, 96 + n * 40 + s]; }, 0.015, 5); grain(c, 0, 0, T, T, 20, r); },
  white(c, T) { c.fillStyle = '#fff'; c.fillRect(0, 0, T, T); },
};

let cache = null;
export function buildMaterialAtlas() {
  if (cache) return cache;
  const { size, tile, cols } = ATLAS;
  const cv = canvas(size, size), c = cv.getContext('2d');
  const r = new RNG(99);
  for (const [name, idx] of Object.entries(MAT)) {
    const tc = canvas(tile, tile), tctx = tc.getContext('2d');
    TILE_PAINTERS[name](tctx, tile, r);
    c.drawImage(tc, (idx % cols) * tile, Math.floor(idx / cols) * tile);
  }
  // normal map from luminance (Sobel), per tile with wrap
  const src = c.getImageData(0, 0, size, size).data;
  const nc = canvas(size, size), nctx = nc.getContext('2d');
  const out = nctx.createImageData(size, size), od = out.data;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) lum[i] = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.59 + src[i * 4 + 2] * 0.11) / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tx = Math.floor(x / tile) * tile, ty = Math.floor(y / tile) * tile;
    const L = (xx, yy) => lum[(ty + ((yy - ty + tile) % tile)) * size + tx + ((xx - tx + tile) % tile)];
    const dx = (L(x + 1, y) - L(x - 1, y)) * 2.2, dy = (L(x, y + 1) - L(x, y - 1)) * 2.2;
    const nz = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * size + x) * 4;
    od[i] = (-dx * nz * 0.5 + 0.5) * 255; od[i + 1] = (dy * nz * 0.5 + 0.5) * 255; od[i + 2] = nz * 255; od[i + 3] = 255;
  }
  nctx.putImageData(out, 0, 0);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(nc); normalMap.anisotropy = 8;
  for (const t of [map, normalMap]) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  cache = { map, normalMap };
  return cache;
}
export function tileRect(idx) { const { cols } = ATLAS; const s = 1 / cols; return [(idx % cols) * s, 1 - (Math.floor(idx / cols) + 1) * s, s, s]; }

// ---------------------------------------------------------------- road strip textures
export function roadTexture() {
  const W = 256, H = 512, cv = canvas(W * 2, H), c = cv.getContext('2d'), r = new RNG(7);
  // left half: dirt road, right half: cobble road. alpha falls off at the edges.
  for (let k = 0; k < 2; k++) {
    const x0 = k * W;
    paintNoise(c, x0, 0, W, H, (n) => k === 0 ? [140 + n * 40, 106 + n * 30, 70 + n * 22] : [120 + n * 30, 112 + n * 28, 100 + n * 24], 0.03, 4);
    if (k === 0) {
      for (const rx of [0.33, 0.67]) { c.fillStyle = 'rgba(70,45,20,0.25)'; c.fillRect(x0 + W * rx - 7, 0, 14, H); }
      for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(${r.chance(0.5) ? '200,180,140' : '80,60,40'},0.5)`; c.beginPath(); c.arc(x0 + r.next() * W, r.next() * H, 1 + r.next() * 2.5, 0, 7); c.fill(); }
    } else {
      const rh = 26;
      for (let y = 0; y < H / rh; y++) for (let x = -1; x < W / 30 + 1; x++) {
        const v = 140 + r.next() * 60; const px = x0 + x * 30 + (y % 2) * 15;
        c.fillStyle = `rgb(${v},${v * 0.95},${v * 0.86})`; c.beginPath(); c.roundRect(Math.max(x0, px + 2), y * rh + 2, 26, rh - 4, 7); c.fill();
      }
    }
    const img = c.getImageData(x0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = Math.min(x, W - 1 - x) / (W * 0.5);
      const wob = noise(x0 * 0.1 + y * 0.05, x * 0.02, 2) * 0.25;
      d[(y * W + x) * 4 + 3] = 255 * Math.max(0, Math.min(1, (e - 0.08 + wob) * 4));
    }
    c.putImageData(img, x0, 0);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- vegetation cards
export function grassCardTexture(kind = 'grass') {
  const S = 128, cv = canvas(S, S), c = cv.getContext('2d'), r = new RNG(kind.length * 31);
  if (kind === 'wheat') {
    for (let i = 0; i < 26; i++) {
      const x = 8 + r.next() * (S - 16), h = S * (0.55 + r.next() * 0.4), bend = (r.next() - 0.5) * 16;
      c.strokeStyle = '#d8c070'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x, S); c.quadraticCurveTo(x + bend * 0.3, S - h * 0.5, x + bend, S - h); c.stroke();
      c.fillStyle = '#f4dc88'; for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(x + bend - k * bend * 0.04, S - h + k * 4, 2.6, 4.2, bend * 0.02, 0, 7); c.fill(); }
    }
  } else if (kind === 'flower') {
    for (let i = 0; i < 14; i++) { const x = 10 + r.next() * (S - 20), h = S * (0.3 + r.next() * 0.4); c.strokeStyle = '#4a7a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, S); c.lineTo(x + (r.next() - 0.5) * 8, S - h); c.stroke(); }
    for (let i = 0; i < 14; i++) { const x = 10 + r.next() * (S - 20), y = S * (0.3 + r.next() * 0.35); c.fillStyle = r.pick(['#f4f4f4', '#f2d23a', '#d9463e', '#8f5ad8', '#f09ad0']); for (let k = 0; k < 5; k++) { const a = k * 1.256; c.beginPath(); c.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.4, 0, 7); c.fill(); } c.fillStyle = '#e8b020'; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill(); }
  } else {
    for (let i = 0; i < 70; i++) {
      const x = 4 + r.next() * (S - 8), h = S * (0.35 + r.next() * 0.6), bend = (r.next() - 0.5) * 30, v = r.next();
      c.strokeStyle = `rgb(${60 + v * 60},${110 + v * 70},${30 + v * 30})`; c.lineWidth = 1.5 + r.next() * 2;
      c.beginPath(); c.moveTo(x, S); c.quadraticCurveTo(x + bend * 0.2, S - h * 0.6, x + bend, S - h); c.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softSprite() {
  const S = 64, cv = canvas(S, S), c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}
