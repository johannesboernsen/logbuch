import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function inventoryDatabaseScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-schema-'));
  try {
    const script = `
      require $argv[1];
      $database = new \\Logbuch\\Database($argv[2]);
      $pdo = $database->pdo();
      $pdo->exec("INSERT INTO storage_locations (id, name, created_at, updated_at) VALUES ('location-a', 'Regal A', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
      $pdo->exec("INSERT INTO storage_locations (id, name, created_at, updated_at) VALUES ('location-b', 'Regal B', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
      $pdo->exec("INSERT INTO inventory_items (id, name, stock_unit, created_at, updated_at) VALUES ('item-screw', 'Schraube M4', 'Stück', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
      ${code}
    `;
    return await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), join(storage, 'database.sqlite')], {
      env: { ...process.env, LOGBUCH_ROOT_PATH: root },
    });
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
}

test('Inventarmigration legt Kernmodell, Foreign Keys und Indizes an', async () => {
  const { stdout, stderr } = await inventoryDatabaseScript(`
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    $indexes = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    $storageColumns = $pdo->query('PRAGMA table_info(storage_locations)')->fetchAll(PDO::FETCH_COLUMN, 1);
    $itemColumns = $pdo->query('PRAGMA table_info(inventory_items)')->fetchAll(PDO::FETCH_COLUMN, 1);
    echo json_encode(['tables' => $tables, 'indexes' => $indexes, 'storageColumns' => $storageColumns, 'itemColumns' => $itemColumns, 'foreignKeys' => $pdo->query('PRAGMA foreign_keys')->fetchColumn()]);
  `);
  assert.equal(stderr, '');
  const schema = JSON.parse(stdout);
  for (const table of ['storage_locations', 'inventory_categories', 'inventory_item_categories', 'inventory_items', 'inventory_item_notes', 'stock_entries', 'stock_transactions', 'reservations']) {
    assert.ok(schema.tables.includes(table), `Tabelle ${table} fehlt`);
  }
  assert.equal(schema.foreignKeys, 1);
  assert.ok(schema.storageColumns.includes('icon'));
  assert.ok(!schema.storageColumns.includes('type'));
  assert.ok(schema.itemColumns.includes('tracking_mode'));
  assert.ok(schema.indexes.includes('stock_entries_item_status'));
  assert.ok(schema.indexes.includes('reservations_project_entry'));
  assert.ok(schema.indexes.includes('stock_transactions_item_occurred'));
  assert.ok(schema.indexes.includes('inventory_item_notes_item_created'));
  assert.ok(schema.indexes.includes('inventory_items_tracking_status_name'));
});

test('DB verhindert negative und doppelte physische Bestände', async () => {
  const { stdout } = await inventoryDatabaseScript(`
    $pdo->exec("INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-a', 'item-screw', 'location-a', 3.5, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    $results = [];
    foreach ([
      "INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-negative', 'item-screw', 'location-b', -1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')",
      "INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-duplicate', 'item-screw', 'location-a', 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')"
    ] as $sql) {
      try { $pdo->exec($sql); $results[] = false; } catch (PDOException) { $results[] = true; }
    }
    foreach ([
      "DELETE FROM inventory_items WHERE id = 'item-screw'",
      "DELETE FROM storage_locations WHERE id = 'location-a'"
    ] as $sql) {
      try { $pdo->exec($sql); $results[] = false; } catch (PDOException) { $results[] = true; }
    }
    echo json_encode($results);
  `);
  assert.deepEqual(JSON.parse(stdout), [true, true, true, true]);
});

test('Reservierungen erlauben Überbedarf und erzwingen konsistente Erfüllung', async () => {
  const { stdout } = await inventoryDatabaseScript(`
    $pdo->exec("INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-a', 'item-screw', 'location-a', 3, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    $pdo->exec("INSERT INTO reservations (id, item_id, project_id, requested_quantity, fulfilled_quantity, status, created_at, updated_at) VALUES ('reservation-a', 'item-screw', 'project-example', 5, 0, 'ACTIVE', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    $invalid = false;
    $incompleteTarget = false;
    try {
      $pdo->exec("INSERT INTO reservations (id, item_id, project_id, requested_quantity, fulfilled_quantity, status, created_at, updated_at) VALUES ('reservation-b', 'item-screw', 'project-example', 5, 4, 'FULFILLED', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    } catch (PDOException) { $invalid = true; }
    try {
      $pdo->exec("INSERT INTO reservations (id, item_id, project_id, project_entry_collection, requested_quantity, status, created_at, updated_at) VALUES ('reservation-c', 'item-screw', 'project-example', 'tasks', 1, 'ACTIVE', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    } catch (PDOException) { $incompleteTarget = true; }
    echo json_encode(['active' => $pdo->query("SELECT COUNT(*) FROM reservations WHERE status = 'ACTIVE'")->fetchColumn(), 'invalidFulfilled' => $invalid, 'incompleteTarget' => $incompleteTarget]);
  `);
  assert.deepEqual(JSON.parse(stdout), { active: 1, invalidFulfilled: true, incompleteTarget: true });
});

test('Bewegungstypen erzwingen passende Quell- und Zielorte', async () => {
  const { stdout } = await inventoryDatabaseScript(`
    $pdo->exec("INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, destination_storage_location_id, occurred_at, created_at) VALUES ('transaction-a', 'item-screw', 'TRANSFER', 2, 'location-a', 'location-b', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    $invalidShape = false;
    try {
      $pdo->exec("INSERT INTO stock_transactions (id, item_id, type, quantity, source_storage_location_id, occurred_at, created_at) VALUES ('transaction-b', 'item-screw', 'RECEIPT', 1, 'location-a', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z')");
    } catch (PDOException) { $invalidShape = true; }
    echo json_encode(compact('invalidShape'));
  `);
  assert.deepEqual(JSON.parse(stdout), { invalidShape: true });
});
