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
  assert.match(html, /href="\/#\/inventory\/items" data-inventory-route="items">Artikel<\/a>/);
});

test('Artikelstammdaten werden über den gemeinsamen Dialog gepflegt', () => {
  for (const field of ['name','stockUnit','description','manufacturer','articleNumber','barcode','defaultMinimumQuantity','merchantUrl']) assert.match(html, new RegExp(`name="${field}"`));
  assert.match(script, /openInventoryItemDialog/);
  assert.match(script, /\/inventory-items/);
});

test('Artikelliste unterstützt Suche und Detaildarstellung; Archive liegen im Lagermenü', () => {
  assert.match(script, /inventory-item-search/);
  assert.match(html, /href="\/#\/inventory\/archive" data-inventory-route="archive">Archiviert<\/a>/);
  assert.match(script, /renderInventoryArchive/);
  assert.match(script, /inventoryItemDetail/);
  assert.match(styles, /\.inventory-item-shell \{/);
  assert.match(styles, /\.inventory-item-row\.selected/);
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
  assert.match(script, /inventory-detail-section inventory-history-section/);
  assert.match(script, /inventory-detail-section inventory-item-master-data/);
  assert.match(script, /inventoryDetailSummary\('Weitere Stammdaten', 'Zusätzliche Artikelangaben'\)/);
  assert.match(styles, /\.inventory-detail-section > summary::before,\.inventory-detail-section > summary::after/);
  assert.doesNotMatch(styles, /\.inventory-item-master-data summary \{/);
  assert.match(script, /\$\{reservationSection\}\$\{entrySection\}\$\{masterData\}\$\{history\}/);
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
