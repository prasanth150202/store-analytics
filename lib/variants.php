<?php
/**
 * AHA variant lab: one row per design with every style detail and its sales, so the page can regroup
 * and compare any combination of details instantly. Port of api_variants.py.
 */
declare(strict_types=1);

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'Free (M-XXL)', 'Unknown'];

function price_band($price): string
{
    if ($price === null) {
        return 'Unknown';
    }
    foreach ([[500, 'Under ₹500'], [600, '₹500–599'], [800, '₹600–799'], [1000, '₹800–999'], [1500, '₹1,000–1,499']] as [$hi, $label]) {
        if ($price < $hi) {
            return $label;
        }
    }
    return '₹1,500 and above';
}

function variants_designs(): void
{
    $sc = scope();
    $W = W;
    $n = max(14, min(90, intdiv($sc->days(), 2)));                 // length of the two comparison windows
    $curStart = d_add($sc->end, -($n - 1));
    $prevEnd = d_add($curStart, -1);
    $prevStart = d_add($prevEnd, -($n - 1));
    $rows = q("SELECT i.product_key AS k, p.title, p.product_type, p.feeding, p.zip_style, p.neck, p.sleeve, p.pattern, p.fabric, p.range_tag,
                      p.length_style, p.colour_family, p.colour_name,
                      SUM(i.quantity) AS units, SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units_net,
                      SUM(CASE WHEN i.is_cancelled=0 THEN i.line_after_discount ELSE 0 END) AS rev_net,
                      SUM(i.line_gross) / NULLIF(SUM(i.quantity), 0) AS avg_price,
                      MIN(o.ordered_date_ist) AS first_sold, MAX(o.ordered_date_ist) AS last_sold,
                      SUM(CASE WHEN i.is_cancelled=0 AND o.ordered_date_ist BETWEEN %s AND %s THEN i.quantity ELSE 0 END) AS cur,
                      SUM(CASE WHEN i.is_cancelled=0 AND o.ordered_date_ist BETWEEN %s AND %s THEN i.quantity ELSE 0 END) AS prev
               FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key
               JOIN dim_product p ON p.brand=i.brand AND p.product_key=i.product_key
               WHERE $W GROUP BY i.product_key, p.title, p.product_type, p.feeding, p.zip_style, p.neck, p.sleeve, p.pattern, p.fabric,
                                 p.range_tag, p.length_style, p.colour_family, p.colour_name",
        array_merge([$curStart, $sc->end, $prevStart, $prevEnd], $sc->p()));
    $sizes = q("SELECT i.product_key AS k, i.size, SUM(CASE WHEN i.is_cancelled=0 THEN i.quantity ELSE 0 END) AS units
                FROM fact_order_item i JOIN fact_order o ON o.order_key=i.order_key WHERE $W GROUP BY i.product_key, i.size", $sc->p());
    $bySize = [];
    foreach ($sizes as $s) {
        $bySize[key_id($s['k'])][$s['size']] = $s['units'];
    }
    foreach ($rows as &$r) {
        $r['price_band'] = price_band($r['avg_price']);
        $r['sizes'] = (object)($bySize[key_id($r['k'])] ?? []);   // always a JSON object, even when empty
        $r['days_on_sale'] = d_diff($r['last_sold'], $r['first_sold']) + 1;
    }
    unset($r);
    out(['rows' => $rows, 'size_order' => SIZE_ORDER,
         'window' => ['n' => $n, 'cur_start' => $curStart, 'cur_end' => $sc->end, 'prev_start' => $prevStart, 'prev_end' => $prevEnd]]);
}
