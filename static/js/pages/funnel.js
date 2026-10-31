import { h, fmt, fmtDate, kpi, card, table, notice, empty, cssVar, slotColor } from '../ui.js';
import * as C from '../charts.js';

// Funnel bars use the ordinal one-hue ramp: stage order is meaning, so lightness steps with position.
function funnelRows(steps, { first = steps[0]?.value } = {}) {
  const n = steps.length;
  return h('div', { class: 'funnel' }, steps.map((s, i) => {
    const prev = i ? steps[i - 1].value : null, step = prev ? 100 * s.value / prev : null, ofFirst = first ? 100 * s.value / first : null;
    const idx = Math.max(1, Math.min(5, Math.ceil((i + 1) * 5 / n)));
    return h('div', { class: 'fn-row' },
      h('div', { class: 'fn-l' }, s.label, s.sub && h('small', { text: s.sub })),
      h('div', { class: 'fn-track' }, s.value == null ? h('span', { class: 'muted', style: { padding: '4px 8px', display: 'block', fontSize: '12px' }, text: 'not recorded' })
        : h('div', { class: 'fn-bar', style: { width: `${Math.max(0.4, ofFirst ?? 100)}%`, background: cssVar(`--ordinal-${idx}`) } })),
      h('div', { class: 'fn-v' }, h('b', { text: s.value == null ? '–' : fmt.int(s.value) }),
        h('small', null, step != null ? `${fmt.pct(step, step < 10 ? 2 : 1)} of ${s.vs ? "Meta's count" : 'previous'}` : '',
          step != null && step < 100 && s.dropNote ? ` · ${s.dropNote}` : '')));
  }));
}

