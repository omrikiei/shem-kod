// מנוע המשחק "שם קוד" - לוגיקה טהורה, ללא תלות ב-DOM או ברשת.
// רץ אצל המארח בלבד; שאר השחקנים מקבלים "view" מסונן (בלי מפתח הקלפים).
(function (root) {
  'use strict';

  var MAX_PLAYERS = 16;
  var LOG_MAX = 60;

  function other(t) { return t === 'red' ? 'blue' : 'red'; }

  function shuffle(a, rng) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function rid(n, rng) {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < n; i++) s += abc[Math.floor(rng() * abc.length)];
    return s;
  }

  function clean(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 14);
  }

  function newState(code, hostPid, hostName, rng) {
    rng = rng || Math.random;
    var s = {
      v: 1, code: code, phase: 'lobby',
      players: {}, order: [], hostPid: hostPid,
      words: [], key: [], revealed: [],
      starter: null, turn: null, clue: null,
      guessesLeft: null, guessesMade: 0,
      winner: null, winReason: null,
      log: [], scores: { red: 0, blue: 0 }, round: 0
    };
    addPlayer(s, hostPid, hostName, rng);
    return s;
  }

  function addPlayer(s, pid, name, rng) {
    rng = rng || Math.random;
    var p = s.players[pid];
    if (p) { var n = clean(name); if (n) p.name = n; return { ok: true }; }
    if (s.order.length >= MAX_PLAYERS) return { err: 'החדר מלא' };
    s.players[pid] = { sid: rid(6, rng), name: clean(name) || 'שחקן', team: null, role: 'agent' };
    s.order.push(pid);
    return { ok: true };
  }

  function removePlayer(s, pid) {
    if (!s.players[pid] || pid === s.hostPid) return false;
    delete s.players[pid];
    s.order = s.order.filter(function (x) { return x !== pid; });
    return true;
  }

  function pidBySid(s, sid) {
    for (var i = 0; i < s.order.length; i++) if (s.players[s.order[i]].sid === sid) return s.order[i];
    return null;
  }

  function spyOf(s, team, exceptPid) {
    for (var i = 0; i < s.order.length; i++) {
      var q = s.players[s.order[i]];
      if (s.order[i] !== exceptPid && q.team === team && q.role === 'spy') return s.order[i];
    }
    return null;
  }

  function setTeam(s, pid, team) {
    var p = s.players[pid];
    if (!p) return { err: 'שחקן לא קיים' };
    if (team !== 'red' && team !== 'blue' && team !== null) return { err: 'קבוצה לא תקינה' };
    if (s.phase === 'over') return { err: 'המשחק נגמר' };
    if (s.phase === 'play' && p.role === 'spy') return { err: 'ראש מרגלים לא יכול להחליף קבוצה באמצע משחק' };
    p.team = team;
    if (p.role === 'spy' && (team === null || spyOf(s, team, pid))) p.role = 'agent';
    return { ok: true };
  }

  function setRole(s, pid, role) {
    var p = s.players[pid];
    if (!p) return { err: 'שחקן לא קיים' };
    if (s.phase !== 'lobby') return { err: 'אפשר להחליף תפקיד רק לפני תחילת המשחק' };
    if (role !== 'spy' && role !== 'agent') return { err: 'תפקיד לא תקין' };
    if (role === 'spy') {
      if (!p.team) return { err: 'קודם בחר קבוצה' };
      if (spyOf(s, p.team, pid)) return { err: 'כבר יש ראש מרגלים בקבוצה הזאת' };
    }
    p.role = role;
    return { ok: true };
  }

  function remaining(s, team) {
    var n = 0;
    for (var i = 0; i < 25; i++) if (s.key[i] === team && !s.revealed[i]) n++;
    return n;
  }

  function startCheck(s) {
    if (s.phase !== 'lobby') return 'המשחק כבר התחיל';
    var teams = ['red', 'blue'], names = { red: 'האדומה', blue: 'הכחולה' };
    for (var t = 0; t < 2; t++) {
      var team = teams[t], spy = 0, agents = 0;
      s.order.forEach(function (pid) {
        var p = s.players[pid];
        if (p.team !== team) return;
        if (p.role === 'spy') spy++; else agents++;
      });
      if (!spy) return 'בקבוצה ' + names[team] + ' חסר ראש מרגלים';
      if (!agents) return 'בקבוצה ' + names[team] + ' צריך לפחות סוכן אחד';
    }
    return null;
  }

  function startGame(s, words, rng) {
    rng = rng || Math.random;
    var e = startCheck(s);
    if (e) return { err: e };
    var pool = shuffle(words.slice(), rng).slice(0, 25);
    var starter = rng() < 0.5 ? 'red' : 'blue';
    var key = [];
    var i;
    for (i = 0; i < 9; i++) key.push(starter);
    for (i = 0; i < 8; i++) key.push(other(starter));
    for (i = 0; i < 7; i++) key.push('neutral');
    key.push('assassin');
    shuffle(key, rng);
    s.words = pool; s.key = key;
    s.revealed = pool.map(function () { return false; });
    s.starter = starter; s.turn = starter;
    s.clue = null; s.guessesLeft = null; s.guessesMade = 0;
    s.winner = null; s.winReason = null;
    s.log = []; s.phase = 'play'; s.round++;
    return { ok: true };
  }

  function toLobby(s) {
    s.phase = 'lobby';
    s.words = []; s.key = []; s.revealed = [];
    s.turn = null; s.clue = null; s.guessesLeft = null; s.guessesMade = 0;
    s.winner = null; s.winReason = null; s.log = [];
    return { ok: true };
  }

  function pushLog(s, e) { s.log.push(e); if (s.log.length > LOG_MAX) s.log.shift(); }

  function giveClue(s, pid, word, num) {
    var p = s.players[pid];
    if (!p) return { err: 'שחקן לא קיים' };
    if (s.phase !== 'play') return { err: 'המשחק לא פעיל' };
    if (p.role !== 'spy' || p.team !== s.turn) return { err: 'עכשיו לא התור שלך לתת רמז' };
    if (s.clue) return { err: 'כבר ניתן רמז בתור הזה' };
    word = String(word == null ? '' : word).trim();
    if (!word || /\s/.test(word)) return { err: 'הרמז חייב להיות מילה אחת' };
    if (word.length > 20) return { err: 'הרמז ארוך מדי' };
    for (var i = 0; i < 25; i++) {
      if (!s.revealed[i] && s.words[i] === word) return { err: 'אי אפשר לתת רמז שהוא מילה שעל הלוח' };
    }
    num = Number(num);
    if (!(num === -1 || (Number.isInteger(num) && num >= 0 && num <= 9))) return { err: 'מספר לא תקין' };
    s.clue = { word: word, num: num, by: p.sid };
    s.guessesLeft = num > 0 ? num + 1 : null; // 0 או ∞ = ללא הגבלה
    s.guessesMade = 0;
    pushLog(s, { k: 'clue', team: s.turn, word: word, num: num });
    return { ok: true };
  }

  function switchTurn(s) {
    s.turn = other(s.turn);
    s.clue = null; s.guessesLeft = null; s.guessesMade = 0;
  }

  function finish(s, winner, reason) {
    s.phase = 'over'; s.winner = winner; s.winReason = reason;
    s.scores[winner]++;
  }

  function guess(s, pid, idx) {
    var p = s.players[pid];
    if (!p) return { err: 'שחקן לא קיים' };
    if (s.phase !== 'play') return { err: 'המשחק לא פעיל' };
    if (p.role !== 'agent' || p.team !== s.turn) return { err: 'עכשיו לא התור שלך לנחש' };
    if (!s.clue) return { err: 'ממתינים לרמז' };
    if (!Number.isInteger(idx) || idx < 0 || idx > 24) return { err: 'קלף לא תקין' };
    if (s.revealed[idx]) return { err: 'הקלף כבר נחשף' };
    s.revealed[idx] = true;
    s.guessesMade++;
    var color = s.key[idx], team = s.turn;
    var res = color === team ? 'own' : color === other(team) ? 'enemy' : color;
    pushLog(s, { k: 'guess', team: team, word: s.words[idx], res: res });
    if (color === 'assassin') { finish(s, other(team), 'assassin'); return { ok: true, res: res }; }
    if (remaining(s, 'red') === 0) { finish(s, 'red', 'cards'); return { ok: true, res: res }; }
    if (remaining(s, 'blue') === 0) { finish(s, 'blue', 'cards'); return { ok: true, res: res }; }
    if (color !== team) { switchTurn(s); return { ok: true, res: res }; }
    if (s.guessesLeft !== null) {
      s.guessesLeft--;
      if (s.guessesLeft <= 0) switchTurn(s);
    }
    return { ok: true, res: res };
  }

  function endTurn(s, pid) {
    var p = s.players[pid];
    if (!p) return { err: 'שחקן לא קיים' };
    if (s.phase !== 'play') return { err: 'המשחק לא פעיל' };
    if (p.role !== 'agent' || p.team !== s.turn) return { err: 'עכשיו לא התור שלך' };
    if (!s.clue) return { err: 'ממתינים לרמז' };
    if (s.guessesMade < 1) return { err: 'צריך לנחש לפחות קלף אחד' };
    pushLog(s, { k: 'end', team: s.turn });
    switchTurn(s);
    return { ok: true };
  }

  // מה שכל שחקן רואה. את מפתח הצבעים מקבלים רק ראשי מרגלים (ובסוף המשחק - כולם).
  function viewFor(s, pid, online) {
    var me = s.players[pid];
    if (!me) return null;
    var seeKey = s.phase === 'over' || me.role === 'spy';
    var board = [];
    for (var i = 0; i < s.words.length; i++) {
      var rev = !!s.revealed[i];
      board.push({ w: s.words[i], rev: rev, c: (rev || seeKey) ? s.key[i] : null });
    }
    var host = s.players[s.hostPid];
    return {
      phase: s.phase, code: s.code, round: s.round,
      you: me.sid, hostSid: host ? host.sid : null,
      players: s.order.map(function (id) {
        var q = s.players[id];
        return { sid: q.sid, name: q.name, team: q.team, role: q.role, online: !online || online.has(id) };
      }),
      board: board, turn: s.turn, clue: s.clue,
      guessesLeft: s.guessesLeft, guessesMade: s.guessesMade,
      left: s.phase === 'lobby' ? null : { red: remaining(s, 'red'), blue: remaining(s, 'blue') },
      winner: s.winner, winReason: s.winReason,
      log: s.log.slice(-30), scores: s.scores,
      startErr: s.phase === 'lobby' ? startCheck(s) : null
    };
  }

  // מפעיל פעולה של שחקן על המצב. משותף למארח P2P ולשרת. מחזיר {err} או {ok[, kicked, left]}
  function applyAction(s, pid, m, words, rng) {
    if (!m || typeof m !== 'object' || !s.players[pid]) return { err: 'פעולה לא מוכרת' };
    var isHost = pid === s.hostPid;
    switch (m.t) {
      case 'team': return setTeam(s, pid, m.team);
      case 'role': return setRole(s, pid, m.role);
      case 'clue': return giveClue(s, pid, m.word, m.num);
      case 'guess': return guess(s, pid, m.idx);
      case 'end': return endTurn(s, pid);
      case 'rename': return addPlayer(s, pid, m.name, rng);
      case 'start': return isHost ? startGame(s, words, rng) : { err: 'רק המארח יכול להתחיל' };
      case 'again': return isHost ? toLobby(s) : { err: 'רק המארח יכול להתחיל משחק חדש' };
      case 'kick':
        if (!isHost) return { err: 'רק המארח יכול להסיר שחקנים' };
        var target = pidBySid(s, m.sid);
        if (!target || target === s.hostPid) return { err: 'שחקן לא נמצא' };
        removePlayer(s, target);
        return { ok: true, kicked: target };
      case 'leave':
        if (isHost) return { err: 'המארח לא יכול לצאת (אפשר לסגור את המשחק)' };
        if (s.phase === 'lobby') removePlayer(s, pid);
        return { ok: true, left: true };
    }
    return { err: 'פעולה לא מוכרת' };
  }

  var api = {
    applyAction: applyAction,
    MAX_PLAYERS: MAX_PLAYERS, other: other, shuffle: shuffle, rid: rid, clean: clean,
    newState: newState, addPlayer: addPlayer, removePlayer: removePlayer, pidBySid: pidBySid,
    setTeam: setTeam, setRole: setRole, startCheck: startCheck, startGame: startGame, toLobby: toLobby,
    giveClue: giveClue, guess: guess, endTurn: endTurn, remaining: remaining, viewFor: viewFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Game = api;
})(typeof window !== 'undefined' ? window : this);
