import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyUpdateRequest } from '../docker/updater/updater.mjs';

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
