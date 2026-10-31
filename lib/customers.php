<?php
/** Customer segments (RFM), the customer list and cohorts. Port of api_customers.py. */
declare(strict_types=1);

const SEGMENTS = ['Champions', 'Loyal', 'At risk', 'New', 'Promising', 'Needs attention', 'Hibernating'];
const SEGMENT_HELP = [
    'Champions' => '3 or more kept orders and ordered recently',
    'Loyal' => '2 or more kept orders, ordered fairly recently',
    'At risk' => '2 or more kept orders, but not for a while',
    'New' => 'one kept order, the most recent group',
    'Promising' => 'one kept order, recent',
    'Needs attention' => 'one kept order, getting old',
    'Hibernating' => 'one kept order, a long time ago',
];

/** One row per customer with a kept order in the window; recency is measured from the end date. */
function cust_rows(Scope $sc): array
{
    return q("WITH base AS (
        SELECT o.customer_key, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled, SUM(o.is_cancelled=0) AS net_orders,
               SUM(o.net_amount) AS net_rev, SUM(o.gross_amount) AS gross_rev, SUM(o.payment_method='COD') AS cod_orders,
               MAX(CASE WHEN o.is_cancelled=0 THEN o.ordered_date_ist END) AS last_kept,
               MIN(CASE WHEN o.is_cancelled=0 THEN o.ordered_date_ist END) AS first_kept
        FROM fact_order o WHERE o.brand=%s AND o.ordered_date_ist BETWEEN %s AND %s GROUP BY o.customer_key),
      buyers AS (SELECT b.*, DATEDIFF(%s, b.last_kept) AS recency FROM base b WHERE b.net_orders >= 1),
      ranked AS (SELECT b.*, RANK() OVER (ORDER BY b.recency DESC) - 1 AS rk_r, RANK() OVER (ORDER BY b.net_rev) - 1 AS rk_v,
                        COUNT(*) OVER () - 1 AS n1 FROM buyers b),
      scored AS (SELECT x.*, LEAST(5, 1 + (5 * x.rk_r) DIV GREATEST(x.n1, 1)) AS r,
                        x.n1 > 0 AND 10 * x.rk_v >= 9 * x.n1 AS top10, x.n1 > 0 AND 2 * x.rk_v >= x.n1 AS top50 FROM ranked x)
      SELECT s.*, CASE WHEN s.net_orders >= 3 AND s.r >= 4 THEN 'Champions'
                       WHEN s.net_orders >= 2 AND s.r >= 3 THEN 'Loyal'
                       WHEN s.net_orders >= 2 THEN 'At risk'
                       WHEN s.r = 5 THEN 'New' WHEN s.r = 4 THEN 'Promising' WHEN s.r = 3 THEN 'Needs attention' ELSE 'Hibernating' END AS segment,
             CASE WHEN s.top10 THEN 'High value' WHEN s.top50 THEN 'Mid value' ELSE 'Low value' END AS tier,
             d.customer_name, d.primary_phone, d.primary_email, d.city, d.province, d.total_orders AS lifetime_orders, d.merge_confidence
      FROM scored s JOIN dim_customer d ON d.customer_key = s.customer_key", array_merge($sc->p(), [$sc->end]));
}

