<?php
/**
 * Sign-in for the whole dashboard. One account (AUTH_USER, default admin@digifyce.com); the password is chosen on the
 * first visit, in the browser, with a one-time setup code. Nothing here uses the database.
 *
 *   - The password is stored only as a bcrypt hash in private/auth.php (refused by the web server, ignored by Git).
 *   - Signing in sets a signed cookie (HttpOnly, SameSite=Lax, 14 days). The signing key is stored beside the hash and
 *     replaced whenever the password is set again, which signs everyone out.
 *   - Until a password exists the site is locked: only the setup screen is available, and it needs the setup code.
 *   - To reset a forgotten password, delete private/auth.php on the host; the setup screen comes back.
 *   - Wrong passwords are rate limited (5 per address and 25 in total per 15 minutes).
 *   - AUTH_DISABLED=1 (environment or config.local.php) turns all of this off; only for working on your own computer.
 */
declare(strict_types=1);

// SHA-256 of the one-time setup code. The code itself is known only to the owner, is 100 random bits and is never
// committed, so publishing this hash is safe. Override with SETUP_CODE_SHA256 in config.local.php if you issue a new one.
const SETUP_CODE_SHA256 = '6005edc0b157835cdbf249c10b5a86cd929361016dfcab70110c0a3c7926cb23';
const AUTH_COOKIE = 'dash_auth';
const AUTH_DAYS = 14;
const AUTH_WINDOW = 900;          // seconds that failed attempts are remembered
const AUTH_MAX_PER_IP = 5;
const AUTH_MAX_TOTAL = 25;

function auth_enabled(): bool
{
    return cfg('AUTH_DISABLED') !== '1';
}

function auth_user(): string
{
    return strtolower(trim((string)cfg('AUTH_USER', 'admin@digifyce.com')));
}

function auth_dir(): string
{
    return __DIR__ . '/../private';
}

// ── stored account ──
function auth_record(): ?array
{
    $raw = @file_get_contents(auth_dir() . '/auth.php');
    if ($raw === false || ($nl = strpos($raw, "\n")) === false) {
        return null;
    }
    $r = json_decode(substr($raw, $nl + 1), true);
    return is_array($r) && isset($r['user'], $r['hash'], $r['secret']) ? $r : null;
}

function auth_ensure_dir(): bool
{
    $d = auth_dir();
    if (!is_dir($d) && !@mkdir($d, 0750)) {
        return false;
    }
    if (!is_file("$d/.htaccess")) {
        @file_put_contents("$d/.htaccess", "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n");
    }
    return is_writable($d);
}

function auth_save(array $rec): bool
{
    if (!auth_ensure_dir()) {
        return false;
    }
    $file = auth_dir() . '/auth.php';
    $tmp = $file . '.' . getmypid() . '.tmp';
    // the first line makes the file harmless if a server ever serves it directly
    if (@file_put_contents($tmp, "<?php http_response_code(404); exit; ?>\n" . json_encode($rec)) === false) {
        return false;
    }
    @chmod($tmp, 0600);
    return @rename($tmp, $file);
}

// ── session cookie ──
function auth_token(array $rec, int $exp): string
{
    $body = "v1.$exp";
    return $body . '.' . hash_hmac('sha256', $body . '|' . $rec['user'], $rec['secret']);
}

function auth_valid(): bool
{
    $cookie = $_COOKIE[AUTH_COOKIE] ?? '';
    if (!is_string($cookie) || !preg_match('/^v1\.(\d{9,11})\.[0-9a-f]{64}$/', $cookie, $m) || (int)$m[1] < time()) {
        return false;
    }
    $rec = auth_record();
    return $rec !== null && hash_equals(auth_token($rec, (int)$m[1]), $cookie);
}

function auth_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || str_contains((string)($_SERVER['HTTP_CF_VISITOR'] ?? ''), 'https');
}