export default {
  title: 'Funnel', compare: false,
  async render({ state, api, scope, after, brandName }) {
    const d = await api('/marketing/funnel');
    const a = d.acquisition, c = d.checkouts, co = d.checkout_orders, o = d.orders;
    const page = h('div');
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Funnel' }),
      h('p', { class: 'sub', text: `${brandName} · from ad impression to a delivered parcel. The database has no website session or add-to-cart data, so the top of the funnel comes from your Meta export and the rest from orders and captured checkouts.` }))));

    const grid = h('div', { class: 'grid' }); page.append(grid);

    // A. acquisition
    if (a && a.impressions != null) {
      const steps = [
        { label: 'Impressions', sub: 'ads shown', value: a.impressions }, { label: 'Link clicks', sub: 'people who clicked through', value: a.link_clicks },
        { label: 'Landing page views', sub: 'the page actually loaded', value: a.landing_page_views }, { label: 'Add to cart', sub: 'per Meta pixel', value: a.add_to_cart },
        { label: 'Checkout started', sub: 'per Meta pixel', value: a.checkouts_initiated }, { label: 'Purchases', sub: 'per Meta pixel', value: a.purchases },
        { label: 'Orders in your database', sub: 'tagged as Meta paid, kept', value: d.db_meta.kept, vs: 'Meta purchases' }];
      grid.append(card({ title: 'Ads to order', span: 'c-12', cap: `Meta Ads, ${fmtDate(scope.start, false)} to ${fmtDate(scope.end)}. The last bar comes from your own orders, so differences from Meta's purchase count come from attribution windows and untagged links.`,
        chart: funnelRows(steps),
        tableFn: () => table({ rows: steps, columns: [{ key: 'label', label: 'Step' }, { key: 'value', label: 'People / events', align: 'r', fmt: fmt.int }] }) }));
    } else {
      grid.append(h('div', { class: 'c-12' }, empty('Ads to order needs your Meta export',
        `Impressions, clicks, landing page views, add to cart, checkouts and purchases come from Meta. Send <code>${state.brand}_campaign_day.csv</code> (steps in <code>data/meta/HOW_TO_EXPORT.md</code>) and this funnel fills in. Below, the part that does not need Meta.`)));
    }

    // B. checkout -> delivery
    const linkNote = state.brand === 'AHA'
      ? `AHA's checkout is run by Shopflo and Razorpay, which create their own checkout, so only ${fmt.int(c.by_id)} captured checkouts link to an order by ID. ${fmt.int(c.by_phone_time)} more are linked by phone number within 72 hours, which is an estimate. AHA also captures only a share of its checkouts (${fmt.int(c.captured)} captured against ${fmt.int(o.placed)} orders), so treat this as a partial view.`
      : `Every Tirls order links to its checkout by ID, so these steps are exact.`;
    grid.before(notice(`<b>${state.brand === 'AHA' ? 'Approximate for AHA.' : 'Exact for Tirls.'}</b> ${linkNote}`));
    const stepsB = [
      { label: 'Checkouts captured', sub: 'someone reached checkout', value: c.captured }, { label: 'Left a phone number', sub: 'can be contacted', value: c.with_phone },
      { label: 'Became an order', sub: state.brand === 'AHA' ? 'linked by ID or phone and time' : 'linked by checkout ID', value: c.purchased },
      { label: 'Not cancelled', value: co.kept }, { label: 'Shipped', value: co.shipped }, { label: 'Delivered', sub: state.brand === 'AHA' ? 'AHA does not record delivery' : null, value: state.brand === 'AHA' ? null : co.delivered }];
    // "left a phone number" is a side measure, not a gate: show it, but chain purchases from captured
    const chainB = [stepsB[0], stepsB[2], stepsB[3], stepsB[4], stepsB[5]];
    grid.append(card({ title: 'Checkout to delivery', span: 'c-7', cap: 'Checkouts started in this period and what happened to them.', chart: h('div', null, funnelRows(chainB),
      h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' }, text: `${fmt.int(c.with_phone)} of ${fmt.int(c.captured)} captured checkouts (${fmt.pct(c.captured ? 100 * c.with_phone / c.captured : 0, 0)}) left a phone number, which is what recovery messages need.` })),
      tableFn: () => table({ rows: stepsB, columns: [{ key: 'label', label: 'Step' }, { key: 'value', label: 'Count', align: 'r', fmt: v => v == null ? '–' : fmt.int(v) }] }) }));

    const ch = d.by_channel.map(r => ({ ...r, rate: r.checkouts ? 100 * r.purchased / r.checkouts : 0 }));
    const el = C.chartBox('short');
    grid.append(card({ title: 'Checkout conversion by source', span: 'c-5', cap: 'Share of captured checkouts that became an order, by where the shopper came from.', chart: el,
      tableFn: () => table({ rows: ch, sortKey: 'checkouts', columns: [{ key: 'k', label: 'Source' }, { key: 'checkouts', label: 'Checkouts', align: 'r', fmt: fmt.int }, { key: 'purchased', label: 'Orders', align: 'r', fmt: fmt.int }, { key: 'rate', label: 'Conversion', align: 'r', fmt: v => fmt.pct(v) }] }) }));
    after(() => C.bars(el, { cats: ch.map(r => `${r.k} (${fmt.int(r.checkouts)})`), horizontal: true, valFmt: v => fmt.pct(v), series: [{ name: 'Conversion', values: ch.map(r => +r.rate.toFixed(1)), color: slotColor(1) }] }));

    // C. orders -> delivery
    const stepsC = [{ label: 'Orders placed', value: o.placed }, { label: 'Not cancelled', sub: 'still counted as sales', value: o.kept },
      { label: 'Shipped', sub: 'a shipment with tracking exists', value: o.shipped }, { label: 'Delivered', sub: state.brand === 'AHA' ? 'AHA does not record delivery' : 'latest tracking stage', value: state.brand === 'AHA' ? null : o.delivered }];
    grid.append(card({ title: 'Order to delivery', span: 'c-12', cap: 'Every order placed in this period, regardless of how it was found.', chart: funnelRows(stepsC),
      tableFn: () => table({ rows: stepsC, columns: [{ key: 'label', label: 'Step' }, { key: 'value', label: 'Orders', align: 'r', fmt: v => v == null ? '–' : fmt.int(v) }] }) }));
    return page;
  },
};
