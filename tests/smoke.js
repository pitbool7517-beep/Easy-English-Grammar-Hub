// Smoke test for Easy English Grammar Hub.
// Run from the repository root:  npm i -D playwright && node tests/smoke.js
// Optional: SHIM_DIR=/path node tests/smoke.js  — serves CDN libraries from local files
// (react.js, babel.js, empty.js) for machines without internet access.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const SHIM = process.env.SHIM_DIR;

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name + (extra ? ` (${extra})` : '')]); };

async function routeLibraries(page, { breakCdn = false } = {}) {
  // Block all third-party APIs so the test never depends on them.
  await page.route(/^https:\/\/(api\.|en\.wiktionary|fonts\.)/, (r) => r.abort());
  if (breakCdn) { await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/react/, (r) => r.abort()); }
  if (!SHIM) return;
  const send = (r, name) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SHIM, name)) });
  if (!breakCdn) {
    await page.route(/cdnjs\.cloudflare\.com\/.*\/react\.production/, (r) => send(r, 'react.js'));
    await page.route(/cdnjs\.cloudflare\.com\/.*react-dom/, (r) => send(r, 'empty.js'));
  }
  await page.route(/babel-standalone/, (r) => send(r, 'babel.js'));
  await page.route(/cdn\.tailwindcss\.com|unpkg\.com/, (r) => send(r, 'empty.js'));
}

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const url = `http://localhost:${PORT}/`;
  const browser = await chromium.launch();

  // 1. Normal load and navigation
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(url);
  await page.waitForSelector('aside nav', { timeout: 30000 });
  const header = await page.innerText('header');
  const total = Number((header.match(/\/\s*(\d+)/) || [])[1]);
  check('App loads and shows progress counter', total > 0, `total ${total}`);

  for (const label of ['Времена глаголов', 'Глагол TO BE', 'Притяжательный падеж', 'Артикли A / AN', 'Present Simple (+)', 'Проверка текста', 'Произношение', 'Главная']) {
    await page.click(`aside >> text=${label}`);
    await page.waitForTimeout(150);
  }
  check('All sections open without errors', errors.length === 0, errors.join(' | '));

  // 2a. Tenses mini-test: 9 questions
  await page.click('aside >> text=Времена глаголов');
  const tenseScope = 'main section:has-text("Мини-тест: выберите правильное время")';
  for (const a of ['went', 'drinks', 'will call', 'play', 'visited', 'will rain', 'did', 'cooks', 'will go']) {
    await page.locator(`${tenseScope} button:text-is("${a}"):not([disabled])`).first().click();
  }
  // 2b. Apostrophe: 9 tasks, click the correct gap in each task
  await page.click('aside >> text=Притяжательный падеж');
  const aposTasks = page.locator('main div.border-t').filter({ has: page.locator('button[aria-label^="Поставить апостроф"]') });
  const gaps = [3, 4, 5, 8, 7, 4, 3, 8, 3];
  check('Apostrophe: 9 tasks shown', (await aposTasks.count()) === 9, `${await aposTasks.count()}`);
  for (let i = 0; i < gaps.length; i++) await aposTasks.nth(i).locator(`button[aria-label="Поставить апостроф после буквы ${gaps[i]}"]`).click();
  const early = JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')) || '{}');
  check('Tenses: all 9 answers counted', Object.keys(early).filter((k) => /^t\d+$/.test(k)).length === 9);
  check('Apostrophe: all 9 answers counted', Object.keys(early).filter((k) => /^a\d+$/.test(k)).length === 9);

  // 2. Articles: answer every question correctly
  await page.click('aside >> text=Артикли A / AN');
  const answer = async (text, scope = 'main') => page.locator(`${scope} button:text-is("${text}"):not([disabled])`).first().click();
  const AAN = ['an', 'a', 'an', 'a', 'an', 'a', 'an', 'a', 'an', 'an', 'a', 'an'];
  for (const a of AAN) await answer(a);
  const ZERO = ['—', '—', 'an', '—', 'a'];
  for (const a of ZERO) await answer(a);
  const fixTasks = page.locator('main form, main div.border-t').filter({ has: page.locator('button[aria-label$="отметить как ошибку"]') });
  const fixWrong = [0, 0, 0, 0, 1];
  for (let i = 0; i < 5; i++) await fixTasks.nth(i).locator('button[aria-label$="отметить как ошибку"]').nth(fixWrong[i]).click();
  let stored = JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')) || '{}');
  const artIds = Object.keys(stored).filter((k) => /^a[rzf]\d+$/.test(k));
  check('Articles: all 22 answers counted', artIds.length === 22, `${artIds.length}`);

  // 3. Present Simple: choose, type, find the error
  await page.click('aside >> text=Present Simple (+)');
  const psChoose = 'main section:has-text("Проверка 1: выберите форму")';
  for (const a of ['lives', 'play', 'watches', 'opens', 'drink', 'goes', 'work', 'studies', 'has', 'cries', 'live', 'plays']) await answer(a, psChoose);
  const typed = { pt1: 'studies', pt2: 'Fixes ', pt3: 'rains', pt4: 'have', pt5: 'does', pt6: 'leaves' };
  await page.fill('#in-pt1', 'studys'); await page.press('#in-pt1', 'Enter');
  check('Present Simple: wrong typed answer is rejected', !(JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')))).pt1);
  for (const [id, v] of Object.entries(typed)) { await page.fill(`#in-${id}`, v); await page.press(`#in-${id}`, 'Enter'); }
  const psFix = page.locator('main div.border-t').filter({ has: page.locator('button[aria-label$="отметить как ошибку"]') });
  const psWrong = [0, 0, 0, 1, 0];
  for (let i = 0; i < 5; i++) await psFix.nth(i).locator('button[aria-label$="отметить как ошибку"]').nth(psWrong[i]).click();
  stored = JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')) || '{}');
  const psIds = Object.keys(stored).filter((k) => /^p[stf]\d+$/.test(k));
  check('Present Simple: all 23 answers counted (case/space tolerant)', psIds.length === 23, `${psIds.length}`);

  // 4. Shuffle keeps progress
  await page.click('main >> text=Перемешать и пройти заново');
  const after = Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')))).length;
  check('Shuffle does not erase progress', after === artIds.length + psIds.length + 18);

  // 5. Progress survives reload; unknown old ids do not break the counter
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('eegh-progress-v1')); p['old-removed-id'] = true; localStorage.setItem('eegh-progress-v1', JSON.stringify(p)); });
  await page.reload();
  await page.waitForSelector('aside nav');
  const h2 = await page.innerText('header');
  check('Progress survives reload and ignores unknown ids', h2.includes(`${after} / ${total}`), h2.replace(/\s+/g, ' ').trim());

  // 6. Reset asks for confirmation
  await page.click('aside >> text=Главная');
  await page.click('main >> text=Сбросить прогресс');
  const stillThere = Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-progress-v1')))).length;
  check('Reset needs confirmation (nothing erased on first click)', stillThere > 0);
  await page.click('main >> text=Отмена');
  await page.click('main >> text=Сбросить прогресс');
  await page.click('main >> text=Да, сбросить');
  check('Reset after confirmation clears progress', (await page.evaluate(() => localStorage.getItem('eegh-progress-v1'))) === '{}');

  // 7. Phone width: no horizontal scroll
  await page.setViewportSize({ width: 375, height: 800 });
  const wide = [];
  for (const label of ['Артикли A / AN', 'Present Simple (+)', 'Главная']) {
    await page.click('button[aria-label="Открыть меню разделов"]');
    await page.waitForTimeout(350);
    await page.click(`text=${label} >> visible=true`);
    await page.waitForTimeout(350);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 375) wide.push(`${label}: ${w}px`);
  }
  check('No horizontal scroll at 375px', wide.length === 0, wide.join(', '));
  check('No page errors during the run', errors.length === 0, errors.join(' | '));

  // 8. CDN failure shows a clear message
  const bad = await browser.newPage();
  await routeLibraries(bad, { breakCdn: true });
  await bad.goto(url);
  await bad.waitForTimeout(1500);
  const boot = await bad.innerText('#root');
  check('Library load failure shows a message with a reload button', boot.includes('Приложение не загрузилось') && boot.includes('Обновить страницу'));

  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
