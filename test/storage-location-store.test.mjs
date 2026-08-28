import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function storageLocationScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-storage-locations-'));
  try {
    const script = `
      require $argv[1];
      $database = new \\Logbuch\\Database($argv[2]);
      $store = new \\Logbuch\\StorageLocationStore($database->pdo());
      ${code}
    `;
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), join(storage, 'database.sqlite')], {
      env: { ...process.env, LOGBUCH_ROOT_PATH: root },
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
}

test('Lagerorte bilden einen beliebig tiefen Baum mit stabiler Detailroute', async () => {
  const result = await storageLocationScript(`
    $garage = $store->create(['name' => 'Garage', 'type' => 'ROOM', 'icon' => 'warehouse']);
    $shelf = $store->create(['name' => 'Regal', 'type' => 'SHELF', 'parentId' => $garage['id']]);
    $box = $store->create(['name' => 'Kiste', 'type' => 'BOX', 'parentId' => $shelf['id']]);
    $bag = $store->create(['name' => 'Tüte', 'type' => 'BAG', 'parentId' => $box['id']]);
    $detail = $store->detail($bag['id']);
    echo json_encode(['id' => $detail['location']['id'], 'path' => array_column($detail['path'], 'name'), 'rootIcon' => $detail['path'][0]['icon'], 'leafIcon' => $detail['location']['icon']]);
  `);
  assert.match(result.id, /^location-[a-f0-9]{24}$/);
  assert.deepEqual(result.path, ['Garage', 'Regal', 'Kiste', 'Tüte']);
  assert.equal(result.rootIcon, 'warehouse');
  assert.equal(result.leafIcon, 'archive');
});

test('Lagerortsymbole werden validiert und bearbeitet', async () => {
  const result = await storageLocationScript(`
    $location = $store->create(['name' => 'Regal', 'type' => 'SHELF', 'icon' => 'rows-3']);
    $updated = $store->update($location['id'], ['icon' => 'library-big']);
    $invalidStatus = 0;
    try { $store->update($location['id'], ['icon' => '\" onclick=\"alert(1)']); }
    catch (\\Logbuch\\HttpError $error) { $invalidStatus = $error->status; }
    echo json_encode(['created' => $location['icon'], 'updated' => $updated['icon'], 'invalidStatus' => $invalidStatus]);
  `);
  assert.deepEqual(result, { created:'rows-3', updated:'library-big', invalidStatus:422 });
});

test('Umplatzieren behält den vollständigen Unterbaum und blockiert Zyklen', async () => {
  const result = await storageLocationScript(`
    $garage = $store->create(['name' => 'Garage', 'type' => 'ROOM']);
    $workshop = $store->create(['name' => 'Werkstatt', 'type' => 'ROOM']);
    $shelf = $store->create(['name' => 'Regal', 'type' => 'SHELF', 'parentId' => $garage['id']]);
    $box = $store->create(['name' => 'Kiste', 'type' => 'BOX', 'parentId' => $shelf['id']]);
    $store->update($shelf['id'], ['parentId' => $workshop['id']]);
    $cycleStatus = 0;
    try { $store->update($workshop['id'], ['parentId' => $box['id']]); }
    catch (\\Logbuch\\HttpError $error) { $cycleStatus = $error->status; }
    $detail = $store->detail($box['id']);
    echo json_encode(['path' => array_column($detail['path'], 'name'), 'cycleStatus' => $cycleStatus]);
  `);
  assert.deepEqual(result.path, ['Werkstatt', 'Regal', 'Kiste']);
  assert.equal(result.cycleStatus, 422);
});

test('Archivieren blendet den Unterbaum aus und lässt historische Referenzen intakt', async () => {
  const result = await storageLocationScript(`
    $garage = $store->create(['name' => 'Garage', 'type' => 'ROOM']);
    $shelf = $store->create(['name' => 'Regal', 'type' => 'SHELF', 'parentId' => $garage['id']]);
    $box = $store->create(['name' => 'Kiste', 'type' => 'BOX', 'parentId' => $shelf['id']]);
    $pdo = $database->pdo();
    $pdo->exec("INSERT INTO inventory_items (id, name, stock_unit, created_at, updated_at) VALUES ('item-history', 'Historischer Artikel', 'Stück', '2026-08-27T00:00:00Z', '')");
    $stock = $pdo->prepare("INSERT INTO stock_entries (id, item_id, storage_location_id, quantity, created_at, updated_at) VALUES ('stock-history', 'item-history', :location, 1, '2026-08-27T00:00:00Z', '')");
    $stock->execute(['location' => $box['id']]);
    $changed = $store->archive($shelf['id']);
    $activeIds = array_column($store->list(), 'id');
    $all = array_column($store->list(true), null, 'id');
    $reference = $pdo->query("SELECT storage_location_id FROM stock_entries WHERE id = 'stock-history'")->fetchColumn();
    echo json_encode(['changed' => $changed, 'shelfVisible' => in_array($shelf['id'], $activeIds, true), 'shelfStatus' => $all[$shelf['id']]['status'], 'boxStatus' => $all[$box['id']]['status'], 'reference' => $reference, 'boxId' => $box['id']]);
  `);
  assert.equal(result.changed, 2);
  assert.equal(result.shelfVisible, false);
  assert.equal(result.shelfStatus, 'ARCHIVED');
  assert.equal(result.boxStatus, 'ARCHIVED');
  assert.equal(result.reference, result.boxId);
});

test('Geschwister lassen sich vollständig und deterministisch sortieren', async () => {
  const result = await storageLocationScript(`
    $a = $store->create(['name' => 'A', 'type' => 'AREA']);
    $b = $store->create(['name' => 'B', 'type' => 'AREA']);
    $c = $store->create(['name' => 'C', 'type' => 'AREA']);
    $store->reorder(null, [$c['id'], $a['id'], $b['id']]);
    echo json_encode(array_column(array_values(array_filter($store->list(), static fn(array $location): bool => $location['parentId'] === null)), 'name'));
  `);
  assert.deepEqual(result, ['C', 'A', 'B']);
});
