// AHA only. Compares style details (zip, neck, feeding, sleeve, length, print, fabric, range, colour, price band)
// on sales per DESIGN per month on sale, so a detail carried by many designs does not win just by being common.
import { h, fmt, fmtDate, kpi, kpis, card, table, notice, selectEl, barList, swatch, slotColor, delta, showTip, hideTip } from '../ui.js';
import * as C from '../charts.js';

const ATTRS = [['product_type', 'Garment type'], ['feeding', 'Feeding'], ['zip_style', 'Zip style'], ['neck', 'Neck'], ['sleeve', 'Sleeve'], ['length_style', 'Length'],
  ['pattern', 'Print / pattern'], ['fabric', 'Fabric'], ['range_tag', 'Range'], ['colour_family', 'Colour family'], ['price_band', 'Price band']];
const NS = 'Not specified';
const NSLABEL = { feeding: 'No feeding label', zip_style: 'Zip not stated', neck: 'Neck not stated', sleeve: 'Sleeve not stated', length_style: 'Length not stated', fabric: 'Fabric not stated' };
const NSSET = new Set([NS, ...Object.values(NSLABEL)]);
const isNs = v => NSSET.has(v);
const MAPM = [['ratio', 'Performance vs average'], ['velAvg', 'Units per design per month'], ['kept', 'Units kept'], ['n', 'Designs'], ['cancel', 'Cancel rate']];
const PRESETS = [['Feeding × zip', ['feeding', 'zip_style']], ['Type × zip × feeding', ['product_type', 'zip_style', 'feeding']], ['Type × neck', ['product_type', 'neck']],
  ['Print × colour', ['pattern', 'colour_family']], ['Type × length', ['product_type', 'length_style']], ['Zip × price', ['zip_style', 'price_band']]];
const ui = { combo: ['product_type', 'feeding', 'zip_style'], min: 5, x: 'zip_style', y: 'product_type', metric: 'ratio', mom: 'zip_style', sizeAttr: 'zip_style', drillAttr: 'zip_style', drillVal: null };
const label = k => ATTRS.find(a => a[0] === k)?.[1] ?? k;

// ── aggregation ──
function groupBy(rows, keys) {
  const m = new Map();
  for (const r of rows) {
    const k = keys.map(x => r[x]).join('\u0001');
    let g = m.get(k);
    if (!g) { g = { keys: keys.map(x => r[x]), n: 0, units: 0, kept: 0, rev: 0, vel: 0, adjSum: 0, cur: 0, prev: 0, designs: [] }; m.set(k, g); }
    g.n++; g.units += r.units; g.kept += r.units_net; g.rev += r.rev_net; g.vel += r.vel; g.adjSum += r.adj; g.cur += r.cur; g.prev += r.prev; g.designs.push(r);
  }
  return [...m.values()];
}
function finish(g, T) {
  g.label = g.keys.join(' + '); g.velAvg = g.vel / g.n; g.upd = g.kept / g.n; g.ratio = T.velAvg ? g.velAvg / T.velAvg : null; g.adj = g.adjSum / g.n;
  g.shareU = 100 * g.kept / (T.kept || 1); g.shareD = 100 * g.n / T.n; g.cancel = g.units ? 100 * (g.units - g.kept) / g.units : 0;
  g.price = g.kept ? g.rev / g.kept : null; g.verdict = verdict(g); return g;
}
// A detail only counts as over/under-performing when it is at least 15% off the average design AND still
// at least 10% off once each design is compared with the designs launched in the same quarter. Otherwise the
// gap may only reflect when its designs happened to launch.
function verdict(g) {
  if (g.n < 5) return ['Few designs', 'few'];
  if (g.ratio >= 1.15) return g.adj >= 1.10 ? ['Over-performs ▲', 'up'] : ['Unclear: launch timing', 'weak'];
  if (g.ratio <= 0.85) return g.adj <= 0.90 ? ['Under-performs ▼', 'down'] : ['Unclear: launch timing', 'weak'];
  return ['On par', 'flat'];
}
const verdictNode = g => h('span', { class: `verdict ${g.verdict[1]}`, text: g.verdict[0] });
const arrow = g => ({ up: ' ▲', down: ' ▼', weak: ' ?' })[g.verdict[1]] || '';
const isNS = g => g.keys.some(k => k === NS || k === 'Plain / other' && false);

