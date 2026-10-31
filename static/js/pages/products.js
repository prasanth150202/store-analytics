import { h, fmt, fmtDate, fmtBucket, kpi, card, legend, table, swatch, barList, selectEl, entityColor, slotColor, showTip, hideTip, notice, kpis } from '../ui.js';
import * as C from '../charts.js';

const DIMS = [['size', 'Size'], ['colour_family', 'Colour family'], ['colour_name', 'Colour (exact shade)'], ['colour_shade', 'Light / dark'],
  ['product_type', 'Garment type'], ['feeding', 'Feeding'], ['zip_style', 'Zip style'], ['neck', 'Neck'], ['sleeve', 'Sleeve'],
  ['pattern', 'Print / pattern'], ['fabric', 'Fabric'], ['range_tag', 'Range'], ['length_style', 'Length'],
  ['style_name', 'Design / style'], ['price_band', 'Price band'], ['product', 'Product']];
const METRICS = [['units_net', 'Units kept'], ['rev_net', 'Revenue kept'], ['orders', 'Orders'], ['cancel_rate', 'Cancel rate']];
const TREND_DIMS = ['colour_family', 'size', 'product_type', 'feeding', 'zip_style', 'pattern', 'price_band'].map(k => [k, DIMS.find(d => d[0] === k)[1]]);
const label = k => DIMS.find(d => d[0] === k)?.[1] || k;
const ui = { dim: 'colour_family', x: 'size', y: 'product_type', metric: 'units_net', trend: 'colour_family', ruler: 'all' };   // view settings survive date changes

