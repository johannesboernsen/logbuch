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
