<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/app/bootstrap.php';

use MakeLog\Database;
use MakeLog\ProjectStore;

$inputPath = $argv[1] ?? '';
$storagePath = $argv[2] ?? makelog_storage_path();
if ($inputPath === '' || !is_file($inputPath)) {
    fwrite(STDERR, "Verwendung: php tools/import-legacy.php <Export.json> [Speicherordner]\n");
    exit(2);
}

$manifest = json_decode((string) file_get_contents($inputPath), true);
if (!is_array($manifest) || ($manifest['format'] ?? '') !== 'make-log-legacy-migration' || !is_array($manifest['projects'] ?? null)) {
    fwrite(STDERR, "Kein unterstützter Make:Log-Migrationsexport.\n");
    exit(2);
}

$database = new Database(rtrim($storagePath, DIRECTORY_SEPARATOR) . '/database.sqlite');
$pdo = $database->pdo();
$projects = new ProjectStore(rtrim($storagePath, DIRECTORY_SEPARATOR) . '/projects');

$tagStatement = $pdo->prepare('INSERT INTO tags (id, name, normalized_name, active, created_at) VALUES (:id, :name, :normalized, :active, :created) ON CONFLICT(id) DO UPDATE SET name = excluded.name, normalized_name = excluded.normalized_name, active = excluded.active');
foreach ($manifest['tags'] ?? [] as $tag) {
    if (!is_array($tag) || !MakeLog\validId((string) ($tag['id'] ?? ''))) {
        continue;
    }
    $name = trim((string) ($tag['name'] ?? ''));
    if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
        continue;
    }
    $tagStatement->execute(['id' => $tag['id'], 'name' => $name, 'normalized' => MakeLog\normalizeName($name), 'active' => (int) ($tag['active'] ?? true), 'created' => $tag['createdAt'] ?? MakeLog\nowIso()]);
}

$imported = 0;
foreach ($manifest['projects'] as $project) {
    if (!is_array($project)) {
        continue;
    }
    $projects->saveImported($project, true);
    ++$imported;
}

fwrite(STDOUT, $imported . " Projekte importiert. Das Administratorkonto wird im Installer angelegt.\n");

