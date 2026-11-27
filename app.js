// שם קוד - ממשק + רשת (WebRTC דרך PeerJS). המארח הוא "השרת" והמצב נשמר ב-localStorage שלו.
(function () {
  'use strict';
  var G = window.Game, WORDS = window.WORDS;
  var ICE = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ] };
  var PREFIX = 'shemkod-';
  var CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var TEAM_HE = { red: 'אדומים', blue: 'כחולים' };
  var TEAM_ONE = { red: 'האדומה', blue: 'הכחולה' };

  // ---------- עזרים ----------
  function secureRng() { return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function makeCode() { var s = ''; for (var i = 0; i < 4; i++) s += CODE_ABC[Math.floor(secureRng() * CODE_ABC.length)]; return s; }
  function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v == null || v === false || k === 'value') continue;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'selected') el.selected = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      }
    })(Array.prototype.slice.call(arguments, 2));
    if (props && props.value != null) el.value = props.value;
    return el;
  }

  var toastT;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function safeSend(c, m) { try { if (c && c.open) c.send(m); } catch (e) {} }

  // ---------- מצב ----------
  var me = load('sk_me');
  if (!me || !me.pid) { me = { pid: G.rid(32, secureRng), name: '' }; save('sk_me', me); }
  var session = load('sk_session');
  var mode = null;            // 'host' | 'client' (P2P) | 'server' (אירוח על שרת) | null
  var SRV = false, es = null;  // SRV: האתר מוגש מ-server.js
  var hs = null;              // מצב מלא (מארח בלבד)
  var view = null;            // מה שהשחקן הנוכחי רואה
  var net = 'connecting';     // connecting | online | reconnecting | notfound
  var peer = null, conns = {}, lastSeen = {}, clientConn = null, joinCode = null;
  var dialT, pingI, watchI, lastRx = 0, resuming = false, resumeTries = 0;
  var sel = null;
  var draft = { name: me.name || '', code: '', clue: '', num: '1' };
  var wl = null;

  var params = new URLSearchParams(location.search);
  var joinParam = cleanCode(params.get('join'));
  if (joinParam) draft.code = joinParam;

  function saveSession() { save('sk_session', session); }
  function onlineSet() { var s = new Set(Object.keys(conns)); s.add(me.pid); return s; }

  async function wake() {
    try {
      if ('wakeLock' in navigator && !wl) {
        wl = await navigator.wakeLock.request('screen');
        wl.addEventListener('release', function () { wl = null; });
      }
    } catch (e) {}
  }

  // ---------- מארח ----------
  function hostNew(name) {
    me.name = name; save('sk_me', me);
    hs = G.newState(makeCode(), me.pid, name, secureRng);
    resuming = false;
    hostOpen(hs.code);
  }

  function persistAndBroadcast() {
    save('sk_host', { code: hs.code, state: hs });
    var on = onlineSet();
    Object.keys(conns).forEach(function (pid) {
      safeSend(conns[pid], { t: 'state', view: G.viewFor(hs, pid, on) });
    });
    view = G.viewFor(hs, me.pid, on);
    render();
  }

  function hostOpen(code) {
    mode = 'host'; net = 'connecting';
    session = { role: 'host', code: code }; saveSession();
    save('sk_host', { code: hs.code, state: hs });
    destroyPeer(true);
    view = G.viewFor(hs, me.pid, onlineSet());
    render(); wake();
    var p = new Peer(PREFIX + code, { config: ICE });
    peer = p;
    p.on('open', function () { if (peer !== p) return; net = 'online'; resumeTries = 0; startWatch(); render(); });
    p.on('connection', onHostConn);
    p.on('disconnected', function () {
      if (peer !== p || p.destroyed) return;
      net = 'reconnecting'; render();
      setTimeout(function () { try { if (peer === p && p.disconnected) p.reconnect(); } catch (e) {} }, 1500);
    });
    p.on('error', function (err) {
      if (peer !== p) return;
      if (err.type === 'unavailable-id') {
        if (resuming && resumeTries < 20) { resumeTries++; net = 'reconnecting'; render(); setTimeout(function () { if (peer === p) hostOpen(code); }, 3000); }
        else { hs.code = makeCode(); hostOpen(hs.code); }
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].indexOf(err.type) >= 0) {
        net = 'reconnecting'; render();
        setTimeout(function () { if (peer === p && mode === 'host') hostOpen(code); }, 4000);
      }
    });
  }

  function onHostConn(conn) {
    conn.on('data', function (d) { onHostData(conn, d); });
    conn.on('close', function () { dropConn(conn); });
    conn.on('error', function () { dropConn(conn); });
  }

  function dropConn(conn) {
    if (conn.pid && conns[conn.pid] === conn) {
      delete conns[conn.pid]; delete lastSeen[conn.pid];
      if (hs) persistAndBroadcast();
    }
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== 'object' || !hs) return;
    if (d.t === 'hello') {
      var pid = d.pid;
      if (typeof pid !== 'string' || pid.length < 16 || pid.length > 64) return;
      var r = G.addPlayer(hs, pid, d.name, secureRng);
      if (r.err) { safeSend(conn, { t: 'fatal', msg: r.err }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 300); return; }
      var old = conns[pid];
      if (old && old !== conn) { try { old.close(); } catch (e) {} }
      conn.pid = pid; conns[pid] = conn; lastSeen[pid] = Date.now();
      persistAndBroadcast();
      return;
    }
    if (!conn.pid || conns[conn.pid] !== conn) return;
    lastSeen[conn.pid] = Date.now();
    if (d.t === 'ping') { safeSend(conn, { t: 'pong' }); return; }
    handleAction(conn.pid, d);
  }

  function toastTo(pid, msg) {
    if (pid === me.pid) toast(msg); else safeSend(conns[pid], { t: 'toast', msg: msg });
  }

  function handleAction(pid, m) {
    if (!hs || !m) return;
    var r = G.applyAction(hs, pid, m, WORDS, secureRng);
    if (r.err) { toastTo(pid, r.err); return; }
    var c = conns[pid];
    if (r.kicked) {
      var kc = conns[r.kicked]; delete conns[r.kicked];
      if (kc) { safeSend(kc, { t: 'kicked' }); setTimeout(function () { try { kc.close(); } catch (e) {} }, 300); }
    }
    if (r.left) { delete conns[pid]; if (c) setTimeout(function () { try { c.close(); } catch (e) {} }, 200); }
    persistAndBroadcast();
  }

  function startWatch() {
    clearInterval(watchI);
    watchI = setInterval(function () {
      var now = Date.now();
      Object.keys(conns).forEach(function (pid) {
        if (now - (lastSeen[pid] || 0) > 30000) { var c = conns[pid]; try { c.close(); } catch (e) {} dropConn(c); }
      });
    }, 5000);
  }

  function closeRoom() {
    Object.keys(conns).forEach(function (pid) { safeSend(conns[pid], { t: 'closed' }); });
    setTimeout(function () { del('sk_host'); del('sk_session'); session = null; goHome(); }, 250);
  }

  // ---------- שחקן ----------
  function joinNew(name, code) {
    me.name = name; save('sk_me', me);
    session = { role: 'client', code: code }; saveSession();
    clientOpen(code);
  }

  function clientOpen(code) {
    if (joinCode !== code) view = null;
    mode = 'client'; joinCode = code; net = view ? 'reconnecting' : 'connecting';
    destroyPeer(true); render(); wake();
    var p = new Peer(undefined, { config: ICE });
    peer = p;
    p.on('open', function () { if (peer === p && !(clientConn && clientConn.open)) dial(); });
    p.on('disconnected', function () { if (peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) {} } });
    p.on('error', function (err) {
      if (peer !== p) return;
      if (err.type === 'peer-unavailable') { net = view ? 'reconnecting' : 'notfound'; render(); scheduleDial(4000); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(err.type) >= 0) {
        net = view ? 'reconnecting' : 'connecting'; render();
        setTimeout(function () { if (peer === p && mode === 'client') clientOpen(code); }, 4000);
      }
    });
  }

  function scheduleDial(ms) { clearTimeout(dialT); dialT = setTimeout(dial, ms); }

  function dial() {
    clearTimeout(dialT);
    if (mode !== 'client' || !peer || peer.destroyed) return;
    if (!peer.open) { try { peer.reconnect(); } catch (e) {} return; }
    if (clientConn) { clientConn._old = true; try { clientConn.close(); } catch (e) {} }
    var c = peer.connect(PREFIX + joinCode, { reliable: true });
    clientConn = c;
    var to = setTimeout(function () {
      if (clientConn === c && !c.open) {
        c._old = true; try { c.close(); } catch (e) {}
        net = view ? 'reconnecting' : 'notfound'; render(); scheduleDial(4000);
      }
    }, 12000);
    c.on('open', function () {
      clearTimeout(to);
      safeSend(c, { t: 'hello', pid: me.pid, name: me.name });
      lastRx = Date.now(); startPing();
    });
    c.on('data', function (d) { if (clientConn === c) onClientData(d); });
    c.on('close', function () {
      clearTimeout(to);
      if (clientConn !== c || c._old || mode !== 'client') return;
      net = 'reconnecting'; render(); scheduleDial(2000);
    });
    c.on('error', function () {});
  }

  function startPing() {
    clearInterval(pingI);
    pingI = setInterval(function () {
      if (mode !== 'client' || !clientConn) return;
      if (clientConn.open) {
        safeSend(clientConn, { t: 'ping' });
        if (Date.now() - lastRx > 25000) { var c = clientConn; try { c.close(); } catch (e) {} }
      }
    }, 8000);
  }

  function onClientData(d) {
    if (!d || typeof d !== 'object') return;
    lastRx = Date.now();
    switch (d.t) {
      case 'state': view = d.view; net = 'online'; render(); break;
      case 'toast': toast(d.msg); break;
      case 'kicked': endSession('הוסרת מהמשחק'); break;
      case 'closed': endSession('המארח סגר את המשחק'); break;
      case 'fatal': endSession(d.msg || 'לא ניתן להצטרף'); break;
    }
  }

  function endSession(msg) { del('sk_session'); session = null; goHome(); if (msg) toast(msg); }

  function leave() {
    if (mode === 'server') {
      var iAmHost = view && view.you === view.hostSid;
      if (iAmHost) { if (confirm('לסגור את המשחק לכולם?')) api('act', { code: joinCode, pid: me.pid }, { t: 'close' }).then(function () { endSession(); }); return; }
      if (!confirm('לצאת מהמשחק?')) return;
      api('act', { code: joinCode, pid: me.pid }, { t: 'leave' }).catch(function () {}).then(function () { endSession(); });
      return;
    }
    if (mode === 'host') { if (confirm('לסגור את המשחק לכולם?')) closeRoom(); return; }
    if (!confirm('לצאת מהמשחק?')) return;
    safeSend(clientConn, { t: 'leave' });
    setTimeout(function () { endSession(); }, 150);
  }

  // ---------- מצב שרת (server.js) ----------
  function api(path, q, body) {
    var url = 'api/' + path + (q ? '?' + new URLSearchParams(q).toString() : '');
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); });
  }

  function srvCreate(name) {
    me.name = name; save('sk_me', me);
    api('create', null, { pid: me.pid, name: name }).then(function (j) {
      if (j.err) return toast(j.err);
      session = { role: 'srv', code: j.code }; saveSession(); srvOpen(j.code);
    }).catch(function () { toast('השרת לא זמין'); });
  }

  function srvJoin(name, code) {
    me.name = name; save('sk_me', me);
    session = { role: 'srv', code: code }; saveSession(); srvOpen(code);
  }

  function srvOpen(code) {
    var same = joinCode === code && view;
    destroyPeer();
    mode = 'server'; joinCode = code; if (!same) view = null; net = view ? 'reconnecting' : 'connecting';
    render(); wake();
    var e = new EventSource('api/events?' + new URLSearchParams({ code: code, pid: me.pid, name: me.name || '' }).toString());
    es = e;
    e.onopen = function () { if (es === e) { net = 'online'; render(); } };
    e.onerror = function () { if (es === e) { net = view ? 'reconnecting' : 'connecting'; render(); } };
    e.addEventListener('state', function (ev) { if (es !== e) return; view = JSON.parse(ev.data); net = 'online'; render(); });
    e.addEventListener('toast', function (ev) { toast(JSON.parse(ev.data).msg); });
    e.addEventListener('kicked', function () { if (es === e) endSession('הוסרת מהמשחק'); });
    e.addEventListener('closed', function () { if (es === e) endSession('המשחק נסגר'); });
    e.addEventListener('fatal', function (ev) { if (es === e) endSession(JSON.parse(ev.data).msg || 'לא ניתן להצטרף'); });
  }

  // ---------- כללי ----------
  function destroyPeer(keepMode) {
    clearTimeout(dialT); clearInterval(pingI); clearInterval(watchI);
    if (es) { try { es.close(); } catch (e) {} es = null; }
    var p = peer; peer = null;
    if (p) { try { p.destroy(); } catch (e) {} }
    conns = {}; lastSeen = {}; clientConn = null;
  }

  function goHome() {
    destroyPeer(); mode = null; hs = null; view = null; sel = null; resuming = false;
    render();
  }

  function act(m) {
    if (mode === 'server') {
      api('act', { code: joinCode, pid: me.pid }, m).then(function (j) { if (j && j.err) toast(j.err); }).catch(function () { toast('אין חיבור לשרת'); });
    } else if (mode === 'host') handleAction(me.pid, m);
    else if (clientConn && clientConn.open) safeSend(clientConn, m);
    else toast('אין חיבור למארח');
  }

  function shareLink() {
    var url = location.origin + location.pathname + '?join=' + view.code;
    var text = 'בואו לשחק שם קוד! קוד הצטרפות: ' + view.code;
    if (navigator.share) { navigator.share({ title: 'שם קוד', text: text, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('הקישור הועתק'); }, function () { toast(url); });
    else toast(url);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    wake();
    if (mode === 'server') { if (!es || es.readyState === 2) srvOpen(joinCode); return; }
    if (mode === 'host' && peer) {
      if (peer.destroyed) hostOpen(hs.code);
      else if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
    } else if (mode === 'client') {
      if (!clientConn || !clientConn.open) dial();
    }
  });
  window.addEventListener('online', function () {
    if (mode === 'client' && (!clientConn || !clientConn.open)) dial();
    if (mode === 'host' && peer && peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
  });

  // ---------- תצוגה ----------
  var app = document.getElementById('app');

  function render() {
    var ae = document.activeElement, focusId = ae && ae.id, selStart = null;
    if (focusId && ae.setSelectionRange) { try { selStart = [ae.selectionStart, ae.selectionEnd]; } catch (e) {} }
    var screen;
    if (!mode) screen = homeScreen();
    else if (!view) screen = connectingScreen();
    else if (view.phase === 'lobby') screen = lobbyScreen();
    else screen = gameScreen();
    app.textContent = '';
    app.appendChild(screen);
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) { el.focus(); if (selStart && el.setSelectionRange) { try { el.setSelectionRange(selStart[0], selStart[1]); } catch (e) {} } }
    }
  }

  function statusChip() {
    var txt, cls = '';
    if (net === 'online' && mode === 'server') txt = 'מחובר · ' + view.players.filter(function (p) { return p.online; }).length + ' מחוברים';
    else if (net === 'online') txt = mode === 'host' ? 'מארח · ' + (Object.keys(conns).length + 1) + ' מחוברים' : 'מחובר';
    else if (net === 'reconnecting') { txt = 'מתחבר מחדש…'; cls = 'warn'; }
    else if (net === 'notfound') { txt = 'המארח לא נמצא'; cls = 'bad'; }
    else { txt = 'מתחבר…'; cls = 'warn'; }
    return h('span', { class: 'chip ' + cls }, h('span', { class: 'dot' }), txt);
  }

  function homeScreen() {
    var saved = session && ((SRV && session.role === 'srv') || (!SRV && ((session.role === 'host' && load('sk_host')) || session.role === 'client'))) ? session : null;
    return h('div', { class: 'home' },
      h('div', { class: 'logo' },
        h('div', { class: 'title' }, h('b', null, 'שם'), ' ', h('i', null, 'קוד')),
        h('p', null, 'משחק מילים לקבוצות · כל שחקן עם הטלפון שלו')),
      saved && h('div', { class: 'panel resume' },
        h('h3', null, saved.role === 'host' ? 'יש לך משחק פתוח כמארח' : 'חזרה למשחק שהצטרפת אליו'),
        h('div', { class: 'row' },
          h('button', { onclick: function () {
            if (saved.role === 'srv') srvOpen(saved.code);
            else if (saved.role === 'host') { hs = load('sk_host').state; resuming = true; resumeTries = 0; hostOpen(saved.code); }
            else clientOpen(saved.code);
          } }, 'המשך · ' + saved.code),
          h('button', { class: 'ghost fit', onclick: function () { if (confirm('למחוק את המשחק השמור?')) { del('sk_host'); del('sk_session'); session = null; render(); } } }, 'מחק'))),
      h('div', { class: 'panel' },
        h('h3', null, 'איך קוראים לך?'),
        h('input', { type: 'text', id: 'in-name', maxlength: '14', placeholder: 'השם שלך', value: draft.name, autocomplete: 'off',
          oninput: function (e) { draft.name = e.target.value; } })),
      h('div', { class: 'panel' },
        h('h3', null, 'משחק חדש'),
        h('button', { onclick: function () {
          var n = G.clean(draft.name); if (!n) return toast('כתוב קודם את השם שלך');
          if (SRV) srvCreate(n); else hostNew(n);
        } }, 'פתח משחק (אני המארח)'),
        h('div', { class: 'note' }, SRV ? 'המשחק רץ ונשמר על השרת הביתי, אז אפשר לסגור את הדף ולחזור בכל רגע.' : 'הטלפון שלך מנהל את המשחק. כדאי להשאיר את המסך דלוק ואת הדף פתוח.')),
      h('div', { class: 'panel' },
        h('h3', null, 'הצטרפות למשחק'),
        h('input', { type: 'text', id: 'in-code', class: 'code', maxlength: '4', placeholder: 'קוד', value: draft.code, autocomplete: 'off', autocapitalize: 'characters',
          oninput: function (e) { var v = cleanCode(e.target.value); e.target.value = v; draft.code = v; } }),
        h('button', { class: 'ghost', onclick: function () {
          var n = G.clean(draft.name); if (!n) return toast('כתוב קודם את השם שלך');
          if (draft.code.length !== 4) return toast('הקוד הוא 4 תווים');
          if (SRV) srvJoin(n, draft.code); else joinNew(n, draft.code);
        } }, 'הצטרף')));
  }

  function connectingScreen() {
    return h('div', { class: 'connecting' },
      net === 'notfound' ? null : h('div', { class: 'spin' }),
      h('h2', null, net === 'notfound' ? 'לא מצאנו משחק עם הקוד ' + joinCode : 'מתחבר למשחק ' + joinCode + '…'),
      h('div', { class: 'note' }, net === 'notfound'
        ? 'בדוק שהקוד נכון ושהמארח פתח את המשחק ומחובר לאינטרנט. ננסה שוב אוטומטית.'
        : 'זה לוקח כמה שניות.'),
      h('button', { class: 'ghost', onclick: function () { endSession(); } }, 'ביטול'));
  }

  function playersOf(team) { return view.players.filter(function (p) { return p.team === team; }); }

  function plRow(p) {
    var isHost = view.you === view.hostSid;
    return h('div', { class: 'pl' + (p.online ? '' : ' off') },
      p.role === 'spy' ? '🕵️' : null,
      h('span', { class: 'nm' }, p.name + (p.sid === view.you ? ' (אני)' : '') + (p.sid === view.hostSid ? ' ★' : '')),
      isHost && p.sid !== view.you && view.phase === 'lobby' ? h('button', { class: 'x', title: 'הסר', onclick: function () { if (confirm('להסיר את ' + p.name + '?')) act({ t: 'kick', sid: p.sid }); } }, '✕') : null);
  }

  function lobbyScreen() {
    var meP = view.players.find(function (p) { return p.sid === view.you; });
    var isHost = view.you === view.hostSid;
    var none = view.players.filter(function (p) { return !p.team; });
    return h('div', null,
      h('div', { class: 'topbar' }, statusChip(), h('span', { class: 'grow' }),
        h('button', { class: 'link', onclick: leave }, isHost ? 'סגור משחק' : 'יציאה')),
      h('div', { class: 'lobby' },
        h('div', { class: 'codebox' },
          h('div', { class: 'lbl' }, 'קוד הצטרפות'),
          h('div', { class: 'code' }, view.code),
          h('button', { class: 'ghost small', onclick: shareLink }, 'שתף קישור')),
        h('div', { class: 'teams' },
          ['red', 'blue'].map(function (t) {
            return h('div', { class: 'team ' + t }, h('h3', null, TEAM_HE[t]), playersOf(t).map(plRow));
          })),
        none.length ? h('div', { class: 'unassigned' }, h('div', { class: 'note' }, 'עוד לא בחרו קבוצה:'), none.map(plRow)) : null,
        h('div', { class: 'panel me-actions' },
          h('h3', null, 'הבחירה שלך'),
          h('div', { class: 'row' },
            h('button', { class: 'red', disabled: meP.team === 'red', onclick: function () { act({ t: 'team', team: 'red' }); } }, 'אדומים'),
            h('button', { class: 'blue', disabled: meP.team === 'blue', onclick: function () { act({ t: 'team', team: 'blue' }); } }, 'כחולים')),
          h('div', { class: 'seg' },
            h('button', { class: meP.role === 'agent' ? 'on' : '', onclick: function () { act({ t: 'role', role: 'agent' }); } }, 'סוכן'),
            h('button', { class: meP.role === 'spy' ? 'on' : '', onclick: function () { act({ t: 'role', role: 'spy' }); } }, '🕵️ ראש מרגלים')),
          h('div', { class: 'note' }, 'בכל קבוצה יש ראש מרגלים אחד (רואה את המפתח ונותן רמזים) ושאר השחקנים סוכנים (מנחשים).')),
        isHost
          ? h('div', null,
              h('div', { class: 'err' }, view.startErr || ''),
              h('button', { style: 'width:100%', disabled: !!view.startErr, onclick: function () { act({ t: 'start' }); } }, 'התחל משחק'))
          : h('div', { class: 'note', style: 'text-align:center' }, 'ממתינים שהמארח יתחיל את המשחק…')));
  }

  function numLabel(n) { return n === -1 ? '∞' : String(n); }

  function logLine(e) {
    var tm = h('span', { class: 't-' + e.team }, TEAM_HE[e.team]);
    if (e.k === 'clue') return h('li', null, tm, ' · רמז: ', h('b', null, e.word), ' (' + numLabel(e.num) + ')');
    if (e.k === 'end') return h('li', null, tm, ' סיימו תור');
    var res = { own: 'נכון ✓', enemy: 'קלף של היריב ✗', neutral: 'ניטרלי', assassin: 'מתנקש ☠' }[e.res];
    return h('li', null, tm, ' ניחשו ', h('b', null, e.word), ' · ' + res);
  }

  function gameScreen() {
    var meP = view.players.find(function (p) { return p.sid === view.you; });
    var isHost = view.you === view.hostSid;
    var playing = view.phase === 'play', over = view.phase === 'over';
    var myTurn = playing && meP.team === view.turn;
    var canGuess = myTurn && meP.role === 'agent' && !!view.clue;
    var mustClue = myTurn && meP.role === 'spy' && !view.clue;
    if (sel !== null && (!canGuess || (view.board[sel] && view.board[sel].rev))) sel = null;
    if (view.clue) draft.clue = '';

    var score = h('div', { class: 'score' },
      ['red', 'blue'].map(function (t) {
        return h('div', { class: 'tm ' + t + (playing && view.turn === t ? ' on' : '') },
          h('span', { class: 'n' }, String(view.left[t])),
          h('span', { class: 's' }, TEAM_HE[t] + (view.scores[t] ? ' · ' + view.scores[t] + ' נצחונות' : '')));
      }));

    var clue;
    if (over) clue = null;
    else if (view.clue) {
      clue = h('div', { class: 'clue ' + view.turn },
        h('span', { class: 'w' }, view.clue.word), h('span', { class: 'num' }, numLabel(view.clue.num)),
        view.guessesLeft != null ? h('span', { class: 'note' }, 'נשארו ' + view.guessesLeft + ' ניחושים') : h('span', { class: 'note' }, 'ללא הגבלה'));
    } else {
      clue = h('div', { class: 'clue ' + view.turn }, 'ממתינים לרמז מראש המרגלים ' + (view.turn === 'red' ? 'האדום' : 'הכחול'));
    }

    var board = h('div', { class: 'board' }, view.board.map(function (c, i) {
      var cls = 'cell';
      if (c.rev) cls += ' rev ' + c.c; else if (c.c) cls += ' hint ' + c.c;
      if (sel === i) cls += ' sel';
      var mk = { red: '▲', blue: '●', assassin: '☠' }[c.c];
      return h('div', { class: cls, onclick: function () { if (canGuess && !c.rev) { sel = i; render(); } } },
        !c.rev && c.c && mk ? h('span', { class: 'mk' }, mk) : null,
        h('span', null, c.w));
    }));

    var dock;
    if (over) {
      var loser = G.other(view.winner);
      dock = h('div', { class: 'dock' },
        h('div', { class: 'banner ' + view.winner }, 'הקבוצה ' + TEAM_ONE[view.winner] + ' ניצחה! 🎉',
          h('small', null, view.winReason === 'assassin' ? 'הקבוצה ' + TEAM_ONE[loser] + ' חשפה את המתנקש' : 'כל הסוכנים נמצאו')),
        isHost ? h('button', { onclick: function () { act({ t: 'again' }); } }, 'משחק חדש')
               : h('div', { class: 'note', style: 'text-align:center' }, 'ממתינים שהמארח יתחיל משחק חדש…'));
    } else if (mustClue) {
      var send = function () {
        var w = draft.clue.trim();
        if (!w) return toast('כתוב רמז');
        act({ t: 'clue', word: w, num: parseInt(draft.num, 10) });
      };
      dock = h('div', { class: 'dock' },
        h('div', { class: 'role' }, 'התור שלך, ראש מרגלים! תן רמז של מילה אחת ומספר'),
        h('div', { class: 'cluef' },
          h('input', { type: 'text', id: 'in-clue', placeholder: 'רמז', maxlength: '20', value: draft.clue, autocomplete: 'off',
            oninput: function (e) { draft.clue = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') send(); } }),
          h('select', { id: 'in-num', onchange: function (e) { draft.num = e.target.value; }, value: draft.num },
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-1', '0'].map(function (v) { return h('option', { value: v }, v === '-1' ? '∞' : v); })),
          h('button', { onclick: send }, 'שלח')));
    } else if (canGuess) {
      dock = h('div', { class: 'dock' },
        h('div', { class: 'role' }, 'הקבוצה שלך מנחשת: לחץ על קלף'),
        h('button', { class: 'ghost', disabled: view.guessesMade < 1, onclick: function () { act({ t: 'end' }); } }, 'סיים תור'));
    } else if (!meP.team) {
      dock = h('div', { class: 'dock' }, h('div', { class: 'role' }, 'הצטרף לקבוצה כדי לשחק:'),
        h('div', { class: 'row' },
          h('button', { class: 'red', onclick: function () { act({ t: 'team', team: 'red' }); } }, 'אדומים'),
          h('button', { class: 'blue', onclick: function () { act({ t: 'team', team: 'blue' }); } }, 'כחולים')));
    } else {
      var who = meP.team ? (meP.role === 'spy' ? 'ראש מרגלים ' : 'סוכן ') + TEAM_ONE[meP.team] : 'צופה';
      dock = h('div', { class: 'dock' }, h('div', { class: 'role' }, 'אתה: ' + who + (view.turn && meP.team !== view.turn ? ' · התור של ' + TEAM_HE[view.turn] : '')));
    }

    var logBox = h('details', { class: 'log' }, h('summary', null, 'היסטוריה'),
      h('ol', { reversed: true }, view.log.slice().reverse().map(logLine)));

    var sheet = sel !== null ? h('div', { class: 'sheet' },
      h('div', { class: 'big' }, view.board[sel].w),
      h('div', { class: 'note' }, 'לחשוף את הקלף הזה?'),
      h('div', { class: 'row' },
        h('button', { onclick: function () { var i = sel; sel = null; act({ t: 'guess', idx: i }); render(); } }, 'כן, לחשוף'),
        h('button', { class: 'ghost', onclick: function () { sel = null; render(); } }, 'ביטול'))) : null;

    return h('div', null,
      h('div', { class: 'topbar' }, statusChip(), h('span', { class: 'chip' }, 'קוד ' + view.code), h('span', { class: 'grow' }),
        h('button', { class: 'link', onclick: leave }, isHost ? 'סגור משחק' : 'יציאה')),
      h('div', { class: 'game' }, score, clue, board, dock, logBox),
      sheet);
  }

  window.__sk = function () { return { mode: mode, net: net, peerId: peer && peer.id, open: peer && peer.open, disc: peer && peer.disconnected, conns: Object.keys(conns).length, dial: clientConn && clientConn.open }; };

  // ---------- אתחול ----------
  function boot() {
    var saved = session;
    if (SRV && saved && saved.role === 'srv' && (!joinParam || joinParam === saved.code)) { srvOpen(saved.code); return; }
    if (!SRV && saved && saved.role === 'host') {
      var hsave = load('sk_host');
      if (hsave && hsave.state && hsave.code === saved.code && (!joinParam || joinParam === saved.code)) {
        hs = hsave.state; resuming = true; hostOpen(saved.code); return;
      }
    }
    if (!SRV && saved && saved.role === 'client' && (!joinParam || joinParam === saved.code)) { clientOpen(saved.code); return; }
    render();
  }
  // האם האתר מוגש משרת שם קוד? (ב-GitHub Pages אין /api ולכן נשארים במצב P2P)
  (function detect() {
    var ac = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ac) ac.abort(); }, 2500);
    fetch('api/ping', { cache: 'no-store', signal: ac ? ac.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { SRV = !!(j && j.shemkod); })
      .catch(function () {})
      .then(function () { clearTimeout(t); boot(); });
  })();
})();
