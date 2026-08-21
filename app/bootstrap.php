<?php

declare(strict_types=1);

require_once __DIR__ . '/Support.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/ProjectStore.php';
require_once __DIR__ . '/FolderStore.php';
require_once __DIR__ . '/UpdateService.php';
require_once __DIR__ . '/Application.php';

function makelog_storage_path(): string
{
    $configured = getenv('MAKELOG_STORAGE_PATH');
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    return dirname(__DIR__) . '/storage';
}

function makelog_root_path(): string
{
    $configured = getenv('MAKELOG_ROOT_PATH');
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    return dirname(__DIR__);
}

function makelog_version(): string
{
    $version = trim((string) @file_get_contents(makelog_root_path() . '/VERSION'));
    return preg_match('/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/', $version) ? $version : '0.0.0';
}

function makelog_schema_version(): int
{
    return max(0, (int) trim((string) @file_get_contents(makelog_root_path() . '/SCHEMA_VERSION')));
}
