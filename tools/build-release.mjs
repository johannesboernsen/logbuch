import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

const [version, image, digest, output = 'dist'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error('Version fehlt oder ist ungültig.');
if (!/^ghcr\.io\/[a-z0-9._/-]+$/.test(image || '')) throw new Error('Container-Image ist ungültig.');
if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('Container-Digest ist ungültig.');

const root = resolve(new URL('..', import.meta.url).pathname);
const outputPath = resolve(root, output);
const stage = join(outputPath, `makelog-web-${version}`);
const releasePaths = ['app', 'public', 'config', 'VERSION', 'SCHEMA_VERSION'];
try { await stat(join(root, 'database')); releasePaths.push('database'); } catch {}

await rm(outputPath, { recursive:true, force:true });
await mkdir(stage, { recursive:true });
for (const path of releasePaths) await cp(join(root, path), join(stage, path), { recursive:true });

const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink im Release nicht erlaubt: ${path}`);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) {
      const name = relative(stage, path).split('\\').join('/');
      files[name] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
}
await collect(stage);
await writeFile(join(stage, 'RELEASE_FILES.json'), `${JSON.stringify({ version, files:Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) }, null, 2)}\n`);

const archiveName = `makelog-web-${version}.tar`;
const archivePath = join(outputPath, archiveName);
execFileSync('tar', ['-cf', archivePath, '-C', stage, ...releasePaths, 'RELEASE_FILES.json'], { stdio:'inherit', env:{ ...process.env, COPYFILE_DISABLE:'1' } });
const archiveHash = createHash('sha256').update(await readFile(archivePath)).digest('hex');
const repository = process.env.MAKELOG_RELEASE_REPOSITORY || 'johannesboernsen/make-log-releases';
const tag = `v${version}`;
const manifest = {
  format:'make-log-update',
  manifestVersion:1,
  version,
  channel:version.includes('-') ? 'beta' : 'stable',
  publishedAt:new Date().toISOString(),
  minimumPhp:'8.2.0',
  summary:`Make:Log ${version} ist verfügbar. Details stehen in den GitHub Release Notes.`,
  releaseNotesUrl:`https://github.com/${repository}/releases/tag/${tag}`,
  database:{ schemaVersion:Number((await readFile(join(root, 'SCHEMA_VERSION'), 'utf8')).trim()) },
  web:{
    url:`https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
    sha256:archiveHash,
    files:Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  },
  docker:{ image, digest },
};
await writeFile(join(outputPath, 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(outputPath, 'checksums.txt'), `${archiveHash}  ${basename(archivePath)}\n`);
await rm(stage, { recursive:true, force:true });
