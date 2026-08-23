<?php

declare(strict_types=1);

require_once __DIR__ . '/Support.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/ProjectStore.php';
require_once __DIR__ . '/FolderStore.php';
require_once __DIR__ . '/TodoStore.php';
require_once __DIR__ . '/UpdateService.php';
require_once __DIR__ . '/Application.php';

function logbuch_storage_path(): string
{
    $configured = getenv('LOGBUCH_STORAGE_PATH');
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    return dirname(__DIR__) . '/storage';
}

function logbuch_root_path(): string
{
    $configured = getenv('LOGBUCH_ROOT_PATH');
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    return dirname(__DIR__);
}

function logbuch_version(): string
{
    $version = trim((string) @file_get_contents(logbuch_root_path() . '/VERSION'));
    return preg_match('/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/', $version) ? $version : '0.0.0';
}

function logbuch_schema_version(): int
{
    return max(0, (int) trim((string) @file_get_contents(logbuch_root_path() . '/SCHEMA_VERSION')));
}
