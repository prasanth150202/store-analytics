<?php
/**
 * The home page. Visitors who are not signed in get the sign-in (or first-run setup) screen; everyone else gets the dashboard.
 * The dashboard file itself lives in lib/ so it can never be fetched without signing in.
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';

header('X-Robots-Tag: noindex, nofollow');
if (auth_enabled() && !auth_valid()) {
    auth_page();
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile(__DIR__ . '/lib/app.html');
