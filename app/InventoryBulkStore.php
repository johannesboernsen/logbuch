<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryBulkStore
{
    public function __construct(private readonly PDO $db) {}

    public function items(array $input, string $actor): array
    {
        $ids = $this->ids($input['itemIds'] ?? null, 'Artikel');
        $action = (string) ($input['action'] ?? '');
        $this->activeItems($ids);
        return $this->transaction(function () use ($ids, $action, $input, $actor): array {
            if (in_array($action, ['ADD_CATEGORIES', 'REMOVE_CATEGORIES'], true)) {
                $categoryIds = $this->ids($input['categoryIds'] ?? null, 'Kategorie');
                $this->existingIds('inventory_categories', $categoryIds, 'Eine Kategorie');
                if ($action === 'ADD_CATEGORIES') {
                    $insert = $this->db->prepare('INSERT OR IGNORE INTO inventory_item_categories (item_id, category_id, created_at) VALUES (:item, :category, :created)');
                    foreach ($ids as $itemId) foreach ($categoryIds as $categoryId) $insert->execute(['item' => $itemId, 'category' => $categoryId, 'created' => nowIso()]);
                } else {
                    $delete = $this->db->prepare('DELETE FROM inventory_item_categories WHERE item_id = :item AND category_id = :category');
                    foreach ($ids as $itemId) foreach ($categoryIds as $categoryId) $delete->execute(['item' => $itemId, 'category' => $categoryId]);
                }
                $this->touchItems($ids);
                return ['changed' => count($ids), 'action' => $action];
            }
            if ($action === 'SET_GLOBAL_MINIMUM') {
                $value = $this->nullableQuantity($input['value'] ?? null);
                $units = $this->itemUnits($ids);
                if (count($units) !== 1) throw new HttpError(409, 'Ein gemeinsamer Mindestbestand ist nur für Artikel mit derselben Einheit möglich.');
                $this->assertWholeUnits($value, $units[0]);
                $statement = $this->db->prepare("UPDATE inventory_items SET default_minimum_quantity = :value, updated_at = :updated WHERE id = :id AND tracking_mode = 'QUANTITY'");
                foreach ($ids as $id) $statement->execute(['value' => $value, 'updated' => nowIso(), 'id' => $id]);
                return ['changed' => count($ids), 'action' => $action, 'stockUnit' => $units[0]];
            }
            if ($action === 'REQUEST_AUDIT') {
                $priority = ($input['priority'] ?? '') === 'URGENT' ? 'URGENT' : 'NORMAL';
                $note = $this->text($input['note'] ?? '', 2000);
                $dueAt = trim((string) ($input['dueAt'] ?? ''));
                if ($dueAt !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueAt)) throw new HttpError(422, 'Das Prüfdatum ist ungültig.');
                $dismiss = $this->db->prepare("UPDATE inventory_audit_requests SET status = 'DISMISSED', resolved_by = :actor, resolved_at = :resolved WHERE item_id = :item AND stock_entry_id IS NULL AND status = 'OPEN'");
                $insert = $this->db->prepare("INSERT INTO inventory_audit_requests (id, item_id, stock_entry_id, priority, note, due_at, status, created_by, created_at) VALUES (:id, :item, NULL, :priority, :note, :due, 'OPEN', :actor, :created)");
                foreach ($ids as $id) {
                    $now = nowIso();
                    $dismiss->execute(['actor' => $actor, 'resolved' => $now, 'item' => $id]);
                    $insert->execute(['id' => randomId('audit-request-'), 'item' => $id, 'priority' => $priority, 'note' => $note, 'due' => $dueAt !== '' ? $dueAt : null, 'actor' => $actor, 'created' => $now]);
                }
                return ['changed' => count($ids), 'action' => $action];
            }
            throw new HttpError(422, 'Die Mehrfachaktion ist ungültig.');
        });
    }

    public function stockEntries(array $input, string $actor): array
    {
        $ids = $this->ids($input['stockEntryIds'] ?? null, 'Lagerposition');
        $action = (string) ($input['action'] ?? '');
        $entries = $this->activeEntries($ids);
        return $this->transaction(function () use ($ids, $entries, $action, $input, $actor): array {
            if ($action === 'SET_LOCAL_MINIMUM') {
                $value = $this->nullableQuantity($input['value'] ?? null);
                $units = array_values(array_unique(array_column($entries, 'stock_unit')));
                if (count($units) !== 1) throw new HttpError(409, 'Ein gemeinsamer Mindestbestand ist nur für Lagerpositionen mit derselben Einheit möglich.');
                if (array_filter($entries, static fn(array $entry): bool => $entry['tracking_mode'] !== 'QUANTITY')) throw new HttpError(409, 'Lose Sammlungen besitzen keinen Mindestbestand.');
                $this->assertWholeUnits($value, $units[0]);
                $statement = $this->db->prepare('UPDATE stock_entries SET minimum_quantity = :value, updated_at = :updated WHERE id = :id');
                foreach ($ids as $id) $statement->execute(['value' => $value, 'updated' => nowIso(), 'id' => $id]);
                return ['changed' => count($ids), 'action' => $action, 'stockUnit' => $units[0]];
            }
            if ($action === 'MOVE') {
                $destination = trim((string) ($input['destinationStorageLocationId'] ?? ''));
                if (!validId($destination)) throw new HttpError(422, 'Der Ziellagerort ist ungültig.');
                $location = $this->db->prepare("SELECT status FROM storage_locations WHERE id = :id");
                $location->execute(['id' => $destination]);
                if ($location->fetchColumn() !== 'ACTIVE') throw new HttpError(409, 'Der Ziellagerort ist nicht aktiv.');
                $note = $this->text($input['note'] ?? '', 2000);
                foreach ($entries as $entry) {
                    if ($entry['storage_location_id'] === $destination) throw new HttpError(422, 'Quelle und Ziel müssen verschieden sein.');
                    $target = $this->db->prepare('SELECT * FROM stock_entries WHERE item_id = :item AND storage_location_id = :location');
                    $target->execute(['item' => $entry['item_id'], 'location' => $destination]);
                    $targetEntry = $target->fetch();
                    if ($targetEntry) {
                        $minimum = $targetEntry['minimum_quantity'] ?? $entry['minimum_quantity'];
                        $update = $this->db->prepare("UPDATE stock_entries SET quantity = quantity + :quantity, minimum_quantity = :minimum, status = 'ACTIVE', updated_at = :updated WHERE id = :id");
                        $update->execute(['quantity' => $entry['quantity'], 'minimum' => $minimum, 'updated' => nowIso(), 'id' => $targetEntry['id']]);
                        $this->db->prepare('DELETE FROM stock_entries WHERE id = :id')->execute(['id' => $entry['id']]);
                    } else {
                        $this->db->prepare('UPDATE stock_entries SET storage_location_id = :location, updated_at = :updated WHERE id = :id')->execute(['location' => $destination, 'updated' => nowIso(), 'id' => $entry['id']]);
                    }
                    if ($entry['tracking_mode'] === 'QUANTITY' && (float) $entry['quantity'] > 0) {
                        $now = nowIso();
                        $this->db->prepare("INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, destination_storage_location_id, reservation_id, reversal_of_transaction_id, note, recorded_by, occurred_at, created_at) VALUES (:id, :item, 'TRANSFER', :quantity, :source, :destination, NULL, NULL, :note, :actor, :occurred, :created)")->execute(['id' => randomId('transaction-'), 'item' => $entry['item_id'], 'quantity' => $entry['quantity'], 'source' => $entry['storage_location_id'], 'destination' => $destination, 'note' => $note !== '' ? $note : 'Gemeinsam umgelagert', 'actor' => $actor, 'occurred' => $now, 'created' => $now]);
                    }
                }
                return ['changed' => count($entries), 'action' => $action, 'destinationStorageLocationId' => $destination];
            }
            throw new HttpError(422, 'Die Lagerpositionsaktion ist ungültig.');
        });
    }

    private function activeItems(array $ids): void { $this->existingIds('inventory_items', $ids, 'Ein Artikel', "status = 'ACTIVE'"); }
    private function activeEntries(array $ids): array
    {
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $statement = $this->db->prepare("SELECT entry.*, item.stock_unit, item.tracking_mode FROM stock_entries AS entry JOIN inventory_items AS item ON item.id = entry.item_id WHERE entry.id IN ({$marks}) AND entry.status = 'ACTIVE' AND item.status = 'ACTIVE'");
        $statement->execute($ids); $rows = $statement->fetchAll();
        if (count($rows) !== count($ids)) throw new HttpError(404, 'Mindestens eine Lagerposition wurde nicht gefunden.');
        $order = array_flip($ids); usort($rows, static fn(array $a, array $b): int => $order[$a['id']] <=> $order[$b['id']]); return $rows;
    }
    private function existingIds(string $table, array $ids, string $label, string $extra = '1 = 1'): void { $marks = implode(',', array_fill(0, count($ids), '?')); $statement = $this->db->prepare("SELECT COUNT(*) FROM {$table} WHERE id IN ({$marks}) AND {$extra}"); $statement->execute($ids); if ((int) $statement->fetchColumn() !== count($ids)) throw new HttpError(404, "{$label} wurde nicht gefunden."); }
    private function itemUnits(array $ids): array { $marks = implode(',', array_fill(0, count($ids), '?')); $statement = $this->db->prepare("SELECT tracking_mode, stock_unit FROM inventory_items WHERE id IN ({$marks})"); $statement->execute($ids); $rows = $statement->fetchAll(); if (array_filter($rows, static fn(array $row): bool => $row['tracking_mode'] !== 'QUANTITY')) throw new HttpError(409, 'Lose Sammlungen besitzen keinen Mindestbestand.'); return array_values(array_unique(array_map(static fn(array $row): string => (string) $row['stock_unit'], $rows))); }
    private function touchItems(array $ids): void { $statement = $this->db->prepare('UPDATE inventory_items SET updated_at = :updated WHERE id = :id'); foreach ($ids as $id) $statement->execute(['updated' => nowIso(), 'id' => $id]); }
    private function ids(mixed $values, string $label): array { if (!is_array($values) || !$values || count($values) > 500) throw new HttpError(422, "Die {$label}auswahl ist ungültig."); $ids = []; foreach ($values as $value) { $id = trim((string) $value); if (!validId($id)) throw new HttpError(422, "Die {$label}auswahl ist ungültig."); if (!in_array($id, $ids, true)) $ids[] = $id; } return $ids; }
    private function nullableQuantity(mixed $value): ?float { if ($value === null || $value === '') return null; if (!is_numeric($value)) throw new HttpError(422, 'Der Mindestbestand ist ungültig.'); $number = round((float) $value, 6); if (!is_finite($number) || $number < 0 || $number > 1_000_000_000_000) throw new HttpError(422, 'Der Mindestbestand ist ungültig.'); return $number; }
    private function assertWholeUnits(?float $value, string $unit): void { if ($value !== null && mb_strtolower($unit, 'UTF-8') === 'stück' && floor($value) !== $value) throw new HttpError(422, 'Der Mindestbestand muss für die Einheit Stück ganzzahlig sein.'); }
    private function text(mixed $value, int $max): string { $text = trim((string) $value); if (mb_strlen($text) > $max) throw new HttpError(422, 'Der Text ist zu lang.'); return $text; }
    private function transaction(callable $callback): mixed { $this->db->exec('BEGIN IMMEDIATE'); try { $result = $callback(); $this->db->exec('COMMIT'); return $result; } catch (\Throwable $error) { try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {} throw $error; } }
}
