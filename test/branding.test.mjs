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

test('Das Favicon zeigt ausschließlich ein einzelnes L', async () => {
  const favicon = await readFile(join(root, 'public', 'favicon.svg'), 'utf8');
  const app = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const installer = await readFile(join(root, 'public', 'install.html'), 'utf8');
  assert.match(favicon, /<path fill="#ffffff"/);
  assert.doesNotMatch(favicon, /<text|>ML</);
  assert.match(app, /favicon\.svg\?v=20260824-1/);
  assert.match(installer, /favicon\.svg\?v=20260824-1/);
});

test('Der Update-Hinweis folgt dem geöffneten Einstellungsmenü bis System', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="settings-toggle"[\s\S]+id="update-badge"[\s\S]+data-settings-route="system"[\s\S]+id="system-update-badge"/);
  assert.match(ui, /settingsBadge\.hidden = !available \|\| menuOpen/);
  assert.match(ui, /systemBadge\.hidden = !available \|\| !menuOpen/);
  assert.match(ui, /subnav\.hidden = !open;\s+updateUpdateBadge\(\)/);
  assert.match(css, /\.settings-toggle \{[^}]+padding-right:8px;[^}]+gap:10px;/);
  assert.match(css, /\.update-nav-badge \{[^}]+flex:none;/);
  assert.match(css, /\.settings-subnav \.update-nav-badge/);
});

test('Der eingeklappte Projekt-Menüpunkt zeigt die Anzahl aktiver Projekte', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="projects-toggle"[\s\S]+id="project-nav-count"/);
  assert.match(html, /id="project-nav-count"[^>]*title="Anzahl der aktiven Projekte"[^>]*>0<\/i>/);
  assert.doesNotMatch(html, /id="project-nav-count"[^>]*\shidden[^>]*>/);
  assert.match(ui, /badge\.textContent = String\(counts\.active\)/);
  assert.match(ui, /badge\.title = 'Anzahl der aktiven Projekte'/);
  assert.match(ui, /badge\.hidden = menuOpen;/);
  assert.match(ui, /loadProjects\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(ui, /badge\.dataset\.count = String\(counts\.active\)/);
  assert.match(ui, /badge\.hidden = open;/);
  assert.match(css, /\.project-nav-count \{[^}]+line-height:1;/);
});

test('Projekt- und Einstellungsmenü bleiben im aktiven Bereich geöffnet', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(ui, /\$\('#settings-toggle'\)\.onclick = \(\) => \{\s+if \(\$\('#settings-toggle'\)\.getAttribute\('aria-expanded'\) === 'true'\) return;/);
  assert.match(ui, /\$\('#projects-toggle'\)\.onclick = async \(\) => \{\s+if \(\$\('#projects-toggle'\)\.getAttribute\('aria-expanded'\) === 'true'\) return;/);
  assert.match(ui, /const settingsActive = routeName === 'settings';[\s\S]+setSettingsMenu\(settingsActive\);[\s\S]+setProjectsMenu\(projectsActive, projectStatus\);/);
  assert.match(ui, /toggle\.title = open \? 'Projekte' : 'Projektmenü aufklappen'/);
  assert.doesNotMatch(ui, /Projektmenü zuklappen/);
});

test('Projektkarten kollidieren nicht mit Statusaktions-Selektoren', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(ui, /data-project-card-status=/);
  assert.doesNotMatch(ui, /data-project-card data-project-status=/);
});

