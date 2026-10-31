import { h, icon, addDays, parseISO, toISO, fmtDate, fmt, empty } from './ui.js';
import { disposeAll } from './charts.js';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'products', label: 'Products & variants', icon: 'products', group: 'Sales' },
  { id: 'variants', label: 'Variant lab', icon: 'variants', group: 'Sales', brands: ['AHA'] },
  { id: 'cancellations', label: 'Cancellations', icon: 'cancel', group: 'Sales' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', group: 'Marketing' },
  { id: 'channels', label: 'Channels', icon: 'channels', group: 'Marketing' },
  { id: 'funnel', label: 'Funnel', icon: 'funnel', group: 'Marketing' },
  { id: 'checkouts', label: 'Abandoned checkouts', icon: 'cart', group: 'Marketing' },
  { id: 'segments', label: 'Segments', icon: 'segments', group: 'Customers' },
  { id: 'cohorts', label: 'Cohorts', icon: 'cohorts', group: 'Customers' },
  { id: 'behaviour', label: 'Behaviour', icon: 'behaviour', group: 'Customers' },
  { id: 'health', label: 'Data health', icon: 'health', group: 'System' },
];
const BRANDS = { AHA: 'Aha Nightwears', TIRLS: 'Tirls' };
const PRESETS = [
  ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['180d', 'Last 6 months'],
  ['mtd', 'This month'], ['lastmonth', 'Last month'], ['all', 'All time'],
];

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { page: 'overview', brand: 'AHA', preset: 'all', start: null, end: null, compare: true, basis: 'net', ...store.get('cr.state', {}) };
let ctx = null, seq = 0, afterQueue = [];
const pageEl = document.getElementById('page');
const modules = {};

// ── sign-in (only when the server has it: the PHP site on the web host) ──
function backToSignIn() {
  try {
    if (Date.now() - Number(sessionStorage.getItem('cr.signin') || 0) < 10000) return false;
    sessionStorage.setItem('cr.signin', String(Date.now()));
  } catch { /* storage blocked: reload anyway */ }
  location.reload();
  return true;
}

// ── API ──
export async function api(path, extra = {}) {
  const r = range();
  const p = new URLSearchParams({ brand: state.brand, start: r.start, end: r.end, ...extra });
  const res = await fetch(`/api${path}?${p}`);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body.login && backToSignIn()) throw new Error('Signed out');
  if (!res.ok) throw new Error(body.error || body.detail || `Request failed (${res.status})`);
  return body;
}

// ── date range ──
function presetRange(id, first, last) {
  let s = first, e = last;
  const L = parseISO(last);
  if (id === '7d') s = addDays(last, -6);
  else if (id === '30d') s = addDays(last, -29);
  else if (id === '90d') s = addDays(last, -89);
  else if (id === '180d') s = addDays(last, -179);
  else if (id === 'mtd') s = toISO(new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), 1)));
  else if (id === 'lastmonth') { s = toISO(new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth() - 1, 1))); e = toISO(new Date(Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), 0))); }
  return { start: s < first ? first : s, end: e > last ? last : e };
}
export function range() {
  const b = ctx.brands[state.brand];
  if (state.preset === 'custom' && state.start && state.end) {
    return { start: state.start < b.first ? b.first : state.start, end: state.end > b.last ? b.last : state.end };
  }
  return presetRange(state.preset, b.first, b.last);
}
export const scopeInfo = () => {
  const r = range(), days = (parseISO(r.end) - parseISO(r.start)) / 864e5 + 1;
  return { ...r, days, prevEnd: addDays(r.start, -1), prevStart: addDays(r.start, -days), first: ctx.brands[state.brand].first, last: ctx.brands[state.brand].last };
};
const rangeLabel = () => {
  if (state.preset !== 'custom') return PRESETS.find(p => p[0] === state.preset)?.[1] || 'All time';
  const r = range(); return `${fmtDate(r.start, false)} – ${fmtDate(r.end)}`;
};

// ── persistence & hash ──
function save() { store.set('cr.state', { page: state.page, brand: state.brand, preset: state.preset, start: state.start, end: state.end, compare: state.compare, basis: state.basis }); }
function toHash() { return `#/${state.page}`; }
function fromHash() {
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
  if (id && PAGES.some(p => p.id === id && (!p.brands || p.brands.includes(state.brand)))) state.page = id;
}

