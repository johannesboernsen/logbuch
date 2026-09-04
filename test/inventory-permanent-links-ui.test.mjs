import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const script = await readFile(new URL('public/app.js', root), 'utf8');

test('Artikel, Lagerorte und Kategorien besitzen namensunabhängige Dauerlinks', () => {
  assert.match(script, /const permanentInventoryItemHref = id => `\/#\/inventory\/item\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(script, /const permanentStorageLocationHref = id => `\/#\/inventory\/location\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(script, /const permanentInventoryCategoryHref = id => `\/#\/inventory\/category\/\$\{encodeURIComponent\(id\)\}`/);
  for (const attribute of ['data-inventory-item-copy-link', 'data-storage-copy-link', 'data-category-copy-link']) {
    assert.match(script, new RegExp(`${attribute}=.{0,80}Dauerhaften Link kopieren`));
  }
});

test('Dauerlinks verwenden die öffentliche Webadresse und keine Ansichtsparameter', () => {
  assert.match(script, /async function stableLink\(path\)[\s\S]*api\('\/system'\)[\s\S]*\.baseUrl/);
  assert.match(script, /copyLink\(permanentInventoryItemHref\(button\.dataset\.inventoryItemCopyLink\), button\)/);
  assert.match(script, /copyLink\(permanentStorageLocationHref\(button\.dataset\.storageCopyLink\), button\)/);
  assert.match(script, /copyLink\(permanentInventoryCategoryHref\(button\.dataset\.categoryCopyLink\), button\)/);
  for (const helper of ['permanentInventoryItemHref', 'permanentStorageLocationHref', 'permanentInventoryCategoryHref']) {
    const definition = script.match(new RegExp(`const ${helper}[^\n]+`))?.[0] || '';
    assert.doesNotMatch(definition, /URLSearchParams|name|title|archived|sort|direction|categoryId/);
  }
});

test('Dauerlinks bleiben auch ohne Bearbeitungsrecht und im Archiv erreichbar', () => {
  const categoryMenu = script.match(/function inventoryCategoryActionMenu[\s\S]*?\n}/)?.[0] || '';
  const locationMenu = script.match(/function storageLocationActionMenu[\s\S]*?\n}/)?.[0] || '';
  const archive = script.match(/async function renderInventoryArchive[\s\S]*?(?=\nfunction bindInventoryArchiveActions)/)?.[0] || '';
  assert.match(categoryMenu, /if \(!category\) return ''/);
  assert.match(locationMenu, /if \(!location\) return ''/);
  assert.match(categoryMenu, /mayEditProjects\(\) \?.*data-category-edit/);
  assert.match(locationMenu, /!mayEditProjects\(\) \? ''/);
  assert.match(archive, /data-inventory-item-copy-link/);
  assert.match(archive, /data-storage-copy-link/);
  assert.match(script, /function bindInventoryArchiveActions\(\) \{\n  bindInventoryPermanentLinks\(\);/);
});
