import { h, fmt, fmtBucket, kpi, card, legend, table, notice, empty, barList, entityColor, slotColor, kpis } from '../ui.js';
import * as C from '../charts.js';

const NOTE = {
  'Meta paid': 'A Meta campaign ID, an ADZ_ campaign name or a paid medium on the link.',
  'Meta untagged': 'Clicked from Facebook or Instagram but the link carried no campaign tag. Mix of ads and organic.',
  'Google paid': 'Google click ID or a Google source with a paid medium (Performance Max, Shopping, search).',
  'Google organic': 'Google traffic marked organic, such as free product listings.',
  'Social organic': 'Instagram bio link or organic posts.',
  'WhatsApp': 'Opened from a WhatsApp message.',
  'Direct / unknown': 'No tag and no referrer.',
};

export default {
  title: 'Channels', compare: false,
  async render({ state, api, scope, after, brandName }) {
    const d = await api('/marketing/channels');
    const rows = d.rows, g = d.gran, tot = rows.reduce((a, r) => ({ o: a.o + r.orders, n: a.n + r.net }), { o: 0, n: 0 });
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Channels' }),
      h('p', { class: 'sub', text: `${brandName} · where orders come from. The channel is read from each order's own link tags, so untagged links land in "Meta untagged" or "Direct / unknown".` }))));

    const best = rows.filter(r => r.orders >= 30).sort((a, b) => (b.aov || 0) * (100 - b.cancel_rate) - (a.aov || 0) * (100 - a.cancel_rate))[0];
    page.append(kpis(
      kpi('Net revenue, all channels', fmt.inrc(tot.n), { hero: true, d: [h('span', { text: `${fmt.int(tot.o)} orders in this period` })] }),
      kpi('Biggest channel', rows[0]?.k || '–', { sub: rows[0] ? `${fmt.inrc(rows[0].net)} · ${fmt.pct(100 * rows[0].net / (tot.n || 1), 0)} of revenue` : '' }),
      kpi('Lowest cancel rate', (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => a.cancel_rate - b.cancel_rate)[0]; return r ? r.k : '–'; })(),
        { sub: (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => a.cancel_rate - b.cancel_rate)[0]; return r ? `${fmt.pct(r.cancel_rate)} cancelled` : ''; })() }),
      kpi('Highest order value', (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => b.aov - a.aov)[0]; return r ? r.k : '–'; })(),
        { sub: (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => b.aov - a.aov)[0]; return r ? `${fmt.inr(r.aov)} per kept order` : ''; })() }),
      kpi('Most new customers', (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => b.new_share - a.new_share)[0]; return r ? r.k : '–'; })(),
        { sub: (() => { const r = rows.filter(x => x.orders >= 30).sort((a, b) => b.new_share - a.new_share)[0]; return r ? `${fmt.pct(r.new_share, 0)} of its orders` : ''; })() })));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    grid.append(card({ title: 'Channel scorecard', span: 'c-12', cls: 'pad0', cap: 'Channels with fewer than 30 orders are too small to compare on rates.',
      chart: table({ filename: 'channels.csv', sortKey: 'net', rows, columns: [
        { key: 'k', label: 'Channel', name: true, searchable: true, render: r => h('span', { title: NOTE[r.k] || '' }, h('span', { class: 'sw', style: { background: entityColor('channel', r.k) } }), r.k) },
        { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr, bar: true },
        { key: 'aov', label: 'Avg order value', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) }, { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 1) },
        { key: 'new_share', label: 'New customers', align: 'r', fmt: v => fmt.pct(v, 0) }, { key: 'cod_share', label: 'Cash on delivery', align: 'r', fmt: v => fmt.pct(v, 0) }] }) }));

    const el1 = C.chartBox(), el2 = C.chartBox();
    grid.append(card({ title: 'Net revenue by channel', span: 'c-5', cap: 'After removing cancelled orders.', chart: el1,
      tableFn: () => table({ rows, sortKey: 'net', columns: [{ key: 'k', label: 'Channel' }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }] }) }));
    after(() => C.bars(el1, { cats: rows.map(r => r.k), horizontal: true, valFmt: fmt.inrc, series: [{ name: 'Net revenue', values: rows.map(r => ({ value: r.net, itemStyle: { color: entityColor('channel', r.k) } })) }] }));
    el2.before(legend(d.keys.map(k => ({ name: k, color: entityColor('channel', k), box: true }))));
    grid.append(card({ title: 'Orders by channel over time', span: 'c-7', cap: 'Each column is a period, split by channel.', chart: el2,
      tableFn: () => table({ filename: 'channels_over_time.csv', sortKey: 'd', sortDir: 1, rows: d.series, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, ...d.keys.map(k => ({ key: k, label: k, align: 'r', fmt: fmt.int }))] }) }));
    after(() => C.bars(el2, { cats: d.series.map(s => s.d), catFmt: v => fmtBucket(v, g), stacked: true, labels: false, valFmt: fmt.int,
      series: d.keys.map(k => ({ name: k, values: d.series.map(s => s[k]), color: entityColor('channel', k) })) }));

    grid.append(card({ title: 'What each channel means', span: 'c-12', cap: 'How the channel is decided from the link tags on each order.',
      chart: h('div', { class: 'blist' }, Object.entries(NOTE).map(([k, v]) => h('div', { class: 'bl-row', style: { gridTemplateColumns: '180px minmax(0,1fr)' } },
        h('div', { class: 'bl-n' }, h('span', { class: 'sw', style: { background: entityColor('channel', k) } }), h('span', { text: k })), h('div', { style: { color: 'var(--ink-2)' }, text: v })))) }));

    // Meta placements
    if (d.placement.length) {
      grid.append(card({ title: 'Meta platforms and placements', span: 'c-12', cls: 'pad0', cap: 'Spend and results by where the ad was shown, from your placement export.',
        chart: table({ filename: 'meta_placements.csv', sortKey: 'spend', rows: d.placement, columns: [
          { key: 'platform', label: 'Platform', searchable: true }, { key: 'placement', label: 'Placement', searchable: true },
          { key: 'spend', label: 'Spend', align: 'r', fmt: fmt.inr, bar: true }, { key: 'impressions', label: 'Impressions', align: 'r', fmt: fmt.compact },
          { key: 'link_clicks', label: 'Clicks', align: 'r', fmt: fmt.compact }, { key: 'ctr', label: 'CTR', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v, 2) },
          { key: 'cpc', label: 'CPC', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) }, { key: 'purchases', label: 'Purchases', align: 'r', fmt: fmt.int },
          { key: 'cpa', label: 'Cost / purchase', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) }, { key: 'roas', label: 'ROAS', align: 'r', fmt: v => v == null ? '–' : fmt.x(v) }] }) }));
    } else {
      grid.append(h('div', { class: 'c-12' }, empty('Meta platform and placement results will appear here', `Export <code>${state.brand}_campaign_platform_placement_day.csv</code> from Ads Manager (steps in <code>data/meta/HOW_TO_EXPORT.md</code>). It splits Facebook and Instagram, and Feed, Reels and Stories, so you can see which placements pay back.`)));
    }

    grid.append(card({ title: 'Source and medium on the links', span: 'c-12', cls: 'pad0', cap: 'The raw tags behind the channels, for the 40 most common combinations.',
      chart: table({ filename: 'utm_source_medium.csv', sortKey: 'orders', search: 'Search source or medium', limit: 25, rows: d.utm, columns: [
        { key: 'source', label: 'Source', searchable: true }, { key: 'medium', label: 'Medium / ad set', name: true, searchable: true }, { key: 'channel', label: 'Channel' },
        { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int, bar: true }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }, { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => fmt.pct(v, 0) }] }) }));
    return page;
  },
};
