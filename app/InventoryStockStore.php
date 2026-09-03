<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryStockStore
{
    private const INBOUND_TYPES = ['RECEIPT', 'RETURN'];
    private const OUTBOUND_TYPES = ['CONSUMPTION', 'DISPOSAL', 'LOSS'];

    public function __construct(private readonly PDO $db) {}

    public function list(?string $itemId = null, ?string $locationId = null, bool $includeArchived = false): array
    {
        if ($itemId !== null) $this->assertId($itemId, 'Artikel');
        if ($locationId !== null) $this->assertId($locationId, 'Lagerort');
        $conditions = $includeArchived ? [] : ["entry.status = 'ACTIVE'"];
        $parameters = [];
        if ($itemId !== null) {
            $conditions[] = 'entry.item_id = :item';
            $parameters['item'] = $itemId;
        }
        if ($locationId !== null) {
            $conditions[] = 'entry.storage_location_id = :location';
            $parameters['location'] = $locationId;
        }
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
        $statement = $this->db->prepare(<<<SQL
            SELECT entry.id, entry.item_id, entry.storage_location_id, entry.quantity,
                   entry.minimum_quantity, entry.note, entry.status, entry.created_at, entry.updated_at,
                   item.name AS item_name, item.stock_unit, item.tracking_mode, item.status AS item_status,
                   location.name AS location_name, location.status AS location_status
            FROM stock_entries AS entry
            JOIN inventory_items AS item ON item.id = entry.item_id
            JOIN storage_locations AS location ON location.id = entry.storage_location_id
            {$where}
            ORDER BY item.name COLLATE NOCASE, location.name COLLATE NOCASE, entry.id
        SQL);
        $statement->execute($parameters);
        return array_map(fn(array $row): array => $this->publicEntry($row), $statement->fetchAll());
    }

    public function summary(string $itemId): array
    {
        $item = $this->activeOrHistoricalItem($itemId);
        $entries = $this->list($itemId);
        if ($item['tracking_mode'] === 'COLLECTION') {
            $statement = $this->db->prepare("SELECT COUNT(*) FROM reservations WHERE item_id = :item AND status = 'ACTIVE'");
            $statement->execute(['item' => $itemId]);
            return [
                'itemId' => $itemId,
                'trackingMode' => 'COLLECTION',
                'stockUnit' => $item['stock_unit'],
                'physicalQuantity' => null,
                'reservedQuantity' => null,
                'availableQuantity' => null,
                'minimumQuantity' => null,
                'projectShortageQuantity' => 0.0,
                'globalReorderQuantity' => 0.0,
                'localReorderQuantity' => 0.0,
                'reorderQuantity' => 0.0,
                'bookingCount' => (int) $statement->fetchColumn(),
                'locationCount' => count(array_filter($entries, static fn(array $entry): bool => $entry['status'] === 'ACTIVE')),
                'localShortages' => [],
                'entries' => $entries,
            ];
        }
        $physical = round(array_sum(array_column($entries, 'quantity')), 6);
        $statement = $this->db->prepare("SELECT COALESCE(SUM(requested_quantity - fulfilled_quantity), 0) FROM reservations WHERE item_id = :item AND status = 'ACTIVE'");
        $statement->execute(['item' => $itemId]);
        $reserved = round((float) $statement->fetchColumn(), 6);
        $available = round($physical - $reserved, 6);
        $minimum = $item['default_minimum_quantity'] === null ? null : (float) $item['default_minimum_quantity'];
        $globalReorder = round(max(($minimum ?? 0) - $available, 0), 6);
        $localShortages = [];
        foreach ($entries as $entry) {
            if ($entry['locationStatus'] !== 'ACTIVE' || $entry['minimumQuantity'] === null || $entry['quantity'] >= $entry['minimumQuantity']) continue;
            $localShortages[] = [
                'stockEntryId' => $entry['id'],
                'storageLocationId' => $entry['storageLocationId'],
                'locationName' => $entry['locationName'],
                'locationPath' => $entry['locationPath'],
                'quantity' => $entry['quantity'],
                'minimumQuantity' => $entry['minimumQuantity'],
                'shortageQuantity' => round($entry['minimumQuantity'] - $entry['quantity'], 6),
            ];
        }
        $localReorder = round(array_sum(array_column($localShortages, 'shortageQuantity')), 6);
        return [
            'itemId' => $itemId,
            'trackingMode' => 'QUANTITY',
            'stockUnit' => $item['stock_unit'],
            'physicalQuantity' => $physical,
            'reservedQuantity' => $reserved,
            'availableQuantity' => $available,
            'minimumQuantity' => $minimum,
            'projectShortageQuantity' => round(max(-$available, 0), 6),
            'globalReorderQuantity' => $globalReorder,
            'localReorderQuantity' => $localReorder,
            'reorderQuantity' => max($globalReorder, $localReorder),
            'localShortages' => $localShortages,
            'entries' => $entries,
        ];
    }

    public function overview(array $itemIds): array
    {
        $ids = array_values(array_unique($itemIds));
        if (count($ids) > 10000) throw new HttpError(422, 'Zu viele Artikel für die Bestandsübersicht.');
        foreach ($ids as $id) $this->assertId((string) $id, 'Artikel');
        if (!$ids) return [];

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $physical = [];
        $statement = $this->db->prepare("SELECT item_id, COALESCE(SUM(quantity), 0) AS quantity FROM stock_entries WHERE status = 'ACTIVE' AND item_id IN ({$placeholders}) GROUP BY item_id");
        $statement->execute($ids);
        foreach ($statement->fetchAll() as $row) $physical[(string) $row['item_id']] = round((float) $row['quantity'], 6);

        $reserved = [];
        $statement = $this->db->prepare("SELECT item_id, COALESCE(SUM(requested_quantity - fulfilled_quantity), 0) AS quantity FROM reservations WHERE status = 'ACTIVE' AND item_id IN ({$placeholders}) GROUP BY item_id");
        $statement->execute($ids);
        foreach ($statement->fetchAll() as $row) $reserved[(string) $row['item_id']] = round((float) $row['quantity'], 6);

        $modes = [];
        $statement = $this->db->prepare("SELECT id, tracking_mode FROM inventory_items WHERE id IN ({$placeholders})");
        $statement->execute($ids);
        foreach ($statement->fetchAll() as $row) $modes[(string) $row['id']] = (string) $row['tracking_mode'];

        $bookings = [];
        $statement = $this->db->prepare("SELECT item_id, COUNT(*) AS quantity FROM reservations WHERE status = 'ACTIVE' AND item_id IN ({$placeholders}) GROUP BY item_id");
        $statement->execute($ids);
        foreach ($statement->fetchAll() as $row) $bookings[(string) $row['item_id']] = (int) $row['quantity'];

        $overview = [];
        foreach ($ids as $id) {
            $itemId = (string) $id;
            if (($modes[$itemId] ?? 'QUANTITY') === 'COLLECTION') {
                $overview[$itemId] = ['physicalQuantity' => null, 'reservedQuantity' => null, 'availableQuantity' => null, 'bookingCount' => $bookings[$itemId] ?? 0];
                continue;
            }
            $physicalQuantity = $physical[$itemId] ?? 0.0;
            $reservedQuantity = $reserved[$itemId] ?? 0.0;
            $overview[$itemId] = [
                'physicalQuantity' => $physicalQuantity,
                'reservedQuantity' => $reservedQuantity,
                'availableQuantity' => round($physicalQuantity - $reservedQuantity, 6),
            ];
        }
        return $overview;
    }

    public function replenishment(string $query = '', bool $includeSatisfied = false, string $sort = 'urgency'): array
    {
        $query = trim($query);
        if (mb_strlen($query) > 200) throw new HttpError(422, 'Der Suchbegriff ist zu lang.');
        if (!in_array($sort, ['urgency', 'name', 'available', 'reorder'], true)) throw new HttpError(422, 'Ungültige Sortierung.');
        $conditions = ["status = 'ACTIVE'", "tracking_mode = 'QUANTITY'"];
        $parameters = [];
        if ($query !== '') {
            $conditions[] = '(name LIKE :query ESCAPE \'\\\' OR description LIKE :query ESCAPE \'\\\' OR manufacturer LIKE :query ESCAPE \'\\\' OR article_number LIKE :query ESCAPE \'\\\' OR barcode LIKE :query ESCAPE \'\\\')';
            $parameters['query'] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
        }
        $where = implode(' AND ', $conditions);
        $statement = $this->db->prepare(<<<SQL
            SELECT id, name, stock_unit, manufacturer, article_number, merchant_url,
                   default_minimum_quantity
            FROM inventory_items
            WHERE {$where}
            ORDER BY name COLLATE NOCASE, id
        SQL);
        $statement->execute($parameters);
        $items = [];
        foreach ($statement->fetchAll() as $item) {
            $summary = $this->summary((string) $item['id']);
            if (!$includeSatisfied && $summary['reorderQuantity'] <= 0) continue;
            $items[] = [
                'itemId' => (string) $item['id'], 'name' => (string) $item['name'],
                'stockUnit' => (string) $item['stock_unit'], 'manufacturer' => (string) $item['manufacturer'],
                'articleNumber' => (string) $item['article_number'], 'merchantUrl' => (string) $item['merchant_url'],
                ...$summary,
            ];
        }
        usort($items, static function (array $left, array $right) use ($sort): int {
            return match ($sort) {
                'name' => strcasecmp((string) $left['name'], (string) $right['name']) ?: strcmp((string) $left['itemId'], (string) $right['itemId']),
                'available' => $left['availableQuantity'] <=> $right['availableQuantity'] ?: strcasecmp((string) $left['name'], (string) $right['name']),
                'reorder' => $right['reorderQuantity'] <=> $left['reorderQuantity'] ?: strcasecmp((string) $left['name'], (string) $right['name']),
                default => (($right['projectShortageQuantity'] > 0) <=> ($left['projectShortageQuantity'] > 0))
                    ?: $right['reorderQuantity'] <=> $left['reorderQuantity']
                    ?: $left['availableQuantity'] <=> $right['availableQuantity']
                    ?: strcasecmp((string) $left['name'], (string) $right['name']),
            };
        });
        $unitTotals = [];
        foreach ($items as $item) {
            if ($item['reorderQuantity'] <= 0) continue;
            $unitTotals[$item['stockUnit']] = round(($unitTotals[$item['stockUnit']] ?? 0) + $item['reorderQuantity'], 6);
        }
        ksort($unitTotals, SORT_NATURAL | SORT_FLAG_CASE);
        return [
            'items' => $items,
            'summary' => [
                'itemCount' => count($items),
                'projectShortageCount' => count(array_filter($items, static fn(array $item): bool => $item['projectShortageQuantity'] > 0)),
                'localShortageCount' => count(array_filter($items, static fn(array $item): bool => $item['localReorderQuantity'] > 0)),
                'unitTotals' => $unitTotals,
            ],
        ];
    }

    public function create(array $input, string $actor): array
    {
        return $this->transaction(function () use ($input, $actor): array {
            $itemId = $this->requiredId($input['itemId'] ?? null, 'Artikel');
            $locationId = $this->requiredId($input['storageLocationId'] ?? null, 'Lagerort');
            $item = $this->activeItem($itemId);
            $this->activeLocation($locationId);
            if ($this->findEntry($itemId, $locationId) !== null) throw new HttpError(409, 'Für diesen Artikel und Lagerort gibt es bereits einen Bestandseintrag.');
            $isCollection = $item['tracking_mode'] === 'COLLECTION';
            if ($isCollection && (float) ($input['initialQuantity'] ?? 0) !== 0.0) throw new HttpError(422, 'Lose Sammlungen werden ohne Anfangsmenge angelegt.');
            if ($isCollection && ($input['minimumQuantity'] ?? null) !== null && ($input['minimumQuantity'] ?? '') !== '') throw new HttpError(422, 'Lose Sammlungen besitzen keinen Mindestbestand.');
            $initial = $isCollection ? 0.0 : $this->quantity($input['initialQuantity'] ?? 0, (string) $item['stock_unit'], true, 'Die Anfangsmenge');
            $minimum = $isCollection ? null : $this->nullableQuantity($input['minimumQuantity'] ?? null, (string) $item['stock_unit'], 'Der lokale Mindestbestand');
            $note = $this->text($input['note'] ?? '', 2000, 'Die Notiz');
            $entryId = randomId('stock-');
            $createdAt = nowIso();
            $statement = $this->db->prepare('INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, minimum_quantity, note, status, created_at, updated_at) VALUES (:id, :item, :location, 0, :minimum, :note, \'ACTIVE\', :created, \'\')');
            $statement->execute(['id' => $entryId, 'item' => $itemId, 'location' => $locationId, 'minimum' => $minimum, 'note' => $note, 'created' => $createdAt]);
            if ($initial > 0) {
                $this->changeEntryQuantity($entryId, $initial);
                $this->insertTransaction($itemId, 'RECEIPT', $initial, null, $locationId, $note !== '' ? $note : 'Anfangsbestand', $actor);
            }
            return $this->getEntry($entryId);
        });
    }

    public function update(string $id, array $input): array
    {
        return $this->transaction(function () use ($id, $input): array {
            $entry = $this->getEntry($id);
            if ($entry['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Bestandseinträge können nicht bearbeitet werden.');
            $item = $this->activeItem($entry['itemId']);
            $isCollection = $item['tracking_mode'] === 'COLLECTION';
            $minimum = !$isCollection && array_key_exists('minimumQuantity', $input)
                ? $this->nullableQuantity($input['minimumQuantity'], (string) $item['stock_unit'], 'Der lokale Mindestbestand')
                : ($isCollection ? null : $entry['minimumQuantity']);
            $note = array_key_exists('note', $input) ? $this->text($input['note'], 2000, 'Die Notiz') : $entry['note'];
            $locationId = $entry['storageLocationId'];
            if (array_key_exists('storageLocationId', $input)) {
                if (!$isCollection) throw new HttpError(422, 'Artikel mit Mengenerfassung werden über eine Bestandsbewegung umgelagert.');
                $locationId = $this->requiredId($input['storageLocationId'], 'Ziellagerort');
                $this->activeLocation($locationId);
                $existing = $this->findEntry($entry['itemId'], $locationId);
                if ($existing !== null && $existing['id'] !== $id) throw new HttpError(409, 'Diese lose Sammlung ist dem Ziellagerort bereits zugeordnet.');
            }
            $statement = $this->db->prepare('UPDATE stock_entries SET storage_location_id = :location, minimum_quantity = :minimum, note = :note, updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
            $statement->execute(['location' => $locationId, 'minimum' => $minimum, 'note' => $note, 'updated' => nowIso(), 'id' => $id]);
            return $this->getEntry($id);
        });
    }

    public function delete(string $id): bool
    {
        return $this->transaction(function () use ($id): bool {
            $entry = $this->getEntry($id);
            if ($entry['quantity'] > 0) throw new HttpError(409, 'Ein Lagerplatz kann erst mit Menge 0 entfernt werden.');
            $this->deleteEntry($id);
            return true;
        });
    }

    public function record(array $input, string $actor): array
    {
        return $this->transaction(function () use ($input, $actor): array {
            $type = strtoupper(trim((string) ($input['type'] ?? '')));
            $itemId = $this->requiredId($input['itemId'] ?? null, 'Artikel');
            $item = $this->activeItem($itemId);
            if ($item['tracking_mode'] === 'COLLECTION') throw new HttpError(409, 'Lose Sammlungen werden ohne Mengenbuchungen geführt.');
            $unit = (string) $item['stock_unit'];
            $note = $this->text($input['note'] ?? '', 2000, 'Die Buchungsnotiz');

            if (in_array($type, self::INBOUND_TYPES, true)) {
                $destination = $this->requiredId($input['destinationStorageLocationId'] ?? null, 'Ziellagerort');
                $this->activeLocation($destination);
                $quantity = $this->quantity($input['quantity'] ?? null, $unit, false, 'Die Menge');
                $entry = $this->activeEntry($itemId, $destination, true);
                $this->changeEntryQuantity($entry['id'], $quantity);
                $transaction = $this->insertTransaction($itemId, $type, $quantity, null, $destination, $note, $actor);
                return $this->movementResult($itemId, $transaction);
            }

            if (in_array($type, self::OUTBOUND_TYPES, true)) {
                $source = $this->requiredId($input['sourceStorageLocationId'] ?? null, 'Quelllagerort');
                $this->activeLocation($source);
                $quantity = $this->quantity($input['quantity'] ?? null, $unit, false, 'Die Menge');
                $entry = $this->activeEntry($itemId, $source);
                $this->subtractEntryQuantity($entry['id'], $quantity);
                $transaction = $this->insertTransaction($itemId, $type, $quantity, $source, null, $note, $actor);
                return $this->movementResult($itemId, $transaction);
            }

            if ($type === 'TRANSFER') {
                $source = $this->requiredId($input['sourceStorageLocationId'] ?? null, 'Quelllagerort');
                $destination = $this->requiredId($input['destinationStorageLocationId'] ?? null, 'Ziellagerort');
                if ($source === $destination) throw new HttpError(422, 'Quelle und Ziel der Umlagerung müssen verschieden sein.');
                $this->activeLocation($source);
                $this->activeLocation($destination);
                $quantity = $this->quantity($input['quantity'] ?? null, $unit, false, 'Die Menge');
                $sourceEntry = $this->activeEntry($itemId, $source);
                $destinationEntry = $this->activeEntry($itemId, $destination, true);
                $this->subtractEntryQuantity($sourceEntry['id'], $quantity);
                $this->changeEntryQuantity($destinationEntry['id'], $quantity);
                if (abs($sourceEntry['quantity'] - $quantity) < 0.000001) {
                    $this->deleteEntry($sourceEntry['id']);
                }
                $transaction = $this->insertTransaction($itemId, 'TRANSFER', $quantity, $source, $destination, $note, $actor);
                return $this->movementResult($itemId, $transaction);
            }

            if ($type === 'CORRECTION') {
                $location = $this->requiredId($input['storageLocationId'] ?? null, 'Lagerort');
                $this->activeLocation($location);
                $entry = $this->activeEntry($itemId, $location, true);
                $counted = $this->quantity($input['countedQuantity'] ?? null, $unit, true, 'Die gezählte Menge');
                $difference = round($counted - $entry['quantity'], 6);
                if ($difference === 0.0) return ['changed' => false, 'transaction' => null, 'summary' => $this->summary($itemId)];
                if ($difference > 0) $this->changeEntryQuantity($entry['id'], $difference);
                else $this->subtractEntryQuantity($entry['id'], abs($difference));
                $transaction = $this->insertTransaction($itemId, 'CORRECTION', abs($difference), $difference < 0 ? $location : null, $difference > 0 ? $location : null, $note, $actor);
                return $this->movementResult($itemId, $transaction);
            }

            throw new HttpError(422, 'Ungültige Bestandsbewegung.');
        });
    }

    public function transactions(?string $itemId = null, ?string $locationId = null, int $limit = 100): array
    {
        if ($itemId === null && $locationId === null) throw new HttpError(422, 'Artikel oder Lagerort wird benötigt.');
        if ($itemId !== null) $this->assertId($itemId, 'Artikel');
        if ($locationId !== null) $this->assertId($locationId, 'Lagerort');
        $limit = max(1, min(500, $limit));
        $conditions = [];
        $parameters = [];
        if ($itemId !== null) {
            $conditions[] = 'movement.item_id = :item';
            $parameters['item'] = $itemId;
        }
        if ($locationId !== null) {
            $conditions[] = '(movement.source_storage_location_id = :location OR movement.destination_storage_location_id = :location)';
            $parameters['location'] = $locationId;
        }
        $parameters['limit'] = $limit;
        $where = implode(' AND ', $conditions);
        $statement = $this->db->prepare(<<<SQL
            SELECT movement.id, movement.item_id, movement.type, movement.quantity,
                   movement.source_storage_location_id, movement.destination_storage_location_id,
                   movement.reservation_id, movement.reversal_of_transaction_id, movement.note,
                   movement.recorded_by, movement.occurred_at, movement.created_at,
                   item.name AS item_name, item.stock_unit,
                   source.name AS source_name, destination.name AS destination_name
            FROM stock_transactions AS movement
            JOIN inventory_items AS item ON item.id = movement.item_id
            LEFT JOIN storage_locations AS source ON source.id = movement.source_storage_location_id
            LEFT JOIN storage_locations AS destination ON destination.id = movement.destination_storage_location_id
            WHERE {$where}
            ORDER BY movement.occurred_at DESC, movement.rowid DESC
            LIMIT :limit
        SQL);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        foreach ($parameters as $key => $value) {
            if ($key !== 'limit') $statement->bindValue(':' . $key, $value);
        }
        $statement->execute();
        return array_map(fn(array $row): array => $this->publicTransaction($row), $statement->fetchAll());
    }

    private function movementResult(string $itemId, array $transaction): array
    {
        return ['changed' => true, 'transaction' => $transaction, 'summary' => $this->summary($itemId)];
    }

    private function insertTransaction(string $itemId, string $type, float $quantity, ?string $source, ?string $destination, string $note, string $actor): array
    {
        $transaction = [
            'id' => randomId('transaction-'), 'itemId' => $itemId, 'type' => $type,
            'quantity' => $quantity, 'sourceStorageLocationId' => $source,
            'destinationStorageLocationId' => $destination, 'reservationId' => null,
            'reversalOfTransactionId' => null, 'note' => $note, 'recordedBy' => $actor,
            'occurredAt' => nowIso(), 'createdAt' => nowIso(),
        ];
        $statement = $this->db->prepare(<<<'SQL'
            INSERT INTO stock_transactions (
                id, item_id, type, quantity, source_storage_location_id,
                destination_storage_location_id, reservation_id, reversal_of_transaction_id,
                note, recorded_by, occurred_at, created_at
            ) VALUES (
                :id, :item, :type, :quantity, :source, :destination,
                NULL, NULL, :note, :actor, :occurred, :created
            )
        SQL);
        $statement->execute([
            'id' => $transaction['id'], 'item' => $itemId, 'type' => $type,
            'quantity' => $quantity, 'source' => $source, 'destination' => $destination,
            'note' => $note, 'actor' => $actor, 'occurred' => $transaction['occurredAt'],
            'created' => $transaction['createdAt'],
        ]);
        return $transaction;
    }

    private function activeEntry(string $itemId, string $locationId, bool $create = false): array
    {
        $entry = $this->findEntry($itemId, $locationId);
        if ($entry === null && $create) {
            $id = randomId('stock-');
            $statement = $this->db->prepare('INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, status, created_at, updated_at) VALUES (:id, :item, :location, 0, \'ACTIVE\', :created, \'\')');
            $statement->execute(['id' => $id, 'item' => $itemId, 'location' => $locationId, 'created' => nowIso()]);
            return $this->getEntry($id);
        }
        if ($entry !== null && $create && $entry['status'] === 'ARCHIVED') {
            $this->setEntryStatus($entry['id'], 'ACTIVE');
            return $this->getEntry($entry['id']);
        }
        if ($entry === null || $entry['status'] !== 'ACTIVE') throw new HttpError(409, 'Für diesen Lagerort gibt es keinen aktiven Bestandseintrag.');
        return $entry;
    }

    private function findEntry(string $itemId, string $locationId): ?array
    {
        $statement = $this->db->prepare('SELECT id FROM stock_entries WHERE item_id = :item AND storage_location_id = :location');
        $statement->execute(['item' => $itemId, 'location' => $locationId]);
        $id = $statement->fetchColumn();
        return $id === false ? null : $this->getEntry((string) $id);
    }

    private function getEntry(string $id): array
    {
        $this->assertId($id, 'Bestandseintrag');
        $statement = $this->db->prepare(<<<'SQL'
            SELECT entry.id, entry.item_id, entry.storage_location_id, entry.quantity,
                   entry.minimum_quantity, entry.note, entry.status, entry.created_at, entry.updated_at,
                   item.name AS item_name, item.stock_unit, item.tracking_mode, item.status AS item_status,
                   location.name AS location_name, location.status AS location_status
            FROM stock_entries AS entry
            JOIN inventory_items AS item ON item.id = entry.item_id
            JOIN storage_locations AS location ON location.id = entry.storage_location_id
            WHERE entry.id = :id
        SQL);
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Bestandseintrag nicht gefunden.');
        return $this->publicEntry($row);
    }

    private function publicEntry(array $row): array
    {
        $collection = ($row['tracking_mode'] ?? 'QUANTITY') === 'COLLECTION';
        return [
            'id' => (string) $row['id'], 'itemId' => (string) $row['item_id'],
            'storageLocationId' => (string) $row['storage_location_id'],
            'quantity' => $collection ? null : (float) $row['quantity'],
            'minimumQuantity' => $collection || $row['minimum_quantity'] === null ? null : (float) $row['minimum_quantity'],
            'note' => (string) $row['note'], 'status' => (string) $row['status'],
            'itemName' => (string) $row['item_name'], 'stockUnit' => (string) $row['stock_unit'],
            'trackingMode' => (string) ($row['tracking_mode'] ?? 'QUANTITY'),
            'itemStatus' => (string) $row['item_status'], 'locationName' => (string) $row['location_name'],
            'locationStatus' => (string) $row['location_status'],
            'locationPath' => $this->locationPath((string) $row['storage_location_id']),
            'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'],
        ];
    }

    private function publicTransaction(array $row): array
    {
        return [
            'id' => (string) $row['id'], 'itemId' => (string) $row['item_id'],
            'itemName' => (string) $row['item_name'], 'stockUnit' => (string) $row['stock_unit'],
            'type' => (string) $row['type'], 'quantity' => (float) $row['quantity'],
            'sourceStorageLocationId' => $row['source_storage_location_id'] ?: null,
            'sourceName' => (string) ($row['source_name'] ?? ''),
            'destinationStorageLocationId' => $row['destination_storage_location_id'] ?: null,
            'destinationName' => (string) ($row['destination_name'] ?? ''),
            'reservationId' => $row['reservation_id'] ?: null,
            'reversalOfTransactionId' => $row['reversal_of_transaction_id'] ?: null,
            'note' => (string) $row['note'], 'recordedBy' => (string) $row['recorded_by'],
            'occurredAt' => (string) $row['occurred_at'], 'createdAt' => (string) $row['created_at'],
        ];
    }

    private function locationPath(string $id): array
    {
        $path = [];
        $seen = [];
        $statement = $this->db->prepare('SELECT id, parent_id, name FROM storage_locations WHERE id = :id');
        for ($currentId = $id; $currentId !== null;) {
            if (isset($seen[$currentId])) throw new HttpError(409, 'Der Lagerbaum enthält einen ungültigen Zyklus.');
            $seen[$currentId] = true;
            $statement->execute(['id' => $currentId]);
            $row = $statement->fetch();
            if (!$row) break;
            array_unshift($path, ['id' => (string) $row['id'], 'name' => (string) $row['name']]);
            $currentId = $row['parent_id'] ?: null;
        }
        return $path;
    }

    private function activeItem(string $id): array
    {
        $item = $this->activeOrHistoricalItem($id);
        if ($item['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Artikel können nicht gebucht werden.');
        return $item;
    }

    private function activeOrHistoricalItem(string $id): array
    {
        $this->assertId($id, 'Artikel');
        $statement = $this->db->prepare('SELECT id, stock_unit, tracking_mode, status, default_minimum_quantity FROM inventory_items WHERE id = :id');
        $statement->execute(['id' => $id]);
        $item = $statement->fetch();
        if (!$item) throw new HttpError(404, 'Artikel nicht gefunden.');
        return $item;
    }

    private function activeLocation(string $id): array
    {
        $this->assertId($id, 'Lagerort');
        $statement = $this->db->prepare('SELECT id, status FROM storage_locations WHERE id = :id');
        $statement->execute(['id' => $id]);
        $location = $statement->fetch();
        if (!$location) throw new HttpError(404, 'Lagerort nicht gefunden.');
        if ($location['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Lagerorte können nicht gebucht werden.');
        return $location;
    }

    private function changeEntryQuantity(string $id, float $quantity): void
    {
        $statement = $this->db->prepare('UPDATE stock_entries SET quantity = round(quantity + :quantity, 6), updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
        $statement->execute(['quantity' => $quantity, 'updated' => nowIso(), 'id' => $id]);
        if ($statement->rowCount() !== 1) throw new HttpError(409, 'Der Bestand konnte nicht aktualisiert werden.');
    }

    private function subtractEntryQuantity(string $id, float $quantity): void
    {
        $statement = $this->db->prepare('UPDATE stock_entries SET quantity = round(quantity - :quantity, 6), updated_at = :updated WHERE id = :id AND status = \'ACTIVE\' AND quantity >= :quantity');
        $statement->execute(['quantity' => $quantity, 'updated' => nowIso(), 'id' => $id]);
        if ($statement->rowCount() !== 1) throw new HttpError(409, 'Die Menge überschreitet den vorhandenen physischen Bestand.');
    }

    private function setEntryStatus(string $id, string $status): void
    {
        $statement = $this->db->prepare('UPDATE stock_entries SET status = :status, updated_at = :updated WHERE id = :id');
        $statement->execute(['status' => $status, 'updated' => nowIso(), 'id' => $id]);
    }

    private function deleteEntry(string $id): void
    {
        $statement = $this->db->prepare('DELETE FROM stock_entries WHERE id = :id AND quantity = 0');
        $statement->execute(['id' => $id]);
        if ($statement->rowCount() !== 1) throw new HttpError(409, 'Der Lagerplatz konnte nicht entfernt werden.');
    }

    private function nullableQuantity(mixed $value, string $unit, string $label): ?float
    {
        return $value === null || $value === '' ? null : $this->quantity($value, $unit, true, $label);
    }

    private function quantity(mixed $value, string $unit, bool $allowZero, string $label): float
    {
        if (!is_int($value) && !is_float($value) && !is_string($value)) throw new HttpError(422, "{$label} ist ungültig.");
        $normalized = str_replace(',', '.', trim((string) $value));
        if ($normalized === '' || !is_numeric($normalized)) throw new HttpError(422, "{$label} ist ungültig.");
        $quantity = round((float) $normalized, 6);
        if (!is_finite($quantity) || ($allowZero ? $quantity < 0 : $quantity <= 0) || $quantity > 1_000_000_000_000) throw new HttpError(422, "{$label} ist ungültig.");
        if (mb_strtolower($unit) === 'stück' && floor($quantity) !== $quantity) throw new HttpError(422, "{$label} muss für die Einheit Stück ganzzahlig sein.");
        return $quantity;
    }

    private function text(mixed $value, int $maximum, string $label): string
    {
        $text = trim((string) $value);
        if (mb_strlen($text) > $maximum) throw new HttpError(422, "{$label} darf höchstens {$maximum} Zeichen lang sein.");
        return $text;
    }

    private function requiredId(mixed $value, string $label): string
    {
        $id = trim((string) ($value ?? ''));
        $this->assertId($id, $label);
        return $id;
    }

    private function assertId(string $id, string $label): void
    {
        if (!validId($id)) throw new HttpError(422, "{$label} ist ungültig.");
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
