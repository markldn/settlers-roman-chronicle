// All sound is synthesized: SFX are rendered once into AudioBuffers with OfflineAudioContext,
// ambience is procedural noise + chirps, and music is a lookahead-scheduled medieval ensemble
// (plucked lute, recorder, bowed drone, frame drum) playing composed and generated tunes.

const SR = 44100;
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function noiseBuf(ctx, dur, color = 'white') {
  const b = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
  let l = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'brown') { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
    else if (color === 'pink') { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 1.8; }
    else d[i] = w;
  }
  return b;
}
function env(g, t, a, peak, decay, sustain = 0.0001) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + decay);
}

// ---------------------------------------------------------------- SFX recipes (offline)
const RECIPES = {
  chop(c) { const t = 0; const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.3); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2; const g = c.createGain(); env(g.gain ? g : g, t, 0.002, 0.9, 0.12); n.connect(f).connect(g).connect(c.destination); n.start();
    const o = c.createOscillator(); o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12); const g2 = c.createGain(); env(g2, t, 0.002, 0.8, 0.14); o.connect(g2).connect(c.destination); o.start(); o.stop(0.3); return 0.35; },
  treeFall(c) {
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 2.2, 'pink'); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, 0); f.frequency.linearRampToValueAtTime(900, 1.2); const g = c.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.4, 0.9); g.gain.linearRampToValueAtTime(0.0001, 1.25); n.connect(f).connect(g).connect(c.destination); n.start();
    const n2 = c.createBufferSource(); n2.buffer = noiseBuf(c, 1.2, 'brown'); const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, 0); g2.gain.setValueAtTime(0.0001, 1.25); g2.gain.exponentialRampToValueAtTime(1.0, 1.27); g2.gain.exponentialRampToValueAtTime(0.0001, 2.1); const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 500; n2.connect(f2).connect(g2).connect(c.destination); n2.start();
    // leaves rustle
    const n3 = c.createBufferSource(); n3.buffer = noiseBuf(c, 2.2); const f3 = c.createBiquadFilter(); f3.type = 'highpass'; f3.frequency.value = 4000; const g3 = c.createGain(); g3.gain.setValueAtTime(0.0001, 1.2); g3.gain.exponentialRampToValueAtTime(0.25, 1.3); g3.gain.exponentialRampToValueAtTime(0.0001, 2.1); n3.connect(f3).connect(g3).connect(c.destination); n3.start();
    return 2.2; },
  saw(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.9); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 2; const g = c.createGain(); g.gain.value = 0; for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(0.0001, k * 0.28); g.gain.linearRampToValueAtTime(0.5, k * 0.28 + 0.08); g.gain.linearRampToValueAtTime(0.0001, k * 0.28 + 0.26); } const lfo = c.createOscillator(); lfo.frequency.value = 40; const lg = c.createGain(); lg.gain.value = 800; lfo.connect(lg).connect(f.frequency); lfo.start(); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.9; },
  hammer(c) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(1400, 0); o.frequency.exponentialRampToValueAtTime(600, 0.05); const g = c.createGain(); env(g, 0, 0.001, 0.5, 0.08); o.connect(g).connect(c.destination); o.start(); o.stop(0.2);
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.1); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; const g2 = c.createGain(); env(g2, 0, 0.001, 0.8, 0.05); n.connect(f).connect(g2).connect(c.destination); n.start(); return 0.25; },
  pick(c) { for (const [fr, a] of [[2600, 0.3], [3900, 0.2], [5200, 0.12]]) { const o = c.createOscillator(); o.frequency.value = fr * (0.95 + rnd() * 0.1); const g = c.createGain(); env(g, 0, 0.001, a, 0.12); o.connect(g).connect(c.destination); o.start(); o.stop(0.2); }
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.12); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; const g = c.createGain(); env(g, 0, 0.001, 0.5, 0.06); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.25; },
  anvil(c) { for (const [fr, a, d] of [[820, 0.4, 1.2], [1260, 0.3, 0.9], [2210, 0.2, 0.6], [3310, 0.1, 0.4]]) { const o = c.createOscillator(); o.frequency.value = fr; const g = c.createGain(); env(g, 0, 0.001, a, d); o.connect(g).connect(c.destination); o.start(); o.stop(d + 0.1); } return 1.3; },
  dig(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.4, 'brown'); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.8; const g = c.createGain(); env(g, 0, 0.02, 0.9, 0.3); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.45; },
  splash(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.8); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, 0); f.frequency.exponentialRampToValueAtTime(400, 0.6); const g = c.createGain(); env(g, 0, 0.005, 0.6, 0.6); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.8; },
  bow(c) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(260, 0); o.frequency.exponentialRampToValueAtTime(180, 0.3); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200; const g = c.createGain(); env(g, 0, 0.002, 0.4, 0.3); o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(0.4);
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.35); const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.setValueAtTime(3000, 0.05); f2.frequency.exponentialRampToValueAtTime(800, 0.35); const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, 0.04); g2.gain.exponentialRampToValueAtTime(0.25, 0.06); g2.gain.exponentialRampToValueAtTime(0.0001, 0.35); n.connect(f2).connect(g2).connect(c.destination); n.start(); return 0.45; },
  clash(c) { for (let k = 0; k < 6; k++) { const o = c.createOscillator(); o.type = k % 2 ? 'square' : 'sine'; o.frequency.value = 1800 + rnd() * 3600; const g = c.createGain(); env(g, 0, 0.001, 0.12, 0.25 + rnd() * 0.3); o.connect(g).connect(c.destination); o.start(); o.stop(0.7); }
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.2); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000; const g = c.createGain(); env(g, 0, 0.001, 0.6, 0.1); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.7; },
  thud(c) { const o = c.createOscillator(); o.frequency.setValueAtTime(140, 0); o.frequency.exponentialRampToValueAtTime(50, 0.2); const g = c.createGain(); env(g, 0, 0.002, 0.9, 0.25); o.connect(g).connect(c.destination); o.start(); o.stop(0.35);
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.2, 'brown'); const g2 = c.createGain(); env(g2, 0, 0.002, 0.8, 0.15); n.connect(g2).connect(c.destination); n.start(); return 0.35; },
  grunt(c) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(150, 0); o.frequency.exponentialRampToValueAtTime(90, 0.45); const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 600; f1.Q.value = 5; const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 6; const g = c.createGain(); env(g, 0, 0.03, 0.8, 0.4); o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(c.destination); o.start(); o.stop(0.5); return 0.5; },
  horn(c) { const notes = [[0, 0.35, 196], [0.4, 0.8, 294]]; for (const [t, d, fr] of notes) { for (const det of [0, 3]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(2200, t + 0.12); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.08); g.gain.setValueAtTime(0.22, t + d - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.05); } } return 1.3; },
  fanfare(c) { const seq = [[0, 0.14, 392], [0.15, 0.14, 494], [0.3, 0.14, 587], [0.45, 0.5, 784]]; for (const [t, d, fr] of seq) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.03); g.gain.setValueAtTime(0.16, t + d - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.05); } return 1.1; },
  victory(c) { const seq = [[0, 0.2, 392], [0.22, 0.2, 392], [0.44, 0.2, 392], [0.66, 0.6, 523], [1.3, 0.3, 494], [1.62, 0.3, 523], [1.95, 1.0, 659]]; for (const [t, d, fr] of seq) for (const m of [1, 1.5]) { const o = c.createOscillator(); o.type = m === 1 ? 'sawtooth' : 'triangle'; o.frequency.value = fr * m; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(m === 1 ? 0.14 : 0.06, t + 0.04); g.gain.setValueAtTime(m === 1 ? 0.14 : 0.06, t + d - 0.06); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.05); } return 3.1; },
  defeat(c) { const seq = [[0, 0.5, 294], [0.5, 0.5, 277], [1.0, 0.5, 262], [1.5, 1.4, 196]]; for (const [t, d, fr] of seq) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.06); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.05); } return 3; },
  bell(c) { for (const [fr, a, d] of [[1046, 0.25, 1.4], [2093, 0.1, 0.8], [2637, 0.06, 0.5]]) { const o = c.createOscillator(); o.frequency.value = fr; const g = c.createGain(); env(g, 0, 0.002, a, d); o.connect(g).connect(c.destination); o.start(); o.stop(d + 0.1); } return 1.5; },
  coin(c) { for (let k = 0; k < 4; k++) { const t = k * 0.07; const o = c.createOscillator(); o.frequency.value = 3000 + rnd() * 1500; const g = c.createGain(); env(g, t, 0.001, 0.15, 0.2); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.3); } return 0.6; },
  creak(c) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, 0); o.frequency.linearRampToValueAtTime(130, 0.5); o.frequency.linearRampToValueAtTime(100, 0.9); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 8; const g = c.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.25, 0.3); g.gain.linearRampToValueAtTime(0.0001, 0.95); o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(1); return 1; },
  fire(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 1.2, 'brown'); const g = c.createGain(); g.gain.value = 0.4; n.connect(g).connect(c.destination); n.start(); for (let k = 0; k < 14; k++) { const t = rnd() * 1.1; const nn = c.createBufferSource(); nn.buffer = noiseBuf(c, 0.02); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000; const gg = c.createGain(); env(gg, t, 0.001, 0.4, 0.015); nn.connect(f).connect(gg).connect(c.destination); nn.start(t); } return 1.2; },
  oink(c) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(260, 0); o.frequency.linearRampToValueAtTime(200, 0.18); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3; const g = c.createGain(); env(g, 0, 0.01, 0.5, 0.18); const lfo = c.createOscillator(); lfo.frequency.value = 30; const lg = c.createGain(); lg.gain.value = 40; lfo.connect(lg).connect(o.frequency); lfo.start(); o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(0.25); return 0.3; },
  hoof(c) { for (let k = 0; k < 4; k++) { const t = k * 0.13 + (k % 2) * 0.03; const o = c.createOscillator(); o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.04); const g = c.createGain(); env(g, t, 0.001, 0.4, 0.05); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.1); } return 0.65; },
  water(c) { for (let k = 0; k < 5; k++) { const t = k * 0.09 + rnd() * 0.05; const o = c.createOscillator(); o.frequency.setValueAtTime(500 + rnd() * 400, t); o.frequency.exponentialRampToValueAtTime(1500 + rnd() * 600, t + 0.05); const g = c.createGain(); env(g, t, 0.002, 0.15, 0.05); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.1); } return 0.6; },
  click(c) { const o = c.createOscillator(); o.frequency.value = 1800; const g = c.createGain(); env(g, 0, 0.001, 0.25, 0.03); o.connect(g).connect(c.destination); o.start(); o.stop(0.06); return 0.07; },
  error(c) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 140; const g = c.createGain(); env(g, 0, 0.005, 0.18, 0.2); o.connect(g).connect(c.destination); o.start(); o.stop(0.25); return 0.25; },
  flag(c) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(700, 0); o.frequency.exponentialRampToValueAtTime(350, 0.08); const g = c.createGain(); env(g, 0, 0.001, 0.4, 0.1); o.connect(g).connect(c.destination); o.start(); o.stop(0.15); return 0.15; },
  road(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.4); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; const g = c.createGain(); for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(0.0001, k * 0.11); g.gain.exponentialRampToValueAtTime(0.35, k * 0.11 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, k * 0.11 + 0.09); } n.connect(f).connect(g).connect(c.destination); n.start(); return 0.4; },
  drumroll(c) { for (let k = 0; k < 10; k++) { const t = k * 0.05; const o = c.createOscillator(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.05); const g = c.createGain(); env(g, t, 0.001, 0.2 + k * 0.03, 0.06); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.1); } return 0.7; },
  chime(c) { [659, 784, 1046].forEach((fr, k) => { const t = k * 0.1; const o = c.createOscillator(); o.frequency.value = fr; const g = c.createGain(); env(g, t, 0.002, 0.18, 0.7); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.8); }); return 1.1; },
  pickup(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.08); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; const g = c.createGain(); env(g, 0, 0.002, 0.2, 0.06); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.1; },
  scythe(c) { const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.4); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(2000, 0); f.frequency.exponentialRampToValueAtTime(6000, 0.25); f.Q.value = 2; const g = c.createGain(); env(g, 0, 0.05, 0.4, 0.25); n.connect(f).connect(g).connect(c.destination); n.start(); return 0.4; },
  catapult(c) { const o = c.createOscillator(); o.frequency.setValueAtTime(80, 0); o.frequency.exponentialRampToValueAtTime(40, 0.3); const g = c.createGain(); env(g, 0, 0.005, 0.9, 0.3); o.connect(g).connect(c.destination); o.start(); o.stop(0.4); const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.8); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(600, 0.05); f.frequency.exponentialRampToValueAtTime(2500, 0.6); const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, 0.05); g2.gain.exponentialRampToValueAtTime(0.25, 0.15); g2.gain.exponentialRampToValueAtTime(0.0001, 0.7); n.connect(f).connect(g2).connect(c.destination); n.start(); return 0.8; },
};

