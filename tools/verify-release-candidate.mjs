import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';

const [directory, expectedCommit, repository] = process.argv.slice(2);
if (!directory || !/^[a-f0-9]{40}$/.test(expectedCommit || '') || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '')) {
  throw new Error('Ungültige Release-Prüfparameter.');
}
const manifest = JSON.parse(await fs.readFile(join(directory, 'update-manifest.json'), 'utf8'));
const version = manifest?.version;
if (manifest?.format !== 'logbuch-update' || manifest?.manifestVersion !== 1 ||
    typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Ungültiges Release-Manifest.');
}
const tag = `v${version}`;
const image = `ghcr.io/${repository.toLowerCase()}`;
const updaterImage = `${image}-updater`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const appDigest = manifest?.docker?.digest;
const updaterDigest = manifest?.docker?.updater?.digest;
if (manifest?.docker?.image !== image || manifest?.docker?.updater?.image !== updaterImage ||
    !digestPattern.test(appDigest) || !digestPattern.test(updaterDigest)) {
  throw new Error('Das Release enthält unerwartete Docker-Images.');
}
const archiveName = `logbuch-web-${version}.tar`;
const archivePath = join(directory, archiveName);
const archiveHash = createHash('sha256');
for await (const chunk of createReadStream(archivePath)) archiveHash.update(chunk);
const archiveDigest = archiveHash.digest('hex');
const expectedUrl = `https://github.com/${repository}/releases/download/${tag}/${archiveName}`;
if (manifest?.web?.url !== expectedUrl || manifest?.web?.sha256 !== archiveDigest ||
    (await fs.readFile(join(directory, 'checksums.txt'), 'utf8')).trim() !== `${archiveDigest}  ${archiveName}` ||
    (await fs.readFile(join(directory, 'release-notes.md'), 'utf8')).trim() === '') {
  throw new Error('Release-Dateien und Manifest passen nicht zusammen.');
}
const archiveVersion = execFileSync('tar', ['-xOf', archivePath, 'VERSION'], { encoding: 'utf8', maxBuffer: 1024 }).trim();
if (archiveVersion !== version) throw new Error('Die Archiv-Version passt nicht zum Tag.');

execFileSync('git', ['fetch', '--force', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], { stdio: 'inherit' });
const tagCommit = execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
if (tagCommit !== expectedCommit) throw new Error('Der Tag zeigt nicht mehr auf den geprüften Commit.');
execFileSync('git', ['merge-base', '--is-ancestor', tagCommit, 'origin/main']);

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, [
    `version=${version}`,
    `tag=${tag}`,
    `image=${image}`,
    `app_digest=${appDigest}`,
    `updater_image=${updaterImage}`,
    `updater_digest=${updaterDigest}`,
    '',
  ].join('\n'));
}
