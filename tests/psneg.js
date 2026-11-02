// "Present Simple — Positive & Negative" section test.
// Run from the repository root:  node tests/psneg.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9400 + Math.floor(Math.random() * 90);
const SHIM = process.env.SHIM_DIR;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, d) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(d); });
});

const results = [];
const check = (name, ok, extra = '') => results.push([ok, name + (extra ? ` (${extra})` : '')]);

async function routeLibraries(page) {
  await page.route(/^https:\/\/(api\.|en\.wiktionary|fonts\.)/, (r) => r.abort());
  if (!SHIM) return;
  const send = (r, name) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SHIM, name)) });
  await page.route(/cdnjs\.cloudflare\.com\/.*\/react\.production/, (r) => send(r, 'react.js'));
  await page.route(/cdnjs\.cloudflare\.com\/.*react-dom/, (r) => send(r, 'empty.js'));
  await page.route(/babel-standalone/, (r) => send(r, 'babel.js'));
  await page.route(/cdn\.tailwindcss\.com|unpkg\.com/, (r) => send(r, 'empty.js'));
}

// ---------- 1. Data integrity (static, from index.html) ----------
const block = html.slice(html.indexOf('const PN_ENDINGS'), html.indexOf('const PN_TOTAL'));
const ctx = {};
vm.runInNewContext(block + '\nthis.D = { PN_CHOOSE, PN_TRANSFORM, PN_FIX, PN_TRANSLATE, PN_TEST, PN_ALL };', ctx);
const D = ctx.D;
const problems = [];
D.PN_CHOOSE.forEach((q) => { if (!q.options.includes(q.answer)) problems.push(q.id + ': answer not in options'); });
D.PN_TEST.forEach((q) => { if (!q.options.includes(q.answer)) problems.push(q.id + ': answer not in options'); if (new Set(q.options).size !== q.options.length) problems.push(q.id + ': duplicate options'); if (!q.rule) problems.push(q.id + ': no rule'); });
D.PN_FIX.forEach((q) => { const n = (q.text.match(/\[[^\]]+\]/g) || []).length; if (q.wrong >= n) problems.push(q.id + ': wrong index'); });
const allIds = D.PN_ALL.map((q) => q.id);
if (new Set(allIds).size !== allIds.length) problems.push('duplicate ids in section');
const otherIds = [...html.matchAll(/\bid: '([a-z]+\d+)'/g)].map((m) => m[1]);
if (allIds.some((id) => otherIds.includes(id))) problems.push('id clash with other sections');
check(`Data: ${D.PN_CHOOSE.length} choose, ${D.PN_TRANSFORM.length} transform, ${D.PN_FIX.length} fix, ${D.PN_TRANSLATE.length} translate, ${D.PN_TEST.length} test; answers consistent`,
  problems.length === 0 && D.PN_TEST.length === 10 && D.PN_CHOOSE.length >= 8, problems.join('; '));