function cust_segments(): void
{
    $sc = scope();
    $rows = cust_rows($sc);
    $n = count($rows) ?: 1;
    $totRev = array_sum(array_column($rows, 'net_rev')) ?: 1;
    $by = [];
    foreach ($rows as $r) {
        $s = &$by[$r['segment']];
        $s ??= ['k' => $r['segment'], 'customers' => 0, 'rev' => 0.0, 'orders' => 0, 'rec' => 0, 'cancelled' => 0];
        $s['customers']++;
        $s['rev'] += $r['net_rev'];
        $s['orders'] += $r['net_orders'];
        $s['rec'] += $r['recency'];
        $s['cancelled'] += $r['cancelled'];
        unset($s);
    }
    $segs = [];
    foreach (SEGMENTS as $name) {
        $s = $by[$name] ?? null;
        if (!$s) {
            $segs[] = ['k' => $name, 'customers' => 0, 'share' => 0, 'rev' => 0, 'rev_share' => 0, 'avg_orders' => 0, 'aov' => 0, 'avg_recency' => null, 'help' => SEGMENT_HELP[$name]];
            continue;
        }
        $segs[] = ['k' => $name, 'customers' => $s['customers'], 'share' => 100 * $s['customers'] / $n, 'rev' => $s['rev'], 'rev_share' => 100 * $s['rev'] / $totRev,
                   'avg_orders' => $s['orders'] / $s['customers'], 'aov' => $s['orders'] ? $s['rev'] / $s['orders'] : 0, 'avg_recency' => $s['rec'] / $s['customers'],
                   'help' => SEGMENT_HELP[$name]];
    }
    $matrix = [];
    foreach ($rows as $r) {
        $f = min($r['net_orders'], 3);
        $id = $r['r'] . '|' . $f;
        $matrix[$id] ??= ['r' => $r['r'], 'f' => $f, 'n' => 0];
        $matrix[$id]['n']++;
    }
    $tiers = [];
    foreach ($rows as $r) {
        $tiers[$r['tier']] ??= ['k' => $r['tier'], 'customers' => 0, 'rev' => 0.0];
        $tiers[$r['tier']]['customers']++;
        $tiers[$r['tier']]['rev'] += $r['net_rev'];
    }
    foreach ($tiers as &$t) {
        $t['rev_share'] = 100 * $t['rev'] / $totRev;
        $t['share'] = 100 * $t['customers'] / $n;
    }
    unset($t);
    // people who ordered in the window but never kept an order
    $cancelledOnly = one('SELECT COUNT(*) AS n FROM (SELECT customer_key FROM fact_order WHERE brand=%s AND ordered_date_ist BETWEEN %s AND %s
                          GROUP BY customer_key HAVING SUM(is_cancelled=0) = 0) x', $sc->p())['n'];
    $flags = [
        'cancel_prone' => count(array_filter($rows, fn($r) => $r['cancelled'] >= 2 && $r['cancelled'] / $r['orders'] >= 0.5)),
        'cancelled_any' => count(array_filter($rows, fn($r) => $r['cancelled'] >= 1)),
        'cod_only_repeat' => count(array_filter($rows, fn($r) => $r['net_orders'] >= 2 && $r['cod_orders'] == $r['orders'])),
        'cancelled_only' => $cancelledOnly,
    ];
    usort($rows, fn($a, $b) => ($b['net_rev'] <=> $a['net_rev']) ?: strcmp($a['customer_key'], $b['customer_key']));
    $keep = ['customer_key', 'customer_name', 'city', 'net_orders', 'net_rev', 'segment', 'recency'];
    $top = array_map(fn($r) => array_intersect_key($r, array_flip($keep)), array_slice($rows, 0, 12));
    $tierList = [];
    foreach (['High value', 'Mid value', 'Low value'] as $k) {
        if (isset($tiers[$k])) {
            $tierList[] = $tiers[$k];
        }
    }
    out(['customers' => count($rows), 'net_rev' => $totRev, 'segments' => $segs, 'matrix' => array_values($matrix), 'tiers' => $tierList, 'flags' => $flags, 'top' => $top]);
}

function cust_list_rows(Scope $sc, ?string $segment, ?string $search, int $limit): array
{
    $rows = cust_rows($sc);
    if ($segment) {
        $rows = array_values(array_filter($rows, fn($r) => $r['segment'] === $segment || $r['tier'] === $segment));
    }
    if ($search) {
        $s = mb_strtolower($search);
        $rows = array_values(array_filter($rows, fn($r) => str_contains(mb_strtolower((string)$r['customer_name']), $s) || str_contains((string)$r['primary_phone'], $s)
            || str_contains(mb_strtolower((string)$r['city']), $s) || str_contains(mb_strtolower($r['customer_key']), $s)));
    }
    usort($rows, fn($a, $b) => ($b['net_rev'] <=> $a['net_rev']) ?: strcmp($a['customer_key'], $b['customer_key']));
    $keep = ['customer_key', 'customer_name', 'primary_phone', 'primary_email', 'city', 'province', 'net_orders', 'cancelled', 'net_rev', 'recency', 'last_kept', 'segment', 'tier', 'merge_confidence'];
    return ['total' => count($rows), 'rows' => array_map(fn($r) => array_intersect_key($r, array_flip($keep)), array_slice($rows, 0, $limit))];
}

function cust_list(): void
{
    $sc = scope();
    out(cust_list_rows($sc, qs('segment'), qs('search'), qint('limit', 300, null, 2000)));
}

function cust_csv(): void
{
    $sc = scope();
    $segment = qs('segment');
    $rows = cust_list_rows($sc, $segment, null, 2000)['rows'];
    $cols = ['customer_key', 'customer_name', 'primary_phone', 'primary_email', 'city', 'province', 'net_orders', 'cancelled', 'net_rev', 'recency', 'last_kept', 'segment', 'tier'];
    $fh = fopen('php://temp', 'w+');
    fputcsv($fh, $cols, ',', '"', '', "\r\n");
    foreach ($rows as $r) {
        fputcsv($fh, array_map(fn($c) => is_float($r[$c]) ? json_encode($r[$c], JSON_PRESERVE_ZERO_FRACTION) : $r[$c], $cols), ',', '"', '', "\r\n");
    }
    rewind($fh);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $sc->brand . '_customers_' . ($segment ?: 'all') . '.csv"');
    echo "\xEF\xBB\xBF", stream_get_contents($fh);
    exit;
}

