// ECharts wrappers that follow the chart mark specs: 2px lines, 8px markers with a surface ring,
// bars capped at 24px with a 4px rounded data end, hairline solid gridlines, a 2px surface gap
// between touching fills, value-first tooltips, no dual axes.
import { cssVar, esc, fmt, fmtBucket, fmtDate, h } from './ui.js';

const live = new Set();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function disposeAll() {
  live.forEach(c => { try { c.__ro?.disconnect(); c.dispose(); } catch (e) { /* already gone */ } });
  live.clear();
}

function mount(el) {
  const c = echarts.init(el, null, { renderer: 'canvas' });
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el); c.__ro = ro; live.add(c);
  return c;
}

const T = () => ({
  ink: cssVar('--ink'), ink2: cssVar('--ink-2'), ink3: cssVar('--ink-3'), line: cssVar('--line'), line2: cssVar('--line-strong'),
  card: cssVar('--card'), font: cssVar('--font-body'),
});

function tooltipBase(t) {
  return {
    backgroundColor: t.card, borderColor: t.line2, borderWidth: 1, padding: [8, 11], confine: true,
    textStyle: { color: t.ink, fontSize: 12.5, fontFamily: t.font },
    extraCssText: 'border-radius:10px;box-shadow:0 12px 30px -10px rgba(10,16,36,.4);',
  };
}
const row = (color, name, value, line = true) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;margin-top:2px">` +
  `<span style="color:inherit">${color ? `<i style="display:inline-block;width:12px;${line ? 'height:3px;border-radius:2px;vertical-align:3px' : 'height:10px;border-radius:3px;vertical-align:-1px'};background:${color};margin-right:7px"></i>` : ''}${esc(name)}</span>` +
  `<b style="font-weight:650;font-variant-numeric:tabular-nums">${esc(value)}</b></div>`;
const head = txt => `<div style="color:${cssVar('--ink-3')};font-size:12px;margin-bottom:3px">${esc(txt)}</div>`;

function axes(t, { xData, xFmt, yFmt, horizontal }) {
  const cat = { type: 'category', data: xData, axisLine: { lineStyle: { color: t.line2 } }, axisTick: { show: false },
    axisLabel: { color: t.ink3, fontSize: 12, hideOverlap: true, formatter: xFmt }, splitLine: { show: false } };
  const val = { type: 'value', axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: t.ink3, fontSize: 12, formatter: yFmt },
    splitLine: { lineStyle: { color: t.line, type: 'solid', width: 1 } } };
  return horizontal ? { xAxis: val, yAxis: { ...cat, inverse: true, axisLabel: { ...cat.axisLabel, hideOverlap: false, interval: 0 } } }
    : { xAxis: cat, yAxis: val };
}

/** Line / area chart over time. series: [{name, values, color, area}] */
export function line(el, { x, series, yFmt = fmt.compact, valFmt, gran = 'day', height }) {
  const t = T(), c = mount(el);
  const vf = s => s.fmt || valFmt || yFmt;
  const lab = v => gran === 'cat' ? v : fmtBucket(v, gran);
  c.setOption({
    textStyle: { fontFamily: t.font },
    animation: !reduced(), animationDuration: 350,
    grid: { left: 4, right: 18, top: 14, bottom: 4, containLabel: true },
    tooltip: { ...tooltipBase(t), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.line2, width: 1 } },
      formatter: ps => head(lab(ps[0].axisValue) + (gran === 'week' ? ' (week of)' : '')) +
        ps.map(p => row(p.color, p.seriesName, vf(series[p.seriesIndex])(p.value))).join('') },
    ...axes(t, { xData: x, xFmt: lab, yFmt }),
    series: series.map(s => ({
      type: 'line', name: s.name, data: s.values, smooth: false, symbol: 'circle', symbolSize: 8, showSymbol: x.length <= 2,
      lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color, borderColor: t.card, borderWidth: 2 },
      areaStyle: s.area ? { color: s.color, opacity: 0.10 } : undefined, emphasis: { focus: 'none', scale: true },
    })),
  });
  return c;
}

