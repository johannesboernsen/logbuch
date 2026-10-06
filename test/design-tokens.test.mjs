import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../public/' + name, import.meta.url), 'utf8');

test('Alle Oberflächen laden dieselben semantischen Radiuswerte vor ihren Styles', async () => {
  const tokens = await read('design-tokens.css');
  for (const [role, value] of Object.entries({frame:9, panel:7, menu:6, control:6, compact:4})) {
    assert.ok(tokens.includes('--radius-' + role + ':' + value + 'px;'));
  }
  for (const [htmlFile, cssFile] of [['app.html','styles.css'], ['project-share.html','project-share.css'], ['install.html','install.css']]) {
    const html = await read(htmlFile);
    const css = await read(cssFile);
    assert.ok(html.indexOf('/design-tokens.css?') >= 0);
    assert.ok(html.indexOf('/design-tokens.css?') < html.indexOf('/' + cssFile + '?'));
    assert.ok(css.includes('var(--radius-frame)'));
    assert.ok(css.includes('var(--radius-control)'));
    assert.doesNotMatch(css, /--radius-[a-z]+\s*:/);
    // Local UI pixel radii must not return; keep decorative folder glyphs,
    // circular/pill shapes, square joins and physical print dimensions.
    for (const rule of css.split('}')) {
      if (rule.trim().startsWith('.folder-icon')) continue;
      for (const [, radius] of rule.matchAll(/border-radius:([^;}]+)/g)) {
        assert.doesNotMatch(radius, /\b(?:[6-9]|1[0-9]|20)px\b/, htmlFile + ': ' + rule);
      }
    }
  }
});

test('Rahmen, Dialoge und Menüs nutzen passende Rollen auch in der öffentlichen Ansicht', async () => {
  const app = await read('styles.css');
  const shared = await read('project-share.css');
  for (const selector of ['.storage-finder-frame', '.settings-panel', 'dialog']) {
    const rule = app.split('\n').find(line => line.startsWith(selector + ' {'));
    assert.ok(rule.includes('border-radius:var(--radius-frame)'));
  }
  assert.match(shared, /\.public-project-list\{[^}]*border-radius:var\(--radius-frame\)/);
  assert.match(shared, /\.public-folder-card\{[^}]*border-radius:var\(--radius-frame\)/);
  assert.match(shared, /\.public-sort-options \{[^}]*border-radius:var\(--radius-menu\)/);
  assert.match(app, /\.action-menu-panel \{[^}]*border-radius:var\(--radius-menu\)/);
  assert.match(app, /\.tag-filter-panel,\.project-sort-panel \{[^}]*border-radius:var\(--radius-menu\)/);
  assert.match(app, /\.storage-finder-count \{[^}]*border-radius:999px/);
});
