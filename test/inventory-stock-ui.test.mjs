import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Bestandseinträge werden über einen Anfangsbestand einem Lagerort zugeordnet', () => {
  assert.match(html, /id="stock-entry-dialog"/);
  assert.match(html, /name="initialQuantity"/);
  assert.match(script, /\/stock-entries/);
  assert.match(html, /Eine positive Anfangsmenge wird als Zugang protokolliert/);
});

test('Lokaler Mindestbestand zeigt nur die ortsbezogenen Einstellungen', () => {
  assert.match(script, /form\.classList\.toggle\('stock-entry-editing', Boolean\(entry\)\)/);
  assert.match(script, /\$\('\[data-stock-entry-location-field\]'\)\.hidden = Boolean\(entry\)/);
  assert.match(script, /\$\('\[data-stock-entry-initial-field\]'\)\.hidden = Boolean\(entry\)/);
  assert.match(script, /entry \? \(collection \? 'Lagerortnotiz bearbeiten' : 'Lokaler Mindestbestand'\) : 'Weiteren Lagerort hinzufügen'/);
  assert.match(script, /entry \? `\$\{item\.name\} · \$\{stockLocationPath\(entry\)\}`/);
  assert.match(styles, /#stock-entry-form \[hidden\][^{]*\{ display:none; \}/);
  assert.match(styles, /#stock-entry-form\.stock-entry-editing \.inventory-item-meta-fields \{ grid-template-columns:1fr; \}/);
  assert.match(html, /name="minimumQuantity"[^>]*>[\s\S]*data-stock-entry-minimum-step="-1"[\s\S]*data-stock-entry-minimum-step="1"/);
  assert.match(html, /name="initialQuantity"[^>]*>[\s\S]*data-stock-entry-initial-step="-1"[\s\S]*data-stock-entry-initial-step="1"/);
  assert.match(script, /document\.querySelectorAll\('\[data-stock-entry-minimum-step\]'\)/);
  assert.match(script, /document\.querySelectorAll\('\[data-stock-entry-initial-step\]'\)/);
  assert.match(styles, /\.stock-entry-quantity-stepper[^\{]*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto auto;/);
  assert.match(html, /field-label-line">Lokaler Mindestbestand <span class="optional">optional<\/span>/);
  assert.match(styles, /\.field-label-line \{[^}]*min-height:18px;[^}]*display:flex;/);
});

test('Leere Lagerplätze werden entfernt statt archiviert', () => {
  assert.match(script, /data-stock-entry-delete/);
  assert.match(script, />Lagerplatz entfernen</);
  assert.match(script, /method:'DELETE'/);
  assert.match(script, /Die Buchungshistorie bleibt erhalten/);
  assert.doesNotMatch(script, /data-stock-entry-archive/);
  assert.doesNotMatch(script, /data-stock-entry-restore/);
});

test('Buchungsdialog unterscheidet alle physischen Bewegungsarten', () => {
  for (const type of ['RECEIPT','RETURN','CONSUMPTION','TRANSFER','CORRECTION','DISPOSAL','LOSS']) assert.match(html, new RegExp(`value="${type}"`));
  assert.match(script, /syncStockMovementFields/);
  assert.match(script, /\/stock-movements/);
  assert.match(html, /Verbindlich buchen/);
});

test('Direkte Entnahme reduziert den Buchungsdialog auf Menge und Notiz', () => {
  assert.match(html, /data-stock-type-field/);
  assert.match(script, /form\.dataset\.fixedType === 'CONSUMPTION'/);
  assert.match(script, /\$\('\[data-stock-type-field\]'\)\.hidden = fixedConsumption/);
  assert.match(script, /\$\('\[data-stock-source-field\]'\)\.hidden = fixedConsumption/);
  assert.match(script, /stock-movement-dialog-title'\)\.textContent = fixedConsumption \? 'Artikel entnehmen'/);
  assert.match(script, /stock-movement-submit'\)\.textContent = fixedConsumption \? 'Entnehmen'/);
  assert.match(script, /form\.elements\.quantity\.max = fixedConsumption \? sourceEntry\.quantity/);
  assert.match(script, /const wholeUnits = item\.stockUnit[\s\S]*=== 'stück'/);
  assert.match(script, /form\.elements\.quantity\.min = wholeUnits \? '1' : '0\.000001'/);
  assert.match(script, /form\.elements\.quantity\.step = wholeUnits \? '1' : 'any'/);
  assert.match(script, /form\.elements\.quantity\.value = wholeUnits \? '1' : ''/);
  assert.match(html, /name="quantity"[^>]*>[\s\S]*data-stock-quantity-step="-1"[\s\S]*data-stock-quantity-step="1"/);
  assert.match(html, /name="countedQuantity"[^>]*>[\s\S]*data-stock-counted-step="-1"[\s\S]*data-stock-counted-step="1"/);
  assert.match(script, /form\.querySelectorAll\('\[data-stock-quantity-step\],\[data-stock-counted-step\]'\)/);
  assert.match(script, /document\.querySelectorAll\('\[data-stock-counted-step\]'\)/);
  assert.match(script, /function stepInventoryQuantity/);
  assert.match(script, /Math\.min\(maximum, Math\.max\(minimum, next\)\)/);
  assert.match(styles, /\.stock-quantity-stepper button,\.stock-transfer-quantity-stepper button \{[^}]*width:46px;[^}]*min-height:46px;/);
  assert.match(styles, /\.stock-quantity-stepper,\.stock-transfer-quantity-stepper \{[^}]*grid-template-columns:minmax\(0,1fr\) auto auto;/);
  assert.match(styles, /\.stock-quantity-stepper input::\-webkit-inner-spin-button/);
  assert.match(html, /id="stock-movement-quantity-hint"/);
  assert.match(styles, /#stock-movement-form \[hidden\][^{]*\{ display:none; \}/);
  assert.match(styles, /#stock-transfer-form \[hidden\][^{]*\{ display:none; \}/);
});

test('Artikel zeigen physischen Gesamtbestand, Lagerplätze und unveränderliche Historie', () => {
  assert.match(script, /Gesamtbestand/);
  assert.match(script, /inventoryDetailSummary\('Lagerorte'/);
  assert.match(script, /inventoryDetailSummary\('Historie', 'Unveränderlich protokolliert'\)/);
  assert.match(script, /<details class="inventory-stock-section inventory-detail-section inventory-history-section">/);
  assert.doesNotMatch(script, /inventory-history-section" open/);
  assert.match(styles, /\.inventory-detail-section > summary \{[^}]*cursor:pointer;/);
  assert.match(styles, /\.inventory-detail-section:not\(\[open\]\) > summary svg \{ transform:rotate\(-90deg\); \}/);
  assert.match(script, /Unveränderlich protokolliert/);
  assert.match(styles, /\.inventory-item-overview dl \{/);
  assert.match(styles, /\.inventory-stock-transaction \{/);
});

test('Lagerortspalten zeigen lokale Artikelmengen und öffnen kontextuelle Artikeldetails', () => {
  assert.match(html, /id="inventory-toggle"[\s\S]+M18 21V10/);
  assert.match(script, /storage-finder-item-icon[^\n]+iconSvg\('tag'\)/);
  assert.match(styles, /\.storage-finder-icon \{[^}]+border:1px solid var\(--line\)[^}]+color:#747b84;[^}]+background:transparent;/);
  assert.doesNotMatch(script, /inventory-item-row-icon/);
  assert.match(script, /formatInventoryQuantity\(entry\.quantity\)/);
  assert.match(script, /localEntry\.minimumQuantity/);
  assert.match(script, /Gesamtbestand/);
  assert.match(script, /data-stock-source="\$\{escapeHtml\(location\.id\)\}"/);
  assert.doesNotMatch(script, /storage-finder-item-actions/);
  assert.match(script, /storage-item-header-consume[\s\S]*data-stock-movement="CONSUMPTION"[\s\S]*data-stock-source="\$\{escapeHtml\(location\.id\)\}"/);
  assert.match(script, /storage-finder-column-actions">\$\{directConsume\}\$\{menu\}/);
  assert.match(styles, /\.storage-item-header-consume \{[^}]*min-height:34px;/);
  assert.match(styles, /\.storage-item-local \{/);
  assert.match(styles, /\.storage-item-local span \{[^}]*font-size:13px;/);
  assert.match(styles, /\.storage-item-local strong \{[^}]*font-size:18px;/);
  assert.match(script, /<span>Lokales Minimum<\/span><strong class="storage-item-local-minimum">\$\{escapeHtml\(localMinimum\)\}<\/strong>/);
  assert.match(styles, /\.storage-item-local \.storage-item-local-minimum \{[^}]*text-align:right;/);
  assert.match(styles, /\.storage-item-local small \{[^}]*font-size:12px;/);
});

test('Artikel lassen sich per Drag-and-drop mit vollständiger oder teilweiser Menge umlagern', () => {
  assert.match(html, /id="stock-transfer-dialog"/);
  assert.match(html, /value="all" checked/);
  assert.match(html, /value="custom"/);
  assert.match(html, /Bei „Alle verschieben“ verschwindet der Artikel am bisherigen Lagerort/);
  assert.match(html, /data-stock-transfer-destination-field>Ziellagerort/);
  assert.match(html, /data-stock-transfer-quantity-step="-1"[\s\S]*data-stock-transfer-quantity-step="1"/);
  assert.match(html, /Grund oder Hinweis zur Umlagerung/);
  assert.match(script, /data-stock-transfer-menu/);
  assert.match(script, /openStockTransferDialog\([\s\S]*, ''\)/);
  assert.match(script, /\[data-stock-transfer-destination-field\]'\)\.hidden = Boolean\(destination\)/);
  assert.match(script, /const orderedLocations = storageLocationTree\(activeLocations\)/);
  assert.match(script, /\$\{depth \? '↳ ' : ''\}\$\{escapeHtml\(location\.name\)\}\$\{source \? ' \(aktueller Lagerort\)' : ''\}/);
  assert.match(script, /const selected = destination \? location\.id === destination\.id : source/);
  assert.match(script, /value="\$\{source \? '' : escapeHtml\(location\.id\)\}"\$\{source \? ' disabled' : ''\}\$\{selected \? ' selected' : ''\}/);
  assert.match(script, /destinationStorageLocationId\.value = destinationId \|\| ''/);
  assert.match(script, /note:form\.elements\.note\.value/);
  assert.match(styles, /#stock-transfer-form \[hidden\][^{]*\{ display:none; \}/);
  assert.match(script, /draggable="true" data-stock-drag-entry/);
  assert.match(script, /data-storage-drop-target/);
  assert.match(script, /data-storage-column-drop-target/);
  assert.match(script, /column\.dataset\.storageColumnDropTarget/);
  assert.match(script, /bindStorageTransferDragDrop/);
  assert.match(script, /quantity > maximum/);
  assert.match(styles, /\.storage-finder-row\.drop-over/);
  assert.match(styles, /\.storage-finder-column\.drop-over-column/);
});

test('Mobile Bestandsdetails vermeiden breite Tabellen', () => {
  assert.match(styles, /@media \(max-width:780px\)[\s\S]*\.inventory-stock-transaction \{ grid-template-columns:82px minmax\(0,1fr\); \}/);
  assert.doesNotMatch(script, /<table[^>]*inventory-stock/);
});
