<?php
/** Products & variants: best sellers, size / colour / type / zip / pattern analysis, variant explorer. Port of api_products.py. */
declare(strict_types=1);

const ITEM_FROM = 'FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key '
    . 'JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key';

const PRICE_BAND = "CASE WHEN i.unit_price < 500 THEN '1 · under ₹500' WHEN i.unit_price < 600 THEN '2 · ₹500–599' "
    . "WHEN i.unit_price < 800 THEN '3 · ₹600–799' WHEN i.unit_price < 1000 THEN '4 · ₹800–999' "
    . "WHEN i.unit_price < 1500 THEN '5 · ₹1,000–1,499' ELSE '6 · ₹1,500 and above' END";

// dimension name => [SQL expression, SQL ordering aggregate or null, label]
const DIMS = [
    'size' => ['i.size', 'MIN(i.size_order)', 'Size'],
    'colour_family' => ['p.colour_family', null, 'Colour family'],
    'colour_name' => ['p.colour_name', null, 'Colour'],
    'colour_shade' => ["COALESCE(p.colour_shade, 'Standard')", null, 'Shade'],
    'product_type' => ['p.product_type', null, 'Garment type'],
    'feeding' => ['p.feeding', null, 'Feeding'],
    'zip_style' => ['p.zip_style', null, 'Zip style'],
    'neck' => ['p.neck', null, 'Neck'],
    'sleeve' => ['p.sleeve', null, 'Sleeve'],
    'pattern' => ['p.pattern', null, 'Print / pattern'],
    'fabric' => ['p.fabric', null, 'Fabric'],
    'range_tag' => ['p.range_tag', null, 'Range'],
    'length_style' => ['p.length_style', null, 'Length'],
    'style_name' => ['COALESCE(p.style_name, p.title)', null, 'Design / style'],
    'price_band' => [PRICE_BAND, 'MIN(i.unit_price)', 'Price band'],
    'product' => ['p.title', null, 'Product'],
];

const METRICS = [
    'units' => 'SUM(i.quantity)',
    'units_net' => 'SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END)',
    'rev_net' => 'SUM(CASE WHEN i.is_cancelled=0 THEN i.line_after_discount ELSE 0 END)',
    'rev_gross' => 'SUM(i.line_after_discount)',
    'orders' => 'COUNT(DISTINCT i.order_key)',
    'cancel_rate' => '100 * SUM(CASE WHEN i.is_cancelled=1 THEN i.quantity ELSE 0 END) / NULLIF(SUM(i.quantity),0)',
];

const AGG = 'SUM(i.quantity) AS units,
         SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net,
         COUNT(DISTINCT i.order_key) AS orders,
         SUM(i.line_after_discount) AS rev_gross,
         SUM(CASE WHEN i.is_cancelled=0 THEN i.line_after_discount ELSE 0 END) AS rev_net,
         SUM(i.line_gross) / NULLIF(SUM(i.quantity),0) AS avg_price';

function dim_of(string $name): array
{
    if (!isset(DIMS[$name])) {
        fail(400, 'dim must be one of ' . implode(', ', array_keys(DIMS)));
    }
    return DIMS[$name];
}

function products_dimensions(): void
{
    $out = [];
    foreach (DIMS as $k => $v) {
        $out[] = ['key' => $k, 'label' => $v[2]];
    }
    out($out);
}

