import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const support = join(root, 'app', 'Support.php');

test('Unlesbare JSON-Laufzeitdateien liefern still den Fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logbuch-support-test-'));
  const path = join(directory, 'state.json');
  await writeFile(path, '{"state":"success"}');
  await chmod(path, 0o000);
  try {
    const code = 'require $argv[1]; echo json_encode(\\Logbuch\\readJsonFile($argv[2], ["state"=>"idle"]));';
    const { stdout, stderr } = await run('php', ['-d', 'display_errors=1', '-r', code, support, path]);
    assert.equal(stderr, '');
    assert.equal(stdout, '{"state":"idle"}');
  } finally {
    await chmod(path, 0o600);
    await rm(directory, { recursive:true, force:true });
  }
});
