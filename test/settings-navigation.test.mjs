import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const navigationSource = app.slice(app.indexOf('const settingsSections ='), app.indexOf('const settingRow ='));
function navigation(admin, active, available = false) {
  const context = vm.createContext({state:{user:{admin},update:{available}},escapeHtml:String});
  vm.runInContext(navigationSource, context);
  return context.settingsNavigation(active);
}

test('Einstellungen ist ein Direktlink ohne Dropdown im Hauptmenü', () => {
  assert.match(html, /<a id="settings-link"[^>]*href="\/#\/settings\/general"[^>]*data-route="settings"/);
  assert.doesNotMatch(html + app, /settings-toggle|id="settings-subnav"|setSettingsMenu/);
  assert.match(app, /class="settings-workspace">\$\{settingsNavigation\(active\)\}/);
});

test('Administratoren erhalten alle bisherigen Einstellungsbereiche mit aktiver Auswahl', () => {
  const markup = navigation(true, 'appearance');
  assert.deepEqual([...markup.matchAll(/data-settings-route="([^"]+)"/g)].map(match => match[1]), ['general','tags','profile','users','data','appearance','server','security','system']);
  assert.match(markup, /data-settings-route="appearance" aria-current="page"/);
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  assert.match(markup, /aria-label="Einstellungsbereiche"/);
});

test('Normale Benutzer sehen nur Allgemein und Profil, keine Administrationslinks', () => {
  const markup = navigation(false, 'profile');
  assert.deepEqual([...markup.matchAll(/data-settings-route="([^"]+)"/g)].map(match => match[1]), ['general','profile']);
  assert.match(markup, /data-settings-route="profile" aria-current="page"/);
  assert.doesNotMatch(markup, /system-update-badge/);
});

test('Protokoll bleibt dem System zugeordnet; Update-Hinweise brauchen kein offenes Dropdown', () => {
  assert.match(navigation(true, 'audit'), /data-settings-route="system" aria-current="page"/);
  assert.match(navigation(true, 'system', true), /id="system-update-badge" class="update-nav-badge">Update/);
  assert.match(navigation(true, 'system', false), /id="system-update-badge" class="update-nav-badge" hidden/);
});

test('Einstellungsnavigation steht links im gemeinsamen Rahmen und mobil über dem Inhalt', () => {
  assert.match(css, /\.settings-workspace \{[^}]*grid-template-columns:260px minmax\(0,1fr\);/);
  assert.match(css, /\.settings-navigation \{[^}]*border-right:1px solid var\(--line\);/);
  assert.match(css, /@media \(max-width:900px\) \{\s*\.settings-workspace \{ grid-template-columns:minmax\(0,1fr\);/);
  assert.match(css, /\.settings-nav \{ display:flex; max-height:none; overflow-x:auto;/);
});
