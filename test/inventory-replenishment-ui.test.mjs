import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Nachbestellen besitzt eine stabile Lagerroute im gemeinsamen Untermenü', () => {
  assert.match(script, /inventoryReplenishmentHref/);
  assert.match(script, /parts\[1\] === 'replenishment'/);
  assert.match(script, /renderInventoryReplenishment\(routeQuery\)/);
  assert.match(html, /data-inventory-route="replenishment"><span>Nachbestellen<\/span>/);
});

test('Fehlbedarfsansicht erklärt globale, lokale und projektbezogene Gründe', () => {
  for (const label of ['Projektbedarf fehlt', 'Globaler Mindestbestand', 'Lagerort-Mindestbestand']) assert.match(script, new RegExp(label));
  for (const metric of ['Physisch', 'Reserviert', 'Verfügbar', 'Globales Minimum']) assert.match(script, new RegExp(`<span>${metric}<\\/span>`));
  assert.match(script, /localShortages/);
  assert.match(script, /storageLocationHref\(shortage\.storageLocationId\)/);
});

test('Suche, Vollansicht und Sortierungen bleiben als Deep Link erhalten', () => {
  assert.match(script, /params\.set\('includeSatisfied', '1'\)/);
  assert.match(script, /routeQuery\.get\('all'\) === '1'/);
  for (const sort of ['urgency','reorder','available','name']) assert.match(script, new RegExp(`value="${sort}"`));
  assert.match(script, /inventoryReplenishmentHref\(form\.elements\.q\.value\.trim\(\), form\.elements\.view\.value === 'all', form\.elements\.sort\.value\)/);
});

test('Händler- und Artikellinks sind direkt nutzbar', () => {
  assert.match(script, /Beim Händler öffnen/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
  assert.match(script, /Artikel öffnen/);
  assert.match(script, /inventoryItemHref\(item\.itemId, false, ''\)/);
});

test('Nachbestellkarten bleiben auf kleinen Displays ohne breite Tabelle lesbar', () => {
  assert.match(styles, /@media \(max-width:780px\)[\s\S]*\.replenishment-controls \{ grid-template-columns:1fr; \}/);
  assert.match(styles, /\.replenishment-metrics \{ grid-template-columns:1fr 1fr; \}/);
  assert.match(styles, /\.replenishment-item > footer \{ align-items:stretch; flex-direction:column; \}/);
  assert.doesNotMatch(script, /<table[^>]*replenishment/);
});
