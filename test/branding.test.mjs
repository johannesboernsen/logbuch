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
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /data-toggle-project-status-group/);
  assert.match(ui, /data-toggle-project-folder-group/);
  assert.match(ui, /data-project-folder-group/);
  assert.match(ui, /project-status-divider project-list-divider/);
  assert.match(ui, /project-list-divider folder-list-divider/);
  assert.match(ui, /data-toggle-project-folder-group[\s\S]+?<\/button><h2>Ordner <b>\(\$\{folders\.length\}\)<\/b><\/h2>/);
  assert.match(ui, /data-project-status-count/);
  assert.match(ui, /data-new-project-status="\$\{escapeHtml\(status\)\}"/);
  assert.match(ui, /data-new-folder aria-label="Ordner anlegen"/);
  assert.match(ui, /openProjectDialog\(null, \{ status:statusButton\.dataset\.newProjectStatus \}\)/);
  assert.match(ui, /form\.elements\.status\.value = project\?\.status \|\| \(regularProjectStatuses\.includes\(status\) \? status : 'active'\)/);
  assert.match(ui, /document\.querySelectorAll\('\[data-new-folder\]'\)/);
  assert.match(ui, /count\.textContent = `\(\$\{statusCards\.length\}\)`/);
  assert.match(ui, /dedicatedStatusSection = regularProjectStatuses\.includes\(state\.projectStatusFilter\)/);
  assert.match(ui, /separateStatuses = dedicatedStatusSection \|\|/);
  assert.match(ui, /collapsibleFolders = dedicatedStatusSection \|\| state\.projectStatusFilter === 'all'/);
  assert.match(ui, /groupedByStatus = !archived && \(\(state\.projectStatusFilter === 'all'[\s\S]+regularProjectStatuses\.includes\(state\.projectStatusFilter\)\)/);
  assert.match(css, /\.project-list-divider h2 \{[^}]+font-size:15px;[^}]+font-weight:750;/);
  assert.match(css, /\.project-group-head \{[^}]+display:flex;/);
  assert.match(css, /\.project-group-head > \.project-list-divider \{[^}]+flex:1;/);
  assert.match(css, /\.project-list-divider::after,\.log-section-divider::after \{ flex-grow:2; \}/);
  assert.match(css, /@media \(max-width:780px\)[\s\S]+\.project-list-divider::before,\.project-list-divider::after,\.log-section-divider::before,\.log-section-divider::after \{ flex-grow:1; \}/);
  assert.doesNotMatch(css, /\.project-list-divider::before \{ display:none; \}/);
});

