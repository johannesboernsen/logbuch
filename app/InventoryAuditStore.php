<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryAuditStore
{
    public function __construct(private readonly PDO $db) {}

    public function overview(int $staleDays = 365): array
    {
        $staleDays = max(1, min(3650, $staleDays));
        $requests = $this->requestRows();
        $audits = $this->db->query(<<<'SQL'
            SELECT audit.*,
                   COUNT(entry.id) AS position_count,
                   SUM(CASE WHEN entry.result = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
                   SUM(CASE WHEN entry.result NOT IN ('PENDING', 'MATCH', 'OK') THEN 1 ELSE 0 END) AS attention_count
            FROM inventory_audits AS audit
            LEFT JOIN inventory_audit_entries AS entry ON entry.audit_id = audit.id
            GROUP BY audit.id
            ORDER BY CASE audit.status WHEN 'OPEN' THEN 0 WHEN 'COMPLETED' THEN 1 ELSE 2 END, audit.created_at DESC
        SQL)->fetchAll();

        $positions = $this->db->query(<<<'SQL'
            SELECT entry.id AS stock_entry_id, entry.item_id, entry.storage_location_id,
                   entry.quantity, entry.created_at AS entry_created_at,
                   item.name AS item_name, item.stock_unit, item.tracking_mode, item.created_at AS item_created_at,
                   location.name AS location_name,
                   (SELECT MAX(movement.occurred_at) FROM stock_transactions AS movement
                    WHERE movement.item_id = entry.item_id
                      AND (movement.source_storage_location_id = entry.storage_location_id OR movement.destination_storage_location_id = entry.storage_location_id)) AS last_movement_at,
                   (SELECT MAX(check_entry.checked_at) FROM inventory_audit_entries AS check_entry
                    WHERE check_entry.item_id = entry.item_id AND check_entry.storage_location_id = entry.storage_location_id
                      AND check_entry.result NOT IN ('PENDING', 'SKIPPED')) AS last_checked_at
            FROM stock_entries AS entry
            JOIN inventory_items AS item ON item.id = entry.item_id AND item.status = 'ACTIVE'
            JOIN storage_locations AS location ON location.id = entry.storage_location_id AND location.status = 'ACTIVE'
            WHERE entry.status = 'ACTIVE'
            ORDER BY item.name COLLATE NOCASE, location.name COLLATE NOCASE
        SQL)->fetchAll();
        $cutoff = time() - ($staleDays * 86400);
        $stale = [];
        foreach ($positions as $row) {
            $activity = max(array_filter([
                strtotime((string) $row['item_created_at']) ?: 0,
                strtotime((string) $row['entry_created_at']) ?: 0,
                strtotime((string) ($row['last_movement_at'] ?? '')) ?: 0,
                strtotime((string) ($row['last_checked_at'] ?? '')) ?: 0,
            ]));
            if ($activity > $cutoff) continue;
            $stale[] = $this->publicPosition($row, gmdate('c', $activity));
        }
        usort($stale, static fn(array $a, array $b): int => strcmp($a['lastRelevantActivityAt'], $b['lastRelevantActivityAt']));

        return [
            'requests' => array_map(fn(array $row): array => $this->publicRequest($row), $requests),
            'stalePositions' => $stale,
            'audits' => array_map(fn(array $row): array => $this->publicAudit($row), $audits),
            'summary' => [
                'urgentCount' => count(array_filter($requests, static fn(array $row): bool => $row['priority'] === 'URGENT')),
                'requestCount' => count($requests),
                'staleCount' => count($stale),
                'openAuditCount' => count(array_filter($audits, static fn(array $row): bool => $row['status'] === 'OPEN')),
            ],
        ];
    }

    public function request(array $input, string $actor): array
    {
        $itemId = $this->requiredId($input['itemId'] ?? null, 'Artikel');
        $item = $this->activeItem($itemId);
        $entryId = trim((string) ($input['stockEntryId'] ?? '')) ?: null;
        if ($entryId !== null) {
            $entry = $this->activeEntry($entryId);
            if ($entry['item_id'] !== $itemId) throw new HttpError(422, 'Der Lagerplatz gehört nicht zum gewählten Artikel.');
        }
        $priority = strtoupper(trim((string) ($input['priority'] ?? 'NORMAL')));
        if (!in_array($priority, ['NORMAL', 'URGENT'], true)) throw new HttpError(422, 'Die Inventurpriorität ist ungültig.');
        $note = $this->text($input['note'] ?? '', 2000, 'Der Inventurvermerk');
        $dueAt = trim((string) ($input['dueAt'] ?? '')) ?: null;
        if ($dueAt !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueAt)) throw new HttpError(422, 'Das Prüfdatum ist ungültig.');
        $find = $entryId === null
            ? $this->db->prepare("SELECT id FROM inventory_audit_requests WHERE item_id = :item AND stock_entry_id IS NULL AND status = 'OPEN'")
            : $this->db->prepare("SELECT id FROM inventory_audit_requests WHERE stock_entry_id = :entry AND status = 'OPEN'");
        $find->execute($entryId === null ? ['item' => $itemId] : ['entry' => $entryId]);
        $existing = $find->fetchColumn();
        if ($existing !== false) {
            $statement = $this->db->prepare('UPDATE inventory_audit_requests SET priority = :priority, note = :note, due_at = :due WHERE id = :id');
            $statement->execute(['priority' => $priority, 'note' => $note, 'due' => $dueAt, 'id' => $existing]);
            return $this->getRequest((string) $existing);
        }
        $id = randomId('audit-request-');
        $statement = $this->db->prepare("INSERT INTO inventory_audit_requests (id, item_id, stock_entry_id, priority, note, due_at, status, created_by, created_at) VALUES (:id, :item, :entry, :priority, :note, :due, 'OPEN', :actor, :created)");
        $statement->execute(['id' => $id, 'item' => $item['id'], 'entry' => $entryId, 'priority' => $priority, 'note' => $note, 'due' => $dueAt, 'actor' => $actor, 'created' => nowIso()]);
        return $this->getRequest($id);
    }

    public function dismissRequest(string $id, string $actor): bool
    {
        $this->assertId($id, 'Inventurvormerkung');
        $statement = $this->db->prepare("UPDATE inventory_audit_requests SET status = 'DISMISSED', resolved_by = :actor, resolved_at = :resolved WHERE id = :id AND status = 'OPEN'");
        $statement->execute(['actor' => $actor, 'resolved' => nowIso(), 'id' => $id]);
        return $statement->rowCount() === 1;
    }

    public function createAudit(array $input, string $actor): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') $name = 'Inventur ' . date('d.m.Y');
        if (mb_strlen($name) > 160) throw new HttpError(422, 'Der Inventurname darf höchstens 160 Zeichen lang sein.');
        $locationId = trim((string) ($input['locationId'] ?? '')) ?: null;
        $categoryIds = $this->idList($input['categoryIds'] ?? [], 'Kategorie');
        $legacyCategoryId = trim((string) ($input['categoryId'] ?? '')) ?: null;
        if ($legacyCategoryId !== null && !in_array($legacyCategoryId, $categoryIds, true)) $categoryIds[] = $legacyCategoryId;
        $locationIds = null;
        if ($locationId !== null) $locationIds = $this->locationScope($this->requiredExistingId($locationId, 'storage_locations', 'Lagerort'), ($input['includeLocationDescendants'] ?? true) === true);
        $itemIds = null;
        foreach ($categoryIds as $categoryId) {
            $categoryItems = $this->categoryItemScope($this->requiredExistingId($categoryId, 'inventory_categories', 'Kategorie'), ($input['includeCategoryDescendants'] ?? true) === true);
            $itemIds = $itemIds === null ? $categoryItems : array_values(array_unique([...$itemIds, ...$categoryItems]));
        }
        $explicitItems = $this->idList($input['itemIds'] ?? [], 'Artikel');
        if ($explicitItems) $itemIds = $itemIds === null ? $explicitItems : array_values(array_intersect($itemIds, $explicitItems));
        $requestMode = strtoupper(trim((string) ($input['requestMode'] ?? 'ALL')));
        if (!in_array($requestMode, ['ALL', 'REQUESTED', 'URGENT'], true)) throw new HttpError(422, 'Der Vormerkungsfilter ist ungültig.');
        $requested = [];
        if ($requestMode !== 'ALL') {
            foreach ($this->requestRows() as $row) {
                if ($requestMode === 'URGENT' && $row['priority'] !== 'URGENT') continue;
                $requested[] = ['item' => (string) $row['item_id'], 'entry' => $row['stock_entry_id'] ? (string) $row['stock_entry_id'] : null];
            }
        }
        $rows = $this->db->query(<<<'SQL'
            SELECT entry.id AS stock_entry_id, entry.item_id, entry.storage_location_id, entry.quantity,
                   item.name AS item_name, item.stock_unit, item.tracking_mode,
                   location.name AS location_name
            FROM stock_entries AS entry
            JOIN inventory_items AS item ON item.id = entry.item_id AND item.status = 'ACTIVE'
            JOIN storage_locations AS location ON location.id = entry.storage_location_id AND location.status = 'ACTIVE'
            WHERE entry.status = 'ACTIVE'
            ORDER BY location.name COLLATE NOCASE, item.name COLLATE NOCASE, entry.id
        SQL)->fetchAll();
        $rows = array_values(array_filter($rows, static function (array $row) use ($locationIds, $itemIds, $requestMode, $requested): bool {
            if ($locationIds !== null && !in_array($row['storage_location_id'], $locationIds, true)) return false;
            if ($itemIds !== null && !in_array($row['item_id'], $itemIds, true)) return false;
            if ($requestMode === 'ALL') return true;
            foreach ($requested as $request) if ($request['item'] === $row['item_id'] && ($request['entry'] === null || $request['entry'] === $row['stock_entry_id'])) return true;
            return false;
        }));
        if (!$rows) throw new HttpError(422, 'Für diese Auswahl wurden keine aktiven Lagerpositionen gefunden.');
        if (count($rows) > 10000) throw new HttpError(422, 'Ein Inventurlauf darf höchstens 10.000 Positionen enthalten.');
        $scope = ['locationId' => $locationId, 'includeLocationDescendants' => ($input['includeLocationDescendants'] ?? true) === true, 'categoryIds' => $categoryIds, 'includeCategoryDescendants' => ($input['includeCategoryDescendants'] ?? true) === true, 'itemIds' => $explicitItems, 'requestMode' => $requestMode];
        $id = randomId('audit-run-');
        $this->transaction(function () use ($id, $name, $scope, $rows, $actor): void {
            $created = nowIso();
            $statement = $this->db->prepare("INSERT INTO inventory_audits (id, name, status, scope_json, created_by, created_at) VALUES (:id, :name, 'OPEN', :scope, :actor, :created)");
            $statement->execute(['id' => $id, 'name' => $name, 'scope' => json_encode($scope, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'actor' => $actor, 'created' => $created]);
            $insert = $this->db->prepare("INSERT INTO inventory_audit_entries (id, audit_id, item_id, stock_entry_id, storage_location_id, tracking_mode, book_quantity, result, sort_order) VALUES (:id, :audit, :item, :entry, :location, :mode, :book, 'PENDING', :sort)");
            foreach ($rows as $sort => $row) $insert->execute(['id' => randomId('audit-entry-'), 'audit' => $id, 'item' => $row['item_id'], 'entry' => $row['stock_entry_id'], 'location' => $row['storage_location_id'], 'mode' => $row['tracking_mode'], 'book' => $row['tracking_mode'] === 'COLLECTION' ? null : $row['quantity'], 'sort' => $sort]);
        });
        return $this->audit($id);
    }

    public function audit(string $id): array
    {
        $this->assertId($id, 'Inventurlauf');
        $statement = $this->db->prepare('SELECT * FROM inventory_audits WHERE id = :id');
        $statement->execute(['id' => $id]);
        $audit = $statement->fetch();
        if (!$audit) throw new HttpError(404, 'Inventurlauf nicht gefunden.');
        $entries = $this->db->prepare(<<<'SQL'
            SELECT check_entry.*, item.name AS item_name, item.stock_unit,
                   location.name AS location_name, request.priority AS request_priority, request.note AS request_note
            FROM inventory_audit_entries AS check_entry
            JOIN inventory_items AS item ON item.id = check_entry.item_id
            JOIN storage_locations AS location ON location.id = check_entry.storage_location_id
            LEFT JOIN inventory_audit_requests AS request ON request.status = 'OPEN' AND request.item_id = check_entry.item_id
              AND (request.stock_entry_id IS NULL OR request.stock_entry_id = check_entry.stock_entry_id)
            WHERE check_entry.audit_id = :id
            ORDER BY check_entry.sort_order, check_entry.id
        SQL);
        $entries->execute(['id' => $id]);
        $publicEntries = array_map(fn(array $row): array => $this->publicAuditEntry($row), $entries->fetchAll());
        $result = $this->publicAudit($audit);
        $result['entries'] = $publicEntries;
        $result['summary'] = $this->entrySummary($publicEntries);
        return $result;
    }

    public function check(string $auditId, string $entryId, array $input, string $actor): array
    {
        return $this->transaction(function () use ($auditId, $entryId, $input, $actor): array {
            $audit = $this->audit($auditId);
            if ($audit['status'] !== 'OPEN') throw new HttpError(409, 'Nur offene Inventuren können bearbeitet werden.');
            $statement = $this->db->prepare('SELECT check_entry.*, item.stock_unit FROM inventory_audit_entries AS check_entry JOIN inventory_items AS item ON item.id = check_entry.item_id WHERE check_entry.id = :entry AND check_entry.audit_id = :audit');
            $statement->execute(['entry' => $entryId, 'audit' => $auditId]);
            $entry = $statement->fetch();
            if (!$entry) throw new HttpError(404, 'Inventurposition nicht gefunden.');
            $note = $this->text($input['note'] ?? '', 2000, 'Die Prüfnotiz');
            $correctionId = null;
            $counted = null;
            if ($entry['tracking_mode'] === 'COLLECTION') {
                $result = strtoupper(trim((string) ($input['result'] ?? 'OK')));
                if (!in_array($result, ['OK', 'ATTENTION', 'NOT_FOUND', 'SKIPPED'], true)) throw new HttpError(422, 'Das Prüfergebnis ist ungültig.');
            } else {
                $resultInput = strtoupper(trim((string) ($input['result'] ?? '')));
                if (in_array($resultInput, ['NOT_FOUND', 'SKIPPED'], true)) {
                    $result = $resultInput;
                } else {
                    $counted = $this->quantity($input['countedQuantity'] ?? null, (string) $entry['stock_unit']);
                    $book = (float) $entry['book_quantity'];
                    $difference = round($counted - $book, 6);
                    if (abs($difference) < 0.000001) $result = 'MATCH';
                    elseif (($input['correctStock'] ?? true) === true) {
                        $stock = $this->activeEntry((string) $entry['stock_entry_id']);
                        $currentDifference = round($counted - (float) $stock['quantity'], 6);
                        if (abs($currentDifference) >= 0.000001) {
                            $correctionId = randomId('transaction-');
                            $location = (string) $entry['storage_location_id'];
                            $update = $this->db->prepare('UPDATE stock_entries SET quantity = :quantity, updated_at = :updated WHERE id = :id AND status = \'ACTIVE\'');
                            $update->execute(['quantity' => $counted, 'updated' => nowIso(), 'id' => $stock['id']]);
                            $movement = $this->db->prepare("INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, destination_storage_location_id, note, recorded_by, occurred_at, created_at) VALUES (:id, :item, 'CORRECTION', :quantity, :source, :destination, :note, :actor, :occurred, :created)");
                            $now = nowIso();
                            $movement->execute(['id' => $correctionId, 'item' => $entry['item_id'], 'quantity' => abs($currentDifference), 'source' => $currentDifference < 0 ? $location : null, 'destination' => $currentDifference > 0 ? $location : null, 'note' => $note !== '' ? $note : 'Korrektur aus Inventur', 'actor' => $actor, 'occurred' => $now, 'created' => $now]);
                        }
                        $result = 'CORRECTED';
                    } else $result = 'OPEN_DIFFERENCE';
                }
            }
            $checkedAt = nowIso();
            $update = $this->db->prepare('UPDATE inventory_audit_entries SET counted_quantity = :counted, result = :result, note = :note, correction_transaction_id = :correction, checked_by = :actor, checked_at = :checked WHERE id = :id');
            $update->execute(['counted' => $counted, 'result' => $result, 'note' => $note, 'correction' => $correctionId, 'actor' => $actor, 'checked' => $checkedAt, 'id' => $entryId]);
            if (!in_array($result, ['SKIPPED', 'OPEN_DIFFERENCE'], true)) $this->resolveRequests((string) $entry['item_id'], $entry['stock_entry_id'] ? (string) $entry['stock_entry_id'] : null, $actor, $checkedAt);
            return $this->audit($auditId);
        });
    }

    public function complete(string $id, string $actor): array
    {
        $audit = $this->audit($id);
        if ($audit['status'] !== 'OPEN') return $audit;
        if ($audit['summary']['pending'] > 0) throw new HttpError(409, 'Vor dem Abschluss müssen alle Positionen bearbeitet oder übersprungen werden.');
        $statement = $this->db->prepare("UPDATE inventory_audits SET status = 'COMPLETED', completed_by = :actor, completed_at = :completed WHERE id = :id AND status = 'OPEN'");
        $statement->execute(['actor' => $actor, 'completed' => nowIso(), 'id' => $id]);
        return $this->audit($id);
    }

    private function resolveRequests(string $itemId, ?string $stockEntryId, string $actor, string $checkedAt): void
    {
        if ($stockEntryId !== null) {
            $local = $this->db->prepare("UPDATE inventory_audit_requests SET status = 'RESOLVED', resolved_by = :actor, resolved_at = :resolved WHERE stock_entry_id = :entry AND status = 'OPEN'");
            $local->execute(['actor' => $actor, 'resolved' => $checkedAt, 'entry' => $stockEntryId]);
        }
        $global = $this->db->prepare("SELECT id, created_at FROM inventory_audit_requests WHERE item_id = :item AND stock_entry_id IS NULL AND status = 'OPEN'");
        $global->execute(['item' => $itemId]);
        foreach ($global->fetchAll() as $request) {
            $missing = $this->db->prepare("SELECT COUNT(*) FROM stock_entries AS stock WHERE stock.item_id = :item AND stock.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM inventory_audit_entries AS checked WHERE checked.stock_entry_id = stock.id AND checked.checked_at >= :created AND checked.result NOT IN ('PENDING','SKIPPED','OPEN_DIFFERENCE'))");
            $missing->execute(['item' => $itemId, 'created' => $request['created_at']]);
            if ((int) $missing->fetchColumn() !== 0) continue;
            $done = $this->db->prepare("UPDATE inventory_audit_requests SET status = 'RESOLVED', resolved_by = :actor, resolved_at = :resolved WHERE id = :id");
            $done->execute(['actor' => $actor, 'resolved' => $checkedAt, 'id' => $request['id']]);
        }
    }

    private function requestRows(): array
    {
        return $this->db->query(<<<'SQL'
            SELECT request.*, item.name AS item_name, item.stock_unit, item.tracking_mode,
                   entry.storage_location_id, location.name AS location_name
            FROM inventory_audit_requests AS request
            JOIN inventory_items AS item ON item.id = request.item_id
            LEFT JOIN stock_entries AS entry ON entry.id = request.stock_entry_id
            LEFT JOIN storage_locations AS location ON location.id = entry.storage_location_id
            WHERE request.status = 'OPEN' AND item.status = 'ACTIVE'
            ORDER BY CASE request.priority WHEN 'URGENT' THEN 0 ELSE 1 END,
                     CASE WHEN request.due_at IS NULL THEN 1 ELSE 0 END, request.due_at, request.created_at
        SQL)->fetchAll();
    }

    private function getRequest(string $id): array
    {
        foreach ($this->requestRows() as $row) if ($row['id'] === $id) return $this->publicRequest($row);
        throw new HttpError(404, 'Inventurvormerkung nicht gefunden.');
    }

    private function publicRequest(array $row): array
    {
        return ['id' => (string) $row['id'], 'itemId' => (string) $row['item_id'], 'itemName' => (string) $row['item_name'], 'stockEntryId' => $row['stock_entry_id'] ?: null, 'storageLocationId' => $row['storage_location_id'] ?: null, 'locationName' => $row['location_name'] ?: '', 'stockUnit' => (string) $row['stock_unit'], 'trackingMode' => (string) $row['tracking_mode'], 'priority' => (string) $row['priority'], 'note' => (string) $row['note'], 'dueAt' => $row['due_at'] ?: null, 'createdBy' => (string) $row['created_by'], 'createdAt' => (string) $row['created_at']];
    }

    private function publicAudit(array $row): array
    {
        return ['id' => (string) $row['id'], 'name' => (string) $row['name'], 'status' => (string) $row['status'], 'scope' => json_decode((string) $row['scope_json'], true) ?: [], 'positionCount' => (int) ($row['position_count'] ?? 0), 'pendingCount' => (int) ($row['pending_count'] ?? 0), 'attentionCount' => (int) ($row['attention_count'] ?? 0), 'createdBy' => (string) $row['created_by'], 'createdAt' => (string) $row['created_at'], 'completedBy' => (string) $row['completed_by'], 'completedAt' => (string) $row['completed_at']];
    }

    private function publicAuditEntry(array $row): array
    {
        return ['id' => (string) $row['id'], 'itemId' => (string) $row['item_id'], 'itemName' => (string) $row['item_name'], 'stockEntryId' => $row['stock_entry_id'] ?: null, 'storageLocationId' => (string) $row['storage_location_id'], 'locationName' => (string) $row['location_name'], 'stockUnit' => (string) $row['stock_unit'], 'trackingMode' => (string) $row['tracking_mode'], 'bookQuantity' => $row['book_quantity'] === null ? null : (float) $row['book_quantity'], 'countedQuantity' => $row['counted_quantity'] === null ? null : (float) $row['counted_quantity'], 'result' => (string) $row['result'], 'note' => (string) $row['note'], 'correctionTransactionId' => $row['correction_transaction_id'] ?: null, 'checkedBy' => (string) $row['checked_by'], 'checkedAt' => (string) $row['checked_at'], 'requestPriority' => $row['request_priority'] ?? null, 'requestNote' => $row['request_note'] ?? ''];
    }

    private function publicPosition(array $row, string $activity): array
    {
        return ['stockEntryId' => (string) $row['stock_entry_id'], 'itemId' => (string) $row['item_id'], 'itemName' => (string) $row['item_name'], 'storageLocationId' => (string) $row['storage_location_id'], 'locationName' => (string) $row['location_name'], 'trackingMode' => (string) $row['tracking_mode'], 'stockUnit' => (string) $row['stock_unit'], 'quantity' => $row['tracking_mode'] === 'COLLECTION' ? null : (float) $row['quantity'], 'lastMovementAt' => $row['last_movement_at'] ?: null, 'lastCheckedAt' => $row['last_checked_at'] ?: null, 'lastRelevantActivityAt' => $activity];
    }

    private function entrySummary(array $entries): array
    {
        $summary = ['total' => count($entries), 'pending' => 0, 'match' => 0, 'corrected' => 0, 'attention' => 0, 'notFound' => 0, 'skipped' => 0];
        foreach ($entries as $entry) match ($entry['result']) { 'PENDING' => ++$summary['pending'], 'MATCH', 'OK' => ++$summary['match'], 'CORRECTED' => ++$summary['corrected'], 'NOT_FOUND' => ++$summary['notFound'], 'SKIPPED' => ++$summary['skipped'], default => ++$summary['attention'] };
        return $summary;
    }

    private function locationScope(string $id, bool $recursive): array
    {
        if (!$recursive) return [$id];
        $statement = $this->db->prepare('WITH RECURSIVE subtree(id) AS (SELECT id FROM storage_locations WHERE id = :id UNION ALL SELECT child.id FROM storage_locations AS child JOIN subtree ON child.parent_id = subtree.id WHERE child.status = \'ACTIVE\') SELECT id FROM subtree');
        $statement->execute(['id' => $id]);
        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    private function categoryItemScope(string $id, bool $recursive): array
    {
        if (!$recursive) {
            $statement = $this->db->prepare('SELECT item_id FROM inventory_item_categories WHERE category_id = :id');
        } else {
            $statement = $this->db->prepare('WITH RECURSIVE subtree(id) AS (SELECT id FROM inventory_categories WHERE id = :id UNION ALL SELECT child.id FROM inventory_categories AS child JOIN subtree ON child.parent_id = subtree.id) SELECT DISTINCT link.item_id FROM inventory_item_categories AS link JOIN subtree ON subtree.id = link.category_id');
        }
        $statement->execute(['id' => $id]);
        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    private function activeItem(string $id): array { $statement = $this->db->prepare("SELECT id FROM inventory_items WHERE id = :id AND status = 'ACTIVE'"); $statement->execute(['id' => $id]); $row = $statement->fetch(); if (!$row) throw new HttpError(404, 'Artikel nicht gefunden.'); return $row; }
    private function activeEntry(string $id): array { $this->assertId($id, 'Lagerplatz'); $statement = $this->db->prepare("SELECT * FROM stock_entries WHERE id = :id AND status = 'ACTIVE'"); $statement->execute(['id' => $id]); $row = $statement->fetch(); if (!$row) throw new HttpError(404, 'Lagerplatz nicht gefunden.'); return $row; }
    private function requiredExistingId(string $id, string $table, string $label): string { $this->assertId($id, $label); $statement = $this->db->prepare("SELECT 1 FROM {$table} WHERE id = :id"); $statement->execute(['id' => $id]); if (!$statement->fetchColumn()) throw new HttpError(404, "{$label} nicht gefunden."); return $id; }
    private function requiredId(mixed $value, string $label): string { $id = trim((string) $value); $this->assertId($id, $label); return $id; }
    private function assertId(string $id, string $label): void { if (!validId($id)) throw new HttpError(404, "{$label} nicht gefunden."); }
    private function idList(mixed $values, string $label): array { if (!is_array($values) || count($values) > 1000) throw new HttpError(422, "Die {$label}auswahl ist ungültig."); $ids = []; foreach ($values as $value) { $id = trim((string) $value); $this->assertId($id, $label); if (!in_array($id, $ids, true)) $ids[] = $id; } return $ids; }
    private function text(mixed $value, int $max, string $label): string { $text = trim((string) $value); if (mb_strlen($text) > $max) throw new HttpError(422, "{$label} ist zu lang."); return $text; }
    private function quantity(mixed $value, string $unit): float { if (!is_numeric($value)) throw new HttpError(422, 'Die gezählte Menge ist ungültig.'); $number = round((float) $value, 6); if ($number < 0 || $number > 1_000_000_000_000) throw new HttpError(422, 'Die gezählte Menge ist ungültig.'); if (mb_strtolower(trim($unit)) === 'stück' && floor($number) !== $number) throw new HttpError(422, 'Mengen in Stück müssen ganzzahlig sein.'); return $number; }
    private function transaction(callable $callback): mixed { $this->db->exec('BEGIN IMMEDIATE'); $active = true; try { $result = $callback(); $this->db->exec('COMMIT'); $active = false; return $result; } catch (\Throwable $error) { if ($active) try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {} throw $error; } }
}