export default {
  title: 'Variant lab', compare: false,
  async render({ state, api, scope, after, rerender }) {
    const d = await api('/variants/designs');
    const rows = d.rows; rows.forEach(r => { r.vel = r.units_net / (Math.max(r.days_on_sale, 30) / 30); for (const k in NSLABEL) if (r[k] === NS) r[k] = NSLABEL[k]; });
    const T = { n: rows.length, units: rows.reduce((a, r) => a + r.units, 0), kept: rows.reduce((a, r) => a + r.units_net, 0), rev: rows.reduce((a, r) => a + r.rev_net, 0) };
    T.velAvg = rows.reduce((a, r) => a + r.vel, 0) / (T.n || 1);
    // Each design against the average of the designs first sold in the same quarter (below 5 designs: the overall average).
    const qk = r => `${r.first_sold.slice(0, 4)}-Q${Math.floor((+r.first_sold.slice(5, 7) - 1) / 3) + 1}`, qs = {};
    rows.forEach(r => { const q = qs[qk(r)] ||= { n: 0, v: 0 }; q.n++; q.v += r.vel; });
    rows.forEach(r => { const q = qs[qk(r)], base = q.n >= 5 ? q.v / q.n : T.velAvg; r.adj = base ? r.vel / base : 1; });
    const fin = gs => gs.map(g => finish(g, T));
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Variant lab' }),
      h('p', { class: 'sub', text: `AHA's style details compared fairly. A detail carried by many designs sells more in total just by being common, so everything here is measured per design, per month on sale. "1.00×" is the average design. Period: ${fmtDate(scope.start, false)} to ${fmtDate(scope.end)}.` }))));

    // ── the leaderboard across every detail ──
    const everything = ATTRS.flatMap(([k, l]) => fin(groupBy(rows, [k])).filter(g => !isNs(g.keys[0]) && g.n >= 8).map(g => ({ ...g, attr: l, attrKey: k })));
    const best = everything.filter(g => g.verdict[1] === 'up').sort((a, b) => b.ratio - a.ratio), worst = everything.filter(g => g.verdict[1] === 'down').sort((a, b) => a.ratio - b.ratio);
    const unclear = everything.filter(g => g.verdict[1] === 'weak').length;
    page.append(kpis(
      kpi('Typical design sells', fmt.dec(T.velAvg, 1), { hero: true, d: [h('span', { text: `units a month · ${fmt.int(T.n)} designs sold ${fmt.int(T.kept)} kept units in this period` })] }),
      kpi('Strongest detail', best[0] ? best[0].keys[0] : '–', { sub: best[0] ? `${best[0].attr} · ${best[0].ratio.toFixed(2)}× average · ${fmt.int(best[0].n)} designs` : '' }),
      kpi('Weakest detail', worst[0] ? worst[0].keys[0] : '–', { sub: worst[0] ? `${worst[0].attr} · ${worst[0].ratio.toFixed(2)}× average · ${fmt.int(worst[0].n)} designs` : '' }),
      kpi('Details compared', fmt.int(everything.length), { sub: `${fmt.int(best.length)} above, ${fmt.int(worst.length)} below, ${fmt.int(unclear)} unclear` }),
      kpi('Cancelled units', fmt.pct(T.units ? 100 * (T.units - T.kept) / T.units : 0), { sub: 'of units ordered' })));

    const grid = h('div', { class: 'grid' }); page.append(grid);
    const lbCols = [{ key: 'label', label: 'Detail', name: true, render: g => h('span', null, g.attrKey === 'colour_family' ? swatch(g.keys[0]) : '', h('b', { text: g.keys[0] }), h('small', { class: 'muted', style: { marginLeft: '6px' }, text: g.attr })), sortable: false },
      { key: 'n', label: 'Designs', align: 'r', fmt: fmt.int }, { key: 'velAvg', label: 'Per mo', align: 'r', fmt: v => fmt.dec(v, 1) },
      { key: 'ratio', label: 'Vs avg', align: 'r', fmt: v => `${v.toFixed(2)}×` }, { key: 'adj', label: 'Adj.', align: 'r', fmt: v => `${v.toFixed(2)}×` },
      { key: 'cancel', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 0) }];
    grid.append(card({ title: 'Details that sell best', span: 'c-6', cls: 'pad0', cap: 'Details carried by at least 8 designs that sell at least 15% above the average design per month, and still do when compared only with designs launched in the same quarter ("Adj." column).',
      chart: table({ filename: 'best_details.csv', sortKey: 'ratio', rows: best.slice(0, 10), columns: lbCols }) }));
    grid.append(card({ title: 'Details that sell worst', span: 'c-6', cls: 'pad0', cap: 'The other end: at least 15% below the average design, and still below when compared with designs from the same launch quarter (\"Adj.\" column). Weak does not always mean drop it: check how many designs carry it.',
      chart: table({ filename: 'worst_details.csv', sortKey: 'ratio', sortDir: 1, rows: worst.slice(0, 10), columns: lbCols }) }));

    // ── scoreboard: one card per attribute ──
    page.append(h('hr', { class: 'stitch' }));
    page.append(h('h2', { class: 'sub-h', style: { fontSize: '16px' }, text: 'Every style detail, one attribute at a time' }));
    page.append(h('p', { class: 'cap muted', style: { margin: '0 0 12px', fontSize: '13px' }, text: 'Bars show units sold per design per month. The tick is the average design. ▲ means at least 15% above average and ▼ at least 15% below, and the gap still holds when each design is compared only with designs launched in the same quarter. ? means the gap looks real but launch timing may explain it, so do not act on it alone. Details with fewer than 5 designs are too small to judge.' }));
    const sgrid = h('div', { class: 'grid' }); page.append(sgrid);
    const cards = ATTRS.map(([k, l]) => {
      const gs = fin(groupBy(rows, [k])), sorted = gs.filter(g => !isNs(g.keys[0])).sort((a, b) => b.velAvg - a.velAvg).concat(gs.filter(g => isNs(g.keys[0])));
      return { k, l, gs: sorted };
    });
    cards.sort((a, b) => b.gs.length - a.gs.length);   // longest lists first, so the two cards on a row are about the same height
    const vmax = Math.max(...cards.flatMap(c => c.gs.filter(g => g.n >= 3).map(g => g.velAvg)), T.velAvg, 1);
    for (const c of cards) {
      const ns = c.gs.find(g => isNs(g.keys[0])), nsShare = ns ? 100 * ns.n / T.n : 0;
      sgrid.append(card({ title: c.l, span: 'c-6', cap: nsShare > 40 ? `${fmt.pct(nsShare, 0)} of designs do not say this in the title, so they sit in the grey "not stated" row.` : `${fmt.int(c.gs.filter(g => !isNs(g.keys[0])).length)} values.`,
        chart: barList(c.gs, { name: g => g.keys[0], value: g => g.velAvg, valueFmt: v => fmt.dec(v, 1), max: vmax, marker: T.velAvg, markerLabel: 'Average design', extraLabel: 'Vs avg',
          swatchFn: c.k === 'colour_family' ? g => swatch(g.keys[0]) : null, color: g => g.n < 5 || isNs(g.keys[0]) ? 'var(--line-strong)' : 'var(--s1)',
          nameNode: g => h('span', null, g.keys[0], h('small', { text: `${fmt.int(g.n)} design${g.n === 1 ? '' : 's'}` })),
          extra: g => g.n < 5 ? 'few' : `${g.ratio.toFixed(2)}×${arrow(g)}`,
          tip: g => [{ label: 'Designs', value: fmt.int(g.n) }, { label: 'Units kept', value: fmt.int(g.kept) }, { label: 'Share of units', value: fmt.pct(g.shareU, 1) }, { label: 'Share of designs', value: fmt.pct(g.shareD, 1) },
            { label: 'Per design per month', value: fmt.dec(g.velAvg, 1) }, { label: 'Vs average design', value: g.ratio == null ? '–' : `${g.ratio.toFixed(2)}×` }, { label: 'Avg price', value: fmt.inr(g.price) }, { label: 'Cancel rate', value: fmt.pct(g.cancel, 1) }] }),
        tableFn: () => table({ filename: `variants_${c.k}.csv`, sortKey: 'velAvg', rows: c.gs, columns: [{ key: 'label', label: c.l, searchable: true }, { key: 'n', label: 'Designs', align: 'r', fmt: fmt.int },
          { key: 'kept', label: 'Units kept', align: 'r', fmt: fmt.int }, { key: 'shareU', label: 'Share of units', align: 'r', fmt: v => fmt.pct(v, 1) }, { key: 'shareD', label: 'Share of designs', align: 'r', fmt: v => fmt.pct(v, 1) },
          { key: 'velAvg', label: 'Per design / month', align: 'r', fmt: v => fmt.dec(v, 1) }, { key: 'ratio', label: 'Vs average', align: 'r', fmt: v => v == null ? '–' : `${v.toFixed(2)}×` }, { key: 'adj', label: 'Adj.', align: 'r', fmt: v => `${v.toFixed(2)}×` },
          { key: 'price', label: 'Avg price', align: 'r', fmt: fmt.inr }, { key: 'cancel', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 1) }] }) }));
    }

    // ── winning combinations ──
    page.append(h('hr', { class: 'stitch' }));
    const comboBox = h('div'), pickRow = h('div', { class: 'pickrow' });
    const comboCard = card({ title: 'Winning combinations', span: 'c-12', cap: 'Pick two to four details and see which combinations sell best per design. Combinations carried by too few designs are hidden.', chart: h('div', null, pickRow, comboBox) });
    comboCard.querySelector('.card-tools').prepend(selectEl([[3, 'at least 3 designs'], [5, 'at least 5 designs'], [8, 'at least 8 designs'], [12, 'at least 12 designs']], ui.min, v => { ui.min = +v; paintCombo(); }, 'Smallest combination to show'));
    function paintPicks() {
      pickRow.replaceChildren(h('span', { class: 'muted', style: { fontSize: '12.5px', marginRight: '4px' }, text: 'Quick picks' }),
        ...PRESETS.map(([l, keys]) => h('button', { class: 'pick', type: 'button', onclick: () => { ui.combo = keys.slice(); paintPicks(); paintCombo(); } }, l)),
        h('span', { style: { width: '14px' } }), h('span', { class: 'muted', style: { fontSize: '12.5px', marginRight: '4px' }, text: 'Or choose' }),
        ...ATTRS.map(([k, l]) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(ui.combo.includes(k)), onclick: () => {
          ui.combo = ui.combo.includes(k) ? ui.combo.filter(x => x !== k) : ui.combo.concat(k).slice(-4); if (!ui.combo.length) ui.combo = [k]; paintPicks(); paintCombo(); } }, l)));
    }
    function paintCombo() {
      const gs = fin(groupBy(rows, ui.combo)).filter(g => g.n >= ui.min).sort((a, b) => b.ratio - a.ratio);
      const top = gs.slice(0, 12);
      comboBox.replaceChildren(
        h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12.5px' }, text: `${fmt.int(gs.length)} combinations of ${ui.combo.map(label).join(' + ')} are carried by at least ${ui.min} designs. Bars show sales per design per month; the tick is the average design.` }),
        gs.length ? h('div', { class: 'grid', style: { gap: '20px' } },
          h('div', { class: 'c-12' }, barList(top, { cls: 'wide', name: g => g.label, value: g => g.velAvg, valueFmt: v => fmt.dec(v, 1), marker: T.velAvg, extraLabel: 'Vs avg', extra: g => `${g.ratio.toFixed(2)}×${arrow(g)}`,
            nameNode: g => h('span', null, g.label, h('small', { text: `${fmt.int(g.n)}` })), tip: g => [{ label: 'Designs', value: fmt.int(g.n) }, { label: 'Units kept', value: fmt.int(g.kept) }, { label: 'Per design per month', value: fmt.dec(g.velAvg, 1) }, { label: 'Cancel rate', value: fmt.pct(g.cancel, 1) }] })),
          h('div', { class: 'c-12' }, table({ filename: 'combinations.csv', sortKey: 'ratio', rows: gs, limit: 40, search: 'Search combinations', columns: [
            { key: 'label', label: 'Combination', name: true, searchable: true }, { key: 'n', label: 'Designs', align: 'r', fmt: fmt.int }, { key: 'kept', label: 'Units kept', align: 'r', fmt: fmt.int },
            { key: 'velAvg', label: 'Per design / mo', align: 'r', fmt: v => fmt.dec(v, 1) }, { key: 'ratio', label: 'Vs avg', align: 'r', fmt: v => `${v.toFixed(2)}×` },
            { key: 'adj', label: 'Adj.', align: 'r', fmt: v => `${v.toFixed(2)}×` }, { key: 'verdict', label: 'Verdict', render: g => verdictNode(g), sortVal: g => g.ratio }, { key: 'cancel', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 0) }, { key: 'price', label: 'Avg price', align: 'r', fmt: fmt.inr }] })))
          : h('p', { class: 'muted', text: 'No combination has enough designs. Lower the minimum or pick fewer details.' }));
    }
    page.append(comboCard); paintPicks(); paintCombo();

    // ── two-way map ──
    const mapBox = h('div');
    const mapCard = card({ title: 'Two-way map', span: 'c-12', cap: 'Cross any two details. For "performance vs average", blue is above the average design and red below it. Cells with fewer than 3 designs are left blank.', chart: mapBox });
    mapCard.querySelector('.card-tools').prepend(selectEl(ATTRS, ui.x, v => { ui.x = v; paintMap(); }, 'Across'), h('span', { class: 'muted', style: { alignSelf: 'center', padding: '0 4px' }, text: '×' }),
      selectEl(ATTRS, ui.y, v => { ui.y = v; paintMap(); }, 'Down'), selectEl(MAPM, ui.metric, v => { ui.metric = v; paintMap(); }, 'Measure'));
    function paintMap() {
      C.releaseWithin(mapBox);
      if (ui.x === ui.y) { mapBox.replaceChildren(h('p', { class: 'muted', text: 'Pick two different details.' })); return; }
      const gs = fin(groupBy(rows, [ui.x, ui.y])), small = ['ratio', 'velAvg', 'cancel'].includes(ui.metric);
      const order = (idx) => { const t = {}; gs.forEach(g => t[g.keys[idx]] = (t[g.keys[idx]] || 0) + g.kept); return Object.keys(t).sort((a, b) => isNs(a) - isNs(b) || t[b] - t[a]).slice(0, 14); };
      const xs = order(0), ys = order(1), xi = Object.fromEntries(xs.map((v, i) => [v, i])), yi = Object.fromEntries(ys.map((v, i) => [v, i]));
      const val = g => ui.metric === 'ratio' ? +g.ratio.toFixed(2) : ui.metric === 'velAvg' ? +g.velAvg.toFixed(1) : ui.metric === 'cancel' ? +g.cancel.toFixed(1) : g[ui.metric];
      const cells = gs.filter(g => g.keys[0] in xi && g.keys[1] in yi && !(small && g.n < 3)).map(g => [xi[g.keys[0]], yi[g.keys[1]], val(g)]);
      const vf = ui.metric === 'ratio' ? v => `${v.toFixed(2)}×` : ui.metric === 'velAvg' ? v => fmt.dec(v, 1) : ui.metric === 'cancel' ? v => fmt.pct(v, 0) : fmt.int;
      const el = C.chartBox(); el.style.height = `${Math.max(240, 60 + ys.length * 38)}px`; mapBox.replaceChildren(el);
      C.heat(el, { xs, ys, cells, valFmt: vf, ramp: ui.metric === 'ratio' ? 'div' : 'seq', min: ui.metric === 'ratio' ? 0 : 0, max: ui.metric === 'ratio' ? 2 : undefined, labels: cells.length <= 160, tipLabel: MAPM.find(m => m[0] === ui.metric)[1] });
      mapBox.append(h('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '12.5px' }, text: `${label(ui.y)} down, ${label(ui.x)} across. Showing the ${xs.length} × ${ys.length} biggest values.` }));
    }
    page.append(mapCard); after(paintMap);

    // ── rising and falling ──
    const momBox = h('div'), w = d.window;
    const momCard = card({ title: 'Rising and falling details', span: 'c-6', cap: `Units kept in the latest ${w.n} days (${fmtDate(w.cur_start, false)} to ${fmtDate(w.cur_end, false)}) against the ${w.n} days before.`, chart: momBox });
    momCard.querySelector('.card-tools').prepend(selectEl(ATTRS, ui.mom, v => { ui.mom = v; paintMom(); }, 'Detail'));
    function paintMom() {
      const gs = fin(groupBy(rows, [ui.mom])).filter(g => g.cur + g.prev >= 10).sort((a, b) => b.cur - a.cur);
      const tc = gs.reduce((a, g) => a + g.cur, 0) || 1, tp = gs.reduce((a, g) => a + g.prev, 0) || 1;
      gs.forEach(g => { g.sc = 100 * g.cur / tc; g.sp = 100 * g.prev / tp; g.shift = g.sc - g.sp; });
      const overall = rows.reduce((a, r) => [a[0] + r.cur, a[1] + r.prev], [0, 0]);
      momBox.replaceChildren(h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12.5px' }, text: `Across all designs, kept units went from ${fmt.int(overall[1])} to ${fmt.int(overall[0])} (${overall[1] ? (100 * (overall[0] - overall[1]) / overall[1]).toFixed(0) : '0'}%). Read "Share shift" to see which details gained or lost ground against that background.` }),
        gs.length ? table({ filename: 'momentum.csv', sortKey: 'cur', rows: gs, columns: [{ key: 'label', label: label(ui.mom), name: true }, { key: 'cur', label: 'Latest', align: 'r', fmt: fmt.int },
        { key: 'prev', label: 'Before', align: 'r', fmt: fmt.int }, { key: 'chg', label: 'Change', align: 'r', sortVal: g => g.prev ? (g.cur - g.prev) / g.prev : 0, render: g => delta(g.cur, g.prev) || '–' },
        { key: 'shift', label: 'Share shift', align: 'r', fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(1)} pp` }] }) : h('p', { class: 'muted', text: 'Too few sales in the two windows to compare.' }));
    }
    mapCard.after(momCard); paintMom();

    // ── size mix ──
    const szBox = h('div');
    const szCard = card({ title: 'Size mix by detail', span: 'c-6', cap: 'Share of each detail\'s kept units by size. Compare a row with "All designs" to see where a detail skews.', chart: szBox });
    szCard.querySelector('.card-tools').prepend(selectEl(ATTRS, ui.sizeAttr, v => { ui.sizeAttr = v; paintSz(); }, 'Detail'));
    function paintSz() {
      C.releaseWithin(szBox);
      const sizes = d.size_order.filter(s => s !== 'Unknown' && rows.some(r => (r.sizes[s] || 0) > 0));
      const mk = (name, rs) => { const tot = rs.reduce((a, r) => a + sizeUnits(r, sizes), 0); return tot ? { name, tot, pct: sizes.map(s => 100 * rs.reduce((a, r) => a + (r.sizes[s] || 0), 0) / tot) } : null; };
      const gs = groupBy(rows, [ui.sizeAttr]).filter(g => g.kept >= 40 && !isNs(g.keys[0])).sort((a, b) => b.kept - a.kept).slice(0, 10);
      const lines = [mk('All designs', rows), ...gs.map(g => mk(g.keys[0], g.designs))].filter(Boolean);
      const el = C.chartBox(); el.style.height = `${Math.max(220, 56 + lines.length * 34)}px`; szBox.replaceChildren(el);
      C.heat(el, { xs: sizes.map(s => s.startsWith('Free') ? 'Free' : s), ys: lines.map(l => `${l.name}`), cells: lines.flatMap((l, yi) => l.pct.map((p, xi) => [xi, yi, +p.toFixed(1)])), valFmt: v => `${Math.round(v)}%`, tipLabel: 'Share of kept units', min: 0 });
    }
    const sizeUnits = (r, sizes) => sizes.reduce((a, s) => a + (r.sizes[s] || 0), 0);
    momCard.after(szCard); after(paintSz);

    // ── drill into one detail ──
    const drillBox = h('div');
    const drillCard = card({ title: 'Drill into one detail', span: 'c-12', cap: 'Pick a detail and a value to see the designs behind it, their sizes and how each is doing.', chart: drillBox });
    const valSel = h('select', { class: 'select', 'aria-label': 'Value', onchange: e => { ui.drillVal = e.target.value; paintDrill(); } });
    const attrSel = selectEl(ATTRS, ui.drillAttr, v => { ui.drillAttr = v; ui.drillVal = null; fillVals(); paintDrill(); }, 'Detail');
    drillCard.querySelector('.card-tools').prepend(attrSel, valSel);
    function fillVals() {
      const gs = groupBy(rows, [ui.drillAttr]).sort((a, b) => b.kept - a.kept);
      if (!ui.drillVal || !gs.some(g => g.keys[0] === ui.drillVal)) ui.drillVal = (gs.find(g => !isNs(g.keys[0])) || gs[0])?.keys[0];
      valSel.replaceChildren(...gs.map(g => h('option', { value: g.keys[0], selected: g.keys[0] === ui.drillVal ? true : null }, `${g.keys[0]} (${g.n})`)));
    }
    function paintDrill() {
      C.releaseWithin(drillBox);
      const sel = rows.filter(r => r[ui.drillAttr] === ui.drillVal); if (!sel.length) { drillBox.replaceChildren(h('p', { class: 'muted', text: 'No designs.' })); return; }
      const g = fin(groupBy(sel, [ui.drillAttr]))[0], sizes = d.size_order.filter(s => s !== 'Unknown' && sel.some(r => (r.sizes[s] || 0) > 0));
      const el = C.chartBox('short');
      const top = sel.slice().sort((a, b) => b.units_net - a.units_net);
      drillBox.replaceChildren(
        h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(5, minmax(0,1fr))', marginBottom: '14px' } },
          kpi('Designs', fmt.int(g.n)), kpi('Units kept', fmt.int(g.kept), { sub: `${fmt.pct(g.shareU, 1)} of all units` }), kpi('Per design per month', fmt.dec(g.velAvg, 1), { sub: `${g.ratio.toFixed(2)}× the average` }),
          kpi('Verdict', g.verdict[0], { sub: g.n < 5 ? 'too few designs to judge' : 'against the average design' }), kpi('Cancelled', fmt.pct(g.cancel, 1), { sub: `avg price ${fmt.inr(g.price)}` })),
        h('div', { class: 'grid', style: { gap: '20px' } },
          h('div', { class: 'c-4' }, h('div', { class: 'sub-h', text: 'Sizes (kept units)' }), el),
          h('div', { class: 'c-8' }, table({ filename: `designs_${ui.drillAttr}.csv`, sortKey: 'units_net', rows: top, limit: 12, search: 'Search these designs', columns: [
            { key: 'title', label: 'Design', name: true, searchable: true, render: r => h('span', null, swatch(r.colour_family), r.title) }, { key: 'units_net', label: 'Units kept', align: 'r', fmt: fmt.int, bar: true },
            { key: 'vel', label: 'Per month', align: 'r', fmt: v => fmt.dec(v, 1) }, { key: 'avg_price', label: 'Price', align: 'r', fmt: fmt.inr },
            { key: 'cancel', label: 'Cancelled', align: 'r', sortVal: r => r.units ? (r.units - r.units_net) / r.units : 0, render: r => fmt.pct(r.units ? 100 * (r.units - r.units_net) / r.units : 0, 0) },
            { key: 'first_sold', label: 'First sold', fmt: v => fmtDate(v, false) }] }))));
      C.bars(el, { cats: sizes.map(s => s.startsWith('Free') ? 'Free' : s), valFmt: fmt.int, series: [{ name: 'Units kept', values: sizes.map(s => sel.reduce((a, r) => a + (r.sizes[s] || 0), 0)), color: slotColor(1) }] });
    }
    fillVals(); page.append(drillCard); after(paintDrill);

    page.append(notice('<b>How to read this.</b> "Per design per month" divides a detail\'s kept units by the number of designs that carry it and by how long each design was on sale (first to last sale, at least 30 days). A design with no kept sales still counts, so a detail that is common but unpopular scores low. "Adj." repeats the comparison after setting each design against the designs first sold in the same quarter, because designs launched in a strong quarter sell more whatever their details. Most designs stopped selling well before the end of the data, so "months on sale" is approximate and gaps under about 20% are within normal noise. Treat ▲ and ▼ as leads to check, not proof. The data cannot see designs that never sold at all, and details are read from product titles, so "Not specified" means the title does not say.', 'info'));
    return page;
  },
};