function auth_cookie(string $value, int $expires): void
{
    setcookie(AUTH_COOKIE, $value, ['expires' => $expires, 'path' => '/', 'secure' => auth_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

function auth_sign_in(array $rec): void
{
    $exp = time() + AUTH_DAYS * 86400;
    auth_cookie(auth_token($rec, $exp), $exp);
}

/** Every data request calls this first. */
function auth_require(): void
{
    if (auth_enabled() && !auth_valid()) {
        out(['error' => 'Please sign in.', 'login' => true], 401);
    }
}

// ── rate limit: failed attempts live in private/attempts.json as [time, address hash] ──
function auth_ip(): string
{
    return substr(hash('sha256', (string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '?')), 0, 16);
}

function auth_attempts(callable $change): array
{
    $file = auth_dir() . '/attempts.json';
    if (!auth_ensure_dir() || !($h = @fopen($file, 'c+'))) {
        return [];
    }
    @chmod($file, 0600);
    flock($h, LOCK_EX);
    $list = json_decode((string)stream_get_contents($h), true);
    $now = time();
    $list = array_values(array_filter(is_array($list) ? $list : [], fn($a) => is_array($a) && $now - (int)$a[0] < AUTH_WINDOW));
    $list = $change($list, $now);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($list));
    flock($h, LOCK_UN);
    fclose($h);
    return $list;
}

function auth_throttle(): void
{
    $list = auth_attempts(fn($l) => $l);
    $mine = count(array_filter($list, fn($a) => $a[1] === auth_ip()));
    if ($mine >= AUTH_MAX_PER_IP || count($list) >= AUTH_MAX_TOTAL) {
        fail(429, 'Too many attempts. Wait 15 minutes and try again.');
    }
}

function auth_failed(): void
{
    auth_attempts(function ($l, $now) {
        $l[] = [$now, auth_ip()];
        return $l;
    });
    usleep(400000);
}

// ── API: /api/auth/status|login|setup|logout ──
function auth_body(): array
{
    if (stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
        fail(415, 'Send JSON.');
    }
    $b = json_decode((string)file_get_contents('php://input', false, null, 0, 4096), true);
    return is_array($b) ? $b : [];
}

function auth_route(string $route): never
{
    header('Cache-Control: no-store');
    if ($route === 'auth/status') {
        $in = auth_enabled() && auth_valid();
        out(['enabled' => auth_enabled(), 'signed_in' => !auth_enabled() || $in, 'user' => $in ? auth_user() : null, 'needs_setup' => auth_enabled() && auth_record() === null]);
    }
    if (!auth_enabled()) {
        fail(404, 'Not Found');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        header('Allow: POST');
        out(['detail' => 'Method Not Allowed'], 405);
    }
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '' && strtolower((string)parse_url($origin, PHP_URL_HOST)) !== strtolower(explode(':', (string)($_SERVER['HTTP_HOST'] ?? ''))[0])) {
        fail(403, 'Cross-site request refused.');
    }
    if ($route === 'auth/logout') {
        auth_cookie('', time() - 3600);
        out(['ok' => true]);
    }
    $b = auth_body();
    if ($route === 'auth/login') {
        auth_login($b);
    }
    if ($route === 'auth/setup') {
        auth_setup($b);
    }
    fail(404, 'Not Found');
}

function auth_login(array $b): never
{
    $rec = auth_record();
    if ($rec === null) {
        fail(409, 'No password has been set yet. Reload the page to set one.');
    }
    auth_throttle();
    $pw = (string)($b['password'] ?? '');
    $okPassword = strlen($pw) <= 72 && password_verify($pw, $rec['hash']);   // always runs, so timing does not reveal the email
    if (!($okPassword && hash_equals($rec['user'], strtolower(trim((string)($b['user'] ?? '')))))) {
        auth_failed();
        fail(401, 'Wrong email or password.');
    }
    auth_attempts(fn($l) => array_values(array_filter($l, fn($a) => $a[1] !== auth_ip())));
    auth_sign_in($rec);
    out(['ok' => true]);
}

function auth_setup(array $b): never
{
    if (auth_record() !== null) {
        fail(409, 'A password is already set. Sign in instead.');
    }
    auth_throttle();
    $code = strtoupper((string)preg_replace('/[^A-Za-z0-9]/', '', (string)($b['code'] ?? '')));
    if (!hash_equals((string)cfg('SETUP_CODE_SHA256', SETUP_CODE_SHA256), hash('sha256', $code))) {
        auth_failed();
        fail(403, 'That setup code is not right.');
    }
    $pw = (string)($b['password'] ?? '');
    if (strlen($pw) < 10 || strlen($pw) > 72) {
        fail(422, 'Use a password of 10 to 72 characters.');
    }
    if ($pw !== (string)($b['confirm'] ?? '')) {
        fail(422, 'The two passwords are not the same.');
    }
    if (strtolower($pw) === auth_user()) {
        fail(422, 'The password cannot be the email address.');
    }
    $rec = ['user' => auth_user(), 'hash' => password_hash($pw, PASSWORD_DEFAULT), 'secret' => bin2hex(random_bytes(32)), 'created' => gmdate('c')];
    if (!auth_save($rec)) {
        fail(500, 'The server could not save the password (the private folder is not writable). Ask your host to make the site folder writable.');
    }
    auth_attempts(fn($l) => []);
    auth_sign_in($rec);
    out(['ok' => true]);
}

// ── the page shown to visitors who are not signed in ──
function auth_page(): never
{
    $setup = auth_record() === null;
    $user = htmlspecialchars(auth_user(), ENT_QUOTES);
    $mode = $setup ? 'setup' : 'login';
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    $title = $setup ? 'Set your password' : 'Sign in';
    $lead = $setup ? 'First visit: choose the password for <b>' . $user . '</b>. You need the one-time setup code you were given.' : 'Sign in to see the dashboard.';
    $fields = $setup
        ? '<label for="code">Setup code</label><input id="code" name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
           <label for="password">New password <small>(10 to 72 characters)</small></label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="72" required>
           <label for="confirm">Repeat the password</label><input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="72" required>'
        : '<label for="user">Email</label><input id="user" name="user" type="email" value="' . $user . '" autocomplete="username" required>
           <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="72" required autofocus>';
    $button = $setup ? 'Save password and sign in' : 'Sign in';
    echo <<<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231967D2'/%3E%3Ctext x='16' y='22' font-size='18' font-family='Arial' font-weight='700' text-anchor='middle' fill='white'%3ED%3C/text%3E%3C/svg%3E">
<title>$title · Digifyce Analytics</title>
<style>
@font-face { font-family: "Roboto"; font-weight: 100 900; font-display: swap; src: url("/static/fonts/roboto-latin-wght-normal.woff2") format("woff2"); }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { font-family: "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8f9fa; color: #202124; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
main { width: 100%; max-width: 400px; background: #fff; border: 1px solid #dadce0; border-radius: 12px; padding: 32px 28px 28px; }
.mark { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; font-size: 18px; font-weight: 500; }
.mark i { width: 32px; height: 32px; border-radius: 8px; background: #1967d2; color: #fff; display: grid; place-items: center; font-style: normal; font-weight: 700; }
h1 { font-size: 22px; font-weight: 500; margin: 0 0 6px; }
p { margin: 0 0 18px; color: #5f6368; font-size: 14px; line-height: 1.45; }
label { display: block; font-size: 13px; font-weight: 500; margin: 14px 0 6px; color: #3c4043; }
label small { font-weight: 400; color: #70757a; }
input[type=text], input[type=email], input[type=password] { width: 100%; font: inherit; font-size: 16px; padding: 11px 12px; border: 1px solid #dadce0; border-radius: 8px; background: #fff; color: #202124; }
input:focus { outline: 2px solid #1967d2; outline-offset: -1px; border-color: #1967d2; }
.show { display: flex; align-items: center; gap: 8px; font-weight: 400; margin: 12px 0 0; cursor: pointer; }
button { width: 100%; margin-top: 20px; font: inherit; font-weight: 500; font-size: 15px; padding: 12px; border: 0; border-radius: 8px; background: #1967d2; color: #fff; cursor: pointer; }
button:hover { background: #185abc; }
button:disabled { background: #a8c7fa; cursor: default; }
button:focus-visible { outline: 3px solid #a8c7fa; outline-offset: 2px; }
.err { min-height: 20px; margin: 14px 0 0; font-size: 13.5px; color: #c5221f; }
</style>
</head>
<body data-mode="$mode">
<main>
  <div class="mark"><i>D</i>Digifyce Analytics</div>
  <h1>$title</h1>
  <p>$lead</p>
  <form id="f" novalidate>
    $fields
    <label class="show"><input type="checkbox" id="show"> Show password</label>
    <div class="err" id="err" role="alert" aria-live="polite"></div>
    <button type="submit" id="go">$button</button>
  </form>
</main>
<script>
const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go'), mode = document.body.dataset.mode;
document.getElementById('show').onchange = e => f.querySelectorAll('input[type=password]').forEach(i => { i.type = e.target.checked ? 'text' : 'password'; });
f.addEventListener('submit', async e => {
  e.preventDefault();
  err.textContent = '';
  if (!f.checkValidity()) { err.textContent = 'Fill in every field.'; return; }
  go.disabled = true;
  const body = mode === 'setup' ? { code: f.code.value, password: f.password.value, confirm: f.confirm.value } : { user: f.user.value, password: f.password.value };
  try {
    const r = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { location.reload(); return; }
    err.textContent = j.error || j.detail || 'Something went wrong. Try again.';
  } catch (x) { err.textContent = 'Could not reach the server. Check your connection and try again.'; }
  go.disabled = false;
});
</script>
</body>
</html>
HTML;
    exit;
}
