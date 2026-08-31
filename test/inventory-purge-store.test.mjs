import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
async function purgeScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-purge-'));
  try {
    const script = `require $argv[1]; $database = new \\Logbuch\\Database($argv[2]); $pdo=$database->pdo(); $store=new \\Logbuch\\InventoryPurgeStore($pdo); ${code}`;
    const { stdout, stderr } = await run('php', ['-d','display_errors=1','-r',script,join(root,'app','bootstrap.php'),join(storage,'database.sqlite')], { env:{...process.env,LOGBUCH_ROOT_PATH:root} });
    assert.equal(stderr, ''); return JSON.parse(stdout);
  } finally { await rm(storage,{recursive:true,force:true}); }
}

test('Endgültiges Löschen eines Artikels entfernt alle Lagerabhängigkeiten', async () => {
  const result = await purgeScript(`
    $pdo->exec("INSERT INTO storage_locations (id,name,status,sort_order,created_at,updated_at) VALUES ('location-one','Regal','ACTIVE',0,'2026-01-01','')");
    $pdo->exec("INSERT INTO inventory_items (id,name,stock_unit,status,created_at,updated_at) VALUES ('item-one','Altteil','Stück','ARCHIVED','2026-01-01','')");
    $pdo->exec("INSERT INTO inventory_categories (id,name,sort_order,created_at,updated_at) VALUES ('category-one','Teile',0,'2026-01-01','')");
    $pdo->exec("INSERT INTO inventory_item_categories (item_id,category_id,created_at) VALUES ('item-one','category-one','2026-01-01')");
    $pdo->exec("INSERT INTO stock_entries (id,item_id,storage_location_id,quantity,created_at,updated_at) VALUES ('stock-one','item-one','location-one',2,'2026-01-01','')");
    $pdo->exec("INSERT INTO reservations (id,item_id,project_id,requested_quantity,status,created_at,updated_at) VALUES ('reservation-one','item-one','project-one',1,'ACTIVE','2026-01-01','2026-01-01')");
    $pdo->exec("INSERT INTO stock_transactions (id,item_id,type,quantity,destination_storage_location_id,created_at,occurred_at) VALUES ('transaction-one','item-one','RECEIPT',2,'location-one','2026-01-01','2026-01-01')");
    $preview=$store->itemPreview('item-one'); $deleted=$store->deleteItem('item-one');
    echo json_encode(['preview'=>$preview,'items'=>(int)$pdo->query("SELECT COUNT(*) FROM inventory_items")->fetchColumn(),'entries'=>(int)$pdo->query("SELECT COUNT(*) FROM stock_entries")->fetchColumn(),'transactions'=>(int)$pdo->query("SELECT COUNT(*) FROM stock_transactions")->fetchColumn(),'reservations'=>(int)$pdo->query("SELECT COUNT(*) FROM reservations")->fetchColumn(),'links'=>(int)$pdo->query("SELECT COUNT(*) FROM inventory_item_categories")->fetchColumn(),'category'=>(int)$pdo->query("SELECT COUNT(*) FROM inventory_categories")->fetchColumn()]);
  `);
  assert.equal(result.preview.stockEntries, 1);
  assert.deepEqual({items:result.items,entries:result.entries,transactions:result.transactions,reservations:result.reservations,links:result.links,category:result.category},{items:0,entries:0,transactions:0,reservations:0,links:0,category:1});
});

test('Endgültiges Löschen eines Lagerorts entfernt Unterbaum und lokale Historie, nicht den Artikel', async () => {
  const result = await purgeScript(`
    $pdo->exec("INSERT INTO storage_locations (id,name,status,sort_order,created_at,updated_at) VALUES ('location-root','Garage','ARCHIVED',0,'2026-01-01','')");
    $pdo->exec("INSERT INTO storage_locations (id,parent_id,name,status,sort_order,created_at,updated_at) VALUES ('location-child','location-root','Kiste','ARCHIVED',0,'2026-01-01','')");
    $pdo->exec("INSERT INTO inventory_items (id,name,stock_unit,status,created_at,updated_at) VALUES ('item-one','Schraube','Stück','ACTIVE','2026-01-01','')");
    $pdo->exec("INSERT INTO stock_entries (id,item_id,storage_location_id,quantity,created_at,updated_at) VALUES ('stock-one','item-one','location-child',3,'2026-01-01','')");
    $pdo->exec("INSERT INTO stock_transactions (id,item_id,type,quantity,destination_storage_location_id,created_at,occurred_at) VALUES ('transaction-one','item-one','RECEIPT',3,'location-child','2026-01-01','2026-01-01')");
    $preview=$store->locationPreview('location-root'); $store->deleteLocation('location-root');
    echo json_encode(['preview'=>$preview,'locations'=>(int)$pdo->query("SELECT COUNT(*) FROM storage_locations")->fetchColumn(),'items'=>(int)$pdo->query("SELECT COUNT(*) FROM inventory_items")->fetchColumn(),'entries'=>(int)$pdo->query("SELECT COUNT(*) FROM stock_entries")->fetchColumn(),'transactions'=>(int)$pdo->query("SELECT COUNT(*) FROM stock_transactions")->fetchColumn()]);
  `);
  assert.deepEqual(result.preview,{kind:'location',id:'location-root',name:'Garage',locations:2,stockEntries:1,affectedItems:1,transactions:1});
  assert.deepEqual({locations:result.locations,items:result.items,entries:result.entries,transactions:result.transactions},{locations:0,items:1,entries:0,transactions:0});
});
