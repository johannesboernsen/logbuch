import assert from 'node:assert/strict';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:8081').replace(/\/$/, '');
const password = 'docker-concurrency-passwort';

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const status = await json('/api/install/status');
assert.equal(status.response.status, 200);
if (!status.body.installed) {
  const install = await json('/api/install', { method: 'POST', body: JSON.stringify({ siteName: 'Paralleltest', timezone: 'Europe/Berlin', adminUser: 'paralleladmin', adminPassword: password }) });
  assert.equal(install.response.status, 201);
}

const login = await json('/api/login', { method: 'POST', body: JSON.stringify({ user: 'paralleladmin', password }) });
assert.equal(login.response.status, 200);
const cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(cookie);

const paths = ['/api/projects', '/api/project-browser', '/api/overview', '/api/tags', '/api/folders', '/api/system'];
const responses = await Promise.all(Array.from({ length: 300 }, (_, index) => fetch(`${baseUrl}${paths[index % paths.length]}`, { headers: { Accept: 'application/json', Cookie: cookie } })));
const failures = responses.filter(response => response.status !== 200);
assert.equal(failures.length, 0, `${failures.length} von ${responses.length} parallelen Anfragen sind fehlgeschlagen`);
console.log(`${responses.length} parallele API-Anfragen ohne Serverfehler beantwortet.`);
