import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const html = await readFile(new URL('public/app.html', root), 'utf8');
const js = await readFile(new URL('public/app.js', root), 'utf8');
const styles = await readFile(new URL('public/styles.css', root), 'utf8');

test('Kategorien besitzen einen eigenen Lager-Menüpunkt und stabile Finder-Routen', () => {
  assert.match(html, /href="\/#\/inventory\/categories" data-inventory-route="categories"/);
  assert.match(js, /`category\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(js, /renderInventoryCategories\(categoryId, itemId/);
  assert.match(js, /storage-finder-columns/);
});

test('Artikel können über einen kompakten Spaltenbrowser mehreren Kategorien zugeordnet werden', () => {
  assert.match(html, /id="inventory-item-category-options"/);
  assert.match(js, /function renderInventoryCategoryPicker\(form, requestedPath = null\)/);
  assert.match(js, /function renderCompactColumnPicker\(/);
  assert.match(js, /data-compact-column-open/);
  assert.match(js, /class="compact-column-picker-check"[\s\S]*class="compact-column-picker-title"/);
  assert.match(js, /form\.dataset\.categoryIds = JSON\.stringify/);
  assert.match(js, /data-compact-column-clear="\$\{depth\}"/);
  assert.match(js, /if \(event\.target\.closest\('\.compact-column-picker-row'\)\) return;/);
  assert.match(styles, /\.compact-column-picker \{[^}]*display:flex;[^}]*overflow-x:auto/);
  assert.match(js, /replaceItemCategories|categoryIds/);
  assert.match(js, /Aus dieser Kategorie entfernen/);
});

test('Kategorieoptionen bleiben kompakte horizontale Zeilen', () => {
  assert.match(styles, /\.compact-column-picker-row \{[^}]*grid-template-columns:29px minmax\(0,1fr\)/);
  assert.match(styles, /\.compact-column-picker-title \{[^}]*display:grid;[^}]*grid-template-columns:17px minmax\(0,1fr\) auto/);
  assert.match(styles, /\.compact-column-picker-title:is\(button\):hover,[^{]+\{[^}]*background:transparent;/);
});

test('Kategorien und Artikel unterstützen Drag-and-drop mit serverseitigem Zyklenschutz', () => {
  assert.match(js, /data-category-drag/);
  assert.match(js, /data-category-item-drag/);
  assert.match(js, /inventoryCategoryDescendants/);
  assert.match(js, /method:'PATCH'.*parentId/s);
});

test('Kategoriespalten zeigen ausschließlich direkt zugeordnete Artikel', () => {
  assert.doesNotMatch(js, /Alle im Zweig|Nur direkt|\?all=1|recursive=1/);
  assert.match(js, /path\.map\(category => api\(`\/inventory-categories\/\$\{encodeURIComponent\(category\.id\)\}\/items`\)\)/);
  assert.match(styles, /\.storage-finder-column \{[^}]*flex:0 0 340px[^}]*overflow:hidden/);
  assert.match(styles, /\.storage-finder-list \{[^}]*overflow-x:hidden/);
});

test('Die große Kategorieansicht unterstützt Abwahl und Tastaturnavigation wie das Lager', () => {
  assert.match(js, /data-category-clear-selection="\$\{escapeHtml\(parentId\)\}"/);
  assert.match(js, /location\.href = inventoryCategoryHref\(list\.dataset\.categoryClearSelection \|\| ''\)/);
  assert.match(js, /data-storage-parent-href="\$\{inventoryCategoryHref\(category\.parentId \|\| ''\)\}"/);
  assert.match(js, /function bindInventoryCategoryActions\(\)[\s\S]*bindStorageFinderKeyboard\(\);/);
});

test('Ein Artikel lässt sich direkt innerhalb einer Kategorie anlegen', () => {
  assert.match(js, /function inventoryCategoryCreateControl\(parent\)/);
  assert.match(js, /data-category-create-item="\$\{escapeHtml\(parent\.id\)\}"/);
  assert.match(js, /openInventoryItemDialog\('', '', button\.dataset\.categoryCreateItem\)/);
  assert.match(js, /new Set\(item\?\.categoryIds \|\| \(category \? \[category\.id\] : \[\]\)\)/);
  assert.match(js, /inventoryCategoryHref\(categoryContextId, saved\.id\)/);
});
