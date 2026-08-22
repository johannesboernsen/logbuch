import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const ignoredDirectories = new Set(['.git', 'node_modules', 'logbuch-data', 'storage']);
const textExtensions = new Set(['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.php', '.sh', '.svg', '.yaml', '.yml']);
const legacyBrand = new RegExp(['Make:', 'Log', '|Make', 'Log(?!buch)', '|make-', 'log', '|make', 'log', '|Maker', 'Logbuch', '|maker', 'logbuch', '|Projekt', 'tagebuch'].join(''), 'i');

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

test('Quellcode und Dateinamen enthalten keine alten Produktbezeichnungen', async () => {
  const violations = [];
  for (const path of await sourceFiles(root)) {
    const projectPath = relative(root, path);
    if (legacyBrand.test(projectPath) || legacyBrand.test(await readFile(path, 'utf8'))) violations.push(projectPath);
  }
  assert.deepEqual(violations, []);
});

test('Logbuch ist in den UI-Texten grammatikalisch eingebunden', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(ui, /beim Öffnen des Logbuchs/);
  const bareAfterPreposition = new RegExp(['\\b(?:von|zu|in|bei|an|für|ohne) ', 'Logbuch\\b'].join(''), 'i');
  assert.doesNotMatch(ui, bareAfterPreposition);
});
