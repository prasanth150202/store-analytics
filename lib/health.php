<?php
/** Data health: what the numbers can and cannot be trusted for. Port of api_health.py. */
declare(strict_types=1);

function health_overview(): void
{
    $sc = scope();
    $b = [$sc->brand];
    $attr = one("SELECT COUNT(*) AS orders, SUM(a.campaign_id IS NOT NULL) AS with_id, SUM(a.campaign_id IS NULL AND a.campaign_name IS NOT NULL) AS name_only,
                        SUM(a.channel='Direct / unknown') AS direct, SUM(a.campaign_id_source='inferred_from_name') AS inferred_id
                 FROM fact_order_attribution a WHERE a.brand=%s", $b);
    $prod = one("SELECT SUM(i.quantity) AS units, SUM(CASE WHEN p.colour_family<>'Unknown' THEN i.quantity ELSE 0 END) AS colour_units,
                        SUM(CASE WHEN i.size<>'Unknown' THEN i.quantity ELSE 0 END) AS size_units, COUNT(DISTINCT i.product_key) AS designs,
                        SUM(CASE WHEN p.colour_confidence='low' THEN i.quantity ELSE 0 END) AS low_conf_units
                 FROM fact_order_item i JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key WHERE i.brand=%s", $b);
    $chk = one("SELECT COUNT(*) AS captured, SUM(link_method='checkout_id') AS by_id, SUM(link_method='phone_time') AS by_phone_time, SUM(phone_key IS NOT NULL) AS with_phone FROM fact_checkout WHERE brand=%s", $b);
    $orders = one('SELECT COUNT(*) AS n FROM fact_order WHERE brand=%s', $b);
    $missing = q('SELECT category AS k, COUNT(*) AS n, MIN(order_number) AS lo, MAX(order_number) AS hi FROM dq_missing_order_number WHERE brand=%s GROUP BY 1', $b);
    $issues = q('SELECT issue_code AS k, severity, COUNT(*) AS n FROM dq_issue_log WHERE brand=%s GROUP BY 1, 2 ORDER BY 3 DESC', $b);
    $checks = q("SELECT status, COUNT(*) AS n FROM validation_check WHERE brand IN (%s, 'ALL') GROUP BY 1", $b);
    $failing = q("SELECT check_name, expected, actual FROM validation_check WHERE brand IN (%s, 'ALL') AND status='FAIL'", $b);
    $loads = q_safe('SELECT file_name, kind, rows_loaded, date_min, date_max, spend_total, attribution_setting, loaded_at FROM ' . dash() . '.meta_load_log WHERE brand=%s ORDER BY load_id DESC LIMIT 30', $b);
    $span = one('SELECT MIN(ordered_date_ist) AS first, MAX(ordered_date_ist) AS last FROM fact_order WHERE brand=%s', $b);
    $late = one('SELECT SUM(is_late_captured) AS late, SUM(is_offset_anomaly) AS offset_anomaly FROM fact_order WHERE brand=%s', $b);
    out(['snapshot' => SNAPSHOT, 'span' => $span, 'orders' => $orders['n'], 'attribution' => $attr, 'products' => $prod, 'checkouts' => $chk, 'missing' => $missing, 'issues' => $issues,
         'checks' => $checks, 'failing' => $failing, 'meta' => meta_status($sc->brand), 'loads' => $loads, 'late' => $late]);
}
