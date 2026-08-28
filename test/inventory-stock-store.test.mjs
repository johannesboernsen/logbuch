import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function stockScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-stock-'));
  try {
    const script = `
      require $argv[1];
      $database = new \\Logbuch\\Database($argv[2]);
      $pdo = $database->pdo();
      $items = new \\Logbuch\\InventoryItemStore($pdo);
      $locations = new \\Logbuch\\StorageLocationStore($pdo);
      $stock = new \\Logbuch\\InventoryStockStore($pdo);
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

test('Anfangsbestand erzeugt genau einen Bestandseintrag und eine Zugangsbuchung', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Schraube', 'stockUnit' => 'Stück']);
    $garage = $locations->create(['name' => 'Garage', 'type' => 'ROOM']);
    $entry = $stock->create(['itemId' => $item['id'], 'storageLocationId' => $garage['id'], 'initialQuantity' => 40, 'minimumQuantity' => 10], 'admin');
    $duplicate = 0;
    try { $stock->create(['itemId' => $item['id'], 'storageLocationId' => $garage['id']], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $duplicate = $error->status; }
    echo json_encode(['entry' => $entry, 'summary' => $stock->summary($item['id']), 'transactions' => $stock->transactions($item['id']), 'duplicate' => $duplicate]);
  `);
  assert.match(result.entry.id, /^stock-[a-f0-9]{24}$/);
  assert.equal(result.summary.physicalQuantity, 40);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].type, 'RECEIPT');
  assert.equal(result.transactions[0].quantity, 40);
  assert.equal(result.duplicate, 409);
});

test('Zugänge und Entnahmen verändern Bestand nur zusammen mit einer Bewegung', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Muffe', 'stockUnit' => 'Stück']);
    $place = $locations->create(['name' => 'Werkstatt', 'type' => 'ROOM']);
    $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 4], 'admin');
    $stock->record(['type' => 'RECEIPT', 'itemId' => $item['id'], 'destinationStorageLocationId' => $place['id'], 'quantity' => 6], 'admin');
    $stock->record(['type' => 'CONSUMPTION', 'itemId' => $item['id'], 'sourceStorageLocationId' => $place['id'], 'quantity' => 3], 'admin');
    $tooMuch = 0;
    try { $stock->record(['type' => 'LOSS', 'itemId' => $item['id'], 'sourceStorageLocationId' => $place['id'], 'quantity' => 8], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $tooMuch = $error->status; }
    echo json_encode(['summary' => $stock->summary($item['id']), 'types' => array_column($stock->transactions($item['id']), 'type'), 'tooMuch' => $tooMuch]);
  `);
  assert.equal(result.summary.physicalQuantity, 7);
  assert.deepEqual(result.types, ['CONSUMPTION', 'RECEIPT', 'RECEIPT']);
  assert.equal(result.tooMuch, 409);
});

test('Teilmengen-Umlagerung aktualisiert Quelle, Ziel und Historie atomar', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Kabel', 'stockUnit' => 'Meter']);
    $garage = $locations->create(['name' => 'Garage', 'type' => 'ROOM']);
    $workshop = $locations->create(['name' => 'Werkstatt', 'type' => 'ROOM']);
    $stock->create(['itemId' => $item['id'], 'storageLocationId' => $garage['id'], 'initialQuantity' => 12.5], 'admin');
    $stock->record(['type' => 'TRANSFER', 'itemId' => $item['id'], 'sourceStorageLocationId' => $garage['id'], 'destinationStorageLocationId' => $workshop['id'], 'quantity' => 2.75], 'admin');
    $failed = 0;
    try { $stock->record(['type' => 'TRANSFER', 'itemId' => $item['id'], 'sourceStorageLocationId' => $garage['id'], 'destinationStorageLocationId' => $workshop['id'], 'quantity' => 20], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $failed = $error->status; }
    $entries = array_column($stock->list($item['id']), null, 'locationName');
    echo json_encode(['garage' => $entries['Garage']['quantity'], 'workshop' => $entries['Werkstatt']['quantity'], 'transactions' => $stock->transactions($item['id']), 'failed' => $failed]);
  `);
  assert.equal(result.garage, 9.75);
  assert.equal(result.workshop, 2.75);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].type, 'TRANSFER');
  assert.equal(result.failed, 409);
});

