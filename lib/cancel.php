<?php
/** Cancellations: by product, size, colour, area, payment method, channel, device ... Port of api_cancel.py. */
declare(strict_types=1);

const ORDER_JOINS = 'FROM fact_order o LEFT JOIN fact_order_geo g ON g.order_key=o.order_key '
    . 'LEFT JOIN fact_order_attribution a ON a.order_key=o.order_key '
    . 'LEFT JOIN fact_order_device d ON d.order_key=o.order_key '
    . 'LEFT JOIN dim_customer c ON c.customer_key=o.customer_key';

// key => [SQL expression, label, group]
const ORDER_DIMS = [
    'state' => ['g.state', 'State', 'Area'],
    'city' => ['g.city_norm', 'City', 'Area'],
    'pincode' => ['g.pincode', 'Pincode', 'Area'],
    'payment_method' => ['o.payment_method', 'Payment method', 'Order'],
    'payment_gateway' => ['o.payment_gateway', 'Payment gateway', 'Order'],
    'channel' => ['a.channel', 'Acquisition channel', 'Order'],
    'device' => ["CONCAT(d.device_class, ' · ', d.os)", 'Device', 'Order'],
    'customer_type' => ["IF(c.first_order_date_ist < o.ordered_date_ist, 'Returning customer', 'New customer')", 'New or returning', 'Order'],
    'order_value' => ["CASE WHEN o.gross_amount < 600 THEN '1 · under ₹600' WHEN o.gross_amount < 1000 THEN '2 · ₹600–999' "
        . "WHEN o.gross_amount < 1500 THEN '3 · ₹1,000–1,499' WHEN o.gross_amount < 2500 THEN '4 · ₹1,500–2,499' ELSE '5 · ₹2,500 and above' END", 'Order value', 'Order'],
    'weekday' => ["ELT(WEEKDAY(o.ordered_date_ist) + 1, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun')", 'Day of week', 'Order'],
];
const CANCEL_ITEM_KEYS = ['product_type', 'colour_family', 'size', 'style_name', 'zip_style', 'feeding', 'pattern', 'price_band', 'product'];

function cancel_dimensions(): void
{
    $out = [];
    foreach (CANCEL_ITEM_KEYS as $k) {
        $out[] = ['key' => $k, 'label' => DIMS[$k][2], 'group' => 'Product', 'level' => 'item'];
    }
    foreach (ORDER_DIMS as $k => $v) {
        $out[] = ['key' => $k, 'label' => $v[1], 'group' => $v[2], 'level' => 'order'];
    }
    out($out);
}