const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');
const progressOf = async (page) => (JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2'))).progress);
const counter = async (page) => ((await page.innerText('header')).match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).join('/');

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // ---------- 2. Existing progress is kept ----------
  const old = { schema: 2, progress: { t1: { at: '2026-10-20T10:00:00.000Z' }, ar1: { at: null }, ps1: { at: null } }, topics: [], items: [], reviews: [], settings: {}, meta: {} };
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('eegh-data-v2', JSON.stringify(d)); }, old);
  await page.reload(); await page.waitForSelector('aside nav');
  check('Old progress kept, total grows: 3 / 110', (await counter(page)) === '3/110', await counter(page));

  // ---------- 3. Menu, home card, theory ----------
  check('Home has a card for the section', (await mainText(page)).includes('Present Simple: + и −'));
  await page.click('aside >> text=Present Simple: + и −');
  const theory = await mainText(page);
  check('Theory: both formulas', theory.includes('He / She / It + V1 + s / es') && theory.includes("He / She / It + doesn't + V1") && theory.includes("I / You / We / They + don't + V1"));
  check("Theory: highlighted rule about doesn't + V1 without -s", theory.includes("После doesn't основной глагол — без -s / -es"));
  check('Theory: -s / -es rules and examples with translation', theory.includes('watch → watches') && theory.includes('study → studies') && theory.includes('Он не любит кофе.'));
  check('Section is separate: other topics not shown here', !theory.includes('Артикли A / AN Вы уже знаете правило') && !theory.includes('Притяжательный падеж Апостроф'));

  // ---------- 4. Exercise 1: choose ----------
  const ex1 = 'main section:has-text("Упражнение 1: выберите форму")';
  await page.locator(`${ex1} button:text-is("work"):not([disabled])`).first().click();
  check('Ex1: wrong choice shows a hint and is not counted', (await mainText(page)).includes('Подсказка: she → глагол с -s') && !(await progressOf(page))['pn-c1']);
  for (const q of D.PN_CHOOSE) await page.locator(`${ex1} button:text-is("${q.answer}"):not([disabled])`).first().click();
  let p = await progressOf(page);
  check('Ex1: all choose answers counted', D.PN_CHOOSE.every((q) => p[q.id]));

  // ---------- 5. Exercise 2: transform (typed) ----------
  await page.fill('#in-pn-t2', "She doesn't plays the piano.");
  await page.press('#in-pn-t2', 'Enter');
  check("Ex2: \"doesn't plays\" is rejected", !(await progressOf(page))['pn-t2'] && (await page.locator('[data-q="pn-t2"]').innerText()).includes('Проверьте'));
  const variants = { 'pn-t1': "i don't like football", 'pn-t2': 'She does not play the piano', 'pn-t3': "They don’t live in London.", 'pn-t4': "He doesn't watch cartoons.", 'pn-t5': 'My cat does not eat fish.', 'pn-t6': "  Anna  doesn't have a car. " };
  for (const [id, v] of Object.entries(variants)) { await page.fill('#in-' + id, v); await page.press('#in-' + id, 'Enter'); }
  p = await progressOf(page);
  check('Ex2: full/short forms, case, curly apostrophe, spaces accepted', D.PN_TRANSFORM.every((q) => p[q.id]));

  // ---------- 6. Exercise 3: find and fix ----------
  for (const q of D.PN_FIX) {
    const box = page.locator(`[data-q="${q.id}"]`);
    const words = box.locator('button[aria-label$="отметить как ошибку"]');
    const other = q.wrong === 0 ? 1 : 0;
    await words.nth(other).click();
    if (q.id === 'pn-f1') check('Ex3: clicking a correct word says it is fine', (await box.innerText()).includes('Это слово стоит правильно'));
    await words.nth(q.wrong).click();
    if (q.id === 'pn-f2') {
      await page.fill('#fix-' + q.id, 'plays'); await page.press('#fix-' + q.id, 'Enter');
      check('Ex3: wrong correction rejected', !(await progressOf(page))[q.id]);
    }
    await page.fill('#fix-' + q.id, q.fix[q.fix.length - 1]); await page.press('#fix-' + q.id, 'Enter');
  }
  p = await progressOf(page);
  check('Ex3: all 6 errors found and fixed (also "does not")', D.PN_FIX.every((q) => p[q.id]));

  // ---------- 7. Exercise 4: translate ----------
  const tr = { 'pn-r1': "I don't drink coffee", 'pn-r2': 'She works at the office.', 'pn-r3': 'He does not like fish.', 'pn-r4': 'We live in Kazan', 'pn-r5': "My brother doesn't play football.", 'pn-r6': 'The kids watch cartoons.' };
  await page.fill('#in-pn-r3', 'He not like fish.'); await page.press('#in-pn-r3', 'Enter');
  check('Ex4: wrong translation rejected with a words hint', (await page.locator('[data-q="pn-r3"]').innerText()).includes('like — любить'));
  for (const [id, v] of Object.entries(tr)) { await page.fill('#in-' + id, v); await page.press('#in-' + id, 'Enter'); }
  p = await progressOf(page);
  check('Ex4: translations with accepted variants counted', D.PN_TRANSLATE.every((q) => p[q.id]));

  // ---------- 8. Final test ----------
  const wrongOnPurpose = ['pn-q2', 'pn-q9'];
  for (const q of D.PN_TEST) {
    const box = page.locator(`[data-q="${q.id}"]`);
    const pick = wrongOnPurpose.includes(q.id) ? q.options.find((o) => o !== q.answer) : q.answer;
    await box.locator(`button:text-is(${JSON.stringify(pick)})`).click();
    const t = await box.innerText();
    if (q.id === 'pn-q2') check('Test: after a wrong answer — "Неверно", the right option and the rule', t.includes('Неверно') && t.includes(`Правильный ответ: ${q.answer}`) && t.includes('Правило:'));
    if (q.id === 'pn-q1') check('Test: after a right answer — "Верно!" and the rule', t.includes('Верно!') && t.includes('Правило:'));
    if (q.id === 'pn-q1') check('Test: answer is locked after the first click', (await box.locator('button[disabled]').count()) === q.options.length);
  }
  const res = await mainText(page);
  check('Test: result 8 of 10 with advice', res.includes('Результат: 8 из 10') && res.includes('Пройти заново'));
  p = await progressOf(page);
  check('Test: only right answers counted (8)', D.PN_TEST.filter((q) => p[q.id]).length === 8);
  await page.click('main button:has-text("Пройти заново")');
  for (const id of wrongOnPurpose) { const q = D.PN_TEST.find((x) => x.id === id); await page.locator(`[data-q="${id}"] button:text-is(${JSON.stringify(q.answer)})`).click(); }
  p = await progressOf(page);
  check('Test: retake adds the missed questions (10/10)', D.PN_TEST.every((q) => p[q.id]));

  // ---------- 9. Progress after reload ----------
  await page.reload(); await page.waitForSelector('aside nav');
  check(`Progress survives reload: 3 old + ${D.PN_ALL.length} new = ${3 + D.PN_ALL.length} / 110`, (await counter(page)) === `${3 + D.PN_ALL.length}/110`, await counter(page));
  p = await progressOf(page);
  check('Old answers untouched (t1 keeps its date)', p.t1 && p.t1.at === '2026-10-20T10:00:00.000Z' && p.ar1 && p.ps1);
  const nav = await page.innerText('aside');
  check('Menu shows section count 38/38', nav.includes('Present Simple: + и −') && nav.replace(/\s+/g, ' ').includes(`${D.PN_ALL.length}/${D.PN_ALL.length}`));

  // ---------- 10. Phone ----------
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(350);
  await page.click('text=Present Simple: + и − >> visible=true'); await page.waitForTimeout(400);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Phone 375px: section opens from the menu, no horizontal scroll', w <= 375 && (await mainText(page)).includes('Present Simple: утверждение и отрицание'), `${w}px`);
  await page.click('main button:has-text("Перемешать упражнения")');
  await page.waitForTimeout(200);
  const f = page.locator('[data-q="pn-f1"] button[aria-label$="отметить как ошибку"]').nth(1);
  await f.click();
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Phone 375px: fix input fits on screen', w2 <= 375, `${w2}px`);

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
