// בדיקת קצה-לקצה: 4 שחקנים (4 הקשרי דפדפן מבודדים) מתחברים ב-WebRTC אמיתי דרך ברוקר PeerJS.
// הרצה: node test/e2e.js [URL]   (דורש playwright-core + Chrome מותקן)
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const assert = require('assert');
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const OUT = process.env.OUT || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitText(page, txt, ms = 20000) {
  await page.waitForFunction(t => document.getElementById('app').innerText.includes(t), txt, { timeout: ms });
}
const btn = (page, txt) => page.locator('button', { hasText: txt }).first();

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream']
  });
  const mk = async name => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.error('PAGEERROR', name, e.message); process.exitCode = 1; });
    page.on('dialog', d => d.accept());
    return { name, ctx, page };
  };
  const host = await mk('אמא'), p2 = await mk('אבא'), p3 = await mk('דני'), p4 = await mk('נועה');
  const all = [host, p2, p3, p4];

  // מארח פותח
  await host.page.goto(URL_);
  await host.page.fill('#in-name', host.name);
  await btn(host.page, 'פתח משחק').click();
  await waitText(host.page, 'קוד הצטרפות');
  const code = (await host.page.locator('.codebox .code').innerText()).trim();
  console.log('קוד:', code);
  assert(/^[A-Z0-9]{4}$/.test(code));

  // שלושה מצטרפים (אחד דרך קישור)
  for (const p of [p2, p3, p4]) {
    if (p === p4) await p.page.goto(URL_ + '?join=' + code);
    else await p.page.goto(URL_);
    await p.page.fill('#in-name', p.name);
    if (p !== p4) await p.page.fill('#in-code', code.toLowerCase());
    await btn(p.page, 'הצטרף').click();
    await waitText(p.page, 'הבחירה שלך');
  }
  await waitText(host.page, '4 מחוברים');
  console.log('4 שחקנים מחוברים ✓');

  // קבוצות ותפקידים: אמא=אדום+ראש מרגלים, אבא=אדום, דני=כחול+ראש מרגלים, נועה=כחול
  const setup = async (p, team, spy) => {
    await p.page.locator('.me-actions button', { hasText: team }).first().click();
    await sleep(300);
    if (spy) await p.page.locator('.seg button', { hasText: 'ראש מרגלים' }).click();
    await sleep(300);
  };
  await setup(host, 'אדומים', true); await setup(p2, 'אדומים', false);
  await setup(p3, 'כחולים', true); await setup(p4, 'כחולים', false);
  await sleep(600);
  await host.page.screenshot({ path: OUT + '/sk-lobby.png' });
  await btn(host.page, 'התחל משחק').click();
  for (const p of all) await p.page.waitForSelector('.board .cell', { timeout: 15000 });
  console.log('המשחק התחיל ✓');

  // אבטחה: סוכנים לא מקבלים מפתח; ראשי מרגלים כן
  const hints = async p => p.page.locator('.cell.hint').count();
  assert.strictEqual(await hints(host), 25, 'ראש מרגלים לא רואה מפתח');
  assert.strictEqual(await hints(p3), 25);
  assert.strictEqual(await hints(p2), 0, 'סוכן רואה מפתח!');
  assert.strictEqual(await hints(p4), 0, 'סוכן רואה מפתח!');
  console.log('הסתרת מפתח ✓');

  // מי מתחיל?
  const turnTeam = await host.page.locator('.score .tm.on').first().evaluate(e => e.classList.contains('red') ? 'red' : 'blue');
  const spy = turnTeam === 'red' ? host : p3, ag = turnTeam === 'red' ? p2 : p4;
  const otherAg = turnTeam === 'red' ? p4 : p2;

  // סוכן יריב לא יכול לנחש / לראות פקדים
  assert.strictEqual(await otherAg.page.locator('button', { hasText: 'סיים תור' }).count(), 0);

  // רמז
  await spy.page.fill('#in-clue', 'ניסיון');
  await spy.page.selectOption('#in-num', '2');
  await btn(spy.page, 'שלח').click();
  await waitText(ag.page, 'ניסיון');
  console.log('רמז הגיע לסוכן ✓');

  // ניחוש: מצא קלף של הקבוצה לפי מה שראש המרגלים רואה
  const idxOwn = await spy.page.locator('.cell').evaluateAll((els, t) => els.findIndex(e => e.classList.contains('hint') && e.classList.contains(t)), turnTeam);
  await ag.page.locator('.cell').nth(idxOwn).click();
  await ag.page.waitForSelector('.sheet');
  await ag.page.screenshot({ path: OUT + '/sk-agent-confirm.png' });
  await btn(ag.page, 'כן, לחשוף').click();
  await host.page.waitForSelector('.cell.rev', { timeout: 10000 });
  await spy.page.screenshot({ path: OUT + '/sk-spy.png' });
  await ag.page.screenshot({ path: OUT + '/sk-agent.png' });
  console.log('ניחוש נכון נחשף אצל כולם ✓');

  // התחברות מחדש: סוכן 2 מרענן דף ונכנס אוטומטית
  await p2.page.reload();
  await p2.page.waitForSelector('.board .cell', { timeout: 20000 });
  console.log('חיבור מחדש אוטומטי של שחקן ✓');

  // ריענון המארח: משחזר מצב מ-localStorage ושחקנים חוזרים
  await host.page.reload();
  await host.page.waitForSelector('.board .cell', { timeout: 30000 });
  assert.strictEqual(await host.page.locator('.cell.rev').count(), 1, 'מצב המארח לא שוחזר');
  await waitText(host.page, '4 מחוברים', 40000);
  console.log('שחזור מארח + חיבור מחדש של כולם ✓');

  // ניחוש על המתנקש - סיום משחק
  const idxAss = await spy.page.locator('.cell').evaluateAll(els => els.findIndex(e => e.classList.contains('hint') && e.classList.contains('assassin')));
  await ag.page.locator('.cell').nth(idxAss).click();
  await btn(ag.page, 'כן, לחשוף').click();
  for (const p of all) await waitText(p.page, 'ניצחה');
  await p3.page.screenshot({ path: OUT + '/sk-over.png' });
  assert.strictEqual(await p2.page.locator('.cell.hint, .cell.rev').count(), 25, 'בסוף המשחק כולם אמורים לראות את כל הצבעים');
  console.log('סיום משחק (מתנקש) ✓');

  // משחק חדש
  await btn(host.page, 'משחק חדש').click();
  for (const p of all) await waitText(p.page, 'הבחירה שלך');
  console.log('חזרה ללובי ✓');

  await browser.close();
  console.log('E2E עבר ✓');
})().catch(e => { console.error('E2E נכשל:', e); process.exit(1); });