test('Projektstatus-Anzeigen enthalten das Startdatum mit kurzer Beschriftung', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.ok((ui.match(/<small>Start<\/small>/g) || []).length >= 3);
  assert.ok((ui.match(/<small>Fällig<\/small>/g) || []).length >= 2);
  assert.doesNotMatch(ui, /desktop-status-label">Projektstatus/);
  assert.match(ui, /desktop-status-label">Projektdaten[\s\S]+?mobileStatusToggle\('Statusdetails'\)[\s\S]+?project-hero-actions[\s\S]+?<small>Status<\/small>\$\{projectStatusControl\(p\)\}/);
  assert.match(ui, /project\.createdAt \? formatDate\(project\.createdAt\) : 'ohne'/);
  assert.match(ui, /p\.createdAt \? formatDate\(p\.createdAt\) : 'ohne'/);
  assert.match(css, /\.project-status,\.project-priority \{[^}]+color:#626973; background:#e9ecef;/);
  assert.match(css, /\.project-priority\.hoch \{ color:#a33d42; background:#f8e5e6; \}/);
  assert.match(css, /\.project-status-row > \.project-status,[^}]+\.project-hero-fact > \.project-priority \{ width:112px;/);
  assert.doesNotMatch(css, /\.project-status\.(idea|active|paused|completed|archived|trashed) \{/);
  assert.doesNotMatch(css, /\.project-priority\.(mittel|gering) \{/);
  assert.doesNotMatch(css, /\.task-(status|priority)\.(open|in-progress|normal|niedrig) \{/);
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

test('Globale Suche ist im Hauptmenü erreichbar und filterbar', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="global-search-form"[\s\S]+id="global-search-input"/);
  assert.match(html, /id="global-search-form"[\s\S]+type="submit"[\s\S]+Suche starten/);
  assert.match(html, /class="sidebar-bottom"[\s\S]+id="global-search-form"/);
  assert.doesNotMatch(html, /device-state|device-host|Logbuch online/);
  assert.match(ui, /async function renderGlobalSearch/);
  assert.match(ui, /name="type"/);
  assert.match(ui, /name="status"/);
  assert.match(ui, /name="sort"/);
  assert.match(ui, /parts\[0\] === 'search'/);
  assert.match(css, /\.global-search-results/);
  assert.match(css, /\.sidebar-search/);
});

test('Persönliche To-dos besitzen einen eigenständigen kompakten Bereich', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /href="\/#\/todos"[^>]+data-route="todos"/);
  assert.match(ui, /async function renderTodos\(\)/);
  assert.match(ui, /Kurze persönliche Erinnerungen ohne Projektbezug/);
  assert.match(ui, /data-reorder-list="todos"/);
  assert.match(ui, /document\.querySelectorAll\('\[data-todo-id\]'\)/);
  assert.match(ui, /input\.onblur = \(\) => saveTodoEdit\(form\)/);
  assert.match(ui, /!form\.contains\(event\.target\)\) saveTodoEdit\(form\)/);
  assert.match(ui, /event\.key === 'Enter'[\s\S]+saveTodoEdit\(form\)/);
  assert.doesNotMatch(ui, /data-edit-todo=/);
  assert.match(ui, /\/todos\/completed/);
  assert.match(css, /\.todo-list\[hidden\]\s*\{\s*display:none;/);
});

test('Logbuch-Abschnitte verwenden kurze Statusüberschriften und Plus-Schaltflächen', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /completed \? 'Abgeschlossen' : 'Anstehend'/);
  assert.match(ui, /project-status-divider log-section-divider/);
  assert.match(ui, /data-toggle-log-section="\$\{section\}"/);
  assert.match(ui, /data-toggle-log-section="\$\{section\}"[\s\S]+?<\/button><h2>\$\{escapeHtml\(label\)\}<\/h2>/);
  assert.doesNotMatch(ui, /<small>Status<\/small><span class="project-status completed">Erledigt<\/span>/);
  assert.doesNotMatch(ui, /data-task-inline-status/);
  assert.doesNotMatch(ui, /\['Status', task\.status \|\| 'Offen'\]/);
  assert.match(ui, /<small>Erledigt am<\/small><span class="project-status-value">\$\{formatDate\(entry\.date\)\}<\/span>/);
  assert.match(ui, /workstep-add-button[^>]+aria-label="Arbeitsschritt hinzufügen"[^>]*>\+<\/button>/);
  assert.match(ui, /workstep-add-button[^>]+aria-label="Abgeschlossenen Arbeitsschritt hinzufügen"[^>]*>\+<\/button>/);
  assert.match(css, /\.log-section-divider \{[^}]+flex:1;[^}]+color:var\(--muted\);/);
  assert.match(css, /\.log-section-divider h2[^}]+font-size:15px;[^}]+font-weight:750;/);
  assert.doesNotMatch(css, /\.log-section-divider::before \{ display:none; \}/);
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

test('Einzelne Projekte lassen sich als Rohdaten und farbiges PDF exportieren', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /const projectExportButton/);
  assert.match(ui, /\/api\/backup\/projects\/\$\{encodeURIComponent\(project\.id\)\}/);
  assert.match(ui, /href="\/api\/backup\/projects"/);
  assert.match(ui, /loadUsers\(\), loadProjects\(\), loadTags\(\), loadFolders\(\), loadServerSettings\(\), loadStorageStats\(\)/);
  assert.match(ui, /api\('\/import\/projects-archive'/);
  assert.match(ui, /projects\/\$\{encodeURIComponent\(project\.id\)\}\/export/);
  assert.match(ui, /renderProjectExport/);
  assert.match(ui, /projectPrintMarkup\(project, true\)/);
  assert.match(ui, /projectExportFileRecord/);
  assert.match(ui, /file\.description/);
  assert.match(ui, /attachmentEntity\(file\.association\.collection/);
  assert.match(ui, /Projekt- oder Backup-Archiv/);
  assert.match(ui, /payload\.append\('archive', selectedProjects/);
  assert.match(css, /\.project-export-mode \.project-print-header img \{ filter:none; \}/);
  assert.match(css, /\.project-export-mode \.project-print-section-head \{ border-bottom-color:var\(--brand-red\); \}/);
  assert.match(css, /\.project-export-image/);
});

test('Projektdateien sind zentral und an allen Inhaltsarten verfügbar', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  assert.match(html, /id="file-dialog"/);
  assert.match(html, /Maximal 50 MB/);
  assert.match(ui, /\['files','Dateien'/);
  assert.match(ui, /function filesView/);
  assert.match(ui, /function attachmentStrip/);
  assert.match(ui, /data-file-jump/);
  assert.match(ui, /data-rotate-file/);
  assert.match(ui, /project\.files \|\| \[\]/);
  assert.match(ui, /\/api\/backup\/projects/);
  assert.match(css, /\.file-grid/);
  assert.match(css, /\.entity-attachments/);
  assert.match(css, /\.attachment-add \{[^}]+height:26px;[^}]+color:var\(--muted\);[^}]+background:transparent;/);
  assert.match(dockerfile, /upload_max_filesize=4G/);
  assert.match(ui, /function attachmentThumbnailUrl/);
  assert.match(ui, /loading="lazy" decoding="async"/);
  assert.match(ui, /visibleProjectFiles:50/);
});

test('Bilder öffnen sich in einem erweiterbaren internen Betrachter', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="file-viewer-dialog"/);
  assert.match(html, /id="file-viewer-content"/);
  assert.match(html, /id="file-viewer-rotate-left"/);
  assert.match(html, /id="file-viewer-rotate-right"/);
  assert.match(html, /id="file-viewer-form"[\s\S]+name="displayName"[\s\S]+name="description"/);
  assert.match(ui, /function openFileViewer/);
  assert.match(ui, /data-view-file/);
  assert.match(ui, /rotateViewedFile\(-90/);
  assert.match(ui, /rotateViewedFile\(90/);
  assert.match(css, /\.file-viewer-layout/);
  assert.match(css, /\.file-viewer-content/);
});

test('Dateianhänge an Arbeitsschritten sind vertikale Vorschauzeilen', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /attachment-thumbnail image/);
  assert.match(ui, /attachment-name/);
  assert.match(ui, /attachment-size.*formatBytes\(file\.size\)/);
  assert.match(css, /\.entity-attachments \{[^}]+display:grid;/);
  assert.match(css, /\.attachment-row \{[^}]+grid-template-columns:90px minmax\(0,1fr\) auto;/);
  assert.match(css, /\.attachment-thumbnail \{ width:90px; height:60px;/);
});

