import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4230';

test('Installer kann den mitgelieferten Beispieldatensatz aktivieren', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-installer-demo-'));
  let serverErrors = '';
  const server = spawn('php', ['-S', '127.0.0.1:4230', '-t', 'public', 'public/router.php'], {
    cwd: root,
    env: { ...process.env, LOGBUCH_STORAGE_PATH: storage, LOGBUCH_PLATFORM: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await fetch(`${baseUrl}/api/install/status`).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (attempt === 49) throw new Error('PHP-Testserver ist nicht gestartet.');
    }
    const installed = await fetch(`${baseUrl}/api/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteName: 'Demo-Test', timezone: 'Europe/Berlin', adminUser: 'admin', adminPassword: 'sicheres-demo-passwort', demoData: true }),
    });
    const installBody = await installed.clone().text();
    assert.equal(installed.status, 201, `${installBody}\n${serverErrors.slice(-4000)}`);

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', password: 'sicheres-demo-passwort' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const projects = await fetch(`${baseUrl}/api/projects`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(projects.projects.length, 11);
    assert.equal(projects.projects.filter(project => project.status === 'active').length, 4);
    const folders = await fetch(`${baseUrl}/api/folders`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(folders.folders.filter(folder => folder.id.startsWith('demo-folder-')).length, 2);
    const locations = await fetch(`${baseUrl}/api/storage-locations?includeArchived=1`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(locations.locations.filter(location => location.id.startsWith('demo-location-')).length, 15);
    assert.equal(locations.locations.find(location => location.id === 'demo-location-garage-kiste-1').parentId, 'demo-location-garage-regal');
    const items = await fetch(`${baseUrl}/api/inventory-items?includeArchived=1`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(items.items.filter(item => item.id.startsWith('demo-item-')).length, 13);
    const categories = await fetch(`${baseUrl}/api/inventory-categories`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(categories.categories.filter(category => category.id.startsWith('demo-category-')).length, 10);
    assert.deepEqual(items.items.find(item => item.id === 'demo-item-schrauben-m4x30').categoryIds.sort(), ['demo-category-befestigung', 'demo-category-m4']);
    const screwStock = await fetch(`${baseUrl}/api/stock-entries?itemId=demo-item-schrauben-m4x30&includeArchived=1`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(screwStock.entries.length, 3);
    assert.equal(screwStock.summary.physicalQuantity, 70);
    const fanReservations = await fetch(`${baseUrl}/api/reservations?itemId=demo-item-luefter-120`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(fanReservations.reservations.length, 1);
    assert.equal(fanReservations.reservations[0].projectId, 'demo-loetstation-absaugung');
    assert.ok(projects.projects.some(project => project.folderId === 'demo-folder-elektronik'));
    assert.ok(projects.projects.some(project => project.folderId === 'demo-folder-werkstatt'));
    const regularProjects = projects.projects.filter(project => ['idea', 'active', 'paused', 'completed'].includes(project.status));
    assert.equal(regularProjects.filter(project => project.folderId === null).length, 4);
  } finally {
    server.kill('SIGTERM');
    await rm(storage, { recursive: true, force: true });
  }
});
