// The one websocket to the multiplayer server: connects, says hello, reconnects with backoff and
// hands every message to whoever registered for its type. The token the server gives out is kept
// in localStorage, so a reloaded page (or a dropped connection) gets its seat in a running game back.

const LS_TOKEN = 'settlers.mp.token', LS_NAME = 'settlers.mp.name';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class Net {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
    this.status = 'idle'; // idle | connecting | online | offline
    this.want = false;
    this.retry = 0;
    this.token = store.get(LS_TOKEN) || null;
    this.named = !!store.get(LS_NAME); // has this browser picked a name before?
    this.name = store.get(LS_NAME) || `Legatus ${100 + Math.floor(Math.random() * 900)}`;
    this.me = null;
    this.resumeTurn = null; // () => last turn this page has, while it is in a game
    this.on('welcome', (m) => { this.token = m.token; this.me = m.you; store.set(LS_TOKEN, m.token); });
  }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  emit(type, m) { for (const fn of this.handlers.get(type) || []) { try { fn(m); } catch (e) { console.error(`net ${type} handler`, e); } } }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }

  get url() { const u = new URL('net', location.href); u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; return u; }

  connect() {
    this.want = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.setStatus('offline'); this.schedule(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const turn = this.resumeTurn ? this.resumeTurn() : null;
      this.raw({ type: 'hello', name: this.name, token: this.token || undefined, turn: turn ?? undefined });
      this.setStatus('online');
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.raw({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.type) this.emit(m.type, m); };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('offline');
      this.emit('closed', {});
      this.schedule();
    };
  }

  schedule() {
    if (!this.want) return;
    clearTimeout(this.timer);
    const wait = Math.min(10000, 800 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), wait);
  }

  disconnect() {
    this.want = false; clearTimeout(this.timer); clearInterval(this.pinger);
    const ws = this.ws; this.ws = null;
    if (ws) ws.close();
    this.setStatus('idle');
  }

  raw(m) { if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  send(type, fields = {}) { return this.raw(Object.assign({ type }, fields)); }

  setName(name) {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return;
    this.name = name; this.named = true; store.set(LS_NAME, name);
    this.send('name', { name });
  }
}