export default {
  title: 'Products & variants', basis: true, compare: false,
  async render({ state, api, scope, after, brandName }) {
    const gross = state.basis === 'gross';
    const mk = gross ? 'units' : 'units_net', rk = gross ? 'rev_gross' : 'rev_net';
    const [sizes, fams, types, top, designs, cross] = await Promise.all([
      api('/products/by', { dim: 'size' }), api('/products/by', { dim: 'colour_family', limit: 14 }), api('/products/by', { dim: 'product_type' }),
      api('/products/top', { limit: 40, sort: mk === 'units' ? 'units' : 'units_net' }), api('/products/by', { dim: 'product', limit: 1 }),
      api('/products/crosstab', { x: 'size', y: 'product_type', metric: mk })]);
    const tot = sizes.rows.reduce((a, r) => ({ units: a.units + r.units, net: a.net + r.units_net, rev: a.rev + r[rk] }), { units: 0, net: 0, rev: 0 });
    const keptUnits = gross ? tot.units : tot.net;

    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Products & variants' }),
      h('p', { class: 'sub', text: `${brandName} · what sold, in which size and colour, and what came back. Units and revenue are ${gross ? 'before' : 'after'} removing cancelled orders.` }))));
    if (state.brand === 'TIRLS') page.append(notice('<b>Colour for Tirls is inferred.</b> Tirls names its designs ("Coffee Blossom", "Midnight Siesta") instead of describing colour, so colour families here are a best guess from the design name. Fix any wrong ones in <code>data/mappings/product_overrides.csv</code>.'));

    page.append(kpis(
      kpi(gross ? 'Units sold' : 'Units kept', fmt.int(keptUnits), { sub: `${fmt.int(tot.units - tot.net)} cancelled` }),
      kpi(gross ? 'Product revenue (gross)' : 'Product revenue (kept)', fmt.inrc(tot.rev), { sub: 'before shipping' }),
      kpi('Designs sold', fmt.int(designs.total_rows), { sub: `${fmt.int(top.rows[0]?.[mk] || 0)} units for the best one` }),
      kpi('Units cancelled', fmt.pct(tot.units ? 100 * (tot.units - tot.net) / tot.units : 0), { sub: 'share of units ordered' })));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    // ── size curve as a tape measure ──
    const rulerBox = h('div', { class: 'ruler-box' });
    const typeOptions = [['all', 'All garments'], ...cross.ys.map(y => [y, y])];
    function paintRuler() {
      const rows = cross.xs.map(sz => {
        const cells = cross.cells.filter(c => c.x === sz && (ui.ruler === 'all' || c.y === ui.ruler));
        return { k: sz, v: cells.reduce((a, c) => a + (c.v || 0), 0), cancelled: (sizes.rows.find(r => r.k === sz) || {}) };
      });
      const total = rows.reduce((a, r) => a + r.v, 0) || 1, max = Math.max(...rows.map(r => r.v), 1);
      rulerBox.replaceChildren(h('div', { class: 'ruler', role: 'list' }, rows.map(r => {
        const col = h('div', { class: 'col', role: 'listitem', tabindex: '0', 'aria-label': `${r.k}: ${fmt.int(r.v)} units` },
          h('div', { class: 'val' }, fmt.int(r.v), h('small', { text: fmt.pct(100 * r.v / total) })),
          h('div', { class: 'bar', style: { height: `${r.v ? Math.max(1.5, 100 * r.v / max * 0.8) : 0.5}%` } }),
          h('div', { class: 'tape' }, h('b', { text: r.k.startsWith('Free') ? 'Free' : r.k })));
        const tip = e => showTip(e.type === 'focus' ? { clientX: col.getBoundingClientRect().left + 30, clientY: col.getBoundingClientRect().top + 60 } : e,
          [{ label: gross ? 'Units' : 'Units kept', value: fmt.int(r.v) }, { label: 'Share of sizes', value: fmt.pct(100 * r.v / total) },
           ...(ui.ruler === 'all' ? [{ label: 'Cancel rate', value: fmt.pct(r.cancelled.cancel_rate) }, { label: 'Revenue kept', value: fmt.inrc(r.cancelled.rev_net) }] : [])], `Size ${r.k}`);
        col.addEventListener('pointermove', tip); col.addEventListener('focus', tip); col.addEventListener('pointerleave', hideTip); col.addEventListener('blur', hideTip);
        return col;
      })));
    }
    paintRuler();
    const rulerSel = selectEl(typeOptions, ui.ruler, v => { ui.ruler = v; paintRuler(); }, 'Garment type for the size curve');
    grid.append(card({ title: 'Size curve', span: 'c-6', cap: `Which sizes ${brandName} sells. Pick a garment to see its own curve.`,
      tools: [rulerSel], chart: rulerBox,
      tableFn: () => table({ filename: 'size_curve.csv', sortKey: 'ord', sortDir: 1, rows: sizes.rows.map((r, i) => ({ ...r, ord: i })), columns: [
        { key: 'k', label: 'Size', sortVal: r => r.ord }, { key: 'units', label: 'Units ordered', align: 'r', fmt: fmt.int }, { key: 'units_net', label: 'Units kept', align: 'r', fmt: fmt.int },
        { key: 'cancel_rate', label: 'Cancel rate', align: 'r', fmt: v => fmt.pct(v) }, { key: 'rev_net', label: 'Revenue kept', align: 'r', fmt: fmt.inr }] }) }));

    // ── best sellers ──
    grid.append(card({ title: 'Best sellers', span: 'c-6', cap: 'Designs ranked by units. The strip shows the size mix of each.', cls: 'pad0',
      chart: table({ filename: 'best_sellers.csv', sortKey: mk, search: 'Search designs', limit: 12, rows: top.rows, columns: [
        { key: 'title', label: 'Design', name: true, searchable: true, render: r => h('span', null, swatch(r.colour_family), r.title) },
        { key: mk, label: gross ? 'Units' : 'Units kept', align: 'r', fmt: fmt.int, bar: true },
        { key: rk, label: 'Revenue', align: 'r', fmt: fmt.inrc },
        { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 0) }] }) }));

    // ── colour families as swatches ──
    const famRows = fams.rows.filter(r => r.k !== 'Unknown').concat(fams.rows.filter(r => r.k === 'Unknown'));
    grid.append(card({ title: 'Colour families', span: 'c-6', cap: state.brand === 'TIRLS' ? 'Inferred from design names (low confidence).' : 'The colour the garment is named for, grouped into families.',
      chart: barList(famRows, { name: r => r.k, value: r => r[mk], swatchFn: r => swatch(r.k), extra: r => fmt.pct(r.cancel_rate, 0), extraLabel: 'Cancelled',
        tip: r => [{ label: 'Units', value: fmt.int(r[mk]) }, { label: 'Revenue', value: fmt.inrc(r[rk]) }, { label: 'Designs', value: fmt.int(r.products) }, { label: 'Cancel rate', value: fmt.pct(r.cancel_rate) }] }),
      tableFn: () => table({ filename: 'colour_families.csv', sortKey: mk, rows: fams.rows, columns: [{ key: 'k', label: 'Colour family', searchable: true }, { key: mk, label: 'Units', align: 'r', fmt: fmt.int },
        { key: rk, label: 'Revenue', align: 'r', fmt: fmt.inr }, { key: 'products', label: 'Designs', align: 'r', fmt: fmt.int }, { key: 'cancel_rate', label: 'Cancel rate', align: 'r', fmt: v => fmt.pct(v) }] }) }));

    // ── garment type ──
    const elT = C.chartBox();
    grid.append(card({ title: 'Garment types', span: 'c-6', cap: 'Nighty, frock, kaftan and so on, read from the product title.', chart: elT,
      tableFn: () => table({ filename: 'garment_types.csv', sortKey: mk, rows: types.rows, columns: [{ key: 'k', label: 'Type' }, { key: mk, label: 'Units', align: 'r', fmt: fmt.int },
        { key: rk, label: 'Revenue', align: 'r', fmt: fmt.inr }, { key: 'cancel_rate', label: 'Cancel rate', align: 'r', fmt: v => fmt.pct(v) }] }) }));
    after(() => C.bars(elT, { cats: types.rows.map(r => r.k), horizontal: true, valFmt: fmt.int, series: [{ name: 'Units', values: types.rows.map(r => r[mk]), color: slotColor(1) }] }));

    // ── analyse by any attribute ──
    page.append(h('hr', { class: 'stitch' }));
    const byBox = h('div'), byCard = card({ title: 'Analyse by any attribute', span: 'c-12', cap: 'Pick an attribute to see how it sells and how often it comes back. Every attribute here is read from the product title.', chart: byBox, tools: [] });
    const dimSel = selectEl(DIMS, ui.dim, v => { ui.dim = v; paintBy(); }, 'Attribute to analyse');
    byCard.querySelector('.card-tools').prepend(dimSel);
    async function paintBy() {
      byBox.style.opacity = .55;
      const d = await api('/products/by', { dim: ui.dim, limit: 40 });
      const rows = d.rows.slice(0, 40);
      const body = h('div', { class: 'grid', style: { gap: '20px' } },
        h('div', { class: 'c-5' }, h('div', { class: 'sub-h', text: `${label(ui.dim)}: units ${gross ? 'ordered' : 'kept'}` }),
          barList(rows.slice(0, 14), { name: r => r.k, value: r => r[mk], extra: r => fmt.pct(r.cancel_rate, 0), extraLabel: 'Cancelled', swatchFn: ui.dim === 'colour_family' ? r => swatch(r.k) : null,
            tip: r => [{ label: 'Units', value: fmt.int(r[mk]) }, { label: 'Revenue', value: fmt.inrc(r[rk]) }, { label: 'Avg price', value: fmt.inr(r.avg_price) }, { label: 'Cancel rate', value: fmt.pct(r.cancel_rate) }] })),
        h('div', { class: 'c-7' }, table({ filename: `by_${ui.dim}.csv`, sortKey: ui.dim === 'size' || ui.dim === 'price_band' ? null : mk, rows, columns: [
          { key: 'k', label: label(ui.dim), searchable: true, name: true, render: r => h('span', null, ui.dim === 'colour_family' ? swatch(r.k) : '', r.k) },
          { key: mk, label: 'Units', align: 'r', fmt: fmt.int, bar: true }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int },
          { key: rk, label: 'Revenue', align: 'r', fmt: fmt.inrc }, { key: 'avg_price', label: 'Avg price', align: 'r', fmt: fmt.inr },
          { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 1) }] })));
      byBox.replaceChildren(body); byBox.style.opacity = 1;
    }
    page.append(byCard);
    after(paintBy);

    // ── variant explorer (heat map) ──
    let exData = [];
    const exBox = h('div'), exCard = card({ title: 'Variant explorer', span: 'c-12', cap: 'Cross any two attributes. Darker means more. Switch the measure to find combinations that sell well or come back often.', chart: exBox,
      tableFn: () => table({ filename: 'variant_explorer.csv', sortKey: 'v', rows: exData, columns: [{ key: 'y', label: label(ui.y), searchable: true }, { key: 'x', label: label(ui.x), searchable: true },
        { key: 'v', label: METRICS.find(m => m[0] === ui.metric)[1], align: 'r', fmt: v => ui.metric === 'rev_net' ? fmt.inr : ui.metric === 'cancel_rate' ? fmt.pct(v) : fmt.int(v) }, { key: 'units', label: 'Units ordered', align: 'r', fmt: fmt.int }] }) });
    const exTools = exCard.querySelector('.card-tools');
    exTools.prepend(selectEl(DIMS, ui.x, v => { ui.x = v; paintEx(); }, 'Across'), h('span', { class: 'muted', style: { alignSelf: 'center', padding: '0 4px' }, text: '×' }),
      selectEl(DIMS, ui.y, v => { ui.y = v; paintEx(); }, 'Down'), selectEl(METRICS, ui.metric, v => { ui.metric = v; paintEx(); }, 'Measure'));
    async function paintEx() {
      exBox.style.opacity = .55;
      const m = ui.metric === 'units_net' && gross ? 'units' : ui.metric;
      const d = await api('/products/crosstab', { x: ui.x, y: ui.y, metric: m });
      const vf = m === 'rev_net' || m === 'rev_gross' ? fmt.inrc : m === 'cancel_rate' ? v => fmt.pct(v, 0) : fmt.int;
      const xi = Object.fromEntries(d.xs.map((v, i) => [v, i])), yi = Object.fromEntries(d.ys.map((v, i) => [v, i]));
      const cells = d.cells.filter(c => !(m === 'cancel_rate' && c.units < 10)).map(c => [xi[c.x], yi[c.y], c.v]);
      exData = d.cells.filter(c => !(m === 'cancel_rate' && c.units < 10));
      const el = C.chartBox(); el.style.height = `${Math.max(240, 56 + d.ys.length * 36)}px`;
      C.releaseWithin(exBox);
      const tw = h('div', { style: { display: 'none' } });
      exBox.replaceChildren(el);
      C.heat(el, { xs: d.xs, ys: d.ys, cells, valFmt: vf, labels: d.xs.length * d.ys.length <= 150, tipLabel: METRICS.find(x => x[0] === ui.metric)[1], min: m === 'cancel_rate' ? 0 : 0 });
      exBox.append(h('p', { class: 'cap muted', style: { marginTop: '8px', fontSize: '12.5px' }, text: m === 'cancel_rate' ? 'Combinations with fewer than 10 units are left blank because their cancel rate would be noise.' : `Showing ${fmt.int(cells.length)} combinations of ${label(ui.y)} and ${label(ui.x)}.` }));
      exBox.style.opacity = 1;
    }
    page.append(exCard);
    after(paintEx);

    // ── trends ──
    let trData = { keys: [], series: [], gran: 'month' };
    const trBox = h('div'), trCard = card({ title: 'How the mix changes over time', span: 'c-12', cap: 'Units kept per period for the six biggest values of the attribute you pick.', chart: trBox,
      tableFn: () => table({ filename: 'mix_over_time.csv', sortKey: 'd', sortDir: 1, rows: trData.series, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, trData.gran) },
        ...trData.keys.map(k => ({ key: k, label: k, align: 'r', fmt: fmt.int }))] }) });
    trCard.querySelector('.card-tools').prepend(selectEl(TREND_DIMS, ui.trend, v => { ui.trend = v; paintTr(); }, 'Attribute for the trend'));
    async function paintTr() {
      trBox.style.opacity = .55;
      const d = await api('/products/trend', { dim: ui.trend, top: 6 });
      trData = d;
      C.releaseWithin(trBox);
      if (!d.keys.length) { trBox.replaceChildren(h('p', { class: 'muted', text: 'Nothing sold in this period.' })); trBox.style.opacity = 1; return; }
      const el = C.chartBox();
      trBox.replaceChildren(legend(d.keys.map(k => ({ name: k, color: entityColor('trend:' + ui.trend, k) }))), el);
      C.line(el, { x: d.series.map(s => s.d), gran: d.gran, yFmt: fmt.int, series: d.keys.map(k => ({ name: k, values: d.series.map(s => s[k]), color: entityColor('trend:' + ui.trend, k) })) });
      trBox.style.opacity = 1;
    }
    page.append(trCard);
    after(paintTr);

    // ── product x size ──
    const vr = await api('/products/variants', { limit: 60, sort: mk === 'units' ? 'units' : 'units_net' });
    page.append(card({ title: 'Best-selling variants', span: 'c-12', cap: 'A variant is one design in one size. Sorted by units.', cls: 'pad0',
      chart: table({ filename: 'variants.csv', sortKey: mk, search: 'Search designs or sizes', limit: 25, rows: vr.rows, columns: [
        { key: 'title', label: 'Design', name: true, searchable: true }, { key: 'size', label: 'Size', searchable: true }, { key: 'colour_name', label: 'Colour', searchable: true },
        { key: mk, label: 'Units', align: 'r', fmt: fmt.int, bar: true }, { key: rk, label: 'Revenue', align: 'r', fmt: fmt.inr },
        { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 0) }] }) }));
    return page;
  },
};
