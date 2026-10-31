<?php
/**
 * Campaigns, channels and funnel. Meta spend comes from the Meta tables (loaded from your CSV exports);
 * orders come from the cleaned tables. Campaigns are matched by Meta campaign id first, exact campaign name second.
 * Port of api_marketing.py.
 */
declare(strict_types=1);

// level => [meta table, meta key expr, meta name expr, DB key expr, DB name expr]
const MKT_LEVELS = [
    'campaign' => ['meta_campaign_daily', 'campaign_id', 'MAX(campaign_name)', null, 'MAX(a.campaign_name)'],
    'adset' => ['meta_adset_daily', 'LOWER(adset_name)', 'MAX(adset_name)', 'LOWER(a.adset_name)', 'MAX(a.adset_name)'],
    'ad' => ['meta_ad_daily', 'LOWER(ad_name)', 'MAX(ad_name)', 'LOWER(a.ad_name)', 'MAX(a.ad_name)'],
];
const MKT_MET = ['spend', 'impressions', 'reach', 'link_clicks', 'landing_page_views', 'add_to_cart', 'checkouts_initiated', 'purchases', 'purchase_value'];

function meta_status(string $brand): array
{
    $out = [];
    $D = dash();
    foreach (['campaign' => 'meta_campaign_daily', 'placement' => 'meta_campaign_placement_daily', 'adset' => 'meta_adset_daily',
              'ad' => 'meta_ad_daily', 'region' => 'meta_campaign_region'] as $kind => $table) {
        if ($kind === 'region') {
            $r = q_safe("SELECT COUNT(*) AS n FROM $D.$table WHERE brand=%s", [$brand]);
            $out[$kind] = ['rows' => $r ? $r[0]['n'] : 0];
        } else {
            $r = q_safe("SELECT COUNT(*) AS n, MIN(day) AS a, MAX(day) AS b, ROUND(SUM(spend),2) AS spend FROM $D.$table WHERE brand=%s", [$brand]);
            $out[$kind] = ['rows' => $r ? $r[0]['n'] : 0, 'from' => $r ? $r[0]['a'] : null, 'to' => $r ? $r[0]['b'] : null, 'spend' => $r ? $r[0]['spend'] : null];
        }
    }
    return $out;
}

function mkt_status(): void
{
    out(meta_status(scope()->brand));
}

