<?php
/**
 * Shared plumbing: configuration, read-only database access, the date/brand scope and JSON output.
 * Everything here mirrors dashboard/app/db.py so the PHP and Python versions return identical data.
 */
declare(strict_types=1);

date_default_timezone_set('UTC');           // dates are plain calendar dates; keep arithmetic free of DST
ini_set('serialize_precision', '-1');       // shortest exact float text (12.5, not 12.500000000000002)

const SNAPSHOT = '2026-10-24';
const BRANDS = ['AHA', 'TIRLS'];
const W = 'o.brand=%s AND o.ordered_date_ist BETWEEN %s AND %s';   // the standard order filter

// ── configuration: environment variables first, then config.local.php (kept out of Git) ──
function cfg(string $key, ?string $default = null): ?string
{
    static $local = null;
    if ($local === null) {
        $local = [];
        foreach ([__DIR__ . '/../../config.local.php', __DIR__ . '/../config.local.php'] as $file) {
            if (is_file($file)) {
                $local = require $file;
                break;
            }
        }
    }
    $env = getenv($key);
    if ($env !== false && $env !== '') {
        return $env;
    }
    return isset($local[$key]) ? (string)$local[$key] : $default;
}

function dash(): string   // schema holding the Meta Ads tables (the same database on shared hosting)
{
    return cfg('DASH_SCHEMA', 'digifyce_dash');
}

// ── errors ──
final class HttpError extends Exception
{
    public function __construct(public int $status, public string $detail)
    {
        parent::__construct($detail);
    }
}

function fail(int $status, string $detail): never
{
    throw new HttpError($status, $detail);
}

// ── database ──
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_STRINGIFY_FETCHES => false,
            PDO::ATTR_TIMEOUT => 30,
            PDO::ATTR_PERSISTENT => cfg('DB_PERSIST', '1') === '1',   // reuse the connection: hosts cap new connections per hour
            PDO::MYSQL_ATTR_INIT_COMMAND => 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci',
        ];
        if (cfg('DB_SSL') === '1') {   // local Docker MySQL 8.4 needs TLS for caching_sha2 logins
            $opts[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;
            $opts[PDO::MYSQL_ATTR_SSL_CIPHER] = 'DEFAULT';
        }
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', cfg('DB_HOST', 'localhost'), cfg('DB_PORT', '3306'), cfg('DB_NAME', 'digifyce_clean'));
        $pdo = new PDO($dsn, (string)cfg('DB_USER'), (string)cfg('DB_PASSWORD'), $opts);
    }
    return $pdo;
}

/**
 * Run a SELECT and return a list of rows. SQL uses %s placeholders and %% for a literal percent (same as the
 * Python version). DECIMAL values come back as floats, dates as 'YYYY-MM-DD' strings.
 */
function q(string $sql, array $params = []): array
{
    $sql = str_replace('%s', '?', str_replace('%%', "\x01", $sql));
    $sql = str_replace("\x01", '%', $sql);
    $st = db()->prepare($sql);
    foreach (array_values($params) as $i => $v) {
        $st->bindValue($i + 1, $v, is_int($v) ? PDO::PARAM_INT : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
    }
    $st->execute();
    $decimal = [];
    for ($i = 0, $n = $st->columnCount(); $i < $n; $i++) {
        $meta = $st->getColumnMeta($i);
        if (($meta['native_type'] ?? '') === 'NEWDECIMAL') {
            $decimal[] = $meta['name'];
        }
    }
    $rows = $st->fetchAll();
    if ($decimal) {
        foreach ($rows as &$row) {
            foreach ($decimal as $col) {
                if ($row[$col] !== null) {
                    $row[$col] = (float)$row[$col];
                }
            }
        }
        unset($row);
    }
    return $rows;
}

function one(string $sql, array $params = []): array
{
    return q($sql, $params)[0] ?? [];
}

/** q() that returns [] when the table does not exist yet (Meta tables before the first load). */
function q_safe(string $sql, array $params = []): array
{
    try {
        return q($sql, $params);
    } catch (PDOException $e) {
        return [];
    }
}

// ── request parameters ──
function qs(string $key, ?string $default = null): ?string
{
    return isset($_GET[$key]) && $_GET[$key] !== '' ? (string)$_GET[$key] : $default;
}

function qint(string $key, int $default, ?int $min = null, ?int $max = null): int
{
    $raw = qs($key);
    if ($raw === null) {
        return $default;
    }
    if (!preg_match('/^-?\d+$/', $raw)) {
        fail(422, "$key must be an integer");
    }
    $v = (int)$raw;
    if (($max !== null && $v > $max) || ($min !== null && $v < $min)) {
        fail(422, "$key is out of range");
    }
    return $v;
}

// ── dates are 'YYYY-MM-DD' strings; they sort correctly as text ──
function d_add(string $d, int $days): string
{
    return (new DateTimeImmutable($d))->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
}

function d_diff(string $a, string $b): int   // a - b in days
{
    return (int)(new DateTimeImmutable($b))->diff(new DateTimeImmutable($a))->format('%r%a');
}

function d_parse(string $v, string $name): string
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        fail(400, "$name must be a date like 2026-10-24");
    }
    return $v;
}

// ── the date/brand scope shared by every endpoint ──
final class Scope
{
    public function __construct(public string $brand, public string $start, public string $end, public string $first, public string $last)
    {
    }

    public function days(): int
    {
        return d_diff($this->end, $this->start) + 1;
    }

    public function prevEnd(): string
    {
        return d_add($this->start, -1);
    }

    public function prevStart(): string
    {
        return d_add($this->prevEnd(), -($this->days() - 1));
    }

    public function gran(): string
    {
        $n = $this->days();
        return $n <= 92 ? 'day' : ($n <= 540 ? 'week' : 'month');
    }

