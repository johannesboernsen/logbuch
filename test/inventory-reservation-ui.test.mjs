import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Reservierungsdialog plant Artikel für Projekt und optionalen Arbeitsschritt', () => {
  assert.match(html, /id="reservation-dialog"/);
  assert.match(html, /Für Projekt reservieren/);
  assert.match(html, /name="itemId"/);
  assert.match(html, /name="projectId"/);
  assert.match(script, /<option value="" disabled>Projekt auswählen<\/option>/);
  assert.match(html, /name="projectEntryId"/);
  assert.match(html, /Die Reservierung plant Bedarf, ohne den physischen Bestand zu verändern/);
  assert.match(script, /\$\('\[data-reservation-item-field\]'\)\.hidden = Boolean\(fixedItemId\)/);
  assert.match(styles, /#reservation-form \[hidden\] \{ display:none; \}/);
  assert.match(html, /data-reservation-quantity-step="-1"[\s\S]*data-reservation-quantity-step="1"/);
  assert.match(script, /function syncReservationQuantityUnit/);
  assert.match(script, /input\.step = wholeUnits \? '1' : 'any'/);
});

test('Artikeldetails unterscheiden Gesamtbestand, Reservierungen, Verfügbarkeit und Nachbestellbedarf', () => {
  for (const label of ['Gesamtbestand', 'Reserviert', 'Verfügbar']) assert.match(script, new RegExp(label));
  assert.match(script, /summary\?\.reservedQuantity/);
  assert.match(script, /summary\?\.availableQuantity/);
  assert.match(script, /summary\?\.reorderQuantity/);
  assert.match(script, /nachbestellt werden/);
  assert.match(script, /\$\{formatInventoryQuantity\(reserved\)\} \$\{item\.stockUnit\} reserviert/);
});

test('Projekt- und Artikelansicht verwenden dieselbe Reservierung', () => {
  assert.match(script, /data-reservation-project/);
  assert.match(script, /data-reservation-item/);
  assert.match(script, /api\(`\/reservations\?projectId=/);
  assert.match(script, /api\(`\/reservations\?itemId=/);
  assert.match(script, /inventoryMaterials:'Lagermaterial'/);
});

test('Lose Sammlungen werden ohne Menge auf mehrere Projekte gebucht', () => {
  assert.match(html, /Lose Sammlung ohne Mengenerfassung/);
  assert.match(html, /name="trackingMode" value="COLLECTION"/);
  assert.match(script, /Die Sammlung kann ohne Menge gleichzeitig mehreren Projekten zugeordnet werden/);
  assert.match(script, /input\.disabled = collection/);
  assert.match(script, /Lose Sammlung auf Projekt buchen/);
  assert.match(script, /Projektbuchung aufheben/);
  assert.match(script, /Lagermaterial zuordnen/);
});

test('Teilerfüllung wird als verknüpfte Entnahme angeboten', () => {
  assert.match(html, /id="reservation-fulfill-dialog"/);
  assert.match(html, /Die Entnahme reduziert den physischen Bestand und erfüllt den Projektbedarf/);
  assert.match(script, /\/fulfill/);
  assert.match(script, /remainingQuantity/);
});

test('Nur aktive Reservierungen bleiben sichtbar und Aufheben ist der einzige Abschluss', () => {
  assert.match(script, /Reservierung aufheben/);
  assert.match(script, /Reservierung aufgehoben\./);
  assert.doesNotMatch(script, /data-reservation-cancel/);
  assert.match(script, /activeReservations\.map\(reservation => reservationMarkup/);
  assert.match(script, /state\.projectReservations = \(reservationData\.reservations \|\| \[\]\)\.filter\(reservation => reservation\.status === 'ACTIVE'\)/);
});

test('Die zurückhaltende Reservierungsaktion steht bei den Reservierungen', () => {
  assert.match(script, /inventory-section-create"><button class="button secondary compact"[^>]*data-reservation-create/);
  assert.match(script, /inventory-reservation-list">\$\{activeReservations\.map[\s\S]*\$\{reservationActions\}<\/div>/);
  assert.doesNotMatch(script, /button primary compact"[^>]*data-reservation-create data-reservation-item/);
  assert.match(styles, /\.inventory-section-create \{[^}]*justify-content:flex-end;/);
  assert.match(script, /Keine aktive Projektreservierung/);
  assert.match(styles, /\.inventory-reservation-empty \{[^}]*text-align:left;/);
  assert.match(styles, /\.inventory-reservation-empty \.inventory-section-create \{[^}]*justify-content:flex-start;/);
});

test('Reservieren, Aufheben und Projektentnahmen erscheinen in der Artikelhistorie', () => {
  assert.match(script, /function inventoryHistoryMarkup/);
  assert.match(script, /Für Projekt reserviert/);
  assert.match(script, /Reservierung aufgehoben/);
  assert.match(script, /Für Projekt entnommen/);
  assert.match(script, /\['RELEASED','CANCELLED'\]\.includes\(reservation\.status\)/);
  assert.match(styles, /\.inventory-stock-transaction\.reservation-event > span/);
});

test('Reservierungen bleiben auf kleinen Displays kartenbasiert', () => {
  assert.match(styles, /\.inventory-reservation-list/);
  assert.match(styles, /\.project-reservation-list/);
  assert.match(styles, /\.project-reservation-list \{ grid-template-columns:1fr; \}/);
  assert.doesNotMatch(script, /<table[^>]*inventory-reservation/);
});
