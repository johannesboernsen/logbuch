import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function inventoryItemScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-items-'));
  try {
    const script = `
      require $argv[1];
      $database = new \\Logbuch\\Database($argv[2]);
      $store = new \\Logbuch\\InventoryItemStore($database->pdo());
      ${code}
    `;
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), join(storage, 'database.sqlite')], {
      env:{ ...process.env, LOGBUCH_ROOT_PATH:root },
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    await rm(storage, { recursive:true, force:true });
  }
}

test('Artikel besitzen stabile Identität und vollständige ortsunabhängige Stammdaten', async () => {
  const result = await inventoryItemScript(`
    $item = $store->create([
      'name' => 'Schraube M4 × 30', 'stockUnit' => 'Stück',
      'description' => 'Senkkopf, Edelstahl A2', 'manufacturer' => 'Fix & Fest',
      'articleNumber' => 'M4-30-A2', 'barcode' => '4012345678901',
      'merchantUrl' => 'https://example.com/schraube', 'defaultMinimumQuantity' => 50,
    ]);
    $updated = $store->update($item['id'], ['name' => 'Schraube M4 × 30 Senkkopf']);
    echo json_encode(['created' => $item, 'updated' => $updated, 'detail' => $store->detail($item['id'])]);
  `);
  assert.match(result.created.id, /^item-[a-f0-9]{24}$/);
  assert.equal(result.updated.id, result.created.id);
  assert.equal(result.detail.name, 'Schraube M4 × 30 Senkkopf');
  assert.equal(result.detail.stockUnit, 'Stück');
  assert.equal(result.detail.defaultMinimumQuantity, 50);
});

test('Einheiten erzwingen passende Mindestbestände und Händlerlinks', async () => {
  const result = await inventoryItemScript(`
    $pieceStatus = 0;
    $urlStatus = 0;
    try { $store->create(['name' => 'Schraube', 'stockUnit' => 'Stück', 'defaultMinimumQuantity' => 1.5]); }
    catch (\\Logbuch\\HttpError $error) { $pieceStatus = $error->status; }
    try { $store->create(['name' => 'Kabel', 'stockUnit' => 'Meter', 'merchantUrl' => 'javascript:alert(1)']); }
    catch (\\Logbuch\\HttpError $error) { $urlStatus = $error->status; }
    $cable = $store->create(['name' => 'Kabel', 'stockUnit' => 'Meter', 'defaultMinimumQuantity' => '2,75']);
    echo json_encode(['pieceStatus' => $pieceStatus, 'urlStatus' => $urlStatus, 'minimum' => $cable['defaultMinimumQuantity']]);
  `);
  assert.equal(result.pieceStatus, 422);
  assert.equal(result.urlStatus, 422);
  assert.equal(result.minimum, 2.75);
});

test('Artikelsuche berücksichtigt Stammdaten und blendet Archive standardmäßig aus', async () => {
  const result = await inventoryItemScript(`
    $screw = $store->create(['name' => 'Schraube', 'stockUnit' => 'Stück', 'manufacturer' => 'Fix & Fest', 'articleNumber' => 'M4-A2']);
    $cable = $store->create(['name' => 'Kabel', 'stockUnit' => 'Meter', 'barcode' => '998877']);
    $store->archive($screw['id']);
    echo json_encode([
      'active' => array_column($store->list(), 'name'),
      'manufacturer' => array_column($store->list(true, 'Fix & Fest'), 'name'),
      'barcode' => array_column($store->list(false, '998877'), 'name'),
    ]);
  `);
  assert.deepEqual(result.active, ['Kabel']);
  assert.deepEqual(result.manufacturer, ['Schraube']);
  assert.deepEqual(result.barcode, ['Kabel']);
});

test('Archivieren erhält Artikel und historische Bestandsreferenzen', async () => {
  const result = await inventoryItemScript(`
    $item = $store->create(['name' => 'Muffe 22 mm', 'stockUnit' => 'Stück']);
    $pdo = $database->pdo();
    $pdo->exec("INSERT INTO storage_locations (id, name, status, sort_order, created_at, updated_at) VALUES ('location-a', 'Werkstatt', 'ACTIVE', 0, '2026-08-27T00:00:00Z', '')");
    $stock = $pdo->prepare("INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-a', :item, 'location-a', 4, '2026-08-27T00:00:00Z', '')");
    $stock->execute(['item' => $item['id']]);
    $changed = $store->archive($item['id']);
    $reference = $pdo->query("SELECT item_id FROM stock_entries WHERE id = 'stock-a'")->fetchColumn();
    $archived = $store->detail($item['id']);
    $restored = $store->restore($item['id']);
    echo json_encode(['changed' => $changed, 'reference' => $reference, 'id' => $item['id'], 'status' => $archived['status'], 'restored' => $restored]);
  `);
  assert.equal(result.changed, true);
  assert.equal(result.reference, result.id);
  assert.equal(result.status, 'ARCHIVED');
  assert.equal(result.restored, true);
});
