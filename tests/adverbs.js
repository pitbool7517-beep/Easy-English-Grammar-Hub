// "Adverbs of Frequency" section test.
// Run from the repository root:  node tests/adverbs.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { goNav } = require('./helpers');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9600 + Math.floor(Math.random() * 90);
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

// ---------- 1. Data and grammar (static) ----------
const block = html.slice(html.indexOf('const ADV_SCALE'), html.indexOf('const ADV_TOTAL'));
const ctx = {};
vm.runInNewContext(block + '\nthis.D = { ADV_SCALE, ADV_RULES, ADV_CHOOSE, ADV_POSITION, ADV_ORDER, ADV_TRANSLATE, ADV_TEST, ADV_ALL };', ctx);
const D = ctx.D;
const problems = [];
[...D.ADV_CHOOSE, ...D.ADV_POSITION, ...D.ADV_TEST].forEach((q) => { if (!q.options.includes(q.answer)) problems.push(q.id + ': answer not in options'); if (new Set(q.options).size !== q.options.length) problems.push(q.id + ': duplicate options'); });
D.ADV_ORDER.forEach((q) => { if (q.words.join(' ') + q.end !== q.accept[0]) problems.push(q.id + ': words do not build accept[0]'); });
const ids = D.ADV_ALL.map((q) => q.id);
if (new Set(ids).size !== ids.length) problems.push('duplicate ids');
const otherIds = [...html.slice(0, html.indexOf('const ADV_SCALE')).matchAll(/\bid: '([a-z-]+\d+)'/g)].map((m) => m[1]);
if (ids.some((id) => otherIds.includes(id))) problems.push('id clash with other sections');
check(`Data: ${ids.length} tasks (${D.ADV_CHOOSE.length}/${D.ADV_POSITION.length}/${D.ADV_ORDER.length}/${D.ADV_TRANSLATE.length} + test ${D.ADV_TEST.length}), consistent`, problems.length === 0 && D.ADV_TEST.length === 10, problems.join('; '));
const required = ['always', 'usually', 'often', 'sometimes', 'rarely', 'hardly ever', 'never'];
check('Theory: all 7 required adverbs in order, 100% → 0%', JSON.stringify(D.ADV_SCALE.map((a) => a.en)) === JSON.stringify(required) && D.ADV_SCALE[0].pct === 100 && D.ADV_SCALE[6].pct === 0 && D.ADV_SCALE.every((a, i, arr) => i === 0 || a.pct < arr[i - 1].pct));

// Grammar sanity on every correct English sentence in the section
const ADV = '(always|usually|often|sometimes|rarely|hardly ever|never)';
const correct = [
  ...D.ADV_SCALE.map((a) => a.ex), ...D.ADV_RULES.flatMap((r) => r.ex.map((e) => e[0])), ...D.ADV_ORDER.flatMap((q) => q.accept),
  ...D.ADV_TRANSLATE.flatMap((q) => q.accept), ...D.ADV_POSITION.map((q) => q.answer), ...D.ADV_TEST.map((q) => q.answer).filter((a) => /\s/.test(a) && /^[A-Z]/.test(a)),
];
const bad = correct.filter((s) =>
  new RegExp(`\\b${ADV}\\s+(am|is|are)\\b`, 'i').test(s) ||                       // adverb before to be
  /\b(don't|doesn't)\s+never\b/i.test(s) ||                                        // double negative
  new RegExp(`\\b(he|she|it|tom|anna|my dad|my brother)\\s+${ADV}\\s+(drink|read|walk|watch|drive|eat|go|work)\\b`, 'i').test(s) || // missing -s
  !/[.?!]$/.test(s));
check(`Grammar: ${correct.length} correct sentences pass placement / -s / double-negative checks`, bad.length === 0, bad.join(' | '));
const wrongs = D.ADV_POSITION.flatMap((q) => q.options.filter((o) => o !== q.answer));
check('Grammar: every wrong option in "Где стоит наречие?" differs from the right one', wrongs.every((w) => !correct.includes(w)));

