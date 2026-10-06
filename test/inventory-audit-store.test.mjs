import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function auditScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-audit-'));
  try {
    const script = `
      require $argv[1];
      $database = new \\Logbuch\\Database($argv[2] . '/database.sqlite');
      $pdo = $database->pdo();
      $items = new \\Logbuch\\InventoryItemStore($pdo);
      $locations = new \\Logbuch\\StorageLocationStore($pdo);
      $categories = new \\Logbuch\\InventoryCategoryStore($pdo);
      $stock = new \\Logbuch\\InventoryStockStore($pdo);
      $audits = new \\Logbuch\\InventoryAuditStore($pdo);
      ${code}
    `;
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), storage], { env:{ ...process.env, LOGBUCH_ROOT_PATH:root } });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    await rm(storage, { recursive:true, force:true });
  }
}

test('Inventurlauf grenzt Lager- und Kategorieunterbäume als Schnittmenge ein', async () => {
  const result = await auditScript(`
    $room = $locations->create(['name' => 'Werkstatt']);
    $box = $locations->create(['name' => 'Koffer', 'parentId' => $room['id']]);
    $other = $locations->create(['name' => 'Keller']);
    $parts = $categories->create(['name' => 'Kleinteile']);
    $screws = $categories->create(['name' => 'Schrauben', 'parentId' => $parts['id']]);
    $screw = $items->create(['name' => 'M4', 'stockUnit' => 'Stück']);
    $paint = $items->create(['name' => 'Lack', 'stockUnit' => 'Liter']);
    $categories->replaceItemCategories($screw['id'], [$screws['id']]);
    $categories->replaceItemCategories($paint['id'], []);
    $stock->create(['itemId' => $screw['id'], 'storageLocationId' => $box['id'], 'initialQuantity' => 10], 'admin');
    $stock->create(['itemId' => $screw['id'], 'storageLocationId' => $other['id'], 'initialQuantity' => 5], 'admin');
    $stock->create(['itemId' => $paint['id'], 'storageLocationId' => $box['id'], 'initialQuantity' => 1], 'admin');
    $audit = $audits->createAudit(['name' => 'Koffer-Schrauben', 'locationId' => $room['id'], 'includeLocationDescendants' => true, 'categoryId' => $parts['id'], 'includeCategoryDescendants' => true], 'admin');
    echo json_encode($audit);
  `);
  assert.equal(result.summary.total, 1);
  assert.equal(result.entries[0].itemName, 'M4');
  assert.equal(result.entries[0].locationName, 'Koffer');
});

test('Prüfung dokumentiert Treffer und erzeugt bei Abweichung eine Korrekturbuchung', async () => {
  const result = await auditScript(`
    $place = $locations->create(['name' => 'Schublade']);
    $item = $items->create(['name' => 'Mutter', 'stockUnit' => 'Stück']);
    $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id'], 'initialQuantity' => 10], 'admin');
    $audit = $audits->createAudit(['name' => 'Test'], 'admin');
    $checked = $audits->check($audit['id'], $audit['entries'][0]['id'], ['countedQuantity' => 8, 'correctStock' => true, 'note' => 'Zwei fehlen'], 'admin');
    $completed = $audits->complete($audit['id'], 'admin');
    echo json_encode(['checked' => $checked, 'completed' => $completed, 'stock' => $stock->summary($item['id']), 'transactions' => $stock->transactions($item['id'])]);
  `);
  assert.equal(result.checked.entries[0].result, 'CORRECTED');
  assert.equal(result.checked.entries[0].countedQuantity, 8);
  assert.ok(result.checked.entries[0].correctionTransactionId);
  assert.equal(result.stock.physicalQuantity, 8);
  assert.equal(result.transactions[0].type, 'CORRECTION');
  assert.equal(result.completed.status, 'COMPLETED');
});

test('Dringende Vormerkung bleibt bis zur tatsächlichen Prüfung bestehen', async () => {
  const result = await auditScript(`
    $place = $locations->create(['name' => 'Kiste']);
    $item = $items->create(['name' => 'Sortiment', 'trackingMode' => 'COLLECTION']);
    $entry = $stock->create(['itemId' => $item['id'], 'storageLocationId' => $place['id']], 'admin');
    $request = $audits->request(['itemId' => $item['id'], 'priority' => 'URGENT', 'note' => 'Nach Umzug prüfen'], 'admin');
    $before = $audits->overview();
    $audit = $audits->createAudit(['name' => 'Dringend', 'requestMode' => 'URGENT'], 'admin');
    $afterCheck = $audits->check($audit['id'], $audit['entries'][0]['id'], ['result' => 'OK'], 'admin');
    $after = $audits->overview();
    echo json_encode(compact('request', 'before', 'afterCheck', 'after'));
  `);
  assert.equal(result.before.summary.urgentCount, 1);
  assert.equal(result.afterCheck.entries[0].result, 'OK');
  assert.equal(result.after.summary.requestCount, 0);
});
