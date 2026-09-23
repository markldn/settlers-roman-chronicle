// Procedurally drawn icons (canvas 2D): wares, build-help markers, resource signs, UI symbols.
// One atlas canvas is shared by the WebGL billboards and the DOM UI (via data URLs).

export const ICON_SIZE = 64;
export const ICONS = [
  // wares (order matters only for atlas slots)
  'wood', 'boards', 'stones', 'fish', 'meat', 'bread', 'water', 'grain', 'flour', 'pig', 'beer',
  'coal', 'ironore', 'goldore', 'iron', 'coins', 'sword', 'shield',
  'axe', 'saw', 'pickaxe', 'hammer', 'shovel', 'crucible', 'rod', 'scythe', 'cleaver', 'rollingpin', 'bow', 'tongs',
  // build help
  'bh_flag', 'bh_small', 'bh_medium', 'bh_large', 'bh_mine',
  // resource signs
  'res_none', 'res_coal', 'res_iron', 'res_gold', 'res_granite', 'res_water',
  // misc ui
  'donkey', 'soldier', 'carrier', 'swords', 'star', 'road', 'geologist', 'scout', 'destroy', 'stop', 'play', 'eye', 'up', 'down',
];
export const ICON_INDEX = Object.fromEntries(ICONS.map((k, i) => [k, i]));
const COLS = 8;

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function grad(c, x0, y0, x1, y1, a, b) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
function stroke(c, w = 2, col = 'rgba(30,18,8,0.9)') { c.lineWidth = w; c.strokeStyle = col; c.stroke(); }
function blob(c, x, y, r, a, b) { const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); stroke(c, 1.5); }
function log(c, x, y, len, r, ang) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.fillStyle = grad(c, 0, -r, 0, r, '#b07a45', '#5d3a1a'); rr(c, -len / 2, -r, len, r * 2, r * 0.6); c.fill(); stroke(c, 1.5);
  c.fillStyle = '#e7c48f'; c.beginPath(); c.ellipse(len / 2 - r * 0.3, 0, r * 0.45, r * 0.95, 0, 0, 7); c.fill(); stroke(c, 1.2);
  c.strokeStyle = '#a57a4a'; c.lineWidth = 0.8; c.beginPath(); c.ellipse(len / 2 - r * 0.3, 0, r * 0.2, r * 0.45, 0, 0, 7); c.stroke();
  c.restore();
}
function handle(c, x0, y0, x1, y1, w = 5) { c.strokeStyle = '#3b2412'; c.lineWidth = w + 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.strokeStyle = '#a8753f'; c.lineWidth = w; c.stroke(); }
function metal(c) { return grad(c, 0, 0, 64, 64, '#eef2f5', '#6c7680'); }
function house(c, x, y, w, h, roof = '#b4492f') {
  c.fillStyle = grad(c, x, y, x, y + h, '#f3e9d2', '#c9b58f'); c.fillRect(x, y, w, h); c.strokeStyle = '#3a2a18'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
  c.fillStyle = roof; c.beginPath(); c.moveTo(x - 5, y + 1); c.lineTo(x + w / 2, y - h * 0.75); c.lineTo(x + w + 5, y + 1); c.closePath(); c.fill(); stroke(c, 2);
  c.fillStyle = '#4a2c15'; c.fillRect(x + w / 2 - w * 0.12, y + h * 0.45, w * 0.24, h * 0.55);
}

