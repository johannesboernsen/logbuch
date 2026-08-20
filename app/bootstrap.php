<?php

declare(strict_types=1);

require_once __DIR__ . '/Support.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/ProjectStore.php';
require_once __DIR__ . '/FolderStore.php';
require_once __DIR__ . '/Application.php';

function makelog_storage_path(): string
{
    $configured = getenv('MAKELOG_STORAGE_PATH');
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    return dirname(__DIR__) . '/storage';
}
