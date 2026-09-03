import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('Backup-Oberfläche bietet Vollbackup und kennzeichnet seine Reichweite', async () => {
  const [js, css, html] = await Promise.all([
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/styles.css', root), 'utf8'),
    readFile(new URL('public/app.html', root), 'utf8'),
  ]);
  assert.match(js, /href="\/api\/backup\/full"/);
  assert.match(js, /Projekte und Dateien, Benutzer und Erinnerungen/);
  assert.match(js, /das gesamte Lager mit Kategorien, Lagerorten, Artikeln, Beständen, Reservierungen und Historie/);
  assert.match(js, /id="full-backup-file"/);
  assert.match(js, /data-import-full/);
  assert.match(js, /api\('\/import\/full-archive'/);
  assert.match(js, /Alle angemeldeten Geräte/);
  assert.match(css, /\.full-backup-card\s*\{[^}]*grid-column:1\s*\/\s*-1/);
  assert.match(html, /app\.js\?v=20260903-011/);
});
