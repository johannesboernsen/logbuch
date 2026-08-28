import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4201';
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
  storage = await mkdtemp(join(tmpdir(), 'logbuch-inventory-reservation-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4201', '-t', 'public', 'public/router.php'], {
    cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Reservierungs-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Reservierungs-API verbindet Projektbedarf, Verfügbarkeit und verknüpfte Entnahme', async () => {
  const project = await request('/api/projects', { method:'POST', body:JSON.stringify({ title:'Gartenhaus', createdAt:'2026-08-27', status:'active' }) });
  assert.equal(project.response.status, 201, JSON.stringify(project.data));
  const task = await request(`/api/projects/${project.data.id}/tasks`, { method:'POST', body:JSON.stringify({ title:'Dach montieren', status:'Offen' }) });
  const item = await request('/api/inventory-items', { method:'POST', body:JSON.stringify({ name:'Schraube M4', stockUnit:'Stück', defaultMinimumQuantity:5 }) });
  const garage = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Garage', type:'ROOM' }) });
  for (const result of [task, item, garage]) assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal((await request('/api/stock-entries', { method:'POST', body:JSON.stringify({ itemId:item.data.id, storageLocationId:garage.data.id, initialQuantity:6 }) })).response.status, 201);

  const created = await request('/api/reservations', { method:'POST', body:JSON.stringify({ itemId:item.data.id, projectId:project.data.id, projectEntryCollection:'tasks', projectEntryId:task.data.id, requestedQuantity:10, note:'Dachbedarf' }) });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.projectEntryTitle, 'Dach montieren');

  const stockAfterReservation = await request(`/api/stock-entries?itemId=${item.data.id}`);
  assert.deepEqual({
    physical:stockAfterReservation.data.summary.physicalQuantity,
    reserved:stockAfterReservation.data.summary.reservedQuantity,
    available:stockAfterReservation.data.summary.availableQuantity,
    reorder:stockAfterReservation.data.summary.reorderQuantity,
  }, { physical:6, reserved:10, available:-4, reorder:9 });

  const partial = await request(`/api/reservations/${created.data.id}/fulfill`, { method:'POST', body:JSON.stringify({ sourceStorageLocationId:garage.data.id, quantity:4, note:'Erste Montage' }) });
  assert.equal(partial.response.status, 201, JSON.stringify(partial.data));
  assert.equal(partial.data.reservation.remainingQuantity, 6);
  assert.equal(partial.data.reservation.status, 'ACTIVE');

  const tooMuch = await request(`/api/reservations/${created.data.id}/fulfill`, { method:'POST', body:JSON.stringify({ sourceStorageLocationId:garage.data.id, quantity:3 }) });
  assert.equal(tooMuch.response.status, 409);
  const afterReject = await request(`/api/stock-entries?itemId=${item.data.id}`);
  assert.equal(afterReject.data.summary.physicalQuantity, 2);
  assert.equal(afterReject.data.summary.reservedQuantity, 6);

  const byProject = await request(`/api/reservations?projectId=${project.data.id}`);
  const byItem = await request(`/api/reservations?itemId=${item.data.id}`);
  assert.equal(byProject.data.reservations[0].id, created.data.id);
  assert.equal(byItem.data.reservations[0].fulfilledQuantity, 4);
  const history = await request(`/api/stock-transactions?itemId=${item.data.id}`);
  assert.equal(history.data.transactions[0].reservationId, created.data.id);
  assert.equal(history.data.transactions[0].type, 'CONSUMPTION');

  const released = await request(`/api/reservations/${created.data.id}/release`, { method:'POST', body:'{}' });
  assert.equal(released.response.status, 200);
  assert.equal(released.data.status, 'RELEASED');
  const finalSummary = await request(`/api/stock-entries?itemId=${item.data.id}`);
  assert.equal(finalSummary.data.summary.reservedQuantity, 0);
  assert.equal(finalSummary.data.summary.physicalQuantity, 2);
});
