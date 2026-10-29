// Data safety test for Easy English Grammar Hub (stage 1: schema v2, export, import).
// Run from the repository root:  node tests/data.js   (SHIM_DIR works as in smoke.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);
const SHIM = process.env.SHIM_DIR;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eegh-'));

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

const V2 = 'eegh-data-v2', V1 = 'eegh-progress-v1';
const get = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const getJSON = async (page, key) => JSON.parse((await get(page, key)) || 'null');
const set = (page, key, val) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, val]);
const counter = async (page) => ((await page.innerText('header')).match(/(\d+)\s*\/\s*(\d+)/) || [])[1];
const reload = async (page) => { await page.reload(); await page.waitForSelector('aside nav', { timeout: 30000 }); };
const openData = async (page) => { await page.click('aside >> text=Мои данные'); await page.waitForTimeout(150); };
const importFile = async (page, file) => { await page.setInputFiles('#import-file', file); await page.waitForTimeout(250); };

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const url = `http://localhost:${PORT}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeLibraries(page);
  await page.goto(url);
  await page.waitForSelector('aside nav', { timeout: 30000 });

  // 1. Migration from v1: old progress is carried over, old key is kept untouched
  await page.evaluate(() => localStorage.clear());
  const v1 = JSON.stringify({ t1: true, a2: true, ar5: true, 'old-id': true });
  await set(page, V1, v1);
  await reload(page);
  const v2 = await getJSON(page, V2);
  check('Migration: v2 created with schema 2', v2 && v2.schema === 2);
  check('Migration: all old answers carried over', v2 && ['t1', 'a2', 'ar5', 'old-id'].every((id) => v2.progress[id]));
  check('Migration: old v1 key left untouched', (await get(page, V1)) === v1);
  check('Migration: counter shows 3 (unknown id ignored)', (await counter(page)) === '3', await counter(page));

  // 2. New answers are saved with a date
  await page.click('aside >> text=Времена глаголов');
  await page.locator('main section:has-text("Мини-тест") button:text-is("drinks")').click();
  const afterAnswer = await getJSON(page, V2);
  check('New answer stored with ISO date', afterAnswer.progress.t2 && /^\d{4}-\d\d-\d\dT/.test(afterAnswer.progress.t2.at || ''));

  // 3. Export
  await openData(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('main >> text=Скачать копию')]);
  const exportPath = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(exportPath);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  check('Export: file name has a date', /^easy-english-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('Export: app id and schema', exported.app === 'easy-english-grammar-hub' && exported.schema === 2);
  check('Export: progress matches storage exactly', JSON.stringify(exported.data.progress) === JSON.stringify(afterAnswer.progress));
  await page.waitForTimeout(200);
  check('Export: last backup date remembered', !!(await getJSON(page, V2)).meta.lastExportAt);

  // 4. Export → clear → import (replace) restores everything
  await page.evaluate(() => localStorage.clear());
  await reload(page);
  check('After clearing, progress is 0', (await counter(page)) === '0');
  await openData(page);
  await importFile(page, exportPath);
  const preview = await page.innerText('main');
  check('Import: preview shows counts before changing anything', preview.includes('Решено заданий: 4') && (await counter(page)) === '0');
  await page.click('main >> text=Заменить');
  await page.waitForTimeout(200);
  const restored = await getJSON(page, V2);
  check('Import (replace): progress restored exactly', JSON.stringify(restored.progress) === JSON.stringify(afterAnswer.progress));
  check('Import (replace): counter back to 4', (await counter(page)) === '4');
  await reload(page);
  check('Import survives reload', (await counter(page)) === '4');

  // 5. Merge keeps local answers and adds the file's; undo returns the previous state
  await set(page, V2, JSON.stringify({ schema: 2, progress: { t9: { at: '2026-10-01T10:00:00.000Z' }, t1: { at: '2026-10-05T10:00:00.000Z' } }, topics: [], items: [], reviews: [], settings: {}, meta: {} }));
  await reload(page);
  await openData(page);
  await importFile(page, exportPath);
  await page.click('main >> text=Объединить');
  await page.waitForTimeout(200);
  const merged = await getJSON(page, V2);
  check('Import (merge): union of local and file', ['t9', 't1', 't2', 'a2', 'ar5', 'old-id'].every((id) => merged.progress[id]), Object.keys(merged.progress).join(','));
  check('Import (merge): local date kept when file has none', merged.progress.t1.at === '2026-10-05T10:00:00.000Z');
  await page.click('main >> text=Вернуть как было');
  await page.waitForTimeout(200);
  const undone = await getJSON(page, V2);
  check('Undo import returns previous state', Object.keys(undone.progress).sort().join(',') === 't1,t9');

  // 6. Bad files are rejected and change nothing
  const before = await get(page, V2);
  const bad1 = path.join(TMP, 'not-json.json'); fs.writeFileSync(bad1, 'hello, I am not JSON');
  const bad2 = path.join(TMP, 'other-app.json'); fs.writeFileSync(bad2, JSON.stringify({ app: 'other', data: {} }));
  await importFile(page, bad1);
  check('Import: non-JSON file rejected with a message', (await page.innerText('main')).includes('не читается как JSON'));
  await importFile(page, bad2);
  check('Import: other app file rejected with a message', (await page.innerText('main')).includes('другим приложением'));
  check('Import: rejected files changed nothing', (await get(page, V2)) === before);

  // 7. Damaged storage: kept aside, user warned, v1 migration used, nothing crashes
  await set(page, V1, v1);
  await set(page, V2, '{ this is broken');
  await reload(page);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('Damaged storage: raw data saved to a separate key', keys.some((k) => k.startsWith('eegh-data-v2-damaged-')));
  check('Damaged storage: warning shown', (await page.innerText('main')).includes('оказались повреждены'));
  check('Damaged storage: recovered from v1 (3 answers)', (await counter(page)) === '3', await counter(page));

  check('No page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
