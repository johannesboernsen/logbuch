<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class Application
{
    private const MAX_JSON_BYTES = 31_457_280;
    private const MAX_APPEARANCE_LOGO_BYTES = 8_388_608;
    private const APPEARANCE_LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    private const FULL_BACKUP_VERSION = 1;
    private const FULL_BACKUP_MIN_SCHEMA = 17;
    private const FULL_BACKUP_TABLES = [
        'users' => ['id', 'role', 'active', 'access_mode', 'password_hash', 'must_change_password', 'preferences_json', 'created_at', 'last_login_at'],
        'user_projects' => ['user_id', 'project_id'],
        'audit' => ['id', 'occurred_at', 'actor', 'action', 'target', 'details'],
        'tags' => ['id', 'name', 'normalized_name', 'active', 'created_at'],
        'settings' => ['key', 'value'],
        'folders' => ['id', 'parent_id', 'name', 'description', 'priority', 'flagged', 'icon', 'tag_ids_json', 'created_by', 'created_at', 'updated_at'],
        'todos' => ['id', 'user_id', 'title', 'parent_id', 'completed_at', 'cleared_at', 'repeat_interval', 'repeat_unit', 'repeat_due_at', 'repeat_waiting_at', 'sort_order', 'created_at', 'updated_at'],
        'storage_locations' => ['id', 'parent_id', 'name', 'description', 'status', 'created_at', 'updated_at', 'sort_order', 'icon'],
        'inventory_categories' => ['id', 'parent_id', 'name', 'description', 'icon', 'sort_order', 'created_at', 'updated_at'],
        'inventory_items' => ['id', 'name', 'description', 'stock_unit', 'tracking_mode', 'manufacturer', 'article_number', 'barcode', 'merchant_url', 'default_minimum_quantity', 'status', 'created_at', 'updated_at'],
        'inventory_item_notes' => ['id', 'item_id', 'content', 'created_by', 'created_at', 'updated_at'],
        'inventory_item_categories' => ['item_id', 'category_id', 'created_at'],
        'stock_entries' => ['id', 'item_id', 'storage_location_id', 'quantity', 'minimum_quantity', 'note', 'status', 'created_at', 'updated_at'],
        'reservations' => ['id', 'item_id', 'project_id', 'project_entry_collection', 'project_entry_id', 'requested_quantity', 'fulfilled_quantity', 'status', 'note', 'created_by', 'created_at', 'updated_at', 'closed_at'],
        'stock_transactions' => ['id', 'item_id', 'type', 'quantity', 'source_storage_location_id', 'destination_storage_location_id', 'reservation_id', 'reversal_of_transaction_id', 'note', 'recorded_by', 'occurred_at', 'created_at'],
    ];

    private readonly PDO $db;
    private readonly Auth $auth;
    private readonly ProjectStore $projects;
    private readonly FolderStore $folders;
    private readonly TodoStore $todos;
    private readonly StorageLocationStore $storageLocations;
    private readonly InventoryItemStore $inventoryItems;
    private readonly InventoryCategoryStore $inventoryCategories;
    private readonly InventoryPurgeStore $inventoryPurge;
    private readonly InventoryStockStore $inventoryStock;
    private readonly InventoryBatchImportStore $inventoryBatchImport;
    private readonly InventoryReservationStore $inventoryReservations;
    private readonly UpdateService $updates;

    public function __construct(private readonly string $storagePath)
    {
        $database = new Database($storagePath . '/database.sqlite');
        $this->db = $database->pdo();
        $this->auth = new Auth($this->db);
        $this->projects = new ProjectStore($storagePath . '/projects');
        $this->folders = new FolderStore($this->db);
        $this->todos = new TodoStore($this->db);
        $this->storageLocations = new StorageLocationStore($this->db);
        $this->inventoryItems = new InventoryItemStore($this->db, $storagePath . '/inventory-items');
        $this->inventoryCategories = new InventoryCategoryStore($this->db);
        $this->inventoryPurge = new InventoryPurgeStore($this->db);
        $this->inventoryStock = new InventoryStockStore($this->db);
        $this->inventoryBatchImport = new InventoryBatchImportStore($this->db);
        $this->inventoryReservations = new InventoryReservationStore($this->db, $this->projects);
        $this->updates = new UpdateService($storagePath, \logbuch_root_path(), $this->db, (string) (getenv('LOGBUCH_PLATFORM') ?: 'webhosting'));
    }

    public function installed(): bool
    {
        return (int) $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
    }

    public function install(array $input): array
    {
        $siteName = trim((string) ($input['siteName'] ?? 'Logbuch'));
        if (mb_strlen($siteName) < 2 || mb_strlen($siteName) > 80) {
            throw new HttpError(422, 'Der Name muss 2–80 Zeichen lang sein.');
        }
        $timezone = (string) ($input['timezone'] ?? 'Europe/Berlin');
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            throw new HttpError(422, 'Ungültige Zeitzone.');
        }
        $withDemoData = ($input['demoData'] ?? false) === true;
        $demo = $withDemoData ? $this->demoManifest() : null;
        $this->db->exec('BEGIN IMMEDIATE');
        $transactionActive = true;
        try {
            if ($this->installed()) {
                throw new HttpError(409, 'Das Logbuch ist bereits eingerichtet.');
            }
            $this->auth->createAdmin((string) ($input['adminUser'] ?? ''), (string) ($input['adminPassword'] ?? ''));
            $this->setSetting('general', ['siteName' => $siteName, 'timezone' => $timezone, 'baseUrl' => $this->detectedBaseUrl()]);
            if ($demo !== null) {
                $this->installDemoData((string) $input['adminUser'], $demo);
            }
            $this->audit((string) $input['adminUser'], 'system.installed', $siteName);
            // A transaction started with raw SQLite SQL is not reported by
            // PDO::inTransaction() on every supported PHP 8.2 build.
            $this->db->exec('COMMIT');
            $transactionActive = false;
        } catch (\Throwable $error) {
            if ($transactionActive) {
                try {
                    $this->db->exec('ROLLBACK');
                } catch (\Throwable) {
                }
            }
            throw $error;
        }
        return ['installed' => true, 'loginUrl' => '/'];
    }

    public function handle(string $method, string $path): never
    {
        try {
            $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
            $input = str_starts_with($contentType, 'multipart/form-data') ? $_POST : $this->jsonBody();
            if ($path === '/api/install/status' && $method === 'GET') {
                $this->json(200, $this->requirements());
            }
            if ($path === '/api/install' && $method === 'POST') {
                $this->json(201, $this->install($input));
            }
            if (!$this->installed()) {
                throw new HttpError(503, 'Das Logbuch muss zuerst eingerichtet werden.');
            }
            if ($path === '/api/appearance' && $method === 'GET') {
                $this->json(200, $this->appearanceSettings());
            }
            if ($path === '/api/appearance/logo' && $method === 'GET') {
                $this->streamAppearanceLogo();
            }
            if ($path === '/api/login' && $method === 'POST') {
                $user = $this->auth->login((string) ($input['user'] ?? ''), (string) ($input['password'] ?? ''), $this->clientIp(), (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
                $this->json(200, $this->withCsrf($user));
            }
            if ($path === '/api/logout' && $method === 'POST') {
                $this->verifyCsrf();
                $this->auth->logout();
                $this->empty(204);
            }

            $allowPasswordChangeOnly = $path === '/api/account/password' || $path === '/api/me';
            $touchSession = $path === '/api/me' || !in_array($method, ['GET', 'HEAD'], true);
            $user = $this->auth->requireUser(false, $allowPasswordChangeOnly, $touchSession);
            if (!in_array($method, ['GET', 'HEAD'], true)) {
                $this->verifyCsrf();
            }

            if ($path === '/api/me' && $method === 'GET') {
                $this->json(200, $this->withCsrf($user));
            }
            if ($path === '/api/account/password' && $method === 'POST') {
                $this->auth->changePassword($user, (string) ($input['currentPassword'] ?? ''), (string) ($input['newPassword'] ?? ''));
                $this->audit($user['id'], 'password.changed', $user['id']);
                $this->empty(204);
            }
            if ($user['mustChangePassword']) {
                throw new HttpError(428, 'Passwortänderung erforderlich.');
            }
            if ($path === '/api/account/preferences' && $method === 'PATCH') {
                $this->json(200, $this->updatePreferences($user, $input));
            }
            if ($path === '/api/system' && $method === 'GET') {
                $this->json(200, $this->systemStatus());
            }
            if ($path === '/api/storage' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->projects->storageStats());
            }
            if ($path === '/api/update/status' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->updates->status(false));
            }
            if ($path === '/api/update/check' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->updates->status(true));
            }
            if ($path === '/api/update/install' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->auth->verifyPassword($user, (string) ($input['password'] ?? ''));
                $result = $this->updates->install($user['id']);
                $this->audit($user['id'], 'system.update_requested', (string) ($result['version'] ?? ''), 'platform=' . ($result['platform'] ?? ''));
                $this->json(202, $result);
            }

            if ($path === '/api/projects' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible]);
            }
            if ($path === '/api/storage-locations' && $method === 'GET') {
                $includeArchived = ($_GET['includeArchived'] ?? '') === '1';
                $this->json(200, ['locations' => $this->storageLocations->list($includeArchived)]);
            }
            if ($path === '/api/storage-locations' && $method === 'POST') {
                $this->requireEditor($user);
                $location = $this->storageLocations->create($input);
                $this->audit($user['id'], 'storage_location.created', $location['id']);
                $this->json(201, $location);
            }
            if ($path === '/api/storage-locations/batch' && $method === 'POST') {
                $this->requireEditor($user);
                $locations = $this->storageLocations->createSeries($input);
                $this->audit($user['id'], 'storage_locations.batch_created', $locations[0]['id'], 'count=' . count($locations) . ';parent=' . ($locations[0]['parentId'] ?? 'root'));
                $this->json(201, ['locations' => $locations, 'count' => count($locations)]);
            }
            if ($path === '/api/storage-locations/matrix' && $method === 'POST') {
                $this->requireEditor($user);
                $locations = $this->storageLocations->createMatrix($input);
                $this->audit($user['id'], 'storage_locations.matrix_created', $locations[0]['id'], 'count=' . count($locations) . ';parent=' . ($locations[0]['parentId'] ?? 'root'));
                $this->json(201, ['locations' => $locations, 'count' => count($locations)]);
            }
            if ($path === '/api/storage-locations/reorder' && $method === 'POST') {
                $this->requireEditor($user);
                $this->storageLocations->reorder($input['parentId'] ?? null, $input['ids'] ?? null);
                $this->audit($user['id'], 'storage_locations.reordered', (string) ($input['parentId'] ?? 'root'));
                $this->json(200, ['saved' => true]);
            }
            if (preg_match('#^/api/storage-locations/([^/]+)/(archive|restore)$#', $path, $match) && $method === 'POST') {
                $this->requireEditor($user);
                $locationId = rawurldecode($match[1]);
                $changed = $match[2] === 'archive' ? $this->storageLocations->archive($locationId) : $this->storageLocations->restore($locationId);
                $this->audit($user['id'], 'storage_location.' . ($match[2] === 'archive' ? 'archived' : 'restored'), $locationId, 'subtree=' . $changed);
                $this->json(200, ['changed' => $changed]);
            }
            if (preg_match('#^/api/storage-locations/([^/]+)/purge-preview$#', $path, $match) && $method === 'GET') {
                $this->json(200, $this->inventoryPurge->locationPreview(rawurldecode($match[1])));
            }
            if (preg_match('#^/api/storage-locations/([^/]+)/permanent$#', $path, $match) && $method === 'DELETE') {
                $this->requireEditor($user);
                $locationId = rawurldecode($match[1]);
                $result = $this->inventoryPurge->deleteLocation($locationId);
                $this->audit($user['id'], 'storage_location.permanently_deleted', $locationId, 'locations=' . $result['locations'] . ';entries=' . $result['stockEntries'] . ';transactions=' . $result['transactions']);
                $this->json(200, $result);
            }
            if (preg_match('#^/api/storage-locations/([^/]+)$#', $path, $match)) {
                $locationId = rawurldecode($match[1]);
                if ($method === 'GET') $this->json(200, $this->storageLocations->detail($locationId));
                if ($method === 'PATCH') {
                    $this->requireEditor($user);
                    $location = $this->storageLocations->update($locationId, $input);
                    $this->audit($user['id'], 'storage_location.updated', $locationId);
                    $this->json(200, $location);
                }
            }
            if ($path === '/api/inventory-items' && $method === 'GET') {
                $includeArchived = ($_GET['includeArchived'] ?? '') === '1';
                $items = $this->inventoryItemsWithCategories($this->inventoryItems->list($includeArchived, (string) ($_GET['q'] ?? '')));
                if (($_GET['withOverview'] ?? '') === '1') {
                    $overview = $this->inventoryStock->overview(array_column($items, 'id'));
                    $items = array_map(static fn(array $item): array => [...$item, ...($overview[$item['id']] ?? ['physicalQuantity' => 0.0, 'reservedQuantity' => 0.0, 'availableQuantity' => 0.0])], $items);
                }
                $this->json(200, ['items' => $items]);
            }
            if ($path === '/api/inventory-items/import-template' && $method === 'GET') {
                $this->csvDownload('logbuch-artikel-import.csv', $this->inventoryBatchImport->template());
            }
            if ($path === '/api/inventory-items/import-preview' && $method === 'POST') {
                $this->requireEditor($user);
                $this->json(200, $this->inventoryBatchImport->preview($input));
            }
            if ($path === '/api/inventory-items/import' && $method === 'POST') {
                $this->requireEditor($user);
                $result = $this->inventoryBatchImport->import($input, (string) $user['id']);
                $this->audit($user['id'], 'inventory_items.batch_imported', (string) $result['storageLocationId'], 'count=' . $result['count'] . ';categories=' . count($result['categoryIds']));
                $this->json(201, $result);
            }
            if ($path === '/api/inventory-items' && $method === 'POST') {
                $this->requireEditor($user);
                if (array_key_exists('categoryIds', $input)) $this->inventoryCategories->validateCategoryIds($input['categoryIds']);
                $item = $this->inventoryItems->create($input);
                if (array_key_exists('categoryIds', $input)) $this->inventoryCategories->replaceItemCategories($item['id'], $input['categoryIds']);
                $this->audit($user['id'], 'inventory_item.created', $item['id']);
                $this->json(201, $this->inventoryItemWithCategories($item));
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/image$#', $path, $match)) {
                $itemId = rawurldecode($match[1]);
                if ($method === 'GET') $this->streamAttachment($this->inventoryItems->imageContent($itemId), false);
                if ($method === 'POST') {
                    $this->requireEditor($user);
                    $image = $this->inventoryItems->uploadImage($itemId, (array) ($_FILES['image'] ?? []));
                    $this->audit($user['id'], 'inventory_item.image_updated', $itemId, 'name=' . $image['originalName']);
                    $this->json(201, $image);
                }
                if ($method === 'DELETE') {
                    $this->requireEditor($user);
                    $removed = $this->inventoryItems->deleteImage($itemId);
                    $this->audit($user['id'], 'inventory_item.image_removed', $itemId);
                    $this->json(200, ['removed' => $removed]);
                }
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/notes$#', $path, $match)) {
                $itemId = rawurldecode($match[1]);
                if ($method === 'GET') $this->json(200, ['notes' => $this->inventoryItems->notes($itemId)]);
                if ($method === 'POST') {
                    $this->requireEditor($user);
                    $note = $this->inventoryItems->createNote($itemId, $input, (string) $user['id']);
                    $this->audit($user['id'], 'inventory_item.note_created', $itemId, 'note=' . $note['id']);
                    $this->json(201, $note);
                }
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/notes/([^/]+)$#', $path, $match)) {
                $itemId = rawurldecode($match[1]);
                $noteId = rawurldecode($match[2]);
                if ($method === 'PATCH') {
                    $this->requireEditor($user);
                    $note = $this->inventoryItems->updateNote($itemId, $noteId, $input);
                    $this->audit($user['id'], 'inventory_item.note_updated', $itemId, 'note=' . $noteId);
                    $this->json(200, $note);
                }
                if ($method === 'DELETE') {
                    $this->requireEditor($user);
                    $removed = $this->inventoryItems->deleteNote($itemId, $noteId);
                    $this->audit($user['id'], 'inventory_item.note_deleted', $itemId, 'note=' . $noteId);
                    $this->json(200, ['removed' => $removed]);
                }
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/(archive|restore)$#', $path, $match) && $method === 'POST') {
                $this->requireEditor($user);
                $itemId = rawurldecode($match[1]);
                $changed = $match[2] === 'archive' ? $this->inventoryItems->archive($itemId) : $this->inventoryItems->restore($itemId);
                $this->audit($user['id'], 'inventory_item.' . ($match[2] === 'archive' ? 'archived' : 'restored'), $itemId);
                $this->json(200, ['changed' => $changed]);
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/purge-preview$#', $path, $match) && $method === 'GET') {
                $this->json(200, $this->inventoryPurge->itemPreview(rawurldecode($match[1])));
            }
            if (preg_match('#^/api/inventory-items/([^/]+)/permanent$#', $path, $match) && $method === 'DELETE') {
                $this->requireEditor($user);
                $itemId = rawurldecode($match[1]);
                $result = $this->inventoryPurge->deleteItem($itemId);
                $this->inventoryItems->deleteImageFiles($itemId);
                $this->audit($user['id'], 'inventory_item.permanently_deleted', $itemId, 'entries=' . $result['stockEntries'] . ';transactions=' . $result['transactions'] . ';reservations=' . $result['reservations']);
                $this->json(200, $result);
            }
            if (preg_match('#^/api/inventory-items/([^/]+)$#', $path, $match)) {
                $itemId = rawurldecode($match[1]);
                if ($method === 'GET') $this->json(200, $this->inventoryItemWithCategories($this->inventoryItems->detail($itemId)));
                if ($method === 'PATCH') {
                    $this->requireEditor($user);
                    if (array_key_exists('categoryIds', $input)) $this->inventoryCategories->validateCategoryIds($input['categoryIds']);
                    $item = $this->inventoryItems->update($itemId, $input);
                    if (array_key_exists('categoryIds', $input)) $this->inventoryCategories->replaceItemCategories($itemId, $input['categoryIds']);
                    $this->audit($user['id'], 'inventory_item.updated', $itemId);
                    $this->json(200, $this->inventoryItemWithCategories($item));
                }
            }
            if ($path === '/api/inventory-categories' && $method === 'GET') {
                $this->json(200, ['categories' => $this->inventoryCategories->list()]);
            }
            if ($path === '/api/inventory-categories' && $method === 'POST') {
                $this->requireEditor($user);
                $category = $this->inventoryCategories->create($input);
                $this->audit($user['id'], 'inventory_category.created', $category['id']);
                $this->json(201, $category);
            }
            if ($path === '/api/inventory-categories/reorder' && $method === 'POST') {
                $this->requireEditor($user);
                $this->inventoryCategories->reorder($input['parentId'] ?? null, $input['ids'] ?? null);
                $this->json(200, ['saved' => true]);
            }
            if (preg_match('#^/api/inventory-categories/([^/]+)/items$#', $path, $match)) {
                $categoryId = rawurldecode($match[1]);
                if ($method === 'GET') {
                    $ids = array_flip($this->inventoryCategories->itemIds($categoryId, ($_GET['recursive'] ?? '') === '1'));
                    $items = array_values(array_filter($this->inventoryItems->list(false), static fn(array $item): bool => isset($ids[$item['id']])));
                    $this->json(200, ['items' => $this->inventoryItemsWithCategories($items)]);
                }
                if ($method === 'POST') {
                    $this->requireEditor($user);
                    $itemId = (string) ($input['itemId'] ?? '');
                    $added = $this->inventoryCategories->addItem($categoryId, $itemId);
                    $this->audit($user['id'], 'inventory_category.item_added', $categoryId, 'item=' . $itemId);
                    $this->json(200, ['added' => $added]);
                }
            }
            if (preg_match('#^/api/inventory-categories/([^/]+)/items/([^/]+)$#', $path, $match) && $method === 'DELETE') {
                $this->requireEditor($user);
                $categoryId = rawurldecode($match[1]);
                $itemId = rawurldecode($match[2]);
                $removed = $this->inventoryCategories->removeItem($categoryId, $itemId);
                $this->audit($user['id'], 'inventory_category.item_removed', $categoryId, 'item=' . $itemId);
                $this->json(200, ['removed' => $removed]);
            }
            if (preg_match('#^/api/inventory-categories/([^/]+)$#', $path, $match)) {
                $categoryId = rawurldecode($match[1]);
                if ($method === 'GET') $this->json(200, $this->inventoryCategories->detail($categoryId));
                if ($method === 'PATCH') {
                    $this->requireEditor($user);
                    $category = $this->inventoryCategories->update($categoryId, $input);
                    $this->audit($user['id'], 'inventory_category.updated', $categoryId);
                    $this->json(200, $category);
                }
                if ($method === 'DELETE') {
                    $this->requireEditor($user);
                    $deleted = $this->inventoryCategories->delete($categoryId);
                    $this->audit($user['id'], 'inventory_category.deleted', $categoryId);
                    $this->json(200, ['deleted' => $deleted]);
                }
            }
            if ($path === '/api/stock-entries' && $method === 'GET') {
                $itemId = trim((string) ($_GET['itemId'] ?? '')) ?: null;
                $locationId = trim((string) ($_GET['storageLocationId'] ?? '')) ?: null;
                $includeArchived = ($_GET['includeArchived'] ?? '') === '1';
                $entries = $this->inventoryStock->list($itemId, $locationId, $includeArchived);
                $result = ['entries' => $entries];
                if ($itemId !== null) $result['summary'] = $this->inventoryStock->summary($itemId);
                $this->json(200, $result);
            }
            if ($path === '/api/stock-entries' && $method === 'POST') {
                $this->requireEditor($user);
                $entry = $this->inventoryStock->create($input, $user['id']);
                $this->audit($user['id'], 'stock_entry.created', $entry['id'], 'item=' . $entry['itemId'] . ';location=' . $entry['storageLocationId']);
                $this->json(201, $entry);
            }
            if (preg_match('#^/api/stock-entries/([^/]+)$#', $path, $match) && $method === 'DELETE') {
                $this->requireEditor($user);
                $entryId = rawurldecode($match[1]);
                $deleted = $this->inventoryStock->delete($entryId);
                $this->audit($user['id'], 'stock_entry.deleted', $entryId);
                $this->json(200, ['deleted' => $deleted]);
            }
            if (preg_match('#^/api/stock-entries/([^/]+)$#', $path, $match) && $method === 'PATCH') {
                $this->requireEditor($user);
                $entryId = rawurldecode($match[1]);
                $entry = $this->inventoryStock->update($entryId, $input);
                $this->audit($user['id'], 'stock_entry.updated', $entryId);
                $this->json(200, $entry);
            }
            if ($path === '/api/stock-movements' && $method === 'POST') {
                $this->requireEditor($user);
                $result = $this->inventoryStock->record($input, $user['id']);
                if ($result['transaction'] !== null) {
                    $this->audit($user['id'], 'stock_transaction.recorded', $result['transaction']['id'], 'type=' . $result['transaction']['type'] . ';item=' . $result['transaction']['itemId']);
                }
                $this->json(201, $result);
            }
            if ($path === '/api/stock-transactions' && $method === 'GET') {
                $itemId = trim((string) ($_GET['itemId'] ?? '')) ?: null;
                $locationId = trim((string) ($_GET['storageLocationId'] ?? '')) ?: null;
                $limit = (int) ($_GET['limit'] ?? 100);
                $this->json(200, ['transactions' => $this->inventoryStock->transactions($itemId, $locationId, $limit)]);
            }
            if ($path === '/api/inventory-replenishment' && $method === 'GET') {
                $this->json(200, $this->inventoryStock->replenishment(
                    (string) ($_GET['q'] ?? ''),
                    ($_GET['includeSatisfied'] ?? '') === '1',
                    (string) ($_GET['sort'] ?? 'urgency'),
                ));
            }
            if ($path === '/api/reservations' && $method === 'GET') {
                $itemId = trim((string) ($_GET['itemId'] ?? '')) ?: null;
                $projectId = trim((string) ($_GET['projectId'] ?? '')) ?: null;
                $visibleProjectIds = null;
                if ($projectId !== null) {
                    $this->requireProjectAccess($user, $projectId);
                } elseif ($itemId !== null) {
                    $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                    $visibleProjectIds = array_column($visible, 'id');
                }
                $this->json(200, ['reservations' => $this->inventoryReservations->list($itemId, $projectId, $visibleProjectIds)]);
            }
            if ($path === '/api/reservations' && $method === 'POST') {
                $projectId = trim((string) ($input['projectId'] ?? ''));
                $this->requireProjectEdit($user, $projectId);
                $reservation = $this->inventoryReservations->create($input, $user['id']);
                $this->audit($user['id'], 'reservation.created', $reservation['id'], 'item=' . $reservation['itemId'] . ';project=' . $reservation['projectId']);
                $this->json(201, $reservation);
            }
            if (preg_match('#^/api/reservations/([^/]+)/(release|cancel|fulfill)$#', $path, $match) && $method === 'POST') {
                $reservationId = rawurldecode($match[1]);
                $reservation = $this->inventoryReservations->detail($reservationId);
                $this->requireProjectEdit($user, $reservation['projectId']);
                if ($match[2] === 'fulfill') {
                    $result = $this->inventoryReservations->fulfill($reservationId, $input, $user['id']);
                    $this->audit($user['id'], 'reservation.fulfilled', $reservationId, 'quantity=' . ($input['quantity'] ?? '') . ';transaction=' . $result['transactionId']);
                    $this->json(201, $result);
                }
                $status = $match[2] === 'release' ? 'RELEASED' : 'CANCELLED';
                $closed = $this->inventoryReservations->close($reservationId, $status);
                $this->audit($user['id'], 'reservation.' . strtolower($status), $reservationId);
                $this->json(200, $closed);
            }
            if (preg_match('#^/api/reservations/([^/]+)$#', $path, $match) && $method === 'PATCH') {
                $reservationId = rawurldecode($match[1]);
                $reservation = $this->inventoryReservations->detail($reservationId);
                $this->requireProjectEdit($user, $reservation['projectId']);
                $updated = $this->inventoryReservations->update($reservationId, $input);
                $this->audit($user['id'], 'reservation.updated', $reservationId);
                $this->json(200, $updated);
            }
            if ($path === '/api/todos' && $method === 'GET') {
                $todos = $this->todos->list($user['id']);
                $this->json(200, ['todos' => $todos, 'openCount' => count(array_filter($todos, static fn(array $todo): bool => $todo['completedAt'] === ''))]);
            }
            if ($path === '/api/todos' && $method === 'POST') {
                $todo = $this->todos->create($user['id'], $input);
                $this->audit($user['id'], 'todo.created', $todo['id']);
                $this->json(201, $todo);
            }
            if ($path === '/api/todos/reorder' && $method === 'POST') {
                $this->todos->reorder($user['id'], $input['items'] ?? $input['ids'] ?? null);
                $this->json(200, ['saved' => true]);
            }
            if ($path === '/api/todos/cleanup' && $method === 'POST') {
                $cleared = $this->todos->cleanup($user['id']);
                if ($cleared > 0) $this->audit($user['id'], 'todos.cleaned_up', (string) $cleared);
                $this->json(200, ['cleared' => $cleared]);
            }
            if ($path === '/api/todos/completed' && $method === 'DELETE') {
                $removed = $this->todos->deleteCompleted($user['id']);
                if ($removed > 0) $this->audit($user['id'], 'todos.completed_deleted', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }
            if (preg_match('#^/api/todos/([^/]+)/convert-to-project$#', $path, $match) && $method === 'POST') {
                $this->requireEditor($user);
                $this->json(201, $this->convertTodoToProject($user, rawurldecode($match[1])));
            }
            if (preg_match('#^/api/todos/([^/]+)$#', $path, $match)) {
                $todoId = rawurldecode($match[1]);
                if ($method === 'PATCH') {
                    $todo = $this->todos->update($user['id'], $todoId, $input);
                    $this->audit($user['id'], 'todo.updated', $todoId);
                    $this->json(200, $todo);
                }
                if ($method === 'DELETE') {
                    $this->todos->delete($user['id'], $todoId);
                    $this->audit($user['id'], 'todo.deleted', $todoId);
                    $this->empty(204);
                }
            }
            if ($path === '/api/search' && $method === 'GET') {
                $query = trim((string) ($_GET['q'] ?? ''));
                if (mb_strlen($query) > 200) throw new HttpError(422, 'Der Suchbegriff ist zu lang.');
                if ($query !== '' && mb_strlen($query) < 2) throw new HttpError(422, 'Der Suchbegriff muss mindestens zwei Zeichen lang sein.');
                $allowedTypes = ['project', ...ProjectStore::COLLECTIONS, 'files'];
                $type = (string) ($_GET['type'] ?? 'all');
                if ($type !== 'all' && !in_array($type, $allowedTypes, true)) throw new HttpError(422, 'Ungültiger Suchbereich.');
                $status = (string) ($_GET['status'] ?? 'all');
                if ($status !== 'all' && !in_array($status, ProjectStore::STATUSES, true)) throw new HttpError(422, 'Ungültiger Projektstatus.');
                $sort = (string) ($_GET['sort'] ?? 'relevance');
                if (!in_array($sort, ['relevance', 'newest', 'oldest', 'project', 'title'], true)) throw new HttpError(422, 'Ungültige Sortierung.');
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $results = $query === '' ? [] : $this->projects->search($query, array_column($visible, 'id'));
                $results = array_values(array_filter($results, static function (array $result) use ($type, $status): bool {
                    if ($type !== 'all' && ($result['type'] ?? '') !== $type) return false;
                    if ($status === 'all') return ($result['projectStatus'] ?? '') !== 'trashed';
                    return ($result['projectStatus'] ?? '') === $status;
                }));
                usort($results, static function (array $left, array $right) use ($sort): int {
                    $leftDate = strtotime((string) ($left['date'] ?? '')) ?: 0;
                    $rightDate = strtotime((string) ($right['date'] ?? '')) ?: 0;
                    return match ($sort) {
                        'newest' => $rightDate <=> $leftDate ?: strcasecmp((string) $left['title'], (string) $right['title']),
                        'oldest' => $leftDate <=> $rightDate ?: strcasecmp((string) $left['title'], (string) $right['title']),
                        'project' => strcasecmp((string) $left['projectTitle'], (string) $right['projectTitle']) ?: strcasecmp((string) $left['title'], (string) $right['title']),
                        'title' => strcasecmp((string) $left['title'], (string) $right['title']) ?: strcasecmp((string) $left['projectTitle'], (string) $right['projectTitle']),
                        default => ((int) ($right['relevance'] ?? 0)) <=> ((int) ($left['relevance'] ?? 0)) ?: $rightDate <=> $leftDate,
                    };
                });
                $total = count($results);
                $this->json(200, ['query' => $query, 'total' => $total, 'results' => array_slice($results, 0, 500), 'truncated' => $total > 500]);
            }
            if ($path === '/api/project-browser' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible, 'tags' => $this->tagsFor($user, $visible), 'folders' => $this->visibleFolders($user, $visible)]);
            }
            if ($path === '/api/overview' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->overview(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $completed = array_values(array_filter($this->projects->completedProjects(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['projects' => $visible, 'completedProjects' => $completed]);
            }
            if ($path === '/api/projects' && $method === 'POST') {
                $this->requireEditor($user);
                $this->assertFolderInput($user, $input);
                $project = $this->projects->create($input, $user['id']);
                if (!$user['admin'] && $user['projectAccessMode'] === 'include') {
                    $this->setUserProject($user['id'], $project['id'], true);
                }
                $this->audit($user['id'], 'project.created', $project['id']);
                $this->json(201, $project);
            }

            if ($path === '/api/folders' && $method === 'GET') {
                $visible = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
                $this->json(200, ['folders' => $this->visibleFolders($user, $visible)]);
            }
            if ($path === '/api/folders' && $method === 'POST') {
                $this->requireEditor($user);
                $this->assertParentFolderAccess($user, $input);
                $folder = $this->folders->create($input, $user['id']);
                $this->audit($user['id'], 'folder.created', $folder['id']);
                $this->json(201, $folder);
            }
            if (preg_match('#^/api/folders/([^/]+)$#', $path, $match)) {
                $this->requireEditor($user);
                $folderId = rawurldecode($match[1]);
                $this->requireFolderAccess($user, $folderId);
                if ($method === 'PATCH') {
                    $this->assertParentFolderAccess($user, $input);
                    $folder = $this->folders->update($folderId, $input);
                    $this->audit($user['id'], 'folder.updated', $folderId);
                    $this->json(200, $folder);
                }
                if ($method === 'DELETE') {
                    $this->folders->delete($folderId, $this->projects->list());
                    $this->audit($user['id'], 'folder.deleted', $folderId);
                    $this->empty(204);
                }
            }
            if ($path === '/api/projects/trash' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $removed = $this->projects->emptyTrash();
                $this->audit($user['id'], 'trash.emptied', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }

            if (preg_match('#^/api/project-view/([^/]+)$#', $path, $match) && $method === 'GET') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectAccess($user, $projectId);
                $project = $this->projects->get($projectId);
                $project['accessUsers'] = $this->projectUsers($projectId);
                $visible = array_values(array_filter($this->projects->list(), fn(array $candidate): bool => $this->canAccess($user, $candidate['id'])));
                $this->json(200, ['project' => $project, 'tags' => $this->tagsFor($user, $visible), 'folders' => $this->visibleFolders($user, $visible)]);
            }

            if (preg_match('#^/api/projects/([^/]+)/files/([^/]+)/content$#', $path, $match) && $method === 'GET') {
                $projectId = rawurldecode($match[1]);
                $fileId = rawurldecode($match[2]);
                $this->requireProjectAccess($user, $projectId);
                $this->streamAttachment($this->projects->attachmentContent($projectId, $fileId), isset($_GET['download']));
            }
            if (preg_match('#^/api/projects/([^/]+)/files/([^/]+)/thumbnail$#', $path, $match) && $method === 'GET') {
                $projectId = rawurldecode($match[1]);
                $fileId = rawurldecode($match[2]);
                $this->requireProjectAccess($user, $projectId);
                $this->streamAttachment($this->projects->attachmentThumbnail($projectId, $fileId), false);
            }
            if (preg_match('#^/api/projects/([^/]+)/files$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectEdit($user, $projectId);
                $file = $this->projects->createAttachment($projectId, (array) ($_FILES['file'] ?? []), $input, $user['id']);
                $this->audit($user['id'], 'file.created', $projectId . ' · ' . $file['id'], 'name=' . $file['originalName']);
                $this->json(201, $file);
            }
            if (preg_match('#^/api/import/projects/([^/]+)/files$#', $path, $match) && $method === 'POST') {
                $this->requireAdmin($user);
                $projectId = rawurldecode($match[1]);
                $metadata = json_decode((string) ($input['metadata'] ?? ''), true);
                if (!is_array($metadata)) throw new HttpError(422, 'Ungültige Dateimetadaten im Backup.');
                $file = $this->projects->importAttachment($projectId, (array) ($_FILES['file'] ?? []), $metadata, $user['id']);
                $this->audit($user['id'], 'file.imported', $projectId . ' · ' . $file['id'], 'name=' . $file['originalName']);
                $this->json(201, $file);
            }
            if (preg_match('#^/api/projects/([^/]+)/files/([^/]+)/rotate$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $fileId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                $file = $this->projects->rotateAttachment($projectId, $fileId, (int) ($input['degrees'] ?? 90));
                $this->audit($user['id'], 'file.rotated', $projectId . ' · ' . $fileId, 'rotation=' . $file['rotation']);
                $this->json(200, $file);
            }
            if (preg_match('#^/api/projects/([^/]+)/files/([^/]+)$#', $path, $match)) {
                $projectId = rawurldecode($match[1]);
                $fileId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                if ($method === 'PATCH') {
                    $file = $this->projects->updateAttachment($projectId, $fileId, $input);
                    $this->audit($user['id'], 'file.updated', $projectId . ' · ' . $fileId);
                    $this->json(200, $file);
                }
                if ($method === 'DELETE') {
                    $file = $this->projects->deleteAttachment($projectId, $fileId);
                    $this->audit($user['id'], 'file.deleted', $projectId . ' · ' . $fileId, 'name=' . $file['originalName']);
                    $this->empty(204);
                }
            }

            if (preg_match('#^/api/projects/([^/]+)/permanent$#', $path, $match) && $method === 'DELETE') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectEdit($user, $projectId);
                $this->projects->purge($projectId);
                $this->audit($user['id'], 'project.deleted', $projectId);
                $this->empty(204);
            }
            if (preg_match('#^/api/projects/([^/]+)$#', $path, $match)) {
                $projectId = rawurldecode($match[1]);
                if ($method === 'GET') {
                    $this->requireProjectAccess($user, $projectId);
                    $project = $this->projects->get($projectId);
                    $project['accessUsers'] = $this->projectUsers($projectId);
                    $this->json(200, $project);
                }
                $this->requireProjectEdit($user, $projectId);
                if ($method === 'PATCH') {
                    $this->assertFolderInput($user, $input);
                    $project = $this->projects->update($projectId, $input);
                    $this->audit($user['id'], 'project.updated', $projectId);
                    $this->json(200, $project);
                }
                if ($method === 'DELETE') {
                    $project = $this->projects->trash($projectId);
                    $this->audit($user['id'], 'project.trashed', $projectId);
                    $this->json(200, $project);
                }
            }

            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|shopping|materials|contacts|links|ideas|learnings|notes)/reorder$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $this->requireProjectEdit($user, $projectId);
                $ids = $input['ids'] ?? null;
                if (!is_array($ids)) {
                    throw new HttpError(422, 'Ungültige Reihenfolge.');
                }
                $this->projects->reorder($projectId, $collection, $ids);
                $this->audit($user['id'], $collection === 'entries' ? 'logs.reordered' : $collection . '.reordered', $projectId, 'count=' . count($ids));
                $this->json(200, ['ok' => true]);
            }
            if (preg_match('#^/api/projects/([^/]+)/tasks/([^/]+)/complete$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $taskId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                $entry = $this->projects->completeTask($projectId, $taskId, (string) ($input['date'] ?? ''), $user['id']);
                $this->audit($user['id'], 'log.created', $projectId . ' · ' . ($entry['title'] ?? $entry['id']), 'entryId=' . $entry['id']);
                $this->json(201, $entry);
            }
            if (preg_match('#^/api/projects/([^/]+)/entries/([^/]+)/reopen$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $entryId = rawurldecode($match[2]);
                $this->requireProjectEdit($user, $projectId);
                $task = $this->projects->reopenEntry($projectId, $entryId, $user['id']);
                $this->audit($user['id'], 'log.reopened', $projectId . ' · ' . $entryId, 'taskId=' . $task['id']);
                $this->json(200, $task);
            }
            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|shopping|materials|contacts|links|ideas|learnings|notes)$#', $path, $match) && $method === 'POST') {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $this->requireProjectEdit($user, $projectId);
                $item = $this->projects->createItem($projectId, $collection, $input, $user['id']);
                if ($collection === 'entries') {
                    $this->audit($user['id'], 'log.created', $projectId . ' · ' . ($item['title'] ?: $item['id']), 'entryId=' . $item['id'] . ', date=' . $item['date']);
                }
                $this->json(201, $item);
            }
            if (preg_match('#^/api/projects/([^/]+)/(entries|tasks|shopping|materials|contacts|links|ideas|learnings|notes)/([^/]+)$#', $path, $match)) {
                $projectId = rawurldecode($match[1]);
                $collection = $match[2];
                $itemId = rawurldecode($match[3]);
                $this->requireProjectEdit($user, $projectId);
                if ($method === 'PATCH') {
                    $item = $this->projects->updateItem($projectId, $collection, $itemId, $input);
                    if ($collection === 'entries') {
                        $this->audit($user['id'], 'log.updated', $projectId . ' · ' . ($item['title'] ?: $itemId), 'entryId=' . $itemId);
                    }
                    $this->json(200, $item);
                }
                if ($method === 'DELETE') {
                    $item = $this->projects->deleteItem($projectId, $collection, $itemId);
                    if ($collection === 'entries') {
                        $this->audit($user['id'], 'log.deleted', $projectId . ' · ' . ($item['title'] ?: $itemId), 'entryId=' . $itemId);
                    }
                    $this->empty(204);
                }
            }

            if ($path === '/api/tags' && $method === 'GET') {
                $this->json(200, ['tags' => $this->tagsFor($user)]);
            }
            if ($path === '/api/tags' && $method === 'POST') {
                $this->requireEditor($user);
                $this->json(201, $this->createTag($user, (string) ($input['name'] ?? '')));
            }
            if (preg_match('#^/api/tags/([^/]+)/merge$#', $path, $match) && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->mergeTag($user, rawurldecode($match[1]), (string) ($input['targetId'] ?? '')));
            }
            if (preg_match('#^/api/tags/([^/]+)$#', $path, $match)) {
                $this->requireAdmin($user);
                $tagId = rawurldecode($match[1]);
                if ($method === 'PATCH') {
                    $this->json(200, $this->updateTag($user, $tagId, $input));
                }
                if ($method === 'DELETE') {
                    $this->deleteTag($user, $tagId, (bool) ($input['removeFromProjects'] ?? false));
                    $this->empty(204);
                }
            }

            if ($path === '/api/users' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['users' => $this->listUsers()]);
            }
            if ($path === '/api/users' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(201, $this->createUser($user, $input));
            }
            if (preg_match('#^/api/users/([^/]+)$#', $path, $match)) {
                $this->requireAdmin($user);
                $userId = rawurldecode($match[1]);
                if ($method === 'PATCH') {
                    $this->json(200, $this->updateUser($user, $userId, $input));
                }
                if ($method === 'DELETE') {
                    $this->deleteUser($user, $userId);
                    $this->empty(204);
                }
            }
            if ($path === '/api/sessions' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['sessions' => $this->sessions($user)]);
            }
            if (preg_match('#^/api/sessions/([^/]+)$#', $path, $match) && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->revokeSession($user, rawurldecode($match[1]));
                $this->empty(204);
            }
            if ($path === '/api/audit' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['events' => $this->auditEvents()]);
            }

            if (in_array($path, ['/api/settings/server', '/api/settings/device'], true) && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->serverSettings());
            }
            if (in_array($path, ['/api/settings/server', '/api/settings/device'], true) && $method === 'PATCH') {
                $this->requireAdmin($user);
                $this->json(200, $this->updateServerSettings($user, $input));
            }
            if ($path === '/api/settings/appearance' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, $this->appearanceSettings());
            }
            if ($path === '/api/settings/appearance' && $method === 'PATCH') {
                $this->requireAdmin($user);
                $this->json(200, $this->updateAppearanceSettings($user, $input));
            }
            if ($path === '/api/settings/appearance/logo' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(201, $this->uploadAppearanceLogo($user, (array) ($_FILES['logo'] ?? [])));
            }
            if ($path === '/api/settings/appearance/logo' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->json(200, $this->deleteAppearanceLogo($user));
            }
            if ($path === '/api/import/backup-metadata' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->importBackupMetadata($user, $input));
            }
            if ($path === '/api/import/projects-archive' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->importProjectArchive($user, (array) ($_FILES['archive'] ?? []), (string) ($input['conflict'] ?? 'skip')));
            }
            if ($path === '/api/import/full-archive' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->importFullArchive($user, (array) ($_FILES['archive'] ?? [])));
            }
            if ($path === '/api/backup/users' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->json(200, ['accounts' => $this->exportUsers()]);
            }
            if ($path === '/api/backup/projects' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->streamProjectBackup($user);
            }
            if ($path === '/api/backup/full' && $method === 'GET') {
                $this->requireAdmin($user);
                $this->streamFullBackup();
            }
            if (preg_match('#^/api/backup/projects/([^/]+)$#', $path, $match) && $method === 'GET') {
                $projectId = rawurldecode($match[1]);
                $this->requireProjectAccess($user, $projectId);
                $this->streamProjectBackup($user, $projectId);
            }
            if ($path === '/api/import/users' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->importUsers($user, $input));
            }
            if ($path === '/api/import/project' && $method === 'POST') {
                $this->requireAdmin($user);
                $result = $this->projects->saveImported((array) ($input['project'] ?? []), (bool) ($input['replace'] ?? false));
                $this->importTagDefinitions((array) ($input['tags'] ?? []));
                foreach ((array) ($input['accessUsers'] ?? []) as $accessUser) {
                    if (is_string($accessUser) && $this->userExists($accessUser)) {
                        $this->setUserProject($accessUser, $result['id'], true);
                    }
                }
                $this->audit($user['id'], 'data.project_imported', $result['id']);
                $this->json($result['skipped'] ? 200 : 201, $result);
            }
            if ($path === '/api/demo' && $method === 'POST') {
                $this->requireAdmin($user);
                $this->json(200, $this->installDemoData($user['id']));
            }
            if ($path === '/api/demo' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->json(200, $this->removeDemoData($user['id']));
            }
            if ($path === '/api/system/content' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $this->json(200, $this->clearAllContent($user['id']));
            }
            if ($path === '/api/system/users' && $method === 'DELETE') {
                $this->requireAdmin($user);
                $removed = $this->clearUsersExcept($user['id']);
                $this->audit($user['id'], 'system.users_cleared', (string) $removed);
                $this->json(200, ['removed' => $removed]);
            }

            throw new HttpError(404, 'API-Endpunkt nicht gefunden.');
        } catch (HttpError $error) {
            $this->json($error->status, ['error' => $error->getMessage()]);
        } catch (\Throwable $error) {
            error_log((string) $error);
            $this->json(500, ['error' => 'Interner Serverfehler.']);
        }
    }

    public function requirements(): array
    {
        $checks = [
            'php' => version_compare(PHP_VERSION, '8.2.0', '>='),
            'pdoSqlite' => extension_loaded('pdo_sqlite'),
            'json' => extension_loaded('json'),
            'mbstring' => extension_loaded('mbstring'),
            'openssl' => extension_loaded('openssl'),
            'writableStorage' => is_writable($this->storagePath),
        ];
        return ['installed' => $this->installed(), 'ready' => !in_array(false, $checks, true), 'checks' => $checks, 'phpVersion' => PHP_VERSION];
    }

    private function jsonBody(): array
    {
        $declaredLength = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
        if ($declaredLength !== false && $declaredLength > self::MAX_JSON_BYTES) {
            throw new HttpError(413, 'Die Anfrage ist zu groß.');
        }
        $content = file_get_contents('php://input');
        if ($content === false || trim($content) === '') {
            return [];
        }
        if (strlen($content) > self::MAX_JSON_BYTES) {
            throw new HttpError(413, 'Die Anfrage ist zu groß.');
        }
        $decoded = json_decode($content, true);
        if (!is_array($decoded)) {
            throw new HttpError(400, 'Ungültige JSON-Anfrage.');
        }
        return $decoded;
    }

    private function assertFolderInput(array $user, array $input): void
    {
        if (!array_key_exists('folderId', $input) || $input['folderId'] === null || trim((string) $input['folderId']) === '') return;
        $folderId = (string) $input['folderId'];
        if (!$this->folders->exists($folderId)) {
            throw new HttpError(422, 'Der ausgewählte Projektordner wurde nicht gefunden.');
        }
        $this->requireFolderAccess($user, $folderId);
    }

    private function assertParentFolderAccess(array $user, array $input): void
    {
        $parentId = trim((string) ($input['parentId'] ?? ''));
        if ($parentId !== '') $this->requireFolderAccess($user, $parentId);
    }

    private function requireFolderAccess(array $user, string $folderId): void
    {
        $projects = array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
        if (!in_array($folderId, array_column($this->visibleFolders($user, $projects), 'id'), true)) {
            throw new HttpError(403, 'Kein Zugriff auf diesen Projektordner.');
        }
    }

    private function json(int $status, array $data): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    private function empty(int $status): never
    {
        http_response_code($status);
        header('Cache-Control: no-store');
        exit;
    }

    private function csvDownload(string $filename, string $content): never
    {
        http_response_code(200);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Length: ' . strlen($content));
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        echo $content;
        exit;
    }

    private function streamAttachment(array $content, bool $download): never
    {
        $file = (array) ($content['metadata'] ?? []);
        $path = (string) ($content['path'] ?? '');
        if (!is_file($path)) throw new HttpError(404, 'Dateiinhalt nicht gefunden.');
        $mimeType = (string) ($file['mimeType'] ?? 'application/octet-stream');
        $inline = !$download && (str_starts_with($mimeType, 'image/') || $mimeType === 'application/pdf');
        $originalName = (string) ($file['originalName'] ?? 'datei');
        $fallbackName = preg_replace('/[^A-Za-z0-9._-]+/', '_', $originalName) ?: 'datei';
        http_response_code(200);
        header('Content-Type: ' . $mimeType);
        header('Content-Length: ' . (string) filesize($path));
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $fallbackName . '"; filename*=UTF-8\'\'' . rawurlencode($originalName));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }

    private function streamProjectBackup(array $user, ?string $projectId = null): never
    {
        if (!class_exists(\PharData::class)) throw new HttpError(500, 'Die TAR-Unterstützung ist auf diesem Server nicht verfügbar.');
        $summaries = $projectId === null
            ? array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])))
            : [array_values(array_filter($this->projects->list(), static fn(array $project): bool => $project['id'] === $projectId))[0] ?? throw new HttpError(404, 'Projekt nicht gefunden.')];
        $projects = [];
        foreach ($summaries as $summary) {
            $project = $this->projects->get((string) $summary['id']);
            $project['accessUsers'] = $this->projectUsers((string) $project['id']);
            $projects[] = $project;
        }

        $allFolders = $this->visibleFolders($user, $summaries);
        if ($projectId === null) {
            $folders = $allFolders;
        } else {
            $folderById = [];
            foreach ($this->folders->list() as $folder) $folderById[$folder['id']] = $folder;
            $included = [];
            $folderId = (string) ($projects[0]['folderId'] ?? '');
            while ($folderId !== '' && isset($folderById[$folderId]) && !isset($included[$folderId])) {
                $included[$folderId] = true;
                $folderId = (string) ($folderById[$folderId]['parentId'] ?? '');
            }
            $folders = array_values(array_filter($this->folders->list(), static fn(array $folder): bool => isset($included[$folder['id']])));
        }
        $tags = $this->tagsFor($user, $summaries);
        if ($projectId !== null) {
            $usedTagIds = [];
            foreach ($projects as $project) foreach ((array) ($project['tagIds'] ?? []) as $id) $usedTagIds[$id] = true;
            foreach ($folders as $folder) foreach ((array) ($folder['tagIds'] ?? []) as $id) $usedTagIds[$id] = true;
            $tags = array_values(array_filter($tags, static fn(array $tag): bool => isset($usedTagIds[$tag['id']])));
        }
        $cleanFolders = array_map(static fn(array $folder): array => array_intersect_key($folder, array_flip(['id', 'parentId', 'name', 'description', 'priority', 'flagged', 'icon', 'tagIds', 'createdAt', 'updatedAt'])), $folders);
        $cleanTags = array_map(static fn(array $tag): array => array_intersect_key($tag, array_flip(['id', 'name', 'createdAt'])), $tags);
        $server = $this->serverSettings();
        $manifest = [
            'format' => 'logbuch-projects',
            'version' => 1,
            'exportedAt' => nowIso(),
            'source' => ['name' => 'Logbuch', 'host' => parse_url($this->detectedBaseUrl(), PHP_URL_HOST) ?: 'localhost'],
            'tags' => $cleanTags,
            'folders' => $cleanFolders,
            'serverSettings' => $projectId === null ? array_intersect_key($server, array_flip(['siteName', 'baseUrl', 'timezone'])) : null,
            'projects' => $projects,
        ];

        $temporaryDirectory = $this->storagePath . '/tmp';
        if (!is_dir($temporaryDirectory) && !mkdir($temporaryDirectory, 0770, true) && !is_dir($temporaryDirectory)) throw new HttpError(507, 'Temporäres Backup-Verzeichnis konnte nicht angelegt werden.');
        $base = tempnam($temporaryDirectory, 'backup-');
        if ($base === false) throw new HttpError(507, 'Temporäre Backup-Datei konnte nicht angelegt werden.');
        @unlink($base);
        $archivePath = $base . '.tar';
        try {
            $archive = new \PharData($archivePath);
            $archive->addFromString('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            foreach ($projects as $project) {
                $root = 'projects/' . $project['id'];
                $archive->addFromString($root . '/README.md', '# ' . $project['title'] . "\n\n" . trim((string) ($project['description'] ?? '')) . "\n");
                $archive->addFromString($root . '/project.json', json_encode($project, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                foreach (ProjectStore::COLLECTIONS as $collection) {
                    foreach ((array) ($project[$collection] ?? []) as $item) {
                        $archive->addFromString($root . '/' . $collection . '/' . $item['id'] . '.json', json_encode($item, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                    }
                }
                foreach ((array) ($project['files'] ?? []) as $file) {
                    $fileRoot = $root . '/attachments/' . $file['id'];
                    $archive->addFromString($fileRoot . '/metadata.json', json_encode($file, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                    $content = $this->projects->attachmentContent((string) $project['id'], (string) $file['id']);
                    $archive->addFile((string) $content['path'], $fileRoot . '/original.bin');
                }
            }
            unset($archive);
            $title = $projectId === null ? 'projekte' : (string) ($projects[0]['title'] ?? 'projekt');
            $safeTitle = trim(preg_replace('/[^A-Za-z0-9_-]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $title) ?: $title), '-') ?: 'projekt';
            $filename = 'logbuch-' . strtolower($safeTitle) . '-' . gmdate('Y-m-d') . '.tar';
            http_response_code(200);
            header('Content-Type: application/x-tar');
            header('Content-Length: ' . (string) filesize($archivePath));
            header('Content-Disposition: attachment; filename="' . $filename . '"');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: private, no-store');
            readfile($archivePath);
        } finally {
            @unlink($archivePath);
        }
        exit;
    }

    private function streamFullBackup(): never
    {
        if (!class_exists(\PharData::class)) throw new HttpError(500, 'Die TAR-Unterstützung ist auf diesem Server nicht verfügbar.');
        $projects = [];
        foreach ($this->projects->list() as $summary) {
            $project = $this->projects->get((string) $summary['id']);
            $project['accessUsers'] = $this->projectUsers((string) $project['id']);
            $projects[] = $project;
        }
        $tables = [];
        foreach (self::FULL_BACKUP_TABLES as $table => $columns) {
            $quotedColumns = implode(', ', array_map(static fn(string $column): string => '"' . $column . '"', $columns));
            $tables[$table] = $this->db->query('SELECT ' . $quotedColumns . ' FROM "' . $table . '"')->fetchAll() ?: [];
        }
        $inventoryItemImages = [];
        foreach ($tables['inventory_items'] as $item) {
            $metadata = $this->inventoryItems->imageMetadata((string) $item['id']);
            if ($metadata !== null) $inventoryItemImages[] = ['itemId' => (string) $item['id'], ...$metadata];
        }
        $appearanceLogo = is_file($this->appearanceLogoPath()) ? readJsonFile($this->appearanceLogoMetadataPath()) : null;
        if (!is_array($appearanceLogo) || !in_array((string) ($appearanceLogo['mimeType'] ?? ''), self::APPEARANCE_LOGO_MIME_TYPES, true)) $appearanceLogo = null;
        $manifest = [
            'format' => 'logbuch-full',
            'version' => self::FULL_BACKUP_VERSION,
            'schemaVersion' => \logbuch_schema_version(),
            'appVersion' => \logbuch_version(),
            'exportedAt' => nowIso(),
            'source' => ['name' => 'Logbuch', 'host' => parse_url($this->detectedBaseUrl(), PHP_URL_HOST) ?: 'localhost'],
            'tables' => $tables,
            'projects' => $projects,
            'inventoryItemImages' => $inventoryItemImages,
            'appearanceLogo' => $appearanceLogo,
        ];

        $temporaryDirectory = $this->storagePath . '/tmp';
        if (!is_dir($temporaryDirectory) && !mkdir($temporaryDirectory, 0770, true) && !is_dir($temporaryDirectory)) throw new HttpError(507, 'Temporäres Backup-Verzeichnis konnte nicht angelegt werden.');
        $base = tempnam($temporaryDirectory, 'full-backup-');
        if ($base === false) throw new HttpError(507, 'Temporäre Backup-Datei konnte nicht angelegt werden.');
        @unlink($base);
        $archivePath = $base . '.tar';
        try {
            $archive = new \PharData($archivePath);
            $archive->addFromString('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            foreach ($projects as $project) {
                foreach ((array) ($project['files'] ?? []) as $file) {
                    $fileRoot = 'projects/' . $project['id'] . '/attachments/' . $file['id'];
                    $archive->addFromString($fileRoot . '/metadata.json', json_encode($file, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                    $content = $this->projects->attachmentContent((string) $project['id'], (string) $file['id']);
                    $archive->addFile((string) $content['path'], $fileRoot . '/original.bin');
                }
            }
            foreach ($inventoryItemImages as $image) {
                $content = $this->inventoryItems->imageContent((string) $image['itemId']);
                $archive->addFile((string) $content['path'], 'inventory-items/' . $image['itemId'] . '/image.bin');
            }
            if ($appearanceLogo !== null) $archive->addFile($this->appearanceLogoPath(), 'appearance/logo.bin');
            unset($archive);
            $filename = 'logbuch-vollbackup-' . gmdate('Y-m-d') . '.tar';
            http_response_code(200);
            header('Content-Type: application/x-tar');
            header('Content-Length: ' . (string) filesize($archivePath));
            header('Content-Disposition: attachment; filename="' . $filename . '"');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: private, no-store');
            readfile($archivePath);
        } finally {
            @unlink($archivePath);
        }
        exit;
    }

    private function withCsrf(array $user): array
    {
        $user['csrfToken'] = $this->csrfToken();
        return $user;
    }

    private function csrfToken(): string
    {
        $cookie = (string) ($_COOKIE['logbuch_session'] ?? '');
        return hash_hmac('sha256', 'logbuch-csrf-v1', $cookie);
    }

    private function verifyCsrf(): void
    {
        $provided = (string) ($_SERVER['HTTP_X_LOGBUCH_CSRF'] ?? '');
        if ($provided === '' || !hash_equals($this->csrfToken(), $provided)) {
            throw new HttpError(403, 'Ungültiger CSRF-Schutz. Bitte die Seite neu laden.');
        }
    }

    private function requireAdmin(array $user): void
    {
        if (!$user['admin']) {
            throw new HttpError(403, 'Administratorrechte erforderlich.');
        }
    }

    private function requireEditor(array $user): void
    {
        if (!$user['admin'] && $user['role'] !== 'editor') {
            throw new HttpError(403, 'Bearbeitungsrechte erforderlich.');
        }
    }

    private function convertTodoToProject(array $user, string $todoId): array
    {
        $todos = $this->todos->list((string) $user['id']);
        $todo = current(array_filter($todos, static fn(array $item): bool => $item['id'] === $todoId));
        if (!is_array($todo)) throw new HttpError(404, 'Erinnerung nicht gefunden.');
        if (mb_strlen((string) $todo['title']) > 120) {
            throw new HttpError(422, 'Kürze den Erinnerungstitel vor der Umwandlung auf höchstens 120 Zeichen.');
        }
        $children = array_values(array_filter($todos, static fn(array $item): bool => $item['parentId'] === $todoId));
        foreach ($children as $child) {
            if (mb_strlen((string) $child['title']) > 160) {
                throw new HttpError(422, 'Kürze die untergeordneten Erinnerungen vor der Umwandlung auf höchstens 160 Zeichen.');
            }
        }

        $project = null;
        $transactionActive = false;
        try {
            $project = $this->projects->create([
                'title' => $todo['title'],
                'description' => '',
                'status' => 'active',
                'priority' => 'Mittel',
                'flagged' => false,
                'icon' => 'box',
                'iconInherited' => true,
                'createdAt' => substr(nowIso(), 0, 10),
                'dueDate' => '',
                'tagIds' => [],
                'folderId' => null,
            ], (string) $user['id']);
            foreach ($children as $child) {
                $this->projects->createItem((string) $project['id'], 'tasks', [
                    'title' => $child['title'],
                    'description' => '',
                    'status' => 'Offen',
                    'priority' => 'Normal',
                    'dueDate' => '',
                ], (string) $user['id']);
            }
            $project = $this->projects->get((string) $project['id']);

            $this->db->beginTransaction();
            $transactionActive = true;
            if (!$user['admin'] && $user['projectAccessMode'] === 'include') {
                $this->setUserProject((string) $user['id'], (string) $project['id'], true);
            }
            $this->todos->delete((string) $user['id'], $todoId);
            $this->audit((string) $user['id'], 'todo.converted_to_project', $todoId . ' → ' . $project['id'], 'children=' . count($children));
            $this->db->commit();
            $transactionActive = false;

            return ['project' => $project, 'convertedChildren' => count($children)];
        } catch (\Throwable $error) {
            if ($transactionActive && $this->db->inTransaction()) $this->db->rollBack();
            if (is_array($project) && isset($project['id'])) $this->projects->removeByIds([(string) $project['id']]);
            throw $error;
        }
    }

    private function canAccess(array $user, string $projectId): bool
    {
        if ($user['admin'] || $user['projectAccessMode'] === 'all') {
            return true;
        }
        $statement = $this->db->prepare('SELECT 1 FROM user_projects WHERE user_id = :user AND project_id = :project');
        $statement->execute(['user' => $user['id'], 'project' => $projectId]);
        $listed = (bool) $statement->fetchColumn();
        return $user['projectAccessMode'] === 'exclude' ? !$listed : $listed;
    }

    private function requireProjectAccess(array $user, string $projectId): void
    {
        if (!$this->projects->exists($projectId)) {
            throw new HttpError(404, 'Projekt nicht gefunden.');
        }
        if (!$this->canAccess($user, $projectId)) {
            throw new HttpError(403, 'Kein Zugriff auf dieses Projekt.');
        }
    }

    private function requireProjectEdit(array $user, string $projectId): void
    {
        $this->requireProjectAccess($user, $projectId);
        $this->requireEditor($user);
    }

    private function visibleFolders(array $user, array $projects): array
    {
        $folders = $this->folders->list();
        if ($user['admin'] || $user['projectAccessMode'] === 'all') {
            return $folders;
        }
        $byId = array_column($folders, null, 'id');
        $visibleIds = [];
        foreach ($folders as $folder) {
            if (($folder['createdBy'] ?? '') === $user['id']) {
                $folderId = (string) $folder['id'];
                while ($folderId !== '' && isset($byId[$folderId]) && !isset($visibleIds[$folderId])) {
                    $visibleIds[$folderId] = true;
                    $folderId = (string) ($byId[$folderId]['parentId'] ?? '');
                }
            }
        }
        foreach ($projects as $project) {
            $folderId = (string) ($project['folderId'] ?? '');
            while ($folderId !== '' && isset($byId[$folderId]) && !isset($visibleIds[$folderId])) {
                $visibleIds[$folderId] = true;
                $folderId = (string) ($byId[$folderId]['parentId'] ?? '');
            }
        }
        return array_values(array_filter($folders, static fn(array $folder): bool => isset($visibleIds[$folder['id']])));
    }

    private function updatePreferences(array $user, array $input): array
    {
        $allowed = ['home', 'projects', 'archive'];
        if (isset($input['startPage']) && !in_array($input['startPage'], $allowed, true)) {
            throw new HttpError(422, 'Ungültige Startseite.');
        }
        $projectSorts = ['status:asc', 'priority:desc', 'priority:asc', 'dueDate:asc', 'dueDate:desc', 'createdAt:desc', 'createdAt:asc', 'latestEntryDate:desc', 'latestEntryDate:asc', 'title:asc', 'title:desc'];
        $archiveSorts = array_values(array_filter($projectSorts, static fn(string $sort): bool => $sort !== 'status:asc'));
        if (isset($input['projectSort']) && !in_array($input['projectSort'], $projectSorts, true)) {
            throw new HttpError(422, 'Ungültige Standardsortierung für Projekte.');
        }
        if (isset($input['archiveSort']) && !in_array($input['archiveSort'], $archiveSorts, true)) {
            throw new HttpError(422, 'Ungültige Standardsortierung für das Archiv.');
        }
        if (isset($input['defaultProjectIcon']) && (!is_string($input['defaultProjectIcon']) || !preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $input['defaultProjectIcon']))) {
            throw new HttpError(422, 'Ungültiges Standard-Projektsymbol.');
        }
        foreach (['showProjectFolders', 'showOverviewSummary', 'showOverviewRecent', 'showOverviewNext', 'showOverviewRecentlyEdited', 'showOverviewMarked', 'showOverviewDueSoon', 'showOverviewHighPriority', 'showOverviewActivity', 'showOverviewTimeline'] as $flag) {
            if (array_key_exists($flag, $input) && !is_bool($input[$flag])) {
                throw new HttpError(422, 'Ungültige Übersichts-Einstellung.');
            }
        }
        foreach (['overviewRecentRows', 'overviewNextRows', 'overviewRecentlyEditedRows', 'overviewMarkedRows', 'overviewDueSoonRows', 'overviewHighPriorityRows'] as $rowSetting) {
            if (isset($input[$rowSetting]) && (!is_int($input[$rowSetting]) || $input[$rowSetting] < 1 || $input[$rowSetting] > 6)) {
                throw new HttpError(422, 'Es können 1–6 Zeilen angezeigt werden.');
            }
        }
        if (array_key_exists('overviewOrder', $input)) {
            $allowedSections = ['summary', 'recentlyEdited', 'marked', 'dueSoon', 'highPriority', 'next', 'recent', 'activity', 'timeline'];
            $order = $input['overviewOrder'];
            if (!is_array($order) || count($order) !== count($allowedSections) || count(array_filter($order, 'is_string')) !== count($allowedSections) || count(array_unique($order)) !== count($allowedSections) || array_diff($order, $allowedSections)) {
                throw new HttpError(422, 'Ungültige Reihenfolge der Übersichtsbereiche.');
            }
        }
        $statement = $this->db->prepare('SELECT preferences_json FROM users WHERE id = :id');
        $statement->execute(['id' => $user['id']]);
        $preferences = array_replace($this->auth->defaultPreferences(), json_decode((string) $statement->fetchColumn(), true) ?: []);
        foreach (array_keys($this->auth->defaultPreferences()) as $key) {
            if (array_key_exists($key, $input)) {
                $preferences[$key] = $input[$key];
            }
        }
        $this->db->prepare('UPDATE users SET preferences_json = :preferences WHERE id = :id')->execute(['preferences' => json_encode($preferences), 'id' => $user['id']]);
        return $preferences;
    }

    private function systemStatus(): array
    {
        $general = $this->getSetting('general', []);
        $projects = $this->projects->list();
        $demoManifest = $this->demoManifest();
        $demoIds = array_column($demoManifest['projects'], 'id');
        $demoProjectCount = count(array_filter($projects, static fn(array $project): bool => in_array($project['id'], $demoIds, true)));
        $demoFolderIds = array_column($demoManifest['folders'], 'id');
        $demoFolderCount = count(array_filter($this->folders->list(), static fn(array $folder): bool => in_array($folder['id'], $demoFolderIds, true)));
        $demoStorageLocationIds = array_column($demoManifest['storageLocations'], 'id');
        $demoStorageLocationCount = count(array_filter($this->storageLocations->list(true), static fn(array $location): bool => in_array($location['id'], $demoStorageLocationIds, true)));
        $demoInventoryItemIds = array_column($demoManifest['inventoryItems'], 'id');
        $demoInventoryItemCount = count(array_filter($this->inventoryItems->list(true), static fn(array $item): bool => in_array($item['id'], $demoInventoryItemIds, true)));
        $totalBytes = $this->directorySize($this->storagePath);
        return [
            'hostname' => parse_url($this->detectedBaseUrl(), PHP_URL_HOST) ?: ($_SERVER['HTTP_HOST'] ?? 'localhost'),
            'baseUrl' => $general['baseUrl'] ?? $this->detectedBaseUrl(),
            'platform' => getenv('LOGBUCH_PLATFORM') ?: 'webhosting',
            'version' => \logbuch_version(),
            'phpVersion' => PHP_VERSION,
            'projectCount' => count($projects),
            'demoProjectCount' => $demoProjectCount,
            'demoFolderCount' => $demoFolderCount,
            'demoStorageLocationCount' => $demoStorageLocationCount,
            'demoInventoryItemCount' => $demoInventoryItemCount,
            'storageBytes' => $totalBytes,
            'storageFreeBytes' => @disk_free_space($this->storagePath) ?: 0,
            'database' => 'SQLite ' . ($this->db->query('SELECT sqlite_version()')->fetchColumn() ?: ''),
        ];
    }

    private function detectedBaseUrl(): string
    {
        $scheme = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') ? 'https' : 'http';
        $host = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost')) ?: 'localhost';
        return $scheme . '://' . $host;
    }

    private function inventoryItemWithCategories(array $item): array
    {
        $item['categoryIds'] = $this->inventoryCategories->categoryIdsForItem((string) $item['id']);
        return $item;
    }

    private function inventoryItemsWithCategories(array $items): array
    {
        return array_map(fn(array $item): array => $this->inventoryItemWithCategories($item), $items);
    }

    private function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    private function setSetting(string $key, array $value): void
    {
        $statement = $this->db->prepare('INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        $statement->execute(['key' => $key, 'value' => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }

    private function getSetting(string $key, array $default): array
    {
        $statement = $this->db->prepare('SELECT value FROM settings WHERE key = :key');
        $statement->execute(['key' => $key]);
        $value = $statement->fetchColumn();
        $decoded = $value === false ? null : json_decode((string) $value, true);
        return is_array($decoded) ? $decoded : $default;
    }

    private function audit(string $actor, string $action, string $target = '', string $details = ''): void
    {
        $statement = $this->db->prepare('INSERT INTO audit (occurred_at, actor, action, target, details) VALUES (:at, :actor, :action, :target, :details)');
        $statement->execute(['at' => nowIso(), 'actor' => $actor, 'action' => $action, 'target' => $target, 'details' => $details]);
        $this->db->exec('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)');
    }

    private function clearAllContent(string $actor): array
    {
        $counts = [
            'projects' => count($this->projects->list()),
            'reminders' => (int) $this->db->query('SELECT COUNT(*) FROM todos')->fetchColumn(),
            'storageLocations' => (int) $this->db->query('SELECT COUNT(*) FROM storage_locations')->fetchColumn(),
            'items' => (int) $this->db->query('SELECT COUNT(*) FROM inventory_items')->fetchColumn(),
            'itemNotes' => (int) $this->db->query('SELECT COUNT(*) FROM inventory_item_notes')->fetchColumn(),
            'categories' => (int) $this->db->query('SELECT COUNT(*) FROM inventory_categories')->fetchColumn(),
            'stockEntries' => (int) $this->db->query('SELECT COUNT(*) FROM stock_entries')->fetchColumn(),
            'reservations' => (int) $this->db->query('SELECT COUNT(*) FROM reservations')->fetchColumn(),
            'stockTransactions' => (int) $this->db->query('SELECT COUNT(*) FROM stock_transactions')->fetchColumn(),
        ];

        $this->db->exec('BEGIN IMMEDIATE');
        $transactionActive = true;
        try {
            // Dependent inventory records must go first so historical foreign
            // keys never point at content removed by this reset.
            $this->db->exec('DELETE FROM stock_transactions');
            $this->db->exec('DELETE FROM reservations');
            $this->db->exec('DELETE FROM stock_entries');
            $this->db->exec('DELETE FROM inventory_item_notes');
            $this->db->exec('DELETE FROM inventory_item_categories');
            $this->db->exec('DELETE FROM inventory_items');
            $this->db->exec('UPDATE inventory_categories SET parent_id = NULL WHERE parent_id IS NOT NULL');
            $this->db->exec('DELETE FROM inventory_categories');
            $this->db->exec('UPDATE storage_locations SET parent_id = NULL WHERE parent_id IS NOT NULL');
            $this->db->exec('DELETE FROM storage_locations');
            $this->db->exec('DELETE FROM todos');
            $this->db->exec('DELETE FROM user_projects');
            $this->db->exec('DELETE FROM tags');
            $this->db->exec('UPDATE folders SET parent_id = NULL WHERE parent_id IS NOT NULL');
            $this->db->exec('DELETE FROM folders');

            $counts['projects'] = $this->projects->clear();
            $this->audit(
                $actor,
                'system.content_cleared',
                (string) array_sum($counts),
                json_encode($counts, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''
            );
            $this->db->exec('COMMIT');
            $transactionActive = false;
            $this->inventoryItems->clearImages();
        } catch (\Throwable $error) {
            if ($transactionActive) {
                try {
                    $this->db->exec('ROLLBACK');
                } catch (\Throwable) {
                }
            }
            throw $error;
        }

        // Keep the legacy field for API clients that only displayed the
        // deleted project count before the reset covered every content area.
        return ['removed' => $counts['projects'], ...$counts];
    }

    private function auditEvents(): array
    {
        $rows = $this->db->query('SELECT occurred_at AS at, actor, action, target, details FROM audit ORDER BY id DESC LIMIT 500')->fetchAll();
        return $rows ?: [];
    }

    private function projectUsers(string $projectId): array
    {
        $statement = $this->db->prepare('SELECT user_id FROM user_projects WHERE project_id = :project ORDER BY user_id');
        $statement->execute(['project' => $projectId]);
        return array_column($statement->fetchAll(), 'user_id');
    }

    private function setUserProject(string $userId, string $projectId, bool $selected): void
    {
        if ($selected) {
            $statement = $this->db->prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (:user, :project)');
        } else {
            $statement = $this->db->prepare('DELETE FROM user_projects WHERE user_id = :user AND project_id = :project');
        }
        $statement->execute(['user' => $userId, 'project' => $projectId]);
    }

    private function userExists(string $id): bool
    {
        $statement = $this->db->prepare('SELECT 1 FROM users WHERE id = :id');
        $statement->execute(['id' => $id]);
        return (bool) $statement->fetchColumn();
    }

    private function replaceUserProjects(string $userId, array $projectIds): void
    {
        $this->db->prepare('DELETE FROM user_projects WHERE user_id = :user')->execute(['user' => $userId]);
        foreach (array_unique($projectIds) as $projectId) {
            if (is_string($projectId) && $this->projects->exists($projectId)) {
                $this->setUserProject($userId, $projectId, true);
            }
        }
    }

    private function listUsers(): array
    {
        $users = [];
        foreach ($this->db->query('SELECT * FROM users ORDER BY id')->fetchAll() as $row) {
            $user = $this->auth->publicUser($row);
            $user['projectIds'] = $user['admin'] ? array_column($this->projects->list(), 'id') : $this->userProjectIds($user['id']);
            $users[] = $user;
        }
        return $users;
    }

    private function createUser(array $actor, array $input): array
    {
        $id = trim((string) ($input['id'] ?? ''));
        $role = (string) ($input['role'] ?? 'editor');
        $access = (string) ($input['projectAccessMode'] ?? 'include');
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $id) || !in_array($role, ['admin', 'editor', 'viewer'], true) || !in_array($access, ['include', 'exclude', 'all'], true)) {
            throw new HttpError(422, 'Ungültiger Benutzername, Rolle oder Zugriffsmodus.');
        }
        $this->auth->validatePassword((string) ($input['password'] ?? ''));
        try {
            $statement = $this->db->prepare('INSERT INTO users (id, role, active, access_mode, password_hash, must_change_password, preferences_json, created_at) VALUES (:id, :role, 1, :access, :hash, :change, :preferences, :created)');
            $statement->execute(['id' => $id, 'role' => $role, 'access' => $access, 'hash' => password_hash((string) $input['password'], PASSWORD_ARGON2ID), 'change' => (int) ($input['mustChangePassword'] ?? true), 'preferences' => json_encode($this->auth->defaultPreferences()), 'created' => nowIso()]);
        } catch (\PDOException $error) {
            if (str_contains($error->getMessage(), 'UNIQUE')) {
                throw new HttpError(409, 'Benutzername ist bereits vergeben.');
            }
            throw $error;
        }
        $this->replaceUserProjects($id, (array) ($input['projectIds'] ?? []));
        $this->audit($actor['id'], 'user.created', $id);
        return array_values(array_filter($this->listUsers(), static fn(array $user): bool => $user['id'] === $id))[0];
    }

    private function updateUser(array $actor, string $id, array $input): array
    {
        $statement = $this->db->prepare('SELECT * FROM users WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpError(404, 'Benutzer nicht gefunden.');
        }
        $role = (string) ($input['role'] ?? $row['role']);
        $active = array_key_exists('active', $input) ? (bool) $input['active'] : (bool) $row['active'];
        $access = (string) ($input['projectAccessMode'] ?? $row['access_mode']);
        if ($id === $actor['id'] && (!$active || $role !== 'admin')) {
            throw new HttpError(422, 'Der eigene Administratorzugang kann nicht deaktiviert oder herabgestuft werden.');
        }
        if (!in_array($role, ['admin', 'editor', 'viewer'], true) || !in_array($access, ['include', 'exclude', 'all'], true)) {
            throw new HttpError(422, 'Ungültige Rolle oder ungültiger Zugriffsmodus.');
        }
        if ($row['role'] === 'admin' && (bool) $row['active'] && ($role !== 'admin' || !$active) && $this->activeAdminCount($id) === 0) {
            throw new HttpError(422, 'Der letzte aktive Administrator muss erhalten bleiben.');
        }
        $hash = $row['password_hash'];
        if (!empty($input['password'])) {
            $this->auth->validatePassword((string) $input['password']);
            $hash = password_hash((string) $input['password'], PASSWORD_ARGON2ID);
        }
        $update = $this->db->prepare('UPDATE users SET role = :role, active = :active, access_mode = :access, password_hash = :hash, must_change_password = :change WHERE id = :id');
        $update->execute(['role' => $role, 'active' => (int) $active, 'access' => $access, 'hash' => $hash, 'change' => (int) ($input['mustChangePassword'] ?? $row['must_change_password']), 'id' => $id]);
        if (isset($input['projectIds']) && is_array($input['projectIds'])) {
            $this->replaceUserProjects($id, $input['projectIds']);
        }
        if (!$active || isset($input['role']) || isset($input['projectAccessMode']) || !empty($input['password'])) {
            $query = $id === $actor['id'] ? 'DELETE FROM sessions WHERE user_id = :id AND id <> :session' : 'DELETE FROM sessions WHERE user_id = :id';
            $params = $id === $actor['id'] ? ['id' => $id, 'session' => $actor['sessionId']] : ['id' => $id];
            $this->db->prepare($query)->execute($params);
        }
        $this->audit($actor['id'], 'user.updated', $id);
        return array_values(array_filter($this->listUsers(), static fn(array $user): bool => $user['id'] === $id))[0];
    }

    private function deleteUser(array $actor, string $id): void
    {
        if ($id === $actor['id']) {
            throw new HttpError(422, 'Der eigene Benutzer kann nicht gelöscht werden.');
        }
        $statement = $this->db->prepare('DELETE FROM users WHERE id = :id');
        $statement->execute(['id' => $id]);
        if ($statement->rowCount() === 0) {
            throw new HttpError(404, 'Benutzer nicht gefunden.');
        }
        $this->audit($actor['id'], 'user.deleted', $id);
    }

    private function activeAdminCount(string $excluding = ''): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM users WHERE role = :role AND active = 1 AND id <> :excluding');
        $statement->execute(['role' => 'admin', 'excluding' => $excluding]);
        return (int) $statement->fetchColumn();
    }

    private function userProjectIds(string $userId): array
    {
        $statement = $this->db->prepare('SELECT project_id FROM user_projects WHERE user_id = :user ORDER BY project_id');
        $statement->execute(['user' => $userId]);
        return array_column($statement->fetchAll(), 'project_id');
    }

    private function sessions(array $current): array
    {
        $now = time();
        $this->db->prepare('DELETE FROM sessions WHERE touched_at < :expired')->execute(['expired' => $now - 1209600]);
        $rows = $this->db->query('SELECT sessions.*, users.id AS user_id FROM sessions JOIN users ON users.id = sessions.user_id ORDER BY sessions.touched_at DESC')->fetchAll();
        return array_map(static fn(array $row): array => [
            'id' => $row['id'],
            'userId' => $row['user_id'],
            'name' => $row['user_id'],
            'ip' => $row['ip'],
            'userAgent' => $row['user_agent'],
            'activeAgoSeconds' => max(0, $now - (int) $row['touched_at']),
            'ageSeconds' => max(0, $now - (int) $row['created_at']),
            'current' => $row['id'] === $current['sessionId'],
        ], $rows);
    }

    private function revokeSession(array $actor, string $sessionId): void
    {
        if ($sessionId === $actor['sessionId']) {
            throw new HttpError(422, 'Die aktuelle Sitzung wird über Abmelden beendet.');
        }
        $statement = $this->db->prepare('SELECT user_id FROM sessions WHERE id = :id');
        $statement->execute(['id' => $sessionId]);
        $target = $statement->fetchColumn();
        if ($target === false) {
            throw new HttpError(404, 'Sitzung nicht gefunden.');
        }
        $this->db->prepare('DELETE FROM sessions WHERE id = :id')->execute(['id' => $sessionId]);
        $this->audit($actor['id'], 'session.revoked', (string) $target, $sessionId);
    }

    private function tagsFor(array $user, ?array $projects = null): array
    {
        $projects ??= array_values(array_filter($this->projects->list(), fn(array $project): bool => $this->canAccess($user, $project['id'])));
        $usageByTag = [];
        foreach ($projects as $project) {
            $status = (string) ($project['status'] ?? '');
            if (!in_array($status, ['idea', 'active', 'paused', 'completed', 'archived'], true)) continue;
            foreach ($project['tagIds'] ?? [] as $tagId) {
                $usageByTag[$tagId] ??= ['activeProjectCount' => 0, 'archivedProjectCount' => 0];
                $key = $status === 'archived' ? 'archivedProjectCount' : 'activeProjectCount';
                ++$usageByTag[$tagId][$key];
            }
        }
        foreach ($this->visibleFolders($user, $projects) as $folder) {
            foreach ($folder['tagIds'] ?? [] as $tagId) {
                $usageByTag[$tagId] ??= ['activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
                $usageByTag[$tagId]['folderCount'] = ($usageByTag[$tagId]['folderCount'] ?? 0) + 1;
            }
        }
        $tags = [];
        foreach ($this->db->query('SELECT * FROM tags ORDER BY name COLLATE NOCASE')->fetchAll() as $row) {
            if (!$user['admin'] && !isset($usageByTag[$row['id']])) {
                continue;
            }
            $usage = $usageByTag[$row['id']] ?? ['activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
            $usage['folderCount'] ??= 0;
            $tags[] = ['id' => $row['id'], 'name' => $row['name'], 'normalizedName' => $row['normalized_name'], 'createdAt' => $row['created_at'], ...$usage];
        }
        return $tags;
    }

    private function createTag(array $actor, string $name): array
    {
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? $name);
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
            throw new HttpError(422, 'Ein Tag muss 2–40 Zeichen lang sein.');
        }
        $normalized = normalizeName($name);
        $existing = $this->db->prepare('SELECT id FROM tags WHERE normalized_name = :name');
        $existing->execute(['name' => $normalized]);
        if ($id = $existing->fetchColumn()) {
            $row = $this->db->prepare('SELECT id, name, normalized_name, created_at FROM tags WHERE id = :id');
            $row->execute(['id' => $id]);
            $tag = $row->fetch();
            return ['id' => $tag['id'], 'name' => $tag['name'], 'normalizedName' => $tag['normalized_name'], 'createdAt' => $tag['created_at'], 'activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
        }
        $id = 'tag-' . slug($name) . '-' . bin2hex(random_bytes(2));
        $createdAt = nowIso();
        $this->db->prepare('INSERT INTO tags (id, name, normalized_name, active, created_at) VALUES (:id, :name, :normalized, 1, :created)')->execute(['id' => $id, 'name' => $name, 'normalized' => $normalized, 'created' => $createdAt]);
        $this->audit($actor['id'], 'tag.created', $name);
        return ['id' => $id, 'name' => $name, 'normalizedName' => $normalized, 'createdAt' => $createdAt, 'activeProjectCount' => 0, 'archivedProjectCount' => 0, 'folderCount' => 0];
    }

    private function updateTag(array $actor, string $id, array $input): array
    {
        if (array_key_exists('active', $input)) {
            throw new HttpError(422, 'Tags können nicht deaktiviert werden.');
        }
        $statement = $this->db->prepare('SELECT * FROM tags WHERE id = :id');
        $statement->execute(['id' => $id]);
        $tag = $statement->fetch();
        if (!$tag) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        $name = isset($input['name']) ? trim(preg_replace('/\s+/u', ' ', (string) $input['name']) ?? (string) $input['name']) : $tag['name'];
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
            throw new HttpError(422, 'Ein Tag muss 2–40 Zeichen lang sein.');
        }
        try {
            $this->db->prepare('UPDATE tags SET name = :name, normalized_name = :normalized, active = 1 WHERE id = :id')->execute(['name' => $name, 'normalized' => normalizeName($name), 'id' => $id]);
        } catch (\PDOException $error) {
            if (str_contains($error->getMessage(), 'UNIQUE')) {
                throw new HttpError(409, 'Ein Tag mit diesem Namen existiert bereits.');
            }
            throw $error;
        }
        $this->audit($actor['id'], 'tag.updated', $name);
        return array_values(array_filter($this->tagsFor($actor), static fn(array $candidate): bool => $candidate['id'] === $id))[0];
    }

    private function deleteTag(array $actor, string $id, bool $removeFromProjects): void
    {
        $statement = $this->db->prepare('SELECT name FROM tags WHERE id = :id');
        $statement->execute(['id' => $id]);
        $name = $statement->fetchColumn();
        if ($name === false) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        $assigned = array_filter($this->projects->list(), static fn(array $project): bool => in_array($id, $project['tagIds'] ?? [], true));
        $assignedFolders = array_filter($this->folders->list(), static fn(array $folder): bool => in_array($id, $folder['tagIds'] ?? [], true));
        if (($assigned || $assignedFolders) && !$removeFromProjects) {
            throw new HttpError(409, 'Tag ist noch Projekten oder Ordnern zugewiesen.');
        }
        foreach ($assigned as $project) {
            $this->projects->update($project['id'], ['tagIds' => array_values(array_filter($project['tagIds'] ?? [], static fn(string $tagId): bool => $tagId !== $id))]);
        }
        foreach ($assignedFolders as $folder) {
            $this->folders->update($folder['id'], ['tagIds' => array_values(array_filter($folder['tagIds'] ?? [], static fn(string $tagId): bool => $tagId !== $id))]);
        }
        $this->db->prepare('DELETE FROM tags WHERE id = :id')->execute(['id' => $id]);
        $this->audit($actor['id'], 'tag.deleted', (string) $name);
    }

    private function mergeTag(array $actor, string $sourceId, string $targetId): array
    {
        if ($sourceId === $targetId) {
            throw new HttpError(422, 'Quell- und Ziel-Tag müssen verschieden sein.');
        }
        $tags = $this->tagsFor($actor);
        $source = array_values(array_filter($tags, static fn(array $tag): bool => $tag['id'] === $sourceId))[0] ?? null;
        $target = array_values(array_filter($tags, static fn(array $tag): bool => $tag['id'] === $targetId))[0] ?? null;
        if (!$source || !$target) {
            throw new HttpError(404, 'Tag nicht gefunden.');
        }
        foreach ($this->projects->list() as $project) {
            if (!in_array($sourceId, $project['tagIds'] ?? [], true)) {
                continue;
            }
            $ids = array_map(static fn(string $id): string => $id === $sourceId ? $targetId : $id, $project['tagIds']);
            $this->projects->update($project['id'], ['tagIds' => array_values(array_unique($ids))]);
        }
        foreach ($this->folders->list() as $folder) {
            if (!in_array($sourceId, $folder['tagIds'] ?? [], true)) continue;
            $ids = array_map(static fn(string $id): string => $id === $sourceId ? $targetId : $id, $folder['tagIds']);
            $this->folders->update($folder['id'], ['tagIds' => array_values(array_unique($ids))]);
        }
        $this->db->prepare('DELETE FROM tags WHERE id = :id')->execute(['id' => $sourceId]);
        $this->audit($actor['id'], 'tag.merged', $source['name'], 'target=' . $target['name']);
        return array_values(array_filter($this->tagsFor($actor), static fn(array $tag): bool => $tag['id'] === $targetId))[0];
    }

    private function serverSettings(): array
    {
        $general = $this->getSetting('general', []);
        return [
            'siteName' => $general['siteName'] ?? 'Logbuch',
            'baseUrl' => $general['baseUrl'] ?? $this->detectedBaseUrl(),
            'timezone' => $general['timezone'] ?? 'Europe/Berlin',
            'platform' => getenv('LOGBUCH_PLATFORM') ?: 'webhosting',
            'currentTime' => nowIso(),
        ];
    }

    private function appearanceSettings(): array
    {
        $general = $this->getSetting('general', []);
        $appearance = $this->getSetting('appearance', []);
        $accentColor = strtolower((string) ($appearance['accentColor'] ?? '#e5322c'));
        if (preg_match('/^#[0-9a-f]{6}$/', $accentColor) !== 1) $accentColor = '#e5322c';
        $themeMode = (string) ($appearance['themeMode'] ?? 'light');
        if (!in_array($themeMode, ['light', 'dark', 'auto'], true)) $themeMode = 'light';
        $metadata = readJsonFile($this->appearanceLogoMetadataPath());
        $hasLogo = is_file($this->appearanceLogoPath()) && in_array((string) ($metadata['mimeType'] ?? ''), self::APPEARANCE_LOGO_MIME_TYPES, true);
        return [
            'displayName' => (string) ($appearance['displayName'] ?? $general['siteName'] ?? 'Logbuch'),
            'subtitle' => (string) ($appearance['subtitle'] ?? ''),
            'accentColor' => $accentColor,
            'themeMode' => $themeMode,
            'hasLogo' => $hasLogo,
            'logoUrl' => $hasLogo ? '/api/appearance/logo?v=' . rawurlencode((string) ($metadata['updatedAt'] ?? '1')) : null,
            'logo' => $hasLogo ? $metadata : null,
        ];
    }

    private function updateAppearanceSettings(array $actor, array $input): array
    {
        $current = $this->appearanceSettings();
        $displayName = trim(preg_replace('/\s+/u', ' ', (string) ($input['displayName'] ?? $current['displayName'])) ?? '');
        $subtitle = trim(preg_replace('/\s+/u', ' ', (string) ($input['subtitle'] ?? $current['subtitle'])) ?? '');
        $accentColor = strtolower(trim((string) ($input['accentColor'] ?? $current['accentColor'])));
        $themeMode = trim((string) ($input['themeMode'] ?? $current['themeMode']));
        if (mb_strlen($displayName) < 2 || mb_strlen($displayName) > 80) throw new HttpError(422, 'Der Anzeigename muss 2–80 Zeichen lang sein.');
        if (mb_strlen($subtitle) > 120) throw new HttpError(422, 'Der Untertitel darf höchstens 120 Zeichen lang sein.');
        if (preg_match('/^#[0-9a-f]{6}$/', $accentColor) !== 1) throw new HttpError(422, 'Die Akzentfarbe muss als sechsstelliger Hex-Code angegeben werden.');
        if (!in_array($themeMode, ['light', 'dark', 'auto'], true)) throw new HttpError(422, 'Der Darstellungsmodus muss hell, dunkel oder automatisch sein.');
        $this->setSetting('appearance', ['displayName' => $displayName, 'subtitle' => $subtitle, 'accentColor' => $accentColor, 'themeMode' => $themeMode]);
        $this->audit($actor['id'], 'appearance.settings_updated', $displayName, 'accentColor=' . $accentColor . '; themeMode=' . $themeMode);
        return ['saved' => true, ...$this->appearanceSettings()];
    }

    private function uploadAppearanceLogo(array $actor, array $upload): array
    {
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new HttpError(413, 'Das Logo ist größer als 8 MB.');
        $size = (int) ($upload['size'] ?? 0);
        $source = (string) ($upload['tmp_name'] ?? '');
        if ($error !== UPLOAD_ERR_OK || $size < 1 || !is_uploaded_file($source)) throw new HttpError(422, 'Das Logo konnte nicht hochgeladen werden.');
        if ($size > self::MAX_APPEARANCE_LOGO_BYTES) throw new HttpError(413, 'Das Logo ist größer als 8 MB.');
        $detectedMime = class_exists(\finfo::class) ? (new \finfo(FILEINFO_MIME_TYPE))->file($source) : false;
        $mimeType = is_string($detectedMime) ? $detectedMime : '';
        if (!in_array($mimeType, self::APPEARANCE_LOGO_MIME_TYPES, true) || @getimagesize($source) === false) throw new HttpError(415, 'Unterstützt werden JPEG-, PNG-, WebP- und GIF-Bilder.');

        $directory = $this->appearanceDirectory();
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) throw new HttpError(507, 'Die Logoablage konnte nicht angelegt werden.');
        $incoming = $directory . '/logo-' . bin2hex(random_bytes(6)) . '.tmp';
        if (!move_uploaded_file($source, $incoming)) throw new HttpError(507, 'Das Logo konnte nicht gespeichert werden.');
        try {
            $metadata = [
                'originalName' => mb_substr(trim(basename(str_replace('\\', '/', (string) ($upload['name'] ?? 'logo')))), 0, 240) ?: 'logo',
                'mimeType' => $mimeType,
                'size' => (int) filesize($incoming),
                'sha256' => hash_file('sha256', $incoming) ?: '',
                'updatedAt' => nowIso(),
            ];
            if (is_file($this->appearanceLogoPath()) && !@unlink($this->appearanceLogoPath())) throw new HttpError(507, 'Das bisherige Logo konnte nicht ersetzt werden.');
            if (!rename($incoming, $this->appearanceLogoPath())) throw new HttpError(507, 'Das Logo konnte nicht aktiviert werden.');
            writeJsonFile($this->appearanceLogoMetadataPath(), $metadata);
        } finally {
            if (is_file($incoming)) @unlink($incoming);
        }
        $this->audit($actor['id'], 'appearance.logo_updated', (string) $metadata['originalName']);
        return $this->appearanceSettings();
    }

    private function deleteAppearanceLogo(array $actor): array
    {
        $removed = false;
        foreach ([$this->appearanceLogoPath(), $this->appearanceLogoMetadataPath()] as $path) {
            if (is_file($path)) {
                if (!@unlink($path)) throw new HttpError(507, 'Das Logo konnte nicht entfernt werden.');
                $removed = true;
            }
        }
        $this->audit($actor['id'], 'appearance.logo_removed');
        return ['removed' => $removed, ...$this->appearanceSettings()];
    }

    private function streamAppearanceLogo(): never
    {
        $metadata = readJsonFile($this->appearanceLogoMetadataPath());
        if (!is_file($this->appearanceLogoPath()) || !in_array((string) ($metadata['mimeType'] ?? ''), self::APPEARANCE_LOGO_MIME_TYPES, true)) throw new HttpError(404, 'Kein eigenes Logo hinterlegt.');
        $this->streamAttachment(['metadata' => $metadata, 'path' => $this->appearanceLogoPath()], false);
    }

    private function appearanceDirectory(): string
    {
        return rtrim($this->storagePath, '/') . '/appearance';
    }

    private function appearanceLogoPath(): string
    {
        return $this->appearanceDirectory() . '/logo.bin';
    }

    private function appearanceLogoMetadataPath(): string
    {
        return $this->appearanceDirectory() . '/logo.json';
    }

    private function updateServerSettings(array $actor, array $input): array
    {
        $current = $this->serverSettings();
        $siteName = trim((string) ($input['siteName'] ?? $current['siteName']));
        $baseUrl = rtrim(trim((string) ($input['baseUrl'] ?? $current['baseUrl'])), '/');
        $timezone = (string) ($input['timezone'] ?? $current['timezone']);
        if (mb_strlen($siteName) < 2 || mb_strlen($siteName) > 80 || !filter_var($baseUrl, FILTER_VALIDATE_URL) || !in_array($timezone, timezone_identifiers_list(), true)) {
            throw new HttpError(422, 'Ungültige Servereinstellungen.');
        }
        $this->setSetting('general', ['siteName' => $siteName, 'baseUrl' => $baseUrl, 'timezone' => $timezone]);
        $this->audit($actor['id'], 'server.settings_updated', $baseUrl);
        return ['saved' => true, ...$this->serverSettings()];
    }

    private function importBackupMetadata(array $actor, array $input): array
    {
        $folders = $input['folders'] ?? [];
        $settings = $input['serverSettings'] ?? null;
        if (!is_array($folders) || count($folders) > 1000 || ($settings !== null && !is_array($settings))) {
            throw new HttpError(422, 'Ungültige Metadaten im Backup.');
        }
        $replace = (bool) ($input['replace'] ?? false);
        $this->db->beginTransaction();
        try {
            $this->importTagDefinitions((array) ($input['tags'] ?? []));
            $pending = array_values($folders);
            $seen = [];
            foreach ($pending as $folder) {
                $id = is_array($folder) ? (string) ($folder['id'] ?? '') : '';
                if (!validId($id) || isset($seen[$id])) throw new HttpError(422, 'Ungültige oder doppelte Projektordner im Backup.');
                $seen[$id] = true;
            }
            $imported = 0;
            $skipped = 0;
            while ($pending) {
                $remaining = [];
                $progress = false;
                foreach ($pending as $folder) {
                    $id = (string) $folder['id'];
                    $parentId = trim((string) ($folder['parentId'] ?? ''));
                    if ($parentId !== '' && !$this->folders->exists($parentId)) {
                        $remaining[] = $folder;
                        continue;
                    }
                    if ($this->folders->exists($id) && !$replace) {
                        ++$skipped;
                    } else {
                        $this->folders->saveImported($folder, $actor['id']);
                        ++$imported;
                    }
                    $progress = true;
                }
                if (!$progress) throw new HttpError(422, 'Die Ordnerhierarchie im Backup ist unvollständig oder zyklisch.');
                $pending = $remaining;
            }
            $restoredSettings = false;
            if ($settings !== null) {
                $this->updateServerSettings($actor, $settings);
                $restoredSettings = true;
            }
            $this->audit($actor['id'], 'data.metadata_imported', (string) $imported, 'skipped=' . $skipped);
            $this->db->commit();
            return ['foldersImported' => $imported, 'foldersSkipped' => $skipped, 'settingsRestored' => $restoredSettings];
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    private function importProjectArchive(array $actor, array $upload, string $conflict): array
    {
        if (!class_exists(\PharData::class)) throw new HttpError(500, 'Die TAR-Unterstützung ist auf diesem Server nicht verfügbar.');
        if (!in_array($conflict, ['skip', 'replace'], true)) throw new HttpError(422, 'Ungültige Konfliktbehandlung.');
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new HttpError(413, 'Das Backup-Archiv ist zu groß.');
        $source = (string) ($upload['tmp_name'] ?? '');
        $size = (int) ($upload['size'] ?? 0);
        if ($error !== UPLOAD_ERR_OK || $size < 1 || $size > 4 * 1024 ** 3 || !is_uploaded_file($source)) throw new HttpError(422, 'Das Backup-Archiv konnte nicht hochgeladen werden.');
        $temporaryDirectory = $this->storagePath . '/tmp';
        if (!is_dir($temporaryDirectory) && !mkdir($temporaryDirectory, 0770, true) && !is_dir($temporaryDirectory)) throw new HttpError(507, 'Temporäres Import-Verzeichnis konnte nicht angelegt werden.');
        $base = tempnam($temporaryDirectory, 'import-');
        if ($base === false) throw new HttpError(507, 'Temporäre Import-Datei konnte nicht angelegt werden.');
        @unlink($base);
        $archivePath = $base . '.tar';
        if (!move_uploaded_file($source, $archivePath)) throw new HttpError(507, 'Das Backup-Archiv konnte nicht für den Import vorbereitet werden.');
        try {
            try {
                $archive = new \PharData($archivePath);
            } catch (\Throwable) {
                throw new HttpError(422, 'Das gewählte Archiv ist kein lesbares TAR-Backup.');
            }
            if (!isset($archive['manifest.json'])) throw new HttpError(422, 'Im Archiv fehlt manifest.json.');
            $manifestEntry = $archive['manifest.json'];
            if ($manifestEntry->getSize() > 64 * 1024 * 1024) throw new HttpError(413, 'Die Backup-Beschreibung ist zu groß.');
            $manifest = json_decode($manifestEntry->getContent(), true);
            if (!is_array($manifest) || ($manifest['format'] ?? '') !== 'logbuch-projects' || (int) ($manifest['version'] ?? 0) !== 1 || !is_array($manifest['projects'] ?? null)) throw new HttpError(422, 'Kein unterstütztes Logbuch-Projektarchiv.');
            if (count($manifest['projects']) > 10000) throw new HttpError(422, 'Das Archiv enthält zu viele Projekte.');

            $seenProjects = [];
            foreach ($manifest['projects'] as $project) {
                $id = is_array($project) ? (string) ($project['id'] ?? '') : '';
                if (!validId($id) || isset($seenProjects[$id])) throw new HttpError(422, 'Das Archiv enthält eine ungültige oder doppelte Projekt-ID.');
                $seenProjects[$id] = true;
                $seenFiles = [];
                foreach ((array) ($project['files'] ?? []) as $file) {
                    $fileId = is_array($file) ? (string) ($file['id'] ?? '') : '';
                    $path = 'projects/' . $id . '/attachments/' . $fileId . '/original.bin';
                    if (!validId($fileId) || isset($seenFiles[$fileId]) || !isset($archive[$path])) throw new HttpError(422, 'Eine Projektdatei fehlt oder besitzt eine ungültige ID.');
                    $seenFiles[$fileId] = true;
                    $entry = $archive[$path];
                    $expectedSize = (int) ($file['size'] ?? 0);
                    $expectedHash = strtolower((string) ($file['sha256'] ?? ''));
                    if ($entry->getSize() < 1 || $entry->getSize() > ProjectStore::MAX_ATTACHMENT_BYTES || $expectedSize !== $entry->getSize() || !preg_match('/^[a-f0-9]{64}$/', $expectedHash) || !hash_equals($expectedHash, hash_file('sha256', $entry->getPathname()) ?: '')) {
                        throw new HttpError(422, 'Größe oder Prüfsumme einer Projektdatei stimmt nicht.');
                    }
                }
            }

            $replace = $conflict === 'replace';
            $this->importBackupMetadata($actor, ['tags' => (array) ($manifest['tags'] ?? []), 'folders' => (array) ($manifest['folders'] ?? []), 'serverSettings' => $manifest['serverSettings'] ?? null, 'replace' => $replace]);
            $imported = 0;
            $skipped = 0;
            $filesImported = 0;
            foreach ($manifest['projects'] as $project) {
                $result = $this->projects->saveImported($project, $replace);
                if ($result['skipped']) { ++$skipped; continue; }
                ++$imported;
                $projectId = (string) $project['id'];
                foreach ((array) ($project['accessUsers'] ?? []) as $accessUser) {
                    if (is_string($accessUser) && $this->userExists($accessUser)) $this->setUserProject($accessUser, $projectId, true);
                }
                foreach ((array) ($project['files'] ?? []) as $file) {
                    $path = 'projects/' . $projectId . '/attachments/' . $file['id'] . '/original.bin';
                    $this->projects->importAttachmentFromPath($projectId, $archive[$path]->getPathname(), $file, $actor['id']);
                    ++$filesImported;
                }
                $this->audit($actor['id'], 'data.project_imported', $projectId);
            }
            $this->audit($actor['id'], 'data.project_archive_imported', (string) $imported, 'skipped=' . $skipped . ', files=' . $filesImported);
            return ['imported' => $imported, 'skipped' => $skipped, 'filesImported' => $filesImported];
        } finally {
            unset($archive);
            @unlink($archivePath);
        }
    }

    private function importFullArchive(array $actor, array $upload): array
    {
        if (!class_exists(\PharData::class)) throw new HttpError(500, 'Die TAR-Unterstützung ist auf diesem Server nicht verfügbar.');
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new HttpError(413, 'Das Vollbackup ist zu groß.');
        $source = (string) ($upload['tmp_name'] ?? '');
        $size = (int) ($upload['size'] ?? 0);
        if ($error !== UPLOAD_ERR_OK || $size < 1 || $size > 4 * 1024 ** 3 || !is_uploaded_file($source)) throw new HttpError(422, 'Das Vollbackup konnte nicht hochgeladen werden.');

        $temporaryDirectory = $this->storagePath . '/tmp';
        if (!is_dir($temporaryDirectory) && !mkdir($temporaryDirectory, 0770, true) && !is_dir($temporaryDirectory)) throw new HttpError(507, 'Temporäres Import-Verzeichnis konnte nicht angelegt werden.');
        $base = tempnam($temporaryDirectory, 'full-import-');
        if ($base === false) throw new HttpError(507, 'Temporäre Import-Datei konnte nicht angelegt werden.');
        @unlink($base);
        $archivePath = $base . '.tar';
        if (!move_uploaded_file($source, $archivePath)) throw new HttpError(507, 'Das Vollbackup konnte nicht für den Import vorbereitet werden.');

        try {
            try {
                $archive = new \PharData($archivePath);
            } catch (\Throwable) {
                throw new HttpError(422, 'Das gewählte Archiv ist kein lesbares TAR-Vollbackup.');
            }
            if (!isset($archive['manifest.json'])) throw new HttpError(422, 'Im Vollbackup fehlt manifest.json.');
            $manifestEntry = $archive['manifest.json'];
            if ($manifestEntry->getSize() > 256 * 1024 * 1024) throw new HttpError(413, 'Die Beschreibung des Vollbackups ist zu groß.');
            $manifest = json_decode($manifestEntry->getContent(), true);
            $this->validateFullBackupManifest($manifest, $archive);
            return $this->restoreFullBackup($actor, $manifest, $archive);
        } finally {
            unset($archive);
            @unlink($archivePath);
        }
    }

    private function validateFullBackupManifest(mixed $manifest, \PharData $archive): void
    {
        if (!is_array($manifest) || ($manifest['format'] ?? '') !== 'logbuch-full' || (int) ($manifest['version'] ?? 0) !== self::FULL_BACKUP_VERSION) {
            throw new HttpError(422, 'Kein unterstütztes Logbuch-Vollbackup.');
        }
        $schemaVersion = (int) ($manifest['schemaVersion'] ?? 0);
        if ($schemaVersion < self::FULL_BACKUP_MIN_SCHEMA || $schemaVersion > \logbuch_schema_version()) {
            throw new HttpError(422, 'Das Vollbackup verwendet eine nicht unterstützte Datenbankversion.');
        }
        $tables = $manifest['tables'] ?? null;
        $projects = $manifest['projects'] ?? null;
        if (!is_array($tables) || !is_array($projects) || count($projects) > 10000) throw new HttpError(422, 'Das Vollbackup ist unvollständig.');
        foreach (self::FULL_BACKUP_TABLES as $table => $columns) {
            $rows = $tables[$table] ?? ($schemaVersion < 18 && $table === 'inventory_item_notes' ? [] : null);
            if (!is_array($rows) || count($rows) > 500000) throw new HttpError(422, 'Die Tabelle „' . $table . '“ im Vollbackup ist ungültig.');
            foreach ($rows as $row) {
                if (!is_array($row)) throw new HttpError(422, 'Die Tabelle „' . $table . '“ im Vollbackup ist ungültig.');
                foreach ($columns as $column) {
                    if ($schemaVersion < 19 && $table === 'inventory_items' && $column === 'tracking_mode') continue;
                    if (!array_key_exists($column, $row)) throw new HttpError(422, 'In der Tabelle „' . $table . '“ fehlt „' . $column . '“.');
                }
            }
        }
        $users = $tables['users'];
        if (!$users || count($users) > 500) throw new HttpError(422, 'Das Vollbackup enthält keine gültigen Benutzerkonten.');
        $activeAdmin = false;
        foreach ($users as $row) {
            $passwordInfo = password_get_info((string) $row['password_hash']);
            if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', (string) $row['id']) || !in_array($row['role'], ['admin', 'editor', 'viewer'], true) || !in_array($row['access_mode'], ['include', 'exclude', 'all'], true) || ($passwordInfo['algoName'] ?? 'unknown') !== 'argon2id' || !is_array(json_decode((string) $row['preferences_json'], true))) {
                throw new HttpError(422, 'Das Vollbackup enthält ein ungültiges Benutzerkonto.');
            }
            if ($row['role'] === 'admin' && (int) $row['active'] === 1) $activeAdmin = true;
        }
        if (!$activeAdmin) throw new HttpError(422, 'Das Vollbackup enthält keinen aktiven Administrator.');

        $seenProjects = [];
        foreach ($projects as $project) {
            $projectId = is_array($project) ? (string) ($project['id'] ?? '') : '';
            if (!validId($projectId) || isset($seenProjects[$projectId])) throw new HttpError(422, 'Das Vollbackup enthält eine ungültige oder doppelte Projekt-ID.');
            $seenProjects[$projectId] = true;
            $seenFiles = [];
            foreach ((array) ($project['files'] ?? []) as $file) {
                $fileId = is_array($file) ? (string) ($file['id'] ?? '') : '';
                $path = 'projects/' . $projectId . '/attachments/' . $fileId . '/original.bin';
                if (!validId($fileId) || isset($seenFiles[$fileId]) || !isset($archive[$path])) throw new HttpError(422, 'Eine Projektdatei im Vollbackup fehlt oder besitzt eine ungültige ID.');
                $seenFiles[$fileId] = true;
                $entry = $archive[$path];
                $expectedSize = (int) ($file['size'] ?? 0);
                $expectedHash = strtolower((string) ($file['sha256'] ?? ''));
                if ($entry->getSize() < 1 || $entry->getSize() > ProjectStore::MAX_ATTACHMENT_BYTES || $expectedSize !== $entry->getSize() || !preg_match('/^[a-f0-9]{64}$/', $expectedHash) || !hash_equals($expectedHash, hash_file('sha256', $entry->getPathname()) ?: '')) {
                    throw new HttpError(422, 'Größe oder Prüfsumme einer Projektdatei im Vollbackup stimmt nicht.');
                }
            }
        }
        $itemIds = array_fill_keys(array_map(static fn(array $item): string => (string) $item['id'], $tables['inventory_items']), true);
        $seenItemImages = [];
        $itemImages = $manifest['inventoryItemImages'] ?? [];
        if (!is_array($itemImages) || count($itemImages) > count($itemIds)) throw new HttpError(422, 'Die Artikelbilder im Vollbackup sind ungültig.');
        foreach ($itemImages as $image) {
            if (!is_array($image)) throw new HttpError(422, 'Ein Artikelbild im Vollbackup ist ungültig.');
            $itemId = (string) ($image['itemId'] ?? '');
            $path = 'inventory-items/' . $itemId . '/image.bin';
            $mimeType = (string) ($image['mimeType'] ?? '');
            $expectedSize = (int) ($image['size'] ?? 0);
            $expectedHash = strtolower((string) ($image['sha256'] ?? ''));
            if (!validId($itemId) || !isset($itemIds[$itemId]) || isset($seenItemImages[$itemId]) || !isset($archive[$path]) || !in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) throw new HttpError(422, 'Ein Artikelbild im Vollbackup fehlt oder ist ungültig.');
            $seenItemImages[$itemId] = true;
            $entry = $archive[$path];
            if ($entry->getSize() < 1 || $entry->getSize() > InventoryItemStore::MAX_IMAGE_BYTES || $expectedSize !== $entry->getSize() || !preg_match('/^[a-f0-9]{64}$/', $expectedHash) || !hash_equals($expectedHash, hash_file('sha256', $entry->getPathname()) ?: '')) throw new HttpError(422, 'Größe oder Prüfsumme eines Artikelbilds im Vollbackup stimmt nicht.');
        }
        $appearanceLogo = $manifest['appearanceLogo'] ?? null;
        if ($appearanceLogo !== null) {
            $entry = $archive['appearance/logo.bin'] ?? null;
            $mimeType = is_array($appearanceLogo) ? (string) ($appearanceLogo['mimeType'] ?? '') : '';
            $expectedSize = is_array($appearanceLogo) ? (int) ($appearanceLogo['size'] ?? 0) : 0;
            $expectedHash = is_array($appearanceLogo) ? strtolower((string) ($appearanceLogo['sha256'] ?? '')) : '';
            if (!is_array($appearanceLogo) || $entry === null || !in_array($mimeType, self::APPEARANCE_LOGO_MIME_TYPES, true) || $entry->getSize() < 1 || $entry->getSize() > self::MAX_APPEARANCE_LOGO_BYTES || $expectedSize !== $entry->getSize() || !preg_match('/^[a-f0-9]{64}$/', $expectedHash) || !hash_equals($expectedHash, hash_file('sha256', $entry->getPathname()) ?: '')) throw new HttpError(422, 'Das Logo im Vollbackup fehlt oder ist ungültig.');
        }
    }

    private function restoreFullBackup(array $actor, array $manifest, \PharData $archive): array
    {
        $tables = $manifest['tables'];
        $tables['inventory_item_notes'] ??= [];
        if ((int) ($manifest['schemaVersion'] ?? 0) < 19) {
            $tables['inventory_items'] = array_map(static fn(array $row): array => ['tracking_mode' => 'QUANTITY', ...$row], $tables['inventory_items']);
        }
        $projects = $manifest['projects'];
        $itemImages = (array) ($manifest['inventoryItemImages'] ?? []);
        $appearanceLogo = $manifest['appearanceLogo'] ?? null;
        $projectsRoot = $this->storagePath . '/projects';
        $stagedRoot = $this->storagePath . '/tmp/full-restore-old-' . bin2hex(random_bytes(8));
        if (!is_dir($projectsRoot) || !rename($projectsRoot, $stagedRoot)) throw new HttpError(507, 'Die bestehende Projektablage konnte nicht für die Wiederherstellung gesichert werden.');
        if (!mkdir($projectsRoot, 0770, true) && !is_dir($projectsRoot)) {
            @rename($stagedRoot, $projectsRoot);
            throw new HttpError(507, 'Die neue Projektablage konnte nicht angelegt werden.');
        }
        $imagesRoot = $this->storagePath . '/inventory-items';
        if (!is_dir($imagesRoot) && !mkdir($imagesRoot, 0770, true) && !is_dir($imagesRoot)) {
            removeTree($projectsRoot);
            @rename($stagedRoot, $projectsRoot);
            throw new HttpError(507, 'Die Artikelbildablage konnte nicht vorbereitet werden.');
        }
        $stagedImagesRoot = $this->storagePath . '/tmp/full-restore-images-old-' . bin2hex(random_bytes(8));
        if (!rename($imagesRoot, $stagedImagesRoot) || (!mkdir($imagesRoot, 0770, true) && !is_dir($imagesRoot))) {
            if (is_dir($stagedImagesRoot)) @rename($stagedImagesRoot, $imagesRoot);
            removeTree($projectsRoot);
            @rename($stagedRoot, $projectsRoot);
            throw new HttpError(507, 'Die neue Artikelbildablage konnte nicht angelegt werden.');
        }
        $appearanceRoot = $this->appearanceDirectory();
        if (!is_dir($appearanceRoot) && !mkdir($appearanceRoot, 0770, true) && !is_dir($appearanceRoot)) {
            removeTree($imagesRoot);
            @rename($stagedImagesRoot, $imagesRoot);
            removeTree($projectsRoot);
            @rename($stagedRoot, $projectsRoot);
            throw new HttpError(507, 'Die Logoablage konnte nicht vorbereitet werden.');
        }
        $stagedAppearanceRoot = $this->storagePath . '/tmp/full-restore-appearance-old-' . bin2hex(random_bytes(8));
        if (!rename($appearanceRoot, $stagedAppearanceRoot) || (!mkdir($appearanceRoot, 0770, true) && !is_dir($appearanceRoot))) {
            if (is_dir($stagedAppearanceRoot)) @rename($stagedAppearanceRoot, $appearanceRoot);
            removeTree($imagesRoot);
            @rename($stagedImagesRoot, $imagesRoot);
            removeTree($projectsRoot);
            @rename($stagedRoot, $projectsRoot);
            throw new HttpError(507, 'Die neue Logoablage konnte nicht angelegt werden.');
        }

        $transactionActive = false;
        try {
            $this->db->exec('BEGIN IMMEDIATE');
            $transactionActive = true;
            $this->clearFullBackupTables();

            $this->insertFullBackupRows('users', $tables['users']);
            $this->insertFullBackupRows('tags', $tables['tags']);
            $this->insertFullBackupRows('settings', $tables['settings']);
            $this->insertFullBackupSelfRows('folders', $tables['folders']);
            $this->insertFullBackupSelfRows('todos', $tables['todos']);
            $this->insertFullBackupSelfRows('storage_locations', $tables['storage_locations']);
            $this->insertFullBackupSelfRows('inventory_categories', $tables['inventory_categories']);
            $this->insertFullBackupRows('inventory_items', $tables['inventory_items']);
            $this->insertFullBackupRows('inventory_item_notes', $tables['inventory_item_notes']);
            $this->insertFullBackupRows('inventory_item_categories', $tables['inventory_item_categories']);
            $this->insertFullBackupRows('stock_entries', $tables['stock_entries']);
            $this->insertFullBackupRows('reservations', $tables['reservations']);
            $this->insertFullBackupSelfRows('stock_transactions', $tables['stock_transactions'], 'reversal_of_transaction_id');
            $this->insertFullBackupRows('user_projects', $tables['user_projects']);
            $this->insertFullBackupRows('audit', $tables['audit']);

            $filesImported = 0;
            foreach ($projects as $project) {
                $this->projects->saveImported($project, true);
                $projectId = (string) $project['id'];
                foreach ((array) ($project['files'] ?? []) as $file) {
                    $path = 'projects/' . $projectId . '/attachments/' . $file['id'] . '/original.bin';
                    $this->projects->importAttachmentFromPath($projectId, $archive[$path]->getPathname(), $file, $actor['id']);
                    ++$filesImported;
                }
            }
            foreach ($itemImages as $image) {
                $path = 'inventory-items/' . $image['itemId'] . '/image.bin';
                $this->inventoryItems->importImageFromPath((string) $image['itemId'], $archive[$path]->getPathname(), $image);
            }
            if (is_array($appearanceLogo)) {
                if (!copy($archive['appearance/logo.bin']->getPathname(), $this->appearanceLogoPath())) throw new HttpError(507, 'Das Logo konnte nicht aus dem Vollbackup wiederhergestellt werden.');
                @chmod($this->appearanceLogoPath(), 0660);
                writeJsonFile($this->appearanceLogoMetadataPath(), $appearanceLogo);
            }
            $this->audit($actor['id'], 'data.full_backup_restored', (string) count($projects), 'files=' . $filesImported . ';itemImages=' . count($itemImages));
            $this->db->exec('COMMIT');
            $transactionActive = false;
        } catch (\Throwable $error) {
            if ($transactionActive) {
                try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            }
            try { removeTree($projectsRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }
            if (is_dir($stagedRoot) && !@rename($stagedRoot, $projectsRoot)) error_log('Die alte Projektablage konnte nach einem fehlgeschlagenen Vollbackup-Import nicht zurückverschoben werden.');
            try { removeTree($imagesRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }
            if (is_dir($stagedImagesRoot) && !@rename($stagedImagesRoot, $imagesRoot)) error_log('Die alte Artikelbildablage konnte nach einem fehlgeschlagenen Vollbackup-Import nicht zurückverschoben werden.');
            try { removeTree($appearanceRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }
            if (is_dir($stagedAppearanceRoot) && !@rename($stagedAppearanceRoot, $appearanceRoot)) error_log('Die alte Logoablage konnte nach einem fehlgeschlagenen Vollbackup-Import nicht zurückverschoben werden.');
            if ($error instanceof HttpError) throw $error;
            if ($error instanceof \PDOException) throw new HttpError(422, 'Das Vollbackup enthält inkonsistente Daten.');
            throw $error;
        }
        try { removeTree($stagedRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }
        try { removeTree($stagedImagesRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }
        try { removeTree($stagedAppearanceRoot); } catch (\Throwable $cleanupError) { error_log((string) $cleanupError); }

        return [
            'restored' => true,
            'signedOut' => true,
            'projects' => count($projects),
            'users' => count($tables['users']),
            'reminders' => count($tables['todos']),
            'storageLocations' => count($tables['storage_locations']),
            'items' => count($tables['inventory_items']),
            'categories' => count($tables['inventory_categories']),
            'stockTransactions' => count($tables['stock_transactions']),
        ];
    }

    private function clearFullBackupTables(): void
    {
        $this->db->exec('DELETE FROM stock_transactions');
        $this->db->exec('DELETE FROM reservations');
        $this->db->exec('DELETE FROM stock_entries');
        $this->db->exec('DELETE FROM inventory_item_notes');
        $this->db->exec('DELETE FROM inventory_item_categories');
        $this->db->exec('DELETE FROM inventory_items');
        $this->db->exec('UPDATE inventory_categories SET parent_id = NULL WHERE parent_id IS NOT NULL');
        $this->db->exec('DELETE FROM inventory_categories');
        $this->db->exec('UPDATE storage_locations SET parent_id = NULL WHERE parent_id IS NOT NULL');
        $this->db->exec('DELETE FROM storage_locations');
        $this->db->exec('DELETE FROM todos');
        $this->db->exec('DELETE FROM user_projects');
        $this->db->exec('DELETE FROM sessions');
        $this->db->exec('DELETE FROM login_attempts');
        $this->db->exec('DELETE FROM audit');
        $this->db->exec('UPDATE folders SET parent_id = NULL WHERE parent_id IS NOT NULL');
        $this->db->exec('DELETE FROM folders');
        $this->db->exec('DELETE FROM tags');
        $this->db->exec('DELETE FROM settings');
        $this->db->exec('DELETE FROM users');
    }

    private function insertFullBackupRows(string $table, array $rows): void
    {
        $columns = self::FULL_BACKUP_TABLES[$table] ?? throw new \LogicException('Unbekannte Vollbackup-Tabelle.');
        if (!$rows) return;
        $quoted = implode(', ', array_map(static fn(string $column): string => '"' . $column . '"', $columns));
        $placeholders = implode(', ', array_fill(0, count($columns), '?'));
        $statement = $this->db->prepare('INSERT INTO "' . $table . '" (' . $quoted . ') VALUES (' . $placeholders . ')');
        foreach ($rows as $row) $statement->execute(array_map(static fn(string $column): mixed => $row[$column], $columns));
    }

    private function insertFullBackupSelfRows(string $table, array $rows, string $parentColumn = 'parent_id'): void
    {
        $parents = [];
        $flatRows = [];
        foreach ($rows as $row) {
            $parents[(string) $row['id']] = $row[$parentColumn];
            $row[$parentColumn] = null;
            $flatRows[] = $row;
        }
        $this->insertFullBackupRows($table, $flatRows);
        if (!$rows) return;
        $statement = $this->db->prepare('UPDATE "' . $table . '" SET "' . $parentColumn . '" = :parent WHERE id = :id');
        foreach ($parents as $id => $parent) if ($parent !== null && $parent !== '') $statement->execute(['parent' => $parent, 'id' => $id]);
    }

    private function importedPreferences(mixed $input): array
    {
        $defaults = $this->auth->defaultPreferences();
        if ($input === null) return $defaults;
        if (!is_array($input)) throw new HttpError(422, 'Ungültige Benutzereinstellungen im Backup.');
        $preferences = $defaults;
        $allowedStartPages = ['home', 'projects', 'archive'];
        $projectSorts = ['status:asc', 'priority:desc', 'priority:asc', 'dueDate:asc', 'dueDate:desc', 'createdAt:desc', 'createdAt:asc', 'latestEntryDate:desc', 'latestEntryDate:asc', 'title:asc', 'title:desc'];
        $archiveSorts = array_values(array_filter($projectSorts, static fn(string $sort): bool => $sort !== 'status:asc'));
        if (isset($input['startPage']) && !in_array($input['startPage'], $allowedStartPages, true)) throw new HttpError(422, 'Ungültige Startseite im Backup.');
        if (isset($input['projectSort']) && !in_array($input['projectSort'], $projectSorts, true)) throw new HttpError(422, 'Ungültige Projektsortierung im Backup.');
        if (isset($input['archiveSort']) && !in_array($input['archiveSort'], $archiveSorts, true)) throw new HttpError(422, 'Ungültige Archivsortierung im Backup.');
        if (isset($input['defaultProjectIcon']) && (!is_string($input['defaultProjectIcon']) || !preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $input['defaultProjectIcon']))) throw new HttpError(422, 'Ungültiges Projektsymbol im Backup.');
        foreach (['showProjectFolders', 'showOverviewSummary', 'showOverviewRecent', 'showOverviewNext', 'showOverviewRecentlyEdited', 'showOverviewMarked', 'showOverviewDueSoon', 'showOverviewHighPriority', 'showOverviewActivity', 'showOverviewTimeline'] as $flag) {
            if (array_key_exists($flag, $input) && !is_bool($input[$flag])) throw new HttpError(422, 'Ungültige Übersichts-Einstellung im Backup.');
        }
        foreach (['overviewRecentRows', 'overviewNextRows', 'overviewRecentlyEditedRows', 'overviewMarkedRows', 'overviewDueSoonRows', 'overviewHighPriorityRows'] as $rowSetting) {
            if (isset($input[$rowSetting]) && (!is_int($input[$rowSetting]) || $input[$rowSetting] < 1 || $input[$rowSetting] > 6)) throw new HttpError(422, 'Ungültige Zeilenanzahl im Backup.');
        }
        if (array_key_exists('overviewOrder', $input)) {
            $allowedOrder = $defaults['overviewOrder'];
            $order = $input['overviewOrder'];
            if (!is_array($order) || count($order) !== count($allowedOrder) || count(array_filter($order, 'is_string')) !== count($allowedOrder) || count(array_unique($order)) !== count($allowedOrder) || array_diff($order, $allowedOrder)) throw new HttpError(422, 'Ungültige Übersichtsreihenfolge im Backup.');
        }
        foreach (array_keys($defaults) as $key) if (array_key_exists($key, $input)) $preferences[$key] = $input[$key];
        return $preferences;
    }

    private function exportUsers(): array
    {
        $accounts = [];
        foreach ($this->db->query('SELECT * FROM users ORDER BY id')->fetchAll() as $row) {
            $public = $this->auth->publicUser($row);
            $preferences = array_intersect_key($public, $this->auth->defaultPreferences());
            $accounts[] = [
                'id' => $row['id'],
                'name' => $row['id'],
                'role' => $row['role'],
                'active' => (bool) $row['active'],
                'projectAccessMode' => $row['access_mode'],
                'mustChangePassword' => (bool) $row['must_change_password'],
                'createdAt' => $row['created_at'],
                'lastLoginAt' => $row['last_login_at'],
                'passwordAlgorithm' => 'php-password-hash',
                'passwordHash' => $row['password_hash'],
                'projectIds' => $row['role'] === 'admin' ? array_column($this->projects->list(), 'id') : $this->userProjectIds($row['id']),
                'preferences' => $preferences,
                'todos' => $this->todos->list((string) $row['id']),
            ];
        }
        return $accounts;
    }

    private function importUsers(array $actor, array $input): array
    {
        $accounts = $input['accounts'] ?? null;
        if (!is_array($accounts) || !$accounts || count($accounts) > 500) {
            throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
        }
        $imported = 0;
        $skipped = 0;
        foreach ($accounts as $account) {
            if (!is_array($account)) {
                throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
            }
            $passwordInfo = password_get_info((string) ($account['passwordHash'] ?? ''));
            if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', (string) ($account['id'] ?? '')) || !in_array(($account['role'] ?? ''), ['admin', 'editor', 'viewer'], true) || !in_array(($account['projectAccessMode'] ?? ''), ['include', 'exclude', 'all'], true) || ($passwordInfo['algoName'] ?? 'unknown') !== 'argon2id') {
                throw new HttpError(422, 'Ungültige Benutzerkonten im Backup.');
            }
            $id = $account['id'];
            $exists = $this->db->prepare('SELECT 1 FROM users WHERE id = :id');
            $exists->execute(['id' => $id]);
            if ($exists->fetchColumn() && !($input['replace'] ?? false)) {
                ++$skipped;
                continue;
            }
            if ($id === $actor['id'] && ($account['role'] !== 'admin' || ($account['active'] ?? true) === false)) {
                throw new HttpError(422, 'Der angemeldete Administrator muss aktiv bleiben.');
            }
            if (array_key_exists('todos', $account)) $this->todos->validateImported($account['todos']);
            $statement = $this->db->prepare('INSERT INTO users (id, role, active, access_mode, password_hash, must_change_password, preferences_json, created_at, last_login_at) VALUES (:id, :role, :active, :access, :hash, :change, :preferences, :created, :last) ON CONFLICT(id) DO UPDATE SET role = excluded.role, active = excluded.active, access_mode = excluded.access_mode, password_hash = excluded.password_hash, must_change_password = excluded.must_change_password, preferences_json = excluded.preferences_json, created_at = excluded.created_at, last_login_at = excluded.last_login_at');
            $statement->execute(['id' => $id, 'role' => $account['role'], 'active' => (int) ($account['active'] ?? true), 'access' => $account['projectAccessMode'] ?? 'include', 'hash' => $account['passwordHash'], 'change' => (int) ($account['mustChangePassword'] ?? false), 'preferences' => json_encode($this->importedPreferences($account['preferences'] ?? null)), 'created' => $account['createdAt'] ?? nowIso(), 'last' => $account['lastLoginAt'] ?? '']);
            $this->replaceUserProjects($id, (array) ($account['projectIds'] ?? []));
            if (array_key_exists('todos', $account)) $this->todos->replaceImported($id, $account['todos']);
            ++$imported;
        }
        $this->audit($actor['id'], 'data.users_imported', (string) $imported, 'skipped=' . $skipped);
        return ['imported' => $imported, 'skipped' => $skipped];
    }

    private function importTagDefinitions(array $definitions): void
    {
        foreach ($definitions as $tag) {
            if (!is_array($tag) || !validId((string) ($tag['id'] ?? ''))) {
                continue;
            }
            $name = trim((string) ($tag['name'] ?? ''));
            if (mb_strlen($name) < 2 || mb_strlen($name) > 40) {
                continue;
            }
            $this->db->prepare('INSERT OR IGNORE INTO tags (id, name, normalized_name, active, created_at) VALUES (:id, :name, :normalized, 1, :created)')->execute(['id' => $tag['id'], 'name' => $name, 'normalized' => normalizeName($name), 'created' => $tag['createdAt'] ?? nowIso()]);
        }
    }

    private function demoManifest(): array
    {
        $path = dirname(__DIR__) . '/public/demo-data.json';
        $demo = readJsonFile($path);
        if (($demo['format'] ?? '') !== 'logbuch-demo' || ($demo['version'] ?? null) !== 1 || !is_array($demo['tags'] ?? null) || !is_array($demo['folders'] ?? null) || !is_array($demo['projects'] ?? null) || !is_array($demo['storageLocations'] ?? null) || !is_array($demo['inventoryCategories'] ?? null) || !is_array($demo['inventoryItems'] ?? null) || !is_array($demo['stockEntries'] ?? null) || !is_array($demo['reservations'] ?? null) || !is_array($demo['stockTransactions'] ?? null)) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist ungültig.');
        }
        $folderIds = [];
        foreach ($demo['folders'] as $folder) {
            $id = is_array($folder) ? (string) ($folder['id'] ?? '') : '';
            if (!str_starts_with($id, 'demo-folder-') || !validId($id) || isset($folderIds[$id])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Ordner.');
            }
            $folderIds[$id] = true;
        }
        if (count($folderIds) !== 2) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz hat einen unerwarteten Ordnerumfang.');
        }
        $statusCounts = array_fill_keys(ProjectStore::STATUSES, 0);
        $ids = [];
        foreach ($demo['projects'] as $project) {
            $id = is_array($project) ? (string) ($project['id'] ?? '') : '';
            $status = is_array($project) ? (string) ($project['status'] ?? '') : '';
            if (!str_starts_with($id, 'demo-') || !validId($id) || isset($ids[$id]) || !array_key_exists($status, $statusCounts)) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist ungültig.');
            }
            foreach (ProjectStore::COLLECTIONS as $collection) {
                if (!is_array($project[$collection] ?? null)) {
                    throw new \RuntimeException('Der mitgelieferte Beispieldatensatz ist unvollständig.');
                }
            }
            $folderId = $project['folderId'] ?? null;
            if ($folderId !== null && !isset($folderIds[$folderId])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz verweist auf einen unbekannten Ordner.');
            }
            $ids[$id] = true;
            ++$statusCounts[$status];
        }
        if (count($ids) !== 11 || $statusCounts !== ['idea' => 0, 'active' => 4, 'paused' => 2, 'completed' => 3, 'archived' => 1, 'trashed' => 1]) {
            throw new \RuntimeException('Der mitgelieferte Beispieldatensatz hat einen unerwarteten Umfang.');
        }
        $locationIds = [];
        foreach ($demo['storageLocations'] as $location) {
            $id = is_array($location) ? (string) ($location['id'] ?? '') : '';
            $parentId = is_array($location) ? ($location['parentId'] ?? null) : null;
            if (!str_starts_with($id, 'demo-location-') || !validId($id) || isset($locationIds[$id]) || ($parentId !== null && !isset($locationIds[$parentId]))) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Lagerorte.');
            }
            $locationIds[$id] = true;
        }
        $itemIds = [];
        $categoryIds = [];
        foreach ($demo['inventoryCategories'] as $category) {
            $id = is_array($category) ? (string) ($category['id'] ?? '') : '';
            $parentId = is_array($category) ? ($category['parentId'] ?? null) : null;
            if (!str_starts_with($id, 'demo-category-') || !validId($id) || isset($categoryIds[$id]) || ($parentId !== null && !isset($categoryIds[$parentId]))) throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Kategorien.');
            $categoryIds[$id] = true;
        }
        foreach ($demo['inventoryItems'] as $item) {
            $id = is_array($item) ? (string) ($item['id'] ?? '') : '';
            if (!str_starts_with($id, 'demo-item-') || !validId($id) || isset($itemIds[$id])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Artikel.');
            }
            foreach ((array) ($item['categoryIds'] ?? []) as $categoryId) if (!isset($categoryIds[$categoryId])) throw new \RuntimeException('Der mitgelieferte Beispieldatensatz verweist auf eine unbekannte Kategorie.');
            $itemIds[$id] = true;
        }
        $stockIds = [];
        foreach ($demo['stockEntries'] as $entry) {
            $id = is_array($entry) ? (string) ($entry['id'] ?? '') : '';
            if (!str_starts_with($id, 'demo-stock-') || !validId($id) || isset($stockIds[$id]) || !isset($itemIds[$entry['itemId'] ?? '']) || !isset($locationIds[$entry['storageLocationId'] ?? ''])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Bestände.');
            }
            $stockIds[$id] = true;
        }
        $reservationIds = [];
        foreach ($demo['reservations'] as $reservation) {
            $id = is_array($reservation) ? (string) ($reservation['id'] ?? '') : '';
            if (!str_starts_with($id, 'demo-reservation-') || !validId($id) || isset($reservationIds[$id]) || !isset($itemIds[$reservation['itemId'] ?? '']) || !isset($ids[$reservation['projectId'] ?? ''])) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Reservierungen.');
            }
            $reservationIds[$id] = true;
        }
        $transactionIds = [];
        foreach ($demo['stockTransactions'] as $transaction) {
            $id = is_array($transaction) ? (string) ($transaction['id'] ?? '') : '';
            $source = is_array($transaction) ? ($transaction['sourceStorageLocationId'] ?? null) : null;
            $destination = is_array($transaction) ? ($transaction['destinationStorageLocationId'] ?? null) : null;
            if (!str_starts_with($id, 'demo-transaction-') || !validId($id) || isset($transactionIds[$id]) || !isset($itemIds[$transaction['itemId'] ?? '']) || ($source !== null && !isset($locationIds[$source])) || ($destination !== null && !isset($locationIds[$destination]))) {
                throw new \RuntimeException('Der mitgelieferte Beispieldatensatz enthält ungültige Bestandsbewegungen.');
            }
            $transactionIds[$id] = true;
        }
        if (count($locationIds) !== 15 || count($categoryIds) !== 10 || count($itemIds) !== 13 || count($stockIds) !== 15 || count($reservationIds) !== 3 || count($transactionIds) !== 15) {
            throw new \RuntimeException('Der mitgelieferte Lager-Beispieldatensatz hat einen unerwarteten Umfang.');
        }
        return $demo;
    }

    private function installDemoData(string $actorId, ?array $demo = null): array
    {
        $demo ??= $this->demoManifest();
        $this->importTagDefinitions($demo['tags']);
        $tagIds = [];
        $findTag = $this->db->prepare('SELECT id FROM tags WHERE normalized_name = :name');
        foreach ($demo['tags'] as $tag) {
            $findTag->execute(['name' => normalizeName((string) $tag['name'])]);
            $tagIds[(string) $tag['id']] = (string) ($findTag->fetchColumn() ?: $tag['id']);
        }
        foreach ($demo['folders'] as $folder) {
            $folder['tagIds'] = array_values(array_unique(array_map(static fn(string $id): string => $tagIds[$id] ?? $id, (array) ($folder['tagIds'] ?? []))));
            $this->folders->saveImported($folder, $actorId);
        }
        foreach ($demo['projects'] as $project) {
            $project['tagIds'] = array_values(array_unique(array_map(static fn(string $id): string => $tagIds[$id] ?? $id, (array) ($project['tagIds'] ?? []))));
            $this->projects->saveImported($project, true);
        }
        $inventory = $this->installDemoInventory($demo, $actorId);
        $count = count($demo['projects']);
        $this->audit($actorId, 'demo.installed', (string) $count);
        return ['installed' => $count, 'folders' => count($demo['folders']), ...$inventory];
    }

    private function removeDemoData(string $actorId): array
    {
        $demo = $this->demoManifest();
        $projectIds = array_column($demo['projects'], 'id');
        $folderIds = array_column($demo['folders'], 'id');
        $removed = $this->projects->removeByIds($projectIds);
        if ($projectIds) {
            $placeholders = implode(',', array_fill(0, count($projectIds), '?'));
            $this->db->prepare("DELETE FROM user_projects WHERE project_id IN ($placeholders)")->execute($projectIds);
        }
        $folderResult = $this->folders->removeEmptyByIds($folderIds, $this->projects->list());
        $inventoryResult = $this->removeDemoInventory($demo);

        $usedTagIds = [];
        foreach ([...$this->projects->list(), ...$this->folders->list()] as $item) {
            foreach ((array) ($item['tagIds'] ?? []) as $tagId) {
                $usedTagIds[$tagId] = true;
            }
        }
        $deleteTag = $this->db->prepare('DELETE FROM tags WHERE id = :id');
        foreach ($demo['tags'] as $tag) {
            $tagId = (string) ($tag['id'] ?? '');
            if (validId($tagId) && !isset($usedTagIds[$tagId])) {
                $deleteTag->execute(['id' => $tagId]);
            }
        }
        $this->audit($actorId, 'demo.removed', (string) $removed);
        return ['removed' => $removed, 'foldersRemoved' => $folderResult['removed'], 'foldersRetained' => $folderResult['retained'], ...$inventoryResult];
    }

    private function installDemoInventory(array $demo, string $actorId): array
    {
        $itemIds = array_column($demo['inventoryItems'], 'id');
        if ($itemIds) {
            $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
            $this->db->prepare("DELETE FROM stock_transactions WHERE item_id IN ($placeholders)")->execute($itemIds);
            $this->db->prepare("DELETE FROM reservations WHERE item_id IN ($placeholders)")->execute($itemIds);
            $this->db->prepare("DELETE FROM stock_entries WHERE item_id IN ($placeholders)")->execute($itemIds);
            $this->db->prepare("DELETE FROM inventory_items WHERE id IN ($placeholders)")->execute($itemIds);
        }
        $saveLocation = $this->db->prepare(<<<'SQL'
            INSERT INTO storage_locations (id, parent_id, name, icon, description, status, sort_order, created_at, updated_at)
            VALUES (:id, :parent, :name, :icon, :description, :status, :sort, :created, '')
            ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, icon = excluded.icon,
                description = excluded.description, status = excluded.status, sort_order = excluded.sort_order, updated_at = excluded.updated_at
        SQL);
        foreach ($demo['storageLocations'] as $location) {
            $saveLocation->execute(['id' => $location['id'], 'parent' => $location['parentId'] ?? null, 'name' => $location['name'], 'icon' => $location['icon'] ?? 'archive', 'description' => $location['description'] ?? '', 'status' => $location['status'] ?? 'ACTIVE', 'sort' => $location['sortOrder'] ?? 0, 'created' => $location['createdAt'] ?? nowIso()]);
        }
        $saveCategory = $this->db->prepare('INSERT INTO inventory_categories (id, parent_id, name, description, icon, sort_order, created_at, updated_at) VALUES (:id, :parent, :name, :description, :icon, :sort, :created, \'\') ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order');
        foreach ($demo['inventoryCategories'] as $category) $saveCategory->execute(['id' => $category['id'], 'parent' => $category['parentId'] ?? null, 'name' => $category['name'], 'description' => $category['description'] ?? '', 'icon' => $category['icon'] ?? 'folder', 'sort' => $category['sortOrder'] ?? 0, 'created' => $category['createdAt'] ?? nowIso()]);
        $saveItem = $this->db->prepare(<<<'SQL'
            INSERT INTO inventory_items (id, name, description, stock_unit, tracking_mode, manufacturer, article_number, barcode, merchant_url, default_minimum_quantity, status, created_at, updated_at)
            VALUES (:id, :name, :description, :unit, :tracking, :manufacturer, :article, :barcode, :merchant, :minimum, :status, :created, '')
        SQL);
        $saveItemCategory = $this->db->prepare('INSERT INTO inventory_item_categories (item_id, category_id, created_at) VALUES (:item, :category, :created)');
        foreach ($demo['inventoryItems'] as $item) {
            $trackingMode = (string) ($item['trackingMode'] ?? 'QUANTITY');
            $saveItem->execute(['id' => $item['id'], 'name' => $item['name'], 'description' => $item['description'] ?? '', 'unit' => $trackingMode === 'COLLECTION' ? 'Sammlung' : $item['stockUnit'], 'tracking' => $trackingMode, 'manufacturer' => $item['manufacturer'] ?? '', 'article' => $item['articleNumber'] ?? '', 'barcode' => $item['barcode'] ?? '', 'merchant' => $item['merchantUrl'] ?? '', 'minimum' => $trackingMode === 'COLLECTION' ? null : ($item['defaultMinimumQuantity'] ?? null), 'status' => $item['status'] ?? 'ACTIVE', 'created' => $item['createdAt'] ?? nowIso()]);
            foreach ((array) ($item['categoryIds'] ?? []) as $categoryId) $saveItemCategory->execute(['item' => $item['id'], 'category' => $categoryId, 'created' => $item['createdAt'] ?? nowIso()]);
        }
        $saveEntry = $this->db->prepare(<<<'SQL'
            INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, minimum_quantity, note, status, created_at, updated_at)
            VALUES (:id, :item, :location, :quantity, :minimum, :note, :status, :created, '')
        SQL);
        foreach ($demo['stockEntries'] as $entry) {
            $saveEntry->execute(['id' => $entry['id'], 'item' => $entry['itemId'], 'location' => $entry['storageLocationId'], 'quantity' => $entry['quantity'], 'minimum' => $entry['minimumQuantity'] ?? null, 'note' => $entry['note'] ?? '', 'status' => $entry['status'] ?? 'ACTIVE', 'created' => $entry['createdAt'] ?? nowIso()]);
        }
        $saveReservation = $this->db->prepare(<<<'SQL'
            INSERT INTO reservations (id, item_id, project_id, requested_quantity, fulfilled_quantity, status, note, created_by, created_at, updated_at)
            VALUES (:id, :item, :project, :requested, 0, 'ACTIVE', :note, :actor, :created, :created)
        SQL);
        foreach ($demo['reservations'] as $reservation) {
            $saveReservation->execute(['id' => $reservation['id'], 'item' => $reservation['itemId'], 'project' => $reservation['projectId'], 'requested' => $reservation['requestedQuantity'], 'note' => $reservation['note'] ?? '', 'actor' => $actorId, 'created' => $reservation['createdAt'] ?? nowIso()]);
        }
        $saveTransaction = $this->db->prepare(<<<'SQL'
            INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, destination_storage_location_id, reservation_id, reversal_of_transaction_id, note, recorded_by, occurred_at, created_at)
            VALUES (:id, :item, :type, :quantity, :source, :destination, NULL, NULL, :note, :actor, :occurred, :created)
        SQL);
        foreach ($demo['stockTransactions'] as $transaction) {
            $saveTransaction->execute(['id' => $transaction['id'], 'item' => $transaction['itemId'], 'type' => $transaction['type'], 'quantity' => $transaction['quantity'], 'source' => $transaction['sourceStorageLocationId'] ?? null, 'destination' => $transaction['destinationStorageLocationId'] ?? null, 'note' => $transaction['note'] ?? '', 'actor' => $actorId, 'occurred' => $transaction['occurredAt'], 'created' => $transaction['createdAt'] ?? $transaction['occurredAt']]);
        }
        return ['storageLocations' => count($demo['storageLocations']), 'inventoryCategories' => count($demo['inventoryCategories']), 'inventoryItems' => count($demo['inventoryItems'])];
    }

    private function removeDemoInventory(array $demo): array
    {
        $itemIds = array_column($demo['inventoryItems'], 'id');
        $removedItems = 0;
        if ($itemIds) {
            $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
            $this->db->prepare("DELETE FROM stock_transactions WHERE item_id IN ($placeholders)")->execute($itemIds);
            $this->db->prepare("DELETE FROM reservations WHERE item_id IN ($placeholders)")->execute($itemIds);
            $this->db->prepare("DELETE FROM stock_entries WHERE item_id IN ($placeholders)")->execute($itemIds);
            $deleteItems = $this->db->prepare("DELETE FROM inventory_items WHERE id IN ($placeholders)");
            $deleteItems->execute($itemIds);
            $removedItems = $deleteItems->rowCount();
            foreach ($itemIds as $itemId) $this->inventoryItems->deleteImageFiles((string) $itemId);
        }
        $categoryIds = array_column($demo['inventoryCategories'], 'id');
        $deleteCategory = $this->db->prepare('DELETE FROM inventory_categories WHERE id = :id AND NOT EXISTS (SELECT 1 FROM inventory_categories child WHERE child.parent_id = inventory_categories.id) AND NOT EXISTS (SELECT 1 FROM inventory_item_categories link WHERE link.category_id = inventory_categories.id)');
        foreach (array_reverse($categoryIds) as $categoryId) $deleteCategory->execute(['id' => $categoryId]);
        $locationIds = array_column($demo['storageLocations'], 'id');
        $locationPlaceholders = implode(',', array_fill(0, count($locationIds), '?'));
        $existingLocationCount = 0;
        if ($locationIds) {
            $countLocations = $this->db->prepare("SELECT COUNT(*) FROM storage_locations WHERE id IN ($locationPlaceholders)");
            $countLocations->execute($locationIds);
            $existingLocationCount = (int) $countLocations->fetchColumn();
        }
        $removedLocations = 0;
        $deleteLocation = $this->db->prepare(<<<'SQL'
            DELETE FROM storage_locations
            WHERE id = :id
              AND NOT EXISTS (SELECT 1 FROM storage_locations child WHERE child.parent_id = storage_locations.id)
              AND NOT EXISTS (SELECT 1 FROM stock_entries entry WHERE entry.storage_location_id = storage_locations.id)
              AND NOT EXISTS (SELECT 1 FROM stock_transactions movement WHERE movement.source_storage_location_id = storage_locations.id OR movement.destination_storage_location_id = storage_locations.id)
        SQL);
        foreach (array_reverse($locationIds) as $locationId) {
            $deleteLocation->execute(['id' => $locationId]);
            $removedLocations += $deleteLocation->rowCount();
        }
        return ['inventoryItemsRemoved' => $removedItems, 'storageLocationsRemoved' => $removedLocations, 'storageLocationsRetained' => $existingLocationCount - $removedLocations];
    }

    private function clearUsersExcept(string $id): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM users WHERE id <> :id');
        $statement->execute(['id' => $id]);
        $removed = (int) $statement->fetchColumn();
        $this->db->prepare('DELETE FROM users WHERE id <> :id')->execute(['id' => $id]);
        $this->db->prepare('DELETE FROM sessions WHERE user_id <> :id')->execute(['id' => $id]);
        return $removed;
    }

    private function directorySize(string $directory): int
    {
        $bytes = 0;
        if (!is_dir($directory)) {
            return 0;
        }
        try {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::LEAVES_ONLY,
                \RecursiveIteratorIterator::CATCH_GET_CHILD,
            );
            foreach ($files as $file) {
                try {
                    if ($file->isFile()) {
                        $bytes += $file->getSize();
                    }
                } catch (\Throwable) {
                    // An inaccessible runtime file must not break the system page.
                }
            }
        } catch (\Throwable) {
            // Storage metrics are informational and may be incomplete.
        }
        return $bytes;
    }
}
