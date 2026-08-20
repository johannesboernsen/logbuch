import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4174;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

const waitForServer = child => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Testserver ist nicht gestartet')), 8000);
  child.once('error', reject);
  child.stdout.on('data', chunk => {
    if (!String(chunk).includes('Make:Log preview:')) return;
    clearTimeout(timeout);
    resolve();
  });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
});

async function api(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers:{ ...(cookie ? { Cookie:cookie } : {}), ...(body === undefined ? {} : { 'Content-Type':'application/json' }) },
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { status:response.status, data, cookie:response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function login(user, password) {
  const result = await api('/api/login', { method:'POST', body:{ user, password } });
  assert.equal(result.status, 200, `Anmeldung von ${user} fehlgeschlagen`);
  assert.match(result.cookie, /^makerlog_session=/);
  return result.cookie;
}

async function createUser(adminCookie, id, role, projectAccessMode, projectIds = []) {
  const result = await api('/api/users', { method:'POST', cookie:adminCookie, body:{ id, password:'Sicheres-Testpasswort-1', role, projectAccessMode, projectIds, mustChangePassword:false } });
  assert.equal(result.status, 201, `Benutzer ${id} konnte nicht angelegt werden`);
}

test.before(async () => {
  server = spawn(process.execPath, ['test/dev-server.mjs'], {
    cwd:new URL('..', import.meta.url).pathname,
    env:{ ...process.env, MAKERLOG_STRICT_AUTH:'1', MAKERLOG_PORT:String(port) },
    stdio:['ignore','pipe','pipe']
  });
  await waitForServer(server);
});

test.after(() => server?.kill('SIGTERM'));

test('Make:Log erzwingt Rollen, Projektfreigaben und Sitzungsstatus serverseitig', async t => {
  await t.test('nicht angemeldete Zugriffe werden abgewiesen', async () => {
    assert.equal((await api('/api/me')).status, 401);
    assert.equal((await api('/api/system')).status, 401);
    assert.equal((await api('/api/projects')).status, 401);
    assert.equal((await api('/api/projects/werkbank-7c31aa')).status, 401);
    assert.equal((await api('/api/tags')).status, 401);
  });

  const adminCookie = await login('admin', 'admin');
  const activeProject = 'werkbank-7c31aa';
  const archivedProject = 'project-1786995141059';
  const inaccessibleProject = 'project-1786996729146';
  assert.equal((await api(`/api/projects/${archivedProject}`, { method:'PATCH', cookie:adminCookie, body:{ status:'archived' } })).status, 200);

  await createUser(adminCookie, 'editor_include', 'editor', 'include', [activeProject, archivedProject]);
  await createUser(adminCookie, 'viewer_include', 'viewer', 'include', [activeProject]);
  await createUser(adminCookie, 'editor_exclude', 'editor', 'exclude', [archivedProject]);
  await createUser(adminCookie, 'editor_all', 'editor', 'all');
  await createUser(adminCookie, 'temp_disabled', 'editor', 'all');
  const forcedUser = await api('/api/users', { method:'POST', cookie:adminCookie, body:{ id:'forced_password', password:'Sicheres-Testpasswort-1', role:'editor', projectAccessMode:'all', projectIds:[], mustChangePassword:true } });
  assert.equal(forcedUser.status, 201);

  const includeCookie = await login('editor_include', 'Sicheres-Testpasswort-1');
  const viewerCookie = await login('viewer_include', 'Sicheres-Testpasswort-1');
  const excludeCookie = await login('editor_exclude', 'Sicheres-Testpasswort-1');
  const allCookie = await login('editor_all', 'Sicheres-Testpasswort-1');
  const disabledCookie = await login('temp_disabled', 'Sicheres-Testpasswort-1');

  await t.test('die persönliche Startseite wird am Benutzerkonto gespeichert', async () => {
    assert.equal((await api('/api/account/preferences', { method:'PATCH', cookie:adminCookie, body:{ startPage:'ungueltig' } })).status, 422);
    assert.equal((await api('/api/account/preferences', { method:'PATCH', cookie:adminCookie, body:{ overviewRecentRows:7 } })).status, 422);
    assert.equal((await api('/api/account/preferences', { method:'PATCH', cookie:adminCookie, body:{ overviewOrder:['summary','summary'] } })).status, 422);
    const overviewOrder = ['dueSoon','highPriority','recentlyEdited','summary','next','recent','activity','timeline'];
    const updated = await api('/api/account/preferences', { method:'PATCH', cookie:adminCookie, body:{ startPage:'projects', showOverviewSummary:false, showOverviewActivity:false, showOverviewNext:true, showOverviewRecentlyEdited:true, showOverviewDueSoon:true, showOverviewHighPriority:true, overviewRecentRows:3, overviewNextRows:2, overviewRecentlyEditedRows:1, overviewDueSoonRows:2, overviewHighPriorityRows:1, overviewOrder } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.startPage, 'projects');
    assert.equal(updated.data.showOverviewSummary, false);
    assert.equal(updated.data.overviewRecentRows, 3);
    assert.equal(updated.data.overviewNextRows, 2);
    assert.equal(updated.data.overviewRecentlyEditedRows, 1);
    assert.equal(updated.data.overviewDueSoonRows, 2);
    assert.equal(updated.data.overviewHighPriorityRows, 1);
    assert.deepEqual(updated.data.overviewOrder, overviewOrder);
    const me = await api('/api/me', { cookie:adminCookie });
    assert.equal(me.data.startPage, 'projects');
    assert.equal(me.data.showOverviewActivity, false);
    assert.equal(me.data.overviewRecentRows, 3);
    assert.equal(me.data.overviewNextRows, 2);
    assert.equal(me.data.showOverviewRecentlyEdited, true);
    assert.equal(me.data.showOverviewDueSoon, true);
    assert.equal(me.data.showOverviewHighPriority, true);
  });

  await t.test('ein verpflichtender Passwortwechsel sperrt alle anderen API-Funktionen', async () => {
    const forcedCookie = await login('forced_password', 'Sicheres-Testpasswort-1');
    assert.equal((await api('/api/me', { cookie:forcedCookie })).status, 200);
    assert.equal((await api('/api/projects', { cookie:forcedCookie })).status, 428);
    assert.equal((await api('/api/account/password', { method:'POST', cookie:forcedCookie, body:{ currentPassword:'Sicheres-Testpasswort-1', newPassword:'Neues-Testpasswort-2' } })).status, 204);
    assert.equal((await api('/api/projects', { cookie:forcedCookie })).status, 200);
  });

  await t.test('Positivliste enthält nur ausgewählte aktive und archivierte Projekte', async () => {
    const result = await api('/api/projects', { cookie:includeCookie });
    assert.equal(result.status, 200);
    assert.deepEqual(new Set(result.data.projects.map(project => project.id)), new Set([activeProject, archivedProject]));
    assert.equal(result.data.projects.find(project => project.id === archivedProject)?.status, 'archived');
    assert.equal((await api(`/api/projects/${inaccessibleProject}`, { cookie:includeCookie })).status, 403);
    assert.equal((await api(`/api/projects/${archivedProject}`, { cookie:includeCookie })).status, 200);
  });

  const future = await api('/api/projects', { method:'POST', cookie:adminCookie, body:{ title:'Zukünftiges Sicherheitsprojekt', description:'Test', createdAt:'2026-08-18' } });
  assert.equal(future.status, 201);

  await t.test('Vollzugriff und Negativliste berücksichtigen neue Projekte automatisch', async () => {
    const allProjects = await api('/api/projects', { cookie:allCookie });
    assert.equal(allProjects.status, 200);
    assert.ok(allProjects.data.projects.some(project => project.id === future.data.id));
    const excludedProjects = await api('/api/projects', { cookie:excludeCookie });
    assert.equal(excludedProjects.status, 200);
    assert.ok(excludedProjects.data.projects.some(project => project.id === future.data.id));
    assert.ok(!excludedProjects.data.projects.some(project => project.id === archivedProject));
    assert.equal((await api(`/api/projects/${archivedProject}`, { cookie:excludeCookie })).status, 403);
  });

  await t.test('Leser können freigegebene Inhalte lesen, aber niemals verändern', async () => {
    assert.equal((await api(`/api/projects/${activeProject}`, { cookie:viewerCookie })).status, 200);
    assert.equal((await api(`/api/projects/${activeProject}`, { method:'PATCH', cookie:viewerCookie, body:{ title:'Unerlaubt' } })).status, 403);
    assert.equal((await api(`/api/projects/${activeProject}/entries`, { method:'POST', cookie:viewerCookie, body:{ title:'Unerlaubt', date:'2026-08-18' } })).status, 403);
    assert.equal((await api('/api/projects', { method:'POST', cookie:viewerCookie, body:{ title:'Unerlaubt', createdAt:'2026-08-18' } })).status, 403);
  });

  await t.test('Bearbeiter können freigegebene Logs vollständig verwalten', async () => {
    const created = await api(`/api/projects/${activeProject}/entries`, { method:'POST', cookie:includeCookie, body:{ title:'Berechtigungstest', body:'Erstellt', nextStep:'Prüfen', date:'2026-08-18' } });
    assert.equal(created.status, 201);
    assert.equal(created.data.author, 'editor_include');
    assert.equal((await api(`/api/projects/${activeProject}/entries/${created.data.id}`, { method:'PATCH', cookie:includeCookie, body:{ title:'Berechtigungstest bearbeitet' } })).status, 200);
    assert.equal((await api(`/api/projects/${activeProject}/entries/${created.data.id}`, { method:'DELETE', cookie:includeCookie })).status, 204);
    const audit = await api('/api/audit', { cookie:adminCookie });
    assert.ok(audit.data.events.some(event => event.action === 'log.created' && event.actor === 'editor_include'));
    assert.ok(audit.data.events.some(event => event.action === 'log.deleted' && event.actor === 'editor_include'));
  });

  await t.test('Projektinhalte verwenden dieselben Lese- und Schreibgrenzen', async () => {
    for (const collection of ['tasks','materials','contacts','links','ideas','learnings','notes']) {
      assert.equal((await api(`/api/projects/${activeProject}/${collection}`, { method:'POST', cookie:viewerCookie, body:{ name:'Unerlaubt', title:'Unerlaubt' } })).status, 403);
      const created = await api(`/api/projects/${activeProject}/${collection}`, { method:'POST', cookie:includeCookie, body:{ name:`Test ${collection}`, title:`Test ${collection}` } });
      assert.equal(created.status, 201);
      assert.equal((await api(`/api/projects/${activeProject}/${collection}/${created.data.id}`, { method:'PATCH', cookie:includeCookie, body:{ notes:'Bearbeitet' } })).status, 200);
      assert.equal((await api(`/api/projects/${activeProject}/${collection}/${created.data.id}`, { method:'DELETE', cookie:includeCookie })).status, 204);
    }
  });

  await t.test('Projektinhalte und Logs lassen sich nur mit Bearbeitungsrechten dauerhaft sortieren', async () => {
    const firstTask = await api(`/api/projects/${activeProject}/tasks`, { method:'POST', cookie:includeCookie, body:{ title:'Erste Sortieraufgabe' } });
    const secondTask = await api(`/api/projects/${activeProject}/tasks`, { method:'POST', cookie:includeCookie, body:{ title:'Zweite Sortieraufgabe' } });
    assert.equal(firstTask.status, 201);
    assert.equal(secondTask.status, 201);
    const taskIds = [secondTask.data.id, firstTask.data.id];
    assert.equal((await api(`/api/projects/${activeProject}/tasks/reorder`, { method:'POST', cookie:viewerCookie, body:{ ids:taskIds } })).status, 403);
    assert.equal((await api(`/api/projects/${activeProject}/tasks/reorder`, { method:'POST', cookie:includeCookie, body:{ ids:taskIds } })).status, 200);
    const project = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
    assert.equal(project.data.tasks.find(task => task.id === secondTask.data.id)?.sortOrder, 0);
    assert.equal(project.data.tasks.find(task => task.id === firstTask.data.id)?.sortOrder, 1);
    assert.equal((await api(`/api/projects/${activeProject}/tasks/reorder`, { method:'POST', cookie:includeCookie, body:{ ids:[firstTask.data.id, firstTask.data.id] } })).status, 422);
    const firstLog = await api(`/api/projects/${activeProject}/entries`, { method:'POST', cookie:includeCookie, body:{ title:'Erster Sortierlog', date:'2026-08-17' } });
    const secondLog = await api(`/api/projects/${activeProject}/entries`, { method:'POST', cookie:includeCookie, body:{ title:'Zweiter Sortierlog', date:'2026-08-18' } });
    const logIds = [firstLog.data.id, secondLog.data.id];
    assert.equal((await api(`/api/projects/${activeProject}/entries/reorder`, { method:'POST', cookie:includeCookie, body:{ ids:logIds } })).status, 200);
    const reorderedProject = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
    assert.equal(reorderedProject.data.entries.find(entry => entry.id === firstLog.data.id)?.sortOrder, 0);
    assert.equal(reorderedProject.data.entries.find(entry => entry.id === secondLog.data.id)?.sortOrder, 1);
    for (const collection of ['materials','contacts','links','ideas','learnings','notes']) {
      const key = ['materials','contacts'].includes(collection) ? 'name' : 'title';
      const first = await api(`/api/projects/${activeProject}/${collection}`, { method:'POST', cookie:includeCookie, body:{ [key]:`Erster Sortiereintrag ${collection}` } });
      const second = await api(`/api/projects/${activeProject}/${collection}`, { method:'POST', cookie:includeCookie, body:{ [key]:`Zweiter Sortiereintrag ${collection}` } });
      const ids = [second.data.id, first.data.id];
      assert.equal((await api(`/api/projects/${activeProject}/${collection}/reorder`, { method:'POST', cookie:viewerCookie, body:{ ids } })).status, 403);
      assert.equal((await api(`/api/projects/${activeProject}/${collection}/reorder`, { method:'POST', cookie:includeCookie, body:{ ids } })).status, 200);
      const reordered = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
      assert.equal(reordered.data[collection].find(item => item.id === second.data.id)?.sortOrder, 0);
      assert.equal(reordered.data[collection].find(item => item.id === first.data.id)?.sortOrder, 1);
    }
  });

  await t.test('Gelöschte Projekte landen im Papierkorb und werden erst dort endgültig entfernt', async () => {
    const created = await api('/api/projects', { method:'POST', cookie:includeCookie, body:{ title:'Papierkorb-Testprojekt', description:'Wird wiederhergestellt.', createdAt:'2026-08-19', tagIds:[] } });
    assert.equal(created.status, 201);
    const trashed = await api(`/api/projects/${created.data.id}`, { method:'DELETE', cookie:includeCookie });
    assert.equal(trashed.status, 200);
    assert.equal(trashed.data.status, 'trashed');
    assert.ok(Number(trashed.data.deletedAt) > 0);
    const listed = await api('/api/projects', { cookie:includeCookie });
    assert.equal(listed.data.projects.find(project => project.id === created.data.id)?.status, 'trashed');
    const restored = await api(`/api/projects/${created.data.id}`, { method:'PATCH', cookie:includeCookie, body:{ status:'active' } });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.status, 'active');
    assert.equal(restored.data.deletedAt, undefined);
    assert.equal((await api(`/api/projects/${created.data.id}/permanent`, { method:'DELETE', cookie:includeCookie })).status, 409);
    await api(`/api/projects/${created.data.id}`, { method:'DELETE', cookie:includeCookie });
    assert.equal((await api(`/api/projects/${created.data.id}/permanent`, { method:'DELETE', cookie:includeCookie })).status, 204);
    const emptyCandidate = await api('/api/projects', { method:'POST', cookie:includeCookie, body:{ title:'Papierkorb leeren', createdAt:'2026-08-19', tagIds:[] } });
    await api(`/api/projects/${emptyCandidate.data.id}`, { method:'DELETE', cookie:includeCookie });
    assert.equal((await api('/api/projects/trash', { method:'DELETE', cookie:viewerCookie })).status, 403);
    const emptied = await api('/api/projects/trash', { method:'DELETE', cookie:adminCookie });
    assert.equal(emptied.status, 200);
    assert.equal(emptied.data.removed, 1);
  });

  await t.test('Erledigte Aufgaben werden genau einmal als Log übernommen', async () => {
    const created = await api(`/api/projects/${activeProject}/tasks`, { method:'POST', cookie:includeCookie, body:{ title:'Verdrahtung prüfen', description:'Alle Klemmen mit dem Durchgangsprüfer kontrollieren.', priority:'Hoch', dueDate:'2026-08-20' } });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'Offen');
    assert.equal((await api(`/api/projects/${activeProject}/tasks/${created.data.id}/complete`, { method:'POST', cookie:viewerCookie, body:{ date:'2026-08-19' } })).status, 403);
    const completed = await api(`/api/projects/${activeProject}/tasks/${created.data.id}/complete`, { method:'POST', cookie:includeCookie, body:{ date:'2026-08-19' } });
    assert.equal(completed.status, 201);
    assert.equal(completed.data.title, 'Verdrahtung prüfen');
    assert.equal(completed.data.sourceTaskId, created.data.id);
    const repeated = await api(`/api/projects/${activeProject}/tasks/${created.data.id}/complete`, { method:'POST', cookie:includeCookie, body:{ date:'2026-08-19' } });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.id, completed.data.id);
    const project = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
    assert.equal(project.data.tasks.find(task => task.id === created.data.id)?.status, 'Erledigt');
    assert.equal(project.data.entries.filter(entry => entry.sourceTaskId === created.data.id).length, 1);
    assert.equal((await api(`/api/projects/${activeProject}/entries/${completed.data.id}/reopen`, { method:'POST', cookie:viewerCookie, body:{} })).status, 403);
    const reopened = await api(`/api/projects/${activeProject}/entries/${completed.data.id}/reopen`, { method:'POST', cookie:includeCookie, body:{} });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.id, created.data.id);
    assert.equal(reopened.data.status, 'Offen');
    const afterReopen = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
    assert.equal(afterReopen.data.entries.some(entry => entry.id === completed.data.id), false);
    assert.equal(afterReopen.data.tasks.find(task => task.id === created.data.id)?.status, 'Offen');
    const directLog = await api(`/api/projects/${activeProject}/entries`, { method:'POST', cookie:includeCookie, body:{ title:'Direkten Schritt erneut öffnen', body:'Dieser Schritt wurde ohne vorherige Aufgabe geloggt.', date:'2026-08-19' } });
    const directReopen = await api(`/api/projects/${activeProject}/entries/${directLog.data.id}/reopen`, { method:'POST', cookie:includeCookie, body:{} });
    assert.equal(directReopen.status, 200);
    assert.equal(directReopen.data.title, 'Direkten Schritt erneut öffnen');
    assert.equal(directReopen.data.status, 'Offen');
  });

  await t.test('Tags respektieren Rollen, Projektzugriff und sichere Löschregeln', async () => {
    const visible = await api('/api/tags', { cookie:viewerCookie });
    assert.equal(visible.status, 200);
    const electronics = visible.data.tags.find(tag => tag.id === 'tag-elektronik');
    assert.equal(electronics.activeProjectCount, 1, 'Tag-Zähler darf unzugängliche Projekte nicht verraten');
    assert.equal((await api('/api/tags', { method:'POST', cookie:viewerCookie, body:{ name:'Unerlaubt' } })).status, 403);

    const created = await api('/api/tags', { method:'POST', cookie:includeCookie, body:{ name:'Sicherheitstest' } });
    assert.equal(created.status, 201);
    assert.equal((await api(`/api/tags/${created.data.id}`, { method:'PATCH', cookie:includeCookie, body:{ name:'Unerlaubt umbenannt' } })).status, 403);
    assert.equal((await api(`/api/projects/${activeProject}`, { method:'PATCH', cookie:includeCookie, body:{ tagIds:['tag-elektronik', created.data.id] } })).status, 200);
    assert.equal((await api(`/api/projects/${activeProject}`, { method:'PATCH', cookie:includeCookie, body:{ tagIds:['tag-gibt-es-nicht'] } })).status, 422);

    const target = await api('/api/tags', { method:'POST', cookie:adminCookie, body:{ name:'Zusammengeführt' } });
    assert.equal(target.status, 201);
    assert.equal((await api(`/api/tags/${target.data.id}`, { method:'PATCH', cookie:adminCookie, body:{ active:false } })).status, 422);
    assert.equal((await api(`/api/tags/${created.data.id}/merge`, { method:'POST', cookie:adminCookie, body:{ targetId:target.data.id } })).status, 200);
    const projectAfterMerge = await api(`/api/projects/${activeProject}`, { cookie:includeCookie });
    assert.ok(projectAfterMerge.data.tagIds.includes(target.data.id));
    assert.ok(!projectAfterMerge.data.tagIds.includes(created.data.id));
    assert.equal((await api(`/api/tags/${target.data.id}`, { method:'DELETE', cookie:adminCookie, body:{ removeFromProjects:false } })).status, 409);
    assert.equal((await api(`/api/tags/${target.data.id}`, { method:'DELETE', cookie:adminCookie, body:{ removeFromProjects:true } })).status, 204);
  });

  await t.test('Nicht-Administratoren erreichen keine Benutzer- oder Sicherheitsverwaltung', async () => {
    assert.equal((await api('/api/users', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/sessions', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/audit', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/settings/device', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/settings/smtp', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/settings/smtp/test', { method:'POST', cookie:includeCookie, body:{} })).status, 403);
    assert.equal((await api('/api/settings/backup', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/settings/backup/send', { method:'POST', cookie:includeCookie, body:{} })).status, 403);
    assert.equal((await api('/api/backup/users', { cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/import/users', { method:'POST', cookie:includeCookie, body:{} })).status, 403);
    assert.equal((await api('/api/import/project', { method:'POST', cookie:includeCookie, body:{} })).status, 403);
    assert.equal((await api('/api/system/content', { method:'DELETE', cookie:includeCookie })).status, 403);
    assert.equal((await api('/api/system/users', { method:'DELETE', cookie:includeCookie })).status, 403);
  });

  await t.test('Geräteeinstellungen sind geschützt, validiert und geben kein WLAN-Passwort aus', async () => {
    const before = await api('/api/settings/device', { cookie:adminCookie });
    assert.equal(before.status, 200);
    assert.equal(before.data.wifiPasswordSet, true);
    assert.equal('wifiPassword' in before.data, false);
    assert.equal((await api('/api/settings/device', { method:'PATCH', cookie:adminCookie, body:{ ...before.data, hostname:'-ungueltig' } })).status, 422);
    const updated = await api('/api/settings/device', { method:'PATCH', cookie:adminCookie, body:{ wifiSsid:before.data.wifiSsid, wifiPassword:'', hostname:'makerlog-test', timezone:before.data.timezone, ntpPrimary:before.data.ntpPrimary, ntpSecondary:before.data.ntpSecondary } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.restartRequired, true);
    const after = await api('/api/settings/device', { cookie:adminCookie });
    assert.equal(after.data.hostname, 'makerlog-test');
    assert.equal('wifiPassword' in after.data, false);
  });

  await t.test('SMTP kann anbieterunabhängig konfiguriert werden, ohne das Passwort offenzulegen', async () => {
    const before = await api('/api/settings/smtp', { cookie:adminCookie });
    assert.equal(before.status, 200);
    assert.equal(before.data.passwordSet, true);
    assert.equal('password' in before.data, false);
    const updated = await api('/api/settings/smtp', { method:'PATCH', cookie:adminCookie, body:{ ...before.data, port:587, security:'starttls', password:'' } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.configured, true);
    const after = await api('/api/settings/smtp', { cookie:adminCookie });
    assert.equal(after.data.port, 587);
    assert.equal(after.data.security, 'starttls');
    assert.equal('password' in after.data, false);
    assert.equal((await api('/api/settings/smtp/test', { method:'POST', cookie:adminCookie, body:{} })).status, 200);
  });

  await t.test('Automatische Backups haben einen geschützten Zeitplan und lassen sich sofort auslösen', async () => {
    const invalid = await api('/api/settings/backup', { method:'PATCH', cookie:adminCookie, body:{ enabled:true, recipient:'falsch', scope:'both', intervalDays:7 } });
    assert.equal(invalid.status, 422);
    const updated = await api('/api/settings/backup', { method:'PATCH', cookie:adminCookie, body:{ enabled:true, recipient:'backup@example.com', scope:'both', intervalDays:14 } });
    assert.equal(updated.status, 200);
    assert.ok(updated.data.nextRunAt > Math.floor(Date.now() / 1000));
    const sent = await api('/api/settings/backup/send', { method:'POST', cookie:adminCookie, body:{} });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.recipient, 'backup@example.com');
    const schedule = await api('/api/settings/backup', { cookie:adminCookie });
    assert.equal(schedule.data.lastStatus, 'Erfolgreich versendet');
    assert.ok(schedule.data.lastSentAt > 0);
  });

  await t.test('Deaktivieren entzieht bestehende Sitzungen und verhindert neue Anmeldungen', async () => {
    assert.equal((await api('/api/me', { cookie:disabledCookie })).status, 200);
    assert.equal((await api('/api/users/temp_disabled', { method:'PATCH', cookie:adminCookie, body:{ active:false } })).status, 200);
    assert.equal((await api('/api/me', { cookie:disabledCookie })).status, 401);
    assert.equal((await api('/api/login', { method:'POST', body:{ user:'temp_disabled', password:'Sicheres-Testpasswort-1' } })).status, 401);
  });

  await t.test('Administratoren können eine fremde aktive Sitzung widerrufen', async () => {
    const sessions = await api('/api/sessions', { cookie:adminCookie });
    const target = sessions.data.sessions.find(session => session.userId === 'editor_all');
    assert.ok(target);
    assert.equal((await api(`/api/sessions/${target.id}`, { method:'DELETE', cookie:adminCookie })).status, 204);
    assert.equal((await api('/api/me', { cookie:allCookie })).status, 401);
  });
});
