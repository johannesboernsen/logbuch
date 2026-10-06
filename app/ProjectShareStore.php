<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class ProjectShareStore
{
    private const PUBLIC_STATUSES = ['idea', 'active', 'paused', 'completed'];

    public function __construct(
        private readonly PDO $db,
        private readonly ProjectStore $projects,
        private readonly FolderStore $folders,
    ) {}

    public function create(array $input, string $actor): array
    {
        $scope = $this->normalizeScope($input);
        $name = trim((string) ($input['name'] ?? $this->defaultName($scope)));
        if ($name === '' || mb_strlen($name) > 160) throw new HttpError(422, 'Die Bezeichnung muss 1–160 Zeichen lang sein.');
        $expiresAt = trim((string) ($input['expiresAt'] ?? ''));
        if ($expiresAt !== '' && (!validDate($expiresAt) || $expiresAt < substr(nowIso(), 0, 10))) {
            throw new HttpError(422, 'Das Ablaufdatum muss heute oder später liegen.');
        }
        $share = [
            'id' => randomId('project-share-'),
            'token' => bin2hex(random_bytes(32)),
            'name' => $name,
            ...$scope,
            'expiresAt' => $expiresAt,
            'active' => true,
            'createdBy' => $actor,
            'createdAt' => nowIso(),
            'updatedAt' => '',
        ];
        $statement = $this->db->prepare('INSERT INTO project_public_shares (id, token, name, scope_type, project_status, project_statuses_json, folder_id, expires_at, active, created_by, created_at, updated_at) VALUES (:id, :token, :name, :scope, :status, :statuses, :folder, :expires, 1, :actor, :created, \'\')');
        $statement->execute([
            'id' => $share['id'], 'token' => $share['token'], 'name' => $share['name'],
            'scope' => $share['scopeType'], 'status' => $share['projectStatus'], 'folder' => $share['folderId'],
            'statuses' => $share['projectStatuses'] === null ? null : json_encode($share['projectStatuses'], JSON_THROW_ON_ERROR),
            'expires' => $share['expiresAt'], 'actor' => $actor, 'created' => $share['createdAt'],
        ]);
        return $this->decorate($share);
    }

    public function list(): array
    {
        $rows = $this->db->query('SELECT * FROM project_public_shares ORDER BY active DESC, created_at DESC, id')->fetchAll();
        return array_map(fn(array $row): array => $this->decorate($this->row($row)), $rows);
    }

    public function deactivate(string $id): array
    {
        $share = $this->byId($id);
        if (!$share['active']) return $this->decorate($share);
        $updatedAt = nowIso();
        $this->db->prepare('UPDATE project_public_shares SET active = 0, updated_at = :updated WHERE id = :id')->execute(['updated' => $updatedAt, 'id' => $id]);
        return $this->decorate([...$share, 'active' => false, 'updatedAt' => $updatedAt]);
    }

    public function update(string $id, array $input): array
    {
        $share = $this->byId($id);
        // Editing a link never changes its folder or scope, nor regenerates its token.
        $scope = $this->normalizeScope([
            ...$share,
            'projectStatus' => $input['projectStatus'] ?? $share['projectStatus'],
            'projectStatuses' => array_key_exists('projectStatuses', $input) ? $input['projectStatuses'] : $share['projectStatuses'],
        ]);
        $name = trim((string) ($input['name'] ?? $share['name']));
        if ($name === '' || mb_strlen($name) > 160) throw new HttpError(422, 'Die Bezeichnung muss 1–160 Zeichen lang sein.');
        $expiresAt = trim((string) ($input['expiresAt'] ?? $share['expiresAt']));
        if ($expiresAt !== '' && (!validDate($expiresAt) || ($expiresAt !== $share['expiresAt'] && $expiresAt < substr(nowIso(), 0, 10)))) {
            throw new HttpError(422, 'Das Ablaufdatum muss heute oder später liegen.');
        }
        $active = $input['active'] ?? $share['active'];
        if (!is_bool($active)) throw new HttpError(422, 'Der Freigabestatus ist ungültig.');
        $updatedAt = nowIso();
        $this->db->prepare('UPDATE project_public_shares SET name = :name, project_status = :status, project_statuses_json = :statuses, expires_at = :expires, active = :active, updated_at = :updated WHERE id = :id')->execute([
            'name' => $name, 'status' => $scope['projectStatus'],
            'statuses' => $scope['projectStatuses'] === null ? null : json_encode($scope['projectStatuses'], JSON_THROW_ON_ERROR),
            'expires' => $expiresAt, 'active' => (int) $active, 'updated' => $updatedAt, 'id' => $id,
        ]);
        return $this->decorate([...$share, ...$scope, 'name' => $name, 'expiresAt' => $expiresAt, 'active' => $active, 'updatedAt' => $updatedAt]);
    }

    public function delete(string $id): void
    {
        $this->byId($id);
        $this->db->prepare('DELETE FROM project_public_shares WHERE id = :id')->execute(['id' => $id]);
    }

    public function rotate(string $id): array
    {
        $share = $this->byId($id);
        if (!$share['active']) throw new HttpError(409, 'Eine deaktivierte Freigabe kann nicht erneuert werden.');
        $token = bin2hex(random_bytes(32));
        $updatedAt = nowIso();
        $this->db->prepare('UPDATE project_public_shares SET token = :token, updated_at = :updated WHERE id = :id')->execute(['token' => $token, 'updated' => $updatedAt, 'id' => $id]);
        return $this->decorate([...$share, 'token' => $token, 'updatedAt' => $updatedAt]);
    }

    public function publicData(string $token): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) throw new HttpError(404, 'Diese Projektfreigabe ist nicht verfügbar.');
        $statement = $this->db->prepare('SELECT * FROM project_public_shares WHERE token = :token AND active = 1');
        $statement->execute(['token' => $token]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Diese Projektfreigabe ist nicht verfügbar.');
        $share = $this->row($row);
        if ($this->expired($share)) throw new HttpError(410, 'Diese Projektfreigabe ist abgelaufen.');
        return $this->snapshot($share, true);
    }

    private function byId(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Projektfreigabe nicht gefunden.');
        $statement = $this->db->prepare('SELECT * FROM project_public_shares WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Projektfreigabe nicht gefunden.');
        return $this->row($row);
    }

    private function normalizeScope(array $input): array
    {
        $scopeType = strtoupper(trim((string) ($input['scopeType'] ?? '')));
        $projectStatus = trim((string) ($input['projectStatus'] ?? ''));
        $folderId = trim((string) ($input['folderId'] ?? ''));
        $statuses = self::validateProjectStatuses($input['projectStatuses'] ?? null);
        if ($scopeType !== 'FOLDER' && $statuses !== null) throw new HttpError(422, 'Die Statusauswahl ist nur für Ordnerfreigaben verfügbar.');
        if ($scopeType === 'ALL') return ['scopeType' => 'ALL', 'projectStatus' => '', 'projectStatuses' => null, 'folderId' => null];
        if ($scopeType === 'STATUS' && in_array($projectStatus, self::PUBLIC_STATUSES, true)) {
            return ['scopeType' => 'STATUS', 'projectStatus' => $projectStatus, 'projectStatuses' => null, 'folderId' => null];
        }
        if ($scopeType === 'FOLDER' && $this->folders->exists($folderId)) {
            return ['scopeType' => 'FOLDER', 'projectStatus' => '', 'projectStatuses' => $statuses, 'folderId' => $folderId];
        }
        throw new HttpError(422, 'Der Freigabebereich ist ungültig.');
    }

    private function defaultName(array $scope): string
    {
        if ($scope['scopeType'] === 'STATUS') return match ($scope['projectStatus']) {
            'idea' => 'Projektideen', 'active' => 'Aktive Projekte', 'paused' => 'Pausierte Projekte', 'completed' => 'Abgeschlossene Projekte', default => 'Projektübersicht',
        };
        if ($scope['scopeType'] === 'FOLDER') {
            $folder = current(array_filter($this->folders->list(), static fn(array $candidate): bool => $candidate['id'] === $scope['folderId']));
            return is_array($folder) ? 'Ordner: ' . $folder['name'] : 'Projektordner';
        }
        return 'Alle Projekte';
    }

    public static function validateProjectStatuses(mixed $statuses): ?array
    {
        if ($statuses === null) return null;
        if (!is_array($statuses) || !array_is_list($statuses) || count($statuses) < 1 || count($statuses) > 4
            || count(array_filter($statuses, 'is_string')) !== count($statuses)
            || array_diff($statuses, self::PUBLIC_STATUSES) || count(array_unique($statuses)) !== count($statuses)) {
            throw new HttpError(422, 'Bitte mindestens einen gültigen Projektstatus auswählen.');
        }
        return array_values(array_intersect(self::PUBLIC_STATUSES, $statuses));
    }

    private function decorate(array $share): array
    {
        $snapshot = $this->snapshot($share, false);
        return [...$share, 'expired' => $this->expired($share), 'scopeLabel' => $snapshot['scopeLabel'], 'projectCount' => count($snapshot['projects'])];
    }

    private function snapshot(array $share, bool $public): array
    {
        $folders = $this->folders->list();
        $foldersById = array_column($folders, null, 'id');
        $projects = array_values(array_filter($this->projects->list(), static fn(array $project): bool => in_array((string) ($project['status'] ?? ''), self::PUBLIC_STATUSES, true)));
        $rootId = null;
        if ($share['scopeType'] === 'STATUS') {
            $projects = array_values(array_filter($projects, static fn(array $project): bool => ($project['status'] ?? '') === $share['projectStatus']));
        } elseif ($share['scopeType'] === 'FOLDER') {
            $rootId = (string) $share['folderId'];
            $includedFolders = $this->descendantFolderIds($folders, $rootId);
            $projects = array_values(array_filter($projects, static fn(array $project): bool => isset($includedFolders[(string) ($project['folderId'] ?? '')])));
            if ($share['projectStatuses'] !== null) {
                $projects = array_values(array_filter($projects, static fn(array $project): bool => in_array($project['status'], $share['projectStatuses'], true)));
            }
        }

        $neededFolderIds = [];
        if ($share['scopeType'] === 'FOLDER' && $rootId !== null) {
            $neededFolderIds = $this->descendantFolderIds($folders, $rootId);
        } else {
            foreach ($projects as $project) {
                $folderId = (string) ($project['folderId'] ?? '');
                while ($folderId !== '' && isset($foldersById[$folderId]) && !isset($neededFolderIds[$folderId])) {
                    $neededFolderIds[$folderId] = true;
                    $folderId = (string) ($foldersById[$folderId]['parentId'] ?? '');
                }
            }
        }

        $folderKeys = [];
        foreach (array_keys($neededFolderIds) as $folderId) $folderKeys[$folderId] = 'f-' . substr(hash_hmac('sha256', $folderId, $share['token']), 0, 20);
        $publicFolders = [];
        foreach ($folders as $folder) {
            if (!isset($neededFolderIds[$folder['id']])) continue;
            $parentId = (string) ($folder['parentId'] ?? '');
            $publicFolders[] = [
                'key' => $folderKeys[$folder['id']],
                'parentKey' => isset($folderKeys[$parentId]) ? $folderKeys[$parentId] : null,
                'name' => (string) $folder['name'],
            ];
        }
        $publicProjects = array_map(static fn(array $project): array => [
            'title' => (string) ($project['title'] ?? 'Projekt'),
            'description' => (string) ($project['description'] ?? ''),
            'status' => (string) ($project['status'] ?? ''),
            'dueDate' => (string) ($project['dueDate'] ?? ''),
            'folderKey' => isset($folderKeys[(string) ($project['folderId'] ?? '')]) ? $folderKeys[(string) $project['folderId']] : null,
        ], $projects);
        usort($publicProjects, static fn(array $left, array $right): int => ($left['dueDate'] === '' ? 1 : 0) <=> ($right['dueDate'] === '' ? 1 : 0) ?: strcmp($left['dueDate'], $right['dueDate']) ?: strcasecmp($left['title'], $right['title']));
        usort($publicFolders, static fn(array $left, array $right): int => strcasecmp($left['name'], $right['name']));

        $scopeLabel = $this->defaultName($share);
        if ($share['scopeType'] === 'FOLDER') {
            $labels = ['idea' => 'Idee', 'active' => 'Aktiv', 'paused' => 'Pausiert', 'completed' => 'Abgeschlossen'];
            $scopeLabel .= ' · ' . ($share['projectStatuses'] === null ? 'Alle Status' : implode(', ', array_map(static fn(string $status): string => $labels[$status], $share['projectStatuses'])));
        }
        $result = [
            'name' => $share['name'],
            'scopeLabel' => $scopeLabel,
            'expiresAt' => $share['expiresAt'],
            'rootFolderKey' => $rootId !== null ? ($folderKeys[$rootId] ?? null) : null,
            'folders' => $publicFolders,
            'projects' => $publicProjects,
        ];
        return $public ? [...$result, 'generatedAt' => nowIso()] : $result;
    }

    private function descendantFolderIds(array $folders, string $rootId): array
    {
        $ids = [$rootId => true];
        $changed = true;
        while ($changed) {
            $changed = false;
            foreach ($folders as $folder) {
                $parentId = (string) ($folder['parentId'] ?? '');
                if ($parentId !== '' && isset($ids[$parentId]) && !isset($ids[$folder['id']])) {
                    $ids[$folder['id']] = true;
                    $changed = true;
                }
            }
        }
        return $ids;
    }

    private function expired(array $share): bool
    {
        return $share['expiresAt'] !== '' && $share['expiresAt'] < substr(nowIso(), 0, 10);
    }

    private function row(array $row): array
    {
        return [
            'id' => (string) $row['id'], 'token' => (string) $row['token'], 'name' => (string) $row['name'],
            'scopeType' => (string) $row['scope_type'], 'projectStatus' => (string) $row['project_status'],
            'projectStatuses' => ($row['project_statuses_json'] ?? null) === null ? null : self::validateProjectStatuses(json_decode($row['project_statuses_json'], true, 512, JSON_THROW_ON_ERROR)),
            'folderId' => $row['folder_id'] ?: null, 'expiresAt' => (string) $row['expires_at'],
            'active' => (bool) $row['active'], 'createdBy' => (string) $row['created_by'],
            'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'],
        ];
    }
}
