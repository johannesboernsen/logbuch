<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryCategoryStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(): array
    {
        $rows = $this->db->query(<<<'SQL'
            SELECT category.id, category.parent_id, category.name, category.description,
                   category.icon, category.sort_order, category.created_at, category.updated_at,
                   (SELECT COUNT(*) FROM inventory_categories AS child WHERE child.parent_id = category.id) AS child_count,
                   (SELECT COUNT(*) FROM inventory_item_categories AS link WHERE link.category_id = category.id) AS direct_item_count
            FROM inventory_categories AS category
            ORDER BY category.parent_id, category.sort_order, category.name COLLATE NOCASE, category.id
        SQL)->fetchAll();
        return array_map(fn(array $row): array => $this->publicCategory($row), $rows);
    }

    public function detail(string $id): array
    {
        $category = $this->get($id);
        $all = $this->list();
        $byId = array_column($all, null, 'id');
        $path = [];
        $seen = [];
        for ($current = $category; $current; $current = $current['parentId'] ? ($byId[$current['parentId']] ?? null) : null) {
            if (isset($seen[$current['id']])) throw new HttpError(409, 'Der Kategorienbaum enthält einen ungültigen Zyklus.');
            $seen[$current['id']] = true;
            array_unshift($path, $current);
        }
        return [
            'category' => $category,
            'path' => $path,
            'children' => array_values(array_filter($all, static fn(array $candidate): bool => $candidate['parentId'] === $id)),
            'directItemIds' => $this->itemIds($id, false),
            'recursiveItemIds' => $this->itemIds($id, true),
        ];
    }

    public function create(array $input): array
    {
        return $this->transaction(function () use ($input): array {
            $name = $this->validName($input['name'] ?? '');
            $description = $this->validDescription($input['description'] ?? '');
            $icon = $this->validIcon($input['icon'] ?? 'folder');
            $parentId = $this->validParent($input['parentId'] ?? null);
            $this->assertUniqueName($name, $parentId);
            $category = [
                'id' => randomId('category-'), 'parentId' => $parentId, 'name' => $name,
                'description' => $description, 'icon' => $icon, 'sortOrder' => $this->nextSortOrder($parentId),
                'childCount' => 0, 'directItemCount' => 0, 'createdAt' => nowIso(), 'updatedAt' => '',
            ];
            $statement = $this->db->prepare('INSERT INTO inventory_categories (id, parent_id, name, description, icon, sort_order, created_at, updated_at) VALUES (:id, :parent, :name, :description, :icon, :sort, :created, :updated)');
            $statement->execute(['id' => $category['id'], 'parent' => $parentId, 'name' => $name, 'description' => $description, 'icon' => $icon, 'sort' => $category['sortOrder'], 'created' => $category['createdAt'], 'updated' => '']);
            return $category;
        });
    }

    public function update(string $id, array $input): array
    {
        return $this->transaction(function () use ($id, $input): array {
            $category = $this->get($id);
            $name = array_key_exists('name', $input) ? $this->validName($input['name']) : $category['name'];
            $description = array_key_exists('description', $input) ? $this->validDescription($input['description']) : $category['description'];
            $icon = array_key_exists('icon', $input) ? $this->validIcon($input['icon']) : $category['icon'];
            $parentId = array_key_exists('parentId', $input) ? $this->validParent($input['parentId']) : $category['parentId'];
            if ($parentId === $id || ($parentId !== null && $this->isDescendant($parentId, $id))) throw new HttpError(422, 'Eine Kategorie kann nicht in sich selbst oder eine eigene Unterkategorie verschoben werden.');
            $this->assertUniqueName($name, $parentId, $id);
            $sortOrder = $parentId === $category['parentId'] ? $category['sortOrder'] : $this->nextSortOrder($parentId);
            $updatedAt = nowIso();
            $statement = $this->db->prepare('UPDATE inventory_categories SET parent_id = :parent, name = :name, description = :description, icon = :icon, sort_order = :sort, updated_at = :updated WHERE id = :id');
            $statement->execute(['parent' => $parentId, 'name' => $name, 'description' => $description, 'icon' => $icon, 'sort' => $sortOrder, 'updated' => $updatedAt, 'id' => $id]);
            return [...$category, 'parentId' => $parentId, 'name' => $name, 'description' => $description, 'icon' => $icon, 'sortOrder' => $sortOrder, 'updatedAt' => $updatedAt];
        });
    }

    public function reorder(mixed $parentValue, mixed $ids): void
    {
        $this->transaction(function () use ($parentValue, $ids): void {
            $parentId = $this->validParent($parentValue);
            if (!is_array($ids) || count($ids) > 1000) throw new HttpError(422, 'Ungültige Reihenfolge der Kategorien.');
            $normalized = [];
            foreach ($ids as $id) {
                if (!is_string($id) || !validId($id) || in_array($id, $normalized, true)) throw new HttpError(422, 'Ungültige Reihenfolge der Kategorien.');
                $normalized[] = $id;
            }
            $current = array_values(array_filter($this->list(), static fn(array $category): bool => $category['parentId'] === $parentId));
            $currentIds = array_column($current, 'id');
            sort($currentIds); $submitted = $normalized; sort($submitted);
            if ($currentIds !== $submitted) throw new HttpError(422, 'Die Reihenfolge muss alle Kategorien dieser Ebene genau einmal enthalten.');
            $statement = $this->db->prepare('UPDATE inventory_categories SET sort_order = :sort, updated_at = :updated WHERE id = :id');
            $updatedAt = nowIso();
            foreach ($normalized as $sort => $id) $statement->execute(['sort' => $sort, 'updated' => $updatedAt, 'id' => $id]);
        });
    }

    public function delete(string $id): bool
    {
        $this->get($id);
        $children = $this->db->prepare('SELECT COUNT(*) FROM inventory_categories WHERE parent_id = :id');
        $children->execute(['id' => $id]);
        $items = $this->db->prepare('SELECT COUNT(*) FROM inventory_item_categories WHERE category_id = :id');
        $items->execute(['id' => $id]);
        if ((int) $children->fetchColumn() > 0 || (int) $items->fetchColumn() > 0) throw new HttpError(409, 'Die Kategorie kann nur gelöscht werden, wenn sie keine Unterkategorien oder Artikel enthält.');
        $statement = $this->db->prepare('DELETE FROM inventory_categories WHERE id = :id');
        $statement->execute(['id' => $id]);
        return $statement->rowCount() === 1;
    }

    public function itemIds(string $categoryId, bool $recursive): array
    {
        $this->get($categoryId);
        if (!$recursive) {
            $statement = $this->db->prepare('SELECT item_id FROM inventory_item_categories WHERE category_id = :id ORDER BY item_id');
            $statement->execute(['id' => $categoryId]);
        } else {
            $statement = $this->db->prepare(<<<'SQL'
                WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM inventory_categories WHERE id = :id
                    UNION ALL
                    SELECT child.id FROM inventory_categories AS child JOIN subtree ON child.parent_id = subtree.id
                )
                SELECT DISTINCT link.item_id FROM inventory_item_categories AS link JOIN subtree ON subtree.id = link.category_id ORDER BY link.item_id
            SQL);
            $statement->execute(['id' => $categoryId]);
        }
        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    public function categoryIdsForItem(string $itemId): array
    {
        $statement = $this->db->prepare('SELECT category_id FROM inventory_item_categories WHERE item_id = :item ORDER BY category_id');
        $statement->execute(['item' => $itemId]);
        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    public function replaceItemCategories(string $itemId, mixed $ids): array
    {
        $normalized = $this->validateCategoryIds($ids);
        return $this->transaction(function () use ($itemId, $normalized): array {
            $exists = $this->db->prepare('SELECT 1 FROM inventory_items WHERE id = :id');
            $exists->execute(['id' => $itemId]);
            if (!$exists->fetchColumn()) throw new HttpError(404, 'Artikel nicht gefunden.');
            $delete = $this->db->prepare('DELETE FROM inventory_item_categories WHERE item_id = :item');
            $delete->execute(['item' => $itemId]);
            $insert = $this->db->prepare('INSERT INTO inventory_item_categories (item_id, category_id, created_at) VALUES (:item, :category, :created)');
            foreach ($normalized as $categoryId) $insert->execute(['item' => $itemId, 'category' => $categoryId, 'created' => nowIso()]);
            return $normalized;
        });
    }

    public function validateCategoryIds(mixed $ids): array
    {
        if (!is_array($ids) || count($ids) > 100) throw new HttpError(422, 'Die Kategorieauswahl ist ungültig.');
        $normalized = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !validId($id) || in_array($id, $normalized, true)) throw new HttpError(422, 'Die Kategorieauswahl ist ungültig.');
            $this->get($id);
            $normalized[] = $id;
        }
        return $normalized;
    }

    public function addItem(string $categoryId, string $itemId): bool
    {
        $ids = $this->categoryIdsForItem($itemId);
        if (in_array($categoryId, $ids, true)) return false;
        $this->replaceItemCategories($itemId, [...$ids, $categoryId]);
        return true;
    }

    public function removeItem(string $categoryId, string $itemId): bool
    {
        $statement = $this->db->prepare('DELETE FROM inventory_item_categories WHERE item_id = :item AND category_id = :category');
        $statement->execute(['item' => $itemId, 'category' => $categoryId]);
        return $statement->rowCount() === 1;
    }

    private function get(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Kategorie nicht gefunden.');
        $statement = $this->db->prepare(<<<'SQL'
            SELECT category.id, category.parent_id, category.name, category.description,
                   category.icon, category.sort_order, category.created_at, category.updated_at,
                   (SELECT COUNT(*) FROM inventory_categories AS child WHERE child.parent_id = category.id) AS child_count,
                   (SELECT COUNT(*) FROM inventory_item_categories AS link WHERE link.category_id = category.id) AS direct_item_count
            FROM inventory_categories AS category WHERE category.id = :id
        SQL);
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Kategorie nicht gefunden.');
        return $this->publicCategory($row);
    }

    private function publicCategory(array $row): array
    {
        return ['id' => (string) $row['id'], 'parentId' => $row['parent_id'] === null ? null : (string) $row['parent_id'], 'name' => (string) $row['name'], 'description' => (string) $row['description'], 'icon' => (string) $row['icon'], 'sortOrder' => (int) $row['sort_order'], 'childCount' => (int) $row['child_count'], 'directItemCount' => (int) $row['direct_item_count'], 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at']];
    }

    private function validName(mixed $value): string { $name = trim((string) $value); if (mb_strlen($name) < 1 || mb_strlen($name) > 160) throw new HttpError(422, 'Der Name muss 1–160 Zeichen lang sein.'); return $name; }
    private function validDescription(mixed $value): string { $text = trim((string) $value); if (mb_strlen($text) > 2000) throw new HttpError(422, 'Die Beschreibung darf höchstens 2.000 Zeichen lang sein.'); return $text; }
    private function validIcon(mixed $value): string { $icon = trim((string) $value); if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $icon)) throw new HttpError(422, 'Ungültiges Kategoriesymbol.'); return $icon; }
    private function validParent(mixed $value): ?string { $id = trim((string) ($value ?? '')); if ($id === '') return null; $this->get($id); return $id; }
    private function assertUniqueName(string $name, ?string $parentId, string $exceptId = ''): void { foreach ($this->list() as $category) if ($category['id'] !== $exceptId && $category['parentId'] === $parentId && normalizeName($category['name']) === normalizeName($name)) throw new HttpError(409, 'Auf dieser Ebene gibt es bereits eine Kategorie mit diesem Namen.'); }
    private function nextSortOrder(?string $parentId): int { $statement = $this->db->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM inventory_categories WHERE parent_id IS :parent'); $statement->execute(['parent' => $parentId]); return (int) $statement->fetchColumn(); }
    private function isDescendant(string $candidateId, string $ancestorId): bool { $statement = $this->db->prepare('WITH RECURSIVE descendants(id) AS (SELECT id FROM inventory_categories WHERE parent_id = :ancestor UNION ALL SELECT child.id FROM inventory_categories AS child JOIN descendants ON child.parent_id = descendants.id) SELECT 1 FROM descendants WHERE id = :candidate LIMIT 1'); $statement->execute(['ancestor' => $ancestorId, 'candidate' => $candidateId]); return (bool) $statement->fetchColumn(); }
    private function transaction(callable $callback): mixed { $this->db->exec('BEGIN IMMEDIATE'); $active = true; try { $result = $callback(); $this->db->exec('COMMIT'); $active = false; return $result; } catch (\Throwable $error) { if ($active) try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {} throw $error; } }
}
