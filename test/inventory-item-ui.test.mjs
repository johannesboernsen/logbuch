import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Artikel besitzen Katalog- und stabile Detailrouten innerhalb des Lagers', () => {
  assert.match(script, /inventoryItemHref/);
  assert.match(script, /`item\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(script, /parts\[1\] === 'items' \|\| parts\[1\] === 'item'/);
  assert.match(html, /href="\/#\/inventory\/items" data-inventory-route="items"><span>Artikel<\/span>/);
});

test('Artikelstammdaten werden über den gemeinsamen Dialog gepflegt', () => {
  for (const field of ['name','stockUnit','description','manufacturer','articleNumber','barcode','defaultMinimumQuantity','merchantUrl']) assert.match(html, new RegExp(`name="${field}"`));
  assert.match(script, /openInventoryItemDialog/);
  assert.match(script, /\/inventory-items/);
});

test('Artikel können ein validiertes Bild erhalten und wieder entfernen', () => {
  assert.match(html, /name="image" type="file" accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(html, /id="inventory-item-image-remove"/);
  assert.match(script, /function setInventoryItemImagePreview/);
  assert.match(script, /imagePayload\.append\('image', image, image\.name\)/);
  assert.match(script, /\/inventory-items\/\$\{encodeURIComponent\(saved\.id\)\}\/image/);
  assert.match(script, /item\.hasImage \? `<img src=/);
  assert.match(styles, /\.storage-item-preview\.has-image img \{[^}]*object-fit:contain;/);
  assert.match(styles, /\.inventory-item-image-editor \[hidden\] \{ display:none; \}/);
});

test('Artikel besitzen mehrere bearbeitbare Notizen in Artikel- und Lageransicht', () => {
  assert.match(html, /id="inventory-item-note-dialog"/);
  assert.match(html, /name="content" minlength="1" maxlength="10000"/);
  assert.match(script, /function inventoryItemNotesSection\(item, notes = \[\], archived = false\)/);
  assert.match(script, /inventoryDetailSummary\('Notizen'/);
  assert.match(script, /data-inventory-item-note-create/);
  assert.match(script, /data-inventory-item-note-edit/);
  assert.match(script, /data-inventory-item-note-delete/);
  assert.match(script, /storageFinderItemInspector\(location, item, localEntry, stockData, notes, includeArchived\)/);
  assert.match(script, /api\(`\/inventory-items\/\$\{encodeURIComponent\(current\.id\)\}\/notes`\)/);
  assert.match(styles, /\.inventory-item-note \{[^}]*border:1px solid var\(--line\);[^}]*border-radius:12px;/);
});

