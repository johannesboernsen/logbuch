import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Artikel- und Kategorieansicht verwenden dieselbe Mehrfachauswahl', () => {
  assert.match(script, /data-bulk-item-id/);
  assert.match(script, /inventoryBulkToolbar\('item'\)/);
  assert.match(script, /bindInventoryBulkActions/);
});

test('Lagerpositionen besitzen kontextabhängige Mehrfachaktionen', () => {
  assert.match(script, /data-bulk-stock-id/);
  assert.match(script, /data-bulk-action="MOVE"/);
  assert.match(script, /data-bulk-action="SET_LOCAL_MINIMUM"/);
  assert.match(script, /\/stock-entries\/batch/);
});

test('Gemeinsame Pflege umfasst Kategorien, Mindestbestand, Inventur und Etiketten', () => {
  for (const action of ['ADD_CATEGORIES','REMOVE_CATEGORIES','SET_GLOBAL_MINIMUM','REQUEST_AUDIT']) assert.match(script, new RegExp(action));
  assert.match(script, /openInventoryBulkLabels/);
  assert.match(html, /id="inventory-bulk-dialog"/);
  assert.match(styles, /\.inventory-bulk-toolbar/);
});