function cancel_kp(array $p): array
{
    $W = W;
    return one("SELECT COUNT(*) AS orders, COALESCE(SUM(o.is_cancelled),0) AS cancelled, COALESCE(SUM(o.cancelled_amount),0) AS cancelled_value,
                       COALESCE(SUM(o.gross_amount),0) AS gross, COALESCE(SUM(o.cancelled_after_shipment),0) AS after_dispatch,
                       COALESCE(SUM(o.is_cancelled=1 AND o.cancelled_after_shipment=0),0) AS before_dispatch,
                       COALESCE(SUM(o.payment_method='COD'),0) AS cod, COALESCE(SUM(o.payment_method='COD' AND o.is_cancelled=1),0) AS cod_cancelled,
                       COALESCE(SUM(o.payment_method='PREPAID'),0) AS pre, COALESCE(SUM(o.payment_method='PREPAID' AND o.is_cancelled=1),0) AS pre_cancelled
                FROM fact_order o WHERE $W", $p);
}

function cancel_summary(): void
{
    $sc = scope();
    $W = W;
    $b = bucket($sc->gran(), 'o.ordered_date_ist');
    $series = q("SELECT $b AS d, COUNT(*) AS orders, SUM(o.is_cancelled) AS cancelled,
                        SUM(o.is_cancelled=1 AND o.cancelled_after_shipment=1) AS after_dispatch, SUM(o.cancelled_amount) AS value
                 FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());
    $sources = q("SELECT CONCAT_WS(' + ', IF(o.cancel_source LIKE '%%process%%', 'status update', NULL), IF(o.cancel_source LIKE '%%payload%%', 'cancelled at checkout', NULL),
                                   IF(o.cancel_source LIKE '%%voided%%', 'payment voided', NULL)) AS k, COUNT(*) AS n
                  FROM fact_order o WHERE $W AND o.is_cancelled=1 GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    $reasons = q("SELECT COALESCE(o.cancel_reason, 'Not stated') AS k, COUNT(*) AS n FROM fact_order o
                  WHERE $W AND o.is_cancelled=1 GROUP BY 1 ORDER BY 2 DESC", $sc->p());
    // Always by month, whatever the chart granularity: a change in how cancellations are recorded shows up month by month.
    $paySeries = q("SELECT DATE_FORMAT(o.ordered_date_ist, '%%Y-%%m-01') AS d,
                           SUM(o.payment_method='COD') AS cod, SUM(o.payment_method='COD' AND o.is_cancelled=1) AS cod_cancelled,
                           SUM(o.payment_method='PREPAID') AS pre, SUM(o.payment_method='PREPAID' AND o.is_cancelled=1) AS pre_cancelled
                    FROM fact_order o WHERE $W GROUP BY 1 ORDER BY 1", $sc->p());
    out(['kpis' => cancel_kp($sc->p()), 'prev' => $sc->prevStart() >= $sc->first ? cancel_kp($sc->prevP()) : null, 'gran' => $sc->gran(),
         'series' => fill($sc, $series, 'd', ['orders' => 0, 'cancelled' => 0, 'after_dispatch' => 0, 'value' => 0]),
         'pay_series' => $paySeries, 'sources' => $sources, 'reasons' => $reasons]);
}

function cancel_by(): void
{
    $sc = scope();
    $dim = qs('dim', 'product_type');
    $min = qint('min', 10, 1);
    [$W, $JOINS, $FROM] = [W, ORDER_JOINS, ITEM_FROM];
    if (isset(ORDER_DIMS[$dim])) {
        $expr = ORDER_DIMS[$dim][0];
        $rows = q("SELECT $expr AS k, COUNT(*) AS volume, COALESCE(SUM(o.is_cancelled),0) AS cancelled,
                          COALESCE(SUM(o.cancelled_amount),0) AS cancelled_value, COALESCE(SUM(o.cancelled_after_shipment),0) AS after_dispatch
                   $JOINS WHERE $W AND $expr IS NOT NULL GROUP BY 1", $sc->p());
        $unit = 'orders';
    } elseif (in_array($dim, CANCEL_ITEM_KEYS, true)) {
        $expr = DIMS[$dim][0];
        $rows = q("SELECT $expr AS k, SUM(i.quantity) AS volume, SUM(CASE WHEN i.is_cancelled=1 THEN i.quantity ELSE 0 END) AS cancelled,
                          SUM(CASE WHEN i.is_cancelled=1 THEN i.line_after_discount ELSE 0 END) AS cancelled_value, 0 AS after_dispatch
                   $FROM WHERE $W GROUP BY 1", $sc->p());
        $unit = 'units';
    } else {
        fail(400, 'unknown dim');
    }
    $totV = array_sum(array_column($rows, 'volume')) ?: 1;
    $totC = array_sum(array_column($rows, 'cancelled'));
    $overall = 100 * $totC / $totV;
    $out = [];
    foreach ($rows as $r) {
        if ($r['volume'] < $min) {
            continue;
        }
        $r['rate'] = 100 * $r['cancelled'] / $r['volume'];
        $r['lift'] = $overall ? $r['rate'] / $overall : null;
        $r['share_of_cancelled'] = $totC ? 100 * $r['cancelled'] / $totC : 0;
        $out[] = $r;
    }
    usort($out, fn($a, $b) => ($b['cancelled'] <=> $a['cancelled']) ?: strcmp((string)$a['k'], (string)$b['k']));
    out(['dim' => $dim, 'unit' => $unit, 'overall_rate' => $overall, 'total_volume' => $totV, 'total_cancelled' => $totC, 'rows' => $out,
         'hidden' => count($rows) - count($out), 'min' => $min]);
}
