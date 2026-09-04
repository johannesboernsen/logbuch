<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryBatchImportStore
{
    public const TEMPLATE_HEADERS = [
        'Name', 'Anfangsbestand', 'Einheit', 'Lokaler Mindestbestand',
        'Globaler Mindestbestand', 'Hersteller', 'Artikelnummer', 'Barcode / EAN',
        'Beschreibung', 'Händlerlink', 'Lagerortnotiz',
    ];
    private const MAX_CSV_BYTES = 2_097_152;
    private const MAX_ROWS = 500;

    public function __construct(private readonly PDO $db) {}

    public function template(): string
    {
        return "\xEF\xBB\xBF" . implode(';', self::TEMPLATE_HEADERS) . "\r\n";
    }

    public function preview(array $input): array
    {
        $location = $this->activeLocation($input['storageLocationId'] ?? null);
        $categoryIds = $this->categoryIds($input['categoryIds'] ?? []);
        $rows = $this->parse((string) ($input['csv'] ?? ''));
        $warnings = $this->duplicateWarnings($rows);

        foreach ($rows as &$row) {
            $row['warnings'] = $warnings[$row['rowNumber']] ?? [];
        }
        unset($row);

        return [
            'valid' => true,
            'storageLocation' => $location,
            'categoryIds' => $categoryIds,
            'rows' => $rows,
            'rowCount' => count($rows),
            'warningCount' => array_sum(array_map(static fn(array $row): int => count($row['warnings']), $rows)),
        ];
    }

    public function import(array $input, string $actor): array
    {
        $preview = $this->preview($input);
        $created = [];
        $this->db->exec('BEGIN IMMEDIATE');
        $active = true;
        try {
            // Validate mutable references again while holding the write lock.
            $location = $this->activeLocation($input['storageLocationId'] ?? null);
            $categoryIds = $this->categoryIds($input['categoryIds'] ?? []);
            foreach ($preview['rows'] as $row) {
                $created[] = $this->insertRow($row, (string) $location['id'], $categoryIds, $actor);
            }
            $this->db->exec('COMMIT');
            $active = false;
        } catch (\Throwable $error) {
            if ($active) {
                try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            }
            throw $error;
        }

        return [
            'created' => $created,
            'count' => count($created),
            'storageLocationId' => (string) $preview['storageLocation']['id'],
            'categoryIds' => $preview['categoryIds'],
        ];
    }

    private function parse(string $csv): array
    {
        if ($csv === '') throw new HttpError(422, 'Bitte wähle eine ausgefüllte CSV-Datei aus.');
        if (strlen($csv) > self::MAX_CSV_BYTES) throw new HttpError(413, 'Die CSV-Datei darf höchstens 2 MB groß sein.');
        if (!mb_check_encoding($csv, 'UTF-8')) throw new HttpError(422, 'Die CSV-Datei muss UTF-8-codiert sein.');
        $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? $csv;
        $firstLine = strtok($csv, "\r\n") ?: '';
        $delimiter = $this->delimiter($firstLine);
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) throw new HttpError(500, 'Die CSV-Datei konnte nicht verarbeitet werden.');
        fwrite($stream, $csv);
        rewind($stream);
        $header = fgetcsv($stream, 0, $delimiter, '"', '');
        if (!is_array($header)) throw new HttpError(422, 'Die CSV-Datei enthält keine Kopfzeile.');
        $header = array_map(static fn(mixed $value): string => trim((string) $value), $header);
        if ($header !== self::TEMPLATE_HEADERS) {
            throw new HttpError(422, 'Die Spalten entsprechen nicht der aktuellen Vorlage. Bitte lade die unveränderte CSV-Vorlage erneut herunter.');
        }

        $rows = [];
        $line = 1;
        while (($values = fgetcsv($stream, 0, $delimiter, '"', '')) !== false) {
            ++$line;
            if (count($values) === 1 && $values[0] === null) continue;
            $values = array_map(static fn(mixed $value): string => trim((string) $value), $values);
            if (!array_filter($values, static fn(string $value): bool => $value !== '')) continue;
            if (count($values) !== count(self::TEMPLATE_HEADERS)) throw new HttpError(422, "Zeile {$line} besitzt nicht die erwartete Anzahl an Spalten.");
            if (count($rows) >= self::MAX_ROWS) throw new HttpError(422, 'Pro Import können höchstens 500 Artikel angelegt werden.');
            $rows[] = $this->validatedRow(array_combine(self::TEMPLATE_HEADERS, $values), $line);
        }
        fclose($stream);
        if (!$rows) throw new HttpError(422, 'Die CSV-Datei enthält keine Artikelzeilen.');
        return $rows;
    }

    private function delimiter(string $line): string
    {
        $counts = [';' => substr_count($line, ';'), ',' => substr_count($line, ','), "\t" => substr_count($line, "\t")];
        arsort($counts);
        $delimiter = (string) array_key_first($counts);
        if (($counts[$delimiter] ?? 0) < count(self::TEMPLATE_HEADERS) - 1) throw new HttpError(422, 'Das Trennzeichen oder die Kopfzeile der CSV-Datei ist ungültig.');
        return $delimiter;
    }

    private function validatedRow(array $source, int $line): array
    {
        $name = $this->text($source['Name'], 200, "Der Name in Zeile {$line}", true);
        $unit = $this->text($source['Einheit'] !== '' ? $source['Einheit'] : 'Stück', 40, "Die Einheit in Zeile {$line}", true);
        $initial = $this->quantity($source['Anfangsbestand'] !== '' ? $source['Anfangsbestand'] : '0', $unit, "Der Anfangsbestand in Zeile {$line}", false);
        $localMinimum = $this->quantity($source['Lokaler Mindestbestand'], $unit, "Der lokale Mindestbestand in Zeile {$line}", true);
        $globalMinimum = $this->quantity($source['Globaler Mindestbestand'], $unit, "Der globale Mindestbestand in Zeile {$line}", true);
        $merchantUrl = $this->text($source['Händlerlink'], 2000, "Der Händlerlink in Zeile {$line}");
        if ($merchantUrl !== '' && (!filter_var($merchantUrl, FILTER_VALIDATE_URL) || !in_array(strtolower((string) parse_url($merchantUrl, PHP_URL_SCHEME)), ['http', 'https'], true))) {
            throw new HttpError(422, "Der Händlerlink in Zeile {$line} muss eine gültige HTTP- oder HTTPS-Adresse sein.");
        }
        return [
            'rowNumber' => $line,
            'name' => $name,
            'initialQuantity' => $initial,
            'stockUnit' => $unit,
            'localMinimumQuantity' => $localMinimum,
            'defaultMinimumQuantity' => $globalMinimum,
            'manufacturer' => $this->text($source['Hersteller'], 160, "Der Hersteller in Zeile {$line}"),
            'articleNumber' => $this->text($source['Artikelnummer'], 120, "Die Artikelnummer in Zeile {$line}"),
            'barcode' => $this->text($source['Barcode / EAN'], 120, "Der Barcode in Zeile {$line}"),
            'description' => $this->text($source['Beschreibung'], 4000, "Die Beschreibung in Zeile {$line}"),
            'merchantUrl' => $merchantUrl,
            'locationNote' => $this->text($source['Lagerortnotiz'], 2000, "Die Lagerortnotiz in Zeile {$line}"),
        ];
    }

    private function duplicateWarnings(array $rows): array
    {
        $warnings = [];
        $seen = [];
        $existing = $this->db->query("SELECT name, manufacturer, article_number, barcode FROM inventory_items WHERE status = 'ACTIVE'")->fetchAll();
        foreach ($rows as $row) {
            $keys = $this->identityKeys($row);
            foreach ($keys as $key => $label) {
                if (isset($seen[$key])) $warnings[$row['rowNumber']][] = "Mögliche Dublette innerhalb der Datei ({$label}, zuerst in Zeile {$seen[$key]}).";
                else $seen[$key] = $row['rowNumber'];
            }
            foreach ($existing as $item) {
                $candidate = [
                    'name' => (string) $item['name'], 'manufacturer' => (string) $item['manufacturer'],
                    'articleNumber' => (string) $item['article_number'], 'barcode' => (string) $item['barcode'],
                ];
                if (array_intersect_key($keys, $this->identityKeys($candidate))) {
                    $warnings[$row['rowNumber']][] = 'Ein ähnlich identifizierter Artikel ist bereits vorhanden.';
                    break;
                }
            }
        }
        return $warnings;
    }

    private function identityKeys(array $row): array
    {
        $keys = [];
        if (($row['barcode'] ?? '') !== '') $keys['barcode:' . normalizeName((string) $row['barcode'])] = 'Barcode';
        if (($row['articleNumber'] ?? '') !== '') $keys['article:' . normalizeName((string) ($row['manufacturer'] ?? '')) . ':' . normalizeName((string) $row['articleNumber'])] = 'Artikelnummer';
        $keys['name:' . normalizeName((string) ($row['manufacturer'] ?? '')) . ':' . normalizeName((string) $row['name'])] = 'Name und Hersteller';
        return $keys;
    }

    private function insertRow(array $row, string $locationId, array $categoryIds, string $actor): array
    {
        $itemId = randomId('item-');
        $stockId = randomId('stock-');
        $created = nowIso();
        $item = $this->db->prepare(<<<'SQL'
            INSERT INTO inventory_items (
                id, name, description, stock_unit, tracking_mode, manufacturer, article_number,
                barcode, merchant_url, default_minimum_quantity, status, created_at, updated_at
            ) VALUES (:id, :name, :description, :unit, 'QUANTITY', :manufacturer, :article, :barcode, :url, :minimum, 'ACTIVE', :created, '')
        SQL);
        $item->execute([
            'id' => $itemId, 'name' => $row['name'], 'description' => $row['description'], 'unit' => $row['stockUnit'],
            'manufacturer' => $row['manufacturer'], 'article' => $row['articleNumber'], 'barcode' => $row['barcode'],
            'url' => $row['merchantUrl'], 'minimum' => $row['defaultMinimumQuantity'], 'created' => $created,
        ]);
        $entry = $this->db->prepare("INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, minimum_quantity, note, status, created_at, updated_at) VALUES (:id, :item, :location, :quantity, :minimum, :note, 'ACTIVE', :created, '')");
        $entry->execute(['id' => $stockId, 'item' => $itemId, 'location' => $locationId, 'quantity' => $row['initialQuantity'], 'minimum' => $row['localMinimumQuantity'], 'note' => $row['locationNote'], 'created' => $created]);
        $link = $this->db->prepare('INSERT INTO inventory_item_categories (item_id, category_id, created_at) VALUES (:item, :category, :created)');
        foreach ($categoryIds as $categoryId) $link->execute(['item' => $itemId, 'category' => $categoryId, 'created' => $created]);
        if ($row['initialQuantity'] > 0) {
            $transaction = $this->db->prepare("INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, destination_storage_location_id, reservation_id, reversal_of_transaction_id, note, recorded_by, occurred_at, created_at) VALUES (:id, :item, 'RECEIPT', :quantity, NULL, :location, NULL, NULL, :note, :actor, :occurred, :created)");
            $transaction->execute([
                'id' => randomId('transaction-'), 'item' => $itemId, 'quantity' => $row['initialQuantity'], 'location' => $locationId,
                'note' => $row['locationNote'] !== '' ? $row['locationNote'] : 'Anfangsbestand · Stapelimport', 'actor' => $actor,
                'occurred' => $created, 'created' => $created,
            ]);
        }
        return ['id' => $itemId, 'name' => $row['name'], 'stockEntryId' => $stockId];
    }

    private function activeLocation(mixed $value): array
    {
        $id = trim((string) ($value ?? ''));
        if (!validId($id)) throw new HttpError(422, 'Der Lagerort ist ungültig.');
        $statement = $this->db->prepare('SELECT id, name, status FROM storage_locations WHERE id = :id');
        $statement->execute(['id' => $id]);
        $location = $statement->fetch();
        if (!$location) throw new HttpError(404, 'Lagerort nicht gefunden.');
        if ($location['status'] !== 'ACTIVE') throw new HttpError(409, 'In einen archivierten Lagerort kann nicht importiert werden.');
        return ['id' => (string) $location['id'], 'name' => (string) $location['name']];
    }

    private function categoryIds(mixed $values): array
    {
        if (!is_array($values) || count($values) > 100) throw new HttpError(422, 'Die Kategorieauswahl ist ungültig.');
        $ids = [];
        $find = $this->db->prepare('SELECT 1 FROM inventory_categories WHERE id = :id');
        foreach ($values as $value) {
            $id = trim((string) $value);
            if (!validId($id) || in_array($id, $ids, true)) throw new HttpError(422, 'Die Kategorieauswahl ist ungültig.');
            $find->execute(['id' => $id]);
            if (!$find->fetchColumn()) throw new HttpError(422, 'Eine ausgewählte Kategorie wurde nicht gefunden.');
            $ids[] = $id;
        }
        return $ids;
    }

    private function text(mixed $value, int $maximum, string $label, bool $required = false): string
    {
        $text = trim((string) $value);
        if ($required && $text === '') throw new HttpError(422, "{$label} darf nicht leer sein.");
        if (mb_strlen($text) > $maximum) throw new HttpError(422, "{$label} darf höchstens {$maximum} Zeichen lang sein.");
        return $text;
    }

    private function quantity(mixed $value, string $unit, string $label, bool $nullable): ?float
    {
        $normalized = str_replace(',', '.', trim((string) $value));
        if ($normalized === '' && $nullable) return null;
        if ($normalized === '' || !is_numeric($normalized)) throw new HttpError(422, "{$label} ist ungültig.");
        $quantity = round((float) $normalized, 6);
        if (!is_finite($quantity) || $quantity < 0 || $quantity > 1_000_000_000_000) throw new HttpError(422, "{$label} ist ungültig.");
        if (mb_strtolower($unit) === 'stück' && floor($quantity) !== $quantity) throw new HttpError(422, "{$label} muss für die Einheit Stück ganzzahlig sein.");
        return $quantity;
    }
}
