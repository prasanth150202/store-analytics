<?php
/**
 * Single entry point for every /api/* request (see .htaccess). Same endpoints and JSON as the Python service.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';
foreach (['core', 'products', 'cancel', 'marketing', 'checkouts', 'customers', 'behaviour', 'variants', 'health'] as $module) {
    require __DIR__ . "/../lib/$module.php";
}

const ROUTES = [
    'context' => 'ctx_context',
    'overview' => 'ctx_overview',
    'products/dimensions' => 'products_dimensions',
    'products/by' => 'products_by',
    'products/top' => 'products_top',
    'products/crosstab' => 'products_crosstab',
    'products/trend' => 'products_trend',
    'products/variants' => 'products_variants',
    'cancellations/dimensions' => 'cancel_dimensions',
    'cancellations/summary' => 'cancel_summary',
    'cancellations/by' => 'cancel_by',
    'marketing/meta-status' => 'mkt_status',
    'marketing/campaigns' => 'mkt_campaigns',
    'marketing/channels' => 'mkt_channels',
    'marketing/funnel' => 'mkt_funnel',
    'checkouts/overview' => 'checkouts_overview',
    'customers/segments' => 'cust_segments',
    'customers/list' => 'cust_list',
    'customers/list.csv' => 'cust_csv',
    'customers/cohorts' => 'cust_cohorts',
    'behaviour/overview' => 'behaviour_overview',
    'variants/designs' => 'variants_designs',
    'health/overview' => 'health_overview',
];

try {
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
        header('Allow: GET, HEAD');
        out(['detail' => 'Method Not Allowed'], 405);
    }
    $path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $route = trim((string)preg_replace('#^.*?/api/#', '', $path . (str_ends_with($path, '/api') ? '/' : '')), '/');
    if ($route === 'health' || str_ends_with($path, '/health')) {
        out(['ok' => true]);
    }
    if (!isset(ROUTES[$route])) {
        out(['detail' => 'Not Found'], 404);
    }
    // names and phone numbers are never written to the cache folder
    if (!in_array($route, ['customers/list', 'customers/list.csv'], true) && ($hit = cache_open($route)) !== null) {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Cache: hit');
        echo $hit;
        exit;
    }
    (ROUTES[$route])();
} catch (HttpError $e) {
    out(['detail' => $e->detail], $e->status);
} catch (Throwable $e) {
    error_log('dashboard api: ' . get_class($e) . ': ' . $e->getMessage());
    if ($e instanceof PDOException) {
        $code = (int)($e->errorInfo[1] ?? $e->getCode());
        // 1226 = hourly connection limit of the database user, 1203 = its simultaneous limit, 1040 = server full
        if (in_array($code, [1226, 1203, 1040], true)) {
            out(['error' => 'The database is at its connection limit right now. Wait a few minutes and reload.'], 503);
        }
        // setup problems: say what to check (never the host, user or password)
        if (cfg('DB_USER', '') === '') {
            out(['error' => 'No database login is set. Put config.local.php next to index.html (see README, step 5).'], 500);
        }
        if (in_array($code, [1044, 1045, 1049, 2002, 2003, 2006, 2054], true)) {
            $why = [1044 => 'this user may not use that database', 1045 => 'user or password refused', 1049 => 'no database with that name',
                    2002 => 'the host could not be reached', 2003 => 'the host could not be reached', 2006 => 'the server dropped the connection', 2054 => 'login method not supported'][$code];
            out(['error' => "Cannot connect to the database (error $code: $why). Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in config.local.php."], 500);
        }
    }
    out(['error' => cfg('APP_DEBUG') === '1' ? get_class($e) . ': ' . $e->getMessage() : 'Something went wrong. Please try again.'], 500);
}