function products_by(): void
{
    $sc = scope();
    $dim = qs('dim', 'size');
    $limit = qint('limit', 40, null, 200);
    [$expr, $order, $label] = dim_of($dim);
    [$W, $FROM, $AGG] = [W, ITEM_FROM, AGG];
    $ordSel = $order ? ", $order AS ord" : '';
    $orderBy = $order ? 'ord, 1' : 'units_net DESC, units DESC, 1';
    $rows = q("SELECT $expr AS k, $AGG, COUNT(DISTINCT i.product_key) AS products
               $ordSel
               $FROM WHERE $W GROUP BY 1 ORDER BY $orderBy", $sc->p());
    foreach ($rows as &$r) {
        $r['cancelled_units'] = $r['units'] - $r['units_net'];
        $r['cancel_rate'] = $r['units'] ? 100 * $r['cancelled_units'] / $r['units'] : 0;
    }
    unset($r);
    out(['dim' => $dim, 'label' => $label, 'rows' => $order ? $rows : array_slice($rows, 0, $limit), 'total_rows' => count($rows)]);
}

function products_top(): void
{
    $sc = scope();
    $sort = qs('sort', 'units_net');
    $limit = qint('limit', 30, null, 100);
    if (!in_array($sort, ['units_net', 'units', 'rev_net', 'cancel_rate'], true)) {
        fail(400, 'bad sort');
    }
    [$W, $FROM, $AGG] = [W, ITEM_FROM, AGG];
    $rows = q("SELECT i.product_key, p.title, p.product_type, p.colour_name, p.colour_family, p.feeding, p.zip_style,
                      p.style_name, $AGG, MIN(o.ordered_date_ist) AS first_sold, MAX(o.ordered_date_ist) AS last_sold,
                      100 * (1 - SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) / NULLIF(SUM(i.quantity),0)) AS cancel_rate
               $FROM WHERE $W
               GROUP BY i.product_key, p.title, p.product_type, p.colour_name, p.colour_family, p.feeding, p.zip_style, p.style_name
               ORDER BY $sort DESC, units DESC, i.product_key LIMIT %s", array_merge($sc->p(), [$limit]));
    if ($rows) {
        $keys = array_column($rows, 'product_key');
        $marks = placeholders(count($keys));
        $mix = q("SELECT i.product_key, i.size, MIN(i.size_order) AS ord,
                         SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net
                  $FROM WHERE $W AND i.product_key IN ($marks) GROUP BY i.product_key, i.size", array_merge($sc->p(), $keys));
        $by = [];
        foreach ($mix as $m) {
            $by[key_id($m['product_key'])][] = ['size' => $m['size'], 'ord' => $m['ord'], 'units' => $m['units_net']];
        }
        foreach ($rows as &$r) {
            $sizes = $by[key_id($r['product_key'])] ?? [];
            usort($sizes, fn($a, $b) => $a['ord'] <=> $b['ord']);
            $r['sizes'] = $sizes;
        }
        unset($r);
    }
    out(['rows' => $rows]);
}

/** Axis order for the cross-tab: by the ordering aggregate when there is one, otherwise by units, biggest first. */
function ct_order(array $rows, string $axis, string $ordKey): array
{
    $seen = [];
    if ($rows && array_key_exists($ordKey, $rows[0])) {
        foreach ($rows as $r) {
            $id = key_id($r[$axis]);
            $seen[$id] = [$r[$axis], isset($seen[$id]) ? min($seen[$id][1], $r[$ordKey]) : min(1e18, $r[$ordKey])];
        }
        $items = array_values($seen);
        usort($items, fn($a, $b) => ($a[1] <=> $b[1]) ?: strcmp((string)$a[0], (string)$b[0]));
    } else {
        foreach ($rows as $r) {
            $id = key_id($r[$axis]);
            $seen[$id] = [$r[$axis], ($seen[$id][1] ?? 0) + ($r['units'] ?? 0)];
        }
        $items = array_values($seen);
        usort($items, fn($a, $b) => ($b[1] <=> $a[1]) ?: strcmp((string)$a[0], (string)$b[0]));
    }
    return array_column($items, 0);
}

function products_crosstab(): void
{
    $sc = scope();
    $x = qs('x', 'size');
    $y = qs('y', 'product_type');
    $metric = qs('metric', 'units_net');
    [$xe, $xo, $xl] = dim_of($x);
    [$ye, $yo, $yl] = dim_of($y);
    if (!isset(METRICS[$metric])) {
        fail(400, 'bad metric');
    }
    [$W, $FROM] = [W, ITEM_FROM];
    $m = METRICS[$metric];
    $xs_ = $xo ? ", $xo AS xo" : '';
    $ys_ = $yo ? ", $yo AS yo" : '';
    $rows = q("SELECT $xe AS x, $ye AS y, $m AS v, SUM(i.quantity) AS units
               $xs_ $ys_
               $FROM WHERE $W GROUP BY 1, 2", $sc->p());
    $xs = array_slice(ct_order($rows, 'x', 'xo'), 0, 30);
    $ys = array_slice(ct_order($rows, 'y', 'yo'), 0, 30);
    $cells = [];
    foreach ($rows as $r) {
        if (in_array($r['x'], $xs, true) && in_array($r['y'], $ys, true)) {
            $cells[] = ['x' => $r['x'], 'y' => $r['y'], 'v' => $r['v'], 'units' => $r['units']];
        }
    }
    out(['x' => $x, 'y' => $y, 'x_label' => $xl, 'y_label' => $yl, 'metric' => $metric, 'xs' => $xs, 'ys' => $ys, 'cells' => $cells]);
}

function products_trend(): void
{
    $sc = scope();
    $dim = qs('dim', 'colour_family');
    $top = qint('top', 6, null, 8);
    [$expr, , $label] = dim_of($dim);
    [$W, $FROM] = [W, ITEM_FROM];
    $leaders = q("SELECT $expr AS k, SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net
                  $FROM WHERE $W GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT %s", array_merge($sc->p(), [$top]));
    $names = array_column($leaders, 'k');
    if (!$names) {
        out(['dim' => $dim, 'label' => $label, 'series' => [], 'keys' => []]);
    }
    $marks = placeholders(count($names));
    $b = bucket($sc->gran(), 'o.ordered_date_ist');
    $rows = q("SELECT $b AS d, $expr AS k,
                      SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net
               $FROM WHERE $W AND $expr IN ($marks) GROUP BY 1, 2", array_merge($sc->p(), $names));
    $pivot = [];
    foreach ($rows as $r) {
        $pivot['k' . $r['d']] ??= ['d' => $r['d']];
        $pivot['k' . $r['d']][$r['k']] = $r['units_net'];
    }
    $zero = [];
    foreach ($names as $n) {
        $zero[$n] = 0;
    }
    $series = fill($sc, array_values($pivot), 'd', $zero);
    foreach ($series as &$s) {
        foreach ($names as $n) {
            $s[$n] ??= 0;
        }
    }
    unset($s);
    out(['dim' => $dim, 'label' => $label, 'keys' => $names, 'series' => $series, 'gran' => $sc->gran()]);
}

function products_variants(): void
{
    $sc = scope();
    $sort = qs('sort', 'units_net');
    $limit = qint('limit', 40, null, 150);
    if (!in_array($sort, ['units_net', 'rev_net', 'cancel_rate', 'units'], true)) {
        fail(400, 'bad sort');
    }
    [$W, $FROM, $AGG] = [W, ITEM_FROM, AGG];
    $rows = q("SELECT i.product_key, p.title, i.size, p.product_type, p.colour_name, $AGG,
                      100 * (1 - SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) / NULLIF(SUM(i.quantity),0)) AS cancel_rate
               $FROM WHERE $W
               GROUP BY i.product_key, p.title, i.size, p.product_type, p.colour_name
               HAVING SUM(i.quantity) >= 1
               ORDER BY $sort DESC, units DESC, i.product_key, i.size LIMIT %s", array_merge($sc->p(), [$limit]));
    out(['rows' => $rows]);
}
