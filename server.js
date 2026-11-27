#!/usr/bin/env node
// שרת "שם קוד" - מצב אירוח על מחשב ביתי (למשל Mac mini + Tailscale).
// בלי תלויות: http + Server-Sent Events לדחיפת מצב, POST לפעולות. המצב נשמר בקובץ בדיסק.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('./game.js');
const WORDS = require('./words.js');

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.shem-kod');
const FILE = path.join(DATA_DIR, 'rooms.json');
const ROOM_TTL = 14 * 24 * 3600 * 1000;
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/game.js': ['game.js', 'text/javascript; charset=utf-8'],
  '/words.js': ['words.js', 'text/javascript; charset=utf-8'],
  '/vendor/peerjs.min.js': ['vendor/peerjs.min.js', 'text/javascript; charset=utf-8']
};

const rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const rooms = new Map(); // code -> { state, streams: Map(pid -> Set(res)), touched }

// ---------- שמירה לדיסק ----------
function loadRooms() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const now = Date.now();
    for (const [code, r] of Object.entries(data)) {
      if (r && r.state && now - (r.touched || 0) < ROOM_TTL) rooms.set(code, { state: r.state, streams: new Map(), touched: r.touched || now });
    }
  } catch (e) { if (e.code !== 'ENOENT') console.error('שגיאה בטעינת', FILE, e.message); }
}
let saveT = null;
function scheduleSave() {
  if (saveT) return;
  saveT = setTimeout(() => {
    saveT = null;
    const out = {};
    for (const [code, r] of rooms) out[code] = { state: r.state, touched: r.touched };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('שגיאה בשמירה:', e.message); }
  }, 150);
}
function flushSave() { if (saveT) { clearTimeout(saveT); saveT = null; } const out = {}; for (const [c, r] of rooms) out[c] = { state: r.state, touched: r.touched }; try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(out)); } catch (e) {} }

// ---------- חדרים ----------
function makeCode() {
  for (let n = 0; n < 200; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ABC[crypto.randomInt(0, CODE_ABC.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const validPid = p => typeof p === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(p);
const validCode = c => typeof c === 'string' && /^[A-Z0-9]{4}$/.test(c);

function onlineOf(room) {
  return { has: pid => { const s = room.streams.get(pid); return !!(s && s.size); } };
}
function sse(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}
function broadcast(room) {
  room.touched = Date.now();
  const on = onlineOf(room);
  for (const [pid, set] of room.streams) {
    if (!set.size) continue;
    const view = G.viewFor(room.state, pid, on);
    if (view) for (const res of set) sse(res, 'state', view);
  }
  scheduleSave();
}
function sendTo(room, pid, event, data) {
  const set = room.streams.get(pid);
  if (set) for (const res of set) sse(res, event, data);
}
function dropStreams(room, pid) {
  const set = room.streams.get(pid);
  if (set) for (const res of set) { try { res.end(); } catch (e) {} }
  room.streams.delete(pid);
}

// ---------- HTTP ----------
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 4096) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { cb(e); } });
  req.on('error', () => {});
}

function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'GET' && STATIC[p]) {
    const [file, type] = STATIC[p];
    fs.readFile(path.join(__dirname, file), (err, buf) => {
      if (err) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  if (p === '/api/ping') return json(res, 200, { shemkod: true, rooms: rooms.size });

  if (p === '/api/create' && req.method === 'POST') {
    return readBody(req, (err, b) => {
      if (err || !validPid(b.pid)) return json(res, 400, { err: 'בקשה לא תקינה' });
      const code = makeCode();
      if (!code) return json(res, 503, { err: 'אין קודים פנויים' });
      const state = G.newState(code, b.pid, b.name, rng);
      rooms.set(code, { state, streams: new Map(), touched: Date.now() });
      scheduleSave();
      json(res, 200, { code });
    });
  }

  if (p === '/api/events' && req.method === 'GET') {
    const code = String(u.searchParams.get('code') || '').toUpperCase();
    const pid = u.searchParams.get('pid');
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    const room = validCode(code) && rooms.get(code);
    if (!room || !validPid(pid)) { sse(res, 'fatal', { msg: 'לא נמצא משחק עם הקוד הזה' }); return res.end(); }
    const add = G.addPlayer(room.state, pid, u.searchParams.get('name'), rng);
    if (add.err) { sse(res, 'fatal', { msg: add.err }); return res.end(); }
    if (!room.streams.has(pid)) room.streams.set(pid, new Set());
    room.streams.get(pid).add(res);
    broadcast(room);
    req.on('close', () => {
      const set = room.streams.get(pid);
      if (set) { set.delete(res); if (!set.size) room.streams.delete(pid); }
      if (rooms.get(code) === room) broadcast(room);
    });
    return;
  }

  if (p === '/api/act' && req.method === 'POST') {
    const code = String(u.searchParams.get('code') || '').toUpperCase();
    const pid = u.searchParams.get('pid');
    const room = validCode(code) && rooms.get(code);
    if (!room || !validPid(pid) || !room.state.players[pid]) return json(res, 404, { err: 'המשחק לא נמצא' });
    return readBody(req, (err, m) => {
      if (err) return json(res, 400, { err: 'בקשה לא תקינה' });
      const st = room.state;
      if (m.t === 'close') {
        if (pid !== st.hostPid) return json(res, 403, { err: 'רק המארח יכול לסגור את המשחק' });
        for (const [q] of room.streams) sendTo(room, q, 'closed', {});
        setTimeout(() => { for (const [q] of room.streams) dropStreams(room, q); }, 300);
        rooms.delete(code); scheduleSave();
        return json(res, 200, { ok: true });
      }
      const r = G.applyAction(st, pid, m, WORDS, rng);
      if (r.err) return json(res, 200, { err: r.err });
      if (r.kicked) { sendTo(room, r.kicked, 'kicked', {}); setTimeout(() => dropStreams(room, r.kicked), 300); }
      if (r.left) { setTimeout(() => dropStreams(room, pid), 200); }
      broadcast(room);
      json(res, 200, { ok: true });
    });
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('לא נמצא');
}

// ---------- הפעלה ----------
function bindAddrs() {
  if (process.env.BIND) return process.env.BIND.split(',').map(s => s.trim()).filter(Boolean);
  const out = ['127.0.0.1'];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address)) out.push(i.address); // טווח Tailscale (CGNAT)
    }
  }
  return out;
}

function main() {
  loadRooms();
  setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) if (now - r.touched > ROOM_TTL) rooms.delete(code);
    for (const r of rooms.values()) for (const set of r.streams.values()) for (const res of set) { try { res.write(': hb\n\n'); } catch (e) {} }
  }, 15000).unref();

  const addrs = bindAddrs();
  let up = 0;
  addrs.forEach(addr => {
    const srv = http.createServer(handle);
    srv.on('error', e => console.error('לא ניתן להאזין ל-' + addr + ':' + PORT + ' - ' + e.message));
    srv.listen(PORT, addr, () => { up++; console.log('שם קוד מאזין על http://' + addr + ':' + PORT); });
  });
  console.log('חדרים שנטענו: ' + rooms.size + ' · נתונים: ' + FILE);
  if (addrs.length === 1) console.log('לא נמצאה כתובת Tailscale (100.x). אפשר להגדיר BIND=...');
  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { flushSave(); process.exit(0); }));
}

if (require.main === module) main();
module.exports = { handle };
