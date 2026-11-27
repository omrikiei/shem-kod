const assert = require('assert');
const G = require('../game.js');
const WORDS = require('../words.js');

// מילים
assert(WORDS.length >= 300, 'מעט מדי מילים: ' + WORDS.length);
WORDS.forEach(w => {
  assert(!/\s/.test(w), 'רווח במילה: ' + w);
  assert(w.length <= 9, 'מילה ארוכה: ' + w);
});
assert.strictEqual(new Set(WORDS).size, WORDS.length);

// rng דטרמיניסטי
let seed = 7;
const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

const s = G.newState('ABCD', 'h', 'מארח', rng);
['a', 'b', 'c', 'd'].forEach(id => G.addPlayer(s, id, 'שחקן ' + id, rng));
assert(G.startCheck(s));
G.setTeam(s, 'h', 'red'); G.setRole(s, 'h', 'spy');
G.setTeam(s, 'a', 'red');
G.setTeam(s, 'b', 'blue'); G.setRole(s, 'b', 'spy');
G.setTeam(s, 'c', 'blue');
assert.strictEqual(G.setRole(s, 'a', 'spy').err, 'כבר יש ראש מרגלים בקבוצה הזאת');
assert.strictEqual(G.startCheck(s), null);
assert.strictEqual(G.startGame(s, WORDS, rng).ok, true);

// פיזור הקלפים
const cnt = {};
s.key.forEach(k => cnt[k] = (cnt[k] || 0) + 1);
assert.strictEqual(cnt[s.starter], 9);
assert.strictEqual(cnt[G.other(s.starter)], 8);
assert.strictEqual(cnt.neutral, 7);
assert.strictEqual(cnt.assassin, 1);
assert.strictEqual(new Set(s.words).size, 25);

// הסתרת המפתח
const spyView = G.viewFor(s, 'h');
const agView = G.viewFor(s, 'a');
assert(spyView.board.every(c => c.c));
assert(agView.board.every(c => c.c === null), 'סוכן רואה מפתח!');
assert(!JSON.stringify(agView).includes('"key"'));

// סדר תורות
const first = s.turn, second = G.other(first);
const spyFirst = first === 'red' ? 'h' : 'b', agFirst = first === 'red' ? 'a' : 'c';
const spySecond = first === 'red' ? 'b' : 'h', agSecond = first === 'red' ? 'c' : 'a';
assert(G.giveClue(s, spySecond, 'מילה', 2).err, 'ראש מרגלים של הקבוצה השנייה נתן רמז');
assert(G.guess(s, agFirst, 0).err, 'ניחוש לפני רמז');
assert(G.giveClue(s, spyFirst, 'שתי מילים', 2).err);
assert(G.giveClue(s, spyFirst, s.words[0], 2).err, 'רמז = מילה על הלוח');
assert.strictEqual(G.giveClue(s, spyFirst, 'רמז', 2).ok, true);
assert(G.endTurn(s, agFirst).err, 'סיום תור בלי ניחוש');
assert(G.guess(s, agSecond, 0).err, 'ניחוש מקבוצה לא נכונה');
assert(G.guess(s, spyFirst, 0).err, 'ראש מרגלים מנחש');

// ניחוש נכון ממשיך, שגוי מחליף תור
const idxOwn = s.key.findIndex((k, i) => k === first && !s.revealed[i]);
assert.strictEqual(G.guess(s, agFirst, idxOwn).res, 'own');
assert.strictEqual(s.turn, first);
assert.strictEqual(s.guessesLeft, 2);
assert.strictEqual(G.guess(s, agFirst, idxOwn).err, 'הקלף כבר נחשף');
const idxNeutral = s.key.indexOf('neutral');
assert.strictEqual(G.guess(s, agFirst, idxNeutral).res, 'neutral');
assert.strictEqual(s.turn, second);
assert.strictEqual(s.clue, null);

// מגבלת ניחושים (מספר+1)
G.giveClue(s, spySecond, 'עוד', 1);
const own2 = s.key.map((k, i) => k === second ? i : -1).filter(i => i >= 0);
G.guess(s, agSecond, own2[0]);
assert.strictEqual(s.turn, second);
G.guess(s, agSecond, own2[1]);
assert.strictEqual(s.turn, first, 'אחרי num+1 ניחושים התור עובר');

// ללא הגבלה (0 / ∞)
G.giveClue(s, spyFirst, 'בלי', -1);
assert.strictEqual(s.guessesLeft, null);
assert.strictEqual(G.guess(s, agFirst, own2[2]).res, 'enemy');
assert.strictEqual(s.turn, second);

// כל הקלפים של קבוצה → ניצחון (גם אם הוחשפו ע"י הקבוצה השנייה)
const s2 = G.newState('WXYZ', 'h', 'מארח', rng);
['a', 'b', 'c'].forEach(id => G.addPlayer(s2, id, id, rng));
G.setTeam(s2, 'h', 'red'); G.setRole(s2, 'h', 'spy'); G.setTeam(s2, 'a', 'red');
G.setTeam(s2, 'b', 'blue'); G.setRole(s2, 'b', 'spy'); G.setTeam(s2, 'c', 'blue');
G.startGame(s2, WORDS, rng);
const t = s2.turn, ag = t === 'red' ? 'a' : 'c', sp = t === 'red' ? 'h' : 'b';
G.giveClue(s2, sp, 'הכל', -1);
s2.key.forEach((k, i) => { if (k === t) G.guess(s2, ag, i); });
assert.strictEqual(s2.phase, 'over');
assert.strictEqual(s2.winner, t);
assert.strictEqual(s2.scores[t], 1);
assert(G.viewFor(s2, 'a').board.every(c => c.c), 'בסוף המשחק כולם רואים מפתח');

// מתנקש
const s3 = G.newState('QQQQ', 'h', 'מארח', rng);
['a', 'b', 'c'].forEach(id => G.addPlayer(s3, id, id, rng));
G.setTeam(s3, 'h', 'red'); G.setRole(s3, 'h', 'spy'); G.setTeam(s3, 'a', 'red');
G.setTeam(s3, 'b', 'blue'); G.setRole(s3, 'b', 'spy'); G.setTeam(s3, 'c', 'blue');
G.startGame(s3, WORDS, rng);
const t3 = s3.turn, ag3 = t3 === 'red' ? 'a' : 'c', sp3 = t3 === 'red' ? 'h' : 'b';
G.giveClue(s3, sp3, 'פח', 1);
assert.strictEqual(G.guess(s3, ag3, s3.key.indexOf('assassin')).res, 'assassin');
assert.strictEqual(s3.winner, G.other(t3));
assert.strictEqual(s3.winReason, 'assassin');
assert(G.guess(s3, ag3, 0).err);

// חזרה ללובי ומשחק חדש
G.toLobby(s3);
assert.strictEqual(s3.phase, 'lobby');
assert.strictEqual(G.startGame(s3, WORDS, rng).ok, true);
assert.strictEqual(s3.round, 2);

// הגבלת שחקנים והסרה
const s4 = G.newState('MMMM', 'h', 'מארח', rng);
for (let i = 0; i < 40; i++) G.addPlayer(s4, 'p' + i, 'x', rng);
assert.strictEqual(s4.order.length, G.MAX_PLAYERS);
assert.strictEqual(G.removePlayer(s4, 'h'), false);
assert.strictEqual(G.removePlayer(s4, 'p3'), true);

console.log('כל הבדיקות עברו ✓ (' + WORDS.length + ' מילים)');
