<?php

declare(strict_types=1);

namespace Logbuch;

final class ProjectStore
{
    public const COLLECTIONS = ['entries', 'tasks', 'shopping', 'materials', 'contacts', 'links', 'ideas', 'learnings', 'notes'];
    public const STATUSES = ['idea', 'active', 'paused', 'completed', 'archived', 'trashed'];
    public const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

    public function __construct(private readonly string $root)
    {
        if (!is_dir($root) && !mkdir($root, 0770, true) && !is_dir($root)) {
            throw new \RuntimeException('Das Projektverzeichnis konnte nicht angelegt werden.');
        }
    }

    public function list(): array
    {
        $projects = [];
        foreach (glob($this->root . '/*/project.json') ?: [] as $path) {
            $project = readJsonFile($path);
            if (!$project || !validId((string) ($project['id'] ?? ''))) {
                continue;
            }
            $projects[] = $this->summary($project);
        }
        usort($projects, static fn(array $left, array $right): int => strcmp((string) ($right['createdAt'] ?? ''), (string) ($left['createdAt'] ?? '')) ?: strcasecmp((string) $left['title'], (string) $right['title']));
        return $projects;
    }

    public function overview(): array
    {
        $projects = [];
        foreach (glob($this->root . '/*/project.json') ?: [] as $path) {
            $project = readJsonFile($path);
            if (!$project || !validId((string) ($project['id'] ?? '')) || ($project['status'] ?? '') !== 'active') {
                continue;
            }
            $entries = $this->collection((string) $project['id'], 'entries');
            $tasks = $this->collection((string) $project['id'], 'tasks');
            $summary = $this->summary($project, $entries, $tasks);
            $summary['entries'] = $entries;
            $summary['tasks'] = $tasks;
            $summary['lastActivityAt'] = $this->lastActivityAt((string) $project['id'], $project);
            $projects[] = $summary;
        }
        usort($projects, static fn(array $left, array $right): int => strcmp((string) ($right['createdAt'] ?? ''), (string) ($left['createdAt'] ?? '')) ?: strcasecmp((string) $left['title'], (string) $right['title']));
        return $projects;
    }

    public function completedProjects(): array
    {
        $projects = [];
        foreach (glob($this->root . '/*/project.json') ?: [] as $path) {
            $project = readJsonFile($path);
            if (!$project || !validId((string) ($project['id'] ?? '')) || ($project['status'] ?? '') !== 'completed') continue;
            $completedAt = (string) ($project['completedAt'] ?? $project['updatedAt'] ?? $project['latestEntryDate'] ?? '');
            if ($completedAt === '') {
                $dates = array_column($this->collection((string) $project['id'], 'entries'), 'date');
                rsort($dates);
                $completedAt = (string) ($dates[0] ?? '');
            }
            $projects[] = [
                'id' => $project['id'],
                'title' => $project['title'] ?? '',
                'createdAt' => $project['createdAt'] ?? '',
                'completedAt' => $completedAt,
            ];
        }
        return $projects;
    }

    public function exists(string $id): bool
    {
        return validId($id) && is_file($this->projectPath($id));
    }

    public function get(string $id): array
    {
        if (!$this->exists($id)) {
            throw new HttpError(404, 'Projekt nicht gefunden.');
        }
        $project = readJsonFile($this->projectPath($id));
        foreach (self::COLLECTIONS as $collection) {
            $project[$collection] = $this->collection($id, $collection);
        }
        $project['files'] = $this->attachments($id);
        return $project;
    }

    public function reservationTarget(string $projectId, ?string $collection = null, ?string $itemId = null): array
    {
        $project = $this->getBase($projectId);
        $target = null;
        if ($collection !== null || $itemId !== null) {
            if ($collection === null || $itemId === null) {
                throw new HttpError(422, 'Projektelement-Typ und -ID müssen gemeinsam angegeben werden.');
            }
            $entry = $this->item($projectId, $collection, $itemId);
            $target = [
                'collection' => $collection,
                'id' => $itemId,
                'title' => trim((string) ($entry['title'] ?? $entry['name'] ?? 'Projektelement')) ?: 'Projektelement',
            ];
        }
        return [
            'project' => [
                'id' => (string) $project['id'],
                'title' => (string) ($project['title'] ?? 'Projekt'),
                'status' => (string) ($project['status'] ?? 'active'),
            ],
            'entry' => $target,
        ];
    }

    public function search(string $query, array $projectIds): array
    {
        $normalizedQuery = mb_strtolower(trim($query), 'UTF-8');
        $terms = array_values(array_filter(preg_split('/\s+/u', $normalizedQuery) ?: []));
        if (!$terms) return [];
        $allowed = array_fill_keys(array_values(array_filter($projectIds, 'is_string')), true);
        $results = [];
        foreach ($this->list() as $summary) {
            $projectId = (string) ($summary['id'] ?? '');
            if (!isset($allowed[$projectId])) continue;
            $project = $this->get($projectId);
            $projectTitle = (string) ($project['title'] ?? 'Projekt');
            $projectDescription = (string) ($project['description'] ?? '');
            $projectSearchText = implode(' ', [$projectTitle, $projectDescription, (string) ($project['priority'] ?? ''), (string) ($project['status'] ?? '')]);
            $projectResult = $this->searchResult($terms, 'project', $project, $projectTitle, $projectDescription, $projectSearchText, $project);
            if ($projectResult) $results[] = $projectResult;
            foreach (self::COLLECTIONS as $collection) {
                foreach ((array) ($project[$collection] ?? []) as $item) {
                    if (!is_array($item)) continue;
                    $title = $this->searchItemTitle($collection, $item);
                    $body = $this->searchItemBody($collection, $item);
                    $searchText = implode(' ', array_map(static fn(mixed $value): string => is_scalar($value) ? (string) $value : '', $item));
                    $result = $this->searchResult($terms, $collection, $item, $title, $body, $searchText, $project);
                    if ($result) $results[] = $result;
                }
            }
            foreach ((array) ($project['files'] ?? []) as $file) {
                if (!is_array($file)) continue;
                $title = trim((string) ($file['displayName'] ?? $file['originalName'] ?? 'Datei')) ?: 'Datei';
                $body = trim(implode(' · ', [(string) ($file['description'] ?? ''), (string) ($file['originalName'] ?? ''), (string) ($file['mimeType'] ?? '')]));
                $result = $this->searchResult($terms, 'files', $file, $title, $body, $body, $project);
                if ($result) $results[] = $result;
            }
        }
        return $results;
    }

