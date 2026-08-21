<?php

declare(strict_types=1);

namespace MakeLog;

use PDO;
use PharData;
use RecursiveIteratorIterator;

final class UpdateService
{
    private const CACHE_SECONDS = 21600;
    private const MAX_MANIFEST_BYTES = 2097152;
    private const MAX_ARCHIVE_BYTES = 104857600;
    private const DEFAULT_MANIFEST_URL = 'https://github.com/johannesboernsen/make-log-releases/releases/latest/download/update-manifest.json';
    private const DEFAULT_IMAGE = 'ghcr.io/johannesboernsen/make-log';

    private string $updatesPath;

    public function __construct(
        private readonly string $storagePath,
        private readonly string $rootPath,
        private readonly PDO $db,
        private readonly string $platform,
    ) {
        $this->updatesPath = $storagePath . '/updates';
    }

    public function status(bool $force = false): array
    {
        $this->ensureUpdatesPath();
        $cachePath = $this->updatesPath . '/release-cache.json';
        $cached = readJsonFile($cachePath);
        $fresh = isset($cached['checkedAtEpoch']) && (int) $cached['checkedAtEpoch'] >= time() - self::CACHE_SECONDS;

        if (!$force && $fresh) {
            try {
                $manifest = $this->verifyManifest((string) ($cached['manifestRaw'] ?? ''), (string) ($cached['signature'] ?? ''));
                return $this->publicStatus($manifest, (string) ($cached['checkedAt'] ?? nowIso()));
            } catch (\Throwable) {
                // A damaged cache is discarded and fetched again below.
            }
        }

        try {
            [$manifestRaw, $signature] = $this->downloadManifest();
            $manifest = $this->verifyManifest($manifestRaw, $signature);
            $checkedAt = nowIso();
            writeJsonFile($cachePath, [
                'checkedAt' => $checkedAt,
                'checkedAtEpoch' => time(),
                'manifestRaw' => $manifestRaw,
                'signature' => $signature,
            ]);
            return $this->publicStatus($manifest, $checkedAt);
        } catch (HttpError $error) {
            if ($cached !== []) {
                try {
                    $manifest = $this->verifyManifest((string) ($cached['manifestRaw'] ?? ''), (string) ($cached['signature'] ?? ''));
                    $status = $this->publicStatus($manifest, (string) ($cached['checkedAt'] ?? ''));
                    $status['checkError'] = $error->getMessage();
                    return $status;
                } catch (\Throwable) {
                }
            }
            return $this->unavailableStatus($error->getMessage());
        }
    }

