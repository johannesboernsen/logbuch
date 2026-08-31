import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4199';
let storage;
let server;
let cookie = '';
let csrf = '';
let serverErrors = '';

async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(cookie ? { Cookie:cookie } : {}), ...(!['GET','HEAD'].includes(method) && csrf ? { 'X-Logbuch-CSRF':csrf } : {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}

before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-stock-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4199', '-t', 'public', 'public/router.php'], {
    cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Bestands-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Bestands-API verbindet Artikel und Lagerorte über atomare Bewegungen', async () => {
  const item = await request('/api/inventory-items', { method:'POST', body:JSON.stringify({ name:'Schraube M4', stockUnit:'Stück', defaultMinimumQuantity:5 }) });
  const garage = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Garage', type:'ROOM' }) });
  const workshop = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Werkstatt', type:'ROOM' }) });
  for (const result of [item, garage, workshop]) assert.equal(result.response.status, 201, JSON.stringify(result.data));

  const assigned = await request('/api/stock-entries', { method:'POST', body:JSON.stringify({ itemId:item.data.id, storageLocationId:garage.data.id, initialQuantity:10, minimumQuantity:3, note:'Hauptvorrat' }) });
  assert.equal(assigned.response.status, 201, JSON.stringify(assigned.data));
  assert.equal(assigned.data.quantity, 10);

  const receipt = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'RECEIPT', itemId:item.data.id, destinationStorageLocationId:garage.data.id, quantity:5 }) });
  assert.equal(receipt.response.status, 201);
  assert.equal(receipt.data.summary.physicalQuantity, 15);

  const transfer = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'TRANSFER', itemId:item.data.id, sourceStorageLocationId:garage.data.id, destinationStorageLocationId:workshop.data.id, quantity:4 }) });
  assert.equal(transfer.response.status, 201);
  assert.equal(transfer.data.summary.physicalQuantity, 15);
  const balances = Object.fromEntries(transfer.data.summary.entries.map(entry => [entry.locationName, entry.quantity]));
  assert.deepEqual(balances, { Garage:11, Werkstatt:4 });

  const rejected = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'CONSUMPTION', itemId:item.data.id, sourceStorageLocationId:workshop.data.id, quantity:5 }) });
  assert.equal(rejected.response.status, 409);
  const afterReject = await request(`/api/stock-entries?itemId=${item.data.id}`);
  assert.equal(afterReject.data.summary.physicalQuantity, 15);
  assert.equal(afterReject.data.entries.find(entry => entry.locationName === 'Werkstatt').quantity, 4);

  const corrected = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'CORRECTION', itemId:item.data.id, storageLocationId:workshop.data.id, countedQuantity:2, note:'Inventur' }) });
  assert.equal(corrected.response.status, 201);
  assert.equal(corrected.data.summary.physicalQuantity, 13);
  const tableOverview = await request(`/api/inventory-items?q=Schraube&withOverview=1`);
  assert.deepEqual(
    { physicalQuantity:tableOverview.data.items[0].physicalQuantity, reservedQuantity:tableOverview.data.items[0].reservedQuantity, availableQuantity:tableOverview.data.items[0].availableQuantity },
    { physicalQuantity:13, reservedQuantity:0, availableQuantity:13 },
  );

  const history = await request(`/api/stock-transactions?itemId=${item.data.id}`);
  assert.deepEqual(history.data.transactions.map(transaction => transaction.type), ['CORRECTION','TRANSFER','RECEIPT','RECEIPT']);
  assert.equal((await request(`/api/stock-transactions/${history.data.transactions[0].id}`, { method:'PATCH', body:'{}' })).response.status, 404);
  assert.equal((await request(`/api/stock-transactions/${history.data.transactions[0].id}`, { method:'DELETE' })).response.status, 404);

  const fullTransfer = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'TRANSFER', itemId:item.data.id, sourceStorageLocationId:garage.data.id, destinationStorageLocationId:workshop.data.id, quantity:11 }) });
  assert.equal(fullTransfer.response.status, 201);
  assert.deepEqual(fullTransfer.data.summary.entries.map(entry => [entry.locationName, entry.quantity]), [['Werkstatt', 13]]);
  const withArchivedSource = await request(`/api/stock-entries?itemId=${item.data.id}&includeArchived=1`);
  assert.equal(withArchivedSource.data.entries.some(entry => entry.locationName === 'Garage'), false);

  const consumedAll = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'CONSUMPTION', itemId:item.data.id, sourceStorageLocationId:workshop.data.id, quantity:13 }) });
  assert.equal(consumedAll.response.status, 201);
  assert.deepEqual(consumedAll.data.summary.entries.map(entry => [entry.locationName, entry.quantity, entry.status]), [['Werkstatt', 0, 'ACTIVE']]);

  const removed = await request(`/api/stock-entries/${consumedAll.data.summary.entries[0].id}`, { method:'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.deleted, true);
  const afterRemoval = await request(`/api/stock-entries?itemId=${item.data.id}&includeArchived=1`);
  assert.deepEqual(afterRemoval.data.entries, []);
  const historyAfterRemoval = await request(`/api/stock-transactions?itemId=${item.data.id}`);
  assert.equal(historyAfterRemoval.data.transactions.length, 6);
});
