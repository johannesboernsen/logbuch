import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await import('../public/backup-format.js');
const backupArchives = globalThis.LogbuchBackupArchive;

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4191';
let storage;
let server;
let serverErrors = '';
let cookie = '';
let csrf = '';
let adminCookie = '';
let adminCsrf = '';
let projectId = '';

async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf && !['GET', 'HEAD'].includes(options.method || 'GET') ? { 'X-Logbuch-CSRF': csrf } : {}), ...options.headers };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-test-'));
  server = spawn('php', ['-S', '127.0.0.1:4191', '-t', 'public', 'public/router.php'], {
    cwd: root,
    env: { ...process.env, LOGBUCH_STORAGE_PATH: storage, LOGBUCH_PLATFORM: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/install/status`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('PHP-Testserver ist nicht gestartet.');
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive: true, force: true });
});

test('Installer prüft die Umgebung und legt genau einen Admin an', async () => {
  const status = await request('/api/install/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.data.ready, true);
  assert.equal(status.data.installed, false);

  const installed = await request('/api/install', { method: 'POST', body: JSON.stringify({ siteName: 'Logbuch Test', timezone: 'Europe/Berlin', adminUser: 'admin', adminPassword: 'ein-langes-Testpasswort', demoData: false }) });
  assert.equal(installed.response.status, 201, `${JSON.stringify(installed.data)}\n${serverErrors.slice(-4000)}`);
  const repeated = await request('/api/install', { method: 'POST', body: JSON.stringify({ siteName: 'Zweites Logbuch', timezone: 'UTC', adminUser: 'other', adminPassword: 'ein-anderes-Testpasswort' }) });
  assert.equal(repeated.response.status, 409);
});

test('Anmeldung setzt eine sichere Sitzung und liefert CSRF-Schutz', async () => {
  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ user: 'admin', password: 'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.admin, true);
  assert.match(login.data.csrfToken, /^[a-f0-9]{64}$/);
  const setCookie = login.response.headers.get('set-cookie');
  assert.match(setCookie, /logbuch_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  cookie = setCookie.split(';', 1)[0];
  csrf = login.data.csrfToken;
  adminCookie = cookie;
  adminCsrf = csrf;
});

test('Systemstatus bleibt bei einem unlesbaren Laufzeitverzeichnis verfügbar', async () => {
  const inaccessible = join(storage, 'runtime-unlesbar');
  await mkdir(inaccessible);
  await chmod(inaccessible, 0o000);
  try {
    const status = await request('/api/system');
    assert.equal(status.response.status, 200, `${JSON.stringify(status.data)}\n${serverErrors.slice(-4000)}`);
    assert.equal(status.data.version, (await readFile(join(root, 'VERSION'), 'utf8')).trim());
  } finally {
    await chmod(inaccessible, 0o700);
    await rm(inaccessible, { recursive: true, force: true });
  }
});

test('Schreibzugriffe werden ohne korrektes CSRF-Token abgewiesen', async () => {
  const invalid = await request('/api/projects', { method: 'POST', headers: { 'X-Logbuch-CSRF': 'falsch' }, body: JSON.stringify({ title: 'Nicht speichern', createdAt: '2026-08-19' }) });
  assert.equal(invalid.response.status, 403);
});

test('Beispieldaten lassen sich unabhängig von eigenen Projekten verwalten', async () => {
  const existingTag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'Elektronik' }) });
  assert.equal(existingTag.response.status, 201);

  const ownProject = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Mein eigenes Netzteil', createdAt: '2026-08-20', tagIds: [existingTag.data.id] }) });
  assert.equal(ownProject.response.status, 201);

  const installed = await request('/api/demo', { method: 'POST' });
  assert.equal(installed.response.status, 200);
  assert.equal(installed.data.installed, 11);
  assert.equal(installed.data.folders, 2);

  const list = await request('/api/projects');
  const demoProjects = list.data.projects.filter(project => project.id.startsWith('demo-'));
  assert.equal(demoProjects.length, 11);
  assert.deepEqual(Object.fromEntries(['idea', 'active', 'paused', 'completed', 'archived', 'trashed'].map(status => [status, demoProjects.filter(project => project.status === status).length])), { idea: 0, active: 4, paused: 2, completed: 3, archived: 1, trashed: 1 });
  const regularDemoProjects = demoProjects.filter(project => ['idea', 'active', 'paused', 'completed'].includes(project.status));
  assert.equal(regularDemoProjects.filter(project => project.folderId === null).length, 4);
  assert.equal(regularDemoProjects.filter(project => project.folderId === 'demo-folder-elektronik').length, 3);
  assert.equal(regularDemoProjects.filter(project => project.folderId === 'demo-folder-werkstatt').length, 2);

  const demoProject = await request('/api/projects/demo-loetstation-absaugung');
  assert.equal(demoProject.response.status, 200);
  assert.ok(demoProject.data.tasks.length >= 2);
  assert.ok(demoProject.data.materials.length >= 1);
  assert.ok(demoProject.data.tagIds.includes(existingTag.data.id));
  assert.equal(demoProject.data.folderId, 'demo-folder-elektronik');

  const demoFolders = await request('/api/folders');
  assert.equal(demoFolders.data.folders.filter(folder => folder.id.startsWith('demo-folder-')).length, 2);
  assert.deepEqual(demoFolders.data.folders.filter(folder => folder.id.startsWith('demo-folder-')).map(folder => folder.name).sort(), ['Elektronik', 'Holzwerken']);

  const ownChildFolder = await request('/api/folders', { method: 'POST', body: JSON.stringify({ name: 'Mein Unterordner', description: 'Soll erhalten bleiben.', parentId: 'demo-folder-elektronik' }) });
  assert.equal(ownChildFolder.response.status, 201);
  const ownProjectInDemoFolder = await request(`/api/projects/${ownProject.data.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: 'demo-folder-elektronik' }) });
  assert.equal(ownProjectInDemoFolder.data.folderId, 'demo-folder-elektronik');

  const extraNote = await request('/api/projects/demo-loetstation-absaugung/notes', { method: 'POST', body: JSON.stringify({ title: 'Eigene Ergänzung', description: 'Soll mit dem Demo-Projekt verschwinden.' }) });
  assert.equal(extraNote.response.status, 201);

  const removed = await request('/api/demo', { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.removed, 11);
  assert.equal(removed.data.foldersRemoved, 1);
  assert.equal(removed.data.foldersRetained, 1);
  assert.equal((await request('/api/projects/demo-loetstation-absaugung')).response.status, 404);
  assert.equal((await request(`/api/projects/${ownProject.data.id}`)).data.folderId, 'demo-folder-elektronik');
  const foldersAfterRemoval = (await request('/api/folders')).data.folders;
  assert.equal(foldersAfterRemoval.find(folder => folder.id === ownChildFolder.data.id)?.parentId, 'demo-folder-elektronik');
  assert.ok(foldersAfterRemoval.some(folder => folder.id === 'demo-folder-elektronik'));
  assert.ok(!foldersAfterRemoval.some(folder => folder.id === 'demo-folder-werkstatt'));
  assert.ok((await request('/api/project-browser')).data.tags.some(tag => tag.id === existingTag.data.id));
  assert.equal((await request('/api/system')).data.demoProjectCount, 0);
  assert.equal((await request('/api/system')).data.demoFolderCount, 1);

  await request(`/api/projects/${ownProject.data.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: null }) });
  assert.equal((await request(`/api/folders/${ownChildFolder.data.id}`, { method: 'DELETE' })).response.status, 204);
  const removedEmptyFolder = await request('/api/demo', { method: 'DELETE' });
  assert.equal(removedEmptyFolder.data.foldersRemoved, 1);
  assert.equal(removedEmptyFolder.data.foldersRetained, 0);
  assert.equal((await request('/api/system')).data.demoFolderCount, 0);
});

test('Übersichtsbereiche werden in Zeilen konfiguriert', async () => {
  const invalid = await request('/api/account/preferences', { method: 'PATCH', body: JSON.stringify({ overviewNextRows: 7 }) });
  assert.equal(invalid.response.status, 422);
  const invalidOrder = await request('/api/account/preferences', { method: 'PATCH', body: JSON.stringify({ overviewOrder: ['summary', 'summary'] }) });
  assert.equal(invalidOrder.response.status, 422);
  const invalidSort = await request('/api/account/preferences', { method: 'PATCH', body: JSON.stringify({ projectSort: 'zufall:asc' }) });
  assert.equal(invalidSort.response.status, 422);

  const overviewOrder = ['recentlyEdited', 'marked', 'dueSoon', 'highPriority', 'summary', 'next', 'recent', 'activity', 'timeline'];
  const updated = await request('/api/account/preferences', { method: 'PATCH', body: JSON.stringify({ projectSort:'dueDate:asc', archiveSort:'title:asc', defaultProjectIcon:'rocket', showProjectFolders:false, showOverviewNext: true, showOverviewRecentlyEdited: true, showOverviewMarked: true, showOverviewDueSoon: true, showOverviewHighPriority: true, overviewRecentRows: 3, overviewNextRows: 2, overviewRecentlyEditedRows: 1, overviewMarkedRows: 1, overviewDueSoonRows: 2, overviewHighPriorityRows: 1, overviewOrder }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.showOverviewNext, true);
  assert.equal(updated.data.overviewRecentRows, 3);
  assert.equal(updated.data.overviewNextRows, 2);
  assert.equal(updated.data.overviewRecentlyEditedRows, 1);
  assert.equal(updated.data.overviewMarkedRows, 1);
  assert.equal(updated.data.overviewDueSoonRows, 2);
  assert.equal(updated.data.overviewHighPriorityRows, 1);
  assert.equal(updated.data.projectSort, 'dueDate:asc');
  assert.equal(updated.data.archiveSort, 'title:asc');
  assert.equal(updated.data.defaultProjectIcon, 'rocket');
  assert.equal(updated.data.showProjectFolders, false);
  assert.deepEqual(updated.data.overviewOrder, overviewOrder);
});

test('Persönliche To-dos bleiben einfach, sortierbar und vom Projektlog getrennt', async () => {
  assert.equal((await request('/api/todos')).data.openCount, 0);
  assert.equal((await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'   ' }) })).response.status, 422);
  assert.equal((await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'x'.repeat(201) }) })).response.status, 422);

  const first = await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'Paket zur Post bringen' }) });
  const second = await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'Versicherung anrufen' }) });
  const third = await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'Batterien kaufen' }) });
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(third.response.status, 201);
  assert.equal((await request('/api/todos')).data.openCount, 3);

  const order = [third.data.id, first.data.id, second.data.id];
  assert.equal((await request('/api/todos/reorder', { method:'POST', body:JSON.stringify({ ids:order }) })).response.status, 200);
  assert.deepEqual((await request('/api/todos')).data.todos.filter(todo => !todo.completedAt).map(todo => todo.id), order);
  assert.equal((await request('/api/todos/reorder', { method:'POST', body:JSON.stringify({ ids:[first.data.id] }) })).response.status, 422);

  const edited = await request(`/api/todos/${second.data.id}`, { method:'PATCH', body:JSON.stringify({ title:'Versicherung zurückrufen' }) });
  assert.equal(edited.data.title, 'Versicherung zurückrufen');
  const completed = await request(`/api/todos/${third.data.id}`, { method:'PATCH', body:JSON.stringify({ completed:true }) });
  assert.match(completed.data.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  const listed = await request('/api/todos');
  assert.equal(listed.data.openCount, 2);
  assert.equal(listed.data.todos.at(-1).id, third.data.id);

  assert.equal((await request(`/api/todos/${first.data.id}`, { method:'DELETE' })).response.status, 204);
  assert.equal((await request('/api/todos')).data.todos.length, 2);
});

test('Ein Projekt benötigt Titel und Startdatum', async () => {
  const missingTitle = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: '', createdAt: '' }) });
  assert.equal(missingTitle.response.status, 422);

  const missingDate = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'X', createdAt: '' }) });
  assert.equal(missingDate.response.status, 422);

  const minimal = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'X', createdAt: '2026-08-19' }) });
  assert.equal(minimal.response.status, 201);
  assert.equal(minimal.data.title, 'X');
  assert.equal(minimal.data.createdAt, '2026-08-19');
  assert.equal(minimal.data.priority, 'Mittel');
  assert.equal(minimal.data.flagged, false);
  assert.equal(minimal.data.icon, 'box');
  assert.equal(minimal.data.iconInherited, true);
  assert.equal(minimal.data.dueDate, '');
  assert.equal(minimal.data.status, 'active');

  const idea = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Neue Projektidee', status: 'idea', createdAt: '2026-08-19' }) });
  assert.equal(idea.response.status, 201);
  assert.equal(idea.data.status, 'idea');
  assert.ok(!(await request('/api/overview')).data.projects.some(project => project.id === idea.data.id));

  const invalidStatus = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Ungültiger Status', status: 'vielleicht', createdAt: '2026-08-19' }) });
  assert.equal(invalidStatus.response.status, 422);

  const invalidPriority = await request(`/api/projects/${minimal.data.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'Dringend' }) });
  assert.equal(invalidPriority.response.status, 422);
  const invalidFlag = await request(`/api/projects/${minimal.data.id}`, { method: 'PATCH', body: JSON.stringify({ flagged: 'ja' }) });
  assert.equal(invalidFlag.response.status, 422);
  const invalidIcon = await request(`/api/projects/${minimal.data.id}`, { method: 'PATCH', body: JSON.stringify({ icon: '<svg>' }) });
  assert.equal(invalidIcon.response.status, 422);
  const invalidDueDate = await request(`/api/projects/${minimal.data.id}`, { method: 'PATCH', body: JSON.stringify({ dueDate: '2026-02-30' }) });
  assert.equal(invalidDueDate.response.status, 422);
});

