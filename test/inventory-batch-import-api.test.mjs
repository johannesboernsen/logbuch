import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4260';
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
  storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-batch-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4260', '-t', 'public', 'public/router.php'], {
    cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Import-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Feste CSV-Vorlage und Vorschau sind lagerortbezogen', async () => {
  const location = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Schraubenkoffer' }) });
  assert.equal(location.response.status, 201);
  const template = await fetch(`${baseUrl}/api/inventory-items/import-template`, { headers:{ Cookie:cookie } });
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-disposition'), /logbuch-artikel-import\.csv/);
  assert.equal((await template.text()).replace(/^\uFEFF/, ''), 'Name;Anfangsbestand;Einheit;Lokaler Mindestbestand;Globaler Mindestbestand;Hersteller;Artikelnummer;Barcode / EAN;Beschreibung;Händlerlink;Lagerortnotiz\r\n');

  const csv = 'Name;Anfangsbestand;Einheit;Lokaler Mindestbestand;Globaler Mindestbestand;Hersteller;Artikelnummer;Barcode / EAN;Beschreibung;Händlerlink;Lagerortnotiz\nSpax 4x40;100;Stück;20;30;Spax;A-40;;Senkkopf;;\nSpax 5x50;25;;5;;;;;;;Obere Reihe';
  const preview = await request('/api/inventory-items/import-preview', { method:'POST', body:JSON.stringify({ storageLocationId:location.data.id, categoryIds:[], csv }) });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rowCount, 2);
  assert.equal(preview.data.storageLocation.name, 'Schraubenkoffer');
  assert.equal(preview.data.rows[1].stockUnit, 'Stück');
});

test('Import legt Artikel, Bestände, Anfangsbuchungen und mehrere Kategorien atomar an', async () => {
  const location = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Sortiment' }) });
  const categoryA = await request('/api/inventory-categories', { method:'POST', body:JSON.stringify({ name:'Schrauben' }) });
  const categoryB = await request('/api/inventory-categories', { method:'POST', body:JSON.stringify({ name:'Verzinkt' }) });
  const header = 'Name;Anfangsbestand;Einheit;Lokaler Mindestbestand;Globaler Mindestbestand;Hersteller;Artikelnummer;Barcode / EAN;Beschreibung;Händlerlink;Lagerortnotiz';
  const csv = `${header}\nBlechschraube 3x16;40;Stück;8;12;FixCo;BS316;4012345678901;Selbstschneidend;https://example.com/bs316;Fach A\nBlechschraube 4x20;0;Stück;;;FixCo;BS420;;;;Fach B`;
  const imported = await request('/api/inventory-items/import', { method:'POST', body:JSON.stringify({ storageLocationId:location.data.id, categoryIds:[categoryA.data.id, categoryB.data.id], csv }) });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.count, 2);

  const items = await request('/api/inventory-items');
  assert.equal(items.data.items.length, 2);
  for (const item of items.data.items) assert.deepEqual(new Set(item.categoryIds), new Set([categoryA.data.id, categoryB.data.id]));
  const first = items.data.items.find(item => item.articleNumber === 'BS316');
  const stock = await request(`/api/stock-entries?itemId=${first.id}`);
  assert.equal(stock.data.entries[0].quantity, 40);
  assert.equal(stock.data.entries[0].minimumQuantity, 8);
  assert.equal(stock.data.entries[0].note, 'Fach A');
  assert.equal(stock.data.summary.minimumQuantity, 12);
  const transactions = await request(`/api/stock-transactions?itemId=${first.id}`);
  assert.equal(transactions.data.transactions.length, 1);
  assert.equal(transactions.data.transactions[0].type, 'RECEIPT');

  const invalid = `${header}\nGültig;2;Stück;;;;;;;;\nUngültig;x;Stück;;;;;;;;`;
  const rejected = await request('/api/inventory-items/import', { method:'POST', body:JSON.stringify({ storageLocationId:location.data.id, categoryIds:[], csv:invalid }) });
  assert.equal(rejected.response.status, 422);
  assert.equal((await request('/api/inventory-items')).data.items.length, 2);
});
