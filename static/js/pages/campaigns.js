import { h, fmt, fmtBucket, fmtDate, kpi, card, legend, table, notice, empty, slotColor, entityColor, kpis } from '../ui.js';
import * as C from '../charts.js';

const ui = { level: 'campaign' };
const LEVELS = [['campaign', 'Campaigns'], ['adset', 'Ad sets'], ['ad', 'Ads']];

export default {
  title: 'Campaigns', compare: false,
  async render({ state, api, scope, after, rerender, brandName }) {
    const d = await api('/marketing/campaigns', { level: ui.level });
    const cov = d.coverage, tot = d.totals, st = d.meta;
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Campaigns' }),
      h('p', { class: 'sub', text: `${brandName} · Meta Ads spend and results next to the orders each campaign actually produced, matched by campaign ID first and exact campaign name second.` })),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Level' }, LEVELS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(ui.level === k), onclick: () => { ui.level = k; rerender(); } }, l)))));

    if (!d.has_meta) {
      page.append(notice(ui.level === 'campaign'
        ? `<b>No Meta export is loaded for ${brandName} yet.</b> The table below shows orders by the campaign tags on your links, without spend. Export the files listed in <code>data/meta/HOW_TO_EXPORT.md</code>, send them over, and spend, clicks, ROAS and cost per order fill in here.`
        : `<b>No ${ui.level === 'adset' ? 'ad set' : 'ad'} export is loaded for ${brandName} yet.</b> Orders are grouped by the ${ui.level === 'adset' ? 'ad set name your links carry in <code>utm_medium</code>' : 'ad name your links carry in <code>utm_content</code>'}. Export <code>${state.brand}_${ui.level}_day.csv</code> to see spend next to them.`));
    } else {
      page.append(notice(`Meta data loaded for ${fmtDate(st[ui.level === 'campaign' ? 'campaign' : ui.level].from)} to ${fmtDate(st[ui.level === 'campaign' ? 'campaign' : ui.level].to)}. ` +
        `<b>${fmt.pct(cov.orders ? 100 * cov.orders_matched_to_meta / cov.orders : 0, 0)} of this period's orders</b> could be tied to a Meta campaign in your export, so campaign results below describe that share of sales, not all of it.`, 'info'));
    }

    // ── coverage ──
    const covRow = (l, n, sub) => h('div', { class: 'bl-row', style: { gridTemplateColumns: 'minmax(0,1fr) 70px 70px' } },
      h('div', { class: 'bl-n' }, h('span', { text: l })), h('div', { class: 'bl-v num', text: fmt.int(n) }), h('div', { class: 'bl-x num r', text: sub }));
    const pct = n => cov.orders ? fmt.pct(100 * n / cov.orders, 0) : '–';

    if (d.has_meta) {
      const roas = tot.spend ? tot.net / tot.spend : null, mroas = tot.spend ? tot.purchase_value / tot.spend : null;
      const keptM = d.rows.reduce((a, r) => a + (r.in_meta ? r.kept_orders : 0), 0);
      page.append(kpis(
        kpi('Ad spend', fmt.inrc(tot.spend), { hero: true, d: [h('span', { text: `${fmt.inr(tot.spend)} across ${fmt.int(d.rows.filter(r => r.in_meta).length)} ${LEVELS.find(l => l[0] === ui.level)[1].toLowerCase()}` })] }),
        kpi('Impressions', fmt.compact(tot.impressions), { sub: `CPM ${fmt.inr(tot.impressions ? 1000 * tot.spend / tot.impressions : 0)}` }),
        kpi('Link clicks', fmt.compact(tot.link_clicks), { sub: `CTR ${fmt.pct(tot.impressions ? 100 * tot.link_clicks / tot.impressions : 0, 2)} · CPC ${fmt.inr(tot.link_clicks ? tot.spend / tot.link_clicks : 0)}` }),
        kpi('Purchases per Meta', fmt.int(tot.purchases), { sub: `${fmt.inr(tot.purchases ? tot.spend / tot.purchases : 0)} each · ROAS ${fmt.x(mroas)}` }),
        kpi('Orders matched in database', fmt.int(cov.orders_matched_to_meta), { sub: `${fmt.int(keptM)} kept` }),
        kpi('Return on spend (kept orders)', fmt.x(roas), { sub: `${fmt.inrc(tot.net)} net revenue on matched orders` })));
    } else {
      page.append(kpis(
        kpi('Orders with a campaign tag', fmt.int(cov.with_id + cov.name_only), { hero: true, d: [h('span', { text: `${pct(cov.with_id + cov.name_only)} of ${fmt.int(cov.orders)} orders in this period` })] }),
        kpi('Tagged with a Meta campaign ID', fmt.int(cov.with_id), { sub: pct(cov.with_id) }),
        kpi('Campaign name only', fmt.int(cov.name_only), { sub: pct(cov.name_only) }),
        kpi('Meta paid, no campaign tag', fmt.int(cov.meta_paid_unattributed), { sub: 'clicks from Meta ads with no campaign' }),
        kpi('Meta paid orders', fmt.int(cov.meta_paid), { sub: pct(cov.meta_paid) }),
        kpi('Meta, incl. untagged', fmt.int(cov.meta_any), { sub: 'paid plus Facebook/Instagram clicks with no ad tag' })));
    }

    const grid = h('div', { class: 'grid' }); page.append(grid);

    // ── trends ──
    if (d.has_meta && ui.level === 'campaign') {
      const el1 = C.chartBox('short'), el2 = C.chartBox('short'), sp = d.spend_series, os = d.orders_series, g = d.gran;
      grid.append(card({ title: 'Ad spend over time', span: 'c-6', cap: 'Meta Ads spend per period, from your export.', chart: el1,
        tableFn: () => table({ filename: 'spend_over_time.csv', sortKey: 'd', sortDir: 1, rows: sp, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, { key: 'spend', label: 'Spend', align: 'r', fmt: fmt.inr },
          { key: 'purchases', label: 'Meta purchases', align: 'r', fmt: fmt.int }, { key: 'value', label: 'Meta revenue', align: 'r', fmt: fmt.inr }] }) }));
      after(() => C.bars(el1, { cats: sp.map(x => x.d), catFmt: v => fmtBucket(v, g), labels: false, valFmt: fmt.inrc, series: [{ name: 'Ad spend', values: sp.map(x => x.spend), color: slotColor(1) }] }));
      grid.append(card({ title: 'Orders from Meta campaigns over time', span: 'c-6', cap: 'Orders in your database that carry a Meta campaign ID or came through Meta paid traffic. Its own scale, not shared with spend.', chart: el2,
        tableFn: () => table({ filename: 'meta_orders_over_time.csv', sortKey: 'd', sortDir: 1, rows: os, columns: [{ key: 'd', label: 'Period', fmt: v => fmtBucket(v, g) }, { key: 'orders', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr }] }) }));
      after(() => C.line(el2, { x: os.map(x => x.d), gran: g, yFmt: fmt.int, series: [{ name: 'Orders', values: os.map(x => x.orders), color: slotColor(2), area: true }] }));
    }

    // ── comparison charts ──
    const ranked = d.rows.filter(r => r.net > 0).sort((a, b) => b.net - a.net).slice(0, 10);
    if (ranked.length) {
      const el3 = C.chartBox();
      grid.append(card({ title: 'Net revenue by campaign', span: d.has_meta ? 'c-6' : 'c-12', cap: 'Revenue from orders that were not cancelled, for the ten biggest.', chart: el3 }));
      after(() => C.bars(el3, { cats: ranked.map(r => r.name || r.key), horizontal: true, valFmt: fmt.inrc, series: [{ name: 'Net revenue', values: ranked.map(r => r.net), color: slotColor(1) }] }));
    }
    if (d.has_meta) {
      const roasRows = d.rows.filter(r => r.spend >= 500 && r.orders > 0).sort((a, b) => b.db_roas - a.db_roas).slice(0, 10);
      if (roasRows.length) {
        const el4 = C.chartBox();
        grid.append(card({ title: 'Return on spend by campaign', span: 'c-6', cap: 'Net revenue on matched orders divided by spend, for campaigns that spent at least ₹500. Orders that could not be matched are not counted, so this can understate the true return.', chart: el4 }));
        after(() => C.bars(el4, { cats: roasRows.map(r => r.name || r.key), horizontal: true, valFmt: v => `${v.toFixed(2)}×`, series: [{ name: 'Return on spend', values: roasRows.map(r => +r.db_roas.toFixed(2)), color: slotColor(1) }] }));
      }
    }

    // ── full table ──
    const cols = [{ key: 'name', label: LEVELS.find(l => l[0] === ui.level)[1].replace(/s$/, ''), name: true, searchable: true, render: r => r.name || r.key, raw: r => r.name || r.key }];
    if (d.has_meta) cols.push(
      { key: 'spend', label: 'Spend', align: 'r', fmt: fmt.inr, bar: true }, { key: 'impressions', label: 'Impressions', align: 'r', fmt: fmt.compact },
      { key: 'link_clicks', label: 'Clicks', align: 'r', fmt: fmt.compact }, { key: 'ctr', label: 'CTR', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v, 2) },
      { key: 'cpc', label: 'CPC', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) }, { key: 'add_to_cart', label: 'Add to cart', align: 'r', fmt: fmt.int },
      { key: 'purchases', label: 'Meta purchases', align: 'r', fmt: fmt.int }, { key: 'meta_roas', label: 'Meta ROAS', align: 'r', fmt: v => v == null ? '–' : fmt.x(v) });
    cols.push({ key: 'orders', label: 'Orders (db)', align: 'r', fmt: fmt.int }, { key: 'net', label: 'Net revenue', align: 'r', fmt: fmt.inr, bar: !d.has_meta },
      { key: 'cancel_rate', label: 'Cancelled', align: 'r', fmt: v => v == null ? '–' : fmt.pct(v, 0) }, { key: 'aov', label: 'AOV', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) });
    if (d.has_meta) cols.push({ key: 'db_roas', label: 'ROAS (kept)', align: 'r', fmt: v => v == null ? '–' : fmt.x(v) }, { key: 'cpa', label: 'Cost / kept order', align: 'r', fmt: v => v == null ? '–' : fmt.inr(v) });
    cols.push({ key: 'by_id', label: 'Matched by ID', align: 'r', fmt: fmt.int }, { key: 'by_name', label: 'By name', align: 'r', fmt: fmt.int });
    grid.append(card({ title: `All ${LEVELS.find(l => l[0] === ui.level)[1].toLowerCase()}`, span: 'c-12', cls: 'pad0',
      cap: d.has_meta ? '"Orders (db)" are orders in your database tied to the row; "Meta purchases" is what Meta reports. They differ because of attribution windows and untagged links.' : 'Orders by the campaign tag on the link they came through.',
      chart: table({ filename: `${ui.level}s.csv`, sortKey: d.has_meta ? 'spend' : 'net', search: 'Search by name or ID', limit: 60, rows: d.rows, columns: cols }) }));

    // ── how the matching works ──
    const mt = h('div', { class: 'blist' }, covRow('Orders in this period', cov.orders, '100%'), covRow('…with a Meta campaign ID on the link', cov.with_id, pct(cov.with_id)),
      covRow('…with a campaign name only', cov.name_only, pct(cov.name_only)), covRow('Meta paid orders without any campaign tag', cov.meta_paid_unattributed, pct(cov.meta_paid_unattributed)),
      d.has_meta && covRow('Orders tied to a campaign in your Meta export', cov.orders_matched_to_meta, pct(cov.orders_matched_to_meta)));
    grid.append(card({ title: 'How much of your sales this can see', span: 'c-12', cap: 'Only orders whose link carried a campaign ID (or a name that matches your export) can be assigned to a campaign. Adding {{campaign.id}} to your ad URLs raises this.', chart: mt }));
    return page;
  },
};
