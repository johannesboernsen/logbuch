import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';

const [path, expectedCommit] = process.argv.slice(2);
const candidate = JSON.parse(await fs.readFile(path, 'utf8'));
const version = typeof candidate.version === 'string' ? candidate.version : candidate.tag?.slice(1);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') ||
    candidate.tag !== `v${version}` || !/^[a-f0-9]{40}$/.test(candidate.commit || '') ||
    candidate.commit !== expectedCommit) {
  throw new Error('Tag-Kandidat und auslösender Workflow passen nicht zusammen.');
}
execFileSync('git', ['fetch', '--force', '--no-tags', 'origin', `refs/tags/${candidate.tag}:refs/tags/${candidate.tag}`], { stdio: 'inherit' });
const commit = execFileSync('git', ['rev-parse', `refs/tags/${candidate.tag}^{commit}`], { encoding: 'utf8' }).trim();
if (commit !== expectedCommit) throw new Error('Der Tag zeigt nicht auf den auslösenden Commit.');
execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
const sourceVersion = execFileSync('git', ['show', `${commit}:VERSION`], { encoding: 'utf8' }).trim();
if (sourceVersion !== version) throw new Error('Die Version im Tag-Commit stimmt nicht überein.');
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${candidate.tag}\ncommit=${commit}\n`);
}
