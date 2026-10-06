import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const [html, script, styles] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
]);

test('Erscheinungsbild ist eine eigene administrative Einstellung', () => {
  assert.match(script, /const sections = settingsSections\.filter\([^\n]+state\.user\?\.admin/);
  assert.match(script, /\['appearance','Erscheinungsbild'/);
  assert.match(script, /if \(section === 'appearance'\) return appearanceContent\(\)/);
  assert.match(script, /api\('\/settings\/appearance'/);
});

test('Erscheinungsbild bietet den gemeinsamen Iconpicker mit leerer Auswahl und Favicon-Vorschau', () => {
  assert.match(script, /data-icon-picker="appearance"/);
  assert.match(script, /const optionalPicker = scope === 'appearance'/);
  assert.match(script, /data-clear-icon>Kein Symbol/);
  assert.match(script, /input\.value = '';[\s\S]*input\.dispatchEvent/);
  assert.match(script, /icon:form\.elements\.icon\.value/);
  assert.match(script, /data-appearance-favicon-preview/);
  assert.match(script, /brandIcon\.hidden = !state\.appearance\.iconBody \|\| state\.appearance\.hasLogo/);
});

test('Akzentfarbe lässt sich per Farbfeld, Hex-Code und RGB-Reglern frei einstellen', () => {
  assert.match(script, /name="accentPicker" type="color"/);
  assert.match(script, /name="accentColor"[^>]+pattern="#[^"\n]+"/);
  assert.match(script, /\[\['red','Rot',red\],\['green','Grün',green\],\['blue','Blau',blue\]\]/);
  assert.match(script, /name="\$\{name\}" type="range" min="0" max="255"/);
  assert.match(script, /function applyAccentColor/);
  assert.match(script, /function readableAccent/);
  assert.match(script, /'--red-soft':mixHex/);
  assert.match(script, /'--accent-contrast':contrast/);
  assert.match(styles, /--accent-border:/);
  assert.match(styles, /--accent-level-1:/);
});

test('Hell, Dunkel und Automatisch verwenden dasselbe semantische Farbsystem', () => {
  assert.match(script, /\['light','Hell'/);
  assert.match(script, /\['dark','Dunkel'/);
  assert.match(script, /\['auto','Automatisch'/);
  assert.match(script, /matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(script, /function applyThemeMode/);
  assert.match(script, /systemDarkMode\.addEventListener\('change'/);
  assert.match(script, /semanticAnchors = \{ danger:/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /--danger-soft:/);
  assert.match(styles, /--warning-soft:/);
  assert.match(styles, /--success-soft:/);
  assert.match(styles, /\.appearance-theme-modes/);
  assert.match(html, /name="color-scheme" content="light dark"/);
});

test('Anzeigename, Untertitel und optionales Bildlogo werden in allen Markenflächen verwendet', () => {
  // Login plus one shared desktop/mobile header, without a duplicate mobile logo.
  assert.equal((html.match(/data-brand>/g) || []).length, 2);
  assert.match(html, /data-brand-name>Logbuch/);
  assert.match(html, /data-brand-subtitle hidden/);
  assert.match(html, /data-brand-logo alt="" hidden/);
  assert.match(script, /name="displayName"/);
  assert.match(script, /name="subtitle"/);
  assert.match(script, /name="logo" type="file" accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(script, /data-remove-appearance-logo/);
  assert.match(script, /applyAppearance\(appearance\)/);
  assert.match(styles, /\.brand-wordmark strong/);
  assert.match(styles, /\.brand-custom-logo/);
});
