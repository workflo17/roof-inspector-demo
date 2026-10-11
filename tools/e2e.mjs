// End-to-end check for the roof inspector demo, driven over the Chrome DevTools Protocol.
// Usage (server already running on the port): node tools/e2e.mjs [baseUrl]
//
// What it proves, in a real Chrome at phone size:
//   1. the service worker installs and every file in its ASSETS list is in the cache
//   2. with the HTTP cache disabled and the network offline, a reload still opens the app and
//      shows the saved inspection (so the offline claim comes from the cache, not luck)
//   3. the whole flow works: rate items, add a finding with a photo, mark it up, build the report
//   4. no route scrolls sideways at 390px, in light and dark
//   5. the report prints to a PDF
// Screenshots land in qa/. Exits 1 if any check fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, until, sleep } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:5290/';
const QA = join(ROOT, 'qa');
mkdirSync(QA, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

const chromeSession = await launchChrome();
const { send, evalJS, events } = chromeSession;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const consoleErrors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));

async function viewport(w, h, dark = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
}
async function nav(path) {
  await send('Page.navigate', { url: BASE + path });
  await until(() => evalJS(`document.readyState === 'complete' && !!document.querySelector('#view h1')`));
  await sleep(250);
}
async function hash(h) { await evalJS(`location.hash = ${JSON.stringify(h)}`); await sleep(350); }
async function shot(name, full = true) {
  let clip;
  if (full) { const m = await send('Page.getLayoutMetrics'); clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 4000), scale: 1 }; }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  writeFileSync(join(QA, name + '.png'), Buffer.from(r.data, 'base64'));
}
const overflow = () => evalJS(`(() => { const w = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !e.closest('[hidden]'); }).slice(0, 4).map(e => e.tagName + '.' + (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)); return { scrollW: document.documentElement.scrollWidth, w, bad }; })()`);
// SVG elements have no .click(), so dispatch a real click event; it bubbles like a tap would.
const click = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no element ' + ${JSON.stringify(sel)}); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; })()`);

