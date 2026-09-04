import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await import('../public/backup-format.js');
const backupArchives = globalThis.LogbuchBackupArchive;

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4247';
let storage;
let server;
let serverErrors = '';
let cookie = '';
let csrf = '';

async function jsonRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {}),
    ...(cookie ? { Cookie:cookie } : {}),
    ...(!['GET', 'HEAD'].includes(method) && csrf ? { 'X-Logbuch-CSRF':csrf } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}

async function login() {
  const result = await jsonRequest('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(result.response.status, 200, `${JSON.stringify(result.data)}\n${serverErrors.slice(-4000)}`);
  cookie = result.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = result.data.csrfToken;
}

async function uploadBackup(blob, filename = 'vollbackup.tar') {
  const form = new FormData();
  form.append('archive', blob, filename);
  const response = await fetch(`${baseUrl}/api/import/full-archive`, {
    method:'POST',
    headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' },
    body:form,
  });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}

before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-full-backup-'));
  server = spawn('php', ['-S', '127.0.0.1:4247', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' },
    stdio:['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/install/status`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('PHP-Testserver ist nicht gestartet.');
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Vollbackup sichert und ersetzt Projekte, Erinnerungen und das gesamte Lager atomar', async () => {
  const installed = await jsonRequest('/api/install', {
    method:'POST',
    body:JSON.stringify({ siteName:'Vollbackup Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort', demoData:true }),
  });
  assert.equal(installed.response.status, 201, `${JSON.stringify(installed.data)}\n${serverErrors.slice(-4000)}`);
  await login();

  const itemImageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const itemImageForm = new FormData();
  itemImageForm.append('image', new Blob([itemImageBytes], { type:'image/png' }), 'schraube.png');
  const itemImageUpload = await fetch(`${baseUrl}/api/inventory-items/demo-item-schrauben-m4x30/image`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:itemImageForm });
  assert.equal(itemImageUpload.status, 201, await itemImageUpload.text());
  const appearance = await jsonRequest('/api/settings/appearance', { method:'PATCH', body:JSON.stringify({ displayName:'Gesicherte Werkstatt', subtitle:'Mit Logo', accentColor:'#2468ac', themeMode:'dark' }) });
  assert.equal(appearance.response.status, 200, JSON.stringify(appearance.data));
  const logoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const logoForm = new FormData();
  logoForm.append('logo', new Blob([logoBytes], { type:'image/png' }), 'werkstatt.png');
  const logoUpload = await fetch(`${baseUrl}/api/settings/appearance/logo`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:logoForm });
  assert.equal(logoUpload.status, 201, await logoUpload.text());

  const reminder = await jsonRequest('/api/todos', { method:'POST', body:JSON.stringify({ title:'Backup-Erinnerung' }) });
  assert.equal(reminder.response.status, 201);
  const itemNote = await jsonRequest('/api/inventory-items/demo-item-schrauben-m4x30/notes', { method:'POST', body:JSON.stringify({ content:'Nur mit passender M-Kontur-Pressbacke verwenden.' }) });
  assert.equal(itemNote.response.status, 201);

  const exported = await fetch(`${baseUrl}/api/backup/full`, { headers:{ Cookie:cookie } });
  assert.equal(exported.status, 200, serverErrors.slice(-4000));
  assert.match(exported.headers.get('content-type') || '', /application\/x-tar/);
  const backupBuffer = await exported.arrayBuffer();
  const files = backupArchives.parse(backupBuffer);
  assert.ok(files.has('manifest.json'));
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  assert.equal(manifest.format, 'logbuch-full');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.projects.length, 11);
  assert.equal(manifest.tables.todos.some(todo => todo.title === 'Backup-Erinnerung'), true);
  assert.equal(manifest.tables.storage_locations.length, 15);
  assert.equal(manifest.tables.inventory_categories.length, 10);
  assert.equal(manifest.tables.inventory_items.length, 13);
  assert.equal(manifest.tables.inventory_item_notes.length, 1);
  assert.equal(manifest.tables.inventory_item_notes[0].content, 'Nur mit passender M-Kontur-Pressbacke verwenden.');
  assert.equal(manifest.tables.stock_entries.length, 15);
  assert.equal(manifest.tables.reservations.length, 3);
  assert.equal(manifest.tables.stock_transactions.length, 15);
  assert.equal(manifest.inventoryItemImages.length, 1);
  assert.equal(manifest.inventoryItemImages[0].itemId, 'demo-item-schrauben-m4x30');
  assert.deepEqual(Buffer.from(files.get('inventory-items/demo-item-schrauben-m4x30/image.bin')), itemImageBytes);
  assert.equal(manifest.appearanceLogo.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(files.get('appearance/logo.bin')), logoBytes);

  const inconsistentManifest = structuredClone(manifest);
  inconsistentManifest.tables.inventory_items = [];
  const inconsistentArchive = await backupArchives.create([['manifest.json', JSON.stringify(inconsistentManifest)]]);
  const rejected = await uploadBackup(inconsistentArchive, 'inkonsistent.tar');
  assert.equal(rejected.response.status, 422, `${JSON.stringify(rejected.data)}\n${serverErrors.slice(-4000)}`);
  assert.equal((await jsonRequest('/api/me')).response.status, 200, 'Die Sitzung muss nach dem zurückgerollten Import erhalten bleiben.');
  assert.equal((await jsonRequest('/api/projects')).data.projects.length, 11, 'Projekte müssen nach dem zurückgerollten Import erhalten bleiben.');

  const cleared = await jsonRequest('/api/system/content', { method:'DELETE', body:'{}' });
  assert.equal(cleared.response.status, 200);
  assert.equal((await jsonRequest('/api/projects')).data.projects.length, 0);
  assert.equal((await jsonRequest('/api/todos')).data.todos.length, 0);
  assert.equal((await jsonRequest('/api/storage-locations?includeArchived=1')).data.locations.length, 0);

  const restored = await uploadBackup(new Blob([backupBuffer], { type:'application/x-tar' }));
  assert.equal(restored.response.status, 200, `${JSON.stringify(restored.data)}\n${serverErrors.slice(-6000)}`);
  assert.deepEqual(
    { projects:restored.data.projects, reminders:restored.data.reminders, storageLocations:restored.data.storageLocations, items:restored.data.items, categories:restored.data.categories, stockTransactions:restored.data.stockTransactions },
    { projects:11, reminders:1, storageLocations:15, items:13, categories:10, stockTransactions:15 },
  );
  assert.equal((await jsonRequest('/api/me')).response.status, 401, 'Eine vollständige Wiederherstellung muss alte Sitzungen beenden.');

  cookie = '';
  csrf = '';
  await login();
  assert.equal((await jsonRequest('/api/projects')).data.projects.length, 11);
  assert.equal((await jsonRequest('/api/todos')).data.todos.some(todo => todo.title === 'Backup-Erinnerung'), true);
  assert.equal((await jsonRequest('/api/storage-locations?includeArchived=1')).data.locations.length, 15);
  assert.equal((await jsonRequest('/api/inventory-categories')).data.categories.length, 10);
  assert.equal((await jsonRequest('/api/inventory-items?includeArchived=1')).data.items.length, 13);
  assert.equal((await jsonRequest('/api/inventory-items/demo-item-schrauben-m4x30/notes')).data.notes[0].content, 'Nur mit passender M-Kontur-Pressbacke verwenden.');
  const restoredImage = await fetch(`${baseUrl}/api/inventory-items/demo-item-schrauben-m4x30/image`, { headers:{ Cookie:cookie } });
  assert.equal(restoredImage.status, 200);
  assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), itemImageBytes);
  const restoredAppearance = await jsonRequest('/api/appearance');
  assert.deepEqual({ displayName:restoredAppearance.data.displayName, subtitle:restoredAppearance.data.subtitle, accentColor:restoredAppearance.data.accentColor, themeMode:restoredAppearance.data.themeMode, hasLogo:restoredAppearance.data.hasLogo }, { displayName:'Gesicherte Werkstatt', subtitle:'Mit Logo', accentColor:'#2468ac', themeMode:'dark', hasLogo:true });
  const restoredLogo = await fetch(`${baseUrl}/api/appearance/logo`);
  assert.equal(restoredLogo.status, 200);
  assert.deepEqual(Buffer.from(await restoredLogo.arrayBuffer()), logoBytes);
  assert.equal((await jsonRequest('/api/stock-transactions?itemId=demo-item-schrauben-m4x30')).data.transactions.length, 3);
  assert.equal((await jsonRequest('/api/audit')).data.events.some(event => event.action === 'data.full_backup_restored'), true);
});
