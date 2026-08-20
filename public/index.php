<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/app/bootstrap.php';

use MakeLog\Application;
use MakeLog\HttpError;

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

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