// game event -> sfx name (+ volume)
const EVENT_SFX = {
  chop: ['chop', 0.8], treeFall: ['treeFall', 1], saw: ['saw', 0.35], hammer: ['hammer', 0.6], pick: ['pick', 0.5], anvil: ['anvil', 0.35], dig: ['dig', 0.5],
  splash: ['splash', 0.5], fish: ['splash', 0.15], bow: ['bow', 0.7], hit: ['clash', 0.6], parry: ['clash', 0.35], death: ['grunt', 0.7], fightStart: ['clash', 0.4],
  built: ['fanfare', 0.5], flagPlaced: ['flag', 0.7], roadBuilt: ['road', 0.7], sitePlaced: ['hammer', 0.5], mill: ['creak', 0.3], fire: ['fire', 0.35], oven: ['fire', 0.2],
  pig: ['oink', 0.4], hoof: ['hoof', 0.35], water: ['water', 0.3], coin: ['coin', 0.4], promote: ['chime', 0.6], recruit: ['drumroll', 0.4], capture: ['fanfare', 0.8],
  burn: ['fire', 0.8], scythe: ['scythe', 0.4], sow: ['dig', 0.3], cut: ['chop', 0.4], catapult: ['catapult', 0.8], impact: ['thud', 1], occupied: ['chime', 0.5], brew: ['water', 0.2],
  pickup: ['pickup', 0.25], drop: ['pickup', 0.2], sign: ['flag', 0.3],
};

