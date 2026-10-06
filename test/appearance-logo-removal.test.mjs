import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const start = script.indexOf("  $('[data-remove-appearance-logo]', form)?.addEventListener");
assert.notEqual(start, -1);
const handlerSource = script.slice(start, script.indexOf('  form.onsubmit =', start));

function setup({ fail = false } = {}) {
  let handler;
  let confirm;
  const calls = [];
  const button = { disabled:false };
  const appearance = { hasLogo:false, logoUrl:null, icon:'camera' };
  const context = vm.createContext({
    form:{}, appearanceLogoPreviewUrl:'blob:pending-logo',
    $:() => ({ addEventListener:(_event, callback) => { handler = callback; } }),
    confirmAction:() => new Promise(resolve => { confirm = resolve; }),
    api:async (path, options) => {
      calls.push(['api', path, options.method]);
      if (fail) throw new Error('Logo konnte nicht entfernt werden');
      return appearance;
    },
    URL:{ revokeObjectURL:url => calls.push(['revoke', url]) },
    applyAppearance:value => calls.push(['appearance', value]),
    toast:message => calls.push(['toast', message]),
    renderSettings:async () => calls.push(['render']),
  });
  vm.runInContext(handlerSource, context);
  const event = { currentTarget:button };
  const completed = handler(event);
  // Browsers clear currentTarget after synchronous event dispatch, while the dialog is still open.
  event.currentTarget = null;
  return { button, calls, context, appearance, completed, confirm:value => confirm(value) };
}

test('Logo entfernen behält den Button über die asynchrone Bestätigung hinweg', async () => {
  const run = setup();
  assert.equal(run.calls.length, 0);
  run.confirm(true);
  await run.completed;
  assert.equal(run.button.disabled, true);
  assert.deepEqual(run.calls, [
    ['api', '/settings/appearance/logo', 'DELETE'],
    ['revoke', 'blob:pending-logo'],
    ['appearance', run.appearance],
    ['toast', 'Eigenes Logo entfernt'],
    ['render'],
  ]);
  assert.equal(run.context.appearanceLogoPreviewUrl, '');
});

test('Abbrechen lässt das Logo und die Vorschau unverändert', async () => {
  const run = setup();
  run.confirm(false);
  await run.completed;
  assert.deepEqual(run.calls, []);
  assert.equal(run.button.disabled, false);
  assert.equal(run.context.appearanceLogoPreviewUrl, 'blob:pending-logo');
});

test('Ein Löschfehler wird angezeigt und der Button für einen neuen Versuch freigegeben', async () => {
  const run = setup({ fail:true });
  run.confirm(true);
  await run.completed;
  assert.equal(run.button.disabled, false);
  assert.equal(run.context.appearanceLogoPreviewUrl, 'blob:pending-logo');
  assert.deepEqual(run.calls, [
    ['api', '/settings/appearance/logo', 'DELETE'],
    ['toast', 'Logo konnte nicht entfernt werden'],
  ]);
});
