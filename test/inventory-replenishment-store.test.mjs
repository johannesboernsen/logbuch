import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function reportScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-replenishment-'));
  try {
    const script = `
      require $argv[1];
      $storage = $argv[2];
      $database = new \\Logbuch\\Database($storage . '/database.sqlite');
      $pdo = $database->pdo();
      $projects = new \\Logbuch\\ProjectStore($storage . '/projects');
      $items = new \\Logbuch\\InventoryItemStore($pdo);
      $locations = new \\Logbuch\\StorageLocationStore($pdo);
      $stock = new \\Logbuch\\InventoryStockStore($pdo);
      $reservations = new \\Logbuch\\InventoryReservationStore($pdo, $projects);
      ${code}
    `;
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), storage], { env:{ ...process.env, LOGBUCH_ROOT_PATH:root } });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    await rm(storage, { recursive:true, force:true });
  }
}

test('Nachbestellliste berücksichtigt Mindestbestand und offenen Projektbedarf', async () => {
  const result = await reportScript(`
    $project = $projects->create(['title' => 'Gartenhaus', 'createdAt' => '2026-08-27', 'status' => 'active'], 'admin');
    $place = $locations->create(['name' => 'Garage', 'type' => 'ROOM']);
    $screw = $items->create(['name' => 'Schraube', 'stockUnit' => 'Stück', 'defaultMinimumQuantity' => 5, 'merchantUrl' => 'https://example.com/screw']);
    $stock->create(['itemId' => $screw['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 6], 'admin');
    $reservations->create(['itemId' => $screw['id'], 'projectId' => $project['id'], 'requestedQuantity' => 10], 'admin');
    $paint = $items->create(['name' => 'Farbe', 'stockUnit' => 'Liter']);
    $stock->create(['itemId' => $paint['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 1], 'admin');
    $reservations->create(['itemId' => $paint['id'], 'projectId' => $project['id'], 'requestedQuantity' => 3], 'admin');
    echo json_encode($stock->replenishment());
  `);
  assert.deepEqual(result.items.map(item => item.name), ['Schraube', 'Farbe']);
  assert.deepEqual(result.items.map(item => item.reorderQuantity), [9, 2]);
  assert.equal(result.items[0].availableQuantity, -4);
  assert.equal(result.items[1].minimumQuantity, null);
  assert.equal(result.summary.projectShortageCount, 2);
  assert.deepEqual(result.summary.unitTotals, { Liter:2, Stück:9 });
});

test('Lokale Mindestbestände erzeugen einen nachvollziehbaren Lagerortbedarf', async () => {
  const result = await reportScript(`
    $place = $locations->create(['name' => 'Werkstatt', 'type' => 'ROOM']);
    $item = $items->create(['name' => 'Dichtung', 'stockUnit' => 'Stück']);
    $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 2, 'minimumQuantity' => 7], 'admin');
    echo json_encode($stock->replenishment());
  `);
  assert.equal(result.items[0].globalReorderQuantity, 0);
  assert.equal(result.items[0].localReorderQuantity, 5);
  assert.equal(result.items[0].reorderQuantity, 5);
  assert.equal(result.items[0].localShortages[0].locationName, 'Werkstatt');
  assert.equal(result.items[0].localShortages[0].shortageQuantity, 5);
  assert.equal(result.summary.localShortageCount, 1);
});

test('Nachbestellliste unterstützt Suche, Vollansicht und stabile Sortierungen', async () => {
  const result = await reportScript(`
    $items->create(['name' => 'Schraube M4', 'stockUnit' => 'Stück', 'manufacturer' => 'Fixwerk', 'defaultMinimumQuantity' => 4]);
    $items->create(['name' => 'Dübel', 'stockUnit' => 'Stück']);
    echo json_encode([
      'filtered' => $stock->replenishment('Fixwerk'),
      'all' => $stock->replenishment('', true, 'name'),
    ]);
  `);
  assert.deepEqual(result.filtered.items.map(item => item.name), ['Schraube M4']);
  assert.deepEqual(result.all.items.map(item => item.name), ['Dübel', 'Schraube M4']);
  assert.equal(result.all.items[0].reorderQuantity, 0);
  assert.equal(result.all.items[1].reorderQuantity, 4);
});
