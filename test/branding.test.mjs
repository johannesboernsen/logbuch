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

test('Projektseiten besitzen eine eigenständige kompakte Smartphone-Bedienung', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /mobile-header-main[\s\S]+id="menu-button"[\s\S]+class="brand"/);
  assert.match(html, /id="mobile-header-actions"/);
  assert.match(ui, /bindMobileProjectControls/);
  assert.match(ui, /data-mobile-status-panel/);
  assert.match(ui, /project-card-collapsible-status mobile-collapsed/);
  assert.match(ui, /project-card-status-content/);
  assert.match(ui, /mobile-workstep-menu/);
  assert.match(ui, /mobile-overview-config/);
  assert.match(ui, /mobile-project-nav/);
  assert.match(ui, /aria-label="Projektbereich wählen"/);
  assert.match(css, /@media \(max-width:780px\)[\s\S]+workstep-card-status\.mobile-collapsed \.workstep-status-content \{ display:none; \}/);
  assert.match(css, /project-hero-status\.mobile-collapsed \.project-hero-facts \{ display:none; \}/);
  assert.match(css, /project-card-collapsible-status\.mobile-collapsed \.project-card-status-content \{ display:none; \}/);
  assert.match(css, /mobile-workstep-actions \.drag-handle[^}]+width:44px; height:44px/);
  assert.match(css, /overview-head > \.desktop-overview-config \{ display:none; \}/);
  assert.match(css, /mobile-project-status-controls \{[^}]+display:flex;/);
  assert.match(css, /mobile-project-status-controls > \.mobile-status-toggle \{[^}]+margin-left:auto; flex:none; justify-content:flex-start;/);
  assert.match(css, /mobile-project-nav > summary \{[^}]+color:#fff;[^}]+background:var\(--brand-red\);/);
  assert.match(css, /mobile-project-nav \.menu-item\.active/);
  assert.match(css, /project-subnav \{ display:none; \}/);
});

test('Logbuch-Abschnitte verwenden kurze Statusüberschriften und Plus-Schaltflächen', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /completed \? 'Abgeschlossen' : 'Anstehend'/);
  assert.match(ui, /workstep-add-button[^>]+aria-label="Arbeitsschritt hinzufügen"[^>]*>\+<\/button>/);
  assert.match(ui, /workstep-add-button[^>]+aria-label="Abgeschlossenen Arbeitsschritt hinzufügen"[^>]*>\+<\/button>/);
  assert.match(css, /\.workstep-add-button \{ width:36px; height:36px;/);
  assert.match(css, /\.workstep-add-button \{ width:44px; height:44px; font-size:23px; \}/);
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
  assert.match(ui, /if \(!items\.length\) return '';/);
  assert.match(ui, /const logbook = logbookContents \?/);
  assert.match(css, /@page \{ size:A4 portrait;/);
  assert.match(css, /break-inside:avoid-page/);
  assert.match(css, /project-print-header img[^}]+filter:grayscale\(1\) brightness\(0\)/);
  assert.match(css, /project-print-facts > div[^}]+background:#fff/);
  assert.match(css, /project-print-record[^}]+background:#fff/);
  assert.match(css, /project-print-section-head > span[^}]+border:1px solid #202327[^}]+color:#202327[^}]+background:#fff/);
  assert.match(css, /project-print-section > \.project-print-records \{ margin-top:2\.5mm; \}/);
});
