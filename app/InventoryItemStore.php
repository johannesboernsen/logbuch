<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryItemStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(bool $includeArchived = false, string $query = ''): array
    {
        $query = trim($query);
        if (mb_strlen($query) > 200) throw new HttpError(422, 'Der Suchbegriff ist zu lang.');
        $conditions = $includeArchived ? [] : ["status = 'ACTIVE'"];
        $parameters = [];
        if ($query !== '') {
            $conditions[] = '(name LIKE :query ESCAPE \'\\\' OR description LIKE :query ESCAPE \'\\\' OR manufacturer LIKE :query ESCAPE \'\\\' OR article_number LIKE :query ESCAPE \'\\\' OR barcode LIKE :query ESCAPE \'\\\')';
            $parameters['query'] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
        }
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
        $statement = $this->db->prepare(<<<SQL
            SELECT id, name, description, stock_unit, manufacturer, article_number,
                   barcode, merchant_url, default_minimum_quantity, status, created_at, updated_at
            FROM inventory_items
            {$where}
            ORDER BY name COLLATE NOCASE, manufacturer COLLATE NOCASE, id
        SQL);
        $statement->execute($parameters);
        return array_map(fn(array $row): array => $this->publicItem($row), $statement->fetchAll());
    }

    public function detail(string $id): array
    {
        return $this->get($id);
    }

    public function create(array $input): array
    {
        $item = $this->validated($input);
        $item['id'] = randomId('item-');
        $item['status'] = 'ACTIVE';
        $item['createdAt'] = nowIso();
        $item['updatedAt'] = '';
        $statement = $this->db->prepare(<<<'SQL'
            INSERT INTO inventory_items (
                id, name, description, stock_unit, manufacturer, article_number,
                barcode, merchant_url, default_minimum_quantity, status, created_at, updated_at
            ) VALUES (
                :id, :name, :description, :unit, :manufacturer, :article_number,
                :barcode, :merchant_url, :minimum, 'ACTIVE', :created, :updated
            )
        SQL);
        $statement->execute($this->parameters($item));
        return $item;
    }

    public function update(string $id, array $input): array
    {
        $existing = $this->get($id);
        if ($existing['status'] !== 'ACTIVE') throw new HttpError(409, 'Archivierte Artikel können nicht bearbeitet werden.');
        $item = $this->validated([...$existing, ...$input]);
        $item = [...$existing, ...$item, 'updatedAt' => nowIso()];
        $statement = $this->db->prepare(<<<'SQL'
            UPDATE inventory_items
            SET name = :name, description = :description, stock_unit = :unit,
                manufacturer = :manufacturer, article_number = :article_number,
                barcode = :barcode, merchant_url = :merchant_url,
                default_minimum_quantity = :minimum, created_at = :created, updated_at = :updated
            WHERE id = :id AND status = 'ACTIVE'
        SQL);
        $statement->execute($this->parameters($item));
        return $item;
    }

    public function archive(string $id): bool
    {
        return $this->setStatus($id, 'ARCHIVED');
    }

    public function restore(string $id): bool
    {
        return $this->setStatus($id, 'ACTIVE');
    }

    private function setStatus(string $id, string $status): bool
    {
        $item = $this->get($id);
        if ($item['status'] === $status) return false;
        $statement = $this->db->prepare('UPDATE inventory_items SET status = :status, updated_at = :updated WHERE id = :id');
        $statement->execute(['status' => $status, 'updated' => nowIso(), 'id' => $id]);
        return true;
    }

    private function get(string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Artikel nicht gefunden.');
        $statement = $this->db->prepare(<<<'SQL'
            SELECT id, name, description, stock_unit, manufacturer, article_number,
                   barcode, merchant_url, default_minimum_quantity, status, created_at, updated_at
            FROM inventory_items WHERE id = :id
        SQL);
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Artikel nicht gefunden.');
        return $this->publicItem($row);
    }

    private function validated(array $input): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        if (mb_strlen($name) < 1 || mb_strlen($name) > 200) throw new HttpError(422, 'Der Artikelname muss 1–200 Zeichen lang sein.');
        $unit = trim((string) ($input['stockUnit'] ?? ''));
        if (mb_strlen($unit) < 1 || mb_strlen($unit) > 40) throw new HttpError(422, 'Die Bestandseinheit muss 1–40 Zeichen lang sein.');
        $description = $this->text($input['description'] ?? '', 4000, 'Die Beschreibung');
        $manufacturer = $this->text($input['manufacturer'] ?? '', 160, 'Der Hersteller');
        $articleNumber = $this->text($input['articleNumber'] ?? '', 120, 'Die Artikelnummer');
        $barcode = $this->text($input['barcode'] ?? '', 120, 'Der Barcode');
        $merchantUrl = $this->text($input['merchantUrl'] ?? '', 2000, 'Der Händlerlink');
        if ($merchantUrl !== '' && (!filter_var($merchantUrl, FILTER_VALIDATE_URL) || !in_array(strtolower((string) parse_url($merchantUrl, PHP_URL_SCHEME)), ['http', 'https'], true))) {
            throw new HttpError(422, 'Der Händlerlink muss eine gültige HTTP- oder HTTPS-Adresse sein.');
        }
        $minimum = $this->quantity($input['defaultMinimumQuantity'] ?? null, $unit);
        return [
            'name' => $name,
            'description' => $description,
            'stockUnit' => $unit,
            'manufacturer' => $manufacturer,
            'articleNumber' => $articleNumber,
            'barcode' => $barcode,
            'merchantUrl' => $merchantUrl,
            'defaultMinimumQuantity' => $minimum,
        ];
    }

    private function text(mixed $value, int $maximum, string $label): string
    {
        $text = trim((string) $value);
        if (mb_strlen($text) > $maximum) throw new HttpError(422, "{$label} darf höchstens {$maximum} Zeichen lang sein.");
        return $text;
    }

    private function quantity(mixed $value, string $unit): ?float
    {
        if ($value === null || $value === '') return null;
        if (!is_int($value) && !is_float($value) && !is_string($value)) throw new HttpError(422, 'Der Mindestbestand ist ungültig.');
        $normalized = str_replace(',', '.', trim((string) $value));
        if ($normalized === '' || !is_numeric($normalized)) throw new HttpError(422, 'Der Mindestbestand ist ungültig.');
        $quantity = (float) $normalized;
        if (!is_finite($quantity) || $quantity < 0 || $quantity > 1_000_000_000_000) throw new HttpError(422, 'Der Mindestbestand ist ungültig.');
        $quantity = round($quantity, 6);
        if (mb_strtolower($unit) === 'stück' && floor($quantity) !== $quantity) throw new HttpError(422, 'Für die Einheit Stück muss der Mindestbestand ganzzahlig sein.');
        return $quantity;
    }

    private function parameters(array $item): array
    {
        return [
            'id' => $item['id'],
            'name' => $item['name'],
            'description' => $item['description'],
            'unit' => $item['stockUnit'],
            'manufacturer' => $item['manufacturer'],
            'article_number' => $item['articleNumber'],
            'barcode' => $item['barcode'],
            'merchant_url' => $item['merchantUrl'],
            'minimum' => $item['defaultMinimumQuantity'],
            'created' => $item['createdAt'],
            'updated' => $item['updatedAt'],
        ];
    }

    private function publicItem(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'description' => (string) $row['description'],
            'stockUnit' => (string) $row['stock_unit'],
            'manufacturer' => (string) $row['manufacturer'],
            'articleNumber' => (string) $row['article_number'],
            'barcode' => (string) $row['barcode'],
            'merchantUrl' => (string) $row['merchant_url'],
            'defaultMinimumQuantity' => $row['default_minimum_quantity'] === null ? null : (float) $row['default_minimum_quantity'],
            'status' => (string) $row['status'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
}