test('Artikelliste unterstützt Suche und Detaildarstellung; Archive liegen im Lagermenü', () => {
  assert.match(script, /inventory-item-search/);
  assert.match(html, /href="\/#\/inventory\/archive" data-inventory-route="archive"><span>Archiviert<\/span>/);
  assert.match(script, /renderInventoryArchive/);
  assert.match(script, /inventoryItemDetail/);
  assert.match(styles, /\.inventory-item-shell \{/);
  assert.match(styles, /\.inventory-item-row\.selected/);
  assert.match(script, /function inventoryItemTable/);
  for (const heading of ['Artikel','Hersteller · Artikelnummer','Bestand','Reserviert','Verfügbar']) assert.match(script, new RegExp(`inventoryItemSortHeader\\('${heading}'`));
  assert.match(script, /new URLSearchParams\(\{ withOverview:'1' \}\)/);
  assert.match(script, /physicalQuantity/);
  assert.match(script, /reservedQuantity/);
  assert.match(script, /availableQuantity/);
  assert.doesNotMatch(script.match(/function inventoryItemRow[\s\S]*?\n}\n\nfunction inventoryItemTable/)?.[0] || '', /inventory-item-row-icon|iconSvg\('tag'\)|aria-hidden="true">›/);
  assert.match(styles, /\.inventory-item-row \{[^}]*height:46px;/);
  assert.match(styles, /\.inventory-item-shell:not\(\.has-selection\) \.inventory-item-welcome \{ display:none; \}/);
  assert.match(styles, /\.inventory-item-shell\.has-selection \.inventory-item-meta-column,[^{]+\{ display:none; \}/);
});

test('Artikelliste lässt sich über den hierarchischen Kategorienbaum filtern', () => {
  assert.match(script, /name="category" aria-label="Nach Kategorie filtern"/);
  assert.match(script, /function inventoryItemCategoryFilterOptions/);
  assert.match(script, /inventoryCategoryTree\(state\.inventoryCategories\)/);
  assert.match(script, /const categoryIds = categoryId \? inventoryCategoryDescendants\(categoryId\) : new Set\(\);/);
  assert.match(script, /if \(categoryId\) categoryIds\.add\(categoryId\);/);
  assert.match(script, /\(item\.categoryIds \|\| \[\]\)\.some\(id => categoryIds\.has\(id\)\)/);
  assert.match(script, /routeQuery\.get\('category'\) \|\| ''/);
  assert.match(styles, /\.inventory-item-category-filter \{[^}]*width:min\(260px,28vw\);/);
});

test('Alle sichtbaren Artikelspalten lassen sich auf- und absteigend sortieren', () => {
  assert.match(script, /function inventoryItemSortHeader/);
  assert.match(script, /active && direction === 'asc' \? 'desc' : 'asc'/);
  assert.match(script, /function sortInventoryItems/);
  for (const field of ['manufacturer','physical','reserved','available']) assert.match(script, new RegExp(`sort === '${field}'`));
  assert.match(script, /direction === 'desc' \? -result : result/);
  assert.match(script, /routeQuery\.get\('sort'\) \|\| 'name'/);
  assert.match(script, /routeQuery\.get\('direction'\) \|\| 'asc'/);
  assert.match(styles, /\.inventory-item-sort-link\.active/);
});

test('Artikelverwaltung und Lager verwenden dieselbe Artikelübersicht', () => {
  assert.match(script, /function inventoryItemOverview/);
  assert.match(script, /inventoryItemOverview\(item, stockData\.summary \|\| \{\}, '', stockBookingAction, true\)/);
  assert.match(script, /inventoryItemOverview\(item, summary, localOverview\)/);
  for (const label of ['Gesamtbestand','Reserviert','Verfügbar','Globales Minimum']) assert.match(script, new RegExp(label));
  assert.match(script, /inventory-item-detail storage-item-detail/);
  assert.match(script, /inventory-item-detail-body/);
  assert.match(styles, /\.inventory-item-overview dl \{[^}]*border:0;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview dl \{[^}]*margin:0;[^}]*border:0;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview dl > div \{[^}]*min-height:30px;[^}]*border:0;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview \{[^}]*grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview-heading h2 \{[^}]*font-size:clamp\(30px,3\.5vw,42px\);/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview-heading p \{[^}]*margin:8px 0 0;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview \.storage-item-preview \{[^}]*grid-column:1;[^}]*grid-row:2;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview \.storage-item-preview \{[^}]*width:100%;[^}]*aspect-ratio:4\/3;/);
  assert.match(styles, /\.inventory-item-detail \.inventory-item-stock-overview \{[^}]*grid-column:2;[^}]*grid-row:2;/);
  assert.match(script, /inventory-item-detail-menu-header/);
  assert.match(styles, /@media \(max-width:420px\)[\s\S]*\.inventory-item-detail \.inventory-item-overview \{ grid-template-columns:1fr; \}/);
});

test('Artikelvorschaubilder halten Abstand zu den folgenden Metadaten', () => {
  assert.match(styles, /\.inventory-item-detail \.inventory-item-overview > \.storage-item-metadata \{[^}]*grid-row:3;[^}]*margin:16px 0 0;/);
});

test('Bestandsaktionen stehen bei den jeweils betroffenen Daten', () => {
  assert.match(script, /inventory-item-overview-actions/);
  assert.match(script, /stockBookingAction[\s\S]*data-stock-movement="RECEIPT">Bestand buchen/);
  assert.match(script, /stockLocationAction[\s\S]*data-stock-entry-create[^>]*>Weiteren Lagerort hinzufügen/);
  const stockEntryMarkup = script.match(/function inventoryStockEntryMarkup[\s\S]*?\n}\n\nfunction stockTransactionMarkup/)?.[0] || '';
  assert.doesNotMatch(stockEntryMarkup, /data-stock-movement/);
  assert.doesNotMatch(stockEntryMarkup, />Buchen<\/button>/);
  assert.doesNotMatch(styles, /\.inventory-stock-entry footer \.button \{/);
  assert.match(styles, /\.inventory-item-overview-actions \{[^}]*justify-content:flex-start;/);
});

