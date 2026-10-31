import { h, fmt, fmtDate, kpi, card, table, notice, icon, kpis } from '../ui.js';

const ISSUE = { TEST_ORDER: 'Test orders removed', DUPLICATE_ORDER_ROW: 'Duplicate order rows removed', DUPLICATE_FULFILLMENT: 'Repeated shipment records removed',
  FULFILLMENT_WITHOUT_ORDER: 'Shipments with no order removed', CANCELLED_AFTER_SHIPMENT: 'Cancelled after a shipment existed', LATE_CAPTURED_HISTORY: 'Order reached the data more than a day late',
  TZ_OFFSET_NOT_IST: 'Order time zone is not IST', INVALID_OR_MISSING_PHONE: 'Phone number missing or invalid', STAGE_FROM_FULFILLMENT: 'Marked shipped because a shipment exists',
  CUSTOMER_MERGED_2_PHONES: 'Customer merged across 2 phone numbers', CUSTOMER_MERGED_3PLUS_PHONES: 'Customer merged across 3+ phone numbers (review)',
  HIGH_FREQUENCY_CUSTOMER: 'Customer with 15+ orders (reseller or shared number?)', AMBIGUOUS_IDENTIFIER_NOT_USED: 'Shared email or ID not used to merge customers' };
const chip = (level, text) => h('span', { class: `chip ${level}` }, level === 'ok' ? '✓ ' : level === 'bad' ? '✕ ' : '! ', text);

