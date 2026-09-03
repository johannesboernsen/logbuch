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

test('Lose Sammlung besitzt Lagerort und unabhängige Projektbuchungen ohne Menge', async () => {
  const projectA = await request('/api/projects', { method:'POST', body:JSON.stringify({ title:'Werkbank', createdAt:'2026-09-03', status:'active' }) });
  const projectB = await request('/api/projects', { method:'POST', body:JSON.stringify({ title:'Kamera-Rig', createdAt:'2026-09-03', status:'active' }) });
  const item = await request('/api/inventory-items', { method:'POST', body:JSON.stringify({ name:'Lose selbstschneidende Schrauben', trackingMode:'COLLECTION', defaultMinimumQuantity:99 }) });
  const shelf = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Kleinteileregal' }) });
  const box = await request('/api/storage-locations', { method:'POST', body:JSON.stringify({ name:'Sortierbox' }) });
  for (const result of [projectA, projectB, item, shelf, box]) assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(item.data.trackingMode, 'COLLECTION');
  assert.equal(item.data.defaultMinimumQuantity, null);

  const placed = await request('/api/stock-entries', { method:'POST', body:JSON.stringify({ itemId:item.data.id, storageLocationId:shelf.data.id, note:'Blaue Kiste' }) });
  assert.equal(placed.response.status, 201, JSON.stringify(placed.data));
  assert.equal(placed.data.trackingMode, 'COLLECTION');
  assert.equal(placed.data.quantity, null);

  const bookingA = await request('/api/reservations', { method:'POST', body:JSON.stringify({ itemId:item.data.id, projectId:projectA.data.id, note:'Für Prototypen' }) });
  const bookingB = await request('/api/reservations', { method:'POST', body:JSON.stringify({ itemId:item.data.id, projectId:projectB.data.id }) });
  assert.equal(bookingA.response.status, 201, JSON.stringify(bookingA.data));
  assert.equal(bookingB.response.status, 201, JSON.stringify(bookingB.data));
  assert.equal(bookingA.data.trackingMode, 'COLLECTION');
  assert.equal(bookingA.data.requestedQuantity, null);
  assert.equal(bookingB.data.remainingQuantity, null);
  const edited = await request(`/api/reservations/${bookingA.data.id}`, { method:'PATCH', body:JSON.stringify({ note:'Für erste Prototypen' }) });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.note, 'Für erste Prototypen');

  const duplicate = await request('/api/reservations', { method:'POST', body:JSON.stringify({ itemId:item.data.id, projectId:projectA.data.id }) });
  assert.equal(duplicate.response.status, 409);

  const summary = await request(`/api/stock-entries?itemId=${item.data.id}`);
  assert.deepEqual({ trackingMode:summary.data.summary.trackingMode, physical:summary.data.summary.physicalQuantity, reserved:summary.data.summary.reservedQuantity, bookings:summary.data.summary.bookingCount }, { trackingMode:'COLLECTION', physical:null, reserved:null, bookings:2 });
  const overview = await request('/api/inventory-items?withOverview=1');
  const overviewItem = overview.data.items.find(candidate => candidate.id === item.data.id);
  assert.deepEqual({ physical:overviewItem.physicalQuantity, reserved:overviewItem.reservedQuantity, available:overviewItem.availableQuantity, bookings:overviewItem.bookingCount }, { physical:null, reserved:null, available:null, bookings:2 });

  const movement = await request('/api/stock-movements', { method:'POST', body:JSON.stringify({ type:'RECEIPT', itemId:item.data.id, destinationStorageLocationId:shelf.data.id, quantity:1 }) });
  assert.equal(movement.response.status, 409);
  const fulfillment = await request(`/api/reservations/${bookingA.data.id}/fulfill`, { method:'POST', body:JSON.stringify({ sourceStorageLocationId:shelf.data.id, quantity:1 }) });
  assert.equal(fulfillment.response.status, 409);

  const moved = await request(`/api/stock-entries/${placed.data.id}`, { method:'PATCH', body:JSON.stringify({ storageLocationId:box.data.id }) });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.storageLocationId, box.data.id);

  const replenishment = await request('/api/inventory-replenishment?includeSatisfied=1');
  assert.equal(replenishment.response.status, 200);
  assert.ok(!replenishment.data.items.some(candidate => candidate.itemId === item.data.id));
});
