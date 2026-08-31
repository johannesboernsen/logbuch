<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class InventoryItemStore
{
    public const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    private const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    private readonly string $imageRoot;

    public function __construct(private readonly PDO $db, ?string $imageRoot = null)
    {
        if ($imageRoot !== null && trim($imageRoot) !== '') {
            $this->imageRoot = rtrim($imageRoot, '/');
            return;
        }
        $database = $this->db->query('PRAGMA database_list')->fetch(PDO::FETCH_ASSOC);
        $databasePath = trim((string) ($database['file'] ?? ''));
        $this->imageRoot = $databasePath !== ''
            ? dirname($databasePath) . '/inventory-items'
            : sys_get_temp_dir() . '/logbuch-inventory-items-' . spl_object_id($this->db);
    }

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

    public function notes(string $itemId): array
    {
        $this->get($itemId);
        $statement = $this->db->prepare(<<<'SQL'
            SELECT id, item_id, content, created_by, created_at, updated_at
            FROM inventory_item_notes
            WHERE item_id = :item
            ORDER BY created_at DESC, id DESC
        SQL);
        $statement->execute(['item' => $itemId]);
        return array_map(fn(array $row): array => $this->publicNote($row), $statement->fetchAll());
    }

    public function createNote(string $itemId, array $input, string $actor): array
    {
        $this->assertActive($itemId);
        $content = $this->noteContent($input['content'] ?? '');
        $note = [
            'id' => randomId('note-'),
            'itemId' => $itemId,
            'content' => $content,
            'createdBy' => $actor,
            'createdAt' => nowIso(),
            'updatedAt' => '',
        ];
        $statement = $this->db->prepare(<<<'SQL'
            INSERT INTO inventory_item_notes (id, item_id, content, created_by, created_at, updated_at)
            VALUES (:id, :item, :content, :actor, :created, :updated)
        SQL);
        $statement->execute([
            'id' => $note['id'], 'item' => $itemId, 'content' => $content,
            'actor' => $actor, 'created' => $note['createdAt'], 'updated' => '',
        ]);
        $this->touch($itemId);
        return $note;
    }

    public function updateNote(string $itemId, string $noteId, array $input): array
    {
        $this->assertActive($itemId);
        $this->note($itemId, $noteId);
        $content = $this->noteContent($input['content'] ?? '');
        $updatedAt = nowIso();
        $statement = $this->db->prepare('UPDATE inventory_item_notes SET content = :content, updated_at = :updated WHERE id = :id AND item_id = :item');
        $statement->execute(['content' => $content, 'updated' => $updatedAt, 'id' => $noteId, 'item' => $itemId]);
        $this->touch($itemId, $updatedAt);
        return $this->note($itemId, $noteId);
    }

    public function deleteNote(string $itemId, string $noteId): bool
    {
        $this->assertActive($itemId);
        $this->note($itemId, $noteId);
        $statement = $this->db->prepare('DELETE FROM inventory_item_notes WHERE id = :id AND item_id = :item');
        $statement->execute(['id' => $noteId, 'item' => $itemId]);
        $this->touch($itemId);
        return $statement->rowCount() === 1;
    }

    private function setStatus(string $id, string $status): bool
    {
        $item = $this->get($id);
        if ($item['status'] === $status) return false;
        $statement = $this->db->prepare('UPDATE inventory_items SET status = :status, updated_at = :updated WHERE id = :id');
        $statement->execute(['status' => $status, 'updated' => nowIso(), 'id' => $id]);
        return true;
    }

    private function assertActive(string $id): array
    {
        $item = $this->get($id);
        if ($item['status'] !== 'ACTIVE') throw new HttpError(409, 'Notizen archivierter Artikel können nicht bearbeitet werden.');
        return $item;
    }

    private function note(string $itemId, string $noteId): array
    {
        if (!validId($noteId)) throw new HttpError(404, 'Notiz nicht gefunden.');
        $statement = $this->db->prepare('SELECT id, item_id, content, created_by, created_at, updated_at FROM inventory_item_notes WHERE id = :id AND item_id = :item');
        $statement->execute(['id' => $noteId, 'item' => $itemId]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Notiz nicht gefunden.');
        return $this->publicNote($row);
    }

    private function noteContent(mixed $value): string
    {
        $content = trim((string) $value);
        if (mb_strlen($content) < 1 || mb_strlen($content) > 10000) throw new HttpError(422, 'Die Notiz muss 1–10.000 Zeichen lang sein.');
        return $content;
    }

    private function touch(string $itemId, ?string $at = null): void
    {
        $statement = $this->db->prepare('UPDATE inventory_items SET updated_at = :updated WHERE id = :id');
        $statement->execute(['updated' => $at ?? nowIso(), 'id' => $itemId]);
    }

    private function publicNote(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'itemId' => (string) $row['item_id'],
            'content' => (string) $row['content'],
            'createdBy' => (string) $row['created_by'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }

    public function uploadImage(string $id, array $upload): array
    {
        $item = $this->get($id);
        if ($item['status'] !== 'ACTIVE') throw new HttpError(409, 'Zu archivierten Artikeln kann kein Bild hochgeladen werden.');
        return $this->storeImage($id, $upload);
    }

    public function importImageFromPath(string $id, string $sourcePath, array $metadata): array
    {
        $this->get($id);
        $upload = [
            'error' => UPLOAD_ERR_OK,
            'size' => @filesize($sourcePath) ?: 0,
            'tmp_name' => $sourcePath,
            'name' => (string) ($metadata['originalName'] ?? 'artikelbild'),
        ];
        return $this->storeImage($id, $upload, $metadata, true);
    }

    public function imageMetadata(string $id): ?array
    {
        if (!validId($id)) return null;
        $metadata = readJsonFile($this->imageDirectory($id) . '/metadata.json');
        if (!$metadata || !is_file($this->imageDirectory($id) . '/image.bin')) return null;
        $mimeType = (string) ($metadata['mimeType'] ?? '');
        if (!in_array($mimeType, self::IMAGE_MIME_TYPES, true)) return null;
        return [
            'originalName' => (string) ($metadata['originalName'] ?? 'artikelbild'),
            'mimeType' => $mimeType,
            'size' => (int) ($metadata['size'] ?? 0),
            'sha256' => (string) ($metadata['sha256'] ?? ''),
            'updatedAt' => (string) ($metadata['updatedAt'] ?? ''),
        ];
    }

    public function imageContent(string $id): array
    {
        $this->get($id);
        $metadata = $this->imageMetadata($id);
        if ($metadata === null) throw new HttpError(404, 'Für diesen Artikel ist kein Bild hinterlegt.');
        return ['metadata' => $metadata, 'path' => $this->imageDirectory($id) . '/image.bin'];
    }

    public function deleteImage(string $id): bool
    {
        $item = $this->get($id);
        if ($item['status'] !== 'ACTIVE') throw new HttpError(409, 'Das Bild eines archivierten Artikels kann nicht bearbeitet werden.');
        return $this->deleteImageFiles($id);
    }

    public function deleteImageFiles(string $id): bool
    {
        $directory = $this->imageDirectory($id);
        if (!is_dir($directory)) return false;
        removeTree($directory);
        return true;
    }

    public function clearImages(): void
    {
        if (is_dir($this->imageRoot)) removeTree($this->imageRoot);
        if (!mkdir($this->imageRoot, 0770, true) && !is_dir($this->imageRoot)) throw new HttpError(507, 'Die Artikelbildablage konnte nicht neu angelegt werden.');
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
        $image = $this->imageMetadata((string) $row['id']);
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
            'hasImage' => $image !== null,
            'image' => $image,
        ];
    }

    private function storeImage(string $id, array $upload, ?array $restoredMetadata = null, bool $trustedLocalSource = false): array
    {
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new HttpError(413, 'Das Artikelbild ist größer als 15 MB.');
        if ($error !== UPLOAD_ERR_OK) throw new HttpError(422, 'Das Artikelbild konnte nicht hochgeladen werden.');
        $size = (int) ($upload['size'] ?? 0);
        $source = (string) ($upload['tmp_name'] ?? '');
        if ($size < 1 || $size > self::MAX_IMAGE_BYTES || !is_file($source)) throw new HttpError($size > self::MAX_IMAGE_BYTES ? 413 : 422, $size > self::MAX_IMAGE_BYTES ? 'Das Artikelbild ist größer als 15 MB.' : 'Das Artikelbild ist leer oder ungültig.');
        $detectedMime = class_exists(\finfo::class) ? (new \finfo(FILEINFO_MIME_TYPE))->file($source) : false;
        $mimeType = is_string($detectedMime) ? $detectedMime : '';
        if (!in_array($mimeType, self::IMAGE_MIME_TYPES, true) || @getimagesize($source) === false) throw new HttpError(415, 'Unterstützt werden JPEG-, PNG-, WebP- und GIF-Bilder.');

        if (!is_dir($this->imageRoot) && !mkdir($this->imageRoot, 0770, true) && !is_dir($this->imageRoot)) throw new HttpError(507, 'Die Artikelbildablage konnte nicht angelegt werden.');
        $directory = $this->imageDirectory($id);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) throw new HttpError(507, 'Das Verzeichnis für das Artikelbild konnte nicht angelegt werden.');
        $incoming = $directory . '/image-' . bin2hex(random_bytes(6)) . '.tmp';
        $stored = $trustedLocalSource ? copy($source, $incoming) : move_uploaded_file($source, $incoming);
        if (!$stored) throw new HttpError(507, 'Das Artikelbild konnte nicht gespeichert werden.');

        try {
            $sha256 = hash_file('sha256', $incoming) ?: '';
            if ($restoredMetadata !== null) {
                $expectedHash = strtolower((string) ($restoredMetadata['sha256'] ?? ''));
                $expectedSize = (int) ($restoredMetadata['size'] ?? 0);
                $expectedMime = (string) ($restoredMetadata['mimeType'] ?? '');
                if ($expectedSize !== filesize($incoming) || !preg_match('/^[a-f0-9]{64}$/', $expectedHash) || !hash_equals($expectedHash, $sha256) || $expectedMime !== $mimeType) throw new HttpError(422, 'Das Artikelbild stimmt nicht mit dem Vollbackup überein.');
            }
            $originalName = mb_substr(trim(basename(str_replace('\\', '/', (string) ($upload['name'] ?? 'artikelbild')))), 0, 240) ?: 'artikelbild';
            $metadata = [
                'originalName' => $originalName,
                'mimeType' => $mimeType,
                'size' => (int) filesize($incoming),
                'sha256' => $sha256,
                'updatedAt' => $restoredMetadata === null ? nowIso() : (string) ($restoredMetadata['updatedAt'] ?? nowIso()),
            ];
            $destination = $directory . '/image.bin';
            if (is_file($destination) && !@unlink($destination)) throw new HttpError(507, 'Das bisherige Artikelbild konnte nicht ersetzt werden.');
            if (!rename($incoming, $destination)) throw new HttpError(507, 'Das Artikelbild konnte nicht aktiviert werden.');
            writeJsonFile($directory . '/metadata.json', $metadata);
            return $metadata;
        } finally {
            if (is_file($incoming)) @unlink($incoming);
        }
    }

    private function imageDirectory(string $id): string
    {
        return rtrim($this->imageRoot, '/') . '/' . $id;
    }
}