test('Projekt, Aufgabe und Log werden per API und als offene Dateien gespeichert', async () => {
  const project = await request('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Werkbank', description: 'Testprojekt', priority: 'Hoch', flagged: true, icon: 'hammer', createdAt: '2026-08-19', dueDate: '2026-09-30' }) });
  assert.equal(project.response.status, 201);
  assert.equal(project.data.priority, 'Hoch');
  assert.equal(project.data.flagged, true);
  assert.equal(project.data.icon, 'hammer');
  assert.equal(project.data.iconInherited, false);
  assert.equal(project.data.dueDate, '2026-09-30');
  projectId = project.data.id;

  const task = await request(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify({ title: 'Beine montieren', description: 'Mit M8 verschrauben', flagged: true }) });
  assert.equal(task.response.status, 201);
  assert.match(task.data.id, /^task-/);
  assert.equal(task.data.flagged, true);

  const protectedFields = await request(`/api/projects/${projectId}/materials`, { method: 'POST', body: JSON.stringify({ id:task.data.id, name:'Schrauben', author:'gefälscht', createdAt:'2000-01-01', unexpected:'nicht speichern' }) });
  assert.equal(protectedFields.response.status, 201);
  assert.match(protectedFields.data.id, /^material-/);
  assert.notEqual(protectedFields.data.id, task.data.id);
  assert.equal(protectedFields.data.author, 'admin');
  assert.notEqual(protectedFields.data.createdAt, '2000-01-01');
  assert.equal('unexpected' in protectedFields.data, false);

  const updatedTask = await request(`/api/projects/${projectId}/tasks/${task.data.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'In Arbeit', priority: 'Niedrig', dueDate: '', flagged: false }) });
  assert.equal(updatedTask.response.status, 200);
  assert.equal(updatedTask.data.status, 'In Arbeit');
  assert.equal(updatedTask.data.priority, 'Niedrig');
  assert.equal(updatedTask.data.dueDate, '');
  assert.equal(updatedTask.data.flagged, false);
  const invalidTaskFlag = await request(`/api/projects/${projectId}/tasks/${task.data.id}`, { method: 'PATCH', body: JSON.stringify({ flagged: 'ja' }) });
  assert.equal(invalidTaskFlag.response.status, 422);
  const invalidTaskPriority = await request(`/api/projects/${projectId}/tasks/${task.data.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'Sofort' }) });
  assert.equal(invalidTaskPriority.response.status, 422);

  const completed = await request(`/api/projects/${projectId}/tasks/${task.data.id}/complete`, { method: 'POST', body: JSON.stringify({ date: '2026-08-18' }) });
  assert.equal(completed.response.status, 201);
  assert.match(completed.data.id, /^entry-/);

  const learning = await request(`/api/projects/${projectId}/learnings`, { method: 'POST', body: JSON.stringify({ title: 'Vorbohren verhindert Ausrisse', description: 'Bei Hartholz zuerst mit kleinerem Durchmesser vorbohren.', futureUse: 'Bohrschablone und passenden Vorbohrer bereitlegen.' }) });
  assert.equal(learning.response.status, 201);
  assert.match(learning.data.id, /^learning-/);
  assert.equal(learning.data.futureUse, 'Bohrschablone und passenden Vorbohrer bereitlegen.');

  const note = await request(`/api/projects/${projectId}/notes`, { method: 'POST', body: JSON.stringify({ title: 'Maße der Werkbank', description: 'Die freie Breite zwischen den Beinen beträgt 820 mm.' }) });
  assert.equal(note.response.status, 201);
  assert.match(note.data.id, /^note-/);

  const detail = await request(`/api/projects/${projectId}`);
  assert.equal(detail.data.tasks.length, 1);
  assert.equal(detail.data.tasks[0].status, 'Erledigt');
  assert.equal(detail.data.entries.length, 1);
  assert.equal(detail.data.learnings.length, 1);
  assert.equal(detail.data.notes.length, 1);
  assert.equal(detail.data.createdAt, '2026-08-18');

  const overview = await request('/api/overview');
  assert.equal(overview.response.status, 200);
  const overviewProject = overview.data.projects.find(item => item.id === projectId);
  assert.equal(overviewProject.entries.length, 1);
  assert.equal(overviewProject.tasks.length, 1);
  assert.equal(overviewProject.latestEntryId, completed.data.id);
  assert.match(overviewProject.lastActivityAt, /^\d{4}-\d{2}-\d{2}T/);

  const upcoming = await request(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify({ title: 'Oberfläche ölen', description: 'Nach dem Feinschliff dünn auftragen.' }) });
  assert.equal(upcoming.response.status, 201);

  const browserData = await request('/api/project-browser');
  assert.equal(browserData.response.status, 200);
  const browserProject = browserData.data.projects.find(item => item.id === projectId);
  assert.equal(browserProject?.nextTaskTitle, 'Oberfläche ölen');
  assert.deepEqual(browserProject?.nextTaskTitles, ['Oberfläche ölen']);
  assert.equal(browserProject?.dueDate, '2026-09-30');
  assert.ok(Array.isArray(browserData.data.tags));
  assert.ok(Array.isArray(browserData.data.folders));

  const projectView = await request(`/api/project-view/${projectId}`);
  assert.equal(projectView.response.status, 200);
  assert.equal(projectView.data.project.id, projectId);
  assert.equal(projectView.data.project.entries.length, 1);
  assert.ok(Array.isArray(projectView.data.tags));

  const markdown = await readFile(join(storage, 'projects', projectId, 'entries', `${completed.data.id}.md`), 'utf8');
  assert.match(markdown, /Beine montieren/);
  const learningMarkdown = await readFile(join(storage, 'projects', projectId, 'learnings', `${learning.data.id}.md`), 'utf8');
  assert.match(learningMarkdown, /Vorbohren verhindert Ausrisse/);
  const noteMarkdown = await readFile(join(storage, 'projects', projectId, 'notes', `${note.data.id}.md`), 'utf8');
  assert.match(noteMarkdown, /Maße der Werkbank/);
  const projectMarkdown = await readFile(join(storage, 'projects', projectId, 'README.md'), 'utf8');
  assert.match(projectMarkdown, /priority: "Hoch"/);
  assert.match(projectMarkdown, /flagged: true/);
  assert.match(projectMarkdown, /icon: "hammer"/);
  assert.match(projectMarkdown, /dueDate: "2026-09-30"/);
});

