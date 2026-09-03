<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryReservationStore
{
    private const CLOSED_STATUSES = ['RELEASED', 'CANCELLED'];

    public function __construct(private readonly PDO $db, private readonly ProjectStore $projects) {}

    public function detail(string $id): array
    {
        $this->assertId($id, 'Reservierung');
        $statement = $this->db->prepare(<<<'SQL'
            SELECT reservation.*, item.name AS item_name, item.stock_unit, item.tracking_mode, item.status AS item_status
            FROM reservations AS reservation
            JOIN inventory_items AS item ON item.id = reservation.item_id
            WHERE reservation.id = :id
        SQL);
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Reservierung nicht gefunden.');
        return $this->publicReservation($row);
    }

    public function list(?string $itemId = null, ?string $projectId = null, ?array $visibleProjectIds = null): array
    {
        if ($itemId === null && $projectId === null) throw new HttpError(422, 'Artikel oder Projekt wird benötigt.');
        $conditions = [];
        $parameters = [];
        if ($itemId !== null) {
            $this->assertId($itemId, 'Artikel');
            $conditions[] = 'reservation.item_id = :item';
            $parameters['item'] = $itemId;
        }
        if ($projectId !== null) {
            $this->assertId($projectId, 'Projekt');
            $conditions[] = 'reservation.project_id = :project';
            $parameters['project'] = $projectId;
        }
        if ($visibleProjectIds !== null) {
            $visibleProjectIds = array_values(array_unique(array_filter($visibleProjectIds, fn(mixed $id): bool => is_string($id) && validId($id))));
            if (!$visibleProjectIds) return [];
            $placeholders = [];
            foreach ($visibleProjectIds as $index => $id) {
                $key = 'visible' . $index;
                $placeholders[] = ':' . $key;
                $parameters[$key] = $id;
            }
            $conditions[] = 'reservation.project_id IN (' . implode(', ', $placeholders) . ')';
        }
        $where = implode(' AND ', $conditions);
        $statement = $this->db->prepare(<<<SQL
            SELECT reservation.*, item.name AS item_name, item.stock_unit, item.tracking_mode, item.status AS item_status
            FROM reservations AS reservation
            JOIN inventory_items AS item ON item.id = reservation.item_id
            WHERE {$where}
            ORDER BY CASE reservation.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                     reservation.created_at DESC, reservation.rowid DESC
        SQL);
        $statement->execute($parameters);
        return array_map(fn(array $row): array => $this->publicReservation($row), $statement->fetchAll());
    }

    public function create(array $input, string $actor): array
    {
        return $this->transaction(function () use ($input, $actor): array {
            $itemId = $this->requiredId($input['itemId'] ?? null, 'Artikel');
            $projectId = $this->requiredId($input['projectId'] ?? null, 'Projekt');
            $item = $this->item($itemId, true);
            [$collection, $entryId] = $this->targetInput($input);
            $target = $this->projects->reservationTarget($projectId, $collection, $entryId);
            if (in_array($target['project']['status'], ['completed', 'archived', 'trashed'], true)) {
                throw new HttpError(409, 'Für abgeschlossene, archivierte oder gelöschte Projekte können keine neuen Reservierungen angelegt werden.');
            }
            $isCollection = $item['tracking_mode'] === 'COLLECTION';
            if ($isCollection) {
                $duplicate = $this->db->prepare("SELECT 1 FROM reservations WHERE item_id = :item AND project_id = :project AND status = 'ACTIVE' LIMIT 1");
                $duplicate->execute(['item' => $itemId, 'project' => $projectId]);
                if ($duplicate->fetchColumn()) throw new HttpError(409, 'Diese lose Sammlung ist bereits auf dieses Projekt gebucht.');
            }
            $quantity = $isCollection ? 1.0 : $this->quantity($input['requestedQuantity'] ?? null, (string) $item['stock_unit'], 'Die reservierte Menge');
            $now = nowIso();
            $id = randomId('reservation-');
            $statement = $this->db->prepare(<<<'SQL'
                INSERT INTO reservations (
                    id, item_id, project_id, project_entry_collection, project_entry_id,
                    requested_quantity, fulfilled_quantity, status, note, created_by,
                    created_at, updated_at, closed_at
                ) VALUES (
                    :id, :item, :project, :collection, :entry, :quantity, 0, 'ACTIVE',
                    :note, :actor, :created, :updated, NULL
                )
            SQL);
            $statement->execute([
                'id' => $id, 'item' => $itemId, 'project' => $projectId,
                'collection' => $collection, 'entry' => $entryId, 'quantity' => $quantity,
                'note' => $this->text($input['note'] ?? '', 2000), 'actor' => $actor,
                'created' => $now, 'updated' => $now,
            ]);
            return $this->detail($id);
        });
    }

    public function update(string $id, array $input): array
    {
        return $this->transaction(function () use ($id, $input): array {
            $reservation = $this->detail($id);
            if ($reservation['status'] !== 'ACTIVE') throw new HttpError(409, 'Nur aktive Reservierungen können bearbeitet werden.');
            $item = $this->item($reservation['itemId']);
            $isCollection = $item['tracking_mode'] === 'COLLECTION';
            $requested = $isCollection
                ? 1.0
                : (array_key_exists('requestedQuantity', $input)
                    ? $this->quantity($input['requestedQuantity'], (string) $item['stock_unit'], 'Die reservierte Menge')
                    : $reservation['requestedQuantity']);
            if (!$isCollection && $requested <= $reservation['fulfilledQuantity']) {
                throw new HttpError(422, 'Die reservierte Menge muss größer als die bereits erfüllte Menge sein.');
            }
            $targetInput = array_key_exists('projectEntryCollection', $input) || array_key_exists('projectEntryId', $input)
                ? $input
                : ['projectEntryCollection' => $reservation['projectEntryCollection'], 'projectEntryId' => $reservation['projectEntryId']];
            [$collection, $entryId] = $this->targetInput($targetInput);
            $this->projects->reservationTarget($reservation['projectId'], $collection, $entryId);
            $note = array_key_exists('note', $input) ? $this->text($input['note'], 2000) : $reservation['note'];
            $statement = $this->db->prepare('UPDATE reservations SET requested_quantity = :requested, project_entry_collection = :collection, project_entry_id = :entry, note = :note, updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
            $statement->execute(['requested' => $requested, 'collection' => $collection, 'entry' => $entryId, 'note' => $note, 'updated' => nowIso(), 'id' => $id]);
            return $this->detail($id);
        });
    }

    public function close(string $id, string $status): array
    {
        $status = strtoupper(trim($status));
        if (!in_array($status, self::CLOSED_STATUSES, true)) throw new HttpError(422, 'Ungültiger Abschlussstatus.');
        return $this->transaction(function () use ($id, $status): array {
            $reservation = $this->detail($id);
            if ($reservation['status'] !== 'ACTIVE') throw new HttpError(409, 'Die Reservierung ist nicht mehr aktiv.');
            $now = nowIso();
            $statement = $this->db->prepare('UPDATE reservations SET status = :status, updated_at = :updated, closed_at = :closed WHERE id = :id AND status = \'ACTIVE\'');
            $statement->execute(['status' => $status, 'updated' => $now, 'closed' => $now, 'id' => $id]);
            return $this->detail($id);
        });
    }

    public function fulfill(string $id, array $input, string $actor): array
    {
        return $this->transaction(function () use ($id, $input, $actor): array {
            $reservation = $this->detail($id);
            if ($reservation['status'] !== 'ACTIVE') throw new HttpError(409, 'Die Reservierung ist nicht mehr aktiv.');
            $item = $this->item($reservation['itemId'], true);
            if ($item['tracking_mode'] === 'COLLECTION') throw new HttpError(409, 'Lose Sammlungen werden ohne Mengenentnahme auf Projekte gebucht.');
            $sourceId = $this->requiredId($input['sourceStorageLocationId'] ?? null, 'Quelllagerort');
            $this->activeLocation($sourceId);
            $quantity = $this->quantity($input['quantity'] ?? null, (string) $item['stock_unit'], 'Die erfüllte Menge');
            if ($quantity > $reservation['remainingQuantity']) throw new HttpError(422, 'Die Menge überschreitet den noch offenen Reservierungsbedarf.');
            $entry = $this->activeEntry($reservation['itemId'], $sourceId);
            $statement = $this->db->prepare('UPDATE stock_entries SET quantity = round(quantity - :quantity, 6), updated_at = :updated WHERE id = :id AND status = \'ACTIVE\' AND quantity >= :quantity');
            $statement->execute(['quantity' => $quantity, 'updated' => nowIso(), 'id' => $entry['id']]);
            if ($statement->rowCount() !== 1) throw new HttpError(409, 'Die Menge überschreitet den vorhandenen physischen Bestand.');

            $fulfilled = round($reservation['fulfilledQuantity'] + $quantity, 6);
            $status = abs($fulfilled - $reservation['requestedQuantity']) < 0.000001 ? 'FULFILLED' : 'ACTIVE';
            $now = nowIso();
            $statement = $this->db->prepare('UPDATE reservations SET fulfilled_quantity = :fulfilled, status = :status, updated_at = :updated, closed_at = :closed WHERE id = :id AND status = \'ACTIVE\'');
            $statement->execute(['fulfilled' => $fulfilled, 'status' => $status, 'updated' => $now, 'closed' => $status === 'FULFILLED' ? $now : null, 'id' => $id]);

            $transactionId = randomId('transaction-');
            $note = $this->text($input['note'] ?? '', 2000);
            $statement = $this->db->prepare(<<<'SQL'
                INSERT INTO stock_transactions (
                    id, item_id, type, quantity, source_storage_location_id,
                    destination_storage_location_id, reservation_id, reversal_of_transaction_id,
                    note, recorded_by, occurred_at, created_at
                ) VALUES (:id, :item, 'CONSUMPTION', :quantity, :source, NULL, :reservation, NULL, :note, :actor, :occurred, :created)
            SQL);
            $statement->execute([
                'id' => $transactionId, 'item' => $reservation['itemId'], 'quantity' => $quantity,
                'source' => $sourceId, 'reservation' => $id,
                'note' => $note !== '' ? $note : 'Projektbedarf erfüllt', 'actor' => $actor,
                'occurred' => $now, 'created' => $now,
            ]);
            return ['reservation' => $this->detail($id), 'transactionId' => $transactionId];
        });
    }

    private function publicReservation(array $row): array
    {
        $target = null;
        try {
            $target = $this->projects->reservationTarget(
                (string) $row['project_id'],
                $row['project_entry_collection'] ?: null,
                $row['project_entry_id'] ?: null,
            );
        } catch (HttpError $error) {
            if ($error->status !== 404) throw $error;
        }
        $collection = ($row['tracking_mode'] ?? 'QUANTITY') === 'COLLECTION';
        $requested = $collection ? null : (float) $row['requested_quantity'];
        $fulfilled = $collection ? null : (float) $row['fulfilled_quantity'];
        return [
            'id' => (string) $row['id'], 'itemId' => (string) $row['item_id'],
            'itemName' => (string) $row['item_name'], 'stockUnit' => (string) $row['stock_unit'],
            'trackingMode' => (string) ($row['tracking_mode'] ?? 'QUANTITY'),
            'itemStatus' => (string) $row['item_status'], 'projectId' => (string) $row['project_id'],
            'projectTitle' => (string) ($target['project']['title'] ?? 'Historisches Projekt'),
            'projectStatus' => $target['project']['status'] ?? null,
            'projectEntryCollection' => $row['project_entry_collection'] ?: null,
            'projectEntryId' => $row['project_entry_id'] ?: null,
            'projectEntryTitle' => $target['entry']['title'] ?? null,
            'targetResolved' => $target !== null,
            'requestedQuantity' => $requested, 'fulfilledQuantity' => $fulfilled,
            'remainingQuantity' => $collection ? null : round($requested - $fulfilled, 6),
            'status' => (string) $row['status'], 'note' => (string) $row['note'],
            'createdBy' => (string) $row['created_by'], 'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'], 'closedAt' => $row['closed_at'] ?: null,
        ];
    }

    private function targetInput(array $input): array
    {
        $collection = trim((string) ($input['projectEntryCollection'] ?? '')) ?: null;
        $entryId = trim((string) ($input['projectEntryId'] ?? '')) ?: null;
        if (($collection === null) !== ($entryId === null)) throw new HttpError(422, 'Projektelement-Typ und -ID müssen gemeinsam angegeben werden.');
        if ($collection !== null && !in_array($collection, ProjectStore::COLLECTIONS, true)) throw new HttpError(422, 'Ungültiges Projektelement.');
        if ($entryId !== null) $this->assertId($entryId, 'Projektelement');
        return [$collection, $entryId];
    }

    private function item(string $id, bool $active = false): array
    {
        $this->assertId($id, 'Artikel');
        $statement = $this->db->prepare('SELECT id, stock_unit, tracking_mode, status FROM inventory_items WHERE id = :id');
        $statement->execute(['id' => $id]);
        $item = $statement->fetch();
        if (!$item) throw new HttpError(404, 'Artikel nicht gefunden.');
        if ($active && $item['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Artikel können nicht reserviert oder entnommen werden.');
        return $item;
    }

    private function activeLocation(string $id): void
    {
        $this->assertId($id, 'Lagerort');
        $statement = $this->db->prepare('SELECT status FROM storage_locations WHERE id = :id');
        $statement->execute(['id' => $id]);
        $status = $statement->fetchColumn();
        if ($status === false) throw new HttpError(404, 'Lagerort nicht gefunden.');
        if ($status !== 'ACTIVE') throw new HttpError(409, 'Archivierte Lagerorte können nicht gebucht werden.');
    }

    private function activeEntry(string $itemId, string $locationId): array
    {
        $statement = $this->db->prepare('SELECT id, quantity, status FROM stock_entries WHERE item_id = :item AND storage_location_id = :location');
        $statement->execute(['item' => $itemId, 'location' => $locationId]);
        $entry = $statement->fetch();
        if (!$entry || $entry['status'] !== 'ACTIVE') throw new HttpError(409, 'Für diesen Lagerort gibt es keinen aktiven Bestandseintrag.');
        return $entry;
    }

    private function quantity(mixed $value, string $unit, string $label): float
    {
        if (!is_numeric($value)) throw new HttpError(422, $label . ' ist ungültig.');
        $quantity = round((float) $value, 6);
        if (!is_finite($quantity) || $quantity <= 0 || $quantity > 1_000_000_000_000) throw new HttpError(422, $label . ' ist ungültig.');
        if (mb_strtolower(trim($unit), 'UTF-8') === 'stück' && floor($quantity) !== $quantity) throw new HttpError(422, $label . ' muss für die Einheit Stück ganzzahlig sein.');
        return $quantity;
    }

    private function text(mixed $value, int $max): string
    {
        if (!is_scalar($value) && $value !== null) throw new HttpError(422, 'Ungültiger Textwert.');
        return mb_substr(trim((string) $value), 0, $max);
    }

    private function requiredId(mixed $value, string $label): string
    {
        $id = trim((string) $value);
        $this->assertId($id, $label);
        return $id;
    }

    private function assertId(string $id, string $label): void
    {
        if (!validId($id)) throw new HttpError(422, $label . '-ID ist ungültig.');
    }

    private function transaction(callable $callback): mixed
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $result = $callback();
            $this->db->exec('COMMIT');
            return $result;
        } catch (\Throwable $error) {
            try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            throw $error;
        }
    }
}
