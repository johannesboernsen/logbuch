import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function categoryScript(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-categories-'));
  try {
    const script = `require $argv[1]; $database = new \\Logbuch\\Database($argv[2]); $store = new \\Logbuch\\InventoryCategoryStore($database->pdo()); ${code}`;
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app', 'bootstrap.php'), join(storage, 'database.sqlite')], { env:{ ...process.env, LOGBUCH_ROOT_PATH:root } });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally { await rm(storage, { recursive:true, force:true }); }
}

test('Kategorien sind beliebig tief verschachtelt und behalten beim Umplatzieren ihren Unterbaum', async () => {
  const result = await categoryScript(`
    $root = $store->create(['name'=>'Schrauben']);
    $metric = $store->create(['name'=>'Metrisch','parentId'=>$root['id']]);
    $m4 = $store->create(['name'=>'M4','parentId'=>$metric['id']]);
    $other = $store->create(['name'=>'Befestigung']);
    $store->update($metric['id'], ['parentId'=>$other['id']]);
    $cycle = 0; try { $store->update($other['id'], ['parentId'=>$m4['id']]); } catch (\\Logbuch\\HttpError $error) { $cycle = $error->status; }
    echo json_encode(['path'=>array_column($store->detail($m4['id'])['path'],'name'),'cycle'=>$cycle]);
  `);
  assert.deepEqual(result.path, ['Befestigung', 'Metrisch', 'M4']);
  assert.equal(result.cycle, 422);
});
test('Artikel können mehreren Kategorien angehören und rekursiv gefunden werden', async () => {
  const result = await categoryScript(`
    $pdo = $database->pdo();
    $pdo->exec("INSERT INTO inventory_items (id,name,stock_unit,created_at,updated_at) VALUES ('item-one','Display','Stück','2026-01-01T00:00:00Z','')");
    $electronics = $store->create(['name'=>'Elektronik']);
    $displays = $store->create(['name'=>'Displays','parentId'=>$electronics['id']]);
    $touch = $store->create(['name'=>'Touch','parentId'=>$displays['id']]);
    $store->replaceItemCategories('item-one', [$touch['id'], $electronics['id']]);
    $blocked = 0; try { $store->delete($electronics['id']); } catch (\\Logbuch\\HttpError $error) { $blocked = $error->status; }
    echo json_encode(['assigned'=>count($store->categoryIdsForItem('item-one')),'direct'=>count($store->itemIds($displays['id'],false)),'recursive'=>count($store->itemIds($displays['id'],true)),'deleteBlocked'=>$blocked]);
  `);
  assert.deepEqual(result, { assigned:2, direct:0, recursive:1, deleteBlocked:409 });
});