test('Weiße Seitenköpfe verwenden ein gemeinsames Höhen- und Ausrichtungsraster', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /function standardPageHeader/);
  assert.match(ui, /project-page-head standard-page-head standard-plain-page-head/);
  assert.match(ui, /standardPageHeader\(\{ title:'Übersicht'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Erinnerungen'/);
  assert.match(ui, /standardPageHeader\(\{ title, description:currentFolder/);
  assert.match(ui, /standardPageHeader\(\{ title:'Archiv'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Papierkorb'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Artikel'[^\n]+icon:'tag'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Nachbestellen'[^\n]+icon:'shopping-cart'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Lager'[^\n]+icon:'warehouse'/);
  assert.match(ui, /standardPageHeader\(\{ title:'Archiv'[^\n]+icon:'archive'/);
  assert.doesNotMatch(ui, /function normalizePlainPageHeader/);
  assert.match(ui, /standardPageHeader\(\{ title:'Suche'/);
  assert.match(ui, /standardPageHeader\(\{ title, description, icon:'settings'/);
  assert.doesNotMatch(ui, /normalizeCommonPageHeader/);
  assert.match(css, /\.standard-page-head \{[^}]+height:154px;[^}]+min-height:154px;/);
  assert.match(css, /\.standard-page-breadcrumbs \{[^}]+height:20px;/);
  assert.match(css, /\.standard-page-head \.project-heading-row \{[^}]+height:88px;[^}]+align-items:center;/);
  assert.match(css, /\.standard-page-head \.project-hero-icon \{ width:54px; height:54px; \}/);
  assert.match(css, /\.standard-page-head \.project-hero-icon svg \{[^}]+stroke:currentColor;/);
  assert.match(css, /\.standard-page-head \.standard-page-head-actions \{[^}]+align-items:center;[^}]+justify-content:flex-end;/);
  assert.match(ui, /<div class="project-page-breadcrumbs">\$\{breadcrumbs\}<\/div><div class="project-page-head"><section class="project-hero">/);
  assert.doesNotMatch(ui, /<div class="project-page-breadcrumbs">\$\{breadcrumbs\}<\/div><div class="project-page-head standard-page-head">/);
});

test('Projekt- und Ordnergruppen sind in der Alle-Ansicht einklappbar', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /data-toggle-project-status-group/);
  assert.match(ui, /data-toggle-project-folder-group/);
  assert.match(ui, /data-project-folder-group/);
  assert.match(ui, /project-status-divider project-list-divider/);
  assert.match(ui, /project-list-divider folder-list-divider/);
  assert.match(ui, /data-toggle-project-folder-group[\s\S]+?divider-label">Ordner <b>\(\$\{folders\.length\}\)<\/b><\/strong><\/button>/);
  assert.match(ui, /data-project-status-count/);
  assert.match(ui, /project-divider-toggle[\s\S]+divider-label[\s\S]+data-project-status-count/);
  assert.match(ui, /button\.querySelector\('\.divider-label'\)/);
  assert.doesNotMatch(ui, /data-new-project-status/);
  assert.doesNotMatch(ui, /project-divider-add/);
  assert.match(ui, /data-open-project-create/);
  assert.match(ui, /actions:`\$\{projectListControls\(false, projects\)\}\$\{addButton\}`/);
  assert.match(ui, /Projekt oder Ordner hinzufügen/);
  assert.match(html, /id="project-create-dialog"[\s\S]+data-project-create-choice="project"[\s\S]+data-project-create-choice="folder"/);
  assert.match(ui, /openProjectDialog\(null, \{ status \}\)/);
  assert.match(ui, /form\.elements\.status\.value = project\?\.status \|\| \(regularProjectStatuses\.includes\(status\) \? status : 'active'\)/);
  assert.match(ui, /openFolderDialog\(\)/);
  assert.match(ui, /count\.textContent = `\(\$\{statusCards\.length\}\)`/);
  assert.match(ui, /dedicatedStatusSection = regularProjectStatuses\.includes\(state\.projectStatusFilter\)/);
  assert.match(ui, /separateStatuses = dedicatedStatusSection \|\|/);
  assert.match(ui, /collapsibleFolders = dedicatedStatusSection \|\| state\.projectStatusFilter === 'all'/);
  assert.match(ui, /breadcrumbs:folderBreadcrumbs\(state\.currentFolderId\)/);
  assert.match(ui, /className:'project-browser-page-head'/);
  assert.match(ui, /function standardPageHeader/);
  assert.match(ui, /groupedByStatus = !archived && \(\(state\.projectStatusFilter === 'all'[\s\S]+regularProjectStatuses\.includes\(state\.projectStatusFilter\)\)/);
  assert.match(css, /\.project-list-divider \.divider-label,\.log-section-divider \.divider-label \{[^}]+font-size:15px;[^}]+font-weight:750;/);
  assert.match(css, /\.project-divider-toggle::after,\.log-divider-toggle::after \{[^}]+width:14px;[^}]+content:'';/);
  assert.match(css, /\.project-status-divider button:hover \{ color:var\(--red\); background:transparent; \}/);
  assert.match(css, /\.project-browser-create-toolbar \{ margin-bottom:18px; \}/);
  assert.match(css, /\.project-group-head \{[^}]+display:flex;/);
  assert.match(css, /\.project-group-head > \.project-list-divider \{[^}]+flex:1;/);
  assert.match(css, /\.project-list-divider::before,\.log-section-divider::before \{ flex-grow:1; \}/);
  assert.match(css, /\.project-list-divider::after,\.log-section-divider::after \{ flex-grow:1; \}/);
  assert.doesNotMatch(css, /\.project-list-divider::after,\.log-section-divider::after \{ flex-grow:2; \}/);
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
  assert.match(css, /\.project-status,\.project-priority \{[^}]+color:var\(--ink-soft\); background:var\(--interactive-hover\);/);
  assert.match(css, /\.project-priority\.hoch \{ color:var\(--danger-strong\); background:var\(--danger-soft\); \}/);
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
  assert.match(ui, /standardPageHeader\(\{ title:'Übersicht'/);
  assert.match(ui, /standardPageHeader\(\{ title, description, icon:'settings'/);
  assert.match(ui, /className:'settings-page-head'/);
  assert.match(ui, /project-add-button/);
  assert.match(ui, /aria-label="Projektinhalt hinzufügen"/);
  assert.match(css, /@media \(max-width:780px\)[\s\S]+workstep-card-status\.mobile-collapsed \.workstep-status-content \{ display:none; \}/);
  assert.match(css, /project-hero-status\.mobile-collapsed \.project-hero-facts \{ display:none; \}/);
  assert.match(css, /project-card-collapsible-status\.mobile-collapsed \.project-card-status-content \{ display:none; \}/);
  assert.match(css, /mobile-workstep-actions \.drag-handle[^}]+width:44px; height:44px/);
  assert.match(css, /overview-page-head \.desktop-overview-config \{ display:none; \}/);
  assert.match(css, /\.standard-page-head \{[^}]+height:154px;[^}]+min-height:154px;/);
  assert.match(css, /mobile-project-status-controls \{[^}]+display:flex;/);
  assert.match(css, /mobile-project-status-controls > \.mobile-status-toggle \{[^}]+margin-left:auto; flex:none; justify-content:flex-start;/);
  assert.match(css, /\.project-add-button \{[^}]+width:44px;[^}]+height:44px;/);
  assert.match(css, /\.project-add-button b \{ display:none; \}/);
});

test('Globale Suche ist im Hauptmenü erreichbar und filterbar', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="global-search-form"[\s\S]+id="global-search-input"/);
  assert.match(html, /id="global-search-form"[\s\S]+type="submit"[\s\S]+Suche starten/);
  assert.match(html, /class="sidebar-search-clear"[\s\S]+Suchbegriff löschen/);
  assert.match(html, /class="sidebar-bottom"[\s\S]+id="global-search-form"/);
  assert.doesNotMatch(html, /device-state|device-host|Logbuch online/);
  assert.match(ui, /async function renderGlobalSearch/);
  assert.match(ui, /standardPageHeader\(\{ title:'Suche'/);
  assert.match(ui, /project-page-content search-page-content/);
  assert.match(ui, /data-clear-global-search/);
  assert.match(ui, /searchInput\.value = '';/);
  assert.match(ui, /function syncSidebarSearchClear/);
  assert.match(ui, /routeName !== 'search'[\s\S]+global-search-input'[\s\S]+value = ''/);
  assert.match(ui, /name="type"/);
  assert.match(ui, /name="status"/);
  assert.match(ui, /name="sort"/);
  assert.match(ui, /parts\[0\] === 'search'/);
  assert.match(css, /\.global-search-results/);
  assert.match(css, /\.global-search-input-wrap \[data-clear-global-search\]/);
  assert.match(css, /\.sidebar-search/);
  assert.match(css, /\.sidebar-search-clear/);
});

test('Persönliche Erinnerungen besitzen einen eigenständigen kompakten Bereich', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /href="\/#\/todos"[^>]+data-route="todos"/);
  assert.match(html, /> Erinnerungen <i id="todo-nav-count"[^>]*title="Anzahl der offenen Erinnerungen"/);
  assert.doesNotMatch(html, /id="todo-nav-count"[^>]*\shidden[^>]*>/);
  assert.match(ui, /const count = state\.todos\.filter\(todo => !todo\.completedAt\)\.length;/);
  assert.match(ui, /badge\.textContent = String\(count\);\s*badge\.hidden = false;/);
  assert.match(ui, /badge\.title = 'Anzahl der offenen Erinnerungen'/);
  assert.match(ui, /`Anzahl der offenen Erinnerungen: \$\{count\}`/);
  assert.match(ui, /async function renderTodos\(\)/);
  assert.doesNotMatch(ui, /Hier werden nur Erinnerungen ohne Projektbezug gesammelt/);
  assert.match(ui, /Notiere dir hier wichtige Dinge, die keinen Projektbezug haben\./);
  assert.doesNotMatch(ui, /ist es ein Arbeitsschritt und wird im Logbuch als anstehend oder erledigt angelegt/);
  assert.match(ui, /data-todo-tree/);
  assert.match(ui, /function bindTodoReordering\(\)/);
  assert.match(ui, /Als untergeordnete Erinnerung ablegen/);
  assert.match(ui, /data-todo-child-dropzone/);
  assert.match(ui, /has-children/);
  assert.match(ui, /collapsedTodoGroups/);
  assert.match(ui, /data-toggle-todo-children/);
  assert.match(ui, /Untergeordnete Erinnerungen einklappen/);
  assert.match(ui, /data-toggle-todo-section="\$\{section\}"/);
  assert.match(ui, /todoSectionToggle\('open', 'Offen'/);
  assert.match(ui, /todoSectionToggle\('completed', 'Erledigt'/);
  assert.match(ui, /data-todo-section-content="open"/);
  assert.match(ui, /data-todo-section-content="completed"/);
  assert.match(ui, /state\.todosOpenOpen = !state\.todosOpenOpen/);
  assert.match(css, /\.todo-section-toggle::after \{ width:14px; height:14px;/);
  assert.match(css, /\[data-todo-section-content\]\[hidden\] \{ display:none; \}/);
  assert.match(ui, /syncTodoGroupStates/);
  assert.match(ui, /const hoverDelay = 250/);
  assert.match(ui, /window\.setTimeout\(\(\) =>/);
  assert.match(ui, /const placeInChildDropzone = target =>/);
  assert.match(ui, /pendingChildTarget = target/);
  assert.match(ui, /placeholder\.remove\(\)/);
  assert.match(ui, /currentGroup === target\) placeInChildDropzone\(target\)/);
  assert.match(ui, /expandedTarget && hitGroup === expandedTarget && !draggedHasChildren/);
  assert.match(ui, /draggedParentId = node\.parentElement\.matches\('\[data-todo-children\]'\)/);
  assert.match(ui, /const setDraggedRootAppearance = root =>/);
  assert.match(ui, /setDraggedRootAppearance\(!parentId\)/);
  assert.match(ui, /syncDraggedLevelFromPlaceholder/);
  assert.match(ui, /dragged\.style\.width = `\$\{list\.getBoundingClientRect\(\)\.width\}px`/);
  assert.match(ui, /dragged\.style\.height = 'auto'/);
  assert.match(ui, /const groupCanReceiveChild = hitGroup[^;]+hitGroup\.dataset\.todoNodeId !== draggedParentId[^;]+!draggedHasChildren/);
  assert.match(ui, /if \(groupCanReceiveChild\) expandAfterPause\(hitGroup\)/);
  assert.match(ui, /hitGroup !== expandedTarget && !insideExpandedTarget\) collapseExpanded\(true\)/);
  assert.match(ui, /event\.key === 'ArrowLeft'/);
  assert.match(ui, /event\.key === 'ArrowRight'/);
  assert.match(ui, /document\.querySelectorAll\('\[data-todo-id\]'\)/);
  assert.match(ui, /input\.onblur = \(\) => saveTodoEdit\(form\)/);
  assert.match(ui, /!form\.contains\(event\.target\)\) saveTodoEdit\(form\)/);
  assert.match(ui, /event\.key === 'Enter'[\s\S]+saveTodoEdit\(form\)/);
  assert.doesNotMatch(ui, /data-edit-todo=/);
  assert.match(ui, /\/todos\/completed/);
  assert.match(ui, /data-cleanup-todos/);
  assert.match(ui, /\/todos\/cleanup/);
  assert.match(ui, /clearedAt/);
  assert.match(html, /id="todo-repeat-dialog"/);
  assert.match(ui, /data-repeat-todo/);
  assert.match(ui, /data-remove-todo-repeat/);
  assert.match(ui, /data-convert-todo/);
  assert.match(ui, /todoProjectControl[^\n]+defaultProjectIconName\(\)/);
  assert.match(ui, /Erinnerung in Projekt umwandeln/);
  assert.match(ui, /\/convert-to-project/);
  assert.match(ui, /confirmAction\(`Erinnerung „\$\{todo\.title\}“ in ein neues Projekt umwandeln\?/);
  assert.match(ui, /untergeordnete Erinnerung[^\n]+als anstehende Einträge übernommen/);
  assert.doesNotMatch(ui, /Wartet \(\$\{waitingCount\}\)/);
  assert.match(ui, /repeatDueAt/);
  assert.match(ui, /state\.todoRepeatTimer = setTimeout/);
  assert.match(css, /\.todo-repeat-action\.active/);
  assert.doesNotMatch(css, /\.todo-waiting-list \.todo-item/);
  assert.match(css, /\.todo-list\[hidden\]\s*\{\s*display:none;/);
  assert.match(css, /\.todo-group\.todo-drop-parent > \.todo-children/);
  assert.match(css, /\.todo-group\.has-children,\.todo-group\.todo-drop-parent\s*\{[^}]+border:1px[^}]+background:var\(--surface\)/);
  assert.match(css, /\.todo-group\.has-children > \.todo-item,\.todo-group\.todo-drop-parent > \.todo-item\s*\{[^}]+border:0/);
  assert.match(css, /\.todo-subitem \.todo-item\s*\{[^}]+min-height:48px[^}]+border:0[^}]+background:transparent/);
  assert.doesNotMatch(css, /\.todo-subitem \.todo-item:(?:hover|focus-within)/);
  assert.match(css, /\.todo-group\.has-children > \.todo-children\s*\{[^}]+margin:0 0 8px 34px[^}]+border-left:1px solid var\(--line\)[^}]+gap:2px/);
  assert.match(css, /\.todo-group\.todo-drop-parent > \.todo-children > \.todo-child-dropzone/);
  assert.match(css, /\.todo-children-toggle\[aria-expanded="false"\] svg/);
  assert.match(css, /\.todo-group\.children-collapsed:not\(\.todo-drop-parent\) > \.todo-children\s*\{\s*display:none;/);
  assert.match(css, /\.todo-group\.children-collapsed\.todo-drop-parent > \.todo-children > \[data-todo-node\]\s*\{\s*display:none;/);
  assert.match(css, /\.todo-drag-placeholder\.as-child/);
  assert.match(css, /\.todo-subitem\.dragging\.todo-drag-root \.todo-item\s*\{[^}]+min-height:62px[^}]+padding:10px 12px[^}]+border:1px solid var\(--line\)/);
  assert.doesNotMatch(css, /\.todo-drag-placeholder\.in-dropzone/);
});

test('Projektinhalte stehen gemeinsam in befüllten Abschnitten mit zentraler Erfassung', async () => {
  const html = await readFile(join(root, 'public', 'app.html'), 'utf8');
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /completed \? 'Abgeschlossen' : 'Anstehend'/);
  assert.match(ui, /project-status-divider log-section-divider/);
  assert.match(ui, /data-toggle-log-section="\$\{section\}"/);
  assert.match(ui, /data-toggle-log-section="\$\{section\}"[\s\S]+?divider-label">\$\{escapeHtml\(label\)\}<\/strong><\/button>/);
  assert.doesNotMatch(ui, /<small>Status<\/small><span class="project-status completed">Erledigt<\/span>/);
  assert.doesNotMatch(ui, /data-task-inline-status/);
  assert.doesNotMatch(ui, /\['Status', task\.status \|\| 'Offen'\]/);
  assert.match(ui, /<small>Erledigt am<\/small><span class="project-status-value">\$\{formatDate\(entry\.date\)\}<\/span>/);
  assert.match(html, /id="project-add-dialog"/);
  for (const collection of ['tasks','entries','notes','shopping','materials','contacts','links','ideas','learnings','files']) {
    assert.match(html, new RegExp(`data-project-add-choice="${collection}"`));
  }
  assert.match(ui, /function unifiedProjectView/);
  assert.match(ui, /definitions\.filter\(\(\[, count\]\) => count > 0\)/);
  assert.match(ui, /data-toggle-project-section/);
  assert.match(ui, /data-open-project-add/);
  assert.match(ui, /openProjectAddDialog/);
  assert.doesNotMatch(ui, /data-tab=/);
  assert.match(css, /\.log-section-divider \{[^}]+flex:1;[^}]+color:var\(--muted\);/);
  assert.match(css, /\.log-section-divider \.divider-label[^}]+font-size:15px;[^}]+font-weight:750;/);
  assert.doesNotMatch(css, /\.log-section-divider::before \{ display:none; \}/);
  assert.match(css, /\.unified-section-head button \{[^}]+justify-content:center;[^}]+text-align:center;/);
  assert.match(css, /\.unified-section-head button:hover \{ color:var\(--red\); background:transparent; \}/);
  assert.match(css, /\.unified-section-head button::after \{[^}]+width:18px;[^}]+content:'';/);
  assert.match(css, /\.project-unified-sections \{ display:grid;/);
  assert.match(css, /\.project-add-grid \{ display:grid;/);
});

test('Projekte besitzen eine vollständige DIN-A4-Druckansicht', async () => {
  const ui = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(ui, /renderProjectPrint/);
  assert.match(ui, /Drucken \/ als PDF speichern/);
  for (const collection of ['tasks', 'entries']) {
    assert.match(ui, new RegExp(`project\\.${collection}`));
  }
  for (const collection of ['notes', 'shopping', 'materials', 'contacts', 'links', 'ideas', 'learnings']) {
    assert.match(ui, new RegExp(`\\['${collection}',`));
  }
  assert.match(ui, /project\[collection\]/);
  assert.match(ui, /if \(!items\.length\) return '';/);
  assert.match(ui, /const logbook = logbookContents \?/);
  assert.match(css, /@page \{ size:A4 portrait;/);
  assert.match(css, /break-inside:avoid-page/);
  assert.match(css, /project-print-header img[^}]+filter:grayscale\(1\) brightness\(0\)/);
  assert.match(css, /body\.project-print-mode \{[^}]+--surface:#fff;[^}]+color-scheme:light;/);
  assert.match(css, /project-print-facts > div[^}]+background:var\(--surface\)/);
  assert.match(css, /project-print-record[^}]+background:var\(--surface\)/);
  assert.match(css, /project-print-section-head > span[^}]+border:1px solid #202327[^}]+color:#202327[^}]+background:var\(--surface\)/);
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
  assert.match(ui, /files:'Dateien'/);
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
  assert.match(html, /optional · jeweils maximal 50 MB/);
  assert.match(ui, /function uploadDialogAttachments/);
  assert.match(ui, /uploadDialogAttachments\(form\.projectId, 'entries', saved\.id, files\)/);
  assert.match(ui, /uploadDialogAttachments\(form\.projectId, form\.collection, saved\.id, files\)/);
  assert.match(ui, /selectedDialogAttachments/);
  assert.match(css, /\.dialog-attachments/);
});

test('Erfassungsdialoge begrenzen breite Inhalte auf das Fenster', async () => {
  const css = await readFile(join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.dialog-head h2 \+ \.dialog-copy \{ margin:6px 0 0; \}/);
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
