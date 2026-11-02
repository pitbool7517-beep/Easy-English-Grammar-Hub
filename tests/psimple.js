// Merged "Present Simple" section test (positive + negative, exercises, final test).
// Run from the repository root:  node tests/psimple.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9500 + Math.floor(Math.random() * 90);
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

// ---------- 1. Data (static, from index.html) ----------
const part1 = html.slice(html.indexOf('const PS_SUBJECTS'), html.indexOf('function TypeQuestion'));
const part2 = html.slice(html.indexOf('const PN_ENDINGS'), html.indexOf('const PS_TOTAL'));
const ctx = {};
vm.runInNewContext(part1 + part2 + '\nthis.D = { PS_QUIZ, PS_TYPE, PS_FIX, PN_CHOOSE, PN_TRANSFORM, PN_FIX, PS_FIX_ALL, PN_TRANSLATE, PN_TEST, PS_ALL, PS_VERBS };', ctx);
const D = ctx.D;
const problems = [];
[...D.PS_QUIZ, ...D.PN_CHOOSE, ...D.PN_TEST].forEach((q) => { if (!q.options.includes(q.answer)) problems.push(q.id + ': answer not in options'); });
D.PN_TEST.forEach((q) => { if (!q.rule) problems.push(q.id + ': no rule'); });
D.PS_FIX_ALL.forEach((q) => { const n = (q.text.match(/\[[^\]]+\]/g) || []).length; if (q.wrong >= n || !Array.isArray(q.fix) || !q.fix.length) problems.push(q.id + ': bad fix data'); });
const ids = D.PS_ALL.map((q) => q.id);
if (new Set(ids).size !== ids.length) problems.push('duplicate ids');
D.PN_CHOOSE.forEach((q) => { if (!/don't|doesn't/.test(q.before + q.options.join(' '))) problems.push(q.id + ': not about the negative'); });
check(`Data: ${ids.length} tasks, answers consistent, negative block only about don't/doesn't`, problems.length === 0 && ids.length === 55, problems.join('; '));
const allOld = ['ps1', 'ps12', 'pt1', 'pt6', 'pf1', 'pf5'];
check('All 23 original task ids are kept (progress-safe)', allOld.every((id) => ids.includes(id)) && ids.filter((id) => /^p[stf]\d+$/.test(id)).length === 23);