test('Globale Suche findet Projektinhalte und unterstützt Filter sowie Sortierung', async () => {
  const learning = await request('/api/search?q=Vorbohren');
  assert.equal(learning.response.status, 200);
  assert.ok(learning.data.results.some(result => result.type === 'learnings' && result.projectId === projectId && result.title === 'Vorbohren verhindert Ausrisse'));

  const notes = await request('/api/search?q=Breite&type=notes&status=active');
  assert.equal(notes.response.status, 200);
  assert.equal(notes.data.results.length, 1);
  assert.equal(notes.data.results[0].type, 'notes');
  assert.equal(notes.data.results[0].title, 'Maße der Werkbank');

  const wrongStatus = await request('/api/search?q=Breite&type=notes&status=paused');
  assert.equal(wrongStatus.data.total, 0);
  const sorted = await request('/api/search?q=Werkbank&sort=title');
  assert.deepEqual(sorted.data.results.map(result => result.title), [...sorted.data.results.map(result => result.title)].sort((left, right) => left.localeCompare(right, 'de', { sensitivity:'base' })));
  assert.equal((await request('/api/search?q=x')).response.status, 422);
  assert.equal((await request('/api/search?q=Werkbank&type=unbekannt')).response.status, 422);
});

test('Projektordner können verschachtelt und nur leer gelöscht werden', async () => {
  const folderTag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'Ordnerstruktur' }) });
  assert.equal(folderTag.response.status, 201);
  const parent = await request('/api/folders', { method: 'POST', body: JSON.stringify({ name: 'Werkstatt', description: 'Alle Werkstattprojekte', priority: 'Hoch', flagged: true, icon: 'warehouse', tagIds: [folderTag.data.id] }) });
  assert.equal(parent.response.status, 201);
  assert.equal(parent.data.parentId, null);
  assert.equal(parent.data.priority, 'Hoch');
  assert.equal(parent.data.flagged, true);
  assert.equal(parent.data.icon, 'warehouse');
  assert.deepEqual(parent.data.tagIds, [folderTag.data.id]);

  const updatedParent = await request(`/api/folders/${parent.data.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'Gering', flagged: false }) });
  assert.equal(updatedParent.data.priority, 'Gering');
  assert.equal(updatedParent.data.flagged, false);
  assert.equal((await request(`/api/folders/${parent.data.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'Dringend' }) })).response.status, 422);
  assert.equal((await request(`/api/folders/${parent.data.id}`, { method: 'PATCH', body: JSON.stringify({ icon: '" onclick="alert(1)' }) })).response.status, 422);

  const child = await request('/api/folders', { method: 'POST', body: JSON.stringify({ name: 'Elektronik', description: 'Elektronische Projekte', parentId: parent.data.id }) });
  assert.equal(child.response.status, 201);
  assert.equal(child.data.parentId, parent.data.id);
  const folderBrowser = await request('/api/project-browser');
  assert.equal(folderBrowser.data.folders.find(folder => folder.id === parent.data.id)?.tagIds[0], folderTag.data.id);
  assert.equal(folderBrowser.data.tags.find(tag => tag.id === folderTag.data.id)?.folderCount, 1);

  const assigned = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ folderId: child.data.id }) });
  assert.equal(assigned.data.folderId, child.data.id);
  assert.equal((await request(`/api/folders/${child.data.id}`, { method: 'DELETE' })).response.status, 409);
  assert.equal((await request(`/api/folders/${parent.data.id}`, { method: 'DELETE' })).response.status, 409);

  const idea = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'idea' }) });
  assert.equal(idea.data.folderId, child.data.id);
  assert.equal('completedAt' in idea.data, false);
  assert.ok(!(await request('/api/overview')).data.projects.some(project => project.id === projectId));

  const paused = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
  assert.equal(paused.data.folderId, child.data.id);
  assert.equal('completedAt' in paused.data, false);
  assert.ok(!(await request('/api/overview')).data.projects.some(project => project.id === projectId));

  const completedProject = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
  assert.equal(completedProject.data.folderId, child.data.id);
  assert.match(completedProject.data.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  const completedOverview = await request('/api/overview');
  assert.ok(completedOverview.data.completedProjects.some(project => project.id === projectId && project.completedAt === completedProject.data.completedAt));

  const archived = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
  assert.equal(archived.data.folderId, null);
  assert.ok(!(await request('/api/overview')).data.completedProjects.some(project => project.id === projectId));
  assert.equal((await request(`/api/folders/${child.data.id}`, { method: 'DELETE' })).response.status, 204);
  assert.equal((await request(`/api/folders/${parent.data.id}`, { method: 'DELETE' })).response.status, 204);
  const restored = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  assert.equal('completedAt' in restored.data, false);
});

