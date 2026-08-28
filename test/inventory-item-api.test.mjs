import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4197';
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
  storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-item-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4197', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' },
    stdio:['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const installed = await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Artikel-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) });
  assert.equal(installed.response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Artikel-API unterstützt Stammdaten, Suche, Deep-Link und Archivierung', async () => {
  const created = await request('/api/inventory-items', { method:'POST', body:JSON.stringify({ name:'Muffe 22 mm', stockUnit:'Stück', manufacturer:'Kupferwerk', articleNumber:'MU-22', defaultMinimumQuantity:5 }) });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.match(created.data.id, /^item-[a-f0-9]{24}$/);

  const updated = await request(`/api/inventory-items/${created.data.id}`, { method:'PATCH', body:JSON.stringify({ description:'Kupfermuffe für Trinkwasser' }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.stockUnit, 'Stück');
  assert.equal(updated.data.description, 'Kupfermuffe für Trinkwasser');

  const search = await request('/api/inventory-items?q=Kupferwerk');
  assert.deepEqual(search.data.items.map(item => item.id), [created.data.id]);
  assert.equal((await request(`/api/inventory-items/${created.data.id}`)).data.name, 'Muffe 22 mm');

  assert.equal((await request(`/api/inventory-items/${created.data.id}/archive`, { method:'POST', body:'{}' })).response.status, 200);
  assert.equal((await request('/api/inventory-items')).data.items.length, 0);
  assert.equal((await request(`/api/inventory-items/${created.data.id}`)).data.status, 'ARCHIVED');
  assert.equal((await request('/api/inventory-items?includeArchived=1')).data.items[0].status, 'ARCHIVED');
  assert.equal((await request(`/api/inventory-items/${created.data.id}/restore`, { method:'POST', body:'{}' })).response.status, 200);
});