export class Audio {
  constructor() {
    this.ctx = null; this.buffers = {}; this.enabled = true;
    this.vol = { master: 0.8, music: 0.45, sfx: 0.8, amb: 0.5 };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem('settlers.audio') || '{}')); } catch { /* ignore */ }
    this.lastPlay = {};
    this.listener = { x: 0, z: 0, dist: 16, w: 30 };
  }
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.vol.music; this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = this.vol.amb; this.amb.connect(this.master);
    // procedural reverb IR
    this.reverb = c.createConvolver();
    const len = c.sampleRate * 2.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 800 ? i / 800 : 1); }
    this.reverb.buffer = ir;
    this.revGain = c.createGain(); this.revGain.gain.value = 0.35; this.reverb.connect(this.revGain).connect(this.master);
    await this.renderSfx();
    this.startAmbience();
    this.musicPlayer = new MusicPlayer(c, this.music, this.reverb);
    if (this.vol.music > 0) this.musicPlayer.start();
  }
  async renderSfx() {
    const jobs = Object.entries(RECIPES).map(async ([k, fn]) => {
      const dur = 3.2;
      const oc = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
      const real = fn(oc) || 1;
      const buf = await oc.startRendering();
      // trim to the recipe's reported length
      const n = Math.min(buf.length, Math.ceil(SR * (real + 0.05)));
      const out = this.ctx.createBuffer(1, n, SR); out.copyToChannel(buf.getChannelData(0).subarray(0, n), 0);
      this.buffers[k] = out;
    });
    await Promise.all(jobs);
  }
  setVolume(k, v) {
    this.vol[k] = v;
    try { localStorage.setItem('settlers.audio', JSON.stringify(this.vol)); } catch { /* ignore */ }
    if (!this.ctx) return;
    ({ master: this.master, music: this.music, sfx: this.sfx, amb: this.amb })[k].gain.value = v;
    if (k === 'music' && this.musicPlayer) { if (v > 0 && !this.musicPlayer.running) this.musicPlayer.start(); }
  }
  play(name, vol = 1, pan = 0, rate = 1) {
    if (!this.ctx || !this.buffers[name]) return;
    const now = this.ctx.currentTime;
    // avoid machine-gunning the same sample
    if (this.lastPlay[name] && now - this.lastPlay[name] < 0.06) return;
    this.lastPlay[name] = now;
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers[name]; s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(g).connect(p).connect(this.sfx);
    const rs = this.ctx.createGain(); rs.gain.value = 0.15; p.connect(rs).connect(this.reverb);
    s.start();
  }
  ui(name) { this.play(name, 0.6); }
  // positional play relative to the camera
  playAt(name, x, z, vol = 1) {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    const range = L.dist * 0.9 + 4;
    if (d > range) return;
    const zoomK = Math.max(0.25, Math.min(1, 14 / L.dist));
    const v = vol * (1 - d / range) ** 1.5 * zoomK;
    if (v < 0.02) return;
    this.play(name, v, dx / range * 1.2);
  }
  onEvents(events, game, humanId) {
    if (!this.ctx) return;
    const g = game.grid;
    for (const e of events) {
      if (e.type === 'msg' && e.p === humanId) { this.play(e.kind === 'war' ? 'horn' : 'bell', e.kind === 'war' ? 0.6 : 0.35); continue; }
      if (e.type === 'defeated') { this.play(e.p === humanId ? 'defeat' : 'victory', 0.7); continue; }
      const m = EVENT_SFX[e.type]; if (!m || e.node < 0) continue;
      this.playAt(m[0], g.wx(e.node), g.wz(e.node), m[1]);
    }
  }
  // ambience driven by what the camera sees
  startAmbience() {
    const c = this.ctx;
    const mk = (color, type, freq, q) => { const s = c.createBufferSource(); s.buffer = noiseBuf(c, 4, color); s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(this.amb); s.start(); return { g, f }; };
    this.windA = mk('pink', 'bandpass', 500, 0.6);
    this.waterA = mk('brown', 'lowpass', 700, 0.5);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 250; lfo.connect(lg).connect(this.windA.f.frequency); lfo.start();
    this.birdT = 0; this.mix = { grass: 0.5, water: 0, mountain: 0 };
  }
  updateAmbience(dt, mix) {
    if (!this.ctx) return;
    this.mix = mix;
    const t = this.ctx.currentTime;
    const zoomK = Math.max(0.3, Math.min(1, 16 / this.listener.dist));
    this.windA.g.gain.setTargetAtTime(0.05 + mix.mountain * 0.25 + (1 - zoomK) * 0.08, t, 1);
    this.waterA.g.gain.setTargetAtTime(mix.water * 0.35 * zoomK, t, 1);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 0.4 + Math.random() * (3.5 - mix.grass * 2.5);
      if (mix.grass > 0.15 && !mix.winter) this.chirp(zoomK * mix.grass);
    }
  }
  chirp(v) {
    const c = this.ctx, t = c.currentTime, kind = Math.random();
    const n = 2 + Math.floor(Math.random() * 5), base = 2400 + Math.random() * 2400;
    const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8; p.connect(this.amb);
    for (let k = 0; k < n; k++) {
      const s = t + k * (0.07 + (kind > 0.5 ? 0.05 : 0)), o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(base * (kind > 0.5 ? 1 : 1.2), s); o.frequency.exponentialRampToValueAtTime(base * (kind > 0.5 ? 1.5 : 0.7), s + 0.05);
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.04 * v, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.06);
      o.connect(g).connect(p); o.start(s); o.stop(s + 0.08);
    }
  }
  setMood(m) { if (this.musicPlayer) this.musicPlayer.mood = m; }
}

