import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function scenario(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-bulk-'));
  try {
    const script = `require $argv[1]; $db = (new \\Logbuch\\Database($argv[2]))->pdo();
      $now = '2026-09-04T10:00:00Z';
      $db->exec("INSERT INTO storage_locations (id,name,created_at,updated_at) VALUES ('location-a','Kiste A','$now',''),('location-b','Kiste B','$now','')");
      $db->exec("INSERT INTO inventory_categories (id,name,created_at,updated_at) VALUES ('category-a','Schrauben','$now','')");
      $db->exec("INSERT INTO inventory_items (id,name,stock_unit,tracking_mode,status,created_at,updated_at) VALUES ('item-a','M4','Stück','QUANTITY','ACTIVE','$now',''),('item-b','M5','Stück','QUANTITY','ACTIVE','$now','')");
      $db->exec("INSERT INTO stock_entries (id,item_id,storage_location_id,quantity,status,created_at,updated_at) VALUES ('stock-a','item-a','location-a',10,'ACTIVE','$now',''),('stock-b','item-b','location-a',20,'ACTIVE','$now','')");
      $store = new \\Logbuch\\InventoryBulkStore($db); ${code}`;
    const result = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app/bootstrap.php'), join(storage, 'database.sqlite')], { env:{ ...process.env, LOGBUCH_ROOT_PATH:root } });
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  } finally { await rm(storage, { recursive:true, force:true }); }
}

test('Mehrere Artikel erhalten Kategorien, globales Minimum und Inventurvormerkungen', async () => {
  const result = await scenario(`
    $store->items(['itemIds'=>['item-a','item-b'],'action'=>'ADD_CATEGORIES','categoryIds'=>['category-a']], 'admin');
    $store->items(['itemIds'=>['item-a','item-b'],'action'=>'SET_GLOBAL_MINIMUM','value'=>5], 'admin');
    $store->items(['itemIds'=>['item-a','item-b'],'action'=>'REQUEST_AUDIT','priority'=>'URGENT','note'=>'Prüfen'], 'admin');
    echo json_encode(['categories'=>(int)$db->query('SELECT COUNT(*) FROM inventory_item_categories')->fetchColumn(),'minimum'=>(int)$db->query('SELECT SUM(default_minimum_quantity) FROM inventory_items')->fetchColumn(),'requests'=>(int)$db->query("SELECT COUNT(*) FROM inventory_audit_requests WHERE priority='URGENT' AND status='OPEN'")->fetchColumn()]);
  `);
  assert.deepEqual(result, { categories:2, minimum:10, requests:2 });
});

test('Mehrere Lagerpositionen werden vollständig und nachvollziehbar verschoben', async () => {
  const result = await scenario(`
    $store->stockEntries(['stockEntryIds'=>['stock-a','stock-b'],'action'=>'SET_LOCAL_MINIMUM','value'=>3], 'admin');
    $store->stockEntries(['stockEntryIds'=>['stock-a','stock-b'],'action'=>'MOVE','destinationStorageLocationId'=>'location-b','note'=>'Kiste gewechselt'], 'admin');
    echo json_encode(['atTarget'=>(int)$db->query("SELECT COUNT(*) FROM stock_entries WHERE storage_location_id='location-b'")->fetchColumn(),'quantity'=>(int)$db->query("SELECT SUM(quantity) FROM stock_entries WHERE storage_location_id='location-b'")->fetchColumn(),'minimum'=>(int)$db->query("SELECT SUM(minimum_quantity) FROM stock_entries WHERE storage_location_id='location-b'")->fetchColumn(),'transfers'=>(int)$db->query("SELECT COUNT(*) FROM stock_transactions WHERE type='TRANSFER'")->fetchColumn()]);
  `);
  assert.deepEqual(result, { atTarget:2, quantity:30, minimum:6, transfers:2 });
});
