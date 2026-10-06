import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4265';
let storage;
let server;
let cookie = '';
let csrf = '';
let serverErrors = '';

async function request(path, options = {}, authenticated = true) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { Accept:'application/json', ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {}), ...(authenticated && cookie ? { Cookie:cookie } : {}), ...(authenticated && !['GET','HEAD'].includes(method) && csrf ? { 'X-Logbuch-CSRF':csrf } : {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}

before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-project-share-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4265', '-t', 'public', 'public/router.php'], { cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'] });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Freigabe-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Freigaben lassen sich unter gleichem Link ändern, deaktivieren, reaktivieren und endgültig löschen', async () => {
  const folder = (await request('/api/folders', { method:'POST', body:JSON.stringify({ name:'Verwaltung' }) })).data;
  const created = await request('/api/project-shares', { method:'POST', body:JSON.stringify({ scopeType:'FOLDER', folderId:folder.id }) });
  assert.equal(created.response.status, 201);
  const share = created.data;
  const path = `/api/project-shares/${share.id}`;
  const updated = await request(path, { method:'PATCH', body:JSON.stringify({ name:'Neue Bezeichnung', projectStatuses:['active', 'paused'], expiresAt:'2099-12-31' }) });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.name, 'Neue Bezeichnung');
  assert.equal(updated.data.url, share.url);
  assert.equal(updated.data.token, share.token);
  assert.equal(updated.data.folderId, folder.id);
  assert.deepEqual(updated.data.projectStatuses, ['active', 'paused']);
  const publicView = await request(`/api/public/project-shares/${share.token}`, {}, false);
  assert.equal(publicView.data.name, 'Neue Bezeichnung');
  assert.equal(publicView.data.expiresAt, '2099-12-31');
  assert.match(publicView.data.scopeLabel, /Aktiv, Pausiert/);
  for (const input of [{ name:'' }, { projectStatuses:[] }, { expiresAt:'2020-01-01' }, { active:'false' }]) {
    assert.equal((await request(path, { method:'PATCH', body:JSON.stringify(input) })).response.status, 422);
  }
  assert.equal((await request(path, { method:'PATCH', body:JSON.stringify({ name:'Nicht erlaubt' }) }, false)).response.status, 401);
  assert.equal((await request(`${path}/permanent`, { method:'DELETE' }, false)).response.status, 401);
  assert.equal((await request(`${path}/deactivate`, { method:'POST', body:'{}' })).response.status, 200);
  assert.equal((await request(`/api/public/project-shares/${share.token}`, {}, false)).response.status, 404);
  assert.equal((await request('/api/project-shares')).data.shares.find(row => row.id === share.id).active, false);
  const reactivated = await request(path, { method:'PATCH', body:JSON.stringify({ active:true, expiresAt:'', projectStatuses:null }) });
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.data.token, share.token);
  assert.equal(reactivated.data.projectStatuses, null);
  assert.equal((await request(`/api/public/project-shares/${share.token}`, {}, false)).response.status, 200);
  assert.equal((await request(`${path}/permanent`, { method:'DELETE' })).response.status, 200);
  assert.equal((await request(`/api/public/project-shares/${share.token}`, {}, false)).response.status, 404);
  assert.equal((await request('/api/project-shares')).data.shares.some(row => row.id === share.id), false);
  assert.equal((await request(path, { method:'PATCH', body:'{}' })).response.status, 404);
  assert.ok((await request('/api/folders')).data.folders.some(row => row.id === folder.id));
});

test('Auch globale und ältere Ein-Status-Freigaben lassen sich bearbeiten', async () => {
  for (const scopeType of ['ALL', 'STATUS']) {
    const created = await request('/api/project-shares', { method:'POST', body:JSON.stringify({ scopeType, projectStatus:'idea' }) });
    assert.equal(created.response.status, 201);
    const updated = await request(`/api/project-shares/${created.data.id}`, { method:'PATCH', body:JSON.stringify({ name:'Umbenannt', ...(scopeType === 'STATUS' ? { projectStatus:'completed' } : {}) }) });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.data.scopeType, scopeType);
    assert.equal(updated.data.token, created.data.token);
    assert.equal(updated.data.projectStatus, scopeType === 'STATUS' ? 'completed' : '');
  }
});

