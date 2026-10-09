import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, reserveUpdate, verifyUpdateRequest, readImageSelection } from '../docker/updater/updater.mjs';

const appImage = 'ghcr.io/johannesboernsen/logbuch';
const updaterImage = 'ghcr.io/johannesboernsen/logbuch-updater';
const appDigest = `sha256:${'a'.repeat(64)}`;
const updaterDigest = `sha256:${'b'.repeat(64)}`;

function signedRequest() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const manifestRaw = `${JSON.stringify({
    format: 'logbuch-update',
    manifestVersion: 1,
    version: '1.2.3',
    docker: {
      image: appImage,
      digest: appDigest,
      updater: { image: updaterImage, digest: updaterDigest },
    },
  })}\n`;
  return {
    publicKey,
    request: {
      format: 'logbuch-docker-update-request',
      version: '1.2.3',
      image: appImage,
      digest: appDigest,
      updaterImage,
      updaterDigest,
      manifest: Buffer.from(manifestRaw).toString('base64'),
      signature: sign('sha256', Buffer.from(manifestRaw), privateKey).toString('base64'),
    },
  };
}

test('AIO-Updater akzeptiert nur ein vollständig signiertes Image-Paar', () => {
  const { request, publicKey } = signedRequest();
  const manifest = verifyUpdateRequest(request, publicKey, appImage, updaterImage);
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.docker.digest, appDigest);
  assert.equal(manifest.docker.updater.digest, updaterDigest);
});

test('AIO-Updater verwirft Manipulationen und fremde Images', () => {
  const signed = signedRequest();
  assert.throws(
    () => verifyUpdateRequest({ ...signed.request, digest: `sha256:${'c'.repeat(64)}` }, signed.publicKey, appImage, updaterImage),
    /passen nicht/,
  );
  assert.throws(
    () => verifyUpdateRequest(signed.request, signed.publicKey, 'ghcr.io/example/fremd', updaterImage),
    /freigegebene Images/,
  );
  const damaged = { ...signed.request, signature: Buffer.from('falsch').toString('base64') };
  assert.throws(() => verifyUpdateRequest(damaged, signed.publicKey, appImage, updaterImage), /Signatur/);
});

test('Updater vergleicht Release-Versionen einschließlich Vorabversionen', () => {
  assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3-beta.2', '1.2.3-beta.10'), -1);
  assert.equal(compareVersions('1.2.3-beta.10', '1.2.3'), -1);
  assert.equal(compareVersions('1.2.3-beta-x', '1.2.3-beta-y'), -1);
});

test('privater Versionsstand verhindert Replay und Downgrade ohne gemeinsame Verlaufsdateien', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logbuch-replay-'));
  const stateFile = join(directory, 'accepted-release.json');
  const request = signedRequest().request;
  const manifestRaw = Buffer.from(request.manifest, 'base64');
  const manifest = JSON.parse(manifestRaw);
  try {
    await assert.rejects(reserveUpdate(manifest, manifestRaw, '1.2.3', stateFile), /nicht neuer/);
    await reserveUpdate(manifest, manifestRaw, '1.2.2', stateFile);
    const accepted = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(accepted.version, '1.2.3');
    assert.match(accepted.manifestDigest, /^[a-f0-9]{64}$/);
    await assert.rejects(reserveUpdate(manifest, manifestRaw, '1.2.2', stateFile), /bereits verarbeitet/);
    await assert.rejects(reserveUpdate({ version: '1.2.1' }, 'older signed manifest', '1.2.2', stateFile), /bereits verarbeitet/);
    await assert.rejects(reserveUpdate({ version: '1.2.3' }, 'different signed manifest', '1.2.3', stateFile), /bereits verarbeitet/);
    await writeFile(stateFile, '{"version":"broken"}\n');
    await assert.rejects(reserveUpdate({ version: '1.2.4' }, 'next signed manifest', '1.2.3', stateFile), /private Update-Verlauf/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('privilegierte Image-Auswahl verwirft zusätzliche Compose-Schlüssel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logbuch-updater-'));
  const imageFile = join(directory, 'image.env');
  const updaterFile = join(directory, 'updater-image.env');
  try {
    await writeFile(imageFile, `LOGBUCH_IMAGE=${appImage}@${appDigest}\n`);
    assert.equal(await readImageSelection(imageFile, 'LOGBUCH_IMAGE'), `${appImage}@${appDigest}`);
    await writeFile(imageFile, `LOGBUCH_IMAGE=${appImage}@${appDigest}\nLOGBUCH_UPDATER_IMAGE=evil/image:latest\n`);
    await assert.rejects(readImageSelection(imageFile, 'LOGBUCH_IMAGE'), /Ungültige Image-Auswahl/);
    await writeFile(updaterFile, `LOGBUCH_UPDATER_IMAGE=${updaterImage}@${updaterDigest}\n`);
    assert.equal(await readImageSelection(updaterFile, 'LOGBUCH_UPDATER_IMAGE'), `${updaterImage}@${updaterDigest}`);
    await writeFile(updaterFile, `LOGBUCH_UPDATER_IMAGE=${updaterImage}@${updaterDigest}\nLOGBUCH_IMAGE=evil/image:latest\n`);
    await assert.rejects(readImageSelection(updaterFile, 'LOGBUCH_UPDATER_IMAGE'), /Ungültige Image-Auswahl/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Compose trennt App-Daten von privatem Updater-Zustand', async (t) => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  } catch {
    t.skip('Docker Compose ist nicht installiert');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'logbuch-compose-'));
  try {
    const base = join(directory, 'base.env');
    const app = join(directory, 'image.env');
    const updater = join(directory, 'updater-image.env');
    const shared = join(directory, 'shared.env');
    await writeFile(base, `LOGBUCH_BIND_ADDRESS=127.0.0.1\nLOGBUCH_PORT=8080\nLOGBUCH_TIMEZONE=Europe/Berlin\nLOGBUCH_UPDATE_IMAGE=${appImage}\nLOGBUCH_UPDATE_UPDATER_IMAGE=${updaterImage}\nLOGBUCH_UPDATE_POLL_SECONDS=5\n`);
    await writeFile(app, `LOGBUCH_IMAGE=${appImage}@${appDigest}\n`);
    await writeFile(updater, `LOGBUCH_UPDATER_IMAGE=${updaterImage}@${updaterDigest}\n`);
    await writeFile(shared, 'LOGBUCH_IMAGE=evil/app:latest\nLOGBUCH_UPDATER_IMAGE=evil/updater:latest\n');
    const runtime = new URL('../docker/updater/compose.runtime.yaml', import.meta.url).pathname;
    const args = ['compose', '--env-file', base, '--env-file', app, '--env-file', updater, '-f', runtime, 'config', '--format', 'json'];
    const configuration = JSON.parse(execFileSync('docker', args, { encoding: 'utf8' }));
    assert.equal(configuration.services.logbuch.image, `${appImage}@${appDigest}`);
    assert.equal(configuration.services['logbuch-updater'].image, `${updaterImage}@${updaterDigest}`);
    assert.ok(configuration.services['logbuch-updater'].volumes.some((volume) => volume.source === 'logbuch-updater-state'));
    assert.ok(configuration.services.logbuch.volumes.every((volume) => volume.source !== 'logbuch-updater-state'));
    assert.equal((await readFile(shared, 'utf8')).includes('evil/updater'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
