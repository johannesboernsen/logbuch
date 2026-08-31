<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class StorageLocationStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(bool $includeArchived = false): array
    {
        $where = $includeArchived ? '' : "WHERE location.status = 'ACTIVE'";
        $rootStatus = $includeArchived ? '' : "WHERE root.status = 'ACTIVE'";
        $childStatus = $includeArchived ? '' : "AND child.status = 'ACTIVE'";
        $entryStatus = $includeArchived ? '' : "AND entry.status = 'ACTIVE'";
        $rows = $this->db->query(<<<SQL
            WITH RECURSIVE subtree(root_id, id) AS (
                SELECT root.id, root.id FROM storage_locations AS root {$rootStatus}
                UNION
                SELECT subtree.root_id, child.id
                FROM subtree
                JOIN storage_locations AS child ON child.parent_id = subtree.id {$childStatus}
            )
            SELECT location.id, location.parent_id, location.name, location.icon,
                   location.description, location.status, location.sort_order,
                   location.created_at, location.updated_at,
                   (SELECT COUNT(*) FROM storage_locations AS child
                    WHERE child.parent_id = location.id {$childStatus}) AS child_count,
                   (SELECT COUNT(DISTINCT entry.item_id) FROM stock_entries AS entry
                    WHERE entry.storage_location_id = location.id {$entryStatus}) AS direct_item_count,
                   (SELECT COUNT(*) - 1 FROM subtree
                    WHERE subtree.root_id = location.id) AS descendant_count,
                   (SELECT COUNT(DISTINCT entry.item_id)
                    FROM subtree
                    JOIN stock_entries AS entry ON entry.storage_location_id = subtree.id
                    WHERE subtree.root_id = location.id {$entryStatus}) AS subtree_item_count
            FROM storage_locations AS location
            {$where}
            ORDER BY location.parent_id, location.sort_order, location.name COLLATE NOCASE, location.id
        SQL)->fetchAll();
        return array_map(fn(array $row): array => $this->publicLocation($row), $rows);
    }

    public function detail(string $id): array
    {
        $location = $this->get($id);
        $all = $this->list(true);
        $byId = array_column($all, null, 'id');
        $path = [];
        $seen = [];
        for ($current = $location; $current; $current = $current['parentId'] ? ($byId[$current['parentId']] ?? null) : null) {
            if (isset($seen[$current['id']])) throw new HttpError(409, 'Der Lagerbaum enthält einen ungültigen Zyklus.');
            $seen[$current['id']] = true;
            array_unshift($path, $current);
        }
        $children = array_values(array_filter($all, static fn(array $candidate): bool => $candidate['parentId'] === $id));
        return ['location' => $location, 'path' => $path, 'children' => $children];
    }

    public function create(array $input): array
    {
        return $this->transaction(function () use ($input): array {
            $name = $this->validName($input['name'] ?? '');
            $icon = $this->validIcon($input['icon'] ?? 'archive');
            $description = $this->validDescription($input['description'] ?? '');
            $parentId = $this->validParent($input['parentId'] ?? null);
            $this->assertUniqueName($name, $parentId);
            $sortOrder = $this->nextSortOrder($parentId);
            $location = [
                'id' => randomId('location-'),
                'parentId' => $parentId,
                'name' => $name,
                'icon' => $icon,
                'description' => $description,
                'status' => 'ACTIVE',
                'sortOrder' => $sortOrder,
                'childCount' => 0,
                'directItemCount' => 0,
                'descendantCount' => 0,
                'subtreeItemCount' => 0,
                'createdAt' => nowIso(),
                'updatedAt' => '',
            ];
            $statement = $this->db->prepare('INSERT INTO storage_locations (id, parent_id, name, icon, description, status, sort_order, created_at, updated_at) VALUES (:id, :parent, :name, :icon, :description, \'ACTIVE\', :sort, :created, \'\')');
            $statement->execute(['id' => $location['id'], 'parent' => $parentId, 'name' => $name, 'icon' => $icon, 'description' => $description, 'sort' => $sortOrder, 'created' => $location['createdAt']]);
            return $location;
        });
    }

    public function createSeries(array $input): array
    {
        return $this->transaction(function () use ($input): array {
            $baseName = $this->validName($input['name'] ?? '');
            $counterStart = $this->validSeriesInteger($input['counterStart'] ?? null, 'Der Zählerstart', 0, 999_999_999);
            $count = $this->validSeriesInteger($input['count'] ?? null, 'Die Anzahl der Lagerorte', 2, 500);
            if ($counterStart + $count - 1 > 999_999_999) throw new HttpError(422, 'Der letzte Zählerwert darf höchstens 999.999.999 sein.');
            $icon = $this->validIcon($input['icon'] ?? 'archive');
            $description = $this->validDescription($input['description'] ?? '');
            $parentId = $this->validParent($input['parentId'] ?? null);
            $names = [];
            for ($offset = 0; $offset < $count; ++$offset) {
                $names[] = $this->validName($baseName . ' ' . ($counterStart + $offset));
            }
            return $this->createNamedLocations($names, $icon, $description, $parentId);
        });
    }

    public function createMatrix(array $input): array
    {
        return $this->transaction(function () use ($input): array {
            $baseName = $this->validName($input['name'] ?? '');
            $letterStart = $this->validMatrixLetter($input['letterStart'] ?? null, 'Der Startbuchstabe');
            $letterEnd = $this->validMatrixLetter($input['letterEnd'] ?? null, 'Der Endbuchstabe');
            $counterStart = $this->validSeriesInteger($input['counterStart'] ?? null, 'Der Startzähler', 0, 999_999_999);
            $counterEnd = $this->validSeriesInteger($input['counterEnd'] ?? null, 'Der Endzähler', 0, 999_999_999);
            if ($letterStart > $letterEnd) throw new HttpError(422, 'Der Endbuchstabe darf nicht vor dem Startbuchstaben liegen.');
            if ($counterStart > $counterEnd) throw new HttpError(422, 'Der Endzähler darf nicht kleiner als der Startzähler sein.');
            $count = (ord($letterEnd) - ord($letterStart) + 1) * ($counterEnd - $counterStart + 1);
            if ($count < 2 || $count > 500) throw new HttpError(422, 'Eine Lagermatrix muss zwischen 2 und 500 Lagerorte enthalten.');
            $icon = $this->validIcon($input['icon'] ?? 'archive');
            $description = $this->validDescription($input['description'] ?? '');
            $parentId = $this->validParent($input['parentId'] ?? null);
            $names = [];
            for ($letterCode = ord($letterStart); $letterCode <= ord($letterEnd); ++$letterCode) {
                for ($counter = $counterStart; $counter <= $counterEnd; ++$counter) {
                    $names[] = $this->validName($baseName . ' ' . chr($letterCode) . $counter);
                }
            }
            return $this->createNamedLocations($names, $icon, $description, $parentId);
        });
    }

    public function update(string $id, array $input): array
    {
        return $this->transaction(function () use ($id, $input): array {
            $location = $this->get($id);
            if ($location['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Lagerorte können nicht bearbeitet werden.');
            $name = array_key_exists('name', $input) ? $this->validName($input['name']) : $location['name'];
            $icon = array_key_exists('icon', $input) ? $this->validIcon($input['icon']) : $location['icon'];
            $description = array_key_exists('description', $input) ? $this->validDescription($input['description']) : $location['description'];
            $parentId = array_key_exists('parentId', $input) ? $this->validParent($input['parentId']) : $location['parentId'];
            if ($parentId === $id || ($parentId !== null && $this->isDescendant($parentId, $id))) {
                throw new HttpError(422, 'Ein Lagerort kann nicht in sich selbst oder einen eigenen Unterort verschoben werden.');
            }
            $this->assertUniqueName($name, $parentId, $id);
            $sortOrder = $parentId === $location['parentId'] ? $location['sortOrder'] : $this->nextSortOrder($parentId);
            $updatedAt = nowIso();
            $statement = $this->db->prepare('UPDATE storage_locations SET parent_id = :parent, name = :name, icon = :icon, description = :description, sort_order = :sort, updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
            $statement->execute(['parent' => $parentId, 'name' => $name, 'icon' => $icon, 'description' => $description, 'sort' => $sortOrder, 'updated' => $updatedAt, 'id' => $id]);
            return [...$location, 'parentId' => $parentId, 'name' => $name, 'icon' => $icon, 'description' => $description, 'sortOrder' => $sortOrder, 'updatedAt' => $updatedAt];
        });
    }

    public function reorder(mixed $parentValue, mixed $ids): void
    {
        $this->transaction(function () use ($parentValue, $ids): void {
            $parentId = $this->validParent($parentValue);
            if (!is_array($ids) || count($ids) > 1000) throw new HttpError(422, 'Ungültige Reihenfolge der Lagerorte.');
            $normalized = [];
            foreach ($ids as $id) {
                if (!is_string($id) || !validId($id) || in_array($id, $normalized, true)) throw new HttpError(422, 'Ungültige Reihenfolge der Lagerorte.');
                $normalized[] = $id;
            }
            $current = array_values(array_filter($this->list(), static fn(array $location): bool => $location['parentId'] === $parentId));
            $currentIds = array_column($current, 'id');
            sort($currentIds);
            $submittedIds = $normalized;
            sort($submittedIds);
            if ($currentIds !== $submittedIds) throw new HttpError(422, 'Die Reihenfolge muss alle sichtbaren Lagerorte dieser Ebene genau einmal enthalten.');
            $statement = $this->db->prepare('UPDATE storage_locations SET sort_order = :sort, updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
            $updatedAt = nowIso();
            foreach ($normalized as $sort => $id) $statement->execute(['sort' => $sort, 'updated' => $updatedAt, 'id' => $id]);
        });
    }

    public function archive(string $id): int
    {
        return $this->transaction(function () use ($id): int {
            $location = $this->get($id);
            return $location['status'] === 'ARCHIVED' ? 0 : $this->setSubtreeStatus($id, 'ARCHIVED');
        });
    }

    public function restore(string $id): int
    {
        return $this->transaction(function () use ($id): int {
            $location = $this->get($id);
            if ($location['status'] === 'ACTIVE') return 0;
            if ($location['parentId'] !== null) {
                $parent = $this->get($location['parentId']);
                if ($parent['status'] !== 'ACTIVE') throw new HttpError(409, 'Zuerst muss der übergeordnete Lagerort wiederhergestellt werden.');
            }
            return $this->setSubtreeStatus($id, 'ACTIVE');
        });
    }

    private function setSubtreeStatus(string $id, string $status): int
    {
        $statement = $this->db->prepare(<<<'SQL'
                WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM storage_locations WHERE id = :id
                    UNION
                    SELECT child.id FROM storage_locations AS child JOIN subtree ON child.parent_id = subtree.id
                )
                UPDATE storage_locations
                SET status = :status, updated_at = :updated
                WHERE id IN (SELECT id FROM subtree) AND status <> :status
            SQL);
        $statement->execute(['id' => $id, 'status' => $status, 'updated' => nowIso()]);
        return $statement->rowCount();
    }

    private function get(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Lagerort nicht gefunden.');
        $statement = $this->db->prepare(<<<'SQL'
            WITH RECURSIVE subtree(id) AS (
                SELECT id FROM storage_locations WHERE id = :id
                UNION
                SELECT child.id FROM subtree
                JOIN storage_locations AS child ON child.parent_id = subtree.id
                WHERE child.status = 'ACTIVE'
            )
            SELECT location.id, location.parent_id, location.name, location.icon,
                   location.description, location.status, location.sort_order,
                   location.created_at, location.updated_at,
                   (SELECT COUNT(*) FROM storage_locations AS child WHERE child.parent_id = location.id AND child.status = 'ACTIVE') AS child_count,
                   (SELECT COUNT(DISTINCT entry.item_id) FROM stock_entries AS entry WHERE entry.storage_location_id = location.id AND entry.status = 'ACTIVE') AS direct_item_count,
                   (SELECT COUNT(*) - 1 FROM subtree) AS descendant_count,
                   (SELECT COUNT(DISTINCT entry.item_id) FROM subtree JOIN stock_entries AS entry ON entry.storage_location_id = subtree.id WHERE entry.status = 'ACTIVE') AS subtree_item_count
            FROM storage_locations AS location WHERE location.id = :id
        SQL);
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Lagerort nicht gefunden.');
        return $this->publicLocation($row);
    }

    private function publicLocation(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'parentId' => $row['parent_id'] ?: null,
            'name' => (string) $row['name'],
            'icon' => (string) $row['icon'],
            'description' => (string) $row['description'],
            'status' => (string) $row['status'],
            'sortOrder' => (int) $row['sort_order'],
            'childCount' => (int) $row['child_count'],
            'directItemCount' => (int) $row['direct_item_count'],
            'descendantCount' => (int) $row['descendant_count'],
            'subtreeItemCount' => (int) $row['subtree_item_count'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }

    private function validName(mixed $value): string
    {
        $name = trim((string) $value);
        if (mb_strlen($name) < 1 || mb_strlen($name) > 160) throw new HttpError(422, 'Der Name muss 1–160 Zeichen lang sein.');
        return $name;
    }

    private function validDescription(mixed $value): string
    {
        $description = trim((string) $value);
        if (mb_strlen($description) > 2000) throw new HttpError(422, 'Die Beschreibung darf höchstens 2.000 Zeichen lang sein.');
        return $description;
    }

    private function validIcon(mixed $value): string
    {
        $icon = trim((string) $value);
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $icon)) throw new HttpError(422, 'Ungültiges Lagerortsymbol.');
        return $icon;
    }

    private function validSeriesInteger(mixed $value, string $label, int $minimum, int $maximum): int
    {
        $validated = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => $minimum, 'max_range' => $maximum]]);
        if ($validated === false) throw new HttpError(422, "{$label} muss eine ganze Zahl zwischen {$minimum} und {$maximum} sein.");
        return $validated;
    }

    private function validMatrixLetter(mixed $value, string $label): string
    {
        $letter = strtoupper(trim((string) $value));
        if (!preg_match('/^[A-Z]$/', $letter)) throw new HttpError(422, "{$label} muss ein einzelner Buchstabe von A bis Z sein.");
        return $letter;
    }

    private function createNamedLocations(array $names, string $icon, string $description, ?string $parentId): array
    {
        $existingNames = [];
        foreach ($this->list() as $location) {
            if ($location['parentId'] === $parentId) $existingNames[normalizeName($location['name'])] = true;
        }
        foreach ($names as $name) {
            $normalized = normalizeName($name);
            if (isset($existingNames[$normalized])) throw new HttpError(409, "Auf dieser Ebene gibt es bereits einen Lagerort mit dem Namen „{$name}“.");
            $existingNames[$normalized] = true;
        }

        $sortOrder = $this->nextSortOrder($parentId);
        $createdAt = nowIso();
        $statement = $this->db->prepare('INSERT INTO storage_locations (id, parent_id, name, icon, description, status, sort_order, created_at, updated_at) VALUES (:id, :parent, :name, :icon, :description, \'ACTIVE\', :sort, :created, \'\')');
        $locations = [];
        foreach ($names as $offset => $name) {
            $location = [
                'id' => randomId('location-'),
                'parentId' => $parentId,
                'name' => $name,
                'icon' => $icon,
                'description' => $description,
                'status' => 'ACTIVE',
                'sortOrder' => $sortOrder + $offset,
                'childCount' => 0,
                'directItemCount' => 0,
                'descendantCount' => 0,
                'subtreeItemCount' => 0,
                'createdAt' => $createdAt,
                'updatedAt' => '',
            ];
            $statement->execute(['id' => $location['id'], 'parent' => $parentId, 'name' => $name, 'icon' => $icon, 'description' => $description, 'sort' => $location['sortOrder'], 'created' => $createdAt]);
            $locations[] = $location;
        }
        return $locations;
    }

    private function validParent(mixed $value): ?string
    {
        $id = trim((string) ($value ?? ''));
        if ($id === '') return null;
        $parent = $this->get($id);
        if ($parent['status'] !== 'ACTIVE') throw new HttpError(422, 'Ein archivierter Lagerort kann nicht als Ziel verwendet werden.');
        return $id;
    }

    private function assertUniqueName(string $name, ?string $parentId, string $exceptId = ''): void
    {
        foreach ($this->list() as $location) {
            if ($location['id'] !== $exceptId && $location['parentId'] === $parentId && normalizeName($location['name']) === normalizeName($name)) {
                throw new HttpError(409, 'Auf dieser Ebene gibt es bereits einen Lagerort mit diesem Namen.');
            }
        }
    }

    private function nextSortOrder(?string $parentId): int
    {
        $statement = $this->db->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM storage_locations WHERE parent_id IS :parent AND status = \'ACTIVE\'');
        $statement->execute(['parent' => $parentId]);
        return (int) $statement->fetchColumn();
    }

    private function isDescendant(string $candidateId, string $ancestorId): bool
    {
        $statement = $this->db->prepare(<<<'SQL'
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM storage_locations WHERE parent_id = :ancestor
                UNION
                SELECT child.id FROM storage_locations AS child JOIN descendants ON child.parent_id = descendants.id
            )
            SELECT 1 FROM descendants WHERE id = :candidate LIMIT 1
        SQL);
        $statement->execute(['ancestor' => $ancestorId, 'candidate' => $candidateId]);
        return (bool) $statement->fetchColumn();
    }

    private function transaction(callable $callback): mixed
    {
        $this->db->exec('BEGIN IMMEDIATE');
        $active = true;
        try {
            $result = $callback();
            $this->db->exec('COMMIT');
            $active = false;
            return $result;
        } catch (\Throwable $error) {
            if ($active) {
                try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            }
            throw $error;
        }
    }
}
