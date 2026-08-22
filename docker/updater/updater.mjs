import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { verify as verifySignature } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const dataPath = process.env.LOGBUCH_UPDATE_DATA_PATH || '/var/lib/logbuch/updates';
const composeFile = process.env.LOGBUCH_UPDATE_COMPOSE_FILE || '/opt/logbuch/compose.yaml';
const publicKeyPath = process.env.LOGBUCH_UPDATE_PUBLIC_KEY_PATH || '/etc/logbuch/update-public-key.pem';
const appContainer = process.env.LOGBUCH_APP_CONTAINER || 'logbuch';
const updaterContainer = process.env.LOGBUCH_UPDATER_CONTAINER || 'logbuch-updater';
const handoffContainer = process.env.LOGBUCH_HANDOFF_CONTAINER || 'logbuch-updater-handoff';
const volumeName = process.env.LOGBUCH_DATA_VOLUME || 'logbuch-data';

const requestPath = `${dataPath}/docker-request.json`;
const statePath = `${dataPath}/state.json`;
const resultPath = `${dataPath}/docker-result.json`;
const heartbeatPath = `${dataPath}/updater-heartbeat`;
const baseEnvPath = `${dataPath}/base.env`;
const appEnvPath = `${dataPath}/image.env`;
const updaterEnvPath = `${dataPath}/updater-image.env`;
const updaterPreviousEnvPath = `${dataPath}/updater-image.previous.env`;
const lockPath = `${dataPath}/updater.lock`;
const sharedUid = Number.parseInt(process.env.LOGBUCH_SHARED_UID || '33', 10);
const sharedGid = Number.parseInt(process.env.LOGBUCH_SHARED_GID || '33', 10);

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IMAGE_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_.-]+)?$/;

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${label} fehlt oder ist ungültig.`);
  }
  return value;
}

function allowedImage(value, label) {
  const image = requiredString(value, label);
  if (!IMAGE_PATTERN.test(image) || image.includes('@')) {
    throw new Error(`${label} ist ungültig.`);
  }
  return image;
}

function strictBase64(value, label) {
  const encoded = requiredString(value, label);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`${label} ist ungültig.`);
  }
  return Buffer.from(encoded, 'base64');
}

export function verifyUpdateRequest(request, publicKey, expectedImage, expectedUpdaterImage) {
  if (!request || typeof request !== 'object' || request.format !== 'logbuch-docker-update-request') {
    throw new Error('Die Update-Anforderung hat ein unbekanntes Format.');
  }
  const version = requiredString(request.version, 'Version');
  const image = requiredString(request.image, 'Docker-Image');
  const digest = requiredString(request.digest, 'Docker-Digest');
  const updaterImage = requiredString(request.updaterImage, 'Updater-Image');
  const updaterDigest = requiredString(request.updaterDigest, 'Updater-Digest');
  if (!VERSION_PATTERN.test(version) || !DIGEST_PATTERN.test(digest) || !DIGEST_PATTERN.test(updaterDigest)) {
    throw new Error('Die Update-Anforderung enthält ungültige Versions- oder Digest-Angaben.');
  }
  if (image !== expectedImage || updaterImage !== expectedUpdaterImage) {
    throw new Error('Die Update-Anforderung verweist nicht auf freigegebene Images.');
  }

  const manifestRaw = strictBase64(request.manifest, 'Manifest').toString('utf8');
  const signature = strictBase64(request.signature, 'Signatur');
  if (!verifySignature('sha256', Buffer.from(manifestRaw), publicKey, signature)) {
    throw new Error('Die Signatur des Update-Manifests ist ungültig.');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new Error('Das Update-Manifest ist kein gültiges JSON-Dokument.');
  }
  if (manifest?.format !== 'logbuch-update' || manifest?.manifestVersion !== 1 || manifest?.version !== version) {
    throw new Error('Update-Anforderung und Manifest passen nicht zusammen.');
  }
  if (manifest?.docker?.image !== image || manifest?.docker?.digest !== digest ||
      manifest?.docker?.updater?.image !== updaterImage || manifest?.docker?.updater?.digest !== updaterDigest) {
    throw new Error('Die signierten Image-Angaben passen nicht zur Update-Anforderung.');
  }
  return manifest;
}

async function exists(path) {
  try {
    await fs.access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}`;
  await fs.writeFile(temporary, content, { mode: 0o660 });
  await fs.chown(temporary, sharedUid, sharedGid);
  await fs.rename(temporary, path);
}

