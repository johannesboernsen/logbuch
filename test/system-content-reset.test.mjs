import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4243';

test('Alle Inhalte löscht Projekte, Erinnerungen und Lagerdaten, aber nicht Konto, Sitzung und Protokoll', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-content-reset-'));
  let errors = '';
  const server = spawn('php', ['-S', '127.0.0.1:4243', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' },
    stdio:['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { errors += chunk; });
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await fetch(`${baseUrl}/api/install/status`).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const installed = await fetch(`${baseUrl}/api/install`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ siteName:'Inhaltsreset-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort', demoData:true }),
    });
    assert.equal(installed.status, 201, errors);
    const login = await fetch(`${baseUrl}/api/login`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }),
    });
    const loginData = await login.json();
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const writeHeaders = { Cookie:cookie, 'X-Logbuch-CSRF':loginData.csrfToken, 'Content-Type':'application/json' };
    const readHeaders = { Cookie:cookie, Accept:'application/json' };

    const reminder = await fetch(`${baseUrl}/api/todos`, { method:'POST', headers:writeHeaders, body:JSON.stringify({ title:'Wird gelöscht' }) });
    assert.equal(reminder.status, 201, await reminder.clone().text());
    const note = await fetch(`${baseUrl}/api/inventory-items/demo-item-schrauben-m4x30/notes`, { method:'POST', headers:writeHeaders, body:JSON.stringify({ content:'Wird ebenfalls gelöscht' }) });
    assert.equal(note.status, 201, await note.clone().text());

    const reset = await fetch(`${baseUrl}/api/system/content`, { method:'DELETE', headers:writeHeaders, body:'{}' });
    assert.equal(reset.status, 200, `${await reset.clone().text()}\n${errors}`);
    const result = await reset.json();
    assert.ok(result.projects > 0);
    assert.equal(result.reminders, 1);
    assert.ok(result.storageLocations > 0);
    assert.ok(result.items > 0);
    assert.equal(result.itemNotes, 1);
    assert.ok(result.categories > 0);
    assert.ok(result.stockEntries > 0);
    assert.ok(result.reservations > 0);
    assert.ok(result.stockTransactions > 0);

    const [projects, reminders, locations, items, categories, me, audit] = await Promise.all([
      fetch(`${baseUrl}/api/projects`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/todos`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/storage-locations?includeArchived=1`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/inventory-items?includeArchived=1`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/inventory-categories`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/me`, { headers:readHeaders }).then(response => response.json()),
      fetch(`${baseUrl}/api/audit`, { headers:readHeaders }).then(response => response.json()),
    ]);
    assert.deepEqual(projects.projects, []);
    assert.deepEqual(reminders.todos, []);
    assert.deepEqual(locations.locations, []);
    assert.deepEqual(items.items, []);
    assert.deepEqual(categories.categories, []);
    assert.equal(me.id, 'admin');
    assert.ok(audit.events.some(event => event.action === 'system.content_cleared'));
  } finally {
    server.kill('SIGTERM');
    await rm(storage, { recursive:true, force:true });
  }
});
