// "Повторение" test for Easy English Grammar Hub (stage 3: review sessions).
// Run from the repository root:  node tests/review.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9100 + Math.floor(Math.random() * 90);
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

const T = '2026-10-01T00:00:00.000Z';
const SEED = {
  schema: 2, progress: {}, settings: {}, reviews: [], meta: { createdAt: T, updatedAt: T, lastExportAt: null },
  topics: [{ id: 't_food', name: 'Еда', createdAt: T }, { id: 't_work', name: 'Работа', createdAt: T }],
  items: [
    { id: 'i1', type: 'word', en: 'apple', ru: 'яблоко', note: 'I eat an apple every day.', ipa: '', topicId: 't_food' },
    { id: 'i2', type: 'word', en: 'bread', ru: 'хлеб', note: 'Fresh bread is tasty.', ipa: '', topicId: 't_food' },
    { id: 'i3', type: 'word', en: 'water', ru: 'вода', note: '', ipa: '', topicId: 't_food' },
    { id: 'i4', type: 'word', en: 'colleague', ru: 'коллега', note: 'My colleague is nice.', ipa: '', topicId: 't_work' },
    { id: 'i5', type: 'phrase', en: 'take a break', ru: 'сделать перерыв', note: "Let's take a break.", ipa: '', topicId: 't_work' },
    { id: 'i6', type: 'rule', en: 'She works.', ru: 'he / she / it + глагол с -s', note: 'Present Simple', ipa: '', topicId: 't_work' },
  ],
};
const ANSWER_BY_RU = { 'яблоко': 'apple', 'хлеб': 'bread', 'вода': 'water', 'коллега': 'colleague', 'сделать перерыв': 'take a break' };

const store = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2')));
const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');

