import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function reservationScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-reservation-'));
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
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), storage], {
      env:{ ...process.env, LOGBUCH_ROOT_PATH:root },
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    await rm(storage, { recursive:true, force:true });
  }
}

const setup = `
  $project = $projects->create(['title' => 'Gartenhaus', 'createdAt' => '2026-08-27', 'status' => 'active'], 'admin');
  $task = $projects->createItem($project['id'], 'tasks', ['title' => 'Dach montieren', 'status' => 'Offen'], 'admin');
  $item = $items->create(['name' => 'Schraube', 'stockUnit' => 'Stück', 'defaultMinimumQuantity' => 5]);
  $place = $locations->create(['name' => 'Garage', 'type' => 'ROOM']);
  $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 6], 'admin');
`;

test('Reservierungen binden Artikel an Projekt und Arbeitsschritt und dürfen Überbedarf erzeugen', async () => {
  const result = await reservationScript(`${setup}
    $reservation = $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'projectEntryCollection' => 'tasks', 'projectEntryId' => $task['id'], 'requestedQuantity' => 10, 'note' => 'Für das Dach'], 'admin');
    echo json_encode(['reservation' => $reservation, 'summary' => $stock->summary($item['id'])]);
  `);
  assert.match(result.reservation.id, /^reservation-[a-f0-9]{24}$/);
  assert.equal(result.reservation.projectTitle, 'Gartenhaus');
  assert.equal(result.reservation.projectEntryTitle, 'Dach montieren');
  assert.equal(result.summary.physicalQuantity, 6);
  assert.equal(result.summary.reservedQuantity, 10);
  assert.equal(result.summary.availableQuantity, -4);
  assert.equal(result.summary.reorderQuantity, 9);
});

test('Teilerfüllung reduziert Bestand und offenen Bedarf in einer Transaktion', async () => {
  const result = await reservationScript(`${setup}
    $reservation = $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 5], 'admin');
    $partial = $reservations->fulfill($reservation['id'], ['sourceStorageLocationId' => $place['id'], 'quantity' => 2], 'admin');
    $complete = $reservations->fulfill($reservation['id'], ['sourceStorageLocationId' => $place['id'], 'quantity' => 3], 'admin');
    echo json_encode(['partial' => $partial, 'complete' => $complete, 'summary' => $stock->summary($item['id']), 'transactions' => $stock->transactions($item['id'])]);
  `);
  assert.equal(result.partial.reservation.status, 'ACTIVE');
  assert.equal(result.partial.reservation.remainingQuantity, 3);
  assert.equal(result.complete.reservation.status, 'FULFILLED');
  assert.equal(result.complete.reservation.remainingQuantity, 0);
  assert.equal(result.summary.physicalQuantity, 1);
  assert.equal(result.summary.reservedQuantity, 0);
  assert.equal(result.transactions[0].reservationId, result.complete.reservation.id);
  assert.deepEqual(result.transactions.slice(0, 2).map(transaction => transaction.type), ['CONSUMPTION', 'CONSUMPTION']);
});

test('Fehlgeschlagene Erfüllung verändert weder Bestand noch Reservierung', async () => {
  const result = await reservationScript(`${setup}
    $reservation = $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 8], 'admin');
    $status = 0;
    try { $reservations->fulfill($reservation['id'], ['sourceStorageLocationId' => $place['id'], 'quantity' => 7], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $status = $error->status; }
    echo json_encode(['status' => $status, 'reservation' => $reservations->detail($reservation['id']), 'summary' => $stock->summary($item['id']), 'transactions' => $stock->transactions($item['id'])]);
  `);
  assert.equal(result.status, 409);
  assert.equal(result.reservation.fulfilledQuantity, 0);
  assert.equal(result.reservation.status, 'ACTIVE');
  assert.equal(result.summary.physicalQuantity, 6);
  assert.equal(result.transactions.length, 1);
});

test('Freigeben und Stornieren schließen Bedarfe ohne physischen Bestandswechsel', async () => {
  const result = await reservationScript(`${setup}
    $released = $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 2], 'admin');
    $cancelled = $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 3], 'admin');
    $released = $reservations->close($released['id'], 'RELEASED');
    $cancelled = $reservations->close($cancelled['id'], 'CANCELLED');
    echo json_encode(['released' => $released, 'cancelled' => $cancelled, 'summary' => $stock->summary($item['id'])]);
  `);
  assert.equal(result.released.status, 'RELEASED');
  assert.equal(result.cancelled.status, 'CANCELLED');
  assert.ok(result.released.closedAt);
  assert.equal(result.summary.physicalQuantity, 6);
  assert.equal(result.summary.reservedQuantity, 0);
});

test('Neue Reservierungen validieren Projektziel, Artikelstatus und Stückmengen', async () => {
  const result = await reservationScript(`${setup}
    $badTarget = $fraction = $archived = 0;
    try { $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'projectEntryCollection' => 'tasks', 'projectEntryId' => 'task-missing', 'requestedQuantity' => 1], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $badTarget = $error->status; }
    try { $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 1.5], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $fraction = $error->status; }
    $items->archive($item['id']);
    try { $reservations->create(['itemId' => $item['id'], 'projectId' => $project['id'], 'requestedQuantity' => 1], 'admin'); }
    catch (\\Logbuch\\HttpError $error) { $archived = $error->status; }
    echo json_encode(compact('badTarget', 'fraction', 'archived'));
  `);
  assert.deepEqual(result, { badTarget:404, fraction:422, archived:409 });
});
