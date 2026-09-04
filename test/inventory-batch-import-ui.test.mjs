import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Lagerort-Menü öffnet einen Stapelimport mit fester Vorlage', () => {
  assert.match(script, /data-storage-import-items/);
  assert.match(script, /openInventoryBatchImportDialog/);
  assert.match(html, /id="inventory-batch-import-dialog"/);
  assert.match(html, /href="\/api\/inventory-items\/import-template"/);
  assert.match(html, /Die Vorlage bleibt immer gleich/);
  assert.match(styles, /\.inventory-batch-import-dialog/);
});

test('Import verwendet die gemeinsame Kompakt-Spaltenansicht für mehrere Kategorien', () => {
  assert.match(script, /renderInventoryBatchCategoryPicker/);
  assert.match(script, /renderCompactColumnPicker\(\{/);
  assert.match(script, /selectionMode:'multiple'/);
  assert.match(html, /id="inventory-batch-category-options"/);
  assert.match(html, /id="inventory-batch-category-create"/);
  assert.match(script, /selected\.add\(saved\.id\)/);
});

test('CSV wird vor dem atomaren Import als Tabelle validiert', () => {
  assert.match(script, /\/inventory-items\/import-preview/);
  assert.match(script, /function renderInventoryBatchPreview/);
  assert.match(script, /inventory-batch-preview-table-wrap/);
  assert.match(script, /\/inventory-items\/import'/);
  assert.match(html, /id="inventory-batch-import-submit"[^>]+disabled/);
  assert.match(styles, /\.inventory-batch-preview table/);
});
