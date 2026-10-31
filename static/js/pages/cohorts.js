import { h, fmt, fmtDate, fmtMonth, kpi, card, table, notice, selectEl, slotColor, kpis } from '../ui.js';
import * as C from '../charts.js';

const ui = { gran: null, metric: 'pct' };
const METRICS = [['pct', 'Customers who ordered again'], ['orders', 'Orders per acquired customer'], ['revenue', 'Revenue per acquired customer']];

export default {
  title: 'Cohorts', compare: false,
  async render({ state, api, scope, after, brandName, rerender }) {
    ui.gran ||= state.brand === 'TIRLS' ? 'week' : 'month';
    if (state.brand === 'TIRLS' && ui.gran === 'month' && !ui._userSet) ui.gran = 'week';
    const d = await api('/customers/cohorts', { gran: ui.gran });
    const W = ui.gran === 'week' ? 'Week' : 'Month', unit = ui.gran === 'week' ? 'w' : 'm';
    const label = c => ui.gran === 'month' ? fmtMonth(c) : fmtDate(c, false);
    const cohorts = d.cohorts.filter(c => c.size > 0);
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Cohorts' }),
      h('p', { class: 'sub', text: `${brandName} · customers grouped by the ${ui.gran} of their first kept order, and how many came back. Cohorts are customers whose first order fell between ${fmtDate(scope.start, false)} and ${fmtDate(scope.end)}; their later orders are followed to ${fmtDate(d.last)}.` })),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Cohort period' }, [['month', 'Monthly'], ['week', 'Weekly']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(ui.gran === k), onclick: () => { ui.gran = k; ui._userSet = true; rerender(); } }, l)))));

    if (d.unreliable_before) page.append(notice(`<b>AHA cohorts before June 2025 are not reliable.</b> The data starts in mid-May 2025, so customers who had already bought earlier look "new" in the first months. Cohorts marked ⚠ are affected.`));
    if (!cohorts.length) { page.append(notice('No customers were acquired in this period. Widen the date range.')); return page; }

    // retention matrix
    const maxIdx = Math.min(Math.max(...cohorts.map(c => c.max_idx)), ui.gran === 'week' ? 14 : 17);
    const ys = cohorts.map(c => `${d.unreliable_before && c.cohort < d.unreliable_before ? '⚠ ' : ''}${label(c.cohort)} · ${fmt.int(c.size)}`);
    const xs = Array.from({ length: maxIdx }, (_, i) => `${unit}${i + 1}`);
    const val = (c, i) => {
      if (i > c.max_idx) return null;
      const cell = c.cells.find(x => x.i === i);
      if (ui.metric === 'pct') return cell ? +(100 * cell.customers / c.size).toFixed(1) : 0;
      if (ui.metric === 'orders') return cell ? +(cell.orders / c.size).toFixed(2) : 0;
      return cell ? Math.round(cell.revenue / c.size) : 0;
    };
    const cells = [];
    cohorts.forEach((c, yi) => { for (let i = 1; i <= maxIdx; i++) { const v = val(c, i); if (v != null) cells.push([i - 1, yi, v]); } });
    const vf = ui.metric === 'pct' ? v => `${v.toFixed(v < 10 ? 1 : 0)}%` : ui.metric === 'orders' ? v => v.toFixed(2) : v => fmt.inrc(v);

    // weighted retention curve + KPIs
    const curve = Array.from({ length: maxIdx }, (_, k) => {
      const i = k + 1, reach = cohorts.filter(c => c.max_idx >= i), base = reach.reduce((a, c) => a + c.size, 0);
      const back = reach.reduce((a, c) => a + (c.cells.find(x => x.i === i)?.customers || 0), 0);
      return { i, pct: base ? 100 * back / base : null, base };
    });
    const first = d.acquired ? 100 * d.repeaters / d.acquired : 0;
    page.append(kpis(
      kpi('Customers acquired', fmt.int(d.acquired), { hero: true, d: [h('span', { text: `${fmt.int(d.repeaters)} have placed a second kept order` })] }),
      kpi('Came back at least once', fmt.pct(first, 1), { sub: 'second kept order, any time since' }),
      kpi('Median days to a second order', d.median_gap == null ? '–' : fmt.int(d.median_gap), { sub: 'among those who came back' }),
      kpi(`Back the next ${W.toLowerCase()}`, curve[0]?.pct == null ? '–' : fmt.pct(curve[0].pct, 1), { sub: `ordered in the calendar ${W.toLowerCase()} after the first order${ui.gran === 'month' ? ' (not the same as within 30 days)' : ''}; averaged over cohorts old enough` }),
      kpi(`Back ${W.toLowerCase()} 3`, curve[2]?.pct == null ? '–' : fmt.pct(curve[2].pct, 1), { sub: `ordered in the third calendar ${W.toLowerCase()} after the first order` }),
      kpi('Cohorts shown', fmt.int(cohorts.length), { sub: `${ui.gran === 'week' ? 'weekly' : 'monthly'}` })));

    const grid = h('div', { class: 'grid' }); page.append(grid);
    const el1 = C.chartBox(); el1.style.height = `${Math.max(260, 60 + cohorts.length * 32)}px`;
    const mCard = card({ title: 'Retention by cohort', span: 'c-12', cap: `Each row is a cohort (${ui.gran} of first kept order · customers acquired). Each column is how many ${ui.gran}s later. Blank cells have not happened yet.`, chart: el1,
      tableFn: () => table({ filename: 'cohorts.csv', sortKey: 'cohort', sortDir: 1, rows: cohorts.map(c => ({ cohort: c.cohort, label: label(c.cohort), size: c.size, ...Object.fromEntries(xs.map((x, k) => [x, val(c, k + 1)])) })),
        columns: [{ key: 'cohort', label: `${W} acquired`, render: r => r.label }, { key: 'size', label: 'Customers', align: 'r', fmt: fmt.int }, ...xs.map(x => ({ key: x, label: x.toUpperCase(), align: 'r', fmt: v => v == null ? '' : vf(v) }))] }) });
    mCard.querySelector('.card-tools').prepend(selectEl(METRICS, ui.metric, v => { ui.metric = v; rerender(); }, 'Measure'));
    grid.append(mCard);
    after(() => C.heat(el1, { xs, ys, cells, valFmt: vf, tipLabel: METRICS.find(m => m[0] === ui.metric)[1], labels: cohorts.length * maxIdx <= 400, min: 0 }));

    const el2 = C.chartBox('short');
    grid.append(card({ title: 'Average retention curve', span: 'c-6', cap: `Share of acquired customers who ordered again, ${ui.gran}s after their first order, averaged over every cohort old enough to have reached that point.`, chart: el2,
      tableFn: () => table({ rows: curve, sortKey: 'i', sortDir: 1, columns: [{ key: 'i', label: `${W}s after first order`, fmt: v => `${W} ${v}` }, { key: 'pct', label: 'Ordered again', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v, 1) }, { key: 'base', label: 'Customers measured', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.line(el2, { x: curve.map(c => `${unit}${c.i}`), gran: 'cat', yFmt: v => `${v}%`, valFmt: v => fmt.pct(v, 1), series: [{ name: 'Ordered again', values: curve.map(c => c.pct == null ? null : +c.pct.toFixed(2)), color: slotColor(1), area: true }] }));

    const el3 = C.chartBox('short');
    grid.append(card({ title: 'How long until the second order', span: 'c-6', cap: 'For customers acquired in this period who did come back.', chart: el3,
      tableFn: () => table({ rows: d.gap_dist, columns: [{ key: 'k', label: 'Time to second order' }, { key: 'n', label: 'Customers', align: 'r', fmt: fmt.int }] }) }));
    after(() => C.bars(el3, { cats: d.gap_dist.map(g => g.k), valFmt: fmt.int, series: [{ name: 'Customers', values: d.gap_dist.map(g => g.n), color: slotColor(1) }] }));
    return page;
  },
};
