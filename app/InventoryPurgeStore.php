<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryPurgeStore
{
    public function __construct(private readonly PDO $db) {}

    public function itemPreview(string $id): array
    {
        $item = $this->archivedItem($id);
        return [
            'kind' => 'item',
            'id' => $id,
            'name' => $item['name'],
            'stockEntries' => $this->count('stock_entries', 'item_id', $id),
            'transactions' => $this->count('stock_transactions', 'item_id', $id),
            'reservations' => $this->count('reservations', 'item_id', $id),
            'categoryAssignments' => $this->count('inventory_item_categories', 'item_id', $id),
            'notes' => $this->count('inventory_item_notes', 'item_id', $id),
        ];
    }

    public function deleteItem(string $id): array
    {
        $preview = $this->itemPreview($id);
        return $this->transaction(function () use ($id, $preview): array {
            $this->db->prepare('UPDATE stock_transactions SET reversal_of_transaction_id = NULL WHERE item_id <> :id AND reversal_of_transaction_id IN (SELECT id FROM stock_transactions WHERE item_id = :id)')->execute(['id' => $id]);
            $this->db->prepare('UPDATE stock_transactions SET reservation_id = NULL WHERE item_id <> :id AND reservation_id IN (SELECT id FROM reservations WHERE item_id = :id)')->execute(['id' => $id]);
            foreach (['stock_transactions', 'reservations', 'stock_entries', 'inventory_item_notes', 'inventory_item_categories'] as $table) {
                $this->db->prepare("DELETE FROM {$table} WHERE item_id = :id")->execute(['id' => $id]);
            }
            $statement = $this->db->prepare("DELETE FROM inventory_items WHERE id = :id AND status = 'ARCHIVED'");
            $statement->execute(['id' => $id]);
            if ($statement->rowCount() !== 1) throw new HttpError(409, 'Der Artikel ist nicht mehr archiviert und wurde nicht gelöscht.');
            return [...$preview, 'deleted' => true];
        });
    }

    public function locationPreview(string $id): array
    {
        $location = $this->archivedLocation($id);
        $ids = $this->locationSubtree($id);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stock = $this->db->prepare("SELECT COUNT(*) AS entries, COUNT(DISTINCT item_id) AS items FROM stock_entries WHERE storage_location_id IN ({$placeholders})");
        $stock->execute($ids);
        $stockCounts = $stock->fetch();
        $transactions = $this->db->prepare("SELECT COUNT(*) FROM stock_transactions WHERE source_storage_location_id IN ({$placeholders}) OR destination_storage_location_id IN ({$placeholders})");
        $transactions->execute([...$ids, ...$ids]);
        return [
            'kind' => 'location',
            'id' => $id,
            'name' => $location['name'],
            'locations' => count($ids),
            'stockEntries' => (int) $stockCounts['entries'],
            'affectedItems' => (int) $stockCounts['items'],
            'transactions' => (int) $transactions->fetchColumn(),
        ];
    }

    public function deleteLocation(string $id): array
    {
        $preview = $this->locationPreview($id);
        return $this->transaction(function () use ($id, $preview): array {
            $ids = $this->locationSubtree($id);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $transactionIds = $this->db->prepare("SELECT id FROM stock_transactions WHERE source_storage_location_id IN ({$placeholders}) OR destination_storage_location_id IN ({$placeholders})");
            $transactionIds->execute([...$ids, ...$ids]);
            $movementIds = array_map('strval', $transactionIds->fetchAll(PDO::FETCH_COLUMN));
            if ($movementIds) {
                $movementPlaceholders = implode(',', array_fill(0, count($movementIds), '?'));
                $this->db->prepare("UPDATE stock_transactions SET reversal_of_transaction_id = NULL WHERE id NOT IN ({$movementPlaceholders}) AND reversal_of_transaction_id IN ({$movementPlaceholders})")->execute([...$movementIds, ...$movementIds]);
                $this->db->prepare("DELETE FROM stock_transactions WHERE id IN ({$movementPlaceholders})")->execute($movementIds);
            }
            $this->db->prepare("DELETE FROM stock_entries WHERE storage_location_id IN ({$placeholders})")->execute($ids);
            foreach ($ids as $locationId) {
                $statement = $this->db->prepare("DELETE FROM storage_locations WHERE id = :id AND status = 'ARCHIVED'");
                $statement->execute(['id' => $locationId]);
                if ($statement->rowCount() !== 1) throw new HttpError(409, 'Der Lagerort-Unterbaum ist nicht vollständig archiviert und wurde nicht gelöscht.');
            }
            return [...$preview, 'deleted' => true];
        });
    }

    private function archivedItem(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Artikel nicht gefunden.');
        $statement = $this->db->prepare('SELECT id, name, status FROM inventory_items WHERE id = :id');
        $statement->execute(['id' => $id]);
        $item = $statement->fetch();
        if (!$item) throw new HttpError(404, 'Artikel nicht gefunden.');
        if ($item['status'] !== 'ARCHIVED') throw new HttpError(409, 'Nur archivierte Artikel können endgültig gelöscht werden.');
        return $item;
    }

    private function archivedLocation(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Lagerort nicht gefunden.');
        $statement = $this->db->prepare('SELECT id, name, status FROM storage_locations WHERE id = :id');
        $statement->execute(['id' => $id]);
        $location = $statement->fetch();
        if (!$location) throw new HttpError(404, 'Lagerort nicht gefunden.');
        if ($location['status'] !== 'ARCHIVED') throw new HttpError(409, 'Nur archivierte Lagerorte können endgültig gelöscht werden.');
        return $location;
    }

    private function locationSubtree(string $id): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            WITH RECURSIVE subtree(id, depth, status) AS (
                SELECT id, 0, status FROM storage_locations WHERE id = :id
                UNION ALL
                SELECT child.id, subtree.depth + 1, child.status
                FROM storage_locations child JOIN subtree ON child.parent_id = subtree.id
            )
            SELECT id, status FROM subtree ORDER BY depth DESC, id
        SQL);
        $statement->execute(['id' => $id]);
        $rows = $statement->fetchAll();
        if (!$rows || array_filter($rows, static fn(array $row): bool => $row['status'] !== 'ARCHIVED')) throw new HttpError(409, 'Der gesamte Lagerort-Unterbaum muss archiviert sein.');
        return array_map(static fn(array $row): string => (string) $row['id'], $rows);
    }

    private function count(string $table, string $column, string $id): int
    {
        $statement = $this->db->prepare("SELECT COUNT(*) FROM {$table} WHERE {$column} = :id");
        $statement->execute(['id' => $id]);
        return (int) $statement->fetchColumn();
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
            if ($active) try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            throw $error;
        }
    }
}
