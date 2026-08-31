import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Lager ist unter Projekte über ein Untermenü und stabile Location-Routen erreichbar', () => {
  assert.match(html, /id="inventory-toggle"[\s\S]*<b>Lager<\/b>/);
  assert.match(html, /href="\/#\/inventory" data-inventory-route="locations"><span>Lagerorte<\/span><small[^>]+data-inventory-count="locations">0<\/small><\/a>/);
  assert.match(html, /projects-menu[\s\S]*inventory-menu[\s\S]*settings-menu/);
  assert.match(script, /`\/location\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(script, /parts\[1\] === 'location'/);
  assert.match(html, /inventory-subnav[\s\S]*data-inventory-route="items"[\s\S]*data-inventory-route="categories"[\s\S]*data-inventory-route="locations"[\s\S]*data-inventory-route="replenishment"[\s\S]*data-inventory-route="archive"/);
});

test('Das Lagermenü zeigt aktuelle Zähler für alle Bereiche', () => {
  for (const area of ['locations', 'items', 'replenishment', 'archive']) assert.match(html, new RegExp(`data-inventory-count="${area}"`));
  assert.match(html, /id="inventory-nav-count"[^>]*title="Anzahl unterschiedlicher Artikel im Lager"[^>]*>0<\/i>/);
  assert.doesNotMatch(html, /id="inventory-nav-count"[^>]*\shidden[^>]*>/);
  assert.match(script, /async function loadInventoryMenuCounts\(\)/);
  assert.match(script, /locations:locations\.filter\(location => location\.status === 'ACTIVE'\)\.length/);
  assert.match(script, /items:items\.filter\(item => item\.status === 'ACTIVE'\)\.length/);
  assert.match(script, /replenishment:Number\(replenishmentData\.summary\?\.itemCount \|\| 0\)/);
  assert.match(script, /archive:locations\.filter[\s\S]+items\.filter/);
  assert.match(script, /badge\.textContent = String\(counts\.items\)/);
  assert.match(script, /badge\.title = 'Anzahl unterschiedlicher Artikel im Lager'/);
  assert.match(script, /badge\.hidden = menuOpen;/);
});

test('Finder-Spalten werden aus dem rekonstruierten Parent-Pfad aufgebaut', () => {
  assert.match(script, /const headingCopy = 'Lagerorte und Artikel verwalten\.'/);
  assert.doesNotMatch(script, /Direkter Inhalt von/);
  assert.match(script, /const path = detail\?\.path \|\| \[\]/);
  assert.match(script, /path\.forEach\(\(parent, index\) => columns\.push\(storageFinderColumn/);
  assert.match(script, /storage-finder-columns/);
  assert.match(script, /data-finder-current-column/);
  assert.match(styles, /\.storage-finder-columns \{[^}]*display:flex/);
  assert.match(script, /storage-finder-frame[\s\S]+data-storage-finder-shell[\s\S]+storage-finder-statusbar[\s\S]+\$\{breadcrumbs\}/);
  assert.match(styles, /\.storage-finder-statusbar \{[^}]+border-top:1px solid var\(--line\)/);
  assert.doesNotMatch(script, /Direkt enthalten|Oberste Ebene<\/small>/);
});

test('Der Lagerrahmen reicht inklusive Statusleiste dynamisch bis zum unteren Browserrand', () => {
  assert.match(styles, /\.storage-finder-frame \{[^}]*height:calc\(100dvh - 235px\);[^}]*grid-template-rows:minmax\(0,1fr\) auto;/);
  assert.match(styles, /\.storage-finder-shell \{[^}]*min-height:0;/);
  assert.doesNotMatch(styles, /\.storage-finder-shell \{[^}]*height:clamp/);
  assert.match(script, /\['\.storage-finder-frame', '\.inventory-item-shell'\]/);
});

test('Die Lageransicht besitzt dieselbe weiße Kopffläche wie die Hauptbereiche', () => {
  assert.match(script, /standardPageHeader\(\{ title:'Lager'[^\n]+icon:'warehouse'/);
  assert.match(styles, /\.standard-page-head \{[^}]*height:154px;[^}]*background:#fff;/);
  assert.match(styles, /@media \(max-width:780px\)[\s\S]*\.standard-page-head \{ height:auto;/);
});

test('Die Plus-Schaltfläche öffnet zuerst die Auswahl der Anlageart', () => {
  assert.match(script, /function storageLocationCreateMenu\(parent\)/);
  assert.match(script, /storageLocationCreateMenu\(parent\)/);
  assert.match(script, /data-storage-create-single="\$\{escapeHtml\(parentId\)\}"/);
  assert.match(script, /data-storage-create-series="\$\{escapeHtml\(parentId\)\}"/);
  assert.match(script, /data-storage-create-matrix="\$\{escapeHtml\(parentId\)\}"/);
  assert.match(script, /<strong>Lagermatrix<\/strong>/);
  assert.doesNotMatch(script, /data-storage-create="/);
  assert.match(styles, /\.storage-finder-create-menu \.action-menu-panel \{ width:248px; \}/);
});

test('Ortsaktionen stehen im Kopf der geöffneten Spalte statt an jeder Lagerortzeile', () => {
  assert.match(script, /function storageLocationActionMenu\(location\)/);
  assert.match(script, /storage-finder-column-actions[\s\S]*\$\{headerActions\}/);
  assert.match(script, /\$\{storageLocationActionMenu\(parent\)\}/);
  assert.match(script, /aria-label="Menü für \$\{escapeHtml\(location\.name\)\}"[\s\S]*\$\{iconSvg\('menu'\)\}/);
  assert.doesNotMatch(script, /storage-finder-row-actions|storage-finder-menu/);
  assert.match(styles, /\.storage-finder-column-menu summary/);
});

test('Das Elternort-Dropdown bildet die Lagerhierarchie in Baumreihenfolge ab', () => {
  assert.match(script, /function storageLocationTree\(locations\)[\s\S]*const children = parentId => locations\.filter\(location => location\.parentId === parentId\)/);
  assert.match(script, /ordered\.push\(\{ location, depth \}\);[\s\S]*append\(location\.id, depth \+ 1\)/);
  assert.match(script, /const ordered = storageLocationTree\(active\)/);
  assert.match(script, /\$\{depth \? '↳ ' : ''\}\$\{escapeHtml\(location\.name\)\}/);
});

test('Lagerorte besitzen denselben hinterlegten Icon-Picker wie Projektordner', () => {
  assert.match(html, /id="storage-location-form"[\s\S]*name="icon" value="archive"[\s\S]*data-icon-picker="storage-location"/);
  assert.match(script, /renderIconPicker\('storage-location'\)/);
  assert.match(script, /entityIconName\(location, 'archive'\)/);
  assert.match(script, /icon:form\.elements\.icon\.value/);
  assert.match(script, /storage-finder-icon storage-finder-location-icon/);
  assert.match(styles, /\.storage-finder-location-icon \{[^}]+color:var\(--red\);[^}]+border-color:#dfaaa7;[^}]+background:linear-gradient/);
  assert.match(styles, /\.storage-finder-item-icon \{[^}]+color:#747b84;[^}]+background:transparent;/);
  assert.doesNotMatch(html, /id="storage-location-form"[\s\S]*<label>Typ<select/);
  assert.doesNotMatch(script, /storageLocationTypeLabels|location\.type/);
});

test('Lagerorte lassen sich einzeln oder als nummerierte Serie anlegen', () => {
  assert.match(html, /type="hidden" name="creationMode" value="single"/);
  assert.doesNotMatch(html, /type="radio" name="creationMode"/);
  assert.match(html, /name="counterStart" type="number" min="0" max="999999999" step="1" value="1"/);
  assert.match(html, /name="count" type="number" min="2" max="500" step="1" value="10"/);
  assert.match(script, /function syncStorageLocationCreationMode/);
  assert.match(script, /function updateStorageLocationSeriesPreview/);
  assert.match(script, /openStorageLocationDialog\('', parentId \|\| null, mode\)/);
  assert.match(script, /'Mehrere Lagerorte anlegen'/);
  assert.match(script, /series \? '\/storage-locations\/batch' : matrix \? '\/storage-locations\/matrix' : '\/storage-locations'/);
  assert.match(script, /storageLocationHref\(payload\.parentId \|\| ''\)/);
  assert.match(styles, /\.storage-location-series-fields,\.storage-location-matrix-fields \{[^}]*grid-template-columns:1fr 1fr;/);
  assert.match(styles, /#storage-location-form \[hidden\][^{]*\{ display:none; \}/);
});

test('Eine Lagermatrix erzeugt Lagerorte aus frei gewählten Buchstaben- und Zählerbereichen', () => {
  assert.match(html, /id="storage-location-matrix-fields"/);
  assert.match(html, /name="letterStart"[^>]*value="A"/);
  assert.match(html, /name="letterEnd"[^>]*value="C"/);
  assert.match(html, /name="matrixCounterStart"[^>]*value="1"/);
  assert.match(html, /name="matrixCounterEnd"[^>]*value="3"/);
  assert.match(script, /function updateStorageLocationMatrixPreview/);
  assert.match(script, /\(letterEnd\.charCodeAt\(0\) - letterStart\.charCodeAt\(0\) \+ 1\) \* \(counterEnd - counterStart \+ 1\)/);
  assert.match(script, /form\.elements\.creationMode\.value === 'matrix'/);
  assert.match(script, /'Lagermatrix anlegen'/);
  assert.match(script, /matrix \? '\/storage-locations\/matrix'/);
  assert.match(styles, /\.storage-location-series-fields,\.storage-location-matrix-fields \{[^}]*grid-template-columns:1fr 1fr;/);
});

test('Die Auswahl verändert nicht die gespeicherte Reihenfolge einer Spalte', () => {
  assert.match(script, /const merged = new Map\(state\.storageLocations\.map/);
  assert.match(script, /\[\.\.\.path, \.\.\.visibleDetailChildren\]\.forEach\(location => merged\.set/);
  assert.doesNotMatch(script, /new Map\(\[\.\.\.path, \.\.\.visibleDetailChildren\]\.map/);
});

test('Lagerzeilen kommen ohne sichtbare Navigations- und Sortierpfeile aus', () => {
  assert.doesNotMatch(script, /class="storage-finder-chevron"/);
  assert.doesNotMatch(script, /class="storage-order-actions"/);
  assert.doesNotMatch(script, /data-storage-order=/);
});

test('Lagerorte lassen sich per Drag-and-drop unter einen anderen Lagerort verschieben', () => {
  assert.match(script, /draggable="true" data-storage-move-location/);
  assert.match(script, /bindStorageLocationMoveDragDrop/);
  assert.match(script, /data-storage-location-column-target/);
  assert.match(script, /!isDescendant\(destinationId, storageLocationDrag\.id\)/);
  assert.match(script, /method:'PATCH'.*parentId:destinationId \|\| null/);
  assert.match(styles, /\.storage-finder-row\.location-move-over/);
  assert.match(styles, /\.storage-finder-column\.location-column-move-over/);
});

test('Jede Lagerortspalte mischt direkte Unterorte und direkt gelagerte Artikel', () => {
  assert.match(script, /function storageFinderColumn\(parent, locations, stockEntries/);
  assert.match(script, /locations\.map\(location => storageFinderEntry/);
  assert.match(script, /stockEntries\]\.sort[\s\S]*\.map\(entry => storageFinderItemEntry/);
  assert.match(script, /storage-finder-item-row/);
  assert.match(script, /storageLocationId=\$\{encodeURIComponent\(location\.id\)\}/);
});

test('Lagerortzeilen zeigen den vollständigen Unterbaum als kompakte Zähler', () => {
  assert.match(script, /const descendantCount = Number\(location\.descendantCount \|\| 0\)/);
  assert.match(script, /const itemCount = Number\(location\.subtreeItemCount \|\| 0\)/);
  assert.match(script, /title="Anzahl aller untergeordneten Lagerorte"/);
  assert.match(script, /title="Anzahl unterschiedlicher Artikel in diesem Lagerort und seinem Unterbaum"/);
  assert.match(script, /storage-finder-counts/);
  assert.match(styles, /\.storage-finder-column \{ width:340px; min-width:340px;[^}]*flex:0 0 340px;/);
  assert.match(styles, /\.storage-finder-count \{[^}]*border-radius:999px;[^}]*background:#eef0f2;/);
  assert.match(styles, /\.storage-finder-row\.selected \.storage-finder-count[^}]*background:#fff;/);
});

test('Alle Lagerortspalten teilen sich Sortierung und Leerfilter aus dem Seitenkopf', () => {
  assert.match(script, /function storageLocationViewControls\(\)/);
  assert.match(script, /Titel · A–Z/);
  assert.match(script, /Unterlagerorte · viele → wenige/);
  assert.match(script, /Artikel · viele → wenige/);
  assert.match(script, /Zuletzt geändert · neueste zuerst/);
  assert.match(script, /new Intl\.Collator\('de', \{ sensitivity:'base', numeric:true \}\)/);
  assert.match(script, /Number\(location\.subtreeItemCount \|\| 0\) > 0 \|\| selectedPathIds\.has\(location\.id\)/);
  assert.match(script, /Leere Lagerorte anzeigen/);
  assert.match(script, /params\.set\('empty', 'hide'\)/);
  assert.match(script, /params\.set\('sort', state\.storageLocationSort\)/);
  assert.match(script, /bindStorageLocationViewControls\(locationId, itemId, includeArchived\)/);
  assert.match(script, /stockEntries\]\.sort\(\(left, right\) => String\(left\.itemName/);
  assert.match(styles, /\.storage-view-controls \.project-filter-control\.has-value \.project-tool-toggle::after/);
});

test('Artikel im Lager besitzen einen eindeutigen Lagerort-Kontext und eine rechte Detailspalte', () => {
  const inspector = script.match(/function storageFinderItemInspector[\s\S]*?(?=\nfunction bindStorageFinderKeyboard)/)?.[0] || '';
  assert.match(script, /storageContextItemHref/);
  assert.match(script, /location\/\$\{encodeURIComponent\(locationId\)\}\/item\/\$\{encodeURIComponent\(itemId\)\}/);
  assert.match(script, /parts\[3\] === 'item'/);
  assert.match(script, /storageFinderItemInspector/);
  assert.match(inspector, /In \$\{escapeHtml\(location\.name\)\}/);
  assert.match(inspector, /Weitere Lagerorte/);
  assert.match(inspector, /storage-finder-detail-header/);
  assert.match(inspector, /storage-item-column-menu/);
  assert.match(inspector, /storage-item-header-consume[\s\S]*Entnehmen/);
  assert.match(inspector, /Umlagern[\s\S]*Lokaler Mindestbestand/);
  assert.doesNotMatch(inspector, /Artikel bearbeiten/);
  assert.match(inspector, /Vollständige Artikeldetails/);
  assert.doesNotMatch(inspector, /storage-finder-detail-actions/);
  assert.doesNotMatch(inspector, /storage-type-label/);
  assert.match(inspector, /storage-finder-detail-header"><strong>\$\{escapeHtml\(item\.name\)\}<\/strong><div class="storage-finder-column-actions">/);
  assert.doesNotMatch(inspector, /<h2>\$\{escapeHtml\(item\.name\)\}<\/h2>/);
  assert.match(styles, /\.storage-finder-detail-header \{/);
  assert.match(styles, /\.storage-finder-detail dl \{[^}]*border:0;/);
  assert.match(styles, /\.storage-finder-detail dl > div \{[^}]*min-height:30px;[^}]*border:0;/);
});

test('Kleine Displays zeigen eine Drill-down-Ebene mit Zurücknavigation', () => {
  assert.match(script, /storage-mobile-back/);
  assert.match(styles, /@media \(max-width:780px\)[\s\S]*\.storage-finder-column \{[^}]*display:none/);
  assert.match(styles, /\.storage-finder-column\[data-finder-current-column\] \{ display:grid; \}/);
  assert.match(styles, /\.storage-mobile-back \{[^}]*display:flex/);
  assert.match(styles, /\.storage-finder-shell\.has-item-selection \.storage-finder-columns \{ display:none; \}/);
});

test('Finder-Navigation unterstützt Tastatur und Browser-History-fähige Links', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) assert.match(script, new RegExp(key));
  assert.match(script, /class="storage-finder-link" href="\$\{storageLocationHref\(location\.id\)\}"/);
  assert.match(script, /aria-current="page"/);
});

test('Ein Klick auf die freie Spaltenfläche hebt die Auswahl der nächsten Ebene auf', () => {
  assert.match(script, /data-storage-clear-selection="\$\{escapeHtml\(parentId\)\}"/);
  assert.match(script, /function bindStorageFinderBlankNavigation\(includeArchived = false\)/);
  assert.match(script, /event\.target\.closest\('\.storage-finder-row'\)/);
  assert.match(script, /storageLocationHref\(list\.dataset\.storageClearSelection \|\| '', includeArchived\)/);
  assert.match(script, /bindStorageFinderBlankNavigation\(state\.storageLocationsIncludeArchived\)/);
});
