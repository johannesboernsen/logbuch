import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/update-monitor.js', import.meta.url), 'utf8');
const context = { globalThis:{} };
vm.runInNewContext(source, context);
const { waitForVersion } = context.globalThis.LogbuchUpdateMonitor;

test('Update-Monitor übersteht einen Container-Neustart und erkennt die Zielversion', async () => {
  let time = 0;
  const responses = [
    () => { throw new Error('nicht erreichbar'); },
    () => ({ currentVersion:'0.3.2', state:'queued' }),
    () => ({ currentVersion:'0.3.3', state:'success' }),
  ];
  const attempts = [];
  const result = await waitForVersion({
    targetVersion:'0.3.3',
    check:async () => responses.shift()(),
    onAttempt:value => attempts.push(value),
    timeoutMs:100,
    intervalMs:10,
    now:() => time,
    delay:async milliseconds => { time += milliseconds; },
  });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.attempts, 3);
  assert.deepEqual(attempts.map(attempt => attempt.reachable), [false, true]);
});

test('Update-Monitor meldet einen Fehler des AIO-Updaters', async () => {
  const result = await waitForVersion({
    targetVersion:'0.3.3',
    check:async () => ({ currentVersion:'0.3.2', state:'failed', stateMessage:'Healthcheck fehlgeschlagen' }),
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.status.stateMessage, 'Healthcheck fehlgeschlagen');
});

test('Update-Monitor fordert nach Ablauf des Zeitfensters zum Neuladen auf', async () => {
  let time = 0;
  const result = await waitForVersion({
    targetVersion:'0.3.3',
    check:async () => ({ currentVersion:'0.3.2', state:'queued' }),
    timeoutMs:25,
    intervalMs:10,
    now:() => time,
    delay:async milliseconds => { time += milliseconds; },
  });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.attempts, 3);
});
