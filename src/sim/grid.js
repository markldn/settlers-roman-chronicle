// Node grid geometry: odd rows are shifted right by half a node ("odd-r" offset).
// Directions: 0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE. A building's flag is at its SE neighbour.

export const DIR = { E: 0, SE: 1, SW: 2, W: 3, NW: 4, NE: 5 };
export const ROW_H = 0.8660254;
export const HEIGHT_SCALE = 0.32; // world units per height level

const EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

export class Grid {
  constructor(w, h) {
    this.w = w; this.h = h; this.n = w * h;
    // precomputed neighbour table, -1 outside
    this.nb = new Int32Array(this.n * 6).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = (y & 1) ? ODD : EVEN;
      for (let d = 0; d < 6; d++) {
        const nx = x + t[d][0], ny = y + t[d][1];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) this.nb[(y * w + x) * 6 + d] = ny * w + nx;
      }
    }
  }
  idx(x, y) { return y * this.w + x; }
  x(i) { return i % this.w; }
  y(i) { return (i / this.w) | 0; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  neighbor(i, d) { return this.nb[i * 6 + d]; }
  dirTo(a, b) { for (let d = 0; d < 6; d++) if (this.nb[a * 6 + d] === b) return d; return -1; }
  // axial coords for distance
  qr(i) { const x = i % this.w, y = (i / this.w) | 0; return [x - ((y - (y & 1)) >> 1), y]; }
  dist(a, b) {
    const [q1, r1] = this.qr(a), [q2, r2] = this.qr(b);
    const dq = q1 - q2, dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) >> 1;
  }
  // all nodes within radius r of centre (inclusive), ring order not guaranteed
  within(c, r, out = []) {
    out.length = 0;
    const cy = this.y(c), cx = this.x(c);
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy; if (y < 0 || y >= this.h) continue;
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const x = cx + dx; if (x < 0 || x >= this.w) continue;
        const i = y * this.w + x;
        if (this.dist(c, i) <= r) out.push(i);
      }
    }
    return out;
  }
  // world position of a node (height supplied separately)
  wx(i) { const y = (i / this.w) | 0; return (i % this.w) + ((y & 1) ? 0.5 : 0); }
  wz(i) { return ((i / this.w) | 0) * ROW_H; }
  nearestNode(wx, wz) {
    const y0 = Math.round(wz / ROW_H);
    let best = -1, bd = 1e9;
    for (let y = y0 - 1; y <= y0 + 1; y++) {
      if (y < 0 || y >= this.h) continue;
      const x0 = Math.round(wx - ((y & 1) ? 0.5 : 0));
      for (let x = x0 - 1; x <= x0 + 1; x++) {
        if (x < 0 || x >= this.w) continue;
        const i = y * this.w + x;
        const d = (this.wx(i) - wx) ** 2 + (this.wz(i) - wz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
}

// Small deterministic RNG (mulberry32). State is a plain number so it serialises.
export class RNG {
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return (this.next() * n) | 0; }
  range(a, b) { return a + (b - a) * this.next(); }
  pick(arr) { return arr[this.int(arr.length)]; }
  chance(p) { return this.next() < p; }
}

// Binary min-heap keyed by number, used by all path searches.
export class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(v, k) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v; const top = V[0]; const lk = K.pop(), lv = V.pop();
    if (K.length) {
      let i = 0; const n = K.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }
}

// value noise for map generation
export function makeNoise(seed) {
  const rng = new RNG(seed);
  const P = new Uint8Array(512); const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = rng.int(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const G = new Float32Array(256).map(() => rng.next() * 2 - 1);
  const f = t => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = G[P[(P[xi & 255] + yi) & 511]], b = G[P[(P[(xi + 1) & 255] + yi) & 511]];
    const c = G[P[(P[xi & 255] + yi + 1) & 511]], d = G[P[(P[(xi + 1) & 255] + yi + 1) & 511]];
    const u = f(xf), v = f(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 4) => { let s = 0, amp = 1, fr = 1, n = 0; for (let o = 0; o < oct; o++) { s += n2(x * fr, y * fr) * amp; n += amp; amp *= 0.5; fr *= 2; } return s / n; };
}
