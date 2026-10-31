import { h, fmt, fmtBucket, kpi, card, legend, table, notice, barList, slotColor, entityColor, swatch, kpis } from '../ui.js';
import * as C from '../charts.js';

const STATUS = {
  invalid_phone: ['No usable phone number', 'The shopper left no valid mobile number, so a recovery message could not be sent.'],
  invalid_config: ['Recovery set-up error', 'The automation fired but recorded an invalid configuration, so the message very likely never went out.'],
  abandoned: ['Waiting for a message', 'Marked abandoned and eligible for a recovery message.'],
  recent_trigger: ['Messaged recently', 'Skipped because the same number was messaged a short time ago.'],
  order_exists: ['Order already placed', 'The automation found an order for this shopper and skipped it.'],
  converted: ['Recovered', 'Bought after the message.'],
  unprocessed: ['Not checked', 'Never processed by the automation.'],
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default {
  title: 'Abandoned checkouts', compare: false,
  async render({ state, api, scope, after, brandName }) {
    const d = await api('/checkouts/overview'), k = d.kpis, g = d.gran;
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Abandoned checkouts' }),
      h('p', { class: 'sub', text: `${brandName} · shoppers who reached checkout, who bought, who did not, and what the recovery messages did about it.` }))));

    if (k.captured === 0) { page.append(notice('No checkouts were captured in this period. Try a wider date range.')); return page; }
    if (k.misconfigured || k.no_phone) {
      page.append(notice(`<b>${fmt.inrc(k.no_phone_value + k.misconfigured_value)} of abandoned carts could not be recovered by message.</b> ` +
        `${fmt.int(k.no_phone)} carts (${fmt.inrc(k.no_phone_value)}) had no usable phone number` +
        (k.misconfigured ? `, and ${fmt.int(k.misconfigured)} carts (${fmt.inrc(k.misconfigured_value)}) hit a recovery set-up error` : '') +
        `. Fixing phone capture at checkout and the recovery configuration is the cheapest win here.`));
    }
    if (state.brand === 'AHA') page.append(notice('<b>AHA captures only a share of its checkouts</b>, because its Shopflo and Razorpay checkout bypasses the recovery tool. Purchases are linked to checkouts by phone number and time, so treat the purchased and abandoned split as an estimate.', 'info'));

    page.append(kpis(
      kpi('Abandoned carts', fmt.int(k.abandoned), { hero: true, d: [h('span', { text: `${fmt.pct(100 * k.abandoned / k.captured, 0)} of ${fmt.int(k.captured)} checkouts captured` })] }),
      kpi('Value left in carts', fmt.inrc(k.abandoned_value), { sub: `${fmt.inr(k.abandoned ? k.abandoned_value / k.abandoned : 0)} per cart` }),
      kpi('Reachable by message', fmt.pct(k.abandoned ? 100 * k.abandoned_with_phone / k.abandoned : 0, 0), { sub: `${fmt.int(k.abandoned_with_phone)} with a phone number` }),
      kpi('Recovery messages sent', fmt.int(k.abandoned_triggered), { sub: 'abandoned carts the automation tried' }),
      kpi('Carts recovered', fmt.int(k.recovered), { sub: `${fmt.pct(k.abandoned_triggered ? 100 * k.recovered / k.abandoned_triggered : 0, 1)} of those messaged` }),
      kpi('Revenue recovered', fmt.inrc(k.recovered_revenue), { sub: 'orders placed after a message' })));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    const el1 = C.chartBox('short'), s = d.series;
    el1.before(legend([{ name: 'Bought', color: slotColor(1), box: true }, { name: 'Abandoned', color: slotColor(2), box: true }]));
    grid.append(card({ title: 'Checkouts over time', span: 'c-7', cap: 'Each column is the checkouts started in that period, split by what happened.', chart: el1,
      tableFn: () => table({ filename: 'checkouts_over_time.csv', sortKey: 'd', sortDir: 1, rows: s, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, { key: 'captured', label: 'Captured', align: 'r', fmt: fmt.int },
        { key: 'purchased', label: 'Bought', align: 'r', fmt: fmt.int }, { key: 'abandoned', label: 'Abandoned', align: 'r', fmt: fmt.int }, { key: 'abandoned_value', label: 'Abandoned value', align: 'r', fmt: fmt.inr }] }) }));
    after(() => C.bars(el1, { cats: s.map(x => x.d), catFmt: v => fmtBucket(v, g), stacked: true, labels: false, valFmt: fmt.int,
      series: [{ name: 'Bought', values: s.map(x => x.purchased), color: slotColor(1) }, { name: 'Abandoned', values: s.map(x => x.abandoned), color: slotColor(2) }] }));

    grid.append(card({ title: 'What happened to abandoned carts', span: 'c-5', cap: 'As recorded by the recovery automation. Hover a row for what it means.',
      chart: barList(d.status, { name: r => (STATUS[r.k] || [r.k])[0], value: r => r.carts, color: slotColor(2), extraLabel: 'Cart value', extra: r => fmt.inrc(r.value),
        tip: r => [{ label: 'Carts', value: fmt.int(r.carts) }, { label: 'Value', value: fmt.inrc(r.value) }, { label: (STATUS[r.k] || ['', ''])[1], value: '' }] }),
      tableFn: () => table({ rows: d.status.map(r => ({ ...r, label: (STATUS[r.k] || [r.k])[0], meaning: (STATUS[r.k] || ['', ''])[1] })), sortKey: 'carts', columns: [{ key: 'label', label: 'Status' }, { key: 'carts', label: 'Carts', align: 'r', fmt: fmt.int }, { key: 'value', label: 'Value', align: 'r', fmt: fmt.inr }, { key: 'meaning', label: 'Meaning' }] }) }));

    // heatmap hour x weekday
    const el2 = C.chartBox();
    const hrs = Array.from({ length: 24 }, (_, i) => i);
    const cells = d.heat.map(r => [r.hr, r.wd, r.carts]);
    grid.append(card({ title: 'When carts get abandoned', span: 'c-7', cap: 'Abandoned checkouts by hour and weekday (IST). Darker means more.', chart: el2,
      tableFn: () => table({ rows: d.heat.map(r => ({ day: DAYS[r.wd], hour: `${String(r.hr).padStart(2, '0')}:00`, carts: r.carts, wd: r.wd, hr: r.hr })), sortKey: 'carts', columns: [{ key: 'day', label: 'Day', sortVal: r => r.wd }, { key: 'hour', label: 'Hour', sortVal: r => r.hr }, { key: 'carts', label: 'Abandoned carts', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.heat(el2, { xs: hrs, ys: DAYS, cells, valFmt: fmt.int, labels: false, xFmt: v => (v % 3 === 0 ? `${v}h` : ''), tipLabel: 'Abandoned carts' }));

    // sources
    const el3 = C.chartBox('short'), src = d.sources.map(r => ({ ...r, rate: r.captured ? 100 * r.purchased / r.captured : 0 }));
    grid.append(card({ title: 'Conversion by source', span: 'c-5', cap: 'Share of checkouts that ended in an order, by where the shopper came from.', chart: el3,
      tableFn: () => table({ rows: src, sortKey: 'captured', columns: [{ key: 'k', label: 'Source' }, { key: 'captured', label: 'Checkouts', align: 'r', fmt: fmt.int }, { key: 'purchased', label: 'Bought', align: 'r', fmt: fmt.int },
        { key: 'rate', label: 'Conversion', align: 'r', fmt: v => fmt.pct(v) }, { key: 'abandoned_value', label: 'Abandoned value', align: 'r', fmt: fmt.inr }] }) }));
    after(() => C.bars(el3, { cats: src.map(r => `${r.k} (${fmt.int(r.captured)})`), horizontal: true, valFmt: v => fmt.pct(v), series: [{ name: 'Conversion', values: src.map(r => +r.rate.toFixed(1)), color: slotColor(1) }] }));

    // value bands
    const el4 = C.chartBox('short');
    grid.append(card({ title: 'Cart value', span: 'c-5', cap: 'Checkouts by cart value, and how many of them were abandoned.', chart: el4,
      tableFn: () => table({ rows: d.bands, sortKey: 'k', sortDir: 1, columns: [{ key: 'k', label: 'Cart value' }, { key: 'carts', label: 'Checkouts', align: 'r', fmt: fmt.int }, { key: 'abandoned', label: 'Abandoned', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.bars(el4, { cats: d.bands.map(b => b.k.slice(4)), valFmt: fmt.int, labels: true, series: [{ name: 'Abandoned', values: d.bands.map(b => b.abandoned), color: slotColor(2) }] }));

    grid.append(card({ title: 'Most abandoned products', span: 'c-7', cls: 'pad0', cap: 'Carts holding a single product, matched to the catalogue by title.',
      chart: table({ filename: 'abandoned_products.csv', sortKey: 'carts', search: 'Search products', limit: 12, rows: d.products, columns: [
        { key: 'title', label: 'Product', name: true, searchable: true, render: r => h('span', null, r.colour_family ? swatch(r.colour_family) : '', r.title) },
        { key: 'carts', label: 'Carts', align: 'r', fmt: fmt.int, bar: true }, { key: 'value', label: 'Value', align: 'r', fmt: fmt.inrc }] }) }));
    return page;
  },
};
