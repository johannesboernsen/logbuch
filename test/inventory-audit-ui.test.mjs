import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Inventur besitzt einen zentralen Lagerbereich mit dringenden und alten Positionen', () => {
  assert.match(html, /href="\/#\/inventory\/audits" data-inventory-route="audits"/);
  assert.match(script, /Dringend zu inventarisieren/);
  assert.match(script, /Lange unangetastet/);
  assert.match(script, /staleDays/);
  assert.match(styles, /\.inventory-audit-summary/);
});

test('Inventurläufe können nach Lagerort, Unterorten und mehreren Kategorien eingegrenzt werden', () => {
  assert.match(html, /name="locationId"/);
  assert.match(html, /name="includeLocationDescendants"/);
  assert.match(html, /name="categoryIds" multiple/);
  assert.match(html, /name="includeCategoryDescendants"/);
  assert.match(script, /categoryIds:\[\.\.\.form\.elements\.categoryIds\.selectedOptions\]/);
});

test('Artikel lassen sich normal oder dringend zur Inventur vormerken', () => {
  assert.match(script, /data-inventory-audit-request/);
  assert.match(html, /<option value="NORMAL">Normal<\/option><option value="URGENT">Dringend<\/option>/);
  assert.match(html, /Warum sollte der Bestand geprüft werden/);
  assert.match(script, /Vormerkung entfernen/);
});

test('Mengenartikel und lose Sammlungen erhalten passende Prüfergebnisse', () => {
  assert.match(script, /Gezählter Bestand/);
  assert.match(script, /Abweichung direkt als Korrektur buchen/);
  assert.match(script, /Vorhanden und in Ordnung/);
  assert.match(script, /Vorhanden, aber Klärungsbedarf/);
  assert.match(script, /Nicht auffindbar/);
});