    public function attachments(string $projectId): array
    {
        if (!$this->exists($projectId)) throw new HttpError(404, 'Projekt nicht gefunden.');
        $files = [];
        foreach (glob($this->attachmentsDirectory($projectId) . '/*/metadata.json') ?: [] as $path) {
            $file = readJsonFile($path);
            if ($file && validId((string) ($file['id'] ?? ''))) $files[] = $file;
        }
        usort($files, static fn(array $left, array $right): int => strcmp((string) ($right['uploadedAt'] ?? ''), (string) ($left['uploadedAt'] ?? '')));
        return $files;
    }

    public function createAttachment(string $projectId, array $upload, array $input, string $actor): array
    {
        return $this->storeAttachment($projectId, $upload, $input, $actor);
    }

    public function importAttachment(string $projectId, array $upload, array $metadata, string $actor): array
    {
        $association = is_array($metadata['association'] ?? null) ? $metadata['association'] : [];
        $input = [
            'displayName' => $metadata['displayName'] ?? '',
            'description' => $metadata['description'] ?? '',
            'associationCollection' => $association['collection'] ?? '',
            'associationItemId' => $association['itemId'] ?? '',
        ];
        return $this->storeAttachment($projectId, $upload, $input, $actor, $metadata);
    }

    public function importAttachmentFromPath(string $projectId, string $sourcePath, array $metadata, string $actor): array
    {
        $originalName = (string) ($metadata['originalName'] ?? $metadata['displayName'] ?? 'Datei');
        $upload = ['error' => UPLOAD_ERR_OK, 'size' => @filesize($sourcePath) ?: 0, 'tmp_name' => $sourcePath, 'name' => $originalName];
        $association = is_array($metadata['association'] ?? null) ? $metadata['association'] : [];
        $input = [
            'displayName' => $metadata['displayName'] ?? '',
            'description' => $metadata['description'] ?? '',
            'associationCollection' => $association['collection'] ?? '',
            'associationItemId' => $association['itemId'] ?? '',
        ];
        return $this->storeAttachment($projectId, $upload, $input, $actor, $metadata, true);
    }

