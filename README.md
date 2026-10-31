# Digifyce Analytics – PHP site

The AHA & TIRLS dashboard as a plain PHP 8 + MySQL/MariaDB site, for ordinary web hosting. It is the same dashboard as the
Python version (same screens, same numbers); only the server code is PHP. Tested on PHP 8.2.

**This folder is the whole deployable site. It is safe to put in Git: it contains no data and no passwords.**

```
index.html            the dashboard (single page)
static/               CSS, JavaScript, fonts, charts (copied from dashboard/app/static, see "Updating the screens")
api/index.php         receives every /api/* request
lib/                  the server code (the web server refuses direct requests to it)
.htaccess             routes /api/* to api/index.php, blocks config files, sets cache and robots headers
config.example.php    copy to config.local.php and fill in (config.local.php is ignored by Git)
```

Needs: PHP 8.1 or newer, the `pdo_mysql` and `mbstring` extensions (both standard on shared hosting), Apache or LiteSpeed with
`.htaccess` enabled. The site must be served from the **root of its own (sub)domain**, because the screens call `/api/...`.

## Run it on your own computer (Docker)

```bash
docker compose up -d php          # http://127.0.0.1:8091, reads the local MySQL
```

`php-site/` is mounted into the container, so editing a PHP file needs no rebuild.

## Put it on the web host

1. **Subdomain.** Create e.g. `analytics.yourdomain.com` and turn on HTTPS. Note its document root folder.
2. **Database.** Create one empty MySQL database and one user with access to that database only.
3. **Import the data.** On your computer run `bash scripts/export_for_hosting.sh`. In phpMyAdmin select the new database,
   choose **Import** and upload `dumps/hosting/digifyce_hosting.sql.gz` (about 2 MB). It creates 17 tables (11 cleaned data
   tables and 6 empty Meta Ads tables) and can be imported again at any time to refresh the data.
   That file holds customer names and phone numbers: never commit it or place it in the web folder.
4. **Deploy the code.** In hPanel connect this repository under Git (Advanced > Git), set the deploy path to the subdomain's
   document root and deploy. (Or upload the contents of this folder with the File Manager / FTP.)
5. **Credentials.** In the document root create `config.local.php` from `config.example.php` with the database name, user and
   password. Set `DASH_SCHEMA` to the same database name. Do not commit this file.
6. **Check.** Open `https://analytics.yourdomain.com/health` (shows `{"ok":true}`), then `/api/context` (shows both brands with
   their date ranges), then the home page. If an API call shows "Something went wrong", add `'APP_DEBUG' => '1'` to
   `config.local.php`, reload to read the error text, then remove that line.
   If the page says the database is at its connection limit, see "Connection limits" below.
7. **Protect it.** The Segments page lists customer names and phone numbers. Before sharing the link, add a password in hPanel
   (Websites > Password protect directories) or tell me and I will add a login.

## Connection limits

Some hosting accounts cap how many new connections a database user may open per hour (for example 500), and every
application that uses that user shares the cap. The site is built to stay far below it:

- database connections are kept open and reused between requests (`DB_PERSIST`, on by default);
- each distinct answer is computed once and stored in the `cache/` folder for `CACHE_TTL` seconds (default 3600, `0` turns it
  off), so repeat views and other visitors do not touch the database. The folder is created on first use, is refused by the
  web server and ignored by Git. The customer list (names and phone numbers) is never cached.

After importing new data, delete the `cache/` folder (File Manager) or wait an hour, otherwise old numbers are shown.
When the cap is reached anyway, the page shows "The database is at its connection limit right now" and recovers by itself
when the hour rolls over. If the database user is shared with another application, a separate database and user for this
dashboard is the safer set-up.

## Updating

- **New data** (after a rebuild, or after loading Meta exports locally): run `bash scripts/export_for_hosting.sh`, then import the
  new file in phpMyAdmin over the same database.
- **Updating the screens:** edit them in `dashboard/app/static`, run `bash scripts/sync_php_site.sh`, commit and deploy.
- **Server code:** edit `lib/*.php` here. After changing a query, run `python scripts/parity_check.py` to prove the Python and
  PHP versions still return identical results.

## What was checked

`scripts/parity_check.py` calls the Python and PHP versions with the same requests (every endpoint, both brands, six date
ranges, every analysis dimension, customer CSV, error cases) and compares the JSON value by value: 452 of 452 identical, also
when the PHP site reads a freshly imported single-database copy.
