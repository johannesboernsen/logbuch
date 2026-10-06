import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changelogRelease, updateManifestRelease } from '../tools/changelog.mjs';

const root = new URL('..', import.meta.url);
const [changelog, readme, script, styles, workflow, releaseTool] = await Promise.all([
  readFile(new URL('CHANGELOG.md', root), 'utf8'),
  readFile(new URL('README.md', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
  readFile(new URL('.github/workflows/release.yml', root), 'utf8'),
  readFile(new URL('tools/build-release.mjs', root), 'utf8'),
]);

test('Das GitHub-Changelog enthält veröffentlichte Versionen und einen Bereich für kommende Änderungen', () => {
  assert.match(changelog, /^## \[Unveröffentlicht\]/m);
  assert.match(changelog, /^## \[0\.7\.1\] - 2026-08-31$/m);
  assert.match(readme, /\[Changelog\]\(CHANGELOG\.md\)/);
});

test('Releaseinformationen werden zuverlässig aus dem passenden Changelog-Abschnitt gelesen', () => {
  const release = changelogRelease(changelog, '0.7.1');
  assert.match(release.summary, /Lager/);
  assert.ok(release.highlights.length >= 3);
  assert.match(release.markdown, /^## \[0\.7\.1\]/);
  assert.doesNotMatch(release.markdown, /^## \[0\.7\.0\]/m);
  assert.throws(() => changelogRelease(changelog, '9.9.9'), /fehlt der Abschnitt/);
});

test('Der Release-Prozess veröffentlicht dieselben Informationen im Manifest und auf GitHub', () => {
  assert.match(releaseTool, /changelogRelease/);
  assert.match(releaseTool, /updateManifestRelease/);
  assert.match(releaseTool, /highlights:updateInformation\.highlights/);
  assert.match(releaseTool, /release-notes\.md/);
  assert.match(workflow, /--notes-file dist\/release-notes\.md/);
});

test('Update-Manifeste bleiben innerhalb der vom Logbuch akzeptierten Grenzen', () => {
  const metadata = updateManifestRelease({
    summary:'Kurze Zusammenfassung',
    highlights:Array.from({ length:13 }, (_, index) => `Änderung ${index + 1}`),
  });
  assert.equal(metadata.highlights.length, 10);
  assert.equal(metadata.highlights.at(-1), 'Änderung 10');
  assert.throws(
    () => updateManifestRelease({ summary:'Test', highlights:['x'.repeat(301)] }),
    /zwischen 1 und 300 Zeichen/,
  );
});

test('Die Systemeinstellungen zeigen Highlights und das ausführliche Changelog direkt am Update', () => {
  assert.match(script, /Die wichtigsten Änderungen/);
  assert.match(script, /update\.highlights\.map/);
  assert.match(script, /Ausführliches Changelog auf GitHub/);
  assert.match(styles, /\.update-highlights \{/);
});
