import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/favicon.js', import.meta.url), 'utf8');
function fixture() {
  const link = {href:'/favicon.svg',writes:0,getAttribute() { return this.href; },setAttribute(name, value) { this.href = value; this.writes++; }};
  const context = vm.createContext({document:{querySelector:() => link}});
  vm.runInContext(source, context);
  return {favicon:context.LogbuchFavicon, link};
}

test('Favicon verwendet den vorhandenen Projektwürfel in Akzent- und Kontrastfarbe', async () => {
  const {favicon} = fixture();
  const svg = favicon.svg('#123abc', '#ffffff');
  assert.match(svg, /rect[^>]*fill="#123abc"/);
  assert.match(svg, /stroke="#ffffff"/);
  const fallback = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  const icons = JSON.parse(await readFile(new URL('../public/lucide-icons.json', import.meta.url), 'utf8'));
  const paths = value => [...value.matchAll(/ d="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(paths(svg), paths(icons.icons.box.body));
  assert.deepEqual(paths(fallback), paths(icons.icons.box.body));
});

test('Helle, dunkle und graue Akzentfarben bekommen einen gut erkennbaren Würfel', () => {
  const {favicon} = fixture();
  for (const color of ['#ffffff','#ffff00','#eeeeee']) assert.match(favicon.svg(color), /stroke="#202327"/);
  for (const color of ['#000000','#123abc','#333333']) assert.match(favicon.svg(color), /stroke="#ffffff"/);
  assert.match(favicon.svg('#AbC'), /fill="#aabbcc"/);
});

test('Ungültige Farbwerte werden nicht in das SVG übernommen', () => {
  const {favicon} = fixture();
  const svg = favicon.svg('"><script>alert(1)</script>', 'url(https://example.org)');
  assert.match(svg, /rect[^>]*fill="#e5322c"/);
  assert.doesNotMatch(svg, /<script|example\.org|url\(/);
});

test('Geänderte Farben erneuern die Favicon-URL, unveränderte Farben nicht', () => {
  const {favicon, link} = fixture();
  favicon.apply('#123abc');
  const first = link.href;
  assert.match(first, /^data:image\/svg\+xml,/);
  favicon.apply('#123abc');
  assert.equal(link.writes, 1);
  favicon.apply('#000000');
  assert.notEqual(link.href, first);
  assert.match(decodeURIComponent(link.href), /rect[^>]*fill="#000000"/);
});

test('Gewählte Bibliothekssymbole ersetzen den Würfel; Entfernen stellt ihn wieder her', async () => {
  const {favicon, link} = fixture();
  const icons = JSON.parse(await readFile(new URL('../public/lucide-icons.json', import.meta.url), 'utf8'));
  favicon.apply('#123abc', '#ffffff', icons.icons.star.body);
  assert.ok(decodeURIComponent(link.href).includes(icons.icons.star.body));
  assert.match(decodeURIComponent(link.href), /color="#ffffff"/);
  favicon.apply('#123abc', '#ffffff', null);
  assert.ok(!decodeURIComponent(link.href).includes(icons.icons.star.body));
  assert.match(decodeURIComponent(link.href), /M21 8a2/);
});

test('App und öffentliche Freigaben laden den gemeinsamen Renderer; Vorschaufarben ändern das Favicon nicht', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const share = await readFile(new URL('../public/project-share.js', import.meta.url), 'utf8');
  assert.match(app, /if \(root === document\.documentElement\) LogbuchFavicon\.apply\(accent, contrast, state\.appearance\.iconBody\);/);
  assert.match(share, /LogbuchFavicon\.apply\(accent, null, appearance\?\.iconBody\)/);
  for (const name of ['app','project-share']) {
    const html = await readFile(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('/favicon.js?') < html.indexOf(`/${name}.js?`));
    assert.match(html, /rel="icon" href="\/favicon\.svg/);
  }
});
