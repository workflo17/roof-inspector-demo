/* Roof Inspector demo.
   Plain JavaScript, no libraries. Inspections live in IndexedDB on the phone, photos too,
   and the service worker caches the app itself, so it keeps working with no signal.
   Syncing is simulated: there is no server in this demo. */
(() => {
'use strict';

/* ================= helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = ts => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ts);
const fmtDateTime = ts => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const RANK = { ok: 1, watch: 2, fix: 3 };
const LABEL = { ok: 'Good', watch: 'Watch', fix: 'Fix' };
const worst = list => list.reduce((w, r) => (r && (!w || RANK[r] > RANK[w]) ? r : w), null);

const svg = inner => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chev: svg('<path d="M9 5l7 7-7 7"/>'),
  camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  ok: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  watch: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'),
  fix: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  none: svg('<circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/>'),
  photo: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l5-4 4 3 3-2 3 3"/>'),
};
const badge = (r, text) => `<span class="badge ${r || 'none'}">${ICON[r || 'none']}${esc(text || (r ? LABEL[r] : 'Not yet'))}</span>`;

/* ================= checklist templates =================
   One checklist per roof material, because a single form does not fit asphalt and metal. */
const SLOPE_ITEMS = {
  'Asphalt shingle': [
    ['granule', 'Granule loss or bare spots'],
    ['crack', 'Cracked or split shingles'],
    ['curl', 'Curling or cupping'],
    ['missing', 'Missing or lifted shingles'],
    ['hail', 'Hail bruising or impacts'],
    ['wind', 'Wind creasing'],
    ['nails', 'Nail pops or exposed fasteners'],
    ['moss', 'Moss, algae or debris'],
    ['soft', 'Soft or spongy decking underfoot'],
  ],
  'Metal panel': [
    ['fasteners', 'Loose or backed-out fasteners'],
    ['seams', 'Open or lifted seams'],
    ['rust', 'Rust or coating failure'],
    ['dents', 'Dents or impact marks'],
    ['sealant', 'Sealant cracked at laps'],
    ['panel', 'Buckled or oil-canned panels'],
    ['debris', 'Debris or standing water'],
  ],
};
const PART_ITEMS = {
  chimney: [
    ['flash', 'Flashing sealed and tight'],
    ['crown', 'Crown or cap cracks'],
    ['mortar', 'Mortar and brick'],
    ['cricket', 'Cricket or saddle behind the chimney'],
  ],
  vents: [
    ['boots', 'Pipe boots cracked or dry-rotted'],
    ['flanges', 'Exposed nails on vent flanges'],
    ['ridgevent', 'Ridge or box vents damaged'],
    ['skylight', 'Skylight seals'],
  ],
  gutters: [
    ['debris', 'Debris or standing water'],
    ['loose', 'Loose or sagging sections'],
    ['down', 'Downspouts clear and discharging away'],
    ['fascia', 'Drip edge or fascia damage'],
  ],
};

function buildAreas(material) {
  const slope = SLOPE_ITEMS[material] || SLOPE_ITEMS['Asphalt shingle'];
  const mk = (id, name, kind, items) => ({
    id, name, kind, findings: [], hail: null,
    items: items.map(([iid, label]) => ({ id: iid, label, rating: null })),
  });
  return [
    mk('front', 'Front slope', 'slope', slope),
    mk('right', 'Right slope', 'slope', slope),
    mk('rear', 'Rear slope', 'slope', slope),
    mk('left', 'Left slope', 'slope', slope),
    mk('chimney', 'Chimney and flashing', 'part', PART_ITEMS.chimney),
    mk('vents', 'Vents and penetrations', 'part', PART_ITEMS.vents),
    mk('gutters', 'Gutters and drainage', 'part', PART_ITEMS.gutters),
  ];
}
function newInspection(o) {
  const material = SLOPE_ITEMS[o.material] ? o.material : 'Asphalt shingle';
  return {
    id: uid(), created: Date.now(), updated: Date.now(),
    address: o.address, client: o.client || 'Client name', type: o.type || 'Storm and hail',
    material, age: o.age ? Number(o.age) : null, pitch: o.pitch || '', stories: Number(o.stories) || 2,
    inspector: 'Sample Inspector', sample: false, areas: buildAreas(material),
  };
}

const areaRating = a => worst(a.items.map(i => i.rating).concat(a.findings.map(f => f.severity)));
const inspected = a => areaRating(a) !== null;
const findingCount = i => i.areas.reduce((n, a) => n + a.findings.length, 0);
const overall = i => worst(i.areas.map(areaRating));
const hasHail = (insp, a) => insp.material === 'Asphalt shingle' && a.kind === 'slope';
const checkedCount = a => a.items.filter(i => i.rating).length;

/* ================= storage (IndexedDB, with an in-memory fallback) ================= */
let db = null;
const mem = { inspections: new Map(), photos: new Map(), meta: new Map() };

function openDB() {
  return new Promise(resolve => {
    if (!('indexedDB' in window)) return resolve(null);
    let r;
    try { r = indexedDB.open('roof-inspector-demo', 1); } catch (e) { return resolve(null); }
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('inspections', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const dbPut = (store, value, key) => {
  if (!db) { mem[store].set(store === 'meta' ? key : value.id, value); return Promise.resolve(); }
  return tx(store, 'readwrite', s => (store === 'meta' ? s.put(value, key) : s.put(value)));
};
const dbGet = (store, key) => (db ? tx(store, 'readonly', s => s.get(key)) : Promise.resolve(mem[store].get(key)));
const dbAll = store => (db ? tx(store, 'readonly', s => s.getAll()) : Promise.resolve(Array.from(mem[store].values())));
const dbDel = (store, key) => (db ? tx(store, 'readwrite', s => s.delete(key)) : (mem[store].delete(key), Promise.resolve()));
const dbClear = store => (db ? tx(store, 'readwrite', s => s.clear()) : (mem[store].clear(), Promise.resolve()));

/* photos */
const urls = new Map();
async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const rec = await dbGet('photos', id);
  if (!rec) return '';
  const u = URL.createObjectURL(rec.blob);
  urls.set(id, u);
  return u;
}
function dropURL(id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }
function hydrate(root = document) {
  $$('img[data-photo]', root).forEach(img => {
    photoURL(img.dataset.photo).then(u => { if (u && img.isConnected && img.getAttribute('src') !== u) img.src = u; });
  });
}
async function addPhoto(blob) { const id = uid(); await dbPut('photos', { id, blob, ts: Date.now() }); return id; }
async function replacePhoto(id, blob) { await dbPut('photos', { id, blob, ts: Date.now() }); dropURL(id); }
async function removePhoto(id) { dropURL(id); await dbDel('photos', id); }

async function processFile(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

/* ================= sample photos (drawn, so the demo has no image files) ================= */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function drawShingles(x, r, W, H) {
  const TW = 160, TH = 92;
  x.fillStyle = '#20262b'; x.fillRect(0, 0, W, H);
  for (let row = -1; row * TH < H + TH; row++) {
    const off = row % 2 ? TW / 2 : 0;
    for (let col = -2; col * TW < W + TW; col++) {
      const px = col * TW + off, py = row * TH;
      x.fillStyle = `hsl(205 7% ${27 + r() * 9}%)`;
      x.fillRect(px + 2, py + 2, TW - 4, TH - 4);
      x.fillStyle = 'rgba(0,0,0,.38)';
      x.fillRect(px + 2, py + TH - 9, TW - 4, 7);
    }
  }
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.12)';
    x.fillRect(r() * W, r() * H, 2, 2);
  }
}
function chalk(x, cx, cy, rx, ry) {
  x.save(); x.strokeStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 6; x.lineCap = 'round';
  x.beginPath(); x.ellipse(cx, cy, rx, ry, -0.15, 0, Math.PI * 2); x.stroke(); x.restore();
}
function samplePhoto(kind, seed = 1) {
  const W = 960, H = 720, r = rng(seed * 7919 + kind.length * 31);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  drawShingles(x, r, W, H);

  if (kind === 'missing') {
    const px = 560, py = 276;
    x.fillStyle = '#d99a92'; x.fillRect(px + 2, py + 2, 156, 88);
    x.fillStyle = 'rgba(120,50,45,.35)'; for (let i = 0; i < 4; i++) x.fillRect(px + 2, py + 12 + i * 22, 156, 3);
    x.fillStyle = '#9aa3a8'; [30, 80, 130].forEach(d => { x.beginPath(); x.arc(px + d, py + 22, 5, 0, 7); x.fill(); });
    chalk(x, px + 80, py + 46, 120, 78);
  } else if (kind === 'crack') {
    const px = 320, py = 368; let cx = px + 14, cy = py + 10;
    x.strokeStyle = '#0a0c0d'; x.lineWidth = 6; x.lineJoin = 'round'; x.beginPath(); x.moveTo(cx, cy);
    for (let i = 0; i < 7; i++) { cx += 20 + r() * 8; cy += 8 + r() * 10 - (i % 2 ? 7 : 0); x.lineTo(cx, cy); }
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 2; x.stroke();
    chalk(x, px + 80, py + 46, 118, 70);
  } else if (kind === 'hail') {
    x.save(); x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 8; x.setLineDash([26, 16]); x.strokeRect(150, 110, 660, 500); x.restore();
    for (let i = 0; i < 11; i++) {
      const bx = 190 + r() * 580, by = 150 + r() * 420;
      const g = x.createRadialGradient(bx, by, 2, bx, by, 24);
      g.addColorStop(0, 'rgba(8,10,11,.95)'); g.addColorStop(1, 'rgba(8,10,11,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, 24, 0, 7); x.fill();
      chalk(x, bx, by, 36, 34);
    }
  } else if (kind === 'granule') {
    x.fillStyle = '#14171a'; x.beginPath(); x.ellipse(500, 380, 150, 92, 0.2, 0, 7); x.fill();
    for (let i = 0; i < 600; i++) { x.fillStyle = r() < 0.5 ? '#1d2226' : '#0d0f11'; x.fillRect(380 + r() * 240, 310 + r() * 140, 3, 3); }
    chalk(x, 500, 380, 190, 128);
  } else if (kind === 'flashing') {
    x.save(); x.translate(480, 360); x.rotate(-0.42);
    const g = x.createLinearGradient(0, -70, 0, 70); g.addColorStop(0, '#c9d0d4'); g.addColorStop(1, '#8c969c');
    x.fillStyle = g; x.fillRect(-620, -70, 1240, 140);
    x.fillStyle = '#16191b'; x.fillRect(-620, 52, 1240, 7);
    x.strokeStyle = 'rgba(138,79,44,.75)'; x.lineWidth = 5;
    for (let i = 0; i < 7; i++) { const sx = -380 + i * 120 + r() * 30; x.beginPath(); x.moveTo(sx, -66); x.lineTo(sx + 8, 64); x.stroke(); }
    x.restore(); chalk(x, 500, 360, 200, 120);
  } else if (kind === 'boot') {
    x.fillStyle = '#15191b'; x.beginPath(); x.arc(480, 360, 128, 0, 7); x.fill();
    x.fillStyle = '#262c30'; x.beginPath(); x.arc(480, 360, 92, 0, 7); x.fill();
    x.fillStyle = '#9aa4aa'; x.beginPath(); x.arc(480, 360, 42, 0, 7); x.fill();
    x.strokeStyle = '#e9edef'; x.lineWidth = 4; x.beginPath(); x.moveTo(420, 300); x.lineTo(450, 322); x.lineTo(436, 344); x.lineTo(470, 366); x.stroke();
    chalk(x, 480, 360, 168, 160);
  } else if (kind === 'gutter') {
    const g = x.createLinearGradient(0, 300, 0, 560); g.addColorStop(0, '#79848b'); g.addColorStop(1, '#2c3438');
    x.fillStyle = g; x.fillRect(0, 300, W, 260);
    x.fillStyle = '#1a1f22'; x.fillRect(0, 560, W, 160);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = ['#6b4f2a', '#7a6a2f', '#4c5a2a', '#5b3d22'][i % 4];
      x.beginPath(); x.ellipse(40 + r() * 880, 380 + r() * 150, 16 + r() * 14, 7 + r() * 6, r() * 3, 0, 7); x.fill();
    }
    chalk(x, 480, 440, 330, 110);
  }

  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(W - 238, H - 54, 222, 38);
  x.fillStyle = '#fff'; x.font = 'bold 20px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('SAMPLE PHOTO', W - 127, H - 28);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
}
function sampleKindFor(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('crack')) return 'crack';
  if (l.includes('missing')) return 'missing';
  if (l.includes('hail')) return 'hail';
  if (l.includes('flashing')) return 'flashing';
  if (l.includes('boot')) return 'boot';
  if (l.includes('debris') || l.includes('gutter') || l.includes('downspout')) return 'gutter';
  return 'granule';
}

/* ================= demo data ================= */
async function seedDemo() {
  const insp = newInspection({
    address: '412 Oak Hollow Ln, Grass Valley, CA', client: 'Sample Homeowner', type: 'Storm and hail',
    material: 'Asphalt shingle', age: 14, pitch: '6/12', stories: 2,
  });
  insp.sample = true; insp.created = Date.now() - 2 * 3600 * 1000;
  const A = id => insp.areas.find(a => a.id === id);
  const rate = (id, map) => A(id).items.forEach(it => { if (map[it.id]) it.rating = map[it.id]; });
  const allOk = id => A(id).items.forEach(it => { it.rating = 'ok'; });
  const find = async (id, item, severity, note, kind, seed) => {
    const pid = await addPhoto(await samplePhoto(kind, seed));
    A(id).findings.push({ id: uid(), item, severity, note, photos: [pid] });
  };

  rate('front', { granule: 'watch', crack: 'fix', curl: 'ok', missing: 'ok', hail: 'watch', wind: 'ok', nails: 'ok', moss: 'ok', soft: 'ok' });
  A('front').hail = 11;
  await find('front', 'Cracked or split shingles', 'fix', 'Three cracked tabs near the ridge, about 4 ft in from the left edge.', 'crack', 1);
  await find('front', 'Hail bruising or impacts', 'watch', 'Test square on the lower half of the slope: 11 hits, marked in chalk.', 'hail', 2);

  allOk('right'); A('right').hail = 3;

  allOk('rear'); rate('rear', { missing: 'fix' }); A('rear').hail = 9;
  await find('rear', 'Missing or lifted shingles', 'fix', 'One tab missing above the chimney. Underlayment is exposed.', 'missing', 3);

  allOk('chimney'); rate('chimney', { flash: 'fix' });
  await find('chimney', 'Flashing sealed and tight', 'fix', 'Sealant has pulled away on the uphill side.', 'flashing', 4);

  allOk('vents'); rate('vents', { boots: 'fix' });
  await find('vents', 'Pipe boots cracked or dry-rotted', 'fix', 'Rubber collar is split on the kitchen vent.', 'boot', 5);

  /* left slope and gutters are left unchecked, so the demo shows work in progress */
  return insp;
}

/* ================= state, saving, simulated sync ================= */
const state = { inspections: [], pending: 0, storage: 'device', installEvent: null };
let syncTimer = null;
const byId = id => state.inspections.find(i => i.id === id);
const findArea = (insp, id) => insp.areas.find(a => a.id === id);

function touch(insp) {
  insp.updated = Date.now();
  state.pending += 1;
  dbPut('inspections', insp).catch(() => toast('Could not save on this phone.'));
  scheduleSync();
  updatePills();
}
function scheduleSync() {
  clearTimeout(syncTimer);
  if (!navigator.onLine) return;
  syncTimer = setTimeout(() => { state.pending = 0; updatePills(); }, 1200);
}
function pillState() {
  if (!navigator.onLine) {
    return { cls: 'off', text: state.pending ? `Offline · ${plural(state.pending, 'change')} waiting` : 'Offline · saved on this phone' };
  }
  return state.pending ? { cls: 'sync', text: 'Syncing…' } : { cls: 'on', text: 'Synced' };
}
function updatePills() {
  const s = pillState();
  $$('.pill').forEach(p => { p.className = 'pill ' + s.cls; p.textContent = s.text; });
}
window.addEventListener('online', () => { updatePills(); scheduleSync(); toast('Back online. Syncing…'); });
window.addEventListener('offline', () => { updatePills(); toast('No signal. Everything is saved on this phone.'); });

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= views ================= */
const view = $('#view');
let current = { name: '', id: '' };
const go = path => { location.hash = '#' + path; };
const topbar = (title, backHref, backLabel, small = true) => `
  <header class="top">
    <a class="back" href="${backHref}" aria-label="${esc(backLabel)}">${ICON.back}</a>
    <div class="grow"><h1 class="${small ? 'title-sm ellipsis' : ''}">${esc(title)}</h1></div>
    <span class="pill"></span>
  </header>`;

function homeView() {
  const cards = state.inspections.slice().sort((a, b) => b.updated - a.updated).map(i => {
    const n = findingCount(i), done = i.areas.filter(inspected).length;
    return `<li><a class="card" href="#/i/${i.id}">
      <h2>${esc(i.address)}</h2>
      <p class="sub">${esc(i.client)} · ${fmtDate(i.created)}</p>
      <div class="meta">${badge(overall(i))}<span>${plural(n, 'finding')}</span><span>${done} of ${i.areas.length} areas</span>${i.sample ? '<span>Sample</span>' : ''}</div>
    </a></li>`;
  }).join('');
  return `
  <header class="top">
    <div class="grow"><p class="eyebrow">Roof inspector <span class="demo-tag">Demo</span></p><h1>Inspections</h1></div>
    <span class="pill"></span>
  </header>
  <div class="stack">
    <button class="btn accent block" data-action="new">${ICON.plus}New inspection</button>
    ${state.inspections.some(i => i.sample) ? '<p class="hint">Start with the sample inspection below. Tap a slope on the roof, check things off, add a photo, then build the report.</p>' : ''}
    <ul class="cards">${cards || '<li class="empty-note">No inspections yet. Start one above.</li>'}</ul>
  </div>
  <footer class="foot"><span>Demo with made-up data</span><button class="link" data-action="about">About this demo</button></footer>`;
}

function newView() {
  const types = ['Storm and hail', 'Pre-purchase', 'Maintenance', 'Insurance claim'].map(t => `<option>${t}</option>`).join('');
  const mats = Object.keys(SLOPE_ITEMS).map(t => `<option>${t}</option>`).join('');
  return `
  ${topbar('New inspection', '#/', 'Back to inspections')}
  <form class="form" data-form="new" autocomplete="off">
    <label class="field"><span>Property address</span><input type="text" name="address" required placeholder="Street and town…"></label>
    <label class="field"><span>Client name</span><input type="text" name="client" placeholder="Homeowner or company…"></label>
    <label class="field"><span>Inspection type</span><select name="type">${types}</select></label>
    <label class="field"><span>Roof material</span><select name="material">${mats}</select></label>
    <div class="two">
      <label class="field"><span>Roof age (years)</span><input type="number" name="age" inputmode="numeric" min="0" max="99" placeholder="12"></label>
      <label class="field"><span>Pitch</span><input type="text" name="pitch" placeholder="6/12"></label>
    </div>
    <label class="field"><span>Stories</span><select name="stories"><option>1</option><option selected>2</option><option>3</option></select></label>
    <button class="btn primary block" type="submit">Start inspection</button>
  </form>`;
}

function roofSVG(insp) {
  const A = Object.fromEntries(insp.areas.map(a => [a.id, a]));
  const st = id => areaRating(A[id]) || 'none';
  const desc = id => {
    const a = A[id], r = areaRating(a);
    return `${a.name}. ${r ? LABEL[r] : 'Not yet inspected'}. ${plural(a.findings.length, 'finding')}.`;
  };
  const facet = (id, points) => `<polygon class="facet ${st(id)}" points="${points}"/>`;
  const plate = (id, cx, cy, name) => {
    const a = A[id], r = areaRating(a), n = a.findings.length;
    const line2 = (r ? LABEL[r] : 'Not yet') + (n ? ` · ${n}` : '');
    return `<g class="plate ${st(id)}"><rect x="${cx - 40}" y="${cy - 18}" width="80" height="36" rx="9"/>
      <text class="pn" x="${cx}" y="${cy - 3}">${name}</text><text class="ps" x="${cx}" y="${cy + 11}">${line2}</text></g>`;
  };
  const slope = (id, points, cx, cy, name) =>
    `<g class="area" role="button" tabindex="0" data-action="area" data-area="${id}" aria-label="${esc(desc(id))}">${facet(id, points)}${plate(id, cx, cy, name)}</g>`;

  return `<svg class="roof" viewBox="0 0 340 272" role="group" aria-label="Roof plan. Tap a slope or a part to inspect it.">
    ${slope('rear', '20,30 320,30 220,135 120,135', 170, 72, 'REAR')}
    ${slope('front', '20,240 320,240 220,135 120,135', 170, 198, 'FRONT')}
    ${slope('left', '20,30 120,135 20,240', 62, 135, 'LEFT')}
    ${slope('right', '320,30 220,135 320,240', 278, 135, 'RIGHT')}
    <path class="ridge" d="M120 135H220M20 30L120 135M320 30L220 135M20 240L120 135M320 240L220 135"/>
    <g class="area" role="button" tabindex="0" data-action="area" data-area="chimney" aria-label="${esc(desc('chimney'))}">
      <rect class="hitfill" x="214" y="42" width="50" height="50"/><rect class="part ${st('chimney')}" x="226" y="52" width="26" height="30" rx="2"/>
    </g>
    <g class="area" role="button" tabindex="0" data-action="area" data-area="vents" aria-label="${esc(desc('vents'))}">
      <circle class="hitfill" cx="92" cy="214" r="20"/><circle class="hitfill" cx="248" cy="214" r="20"/>
      <circle class="part ${st('vents')}" cx="92" cy="214" r="7"/><circle class="part ${st('vents')}" cx="248" cy="214" r="7"/>
    </g>
    <g class="area" role="button" tabindex="0" data-action="area" data-area="gutters" aria-label="${esc(desc('gutters'))}">
      <rect class="gutter ${st('gutters')}" x="20" y="30" width="300" height="210" rx="2"/>
      <rect class="hit" x="20" y="30" width="300" height="210"/>
    </g>
    <text class="street" x="170" y="262">STREET SIDE</text>
  </svg>`;
}

function mapView(insp) {
  const done = insp.areas.filter(inspected).length, total = insp.areas.length;
  const parts = insp.areas.filter(a => a.kind === 'part').map(a => `
    <button class="rowbtn" data-action="area" data-area="${a.id}">
      <span class="grow"><span class="name">${esc(a.name)}</span><br><span class="sub">${plural(a.findings.length, 'finding')} · ${checkedCount(a)} of ${a.items.length} checked</span></span>
      ${badge(areaRating(a))}${ICON.chev.replace('<svg', '<svg class="chev"')}
    </button>`).join('');
  return `
  ${topbar(insp.address, '#/', 'Back to inspections')}
  <div class="stack">
    <p class="sub">${esc(insp.client)} · ${esc(insp.material)} · ${insp.age ? plural(insp.age, 'year') + ' old' : 'age unknown'} · pitch ${esc(insp.pitch || 'unknown')} · ${plural(insp.stories, 'story', 'stories')}</p>
    <section class="card plan" aria-labelledby="plan-h">
      <h2 id="plan-h" class="eyebrow" style="padding:6px 10px 0">Roof plan</h2>
      ${roofSVG(insp)}
      <div class="legend" aria-label="Key">${badge('ok')}${badge('watch')}${badge('fix')}${badge(null)}</div>
    </section>
    <section class="card">
      <h2>${done} of ${total} areas inspected</h2>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Areas inspected"><i style="transform:scaleX(${(done / total).toFixed(3)})"></i></div>
    </section>
    <p class="section-label">Parts of the roof</p>
    <section class="card" style="padding-top:2px;padding-bottom:2px">${parts}</section>
    <a class="btn primary block" href="#/i/${insp.id}/report">Build report</a>
  </div>`;
}

function areaView(insp, area) {
  const r = areaRating(area), unchecked = area.items.filter(i => !i.rating).length;
  const idx = insp.areas.indexOf(area), next = insp.areas[idx + 1];
  const checks = area.items.map(it => `
    <div class="check" role="group" aria-label="${esc(it.label)}">
      <p class="q">${esc(it.label)}</p>
      <div class="rate">
        ${['ok', 'watch', 'fix'].map(v => `<button type="button" class="${v}" data-action="rate" data-item="${it.id}" data-val="${v}" aria-pressed="${it.rating === v}">${ICON[v]}${LABEL[v]}</button>`).join('')}
      </div>
    </div>`).join('');
  const square = hasHail(insp, area) ? `
    <section class="card">
      <h2 style="display:flex;gap:10px;align-items:center"><span class="chalk" aria-hidden="true"></span>Hail test square</h2>
      <p class="sub" style="margin-top:4px">Chalk a 10 ft by 10 ft square on this slope and count the hail hits inside it.</p>
      <div class="counter" style="margin-top:12px">
        <button type="button" data-action="hail" data-delta="-1" aria-label="One fewer hit">${ICON.minus}</button>
        <p class="num" aria-live="polite">${area.hail == null ? '·' : area.hail}</p>
        <button type="button" data-action="hail" data-delta="1" aria-label="One more hit">${ICON.plus}</button>
      </div>
      <p class="square-note">${area.hail == null ? 'Not counted yet.' : plural(area.hail, 'hit') + ' in the test square. Carrier thresholds vary, so the report records the count and leaves the call to you.'}</p>
    </section>` : '';
  const findings = area.findings.map(f => `
    <button type="button" class="finding" data-action="editFinding" data-id="${f.id}">
      ${f.photos.length ? `<img class="ph" data-photo="${f.photos[0]}" alt="Photo of ${esc(f.item)}">` : `<span class="ph empty">${ICON.photo}</span>`}
      <span class="grow"><span class="t">${esc(f.item)}</span> ${badge(f.severity)}
        <span class="n" style="display:block">${esc(f.note) || 'No notes.'}</span>
        <span class="sub">${plural(f.photos.length, 'photo')}</span></span>
    </button>`).join('');
  return `
  ${topbar(area.name, `#/i/${insp.id}`, 'Back to roof plan')}
  <div class="stack">
    <div class="meta" style="margin:0">${badge(r)}<span>${checkedCount(area)} of ${area.items.length} checked</span><span>${plural(area.findings.length, 'finding')}</span></div>
    ${unchecked ? `<button type="button" class="btn ghost block" data-action="allok">${ICON.ok}Everything else is fine (${unchecked})</button>` : ''}
    <section class="card" style="padding-top:2px;padding-bottom:2px">${checks}</section>
    ${square}
    <p class="section-label">Findings</p>
    <section class="card">${findings || '<p class="empty-note">Nothing logged here yet. Add a finding when you see damage you want in the report.</p>'}</section>
    <button type="button" class="btn accent block" data-action="addFinding">${ICON.camera}Add finding</button>
    ${next ? `<a class="btn primary block" href="#/i/${insp.id}/a/${next.id}">Next: ${esc(next.name)}</a>` : `<a class="btn primary block" href="#/i/${insp.id}/report">Build report</a>`}
  </div>`;
}

function overallText(o) {
  return { ok: 'Good: no repairs needed', watch: 'Fair: keep an eye on the items below', fix: 'Repairs recommended' }[o] || 'Not enough information yet';
}
function reportView(insp) {
  const o = overall(insp);
  const recs = [];
  insp.areas.forEach(a => {
    a.findings.forEach(f => recs.push({ sev: f.severity, area: a.name, text: f.item + (f.note ? ': ' + f.note : '') }));
    a.items.forEach(it => {
      if ((it.rating === 'fix' || it.rating === 'watch') && !a.findings.some(f => f.item === it.label)) recs.push({ sev: it.rating, area: a.name, text: it.label });
    });
  });
  const list = sev => recs.filter(r => r.sev === sev).map(r => `<li><b>${esc(r.area)}.</b> ${esc(r.text)}</li>`).join('');
  const fixes = list('fix'), watches = list('watch');
  const hailCol = insp.material === 'Asphalt shingle';
  const rows = insp.areas.map(a => `<tr>
      <td>${esc(a.name)}</td><td>${badge(areaRating(a))}</td>
      <td class="num col-checked">${checkedCount(a)}/${a.items.length}</td><td class="num">${a.findings.length}</td>
      ${hailCol ? `<td class="num">${hasHail(insp, a) ? (a.hail == null ? 'n/a' : a.hail) : ''}</td>` : ''}</tr>`).join('');
  let n = 0;
  const details = insp.areas.filter(a => a.findings.length).map(a => `
    <section>
      <h2>${esc(a.name)}</h2>
      ${a.findings.map(f => `
        <div class="fblock">
        <div class="finding-head">${esc(f.item)} ${badge(f.severity)}</div>
        ${f.note ? `<p class="fine" style="margin-bottom:8px">${esc(f.note)}</p>` : ''}
        ${f.photos.map(id => { n += 1; return `<figure class="fig"><img data-photo="${id}" alt="Photo ${n}: ${esc(a.name)}, ${esc(f.item)}"><figcaption><b>Photo ${n}.</b> ${esc(a.name)}, ${esc(f.item)}.</figcaption></figure>`; }).join('')}
        </div>
      `).join('')}
    </section>`).join('');
  return `
  ${topbar('Report', `#/i/${insp.id}`, 'Back to roof plan')}
  <div class="toolbar"><button type="button" class="btn primary" data-action="print">Print or save as PDF</button></div>
  <article class="report">
    <div class="brand"><div class="logo">Your logo</div><div><h1>Roof inspection report</h1><p class="fine"><span class="placeholder">Your company name</span></p></div></div>
    <section><h2>Property</h2>
      <dl>
        <dt>Address</dt><dd>${esc(insp.address)}</dd>
        <dt>Client</dt><dd>${esc(insp.client)}</dd>
        <dt>Inspection</dt><dd>${esc(insp.type)}, ${fmtDateTime(insp.created)}</dd>
        <dt>Roof</dt><dd>${esc(insp.material)}, ${insp.age ? plural(insp.age, 'year') + ' old' : 'age unknown'}, pitch ${esc(insp.pitch || 'unknown')}, ${plural(insp.stories, 'story', 'stories')}</dd>
        <dt>Inspector</dt><dd>${esc(insp.inspector)}</dd>
      </dl></section>
    <section><h2>Overall condition</h2>
      <div class="overall">${badge(o)}<strong>${overallText(o)}</strong></div></section>
    <section><h2>Summary by area</h2>
      <div class="tscroll"><table><thead><tr><th>Area</th><th>Rating</th><th class="num col-checked">Checked</th><th class="num">Findings</th>${hailCol ? '<th class="num">Hail hits</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
      ${hailCol ? '<p class="fine" style="margin-top:6px">Hail hits are counted in a 10 ft by 10 ft test square on each slope.</p>' : ''}</section>
    <section><h2>Recommended actions</h2>
      ${fixes ? `<p class="fine"><b>Repair or replace</b></p><ol class="recs">${fixes}</ol>` : ''}
      ${watches ? `<p class="fine" style="margin-top:10px"><b>Monitor at the next inspection</b></p><ol class="recs">${watches}</ol>` : ''}
      ${!fixes && !watches ? '<p class="fine">No actions recommended yet.</p>' : ''}</section>
    ${details}
    <section class="limits"><h2>Limits of this inspection</h2>
      <p class="fine"><span class="placeholder">Replace with your own terms.</span> This report describes what was visible on the day of the inspection. It does not predict how long the roof will last and it does not make insurance coverage decisions.</p>
      <div class="sign"><div>Inspector signature</div><div>Date</div></div></section>
  </article>`;
}

/* ================= routing ================= */
function render(keepScroll) {
  const y = window.scrollY;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let html = '', name = 'home', id = '', title = 'Inspections';
  if (!parts.length) { html = homeView(); }
  else if (parts[0] === 'new') { name = 'new'; title = 'New inspection'; html = newView(); }
  else if (parts[0] === 'i') {
    const insp = byId(parts[1]);
    if (!insp) return go('/');
    id = insp.id;
    const area = parts[2] === 'a' ? findArea(insp, parts[3]) : null;
    if (area) { name = 'area:' + area.id; title = area.name; html = areaView(insp, area); }
    else if (parts[2] === 'report') { name = 'report'; title = 'Report'; html = reportView(insp); }
    else { name = 'map'; title = insp.address; html = mapView(insp); }
  } else { return go('/'); }
  const same = current.name === name && current.id === id;
  current = { name, id };
  document.title = `${title} · Roof Inspector Demo`;
  view.innerHTML = html;
  hydrate(view);
  updatePills();
  if (same && keepScroll) { window.scrollTo(0, y); }
  else {
    window.scrollTo(0, 0);
    const h = $('h1', view);
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
}
window.addEventListener('hashchange', () => render(false));

const curInsp = () => byId(current.id);
const curArea = () => { const i = curInsp(); return i && current.name.startsWith('area:') ? findArea(i, current.name.slice(5)) : null; };

/* ================= bottom sheet ================= */
const sheet = $('#sheet'), panel = $('#sheet-panel');
let sheetFocus = null;
function openSheet(html) {
  sheetFocus = document.activeElement;
  panel.innerHTML = html;
  sheet.hidden = false;
  $('.app').inert = true; // the page behind a dialog cannot take focus or be read out
  document.body.style.overflow = 'hidden';
  hydrate(panel);
  const first = $('select, input:not([type=hidden]), textarea, button', panel);
  if (first) first.focus({ preventScroll: true });
}
function closeSheet() {
  sheet.hidden = true; panel.innerHTML = '';
  $('.app').inert = false;
  document.body.style.overflow = '';
  if (sheetFocus && sheetFocus.isConnected) sheetFocus.focus({ preventScroll: true });
}

/* ---- findings ---- */
let draft = null;
function openFinding(insp, area, id) {
  const existing = id ? area.findings.find(f => f.id === id) : null;
  draft = {
    insp, area, isNew: !existing, added: [], removed: [],
    f: existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), item: area.items[0].label, severity: 'fix', note: '', photos: [] },
  };
  const { f, isNew } = draft;
  const opts = area.items.map(i => i.label).concat('Other').map(l => `<option ${l === f.item ? 'selected' : ''}>${esc(l)}</option>`).join('');
  openSheet(`
    <h2 id="sheet-title">${isNew ? 'Add a finding' : 'Edit finding'}</h2>
    <form class="form" data-form="finding" autocomplete="off">
      <label class="field"><span>What did you find</span><select name="item">${opts}</select></label>
      <fieldset><legend>How serious</legend><div class="choice">
        <label><input type="radio" name="severity" value="watch" ${f.severity === 'watch' ? 'checked' : ''}><span class="watch">${ICON.watch}Watch</span></label>
        <label><input type="radio" name="severity" value="fix" ${f.severity === 'fix' ? 'checked' : ''}><span class="fix">${ICON.fix}Fix</span></label>
      </div></fieldset>
      <label class="field"><span>Notes</span><textarea name="note" placeholder="Where on the slope, how big, what caused it…">${esc(f.note)}</textarea></label>
      <div class="field"><span>Photos</span><div class="thumbs" id="thumbs"></div></div>
      <div class="two">
        <button type="button" class="btn accent" data-action="shoot">${ICON.camera}Take photo</button>
        <button type="button" class="btn ghost" data-action="samplePhoto">Sample photo</button>
      </div>
      <div class="sheet-actions">
        ${isNew ? '' : '<button type="button" class="btn ghost danger full" data-action="deleteFinding">Delete finding</button>'}
        <button type="button" class="btn ghost" data-action="cancelFinding">Cancel</button>
        <button type="submit" class="btn primary">Save finding</button>
      </div>
    </form>`);
  refreshThumbs();
}
function refreshThumbs() {
  const t = $('#thumbs');
  if (!t || !draft) return;
  t.innerHTML = draft.f.photos.map(id => `<button type="button" data-action="markup" data-photo="${id}" aria-label="Mark up this photo"><img data-photo="${id}" alt="Inspection photo"><span class="mark">Mark up</span></button>`).join('')
    || '<p class="empty-note">No photos yet.</p>';
  hydrate(t);
}
function saveFinding(form) {
  const fd = new FormData(form), f = draft.f;
  f.item = String(fd.get('item')); f.severity = fd.get('severity') || 'fix'; f.note = String(fd.get('note') || '').trim();
  const { insp, area } = draft;
  if (draft.isNew) area.findings.push(f);
  else area.findings[area.findings.findIndex(x => x.id === f.id)] = f;
  const it = area.items.find(x => x.label === f.item);
  if (it) it.rating = worst([it.rating, f.severity]);
  draft.removed.forEach(removePhoto);
  touch(insp); closeSheet(); draft = null; render(true); toast('Finding saved');
}
function cancelFinding() {
  if (draft) draft.added.forEach(removePhoto);
  draft = null; closeSheet();
}
function deleteFinding() {
  if (!draft || draft.isNew || !confirm('Delete this finding and its photos?')) return;
  draft.f.photos.forEach(removePhoto);
  draft.area.findings = draft.area.findings.filter(x => x.id !== draft.f.id);
  touch(draft.insp); closeSheet(); draft = null; render(true); toast('Finding deleted');
}

$('#file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !draft) return;
  toast('Saving photo…');
  try {
    const id = await addPhoto(await processFile(file));
    draft.f.photos.push(id); draft.added.push(id);
    refreshThumbs();
    await openAnnotate(id, true);
  } catch (err) { toast('Could not read that photo.'); }
});
let sampleSeed = 20;
async function addSamplePhoto() {
  if (!draft) return;
  const label = $('[name=item]', panel).value;
  const id = await addPhoto(await samplePhoto(sampleKindFor(label), ++sampleSeed));
  draft.f.photos.push(id); draft.added.push(id);
  refreshThumbs();
  await openAnnotate(id, true);
}

/* ---- photo markup ---- */
const annot = $('#annot'), ac = $('#annot-canvas'), actx = ac.getContext('2d');
let A = null;
async function openAnnotate(id, isNew) {
  const rec = await dbGet('photos', id);
  if (!rec) return;
  const bmp = await createImageBitmap(rec.blob);
  A = { id, bmp, strokes: [], cur: null, isNew };
  ac.width = bmp.width; ac.height = bmp.height;
  $('#annot-title').textContent = isNew ? 'Circle the damage' : 'Mark up photo';
  annot.hidden = false;
  clearTimeout(toastTimer); $('#toast').classList.remove('show'); // an old message must not cover the markup screen
  sheet.inert = true; // the finding sheet stays open underneath but cannot take focus
  drawAnnot();
  $('[data-annot=save]', annot).focus({ preventScroll: true });
}
function drawAnnot() {
  actx.drawImage(A.bmp, 0, 0);
  const lw = Math.max(6, ac.width / 140);
  actx.lineCap = 'round'; actx.lineJoin = 'round';
  [['rgba(255,255,255,.95)', lw + 5], ['#FF3B30', lw]].forEach(([color, w]) => {
    actx.strokeStyle = color; actx.fillStyle = color; actx.lineWidth = w;
    A.strokes.forEach(s => {
      if (s.length === 1) { actx.beginPath(); actx.arc(s[0][0], s[0][1], w / 2, 0, 7); actx.fill(); return; }
      actx.beginPath(); actx.moveTo(s[0][0], s[0][1]);
      s.slice(1).forEach(p => actx.lineTo(p[0], p[1]));
      actx.stroke();
    });
  });
}
const pt = e => { const b = ac.getBoundingClientRect(); return [(e.clientX - b.left) * ac.width / b.width, (e.clientY - b.top) * ac.height / b.height]; };
ac.addEventListener('pointerdown', e => {
  if (!A) return;
  try { ac.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  A.cur = [pt(e)]; A.strokes.push(A.cur); drawAnnot();
});
ac.addEventListener('pointermove', e => { if (!A || !A.cur) return; A.cur.push(pt(e)); drawAnnot(); });
['pointerup', 'pointercancel'].forEach(t => ac.addEventListener(t, () => { if (A) A.cur = null; }));
function closeAnnotate() { A = null; annot.hidden = true; sheet.inert = false; refreshThumbs(); }
annot.addEventListener('click', async e => {
  const b = e.target.closest('[data-annot]');
  if (!b || !A) return;
  const act = b.dataset.annot;
  if (act === 'undo') { A.strokes.pop(); drawAnnot(); }
  else if (act === 'clear') { A.strokes.length = 0; drawAnnot(); }
  else if (act === 'skip') { closeAnnotate(); }
  else if (act === 'save') {
    if (A.strokes.length) {
      const blob = await new Promise(res => ac.toBlob(res, 'image/jpeg', 0.88));
      await replacePhoto(A.id, blob);
    }
    closeAnnotate();
  } else if (act === 'remove') {
    if (!confirm('Remove this photo?')) return;
    const id = A.id;
    draft.f.photos = draft.f.photos.filter(p => p !== id);
    if (draft.added.includes(id)) { draft.added = draft.added.filter(p => p !== id); await removePhoto(id); } else draft.removed.push(id);
    closeAnnotate();
  }
});

/* ---- about ---- */
function openAbout() {
  const iosHint = /iphone|ipad/i.test(navigator.userAgent);
  openSheet(`
    <h2 id="sheet-title">About this demo</h2>
    <p class="sub" style="margin-bottom:10px">Made-up data, built to show how an inspection app could work on a roof.</p>
    <p class="section-label" style="margin:0 0 6px">What is real</p>
    <ul class="plain"><li>The checklist, photos, markup and report all work.</li><li>Everything saves on this phone, and the app opens with no signal after the first load.</li></ul>
    <p class="section-label" style="margin:0 0 6px">What is pretend</p>
    <ul class="plain"><li>Syncing. There is no server yet, so the Synced badge is a simulation.</li><li>The sample homeowner, address and photos.</li></ul>
    <p class="section-label" style="margin:0 0 6px">Put it on your home screen</p>
    <p class="sub" style="margin-bottom:12px">${iosHint ? 'In Safari, tap Share, then Add to Home Screen.' : 'In Chrome, open the menu and tap Install app or Add to Home screen.'}</p>
    <div class="sheet-actions">
      ${state.installEvent ? '<button type="button" class="btn accent full" data-action="install">Install app</button>' : ''}
      <button type="button" class="btn ghost" data-action="reset">Reset demo data</button>
      <button type="button" class="btn primary" data-action="closeSheet">Done</button>
    </div>`);
}
async function resetDemo() {
  if (!confirm('Erase everything on this phone and start the demo over?')) return;
  await Promise.all([dbClear('inspections'), dbClear('photos'), dbClear('meta')]);
  urls.forEach((u, id) => dropURL(id));
  state.inspections = [await seedDemo()];
  await dbPut('inspections', state.inspections[0]);
  await dbPut('meta', true, 'seeded');
  state.pending = 0; closeSheet(); go('/'); render(false); toast('Demo data reset');
}

/* ================= events ================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action, insp = curInsp(), area = curArea();
  switch (act) {
    case 'new': go('/new'); break;
    case 'about': openAbout(); break;
    case 'closeSheet': draft ? cancelFinding() : closeSheet(); break;
    case 'area': if (insp) go(`/i/${insp.id}/a/${el.dataset.area}`); break;
    case 'rate': {
      const it = area.items.find(i => i.id === el.dataset.item), v = el.dataset.val;
      it.rating = it.rating === v ? null : v;
      touch(insp); render(true);
      const again = $(`[data-action=rate][data-item="${it.id}"][data-val="${v}"]`); if (again) again.focus({ preventScroll: true });
      break;
    }
    case 'allok': area.items.forEach(i => { if (!i.rating) i.rating = 'ok'; }); touch(insp); render(true); toast('Marked the rest as good'); break;
    case 'hail': {
      area.hail = Math.max(0, (area.hail || 0) + Number(el.dataset.delta));
      touch(insp); render(true);
      const again = $(`[data-action=hail][data-delta="${el.dataset.delta}"]`); if (again) again.focus({ preventScroll: true });
      break;
    }
    case 'addFinding': openFinding(insp, area); break;
    case 'editFinding': openFinding(insp, area, el.dataset.id); break;
    case 'shoot': $('#file').click(); break;
    case 'samplePhoto': addSamplePhoto(); break;
    case 'markup': openAnnotate(el.dataset.photo, false); break;
    case 'cancelFinding': cancelFinding(); break;
    case 'deleteFinding': deleteFinding(); break;
    case 'print': window.print(); break;
    case 'reset': resetDemo(); break;
    case 'install': if (state.installEvent) { state.installEvent.prompt(); state.installEvent = null; closeSheet(); } break;
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'finding') return saveFinding(form);
  if (form.dataset.form === 'new') {
    const fd = new FormData(form);
    const insp = newInspection({
      address: String(fd.get('address') || '').trim() || 'Untitled address', client: String(fd.get('client') || '').trim(),
      type: fd.get('type'), material: fd.get('material'), age: fd.get('age'), pitch: String(fd.get('pitch') || '').trim(), stories: fd.get('stories'),
    });
    state.inspections.unshift(insp); touch(insp); go('/i/' + insp.id);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!annot.hidden) { closeAnnotate(); } else if (!sheet.hidden) { draft ? cancelFinding() : closeSheet(); }
    return;
  }
  const t = e.target.closest && e.target.closest('[role=button][data-action]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvent = e; });

/* ================= start ================= */
async function init() {
  view.innerHTML = '<p class="empty-note" style="padding-top:40px">Loading…</p>';
  db = await openDB();
  if (!db) { state.storage = 'memory'; }
  let list = await dbAll('inspections');
  if (!list.length && !(await dbGet('meta', 'seeded'))) {
    const demo = await seedDemo();
    await dbPut('inspections', demo); await dbPut('meta', true, 'seeded');
    list = [demo];
  }
  state.inspections = list;
  render(false);
  if (state.storage === 'memory') toast('This browser blocks saving. Changes will be lost on reload.');
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
})();