test('Vollständige Umlagerung löscht die leere Quelle und legt sie bei späterer Rückkehr neu an', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Fensterleder', 'stockUnit' => 'Stück']);
    $box = $locations->create(['name' => 'Graue Kiste', 'type' => 'BOX']);
    $closet = $locations->create(['name' => 'Abstellkammer', 'type' => 'ROOM']);
    $source = $stock->create(['itemId' => $item['id'], 'storageLocationId' => $box['id'], 'initialQuantity' => 10, 'minimumQuantity' => 2, 'note' => 'Stammplatz'], 'admin');
    $stock->record(['type' => 'TRANSFER', 'itemId' => $item['id'], 'sourceStorageLocationId' => $box['id'], 'destinationStorageLocationId' => $closet['id'], 'quantity' => 10], 'admin');
    $afterMove = $stock->list($item['id']);
    $afterMoveIncludingArchived = $stock->list($item['id'], null, true);
    $stock->record(['type' => 'TRANSFER', 'itemId' => $item['id'], 'sourceStorageLocationId' => $closet['id'], 'destinationStorageLocationId' => $box['id'], 'quantity' => 4], 'admin');
    $afterReturn = array_column($stock->list($item['id']), null, 'locationName');
    echo json_encode(['afterMove' => $afterMove, 'afterMoveIncludingArchived' => $afterMoveIncludingArchived, 'afterReturn' => $afterReturn, 'transactions' => $stock->transactions($item['id'])]);
  `);
  assert.deepEqual(result.afterMove.map(entry => [entry.locationName, entry.quantity]), [['Abstellkammer', 10]]);
  assert.deepEqual(result.afterMoveIncludingArchived.map(entry => entry.locationName), ['Abstellkammer']);
  assert.equal(result.afterReturn['Graue Kiste'].quantity, 4);
  assert.equal(result.afterReturn['Graue Kiste'].status, 'ACTIVE');
  assert.equal(result.afterReturn['Graue Kiste'].minimumQuantity, null);
  assert.equal(result.afterReturn['Graue Kiste'].note, '');
  assert.equal(result.afterReturn['Abstellkammer'].quantity, 6);
  assert.equal(result.transactions.length, 3);
});

test('Bestandskorrekturen protokollieren ausschließlich echte Differenzen', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Schraube', 'stockUnit' => 'Stück']);
    $place = $locations->create(['name' => 'Kiste', 'type' => 'BOX']);
    $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 10], 'admin');
    $down = $stock->record(['type' => 'CORRECTION', 'itemId' => $item['id'], 'storageLocationId' => $place['id'], 'countedQuantity' => 7, 'note' => 'Inventur'], 'admin');
    $same = $stock->record(['type' => 'CORRECTION', 'itemId' => $item['id'], 'storageLocationId' => $place['id'], 'countedQuantity' => 7], 'admin');
    $fraction = 0;
    try { $stock->record(['type' => 'CORRECTION', 'itemId' => $item['id'], 'storageLocationId' => $place['id'], 'countedQuantity' => 7.5], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $fraction = $error->status; }
    echo json_encode(['down' => $down, 'same' => $same, 'count' => count($stock->transactions($item['id'])), 'fraction' => $fraction]);
  `);
  assert.equal(result.down.transaction.type, 'CORRECTION');
  assert.equal(result.down.transaction.sourceStorageLocationId !== null, true);
  assert.equal(result.same.changed, false);
  assert.equal(result.count, 2);
  assert.equal(result.fraction, 422);
});

test('Leere Bestandseinträge lassen sich löschen, ihre Bewegungshistorie bleibt erhalten', async () => {
  const result = await stockScript(`
    $item = $items->create(['name' => 'Dichtung', 'stockUnit' => 'Stück']);
    $place = $locations->create(['name' => 'Fach', 'type' => 'COMPARTMENT']);
    $entry = $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 2], 'admin');
    $blocked = 0;
    try { $stock->delete($entry['id']); }
    catch (\\Logbuch\\HttpError $error) { $blocked = $error->status; }
    $stock->record(['type' => 'CONSUMPTION', 'itemId' => $item['id'], 'sourceStorageLocationId' => $place['id'], 'quantity' => 2], 'admin');
    $deleted = $stock->delete($entry['id']);
    echo json_encode(['blocked' => $blocked, 'deleted' => $deleted, 'activeCount' => count($stock->list($item['id'])), 'allCount' => count($stock->list($item['id'], null, true)), 'transactions' => $stock->transactions($item['id'])]);
  `);
  assert.equal(result.blocked, 409);
  assert.equal(result.deleted, true);
  assert.equal(result.activeCount, 0);
  assert.equal(result.allCount, 0);
  assert.deepEqual(result.transactions.map(transaction => transaction.type), ['CONSUMPTION', 'RECEIPT']);
});
