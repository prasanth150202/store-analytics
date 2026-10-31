<?php
/**
 * Copy this file to config.local.php and fill it in. config.local.php is never committed to Git.
 * Put it one folder ABOVE the web folder if your host allows it; otherwise leave it next to this file
 * (the web server is set to refuse requests for config*.php).
 *
 * On shared hosting the Meta Ads tables live in the same database, so DASH_SCHEMA is the same as DB_NAME.
 */
return [
    'DB_HOST' => 'localhost',
    'DB_PORT' => '3306',
    'DB_NAME' => 'your_database_name',
    'DB_USER' => 'your_database_user',
    'DB_PASSWORD' => 'your_database_password',
    'DASH_SCHEMA' => 'your_database_name',
    // 'APP_DEBUG' => '1',   // show error text in API responses while setting up; remove afterwards
    // 'CACHE_TTL' => '3600',  // seconds a computed answer is kept in the cache/ folder (0 = off). Hosts that cap new database
    //                         // connections per hour need this; after importing new data, delete cache/ or wait this long.
    // 'DB_PERSIST' => '1',    // reuse database connections between requests (0 = open a new one each time)
];
