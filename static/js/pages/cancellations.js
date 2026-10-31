import { h, fmt, fmtBucket, kpi, delta, card, legend, table, barList, selectEl, slotColor, notice, swatch, kpis } from '../ui.js';
import * as C from '../charts.js';

const ui = { dim: 'product_type', sort: 'cancelled', min: 10 };

export default {
  title: 'Cancellations', compare: true,
  async render({ state, api, scope, after, brandName }) {
    const [s, dims] = await Promise.all([api('/cancellations/summary'), api('/cancellations/dimensions')]);
    const k = s.kpis, p = state.compare ? s.prev : null;
    const rate = k.orders ? 100 * k.cancelled / k.orders : 0, prate = p && p.orders ? 100 * p.cancelled / p.orders : null;
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Cancellations' }),
      h('p', { class: 'sub', text: `${brandName} · which products, sizes and areas cancel most. A cancelled order is one that was cancelled, voided or returned according to its status updates.` }))));

    if (k.cancelled && k.after_dispatch / k.cancelled > 0.4)
      page.append(notice(`<b>${fmt.pct(100 * k.after_dispatch / k.cancelled, 0)} of cancellations happened after dispatch.</b> ${fmt.int(k.after_dispatch)} of the ${fmt.int(k.cancelled)} cancelled orders already had a shipment with a tracking number, so most of them look like returns or refused parcels, not changes of mind. The data does not say which.`));

    // Prepaid cancellations that almost vanish while cash on delivery keeps cancelling: usually a recording change.
    const ps = s.pay_series || [];
    const tot = (rs, a, b) => rs.reduce((t, r) => [t[0] + r[a], t[1] + r[b]], [0, 0]);
    let from = ps.length, seen = 0;                                   // latest months holding at least 300 prepaid orders
    while (from > 0 && seen < 300) seen += ps[--from].pre;
    const recent = ps.slice(from), [ro, rc] = tot(recent, 'pre', 'pre_cancelled'), [co, cc] = tot(recent, 'cod', 'cod_cancelled');
    let peak = null;                                                  // worst 3-month stretch before that, with at least 100 prepaid orders
    for (let i = 0; i + 3 <= from; i++) {
      const [o, c] = tot(ps.slice(i, i + 3), 'pre', 'pre_cancelled');
      if (o >= 100 && (!peak || c / o > peak.rate)) peak = { rate: c / o, a: ps[i].d, b: ps[i + 2].d };
    }
    if (seen >= 300 && peak && peak.rate >= 0.10 && rc / ro <= 0.2 * peak.rate)
      page.append(notice(`<b>Prepaid cancellations almost stop appearing in recent months.</b> In ${fmtBucket(peak.a, 'month')} to ${fmtBucket(peak.b, 'month')}, ${fmt.pct(100 * peak.rate)} of prepaid orders were cancelled; since ${fmtBucket(recent[0].d, 'month')} only ${fmt.pct(100 * rc / ro)} (${fmt.int(rc)} of ${fmt.int(ro)}), while cash on delivery still cancels at ${fmt.pct(co ? 100 * cc / co : 0)}. That can mean prepaid cancellations are no longer being recorded, which would overstate recent net revenue. Worth confirming with the brand team before relying on recent months.`));

    page.append(kpis(
      kpi('Cancelled orders', fmt.int(k.cancelled), { hero: true, d: [h('span', { text: `out of ${fmt.int(k.orders)} orders placed in this period` })] }),
      kpi('Cancellation rate', fmt.pct(rate), { d: p && delta(rate, prate, { goodUp: false, kind: 'pp' }), sub: 'of orders placed' }),
      kpi('Value cancelled', fmt.inrc(k.cancelled_value), { d: p && delta(k.cancelled_value, p.cancelled_value, { goodUp: false }), sub: `${fmt.pct(k.gross ? 100 * k.cancelled_value / k.gross : 0)} of gross` }),
      kpi('Before dispatch', fmt.int(k.before_dispatch), { sub: 'never shipped' }),
      kpi('After dispatch', fmt.int(k.after_dispatch), { sub: 'shipment existed' }),
      kpi('Cash on delivery', fmt.pct(k.cod ? 100 * k.cod_cancelled / k.cod : 0), { sub: `${fmt.int(k.cod_cancelled)} of ${fmt.int(k.cod)} orders` }),
      kpi('Prepaid', fmt.pct(k.pre ? 100 * k.pre_cancelled / k.pre : 0), { sub: `${fmt.int(k.pre_cancelled)} of ${fmt.int(k.pre)} orders` })));

    const grid = h('div', { class: 'grid' }); page.append(grid);
    const ser = s.series, g = s.gran;

    const el1 = C.chartBox('short');
    grid.append(card({ title: 'Cancelled orders over time', span: 'c-6', cap: 'Split by whether a shipment already existed.', chart: el1,
      tableFn: () => table({ filename: 'cancellations_over_time.csv', sortKey: 'd', sortDir: 1, rows: ser, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) },
        { key: 'orders', label: 'Orders placed', align: 'r', fmt: fmt.int }, { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int },
        { key: 'after_dispatch', label: 'After dispatch', align: 'r', fmt: fmt.int }, { key: 'value', label: 'Value', align: 'r', fmt: fmt.inr }] }) }));
    el1.before(legend([{ name: 'Before dispatch', color: slotColor(7), box: true }, { name: 'After dispatch', color: slotColor(8), box: true }]));
    after(() => C.bars(el1, { cats: ser.map(x => x.d), catFmt: v => fmtBucket(v, g), stacked: true, labels: false, valFmt: fmt.int,
      series: [{ name: 'Before dispatch', values: ser.map(x => x.cancelled - x.after_dispatch), color: slotColor(7) }, { name: 'After dispatch', values: ser.map(x => x.after_dispatch), color: slotColor(8) }] }));

    const el2 = C.chartBox('short');
    grid.append(card({ title: 'Cancellation rate over time', span: 'c-6', cap: 'Cancelled orders as a share of orders placed in the same period. Periods with fewer than 20 orders are left out. Recent periods can still rise as parcels come back.', chart: el2,
      tableFn: () => table({ filename: 'cancellation_rate.csv', sortKey: 'd', sortDir: 1, rows: ser.map(x => ({ ...x, rate: x.orders ? 100 * x.cancelled / x.orders : 0 })),
        columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'rate', label: 'Cancel rate', align: 'r', fmt: v => fmt.pct(v) }] }) }));
    after(() => C.line(el2, { x: ser.map(x => x.d), gran: g, yFmt: v => `${v}%`, valFmt: v => fmt.pct(v), series: [{ name: 'Cancellation rate', values: ser.map(x => x.orders >= 20 ? +(100 * x.cancelled / x.orders).toFixed(1) : null), color: slotColor(8), area: true }] }));

    const el2b = C.chartBox('short');
    grid.append(card({ title: 'Cancellation rate by payment method', span: 'c-12', cap: 'Cash on delivery and prepaid orders, by month of order. A month needs at least 20 orders of that payment method to be shown. Read a sudden drop to near zero as a change in what is recorded until it is confirmed otherwise.', chart: el2b,
      tableFn: () => table({ filename: 'cancellation_rate_by_payment.csv', sortKey: 'd', sortDir: 1, rows: ps.map(x => ({ ...x, cod_rate: x.cod ? 100 * x.cod_cancelled / x.cod : null, pre_rate: x.pre ? 100 * x.pre_cancelled / x.pre : null })),
        columns: [{ key: 'd', label: 'Month', fmt: v => fmtBucket(v, 'month') }, { key: 'cod', label: 'COD orders', align: 'r', fmt: fmt.int }, { key: 'cod_cancelled', label: 'COD cancelled', align: 'r', fmt: fmt.int },
          { key: 'cod_rate', label: 'COD rate', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v) }, { key: 'pre', label: 'Prepaid orders', align: 'r', fmt: fmt.int }, { key: 'pre_cancelled', label: 'Prepaid cancelled', align: 'r', fmt: fmt.int },
          { key: 'pre_rate', label: 'Prepaid rate', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v) }] }) }));
    el2b.before(legend([{ name: 'Cash on delivery', color: slotColor(8) }, { name: 'Prepaid', color: slotColor(1) }]));
    after(() => C.line(el2b, { x: ps.map(x => x.d), gran: 'month', yFmt: v => `${v}%`, valFmt: v => fmt.pct(v), series: [
      { name: 'Cash on delivery', values: ps.map(x => x.cod >= 20 ? +(100 * x.cod_cancelled / x.cod).toFixed(1) : null), color: slotColor(8) },
      { name: 'Prepaid', values: ps.map(x => x.pre >= 20 ? +(100 * x.pre_cancelled / x.pre).toFixed(1) : null), color: slotColor(1) }] }));

    // ── explorer ──
    const box = h('div'); let last = null;
    const exp = card({ title: 'Where cancellations come from', span: 'c-12', cap: 'Pick what to slice by. "Vs average" shows how much more (or less) often this group cancels than the overall rate.', chart: box,
      tableFn: () => table({ filename: `cancellations_by_${ui.dim}.csv`, sortKey: 'cancelled', rows: last?.rows || [], columns: [
        { key: 'k', label: dims.find(d => d.key === ui.dim)?.label || 'Group', searchable: true, name: true },
        { key: 'volume', label: last?.unit === 'units' ? 'Units ordered' : 'Orders', align: 'r', fmt: fmt.int }, { key: 'cancelled', label: 'Cancelled', align: 'r', fmt: fmt.int },
        { key: 'rate', label: 'Cancel rate', align: 'r', fmt: v => fmt.pct(v) }, { key: 'lift', label: 'Vs average', align: 'r', fmt: v => v == null ? '–' : `${v.toFixed(2)}×` },
        { key: 'cancelled_value', label: 'Value cancelled', align: 'r', fmt: fmt.inr }, { key: 'after_dispatch', label: 'After dispatch', align: 'r', fmt: fmt.int }] }) });
    const sel = h('select', { class: 'select', 'aria-label': 'Slice by', onchange: e => { ui.dim = e.target.value; paint(); } },
      ['Product', 'Area', 'Order'].map(gp => h('optgroup', { label: gp }, dims.filter(d => d.group === gp).map(d => h('option', { value: d.key, selected: d.key === ui.dim ? true : null }, d.label)))));
    exp.querySelector('.card-tools').prepend(sel,
      selectEl([['cancelled', 'Most cancelled'], ['rate', 'Highest rate'], ['lift', 'Furthest above average']], ui.sort, v => { ui.sort = v; paint(); }, 'Sort by'),
      selectEl([[5, 'min 5'], [10, 'min 10'], [20, 'min 20'], [50, 'min 50']], ui.min, v => { ui.min = +v; paint(); }, 'Smallest group to show'));
    async function paint() {
      box.style.opacity = .55;
      const d = last = await api('/cancellations/by', { dim: ui.dim, min: ui.min });
      const rows = d.rows.slice().sort((a, b) => (b[ui.sort] ?? -1) - (a[ui.sort] ?? -1)).slice(0, 18);
      const unit = d.unit === 'units' ? 'units' : 'orders';
      box.replaceChildren(
        h('p', { class: 'cap muted', style: { margin: '0 0 8px', fontSize: '12.5px' }, text: `Overall: ${fmt.pct(d.overall_rate)} of ${unit} cancelled. ${d.hidden ? `${fmt.int(d.hidden)} groups with fewer than ${d.min} ${unit} are hidden.` : ''}` }),
        rows.length ? barList(rows, { name: r => String(r.k), value: r => r.cancelled, valueFmt: fmt.int, color: slotColor(8), extraLabel: 'Cancel rate',
          swatchFn: ui.dim === 'colour_family' ? r => swatch(r.k) : null, extra: r => fmt.pct(r.rate, 1),
          tip: r => [{ label: `${unit[0].toUpperCase() + unit.slice(1)} ordered`, value: fmt.int(r.volume) }, { label: 'Cancelled', value: fmt.int(r.cancelled) }, { label: 'Cancel rate', value: fmt.pct(r.rate) },
            { label: 'Vs average', value: r.lift == null ? '–' : `${r.lift.toFixed(2)}×` }, { label: 'Value cancelled', value: fmt.inrc(r.cancelled_value) }] })
          : h('p', { class: 'muted', text: 'No group has enough orders. Lower the minimum.' }));
      box.style.opacity = 1;
    }
    page.append(exp); after(paint);

    // ── how & why ──
    grid.append(card({ title: 'How orders were flagged as cancelled', span: 'c-6', cap: 'Three signals feed the status. Most arrive as a later status update, not at checkout.', cls: 'pad0',
      chart: table({ rows: s.sources, sortKey: 'n', columns: [{ key: 'k', label: 'Signal', name: true }, { key: 'n', label: 'Orders', align: 'r', fmt: fmt.int, bar: true }] }) }));
    grid.append(card({ title: 'Reason given', span: 'c-6', cap: 'Only checkout cancellations carry a reason; status updates do not say why.', cls: 'pad0',
      chart: table({ rows: s.reasons, sortKey: 'n', columns: [{ key: 'k', label: 'Reason', name: true }, { key: 'n', label: 'Orders', align: 'r', fmt: fmt.int, bar: true }] }) }));
    return page;
  },
};