    public function install(string $actor): array
    {
        $lock = $this->lock();
        try {
            [$manifestRaw, $signature] = $this->downloadManifest();
            $manifest = $this->verifyManifest($manifestRaw, $signature);
            if (!version_compare((string) $manifest['version'], \makelog_version(), '>')) {
                throw new HttpError(409, 'Es ist kein neueres Update verfügbar.');
            }
            if ($this->platform === 'docker') {
                return $this->queueDockerUpdate($manifest, $manifestRaw, $signature, $actor);
            }
            return $this->installWebRelease($manifest, $actor);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function publicStatus(array $manifest, string $checkedAt): array
    {
        $latest = (string) $manifest['version'];
        $current = \makelog_version();
        $available = version_compare($latest, $current, '>');
        $state = readJsonFile($this->updatesPath . '/state.json');
        $dockerResult = readJsonFile($this->updatesPath . '/docker-result.json');
        if (($dockerResult['status'] ?? '') === 'failed' || (($dockerResult['version'] ?? '') === $current && ($dockerResult['status'] ?? '') === 'success')) {
            $state = $dockerResult;
        }
        $supported = $this->platform === 'docker' || $this->webInstallSupported();
        return [
            'currentVersion' => $current,
            'latestVersion' => $latest,
            'available' => $available,
            'channel' => (string) ($manifest['channel'] ?? 'stable'),
            'publishedAt' => (string) ($manifest['publishedAt'] ?? ''),
            'releaseNotesUrl' => (string) ($manifest['releaseNotesUrl'] ?? ''),
            'summary' => (string) ($manifest['summary'] ?? ''),
            'checkedAt' => $checkedAt,
            'platform' => $this->platform,
            'installSupported' => $supported,
            'installReason' => $supported ? '' : 'Der Webserver darf die Make:Log-Programmdateien nicht verändern.',
            'state' => (string) ($state['status'] ?? 'idle'),
            'stateMessage' => (string) ($state['message'] ?? ''),
            'requestedVersion' => (string) ($state['version'] ?? ''),
        ];
    }

    private function unavailableStatus(string $message): array
    {
        return [
            'currentVersion' => \makelog_version(),
            'latestVersion' => '',
            'available' => false,
            'checkedAt' => '',
            'platform' => $this->platform,
            'installSupported' => false,
            'installReason' => '',
            'state' => 'unavailable',
            'stateMessage' => '',
            'checkError' => $message,
        ];
    }

    private function downloadManifest(): array
    {
        $manifestUrl = $this->environment('MAKELOG_UPDATE_MANIFEST_URL', self::DEFAULT_MANIFEST_URL);
        $signatureUrl = $this->environment('MAKELOG_UPDATE_SIGNATURE_URL', preg_replace('/\.json(?:\?.*)?$/', '.sig', $manifestUrl) ?: $manifestUrl . '.sig');
        return [
            $this->download($manifestUrl, self::MAX_MANIFEST_BYTES),
            trim($this->download($signatureUrl, 16384)),
        ];
    }

    private function verifyManifest(string $raw, string $signature): array
    {
        if ($raw === '' || strlen($raw) > self::MAX_MANIFEST_BYTES) {
            throw new HttpError(502, 'Das Update-Manifest ist leer oder zu groß.');
        }
        $publicKeyPath = $this->environment('MAKELOG_UPDATE_PUBLIC_KEY_PATH', $this->rootPath . '/config/update-public-key.pem');
        $publicKey = @file_get_contents($publicKeyPath);
        $decodedSignature = base64_decode($signature, true);
        if (!is_string($publicKey) || $publicKey === '' || $decodedSignature === false || openssl_verify($raw, $decodedSignature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            throw new HttpError(502, 'Die Signatur des Update-Manifests ist ungültig.');
        }
        $manifest = json_decode($raw, true);
        if (!is_array($manifest) || ($manifest['format'] ?? '') !== 'make-log-update' || ($manifest['manifestVersion'] ?? null) !== 1) {
            throw new HttpError(502, 'Das Update-Manifest hat ein unbekanntes Format.');
        }
        $version = (string) ($manifest['version'] ?? '');
        $minimumPhp = (string) ($manifest['minimumPhp'] ?? '8.2.0');
        if (!preg_match('/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/', $version) || !preg_match('/^\d+\.\d+(?:\.\d+)?$/', $minimumPhp)) {
            throw new HttpError(502, 'Das Update-Manifest enthält ungültige Versionsangaben.');
        }
        if (version_compare(PHP_VERSION, $minimumPhp, '<')) {
            throw new HttpError(409, 'Das Update benötigt mindestens PHP ' . $minimumPhp . '.');
        }
        $web = $manifest['web'] ?? null;
        $docker = $manifest['docker'] ?? null;
        if (!is_array($web) || !is_array($docker) || !filter_var($web['url'] ?? '', FILTER_VALIDATE_URL) || !preg_match('/^[a-f0-9]{64}$/', (string) ($web['sha256'] ?? ''))) {
            throw new HttpError(502, 'Das Update-Manifest enthält kein gültiges Webpaket.');
        }
        $expectedImage = $this->environment('MAKELOG_UPDATE_IMAGE', self::DEFAULT_IMAGE);
        if (($docker['image'] ?? '') !== $expectedImage || !preg_match('/^sha256:[a-f0-9]{64}$/', (string) ($docker['digest'] ?? ''))) {
            throw new HttpError(502, 'Das Update-Manifest enthält kein freigegebenes Docker-Image.');
        }
        $files = $web['files'] ?? null;
        if (!is_array($files) || count($files) < 4 || count($files) > 5000) {
            throw new HttpError(502, 'Die Dateiliste des Updates fehlt oder ist ungültig.');
        }
        foreach ($files as $path => $hash) {
            if (!is_string($path) || !$this->managedPath($path) || !is_string($hash) || !preg_match('/^[a-f0-9]{64}$/', $hash)) {
                throw new HttpError(502, 'Die Dateiliste des Updates enthält einen ungültigen Eintrag.');
            }
        }
        foreach (['app/bootstrap.php', 'app/Application.php', 'public/index.php', 'VERSION', 'SCHEMA_VERSION'] as $required) {
            if (!isset($files[$required])) {
                throw new HttpError(502, 'Im Update fehlt die erforderliche Datei ' . $required . '.');
            }
        }
        return $manifest;
    }

    private function queueDockerUpdate(array $manifest, string $manifestRaw, string $signature, string $actor): array
    {
        $version = (string) $manifest['version'];
        $request = [
            'format' => 'make-log-docker-update-request',
            'version' => $version,
            'image' => (string) $manifest['docker']['image'],
            'digest' => (string) $manifest['docker']['digest'],
            'requestedAt' => nowIso(),
            'requestedBy' => $actor,
            'nonce' => bin2hex(random_bytes(16)),
            'manifest' => base64_encode($manifestRaw),
            'signature' => $signature,
        ];
        writeJsonFile($this->updatesPath . '/docker-request.json', $request);
        $state = ['status' => 'queued', 'version' => $version, 'message' => 'Das Docker-Update wartet auf den Host-Helfer.', 'updatedAt' => nowIso()];
        writeJsonFile($this->updatesPath . '/state.json', $state);
        return $state + ['platform' => 'docker'];
    }

    private function installWebRelease(array $manifest, string $actor): array
    {
        if (!$this->webInstallSupported()) {
            throw new HttpError(409, 'Der Webserver darf die Make:Log-Programmdateien nicht verändern.');
        }
        @set_time_limit(180);
        $version = (string) $manifest['version'];
        $workPath = $this->rootPath . '/.makelog-update';
        $stagePath = $workPath . '/stage-' . bin2hex(random_bytes(6));
        $archivePath = $workPath . '/release-' . bin2hex(random_bytes(6)) . '.tar';
        if (!is_dir($workPath) && !mkdir($workPath, 0770, true) && !is_dir($workPath)) {
            throw new HttpError(507, 'Das Update-Arbeitsverzeichnis konnte nicht angelegt werden.');
        }
        $maintenancePath = $this->updatesPath . '/maintenance.json';
        $backupPath = '';
        $oldFiles = $this->installedFiles();
        $newFiles = (array) $manifest['web']['files'];
        writeJsonFile($this->updatesPath . '/state.json', ['status' => 'installing', 'version' => $version, 'message' => 'Update wird geprüft und installiert.', 'updatedAt' => nowIso()]);
        try {
            $archive = $this->download((string) $manifest['web']['url'], self::MAX_ARCHIVE_BYTES);
            if (!hash_equals((string) $manifest['web']['sha256'], hash('sha256', $archive))) {
                throw new HttpError(502, 'Die Prüfsumme des Update-Pakets stimmt nicht.');
            }
            atomicWrite($archivePath, $archive);
            $this->extractArchive($archivePath, $stagePath);
            $this->verifyStagedFiles($stagePath, $newFiles);
            $this->assertNoLocalChanges($oldFiles);
            $backupPath = $this->createBackup($oldFiles);
            writeJsonFile($maintenancePath, ['version' => $version, 'startedAt' => nowIso(), 'actor' => $actor]);

            $this->db->exec('BEGIN IMMEDIATE');
            $transactionActive = true;
            try {
                $this->applyMigrations($stagePath, (int) ($manifest['database']['schemaVersion'] ?? \makelog_schema_version()));
                $ordered = array_keys($newFiles);
                usort($ordered, static fn(string $left, string $right): int => ($left === 'public/index.php' ? 1 : 0) <=> ($right === 'public/index.php' ? 1 : 0) ?: strcmp($left, $right));
                foreach ($ordered as $path) {
                    $this->copyFile($stagePath . '/' . $path, $this->rootPath . '/' . $path);
                }
                foreach (array_diff(array_keys($oldFiles), array_keys($newFiles)) as $obsolete) {
                    if ($this->managedPath($obsolete) && is_file($this->rootPath . '/' . $obsolete)) {
                        @unlink($this->rootPath . '/' . $obsolete);
                    }
                }
                writeJsonFile($this->rootPath . '/RELEASE_FILES.json', ['version' => $version, 'files' => $newFiles]);
                $this->db->exec('COMMIT');
                $transactionActive = false;
            } catch (\Throwable $error) {
                if ($transactionActive) {
                    try {
                        $this->db->exec('ROLLBACK');
                    } catch (\Throwable) {
                    }
                }
                if ($backupPath !== '') {
                    $this->restoreProgramBackup($backupPath, array_keys($newFiles));
                }
                throw $error;
            }

            @unlink($maintenancePath);
            $state = ['status' => 'success', 'version' => $version, 'message' => 'Make:Log wurde erfolgreich aktualisiert.', 'updatedAt' => nowIso()];
            writeJsonFile($this->updatesPath . '/state.json', $state);
            $this->pruneBackups();
            return $state + ['platform' => 'webhosting', 'reload' => true];
        } catch (HttpError $error) {
            @unlink($maintenancePath);
            writeJsonFile($this->updatesPath . '/state.json', ['status' => 'failed', 'version' => $version, 'message' => $error->getMessage(), 'updatedAt' => nowIso()]);
            throw $error;
        } catch (\Throwable $error) {
            @unlink($maintenancePath);
            writeJsonFile($this->updatesPath . '/state.json', ['status' => 'failed', 'version' => $version, 'message' => 'Das Update wurde abgebrochen und zurückgesetzt.', 'updatedAt' => nowIso()]);
            throw new HttpError(500, 'Das Update wurde abgebrochen und zurückgesetzt.');
        } finally {
            if (is_file($archivePath)) @unlink($archivePath);
            if (is_dir($stagePath)) removeTree($stagePath);
        }
    }

    private function applyMigrations(string $stagePath, int $targetSchema): void
    {
        $current = (int) ($this->db->query("SELECT value FROM meta WHERE key = 'schema_version'")->fetchColumn() ?: 0);
        if ($targetSchema < $current) {
            throw new HttpError(409, 'Dieses Update würde ein nicht unterstütztes Datenbank-Downgrade ausführen.');
        }
        for ($version = $current + 1; $version <= $targetSchema; $version++) {
            $path = $stagePath . '/database/migrations/' . sprintf('%03d.sql', $version);
            if (!is_file($path)) {
                throw new HttpError(502, 'Die Datenbankmigration ' . $version . ' fehlt im Update.');
            }
            $sql = (string) file_get_contents($path);
            if ($sql === '' || preg_match('/\b(?:ATTACH|DETACH|VACUUM|BEGIN|COMMIT|ROLLBACK)\b/i', $sql)) {
                throw new HttpError(502, 'Die Datenbankmigration ' . $version . ' ist nicht zulässig.');
            }
            $this->db->exec($sql);
            $statement = $this->db->prepare('INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
            $statement->execute(['key' => 'schema_version', 'value' => (string) $version]);
        }
    }

    private function createBackup(array $oldFiles): string
    {
        $backupPath = $this->updatesPath . '/backups/' . gmdate('Ymd-His') . '-' . \makelog_version();
        if (!mkdir($backupPath . '/program', 0770, true) && !is_dir($backupPath . '/program')) {
            throw new HttpError(507, 'Die Update-Sicherung konnte nicht angelegt werden.');
        }
        foreach (array_keys($oldFiles) as $path) {
            if ($this->managedPath($path) && is_file($this->rootPath . '/' . $path)) {
                $this->copyFile($this->rootPath . '/' . $path, $backupPath . '/program/' . $path);
            }
        }
        writeJsonFile($backupPath . '/backup.json', ['version' => \makelog_version(), 'files' => array_keys($oldFiles), 'createdAt' => nowIso()]);
        $databaseBackup = $backupPath . '/database.sqlite';
        $this->db->exec('PRAGMA wal_checkpoint(FULL)');
        $this->db->exec("VACUUM INTO '" . str_replace("'", "''", $databaseBackup) . "'");
        return $backupPath;
    }

    private function restoreProgramBackup(string $backupPath, array $newPaths): void
    {
        $backup = readJsonFile($backupPath . '/backup.json');
        $oldPaths = array_values(array_filter((array) ($backup['files'] ?? []), 'is_string'));
        foreach ($newPaths as $path) {
            if ($this->managedPath($path) && !in_array($path, $oldPaths, true) && is_file($this->rootPath . '/' . $path)) {
                @unlink($this->rootPath . '/' . $path);
            }
        }
        foreach ($oldPaths as $path) {
            if ($this->managedPath($path) && is_file($backupPath . '/program/' . $path)) {
                $this->copyFile($backupPath . '/program/' . $path, $this->rootPath . '/' . $path);
            }
        }
    }

    private function installedFiles(): array
    {
        $release = readJsonFile($this->rootPath . '/RELEASE_FILES.json');
        if (is_array($release['files'] ?? null)) return $release['files'];
        $files = [];
        foreach (['app', 'public', 'config'] as $directory) {
            $root = $this->rootPath . '/' . $directory;
            if (!is_dir($root)) continue;
            foreach (new RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)) as $file) {
                if ($file->isFile() && !$file->isLink()) {
                    $relative = substr($file->getPathname(), strlen($this->rootPath) + 1);
                    $files[$relative] = hash_file('sha256', $file->getPathname());
                }
            }
        }
        foreach (['VERSION', 'SCHEMA_VERSION'] as $path) {
            if (is_file($this->rootPath . '/' . $path)) $files[$path] = hash_file('sha256', $this->rootPath . '/' . $path);
        }
        return $files;
    }

    private function assertNoLocalChanges(array $installedFiles): void
    {
        if (!is_file($this->rootPath . '/RELEASE_FILES.json')) return;
        $changed = [];
        foreach ($installedFiles as $path => $expectedHash) {
            $file = $this->rootPath . '/' . $path;
            if (!is_string($expectedHash) || !is_file($file) || !hash_equals($expectedHash, hash_file('sha256', $file))) {
                $changed[] = $path;
                if (count($changed) >= 5) break;
            }
        }
        if ($changed !== []) {
            throw new HttpError(409, 'Lokal veränderte Programmdateien verhindern das Update: ' . implode(', ', $changed));
        }
    }

    private function extractArchive(string $archivePath, string $stagePath): void
    {
        try {
            $archive = new PharData($archivePath);
            $marker = basename($archivePath) . '/';
            $count = 0;
            foreach (new RecursiveIteratorIterator($archive) as $file) {
                $pathname = str_replace('\\', '/', $file->getPathname());
                $markerPosition = strpos($pathname, $marker);
                $path = $markerPosition === false ? '' : substr($pathname, $markerPosition + strlen($marker));
                if (++$count > 5000 || !$this->managedPath($path) || $file->isLink()) {
                    throw new HttpError(502, 'Das Update-Paket enthält einen unzulässigen Dateipfad.');
                }
            }
            if (!mkdir($stagePath, 0770, true) && !is_dir($stagePath)) {
                throw new HttpError(507, 'Das Update konnte nicht vorbereitet werden.');
            }
            $archive->extractTo($stagePath, null, true);
        } catch (HttpError $error) {
            throw $error;
        } catch (\Throwable) {
            throw new HttpError(502, 'Das Update-Paket ist kein gültiges TAR-Archiv.');
        }
    }

    private function verifyStagedFiles(string $stagePath, array $files): void
    {
        foreach ($files as $path => $expectedHash) {
            $file = $stagePath . '/' . $path;
            if (!is_file($file) || is_link($file) || !hash_equals($expectedHash, hash_file('sha256', $file))) {
                throw new HttpError(502, 'Die Datei ' . $path . ' ist beschädigt oder fehlt im Update.');
            }
        }
    }

    private function copyFile(string $source, string $target): void
    {
        $directory = dirname($target);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new HttpError(507, 'Das Zielverzeichnis für das Update konnte nicht angelegt werden.');
        }
        $content = @file_get_contents($source);
        if ($content === false) throw new HttpError(507, 'Eine Update-Datei konnte nicht gelesen werden.');
        atomicWrite($target, $content);
        @chmod($target, 0644);
    }

    private function download(string $url, int $maximumBytes): string
    {
        $parts = parse_url($url);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['https', 'http'], true) || ($scheme === 'http' && !in_array((string) ($parts['host'] ?? ''), ['127.0.0.1', 'localhost'], true))) {
            throw new HttpError(502, 'Die Update-Adresse verwendet kein erlaubtes Protokoll.');
        }
        $context = stream_context_create(['http' => [
            'timeout' => 8,
            'follow_location' => 1,
            'max_redirects' => 5,
            'header' => "Accept: application/octet-stream\r\nUser-Agent: MakeLog-Updater/" . \makelog_version() . "\r\n",
        ]]);
        $handle = @fopen($url, 'rb', false, $context);
        if ($handle === false) throw new HttpError(502, 'GitHub konnte für die Update-Prüfung nicht erreicht werden.');
        $content = '';
        try {
            while (!feof($handle)) {
                $chunk = fread($handle, 1048576);
                if ($chunk === false) throw new HttpError(502, 'Der Update-Download wurde unterbrochen.');
                $content .= $chunk;
                if (strlen($content) > $maximumBytes) throw new HttpError(502, 'Der Update-Download überschreitet die erlaubte Größe.');
            }
        } finally {
            fclose($handle);
        }
        return $content;
    }

    private function managedPath(string $path): bool
    {
        if ($path === '' || str_contains($path, "\0") || str_contains($path, '..') || str_starts_with($path, '/') || str_contains($path, '\\')) return false;
        return in_array($path, ['VERSION', 'SCHEMA_VERSION', 'RELEASE_FILES.json'], true)
            || preg_match('#^(?:app|public|config)/[A-Za-z0-9._/-]+$#', $path) === 1
            || preg_match('#^database/migrations/(?:\d{3}\.sql|README\.md)$#', $path) === 1;
    }

    private function webInstallSupported(): bool
    {
        return is_writable($this->rootPath)
            && is_writable($this->rootPath . '/app')
            && is_writable($this->rootPath . '/public')
            && class_exists(PharData::class);
    }

    private function lock()
    {
        $this->ensureUpdatesPath();
        $handle = fopen($this->updatesPath . '/update.lock', 'c');
        if ($handle === false || !flock($handle, LOCK_EX | LOCK_NB)) {
            throw new HttpError(409, 'Ein Update wird bereits verarbeitet.');
        }
        return $handle;
    }

    private function ensureUpdatesPath(): void
    {
        if (!is_dir($this->updatesPath) && !mkdir($this->updatesPath, 0770, true) && !is_dir($this->updatesPath)) {
            throw new HttpError(507, 'Der Update-Status kann nicht gespeichert werden.');
        }
    }

    private function pruneBackups(): void
    {
        $path = $this->updatesPath . '/backups';
        if (!is_dir($path)) return;
        $backups = array_values(array_filter(iterator_to_array(new \FilesystemIterator($path)), static fn(\SplFileInfo $item): bool => $item->isDir()));
        usort($backups, static fn(\SplFileInfo $left, \SplFileInfo $right): int => $right->getMTime() <=> $left->getMTime());
        foreach (array_slice($backups, 3) as $backup) removeTree($backup->getPathname());
    }

    private function environment(string $name, string $fallback): string
    {
        $value = getenv($name);
        return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
    }
}
