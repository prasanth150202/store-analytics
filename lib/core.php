<?php
/** Context (what data exists) and the Overview page. Port of api_core.py. */
declare(strict_types=1);

function ctx_context(): void
{
    $brands = q('SELECT brand, MIN(ordered_date_ist) AS first, MAX(ordered_date_ist) AS last, COUNT(*) AS orders FROM fact_order GROUP BY brand');
    $meta = q_safe('SELECT brand, kind, COUNT(DISTINCT file_name) AS files, MIN(date_min) AS date_min, MAX(date_max) AS date_max FROM ' . dash() . '.meta_load_log GROUP BY brand, kind');
    $byBrand = [];
    foreach ($brands as $b) {
        $byBrand[$b['brand']] = $b;
    }
    out(['snapshot' => SNAPSHOT, 'brands' => $byBrand, 'meta' => $meta]);
}

function ctx_kpis(array $p): array
{
    $W = W;
    $k = one("SELECT COUNT(*) AS orders, COALESCE(SUM(o.is_cancelled),0) AS cancelled, COALESCE(SUM(o.gross_amount),0) AS gross,
                     COALESCE(SUM(o.cancelled_amount),0) AS cancelled_value, COALESCE(SUM(o.net_amount),0) AS net,
                     COUNT(DISTINCT o.customer_key) AS customers, COALESCE(SUM(o.payment_method='COD'),0) AS cod_orders,
                     COALESCE(SUM(o.delivery_stage='delivered' AND o.is_cancelled=0),0) AS delivered
              FROM fact_order o WHERE $W", $p);
    $u = one("SELECT COALESCE(SUM(i.quantity),0) AS units,
                     COALESCE(SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity END),0) AS units_net
              FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key WHERE $W", $p);
    $n = one('SELECT COUNT(*) AS new_customers FROM dim_customer WHERE brand=%s AND first_order_date_ist BETWEEN %s AND %s', $p);
    $r = one("SELECT COALESCE(SUM(c.first_order_date_ist < o.ordered_date_ist),0) AS returning_orders
              FROM fact_order o JOIN dim_customer c ON c.customer_key=o.customer_key WHERE $W", $p);
    $k = array_merge($k, $u, $n, $r);
    $k['net_orders'] = $k['orders'] - $k['cancelled'];
    return $k;
}

function ctx_overview(): void
{
    $sc = scope();
    $W = W;
    $b = bucket($sc->gran(), 'o.ordered_date_ist');
    $series = q("SELECT $b AS d, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled,
                        SUM(o.net_amount) AS net, SUM(o.gross_amount) AS gross
                 FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());
    $payment = q("SELECT o.payment_method AS k, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled, SUM(o.net_amount) AS net
                  FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    $channels = q("SELECT a.channel AS k, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled, SUM(o.net_amount) AS net
                   FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key
                   WHERE $W GROUP BY 1 ORDER BY 4 DESC", $sc->p());
    $top = q("SELECT p.title, p.product_type, p.colour_name, p.colour_family,
                     SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net,
                     SUM(CASE WHEN i.is_cancelled=0 THEN i.line_after_discount ELSE 0 END) AS rev_net
              FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key
              JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key
              WHERE $W GROUP BY i.product_key, p.title, p.product_type, p.colour_name, p.colour_family
              ORDER BY units_net DESC, rev_net DESC, p.title LIMIT 6", $sc->p());
    $stages = q("SELECT o.delivery_stage AS k, COUNT(*) AS orders FROM fact_order o
                 WHERE $W AND o.is_cancelled=0 GROUP BY 1", $sc->p());
    $states = q("SELECT g.state AS k, COUNT(*) AS orders, SUM(o.net_amount) AS net
                 FROM fact_order o JOIN fact_order_geo g ON g.order_key=o.order_key
                 WHERE $W GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1 LIMIT 8", $sc->p());
    out([
        'scope' => ['start' => $sc->start, 'end' => $sc->end, 'gran' => $sc->gran(), 'prev_start' => $sc->prevStart(), 'prev_end' => $sc->prevEnd()],
        'kpis' => ctx_kpis($sc->p()),
        'prev' => $sc->prevStart() >= $sc->first ? ctx_kpis($sc->prevP()) : null,
        'series' => fill($sc, $series, 'd', ['orders' => 0, 'cancelled' => 0, 'net' => 0, 'gross' => 0]),
        'payment' => $payment, 'channels' => $channels, 'top_products' => $top, 'stages' => $stages, 'states' => $states,
    ]);
}
