<?php

declare(strict_types=1);

$configuredStorage = getenv('MAKELOG_STORAGE_PATH');
$earlyStoragePath = is_string($configuredStorage) && trim($configuredStorage) !== ''
    ? rtrim($configuredStorage, DIRECTORY_SEPARATOR)
    : dirname(__DIR__) . '/storage';
$earlyRequestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (is_file($earlyStoragePath . '/updates/maintenance.json')) {
    http_response_code(503);
    header('Cache-Control: no-store');
    header('Retry-After: 10');
    if (str_starts_with($earlyRequestPath, '/api/')) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Make:Log wird gerade aktualisiert. Bitte gleich erneut versuchen.'], JSON_UNESCAPED_UNICODE);
    } else {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Make:Log wird aktualisiert</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#25282d;font:16px system-ui}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.6rem}p{color:#69707a;line-height:1.6}</style><main><h1>Make:Log wird aktualisiert</h1><p>Die neue Version wird gerade sicher eingespielt. Diese Seite kann in wenigen Augenblicken neu geladen werden.</p></main></html>';
    }
    exit;
}

require_once dirname(__DIR__) . '/app/bootstrap.php';

use MakeLog\Application;
use MakeLog\HttpError;

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
if ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

try {
    $application = new Application(makelog_storage_path());
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (str_starts_with($path, '/api/')) {
        $application->handle(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), $path);
    }

    $page = $application->installed() ? __DIR__ . '/app.html' : __DIR__ . '/install.html';
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    readfile($page);
} catch (HttpError $error) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($error->status);
    echo json_encode(['error' => $error->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log((string) $error);
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['error' => 'Make:Log konnte die Anfrage nicht verarbeiten.'], JSON_UNESCAPED_UNICODE);
}
