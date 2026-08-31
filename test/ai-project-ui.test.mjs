import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, app, aiFormat, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/ai-project-format.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Teilen-Menü bietet den projektbezogenen KI-Download als Markdown an', () => {
  assert.match(app, /Projekt teilen oder exportieren/);
  assert.match(app, /data-ai-project-export/);
  assert.match(app, /Für KI herunterladen/);
  assert.match(app, /logbuch-\$\{safeDownloadName\(project\.title\)\}-ki-kontext\.md/);
  assert.match(html, /id="ai-project-export-dialog"/);
  assert.match(html, /Markdown herunterladen/);
  assert.match(html, /Dateiinhalte werden nicht eingebettet/);
});

test('Oberfläche enthält keinen KI-Reimport und keine KI-Projektvorlage mehr', () => {
  assert.doesNotMatch(app, /data-ai-project-import|openAiProjectImportDialog|applyAiProjectPlan|importSpecification/);
  assert.doesNotMatch(html, /ai-project-import|KI-Projektvorlage|Importspezifikation/);
  assert.doesNotMatch(aiFormat, /logbuch-ai-project|returnContract|importSpecification|blankTemplate/);
  assert.doesNotMatch(styles, /ai-project-preview|ai-template-help/);
  assert.doesNotMatch(html, /data-project-create-choice="ai-import"/);
});
