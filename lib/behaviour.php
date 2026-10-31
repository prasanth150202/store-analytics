<?php
/** Behaviour: when people order, what is in the basket, how often they come back, how they pay, what they browse on. Port of api_behaviour.py. */
declare(strict_types=1);

function behaviour_overview(): void
{
    $sc = scope();
    $W = W;
    $pair = qs('pair', 'product_type');
    $pairCol = ['product_type' => 'p.product_type', 'colour_family' => 'p.colour_family', 'size' => 'i.size'][$pair] ?? 'p.product_type';

    $heat = q("SELECT WEEKDAY(o.ordered_date_ist) AS wd, HOUR(CONVERT_TZ(o.ordered_at_utc, '+00:00', '+05:30')) AS hr, COUNT(*) AS orders, SUM(o.net_amount) AS net
               FROM fact_order o WHERE $W GROUP BY 1, 2", $sc->p());

    $basket = q("SELECT t.units, COUNT(*) AS orders FROM (
                   SELECT i.order_key, SUM(i.quantity) AS units FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key
                   WHERE $W GROUP BY i.order_key) t GROUP BY 1 ORDER BY 1", $sc->p());
    $mix = one("SELECT COUNT(*) AS orders, COALESCE(SUM(t.units),0) AS units, COALESCE(SUM(t.sizes > 1),0) AS multi_size, COALESCE(SUM(t.types > 1),0) AS multi_type,
                       COALESCE(SUM(t.designs > 1),0) AS multi_design, COALESCE(SUM(t.units > 1),0) AS multi_unit
                FROM (SELECT i.order_key, SUM(i.quantity) AS units, COUNT(DISTINCT i.size) AS sizes, COUNT(DISTINCT p.product_type) AS types, COUNT(DISTINCT i.product_key) AS designs
                      FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key
                      WHERE $W GROUP BY i.order_key) t", $sc->p());
    $disc = one("SELECT COUNT(*) AS orders, SUM(o.discount_amount > 0) AS discounted,
                        100 * SUM(CASE WHEN o.discount_amount > 0 THEN o.discount_amount END) / NULLIF(SUM(CASE WHEN o.discount_amount > 0 THEN o.gross_amount + o.discount_amount - o.shipping_amount END), 0) AS avg_disc_pct,
                        AVG(CASE WHEN o.discount_amount > 0 AND o.is_cancelled = 0 THEN o.net_amount END) AS aov_disc, AVG(CASE WHEN o.discount_amount = 0 AND o.is_cancelled = 0 THEN o.net_amount END) AS aov_full,
                        100 * SUM(o.discount_amount > 0 AND o.is_cancelled = 1) / NULLIF(SUM(o.discount_amount > 0), 0) AS cancel_disc,
                        100 * SUM(o.discount_amount = 0 AND o.is_cancelled = 1) / NULLIF(SUM(o.discount_amount = 0), 0) AS cancel_full
                 FROM fact_order o WHERE $W", $sc->p());
    $bands = q("SELECT CASE WHEN o.gross_amount < 600 THEN '1 · under ₹600' WHEN o.gross_amount < 1000 THEN '2 · ₹600–999' WHEN o.gross_amount < 1500 THEN '3 · ₹1,000–1,499'
                            WHEN o.gross_amount < 2500 THEN '4 · ₹1,500–2,499' ELSE '5 · ₹2,500 and above' END AS k, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled
                FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());

    $pairs = q("SELECT LEAST(a.k, b.k) AS a, GREATEST(a.k, b.k) AS b, COUNT(DISTINCT a.order_key) AS orders FROM
                  (SELECT i.order_key, i.item_key, $pairCol AS k FROM fact_order_item i JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key
                   JOIN fact_order o ON o.order_key=i.order_key WHERE $W) a
                JOIN (SELECT i.order_key, i.item_key, $pairCol AS k FROM fact_order_item i JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key
                   JOIN fact_order o ON o.order_key=i.order_key WHERE $W) b ON a.order_key=b.order_key AND a.item_key < b.item_key
                GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2 LIMIT 14", array_merge($sc->p(), $sc->p()));

    $gaps = array_column(q('SELECT DATEDIFF(t.d, t.prev) AS gap FROM (
                   SELECT ordered_date_ist AS d, LAG(ordered_date_ist) OVER (PARTITION BY customer_key ORDER BY ordered_at_utc) AS prev
                   FROM fact_order WHERE brand=%s AND is_cancelled=0) t WHERE t.prev IS NOT NULL AND t.d BETWEEN %s AND %s', $sc->p()), 'gap');
    $edges = [[0, 0, 'Same day'], [1, 7, '1–7d'], [8, 14, '8–14d'], [15, 30, '15–30d'], [31, 60, '31–60d'], [61, 90, '61–90d'],
              [91, 180, '91–180d'], [181, 365, '181–365d'], [366, PHP_INT_MAX, 'Over 1 year']];
    $gapDist = [];
    foreach ($edges as [$lo, $hi, $label]) {
        $gapDist[] = ['k' => $label, 'n' => count(array_filter($gaps, fn($g) => $g >= $lo && $g <= $hi))];
    }

    $seq = q("SELECT LEAST(t.n, 4) AS nth, COUNT(*) AS orders, SUM(t.net_amount) AS net FROM (
                SELECT o.net_amount, o.ordered_date_ist, ROW_NUMBER() OVER (PARTITION BY o.customer_key ORDER BY o.ordered_at_utc) AS n
                FROM fact_order o WHERE o.brand=%s AND o.is_cancelled=0) t WHERE t.ordered_date_ist BETWEEN %s AND %s GROUP BY 1 ORDER BY 1", $sc->p());

    $b = bucket($sc->gran(), 'o.ordered_date_ist');
    $pay = fill($sc, q("SELECT $b AS d, COUNT(*) AS orders, SUM(o.payment_method='COD') AS cod FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 1", $sc->p()),
        'd', ['orders' => 0, 'cod' => 0]);
    $payStats = q("SELECT o.payment_method AS k, COUNT(*) AS orders, 100 * SUM(o.is_cancelled) / COUNT(*) AS cancel_rate,
                          AVG(CASE WHEN o.is_cancelled=0 THEN o.net_amount END) AS aov FROM fact_order o WHERE $W GROUP BY 1", $sc->p());

    $device = q("SELECT d.device_class, d.os, d.browser_type, COUNT(*) AS orders, SUM(o.net_amount) AS net, 100 * SUM(o.is_cancelled) / COUNT(*) AS cancel_rate
                 FROM fact_order o JOIN fact_order_device d ON d.order_key=o.order_key WHERE $W AND d.device_class <> 'Unknown'
                 GROUP BY 1, 2, 3 ORDER BY 4 DESC", $sc->p());
    $known = one("SELECT COUNT(*) AS orders, SUM(d.device_class <> 'Unknown') AS known FROM fact_order o JOIN fact_order_device d ON d.order_key=o.order_key WHERE $W", $sc->p());

    out(['heat' => $heat, 'basket' => $basket, 'mix' => $mix, 'discount' => $disc, 'bands' => $bands, 'pairs' => $pairs, 'pair' => $pair,
         'gaps' => ['dist' => $gapDist, 'n' => count($gaps), 'median' => median($gaps), 'mean' => $gaps ? array_sum($gaps) / count($gaps) : null],
         'sequence' => $seq, 'payment_series' => $pay, 'payment_stats' => $payStats, 'device' => $device, 'device_known' => $known, 'gran' => $sc->gran()]);
}