// ---------------------------------------------------------------- music
const MODES = { dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], ionian: [0, 2, 4, 5, 7, 9, 11] };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Hand-written themes. Notes: scale degree (0-based, can exceed 7 for next octave, '-' rest), durations in beats.
const THEMES = [
  { name: 'The Settlers\' March', mode: 'ionian', root: 62, bpm: 104, chords: [0, 3, 4, 0, 5, 3, 4, 0], drum: 'march',
    mel: '4:1 4:.5 5:.5 6:1 4:1 | 3:1 2:1 1:2 | 2:1 3:.5 4:.5 5:1 3:1 | 4:1 3:1 2:2 | 4:1 4:.5 5:.5 6:1 7:1 | 8:1 7:.5 6:.5 5:2 | 4:1 5:1 3:1 1:1 | 0:4' },
  { name: 'Green Valley', mode: 'mixolydian', root: 60, bpm: 84, chords: [0, 6, 3, 0, 0, 6, 4, 0], drum: 'soft',
    mel: '0:1 2:1 4:1.5 5:.5 | 4:1 2:1 1:2 | 0:1 2:1 4:1 7:1 | 6:3 -:1 | 7:1 6:1 4:1.5 2:.5 | 3:1 2:1 1:2 | 2:1 4:1 3:1 1:1 | 0:4' },
  { name: 'Shepherd\'s Lament', mode: 'dorian', root: 62, bpm: 72, chords: [0, 6, 0, 4, 2, 6, 3, 0], drum: 'none',
    mel: '4:2 5:1 4:1 | 3:1 2:1 0:2 | 2:1 3:1 4:1 6:1 | 5:4 | 4:1 5:1 7:2 | 6:1 5:1 4:2 | 3:1 2:1 3:1 1:1 | 0:4' },
  { name: 'The Long Road', mode: 'aeolian', root: 64, bpm: 96, chords: [0, 5, 6, 0, 3, 5, 4, 0], drum: 'dance',
    mel: '0:.5 2:.5 4:1 4:.5 3:.5 2:1 | 1:.5 2:.5 3:1 1:2 | 2:.5 4:.5 6:1 6:.5 5:.5 4:1 | 5:.5 4:.5 3:.5 2:.5 4:2 | 7:1 6:.5 5:.5 4:1 2:1 | 3:1 4:.5 3:.5 1:2 | 2:1 4:1 3:.5 2:.5 1:1 | 0:4' },
];
function parseMel(s) { return s.replace(/\|/g, ' ').trim().split(/\s+/).map(tok => { const [d, l] = tok.split(':'); return { deg: d === '-' ? null : +d, len: +l }; }); }

