import { h, fmt, fmtDate, kpi, card, table, notice, selectEl, slotColor, cssVar, kpis } from '../ui.js';
import * as C from '../charts.js';
import { range } from '../main.js';

const ui = { segment: '', search: '' };
const ORDER = ['Champions', 'Loyal', 'At risk', 'New', 'Promising', 'Needs attention', 'Hibernating'];

export default {
  title: 'Segments', compare: false,
  async render({ state, api, scope, after, brandName }) {
    const d = await api('/customers/segments');
    const page = h('div'), segs = d.segments, by = Object.fromEntries(segs.map(s => [s.k, s]));
    const repeat = segs.filter(s => ['Champions', 'Loyal', 'At risk'].includes(s.k)).reduce((a, s) => a + s.customers, 0);
    const hv = d.tiers.find(t => t.k === 'High value');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Segments' }),
      h('p', { class: 'sub', text: `${brandName} · customers grouped by how recently and how often they buy. Counted on orders from ${fmtDate(scope.start, false)} to ${fmtDate(scope.end)}; "recent" is measured back from ${fmtDate(scope.end)}.` }))));
    page.append(kpis(
      kpi('Customers with a kept order', fmt.int(d.customers), { hero: true, d: [h('span', { text: `${fmt.inrc(d.net_rev)} net revenue` })] }),
      kpi('Repeat customers', fmt.pct(d.customers ? 100 * repeat / d.customers : 0, 1), { sub: `${fmt.int(repeat)} with 2 or more kept orders` }),
      kpi('Champions', fmt.int(by.Champions?.customers || 0), { sub: `${fmt.pct(by.Champions?.rev_share || 0, 0)} of revenue` }),
      kpi('At risk', fmt.int(by['At risk']?.customers || 0), { sub: 'repeat buyers gone quiet' }),
      kpi('Top 10% by spend', hv ? fmt.pct(hv.rev_share, 0) : '–', { sub: 'share of revenue they bring' }),
      kpi('Cancel-prone', fmt.int(d.flags.cancel_prone), { sub: '2 or more cancellations, half or more of their orders' })));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    grid.append(card({ title: 'Segments', span: 'c-12', cls: 'pad0', cap: 'Hover a segment name for the rule. Customers appear in exactly one segment.',
      chart: table({ filename: 'segments.csv', sortKey: 'order', sortDir: 1, rows: segs.map(s => ({ ...s, order: ORDER.indexOf(s.k) })), columns: [
        { key: 'k', label: 'Segment', sortVal: r => r.order, render: r => h('span', { title: r.help }, r.k), name: true },
        { key: 'customers', label: 'Customers', align: 'r', fmt: fmt.int, bar: true }, { key: 'share', label: 'Share', align: 'r', fmt: v => fmt.pct(v, 0) },
        { key: 'rev', label: 'Revenue', align: 'r', fmt: fmt.inrc }, { key: 'rev_share', label: 'Of revenue', align: 'r', fmt: v => fmt.pct(v, 0) },
        { key: 'avg_orders', label: 'Orders each', align: 'r', fmt: v => fmt.dec(v, 1) }, { key: 'aov', label: 'AOV', align: 'r', fmt: fmt.inr },
        { key: 'avg_recency', label: 'Days since last', align: 'r', fmt: v => v == null ? '–' : fmt.int(v) }] }) }));

    // recency x frequency
    const el = C.chartBox('short');
    const ys = ['Most recent', 'Recent', 'Middle', 'Older', 'Oldest'], xs = ['1 order', '2 orders', '3 or more'];
    const cells = d.matrix.map(m => [m.f - 1, 5 - m.r, m.n]);
    grid.append(card({ title: 'Recency and frequency', span: 'c-6', cap: 'Customers by how recently they last ordered (rows) and how many kept orders they have (columns).', chart: el,
      tableFn: () => table({ rows: d.matrix.map(m => ({ recency: ys[5 - m.r], orders: xs[m.f - 1], n: m.n, r: m.r })), sortKey: 'n', columns: [{ key: 'recency', label: 'Recency', sortVal: r => -r.r }, { key: 'orders', label: 'Kept orders' }, { key: 'n', label: 'Customers', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.heat(el, { xs, ys, cells, valFmt: fmt.int, tipLabel: 'Customers' }));

    grid.append(card({ title: 'Value tiers', span: 'c-6', cap: 'Customers ranked by what they spent in the period.', cls: 'pad0',
      chart: table({ rows: d.tiers, sortKey: null, columns: [{ key: 'k', label: 'Tier' }, { key: 'customers', label: 'Customers', align: 'r', fmt: fmt.int }, { key: 'share', label: 'Share', align: 'r', fmt: v => fmt.pct(v, 0) },
        { key: 'rev', label: 'Revenue', align: 'r', fmt: fmt.inrc }, { key: 'rev_share', label: 'Of revenue', align: 'r', fmt: v => fmt.pct(v, 0), bar: true }] }) }));

    grid.append(card({ title: 'Cancellation and payment risk', span: 'c-12', cap: 'Groups worth treating differently, for example by confirming cash-on-delivery orders before dispatch.',
      chart: h('div', { class: 'blist' }, [
        ['Cancel-prone customers', d.flags.cancel_prone, '2 or more cancellations, and half or more of their orders cancelled'],
        ['Customers with at least one cancellation', d.flags.cancelled_any, 'among customers who also kept an order'],
        ['Cancelled every order', d.flags.cancelled_only, 'ordered in this period but never kept one'],
        ['Repeat buyers who only pay on delivery', d.flags.cod_only_repeat, '2 or more kept orders, every one cash on delivery']].map(([l, n, sub]) =>
        h('div', { class: 'bl-row', style: { gridTemplateColumns: 'minmax(0,1fr) 70px', alignItems: 'start' } }, h('div', { class: 'bl-n', style: { display: 'block' } }, h('div', { text: l }), h('div', { class: 'muted', style: { fontSize: '12.5px', fontWeight: 400 }, text: sub })),
          h('div', { class: 'bl-v num', text: fmt.int(n) })))) }));

    // customer list
    const box = h('div'); let rows = [];
    const lc = card({ title: 'Customer list', span: 'c-12', cap: 'Filter by segment, search by name, phone or city, then download for a campaign or a call list.', chart: box });
    const q0 = new URLSearchParams({ brand: state.brand, ...range() });
    const dl = h('a', { class: 'tool', href: '#', title: 'Download the filtered list', onclick: e => { e.preventDefault(); const p = new URLSearchParams({ brand: state.brand, ...range(), segment: ui.segment }); window.location = `/api/customers/list.csv?${p}`; } }, 'CSV');
    lc.querySelector('.card-tools').prepend(selectEl([['', 'All customers'], ...ORDER.map(s => [s, s]), ['High value', 'High value tier']], ui.segment, v => { ui.segment = v; load(); }, 'Segment'));
    lc.querySelector('.card-tools').append(dl);
    async function load() {
      box.style.opacity = .55;
      const r = await api('/customers/list', { segment: ui.segment || '', limit: 500 });
      box.replaceChildren(h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12.5px' }, text: `${fmt.int(r.total)} customers${r.total > 500 ? ' (showing the top 500 by spend; the CSV has up to 2,000)' : ''}` }),
        table({ filename: 'customers.csv', sortKey: 'net_rev', search: 'Search name, phone, city', limit: 100, rows: r.rows, columns: [
          { key: 'customer_name', label: 'Customer', name: true, searchable: true }, { key: 'primary_phone', label: 'Phone', searchable: true }, { key: 'city', label: 'City', searchable: true },
          { key: 'segment', label: 'Segment' }, { key: 'net_orders', label: 'Kept orders', align: 'r', fmt: fmt.int }, { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int },
          { key: 'net_rev', label: 'Net revenue', align: 'r', fmt: fmt.inr }, { key: 'recency', label: 'Days since last', align: 'r', fmt: fmt.int }] }));
      box.style.opacity = 1;
    }
    page.append(lc); after(load);
    return page;
  },
};
