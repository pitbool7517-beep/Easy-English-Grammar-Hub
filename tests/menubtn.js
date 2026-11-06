// Header menu button (☰, top-left): contrast in light and dark themes, all states, phone and tablet widths.
// Run from the repository root:  node tests/menubtn.js   (SHIM_DIR works as in smoke.js)
// Optional: SHOTS_DIR=/path to save cropped screenshots of the button in every state.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9800 + Math.floor(Math.random() * 90);
const SHIM = process.env.SHIM_DIR;
const SHOTS = process.env.SHOTS_DIR;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, d) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(d); });
});

const results = [];
const check = (name, ok, extra = '') => results.push([ok, name + (extra ? ` (${extra})` : '')]);

// Minimal icon set drawn with currentColor, so the icon colour is visible in screenshots
const ICONS = `(function(){var h=function(){return React.createElement.apply(React,arguments)};
function svg(paths){return function(p){p=p||{};var s=p.size||24;return h('svg',{width:s,height:s,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',className:p.className,style:p.style,'aria-hidden':'true'},paths.map(function(d,i){return h('path',{key:i,d:d})}))}}
var dot=svg(['M12 12h.01']);window.LucideReact=new Proxy({Menu:svg(['M4 6h16','M4 12h16','M4 18h16']),X:svg(['M18 6 6 18','M6 6l12 12'])},{get:function(t,k){return t[k]||dot}});})();`;

async function setup(page) {
  await page.route(/^https:\/\/(api\.|en\.wiktionary|fonts\.)/, (r) => r.abort());
  if (!SHIM) return;
  const send = (r, name) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SHIM, name)) });
  await page.route(/cdnjs\.cloudflare\.com\/.*\/react\.production/, (r) => send(r, 'react.js'));
  await page.route(/cdnjs\.cloudflare\.com\/.*react-dom/, (r) => send(r, 'empty.js'));
  await page.route(/babel-standalone/, (r) => send(r, 'babel.js'));
  await page.route(/cdn\.tailwindcss\.com/, (r) => send(r, 'empty.js'));
  await page.route(/unpkg\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: ICONS }));
}

// WCAG contrast
const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
const isTransparent = (s) => s === 'transparent' || /rgba\(.*,\s*0\)$/.test(s);

async function state(page) {
  return page.$eval('button[aria-label="Открыть меню разделов"]', (b) => {
    const cs = getComputedStyle(b);
    // The header uses Tailwind's bg-surface: read the theme token so the test does not depend on Tailwind
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    const probe = document.createElement('div'); probe.style.background = surface; document.body.appendChild(probe);
    const header = { backgroundColor: getComputedStyle(probe).backgroundColor }; probe.remove();
    const svg = b.querySelector('svg');
    return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, borderW: cs.borderTopWidth, headerBg: header.backgroundColor, svgStroke: svg ? getComputedStyle(svg).stroke : null, transform: cs.transform };
  });
}

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await chromium.launch();
  check('Page declares light + dark support (<meta name="color-scheme">)', /<meta name="color-scheme" content="light dark">/.test(html));
  const before = {}; // light theme values to compare with the previous design

  for (const scheme of ['light', 'dark']) {
    for (const width of [375, 900]) {
      const ctx = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await setup(page);
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('aside nav', { timeout: 30000 });
      await page.mouse.move(width - 5, 690); // pointer away from the button
      await page.waitForTimeout(300);
      const btn = page.locator('button[aria-label="Открыть меню разделов"]');
      const tag = `${scheme} ${width}px`;
      const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); const box = await btn.boundingBox(); await page.screenshot({ path: path.join(SHOTS, `${scheme}-${width}-${name}.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 } }); } };

      // normal
      const n = await state(page);
      const effBg = (s) => (isTransparent(s.bg) ? rgb(s.headerBg) : rgb(s.bg));
      const iconC = ratio(rgb(n.color), effBg(n));
      check(`${tag}: icon follows the button colour (stroke = currentColor)`, !n.svgStroke || n.svgStroke === n.color, `${n.svgStroke} vs ${n.color}`);
      check(`${tag}: normal — icon contrast ≥ 4.5:1`, iconC >= 4.5, iconC.toFixed(2));
      if (scheme === 'dark') {
        const shape = Math.max(ratio(rgb(n.border), rgb(n.headerBg)), ratio(rgb(n.bg), rgb(n.headerBg)));
        check(`${tag}: normal — button outline visible on the header (≥ 3:1)`, shape >= 3, shape.toFixed(2));
      } else {
        before[width] = n;
        check(`${tag}: light design unchanged — transparent, no visible border, ink icon`, isTransparent(n.bg) && isTransparent(n.border) && n.color === 'rgb(31, 42, 68)', `${n.bg} / ${n.border} / ${n.color}`);
      }
      await shot('1-normal');

      // hover
      await btn.hover();
      await page.waitForTimeout(300);
      const h = await state(page);
      const hoverC = ratio(rgb(h.color), effBg(h));
      check(`${tag}: hover — background changes, icon contrast ≥ 4.5:1`, h.bg !== n.bg && hoverC >= 4.5, `${h.bg}, ${hoverC.toFixed(2)}`);
      if (scheme === 'light') check(`${tag}: light hover as before (surface-2 #eef2fa)`, h.bg === 'rgb(238, 242, 250)', h.bg);
      await shot('2-hover');

      // pressed
      await page.mouse.down();
      await page.waitForTimeout(150);
      const p = await state(page);
      check(`${tag}: pressed — button shrinks slightly`, p.transform !== 'none', p.transform);
      await shot('3-pressed');
      await page.mouse.up();
      await page.waitForTimeout(400);

      // open
      const o = await state(page);
      const expanded = await btn.getAttribute('aria-expanded');
      const openC = ratio(rgb(o.color), effBg(o));
      check(`${tag}: open menu — aria-expanded=true, icon contrast ≥ 4.5:1`, expanded === 'true' && openC >= 4.5, `${expanded}, ${openC.toFixed(2)}`);
      if (scheme === 'dark') check(`${tag}: open menu looks different from closed (indigo)`, o.color !== n.color && o.bg !== n.bg, `${o.color} on ${o.bg}`);
      else check(`${tag}: light open state keeps the old look`, o.color === n.color && isTransparent(o.border), `${o.color} / ${o.border}`);
      await page.mouse.move(width - 5, 690);
      await page.waitForTimeout(300);
      await shot('4-open');

      // logic unchanged: second click closes
      await btn.click();
      await page.waitForTimeout(400);
      check(`${tag}: second click closes the menu (logic unchanged)`, (await btn.getAttribute('aria-expanded')) === 'false' && (await page.getAttribute('[data-drawer]', 'aria-hidden')) === 'true');
      check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // Theme switched by the host (data-theme="dark", e.g. inside Claude) also gets the dark button
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await setup(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('aside nav', { timeout: 30000 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.mouse.move(370, 690);
  await page.waitForTimeout(300);
  const d = await state(page);
  check('data-theme="dark": dark button colours apply too', d.bg === 'rgb(42, 53, 82)' && ratio(rgb(d.color), rgb(d.bg)) >= 4.5, `${d.color} on ${d.bg}`);
  await ctx.close();

  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, name] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
