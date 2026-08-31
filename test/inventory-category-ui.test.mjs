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

test('Artikel können mehreren Kategorien zugeordnet werden', () => {
  assert.match(html, /id="inventory-item-category-options"/);
  assert.match(js, /input\[name="categoryIds"\]:checked/);
  assert.match(js, /replaceItemCategories|categoryIds/);
  assert.match(js, /Aus dieser Kategorie entfernen/);
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