export default {
  title: 'Data health', compare: false,
  async render({ state, api, scope, brandName }) {
    const d = await api('/health/overview');
    const a = d.attribution, p = d.products, c = d.checkouts, mt = Object.fromEntries(d.checks.map(x => [x.status, x.n]));
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Data health' }),
      h('p', { class: 'sub', text: `${brandName} · what this dashboard knows well, what it only estimates, and what is missing. Covers the brand's full history, whatever date range is picked.` }))));
    const metaFiles = Object.values(d.meta).reduce((s, m) => s + (m.rows > 0 ? 1 : 0), 0);
    page.append(kpis(
      kpi('Orders in the data', fmt.int(d.orders), { hero: true, d: [h('span', { text: `${fmtDate(d.span.first)} to ${fmtDate(d.span.last)} · snapshot ${fmtDate(d.snapshot)}` })] }),
      kpi('Checks passed', fmt.int(mt.PASS || 0), { sub: `${fmt.int(mt.FAIL || 0)} failed · ${fmt.int(mt.INFO || 0)} for information` }),
      kpi('Orders with a Meta campaign ID', fmt.pct(100 * a.with_id / a.orders, 0), { sub: `${fmt.pct(100 * (a.with_id + a.name_only) / a.orders, 0)} with an ID or a name` }),
      kpi('Units with a known colour', fmt.pct(100 * p.colour_units / p.units, 0), { sub: state.brand === 'TIRLS' ? 'inferred from design names' : 'read from the product title' }),
      kpi('Meta exports loaded', fmt.int(metaFiles), { sub: metaFiles ? 'see the table below' : 'none yet' }),
      kpi('Missing order numbers', fmt.int(d.missing.reduce((s, m) => s + m.n, 0)), { sub: 'gaps in the order sequence' })));

    const rows = [
      ['Orders, revenue and cancellations', d.failing.length ? 'bad' : 'ok', d.failing.length ? `${d.failing.length} check(s) failing` : 'Reconciled', 'Order totals, cancellation counts and customer totals were recomputed from the raw data and match to the rupee.'],
      ['Product, size and variant data', 'ok', `Size on ${fmt.pct(100 * p.size_units / p.units, 0)} of units`, `Line items reconcile to every order's total. Colour and garment details are read from product titles (${fmt.int(p.designs)} designs).`],
      ['Colour', state.brand === 'TIRLS' ? 'warn' : 'ok', state.brand === 'TIRLS' ? 'Inferred from design names' : `${fmt.pct(100 * p.colour_units / p.units, 0)} of units`, state.brand === 'TIRLS' ? 'Tirls names designs instead of describing colour. Review data/mappings/product_attributes_review.csv and add fixes to product_overrides.csv.' : 'Titles with no colour word ("Pure Cotton Batik Nighty") stay unknown.'],
      ['Campaign matching', a.with_id / a.orders > 0.5 ? 'ok' : 'warn', `${fmt.pct(100 * a.with_id / a.orders, 0)} by ID, ${fmt.pct(100 * a.name_only / a.orders, 0)} by name only`,
        `${a.inferred_id ? fmt.int(a.inferred_id) + ' orders got their ID by pairing a campaign name with an ID seen on other orders. ' : ''}Add utm_id={{campaign.id}} to your Meta ad URLs to raise this.`],
      ['Checkout and funnel data', state.brand === 'AHA' ? 'warn' : 'ok', state.brand === 'AHA' ? `${fmt.int(c.by_id)} exact, ${fmt.int(c.by_phone_time)} estimated links` : 'Every order linked by ID',
        state.brand === 'AHA' ? 'AHA checkout bypasses the recovery tool, so only some checkouts are captured and most are linked to orders by phone number and time.' : 'Every Tirls order links to its checkout by ID.'],
      ['Delivery status', state.brand === 'AHA' ? 'warn' : 'ok', state.brand === 'AHA' ? 'Dispatch only' : 'Full tracking', state.brand === 'AHA' ? 'AHA records shipment but not delivery or returns, so "delivered" revenue cannot be computed.' : 'Tracking stages are recorded through delivery.'],
      ['Timestamps', 'ok',d.late.offset_anomaly ? `${fmt.int(d.late.offset_anomaly)} orders sent in a US time zone` : 'All in IST', d.late.offset_anomaly ? 'The first Tirls orders were recorded while the store was set to a US time zone. A review found they are real launch orders (nearly all delivered, normal basket size), so they are counted. Dates are converted to IST either way.' : 'Order times are converted to IST for every chart.'],
    ];
    const grid = h('div', { class: 'grid' }); page.append(grid);
    grid.append(card({ title: 'What you can rely on', span: 'c-12', cls: 'pad0',
      chart: table({ rows: rows.map(r => ({ area: r[0], level: r[1], status: r[2], note: r[3] })), sortKey: null, columns: [
        { key: 'area', label: 'Area', name: true, sortable: false }, { key: 'status', label: 'Status', sortable: false, render: r => chip(r.level, r.status) },
        { key: 'note', label: 'What it means', sortable: false, render: r => h('span', { style: { whiteSpace: 'normal', display: 'block', maxWidth: '70ch' }, text: r.note }) }] }) }));

    const names = { pre_onboarding_history: 'Before the data starts (history)', cutover_window: 'Between the two databases (7–13 Jul 2026)', scattered_live: 'Scattered gaps in live data' };
    grid.append(card({ title: 'Missing orders', span: 'c-6', cls: 'pad0', cap: 'Order numbers that never reached the data. A Shopify order export would close them. The full list is in the dq_missing_order_number table.',
      chart: d.missing.length ? table({ rows: d.missing.map(m => ({ ...m, label: names[m.k] || m.k, range: `#${m.lo}–#${m.hi}` })), sortKey: 'n', columns: [{ key: 'label', label: 'Where', name: true }, { key: 'range', label: 'Order numbers' }, { key: 'n', label: 'Missing', align: 'r', fmt: fmt.int, bar: true }] }) : h('p', { class: 'muted', style: { padding: '8px 20px' }, text: 'No gaps in the order sequence.' }) }));
    grid.append(card({ title: 'Cleaning log', span: 'c-6', cls: 'pad0', cap: 'What was excluded, flagged or merged when the data was cleaned.',
      chart: table({ rows: d.issues, sortKey: 'n', columns: [{ key: 'k', label: 'Issue', name: true, render: r => ISSUE[r.k] || r.k }, { key: 'severity', label: 'Kind' }, { key: 'n', label: 'Rows', align: 'r', fmt: fmt.int, bar: true }] }) }));

    grid.append(card({ title: 'Meta exports loaded', span: 'c-12', cls: 'pad0', cap: 'Each file you send is recorded here with its totals so you can compare them with Ads Manager.',
      chart: d.loads.length ? table({ rows: d.loads, sortKey: 'loaded_at', columns: [{ key: 'file_name', label: 'File', name: true }, { key: 'kind', label: 'Type' }, { key: 'date_min', label: 'From' }, { key: 'date_max', label: 'To' },
        { key: 'rows_loaded', label: 'Rows', align: 'r', fmt: fmt.int }, { key: 'spend_total', label: 'Spend', align: 'r', fmt: fmt.inr }, { key: 'attribution_setting', label: 'Attribution' }, { key: 'loaded_at', label: 'Loaded' }] })
        : h('div', { style: { padding: '8px 20px 14px' } }, notice('No Meta exports have been loaded for this brand. The steps and file names are in <code>data/meta/HOW_TO_EXPORT.md</code>.')) }));
    return page;
  },
};
