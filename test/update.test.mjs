import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const appUrl = 'http://127.0.0.1:4240';

test('signierte Updates werden geprüft und für Docker sicher angefordert', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-update-test-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength:2048,
    privateKeyEncoding:{ type:'pkcs8', format:'pem' },
    publicKeyEncoding:{ type:'spki', format:'pem' },
  });
  const publicKeyPath = join(storage, 'update-public.pem');
  await writeFile(publicKeyPath, publicKey);
  const hash = '0'.repeat(64);
  const manifest = `${JSON.stringify({
    format:'logbuch-update', manifestVersion:1, version:'9.9.9', channel:'stable', publishedAt:'2026-08-21T12:00:00Z', minimumPhp:'8.2.0', summary:'Testupdate', highlights:['Neue Übersicht', 'Behobener Fehler'], releaseNotesUrl:'https://github.com/johannesboernsen/logbuch/releases/tag/v9.9.9', changelogUrl:'https://github.com/johannesboernsen/logbuch/releases/tag/v9.9.9',
    database:{ schemaVersion:6 },
    web:{ url:'http://127.0.0.1/package.tar', sha256:hash, files:{ 'app/bootstrap.php':hash, 'app/Application.php':hash, 'public/index.php':hash, VERSION:hash, SCHEMA_VERSION:hash } },
    docker:{ image:'ghcr.io/johannesboernsen/logbuch', digest:`sha256:${'a'.repeat(64)}`, updater:{ image:'ghcr.io/johannesboernsen/logbuch-updater', digest:`sha256:${'c'.repeat(64)}` } },
  }, null, 2)}\n`;
  let signature = sign('sha256', Buffer.from(manifest), privateKey).toString('base64');
  const releaseServer = createServer((request, response) => {
    if (request.url === '/update-manifest.json') response.end(manifest);
    else if (request.url === '/update-manifest.sig') response.end(signature);
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => releaseServer.listen(0, '127.0.0.1', resolve));
  const releasePort = releaseServer.address().port;
  const php = spawn('php', ['-S', '127.0.0.1:4240', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{
      ...process.env,
      LOGBUCH_STORAGE_PATH:storage,
      LOGBUCH_PLATFORM:'docker',
      LOGBUCH_UPDATE_PUBLIC_KEY_PATH:publicKeyPath,
      LOGBUCH_UPDATE_MANIFEST_URL:`http://127.0.0.1:${releasePort}/update-manifest.json`,
      LOGBUCH_UPDATE_SIGNATURE_URL:`http://127.0.0.1:${releasePort}/update-manifest.sig`,
    },
    stdio:'ignore',
  });
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await fetch(`${appUrl}/api/install/status`).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (attempt === 49) throw new Error('PHP-Testserver ist nicht gestartet.');
    }
    await fetch(`${appUrl}/api/install`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ siteName:'Update-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'sicheres-update-passwort' }) });
    const login = await fetch(`${appUrl}/api/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ user:'admin', password:'sicheres-update-passwort' }) });
    const loginData = await login.json();
    const headers = { Cookie:login.headers.get('set-cookie').split(';', 1)[0], 'X-Logbuch-CSRF':loginData.csrfToken, 'Content-Type':'application/json' };

    const status = await fetch(`${appUrl}/api/update/status`, { headers }).then(response => response.json());
    assert.equal(status.available, true);
    assert.equal(status.latestVersion, '9.9.9');
    assert.equal(status.platform, 'docker');
    assert.deepEqual(status.highlights, ['Neue Übersicht', 'Behobener Fehler']);
    assert.equal(status.changelogUrl, 'https://github.com/johannesboernsen/logbuch/releases/tag/v9.9.9');

    const validSignature = signature;
    signature = Buffer.from('keine gültige Signatur').toString('base64');
    const unsigned = await fetch(`${appUrl}/api/update/install`, { method:'POST', headers, body:JSON.stringify({ password:'sicheres-update-passwort' }) });
    assert.equal(unsigned.status, 502);
    signature = validSignature;
    const rejected = await fetch(`${appUrl}/api/update/install`, { method:'POST', headers, body:JSON.stringify({ password:'falsch' }) });
    assert.equal(rejected.status, 401);
    const accepted = await fetch(`${appUrl}/api/update/install`, { method:'POST', headers, body:JSON.stringify({ password:'sicheres-update-passwort' }) });
    assert.equal(accepted.status, 202);
    const request = JSON.parse(await readFile(join(storage, 'updates', 'docker-request.json'), 'utf8'));
    assert.equal(request.image, 'ghcr.io/johannesboernsen/logbuch');
    assert.equal(request.digest, `sha256:${'a'.repeat(64)}`);
    assert.equal(request.updaterImage, 'ghcr.io/johannesboernsen/logbuch-updater');
    assert.equal(request.updaterDigest, `sha256:${'c'.repeat(64)}`);
    assert.equal(request.requestedBy, 'admin');
  } finally {
    php.kill('SIGTERM');
    releaseServer.close();
    await rm(storage, { recursive:true, force:true });
  }
});

test('Webhosting-Update sichert und ersetzt ausschließlich signierte Programmdateien', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'logbuch-web-update-test-'));
  const installRoot = join(temporary, 'installation');
  const storage = join(installRoot, 'storage');
  const stage = join(temporary, 'release');
  for (const directory of ['app', 'public', 'config']) await mkdir(join(installRoot, directory), { recursive:true });
  await mkdir(storage, { recursive:true });
  await mkdir(join(stage, 'app'), { recursive:true });
  await mkdir(join(stage, 'public'), { recursive:true });
  await mkdir(join(stage, 'config'), { recursive:true });
  await writeFile(join(installRoot, 'VERSION'), '0.2.0\n');
  await writeFile(join(installRoot, 'SCHEMA_VERSION'), '6\n');
  await writeFile(join(installRoot, 'app', 'old.php'), '<?php // alt\n');
  await writeFile(join(installRoot, 'public', 'old.txt'), 'alte Datei\n');

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength:2048,
    privateKeyEncoding:{ type:'pkcs8', format:'pem' },
    publicKeyEncoding:{ type:'spki', format:'pem' },
  });
  const publicKeyPath = join(installRoot, 'config', 'update-public-key.pem');
  await writeFile(publicKeyPath, publicKey);
  const releaseFiles = {
    'app/bootstrap.php':'<?php // neuer Bootstrap\n',
    'app/Application.php':'<?php // neue Anwendung\n',
    'public/index.php':'<?php // neuer Einstieg\n',
    VERSION:'0.3.0\n',
    SCHEMA_VERSION:'6\n',
    'config/update-public-key.pem':publicKey,
  };
  for (const [path, content] of Object.entries(releaseFiles)) {
    await mkdir(join(stage, path, '..'), { recursive:true });
    await writeFile(join(stage, path), content);
  }
  const files = Object.fromEntries(Object.entries(releaseFiles).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')]));
  const archivePath = join(temporary, 'logbuch-web-0.3.0.tar');
  execFileSync('tar', ['-cf', archivePath, '-C', stage, 'app', 'public', 'config', 'VERSION', 'SCHEMA_VERSION'], { env:{ ...process.env, COPYFILE_DISABLE:'1' } });
  const archive = await readFile(archivePath);
  let manifest = '';
  let signature = '';
  const releaseServer = createServer((request, response) => {
    if (request.url === '/update-manifest.json') response.end(manifest);
    else if (request.url === '/update-manifest.sig') response.end(signature);
    else if (request.url === '/package.tar') response.end(archive);
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => releaseServer.listen(0, '127.0.0.1', resolve));
  const releasePort = releaseServer.address().port;
  manifest = `${JSON.stringify({
    format:'logbuch-update', manifestVersion:1, version:'0.3.0', channel:'stable', publishedAt:'2026-08-21T12:00:00Z', minimumPhp:'8.2.0', summary:'Webtest', releaseNotesUrl:'https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.0',
    database:{ schemaVersion:6 },
    web:{ url:`http://127.0.0.1:${releasePort}/package.tar`, sha256:createHash('sha256').update(archive).digest('hex'), files },
    docker:{ image:'ghcr.io/johannesboernsen/logbuch', digest:`sha256:${'b'.repeat(64)}`, updater:{ image:'ghcr.io/johannesboernsen/logbuch-updater', digest:`sha256:${'d'.repeat(64)}` } },
  }, null, 2)}\n`;
  signature = sign('sha256', Buffer.from(manifest), privateKey).toString('base64');
  const php = spawn('php', ['-S', '127.0.0.1:4241', '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_ROOT_PATH:installRoot, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'webhosting', LOGBUCH_UPDATE_PUBLIC_KEY_PATH:publicKeyPath, LOGBUCH_UPDATE_MANIFEST_URL:`http://127.0.0.1:${releasePort}/update-manifest.json`, LOGBUCH_UPDATE_SIGNATURE_URL:`http://127.0.0.1:${releasePort}/update-manifest.sig` },
    stdio:'ignore',
  });
  try {
    const appUrl = 'http://127.0.0.1:4241';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await fetch(`${appUrl}/api/install/status`).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (attempt === 49) throw new Error('PHP-Testserver ist nicht gestartet.');
    }
    await fetch(`${appUrl}/api/install`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ siteName:'Web-Update-Test', timezone:'Europe/Berlin', adminUser:'admin', adminPassword:'sicheres-update-passwort' }) });
    const login = await fetch(`${appUrl}/api/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ user:'admin', password:'sicheres-update-passwort' }) });
    const loginData = await login.json();
    const response = await fetch(`${appUrl}/api/update/install`, { method:'POST', headers:{ Cookie:login.headers.get('set-cookie').split(';', 1)[0], 'X-Logbuch-CSRF':loginData.csrfToken, 'Content-Type':'application/json' }, body:JSON.stringify({ password:'sicheres-update-passwort' }) });
    const responseText = await response.text();
    assert.equal(response.status, 202, responseText);
    assert.equal(await readFile(join(installRoot, 'VERSION'), 'utf8'), '0.3.0\n');
    assert.equal(await readFile(join(installRoot, 'app', 'bootstrap.php'), 'utf8'), releaseFiles['app/bootstrap.php']);
    assert.deepEqual(await readdir(join(storage, 'projects')), []);
    const backups = await readdir(join(storage, 'updates', 'backups'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(storage, 'updates', 'maintenance.json'), 'utf8').catch(() => ''), '');
  } finally {
    php.kill('SIGTERM');
    releaseServer.close();
    await rm(temporary, { recursive:true, force:true });
  }
});