function cust_cohorts(): void
{
    $sc = scope();
    $gran = qs('gran', 'month') === 'week' ? 'week' : 'month';
    if ($gran === 'month') {
        $cohortExpr = "DATE_FORMAT(f.fd, '%%Y-%%m-01')";
        $idxExpr = "TIMESTAMPDIFF(MONTH, c.cohort, DATE_FORMAT(o.ordered_date_ist, '%%Y-%%m-01'))";
    } else {
        $cohortExpr = 'DATE_SUB(f.fd, INTERVAL WEEKDAY(f.fd) DAY)';
        $idxExpr = 'FLOOR(DATEDIFF(o.ordered_date_ist, c.cohort) / 7)';
    }
    $rows = q("WITH f AS (SELECT customer_key, MIN(ordered_date_ist) AS fd FROM fact_order WHERE brand=%s AND is_cancelled=0 GROUP BY customer_key),
                    c AS (SELECT f.customer_key, $cohortExpr AS cohort FROM f WHERE f.fd BETWEEN %s AND %s)
               SELECT c.cohort AS cohort, $idxExpr AS idx, COUNT(DISTINCT o.customer_key) AS customers, COUNT(*) AS orders, SUM(o.net_amount) AS revenue
               FROM c JOIN fact_order o ON o.customer_key = c.customer_key AND o.brand=%s AND o.is_cancelled=0
               GROUP BY 1, 2 ORDER BY 1, 2", [$sc->brand, $sc->start, $sc->end, $sc->brand]);
    $last = $sc->last;
    $cohorts = [];
    foreach ($rows as $r) {
        $cohorts['k' . $r['cohort']] ??= ['cohort' => $r['cohort'], 'cells' => []];
        $cohorts['k' . $r['cohort']]['cells'][(int)$r['idx']] = ['customers' => $r['customers'], 'orders' => $r['orders'], 'revenue' => $r['revenue']];
    }
    $result = [];
    foreach ($cohorts as $c) {
        $start = new DateTimeImmutable($c['cohort']);
        $end = new DateTimeImmutable($last);
        $maxIdx = $gran === 'month'
            ? ((int)$end->format('Y') - (int)$start->format('Y')) * 12 + (int)$end->format('n') - (int)$start->format('n')
            : intdiv(d_diff($last, $c['cohort']), 7);
        $size = $c['cells'][0]['customers'] ?? 0;
        ksort($c['cells']);
        $cells = [];
        foreach ($c['cells'] as $i => $v) {
            $cells[] = ['i' => $i] + $v;
        }
        $result[] = ['cohort' => $c['cohort'], 'size' => $size, 'max_idx' => $maxIdx, 'cells' => $cells];
    }
    // time to second order for customers acquired in the window
    $gaps = array_column(q('WITH o AS (SELECT customer_key, ordered_date_ist AS d, ROW_NUMBER() OVER (PARTITION BY customer_key ORDER BY ordered_at_utc) AS n
                                  FROM fact_order WHERE brand=%s AND is_cancelled=0),
                                 f AS (SELECT customer_key, d AS d1 FROM o WHERE n = 1 AND d BETWEEN %s AND %s)
                            SELECT DATEDIFF(o.d, f.d1) AS gap FROM f JOIN o ON o.customer_key=f.customer_key AND o.n = 2', $sc->p()), 'gap');
    $edges = [[0, 0, 'Same day'], [1, 7, '1–7d'], [8, 14, '8–14d'], [15, 30, '15–30d'], [31, 60, '31–60d'],
              [61, 90, '61–90d'], [91, 180, '91–180d'], [181, PHP_INT_MAX, 'Over 180d']];
    $dist = [];
    foreach ($edges as [$lo, $hi, $label]) {
        $dist[] = ['k' => $label, 'n' => count(array_filter($gaps, fn($g) => $g >= $lo && $g <= $hi))];
    }
    $acquired = one('SELECT COUNT(*) AS n FROM (SELECT customer_key FROM fact_order WHERE brand=%s AND is_cancelled=0 GROUP BY customer_key HAVING MIN(ordered_date_ist) BETWEEN %s AND %s) x', $sc->p())['n'];
    out(['gran' => $gran, 'cohorts' => $result, 'acquired' => $acquired, 'repeaters' => count($gaps), 'median_gap' => median($gaps),
         'gap_dist' => $dist, 'last' => $last, 'unreliable_before' => $sc->brand === 'AHA' ? '2025-06-01' : null]);
}
