// Shared building blocks: DOM helper, formatters, cards, tables, legend, deltas, icons, tooltip.

export const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── formatting (Indian digit grouping, lakh / crore for money) ──
const IN = new Intl.NumberFormat('en-IN');
const IN1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export const fmt = {
  int: n => (n == null || isNaN(n)) ? '–' : IN.format(Math.round(n)),
  dec: (n, d = 1) => (n == null || isNaN(n)) ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n),
  inr: n => (n == null || isNaN(n)) ? '–' : '₹' + IN.format(Math.round(n)),
  inrc(n) {
    if (n == null || isNaN(n)) return '–';
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
    return `${s}₹${Math.round(a)}`;
  },
  compact(n) {
    if (n == null || isNaN(n)) return '–';
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(1) + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(1) + ' L';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return IN1.format(n);
  },
  pct: (n, d = 1) => (n == null || isNaN(n)) ? '–' : `${n.toFixed(d)}%`,
  x: n => (n == null || isNaN(n)) ? '–' : `${n.toFixed(2)}×`,
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const parseISO = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const toISO = d => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
export const fmtDate = (s, withYear = true) => { if (!s) return '–'; const d = parseISO(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`; };
export const fmtMonth = s => { const d = parseISO(s); return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
export const fmtBucket = (s, gran) => gran === 'month' ? fmtMonth(s) : gran === 'week' ? `${fmtDate(s, false)}` : fmtDate(s, false);

// ── icons (static strings only) ──
const P = {
  overview: '<path d="M3 11l7-6 7 6v6H12v-4H8v4H3z"/>',
  products: '<path d="M4 6l6-3 6 3v8l-6 3-6-3z"/><path d="M4 6l6 3 6-3M10 9v8"/>',
  cancel: '<circle cx="10" cy="10" r="7"/><path d="M6.5 6.5l7 7"/>',
  campaigns: '<path d="M3 11V8l11-4v11L3 11z"/><path d="M6 12l1 4h2l-1-4"/>',
  channels: '<circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 9l6-3M7 11l6 3"/>',
  funnel: '<path d="M3 4h14l-5 6v6l-4-2v-4z"/>',
  cart: '<path d="M3 4h2l2 8h8l2-6H6"/><circle cx="8" cy="16" r="1.2"/><circle cx="14" cy="16" r="1.2"/>',
  segments: '<circle cx="7" cy="7" r="3"/><circle cx="13.5" cy="8.5" r="2.5"/><path d="M2 16c0-3 2.5-5 5-5s5 2 5 5M12 12.2c2.6-.5 5.5 1 5.5 3.8"/>',
  cohorts: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9" y="3" width="4" height="5" rx="1"/><rect x="3" y="9" width="5" height="4" rx="1"/><rect x="9" y="9" width="4" height="4" rx="1"/><rect x="3" y="14" width="5" height="3" rx="1"/>',
  behaviour: '<path d="M2 12l4-4 3 3 5-6 4 4"/><path d="M2 17h16"/>',
  health: '<path d="M10 17s-6-3.8-6-9a3.5 3.5 0 0 1 6-2.3A3.5 3.5 0 0 1 16 8c0 5.2-6 9-6 9z"/>',
  calendar: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.5v.01"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  variants: '<path d="M10 3l7 3.5-7 3.5-7-3.5z"/><path d="M3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5"/>',
};
export const icon = (name, size = 18) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
};

// ── colour: categorical slots follow the entity, never its rank ──
const registry = {};
export function slot(ns, name) {
  const r = (registry[ns] ||= { next: 1, map: {} });
  if (!(name in r.map)) r.map[name] = r.next <= 8 ? r.next++ : 8;
  return r.map[name];
}
export const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const slotColor = i => cssVar(`--s${Math.min(Math.max(i, 1), 8)}`);
export const FIXED = { // entities whose colour must never change between charts
  channel: { 'Meta paid': 1, 'Google paid': 2, 'Social organic': 3, 'Google organic': 4, 'Meta untagged': 5, 'WhatsApp': 6, 'Direct / unknown': 7 },
  pay: { PREPAID: 1, COD: 2 },
};
export function entityColor(ns, name) {
  const fixed = FIXED[ns]?.[name];
  return slotColor(fixed || slot(ns, name));
}
// Fabric swatches for garment colour families (identity of the colour itself, not a chart encoding)
export const FAMILY_HEX = { Green: '#3f8f5b', Blue: '#3a6fb8', Navy: '#1f2f5c', 'Sky Blue': '#82bde8', Teal: '#1f9aa3', Pink: '#e98aa8', Red: '#c8323c',
  Orange: '#e8793a', Yellow: '#e8b63a', Gold: '#c9a24a', Purple: '#7a5bb5', Brown: '#7a5238', Maroon: '#7a1f36', Black: '#1b1b1f', White: '#f5f5f2',
  Grey: '#8a8f99', Beige: '#d8c3a0', Peach: '#f3b99a', Multicolour: 'conic-gradient(#e34948,#eda100,#1baf7a,#2a78d6,#6250d6,#e34948)', Unknown: 'repeating-linear-gradient(45deg,#c3c8d4 0 3px,#e6e9f0 3px 6px)' };
export const swatch = fam => h('span', { class: 'sw', style: { background: FAMILY_HEX[fam] || FAMILY_HEX.Unknown }, title: fam });

// ── deltas ──
export function delta(cur, prev, { goodUp = true, kind = 'pct' } = {}) {
  if (prev == null || cur == null) return null;
  if (kind === 'pp') { // percentage-point change of a rate
    const d = cur - prev, cls = Math.abs(d) < 0.05 ? 'flat' : ((d > 0) === goodUp ? (d > 0 ? 'up-good' : 'down-good') : (d > 0 ? 'up-bad' : 'down-bad'));
    return h('span', { class: `delta ${cls}`, title: 'Change vs previous period (percentage points)' }, (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + `${Math.abs(d).toFixed(1)} pp`);
  }
  if (!prev) return h('span', { class: 'delta flat' }, 'new');
  const d = (cur - prev) / Math.abs(prev) * 100;
  const cls = Math.abs(d) < 0.05 ? 'flat' : ((d > 0) === goodUp ? (d > 0 ? 'up-good' : 'down-good') : (d > 0 ? 'up-bad' : 'down-bad'));
  return h('span', { class: `delta ${cls}`, title: 'Change vs previous period' }, (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + `${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%`);
}

export function kpi(label, value, { d, sub, hero } = {}) {
  return h('div', { class: hero ? 'hero' : 'kpi' },
    h('div', { class: 'k-l', text: label }),
    h('div', { class: 'k-v', text: value }),
    (d || sub) && h('div', { class: 'k-d' }, d, sub && h('span', { text: sub })));
}

// ── legend (always present for 2+ series) ──
export function legend(items) {
  return h('div', { class: 'legend', role: 'list' }, items.map(it =>
    h('span', { class: 'lg', role: 'listitem' }, h('i', { class: it.box ? 'box' : '', style: { background: it.color } }), it.name)));
}

// ── table ──
export function csv(columns, rows) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(c => q(c.label)).join(','), ...rows.map(r => columns.map(c => q(c.csv ? c.csv(r) : (c.raw ? c.raw(r) : r[c.key]))).join(','))].join('\n');
}
export function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

export function table({ columns, rows, sortKey, sortDir = -1, limit, search, filename = 'export.csv', empty = 'Nothing in this period.' }) {
  const wrap = h('div'), state = { key: sortKey, dir: sortDir, q: '' };
  const searchBox = search && h('input', { class: 'tbl-search', type: 'search', placeholder: search, 'aria-label': search,
    oninput: e => { state.q = e.target.value.toLowerCase(); paint(); } });
  const body = h('div', { class: 'tbl-wrap' });
  const val = (c, r) => c.sortVal ? c.sortVal(r) : (c.raw ? c.raw(r) : r[c.key]);
  function paint() {
    let list = rows.slice();
    if (state.q) list = list.filter(r => columns.some(c => c.searchable && String(val(c, r) ?? '').toLowerCase().includes(state.q)));
    const sc = columns.find(c => c.key === state.key);
    if (sc) list.sort((a, b) => { const x = val(sc, a), y = val(sc, b); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
    const shown = limit ? list.slice(0, limit) : list;
    const maxes = {}; columns.filter(c => c.bar).forEach(c => maxes[c.key] = Math.max(...rows.map(r => Math.abs(val(c, r) || 0)), 1));
    body.replaceChildren(shown.length ? h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, columns.map(c => h('th', {
        class: (c.align === 'r' ? 'r ' : '') + (c.sortable === false ? '' : 'sortable'),
        'aria-sort': state.key === c.key ? (state.dir > 0 ? 'ascending' : 'descending') : null,
        onclick: c.sortable === false ? null : () => { state.dir = state.key === c.key ? -state.dir : (c.align === 'r' ? -1 : 1); state.key = c.key; paint(); },
      }, c.label, state.key === c.key && h('span', { class: 'arrow' }, state.dir > 0 ? ' ↑' : ' ↓'))))),
      h('tbody', null, shown.map(r => h('tr', null, columns.map(c => {
        const content = c.render ? c.render(r) : (c.fmt ? c.fmt(val(c, r), r) : val(c, r));
        return h('td', { class: (c.align === 'r' ? 'r ' : '') + (c.bar ? 'barcell ' : '') + (c.name ? 'name' : ''), title: c.name ? String(val(c, r) ?? '') : null },
          c.bar && h('i', { style: { width: `${Math.max(2, 100 * Math.abs(val(c, r) || 0) / maxes[c.key] * 0.88)}%` } }),
          c.bar ? h('span', null, content) : content);
      })))),
    ) : h('p', { class: 'muted', style: { padding: '14px 10px' } }, empty));
  }
  paint();
  wrap.append(searchBox || '', body);
  wrap.csv = () => download(filename, csv(columns.filter(c => c.csv !== false), rows));
  return wrap;
}

// ── card with chart/table twin ──
export function card({ title, cap, span = 'c-6', chart, tableFn, tools = [], cls = '', csvName }) {
  const body = h('div', { class: 'card-body' }, chart);
  let showing = 'chart', tableNode = null;
  const toggle = tableFn && h('button', { class: 'tool', type: 'button', 'aria-pressed': 'false', title: 'Show the same numbers as a table', onclick: e => {
    showing = showing === 'chart' ? 'table' : 'chart';
    e.currentTarget.setAttribute('aria-pressed', showing === 'table');
    e.currentTarget.textContent = showing === 'table' ? 'Chart' : 'Table';
    if (showing === 'table') { tableNode ||= tableFn(); body.replaceChildren(tableNode); } else body.replaceChildren(chart);
    window.dispatchEvent(new Event('resize'));
  } }, 'Table');
  const dl = tableFn && h('button', { class: 'tool', type: 'button', title: 'Download as CSV', onclick: () => { tableNode ||= tableFn(); tableNode.csv?.(); } }, 'CSV');
  const el = h('section', { class: `card ${span} ${cls}` },
    h('div', { class: 'card-h' }, h('div', null, h('h2', { text: title }), cap && h('p', { class: 'cap', text: cap })),
      h('div', { class: 'card-tools' }, tools, toggle, dl)),
    body);
  return el;
}

export function notice(html, iconName = 'info') {
  const n = h('div', { class: 'notice', role: 'note' }, icon(iconName));
  const t = h('div'); t.innerHTML = html; n.append(t); return n;   // html is always a literal from the page code
}
export function empty(title, text) {
  const e = h('div', { class: 'empty' }, h('h3', { text: title })); const p = h('p'); p.innerHTML = text; e.append(p); return e;
}

// ── floating tooltip for HTML components ──
export function showTip(evt, rows, head) {
  const t = document.getElementById('tip');
  t.replaceChildren(head ? h('div', { class: 't-h', text: head }) : '', ...rows.map(r =>
    h('div', { class: 't-r' }, h('span', null, r.color && h('i', { class: 'k', style: { background: r.color } }), r.label), h('b', { text: r.value }))));
  t.hidden = false;
  const x = Math.min(evt.clientX + 14, window.innerWidth - t.offsetWidth - 10), y = Math.min(evt.clientY + 14, window.innerHeight - t.offsetHeight - 10);
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
export const hideTip = () => { document.getElementById('tip').hidden = true; };

// ── bar list: nominal categories, one colour, label + value + extra column ──
export function barList(rows, { name, nameNode, value, valueFmt = fmt.int, extra, extraLabel, swatchFn, color = 'var(--s1)', max, tip, marker, markerLabel, cls }) {
  const m = max ?? Math.max(...rows.map(r => value(r)), 1);
  return h('div', { class: `blist ${cls || ''}` },
    extraLabel && h('div', { class: 'bl-head' }, h('span'), h('span'), h('span'), h('span', { class: 'r', text: extraLabel })),
    rows.map(r => {
      const row = h('div', { class: 'bl-row', tabindex: '0' },
        h('div', { class: 'bl-n', title: name(r) }, swatchFn && swatchFn(r), nameNode ? nameNode(r) : h('span', { text: name(r) })),
        h('div', { class: 'bl-t' }, h('i', { style: { width: `${Math.max(1.5, 100 * value(r) / m)}%`, background: typeof color === 'function' ? color(r) : color } }),
          marker != null && h('b', { class: 'mk', title: markerLabel || 'Average', style: { left: `${Math.min(100, 100 * marker / m)}%` } })),
        h('div', { class: 'bl-v num', text: valueFmt(value(r)) }),
        h('div', { class: 'bl-x num r', text: extra ? extra(r) : '' }));
      if (tip) {
        const show = e => showTip(e.type === 'focus' ? { clientX: row.getBoundingClientRect().left + 40, clientY: row.getBoundingClientRect().top + 10 } : e, tip(r), name(r));
        row.addEventListener('pointermove', show); row.addEventListener('focus', show); row.addEventListener('pointerleave', hideTip); row.addEventListener('blur', hideTip);
      }
      return row;
    }));
}

export function selectEl(options, value, onchange, label) {
  const sel = h('select', { class: 'select', 'aria-label': label, onchange: e => onchange(e.target.value) },
    options.map(o => h('option', { value: o[0], selected: o[0] === value ? true : null }, o[1])));
  return sel;
}

// A row of KPI tiles. A hero counts as two columns; if the last row is short, the last tile stretches to fill it.
export function kpis(...items) {
  const tiles = items.flat(Infinity).filter(Boolean);
  const total = tiles.reduce((a, t) => a + (t.classList.contains('hero') ? 2 : 1), 0), rem = total % 4;
  if (rem && tiles.length > 1 && window.innerWidth > 1100) tiles.at(-1).style.gridColumn = `span ${1 + 4 - rem}`;
  return h('div', { class: 'kpis' }, tiles);
}
