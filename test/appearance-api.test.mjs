import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4250';
let storage;
let server;
let cookie = '';
let csrf = '';
let serverErrors = '';

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { Accept:'application/json', ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {}), ...(cookie ? { Cookie:cookie } : {}), ...(!['GET','HEAD'].includes(method) && csrf ? { 'X-Logbuch-CSRF':csrf } : {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}

before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-appearance-api-'));
  server = spawn('php', ['-S', '127.0.0.1:4250', '-t', 'public', 'public/router.php'], { cwd:root, env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' }, stdio:['ignore','ignore','pipe'] });
  server.stderr.on('data', chunk => { serverErrors += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/install/status`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('/api/install', { method:'POST', body:JSON.stringify({ siteName:'Werkstatt Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'ein-langes-Testpasswort' }) })).response.status, 201, serverErrors.slice(-2000));
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  assert.equal(login.response.status, 200, serverErrors.slice(-2000));
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
});

after(async () => {
  server?.kill('SIGTERM');
  if (storage) await rm(storage, { recursive:true, force:true });
});

test('Erscheinungsbild ist öffentlich lesbar und administrativ veränderbar', async () => {
  const initial = await request('/api/appearance');
  assert.equal(initial.response.status, 200);
  assert.deepEqual({ displayName:initial.data.displayName, subtitle:initial.data.subtitle, accentColor:initial.data.accentColor, themeMode:initial.data.themeMode, hasLogo:initial.data.hasLogo }, { displayName:'Werkstatt Test', subtitle:'', accentColor:'#e5322c', themeMode:'light', hasLogo:false });

  const invalid = await request('/api/settings/appearance', { method:'PATCH', body:JSON.stringify({ displayName:'X', accentColor:'yellow' }) });
  assert.equal(invalid.response.status, 422);
  const invalidTheme = await request('/api/settings/appearance', { method:'PATCH', body:JSON.stringify({ displayName:'Meine Werkstatt', themeMode:'sepia' }) });
  assert.equal(invalidTheme.response.status, 422);
  const updated = await request('/api/settings/appearance', { method:'PATCH', body:JSON.stringify({ displayName:'Meine Werkstatt', subtitle:'Projekte und Material', accentColor:'#123abc', themeMode:'auto' }) });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
  assert.deepEqual({ displayName:updated.data.displayName, subtitle:updated.data.subtitle, accentColor:updated.data.accentColor, themeMode:updated.data.themeMode }, { displayName:'Meine Werkstatt', subtitle:'Projekte und Material', accentColor:'#123abc', themeMode:'auto' });
  cookie = '';
  csrf = '';
  assert.equal((await request('/api/appearance')).data.displayName, 'Meine Werkstatt');
});

test('Ein Bildlogo lässt sich hochladen, öffentlich abrufen und entfernen', async () => {
  const login = await request('/api/login', { method:'POST', body:JSON.stringify({ user:'admin', password:'ein-langes-Testpasswort' }) });
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  csrf = login.data.csrfToken;
  const logoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('logo', new Blob([logoBytes], { type:'image/png' }), 'werkstatt.png');
  const uploaded = await fetch(`${baseUrl}/api/settings/appearance/logo`, { method:'POST', headers:{ Cookie:cookie, 'X-Logbuch-CSRF':csrf, Accept:'application/json' }, body:form });
  const uploadedData = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(uploadedData));
  assert.equal(uploadedData.hasLogo, true);
  assert.match(uploadedData.logoUrl, /^\/api\/appearance\/logo\?v=/);

  const logo = await fetch(`${baseUrl}/api/appearance/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), logoBytes);
  const removed = await request('/api/settings/appearance/logo', { method:'DELETE', body:'{}' });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.hasLogo, false);
  assert.equal((await fetch(`${baseUrl}/api/appearance/logo`)).status, 404);
});