// generative tune in the same style, seeded
function generateTheme(seedN) {
  let s = seedN; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const modes = Object.keys(MODES), mode = modes[Math.floor(r() * modes.length)];
  const progs = [[0, 3, 4, 0], [0, 6, 3, 4], [0, 5, 3, 4], [0, 4, 5, 3], [0, 6, 5, 6]];
  const p = progs[Math.floor(r() * progs.length)];
  const rhythms = [[1, 1, 1, 1], [1.5, .5, 1, 1], [.5, .5, 1, 2], [1, .5, .5, 2], [2, 1, 1], [1, 1, 2]];
  const phrase = () => { const out = []; let deg = 2 + Math.floor(r() * 3); for (let bar = 0; bar < 4; bar++) { const rh = rhythms[Math.floor(r() * rhythms.length)]; for (const l of rh) { deg = Math.max(0, Math.min(9, deg + Math.floor(r() * 5) - 2)); out.push({ deg, len: l }); } } out[out.length - 1] = { deg: 0, len: 2 }; out[out.length - 2].len = Math.max(1, out[out.length - 2].len); return out; };
  const A = phrase(), B = phrase();
  const mel = A.concat(B.map(n => ({ deg: Math.min(9, n.deg + 2), len: n.len })), A);
  // pad last bar to full
  return { name: 'Variation ' + (seedN % 97), mode, root: 57 + Math.floor(r() * 8), bpm: 76 + Math.floor(r() * 30), chords: p.concat(p, p), mel, drum: r() < 0.5 ? 'soft' : 'dance' };
}