const DRAW = {
  wood(c) { log(c, 30, 40, 44, 7, -0.25); log(c, 34, 26, 40, 6.5, -0.15); },
  boards(c) { for (let i = 0; i < 3; i++) { c.fillStyle = grad(c, 0, 0, 0, 10, '#e2b77a', '#a8783f'); c.save(); c.translate(32, 22 + i * 10); c.rotate(-0.12); rr(c, -26, -4, 52, 8, 1.5); c.fill(); stroke(c, 1.3); c.strokeStyle = 'rgba(90,50,20,.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-22, 0); c.lineTo(20, 0); c.stroke(); c.restore(); } },
  stones(c) { blob(c, 22, 40, 12, '#d6d6cf', '#6f6e68'); blob(c, 42, 40, 11, '#cfcfc8', '#65645e'); blob(c, 32, 26, 11, '#e0e0da', '#75746d'); },
  fish(c) { c.fillStyle = grad(c, 0, 20, 0, 44, '#b8d3e0', '#4f7d96'); c.beginPath(); c.ellipse(30, 32, 20, 9, 0, 0, 7); c.fill(); stroke(c); c.beginPath(); c.moveTo(48, 32); c.lineTo(60, 22); c.lineTo(60, 42); c.closePath(); c.fill(); stroke(c); c.fillStyle = '#111'; c.beginPath(); c.arc(18, 30, 2.2, 0, 7); c.fill(); },
  meat(c) { c.fillStyle = grad(c, 10, 14, 50, 50, '#e9747a', '#8e2a2e'); c.beginPath(); c.ellipse(28, 34, 18, 14, -0.4, 0, 7); c.fill(); stroke(c); c.fillStyle = '#f4e8d8'; c.beginPath(); c.arc(46, 20, 5, 0, 7); c.arc(52, 24, 5, 0, 7); c.fill(); stroke(c, 1.3); c.fillStyle = '#f4e8d8'; c.fillRect(38, 22, 10, 6); },
  bread(c) { c.fillStyle = grad(c, 0, 16, 0, 50, '#e7b15f', '#9a5a1c'); c.beginPath(); c.ellipse(32, 36, 24, 14, 0, 0, 7); c.fill(); stroke(c); c.strokeStyle = '#f3d49a'; c.lineWidth = 2.5; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(24 + i * 10, 28); c.lineTo(30 + i * 10, 40); c.stroke(); } },
  water(c) { c.fillStyle = grad(c, 0, 12, 0, 56, '#8b6b43', '#4d361c'); rr(c, 14, 16, 36, 40, 5); c.fill(); stroke(c); c.fillStyle = '#58a8e8'; c.beginPath(); c.ellipse(32, 18, 16, 5, 0, 0, 7); c.fill(); stroke(c, 1.2); c.strokeStyle = '#333'; c.lineWidth = 2; c.beginPath(); c.moveTo(14, 30); c.lineTo(50, 30); c.moveTo(14, 46); c.lineTo(50, 46); c.stroke(); },
  grain(c) { c.strokeStyle = '#8a6a1e'; c.lineWidth = 2; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(32 + i * 2, 58); c.quadraticCurveTo(32 + i * 5, 34, 32 + i * 9, 14); c.stroke(); c.fillStyle = '#e7c35a'; for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(32 + i * 9 - k * i * 0.8, 14 + k * 5, 3, 5, i * 0.2, 0, 7); c.fill(); stroke(c, 0.8); } } },
  flour(c) { c.fillStyle = grad(c, 0, 10, 0, 56, '#f5efe0', '#c9bfa5'); c.beginPath(); c.moveTo(20, 18); c.quadraticCurveTo(8, 50, 18, 56); c.lineTo(46, 56); c.quadraticCurveTo(56, 50, 44, 18); c.closePath(); c.fill(); stroke(c); c.fillStyle = '#b58b4a'; c.fillRect(22, 14, 20, 6); stroke(c, 1); },
  pig(c) { c.fillStyle = grad(c, 0, 16, 0, 50, '#f7c3c8', '#d98790'); c.beginPath(); c.ellipse(30, 36, 20, 13, 0, 0, 7); c.fill(); stroke(c); c.beginPath(); c.arc(50, 32, 8, 0, 7); c.fill(); stroke(c); c.fillStyle = '#c86d78'; c.beginPath(); c.ellipse(56, 33, 3, 4, 0, 0, 7); c.fill(); c.fillStyle = '#e59aa3'; for (const x of [18, 26, 36, 42]) c.fillRect(x, 44, 4, 9); },
  beer(c) { c.fillStyle = grad(c, 0, 0, 64, 0, '#8e6337', '#4f3219'); rr(c, 14, 16, 30, 40, 4); c.fill(); stroke(c); c.fillStyle = '#f5f0e0'; c.beginPath(); c.ellipse(29, 17, 17, 7, 0, 0, 7); c.fill(); stroke(c, 1.2); c.strokeStyle = '#3b2412'; c.lineWidth = 4; c.beginPath(); c.arc(46, 36, 9, -1.3, 1.3); c.stroke(); c.strokeStyle = '#c8a24a'; c.lineWidth = 2; c.beginPath(); c.moveTo(14, 28); c.lineTo(44, 28); c.moveTo(14, 46); c.lineTo(44, 46); c.stroke(); },
  coal(c) { blob(c, 22, 40, 12, '#555', '#0e0e0e'); blob(c, 42, 42, 10, '#4a4a4a', '#0a0a0a'); blob(c, 32, 26, 11, '#5a5a5a', '#111'); },
  ironore(c) { blob(c, 24, 38, 13, '#b5876a', '#5b3525'); blob(c, 42, 32, 11, '#a8795c', '#4d2b1e'); c.fillStyle = '#d8d8e0'; for (const [x, y] of [[20, 34], [28, 42], [44, 28], [40, 36]]) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); } },
  goldore(c) { blob(c, 26, 38, 13, '#9a8a6a', '#4b4030'); blob(c, 42, 30, 10, '#a09070', '#4b4030'); c.fillStyle = '#ffd84a'; for (const [x, y] of [[22, 34], [30, 42], [42, 26], [44, 34], [26, 30]]) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); stroke(c, 0.6); } },
  iron(c) { for (let i = 0; i < 2; i++) { c.fillStyle = grad(c, 0, 0, 0, 64, '#c6ccd4', '#4d5560'); c.beginPath(); const y = 42 - i * 14; c.moveTo(10 + i * 4, y + 8); c.lineTo(16 + i * 4, y - 4); c.lineTo(50 - i * 4, y - 4); c.lineTo(56 - i * 4, y + 8); c.closePath(); c.fill(); stroke(c); } },
  coins(c) { for (const [x, y] of [[24, 42], [38, 40], [30, 28]]) { c.fillStyle = grad(c, x - 10, y - 10, x + 10, y + 10, '#fff1a0', '#b8860b'); c.beginPath(); c.ellipse(x, y, 12, 10, 0, 0, 7); c.fill(); stroke(c); c.strokeStyle = '#8a6508'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, 7, 6, 0, 0, 7); c.stroke(); } },
  sword(c) { c.save(); c.translate(32, 32); c.rotate(-0.78); c.fillStyle = metal(c); c.beginPath(); c.moveTo(-3, -26); c.lineTo(0, -30); c.lineTo(3, -26); c.lineTo(3, 12); c.lineTo(-3, 12); c.closePath(); c.fill(); stroke(c, 1.5); c.fillStyle = '#c9a33f'; c.fillRect(-11, 12, 22, 4); c.fillStyle = '#5a3a1a'; c.fillRect(-2.5, 16, 5, 11); c.fillStyle = '#c9a33f'; c.beginPath(); c.arc(0, 29, 3.5, 0, 7); c.fill(); c.restore(); },
  shield(c) { c.fillStyle = grad(c, 0, 0, 64, 64, '#d64a3a', '#7a1a12'); c.beginPath(); c.moveTo(12, 12); c.lineTo(52, 12); c.lineTo(52, 32); c.quadraticCurveTo(50, 50, 32, 58); c.quadraticCurveTo(14, 50, 12, 32); c.closePath(); c.fill(); stroke(c, 2.5); c.fillStyle = '#e8c04a'; c.fillRect(29, 14, 6, 40); c.fillRect(14, 28, 36, 6); },
  axe(c) { handle(c, 16, 54, 44, 14); c.fillStyle = metal(c); c.beginPath(); c.moveTo(38, 10); c.quadraticCurveTo(58, 12, 56, 32); c.lineTo(44, 24); c.closePath(); c.fill(); stroke(c); },
  saw(c) { c.fillStyle = metal(c); c.beginPath(); c.moveTo(10, 30); c.lineTo(50, 22); c.lineTo(50, 34); c.lineTo(10, 40); c.closePath(); c.fill(); stroke(c); c.fillStyle = '#6a7580'; for (let x = 12; x < 48; x += 5) { c.beginPath(); c.moveTo(x, 40 - (x - 10) * 0.15); c.lineTo(x + 2.5, 44 - (x - 10) * 0.15); c.lineTo(x + 5, 39 - (x - 10) * 0.15); c.fill(); } c.fillStyle = '#9b6a36'; rr(c, 46, 18, 12, 20, 4); c.fill(); stroke(c, 1.5); },
  pickaxe(c) { handle(c, 32, 58, 32, 16); c.fillStyle = metal(c); c.beginPath(); c.moveTo(8, 22); c.quadraticCurveTo(32, 6, 56, 22); c.quadraticCurveTo(32, 14, 8, 22); c.fill(); stroke(c); },
  hammer(c) { handle(c, 22, 56, 40, 20); c.fillStyle = metal(c); c.save(); c.translate(42, 18); c.rotate(0.45); rr(c, -14, -7, 28, 14, 2); c.fill(); stroke(c); c.restore(); },
  shovel(c) { handle(c, 44, 8, 30, 38); c.fillStyle = metal(c); c.beginPath(); c.moveTo(24, 34); c.lineTo(38, 40); c.lineTo(30, 58); c.lineTo(16, 50); c.closePath(); c.fill(); stroke(c); },
  crucible(c) { c.fillStyle = grad(c, 0, 20, 0, 56, '#9a8f86', '#433c36'); c.beginPath(); c.moveTo(14, 22); c.lineTo(50, 22); c.lineTo(44, 54); c.lineTo(20, 54); c.closePath(); c.fill(); stroke(c); c.fillStyle = '#ff9a2a'; c.beginPath(); c.ellipse(32, 22, 18, 5, 0, 0, 7); c.fill(); stroke(c, 1); },
  rod(c) { c.strokeStyle = '#8a5a2a'; c.lineWidth = 3; c.beginPath(); c.moveTo(12, 56); c.quadraticCurveTo(30, 20, 56, 10); c.stroke(); c.strokeStyle = '#ddd'; c.lineWidth = 1; c.beginPath(); c.moveTo(56, 10); c.lineTo(52, 48); c.stroke(); c.fillStyle = '#d33'; c.beginPath(); c.arc(52, 48, 3, 0, 7); c.fill(); },
  scythe(c) { handle(c, 20, 58, 38, 10, 4); c.fillStyle = metal(c); c.beginPath(); c.moveTo(38, 10); c.quadraticCurveTo(14, 4, 6, 22); c.quadraticCurveTo(20, 12, 38, 16); c.closePath(); c.fill(); stroke(c); },
  cleaver(c) { handle(c, 16, 54, 28, 38, 6); c.fillStyle = metal(c); c.beginPath(); c.moveTo(24, 40); c.lineTo(50, 14); c.lineTo(58, 26); c.lineTo(32, 48); c.closePath(); c.fill(); stroke(c); },
  rollingpin(c) { c.fillStyle = grad(c, 0, 24, 0, 40, '#e8c58f', '#a57a45'); rr(c, 16, 24, 32, 16, 6); c.fill(); stroke(c); handle(c, 6, 32, 16, 32, 5); handle(c, 48, 32, 58, 32, 5); },
  bow(c) { c.strokeStyle = '#7a4a1e'; c.lineWidth = 4; c.beginPath(); c.arc(8, 32, 30, -1.05, 1.05); c.stroke(); c.strokeStyle = '#ddd'; c.lineWidth = 1; c.beginPath(); c.moveTo(23, 6); c.lineTo(23, 58); c.stroke(); c.strokeStyle = '#6b4a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(12, 32); c.lineTo(56, 32); c.stroke(); c.fillStyle = '#aaa'; c.beginPath(); c.moveTo(58, 32); c.lineTo(50, 28); c.lineTo(50, 36); c.fill(); },
  tongs(c) { c.strokeStyle = '#555c66'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(14, 56); c.lineTo(38, 20); c.lineTo(44, 10); c.moveTo(26, 58); c.lineTo(38, 20); c.lineTo(50, 12); c.stroke(); c.fillStyle = '#333'; c.beginPath(); c.arc(38, 20, 3, 0, 7); c.fill(); },
  bh_flag(c) { c.fillStyle = '#5b3a1a'; c.fillRect(28, 12, 4, 44); c.fillStyle = '#e8d24a'; c.beginPath(); c.moveTo(32, 12); c.lineTo(54, 18); c.lineTo(32, 26); c.fill(); stroke(c, 1.5); },
  bh_small(c) { house(c, 20, 32, 24, 20, '#d0a23a'); },
  bh_medium(c) { house(c, 14, 30, 36, 24, '#d06a2a'); },
  bh_large(c) { c.fillStyle = grad(c, 0, 20, 0, 58, '#e4dccb', '#a79f8d'); c.fillRect(10, 26, 44, 30); c.fillRect(8, 14, 12, 42); c.fillRect(44, 14, 12, 42); for (const x of [8, 14, 44, 50]) c.fillRect(x, 10, 5, 5); c.strokeStyle = '#3a2a18'; c.lineWidth = 2; c.strokeRect(10, 26, 44, 30); c.strokeRect(8, 14, 12, 42); c.strokeRect(44, 14, 12, 42); c.fillStyle = '#4a2c15'; c.beginPath(); c.arc(32, 46, 7, Math.PI, 0); c.lineTo(39, 56); c.lineTo(25, 56); c.fill(); c.fillStyle = '#c33'; c.fillRect(32, 6, 2, 16); c.beginPath(); c.moveTo(34, 6); c.lineTo(44, 10); c.lineTo(34, 14); c.fill(); },
  bh_mine(c) { c.fillStyle = grad(c, 0, 10, 0, 60, '#9a8f84', '#4b443d'); c.beginPath(); c.moveTo(6, 58); c.lineTo(32, 10); c.lineTo(58, 58); c.closePath(); c.fill(); stroke(c); c.fillStyle = '#1d140c'; c.beginPath(); c.arc(32, 50, 10, Math.PI, 0); c.lineTo(42, 58); c.lineTo(22, 58); c.fill(); c.strokeStyle = '#8a5a2a'; c.lineWidth = 3; c.beginPath(); c.moveTo(21, 58); c.lineTo(21, 40); c.lineTo(43, 40); c.lineTo(43, 58); c.stroke(); },
  res_none(c) { sign(c, null); c.strokeStyle = '#c22'; c.lineWidth = 4; c.beginPath(); c.moveTo(22, 12); c.lineTo(42, 32); c.moveTo(42, 12); c.lineTo(22, 32); c.stroke(); },
  res_coal(c) { sign(c, '#222'); }, res_iron(c) { sign(c, '#b36a45'); }, res_gold(c) { sign(c, '#f2c230'); }, res_granite(c) { sign(c, '#c9c9c0'); }, res_water(c) { sign(c, '#3a8ee0'); },
  donkey(c) { c.fillStyle = grad(c, 0, 16, 0, 48, '#9c8a78', '#5d5044'); c.beginPath(); c.ellipse(30, 34, 17, 10, 0, 0, 7); c.fill(); stroke(c); c.beginPath(); c.ellipse(50, 22, 7, 5, -0.6, 0, 7); c.fill(); stroke(c); c.fillRect(44, 22, 5, 12); c.fillStyle = '#5d5044'; for (const x of [16, 22, 36, 42]) c.fillRect(x, 40, 4, 16); c.beginPath(); c.moveTo(50, 16); c.lineTo(48, 6); c.lineTo(53, 14); c.fill(); },
  soldier(c) { c.fillStyle = '#d6b089'; c.beginPath(); c.arc(32, 20, 8, 0, 7); c.fill(); stroke(c, 1.2); c.fillStyle = metal(c); c.beginPath(); c.arc(32, 17, 9, Math.PI, 0); c.fill(); stroke(c, 1.2); c.fillStyle = '#c22'; c.fillRect(30, 4, 4, 6); c.fillStyle = '#b3352a'; rr(c, 22, 28, 20, 22, 4); c.fill(); stroke(c); c.fillStyle = '#6a4a2a'; c.fillRect(24, 50, 6, 10); c.fillRect(34, 50, 6, 10); },
  carrier(c) { c.fillStyle = '#d6b089'; c.beginPath(); c.arc(32, 20, 8, 0, 7); c.fill(); stroke(c, 1.2); c.fillStyle = '#6d8f3a'; rr(c, 22, 28, 20, 22, 4); c.fill(); stroke(c); c.fillStyle = '#4a3a2a'; c.fillRect(24, 50, 6, 10); c.fillRect(34, 50, 6, 10); c.fillStyle = '#a8753f'; c.fillRect(20, 4, 24, 8); stroke(c, 1); },
  swords(c) { DRAW.sword(c); c.save(); c.translate(64, 0); c.scale(-1, 1); DRAW.sword(c); c.restore(); },
  star(c) { c.fillStyle = '#ffd84a'; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 26, a = i * Math.PI / 5 - Math.PI / 2; c.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); } c.closePath(); c.fill(); stroke(c); },
  road(c) { c.fillStyle = '#b08a5a'; c.beginPath(); c.moveTo(22, 60); c.lineTo(30, 4); c.lineTo(36, 4); c.lineTo(44, 60); c.fill(); stroke(c); c.strokeStyle = '#f3e4c0'; c.setLineDash([5, 5]); c.lineWidth = 2; c.beginPath(); c.moveTo(33, 8); c.lineTo(33, 58); c.stroke(); c.setLineDash([]); },
  geologist(c) { DRAW.hammer(c); c.fillStyle = '#ffd84a'; c.beginPath(); c.arc(16, 18, 6, 0, 7); c.fill(); stroke(c, 1); },
  scout(c) { DRAW.eye(c); },
  destroy(c) { c.fillStyle = '#ff7a2a'; c.beginPath(); c.moveTo(32, 6); c.quadraticCurveTo(52, 26, 46, 44); c.quadraticCurveTo(40, 58, 32, 58); c.quadraticCurveTo(18, 58, 16, 44); c.quadraticCurveTo(14, 30, 26, 22); c.quadraticCurveTo(26, 34, 32, 36); c.quadraticCurveTo(28, 20, 32, 6); c.fill(); stroke(c); c.fillStyle = '#ffe07a'; c.beginPath(); c.ellipse(32, 46, 7, 9, 0, 0, 7); c.fill(); },
  stop(c) { c.fillStyle = '#c22'; c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; c.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); } c.closePath(); c.fill(); stroke(c); c.fillStyle = '#fff'; c.fillRect(20, 28, 24, 8); },
  play(c) { c.fillStyle = '#3a3'; c.beginPath(); c.moveTo(20, 12); c.lineTo(50, 32); c.lineTo(20, 52); c.closePath(); c.fill(); stroke(c); },
  eye(c) { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(32, 32, 24, 13, 0, 0, 7); c.fill(); stroke(c); c.fillStyle = '#3a6ea8'; c.beginPath(); c.arc(32, 32, 9, 0, 7); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.arc(32, 32, 4, 0, 7); c.fill(); },
  up(c) { c.fillStyle = '#4a4'; c.beginPath(); c.moveTo(32, 10); c.lineTo(54, 38); c.lineTo(10, 38); c.closePath(); c.fill(); stroke(c); c.fillRect(24, 38, 16, 16); },
  down(c) { c.fillStyle = '#c44'; c.beginPath(); c.moveTo(32, 54); c.lineTo(54, 26); c.lineTo(10, 26); c.closePath(); c.fill(); stroke(c); c.fillRect(24, 10, 16, 16); },
};
function sign(c, col) {
  c.fillStyle = '#6b4520'; c.fillRect(30, 30, 4, 30);
  c.fillStyle = grad(c, 0, 4, 0, 40, '#d9b27a', '#8f6535'); rr(c, 14, 4, 36, 30, 3); c.fill(); stroke(c);
  if (col) { c.fillStyle = col; c.beginPath(); c.arc(32, 19, 10, 0, 7); c.fill(); stroke(c, 1.5); }
}

