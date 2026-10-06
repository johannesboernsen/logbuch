import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const [html, script, styles, license] = await Promise.all([
  readFile(new URL('public/app.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
  readFile(new URL('public/vendor/qrcode-generator.LICENSE.txt', root), 'utf8'),
]);

test('QR-Etikettendialog ist für Artikel, Lagerorte und Kategorien erreichbar', () => {
  assert.match(html, /id="inventory-label-dialog"/);
  assert.match(html, /QR als SVG/);
  assert.match(html, /QR als PNG/);
  assert.match(html, /Etiketten drucken \/ PDF/);
  for (const kind of ['item', 'location', 'category']) {
    assert.match(script, new RegExp(`data-inventory-label-kind="${kind}"`));
  }
  assert.match(styles, /\.inventory-label-card\[data-label-layout="portrait"\]/);
  assert.match(styles, /\.inventory-label-options > \[hidden\] \{ display:none; \}/);
  assert.match(styles, /\.inventory-label-actions \.button\[hidden\] \{ display:none; \}/);
});

test('QR-Codes werden lokal aus den namensunabhängigen Dauerlinks erzeugt', async () => {
  assert.match(html, /src="\/vendor\/qrcode-generator\.js\?v=1\.4\.4"/);
  assert.match(script, /qrcode\(0, 'M'\)/);
  assert.match(script, /permanentInventoryItemHref\(item\.id\)/);
  assert.match(script, /permanentInventoryCategoryHref\(category\.id\)/);
  assert.match(script, /permanentStorageLocationHref\(storageLocation\.id\)/);
  assert.match(license, /MIT License/);

  const vendor = await readFile(new URL('public/vendor/qrcode-generator.js', root), 'utf8');
  const context = {};
  vm.runInNewContext(vendor, context);
  const qr = context.qrcode;
  const code = qr(0, 'M');
  code.addData('https://logbuch.example/#/inventory/item/item-stable-id', 'Byte');
  code.make();
  assert.ok(code.getModuleCount() > 20);
});

test('Ein Lagerort kann einen deduplizierten Etikettenbogen seines Unterbaums erzeugen', () => {
  assert.match(html, /value="direct">Direkt enthaltene Artikel/);
  assert.match(html, /value="subtree">Artikel im gesamten Unterbaum/);
  assert.match(script, /async function inventoryLocationItemLabels\(locationId, subtree = false\)/);
  assert.match(script, /const seen = new Set\(\)/);
  assert.match(script, /seen\.has\(stockEntry\.itemId\)/);
  assert.match(script, /selectedIds\.add\(location\.id\)/);
  assert.match(script, /const pageSize = roll \? `\$\{profile\.width\}mm \$\{profile\.height\}mm` : `A4 \$\{output\.orientation\}`/);
  assert.match(script, /grid-template-columns:repeat\(auto-fill,\$\{profile\.width\}mm\)/);
});

test('Freie Druckprofile steuern Maße, Layout, Inhalte und Kalibrierung', () => {
  assert.match(html, /value="roll">Etikettendrucker/);
  for (const name of ['profileName', 'profileWidth', 'profileHeight', 'profileMargin', 'profileOffsetX', 'profileOffsetY', 'profileLayout', 'profileContent', 'profileBorder']) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(script, /const inventoryBuiltinLabelProfiles = \[/);
  assert.match(script, /function inventoryLabelLayout\(profile\)/);
  assert.match(script, /contentLevel !== normalized\.contentLevel/);
  assert.match(script, /inventoryLabelProfiles:profiles/);
  assert.match(styles, /\.inventory-label-profile-editor/);
});

test('Rollenetiketten werden einzeln in exakter Millimetergröße gedruckt', () => {
  assert.match(script, /@page\{size:\$\{pageSize\};margin:\$\{roll \? '0' : '8mm'\}/);
  assert.match(script, /width:var\(--label-width\);height:var\(--label-height\)/);
  assert.match(script, /\.roll \.label\{margin:0;break-after:page\}/);
  assert.match(script, /eine Druckseite je Etikett/);
});

test('Einzelcodes stehen als SVG und PNG ohne externen QR-Dienst bereit', () => {
  assert.match(script, /function downloadInventoryLabelSvg\(\)/);
  assert.match(script, /type:'image\/svg\+xml;charset=utf-8'/);
  assert.match(script, /function downloadInventoryLabelPng\(\)/);
  assert.match(script, /canvas\.toBlob/);
  assert.doesNotMatch(script, /api\.qrserver|chart\.googleapis|quickchart\.io/);
});
