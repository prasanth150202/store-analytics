import { h, fmt, fmtDate, fmtBucket, kpi, delta, card, legend, table, swatch, entityColor, slotColor, cssVar, kpis } from '../ui.js';
import * as C from '../charts.js';

export default {
  title: 'Overview', basis: true,
  async render({ state, api, scope, after, brandName }) {
    const d = await api('/overview');
    const k = d.kpis, p = state.compare ? d.prev : null;
    const gross = state.basis === 'gross';
    const rev = gross ? k.gross : k.net, revPrev = p ? (gross ? p.gross : p.net) : null;
    const aov = k.net_orders ? k.net / k.net_orders : 0, aovPrev = p && p.net_orders ? p.net / p.net_orders : null;
    const cr = k.orders ? 100 * k.cancelled / k.orders : 0, crPrev = p && p.orders ? 100 * p.cancelled / p.orders : null;
    const ser = d.series, key = gross ? 'gross' : 'net';

    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null,
      h('h1', { text: 'Overview' }),
      h('p', { class: 'sub', text: `${brandName} · ${fmt.int(scope.days)} days from ${fmtDate(scope.start, false)} to ${fmtDate(scope.end)}. Revenue is shown ${gross ? 'before' : 'after'} removing cancelled orders.` }))));

    page.append(kpis(
      kpi(gross ? 'Gross revenue' : 'Net revenue', fmt.inrc(rev), { hero: true,
        d: [p && delta(rev, revPrev), h('span', { text: `${fmt.inr(rev)} from ${fmt.int(k.net_orders)} orders${gross ? ' placed' : ' kept'}` })] }),
      kpi('Orders placed', fmt.int(k.orders), { d: p && delta(k.orders, p.orders), sub: `${fmt.int(k.net_orders)} kept` }),
      kpi('Cancellation rate', fmt.pct(cr), { d: p && delta(cr, crPrev, { goodUp: false, kind: 'pp' }), sub: `${fmt.inrc(k.cancelled_value)} lost` }),
      kpi('Average order value', fmt.inr(aov), { d: p && delta(aov, aovPrev), sub: 'kept orders' }),
      kpi('Customers', fmt.int(k.customers), { d: p && delta(k.customers, p.customers), sub: `${fmt.int(k.new_customers)} new` }),
      kpi('Units sold', fmt.int(k.units_net), { d: p && delta(k.units_net, p.units_net), sub: `${fmt.int(k.units - k.units_net)} cancelled` }),
    ));

    const grid = h('div', { class: 'grid' });
    page.append(grid);

    // revenue over time
    const el1 = C.chartBox();
    grid.append(card({
      title: gross ? 'Gross revenue over time' : 'Net revenue over time', span: 'c-8',
      cap: `By ${d.scope.gran}. Orders are placed on the day shown in IST.`, chart: el1,
      tableFn: () => table({ filename: 'revenue_over_time.csv', sortKey: 'd', sortDir: 1, columns: [
        { key: 'd', label: d.scope.gran === 'month' ? 'Month' : d.scope.gran === 'week' ? 'Week of' : 'Day', fmt: v => fmtBucket(v, d.scope.gran) },
        { key: key, label: gross ? 'Gross revenue' : 'Net revenue', align: 'r', fmt: fmt.inr },
        { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int }], rows: ser }),
    }));
    after(() => C.line(el1, { x: ser.map(s => s.d), gran: d.scope.gran, yFmt: fmt.inrc,
      series: [{ name: gross ? 'Gross revenue' : 'Net revenue', values: ser.map(s => s[key]), color: slotColor(1), area: true }] }));

    // channel mix
    const el2 = C.chartBox();
    const ch = d.channels;
    grid.append(card({ title: 'Where revenue comes from', span: 'c-4', cap: 'Net revenue by acquisition channel, read from each order\'s own tags.', chart: el2,
      tableFn: () => table({ filename: 'channels.csv', sortKey: 'net', columns: [
        { key: 'k', label: 'Channel', searchable: true }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int },
        { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }], rows: ch }) }));
    after(() => C.bars(el2, { cats: ch.map(c => c.k), horizontal: true, valFmt: fmt.inrc,
      series: [{ name: 'Net revenue', values: ch.map(c => ({ value: c.net, itemStyle: { color: entityColor('channel', c.k) } })) }] }));

    // orders & cancellations
    const el3 = C.chartBox();
    grid.append(card({ title: 'Orders kept and cancelled', span: 'c-6', cap: 'Each column is one period; the lower part is orders that were kept.', chart: el3,
      tableFn: () => table({ filename: 'orders_cancelled.csv', sortKey: 'd', sortDir: 1, columns: [
        { key: 'd', label: 'Period', fmt: v => fmtBucket(v, d.scope.gran) }, { key: 'orders', label: 'Placed', align: 'r', fmt: fmt.int },
        { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int }], rows: ser }) }));
    el3.before(legend([{ name: 'Kept', color: slotColor(1), box: true }, { name: 'Cancelled', color: slotColor(8), box: true }]));
    after(() => C.bars(el3, { cats: ser.map(s => s.d), catFmt: v => fmtBucket(v, d.scope.gran), stacked: true, labels: false, valFmt: fmt.int,
      series: [{ name: 'Kept', values: ser.map(s => s.orders - s.cancelled), color: slotColor(1) },
               { name: 'Cancelled', values: ser.map(s => s.cancelled), color: slotColor(8) }] }));

    // best sellers
    grid.append(card({ title: 'Best sellers', span: 'c-6', cap: 'Kept units in this period. Open Products & variants for the full picture.',
      chart: table({ filename: 'best_sellers.csv', sortKey: 'units_net', columns: [
        { key: 'title', label: 'Product', name: true, render: r => h('span', null, swatch(r.colour_family), r.title), searchable: true },
        { key: 'units_net', label: 'Units', align: 'r', fmt: fmt.int, bar: true },
        { key: 'rev_net', label: 'Revenue', align: 'r', fmt: fmt.inrc }], rows: d.top_products }) }));

    // payment / states / stage
    const el4 = C.chartBox('short'), el5 = C.chartBox('short');
    grid.append(card({ title: 'Payment method', span: 'c-4', cap: 'Share of orders and how many were cancelled.', chart: el4,
      tableFn: () => table({ columns: [{ key: 'k', label: 'Method' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int },
        { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }], rows: d.payment }) }));
    after(() => C.bars(el4, { cats: d.payment.map(x => x.k), horizontal: true, valFmt: fmt.int,
      series: [{ name: 'Orders', values: d.payment.map(x => ({ value: x.orders, itemStyle: { color: entityColor('pay', x.k) } })) }] }));
    grid.append(card({ title: 'Top states', span: 'c-4', cap: 'Orders by shipping state.', chart: el5,
      tableFn: () => table({ columns: [{ key: 'k', label: 'State' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int },
        { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }], rows: d.states }) }));
    after(() => C.bars(el5, { cats: d.states.map(x => x.k), horizontal: true, valFmt: fmt.int, series: [{ name: 'Orders', values: d.states.map(x => x.orders), color: slotColor(1) }] }));

    const labels = { not_shipped: 'Not shipped yet', shipped: 'Shipped', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered' };
    const tot = d.stages.reduce((a, s) => a + s.orders, 0) || 1;
    const order = ['not_shipped', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
    grid.append(card({ title: 'Delivery status of kept orders', span: 'c-4',
      cap: state.brand === 'AHA' ? 'AHA only records dispatch, not delivery, so everything dispatched shows as shipped.' : 'Latest tracking stage of orders that were not cancelled.',
      chart: h('div', { class: 'funnel' }, order.map((o, i) => { const s = d.stages.find(x => x.k === o); const n = s ? s.orders : 0;
        return h('div', { class: 'fn-row', style: { gridTemplateColumns: '120px minmax(0,1fr) 90px' } }, h('div', { class: 'fn-l', text: labels[o] }),
          h('div', { class: 'fn-track' }, h('div', { class: 'fn-bar', style: { width: `${100 * n / tot}%`, background: cssVar(`--ordinal-${i + 1}`) } })),
          h('div', { class: 'fn-v' }, h('b', { text: fmt.int(n) }), h('small', { text: fmt.pct(100 * n / tot) }))); })) }));
    return page;
  },
};