// Answer whatever card is on screen. kind: 'right' | 'wrong' | 'typo'
async function answerCard(page, kind = 'right') {
  const text = await mainText(page);
  if (await page.locator('#review-answer').count()) {
    let ru = (text.match(/Подсказка: (.+?) Ваш ответ/) || [])[1];
    if (!ru) ru = Object.keys(ANSWER_BY_RU).find((k) => text.includes('Как это по-английски? ' + k));
    let ans = ANSWER_BY_RU[ru];
    if (kind === 'wrong') ans = 'zzzz';
    if (kind === 'typo') ans = ans.slice(0, -1) + (ans.endsWith('x') ? 'y' : 'x');
    await page.fill('#review-answer', ans);
    await page.click('main button:text-is("Проверить")');
    return 'typed';
  }
  await page.click('main button:text-is("Показать ответ")');
  await page.click(`main button:text-is("${kind === 'right' ? 'Знал' : 'Не знал'}")`);
  return 'self';
}
const nextCard = (page) => page.click('main button:has-text("Дальше")');
const backToSetup = async (page) => { await page.click('aside >> text=Главная'); await page.click('aside >> text=Повторение'); await page.waitForTimeout(150); };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // 1. Answer checking rules
  const cases = [
    ['Apple', 'apple', 'ok'], ['  the apple ', 'apple', 'ok'], ['Hello!', 'hello', 'ok'], ['dont', "don't", 'ok'], ['its', "it's", 'ok'],
    ['to take a break', 'take a break', 'ok'], ['pass', 'ticket / pass', 'ok'], ['ticket', 'ticket, pass', 'ok'], ['look after', 'look after (smb)', 'ok'],
    ['aple', 'apple', 'typo'], ['take a brake', 'take a break', 'typo'], ['colleage', 'colleague', 'typo'],
    ['apl', 'apple', 'wrong'], ['banana', 'apple', 'wrong'], ['cat', 'car', 'wrong'], ['look', 'look for', 'wrong'], ['', 'apple', 'wrong'],
  ];
  const got = await page.evaluate((cs) => cs.map(([g, e]) => window.__eeghTest.checkAnswer(g, e)), cases);
  const mism = cases.filter((c, i) => got[i] !== c[2]).map((c, i) => `${c[0]}→${c[1]}: ${got[cases.indexOf(c)]}`);
  check(`Answer checking: ${cases.length - mism.length}/${cases.length} cases as expected`, mism.length === 0, mism.join('; '));

  // 2. Empty base: sample words button
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('aside nav');
  await page.click('aside >> text=Повторение');
  await page.click('main >> text=Добавить 12 слов для пробы');
  check('Empty state: 12 sample cards added', (await store(page)).items.length === 12);

  // 3. Seeded base, topic "Еда", typed answers, 10 cards
  await page.evaluate((s) => localStorage.setItem('eegh-data-v2', JSON.stringify(s)), SEED);
  await page.reload(); await page.waitForSelector('aside nav');
  await page.click('aside >> text=Повторение');
  await page.click('main button[aria-pressed]:has-text("Еда")');
  await page.click('main button[aria-pressed]:has-text("Вспомнить по-английски")');
  await page.click('main button[aria-pressed]:text-is("10 карточек")');
  check('Setup shows pool size for the chosen topic', (await mainText(page)).includes('Карточек в подборке: 3'));
  await page.click('main button:has-text("Начать")');
  check('Small pool: session of 3 cards, no forced repeats', (await mainText(page)).includes('Карточка 1 из 3'));

  await answerCard(page, 'right');
  check('Right answer: green "Верно!" and the card back', (await mainText(page)).includes('Верно!'));
  await nextCard(page);
  await answerCard(page, 'wrong');
  const wrongText = await mainText(page);
  check('Wrong answer: shows correct answer and promises a repeat', wrongText.includes('Правильный ответ:') && wrongText.includes('ещё раз появится в конце'));
  await nextCard(page);
  check('Wrong card added to the end (now 4 cards)', (await mainText(page)).includes('из 4'));
  await answerCard(page, 'typo');
  check('Typo: accepted as "почти верно"', (await mainText(page)).includes('Почти верно'));
  await nextCard(page);
  let guard = 0;
  while (!(await mainText(page)).includes('Итог занятия') && guard++ < 20) { await answerCard(page, 'right'); await nextCard(page); }
  const summary = await mainText(page);
  check('Summary after the session', summary.includes('Итог занятия') && summary.includes('Ответов: 4'), (summary.match(/Ответов: \d+/) || [''])[0]);
  check('Summary lists the card to repeat', summary.includes('Стоит повторить') && summary.includes('Повторить только ошибки (1)'));
  let s = await store(page);
  check('Every answer saved to history (4 records, 1 wrong, 1 typo)', s.reviews.length === 4 && s.reviews.filter((r) => r.result === 'wrong').length === 1 && s.reviews.filter((r) => r.result === 'typo').length === 1);
  check('History records have card id, date, mode', s.reviews.every((r) => r.itemId && /^\d{4}-/.test(r.at) && r.mode));
  check('Chosen settings remembered', s.settings.review && s.settings.review.mode === 'ru2en' && s.settings.review.topics.includes('t_food'));

  // 4. "Повторить только ошибки"
  await page.click('main button:has-text("Повторить только ошибки")');
  check('Retry mistakes: session of just the 1 wrong card', (await mainText(page)).includes('Карточка 1 из 1'));
  await page.click('main button:text-is("Закончить")');

  // 5. Interrupt: mixed mode, all topics, stop after 2 answers
  await backToSetup(page);
  await page.click('main button[aria-pressed]:has-text("Все темы")');
  await page.click('main button[aria-pressed]:has-text("Смешанный")');
  await page.click('main button:has-text("Начать")');
  const before = (await store(page)).reviews.length;
  await answerCard(page, 'right'); await nextCard(page);
  await answerCard(page, 'right');
  await page.click('main button:text-is("Закончить")');
  check('Interrupt: summary shows the 2 answers given', (await mainText(page)).includes('Ответов: 2'));
  await page.reload(); await page.waitForSelector('aside nav');
  check('Interrupt: both answers kept after reload', (await store(page)).reviews.length === before + 2);

  // 6. Rules use self-assessment
  await page.click('aside >> text=Повторение');
  await page.click('main button[aria-pressed]:has-text("Работа")');
  await page.click('main button[aria-pressed]:has-text("Все темы")');
  await page.click('main button[aria-pressed]:has-text("Работа")');
  await page.click('main button[aria-pressed]:has-text("Вспомнить перевод")');
  await page.click('main button:has-text("Начать")');
  let sawSelf = false;
  for (let i = 0; i < 6; i++) {
    const t = await mainText(page);
    if (t.includes('he / she / it + глагол с -s')) { sawSelf = true; await page.click('main button:text-is("Показать ответ")'); sawSelf = (await mainText(page)).includes('She works.'); break; }
    await answerCard(page, 'right'); await nextCard(page);
  }
  check('Rule card: shows rule, reveals example, asks "Знал / Не знал"', sawSelf);
  await page.click('main button:text-is("Закончить")');

  // 7. Cloze mode count and a cloze card
  await backToSetup(page);
  await page.click('main button[aria-pressed]:has-text("Все темы")');
  check('Cloze mode shows how many cards fit (4 have the word in the example)', (await mainText(page)).includes('подходящих карточек: 4'));
  await page.click('main button[aria-pressed]:has-text("Вставить в пример")');
  await page.click('main button:has-text("Начать")');
  let sawCloze = false;
  for (let i = 0; i < 6 && !sawCloze; i++) {
    const t = await mainText(page);
    if (t.includes('Вставьте пропущенное слово')) { sawCloze = true; await answerCard(page, 'right'); sawCloze = (await mainText(page)).includes('Верно!'); break; }
    await answerCard(page, 'right'); await nextCard(page);
  }
  check('Cloze card: example with a gap, answer accepted', sawCloze);
  await page.click('main button:text-is("Закончить")');

  // 8. Time mode
  await backToSetup(page);
  await page.click('main button[aria-pressed]:text-is("5 минут")');
  await page.click('main button:has-text("Начать")');
  const timer = (await mainText(page)).match(/Осталось (\d:\d\d)/);
  check('Time mode shows a countdown from 5:00', !!timer && ['5:00', '4:59', '4:58'].includes(timer[1]), timer ? timer[1] : 'none');
  await page.waitForTimeout(2200);
  const timer2 = (await mainText(page)).match(/Осталось (\d:\d\d)/);
  check('Countdown ticks', !!timer2 && timer2[1] !== timer[1], timer2 ? timer2[1] : 'none');

  // 8b. When time is up, the next answer leads to the summary
  const tp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await tp.clock.install();
  await routeLibraries(tp);
  await tp.goto(`http://localhost:${PORT}/`);
  await tp.waitForSelector('aside nav', { timeout: 30000 });
  await tp.evaluate((s) => localStorage.setItem('eegh-data-v2', JSON.stringify({ ...s, settings: { review: { topics: ['all'], mode: 'ru2en', length: 't5', withRules: false } } })), SEED);
  await tp.reload(); await tp.waitForSelector('aside nav');
  await tp.click('aside >> text=Повторение');
  await tp.click('main button:has-text("Начать")');
  await answerCard(tp, 'right'); await nextCard(tp);
  await tp.clock.fastForward('05:01');
  await tp.waitForTimeout(100);
  check('Time up: page says so', (await mainText(tp)).includes('Время вышло'));
  await answerCard(tp, 'right'); await nextCard(tp);
  check('Time up: after the current card the summary opens', (await mainText(tp)).includes('Итог занятия') && (await mainText(tp)).includes('Ответов: 2'));
  await tp.close();

  // 9. Phone width during a session
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check('No horizontal scroll at 375px during a session', w <= 375, `${w}px`);

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
