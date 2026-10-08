import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const identity = (name, ip) => createHash('sha256').update(`${name}|${ip}`).digest('hex');
const origin = ip => `origin:${createHash('sha256').update(ip).digest('hex')}`;

async function concurrentLogins(dbPath, directory, names, ip) {
  const barrier = join(directory, `start-${Date.now()}`);
  const script = `require 'app/bootstrap.php';
    while (!is_file($argv[2])) usleep(1000);
    try { (new Logbuch\\Auth((new Logbuch\\Database($argv[1]))->pdo()))->login($argv[3], 'falsch', $argv[4], 'test'); echo '200'; }
    catch (Logbuch\\HttpError $error) { echo $error->status; }`;
  const attempts = names.map(name => new Promise((resolve, reject) => {
    const child = spawn('php', ['-r', script, dbPath, barrier, name, ip], { cwd:root, stdio:['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Number(output)) : reject(new Error(errors || `PHP exit ${code}`)));
  }));
  await writeFile(barrier, 'go');
  return Promise.all(attempts);
}

function attemptState(dbPath, key) {
  const script = `require 'app/bootstrap.php';
    $db=(new Logbuch\\Database($argv[1]))->pdo();
    $statement=$db->prepare('SELECT attempts, blocked_until FROM login_attempts WHERE identity = ?');
    $statement->execute([$argv[2]]);
    echo json_encode($statement->fetch());`;
  return JSON.parse(execFileSync('php', ['-r', script, dbPath, key], { cwd:root, encoding:'utf8' }));
}

test('parallele Fehlversuche werden einmalig gezählt und vor der Passwortprüfung gesperrt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logbuch-login-race-'));
  const dbPath = join(directory, 'logbuch.sqlite');
  try {
    execFileSync('php', ['-r', "require 'app/bootstrap.php'; $db=(new Logbuch\\Database($argv[1]))->pdo(); (new Logbuch\\Auth($db))->createAdmin('admin', 'ein-langes-Testpasswort');", dbPath], { cwd:root });
    const ip = '192.0.2.5';
    const results = await concurrentLogins(dbPath, directory, Array(20).fill('admin'), ip);
    assert.equal(results.filter(status => status === 401).length, 5);
    assert.equal(results.filter(status => status === 429).length, 15);
    const account = attemptState(dbPath, identity('admin', ip));
    assert.equal(Number(account.attempts), 5);
    assert.ok(Number(account.blocked_until) > Date.now() / 1000);
    assert.equal(Number(attemptState(dbPath, origin(ip)).attempts), 5);

    const sprayIp = '192.0.2.6';
    const spray = await concurrentLogins(dbPath, directory, Array.from({ length:25 }, (_, index) => `unknown-${index}`), sprayIp);
    assert.equal(spray.filter(status => status === 401).length, 20);
    assert.equal(spray.filter(status => status === 429).length, 5);
    assert.equal(Number(attemptState(dbPath, origin(sprayIp)).attempts), 20);

    const recoveryIp = '192.0.2.7';
    const recoveryScript = `require 'app/bootstrap.php';
      $auth=new Logbuch\\Auth((new Logbuch\\Database($argv[1]))->pdo());
      try { $auth->login('admin', 'falsch', $argv[2], 'test'); } catch (Logbuch\\HttpError $error) {}
      $auth->login('admin', 'ein-langes-Testpasswort', $argv[2], 'test');`;
    execFileSync('php', ['-r', recoveryScript, dbPath, recoveryIp], { cwd:root });
    assert.equal(attemptState(dbPath, identity('admin', recoveryIp)), false);
    assert.equal(attemptState(dbPath, origin(recoveryIp)), false);
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
});
