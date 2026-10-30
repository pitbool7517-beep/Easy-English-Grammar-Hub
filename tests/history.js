// History and difficult cards test for Easy English Grammar Hub (stage 4).
// Run from the repository root:  node tests/history.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9200 + Math.floor(Math.random() * 90);
const SHIM = process.env.SHIM_DIR;

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

const daysAgo = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
let rid = 0;
const rv = (itemId, n, result) => ({ id: 'r' + ++rid, itemId, at: daysAgo(n, 10 + (rid % 8)), mode: result.startsWith('self') ? 'self' : 'ru2en', result });
const T = '2026-10-01T00:00:00.000Z';
const SEED = {
  schema: 2, progress: {}, settings: {}, meta: { createdAt: T, updatedAt: T, lastExportAt: null },
  topics: [{ id: 't_food', name: 'Еда', createdAt: T }, { id: 't_work', name: 'Работа', createdAt: T }],
  items: [
    { id: 'i1', type: 'word', en: 'apple', ru: 'яблоко', note: '', ipa: '', topicId: 't_food' },
    { id: 'i2', type: 'word', en: 'bread', ru: 'хлеб', note: '', ipa: '', topicId: 't_food' },
    { id: 'i3', type: 'word', en: 'water', ru: 'вода', note: '', ipa: '', topicId: 't_food' },
    { id: 'i4', type: 'word', en: 'colleague', ru: 'коллега', note: '', ipa: '', topicId: 't_work' },
    { id: 'i5', type: 'phrase', en: 'take a break', ru: 'сделать перерыв', note: '', ipa: '', topicId: 't_work' },
    { id: 'i6', type: 'rule', en: 'She works.', ru: 'he / she / it + глагол с -s', note: '', ipa: '', topicId: 't_work' },
  ],
  reviews: [
    rv('i1', 3, 'ok'), rv('i1', 1, 'wrong'),                          // ошибка последней → трудная
    rv('i2', 5, 'wrong'), rv('i2', 2, 'ok'), rv('i2', 1, 'ok'),       // два верных подряд → не трудная
    rv('i3', 2, 'ok'), rv('i3', 1, 'ok'),                             // без ошибок
    rv('i5', 4, 'wrong'), rv('i5', 3, 'ok'), rv('i5', 1, 'typo'),     // опечатка = верно → не трудная
    rv('i6', 3, 'ok'), rv('i6', 2, 'self-wrong'), rv('i6', 1, 'self-ok'), // после ошибки только один верный → трудная
  ],
};
const ANSWER_BY_RU = { 'яблоко': 'apple', 'хлеб': 'bread', 'вода': 'water', 'коллега': 'colleague', 'сделать перерыв': 'take a break' };
const store = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2')));
const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');
async function answerCard(page, kind = 'right') {
  const text = await mainText(page);
  if (await page.locator('#review-answer').count()) {
    let ru = (text.match(/Подсказка: (.+?) Ваш ответ/) || [])[1];
    if (!ru) ru = Object.keys(ANSWER_BY_RU).find((k) => text.includes('Как это по-английски? ' + k));
    await page.fill('#review-answer', kind === 'wrong' ? 'zzzz' : ANSWER_BY_RU[ru]);
    await page.click('main button:text-is("Проверить")');
    return ru;
  }
  await page.click('main button:text-is("Показать ответ")');
  await page.click(`main button:text-is("${kind === 'right' ? 'Знал' : 'Не знал'}")`);
  return 'rule';
}
async function runToSummary(page, kind = 'right') {
  for (let g = 0; g < 30 && !(await mainText(page)).includes('Итог занятия'); g++) { await answerCard(page, kind); await page.click('main button:has-text("Дальше")'); }
}
const hardChip = async (page) => Number(((await mainText(page)).match(/Трудные (\d+)/) || [])[1]);
const openBase = async (page) => { await page.click('aside >> text=Моя база'); await page.waitForTimeout(150); };
const openReview = async (page) => { await page.click('aside >> text=Главная'); await page.click('aside >> text=Повторение'); await page.waitForTimeout(150); };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // 0. Empty history
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('aside nav');
  await page.click('aside >> text=Повторение');
  await page.click('main >> text=Добавить 12 слов для пробы');
  check('No history yet: friendly placeholder', (await mainText(page)).includes('Здесь появятся ваши занятия по дням'));

  // 1. Difficult rule on prepared history
  await page.evaluate((s) => localStorage.setItem('eegh-data-v2', JSON.stringify(s)), SEED);
  await page.reload(); await page.waitForSelector('aside nav');
  check('Home shows how many cards are difficult', (await mainText(page)).includes('Трудных: 2'));
  await openBase(page);
  check('Base: "Трудные" filter counts 2 (apple and the rule)', (await hardChip(page)) === 2, `${await hardChip(page)}`);
  const badges = await page.locator('[data-hard]').count();
  check('Base: two cards carry the "трудная" badge', badges === 2, `${badges}`);
  const st1 = await page.innerText('[data-stat="i1"]');
  check('Base: per-card stats (answers, errors, last date)', /Ответов: 2 · ошибок: 1 · последний раз \d+ /.test(st1), st1);
  check('Base: never reviewed card says so', (await page.innerText('[data-stat="i4"]')).includes('Ещё не повторяли'));
  await page.click('main button[aria-pressed]:has-text("Трудные")');
  const shownHard = Number(((await mainText(page)).match(/Показано: (\d+)/) || [])[1]);
  check('Base: "Трудные" filter shows only 2 cards', shownHard === 2);

  // 2. Review setup: "Только трудные"
  await openReview(page);
  check('Review: "Только трудные" shows 2', (await mainText(page)).includes('Только трудные 2'));
  await page.click('#with-rules');
  check('Review: without rules only 1 difficult card fits', (await mainText(page)).includes('Только трудные 1'));
  await page.click('#with-rules');
  await page.click('main button[aria-pressed]:has-text("Только трудные")');
  check('Review: pool is the 2 difficult cards', (await mainText(page)).includes('Карточек в подборке: 2'));

  // 3. One right answer is not enough, two in a row are
  await page.click('main button:has-text("Начать")');
  await runToSummary(page, 'right');
  let s = await store(page);
  const sum1 = await mainText(page);
  check('After 1 right answer apple stays difficult, the rule (2 right in a row) leaves', sum1.includes('Все трудные карточки (1)'), (sum1.match(/Все трудные карточки \(\d+\)/) || ['none'])[0]);
  await page.click('main button:has-text("Все трудные карточки")');
  await runToSummary(page, 'right');
  check('After the 2nd right answer in a row apple leaves the difficult list', !(await mainText(page)).includes('Все трудные карточки'));
  await openBase(page);
  check('Base: difficult count is now 0', (await hardChip(page)) === 0);

  // 4. A mistake in a session makes a card difficult
  await openReview(page);
  await page.click('main button[aria-pressed]:has-text("Только трудные")').catch(() => {});
  await page.click('main button[aria-pressed]:has-text("Еда")');
  await page.click('main button[aria-pressed]:has-text("Вспомнить по-английски")');
  await page.click('main button:has-text("Начать")');
  const missed = await answerCard(page, 'wrong');
  await page.click('main button:text-is("Закончить")');
  s = await store(page);
  const missedId = SEED.items.find((i) => i.ru === missed).id;
  check('A wrong answer is saved for the right card', s.reviews[s.reviews.length - 1].itemId === missedId && s.reviews[s.reviews.length - 1].result === 'wrong');
  await openBase(page);
  check('That card becomes difficult right away', (await hardChip(page)) === 1 && (await page.locator(`li[data-item="${missedId}"] [data-hard]`).count()) === 1);

  // 5. History by day
  await openReview(page);
  const hist = await mainText(page);
  check('History: "Сегодня" row with today\'s answers', /Сегодня\s*\d+ ответ/.test(hist));
  check('History: streak counts today and the 5 previous days', hist.includes('Серия: 6 дней подряд'), (hist.match(/Серия: [^·]+?подряд/) || ['none'])[0]);
  check('History: chart has 14 day columns', (await page.locator('[data-day]').count()) === 14);
  const total = (await store(page)).reviews.length;
  check('History: total matches saved answers', hist.includes(`Всего ответов: ${total}`), `${total}`);
  check('History: earlier days listed', (await page.locator('[data-history-day]').count()) >= 6);

  // 6. Phone width
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check('No horizontal scroll at 375px (history chart scrolls inside its box)', w <= 375, `${w}px`);
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(350);
  await page.click('text=Моя база >> visible=true'); await page.waitForTimeout(300);
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check('No horizontal scroll at 375px in the base with stats', w2 <= 375, `${w2}px`);

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