/** Bars. series: [{name, values, color}]; one series = one colour, no legend. */
const cut = (s, n = 30) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export function bars(el, { cats, series, horizontal = false, stacked = false, valFmt = fmt.compact, labels = true, catFmt, yFmt }) {
  const t = T(), c = mount(el);
  const ax = axes(t, { xData: horizontal ? cats.map(v => cut(v)) : cats, xFmt: catFmt, yFmt: yFmt || valFmt, horizontal });
  if (horizontal && labels) { ax.xAxis.axisLabel.show = false; ax.xAxis.splitLine.show = false; }
  if (!horizontal && cats.length <= 14) {          // few categories: show every label, wrapped to the column width
    const w = Math.max(44, Math.floor((el.clientWidth - 56) / cats.length) - 4);
    ax.xAxis.axisLabel = { ...ax.xAxis.axisLabel, interval: 0, hideOverlap: false, width: w, overflow: 'break' };
  }
  c.setOption({
    textStyle: { fontFamily: t.font },
    animation: !reduced(), animationDuration: 350,
    grid: { left: 4, right: horizontal && labels ? 64 : 14, top: horizontal ? 4 : 22, bottom: 4, containLabel: true },
    tooltip: { ...tooltipBase(t), trigger: 'item',
      formatter: p => head(String(cats[p.dataIndex] ?? p.name)) + row(p.color, p.seriesName, valFmt(p.value), false) },
    ...ax,
    series: series.map((s, i) => ({
      type: 'bar', name: s.name, data: s.values, stack: stacked ? 'a' : undefined, barMaxWidth: 24, barCategoryGap: '38%',
      itemStyle: { color: s.color, borderRadius: stacked ? 0 : (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]),
        borderColor: stacked ? t.card : undefined, borderWidth: stacked ? 2 : 0 },
      label: labels && !stacked ? { show: true, position: horizontal ? 'right' : 'top', color: t.ink2, fontSize: 12, formatter: p => valFmt(p.value) } : { show: false },
      emphasis: { itemStyle: { opacity: 0.86 } },
    })),
  });
  return c;
}

/** Heat map. cells: [[xIndex, yIndex, value]]. ramp 'seq' (one hue) or 'div' (blue <-> red around grey). */
export function heat(el, { xs, ys, cells, valFmt = fmt.compact, ramp = 'seq', min, max, labels = true, xFmt, tipLabel = 'Value', pad = true }) {
  const t = T(), c = mount(el);
  const vals = cells.map(d => d[2]).filter(v => v != null);
  const lo = min ?? Math.min(...vals, 0), hi = max ?? Math.max(...vals, 1);
  const colors = ramp === 'div' ? [cssVar('--div-neg'), cssVar('--div-mid'), cssVar('--div-pos')]
    : [0, 1, 2, 3, 4, 5, 6].map(i => cssVar(`--seq-${i}`));
  const dark = cssVar('--seq-0') < cssVar('--seq-6') && document.documentElement.dataset.theme === 'dark';
  const textOn = v => { const p = hi === lo ? 0 : (v - lo) / (hi - lo); return (ramp === 'seq' ? (dark ? p < 0.55 : p > 0.52) : Math.abs(p - 0.5) > 0.3) ? '#ffffff' : t.ink; };
  c.setOption({
    textStyle: { fontFamily: t.font },
    animation: !reduced(), animationDuration: 300,
    grid: { left: 4, right: 10, top: 6, bottom: xs.length <= 16 ? 40 : 24, containLabel: true },
    tooltip: { ...tooltipBase(t), trigger: 'item', formatter: p => head(`${ys[p.value[1]]} · ${xFmt ? xFmt(xs[p.value[0]]) : xs[p.value[0]]}`) + row(null, tipLabel, p.value[2] == null ? '–' : valFmt(p.value[2])) },
    xAxis: { type: 'category', data: xs, splitArea: { show: false }, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: xs.length <= 16 ? { color: t.ink3, fontSize: 12, formatter: xFmt, interval: 0, hideOverlap: false, width: Math.max(40, Math.floor((el.clientWidth - 150) / xs.length) - 6), overflow: 'break' }
                                 : { color: t.ink3, fontSize: 12, formatter: xFmt, hideOverlap: true } },
    yAxis: { type: 'category', data: ys, inverse: true, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.ink3, fontSize: 12, width: 130, overflow: 'truncate' } },
    visualMap: { show: false, min: lo, max: hi, dimension: 2, inRange: { color: colors }, outOfRange: { color: t.line } },
    series: [{ type: 'heatmap', data: cells.map(d => ({ value: d, label: labels && d[2] != null ? { show: true, color: textOn(d[2]), fontSize: 11.5, formatter: () => valFmt(d[2]) } : { show: false } })),
      itemStyle: { borderColor: t.card, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
  });
  return c;
}

/** Tiny inline trend for KPI tiles (no axes, current point marked). */
export function spark(values, color) {
  const w = 120, hgt = 26, n = values.length;
  if (n < 2) return h('span');
  const mx = Math.max(...values, 1e-9), mn = Math.min(...values, 0);
  const pts = values.map((v, i) => [i * (w - 4) / (n - 1) + 2, hgt - 3 - (v - mn) / (mx - mn || 1) * (hgt - 8)]);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${hgt}`); s.setAttribute('width', w); s.setAttribute('height', hgt); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<polyline fill="none" stroke="${cssVar('--line-strong')}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` +
    `<circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="3.2" fill="${color}" stroke="${cssVar('--card')}" stroke-width="1.5"/>`;
  return s;
}

export function chartBox(cls = '') { return h('div', { class: `chart ${cls}` }); }

/** Dispose the charts that live inside `node` (used when a card re-renders on its own). */
export function releaseWithin(node) {
  live.forEach(c => { if (node.contains(c.getDom())) { try { c.__ro?.disconnect(); c.dispose(); } catch (e) { /* gone */ } live.delete(c); } });
}