test('Dateien können bereits beim Anlegen von Projektinhalten ausgewählt werden', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.ok((html.match(/name="attachments" type="file" multiple/g) || []).length >= 2);
  assert.match(html, /Optional · jeweils maximal 50 MB/);
  assert.match(ui, /function uploadDialogAttachments/);
  assert.match(ui, /uploadDialogAttachments\(form\.projectId, 'entries', saved\.id, files\)/);
  assert.match(ui, /uploadDialogAttachments\(form\.projectId, form\.collection, saved\.id, files\)/);
  assert.match(ui, /selectedDialogAttachments/);
  assert.match(css, /\.dialog-attachments/);
});

test('Erfassungsdialoge begrenzen breite Inhalte auf das Fenster', async () => {
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /dialog form \{ min-width:0;[^}]+grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.item-fields \{ min-width:0;[^}]+grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.dialog-attachments \{ min-width:0; max-width:100%;[^}]+overflow:hidden/);
  assert.match(css, /\.dialog-actions \{[^}]+flex-wrap:wrap/);
  assert.match(css, /@media \(max-width:420px\)[\s\S]+\.dialog-actions \{ width:100%; display:grid; grid-template-columns:1fr;/);
});

test('Ausgewählte Upload-Dateien stehen im Dialog untereinander', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /files\.map\(\(file, index\) => `<span class="dialog-selected-file"/);
  assert.match(ui, /data-remove-dialog-attachment="\$\{index\}"/);
  assert.match(ui, /const transfer = new DataTransfer\(\)/);
  assert.match(ui, /summary\.scrollHeight > summary\.clientHeight/);
  assert.match(css, /\.dialog-attachment-summary \{[^}]+padding-right:4px;[^}]+overflow-y:auto;[^}]+scrollbar-gutter:stable;/);
  assert.match(css, /\.dialog-attachment-summary\.is-overflowing \{[^}]+overflow-y:scroll;[^}]+scrollbar-color:/);
  assert.match(css, /\.dialog-attachment-summary\.is-overflowing::\-webkit-scrollbar-thumb/);
  assert.match(css, /\.dialog-selected-file \{[^}]+grid-template-columns:minmax\(0,1fr\) auto 22px;/);
  assert.doesNotMatch(css, /\.dialog-selected-file \{[^}]+background:#fff/);
});
