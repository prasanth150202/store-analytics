import { h, fmt, fmtBucket, kpi, card, legend, table, notice, selectEl, barList, slotColor, entityColor, kpis } from '../ui.js';
import * as C from '../charts.js';

const ui = { heat: 'orders', pair: 'product_type' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PAIRS = [['product_type', 'Garment types'], ['colour_family', 'Colour families'], ['size', 'Sizes']];
const NTH = { 1: 'First order', 2: 'Second order', 3: 'Third order', 4: 'Fourth or later' };

export default {
  title: 'Behaviour', compare: false,
  async render({ state, api, scope, after, brandName, rerender }) {
    const d = await api('/behaviour/overview', { pair: ui.pair });
    const m = d.mix, ds = d.discount, g = d.gran;
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Behaviour' }),
      h('p', { class: 'sub', text: `${brandName} · when people order, what goes in the basket, how often they return, how they pay and what they browse on.` }))));

    const cod = d.payment_stats.find(p => p.k === 'COD'), tot = d.payment_stats.reduce((a, p) => a + p.orders, 0);
    page.append(kpis(
      kpi('Units per order', fmt.dec(m.orders ? m.units / m.orders : 0, 2), { hero: true, d: [h('span', { text: `${fmt.pct(m.orders ? 100 * m.multi_unit / m.orders : 0, 0)} of orders have more than one unit` })] }),
      kpi('Mixed-size baskets', fmt.pct(m.orders ? 100 * m.multi_size / m.orders : 0, 1), { sub: 'more than one size in an order' }),
      kpi('Orders with a discount', fmt.pct(ds.orders ? 100 * ds.discounted / ds.orders : 0, 0), { sub: ds.avg_disc_pct ? `${fmt.dec(ds.avg_disc_pct, 1)}% off on average` : '' }),
      kpi('Days between orders', d.gaps.median == null ? '–' : fmt.int(d.gaps.median), { sub: `median across ${fmt.int(d.gaps.n)} repeat orders` }),
      kpi('Cash on delivery', fmt.pct(tot ? 100 * (cod?.orders || 0) / tot : 0, 0), { sub: `${fmt.int(cod?.orders || 0)} orders` }),
      kpi('Orders with two or more garment types', fmt.pct(m.orders ? 100 * m.multi_type / m.orders : 0, 1), { sub: 'for example a nighty and a frock' })));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    // when
    const el1 = C.chartBox(); const hrs = Array.from({ length: 24 }, (_, i) => i);
    const hc = d.heat.map(r => [r.hr, r.wd, ui.heat === 'orders' ? r.orders : Math.round(r.net)]);
    const hf = ui.heat === 'orders' ? fmt.int : fmt.inrc;
    const hCard = card({ title: 'When people order', span: 'c-12', cap: 'Orders by hour of day and weekday (IST). Darker means more.', chart: el1,
      tableFn: () => table({ rows: d.heat.map(r => ({ day: DAYS[r.wd], hour: `${String(r.hr).padStart(2, '0')}:00`, orders: r.orders, net: r.net, wd: r.wd, hr: r.hr })), sortKey: 'orders', columns: [
        { key: 'day', label: 'Day', sortVal: r => r.wd }, { key: 'hour', label: 'Hour', sortVal: r => r.hr }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }] }) });
    hCard.querySelector('.card-tools').prepend(selectEl([['orders', 'Orders'], ['net', 'Net revenue']], ui.heat, v => { ui.heat = v; rerender(); }, 'Measure'));
    grid.append(hCard);
    after(() => C.heat(el1, { xs: hrs, ys: DAYS, cells: hc, valFmt: hf, labels: false, xFmt: v => `${v}h`, tipLabel: ui.heat === 'orders' ? 'Orders' : 'Net revenue' }));

    // basket
    const el2 = C.chartBox('short'), bk = d.basket.map(b => ({ k: b.units >= 5 ? '5 or more' : `${b.units} unit${b.units > 1 ? 's' : ''}`, orders: b.orders, u: b.units }));
    const agg = []; bk.forEach(b => { const e = agg.find(a => a.k === b.k); if (e) e.orders += b.orders; else agg.push({ ...b }); });
    grid.append(card({ title: 'Basket size', span: 'c-4', cap: 'Orders by number of units.', chart: el2, tableFn: () => table({ rows: agg, columns: [{ key: 'k', label: 'Units in order' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.bars(el2, { cats: agg.map(a => a.k), valFmt: fmt.int, series: [{ name: 'Orders', values: agg.map(a => a.orders), color: slotColor(1) }] }));

    const el3 = C.chartBox('short');
    grid.append(card({ title: 'Order value', span: 'c-4', cap: 'Orders by order total, with how many were cancelled.', chart: el3,
      tableFn: () => table({ rows: d.bands, sortKey: 'k', sortDir: 1, columns: [{ key: 'k', label: 'Order value' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int }] }) }));
    el3.before(legend([{ name: 'Kept', color: slotColor(1), box: true }, { name: 'Cancelled', color: slotColor(8), box: true }]));
    after(() => C.bars(el3, { cats: d.bands.map(b => b.k.slice(4)), stacked: true, labels: false, valFmt: fmt.int,
      series: [{ name: 'Kept', values: d.bands.map(b => b.orders - b.cancelled), color: slotColor(1) }, { name: 'Cancelled', values: d.bands.map(b => b.cancelled), color: slotColor(8) }] }));

    const el4 = C.chartBox('short');
    grid.append(card({ title: 'Which order is it', span: 'c-4', cap: 'Kept orders by whether it is the customer\'s first, second, third or later.', chart: el4,
      tableFn: () => table({ rows: d.sequence.map(s => ({ k: NTH[s.nth], orders: s.orders, net: s.net })), columns: [{ key: 'k', label: 'Order' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }] }) }));
    after(() => C.bars(el4, { cats: d.sequence.map(s => NTH[s.nth]), valFmt: fmt.int, series: [{ name: 'Kept orders', values: d.sequence.map(s => s.orders), color: slotColor(1) }] }));

    // bought together
    const pc = card({ title: 'Bought together', span: 'c-6', cap: 'Pairs that appear in the same order, most frequent first.', cls: 'pad0',
      chart: d.pairs.length ? table({ filename: 'bought_together.csv', sortKey: 'orders', rows: d.pairs, columns: [{ key: 'a', label: 'One', name: true }, { key: 'b', label: 'Other', name: true }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int, bar: true }] })
        : h('p', { class: 'muted', style: { padding: '8px 20px' }, text: 'No orders in this period have two different items to pair.' }) });
    pc.querySelector('.card-tools').prepend(selectEl(PAIRS, ui.pair, v => { ui.pair = v; rerender(); }, 'Pair by'));
    grid.append(pc);

    const el5 = C.chartBox('short');
    grid.append(card({ title: 'Days between repeat orders', span: 'c-6', cap: `For customers who ordered again. Median ${d.gaps.median == null ? '–' : fmt.int(d.gaps.median)} days, mean ${d.gaps.mean == null ? '–' : fmt.int(d.gaps.mean)}.`, chart: el5,
      tableFn: () => table({ rows: d.gaps.dist, columns: [{ key: 'k', label: 'Gap' }, { key: 'n', label: 'Repeat orders', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.bars(el5, { cats: d.gaps.dist.map(x => x.k), valFmt: fmt.int, series: [{ name: 'Repeat orders', values: d.gaps.dist.map(x => x.n), color: slotColor(1) }] }));

    // payment & discounts
    const el6 = C.chartBox('short'), ps = d.payment_series;
    grid.append(card({ title: 'Cash on delivery share over time', span: 'c-6', cap: 'Share of orders paid on delivery in each period.', chart: el6,
      tableFn: () => table({ rows: ps, sortKey: 'd', sortDir: 1, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'cod', label: 'Cash on delivery', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.line(el6, { x: ps.map(p => p.d), gran: g, yFmt: v => `${v}%`, valFmt: v => fmt.pct(v, 1), series: [{ name: 'Cash on delivery', values: ps.map(p => p.orders >= 20 ? +(100 * p.cod / p.orders).toFixed(1) : null), color: slotColor(2), area: true }] }));

    grid.append(card({ title: 'Payment method and discounts', span: 'c-6', cls: 'pad0', cap: 'Order value and cancellation by how the order was paid, and with or without a discount.',
      chart: table({ rows: [
        ...d.payment_stats.map(p => ({ k: p.k === 'COD' ? 'Cash on delivery' : 'Prepaid', orders: p.orders, aov: p.aov, cancel: p.cancel_rate })),
        { k: 'With a discount', orders: ds.discounted, aov: ds.aov_disc, cancel: ds.cancel_disc }, { k: 'Full price', orders: ds.orders - ds.discounted, aov: ds.aov_full, cancel: ds.cancel_full }],
        columns: [{ key: 'k', label: 'Group' }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'aov', label: 'Avg kept order', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) }, { key: 'cancel', label: 'Cancelled', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v, 1) }] }) }));

    // devices
    const known = d.device_known;
    grid.append(card({ title: 'Device and browser', span: 'c-12', cls: 'pad0',
      cap: known.known ? `From the browser captured at checkout, available for ${fmt.pct(100 * known.known / known.orders, 0)} of orders in this period. "In-app" means the shopper was inside the Instagram or Facebook app.` : 'The browser was not captured for orders in this period.',
      chart: d.device.length ? table({ filename: 'devices.csv', sortKey: 'orders', rows: d.device, columns: [{ key: 'device_class', label: 'Device' }, { key: 'os', label: 'System' }, { key: 'browser_type', label: 'Browser' },
        { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int, bar: true }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }, { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 1) }] })
        : h('p', { class: 'muted', style: { padding: '8px 20px' }, text: 'No browser information for this period.' }) }));
    return page;
  },
};