    private function storeAttachment(string $projectId, array $upload, array $input, string $actor, ?array $restoredMetadata = null, bool $trustedLocalSource = false): array
    {
        if (!$this->exists($projectId)) throw new HttpError(404, 'Projekt nicht gefunden.');
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) throw new HttpError(413, 'Die Datei ist größer als 50 MB.');
        if ($error !== UPLOAD_ERR_OK) throw new HttpError(422, 'Die Datei konnte nicht hochgeladen werden.');
        $size = (int) ($upload['size'] ?? 0);
        $temporaryPath = (string) ($upload['tmp_name'] ?? '');
        if ($size < 1 || $size > self::MAX_ATTACHMENT_BYTES || !is_file($temporaryPath)) throw new HttpError($size > self::MAX_ATTACHMENT_BYTES ? 413 : 422, $size > self::MAX_ATTACHMENT_BYTES ? 'Die Datei ist größer als 50 MB.' : 'Die Datei ist leer oder ungültig.');
        $originalName = mb_substr(trim(basename(str_replace('\\', '/', (string) ($upload['name'] ?? 'Datei')))), 0, 240);
        if ($originalName === '') $originalName = 'Datei';
        $extension = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
        if (in_array($extension, ['php', 'phtml', 'phar', 'cgi', 'pl', 'sh', 'bash', 'exe', 'dll', 'com', 'bat', 'cmd'], true)) throw new HttpError(415, 'Dieser Dateityp ist aus Sicherheitsgründen nicht erlaubt.');
        $mimeType = 'application/octet-stream';
        if (class_exists(\finfo::class)) {
            $detected = (new \finfo(FILEINFO_MIME_TYPE))->file($temporaryPath);
            if (is_string($detected) && $detected !== '') $mimeType = mb_substr($detected, 0, 160);
        }
        $association = $this->normalizeAttachmentAssociation($projectId, $input);
        $restoredId = trim((string) ($restoredMetadata['id'] ?? ''));
        if ($restoredMetadata !== null && !validId($restoredId)) throw new HttpError(422, 'Ungültige Datei-ID im Backup.');
        $id = $restoredMetadata === null ? 'file-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3)) : $restoredId;
        $directory = $this->attachmentDirectory($projectId, $id);
        if (is_dir($directory)) throw new HttpError(409, 'Die Datei ist im Projekt bereits vorhanden.');
        if (!mkdir($directory, 0770, true) && !is_dir($directory)) throw new HttpError(507, 'Dateiverzeichnis konnte nicht angelegt werden.');
        $destination = $directory . '/original.bin';
        $stored = $trustedLocalSource ? copy($temporaryPath, $destination) : move_uploaded_file($temporaryPath, $destination);
        if (!$stored) {
            removeTree($directory);
            throw new HttpError(507, 'Die Datei konnte nicht im Projektordner gespeichert werden.');
        }
        $sha256 = hash_file('sha256', $destination) ?: '';
        $restoredSha256 = strtolower(trim((string) ($restoredMetadata['sha256'] ?? '')));
        if ($restoredMetadata !== null && $restoredSha256 !== '' && (!preg_match('/^[a-f0-9]{64}$/', $restoredSha256) || !hash_equals($restoredSha256, $sha256))) {
            removeTree($directory);
            throw new HttpError(422, 'Die Prüfsumme der importierten Datei stimmt nicht mit dem Backup überein.');
        }
        $restoredMimeType = trim((string) ($restoredMetadata['mimeType'] ?? ''));
        $mimeType = $restoredMetadata === null || $restoredMimeType === '' ? $mimeType : $restoredMimeType;
        if (!preg_match('#^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$#', $mimeType)) {
            removeTree($directory);
            throw new HttpError(422, 'Ungültiger Dateityp im Backup.');
        }
        $rotation = $restoredMetadata === null ? 0 : (int) ($restoredMetadata['rotation'] ?? 0);
        if (!in_array($rotation, [0, 90, 180, 270], true)) {
            removeTree($directory);
            throw new HttpError(422, 'Ungültige Bilddrehung im Backup.');
        }
        $uploadedAt = $restoredMetadata === null ? nowIso() : $this->attachmentTimestamp($restoredMetadata['uploadedAt'] ?? null, 'Uploadzeitpunkt');
        $uploadedBy = $restoredMetadata === null ? $actor : $this->attachmentText($restoredMetadata['uploadedBy'] ?? '', 80, $actor);
        $file = [
            'id' => $id,
            'originalName' => $originalName,
            'displayName' => $this->attachmentText($input['displayName'] ?? '', 160, $originalName),
            'description' => $this->attachmentText($input['description'] ?? '', 4000),
            'mimeType' => $mimeType,
            'size' => filesize($destination) ?: $size,
            'sha256' => $sha256,
            'rotation' => $rotation,
            'association' => $association,
            'uploadedAt' => $uploadedAt,
            'uploadedBy' => $uploadedBy,
        ];
        if ($restoredMetadata !== null && array_key_exists('updatedAt', $restoredMetadata)) {
            $file['updatedAt'] = $this->attachmentTimestamp($restoredMetadata['updatedAt'], 'Änderungszeitpunkt');
        }
        writeJsonFile($directory . '/metadata.json', $file);
        $this->generateAttachmentThumbnail($directory, $mimeType);
        return $file;
    }

    public function updateAttachment(string $projectId, string $fileId, array $input): array
    {
        $file = $this->attachment($projectId, $fileId);
        if (array_key_exists('displayName', $input)) $file['displayName'] = $this->attachmentText($input['displayName'], 160, (string) $file['originalName']);
        if (array_key_exists('description', $input)) $file['description'] = $this->attachmentText($input['description'], 4000);
        if (array_key_exists('associationCollection', $input) || array_key_exists('associationItemId', $input)) $file['association'] = $this->normalizeAttachmentAssociation($projectId, $input);
        $file['updatedAt'] = nowIso();
        writeJsonFile($this->attachmentDirectory($projectId, $fileId) . '/metadata.json', $file);
        return $file;
    }

    public function rotateAttachment(string $projectId, string $fileId, int $degrees): array
    {
        $file = $this->attachment($projectId, $fileId);
        if (!str_starts_with((string) ($file['mimeType'] ?? ''), 'image/')) throw new HttpError(422, 'Nur Bilder können gedreht werden.');
        if (!in_array($degrees, [-90, 90], true)) throw new HttpError(422, 'Ungültige Drehung.');
        $file['rotation'] = (((int) ($file['rotation'] ?? 0) + $degrees) % 360 + 360) % 360;
        $file['updatedAt'] = nowIso();
        writeJsonFile($this->attachmentDirectory($projectId, $fileId) . '/metadata.json', $file);
        return $file;
    }

    public function deleteAttachment(string $projectId, string $fileId): array
    {
        $file = $this->attachment($projectId, $fileId);
        removeTree($this->attachmentDirectory($projectId, $fileId));
        return $file;
    }

    public function attachmentContent(string $projectId, string $fileId): array
    {
        $file = $this->attachment($projectId, $fileId);
        $path = $this->attachmentDirectory($projectId, $fileId) . '/original.bin';
        if (!is_file($path)) throw new HttpError(404, 'Dateiinhalt nicht gefunden.');
        return ['metadata' => $file, 'path' => $path];
    }

    public function attachmentThumbnail(string $projectId, string $fileId): array
    {
        $file = $this->attachment($projectId, $fileId);
        $directory = $this->attachmentDirectory($projectId, $fileId);
        $path = $directory . '/thumbnail.jpg';
        if (!is_file($path)) $this->generateAttachmentThumbnail($directory, (string) ($file['mimeType'] ?? ''));
        if (!is_file($path)) return $this->attachmentContent($projectId, $fileId);
        return ['metadata' => [...$file, 'mimeType' => 'image/jpeg', 'originalName' => 'thumbnail.jpg'], 'path' => $path];
    }

    public function storageStats(): array
    {
        $projectBytes = 0;
        $attachmentBytes = 0;
        $attachmentCount = 0;
        foreach (glob($this->root . '/*') ?: [] as $projectDirectory) {
            if (!is_dir($projectDirectory)) continue;
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($projectDirectory, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $item) {
                if (!$item->isFile()) continue;
                $size = $item->getSize();
                $projectBytes += $size;
                if ($item->getFilename() === 'original.bin') { $attachmentBytes += $size; ++$attachmentCount; }
            }
        }
        $free = @disk_free_space($this->root);
        $total = @disk_total_space($this->root);
        $freeBytes = is_float($free) || is_int($free) ? (int) $free : 0;
        $totalBytes = is_float($total) || is_int($total) ? (int) $total : 0;
        return ['projectBytes' => $projectBytes, 'attachmentBytes' => $attachmentBytes, 'attachmentCount' => $attachmentCount, 'freeBytes' => $freeBytes, 'totalBytes' => $totalBytes, 'warning' => $totalBytes > 0 && ($freeBytes < 5 * 1024 ** 3 || $freeBytes / $totalBytes < 0.1)];
    }

    public function create(array $input, string $actor): array
    {
        $title = trim((string) ($input['title'] ?? ''));
        $createdAt = (string) ($input['createdAt'] ?? '');
        if (mb_strlen($title) < 1 || mb_strlen($title) > 120) {
            throw new HttpError(422, 'Der Projektname muss 1–120 Zeichen lang sein.');
        }
        if (!validDate($createdAt)) {
            throw new HttpError(422, 'Ein gültiges Startdatum ist erforderlich.');
        }
        $dueDate = trim((string) ($input['dueDate'] ?? ''));
        if ($dueDate !== '' && !validDate($dueDate)) {
            throw new HttpError(422, 'Die Fälligkeit muss ein gültiges Datum sein.');
        }
        $status = (string) ($input['status'] ?? 'active');
        if (!in_array($status, self::STATUSES, true) || $status === 'trashed') {
            throw new HttpError(422, 'Ungültiger Projektstatus.');
        }
        $id = 'project-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3));
        $project = [
            'id' => $id,
            'title' => $title,
            'description' => mb_substr(trim((string) ($input['description'] ?? '')), 0, 2000),
            'status' => $status,
            'priority' => $this->validPriority($input['priority'] ?? 'Mittel'),
            'flagged' => $this->validFlag($input['flagged'] ?? false),
            'icon' => $this->validIcon($input['icon'] ?? 'box'),
            'iconInherited' => $this->validFlag($input['iconInherited'] ?? !array_key_exists('icon', $input)),
            'createdAt' => $createdAt,
            'dueDate' => $dueDate,
            'createdBy' => $actor,
            'tagIds' => $this->validTagIds($input['tagIds'] ?? []),
            'folderId' => $status === 'archived' ? null : $this->validFolderId($input['folderId'] ?? null),
        ];
        if ($status === 'completed') {
            $project['completedAt'] = nowIso();
        }
        $this->prepareProjectDirectory($id);
        $this->saveProject($project);
        return $this->get($id);
    }

    public function update(string $id, array $input): array
    {
        $project = $this->getBase($id);
        if (array_key_exists('title', $input)) {
            $title = trim((string) $input['title']);
            if (mb_strlen($title) < 1 || mb_strlen($title) > 120) {
                throw new HttpError(422, 'Der Projektname muss 1–120 Zeichen lang sein.');
            }
            $project['title'] = $title;
        }
        if (array_key_exists('description', $input)) {
            $project['description'] = mb_substr(trim((string) $input['description']), 0, 2000);
        }
        if (array_key_exists('priority', $input)) {
            $project['priority'] = $this->validPriority($input['priority']);
        }
        if (array_key_exists('flagged', $input)) {
            $project['flagged'] = $this->validFlag($input['flagged']);
        }
        if (array_key_exists('icon', $input)) {
            $project['icon'] = $this->validIcon($input['icon']);
        }
        if (array_key_exists('iconInherited', $input)) {
            $project['iconInherited'] = $this->validFlag($input['iconInherited']);
        }
        if (array_key_exists('createdAt', $input)) {
            if (!validDate((string) $input['createdAt'])) {
                throw new HttpError(422, 'Ein gültiges Startdatum ist erforderlich.');
            }
            $project['createdAt'] = $input['createdAt'];
        }
        if (array_key_exists('dueDate', $input)) {
            $dueDate = trim((string) $input['dueDate']);
            if ($dueDate !== '' && !validDate($dueDate)) {
                throw new HttpError(422, 'Die Fälligkeit muss ein gültiges Datum sein.');
            }
            $project['dueDate'] = $dueDate;
        }
        if (array_key_exists('status', $input)) {
            if (!in_array($input['status'], self::STATUSES, true)) {
                throw new HttpError(422, 'Ungültiger Projektstatus.');
            }
            $previousStatus = (string) ($project['status'] ?? 'active');
            $project['status'] = $input['status'];
            if ($input['status'] === 'completed' && $previousStatus !== 'completed') {
                $project['completedAt'] = nowIso();
            } elseif (in_array($input['status'], ['idea', 'active', 'paused'], true)) {
                unset($project['completedAt']);
            }
            if ($input['status'] === 'trashed') {
                $project['deletedAt'] = isset($input['deletedAt']) ? (int) $input['deletedAt'] : time();
            } else {
                unset($project['deletedAt']);
            }
        }
        if (array_key_exists('tagIds', $input)) {
            $project['tagIds'] = $this->validTagIds($input['tagIds']);
        }
        if (array_key_exists('folderId', $input)) {
            $project['folderId'] = $this->validFolderId($input['folderId']);
        }
        if (in_array(($project['status'] ?? ''), ['archived', 'trashed'], true)) {
            $project['folderId'] = null;
        }
        $project['updatedAt'] = nowIso();
        $this->saveProject($project);
        return $this->get($id);
    }

    public function trash(string $id): array
    {
        return $this->update($id, ['status' => 'trashed', 'deletedAt' => time()]);
    }

    public function purge(string $id): void
    {
        $project = $this->getBase($id);
        if (($project['status'] ?? '') !== 'trashed') {
            throw new HttpError(409, 'Nur Projekte im Papierkorb können endgültig gelöscht werden.');
        }
        removeTree($this->projectDirectory($id));
    }

    public function emptyTrash(): int
    {
        $removed = 0;
        foreach ($this->list() as $project) {
            if (($project['status'] ?? '') !== 'trashed') {
                continue;
            }
            removeTree($this->projectDirectory($project['id']));
            ++$removed;
        }
        return $removed;
    }

    public function clear(): int
    {
        $projects = $this->list();
        foreach ($projects as $project) {
            removeTree($this->projectDirectory($project['id']));
        }
        return count($projects);
    }

    public function removeByIds(array $ids): int
    {
        $removed = 0;
        foreach (array_values(array_unique($ids)) as $id) {
            if (!is_string($id) || !validId($id) || !$this->exists($id)) {
                continue;
            }
            removeTree($this->projectDirectory($id));
            ++$removed;
        }
        return $removed;
    }

    public function saveImported(array $project, bool $replace): array
    {
        $id = (string) ($project['id'] ?? '');
        if (!validId($id) || mb_strlen(trim((string) ($project['title'] ?? ''))) < 2) {
            throw new HttpError(422, 'Ungültige Projektdaten im Backup.');
        }
        foreach (self::COLLECTIONS as $collection) {
            if (!isset($project[$collection])) {
                $project[$collection] = [];
            }
            if (!is_array($project[$collection])) {
                throw new HttpError(422, 'Ungültige Projektdaten im Backup.');
            }
            foreach ($project[$collection] as $item) {
                if (!is_array($item) || !validId((string) ($item['id'] ?? ''))) {
                    throw new HttpError(422, 'Ungültige Einträge im Backup.');
                }
            }
        }
        if ($this->exists($id) && !$replace) {
            return ['id' => $id, 'skipped' => true];
        }
        if ($this->exists($id)) {
            removeTree($this->projectDirectory($id));
        }
        $this->prepareProjectDirectory($id);
        $base = $project;
        foreach (self::COLLECTIONS as $collection) {
            unset($base[$collection]);
        }
        unset($base['files']);
        $base['status'] = in_array(($base['status'] ?? 'active'), self::STATUSES, true) ? $base['status'] : 'active';
        $base['priority'] = $this->validPriority($base['priority'] ?? 'Mittel');
        $base['flagged'] = $this->validFlag($base['flagged'] ?? false);
        $base['icon'] = $this->validIcon($base['icon'] ?? 'box');
        $base['iconInherited'] = $this->validFlag($base['iconInherited'] ?? (($base['icon'] ?? 'box') === 'box'));
        $base['dueDate'] = trim((string) ($base['dueDate'] ?? ''));
        if ($base['dueDate'] !== '' && !validDate($base['dueDate'])) {
            throw new HttpError(422, 'Ungültige Projektfälligkeit im Backup.');
        }
        $base['tagIds'] = $this->validTagIds($base['tagIds'] ?? []);
        $base['folderId'] = $this->validFolderId($base['folderId'] ?? null);
        $this->saveProject($base);
        foreach (self::COLLECTIONS as $collection) {
            foreach ($project[$collection] as $item) {
                $this->saveItem($id, $collection, $item);
            }
        }
        return ['id' => $id, 'skipped' => false];
    }

    public function createEntry(string $projectId, array $input, string $actor): array
    {
        foreach (['date', 'title', 'body', 'nextStep'] as $field) {
            if (isset($input[$field]) && !is_scalar($input[$field])) {
                throw new HttpError(422, 'Ungültiger Feldwert.');
            }
        }
        $date = (string) ($input['date'] ?? '');
        if (!validDate($date)) {
            throw new HttpError(422, 'Ein gültiges Eintragsdatum ist erforderlich.');
        }
        $entry = [
            'id' => 'entry-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3)),
            'date' => $date,
            'title' => mb_substr(trim((string) ($input['title'] ?? '')), 0, 160),
            'body' => mb_substr((string) ($input['body'] ?? ''), 0, 50000),
            'nextStep' => mb_substr((string) ($input['nextStep'] ?? ''), 0, 10000),
            'author' => $actor,
            'createdAt' => nowIso(),
        ];
        $this->saveItem($projectId, 'entries', $entry);
        $this->adjustStartDate($projectId, $date);
        return $entry;
    }

    public function createItem(string $projectId, string $collection, array $input, string $actor): array
    {
        $this->assertCollection($collection);
        if ($collection === 'entries') {
            return $this->createEntry($projectId, $input, $actor);
        }
        $singular = [
            'tasks' => 'task',
            'shopping' => 'purchase',
            'materials' => 'material',
            'contacts' => 'contact',
            'links' => 'link',
            'ideas' => 'idea',
            'learnings' => 'learning',
            'notes' => 'note',
        ][$collection];
        $item = [
            'id' => $singular . '-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3)),
            ...$this->normalizeItemInput($collection, $input),
            'createdAt' => nowIso(),
            'author' => $actor,
        ];
        $this->saveItem($projectId, $collection, $item);
        return $item;
    }

    public function updateItem(string $projectId, string $collection, string $itemId, array $input): array
    {
        $item = $this->item($projectId, $collection, $itemId);
        if ($collection === 'entries' && isset($input['date']) && !validDate((string) $input['date'])) {
            throw new HttpError(422, 'Ein gültiges Eintragsdatum ist erforderlich.');
        }
        $changes = $collection === 'entries'
            ? $this->normalizeEntryChanges($input)
            : $this->normalizeItemInput($collection, $input, true);
        $item = array_replace($item, $changes, ['updatedAt' => nowIso()]);
        $this->saveItem($projectId, $collection, $item);
        if ($collection === 'entries' && isset($changes['date'])) {
            $this->adjustStartDate($projectId, (string) $changes['date']);
        }
        return $item;
    }

    public function deleteItem(string $projectId, string $collection, string $itemId): array
    {
        $item = $this->item($projectId, $collection, $itemId);
        foreach ($this->attachments($projectId) as $file) {
            if (($file['association']['collection'] ?? null) !== $collection || ($file['association']['itemId'] ?? null) !== $itemId) continue;
            removeTree($this->attachmentDirectory($projectId, (string) $file['id']));
        }
        $base = $this->itemBase($projectId, $collection, $itemId);
        @unlink($base . '.md');
        if (!unlink($base . '.json')) {
            throw new HttpError(507, 'Eintrag konnte nicht gelöscht werden.');
        }
        return $item;
    }

    public function reorder(string $projectId, string $collection, array $ids): void
    {
        $this->assertCollection($collection);
        if (count($ids) > 500 || count(array_unique($ids)) !== count($ids)) {
            throw new HttpError(422, 'Ungültige Reihenfolge.');
        }
        foreach ($ids as $index => $id) {
            $item = $this->item($projectId, $collection, (string) $id);
            $item['sortOrder'] = $index;
            $this->saveItem($projectId, $collection, $item);
        }
    }

    public function completeTask(string $projectId, string $taskId, string $date, string $actor): array
    {
        if (!validDate($date)) {
            throw new HttpError(422, 'Ein gültiges Abschlussdatum ist erforderlich.');
        }
        $task = $this->item($projectId, 'tasks', $taskId);
        $entryId = 'entry-task-' . substr(hash('sha256', $taskId), 0, 12);
        $entryPath = $this->itemBase($projectId, 'entries', $entryId) . '.json';
        if (($task['status'] ?? '') === 'Erledigt' && is_file($entryPath)) {
            return readJsonFile($entryPath);
        }
        $entry = [
            'id' => $entryId,
            'date' => $date,
            'title' => $task['title'] ?? 'Arbeitsschritt erledigt',
            'body' => $task['description'] ?? '',
            'nextStep' => '',
            'author' => $actor,
            'sourceTaskId' => $taskId,
            'createdAt' => nowIso(),
        ];
        $task['status'] = 'Erledigt';
        $task['completedAt'] = $date;
        $task['completedEntryId'] = $entryId;
        $this->saveItem($projectId, 'entries', $entry);
        $this->saveItem($projectId, 'tasks', $task);
        $this->reassignAttachments($projectId, 'tasks', $taskId, 'entries', $entryId);
        $this->adjustStartDate($projectId, $date);
        return $entry;
    }

    public function reopenEntry(string $projectId, string $entryId, string $actor): array
    {
        $entry = $this->item($projectId, 'entries', $entryId);
        $taskId = (string) ($entry['sourceTaskId'] ?? ('task-entry-' . substr(hash('sha256', $entryId), 0, 12)));
        try {
            $task = $this->item($projectId, 'tasks', $taskId);
        } catch (HttpError $error) {
            if ($error->status !== 404) {
                throw $error;
            }
            $task = [
                'id' => $taskId,
                'createdAt' => $entry['date'] ?? nowIso(),
                'author' => $actor,
                'title' => $entry['title'] ?? 'Arbeitsschritt fortsetzen',
                'description' => $entry['body'] ?? '',
                'priority' => 'Normal',
            ];
        }
        $task['status'] = 'Offen';
        unset($task['completedAt'], $task['completedEntryId'], $task['sortOrder']);
        $this->saveItem($projectId, 'tasks', $task);
        $this->reassignAttachments($projectId, 'entries', $entryId, 'tasks', $taskId);
        $this->deleteItem($projectId, 'entries', $entryId);
        return $task;
    }

    private function getBase(string $id): array
    {
        if (!$this->exists($id)) {
            throw new HttpError(404, 'Projekt nicht gefunden.');
        }
        return readJsonFile($this->projectPath($id));
    }

    private function collection(string $projectId, string $collection): array
    {
        $this->assertCollection($collection);
        $items = [];
        foreach (glob($this->projectDirectory($projectId) . '/' . $collection . '/*.json') ?: [] as $path) {
            $item = readJsonFile($path);
            if ($item) {
                $items[] = $item;
            }
        }
        usort($items, static function (array $left, array $right): int {
            $leftOrder = isset($left['sortOrder']) ? (int) $left['sortOrder'] : PHP_INT_MAX;
            $rightOrder = isset($right['sortOrder']) ? (int) $right['sortOrder'] : PHP_INT_MAX;
            return $leftOrder <=> $rightOrder ?: strcmp((string) ($right['date'] ?? $right['createdAt'] ?? ''), (string) ($left['date'] ?? $left['createdAt'] ?? ''));
        });
        return $items;
    }

    private function item(string $projectId, string $collection, string $itemId): array
    {
        $this->assertCollection($collection);
        if (!$this->exists($projectId) || !validId($itemId)) {
            throw new HttpError(404, 'Eintrag nicht gefunden.');
        }
        $path = $this->itemBase($projectId, $collection, $itemId) . '.json';
        if (!is_file($path)) {
            throw new HttpError(404, 'Eintrag nicht gefunden.');
        }
        return readJsonFile($path);
    }

    private function saveProject(array $project): void
    {
        $id = (string) $project['id'];
        writeJsonFile($this->projectPath($id), $project);
        $markdown = frontmatter([
            'format' => 'logbuch-project',
            'version' => 1,
            'id' => $id,
            'title' => $project['title'] ?? '',
            'status' => $project['status'] ?? 'active',
            'priority' => $project['priority'] ?? 'Mittel',
            'flagged' => $project['flagged'] ?? false,
            'icon' => $project['icon'] ?? 'box',
            'iconInherited' => $project['iconInherited'] ?? (($project['icon'] ?? 'box') === 'box'),
            'createdAt' => $project['createdAt'] ?? '',
            'dueDate' => $project['dueDate'] ?? '',
            'deletedAt' => $project['deletedAt'] ?? null,
            'completedAt' => $project['completedAt'] ?? null,
            'tagIds' => $project['tagIds'] ?? [],
            'folderId' => $project['folderId'] ?? null,
        ]);
        $markdown .= "\n# " . ($project['title'] ?? 'Projekt') . "\n\n" . ($project['description'] ?? '') . "\n";
        atomicWrite($this->projectDirectory($id) . '/README.md', $markdown);
    }

    private function saveItem(string $projectId, string $collection, array $item): void
    {
        $this->assertCollection($collection);
        if (!$this->exists($projectId) || !validId((string) ($item['id'] ?? ''))) {
            throw new HttpError(404, 'Projekt oder Eintrag nicht gefunden.');
        }
        $base = $this->itemBase($projectId, $collection, (string) $item['id']);
        writeJsonFile($base . '.json', $item);
        atomicWrite($base . '.md', $this->itemMarkdown($collection, $item));
    }

    private function itemMarkdown(string $collection, array $item): string
    {
        $title = (string) ($item['title'] ?? $item['name'] ?? 'Eintrag');
        $body = (string) ($item['body'] ?? $item['description'] ?? $item['notes'] ?? $item['properties'] ?? '');
        $fields = ['format' => 'logbuch-' . $collection, 'version' => 1];
        foreach ($item as $key => $value) {
            if (is_scalar($value) || $value === null) {
                $fields[$key] = $value;
            }
        }
        return frontmatter($fields) . "\n# " . $title . "\n\n" . $body . "\n";
    }

    private function lastActivityAt(string $projectId, array $project): string
    {
        $latest = 0;
        foreach (['createdAt', 'updatedAt', 'completedAt'] as $field) {
            $timestamp = strtotime((string) ($project[$field] ?? ''));
            if ($timestamp !== false) $latest = max($latest, $timestamp);
        }
        $paths = [$this->projectPath($projectId), ...(glob($this->projectDirectory($projectId) . '/*/*.json') ?: [])];
        foreach ($paths as $path) {
            $timestamp = is_file($path) ? filemtime($path) : false;
            if ($timestamp !== false) $latest = max($latest, $timestamp);
        }
        return $latest > 0 ? gmdate(DATE_ATOM, $latest) : (string) ($project['createdAt'] ?? '');
    }

    private function searchResult(array $terms, string $type, array $record, string $title, string $body, string $searchText, array $project): ?array
    {
        $projectTitle = (string) ($project['title'] ?? 'Projekt');
        $titleNormalized = mb_strtolower($title, 'UTF-8');
        $projectTitleNormalized = mb_strtolower($projectTitle, 'UTF-8');
        $haystack = mb_strtolower(implode(' ', [$title, $body, $searchText, $projectTitle]), 'UTF-8');
        foreach ($terms as $term) {
            if (!str_contains($haystack, $term)) return null;
        }
        $score = $type === 'project' ? 8 : 0;
        foreach ($terms as $term) {
            if ($titleNormalized === $term) $score += 120;
            elseif (str_starts_with($titleNormalized, $term)) $score += 70;
            elseif (str_contains($titleNormalized, $term)) $score += 45;
            if ($projectTitleNormalized === $term) $score += 35;
            elseif (str_contains($projectTitleNormalized, $term)) $score += 18;
            $score += min(12, substr_count($haystack, $term) * 3);
        }
        return [
            'id' => (string) ($record['id'] ?? $project['id']),
            'type' => $type,
            'projectId' => (string) $project['id'],
            'projectTitle' => $projectTitle,
            'projectStatus' => (string) ($project['status'] ?? 'active'),
            'title' => $title,
            'excerpt' => $this->searchExcerpt($body !== '' ? $body : $searchText, $terms[0]),
            'date' => (string) ($record['date'] ?? $record['updatedAt'] ?? $record['createdAt'] ?? $record['dueDate'] ?? $project['updatedAt'] ?? $project['createdAt'] ?? ''),
            'relevance' => $score,
        ];
    }

    private function searchItemTitle(string $collection, array $item): string
    {
        $title = trim((string) ($item['title'] ?? $item['name'] ?? ''));
        if ($title !== '') return $title;
        return [
            'entries' => 'Logbucheintrag',
            'tasks' => 'Arbeitsschritt',
            'shopping' => 'Einkaufsgegenstand',
            'materials' => 'Material',
            'contacts' => 'Kontakt',
            'links' => 'Link',
            'ideas' => 'Idee',
            'learnings' => 'Erkenntnis',
            'notes' => 'Notiz',
        ][$collection] ?? 'Eintrag';
    }

    private function searchItemBody(string $collection, array $item): string
    {
        $fields = [
            'entries' => ['body', 'nextStep'],
            'tasks' => ['description', 'status', 'priority'],
            'shopping' => ['properties', 'quantity', 'retailer', 'status', 'priority', 'unitPrice', 'notes', 'url'],
            'materials' => ['quantity', 'status', 'price', 'url', 'properties'],
            'contacts' => ['role', 'company', 'email', 'phone', 'notes'],
            'links' => ['url', 'notes'],
            'ideas' => ['status', 'description'],
            'learnings' => ['description', 'futureUse'],
            'notes' => ['description'],
        ][$collection] ?? [];
        return trim(implode(' · ', array_values(array_filter(array_map(static fn(string $field): string => trim((string) ($item[$field] ?? '')), $fields)))));
    }

    private function searchExcerpt(string $text, string $term): string
    {
        $text = preg_replace('/\s+/u', ' ', trim($text)) ?? trim($text);
        if ($text === '') return '';
        $position = mb_stripos($text, $term, 0, 'UTF-8');
        $start = $position === false ? 0 : max(0, $position - 70);
        $excerpt = mb_substr($text, $start, 220, 'UTF-8');
        if ($start > 0) $excerpt = '…' . ltrim($excerpt);
        if ($start + 220 < mb_strlen($text, 'UTF-8')) $excerpt = rtrim($excerpt) . '…';
        return $excerpt;
    }

    private function summary(array $project, ?array $entries = null, ?array $tasks = null): array
    {
        $entries ??= $this->collection((string) $project['id'], 'entries');
        $tasks ??= $this->collection((string) $project['id'], 'tasks');
        usort($entries, static fn(array $left, array $right): int => strcmp((string) ($right['date'] ?? ''), (string) ($left['date'] ?? '')));
        $latest = $entries[0] ?? null;
        $nextTasks = array_slice(array_values(array_filter($tasks, static fn(array $task): bool => ($task['status'] ?? 'Offen') !== 'Erledigt')), 0, 3);
        $summary = $project;
        $summary['entryCount'] = count($entries);
        $summary['nextTaskTitles'] = array_values(array_map(static fn(array $task): string => (string) ($task['title'] ?? ''), $nextTasks));
        $summary['nextTaskTitle'] = $summary['nextTaskTitles'][0] ?? '';
        if ($latest) {
            $summary['latestEntryId'] = $latest['id'];
            $summary['latestEntryDate'] = $latest['date'] ?? '';
            $summary['latestEntryTitle'] = $latest['title'] ?? '';
            $summary['latestEntryBody'] = $latest['body'] ?? '';
            $summary['latestNextStep'] = $latest['nextStep'] ?? '';
        }
        return $summary;
    }

    private function adjustStartDate(string $projectId, string $date): void
    {
        $project = $this->getBase($projectId);
        if (!validDate((string) ($project['createdAt'] ?? '')) || $date < $project['createdAt']) {
            $project['createdAt'] = $date;
            $this->saveProject($project);
        }
    }

    private function prepareProjectDirectory(string $id): void
    {
        foreach (['', ...self::COLLECTIONS, 'attachments'] as $folder) {
            $path = $this->projectDirectory($id) . ($folder === '' ? '' : '/' . $folder);
            if (!is_dir($path) && !mkdir($path, 0770, true) && !is_dir($path)) {
                throw new HttpError(507, 'Projektverzeichnis konnte nicht angelegt werden.');
            }
        }
    }

    private function validTagIds(mixed $ids): array
    {
        if (!is_array($ids) || count($ids) > 20) {
            throw new HttpError(422, 'Ungültige Tag-Auswahl.');
        }
        $valid = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !validId($id)) {
                throw new HttpError(422, 'Ungültige Tag-Auswahl.');
            }
            if (!in_array($id, $valid, true)) {
                $valid[] = $id;
            }
        }
        return $valid;
    }

    private function normalizeItemInput(string $collection, array $input, bool $partial = false): array
    {
        $definitions = [
            'tasks' => ['title' => 160, 'description' => 10000, 'status' => 20, 'priority' => 20, 'dueDate' => 10],
            'shopping' => ['name' => 160, 'properties' => 10000, 'quantity' => 100, 'retailer' => 160, 'url' => 2048, 'status' => 20, 'priority' => 20, 'unitPrice' => 100, 'notes' => 10000],
            'materials' => ['name' => 160, 'quantity' => 100, 'status' => 40, 'price' => 100, 'url' => 2048, 'properties' => 10000],
            'contacts' => ['name' => 160, 'role' => 160, 'company' => 160, 'email' => 254, 'phone' => 100, 'notes' => 10000],
            'links' => ['title' => 160, 'url' => 2048, 'notes' => 10000],
            'ideas' => ['title' => 160, 'status' => 20, 'description' => 10000],
            'learnings' => ['title' => 160, 'description' => 10000, 'futureUse' => 10000],
            'notes' => ['title' => 160, 'description' => 50000],
        ];
        if (!isset($definitions[$collection])) {
            throw new HttpError(404, 'Bereich nicht gefunden.');
        }

        $result = [];
        foreach ($definitions[$collection] as $field => $maxLength) {
            if (!array_key_exists($field, $input)) {
                continue;
            }
            if (!is_scalar($input[$field]) && $input[$field] !== null) {
                throw new HttpError(422, 'Ungültiger Feldwert.');
            }
            $result[$field] = mb_substr(trim((string) ($input[$field] ?? '')), 0, $maxLength);
        }

        $required = in_array($collection, ['shopping', 'materials', 'contacts'], true) ? 'name' : 'title';
        if ((!$partial || array_key_exists($required, $input)) && ($result[$required] ?? '') === '') {
            throw new HttpError(422, 'Eine Bezeichnung ist erforderlich.');
        }
        if ($collection === 'tasks') {
            if (array_key_exists('flagged', $input)) {
                if (!is_bool($input['flagged'])) throw new HttpError(422, 'Ungültige Arbeitsschrittmarkierung.');
                $result['flagged'] = $input['flagged'];
            } elseif (!$partial) {
                $result['flagged'] = false;
            }
            $result['status'] ??= $partial ? null : 'Offen';
            $result['priority'] ??= $partial ? null : 'Normal';
            $result['dueDate'] ??= $partial ? null : '';
            foreach (['status', 'priority', 'dueDate'] as $field) {
                if ($partial && $result[$field] === null) unset($result[$field]);
            }
            if (isset($result['status']) && !in_array($result['status'], ['Offen', 'In Arbeit'], true)) throw new HttpError(422, 'Ungültiger Arbeitsschrittstatus.');
            if (isset($result['priority']) && !in_array($result['priority'], ['Normal', 'Hoch', 'Niedrig'], true)) throw new HttpError(422, 'Ungültige Arbeitsschrittpriorität.');
            if (isset($result['dueDate']) && $result['dueDate'] !== '' && !validDate($result['dueDate'])) throw new HttpError(422, 'Ungültige Fälligkeit des Arbeitsschritts.');
        }
        if ($collection === 'ideas' && isset($result['status']) && !in_array($result['status'], ['Offen', 'Prüfen', 'Umgesetzt', 'Verworfen'], true)) {
            throw new HttpError(422, 'Ungültiger Ideenstatus.');
        }
        if ($collection === 'shopping') {
            if (!$partial) {
                $result['status'] ??= 'Benötigt';
                $result['priority'] ??= 'Normal';
            }
            if (isset($result['status']) && !in_array($result['status'], ['Benötigt', 'Bestellt', 'Gekauft'], true)) {
                throw new HttpError(422, 'Ungültiger Einkaufsstatus.');
            }
            if (isset($result['priority']) && !in_array($result['priority'], ['Normal', 'Hoch', 'Niedrig'], true)) {
                throw new HttpError(422, 'Ungültige Einkaufspriorität.');
            }
        }
        if (isset($result['url']) && $result['url'] !== '') {
            $scheme = strtolower((string) parse_url($result['url'], PHP_URL_SCHEME));
            if (!filter_var($result['url'], FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
                throw new HttpError(422, 'Ungültige Webadresse.');
            }
        }
        if (isset($result['email']) && $result['email'] !== '' && !filter_var($result['email'], FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Ungültige E-Mail-Adresse.');
        }
        return $result;
    }

    private function normalizeEntryChanges(array $input): array
    {
        $result = [];
        foreach (['title' => 160, 'body' => 50000, 'nextStep' => 10000] as $field => $maxLength) {
            if (!array_key_exists($field, $input)) continue;
            if (!is_scalar($input[$field]) && $input[$field] !== null) throw new HttpError(422, 'Ungültiger Feldwert.');
            $result[$field] = mb_substr((string) ($input[$field] ?? ''), 0, $maxLength);
        }
        if (array_key_exists('date', $input)) {
            if (!is_string($input['date']) || !validDate($input['date'])) throw new HttpError(422, 'Ein gültiges Eintragsdatum ist erforderlich.');
            $result['date'] = $input['date'];
        }
        return $result;
    }

    private function validFolderId(mixed $id): ?string
    {
        $value = trim((string) ($id ?? ''));
        if ($value === '') return null;
        if (!validId($value)) throw new HttpError(422, 'Ungültiger Projektordner.');
        return $value;
    }

    private function validPriority(mixed $value): string
    {
        $priority = trim((string) $value);
        if (!in_array($priority, ['Hoch', 'Mittel', 'Gering'], true)) {
            throw new HttpError(422, 'Ungültige Projektpriorität.');
        }
        return $priority;
    }

    private function validFlag(mixed $value): bool
    {
        if (!is_bool($value)) {
            throw new HttpError(422, 'Ungültige Projektmarkierung.');
        }
        return $value;
    }

    private function validIcon(mixed $value): string
    {
        $icon = trim((string) $value);
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $icon)) throw new HttpError(422, 'Ungültiges Projektsymbol.');
        return $icon;
    }

    private function assertCollection(string $collection): void
    {
        if (!in_array($collection, self::COLLECTIONS, true)) {
            throw new HttpError(404, 'Bereich nicht gefunden.');
        }
    }

    private function attachment(string $projectId, string $fileId): array
    {
        if (!$this->exists($projectId) || !validId($fileId)) throw new HttpError(404, 'Datei nicht gefunden.');
        $path = $this->attachmentDirectory($projectId, $fileId) . '/metadata.json';
        if (!is_file($path)) throw new HttpError(404, 'Datei nicht gefunden.');
        return readJsonFile($path);
    }

    private function normalizeAttachmentAssociation(string $projectId, array $input): ?array
    {
        $collection = trim((string) ($input['associationCollection'] ?? ''));
        $itemId = trim((string) ($input['associationItemId'] ?? ''));
        if ($collection === '' && $itemId === '') return null;
        if (!in_array($collection, self::COLLECTIONS, true) || $itemId === '') throw new HttpError(422, 'Ungültige Dateizuordnung.');
        $this->item($projectId, $collection, $itemId);
        return ['collection' => $collection, 'itemId' => $itemId];
    }

    private function attachmentText(mixed $value, int $maximum, string $fallback = ''): string
    {
        if (!is_scalar($value) && $value !== null) throw new HttpError(422, 'Ungültige Dateimetadaten.');
        $text = mb_substr(trim((string) ($value ?? '')), 0, $maximum);
        return $text !== '' ? $text : $fallback;
    }

    private function attachmentTimestamp(mixed $value, string $label): string
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $value) || strtotime($value) === false) {
            throw new HttpError(422, 'Ungültiger ' . $label . ' im Backup.');
        }
        return $value;
    }

    private function generateAttachmentThumbnail(string $directory, string $mimeType): void
    {
        if (!str_starts_with($mimeType, 'image/') || !function_exists('imagecreatefromstring')) return;
        $sourcePath = $directory . '/original.bin';
        $dimensions = @getimagesize($sourcePath);
        if (!$dimensions || $dimensions[0] < 1 || $dimensions[1] < 1 || $dimensions[0] * $dimensions[1] > 40_000_000) return;
        $sourceData = @file_get_contents($sourcePath);
        $source = $sourceData === false ? false : @imagecreatefromstring($sourceData);
        if ($source === false) return;
        $scale = min(480 / $dimensions[0], 320 / $dimensions[1], 1);
        $width = max(1, (int) round($dimensions[0] * $scale));
        $height = max(1, (int) round($dimensions[1] * $scale));
        $target = imagecreatetruecolor($width, $height);
        if ($target === false) return;
        $white = imagecolorallocate($target, 255, 255, 255);
        imagefill($target, 0, 0, $white);
        imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $dimensions[0], $dimensions[1]);
        @imagejpeg($target, $directory . '/thumbnail.jpg', 82);
    }

    private function reassignAttachments(string $projectId, string $fromCollection, string $fromItemId, string $toCollection, string $toItemId): void
    {
        foreach ($this->attachments($projectId) as $file) {
            if (($file['association']['collection'] ?? null) !== $fromCollection || ($file['association']['itemId'] ?? null) !== $fromItemId) continue;
            $file['association'] = ['collection' => $toCollection, 'itemId' => $toItemId];
            $file['updatedAt'] = nowIso();
            writeJsonFile($this->attachmentDirectory($projectId, (string) $file['id']) . '/metadata.json', $file);
        }
    }

    private function attachmentsDirectory(string $projectId): string
    {
        return $this->projectDirectory($projectId) . '/attachments';
    }

    private function attachmentDirectory(string $projectId, string $fileId): string
    {
        if (!validId($fileId)) throw new HttpError(404, 'Datei nicht gefunden.');
        return $this->attachmentsDirectory($projectId) . '/' . $fileId;
    }

    private function projectDirectory(string $id): string
    {
        if (!validId($id)) {
            throw new HttpError(404, 'Projekt nicht gefunden.');
        }
        return $this->root . '/' . $id;
    }

    private function projectPath(string $id): string
    {
        return $this->projectDirectory($id) . '/project.json';
    }

    private function itemBase(string $projectId, string $collection, string $itemId): string
    {
        if (!validId($itemId)) {
            throw new HttpError(404, 'Eintrag nicht gefunden.');
        }
        return $this->projectDirectory($projectId) . '/' . $collection . '/' . $itemId;
    }
}