// ── chrome ──
function renderTags() {
  const box = document.getElementById('tags');
  box.replaceChildren(...Object.entries(BRANDS).map(([b, name]) => h('button', {
    class: 'tag', 'data-brand': b, type: 'button', role: 'radio', 'aria-checked': String(state.brand === b), title: name,
    onclick: () => { if (state.brand !== b) setBrand(b); },
  }, h('span', { class: 'tg-av', text: b[0] }), h('span', { class: 'tg-txt' }, h('span', { class: 'tg-name', text: b }), h('span', { class: 'tg-sub', text: name })))));
  document.documentElement.dataset.brand = state.brand;
}
function renderNav() {
  const nav = document.getElementById('nav'); let last = null;
  nav.replaceChildren(...PAGES.filter(p => !p.brands || p.brands.includes(state.brand)).flatMap(p => {
    const out = [];
    if (p.group && p.group !== last) out.push(h('div', { class: 'nav-group', text: p.group }));
    last = p.group || last;
    out.push(h('a', { class: 'nav-item', href: `#/${p.id}`, 'aria-current': state.page === p.id ? 'page' : null, title: p.label,
      onclick: e => { e.preventDefault(); go(p.id); document.getElementById('shell').classList.remove('open'); document.getElementById('scrim').hidden = true; } },
      icon(p.icon), h('span', { text: p.label }), p.brands && h('span', { class: 'nav-tag', text: p.brands.join(' ') })));
    return out;
  }));
}
function renderFilters(page) {
  const box = document.getElementById('filters'), r = range(), info = scopeInfo();
  const dateBtn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: e => togglePicker(e.currentTarget) },
    icon('calendar', 16), h('span', { text: rangeLabel() }), h('span', { class: 'muted', text: '▾' }));
  box.replaceChildren(...[dateBtn,
    page.compare !== false && h('label', { class: 'toggle', title: `Compare with ${fmtDate(info.prevStart, false)} – ${fmtDate(info.prevEnd)}` },
      h('input', { type: 'checkbox', checked: state.compare ? true : null, onchange: e => { state.compare = e.target.checked; save(); render(); } }), 'Compare to previous period'),
    page.basis && h('div', { class: 'seg', role: 'group', 'aria-label': 'Revenue basis' },
      ['net', 'gross'].map(b => h('button', { type: 'button', 'aria-pressed': String(state.basis === b), onclick: () => { state.basis = b; save(); render(); } },
        b === 'net' ? 'Net of cancellations' : 'Gross'))),
    h('span', { class: 'spacer' }),
    h('span', { class: 'range-note num', text: `${fmt.int(info.days)} days · ${fmtDate(r.start, false)} – ${fmtDate(r.end)}` })].filter(Boolean));
}
function togglePicker(btn) {
  const open = document.querySelector('.pop');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const b = ctx.brands[state.brand], r = range();
  const pop = h('div', { class: 'pop', role: 'menu' },
    PRESETS.map(([id, label]) => {
      const pr = presetRange(id, b.first, b.last);
      return h('button', { class: 'pop-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(state.preset === id), onclick: () => { state.preset = id; save(); close(); render(); } },
        h('span', { class: 'check' }, icon('check', 16)), label, h('span', { class: 'hint num', text: id === 'all' ? '' : `${fmtDate(pr.start, false)} – ${fmtDate(pr.end, false)}` }));
    }),
    (() => {
      const s = h('input', { type: 'date', value: r.start, min: b.first, max: b.last }), e = h('input', { type: 'date', value: r.end, min: b.first, max: b.last });
      return h('div', { class: 'pop-foot' }, h('div', { class: 'row' }, h('label', null, 'From', s), h('label', null, 'To', e)),
        h('button', { class: 'apply', type: 'button', onclick: () => { if (s.value && e.value && s.value <= e.value) { state.preset = 'custom'; state.start = s.value; state.end = e.value; save(); close(); render(); } } }, 'Apply range'));
    })());
  function close() { pop.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', away, true); }
  function away(ev) { if (!pop.contains(ev.target) && !btn.contains(ev.target)) close(); }
  btn.after(pop); pop.style.position = 'absolute'; btn.setAttribute('aria-expanded', 'true');
  btn.parentElement.style.position = 'relative'; pop.style.left = `${btn.offsetLeft}px`; pop.style.top = `${btn.offsetTop + btn.offsetHeight}px`;   // without a top it is centred on the flex row and spills above the page
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); btn.focus(); } });
}

