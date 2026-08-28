import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4203';
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
  storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-replenishment-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4203', '-t', 'public', 'public/router.php'], { cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'] });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Nachbestell-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Nachbestell-API liefert berechnete Fehlbedarfe, Filter und Händlerlinks', async () => {
  const item = await request('/api/inventory-items', { method:'POST', body:JSON.stringify({ name:'Schraube M4', stockUnit:'Stück', manufacturer:'Fixwerk', defaultMinimumQuantity:10, merchantUrl:'https://example.com/screw' }) });
  const location = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Werkstatt', type:'ROOM' }) });
  assert.equal(item.response.status, 201);
  assert.equal(location.response.status, 201);
  assert.equal((await request('/api/stock-entries', { method:'POST', body:JSON.stringify({ itemId:item.data.id, storageLocationId:location.data.id, initialQuantity:3, minimumQuantity:5 }) })).response.status, 201);

  const report = await request('/api/inventory-replenishment');
  assert.equal(report.response.status, 200, JSON.stringify(report.data));
  assert.equal(report.data.items.length, 1);
  assert.equal(report.data.items[0].reorderQuantity, 7);
  assert.equal(report.data.items[0].localReorderQuantity, 2);
  assert.equal(report.data.items[0].merchantUrl, 'https://example.com/screw');

  const search = await request('/api/inventory-replenishment?q=Fixwerk&sort=name');
  assert.equal(search.data.items[0].name, 'Schraube M4');
  assert.equal((await request('/api/inventory-replenishment?q=nicht-vorhanden')).data.items.length, 0);
  assert.equal((await request('/api/inventory-replenishment?sort=invalid')).response.status, 422);
});
