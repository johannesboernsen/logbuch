import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
await import('../public/project-navigation.js');
const source = await readFile(new URL('../public/project-browser.js', import.meta.url), 'utf8');

function browser() {
  const state = {
    user:{}, currentFolderId:null, projectStatusFilter:'all', projectSearch:{ active:'' },
    projectSort:{ field:'status', direction:'asc' }, projectTagFilter:{ active:{ ids:[], mode:'all' } },
    folders:[{ id:'a', name:'Ordner A', parentId:null }, { id:'b', name:'Unterordner', parentId:'a' }],
    projects:['completed', 'paused', 'active', 'idea'].map((status, index) => ({ id:`p${index}`, title:`Projekt ${status}`, status, folderId:'a', tagIds:['tag-1'], dueDate:'2026-01-01' })),
  };
  const context = vm.createContext({ state, URLSearchParams,
    projectNavigation:globalThis.LogbuchProjectNavigation,
    matchesProjectStatus:project => globalThis.LogbuchProjectNavigation.statusSelection(state.projectStatusFilter).includes(project.status),
    folderById:id => state.folders.find(folder => folder.id === id), folderPathLabel:() => '',
    sortedProjects:projects => projects, mayEditProjects:() => true,
    escapeHtml:value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    iconSvg:() => '<svg></svg>', entityIconName:() => 'folder', projectIconName:() => 'box',
    projectFlagIcon:() => '<svg></svg>', folderProjectCount:() => 4,
    projectStatusLabels:{ idea:'Idee', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen' },
    formatDate:date => date, today:() => '2026-10-06', contextActionMenu:(_label, content) => content,
  });
  vm.runInContext(source, context);
  return { state, context };
}

test('Jede Projektspalte zeigt direkte Ordner zuerst und alle Statusgruppen in fester Reihenfolge', () => {
  const { state, context } = browser();
  const html = context.projectFolderColumn(state.folders[0]);
  const expected = ['Unterordner', 'Projekt idea', 'Projekt active', 'Projekt paused', 'Projekt completed'];
  let previous = -1;
  for (const text of expected) { const position = html.indexOf(text); assert.ok(position > previous, text); previous = position; }
  assert.match(html, /data-column-create-project="a"/);
  assert.match(html, /data-column-create-folder="a"/);
  assert.match(html, /Fällig: 2026-01-01/);
  assert.match(html, /Überfällig: 2026-01-01/);
  assert.doesNotMatch(context.projectFolderColumn(null), /data-project-browser-row/);
});

test('Status-, Such- und Tagfilter lassen Ordner sichtbar und schließen unpassende Projekte aus', () => {
  const { state, context } = browser();
  state.projectStatusFilter = 'idea,active';
  let html = context.projectFolderColumn(state.folders[0]);
  assert.match(html, /Unterordner/);
  assert.match(html, /Projekt idea/);
  assert.doesNotMatch(html, /Projekt paused|Projekt completed/);
  state.projectSearch.active = 'does not exist';
  html = context.projectFolderColumn(state.folders[0]);
  assert.match(html, /Unterordner/);
  assert.doesNotMatch(html, /data-project-browser-row/);
  state.projectSearch.active = '';
  state.projectTagFilter.active.ids = ['missing'];
  assert.doesNotMatch(context.projectFolderColumn(state.folders[0]), /data-project-browser-row/);
});

test('Alternative Sortierungen behalten Ordner oben und verzichten auf Statusgruppen', () => {
  const { state, context } = browser();
  state.projectSort.field = 'title';
  const html = context.projectFolderColumn(state.folders[0]);
  assert.doesNotMatch(html, /project-column-group/);
  assert.ok(html.indexOf('Unterordner') < html.indexOf('Projekt completed'));
});

test('Projektlinks erhalten Filter, Vorschau und Sortierung ohne Titel als Identität', () => {
  const { state, context } = browser();
  state.projectSearch.active = 'A & B';
  state.projectTagFilter.active.ids = ['tag-1'];
  const params = new URLSearchParams(context.projectBrowserHref('a', 'p1').split('?')[1]);
  assert.equal(params.get('folder'), 'a');
  assert.equal(params.get('project'), 'p1');
  assert.equal(params.get('q'), 'A & B');
  assert.equal(params.get('sort'), 'status:asc');
  assert.equal(params.get('tags'), 'tag-1');
  assert.equal(params.get('view'), 'columns');
});

test('Sichtbarkeitsmenü hat vier kombinierbare Status und kennzeichnet aktive Einschränkungen', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const markup = app.slice(app.indexOf('function projectStatusFilterMarkup()'), app.indexOf('function bindProjectStatusFilter()'));
  let selected = ['idea', 'active'];
  const context = vm.createContext({ selectedProjectStatuses:() => selected,
    regularProjectStatuses:['idea','active','paused','completed'],
    projectStatusLabels:{idea:'Idee',active:'Aktiv',paused:'Pausiert',completed:'Abgeschlossen'},
  });
  vm.runInContext(markup, context);
  let html = context.projectStatusFilterMarkup();
  assert.equal((html.match(/data-filter-project-status/g) || []).length, 4);
  assert.equal((html.match(/ checked/g) || []).length, 2);
  assert.match(html, /has-value/);
  assert.match(html, /id="project-status-panel" class="tag-filter-panel" hidden/);
  assert.match(html, /Alle anzeigen/);
  selected = ['idea','active','paused','completed'];
  assert.doesNotMatch(context.projectStatusFilterMarkup(), /has-value/);
  selected = [];
  assert.doesNotMatch(context.projectStatusFilterMarkup(), / checked/);
});

test('Verschieben verlangt ein gewähltes, existierendes und anderes Ziel', () => {
  const { context } = browser();
  assert.equal(context.validProjectMove({ type:'project', id:'p1' }, undefined), false);
  assert.equal(context.validProjectMove({ type:'project', id:'p1' }, 'a'), false);
  assert.equal(context.validProjectMove({ type:'project', id:'p1' }, 'missing'), false);
  assert.equal(context.validProjectMove({ type:'project', id:'p1' }, null), true);
  assert.equal(context.validProjectMove({ type:'project', id:'p1' }, 'b'), true);
  assert.equal(context.validProjectMove({ type:'folder', id:'a' }, 'b'), false);
});
