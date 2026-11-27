// אפקטים לגרסת "סוכן סודי": רקע חלקיקים, קונפטי, צלילים (WebAudio) ורטט. הכל נוצר בקוד, בלי קבצים חיצוניים.
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var muted = false;
  try { muted = localStorage.getItem('sk_mute') === '1'; } catch (e) {}
  var COL = { red: '#ff3b5c', blue: '#2e8bff' };

  // ---------- צליל ----------
  var ac = null;
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { addEventListener(ev, audio, { passive: true }); });
  function tone(f, t0, dur, type, vol, slideTo) {
    var a = ac; if (!a || muted || a.state !== 'running') return;
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  var S = {
    good: function () { tone(660, 0, .12, 'triangle', .18); tone(990, .09, .22, 'triangle', .18); },
    bad: function () { tone(240, 0, .28, 'sawtooth', .1, 110); },
    neutral: function () { tone(330, 0, .16, 'sine', .15); },
    boom: function () { tone(90, 0, .9, 'sawtooth', .22, 28); tone(60, 0, 1, 'square', .1, 20); },
    clue: function () { tone(880, 0, .08, 'sine', .12); tone(1320, .08, .16, 'sine', .12); },
    win: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * .1, .32, 'triangle', .17); }); },
    join: function () { tone(520, 0, .08, 'sine', .09); },
    start: function () { [392, 523, 659].forEach(function (f, i) { tone(f, i * .08, .2, 'square', .06); }); }
  };
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  // ---------- רקע חלקיקים ----------
  (function bg() {
    var c = document.getElementById('bg');
    if (!c || reduce) return;
    var x = c.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), W, H, P = [];
    function size() {
      W = innerWidth; H = innerHeight;
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(60, Math.round(W * H / 14000));
      while (P.length < n) P.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.6 + .6, k: Math.random() });
      P.length = n;
    }
    size(); addEventListener('resize', size);
    var last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 33) return;
      last = t;
      x.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
        for (var j = i + 1; j < P.length; j++) {
          var q = P[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          if (d < 12000) {
            x.strokeStyle = 'rgba(' + (p.k < .5 ? '255,90,120' : '90,150,255') + ',' + (1 - d / 12000) * .22 + ')';
            x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke();
          }
        }
        x.fillStyle = p.k < .33 ? 'rgba(255,90,120,.8)' : p.k < .66 ? 'rgba(90,150,255,.8)' : 'rgba(255,255,255,.55)';
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283); x.fill();
      }
    }
    requestAnimationFrame(frame);
  })();

  // ---------- קונפטי ----------
  var cfRun = false;
  function confetti(team) {
    var c = document.getElementById('fx');
    if (!c || reduce) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cols = [COL[team], '#ffffff', '#ffd86b', team === 'red' ? '#ff9db0' : '#9cc8ff'];
    var P = [];
    for (var i = 0; i < 160; i++) {
      var side = i % 2 ? 1 : -1, a = -Math.PI / 2 + side * (.25 + Math.random() * .5);
      var sp = 9 + Math.random() * 10;
      P.push({ x: W / 2, y: H * .55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length] });
    }
    var t0 = performance.now(); cfRun = true;
    (function step(t) {
      var el = t - t0;
      x.clearRect(0, 0, W, H);
      P.forEach(function (p) {
        p.vy += .28; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.globalAlpha = Math.max(0, 1 - el / 3600);
        x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore();
      });
      if (el < 3600) requestAnimationFrame(step); else { x.clearRect(0, 0, W, H); cfRun = false; }
    })(t0);
  }

  function flash() {
    document.body.classList.add('flash');
    setTimeout(function () { document.body.classList.remove('flash'); }, 900);
  }

  // ---------- כפתור השתקה (נכנס לסרגל העליון בכל רינדור) ----------
  function muteBtn() {
    var bar = document.querySelector('.topbar');
    if (!bar || bar.querySelector('.mute')) return;
    var b = document.createElement('button');
    b.className = 'link mute'; b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', 'צלילים');
    b.addEventListener('click', function () {
      muted = !muted; try { localStorage.setItem('sk_mute', muted ? '1' : '0'); } catch (e) {}
      b.textContent = muted ? '🔇' : '🔊'; audio(); if (!muted) S.good();
    });
    bar.insertBefore(b, bar.firstChild);
  }

  // ---------- תגובה לשינויי מצב ----------
  function onRender(v, p) {
    muteBtn();
    if (!p || p === v || p.code !== v.code) return;
    if (p.phase === 'lobby' && v.phase === 'play') { S.start(); buzz(30); return; }
    if (p.phase === 'lobby' && v.phase === 'lobby') {
      var on = function (x) { return x.players.filter(function (q) { return q.online; }).length; };
      if (on(v) > on(p)) S.join();
      return;
    }
    if (p.phase !== 'play' || p.round !== v.round) return;
    var fresh = [];
    for (var i = 0; i < v.board.length; i++) if (v.board[i].rev && !(p.board[i] && p.board[i].rev)) fresh.push(i);
    if (fresh.length) {
      var col = v.board[fresh[0]].c;
      if (col === 'assassin') { S.boom(); flash(); buzz([80, 40, 200]); }
      else if (col === p.turn) { S.good(); buzz(20); }
      else if (col === 'neutral') { S.neutral(); buzz(30); }
      else { S.bad(); buzz([40, 30, 40]); }
    } else if (!p.clue && v.clue) { S.clue(); buzz(15); }
    if (v.phase === 'over' && v.winReason !== 'assassin') { setTimeout(function () { S.win(); confetti(v.winner); }, 650); }
    else if (v.phase === 'over') { setTimeout(function () { confetti(v.winner); }, 900); }
  }

  window.SKFX = { onRender: onRender };
})();
