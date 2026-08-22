import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

test('parallele Ersteinrichtung erzeugt genau einen Administrator', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-install-race-'));
  let serverErrors = '';
  const ports = Array.from({ length:6 }, (_, index) => 4210 + index);
  const servers = ports.map(port => spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/router.php'], {
    cwd:root,
    env:{ ...process.env, LOGBUCH_STORAGE_PATH:storage, LOGBUCH_PLATFORM:'test' },
    stdio:['ignore', 'ignore', 'pipe'],
  }));
  servers.forEach(server => server.stderr.on('data', chunk => { serverErrors += chunk.toString(); }));
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await Promise.all(ports.map(port => fetch(`http://127.0.0.1:${port}/api/install/status`).then(response => response.ok).catch(() => false)));
      if (ready.every(Boolean)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (attempt === 49) throw new Error('PHP-Testserver sind nicht gestartet.');
    }
    const responses = await Promise.all(ports.map((port, index) => fetch(`http://127.0.0.1:${port}/api/install`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ siteName:'Race-Test', timezone:'Europe/Berlin', adminUser:`raceadmin${index}`, adminPassword:'sicheres-race-passwort' }),
    })));
    const responseSummary = await Promise.all(responses.map(async response => `${response.status} ${await response.text()}`));
    assert.equal(responses.filter(response => response.status === 201).length, 1, `${responseSummary.join('\n')}\n${serverErrors.slice(-8000)}`);
    assert.equal(responses.filter(response => response.status === 409).length, ports.length - 1);
  } finally {
    servers.forEach(server => server.kill('SIGTERM'));
    await rm(storage, { recursive:true, force:true });
  }
});