const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');
const progressOf = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2'))).progress;
const counter = async (page) => ((await page.innerText('header')).match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).join('/');
const tab = (page, name) => page.click(`main [role=tab]:has-text("${name}")`);
const solvedIn = async (page, list) => { const p = await progressOf(page); return list.filter((q) => p[q.id]).length; };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // ---------- 2. Existing progress kept ----------
  const old = { schema: 2, progress: { ps1: { at: '2026-10-20T10:00:00.000Z' }, ar1: { at: null } }, topics: [], items: [], reviews: [], settings: {}, meta: {} };
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('eegh-data-v2', JSON.stringify(d)); }, old);
  await page.reload(); await page.waitForSelector('aside nav');
  check('Old progress kept, total grows: 2 / 143', (await counter(page)) === '2/143', await counter(page));
  check('Home has a card for the topic', (await mainText(page)).includes('Adverbs of Frequency') && (await mainText(page)).includes(`0 / ${ids.length} заданий`));

  // ---------- 3. Rules ----------
  await goNav(page, 'Adverbs of Frequency');
  const navItem = page.locator('aside button[data-nav-item="adverbs"]');
  check('Menu: topic is in the "Грамматика" group', (await navItem.getAttribute('data-group')) === (await page.locator('aside button[data-nav-item="psimple"]').getAttribute('data-group')));
  const rules = await mainText(page);
  check('Rules: every adverb with Russian translation', required.every((a) => rules.includes(a)) && ['всегда', 'обычно', 'часто', 'иногда', 'редко', 'почти никогда', 'никогда'].every((r) => rules.includes(r)));
  check('Rules: scale shows 100% … 0%', rules.includes('100%') && rules.includes('0%'));
  check('Rule 1 (before the verb) with translations', rules.includes('I always drink coffee.') && rules.includes('Я всегда пью кофе.') && rules.includes('She often reads books.') && rules.includes('Она часто читает книги.'));
  check('Rule 2 (after am/is/are) with translations', rules.includes('I am always busy.') && rules.includes('Я всегда занят.') && rules.includes('He is usually happy.') && rules.includes('Он обычно счастлив.'));
  check('Rule 3 (How often) with translations', rules.includes('How often do you exercise?') && rules.includes('Как часто ты занимаешься спортом?') && rules.includes('How often does she read?') && rules.includes('Как часто она читает?'));
  await page.click('main [data-adverb="never"]');
  check('Scale: clicking "never" shows its example', (await mainText(page)).includes('They never eat fast food.') && (await mainText(page)).includes('Они никогда не едят фастфуд.'));

  // ---------- 4. Practice ----------
  await tab(page, 'Упражнения');
  const ex1 = 'main section:has-text("1. Выберите наречие")';
  await page.locator(`${ex1} button:text-is("never"):not([disabled])`).first().click();
  check('Ex1: wrong adverb gives a hint, not counted', !(await progressOf(page))['adv-c1'] && (await mainText(page)).includes('Не совсем'));
  check('Ex1: situation shown above the gap', (await mainText(page)).includes('Tom drinks coffee every morning, without exceptions.'));
  for (const q of D.ADV_CHOOSE) await page.locator(`${ex1} button:text-is(${JSON.stringify(q.answer)}):not([disabled])`).first().click();
  check('Ex1: all choose answers counted', (await solvedIn(page, D.ADV_CHOOSE)) === D.ADV_CHOOSE.length);

  for (const q of D.ADV_POSITION) {
    const box = page.locator(`[data-q="${q.id}"]`);
    if (q.id === 'adv-p3') {
      await box.locator('button:text-is("He never is late.")').click();
      check('Ex2: wrong position shows the right sentence and the rule', (await box.innerText()).includes('Правильно: «He is never late.»') && !(await progressOf(page))['adv-p3']);
    }
    await box.locator(`button:text-is(${JSON.stringify(q.answer)})`).click();
  }
  check('Ex2: all position answers counted', (await solvedIn(page, D.ADV_POSITION)) === D.ADV_POSITION.length);

  for (const q of D.ADV_ORDER) {
    const box = page.locator(`[data-q="${q.id}"]`);
    const words = q.id === 'adv-o3' ? ['sometimes', 'We', 'eat', 'pizza', 'on', 'Fridays'] : q.words;
    if (q.id === 'adv-o1') {
      for (const w of ['usually', 'I', 'to', 'walk', 'work']) await box.locator(`[data-tile="pool"]:text-is("${w}")`).first().click();
      await box.locator('button:text-is("Проверить")').click();
      check('Ex3: wrong word order rejected with the right sentence', (await box.innerText()).includes('Порядок неверный') && !(await progressOf(page))['adv-o1']);
      await box.locator('button:text-is("Сначала")').click();
    }
    if (q.id === 'adv-o2') {
      await box.locator('[data-tile="pool"]:text-is("She")').click();
      await box.locator('[data-line] [data-tile="line"]:text-is("She")').click();
      check('Ex3: a word can be taken back from the line', (await box.locator('[data-tile="line"]').count()) === 0);
    }
    for (const w of words) await box.locator(`[data-tile="pool"]:text-is("${w}")`).first().click();
    await box.locator('button:text-is("Проверить")').click();
  }
  const p = await progressOf(page);
  check('Ex3: all word-order tasks counted (incl. "Sometimes we eat…" variant)', D.ADV_ORDER.every((q) => p[q.id]));

  await page.fill('#in-adv-r3', 'He never is late.'); await page.press('#in-adv-r3', 'Enter');
  check('Ex4: "He never is late" rejected with a placement hint', !(await progressOf(page))['adv-r3'] && (await page.locator('[data-q="adv-r3"]').innerText()).includes('Проверьте место наречия'));
  const tr = { 'adv-r1': 'i always eat breakfast at home', 'adv-r2': 'She often reads books.', 'adv-r3': "He's never late.", 'adv-r4': 'Sometimes we work from home.', 'adv-r5': 'How often do you go to the gym', 'adv-r6': 'My brother is usually busy.' };
  for (const [id, v] of Object.entries(tr)) { await page.fill('#in-' + id, v); await page.press('#in-' + id, 'Enter'); }
  check('Ex4: translations with variants counted', (await solvedIn(page, D.ADV_TRANSLATE)) === D.ADV_TRANSLATE.length);

  // ---------- 5. Final test ----------
  await tab(page, 'Итоговый тест');
  for (const q of D.ADV_TEST) {
    const pick = q.id === 'adv-q5' ? 'do' : q.answer;
    await page.locator(`[data-q="${q.id}"] button:text-is(${JSON.stringify(pick)})`).click();
  }
  const t5 = await page.locator('[data-q="adv-q5"]').innerText();
  check('Test: wrong answer shows correct option and rule', t5.includes('Неверно') && t5.includes('Правильный ответ: does') && t5.includes('Правило:'));
  check('Test: "Вопрос 1 из 10" and result 9 of 10', (await mainText(page)).includes('Вопрос 1 из 10') && (await mainText(page)).includes('Результат: 9 из 10'));
  await page.click('main button:has-text("Пройти заново")');
  await page.locator('[data-q="adv-q5"] button:text-is("does")').click();
  check('Test: retake adds the missed question', (await solvedIn(page, D.ADV_TEST)) === 10);

  // ---------- 6. Persistence ----------
  await page.reload(); await page.waitForSelector('aside nav');
  check(`After reload: 2 old + ${ids.length} = ${2 + ids.length} / 143`, (await counter(page)) === `${2 + ids.length}/143`, await counter(page));
  const pp = await progressOf(page);
  check('Old answers untouched', pp.ps1.at === '2026-10-20T10:00:00.000Z' && pp.ar1);
  check('Present Simple test still works with its own questions', html.includes('<FinalTest progress={progress} onCorrect={onCorrect} />') && html.includes('questions={ADV_TEST}'));

  // ---------- 7. Phone ----------
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(350);
  await goNav(page, 'Adverbs of Frequency', '[data-drawer]');
  const widths = [];
  for (const name of ['Правила', 'Упражнения', 'Итоговый тест']) { await tab(page, name); await page.waitForTimeout(200); widths.push(await page.evaluate(() => document.documentElement.scrollWidth)); }
  check('Phone 375px: opened from the phone menu, no horizontal scroll on any tab', widths.every((w) => w <= 375) && (await mainText(page)).includes('Adverbs of Frequency'), widths.join(','));

  check('No page or console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