    public function p(): array       // the standard (brand, start, end) filter parameters
    {
        return [$this->brand, $this->start, $this->end];
    }

    public function prevP(): array
    {
        return [$this->brand, $this->prevStart(), $this->prevEnd()];
    }

    public function with(?string $start = null, ?string $end = null): Scope
    {
        return new Scope($this->brand, $start ?? $this->start, $end ?? $this->end, $this->first, $this->last);
    }
}

function scope(): Scope
{
    $brand = strtoupper(qs('brand', 'AHA') ?? '');
    if (!in_array($brand, BRANDS, true)) {
        fail(400, 'brand must be AHA or TIRLS');
    }
    $r = one('SELECT MIN(ordered_date_ist) AS a, MAX(ordered_date_ist) AS b FROM fact_order WHERE brand=%s', [$brand]);
    $first = $r['a'];
    $last = $r['b'];
    $s = qs('start') !== null ? d_parse(qs('start'), 'start') : $first;
    $e = qs('end') !== null ? d_parse(qs('end'), 'end') : $last;
    $s = max($s, $first);
    $e = min($e, $last);
    if ($s > $e) {
        $s = $e;
    }
    return new Scope($brand, $s, $e, $first, $last);
}

function bucket(string $gran, string $col): string
{
    if ($gran === 'day') {
        return $col;
    }
    if ($gran === 'week') {
        return "DATE_SUB($col, INTERVAL WEEKDAY($col) DAY)";
    }
    return "DATE_FORMAT($col, '%%Y-%%m-01')";
}

/** Every bucket start between start and end, so charts show zeros instead of gaps. */
function bucket_keys(Scope $sc): array
{
    $out = [];
    $gran = $sc->gran();
    if ($gran === 'day') {
        for ($d = $sc->start; $d <= $sc->end; $d = d_add($d, 1)) {
            $out[] = $d;
        }
    } elseif ($gran === 'week') {
        $d = d_add($sc->start, -((int)(new DateTimeImmutable($sc->start))->format('N') - 1));
        for (; $d <= $sc->end; $d = d_add($d, 7)) {
            $out[] = $d;
        }
    } else {
        $d = (new DateTimeImmutable($sc->start))->modify('first day of this month');
        while ($d->format('Y-m-d') <= $sc->end) {
            $out[] = $d->format('Y-m-d');
            $d = $d->modify('first day of next month');
        }
    }
    return $out;
}

/** Align rows (each with a bucket date under $key) to every bucket in the scope. */
function fill(Scope $sc, array $rows, string $key = 'd', array $zero = []): array
{
    $by = [];
    foreach ($rows as $r) {
        $by['k' . $r[$key]] = $r;
    }
    $out = [];
    foreach (bucket_keys($sc) as $k) {
        $out[] = $by['k' . $k] ?? ([$key => $k] + $zero);
    }
    return $out;
}

// ── small helpers the endpoints share ──
function ratio($a, $b)
{
    return $b ? $a / $b : null;
}

function placeholders(int $n): string
{
    return implode(',', array_fill(0, $n, '%s'));
}

function median(array $xs)
{
    $n = count($xs);
    if ($n === 0) {
        return null;
    }
    sort($xs);
    $mid = intdiv($n, 2);
    return $n % 2 ? $xs[$mid] : ($xs[$mid - 1] + $xs[$mid]) / 2;
}

/** Group a list by a value that may be null or numeric-looking without PHP rewriting the key. */
function key_id($v): string
{
    return $v === null ? "\0null" : 's' . $v;
}

// ── output ──
const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION;

function out($data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    $body = json_encode($data, JSON_FLAGS);
    if ($status === 200) {
        cache_store($body);
    }
    echo $body;
    exit;
}

// ── response cache ──
// A hosting account may allow only a few hundred new database connections per hour, and the same database user may
// serve other applications. So each distinct request is computed once and kept as a file for CACHE_TTL seconds
// (default 3600; 0 turns it off). The cache is skipped when the folder cannot be written. After importing new data,
// delete the cache folder or wait for the time to pass.

/** The file the current request's response is stored in (set by cache_open, read by cache_store). */
function cache_target(?string $set = null): ?string
{
    static $file = null;
    if ($set !== null) {
        $file = $set;
    }
    return $file;
}

/** Return the stored response for this request, or null (and remember where to store the new one). */
function cache_open(string $route): ?string
{
    $ttl = (int)cfg('CACHE_TTL', '3600');
    $dir = __DIR__ . '/../cache';
    if ($ttl <= 0 || (!is_dir($dir) && !@mkdir($dir, 0750)) || !is_writable($dir)) {
        return null;
    }
    if (!is_file("$dir/.htaccess")) {
        @file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n");
    }
    $get = $_GET;
    ksort($get);
    $code = max(array_map('filemtime', glob(__DIR__ . '/*.php')));   // new code means new answers
    $file = "$dir/" . sha1($route . '?' . http_build_query($get) . '#' . $code . '#' . cfg('DB_NAME')) . '.json';
    cache_target($file);
    if (is_file($file) && time() - (int)filemtime($file) < $ttl) {
        $body = @file_get_contents($file);
        return $body === false ? null : $body;
    }
    return null;
}

function cache_store(string $body): void
{
    $file = cache_target();
    if ($file === null) {
        return;
    }
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $body) !== false) {
        @rename($tmp, $file);
    }
    if (random_int(1, 50) === 1) {   // now and then, drop entries that have expired
        $ttl = (int)cfg('CACHE_TTL', '3600');
        foreach (glob(dirname($file) . '/*.json') ?: [] as $old) {
            if (time() - (int)filemtime($old) >= $ttl) {
                @unlink($old);
            }
        }
    }
}
