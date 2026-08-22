<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class Application
{
    private const MAX_JSON_BYTES = 31_457_280;

    private readonly PDO $db;
    private readonly Auth $auth;
    private readonly ProjectStore $projects;
    private readonly FolderStore $folders;
    private readonly UpdateService $updates;

    public function __construct(private readonly string $storagePath)
    {
        $database = new Database($storagePath . '/database.sqlite');
        $this->db = $database->pdo();
        $this->auth = new Auth($this->db);
        $this->projects = new ProjectStore($storagePath . '/projects');
        $this->folders = new FolderStore($this->db);
        $this->updates = new UpdateService($storagePath, \logbuch_root_path(), $this->db, (string) (getenv('LOGBUCH_PLATFORM') ?: 'webhosting'));
    }

    public function installed(): bool
    {
        return (int) $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
    }

    public function install(array $input): array
    {
        $siteName = trim((string) ($input['siteName'] ?? 'Logbuch'));
        if (mb_strlen($siteName) < 2 || mb_strlen($siteName) > 80) {
            throw new HttpError(422, 'Der Name muss 2–80 Zeichen lang sein.');
        }
        $timezone = (string) ($input['timezone'] ?? 'Europe/Berlin');
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            throw new HttpError(422, 'Ungültige Zeitzone.');
        }
        $withDemoData = ($input['demoData'] ?? false) === true;
        $demo = $withDemoData ? $this->demoManifest() : null;
        $this->db->exec('BEGIN IMMEDIATE');
        $transactionActive = true;
        try {
            if ($this->installed()) {
                throw new HttpError(409, 'Das Logbuch ist bereits eingerichtet.');
            }
            $this->auth->createAdmin((string) ($input['adminUser'] ?? ''), (string) ($input['adminPassword'] ?? ''));
            $this->setSetting('general', ['siteName' => $siteName, 'timezone' => $timezone, 'baseUrl' => $this->detectedBaseUrl()]);
            if ($demo !== null) {
                $this->installDemoData((string) $input['adminUser'], $demo);
            }
            $this->audit((string) $input['adminUser'], 'system.installed', $siteName);
            // A transaction started with raw SQLite SQL is not reported by
            // PDO::inTransaction() on every supported PHP 8.2 build.
            $this->db->exec('COMMIT');
            $transactionActive = false;
        } catch (\Throwable $error) {
            if ($transactionActive) {
                try {
                    $this->db->exec('ROLLBACK');
                } catch (\Throwable) {
                }
            }
            throw $error;
        }
        return ['installed' => true, 'loginUrl' => '/'];
    }

    public function handle(string $method, string $path): never
    {
        try {
            $input = $this->jsonBody();
            if ($path === '/api/install/status' && $method === 'GET') {
                $this->json(200, $this->requirements());
            }
            if ($path === '/api/install' && $method === 'POST') {
                $this->json(201, $this->install($input));
            }
            if (!$this->installed()) {
                throw new HttpError(503, 'Das Logbuch muss zuerst eingerichtet werden.');
            }
            if ($path === '/api/login' && $method === 'POST') {
                $user = $this->auth->login((string) ($input['user'] ?? ''), (string) ($input['password'] ?? ''), $this->clientIp(), (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
                $this->json(200, $this->withCsrf($user));
            }
            if ($path === '/api/logout' && $method === 'POST') {
                $this->verifyCsrf();
                $this->auth->logout();
                $this->empty(204);
            }

            $allowPasswordChangeOnly = $path === '/api/account/password' || $path === '/api/me';
            $touchSession = $path === '/api/me' || !in_array($method, ['GET', 'HEAD'], true);
            $user = $this->auth->requireUser(false, $allowPasswordChangeOnly, $touchSession);
            if (!in_array($method, ['GET', 'HEAD'], true)) {
                $this->verifyCsrf();
            }

            if ($path === '/api/me' && $method === 'GET') {
                $this->json(200, $this->withCsrf($user));
            }
            if ($path === '/api/account/password' && $method === 'POST') {
                $this->auth->changePassword($user, (string) ($input['currentPassword'] ?? ''), (string) ($input['newPassword'] ?? ''));
                $this->audit($user['id'], 'password.changed', $user['id']);
                $this->empty(204);
            }
            if ($user['mustChangePassword']) {
                throw new HttpError(428, 'Passwortänderung erforderlich.');
            }
            if ($path === '/api/account/preferences' && $method === 'PATCH') {
                $this->json(200, $this->updatePreferences($user, $input));
            }
            if ($path === '/api/system' && $method === 'GET') {
                $this->json(200, $this->systemStatus());
            }
            if ($path === '/api/update/status' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->updates->status(false));
            }
            if ($path === '/api/update/check' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->updates->status(true));
            }
            if ($path === '/api/update/install' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->auth->verifyPassword($user, (string) ($input['password'] ?? ''));
                $result = $this->updates->install($user['id']);
                $this->audit($user['id'], 'system.update_requested', (string) ($result['version'] ?? ''), 'platform=' . ($result['platform'] ?? ''));
                $this->json(202, $result);
            }

            if ($path === '/api/projects' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible]);
            }
            if ($path === '/api/project-browser' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible, 'tags' => $this->tagsFor($user, $visible), 'folders' => $this->visibleFolders($user, $visible)]);
            }
            if ($path === '/api/overview' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->overview(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $completed = array_values(array_filter($this->projects->completedProjects(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible, 'completedProjects' => $completed]);
            }
            if ($path === '/api/projects' && $method === 'POST') {
                $this->requireEditor($user);
                $this->assertFolderInput($user, $input);
                $project = $this->projects->create($input, $user['id']);
                if (!$user['admin'] && $user['projectAccessMode'] === 'include') {
                    $this->setUserProject($user['id'], $project['id'], true);
                }
                $this->audit($user['id'], 'project.created', $project['id']);
                $this->json(201, $project);
            }

            if ($path === '/api/folders' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['folders' => $this->visibleFolders($user, $visible)]);
            }
            if ($path === '/api/folders' && $method === 'POST') {
                $this->requireEditor($user);
                $this->assertParentFolderAccess($user, $input);
                $folder = $this->folders->create($input, $user['id']);
                $this->audit($user['id'], 'folder.created', $folder['id']);
                $this->json(201, $folder);
            }
            if (preg_match('#^/api/folders/([^/]+)$#', $path, $match)) {
                $this->requireEditor($user);
                $folderId = rawurldecode($match[1]);
                $this->requireFolderAccess($user, $folderId);
                if ($method === 'PATCH') {
                    $this->assertParentFolderAccess($user, $input);
                    $folder = $this->folders->update($folderId, $input);
                    $this->audit($user['id'], 'folder.updated', $folderId);
                    $this->json(200, $folder);
                }
                if ($method === 'DELETE') {
                    $this->folders->delete($folderId, $this->projects->list());
                    $this->audit($user['id'], 'folder.deleted', $folderId);
                    $this->empty(204);
                }
            }
            if ($path === '/api/projects/trash' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $removed = $this->projects->emptyTrash();
                $this->audit($user['id'], 'trash.emptied', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }

            if (preg_match('#^/api/project-view/([^/]+)$#', $path, $match) && $method === 'GET') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectAccess($user, $projectId);
                $project = $this->projects->get($projectId);
                $project['accessUsers'] = $this->projectUsers($projectId);
                $visible = array_values(array_filter($this->projects->list(), fn(array $candidate): bool => $this->canAccess($user, $candidate['id'])));
                $this->json(200, ['project' => $project, 'tags' => $this->tagsFor($user, $visible), 'folders' => $this->visibleFolders($user, $visible)]);
            }

            if (preg_match('#^/api/projects/([^/]+)/permanent$#', $path, $match) && $method === 'DELETE') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectEdit($user, $projectId);
                $this->projects->purge($projectId);
                $this->audit($user['id'], 'project.deleted', $projectId);
                $this->empty(204);
            }
            if (preg_match('#^/api/projects/([^/]+)$#', $path, $match)) {
                $projectId = rawurldecode($match[1]);
                if ($method === 'GET') {
                    $this->requireProjectAccess($user, $projectId);
                    $project = $this->projects->get($projectId);
                    $project['accessUsers'] = $this->projectUsers($projectId);
                    $this->json(200, $project);
                }
                $this->requireProjectEdit($user, $projectId);
                if ($method === 'PATCH') {
                    $this->assertFolderInput($user, $input);
                    $project = $this->projects->update($projectId, $input);
                    $this->audit($user['id'], 'project.updated', $projectId);
                    $this->json(200, $project);
                }
                if ($method === 'DELETE') {
                    $project = $this->projects->trash($projectId);
                    $this->audit($user['id'], 'project.trashed', $projectId);
                    $this->json(200, $project);
                }
            }

            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|materials|contacts|links|ideas|learnings|notes)/reorder$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $this->requireProjectEdit($user, $projectId);
                $ids = $input['ids'] ?? null;
                if (!is_array($ids)) {
                    throw new HttpError(422, 'Ungültige Reihenfolge.');
                }
                $this->projects->reorder($projectId, $collection, $ids);
                $this->audit($user['id'], $collection === 'entries' ? 'logs.reordered' : $collection . '.reordered', $projectId, 'count=' . count($ids));
                $this->json(200, ['ok' => true]);
            }
            if (preg_match('#^/api/projects/([^/]+)/tasks/([^/]+)/complete$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $taskId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                $entry = $this->projects->completeTask($projectId, $taskId, (string) ($input['date'] ?? ''), $user['id']);
                $this->audit($user['id'], 'log.created', $projectId . ' · ' . ($entry['title'] ?? $entry['id']), 'entryId=' . $entry['id']);
                $this->json(201, $entry);
            }
            if (preg_match('#^/api/projects/([^/]+)/entries/([^/]+)/reopen$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $entryId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                $task = $this->projects->reopenEntry($projectId, $entryId, $user['id']);
                $this->audit($user['id'], 'log.reopened', $projectId . ' · ' . $entryId, 'taskId=' . $task['id']);
                $this->json(200, $task);
            }
            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|materials|contacts|links|ideas|learnings|notes)$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $this->requireProjectEdit($user, $projectId);
                $item = $this->projects->createItem($projectId, $collection, $input, $user['id']);
                if ($collection === 'entries') {
                    $this->audit($user['id'], 'log.created', $projectId . ' · ' . ($item['title'] ?: $item['id']), 'entryId=' . $item['id'] . ', date=' . $item['date']);
                }
                $this->json(201, $item);
            }
            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|materials|contacts|links|ideas|learnings|notes)/([^/]+)$#', $path, $match)) {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $itemId = rawurldecode($match[3]);
                $this->requireProjectEdit($user, $projectId);
                if ($method === 'PATCH') {
                    $item = $this->projects->updateItem($projectId, $collection, $itemId, $input);
                    if ($collection === 'entries') {
                        $this->audit($user['id'], 'log.updated', $projectId . ' · ' . ($item['title'] ?: $itemId), 'entryId=' . $itemId);
                    }
                    $this->json(200, $item);
                }
                if ($method === 'DELETE') {
                    $item = $this->projects->deleteItem($projectId, $collection, $itemId);
                    if ($collection === 'entries') {
                        $this->audit($user['id'], 'log.deleted', $projectId . ' · ' . ($item['title'] ?: $itemId), 'entryId=' . $itemId);
                    }
                    $this->empty(204);
                }
            }

            if ($path === '/api/tags' && $method === 'GET') {
                $this->json(200, ['tags' => $this->tagsFor($user)]);
            }
            if ($path === '/api/tags' && $method === 'POST') {
                $this->requireEditor($user);
                $this->json(201, $this->createTag($user, (string) ($input['name'] ?? '')));
            }
            if (preg_match('#^/api/tags/([^/]+)/merge$#', $path, $match) && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->mergeTag($user, rawurldecode($match[1]), (string) ($input['targetId'] ?? '')));
            }
            if (preg_match('#^/api/tags/([^/]+)$#', $path, $match)) {
                $this->requireAdmin($user);
                $tagId = rawurldecode($match[1]);
                if ($method === 'PATCH') {
                    $this->json(200, $this->updateTag($user, $tagId, $input));
                }
                if ($method === 'DELETE') {
                    $this->deleteTag($user, $tagId, (bool) ($input['removeFromProjects'] ?? false));
                    $this->empty(204);
                }
            }

            if ($path === '/api/users' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['users' => $this->listUsers()]);
            }
            if ($path === '/api/users' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(201, $this->createUser($user, $input));
            }
            if (preg_match('#^/api/users/([^/]+)$#', $path, $match)) {
                $this->requireAdmin($user);
                $userId = rawurldecode($match[1]);
                if ($method === 'PATCH') {
                    $this->json(200, $this->updateUser($user, $userId, $input));
                }
                if ($method === 'DELETE') {
                    $this->deleteUser($user, $userId);
                    $this->empty(204);
                }
            }
            if ($path === '/api/sessions' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['sessions' => $this->sessions($user)]);
            }
            if (preg_match('#^/api/sessions/([^/]+)$#', $path, $match) && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->revokeSession($user, rawurldecode($match[1]));
                $this->empty(204);
            }
            if ($path === '/api/audit' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['events' => $this->auditEvents()]);
            }

            if (in_array($path, ['/api/settings/server', '/api/settings/device'], true) && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->serverSettings());
            }
            if (in_array($path, ['/api/settings/server', '/api/settings/device'], true) && $method === 'PATCH') {
                $this->requireAdmin($user);
                $this->json(200, $this->updateServerSettings($user, $input));
            }
            if ($path === '/api/backup/users' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['accounts' => $this->exportUsers()]);
            }
            if ($path === '/api/import/users' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->importUsers($user, $input));
            }
            if ($path === '/api/import/project' && $method === 'POST') {
                $this->requireAdmin($user);
                $result = $this->projects->saveImported((array) ($input['project'] ?? []), (bool) ($input['replace'] ?? false));
                $this->importTagDefinitions((array) ($input['tags'] ?? []));
                foreach ((array) ($input['accessUsers'] ?? []) as $accessUser) {
                    if (is_string($accessUser)) {
                        $this->setUserProject($accessUser, $result['id'], true);
                    }
                }
                $this->audit($user['id'], 'data.project_imported', $result['id']);
                $this->json($result['skipped'] ? 200 : 201, $result);
            }
            if ($path === '/api/demo' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->installDemoData($user['id']));
            }
            if ($path === '/api/demo' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->json(200, $this->removeDemoData($user['id']));
            }
            if ($path === '/api/system/content' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $removed = $this->projects->clear();
                $this->db->exec('DELETE FROM tags');
                $this->db->exec('DELETE FROM folders');
                $this->db->exec('DELETE FROM user_projects');
                $this->audit($user['id'], 'system.content_cleared', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }
            if ($path === '/api/system/users' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $removed = $this->clearUsersExcept($user['id']);
                $this->audit($user['id'], 'system.users_cleared', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }

            throw new HttpError(404, 'API-Endpunkt nicht gefunden.');
        } catch (HttpError $error) {
            $this->json($error->status, ['error' => $error->getMessage()]);
        } catch (\Throwable $error) {
            error_log((string) $error);
            $this->json(500, ['error' => 'Interner Serverfehler.']);
        }
    }

    public function requirements(): array
    {
        $checks = [
            'php' => version_compare(PHP_VERSION, '8.2.0', '>='),
            'pdoSqlite' => extension_loaded('pdo_sqlite'),
            'json' => extension_loaded('json'),
            'mbstring' => extension_loaded('mbstring'),
            'openssl' => extension_loaded('openssl'),
            'writableStorage' => is_writable($this->storagePath),
        ];
        return ['installed' => $this->installed(), 'ready' => !in_array(false, $checks, true), 'checks' => $checks, 'phpVersion' => PHP_VERSION];
    }

    private function jsonBody(): array
    {
        $declaredLength = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
        if ($declaredLength !== false && $declaredLength > self::MAX_JSON_BYTES) {
            throw new HttpError(413, 'Die Anfrage ist zu groß.');
        }
        $content = file_get_contents('php://input');
        if ($content === false || trim($content) === '') {
            return [];
        }
        if (strlen($content) > self::MAX_JSON_BYTES) {
            throw new HttpError(413, 'Die Anfrage ist zu groß.');
        }
        $decoded = json_decode($content, true);
        if (!is_array($decoded)) {
            throw new HttpError(400, 'Ungültige JSON-Anfrage.');
        }
        return $decoded;
    }

    private function assertFolderInput(array $user, array $input): void
    {
        if (!array_key_exists('folderId', $input) || $input['folderId'] === null || trim((string) $input['folderId']) === '') return;
        $folderId = (string) $input['folderId'];
        if (!$this->folders->exists($folderId)) {
            throw new HttpError(422, 'Der ausgewählte Projektordner wurde nicht gefunden.');
        }
        $this->requireFolderAccess($user, $folderId);
    }

    private function assertParentFolderAccess(array $user, array $input): void
    {
        $parentId = trim((string) ($input['parentId'] ?? ''));
        if ($parentId !== '') $this->requireFolderAccess($user, $parentId);
    }

    private function requireFolderAccess(array $user, string $folderId): void
    {
        $projects = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
        if (!in_array($folderId, array_column($this->visibleFolders($user, $projects), 'id'), true)) {
            throw new HttpError(403, 'Kein Zugriff auf diesen Projektordner.');
        }
    }

    private function json(int $status, array $data): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    private function empty(int $status): never
    {
        http_response_code($status);
        header('Cache-Control: no-store');
        exit;
    }

    private function withCsrf(array $user): array
    {
        $user['csrfToken'] = $this->csrfToken();
        return $user;
    }

    private function csrfToken(): string
    {
        $cookie = (string) ($_COOKIE['logbuch_session'] ?? '');
        return hash_hmac('sha256', 'logbuch-csrf-v1', $cookie);
    }

    private function verifyCsrf(): void
    {
        $provided = (string) ($_SERVER['HTTP_X_LOGBUCH_CSRF'] ?? '');
        if ($provided === '' || !hash_equals($this->csrfToken(), $provided)) {
            throw new HttpError(403, 'Ungültiger CSRF-Schutz. Bitte die Seite neu laden.');
        }
    }

    private function requireAdmin(array $user): void
    {
        if (!$user['admin']) {
            throw new HttpError(403, 'Administratorrechte erforderlich.');
        }
    }

    private function requireEditor(array $user): void
    {
        if (!$user['admin'] && $user['role'] !== 'editor') {
            throw new HttpError(403, 'Bearbeitungsrechte erforderlich.');
        }
    }

    private function canAccess(array $user, string $projectId): bool
    {
        if ($user['admin'] || $user['projectAccessMode'] === 'all') {
            return true;
        }
        $statement = $this->db->prepare('SELECT 1 FROM user_projects WHERE user_id = :user AND project_id = :project');
        $statement->execute(['user' => $user['id'], 'project' => $projectId]);
        $listed = (bool) $statement->fetchColumn();
        return $user['projectAccessMode'] === 'exclude' ? !$listed : $listed;
    }

    private function requireProjectAccess(array $user, string $projectId): void
    {
        if (!$this->projects->exists($projectId)) {
            throw new HttpError(404, 'Projekt nicht gefunden.');
        }
        if (!$this->canAccess($user, $projectId)) {
            throw new HttpError(403, 'Kein Zugriff auf dieses Projekt.');
        }
    }

    private function requireProjectEdit(array $user, string $projectId): void
    {
        $this->requireProjectAccess($user, $projectId);
        $this->requireEditor($user);
    }

    private function visibleFolders(array $user, array $projects): array
    {
        $folders = $this->folders->list();
        if ($user['admin'] || $user['projectAccessMode'] === 'all') {
            return $folders;
        }
        $byId = array_column($folders, null, 'id');
        $visibleIds = [];
        foreach ($folders as $folder) {
            if (($folder['createdBy'] ?? '') === $user['id']) {
                $folderId = (string) $folder['id'];
                while ($folderId !== '' && isset($byId[$folderId]) && !isset($visibleIds[$folderId])) {
                    $visibleIds[$folderId] = true;
                    $folderId = (string) ($byId[$folderId]['parentId'] ?? '');
                }
            }
        }
        foreach ($projects as $project) {
            $folderId = (string) ($project['folderId'] ?? '');
            while ($folderId !== '' && isset($byId[$folderId]) && !isset($visibleIds[$folderId])) {
                $visibleIds[$folderId] = true;
                $folderId = (string) ($byId[$folderId]['parentId'] ?? '');
            }
        }
        return array_values(array_filter($folders, static fn(array $folder): bool => isset($visibleIds[$folder['id']])));
    }

    private function updatePreferences(array $user, array $input): array
    {
        $allowed = ['home', 'projects', 'archive'];
        if (isset($input['startPage']) && !in_array($input['startPage'], $allowed, true)) {
            throw new HttpError(422, 'Ungültige Startseite.');
        }
        $projectSorts = ['status:asc', 'priority:desc', 'priority:asc', 'dueDate:asc', 'dueDate:desc', 'createdAt:desc', 'createdAt:asc', 'latestEntryDate:desc', 'latestEntryDate:asc', 'title:asc', 'title:desc'];
        $archiveSorts = array_values(array_filter($projectSorts, static fn(string $sort): bool => $sort !== 'status:asc'));
        if (isset($input['projectSort']) && !in_array($input['projectSort'], $projectSorts, true)) {
            throw new HttpError(422, 'Ungültige Standardsortierung für Projekte.');
        }
        if (isset($input['archiveSort']) && !in_array($input['archiveSort'], $archiveSorts, true)) {
            throw new HttpError(422, 'Ungültige Standardsortierung für das Archiv.');
        }
        if (isset($input['defaultProjectIcon']) && (!is_string($input['defaultProjectIcon']) || !preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $input['defaultProjectIcon']))) {
            throw new HttpError(422, 'Ungültiges Standard-Projektsymbol.');
        }
        foreach (['showProjectFolders', 'showOverviewSummary', 'showOverviewRecent', 'showOverviewNext', 'showOverviewRecentlyEdited', 'showOverviewMarked', 'showOverviewDueSoon', 'showOverviewHighPriority', 'showOverviewActivity', 'showOverviewTimeline'] as $flag) {
            if (array_key_exists($flag, $input) && !is_bool($input[$flag])) {
                throw new HttpError(422, 'Ungültige Übersichts-Einstellung.');
            }
        }
        foreach (['overviewRecentRows', 'overviewNextRows', 'overviewRecentlyEditedRows', 'overviewMarkedRows', 'overviewDueSoonRows', 'overviewHighPriorityRows'] as $rowSetting) {
            if (isset($input[$rowSetting]) && (!is_int($input[$rowSetting]) || $input[$rowSetting] < 1 || $input[$rowSetting] > 6)) {
                throw new HttpError(422, 'Es können 1–6 Zeilen angezeigt werden.');
            }
        }
        if (array_key_exists('overviewOrder', $input)) {
            $allowedSections = ['summary', 'recentlyEdited', 'marked', 'dueSoon', 'highPriority', 'next', 'recent', 'activity', 'timeline'];
            $order = $input['overviewOrder'];
            if (!is_array($order) || count($order) !== count($allowedSections) || count(array_filter($order, 'is_string')) !== count($allowedSections) || count(array_unique($order)) !== count($allowedSections) || array_diff($order, $allowedSections)) {
                throw new HttpError(422, 'Ungültige Reihenfolge der Übersichtsbereiche.');
            }
        }
        $statement = $this->db->prepare('SELECT preferences_json FROM users WHERE id = :id');
        $statement->execute(['id' => $user['id']]);
        $preferences = array_replace($this->auth->defaultPreferences(), json_decode((string) $statement->fetchColumn(), true) ?: []);
        foreach (array_keys($this->auth->defaultPreferences()) as $key) {
            if (array_key_exists($key, $input)) {
                $preferences[$key] = $input[$key];
            }
        }
        $this->db->prepare('UPDATE users SET preferences_json = :preferences WHERE id = :id')->execute(['preferences' => json_encode($preferences), 'id' => $user['id']]);
        return $preferences;
    }

    private function systemStatus(): array
    {
        $general = $this->getSetting('general', []);
        $projects = $this->projects->list();
        $demoManifest = $this->demoManifest();
        $demoIds = array_column($demoManifest['projects'], 'id');
        $demoProjectCount = count(array_filter($projects, static fn(array $project): bool => in_array($project['id'], $demoIds, true)));
        $demoFolderIds = array_column($demoManifest['folders'], 'id');
        $demoFolderCount = count(array_filter($this->folders->list(), static fn(array $folder): bool => in_array($folder['id'], $demoFolderIds, true)));
        $totalBytes = $this->directorySize($this->storagePath);
        return [
            'hostname' => parse_url($this->detectedBaseUrl(), PHP_URL_HOST) ?: ($_SERVER['HTTP_HOST'] ?? 'localhost'),
            'baseUrl' => $general['baseUrl'] ?? $this->detectedBaseUrl(),
            'platform' => getenv('LOGBUCH_PLATFORM') ?: 'webhosting',
            'version' => \logbuch_version(),
            'phpVersion' => PHP_VERSION,
            'projectCount' => count($projects),
            'demoProjectCount' => $demoProjectCount,
            'demoFolderCount' => $demoFolderCount,
            'storageBytes' => $totalBytes,
            'storageFreeBytes' => @disk_free_space($this->storagePath) ?: 0,
            'database' => 'SQLite ' . ($this->db->query('SELECT sqlite_version()')->fetchColumn() ?: ''),
        ];
    }

    private function detectedBaseUrl(): string
    {
        $scheme = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') ? 'https' : 'http';
        $host = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost')) ?: 'localhost';
        return $scheme . '://' . $host;
    }

    private function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    private function setSetting(string $key, array $value): void
    {
        $statement = $this->db->prepare('INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        $statement->execute(['key' => $key, 'value' => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }

    private function getSetting(string $key, array $default): array
    {
        $statement = $this->db->prepare('SELECT value FROM settings WHERE key = :key');
        $statement->execute(['key' => $key]);
        $value = $statement->fetchColumn();
        $decoded = $value === false ? null : json_decode((string) $value, true);
        return is_array($decoded) ? $decoded : $default;
    }

    private function audit(string $actor, string $action, string $target = '', string $details = ''): void
    {
        $statement = $this->db->prepare('INSERT INTO audit (occurred_at, actor, action, target, details) VALUES (:at, :actor, :action, :target, :details)');
        $statement->execute(['at' => nowIso(), 'actor' => $actor, 'action' => $action, 'target' => $target, 'details' => $details]);
        $this->db->exec('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)');
    }

    private function auditEvents(): array
    {
        $rows = $this->db->query('SELECT occurred_at AS at, actor, action, target, details FROM audit ORDER BY id DESC LIMIT 500')->fetchAll();
        return $rows ?: [];
    }

    private function projectUsers(string $projectId): array
    {
        $statement = $this->db->prepare('SELECT user_id FROM user_projects WHERE project_id = :project ORDER BY user_id');
        $statement->execute(['project' => $projectId]);
        return array_column($statement->fetchAll(), 'user_id');
    }

    private function setUserProject(string $userId, string $projectId, bool $selected): void
    {
        if ($selected) {
            $statement = $this->db->prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (:user, :project)');
        } else {
            $statement = $this->db->prepare('DELETE FROM user_projects WHERE user_id = :user AND project_id = :project');
        }
        $statement->execute(['user' => $userId, 'project' => $projectId]);
    }

    private function replaceUserProjects(string $userId, array $projectIds): void
    {
        $this->db->prepare('DELETE FROM user_projects WHERE user_id = :user')->execute(['user' => $userId]);
        foreach (array_unique($projectIds) as $projectId) {
            if (is_string($projectId) && $this->projects->exists($projectId)) {
                $this->setUserProject($userId, $projectId, true);
            }
        }
    }

    private function listUsers(): array
    {
        $users = [];
        foreach ($this->db->query('SELECT * FROM users ORDER BY id')->fetchAll() as $row) {
            $user = $this->auth->publicUser($row);
            $user['projectIds'] = $user['admin'] ? array_column($this->projects->list(), 'id') : $this->userProjectIds($user['id']);
            $users[] = $user;
        }
        return $users;
    }

    private function createUser(array $actor, array $input): array
    {
        $id = trim((string) ($input['id'] ?? ''));
        $role = (string) ($input['role'] ?? 'editor');
        $access = (string) ($input['projectAccessMode'] ?? 'include');
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $id) || !in_array($role, ['admin', 'editor', 'viewer'], true) || !in_array($access, ['include', 'exclude', 'all'], true)) {
            throw new HttpError(422, 'Ungültiger Benutzername, Rolle oder Zugriffsmodus.');
        }
        $this->auth->validatePassword((string) ($input['password'] ?? ''));
        try {
            $statement = $this->db->prepare('INSERT INTO users (id, role, active, access_mode, password_hash, must_change_password, preferences_json, created_at) VALUES (:id, :role, 1, :access, :hash, :change, :preferences, :created)');
            $statement->execute(['id' => $id, 'role' => $role, 'access' => $access, 'hash' => password_hash((string) $input['password'], PASSWORD_ARGON2ID), 'change' => (int) ($input['mustChangePassword'] ?? true), 'preferences' => json_encode($this->auth->defaultPreferences()), 'created' => nowIso()]);
        } catch (\PDOException $error) {
            if (str_contains($error->getMessage(), 'UNIQUE')) {
                throw new HttpError(409, 'Benutzername ist bereits vergeben.');
            }
            throw $error;
        }
        $this->replaceUserProjects($id, (array) ($input['projectIds'] ?? []));
        $this->audit($actor['id'], 'user.created', $id);
        return array_values(array_filter($this->listUsers(), static fn(array $user): bool => $user['id'] === $id))[0];
    }

    private function updateUser(array $actor, string $id, array $input): array
    {
        $statement = $this->db->prepare('SELECT * FROM users WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpError(404, 'Benutzer nicht gefunden.');
        }
        $role = (string) ($input['role'] ?? $row['role']);
        $active = array_key_exists('active', $input) ? (bool) $input['active'] : (bool) $row['active'];
        $access = (string) ($input['projectAccessMode'] ?? $row['access_mode']);
        if ($id === $actor['id'] && (!$active || $role !== 'admin')) {
            throw new HttpError(422, 'Der eigene Administratorzugang kann nicht deaktiviert oder herabgestuft werden.');
        }
        if (!in_array($role, ['admin', 'editor', 'viewer'], true) || !in_array($access, ['include', 'exclude', 'all'], true)) {
            throw new HttpError(422, 'Ungültige Rolle oder ungültiger Zugriffsmodus.');
        }
        if ($row['role'] === 'admin' && (bool) $row['active'] && ($role !== 'admin' || !$active) && $this->activeAdminCount($id) === 0) {
            throw new HttpError(422, 'Der letzte aktive Administrator muss erhalten bleiben.');
        }
        $hash = $row['password_hash'];
        if (!empty($input['password'])) {
            $this->auth->validatePassword((string) $input['password']);
            $hash = password_hash((string) $input['password'], PASSWORD_ARGON2ID);
        }
        $update = $this->db->prepare('UPDATE users SET role = :role, active = :active, access_mode = :access, password_hash = :hash, must_change_password = :change WHERE id = :id');
        $update->execute(['role' => $role, 'active' => (int) $active, 'access' => $access, 'hash' => $hash, 'change' => (int) ($input['mustChangePassword'] ?? $row['must_change_password']), 'id' => $id]);
        if (isset($input['projectIds']) && is_array($input['projectIds'])) {
            $this->replaceUserProjects($id, $input['projectIds']);
        }
        if (!$active || isset($input['role']) || isset($input['projectAccessMode']) || !empty($input['password'])) {
            $query = $id === $actor['id'] ? 'DELETE FROM sessions WHERE user_id = :id AND id <> :session' : 'DELETE FROM sessions WHERE user_id = :id';
            $params = $id === $actor['id'] ? ['id' => $id, 'session' => $actor['sessionId']] : ['id' => $id];
            $this->db->prepare($query)->execute($params);
        }
        $this->audit($actor['id'], 'user.updated', $id);
        return array_values(array_filter($this->listUsers(), static fn(array $user): bool => $user['id'] === $id))[0];
    }

    private function deleteUser(array $actor, string $id): void
    {
        if ($id === $actor['id']) {
            throw new HttpError(422, 'Der eigene Benutzer kann nicht gelöscht werden.');
        }
        $statement = $this->db->prepare('DELETE FROM users WHERE id = :id');
        $statement->execute(['id' => $id]);
        if ($statement->rowCount() === 0) {
            throw new HttpError(404, 'Benutzer nicht gefunden.');
        }
        $this->audit($actor['id'], 'user.deleted', $id);
    }

    private function activeAdminCount(string $excluding = ''): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM users WHERE role = :role AND active = 1 AND id <> :excluding');
        $statement->execute(['role' => 'admin', 'excluding' => $excluding]);
        return (int) $statement->fetchColumn();
    }

    private function userProjectIds(string $userId): array
    {
        $statement = $this->db->prepare('SELECT project_id FROM user_projects WHERE user_id = :user ORDER BY project_id');
        $statement->execute(['user' => $userId]);
        return array_column($statement->fetchAll(), 'project_id');
    }

    private function sessions(array $current): array
    {
        $now = time();
        $this->db->prepare('DELETE FROM sessions WHERE touched_at < :expired')->execute(['expired' => $now - 1209600]);
        $rows = $this->db->query('SELECT sessions.*, users.id AS user_id FROM sessions JOIN users ON users.id = sessions.user_id ORDER BY sessions.touched_at DESC')->fetchAll();
        return array_map(static fn(array $row): array => [
            'id' => $row['id'],
            'userId' => $row['user_id'],
            'name' => $row['user_id'],
            'ip' => $row['ip'],
            'userAgent' => $row['user_agent'],
            'activeAgoSeconds' => max(0, $now - (int) $row['touched_at']),
            'ageSeconds' => max(0, $now - (int) $row['created_at']),
            'current' => $row['id'] === $current['sessionId'],
        ], $rows);
    }

    private function revokeSession(array $actor, string $sessionId): void
    {
        if ($sessionId === $actor['sessionId']) {
            throw new HttpError(422, 'Die aktuelle Sitzung wird über Abmelden beendet.');
        }
        $statement = $this->db->prepare('SELECT user_id FROM sessions WHERE id = :id');
        $statement->execute(['id' => $sessionId]);
        $target = $statement->fetchColumn();
        if ($target === false) {
            throw new HttpError(404, 'Sitzung nicht gefunden.');
        }
        $this->db->prepare('DELETE FROM sessions WHERE id = :id')->execute(['id' => $sessionId]);
        $this->audit($actor['id'], 'session.revoked', (string) $target, $sessionId);
    }

    private function tagsFor(array $user, ?array $projects = null): array
    {
        $projects ??= array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
        $usageByTag = [];
        foreach ($projects as $project) {
            $status = (string) ($project['status'] ?? '');
            if (!in_array($status, ['active', 'paused', 'completed', 'archived'], true)) continue;
            foreach ($project['tagIds'] ?? [] as $tagId) {
                $usageByTag[$tagId] ??= ['activeProjectCount' => 0, 'archivedProjectCount' => 0];
                $key = $status === 'archived' ? 'archivedProjectCount' : 'activeProjectCount';
                ++$usageByTag[$tagId][$key];
            }
        }
        foreach ($this->visibleFolders($user, $projects) as $folder) {
            foreach ($folder['tagIds'] ?? [] as $tagId) {
                $usageByTag[$tagId] ??= ['activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
                $usageByTag[$tagId]['folderCount'] = ($usageByTag[$tagId]['folderCount'] ?? 0) + 1;
            }
        }
        $tags = [];
        foreach ($this->db->query('SELECT * FROM tags ORDER BY name COLLATE NOCASE')->fetchAll() as $row) {
            if (!$user['admin'] && !isset($usageByTag[$row['id']])) {
                continue;
            }
            $usage = $usageByTag[$row['id']] ?? ['activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
            $usage['folderCount'] ??= 0;
            $tags[] = ['id' => $row['id'], 'name' => $row['name'], 'normalizedName' => $row['normalized_name'], 'createdAt' => $row['created_at'], ...$usage];
        }
        return $tags;
    }

    private function createTag(array $actor, string $name): array
    {
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? $name);
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
            throw new HttpError(422, 'Ein Tag muss 2–40 Zeichen lang sein.');
        }
        $normalized = normalizeName($name);
        $existing = $this->db->prepare('SELECT id FROM tags WHERE normalized_name = :name');
        $existing->execute(['name' => $normalized]);
        if ($id = $existing->fetchColumn()) {
            $row = $this->db->prepare('SELECT id, name, normalized_name, created_at FROM tags WHERE id = :id');
            $row->execute(['id' => $id]);
            $tag = $row->fetch();
            return ['id' => $tag['id'], 'name' => $tag['name'], 'normalizedName' => $tag['normalized_name'], 'createdAt' => $tag['created_at'], 'activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
        }
        $id = 'tag-' . slug($name) . '-' . bin2hex(random_bytes(2));
        $createdAt = nowIso();
        $this->db->prepare('INSERT INTO tags (id, name, normalized_name, active, created_at) VALUES (:id, :name, :normalized, 1, :created)')->execute(['id' => $id, 'name' => $name, 'normalized' => $normalized, 'created' => $createdAt]);
        $this->audit($actor['id'], 'tag.created', $name);
        return ['id' => $id, 'name' => $name, 'normalizedName' => $normalized, 'createdAt' => $createdAt, 'activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
    }

    private function updateTag(array $actor, string $id, array $input): array
    {
        if (array_key_exists('active', $input)) {
            throw new HttpError(422, 'Tags können nicht deaktiviert werden.');
        }
        $statement = $this->db->prepare('SELECT * FROM tags WHERE id = :id');
        $statement->execute(['id' => $id]);
        $tag = $statement->fetch();
        if (!$tag) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        $name = isset($input['name']) ? trim(preg_replace('/\s+/u', ' ', (string) $input['name']) ?? (string) $input['name']) : $tag['name'];
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
            throw new HttpError(422, 'Ein Tag muss 2–40 Zeichen lang sein.');
        }
        try {
            $this->db->prepare('UPDATE tags SET name = :name, normalized_name = :normalized, active = 1 WHERE id = :id')->execute(['name' => $name, 'normalized' => normalizeName($name), 'id' => $id]);
        } catch (\PDOException $error) {
            if (str_contains($error->getMessage(), 'UNIQUE')) {
                throw new HttpError(409, 'Ein Tag mit diesem Namen existiert bereits.');
            }
            throw $error;
        }
        $this->audit($actor['id'], 'tag.updated', $name);
        return array_values(array_filter($this->tagsFor($actor), static fn(array $candidate): bool => $candidate['id'] === $id))[0];
    }

    private function deleteTag(array $actor, string $id, bool $removeFromProjects): void
    {
        $statement = $this->db->prepare('SELECT name FROM tags WHERE id = :id');
        $statement->execute(['id' => $id]);
        $name = $statement->fetchColumn();
        if ($name === false) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        $assigned = array_filter($this->projects->list(), static fn(array $project): bool => in_array($id, $project['tagIds'] ?? [], true));
        $assignedFolders = array_filter($this->folders->list(), static fn(array $folder): bool => in_array($id, $folder['tagIds'] ?? [], true));
        if (($assigned || $assignedFolders) && !$removeFromProjects) {
            throw new HttpError(409, 'Tag ist noch Projekten oder Ordnern zugewiesen.');
        }
        foreach ($assigned as $project) {
            $this->projects->update($project['id'], ['tagIds' => array_values(array_filter($project['tagIds'] ?? [], static fn(string $tagId): bool => $tagId !== $id))]);
        }
        foreach ($assignedFolders as $folder) {
            $this->folders->update($folder['id'], ['tagIds' => array_values(array_filter($folder['tagIds'] ?? [], static fn(string $tagId): bool => $tagId !== $id))]);
        }
        $this->db->prepare('DELETE FROM tags WHERE id = :id')->execute(['id' => $id]);
        $this->audit($actor['id'], 'tag.deleted', (string) $name);
    }

    private function mergeTag(array $actor, string $sourceId, string $targetId): array
    {
        if ($sourceId === $targetId) {
            throw new HttpError(422, 'Quell- und Ziel-Tag müssen verschieden sein.');
        }
        $tags = $this->tagsFor($actor);
        $source = array_values(array_filter($tags, static fn(array $tag): bool => $tag['id'] === $sourceId))[0] ?? null;
        $target = array_values(array_filter($tags, static fn(array $tag): bool => $tag['id'] === $targetId))[0] ?? null;
        if (!$source || !$target) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        foreach ($this->projects->list() as $project) {
            if (!in_array($sourceId, $project['tagIds'] ?? [], true)) {
                continue;
            }
            $ids = array_map(static fn(string $id): string => $id === $sourceId ? $targetId : $id, $project['tagIds']);
            $this->projects->update($project['id'], ['tagIds' => array_values(array_unique($ids))]);
        }
        foreach ($this->folders->list() as $folder) {
            if (!in_array($sourceId, $folder['tagIds'] ?? [], true)) continue;
            $ids = array_map(static fn(string $id): string => $id === $sourceId ? $targetId : $id, $folder['tagIds']);
            $this->folders->update($folder['id'], ['tagIds' => array_values(array_unique($ids))]);
        }
        $this->db->prepare('DELETE FROM tags WHERE id = :id')->execute(['id' => $sourceId]);
        $this->audit($actor['id'], 'tag.merged', $source['name'], 'target=' . $target['name']);
        return array_values(array_filter($this->tagsFor($actor), static fn(array $tag): bool => $tag['id'] === $targetId))[0];
    }

    private function serverSettings(): array
    {
        $general = $this->getSetting('general', []);
        return [
            'siteName' => $general['siteName'] ?? 'Logbuch',
            'baseUrl' => $general['baseUrl'] ?? $this->detectedBaseUrl(),
            'timezone' => $general['timezone'] ?? 'Europe/Berlin',
            'platform' => getenv('LOGBUCH_PLATFORM') ?: 'webhosting',
            'currentTime' => nowIso(),
        ];
    }

    private function updateServerSettings(array $actor, array $input): array
    {
        $current = $this->serverSettings();
        $siteName = trim((string) ($input['siteName'] ?? $current['siteName']));
        $baseUrl = rtrim(trim((string) ($input['baseUrl'] ?? $current['baseUrl'])), '/');
        $timezone = (string) ($input['timezone'] ?? $current['timezone']);
        if (mb_strlen($siteName) < 2 || mb_strlen($siteName) > 80 || !filter_var($baseUrl, FILTER_VALIDATE_URL) || !in_array($timezone, timezone_identifiers_list(), true)) {
            throw new HttpError(422, 'Ungültige Servereinstellungen.');
        }
        $this->setSetting('general', ['siteName' => $siteName, 'baseUrl' => $baseUrl, 'timezone' => $timezone]);
        $this->audit($actor['id'], 'server.settings_updated', $baseUrl);
        return ['saved' => true, ...$this->serverSettings()];
    }

    private function exportUsers(): array
    {
        $accounts = [];
        foreach ($this->db->query('SELECT * FROM users ORDER BY id')->fetchAll() as $row) {
            $accounts[] = [
                'id' => $row['id'],
                'name' => $row['id'],
                'role' => $row['role'],
                'active' => (bool) $row['active'],
                'projectAccessMode' => $row['access_mode'],
                'mustChangePassword' => (bool) $row['must_change_password'],
                'createdAt' => $row['created_at'],
                'lastLoginAt' => $row['last_login_at'],
                'passwordAlgorithm' => 'php-password-hash',
                'passwordHash' => $row['password_hash'],
                'projectIds' => $row['role'] === 'admin' ? array_column($this->projects->list(), 'id') : $this->userProjectIds($row['id']),
            ];
        }
        return $accounts;
    }

    private function importUsers(array $actor, array $input): array
    {
        $accounts = $input['accounts'] ?? null;
        if (!is_array($accounts) || !$accounts || count($accounts) > 500) {
            throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
        }
        $imported = 0;
        $skipped = 0;
        foreach ($accounts as $account) {
            if (!is_array($account)) {
                throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
            }
            $passwordInfo = password_get_info((string) ($account['passwordHash'] ?? ''));
            if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', (string) ($account['id'] ?? '')) || !in_array(($account['role'] ?? ''), ['admin', 'editor', 'viewer'], true) || !in_array(($account['projectAccessMode'] ?? ''), ['include', 'exclude', 'all'], true) || ($passwordInfo['algoName'] ?? 'unknown') !== 'argon2id') {
                throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
            }
            $id = $account['id'];
            $exists = $this->db->prepare('SELECT 1 FROM users WHERE id = :id');
            $exists->execute(['id' => $id]);
            if ($exists->fetchColumn() && !($input['replace'] ?? false)) {
                ++$skipped;
                continue;
            }
            if ($id === $actor['id'] && ($account['role'] !== 'admin' || ($account['active'] ?? true) === false)) {
                throw new HttpError(422, 'Der angemeldete Administrator muss aktiv bleiben.');
            }
            $statement = $this->db->prepare('INSERT INTO users (id, role, active, access_mode, password_hash, must_change_password, preferences_json, created_at, last_login_at) VALUES (:id, :role, :active, :access, :hash, :change, :preferences, :created, :last) ON CONFLICT(id) DO UPDATE SET role = excluded.role, active = excluded.active, access_mode = excluded.access_mode, password_hash = excluded.password_hash, must_change_password = excluded.must_change_password, created_at = excluded.created_at, last_login_at = excluded.last_login_at');
            $statement->execute(['id' => $id, 'role' => $account['role'], 'active' => (int) ($account['active'] ?? true), 'access' => $account['projectAccessMode'] ?? 'include', 'hash' => $account['passwordHash'], 'change' => (int) ($account['mustChangePassword'] ?? false), 'preferences' => json_encode($this->auth->defaultPreferences()), 'created' => $account['createdAt'] ?? nowIso(), 'last' => $account['lastLoginAt'] ?? '']);
            $this->replaceUserProjects($id, (array) ($account['projectIds'] ?? []));
            ++$imported;
        }
        $this->audit($actor['id'], 'data.users_imported', (string) $imported, 'skipped=' . $skipped);
        return ['imported' => $imported, 'skipped' => $skipped];
    }

    private function importTagDefinitions(array $definitions): void
    {
        foreach ($definitions as $tag) {
            if (!is_array($tag) || !validId((string) ($tag['id'] ?? ''))) {
                continue;
            }
            $name = trim((string) ($tag['name'] ?? ''));
            if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
                continue;
            }
            $this->db->prepare('INSERT OR IGNORE INTO tags (id, name, normalized_name, active, created_at) VALUES (:id, :name, :normalized, 1, :created)')->execute(['id' => $tag['id'], 'name' => $name, 'normalized' => normalizeName($name), 'created' => $tag['createdAt'] ?? nowIso()]);
        }
    }

    private function demoManifest(): array
    {
        $path = dirname(__DIR__) . '/public/demo-data.json';
        $demo = readJsonFile($path);
        if (($demo['format'] ?? '') !== 'logbuch-demo' || ($demo['version'] ?? null) !== 1 || !is_array($demo['tags'] ?? null) || !is_array($demo['folders'] ?? null) || !is_array($demo['projects'] ?? null)) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist ungültig.');
        }
        $folderIds = [];
        foreach ($demo['folders'] as $folder) {
            $id = is_array($folder) ? (string) ($folder['id'] ?? '') : '';
            if (!str_starts_with($id, 'demo-folder-') || !validId($id) || isset($folderIds[$id])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Ordner.');
            }
            $folderIds[$id] = true;
        }
        if (count($folderIds) !== 2) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz hat einen unerwarteten Ordnerumfang.');
        }
        $statusCounts = array_fill_keys(['active', 'paused', 'completed', 'archived', 'trashed'], 0);
        $ids = [];
        foreach ($demo['projects'] as $project) {
            $id = is_array($project) ? (string) ($project['id'] ?? '') : '';
            $status = is_array($project) ? (string) ($project['status'] ?? '') : '';
            if (!str_starts_with($id, 'demo-') || !validId($id) || isset($ids[$id]) || !array_key_exists($status, $statusCounts)) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist ungültig.');
            }
            foreach (ProjectStore::COLLECTIONS as $collection) {
                if (!is_array($project[$collection] ?? null)) {
                    throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist unvollständig.');
                }
            }
            $folderId = $project['folderId'] ?? null;
            if ($folderId !== null && !isset($folderIds[$folderId])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz verweist auf einen unbekannten Ordner.');
            }
            $ids[$id] = true;
            ++$statusCounts[$status];
        }
        if (count($ids) !== 11 || $statusCounts !== ['active' => 4, 'paused' => 2, 'completed' => 3, 'archived' => 1, 'trashed' => 1]) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz hat einen unerwarteten Umfang.');
        }
        return $demo;
    }

    private function installDemoData(string $actorId, ?array $demo = null): array
    {
        $demo ??= $this->demoManifest();
        $this->importTagDefinitions($demo['tags']);
        $tagIds = [];
        $findTag = $this->db->prepare('SELECT id FROM tags WHERE normalized_name = :name');
        foreach ($demo['tags'] as $tag) {
            $findTag->execute(['name' => normalizeName((string) $tag['name'])]);
            $tagIds[(string) $tag['id']] = (string) ($findTag->fetchColumn() ?: $tag['id']);
        }
        foreach ($demo['folders'] as $folder) {
            $folder['tagIds'] = array_values(array_unique(array_map(static fn(string $id): string => $tagIds[$id] ?? $id, (array) ($folder['tagIds'] ?? []))));
            $this->folders->saveImported($folder, $actorId);
        }
        foreach ($demo['projects'] as $project) {
            $project['tagIds'] = array_values(array_unique(array_map(static fn(string $id): string => $tagIds[$id] ?? $id, (array) ($project['tagIds'] ?? []))));
            $this->projects->saveImported($project, true);
        }
        $count = count($demo['projects']);
        $this->audit($actorId, 'demo.installed', (string) $count);
        return ['installed' => $count, 'folders' => count($demo['folders'])];
    }

    private function removeDemoData(string $actorId): array
    {
        $demo = $this->demoManifest();
        $projectIds = array_column($demo['projects'], 'id');
        $folderIds = array_column($demo['folders'], 'id');
        $removed = $this->projects->removeByIds($projectIds);
        if ($projectIds) {
            $placeholders = implode(',', array_fill(0, count($projectIds), '?'));
            $this->db->prepare("DELETE FROM user_projects WHERE project_id IN ($placeholders)")->execute($projectIds);
        }
        $folderResult = $this->folders->removeEmptyByIds($folderIds, $this->projects->list());

        $usedTagIds = [];
        foreach ([...$this->projects->list(), ...$this->folders->list()] as $item) {
            foreach ((array) ($item['tagIds'] ?? []) as $tagId) {
                $usedTagIds[$tagId] = true;
            }
        }
        $deleteTag = $this->db->prepare('DELETE FROM tags WHERE id = :id');
        foreach ($demo['tags'] as $tag) {
            $tagId = (string) ($tag['id'] ?? '');
            if (validId($tagId) && !isset($usedTagIds[$tagId])) {
                $deleteTag->execute(['id' => $tagId]);
            }
        }
        $this->audit($actorId, 'demo.removed', (string) $removed);
        return ['removed' => $removed, 'foldersRemoved' => $folderResult['removed'], 'foldersRetained' => $folderResult['retained']];
    }

    private function clearUsersExcept(string $id): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM users WHERE id <> :id');
        $statement->execute(['id' => $id]);
        $removed = (int) $statement->fetchColumn();
        $this->db->prepare('DELETE FROM users WHERE id <> :id')->execute(['id' => $id]);
        $this->db->prepare('DELETE FROM sessions WHERE user_id <> :id')->execute(['id' => $id]);
        return $removed;
    }

    private function directorySize(string $directory): int
    {
        $bytes = 0;
        if (!is_dir($directory)) {
            return 0;
        }
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isFile()) {
                $bytes += $file->getSize();
            }
        }
        return $bytes;
    }
}
