import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('Projektansichten bieten eine verwaltete öffentliche Freigabe', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('public/app.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/styles.css', root), 'utf8'),
  ]);
  assert.match(html, /id="project-share-dialog"/);
  assert.match(html, /Ohne Anmeldung sichtbar/);
  assert.match(js, /data-open-project-share/);
  assert.match(js, /scopeType:'FOLDER'/);
  assert.match(js, /scopeType:'STATUS'/);
  assert.match(js, /api\('\/project-shares'/);
  assert.match(js, /data-project-share-rotate/);
  assert.match(js, /data-project-share-disable/);
  assert.match(css, /\.project-share-row/);
});

test('Öffentliche Projektseite zeigt ausschließlich reduzierte Felder und Ordnernavigation', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('public/project-share.html', root), 'utf8'),
    readFile(new URL('public/project-share.js', root), 'utf8'),
    readFile(new URL('public/project-share.css', root), 'utf8'),
  ]);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /Öffentliche Projektübersicht/);
  assert.match(js, /api\/public\/project-shares/);
  assert.match(js, /project\.title/);
  assert.match(js, /project\.description/);
  assert.match(js, /project\.status/);
  assert.match(js, /project\.dueDate/);
  assert.match(js, /Fälligkeit · früheste zuerst/);
  assert.match(js, /Projektname · A–Z/);
  assert.match(js, /Status · Idee bis Abgeschlossen/);
  assert.match(js, /data-project-sort/);
  assert.match(css, /\.public-project-list/);
  assert.match(css, /\.public-project-row/);
  assert.doesNotMatch(js, /public-project-card/);
  assert.doesNotMatch(js, /project\.(entries|tasks|files|materials)/);
});