// ── navigation & rendering ──
function setBrand(b) {
  state.brand = b;
  const cur = PAGES.find(p => p.id === state.page);
  if (cur?.brands && !cur.brands.includes(b)) { state.page = 'products'; history.replaceState(null, '', toHash()); }   // brand-specific page is not available for this brand
  save(); renderTags(); renderNav(); render();
}
export function go(id) { state.page = id; save(); history.replaceState(null, '', toHash()); renderNav(); render(); }

async function loadPage(id) {
  if (!modules[id]) {
    try { modules[id] = (await import(`./pages/${id}.js`)).default; }
    catch (e) {
      console.error(e);
      modules[id] = { title: PAGES.find(p => p.id === id).label, render: async () => h('div', null, h('div', { class: 'page-head' }, h('h1', { text: PAGES.find(p => p.id === id).label })), empty('This page is not available yet', 'Reload to try again.')) };
    }
  }
  return modules[id];
}
export async function render() {
  const token = ++seq, page = await loadPage(state.page);
  renderFilters(page);
  pageEl.classList.add('loading');
  afterQueue = [];
  try {
    const node = await page.render({ state, ctx, api, scope: scopeInfo(), after: fn => afterQueue.push(fn), rerender: render, brandName: BRANDS[state.brand] });
    if (token !== seq) return;
    disposeAll();
    pageEl.replaceChildren(node);
    try { await document.fonts.ready; } catch (e) { /* older browsers */ }   // charts measure text, so wait for the web fonts
    if (token !== seq) return;
    afterQueue.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    document.title = `${page.title} · ${state.brand} · Digifyce Analytics`;
  } catch (e) {
    if (token !== seq) return;
    console.error(e);
    disposeAll();
    pageEl.replaceChildren(h('div', { class: 'page-head' }, h('h1', { text: page.title })), h('div', { class: 'notice' }, icon('info'), h('div', null, h('b', { text: 'This page could not load. ' }), String(e.message || e))));
  } finally {
    if (token === seq) pageEl.classList.remove('loading');
  }
}

// ── boot ──
(async function boot() {
  const shell = document.getElementById('shell');
  const theme = store.get('cr.theme', null);
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  if (store.get('cr.collapsed', false)) shell.classList.add('collapsed');
  document.getElementById('railCollapse').onclick = () => { shell.classList.toggle('collapsed'); store.set('cr.collapsed', shell.classList.contains('collapsed')); setTimeout(() => window.dispatchEvent(new Event('resize')), 260); };
  document.getElementById('themeBtn').onclick = () => {
    const now = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';   // light is the default; the OS setting is not followed
    const next = now === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('cr.theme', next); render();
  };
  document.getElementById('menuBtn').onclick = () => { shell.classList.add('open'); document.getElementById('scrim').hidden = false; };
  document.getElementById('scrim').onclick = () => { shell.classList.remove('open'); document.getElementById('scrim').hidden = true; };
  window.addEventListener('hashchange', () => { fromHash(); renderNav(); render(); });

  try { ctx = await (await fetch('/api/context')).json(); } catch (e) { ctx = null; }
  if (ctx && ctx.login && backToSignIn()) return;
  fetch('/api/auth/status').then(r => (r.ok ? r.json() : null)).then(a => {
    if (!a || !a.enabled || !a.signed_in) return;
    document.getElementById('whoName').textContent = a.user || '';
    document.getElementById('signOut').title = `Signed in as ${a.user || ''}`;
    document.getElementById('who').hidden = false;
    document.getElementById('signOut').onclick = () => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).finally(() => location.reload());
  }).catch(() => {});
  if (!ctx || !ctx.brands || !ctx.brands.AHA) {
    pageEl.replaceChildren(empty('The data service is not reachable', 'Check that the database container is running, then reload this page.'));
    return;
  }
  if (!ctx.brands[state.brand]) state.brand = 'AHA';
  fromHash();
  document.getElementById('asof').replaceChildren(h('b', { text: fmtDate(ctx.snapshot) }), 'Data as of');
  renderTags(); renderNav(); render();
})();
