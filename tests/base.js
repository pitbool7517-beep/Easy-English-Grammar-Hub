// "Моя база" test for Easy English Grammar Hub (stage 2: own cards and topics).
// Run from the repository root:  node tests/base.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9000 + Math.floor(Math.random() * 90);
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

const data = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2')));
const shown = async (page) => Number(((await page.innerText('main')).match(/Показано: (\d+) из (\d+)/) || [])[2]);
const openBase = async (page) => { await page.click('aside >> text=Моя база'); await page.waitForTimeout(150); };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('aside nav');
  await openBase(page);
  check('Empty base shows a helpful empty state', (await page.innerText('main')).includes('В базе пока пусто'));

  // Topics
  await page.fill('#new-topic', 'Еда');
  await page.click('main >> text=Создать тему');
  await page.fill('#new-topic', 'Путешествия');
  await page.click('main >> text=Создать тему');
  await page.fill('#new-topic', 'еда');
  await page.click('main >> text=Создать тему');
  check('Duplicate topic name is refused', (await page.innerText('main')).includes('уже есть'));
  let d = await data(page);
  check('Two topics created', d.topics.map((t) => t.name).join(',') === 'Еда,Путешествия');

  // One card of each type (current filter = Путешествия, so cards go there by default)
  const fillCard = async (type, en, ru, note) => {
    await page.click(`main [role=radio]:has-text("${type}")`);
    await page.fill('#f-en-new', en); await page.fill('#f-ru-new', ru); if (note) await page.fill('#f-note-new', note);
    await page.click('main form button[type=submit]:has-text("Добавить")');
  };
  await fillCard('Слово', 'ticket', 'билет', 'a one-way ticket');
  await fillCard('Выражение', 'check in', 'зарегистрироваться', '');
  await fillCard('Правило', 'an hour', 'a/an выбираем по звуку', 'h в hour немая');
  await page.click('main [role=radio]:has-text("Слово")');
  await page.fill('#f-en-new', 'only english');
  await page.click('main form button[type=submit]:has-text("Добавить")');
  check('Card without translation is refused with a message', (await page.innerText('main')).includes('Заполните английский вариант и перевод'));
  d = await data(page);
  const travel = d.topics.find((t) => t.name === 'Путешествия').id;
  check('Three cards saved, one per type, in the selected topic', d.items.length === 3 && d.items.every((i) => i.topicId === travel) && ['word', 'phrase', 'rule'].every((t) => d.items.some((i) => i.type === t)));

  // Transcription button uses the built-in dictionary offline
  await page.click('main [role=radio]:has-text("Слово")');
  await page.fill('#f-en-new', 'comfortable');
  await page.click('main button:text-is("Подставить")');
  await page.waitForTimeout(400);
  check('Transcription button fills IPA (built-in dictionary, offline)', (await page.inputValue('#f-ipa-new')) === '/ˈkʌmftərbəl/', await page.inputValue('#f-ipa-new'));
  await page.fill('#f-en-new', '');

  // Bulk paste: 50 good lines + 2 broken + 1 duplicate of "ticket" + 1 duplicate inside the list
  await page.click('main >> text=Вставить списком');
  const lines = [];
  for (let i = 1; i <= 50; i++) lines.push(`word${i} ${['—', '-', '=', ';', '\t'][i % 5]} слово${i}`);
  lines.splice(10, 0, 'broken line without translation');
  lines.splice(20, 0, 'another-broken');
  lines.push('ticket — билет (повтор)');
  lines.push('word1 — ещё раз');
  await page.fill('#bulk-text', lines.join('\n'));
  await page.selectOption('#bulk-topic', { label: 'Еда' });
  const bulkInfo = await page.innerText('main');
  check('Bulk preview: 50 ready, 2 duplicates skipped, 2 lines not parsed',
    bulkInfo.includes('Готово к добавлению: 50') && bulkInfo.includes('пропустим: 2') && bulkInfo.includes('не разобрано строк: 2'));
  await page.click('main button:has-text("Добавить 50")');
  d = await data(page);
  const food = d.topics.find((t) => t.name === 'Еда').id;
  check('Bulk add: 50 cards added at once into "Еда"', d.items.filter((i) => i.topicId === food).length === 50, `${d.items.length} total`);
  check('Bulk add: separators —, -, =, ;, tab all parsed', ['word1', 'word2', 'word3', 'word4', 'word5'].every((w) => d.items.some((i) => i.en === w && i.ru === 'слово' + w.slice(4))));

  // Filters and search
  await page.click('main [role=tab]:has-text("Все")');
  check('"Все" shows 53 cards', (await shown(page)) === 53, `${await shown(page)}`);
  await page.click('main [role=tab]:has-text("Еда")');
  check('Topic filter shows 50', (await shown(page)) === 50);
  await page.click('main [role=tab]:has-text("Все")');
  await page.fill('#base-search', 'билет');
  check('Search by translation finds "ticket"', (await shown(page)) === 1);
  await page.fill('#base-search', '');
  await page.click('main button[aria-pressed]:text-is("Правила")');
  check('Type filter "Правила" shows 1', (await shown(page)) === 1);
  await page.click('main button[aria-pressed]:text-is("Все")');

  // Edit
  const ticket = d.items.find((i) => i.en === 'ticket').id;
  await page.locator(`li[data-item="${ticket}"] button[aria-label="Изменить карточку"]`).click();
  await page.fill(`#f-ru-${ticket}`, 'билет, проездной');
  await page.locator(`#f-ru-${ticket}`).press('Enter');
  d = await data(page);
  check('Edit saves the new translation', d.items.find((i) => i.id === ticket).ru === 'билет, проездной');

  // Delete with confirmation
  const victim = d.items.find((i) => i.en === 'word7').id;
  await page.locator(`li[data-item="${victim}"] button[aria-label="Удалить карточку"]`).click();
  check('Delete asks for confirmation first', (await data(page)).items.some((i) => i.id === victim));
  await page.locator(`li[data-item="${victim}"] button:text-is("Удалить")`).click();
  check('Delete after confirmation removes the card', !(await data(page)).items.some((i) => i.id === victim));

  // Rename and delete a topic (cards move to "Без темы")
  await page.click('main [role=tab]:has-text("Путешествия")');
  await page.click('main >> text=Переименовать');
  await page.fill('#rename-topic', 'Поездки');
  await page.click('main form button:text-is("Сохранить")');
  d = await data(page);
  check('Rename topic', d.topics.some((t) => t.name === 'Поездки') && !d.topics.some((t) => t.name === 'Путешествия'));
  await page.click('main >> text=Удалить тему');
  await page.click('main .bg-redSoft button:text-is("Удалить тему")');
  d = await data(page);
  check('Delete topic keeps its cards, moved to "Без темы"', !d.topics.some((t) => t.name === 'Поездки') && d.items.length === 52 && d.items.filter((i) => !i.topicId).length === 3);

  // Persistence and export
  await page.reload();
  await page.waitForSelector('aside nav');
  await openBase(page);
  check('Everything survives reload', (await shown(page)) === 52);
  await page.click('aside >> text=Мои данные');
  check('"Мои данные" counts own cards', (await page.innerText('main')).includes('52'));

  // Phone width
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click('button[aria-label="Открыть меню разделов"]');
  await page.waitForTimeout(350);
  await page.click('text=Моя база >> visible=true');
  await page.waitForTimeout(350);
  await page.click('main >> text=+ Добавить карточку');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check('No horizontal scroll at 375px with the form open', w <= 375, `${w}px`);

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