let atlas = null;
export function getIconAtlas() {
  if (atlas) return atlas;
  const rows = Math.ceil(ICONS.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * ICON_SIZE; cv.height = 8 * ICON_SIZE;
  const c = cv.getContext('2d');
  ICONS.forEach((k, i) => {
    c.save(); c.translate((i % COLS) * ICON_SIZE, Math.floor(i / COLS) * ICON_SIZE);
    c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 3; c.shadowOffsetY = 1.5;
    (DRAW[k] || (() => {}))(c);
    c.restore();
  });
  atlas = { canvas: cv, cols: COLS, rows: 8, size: ICON_SIZE, urls: {} };
  return atlas;
}
export function iconUV(name) {
  const i = ICON_INDEX[name] ?? 0;
  return [(i % COLS) / COLS, 1 - (Math.floor(i / COLS) + 1) / 8, 1 / COLS, 1 / 8];
}
export function iconURL(name) {
  const a = getIconAtlas();
  if (a.urls[name]) return a.urls[name];
  const i = ICON_INDEX[name]; if (i === undefined) return '';
  const cv = document.createElement('canvas'); cv.width = cv.height = ICON_SIZE;
  cv.getContext('2d').drawImage(a.canvas, (i % COLS) * ICON_SIZE, Math.floor(i / COLS) * ICON_SIZE, ICON_SIZE, ICON_SIZE, 0, 0, ICON_SIZE, ICON_SIZE);
  return (a.urls[name] = cv.toDataURL());
}
