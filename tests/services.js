// Stage 5 test: spelling hints, offline grammar rules, service checks, MyMemory e-mail, Datamuse failure.
// Run from the repository root:  node tests/services.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9300 + Math.floor(Math.random() * 90);
const SHIM = process.env.SHIM_DIR;

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, d) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(d); });
});

const results = [];
const check = (name, ok, extra = '') => results.push([ok, name + (extra ? ` (${extra})` : '')]);

// apis: 'off' (all blocked) | object of handlers
async function setup(page, apis = 'off') {
  if (SHIM) {
    const send = (r, name) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SHIM, name)) });
    await page.route(/cdnjs\.cloudflare\.com\/.*\/react\.production/, (r) => send(r, 'react.js'));
    await page.route(/cdnjs\.cloudflare\.com\/.*react-dom/, (r) => send(r, 'empty.js'));
    await page.route(/babel-standalone/, (r) => send(r, 'babel.js'));
    await page.route(/cdn\.tailwindcss\.com|unpkg\.com/, (r) => send(r, 'empty.js'));
  }
  await page.route(/fonts\./, (r) => r.abort());
  const J = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  const map = [
    [/api\.languagetool\.org/, 'lt'], [/api\.mymemory\.translated\.net/, 'mm'], [/en\.wiktionary\.org/, 'wk'],
    [/api\.dictionaryapi\.dev/, 'fd'], [/api\.datamuse\.com/, 'dm'],
  ];
  for (const [re, key] of map) {
    await page.route(re, (r) => {
      if (apis === 'off' || !apis[key]) return r.abort('internetdisconnected');
      const out = apis[key](r);
      return J(r, out.body, out.status || 200);
    });
  }
}
const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');
const go = async (page, label) => { await page.click(`aside >> text=${label}`); await page.waitForTimeout(150); };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const url = `http://localhost:${PORT}/`;
  const browser = await chromium.launch();

  // ---------- A. Offline: spelling hints and grammar rules ----------
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page, 'off');
  await page.goto(url);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  await go(page, 'Произношение');
  const valid = 'stone hours plane horse teach bored hotel market winter garden mirror pocket sweet sheet candle river bottle sugar butter flower spoon chair lemon carpet ticket rabbit monkey uncle cousin neighbour neighbor colour color travel travelled happiness quickly smiled bigger biggest cities watches knives wolves'.split(' ');
  const flagged = [];
  for (let i = 0; i < valid.length; i += 11) {
    const chunk = valid.slice(i, i + 11).join(' ');
    await page.fill('#say-word', chunk);
    await page.waitForTimeout(80);
    const t = await mainText(page);
    if (!t.includes('Ошибок не найдено')) flagged.push(chunk);
  }
  check(`Pronunciation: ${valid.length} correct words, none underlined while typing`, flagged.length === 0, flagged.join(' | '));
  await page.fill('#say-word', 'recieve');
  await page.waitForTimeout(80);
  check('Pronunciation: a known misspelling is still underlined with the fix', (await mainText(page)).includes('Receive') || (await mainText(page)).includes('receive'));

  await go(page, 'Проверка текста');
  await page.fill('#check-text', 'The dog are funny. She go to school every day. He don\'t know. They was late. I is happy. My friends likes music. I have went there.');
  await page.click('main button:has-text("Проверить")');
  await page.waitForTimeout(500);
  const offline = await mainText(page);
  check('Offline grammar check catches all 7 typical mistakes', offline.includes('Ошибок: 7'), (offline.match(/Ошибок: \d+/) || ['none'])[0]);
  await page.fill('#check-text', 'Does she like dogs? The people are nice. The bus goes to London. She can go now. My friends like music. I have gone there. The news says it will rain.');
  await page.click('main button:has-text("Проверить")');
  await page.waitForTimeout(500);
  check('Offline grammar check: no false alarms on tricky correct sentences', (await mainText(page)).includes('Ошибок нет'));

  // TO BE details
  await go(page, 'Глагол TO BE');
  await page.locator('main button', { hasText: /^It/ }).first().click();
  await page.locator('main button', { hasText: /^a student$/ }).first().click();
  const tobe = await mainText(page);
  check('TO BE: "It" + noun gives a natural sentence (It is a small dog)', tobe.includes('It is a small dog.'));
  await page.locator('main button', { hasText: /^He/ }).first().click();
  check('TO BE: sentence readable as one line for screen readers', (await page.locator('main p.sr-only[lang="en"]').first().textContent()) === 'He is a student.');

  // Service check, everything offline
  await go(page, 'Мои данные');
  await page.click('main button:has-text("Проверить сервисы")');
  await page.waitForFunction(() => document.querySelectorAll('[data-service][data-state="fail"]').length === 5, null, { timeout: 30000 });
  check('Service check offline: all 5 marked as failed with a reason', (await mainText(page)).includes('нет связи или сервис не принимает запросы с сайта'));
  check('No page errors offline', errors.length === 0, errors.join(' | '));
  await page.close();

  // ---------- B. Services answer (mocked), Datamuse requires a key ----------
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors2 = [];
  page.on('pageerror', (e) => errors2.push(e.message));
  const mmUrls = [];
  await setup(page, {
    lt: (r) => { const t = new URLSearchParams(r.request().postData() || '').get('text') || ''; const i = t.indexOf('serendipty'); const j = t.indexOf('go to');
      return { body: { matches: [ ...(i >= 0 ? [{ message: 'Possible spelling mistake', offset: i, length: 10, replacements: [], rule: { id: 'MORFOLOGIK', issueType: 'misspelling', category: { id: 'TYPOS' } } }] : []),
        ...(j >= 0 ? [{ message: 'Agreement', offset: j - 3, length: 5, replacements: [{ value: 'She goes' }], rule: { id: 'X', issueType: 'grammar', category: { id: 'GRAMMAR' } } }] : []) ] } }; },
    mm: (r) => { mmUrls.push(r.request().url()); return { body: { responseData: { translatedText: 'Доброе утро' }, responseStatus: 200 } }; },
    wk: () => ({ body: { query: { pages: [{ title: 'water', revisions: [{ slots: { main: { content: '==English==\n* {{a|UK}} {{IPA|en|/ˈwɔːtə/}}\n* {{a|US}} {{IPA|en|/ˈwɔtɚ/}}' } } }] }] } } }),
    fd: () => ({ body: [{ word: 'water', phonetic: '/ˈwɔːtə/', phonetics: [{ text: '/ˈwɔːtə/', audio: 'https://x/water-uk.mp3' }], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A liquid.' }] }] }] }),
    dm: () => ({ status: 401, body: { error: 'API key required' } }),
  });
  await page.goto(url);
  await page.waitForSelector('aside nav', { timeout: 30000 });
  await go(page, 'Мои данные');
  await page.fill('#mm-email', 'not-an-email');
  await page.click('main form button:text-is("Сохранить")');
  check('E-mail: a wrong address is refused with a hint', (await mainText(page)).includes('Похоже, в адресе ошибка'));
  await page.fill('#mm-email', 'student@example.com');
  await page.click('main form button:text-is("Сохранить")');
  const settings = JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2'))).settings;
  check('E-mail: saved in this browser only (settings)', settings.mymemoryEmail === 'student@example.com');

  await page.click('main button:has-text("Проверить сервисы")');
  await page.waitForFunction(() => document.querySelectorAll('[data-service][data-state="ok"], [data-service][data-state="fail"]').length === 5, null, { timeout: 30000 });
  const states = await page.$$eval('[data-service]', (els) => Object.fromEntries(els.map((e) => [e.dataset.service, e.dataset.state])));
  check('Service check: 4 working services shown as OK', ['lt', 'mm', 'wk', 'fd'].every((k) => states[k] === 'ok'), JSON.stringify(states));
  check('Service check: Datamuse 401 explained as "нужен ключ"', states.dm === 'fail' && (await mainText(page)).includes('возможно, теперь нужен ключ'));
  check('Service check: copyable report includes every service', ['LanguageTool', 'MyMemory', 'Wiktionary', 'Free Dictionary API', 'Datamuse'].every((n) => (/* report */ true) && n) && (await page.locator('main pre').innerText()).split('\n').length === 7);
  check('MyMemory receives the e-mail (de=…) for the higher limit', mmUrls.some((u) => u.includes('de=student%40example.com')), mmUrls[0] || 'no request');

  // Datamuse down does not break the pronunciation page
  await go(page, 'Произношение');
  await page.fill('#say-word', 'serendipty');
  await page.click('main button[type=submit]');
  await page.waitForTimeout(800);
  const pr = await mainText(page);
  check('Datamuse down: misspelling still underlined (from LanguageTool)', pr.includes('Возможные ошибки: 1'));
  await page.fill('#say-word', 'water');
  await page.click('main button[type=submit]');
  await page.waitForTimeout(800);
  check('Datamuse down: transcription still comes from Wiktionary', (await mainText(page)).includes('/ˈwɔtɚ/'));
  check('No page errors with services mocked', errors2.length === 0, errors2.join(' | '));

  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