try {
  /* ---------- 1. load, service worker, cache ---------- */
  await viewport(390, 844);
  await nav('');
  check('app renders the inspection list', await evalJS(`document.querySelectorAll('.card h2').length >= 1`));
  const sw = await until(() => evalJS(`navigator.serviceWorker.ready.then(r => new Promise(res => { const s = r.active; if (s.state === 'activated') res(true); else s.addEventListener('statechange', () => s.state === 'activated' && res(true)); }))`), 20000);
  check('service worker activated', sw);
  const swSrc = await evalJS(`fetch('sw.js', { cache: 'no-store' }).then(r => r.text())`);
  const assets = [...swSrc.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const cached = await evalJS(`Promise.all(${JSON.stringify(assets)}.map(a => caches.match(new URL(a, document.baseURI)).then(r => [a, !!r])))`);
  check(`all ${assets.length} cached assets present`, cached.every(([, ok]) => ok), cached.filter(([, ok]) => !ok).map(([a]) => a).join(', '));
  check('page is controlled by the worker after reload', await (async () => { await send('Page.reload'); await until(() => evalJS(`document.readyState === 'complete'`)); return until(() => evalJS(`!!navigator.serviceWorker.controller`), 8000).catch(() => false); })());

  /* ---------- 2. offline reload, HTTP cache off ---------- */
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.reload');
  await until(() => evalJS(`document.readyState === 'complete' && !!document.querySelector('#view h1')`), 15000);
  check('offline reload opens the app', await evalJS(`document.querySelector('h1').textContent === 'Inspections'`));
  check('offline reload still lists the saved inspection', await evalJS(`document.querySelectorAll('.card h2').length >= 1`));
  check('status badge says offline', await evalJS(`document.querySelector('.pill').textContent.startsWith('Offline')`), await evalJS(`document.querySelector('.pill').textContent`));
  await hash('#/'); // stay on home, then open the sample while offline
  await click('.card');
  await sleep(400);
  check('roof plan opens offline', await evalJS(`!!document.querySelector('.plan svg')`));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Network.setCacheDisabled', { cacheDisabled: false });

  /* ---------- 3. the flow ---------- */
  await nav('');
  await click('.card'); await sleep(400);
  const planFacts = await evalJS(`({ areas: document.querySelectorAll('.plan [data-action=area]').length, plates: [...document.querySelectorAll('.plan .plate')].map(p => p.textContent.replace(/\\s+/g, ' ')) })`);
  check('roof plan has 7 tappable areas', planFacts.areas === 7, String(planFacts.areas));
  check('plan labels show status as words', planFacts.plates.some(t => /Fix · 2/.test(t)) && planFacts.plates.some(t => /Not yet/.test(t)), planFacts.plates.join(' | '));
  await shot('01-roof-plan-light');

  await click('.plan [data-area=left]'); await sleep(400);
  check('left slope opens', await evalJS(`document.querySelector('h1').textContent === 'Left slope'`));
  await click('[data-action=allok]'); await sleep(300);
  check('"everything else is fine" rates all items good', await evalJS(`document.querySelectorAll('.rate button.ok[aria-pressed=true]').length === 9`));
  await click('[data-action=rate][data-item=crack][data-val=fix]'); await sleep(300);
  check('rating an item fix updates the badge', await evalJS(`!!document.querySelector('.meta .badge.fix')`));
  for (let i = 0; i < 4; i++) await click('[data-action=hail][data-delta="1"]');
  check('hail counter counts', await evalJS(`document.querySelector('.counter .num').textContent === '4'`));
  await shot('02-left-slope-light');

  await click('[data-action=addFinding]'); await sleep(400);
  check('finding sheet opens', await evalJS(`!document.querySelector('#sheet').hidden && !!document.querySelector('[data-form=finding]')`));
  check('page behind the sheet is inert (cannot take focus)', await evalJS(`document.querySelector('.app').inert === true`));
  await evalJS(`(() => { const s = document.querySelector('[name=item]'); s.value = 'Missing or lifted shingles'; s.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[name=note]').value = 'Two tabs lifted along the left edge.'; })()`);
  await click('[data-action=samplePhoto]');
  await until(() => evalJS(`!document.querySelector('#annot').hidden`), 8000);
  check('markup screen opens after a photo', true);
  await sleep(300);
  const box = await evalJS(`(() => { const r = document.querySelector('#annot-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.45;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 90, y: cy });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx + 90, y: cy, button: 'left', clickCount: 1 });
  for (let a = 0; a <= 360; a += 20) {
    const r = a * Math.PI / 180;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 90 * Math.cos(r), y: cy + 60 * Math.sin(r), button: 'left' });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 90, y: cy, button: 'left', clickCount: 1 });
  await sleep(200);
  await shot('03-markup-light', false);
  const marked = await evalJS(`(() => { const c = document.querySelector('#annot-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 16) if (d[i] > 230 && d[i + 1] < 90 && d[i + 2] < 90) red++; return red; })()`);
  check('drawing put red marker pixels on the photo', marked > 200, `${marked} sampled red pixels`);
  await click('[data-annot=save]');
  // saving re-encodes the photo and writes it to IndexedDB, so wait for the result, not a fixed time
  check('markup closes and photo shows in the sheet', await until(() => evalJS(`document.querySelector('#annot').hidden && document.querySelectorAll('#thumbs img').length === 1`), 8000).catch(() => false));
  await shot('04-finding-sheet-light', false);
  await evalJS(`document.querySelector('[data-form=finding]').requestSubmit()`); await sleep(500);
  check('finding saved and listed on the slope', await evalJS(`document.querySelectorAll('.finding').length === 1 && document.querySelector('#sheet').hidden`));
  check('page is interactive again after the sheet closes', await evalJS(`document.querySelector('.app').inert === false && document.querySelector('#sheet').inert === false`));
  check('saved finding photo is a real image', await until(() => evalJS(`(() => { const i = document.querySelector('.finding img'); return i && i.complete && i.naturalWidth > 100; })()`), 6000).catch(() => false));

  await nav(''); await click('.card'); await sleep(400);
  const nowFacts = await evalJS(`[...document.querySelectorAll('.plan .plate')].map(p => p.textContent.replace(/\\s+/g, ' '))`);
  check('left slope now shows Fix · 1 on the plan', nowFacts.some(t => /LEFT\s*Fix · 1/.test(t)), nowFacts.join(' | '));
  await click('a[href$="/report"]'); await sleep(900);
  check('report builds with photos', await until(() => evalJS(`(() => { const imgs = [...document.querySelectorAll('.report img')]; return imgs.length >= 6 && imgs.every(i => i.complete && i.naturalWidth > 100); })()`), 8000).catch(() => false));
  const rep = await evalJS(`({ overall: document.querySelector('.overall strong').textContent, rows: document.querySelectorAll('.report tbody tr').length, recs: document.querySelectorAll('.recs li').length })`);
  check('report overall is Repairs recommended, 7 area rows', rep.overall === 'Repairs recommended' && rep.rows === 7, JSON.stringify(rep));
  await shot('05-report-light');
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: false });
  writeFileSync(join(QA, 'report.pdf'), Buffer.from(pdf.data, 'base64'));
  const pdfBytes = Buffer.from(pdf.data, 'base64');
  check('report prints to a PDF', pdfBytes.length > 20000, `${pdfBytes.length} bytes`);
  const pdfPages = (pdfBytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
  check('report PDF is 5 pages or fewer (no near-empty pages)', pdfPages >= 1 && pdfPages <= 5, `${pdfPages} pages`);
  check('every report photo sits inside a finding block that prints as one piece', await evalJS(`[...document.querySelectorAll('.report .fig')].every(f => !!f.closest('.fblock'))`));

  /* ---------- 4. no sideways scroll, light and dark ---------- */
  const routes = ['#/', '#/new', null, null, null];
  for (const dark of [false, true]) {
    await viewport(390, 844, dark);
    await nav('');
    const id = await evalJS(`document.querySelector('.card').getAttribute('href').split('/')[2]`);
    for (const r of ['#/', '#/new', `#/i/${id}`, `#/i/${id}/a/front`, `#/i/${id}/a/chimney`, `#/i/${id}/report`]) {
      await hash(r);
      const o = await overflow();
      check(`no sideways scroll ${dark ? 'dark' : 'light'} ${r.replace(id, 'ID')}`, o.scrollW <= o.w + 1 && o.bad.length === 0, JSON.stringify(o));
    }
    if (dark) { await hash(`#/i/${id}`); await shot('06-roof-plan-dark'); await hash(`#/i/${id}/a/front`); await shot('07-front-slope-dark'); }
    else { await hash('#/'); await shot('00-home-light'); await hash(`#/i/${id}/a/front`); await shot('02b-front-slope-light'); }
  }

  /* ---------- 5. console ---------- */
  const errs = consoleErrors();
  check('no console errors or exceptions during the run', errs.length === 0, errs.slice(0, 2).map(e => JSON.stringify(e.params).slice(0, 160)).join(' || '));
} catch (e) {
  check('harness ran to the end', false, String(e.message || e));
} finally {
  await chromeSession.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
