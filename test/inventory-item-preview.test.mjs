import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const source = script.slice(script.indexOf('function bindInventoryItemPreviewLinks()'), script.indexOf('function bindStorageFinderKeyboard()'));

function setup() {
  const timers = new Map();
  let nextTimer = 0;
  const links = ['a', 'b'].map(id => ({
    href:`/#/inventory/location/shelf/item/${id}`, isConnected:true,
    dataset:{ inventoryItemDetailsHref:`/#/inventory/item/${id}` },
    addEventListener(name, handler) { this[name] = handler; },
  }));
  const location = { href:'/#/inventory/location/shelf' };
  vm.runInNewContext(source + '\nbindInventoryItemPreviewLinks();', {
    document:{ querySelectorAll:() => links }, location,
    setTimeout:callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout:id => timers.delete(id),
  });
  const click = (link, options = {}) => {
    const event = { detail:1, prevented:false, preventDefault() { this.prevented = true; }, ...options };
    link.onclick(event);
    return event;
  };
  return { links, location, click, flush:() => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); } };
}

test('Einfachklick öffnet die Vorschau, Doppelklick direkt die vollständigen Artikeldetails', () => {
  const run = setup();
  run.click(run.links[0]);
  run.flush();
  assert.equal(run.location.href, run.links[0].href);
  run.click(run.links[1]);
  run.click(run.links[1], { detail:2 });
  assert.equal(run.location.href, run.links[1].dataset.inventoryItemDetailsHref);
  run.flush();
  assert.equal(run.location.href, run.links[1].dataset.inventoryItemDetailsHref);
});

test('Native Doppelklicks verwenden das vollständige, auch archivfähige Linkziel', () => {
  const run = setup();
  run.links[0].dataset.inventoryItemDetailsHref += '?archived=1';
  run.click(run.links[0]);
  run.links[0].ondblclick({ preventDefault() {} });
  run.flush();
  assert.equal(run.location.href, '/#/inventory/item/a?archived=1');
});

test('Tastatur und modifizierte Klicks behalten das native Linkverhalten', () => {
  for (const options of [{ detail:0 }, { ctrlKey:true }, { metaKey:true }, { shiftKey:true }, { altKey:true }]) {
    const run = setup();
    assert.equal(run.click(run.links[0], options).prevented, false);
    run.flush();
    assert.equal(run.location.href, '/#/inventory/location/shelf');
  }
});

test('Wechselnde Artikel, Drag und andere Navigation lassen keine verspätete Vorschau zurück', () => {
  const run = setup();
  run.click(run.links[0]);
  run.click(run.links[1]);
  run.flush();
  assert.equal(run.location.href, run.links[1].href);
  run.click(run.links[0]);
  run.links[0].dragstart();
  run.flush();
  assert.equal(run.location.href, run.links[1].href);
  run.click(run.links[0]);
  run.location.href = '/#/projects';
  run.flush();
  assert.equal(run.location.href, '/#/projects');
});

test('Lagerorte und Kategorien binden dieselbe Artikelinteraktion ein', () => {
  for (const name of ['bindInventoryCategoryActions', 'bindStorageLocationActions']) {
    assert.ok(script.includes(`function ${name}() {\n  bindInventoryItemPreviewLinks();`));
  }
  assert.match(script, /data-inventory-item-details-href="\$\{inventoryItemHref\(item.id, item.status === 'ARCHIVED', ''\)\}"/);
  assert.match(script, /data-inventory-item-details-href="\$\{inventoryItemHref\(entry.itemId, entry.itemStatus === 'ARCHIVED', ''\)\}"/);
});
