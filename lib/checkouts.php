<?php
/** Abandoned checkout analysis (checkouts captured by the recovery automation, linked to orders). Port of api_checkouts.py. */
declare(strict_types=1);

const CHECKOUT_W = 'c.brand=%s AND c.created_date_ist BETWEEN %s AND %s';

/**
 * The shared scope stops at the first and last ORDER date. Carts are captured a little before the first
 * order and after the last one, so when the range reaches either end, open it up to the first/last cart.
 */
function checkout_scope(): Scope
{
    $sc = scope();
    $r = one('SELECT MIN(created_date_ist) AS a, MAX(created_date_ist) AS b FROM fact_checkout WHERE brand=%s', [$sc->brand]);
    if (empty($r['a'])) {
        return $sc;
    }
    $start = $sc->start === $sc->first ? min($sc->start, $r['a']) : $sc->start;
    $end = $sc->end === $sc->last ? max($sc->end, $r['b']) : $sc->end;
    return $sc->with($start, $end);
}

function checkouts_overview(): void
{
    $sc = checkout_scope();
    $W = CHECKOUT_W;
    $k = one("SELECT COUNT(*) AS captured, COALESCE(SUM(c.outcome='purchased'),0) AS purchased, COALESCE(SUM(c.outcome='abandoned'),0) AS abandoned,
                     COALESCE(SUM(CASE WHEN c.outcome='abandoned' THEN COALESCE(c.total_price,0) END),0) AS abandoned_value,
                     COALESCE(SUM(c.outcome='abandoned' AND c.phone_key IS NOT NULL),0) AS abandoned_with_phone,
                     COALESCE(SUM(c.outcome='abandoned' AND c.triggered=1),0) AS abandoned_triggered,
                     COALESCE(SUM(c.recovered),0) AS recovered,
                     COALESCE(SUM(CASE WHEN c.contact_status='invalid_config' AND c.outcome='abandoned' THEN COALESCE(c.total_price,0) END),0) AS misconfigured_value,
                     COALESCE(SUM(c.contact_status='invalid_config' AND c.outcome='abandoned'),0) AS misconfigured,
                     COALESCE(SUM(c.contact_status='invalid_phone' AND c.outcome='abandoned'),0) AS no_phone,
                     COALESCE(SUM(CASE WHEN c.contact_status='invalid_phone' AND c.outcome='abandoned' THEN COALESCE(c.total_price,0) END),0) AS no_phone_value
              FROM fact_checkout c WHERE $W", $sc->p());
    $rec = one("SELECT COALESCE(SUM(o.net_amount),0) AS recovered_revenue FROM fact_checkout c JOIN fact_order o ON o.order_key=c.order_key
                WHERE $W AND c.recovered=1", $sc->p());
    $k = array_merge($k, $rec);
    $status = q("SELECT c.contact_status AS k, COUNT(*) AS carts, COALESCE(SUM(c.total_price),0) AS value FROM fact_checkout c
                 WHERE $W AND c.outcome='abandoned' GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    $b = bucket($sc->gran(), 'c.created_date_ist');
    $series = q("SELECT $b AS d, COUNT(*) AS captured, SUM(c.outcome='purchased') AS purchased, SUM(c.outcome='abandoned') AS abandoned,
                        SUM(CASE WHEN c.outcome='abandoned' THEN COALESCE(c.total_price,0) END) AS abandoned_value
                 FROM fact_checkout c WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());
    $heat = q("SELECT WEEKDAY(c.created_date_ist) AS wd, HOUR(CONVERT_TZ(c.created_at_utc, '+00:00', '+05:30')) AS hr, COUNT(*) AS carts
               FROM fact_checkout c WHERE $W AND c.outcome='abandoned' GROUP BY 1, 2", $sc->p());
    $sources = q("SELECT c.channel_simple AS k, COUNT(*) AS captured, SUM(c.outcome='purchased') AS purchased, SUM(c.outcome='abandoned') AS abandoned,
                         SUM(CASE WHEN c.outcome='abandoned' THEN COALESCE(c.total_price,0) END) AS abandoned_value
                  FROM fact_checkout c WHERE $W GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    $products = q("SELECT COALESCE(p.title, c.line_item_titles) AS title, p.product_type, p.colour_family, COUNT(*) AS carts, SUM(COALESCE(c.total_price,0)) AS value
                   FROM fact_checkout c LEFT JOIN dim_product p ON p.brand=c.brand AND p.title=c.line_item_titles
                   WHERE $W AND c.outcome='abandoned' AND c.line_item_titles IS NOT NULL AND c.line_item_titles<>'' GROUP BY 1, 2, 3 ORDER BY 4 DESC, 5 DESC, 1, 2, 3 LIMIT 25", $sc->p());
    $bands = q("SELECT CASE WHEN COALESCE(c.total_price,0) < 600 THEN '1 · under ₹600' WHEN c.total_price < 1000 THEN '2 · ₹600–999' WHEN c.total_price < 1500 THEN '3 · ₹1,000–1,499'
                            WHEN c.total_price < 2500 THEN '4 · ₹1,500–2,499' ELSE '5 · ₹2,500 and above' END AS k, COUNT(*) AS carts,
                       SUM(c.outcome='abandoned') AS abandoned
                FROM fact_checkout c WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());
    out(['kpis' => $k, 'status' => $status, 'gran' => $sc->gran(),
         'series' => fill($sc, $series, 'd', ['captured' => 0, 'purchased' => 0, 'abandoned' => 0, 'abandoned_value' => 0]),
         'heat' => $heat, 'sources' => $sources, 'products' => $products, 'bands' => $bands]);
}
