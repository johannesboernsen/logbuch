import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/ai-project-format.js');
const format = globalThis.LogbuchAiProject;

const project = {
  id:'project-ki-test', title:'Werkbank', description:'Eine neue Werkbank bauen.', status:'active', priority:'Hoch', createdAt:'2026-08-30', dueDate:'', tagIds:['tag-holz'],
  entries:[], tasks:[{ id:'task-zuschnitt', title:'Platten zuschneiden', description:'', status:'Offen', priority:'Normal', dueDate:'' }], shopping:[], materials:[], contacts:[], links:[], ideas:[], learnings:[], notes:[],
  files:[{ id:'file-plan', originalName:'plan.pdf', displayName:'Bauplan', description:'Bemaßung', mimeType:'application/pdf', size:1234 }],
};

const snapshotFrom = markdown => JSON.parse(markdown.match(/```json\n([\s\S]+)\n```/)[1]);

test('KI-Kontext exportiert den vollständigen Projektstand als Markdown', () => {
  const markdown = format.exportContext(project, [{ id:'tag-holz', name:'Holz' }]);
  const snapshot = snapshotFrom(markdown);

  assert.match(markdown, /format: logbuch-ai-context/);
  assert.match(markdown, /# Werkbank/);
  assert.match(markdown, /- Tags: Holz/);
  assert.equal(snapshot.format, 'logbuch-ai-context');
  assert.equal(snapshot.project.id, 'project-ki-test');
  assert.equal(snapshot.project.tags[0].name, 'Holz');
  assert.equal(snapshot.contents.tasks[0].id, 'task-zuschnitt');
  assert.deepEqual(Object.keys(snapshot.contents), format.collections);
});

test('Dateimetadaten sind optional und Dateiinhalte werden nicht exportiert', () => {
  const withFiles = snapshotFrom(format.exportContext(project, []));
  assert.equal(withFiles.files[0].displayName, 'Bauplan');
  assert.equal(withFiles.files[0].mimeType, 'application/pdf');
  assert.equal(Object.hasOwn(withFiles.files[0], 'content'), false);

  const withoutFiles = format.exportContext(project, [], { includeFileMetadata:false });
  assert.deepEqual(snapshotFrom(withoutFiles).files, []);
  assert.doesNotMatch(withoutFiles, /Bauplan/);
});

test('KI-Export enthält keinen Vertrag für einen späteren Reimport', () => {
  const markdown = format.exportContext(project);
  assert.doesNotMatch(markdown, /logbuch-ai-project/);
  assert.doesNotMatch(markdown, /returnContract/);
  assert.doesNotMatch(markdown, /Rückimport|Rückgabe|Importvorlage|operations/i);
  assert.equal(format.parse, undefined);
  assert.equal(format.validate, undefined);
  assert.equal(format.importSpecification, undefined);
});
