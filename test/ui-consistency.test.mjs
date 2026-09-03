import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Kritische Aktionen verwenden den gemeinsamen Logbuch-Bestätigungsdialog', () => {
  assert.match(html, /id="confirmation-dialog"/);
  assert.match(script, /function confirmAction\(/);
  assert.doesNotMatch(script, /\bconfirm\(/);
});

test('Kontextmenüs und Übersichtskonfiguration verwenden eindeutige gemeinsame Symbole', () => {
  assert.match(script, /iconSvg\('ellipsis'\)/);
  assert.match(script, /iconSvg\('sliders-horizontal'\)/);
  assert.doesNotMatch(script, /iconSvg\('menu'\)|☰|⋯/);
  assert.match(html, /id="menu-button"[^>]*>☰<\/button>/);
});

test('Filterzeilen besitzen einheitliche Ruhe-, Fokus- und Auswahlzustände', () => {
  assert.match(styles, /\.storage-empty-toggle \{[^}]*background:transparent;/);
  assert.match(styles, /\.storage-empty-toggle:has\(input:checked\) \{ background:var\(--red-soft\); \}/);
  assert.match(styles, /\.tag-filter-options label:has\(input:checked\),\.project-sort-options label:has\(input:checked\)/);
  assert.match(styles, /\.project-access-option:has\(input:checked\)/);
});

test('Zahlenfelder nutzen denselben großen Stepper', () => {
  assert.match(html, /data-todo-repeat-step="-1"[\s\S]*data-todo-repeat-step="1"/);
  assert.match(html, /data-reservation-fulfill-step="-1"[\s\S]*data-reservation-fulfill-step="1"/);
  assert.match(styles, /\.number-stepper,[^\n]+grid-template-columns:minmax\(0,1fr\) auto auto/);
});

test('Seitenköpfe und primäre Anlageaktionen kommen aus dem gemeinsamen Raster', () => {
  assert.doesNotMatch(script, /normalizeCommonPageHeader/);
  assert.match(script, /standardPageHeader\(\{ title:'Suche'/);
  assert.match(script, /standardPageHeader\(\{ title, description, icon:'settings'/);
  assert.match(script, /data-category-create="">Kategorie anlegen/);
  assert.match(script, /data-storage-create-single="">Lagerort anlegen/);
});

test('Bearbeiten folgt der Regel für redaktionelle Inhalte und verwaltete Objekte', () => {
  assert.match(script, /const itemEditButton[^\n]+class="edit-action"/);
  assert.match(script, /const entryEditButton[^\n]+class="edit-action"/);
  assert.match(script, /function contextActionMenu\(/);
  assert.match(script, /function inventoryItemManagementActions\(/);
  assert.match(script, /const actions = contextActionMenu\(`Aktionen für \$\{item\.name\}`/);
  assert.match(script, /const itemActions = inventoryItemManagementActions\(item\)/);
});