function mkt_campaigns(): void
{
    $sc = scope();
    $level = qs('level', 'campaign');
    if (!isset(MKT_LEVELS[$level])) {
        fail(400, 'level must be campaign, adset or ad');
    }
    [$table, $mkey, $mname, $dkey, $dname] = MKT_LEVELS[$level];
    $D = dash();
    $W = W;
    $status = meta_status($sc->brand);
    $hasMeta = $status[$level === 'campaign' ? 'campaign' : $level]['rows'] > 0;

    // ---- Meta side ----
    $meta = [];
    if ($hasMeta) {
        $sums = implode(', ', array_map(fn($m) => "SUM($m) AS $m", MKT_MET));
        foreach (q("SELECT $mkey AS k, $mname AS name, $sums
                    FROM $D.$table WHERE brand=%s AND day BETWEEN %s AND %s GROUP BY 1", $sc->p()) as $r) {
            if ($r['k'] !== null) {
                $meta[(string)$r['k']] = $r;
            }
        }
    }

    // ---- orders side ----
    if ($level === 'campaign') {
        $keyExpr = "COALESCE(a.campaign_id, mm.campaign_id, CONCAT('name:', LOWER(a.campaign_name)))";
        $cond = '(a.campaign_id IS NOT NULL OR mm.campaign_id IS NOT NULL OR a.campaign_name IS NOT NULL)';
        $join = "LEFT JOIN (SELECT brand, LOWER(campaign_name) AS lname, MIN(campaign_id) AS campaign_id FROM $D.meta_campaign_daily "
            . 'GROUP BY brand, LOWER(campaign_name)) mm ON mm.brand=a.brand AND a.campaign_id IS NULL AND mm.lname=LOWER(a.campaign_name)';
        $byId = 'SUM(a.campaign_id IS NOT NULL)';
        $byName = 'SUM(a.campaign_id IS NULL AND mm.campaign_id IS NOT NULL)';
        $nameExpr = 'MAX(a.campaign_name)';
    } else {
        $keyExpr = $dkey;
        $cond = "$dkey IS NOT NULL";
        $join = '';
        [$byId, $byName] = ['0', 'COUNT(*)'];
        $nameExpr = $dname;
    }
    $orders = q("SELECT $keyExpr AS k, $nameExpr AS name, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled, SUM(o.gross_amount) AS gross,
                        SUM(o.net_amount) AS net, $byId AS by_id, $byName AS by_name, SUM(c.first_order_date_ist = o.ordered_date_ist) AS new_customers
                 FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key
                 LEFT JOIN dim_customer c ON c.customer_key=o.customer_key $join
                 WHERE $W AND a.channel IN ('Meta paid', 'Meta untagged') AND $cond GROUP BY 1", $sc->p());

    $zeroMet = array_fill_keys(MKT_MET, 0);
    $rows = [];
    foreach ($meta as $k => $m) {
        $metaPart = [];
        foreach (MKT_MET as $x) {
            $metaPart[$x] = (float)($m[$x] ?? 0);
        }
        $rows['k' . $k] = ['key' => $k, 'name' => $m['name']] + $metaPart
            + ['orders' => 0, 'cancelled' => 0, 'gross' => 0, 'net' => 0, 'by_id' => 0, 'by_name' => 0, 'new_customers' => 0, 'in_meta' => true];
    }
    foreach ($orders as $o) {
        $k = (string)$o['k'];
        $rows['k' . $k] ??= ['key' => $k, 'name' => $o['name']] + $zeroMet + ['in_meta' => false];
        foreach (['orders', 'cancelled', 'gross', 'net', 'by_id', 'by_name', 'new_customers'] as $x) {
            $rows['k' . $k][$x] = (float)($o[$x] ?? 0);
        }
        $rows['k' . $k]['name'] = $rows['k' . $k]['name'] ?: $o['name'];
    }
    $out = [];
    foreach ($rows as $r) {
        $kept = $r['orders'] - $r['cancelled'];
        $r += [
            'kept_orders' => $kept,
            'cancel_rate' => $r['orders'] ? 100 * $r['cancelled'] / $r['orders'] : null,
            'ctr' => ratio(100 * $r['link_clicks'], $r['impressions']),
            'cpc' => ratio($r['spend'], $r['link_clicks']),
            'cpm' => ratio(1000 * $r['spend'], $r['impressions']),
            'meta_roas' => ratio($r['purchase_value'], $r['spend']),
            'db_roas' => $r['spend'] ? ratio($r['net'], $r['spend']) : null,
            'cpa' => $r['spend'] ? ratio($r['spend'], $kept) : null,
            'aov' => ratio($r['net'], $kept),
            'meta_cpa' => ratio($r['spend'], $r['purchases']),
            'atc_rate' => ratio(100 * $r['add_to_cart'], $r['landing_page_views'] ?: $r['link_clicks']),
            'new_share' => ratio(100 * $r['new_customers'], $r['orders']),
        ];
        $out[] = $r;
    }
    usort($out, fn($a, $b) => [-($a['spend'] ?: 0), -($a['net'] ?: 0)] <=> [-($b['spend'] ?: 0), -($b['net'] ?: 0)]);

    // ---- coverage: how much of the order data this analysis can see ----
    $cov = one("SELECT COUNT(*) AS orders, COALESCE(SUM(a.campaign_id IS NOT NULL),0) AS with_id,
                       COALESCE(SUM(a.campaign_id IS NULL AND a.campaign_name IS NOT NULL),0) AS name_only,
                       COALESCE(SUM(a.channel='Meta paid'),0) AS meta_paid, COALESCE(SUM(a.channel IN ('Meta paid','Meta untagged')),0) AS meta_any,
                       COALESCE(SUM(a.channel='Meta paid' AND a.campaign_id IS NULL AND a.campaign_name IS NULL),0) AS meta_paid_unattributed
                FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key WHERE $W", $sc->p());
    $tot = [];
    foreach (MKT_MET as $m) {
        $tot[$m] = array_sum(array_column($out, $m));
    }
    $tot['orders'] = array_sum(array_column($out, 'orders'));
    $tot['net'] = array_sum(array_column($out, 'net'));
    $tot['cancelled'] = array_sum(array_column($out, 'cancelled'));
    $matched = array_filter($out, fn($r) => $r['orders'] > 0 && $r['in_meta']);
    $cov['orders_matched_to_meta'] = array_sum(array_column($matched, 'orders'));
    $cov['spend_matched'] = array_sum(array_column($matched, 'spend'));

    // ---- trends (campaign level only) ----
    $spendSeries = $ordersSeries = [];
    if ($hasMeta && $level === 'campaign') {
        $bd = bucket($sc->gran(), 'day');
        $spendSeries = fill($sc, q("SELECT $bd AS d, SUM(spend) AS spend, SUM(purchases) AS purchases, SUM(purchase_value) AS value
                                    FROM $D.meta_campaign_daily WHERE brand=%s AND day BETWEEN %s AND %s GROUP BY 1 ORDER BY 1", $sc->p()),
            'd', ['spend' => 0, 'purchases' => 0, 'value' => 0]);
    }
    if ($level === 'campaign') {
        $bo = bucket($sc->gran(), 'o.ordered_date_ist');
        $ordersSeries = fill($sc, q("SELECT $bo AS d, COUNT(*) AS orders, SUM(o.net_amount) AS net
                                     FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key
                                     WHERE $W AND (a.campaign_id IS NOT NULL OR a.channel='Meta paid') GROUP BY 1 ORDER BY 1", $sc->p()),
            'd', ['orders' => 0, 'net' => 0]);
    }
    out(['level' => $level, 'meta' => $status, 'has_meta' => $hasMeta, 'rows' => $out, 'totals' => $tot, 'coverage' => $cov, 'gran' => $sc->gran(),
         'spend_series' => $spendSeries, 'orders_series' => $ordersSeries]);
}

function mkt_channels(): void
{
    $sc = scope();
    $W = W;
    $base = "FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key
             LEFT JOIN dim_customer c ON c.customer_key=o.customer_key WHERE $W";
    $rows = q("SELECT a.channel AS k, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled, SUM(o.gross_amount) AS gross, SUM(o.net_amount) AS net,
                      SUM(c.first_order_date_ist = o.ordered_date_ist) AS new_customers, SUM(o.payment_method='COD') AS cod
               $base GROUP BY 1 ORDER BY 5 DESC", $sc->p());
    foreach ($rows as &$r) {
        $kept = $r['orders'] - $r['cancelled'];
        $r['kept'] = $kept;
        $r['cancel_rate'] = 100 * $r['cancelled'] / $r['orders'];
        $r['aov'] = $kept ? $r['net'] / $kept : null;
        $r['new_share'] = 100 * $r['new_customers'] / $r['orders'];
        $r['cod_share'] = 100 * $r['cod'] / $r['orders'];
    }
    unset($r);
    $b = bucket($sc->gran(), 'o.ordered_date_ist');
    $trend = q("SELECT $b AS d, a.channel AS k, COUNT(*) AS orders, SUM(o.net_amount) AS net $base GROUP BY 1, 2", $sc->p());
    $pivot = [];
    foreach ($trend as $t) {
        $pivot['k' . $t['d']] ??= ['d' => $t['d']];
        $pivot['k' . $t['d']][$t['k']] = $t['orders'];
    }
    $keys = array_column($rows, 'k');
    $zero = [];
    foreach ($keys as $k) {
        $zero[$k] = 0;
    }
    $series = fill($sc, array_values($pivot), 'd', $zero);
    foreach ($series as &$s) {
        foreach ($keys as $k) {
            $s[$k] ??= 0;
        }
    }
    unset($s);
    $utm = q("SELECT COALESCE(a.utm_source, '(none)') AS source, COALESCE(a.utm_medium, '(none)') AS medium, a.channel AS channel, COUNT(*) AS orders,
                     SUM(o.net_amount) AS net, 100 * SUM(o.is_cancelled) / COUNT(*) AS cancel_rate
              $base GROUP BY 1, 2, 3 ORDER BY 4 DESC, 5 DESC, 1, 2, 3 LIMIT 40", $sc->p());
    $st = meta_status($sc->brand);
    $placement = [];
    if ($st['placement']['rows']) {
        $D = dash();
        $placement = q("SELECT platform, placement, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(link_clicks) AS link_clicks,
                               SUM(add_to_cart) AS add_to_cart, SUM(purchases) AS purchases, SUM(purchase_value) AS purchase_value
                        FROM $D.meta_campaign_placement_daily WHERE brand=%s AND day BETWEEN %s AND %s GROUP BY 1, 2 ORDER BY 3 DESC", $sc->p());
        foreach ($placement as &$r) {
            $r['ctr'] = ratio(100 * ($r['link_clicks'] ?? 0), $r['impressions']);
            $r['cpc'] = ratio($r['spend'], $r['link_clicks']);
            $r['cpm'] = ratio(1000 * ($r['spend'] ?? 0), $r['impressions']);
            $r['roas'] = ratio($r['purchase_value'], $r['spend']);
            $r['cpa'] = ratio($r['spend'], $r['purchases']);
        }
        unset($r);
    }
    out(['rows' => $rows, 'keys' => $keys, 'series' => $series, 'gran' => $sc->gran(), 'utm' => $utm, 'placement' => $placement, 'meta' => $st]);
}

function mkt_funnel(): void
{
    $sc = scope();
    $W = W;
    $D = dash();
    $st = meta_status($sc->brand);
    $acq = null;
    if ($st['campaign']['rows']) {
        $acq = one("SELECT SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(link_clicks) AS link_clicks, SUM(landing_page_views) AS landing_page_views,
                           SUM(add_to_cart) AS add_to_cart, SUM(checkouts_initiated) AS checkouts_initiated, SUM(purchases) AS purchases,
                           SUM(purchase_value) AS purchase_value, SUM(spend) AS spend
                    FROM $D.meta_campaign_daily WHERE brand=%s AND day BETWEEN %s AND %s", $sc->p());
    }
    $dbMeta = one("SELECT COUNT(*) AS orders, COALESCE(SUM(o.is_cancelled=0),0) AS kept, COALESCE(SUM(o.net_amount),0) AS net
                   FROM fact_order o JOIN fact_order_attribution a ON a.order_key=o.order_key WHERE $W AND a.channel='Meta paid'", $sc->p());
    $chk = one("SELECT COUNT(*) AS captured, COALESCE(SUM(phone_key IS NOT NULL),0) AS with_phone, COALESCE(SUM(outcome='purchased'),0) AS purchased,
                       COALESCE(SUM(link_method='checkout_id'),0) AS by_id, COALESCE(SUM(link_method='phone_time'),0) AS by_phone_time
                FROM fact_checkout WHERE brand=%s AND created_date_ist BETWEEN %s AND %s", $sc->p());
    $linked = one("SELECT COALESCE(SUM(o.is_cancelled=0),0) AS kept, COALESCE(SUM(o.is_cancelled=0 AND o.delivery_stage<>'not_shipped'),0) AS shipped,
                          COALESCE(SUM(o.is_cancelled=0 AND o.delivery_stage='delivered'),0) AS delivered
                   FROM fact_checkout c JOIN fact_order o ON o.order_key=c.order_key
                   WHERE c.brand=%s AND c.created_date_ist BETWEEN %s AND %s", $sc->p());
    $orders = one("SELECT COUNT(*) AS placed, COALESCE(SUM(o.is_cancelled=0),0) AS kept, COALESCE(SUM(o.is_cancelled=0 AND o.delivery_stage<>'not_shipped'),0) AS shipped,
                          COALESCE(SUM(o.is_cancelled=0 AND o.delivery_stage='delivered'),0) AS delivered FROM fact_order o WHERE $W", $sc->p());
    $byChannel = q("SELECT channel_simple AS k, COUNT(*) AS checkouts, SUM(outcome='purchased') AS purchased
                    FROM fact_checkout WHERE brand=%s AND created_date_ist BETWEEN %s AND %s GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    out(['meta' => $st, 'acquisition' => $acq, 'db_meta' => $dbMeta, 'checkouts' => $chk, 'checkout_orders' => $linked, 'orders' => $orders, 'by_channel' => $byChannel]);
}