test('Alle Detailabschnitte besitzen dieselbe einklappbare Darstellung', () => {
  assert.match(script, /inventory-detail-section inventory-reservation-section" open/);
  assert.match(script, /inventory-detail-section inventory-location-section" open/);
  assert.match(script, /inventory-detail-section inventory-category-section" open/);
  assert.match(script, /inventory-detail-section inventory-item-notes-section" open/);
  assert.match(script, /inventory-detail-section inventory-history-section/);
  assert.match(script, /inventory-detail-section inventory-item-master-data/);
  assert.match(script, /inventoryDetailSummary\('Weitere Stammdaten', 'Zusätzliche Artikelangaben'\)/);
  assert.match(styles, /\.inventory-detail-section > summary::before,\.inventory-detail-section > summary::after/);
  assert.doesNotMatch(styles, /\.inventory-item-master-data summary \{/);
  assert.match(script, /\$\{reservationSection\}\$\{entrySection\}\$\{categorySection\}\$\{masterData\}\$\{history\}/);
});

test('Detailabschnitte verwenden gemeinsame Flächen und Projektlisten-Trenner', () => {
  assert.match(script, /function inventoryDetailSummary/);
  assert.match(script, /<div class="inventory-detail-section-body">/);
  assert.match(styles, /\.inventory-detail-section \{[^}]*border:0;[^}]*background:transparent;/);
  assert.match(styles, /\.inventory-detail-section-body \{[^}]*border:1px solid var\(--line\);[^}]*border-radius:14px;[^}]*background:#fff;/);
  assert.match(styles, /\.inventory-detail-section > summary::before,[^{]+\{[^}]*height:1px;[^}]*background:var\(--line\);/);
  assert.match(styles, /\.inventory-detail-section \.inventory-stock-entry \{[^}]*border-bottom:1px solid var\(--line\);/);
  assert.match(styles, /\.inventory-detail-section \.inventory-reservation \{[^}]*border-bottom:1px solid var\(--line\);/);
  assert.match(styles, /\.inventory-stock-empty \{[^}]*border:0;[^}]*border-top:1px solid var\(--line\);/);
});

test('Smartphones wechseln vom Katalog in eine eigenständige Artikeldetailansicht', () => {
  assert.match(styles, /@media \(max-width:780px\)[\s\S]*\.inventory-item-shell\.has-selection \.inventory-item-list-panel \{ display:none; \}/);
  assert.match(styles, /\.inventory-item-mobile-back \{[^}]*display:flex/);
});

test('Geöffnete Artikeldetails lassen sich über X und die freie Seitenfläche schließen', () => {
  assert.match(script, /class="inventory-item-detail-close"[^>]+aria-label="Artikelansicht schließen"/);
  assert.match(styles, /\.inventory-item-detail-close \{[^}]*width:36px;[^}]*height:36px;/);
  assert.match(script, /main\.onclick = state\.inventoryStockItem \? event => \{/);
  assert.match(script, /if \(event\.target === main && location\.hash\.startsWith\('#\/inventory\/item\/'\)\) location\.href = inventoryItemHref\('', state\.inventoryItemsIncludeArchived, state\.inventoryItemQuery, state\.inventoryItemCategoryFilter, state\.inventoryItemSort, state\.inventoryItemSortDirection\);/);
});

test('Der Artikelrahmen reicht dynamisch bis zum unteren Browserrand', () => {
  assert.match(styles, /\.inventory-item-shell \{[^}]*height:calc\(100dvh - 305px\);[^}]*min-height:0;/);
  assert.doesNotMatch(styles, /\.inventory-item-shell \{[^}]*height:clamp/);
  assert.match(script, /function fitInventoryWorkspaces/);
  assert.match(script, /window\.innerHeight - workspace\.getBoundingClientRect\(\)\.top - bottomGap/);
  assert.match(script, /requestAnimationFrame\(fitInventoryWorkspaces\)/);
});

test('Die Artikelansicht besitzt dieselbe weiße Kopffläche wie die Hauptbereiche', () => {
  assert.match(script, /standardPageHeader\(\{ title:'Artikel'[^\n]+className:'storage-finder-page-head inventory-items-page-head'/);
  assert.match(styles, /\.standard-page-head \{[^}]*height:154px;[^}]*border-bottom:1px solid var\(--line\);[^}]*background:#fff;/);
});
