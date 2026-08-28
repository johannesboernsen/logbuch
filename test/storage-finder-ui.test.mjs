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
  assert.match(html, /href="\/#\/inventory" data-inventory-route="locations">Lagerorte<\/a>/);
  assert.match(html, /projects-menu[\s\S]*inventory-menu[\s\S]*settings-menu/);
  assert.match(script, /`\/location\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(script, /parts\[1\] === 'location'/);
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

test('Lagerorte werden ausschließlich über die Plus-Schaltflächen der Spalten angelegt', () => {
  assert.match(script, /data-storage-create="\$\{escapeHtml\(parentId\)\}"/);
  assert.doesNotMatch(script, /data-storage-create="">Lagerort anlegen/);
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
  assert.match(script, /stockEntries\.map\(entry => storageFinderItemEntry/);
  assert.match(script, /storage-finder-item-row/);
  assert.match(script, /storageLocationId=\$\{encodeURIComponent\(location\.id\)\}/);
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
