// Collapsible navigation test: groups open/close, one open at a time, current group stays open, phone menu.
// Run from the repository root:  node tests/nav.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { goNav } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9700 + Math.floor(Math.random() * 90);
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

// Group indices are read from the page by title, so the test does not depend on their order
async function groups(page, scope = 'aside') {
  return page.$$eval(`${scope} [data-group-toggle]`, (els) => els.map((e) => ({
    title: e.querySelector('span').textContent.trim().toLowerCase(), id: e.dataset.groupToggle, open: e.getAttribute('aria-expanded') === 'true',
  })));
}
const openTitles = async (page, scope) => (await groups(page, scope)).filter((g) => g.open).map((g) => g.title);
const toggle = async (page, title, scope = 'aside') => { const g = (await groups(page, scope)).find((x) => x.title === title.toLowerCase()); await page.click(`${scope} [data-group-toggle="${g.id}"]`); await page.waitForTimeout(400); };
const itemVisible = (page, key, scope = 'aside') => page.locator(`${scope} [data-nav-item="${key}"]`).isVisible();

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

  // 1. Structure and start state
  const g0 = await groups(page);
  check('Three groups: Грамматика, Тренажёры, Мои материалы', JSON.stringify(g0.map((g) => g.title)) === JSON.stringify(['грамматика', 'тренажёры', 'мои материалы']), g0.map((g) => g.title).join(', '));
  const items = await page.$$eval('aside [data-nav-item]', (els) => els.map((e) => e.dataset.navItem));
  check('All 11 pages are in the menu', ['home', 'tenses', 'tobe', 'possessive', 'articles', 'psimple', 'adverbs', 'checker', 'pronounce', 'review', 'base', 'data'].every((k) => items.includes(k)), items.join(','));
  check('"Главная" is always visible outside the groups', await itemVisible(page, 'home'));
  check('On the home page only "Грамматика" is open', JSON.stringify(await openTitles(page)) === '["грамматика"]');
  check('Items of closed groups are hidden', !(await itemVisible(page, 'checker')) && !(await itemVisible(page, 'base')) && (await itemVisible(page, 'tenses')));

  // 2. Toggle behaviour
  await toggle(page, 'Тренажёры');
  check('Opening "Тренажёры" closes "Грамматика" (one group at a time)', JSON.stringify(await openTitles(page)) === '["тренажёры"]' && (await itemVisible(page, 'checker')) && !(await itemVisible(page, 'tenses')));
  const arrow = async (title) => { const g = (await groups(page)).find((x) => x.title === title); return page.$eval(`aside [data-group-toggle="${g.id}"] [data-arrow]`, (s) => s.style.transform); };
  const a1 = await arrow('тренажёры');
  check('Arrow turns when the group is open', a1 === 'rotate(180deg)', a1);
  await toggle(page, 'Тренажёры');
  check('Second click closes the group', (await openTitles(page)).length === 0 && !(await itemVisible(page, 'checker')));
  const a2 = await arrow('тренажёры');
  check('Arrow turns back when closed', a2 === 'rotate(0deg)', a2);
  const anim = await page.$eval('aside [role=region]', (e) => e.style.transition);
  check('Open / close is animated', anim.includes('grid-template-rows'), anim);

  // 3. Accessibility of closed groups
  const closed = (await groups(page)).find((x) => x.title === 'мои материалы');
  const a11y = await page.$eval(`#side-group-${closed.id}`, (e) => ({ hidden: e.getAttribute('aria-hidden'), inert: e.hasAttribute('inert'), tab: e.querySelector('button').tabIndex }));
  check('Closed group: aria-hidden, inert, items not reachable by Tab', a11y.hidden === 'true' && a11y.inert && a11y.tab === -1, JSON.stringify(a11y));
  const tg = (await groups(page)).find((x) => x.title === 'мои материалы');
  await page.focus(`aside [data-group-toggle="${tg.id}"]`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('Keyboard: Enter on the group title opens it', JSON.stringify(await openTitles(page)) === '["мои материалы"]');

  // 4. Navigation keeps the current group open
  await page.click('aside [data-nav-item="base"]');
  await page.waitForTimeout(200);
  check('After choosing "Моя база" its group stays open', JSON.stringify(await openTitles(page)) === '["мои материалы"]' && (await page.innerText('main')).includes('Моя база'));
  await goNav(page, 'Главная');
  await page.locator('main button', { hasText: 'Проверка текста' }).first().click();
  await page.waitForTimeout(400);
  check('Going to a page from the home cards opens its group ("Тренажёры")', JSON.stringify(await openTitles(page)) === '["тренажёры"]');
  await toggle(page, 'Тренажёры');
  const dot = (await groups(page)).find((x) => x.title === 'тренажёры');
  check('Closed group with the current page shows a marker', await page.locator(`aside [data-group-toggle="${dot.id}"] [aria-label="здесь открытый раздел"]`).count() === 1);

  // 5. Every page opens through the menu
  const labels = ['Времена глаголов', 'Глагол TO BE', 'Притяжательный падеж', 'Артикли A / AN', 'Present Simple', 'Adverbs of Frequency', 'Проверка текста', 'Произношение', 'Повторение', 'Моя база', 'Мои данные', 'Главная'];
  const failedPages = [];
  for (const l of labels) {
    await goNav(page, l);
    const cur = await page.$eval('aside [aria-current="page"]', (e) => e.innerText).catch(() => '');
    if (!cur.includes(l)) failedPages.push(l);
  }
  check('Every page opens from the menu and is marked as current', failedPages.length === 0, failedPages.join(', '));

  // 5b. Wide screen: the tea-cup button hides and shows the sidebar, choice is remembered
  const deskBtn = page.locator('header button[data-mode]');
  check('Wide screen: tea-cup button is shown (not phone-only anymore)', !(await deskBtn.getAttribute('class')).includes('lg:hidden') && (await deskBtn.getAttribute('data-mode')) === 'desktop');
  check('Wide screen: button says "Скрыть меню разделов", sidebar open', (await deskBtn.getAttribute('aria-label')) === 'Скрыть меню разделов' && (await deskBtn.getAttribute('aria-expanded')) === 'true' && (await page.getAttribute('aside', 'data-side-hidden')) === '0');
  await deskBtn.click(); await page.waitForTimeout(200);
  const asideCls = await page.getAttribute('aside', 'class');
  const gridCls = await page.$eval('aside', (a) => a.parentElement.className);
  check('Wide screen: click hides the sidebar and gives its place to the content', asideCls === 'hidden' && gridCls.includes('lg:grid-cols-[minmax(0,1fr)]') && (await deskBtn.getAttribute('aria-expanded')) === 'false', `${asideCls} | ${gridCls}`);
  check('Wide screen: the phone drawer does not open', (await page.getAttribute('[data-drawer]', 'aria-hidden')) === 'true');
  check('Wide screen: label switches to "Показать меню разделов"', (await deskBtn.getAttribute('aria-label')) === 'Показать меню разделов');
  await page.reload(); await page.waitForSelector('aside nav');
  check('Wide screen: hidden sidebar is remembered after reload', (await page.getAttribute('aside', 'data-side-hidden')) === '1');
  await page.locator('header button[data-mode]').click(); await page.waitForTimeout(200);
  check('Wide screen: second click shows the sidebar again', (await page.getAttribute('aside', 'class')).includes('lg:block') && (await page.getAttribute('aside', 'data-side-hidden')) === '0');
  // reload reset the menu state; restore "last page = Мои данные, now on Главная" for the phone checks
  await goNav(page, 'Мои данные'); await goNav(page, 'Главная');

  // 6. Phone menu
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(400);
  check('Phone: menu has the same three groups', (await groups(page, '[data-drawer]')).length === 3);
  check('Phone: group of the last page ("Мои данные") is open', JSON.stringify(await openTitles(page, '[data-drawer]')) === '["мои материалы"]');
  await toggle(page, 'Тренажёры', '[data-drawer]');
  await toggle(page, 'Мои материалы', '[data-drawer]');
  check('Phone: group opens, only one open', JSON.stringify(await openTitles(page, '[data-drawer]')) === '["мои материалы"]' && (await itemVisible(page, 'review', '[data-drawer]')));
  await page.click('[data-drawer] [data-nav-item="review"]');
  await page.waitForTimeout(400);
  check('Phone: choosing a page closes the menu and opens the page', (await page.getAttribute('[data-drawer]', 'aria-hidden')) === 'true' && (await page.innerText('main')).includes('Повторение'));
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(400);
  check('Phone: reopened menu shows the current group open', JSON.stringify(await openTitles(page, '[data-drawer]')) === '["мои материалы"]');
  await toggle(page, 'Грамматика', '[data-drawer]');
  await goNav(page, 'Adverbs of Frequency', '[data-drawer]');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Phone: no horizontal scroll', w <= 375, `${w}px`);

  check('No page or console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
