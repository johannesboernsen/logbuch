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

test('Projektkarten kollidieren nicht mit Statusaktions-Selektoren', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(ui, /data-project-card-status=/);
  assert.doesNotMatch(ui, /data-project-card data-project-status=/);
});

test('Projekt- und Ordnergruppen sind in der Alle-Ansicht einklappbar', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(ui, /data-toggle-project-status-group/);
  assert.match(ui, /data-toggle-project-folder-group/);
  assert.match(ui, /data-project-folder-group/);
});

test('Projektstatus-Anzeigen enthalten das Startdatum', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.ok((ui.match(/<small>Startdatum<\/small>/g) || []).length >= 3);
  assert.match(ui, /project\.createdAt \? formatDate\(project\.createdAt\) : 'ohne'/);
  assert.match(ui, /p\.createdAt \? formatDate\(p\.createdAt\) : 'ohne'/);
});

test('Projekte besitzen eine vollständige DIN-A4-Druckansicht', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /renderProjectPrint/);
  assert.match(ui, /Drucken \/ als PDF speichern/);
  for (const collection of ['tasks', 'entries']) {
    assert.match(ui, new RegExp(`project\\.${collection}`));
  }
  for (const collection of ['notes', 'materials', 'contacts', 'links', 'ideas', 'learnings']) {
    assert.match(ui, new RegExp(`\\['${collection}',`));
  }
  assert.match(ui, /project\[collection\]/);
  assert.match(css, /@page \{ size:A4 portrait;/);
  assert.match(css, /break-inside:avoid-page/);
  assert.match(css, /project-print-header img[^}]+filter:grayscale\(1\) brightness\(0\)/);
  assert.match(css, /project-print-facts > div[^}]+background:#fff/);
  assert.match(css, /project-print-record[^}]+background:#fff/);
  assert.match(css, /project-print-section-head > span[^}]+border:1px solid #202327[^}]+color:#202327[^}]+background:#fff/);
  assert.match(css, /project-print-section > \.project-print-records \{ margin-top:2\.5mm; \}/);
});