test('Gelöschte Projekte landen mit Löschzeitpunkt im Papierkorb', async () => {
  const removed = await request(`/api/projects/${projectId}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.status, 'trashed');
  assert.equal(Number.isInteger(removed.data.deletedAt), true);

  const restored = await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  assert.equal(restored.data.status, 'active');
  assert.equal('deletedAt' in restored.data, false);
});

test('Projektdateien werden im Projektordner gespeichert, zugeordnet und verwaltet', async () => {
  const detail = await request(`/api/projects/${projectId}`);
  const note = detail.data.notes[0];
  const payload = new FormData();
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  payload.append('file', new Blob([imageBytes], { type:'image/png' }), 'werkbank-plan.png');
  payload.append('displayName', 'Werkbankplan');
  payload.append('description', 'Skizze mit den finalen Abmessungen');
  payload.append('associationCollection', 'notes');
  payload.append('associationItemId', note.id);
  const uploadResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:payload });
  const uploadText = await uploadResponse.text();
  let uploaded;
  try { uploaded = JSON.parse(uploadText); } catch { assert.fail(`${uploadText}\n${serverErrors.slice(-4000)}`); }
  assert.equal(uploadResponse.status, 201, `${JSON.stringify(uploaded)}\n${serverErrors.slice(-4000)}`);
  assert.equal(uploaded.displayName, 'Werkbankplan');
  assert.deepEqual(uploaded.association, { collection:'notes', itemId:note.id });
  assert.match(uploaded.sha256, /^[a-f0-9]{64}$/);

  const stored = await readFile(join(storage, 'projects', projectId, 'attachments', uploaded.id, 'original.bin'));
  assert.deepEqual(stored, imageBytes);
  const withFiles = await request(`/api/project-view/${projectId}`);
  assert.equal(withFiles.data.project.files.length, 1);

  const content = await fetch(`${baseUrl}/api/projects/${projectId}/files/${uploaded.id}/content`, { headers:{ Cookie:cookie } });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), stored);
  const thumbnail = await fetch(`${baseUrl}/api/projects/${projectId}/files/${uploaded.id}/thumbnail`, { headers:{ Cookie:cookie } });
  assert.equal(thumbnail.status, 200);
  assert.equal(thumbnail.headers.get('content-type'), 'image/jpeg');
  assert.ok((await thumbnail.arrayBuffer()).byteLength > 0);
  const storageStatus = await request('/api/storage');
  assert.equal(storageStatus.response.status, 200);
  assert.ok(storageStatus.data.attachmentCount >= 1);
  assert.ok(storageStatus.data.attachmentBytes >= imageBytes.length);

  const rotated = await request(`/api/projects/${projectId}/files/${uploaded.id}/rotate`, { method:'POST', body:JSON.stringify({ degrees:90 }) });
  assert.equal(rotated.response.status, 200);
  assert.equal(rotated.data.rotation, 90);
  const renamed = await request(`/api/projects/${projectId}/files/${uploaded.id}`, { method:'PATCH', body:JSON.stringify({ displayName:'Werkbankplan v2', description:'Aktualisierte Beschreibung' }) });
  assert.equal(renamed.data.displayName, 'Werkbankplan v2');

  const search = await request('/api/search?q=Werkbankplan&type=files');
  assert.equal(search.response.status, 200);
  assert.equal(search.data.results[0]?.id, uploaded.id);

  const removedNote = await request(`/api/projects/${projectId}/notes/${note.id}`, { method:'DELETE' });
  assert.equal(removedNote.response.status, 204);
  const withoutAssociatedFile = await request(`/api/projects/${projectId}`);
  assert.equal(withoutAssociatedFile.data.files.length, 0);
  await assert.rejects(readFile(join(storage, 'projects', projectId, 'attachments', uploaded.id, 'original.bin')));

  const standalonePayload = new FormData();
  standalonePayload.append('file', new Blob([imageBytes], { type:'image/png' }), 'manuell-loeschen.png');
  const standaloneResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:standalonePayload });
  const standalone = await standaloneResponse.json();
  assert.equal(standaloneResponse.status, 201, JSON.stringify(standalone));
  const deleted = await request(`/api/projects/${projectId}/files/${standalone.id}`, { method:'DELETE' });
  assert.equal(deleted.response.status, 204);
  assert.equal((await request(`/api/projects/${projectId}`)).data.files.length, 0);
});

test('Projektbackup stellt Bilddatei und Metadaten bytegenau wieder her', async () => {
  const importedProjectId = 'project-backup-roundtrip';
  const noteId = 'note-backup-roundtrip';
  const fileId = 'file-backup-roundtrip';
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const metadata = {
    id:fileId,
    originalName:'backup-bild.png',
    displayName:'Backup-Bild',
    description:'Beschreibung aus dem ursprünglichen Projekt',
    mimeType:'image/png',
    size:imageBytes.length,
    sha256:createHash('sha256').update(imageBytes).digest('hex'),
    rotation:270,
    association:{ collection:'notes', itemId:noteId },
    uploadedAt:'2025-04-03T12:13:14Z',
    uploadedBy:'ursprungsnutzer',
    updatedAt:'2025-04-04T15:16:17Z',
  };
  const project = {
    id:importedProjectId, title:'Backup Roundtrip', description:'Vollständiger Wiederherstellungstest', status:'idea', priority:'Hoch', flagged:true, icon:'camera', iconInherited:false, createdAt:'2025-04-01', dueDate:'2025-12-31', tagIds:[], folderId:null,
    entries:[], tasks:[], materials:[], contacts:[], links:[], ideas:[], learnings:[], notes:[{ id:noteId, title:'Bildnotiz', description:'Mit Zuordnung', author:'ursprungsnutzer', createdAt:'2025-04-02T10:00:00Z' }], files:[metadata],
  };
  const archive = await backupArchives.create([
    ['manifest.json', JSON.stringify({ format:'logbuch-projects', version:1, exportedAt:'2026-08-23T20:00:00Z', tags:[], folders:[], serverSettings:null, projects:[project] })],
    [`projects/${importedProjectId}/attachments/${fileId}/metadata.json`, JSON.stringify(metadata)],
    [`projects/${importedProjectId}/attachments/${fileId}/original.bin`, imageBytes],
  ]);
  const archiveFiles = backupArchives.parse(await archive.arrayBuffer());
  const restoredManifest = JSON.parse(new TextDecoder().decode(archiveFiles.get('manifest.json')));
  const restoredMetadata = JSON.parse(new TextDecoder().decode(archiveFiles.get(`projects/${importedProjectId}/attachments/${fileId}/metadata.json`)));
  const importedProject = await request('/api/import/project', { method:'POST', body:JSON.stringify({ project:restoredManifest.projects[0], tags:[], replace:false }) });
  assert.equal(importedProject.response.status, 201);

  const upload = new FormData();
  upload.append('file', new Blob([archiveFiles.get(`projects/${importedProjectId}/attachments/${fileId}/original.bin`)], { type:metadata.mimeType }), metadata.originalName);
  upload.append('metadata', JSON.stringify(restoredMetadata));
  const response = await fetch(`${baseUrl}/api/import/projects/${importedProjectId}/files`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:upload });
  const responseText = await response.text();
  let restoredFile;
  try { restoredFile = JSON.parse(responseText); } catch { assert.fail(`${responseText}\n${serverErrors.slice(-4000)}`); }
  assert.equal(response.status, 201, JSON.stringify(restoredFile));
  assert.deepEqual(restoredFile, metadata);
  assert.deepEqual(await readFile(join(storage, 'projects', importedProjectId, 'attachments', fileId, 'original.bin')), imageBytes);
  const restoredProject = await request(`/api/projects/${importedProjectId}`);
  assert.equal(restoredProject.data.status, 'idea');
  assert.equal(restoredProject.data.notes[0].id, noteId);
  assert.deepEqual(restoredProject.data.files[0], metadata);

  const exportResponse = await fetch(`${baseUrl}/api/backup/projects/${importedProjectId}`, { headers:{ Cookie:cookie } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /application\/x-tar/);
  const exportedFiles = backupArchives.parse(await exportResponse.arrayBuffer());
  assert.deepEqual(Buffer.from(exportedFiles.get(`projects/${importedProjectId}/attachments/${fileId}/original.bin`)), imageBytes);
  assert.equal(exportedFiles.has(`projects/${importedProjectId}/attachments/${fileId}/thumbnail.jpg`), false);
});

test('Große Projektarchive werden serverseitig importiert', async () => {
  const importedProjectId = 'project-server-archive-import';
  const fileId = 'file-server-archive-import';
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const metadata = { id:fileId, originalName:'server-import.png', displayName:'Serverimport', description:'Ohne Browser-Entpacken', mimeType:'image/png', size:imageBytes.length, sha256:createHash('sha256').update(imageBytes).digest('hex'), rotation:0, association:null, uploadedAt:'2026-08-23T18:00:00Z', uploadedBy:'admin' };
  const project = { id:importedProjectId, title:'Serverarchiv', description:'Importtest', status:'active', priority:'Mittel', flagged:false, icon:'folder', iconInherited:false, createdAt:'2026-08-23', dueDate:'', tagIds:[], folderId:null, entries:[], tasks:[], materials:[], contacts:[], links:[], ideas:[], learnings:[], notes:[], files:[metadata] };
  const archive = await backupArchives.create([
    ['manifest.json', JSON.stringify({ format:'logbuch-projects', version:1, exportedAt:'2026-08-23T20:00:00Z', tags:[], folders:[], serverSettings:null, projects:[project] })],
    [`projects/${importedProjectId}/attachments/${fileId}/original.bin`, imageBytes],
  ]);
  const payload = new FormData();
  payload.append('archive', archive, 'server-import.tar');
  payload.append('conflict', 'skip');
  const response = await fetch(`${baseUrl}/api/import/projects-archive`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:payload });
  const result = await response.json();
  assert.equal(response.status, 200, `${JSON.stringify(result)}\n${serverErrors.slice(-4000)}`);
  assert.deepEqual(result, { imported:1, skipped:0, filesImported:1 });
  assert.deepEqual(await readFile(join(storage, 'projects', importedProjectId, 'attachments', fileId, 'original.bin')), imageBytes);
});

test('Logs erscheinen im administrativen Protokoll', async () => {
  const audit = await request('/api/audit');
  assert.equal(audit.response.status, 200);
  assert.ok(audit.data.events.some(event => event.action === 'log.created' && event.target.includes(projectId)));
});

test('Rollen und Positivlisten werden auch bei direktem API-Zugriff erzwungen', async () => {
  const privateTag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'Nur intern' }) });
  const privateFolder = await request('/api/folders', { method: 'POST', body: JSON.stringify({ name: 'Interner Ordner', description: 'Vertrauliche Struktur', tagIds:[privateTag.data.id] }) });
  await request(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ folderId:privateFolder.data.id, tagIds:[privateTag.data.id] }) });
  const created = await request('/api/users', { method: 'POST', body: JSON.stringify({ id: 'leser', role: 'viewer', password: 'langes-leser-passwort', mustChangePassword: false, projectAccessMode: 'include', projectIds: [] }) });
  assert.equal(created.response.status, 201);

  cookie = '';
  csrf = '';
  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ user: 'leser', password: 'langes-leser-passwort' }) });
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;

  const list = await request('/api/projects');
  assert.deepEqual(list.data.projects, []);
  const overview = await request('/api/overview');
  assert.deepEqual(overview.data.projects, []);
  const browserData = await request('/api/project-browser');
  assert.deepEqual(browserData.data.projects, []);
  assert.deepEqual(browserData.data.folders, []);
  assert.deepEqual(browserData.data.tags, []);
  const search = await request('/api/search?q=Werkbank');
  assert.equal(search.response.status, 200);
  assert.deepEqual(search.data.results, []);
  const direct = await request(`/api/projects/${projectId}`);
  assert.equal(direct.response.status, 403);
  assert.equal((await request(`/api/project-view/${projectId}`)).response.status, 403);
  const adminArea = await request('/api/users');
  assert.equal(adminArea.response.status, 403);
  const personalTodos = await request('/api/todos');
  assert.deepEqual(personalTodos.data.todos, []);
  const viewerTodo = await request('/api/todos', { method:'POST', body:JSON.stringify({ title:'Eigenes Leser-To-do' }) });
  assert.equal(viewerTodo.response.status, 201);
  assert.equal((await request('/api/todos')).data.openCount, 1);

  cookie = adminCookie;
  csrf = adminCsrf;
  assert.ok(!(await request('/api/todos')).data.todos.some(todo => todo.id === viewerTodo.data.id));
});

test('Backup-Metadaten stellen Ordnerhierarchie und Servereinstellungen transaktional wieder her', async () => {
  const tag = await request('/api/tags', { method:'POST', body:JSON.stringify({ name:'Backupstruktur' }) });
  assert.equal(tag.response.status, 201);
  const restored = await request('/api/import/backup-metadata', { method:'POST', body:JSON.stringify({
    tags:[{ id:tag.data.id, name:tag.data.name, createdAt:tag.data.createdAt }],
    folders:[
      { id:'backup-folder-child', parentId:'backup-folder-root', name:'Unterordner', description:'Zweite Ebene', priority:'Gering', flagged:false, icon:'folder', tagIds:[], createdAt:'2026-08-20T10:00:00Z' },
      { id:'backup-folder-root', parentId:null, name:'Backupordner', description:'Erste Ebene', priority:'Hoch', flagged:true, icon:'archive', tagIds:[tag.data.id], createdAt:'2026-08-20T09:00:00Z' },
    ],
    serverSettings:{ siteName:'Restauriertes Logbuch', baseUrl:'https://logbuch.example.test', timezone:'Europe/Berlin' },
    replace:true,
  }) });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.data.foldersImported, 2);
  assert.equal(restored.data.settingsRestored, true);
  const folders = (await request('/api/folders')).data.folders;
  assert.equal(folders.find(folder => folder.id === 'backup-folder-child')?.parentId, 'backup-folder-root');
  assert.deepEqual(folders.find(folder => folder.id === 'backup-folder-root')?.tagIds, [tag.data.id]);
  const settings = await request('/api/settings/server');
  assert.equal(settings.data.siteName, 'Restauriertes Logbuch');
  assert.equal(settings.data.baseUrl, 'https://logbuch.example.test');

  const cyclic = await request('/api/import/backup-metadata', { method:'POST', body:JSON.stringify({ folders:[
    { id:'backup-cycle-a', parentId:'backup-cycle-b', name:'Kreis A', priority:'Mittel', flagged:false, icon:'folder', tagIds:[] },
    { id:'backup-cycle-b', parentId:'backup-cycle-a', name:'Kreis B', priority:'Mittel', flagged:false, icon:'folder', tagIds:[] },
  ] }) });
  assert.equal(cyclic.response.status, 422);
  const afterFailure = (await request('/api/folders')).data.folders;
  assert.ok(!afterFailure.some(folder => folder.id.startsWith('backup-cycle-')));
});

test('Benutzerbackups erhalten validierte Präferenzen und bleiben ohne Präferenzen kompatibel', async () => {
  const backup = await request('/api/backup/users');
  assert.equal(backup.response.status, 200);
  const admin = backup.data.accounts.find(account => account.id === 'admin');
  assert.equal(admin.preferences.defaultProjectIcon, 'rocket');
  assert.equal(admin.preferences.showProjectFolders, false);
  assert.equal(admin.todos.length, 2);
  assert.ok(admin.todos.some(todo => todo.title === 'Versicherung zurückrufen'));

  const restored = await request('/api/import/users', { method:'POST', body:JSON.stringify({ accounts:[{ ...admin, preferences:{ startPage:'archive', showProjectFolders:true } }], replace:true }) });
  assert.equal(restored.response.status, 200);
  const users = (await request('/api/users')).data.users;
  const restoredAdmin = users.find(user => user.id === 'admin');
  assert.equal(restoredAdmin.startPage, 'archive');
  assert.equal(restoredAdmin.showProjectFolders, true);
  assert.equal(restoredAdmin.defaultProjectIcon, 'box');

  const invalid = await request('/api/import/users', { method:'POST', body:JSON.stringify({ accounts:[{ ...admin, preferences:{ showProjectFolders:'ja' } }], replace:true }) });
  assert.equal(invalid.response.status, 422);
  const legacy = { ...admin };
  delete legacy.preferences;
  delete legacy.todos;
  const compatible = await request('/api/import/users', { method:'POST', body:JSON.stringify({ accounts:[legacy], replace:true }) });
  assert.equal(compatible.response.status, 200);
  const legacyAdmin = (await request('/api/users')).data.users.find(user => user.id === 'admin');
  assert.equal(legacyAdmin.startPage, 'home');
  assert.equal((await request('/api/todos')).data.todos.length, 2);
});
