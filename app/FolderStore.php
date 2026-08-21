<?php

declare(strict_types=1);

namespace MakeLog;

use PDO;

final class FolderStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(): array
    {
        $rows = $this->db->query('SELECT id, parent_id, name, description, priority, flagged, icon, tag_ids_json, created_by, created_at, updated_at FROM folders ORDER BY name COLLATE NOCASE, id')->fetchAll();
        return array_map(fn(array $row): array => [
            'id' => $row['id'],
            'parentId' => $row['parent_id'] ?: null,
            'name' => $row['name'],
            'description' => $row['description'],
            'priority' => in_array($row['priority'], ['Hoch', 'Mittel', 'Gering'], true) ? $row['priority'] : 'Mittel',
            'flagged' => (bool) $row['flagged'],
            'icon' => $this->validIcon($row['icon'] ?? 'folder'),
            'tagIds' => is_array($tagIds = json_decode((string) $row['tag_ids_json'], true)) ? array_values($tagIds) : [],
            'createdBy' => $row['created_by'],
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
        ], $rows);
    }

    public function exists(string $id): bool
    {
        if (!validId($id)) return false;
        $statement = $this->db->prepare('SELECT 1 FROM folders WHERE id = :id');
        $statement->execute(['id' => $id]);
        return (bool) $statement->fetchColumn();
    }

    public function create(array $input, string $actor): array
    {
        $name = $this->validName($input['name'] ?? '');
        $parentId = $this->validParent($input['parentId'] ?? null);
        $this->assertUniqueName($name, $parentId);
        $folder = [
            'id' => 'folder-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3)),
            'parentId' => $parentId,
            'name' => $name,
            'description' => mb_substr(trim((string) ($input['description'] ?? '')), 0, 1000),
            'priority' => $this->validPriority($input['priority'] ?? 'Mittel'),
            'flagged' => $this->validFlag($input['flagged'] ?? false),
            'icon' => $this->validIcon($input['icon'] ?? 'folder'),
            'tagIds' => $this->validTagIds($input['tagIds'] ?? []),
            'createdBy' => $actor,
            'createdAt' => nowIso(),
            'updatedAt' => '',
        ];
        $statement = $this->db->prepare('INSERT INTO folders (id, parent_id, name, description, priority, flagged, icon, tag_ids_json, created_by, created_at, updated_at) VALUES (:id, :parent, :name, :description, :priority, :flagged, :icon, :tags, :actor, :created, :updated)');
        $statement->execute(['id' => $folder['id'], 'parent' => $parentId, 'name' => $name, 'description' => $folder['description'], 'priority' => $folder['priority'], 'flagged' => (int) $folder['flagged'], 'icon' => $folder['icon'], 'tags' => json_encode($folder['tagIds']), 'actor' => $actor, 'created' => $folder['createdAt'], 'updated' => '']);
        return $folder;
    }

    public function saveImported(array $input, string $actor): array
    {
        $id = (string) ($input['id'] ?? '');
        if (!validId($id)) throw new HttpError(422, 'Ungültige Ordnerdaten im Beispieldatensatz.');
        $name = $this->validName($input['name'] ?? '');
        $parentId = $this->validParent($input['parentId'] ?? null);
        if ($parentId === $id || ($parentId !== null && $this->isDescendant($parentId, $id))) {
            throw new HttpError(422, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
        }
        $this->assertUniqueName($name, $parentId, $id);
        $folder = [
            'id' => $id,
            'parentId' => $parentId,
            'name' => $name,
            'description' => mb_substr(trim((string) ($input['description'] ?? '')), 0, 1000),
            'priority' => $this->validPriority($input['priority'] ?? 'Mittel'),
            'flagged' => $this->validFlag($input['flagged'] ?? false),
            'icon' => $this->validIcon($input['icon'] ?? 'folder'),
            'tagIds' => $this->validTagIds($input['tagIds'] ?? []),
            'createdBy' => $actor,
            'createdAt' => (string) ($input['createdAt'] ?? nowIso()),
            'updatedAt' => nowIso(),
        ];
        $statement = $this->db->prepare('INSERT INTO folders (id, parent_id, name, description, priority, flagged, icon, tag_ids_json, created_by, created_at, updated_at) VALUES (:id, :parent, :name, :description, :priority, :flagged, :icon, :tags, :actor, :created, :updated) ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, description = excluded.description, priority = excluded.priority, flagged = excluded.flagged, icon = excluded.icon, tag_ids_json = excluded.tag_ids_json, updated_at = excluded.updated_at');
        $statement->execute(['id' => $id, 'parent' => $parentId, 'name' => $name, 'description' => $folder['description'], 'priority' => $folder['priority'], 'flagged' => (int) $folder['flagged'], 'icon' => $folder['icon'], 'tags' => json_encode($folder['tagIds']), 'actor' => $actor, 'created' => $folder['createdAt'], 'updated' => $folder['updatedAt']]);
        return $folder;
    }

    public function removeEmptyByIds(array $ids, array $projects): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn(mixed $id): bool => is_string($id) && validId($id))));
        $removed = 0;
        $retained = 0;
        $hasChild = $this->db->prepare('SELECT 1 FROM folders WHERE parent_id = :id LIMIT 1');
        $delete = $this->db->prepare('DELETE FROM folders WHERE id = :id');
        foreach ($ids as $id) {
            if (!$this->exists($id)) continue;
            $hasProject = array_filter($projects, static fn(array $project): bool => ($project['folderId'] ?? null) === $id);
            $hasChild->execute(['id' => $id]);
            if ($hasProject || $hasChild->fetchColumn()) {
                ++$retained;
                continue;
            }
            $delete->execute(['id' => $id]);
            $removed += $delete->rowCount();
        }
        return ['removed' => $removed, 'retained' => $retained];
    }

    public function update(string $id, array $input): array
    {
        $folder = $this->get($id);
        $name = array_key_exists('name', $input) ? $this->validName($input['name']) : $folder['name'];
        $parentId = array_key_exists('parentId', $input) ? $this->validParent($input['parentId']) : $folder['parentId'];
        if ($parentId === $id || ($parentId !== null && $this->isDescendant($parentId, $id))) {
            throw new HttpError(422, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
        }
        $this->assertUniqueName($name, $parentId, $id);
        $description = array_key_exists('description', $input) ? mb_substr(trim((string) $input['description']), 0, 1000) : $folder['description'];
        $priority = array_key_exists('priority', $input) ? $this->validPriority($input['priority']) : $folder['priority'];
        $flagged = array_key_exists('flagged', $input) ? $this->validFlag($input['flagged']) : $folder['flagged'];
        $icon = array_key_exists('icon', $input) ? $this->validIcon($input['icon']) : $folder['icon'];
        $tagIds = array_key_exists('tagIds', $input) ? $this->validTagIds($input['tagIds']) : $folder['tagIds'];
        $updatedAt = nowIso();
        $statement = $this->db->prepare('UPDATE folders SET parent_id = :parent, name = :name, description = :description, priority = :priority, flagged = :flagged, icon = :icon, tag_ids_json = :tags, updated_at = :updated WHERE id = :id');
        $statement->execute(['parent' => $parentId, 'name' => $name, 'description' => $description, 'priority' => $priority, 'flagged' => (int) $flagged, 'icon' => $icon, 'tags' => json_encode($tagIds), 'updated' => $updatedAt, 'id' => $id]);
        return [...$folder, 'parentId' => $parentId, 'name' => $name, 'description' => $description, 'priority' => $priority, 'flagged' => $flagged, 'icon' => $icon, 'tagIds' => $tagIds, 'updatedAt' => $updatedAt];
    }

    public function delete(string $id, array $projects): void
    {
        $this->get($id);
        $child = $this->db->prepare('SELECT 1 FROM folders WHERE parent_id = :id LIMIT 1');
        $child->execute(['id' => $id]);
        $hasProject = array_filter($projects, static fn(array $project): bool => ($project['folderId'] ?? null) === $id);
        if ($child->fetchColumn() || $hasProject) {
            throw new HttpError(409, 'Der Ordner kann nur gelöscht werden, wenn er leer ist.');
        }
        $this->db->prepare('DELETE FROM folders WHERE id = :id')->execute(['id' => $id]);
    }

    private function get(string $id): array
    {
        $folder = array_values(array_filter($this->list(), static fn(array $folder): bool => $folder['id'] === $id))[0] ?? null;
        if (!$folder) throw new HttpError(404, 'Ordner nicht gefunden.');
        return $folder;
    }

    private function validName(mixed $value): string
    {
        $name = trim((string) $value);
        if (mb_strlen($name) < 1 || mb_strlen($name) > 100) throw new HttpError(422, 'Der Ordnername muss 1–100 Zeichen lang sein.');
        return $name;
    }

    private function validParent(mixed $value): ?string
    {
        $id = trim((string) ($value ?? ''));
        if ($id === '') return null;
        if (!$this->exists($id)) throw new HttpError(422, 'Der übergeordnete Ordner wurde nicht gefunden.');
        return $id;
    }

    private function validPriority(mixed $value): string
    {
        $priority = trim((string) $value);
        if (!in_array($priority, ['Hoch', 'Mittel', 'Gering'], true)) throw new HttpError(422, 'Ungültige Ordnerpriorität.');
        return $priority;
    }

    private function validFlag(mixed $value): bool
    {
        if (!is_bool($value)) throw new HttpError(422, 'Ungültige Ordnermarkierung.');
        return $value;
    }

    private function validTagIds(mixed $ids): array
    {
        if (!is_array($ids) || count($ids) > 20) throw new HttpError(422, 'Ungültige Tag-Auswahl.');
        $valid = [];
        $exists = $this->db->prepare('SELECT 1 FROM tags WHERE id = :id');
        foreach ($ids as $id) {
            if (!is_string($id) || !validId($id)) throw new HttpError(422, 'Ungültige Tag-Auswahl.');
            $exists->execute(['id' => $id]);
            if (!$exists->fetchColumn()) throw new HttpError(422, 'Ein ausgewählter Tag wurde nicht gefunden.');
            if (!in_array($id, $valid, true)) $valid[] = $id;
        }
        return $valid;
    }

    private function validIcon(mixed $value): string
    {
        $icon = trim((string) $value);
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $icon)) throw new HttpError(422, 'Ungültiges Ordnersymbol.');
        return $icon;
    }

    private function assertUniqueName(string $name, ?string $parentId, string $exceptId = ''): void
    {
        foreach ($this->list() as $folder) {
            if ($folder['id'] !== $exceptId && $folder['parentId'] === $parentId && normalizeName($folder['name']) === normalizeName($name)) {
                throw new HttpError(409, 'In diesem Ordner gibt es bereits einen Ordner mit diesem Namen.');
            }
        }
    }

    private function isDescendant(string $candidateId, string $ancestorId): bool
    {
        $byId = [];
        foreach ($this->list() as $folder) $byId[$folder['id']] = $folder;
        for ($current = $candidateId; isset($byId[$current]); $current = (string) ($byId[$current]['parentId'] ?? '')) {
            if ($current === $ancestorId) return true;
            if (!$byId[$current]['parentId']) break;
        }
        return false;
    }
}