async function writeJson(path, value) {
  await atomicWrite(path, `${JSON.stringify(value)}\n`);
}

async function run(command, args, options = {}) {
  try {
    return await exec(command, args, { maxBuffer: 8 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(detail || `${command} konnte nicht ausgeführt werden.`);
  }
}

function composeArgs(...args) {
  return [
    'compose', '--project-name', 'logbuch',
    '--env-file', baseEnvPath,
    '--env-file', appEnvPath,
    '--env-file', updaterEnvPath,
    '-f', composeFile,
    ...args,
  ];
}

async function compose(...args) {
  return run('docker', composeArgs(...args));
}

async function inspectedImage(container, fallback) {
  try {
    const { stdout } = await run('docker', ['inspect', '--format', '{{.Config.Image}}', container]);
    return requiredString(stdout.trim(), `Image von ${container}`);
  } catch {
    return fallback;
  }
}

function config() {
  const bindAddress = process.env.LOGBUCH_BIND_ADDRESS || '0.0.0.0';
  const port = process.env.LOGBUCH_PORT || '8080';
  const timezone = process.env.LOGBUCH_TIMEZONE || 'Europe/Berlin';
  const pollSeconds = Number.parseInt(process.env.LOGBUCH_UPDATE_POLL_SECONDS || '5', 10);
  if (!/^[0-9A-Fa-f:.\[\]]+$/.test(bindAddress) || !/^\d{1,5}$/.test(port) || Number(port) > 65535 ||
      !/^[A-Za-z0-9_+./-]+$/.test(timezone) || !Number.isInteger(pollSeconds) || pollSeconds < 2 || pollSeconds > 300) {
    throw new Error('Die AIO-Konfiguration enthält ungültige Netzwerk-, Zeitzonen- oder Intervallwerte.');
  }
  return {
    bindAddress,
    port,
    timezone,
    pollSeconds,
    image: allowedImage(process.env.LOGBUCH_UPDATE_IMAGE || 'ghcr.io/johannesboernsen/logbuch', 'Freigegebenes Docker-Image'),
    updaterImage: allowedImage(process.env.LOGBUCH_UPDATE_UPDATER_IMAGE || 'ghcr.io/johannesboernsen/logbuch-updater', 'Freigegebenes Updater-Image'),
  };
}

async function initialize(configuration) {
  if (!Number.isInteger(sharedUid) || sharedUid < 1 || !Number.isInteger(sharedGid) || sharedGid < 1) {
    throw new Error('Die UID oder GID für den gemeinsamen Datenspeicher ist ungültig.');
  }
  await fs.mkdir(dataPath, { recursive: true, mode: 0o770 });
  await fs.chown(dataPath, sharedUid, sharedGid);
  await fs.chmod(dataPath, 0o770);
  await atomicWrite(baseEnvPath,
    `LOGBUCH_BIND_ADDRESS=${configuration.bindAddress}\n` +
    `LOGBUCH_PORT=${configuration.port}\n` +
    `LOGBUCH_TIMEZONE=${configuration.timezone}\n` +
    `LOGBUCH_UPDATE_IMAGE=${configuration.image}\n` +
    `LOGBUCH_UPDATE_UPDATER_IMAGE=${configuration.updaterImage}\n` +
    `LOGBUCH_UPDATE_POLL_SECONDS=${configuration.pollSeconds}\n`);
  if (!(await exists(appEnvPath))) {
    const image = await inspectedImage(appContainer, `${configuration.image}:stable`);
    await atomicWrite(appEnvPath, `LOGBUCH_IMAGE=${image}\n`);
  }
  if (!(await exists(updaterEnvPath))) {
    const image = await inspectedImage(updaterContainer, `${configuration.updaterImage}:stable`);
    await atomicWrite(updaterEnvPath, `LOGBUCH_UPDATER_IMAGE=${image}\n`);
  }
}

async function setState(status, version, message, extra = {}) {
  const value = { status, version, message, updatedAt: new Date().toISOString(), ...extra };
  await writeJson(statePath, value);
  await writeJson(resultPath, value);
}

async function updateApplication(manifest, previousEnv) {
  const target = `${manifest.docker.image}@${manifest.docker.digest}`;
  await atomicWrite(appEnvPath, `LOGBUCH_IMAGE=${target}\n`);
  try {
    await compose('pull', 'logbuch');
    await compose('up', '-d', '--no-deps', '--wait', '--wait-timeout', '120', 'logbuch');
  } catch (error) {
    await atomicWrite(appEnvPath, previousEnv);
    try {
      await compose('up', '-d', '--no-deps', '--wait', '--wait-timeout', '120', 'logbuch');
    } catch (rollbackError) {
      throw new Error(`Update fehlgeschlagen (${error.message}); auch die Wiederherstellung schlug fehl (${rollbackError.message}).`);
    }
    throw new Error(`Update fehlgeschlagen; die vorherige Version wurde wiederhergestellt. ${error.message}`);
  }
}

async function startUpdaterHandoff(manifest) {
  const target = `${manifest.docker.updater.image}@${manifest.docker.updater.digest}`;
  const previousEnv = await fs.readFile(updaterEnvPath, 'utf8');
  if (previousEnv.trim() === `LOGBUCH_UPDATER_IMAGE=${target}`) return;
  const currentImage = await inspectedImage(updaterContainer, previousEnv.trim().replace(/^LOGBUCH_UPDATER_IMAGE=/, ''));
  await run('docker', ['pull', target]);
  await atomicWrite(updaterPreviousEnvPath, previousEnv);
  await atomicWrite(updaterEnvPath, `LOGBUCH_UPDATER_IMAGE=${target}\n`);
  try {
    await run('docker', ['rm', '-f', handoffContainer]);
  } catch {
    // Ein alter Handoff-Container ist normalerweise nicht vorhanden.
  }
  try {
    await run('docker', [
      'run', '-d', '--rm', '--name', handoffContainer,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${volumeName}:/var/lib/logbuch`,
      '--entrypoint', '/usr/local/bin/logbuch-updater-handoff',
      currentImage,
    ]);
  } catch (error) {
    await atomicWrite(updaterEnvPath, previousEnv);
    throw error;
  }
}

async function processRequest(configuration) {
  if (!(await exists(requestPath))) return;
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }
  let request;
  try {
    request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
    const publicKey = await fs.readFile(publicKeyPath);
    const manifest = verifyUpdateRequest(request, publicKey, configuration.image, configuration.updaterImage);
    const version = manifest.version;
    await setState('installing', version, 'Das Docker-Update wird installiert.');
    const previousEnv = await fs.readFile(appEnvPath, 'utf8');
    await updateApplication(manifest, previousEnv);
    const processedPath = `${dataPath}/docker-request-${Date.now()}.processed.json`;
    await fs.rename(requestPath, processedPath);
    await setState('success', version, 'Logbuch wurde erfolgreich aktualisiert.');
    try {
      await startUpdaterHandoff(manifest);
    } catch (error) {
      await writeJson(`${dataPath}/updater-result.json`, {
        status: 'failed', version, message: `Die Anwendung wurde aktualisiert, der AIO-Updater jedoch nicht: ${error.message}`,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    const version = typeof request?.version === 'string' ? request.version : '';
    await setState('failed', version, error.message || 'Das Docker-Update ist fehlgeschlagen.');
    try {
      await fs.rename(requestPath, `${dataPath}/docker-request-${Date.now()}.failed.json`);
    } catch {
      // Eine unlesbare oder bereits verschobene Datei muss nicht erneut verschoben werden.
    }
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function main() {
  const configuration = config();
  await initialize(configuration);
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  while (!stopping) {
    await fs.writeFile(heartbeatPath, `${new Date().toISOString()}\n`);
    await processRequest(configuration);
    await new Promise((resolve) => setTimeout(resolve, configuration.pollSeconds * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
