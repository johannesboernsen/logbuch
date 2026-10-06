import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/project-navigation.js');
const { statusSelection, shortcuts, folderRows, folderPath, canMoveFolder, statusGroups } = globalThis.LogbuchProjectNavigation;

test('Statusauswahl unterstützt Kombinationen, bisherige Links und bewusst leere Filter', () => {
  assert.deepEqual(statusSelection(undefined), ['idea', 'active']);
  assert.deepEqual(statusSelection('active'), ['active']);
  assert.deepEqual(statusSelection('active,idea,active,archived'), ['idea', 'active']);
  assert.deepEqual(statusSelection('all'), ['idea', 'active', 'paused', 'completed']);
  assert.deepEqual(statusSelection('none'), []);
  assert.deepEqual(statusSelection([]), []);
});

test('Statusgruppen folgen Ideen, aktiv, pausiert, abgeschlossen und schließen Archiv aus', () => {
  const projects = ['completed', 'paused', 'active', 'archived', 'idea', 'active'].map((status, id) => ({ id, status }));
  const groups = statusGroups(projects);
  assert.deepEqual(groups.map(group => group.status), ['idea', 'active', 'paused', 'completed']);
  assert.deepEqual(groups[1].projects.map(project => project.id), [2, 5]);
  assert.deepEqual(statusGroups([]), []);
});

test('Ordnerpfade und Verschiebeziele verhindern Selbstbezüge und Zyklen', () => {
  const folders = [{ id:'a', parentId:null }, { id:'b', parentId:'a' }, { id:'c', parentId:'b' }, { id:'d', parentId:null }];
  assert.deepEqual(folderPath(folders, 'c').map(folder => folder.id), ['a', 'b', 'c']);
  assert.deepEqual(folderPath(folders, 'deleted'), []);
  assert.equal(canMoveFolder(folders, 'a', 'c'), false);
  assert.equal(canMoveFolder(folders, 'b', 'b'), false);
  assert.equal(canMoveFolder(folders, 'b', 'a'), false);
  assert.equal(canMoveFolder(folders, 'b', 'missing'), false);
  assert.equal(canMoveFolder(folders, 'missing', null), false);
  assert.equal(canMoveFolder(folders, 'c', 'a'), true);
  assert.equal(canMoveFolder(folders, 'b', null), true);
  assert.equal(canMoveFolder(folders, 'a', 'd'), true);
});

test('Menü bleibt bei hundert Ordnern auf fünf sichtbare Zugriffe begrenzt', () => {
  const folders = Array.from({ length:100 }, (_, index) => ({ id:`f-${index}`, name:`Ordner ${index}` }));
  const result = shortcuts(folders, ['deleted', 'f-20', 'f-2'], ['f-2', 'f-1', 'f-3', 'f-4', 'f-5']);
  assert.deepEqual(result.map(folder => folder.id), ['f-20', 'f-2', 'f-1', 'f-3', 'f-4']);
  assert.deepEqual(result.map(folder => folder.pinned), [true, true, false, false, false]);
  assert.equal(shortcuts(folders, [], []).length, 0);
});

test('Ordnersuche findet verdeckte Unterordner mit ihrem Pfad und erhält den Aufklappzustand', () => {
  const folders = [
    { id:'a', name:'Werkstatt', parentId:null },
    { id:'b', name:'Elektronik', parentId:'a' },
    { id:'c', name:'Slider', parentId:'b' },
    { id:'d', name:'Holz', parentId:'a' },
    { id:'e', name:'Garten', parentId:null },
  ];
  const expanded = new Set(['e']);
  assert.deepEqual(folderRows(folders, expanded).map(row => row.folder.id), ['e', 'a']);
  assert.deepEqual(folderRows(folders, expanded, 'slider').map(row => [row.folder.id, row.depth]), [['a', 0], ['b', 1], ['c', 2]]);
  assert.deepEqual([...expanded], ['e']);
  assert.deepEqual(folderRows(folders, new Set(['a'])).map(row => row.folder.id), ['e', 'a', 'b', 'd']);
  assert.deepEqual(folderRows(folders, expanded, 'unbekannt'), []);
});
