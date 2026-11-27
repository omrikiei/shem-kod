// בדיקה: מצב המשחק נשמר בדיסק של השרת, ושחקנים מתחברים מחדש אחרי הפעלה מחדש של השרת.
// הרצה: node test/e2e-server-restart.js
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PORT = 8799;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
const URL_ = 'http://127.0.0.1:' + PORT + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let srv;
function startServer() {
  srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, BIND: '127.0.0.1' }, stdio: 'ignore' });
  return sleep(800);
}
const waitText = (page, t, ms = 20000) => page.waitForFunction(x => document.getElementById('app').innerText.includes(x), t, { timeout: ms });
const btn = (page, t) => page.locator('button', { hasText: t }).first();

(async () => {
  await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const mk = async name => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.error('PAGEERROR', name, e.message); process.exitCode = 1; });
    page.on('dialog', d => d.accept());
    return { name, page };
  };
  const ps = [await mk('א'), await mk('ב'), await mk('ג'), await mk('ד')];
  const [h, a, s2, b] = ps;
  await h.page.goto(URL_); await h.page.fill('#in-name', h.name); await btn(h.page, 'פתח משחק').click();
  await waitText(h.page, 'קוד הצטרפות');
  const code = (await h.page.locator('.codebox .code').innerText()).trim();
  for (const p of [a, s2, b]) {
    await p.page.goto(URL_); await p.page.fill('#in-name', p.name); await p.page.fill('#in-code', code);
    await btn(p.page, 'הצטרף').click(); await waitText(p.page, 'הבחירה שלך');
  }
  const setup = async (p, team, spy) => {
    await p.page.locator('.me-actions button', { hasText: team }).first().click(); await sleep(300);
    if (spy) { await p.page.locator('.seg button', { hasText: 'ראש מרגלים' }).click(); await sleep(300); }
  };
  await setup(h, 'אדומים', true); await setup(a, 'אדומים', false); await setup(s2, 'כחולים', true); await setup(b, 'כחולים', false);
  await btn(h.page, 'התחל משחק').click();
  for (const p of ps) await p.page.waitForSelector('.board .cell');
  const turn = await h.page.locator('.score .tm.on').first().evaluate(e => e.classList.contains('red') ? 'red' : 'blue');
  const spy = turn === 'red' ? h : s2;
  await spy.page.fill('#in-clue', 'שמור'); await btn(spy.page, 'שלח').click();
  await waitText(a.page, 'שמור');
  const norm = a => a.map(t => t.replace(/[^\u05D0-\u05EA']/g, ''));
  const words = norm(await h.page.locator('.cell').allInnerTexts());
  await sleep(500);

  // השרת נופל ועולה מחדש
  srv.kill('SIGTERM'); await sleep(1200);
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'rooms.json'), 'utf8'));
  assert(saved[code], 'החדר לא נשמר בדיסק');
  assert.strictEqual(saved[code].state.clue.word, 'שמור');
  console.log('המצב נשמר בדיסק ✓');
  await startServer();
  for (const p of ps) await waitText(p.page, 'שמור', 30000);
  const words2 = norm(await h.page.locator('.cell').allInnerTexts());
  assert.deepStrictEqual(words2, words, 'הלוח השתנה אחרי הפעלה מחדש');
  await waitText(h.page, '4 מחוברים', 30000);
  console.log('כל השחקנים חזרו אוטומטית ללוח ולרמז ✓');

  // אחרי ההפעלה מחדש אפשר להמשיך לשחק
  const ag = turn === 'red' ? a : b;
  const idx = await spy.page.locator('.cell').evaluateAll((els, t) => els.findIndex(e => e.classList.contains('hint') && e.classList.contains(t)), turn);
  await ag.page.locator('.cell').nth(idx).click(); await btn(ag.page, 'כן, לחשוף').click();
  await h.page.waitForSelector('.cell.rev');
  console.log('המשחק ממשיך כרגיל ✓');
  await browser.close(); srv.kill('SIGTERM');
  console.log('E2E restart עבר ✓');
})().catch(e => { console.error('נכשל:', e); try { srv.kill(); } catch (_) {} process.exit(1); });