class MusicPlayer {
  constructor(ctx, out, reverb) {
    this.ctx = ctx; this.out = out; this.reverb = reverb; this.running = false; this.mood = 'peace';
    this.queue = []; this.idx = Math.floor(Math.random() * THEMES.length); this.gen = 1;
    this.send = ctx.createGain(); this.send.gain.value = 0.5; this.send.connect(reverb);
    this.bus = ctx.createGain(); this.bus.gain.value = 0.9; this.bus.connect(out); this.bus.connect(this.send);
    this.noise = noiseBuf(ctx, 1);
  }
  start() { if (this.running) return; this.running = true; this.nextTime = this.ctx.currentTime + 0.5; this.loadNext(); this.timer = setInterval(() => this.tick(), 60); }
  stop() { this.running = false; clearInterval(this.timer); }
  loadNext() {
    let th;
    if (this.mood === 'war') th = THEMES[0];
    else if (this.idx % 3 === 2) th = generateTheme(this.gen++ * 7919 + 17);
    else th = THEMES[this.idx % THEMES.length];
    this.idx++;
    const mel = Array.isArray(th.mel) ? th.mel : parseMel(th.mel);
    this.cur = Object.assign({}, th, { notes: mel, pos: 0, beat: 0, scale: MODES[th.mode] });
    this.curBeatLen = 60 / th.bpm;
    this.repeat = 0;
    this.noteQueue = [];
    // melody timeline in beats
    let b = 0; for (const n of mel) { this.noteQueue.push({ b, n }); b += n.len; }
    this.totalBeats = Math.ceil(b / 4) * 4;
    this.beatCursor = 0; this.qi = 0;
    this.nowName = th.name;
  }
  pitch(deg, oct = 0) { const sc = this.cur.scale; const d = ((deg % 7) + 7) % 7, o = Math.floor(deg / 7); return this.cur.root + sc[d] + 12 * (o + oct); }
  tick() {
    if (!this.running) return;
    const ahead = this.ctx.currentTime + 0.25;
    while (this.nextTime < ahead) {
      const bl = this.curBeatLen, t = this.nextTime, beat = this.beatCursor;
      const cur = this.cur;
      // melody notes starting at this beat (lead instrument alternates per repeat)
      while (this.qi < this.noteQueue.length && this.noteQueue[this.qi].b < beat + 1 - 1e-6) {
        const { b, n } = this.noteQueue[this.qi++];
        if (n.deg === null) continue;
        const st = t + (b - beat) * bl, dur = n.len * bl;
        if (this.repeat % 2 === 0) this.recorder(mtof(this.pitch(n.deg, 1)), st, dur);
        else this.lute(mtof(this.pitch(n.deg, 1)), st, dur, 0.22);
      }
      // harmony: chord per bar (4 beats)
      const bar = Math.floor(beat / 4), chordDeg = cur.chords[bar % cur.chords.length];
      if (beat % 4 === 0) {
        this.drone(mtof(this.pitch(chordDeg, -2)), t, bl * 4);
        this.pad([chordDeg, chordDeg + 2, chordDeg + 4].map(d => mtof(this.pitch(d, 0))), t, bl * 4);
      }
      // lute arpeggio
      const arp = [0, 2, 4, 2, 7, 4, 2, 4];
      for (let k = 0; k < 2; k++) { const st = t + k * bl / 2; const d = chordDeg + arp[((beat % 4) * 2 + k) % 8]; this.lute(mtof(this.pitch(d, 0)), st, bl * 0.9, 0.09); }
      // percussion
      this.drum(cur.drum, beat % 4, t, bl);
      this.beatCursor++; this.nextTime += bl;
      if (this.beatCursor >= this.totalBeats) {
        this.repeat++;
        if (this.repeat >= 2) { this.nextTime += 6 + Math.random() * 8; this.loadNext(); }
        else { this.beatCursor = 0; this.qi = 0; }
      }
    }
  }
  lute(f, t, dur, vol) {
    const c = this.ctx, g = c.createGain(); g.connect(this.bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(2.2, dur * 2.5));
    const f1 = c.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.setValueAtTime(f * 8, t); f1.frequency.exponentialRampToValueAtTime(f * 2, t + 0.4); f1.connect(g);
    for (const [m, a, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.15, 'sine'], [1.003, 0.4, 'sawtooth']]) { const o = c.createOscillator(); o.type = type; o.frequency.value = f * m; const og = c.createGain(); og.gain.value = a * (type === 'sawtooth' ? 0.25 : 1); o.connect(og).connect(f1); o.start(t); o.stop(t + Math.min(2.3, dur * 2.6)); }
  }
  recorder(f, t, dur) {
    const c = this.ctx, g = c.createGain(); g.connect(this.bus);
    const a = Math.min(0.06, dur * 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13, t + a); g.gain.setValueAtTime(0.13, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur * 0.98);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; const g2 = c.createGain(); g2.gain.value = 0.15;
    const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.5, dur)); vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 4;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g);
    // breath
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2; const ng = c.createGain(); ng.gain.value = 0.05; n.connect(bp).connect(ng).connect(g);
    for (const x of [o, o2, vib, n]) { x.start(t); x.stop(t + dur + 0.05); }
  }
  pad(freqs, t, dur) {
    const c = this.ctx, g = c.createGain(); g.connect(this.bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.connect(g);
    for (const f of freqs) for (const det of [-6, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur * 1.1); }
  }
  drone(f, t, dur) {
    const c = this.ctx, g = c.createGain(); g.connect(this.bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.1); g.gain.linearRampToValueAtTime(0.06, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 0.02);
  }
  drum(style, b, t, bl) {
    if (style === 'none') return;
    const hit = (st, f0, vol, dec, noise = 0) => {
      const c = this.ctx;
      if (f0 > 0 && vol > 0) {
        const g = c.createGain(); g.connect(this.bus);
        const o = c.createOscillator(); o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * 0.5, st + dec);
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(vol, st + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, st + dec);
        o.connect(g); o.start(st); o.stop(st + dec + 0.05);
      }
      if (noise) { const n = c.createBufferSource(); n.buffer = this.noise; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000; const ng = c.createGain(); ng.gain.setValueAtTime(noise, st); ng.gain.exponentialRampToValueAtTime(0.0001, st + 0.08); n.connect(hp).connect(ng).connect(this.bus); n.start(st, Math.random() * 0.5); n.stop(st + 0.1); }
    };
    if (style === 'march') { hit(t, 110, 0.22, 0.25); if (b % 2 === 1) { hit(t + bl * 0.5, 180, 0.08, 0.1, 0.05); hit(t + bl * 0.75, 180, 0.08, 0.1, 0.05); } }
    else if (style === 'dance') { if (b === 0 || b === 2) hit(t, 95, 0.2, 0.3); hit(t + bl * 0.5, 0, 0, 0.01, 0.06); if (b === 3) hit(t + bl * 0.66, 150, 0.1, 0.15); }
    else if (style === 'soft') { if (b === 0) hit(t, 90, 0.14, 0.4); if (b === 2) hit(t, 130, 0.06, 0.2, 0.03); }
  }
}
