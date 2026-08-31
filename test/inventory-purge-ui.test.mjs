import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const script = await readFile(new URL('public/app.js', root), 'utf8');

test('Das Lagerarchiv bietet Wiederherstellen und endgültiges Löschen getrennt an', () => {
  assert.match(script, /data-inventory-archive-restore/);
  assert.match(script, /data-inventory-permanent-delete/);
  assert.match(script, />Endgültig löschen</);
});
test('Vor dem Löschen zeigt die Oberfläche die betroffenen Lagerdaten an', () => {
  assert.match(script, /purge-preview/);
  assert.match(script, /Lagerplätze.*Buchungen.*Reservierungen.*Kategoriezuordnungen/s);
  assert.match(script, /Lagerorte.*Bestandseinträge.*Buchungen.*Artikeln/s);
  assert.match(script, /unwiderruflich gelöscht/);
});