const mainText = async (page) => (await page.innerText('main')).replace(/\s+/g, ' ');
const progressOf = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('eegh-data-v2'))).progress;
const counter = async (page) => ((await page.innerText('header')).match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).join('/');
const sentence = async (page) => (await page.locator('[data-sentence]').textContent()).trim();
const tab = (page, name) => page.click(`main [role=tab]:has-text("${name}")`);

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // ---------- 2. Existing progress from the old section is kept ----------
  const old = { schema: 2, progress: { ps1: { at: '2026-10-20T10:00:00.000Z' }, pt2: { at: null }, pf3: { at: null }, ar1: { at: null } }, topics: [], items: [], reviews: [], settings: {}, meta: {} };
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('eegh-data-v2', JSON.stringify(d)); }, old);
  await page.reload(); await page.waitForSelector('aside nav');
  check('Old progress kept: 4 / 104 overall', (await counter(page)) === '4/104', await counter(page));
  const nav = (await page.innerText('aside')).replace(/\s+/g, ' ');
  check('One menu item "Present Simple" with 3/55', (nav.match(/Present Simple/g) || []).length === 1 && /Present Simple\s*3\/55/.test(nav), nav.match(/Present Simple[^А-Я]*/)?.[0]);
  const home = await mainText(page);
  check('One home card for Present Simple', (home.match(/Present Simple/g) || []).length === 1 && home.includes('3 / 55 заданий'));

  // ---------- 3. Rules tab ----------
  await page.click('aside >> text=Present Simple');
  const rules = await mainText(page);
  check('Opens on "Правила"; section shows 3 of 55 solved', (await page.getAttribute('main [role=tab]:has-text("Правила")', 'aria-selected')) === 'true' && rules.includes('Решено в разделе: 3 из 55'));
  check('Rules: + and − formulas', rules.includes('He / She / It + V1 + s / es') && rules.includes("He / She / It + doesn't + V1") && rules.includes("I / You / We / They + don't + V1"));
  check("Rules: highlighted doesn't + V1 rule", rules.includes("После doesn't основной глагол — без -s / -es"));
  check('Rules: endings incl. sound [s]/[z]/[ɪz] (from the old section)', rules.includes('watch → watches') && rules.includes('study → studies') && rules.includes('[ɪz]'));
  check('Rules: "Когда используем" kept from the old section', rules.includes('Когда используем') && rules.includes('always, usually, often'));
  check('Rules: examples with translation', rules.includes('Он не любит кофе.'));

  // Constructor + / −
  check('Constructor (+): She watches TV in the evening.', (await sentence(page)) === 'She watches TV in the evening.', await sentence(page));
  await page.click('main [role=radio]:has-text("Отрицание")');
  check("Constructor (−): She doesn't watch TV in the evening.", (await sentence(page)) === "She doesn't watch TV in the evening.", await sentence(page));
  await page.locator('main button', { hasText: /^I$/ }).click();
  check("Constructor (−): I don't watch …", (await sentence(page)).startsWith("I don't watch"));
  await page.locator('main button', { hasText: /^My mum$/ }).click();
  await page.locator('main button', { hasText: /^have$/ }).click();
  check("Constructor (−): My mum doesn't have a dog. + note «не has»", (await sentence(page)) === "My mum doesn't have a dog." && (await mainText(page)).includes('(не has)'));

  // ---------- 4. Practice tab: six blocks ----------
  await tab(page, 'Упражнения');
  const pr = await mainText(page);
  check('Practice: blocks in order (+, −, mixed)', ['1. Выберите форму', '2. Напишите форму сами', "3. Don't или doesn't?", '4. Сделайте отрицание', '5. Найдите и исправьте ошибку', '6. Переведите на английский'].every((t, i, a) => pr.indexOf(t) >= 0 && (i === 0 || pr.indexOf(a[i - 1]) < pr.indexOf(t))));
  check('Practice: old solved tasks marked "уже решено раньше"', (pr.match(/уже решено раньше/g) || []).length === 3);
  const choose = async (scope, answers) => { for (const a of answers) await page.locator(`main section:has-text("${scope}") button:text-is(${JSON.stringify(a)}):not([disabled])`).first().click(); };
  await choose('1. Выберите форму', D.PS_QUIZ.map((q) => q.answer));
  for (const q of D.PS_TYPE) { await page.fill('#in-' + q.id, q.answer.toUpperCase() + ' '); await page.press('#in-' + q.id, 'Enter'); }
  await page.locator(`main section:has-text("3. Don't или doesn't?") button:text-is("doesn't"):not([disabled])`).first().click();
  check("Block 3: wrong don't/doesn't shows a hint, not counted", !(await progressOf(page))['pn-c2']);
  await choose("3. Don't или doesn't?", D.PN_CHOOSE.map((q) => q.answer));
  await page.fill('#in-pn-t2', "She doesn't plays the piano."); await page.press('#in-pn-t2', 'Enter');
  check("Block 4: \"doesn't plays\" rejected", !(await progressOf(page))['pn-t2']);
  for (const q of D.PN_TRANSFORM) { await page.fill('#in-' + q.id, q.accept[0].replace("doesn't", 'does not').toLowerCase()); await page.press('#in-' + q.id, 'Enter'); }
  for (const q of D.PS_FIX_ALL) {
    const words = page.locator(`[data-q="${q.id}"] button[aria-label$="отметить как ошибку"]`);
    await words.nth(q.wrong).click();
    await page.fill('#fix-' + q.id, q.fix[q.fix.length - 1]); await page.press('#fix-' + q.id, 'Enter');
  }
  for (const q of D.PN_TRANSLATE) { await page.fill('#in-' + q.id, q.accept[q.accept.length - 1]); await page.press('#in-' + q.id, 'Enter'); }
  let p = await progressOf(page);
  const practice = [...D.PS_QUIZ, ...D.PS_TYPE, ...D.PN_CHOOSE, ...D.PN_TRANSFORM, ...D.PS_FIX_ALL, ...D.PN_TRANSLATE];
  check(`Practice: all ${practice.length} tasks counted`, practice.every((q) => p[q.id]), practice.filter((q) => !p[q.id]).map((q) => q.id).join(','));
  check('Old find-the-error tasks now also ask for the fix (two steps)', (await page.locator('[data-q="pf1"]').innerText()).includes('lives'));

  // ---------- 5. Test tab ----------
  await tab(page, 'Итоговый тест');
  for (const q of D.PN_TEST) {
    const pick = q.id === 'pn-q4' ? q.options.find((o) => o !== q.answer) : q.answer;
    await page.locator(`[data-q="${q.id}"] button:text-is(${JSON.stringify(pick)})`).click();
  }
  const t = await page.locator('[data-q="pn-q4"]').innerText();
  check('Test: wrong answer shows the right option and the rule', t.includes('Неверно') && t.includes('Правильный ответ: watch') && t.includes('Правило:'));
  check('Test: result 9 of 10', (await mainText(page)).includes('Результат: 9 из 10'));
  await page.click('main button:has-text("Пройти заново")');
  await page.locator('[data-q="pn-q4"] button:text-is("watch")').click();

  // ---------- 6. Persistence ----------
  await page.reload(); await page.waitForSelector('aside nav');
  check('After reload: all 55 + 1 other = 56 / 104', (await counter(page)) === '56/104', await counter(page));
  p = await progressOf(page);
  check('Old answer dates untouched', p.ps1.at === '2026-10-20T10:00:00.000Z' && p.ar1);

  // ---------- 7. Phone ----------
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click('button[aria-label="Открыть меню разделов"]'); await page.waitForTimeout(350);
  await page.click('text=Present Simple >> visible=true'); await page.waitForTimeout(350);
  const sizes = [];
  for (const name of ['Правила', 'Упражнения', 'Итоговый тест']) { await tab(page, name); await page.waitForTimeout(200); sizes.push(await page.evaluate(() => document.documentElement.scrollWidth)); }
  check('Phone 375px: all three tabs without horizontal scroll', sizes.every((w) => w <= 375), sizes.join(','));

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