test('Öffentliche Freigabe bleibt ohne Login reduziert, erneuerbar und widerrufbar', async () => {
  const folder = await request('/api/folders', { method:'POST', body:JSON.stringify({ name:'Kundenprojekte' }) });
  assert.equal(folder.response.status, 201, JSON.stringify(folder.data));
  const project = await request('/api/projects', { method:'POST', body:JSON.stringify({ title:'Messestand','description':'Aufbau des neuen Messestands','status':'active','createdAt':'2026-10-01','dueDate':'2026-11-15','folderId':folder.data.id }) });
  assert.equal(project.response.status, 201, JSON.stringify(project.data));

  const created = await request('/api/project-shares', { method:'POST', body:JSON.stringify({ scopeType:'FOLDER', folderId:folder.data.id, name:'Öffentliche Kundenprojekte' }) });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.match(created.data.url, /\/share\/projects\/[a-f0-9]{64}$/);
  const token = created.data.token;

  const publicView = await request(`/api/public/project-shares/${token}`, {}, false);
  assert.equal(publicView.response.status, 200, JSON.stringify(publicView.data));
  assert.deepEqual(publicView.data.projects, [{ title:'Messestand', description:'Aufbau des neuen Messestands', status:'active', dueDate:'2026-11-15', folderKey:publicView.data.rootFolderKey }]);
  assert.equal(Object.hasOwn(publicView.data.projects[0], 'id'), false);
  assert.equal((await request('/api/project-shares', {}, false)).response.status, 401);

  const rotated = await request(`/api/project-shares/${created.data.id}/rotate`, { method:'POST', body:'{}' });
  assert.equal(rotated.response.status, 200);
  assert.equal((await request(`/api/public/project-shares/${token}`, {}, false)).response.status, 404);
  assert.equal((await request(`/api/public/project-shares/${rotated.data.token}`, {}, false)).response.status, 200);

  assert.equal((await request(`/api/project-shares/${created.data.id}`, { method:'DELETE', body:'{}' })).response.status, 200);
  assert.equal((await request(`/api/public/project-shares/${rotated.data.token}`, {}, false)).response.status, 404);
});

test('Ordnerfreigaben filtern kombinierte Status serverseitig, dynamisch und einschließlich Unterordnern', async () => {
  const post = async (path, data) => {
    const result = await request(path, { method:'POST', body:JSON.stringify(data) });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data;
  };
  const folder = await post('/api/folders', { name:'Statusfreigabe' });
  const child = await post('/api/folders', { name:'Unterordner', parentId:folder.id });
  const projects = {};
  for (const status of ['idea', 'active', 'paused', 'completed']) {
    projects[status] = await post('/api/projects', { title:`Status ${status}`, status, createdAt:'2026-10-01', folderId:status === 'active' ? child.id : folder.id });
  }
  await post('/api/projects', { title:'Nicht im Ordner', status:'active', createdAt:'2026-10-01' });
  const selected = await post('/api/project-shares', { scopeType:'FOLDER', folderId:folder.id, projectStatuses:['active', 'idea'] });
  assert.deepEqual(selected.projectStatuses, ['idea', 'active']);
  assert.equal(selected.projectCount, 2);
  const publicProjects = async share => (await request(`/api/public/project-shares/${share.token}`, {}, false)).data.projects;
  assert.deepEqual((await publicProjects(selected)).map(project => project.status).sort(), ['active', 'idea']);
  const all = await post('/api/project-shares', { scopeType:'FOLDER', folderId:folder.id });
  assert.equal(all.projectStatuses, null);
  assert.equal((await publicProjects(all)).length, 4);
  assert.deepEqual((await request('/api/project-shares')).data.shares.find(share => share.id === selected.id).projectStatuses, ['idea', 'active']);

  const changed = await request(`/api/projects/${projects.idea.id}`, { method:'PATCH', body:JSON.stringify({ status:'completed' }) });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data));
  assert.deepEqual((await publicProjects(selected)).map(project => project.status), ['active']);
  await post('/api/projects', { title:'Neue Idee', status:'idea', createdAt:'2026-10-01', folderId:child.id });
  assert.equal((await publicProjects(selected)).length, 2);
  const rotated = await request(`/api/project-shares/${selected.id}/rotate`, { method:'POST', body:'{}' });
  assert.deepEqual(rotated.data.projectStatuses, ['idea', 'active']);
  assert.equal((await publicProjects(rotated.data)).length, 2);
  for (const projectStatuses of [[], ['archived'], ['deleted'], ['idea', 'idea'], 'active', {}, [42], ['idea', null]]) {
    const invalid = await request('/api/project-shares', { method:'POST', body:JSON.stringify({ scopeType:'FOLDER', folderId:folder.id, projectStatuses }) });
    assert.equal(invalid.response.status, 422, JSON.stringify(projectStatuses));
  }
  assert.equal((await request('/api/project-shares', { method:'POST', body:JSON.stringify({ scopeType:'ALL', projectStatuses:['active'] }) })).response.status, 422);
});
