import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4194';
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
  storage = await mkdtemp(join(tmpdir(), 'logbuch-storage-location-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4194', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' },
    stdio:['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const installed = await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Lager-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) });
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

test('StorageLocation-API unterstützt Baum, Deep-Link, Verschieben, Zyklenschutz und Archivierung', async () => {
  const create = async payload => request('/api/storage-locations', { method:'POST', body:JSON.stringify(payload) });
  const garage = await create({ name:'Garage', type:'ROOM', icon:'warehouse', description:'Hauptlager' });
  const workshop = await create({ name:'Werkstatt', type:'ROOM' });
  const shelf = await create({ name:'Regal', type:'SHELF', parentId:garage.data.id });
  const box = await create({ name:'Kiste', type:'BOX', parentId:shelf.data.id });
  for (const result of [garage, workshop, shelf, box]) assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(garage.data.icon, 'warehouse');
  assert.equal(box.data.icon, 'archive');

  const iconUpdate = await request(`/api/storage-locations/${box.data.id}`, { method:'PATCH', body:JSON.stringify({ icon:'package-open' }) });
  assert.equal(iconUpdate.data.icon, 'package-open');
  assert.equal((await request(`/api/storage-locations/${box.data.id}`, { method:'PATCH', body:JSON.stringify({ icon:'<svg>' }) })).response.status, 422);

  const moved = await request(`/api/storage-locations/${shelf.data.id}`, { method:'PATCH', body:JSON.stringify({ parentId:workshop.data.id }) });
  assert.equal(moved.response.status, 200);
  const detail = await request(`/api/storage-locations/${box.data.id}`);
  assert.deepEqual(detail.data.path.map(location => location.name), ['Werkstatt', 'Regal', 'Kiste']);

  const cycle = await request(`/api/storage-locations/${workshop.data.id}`, { method:'PATCH', body:JSON.stringify({ parentId:box.data.id }) });
  assert.equal(cycle.response.status, 422);

  const archived = await request(`/api/storage-locations/${shelf.data.id}/archive`, { method:'POST', body:'{}' });
  assert.equal(archived.data.changed, 2);
  const active = await request('/api/storage-locations');
  assert.ok(!active.data.locations.some(location => location.id === shelf.data.id || location.id === box.data.id));
  const all = await request('/api/storage-locations?includeArchived=1');
  assert.equal(all.data.locations.find(location => location.id === box.data.id).status, 'ARCHIVED');
  assert.equal((await request(`/api/storage-locations/${box.data.id}`)).response.status, 200);

  const restored = await request(`/api/storage-locations/${shelf.data.id}/restore`, { method:'POST', body:'{}' });
  assert.equal(restored.data.changed, 2);
  const reordered = await request('/api/storage-locations/reorder', { method:'POST', body:JSON.stringify({ parentId:null, ids:[workshop.data.id, garage.data.id] }) });
  assert.equal(reordered.response.status, 200);
  assert.deepEqual((await request('/api/storage-locations')).data.locations.filter(location => location.parentId === null).map(location => location.name), ['Werkstatt', 'Garage']);
});
