import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

async function scenario(code) {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-project-share-'));
  try {
    const script = `require $argv[1];
      $db = (new \\Logbuch\\Database($argv[2] . '/database.sqlite'))->pdo();
      $projects = new \\Logbuch\\ProjectStore($argv[2] . '/projects');
      $folders = new \\Logbuch\\FolderStore($db);
      $rootFolder = $folders->create(['name'=>'Kunden','description'=>'Intern'], 'admin');
      $childFolder = $folders->create(['name'=>'Aufträge','parentId'=>$rootFolder['id']], 'admin');
      $projects->create(['title'=>'Aktiv im Ordner','description'=>'Öffentliche Kurzbeschreibung','status'=>'active','createdAt'=>'2026-10-01','dueDate'=>'2026-11-10','folderId'=>$childFolder['id']], 'admin');
      $projects->create(['title'=>'Idee im Ordner','description'=>'Zweite Beschreibung','status'=>'idea','createdAt'=>'2026-10-01','dueDate'=>'','folderId'=>$rootFolder['id']], 'admin');
      $projects->create(['title'=>'Aktiv ohne Ordner','description'=>'Direkt oben','status'=>'active','createdAt'=>'2026-10-01','dueDate'=>'2026-10-20'], 'admin');
      $store = new \\Logbuch\\ProjectShareStore($db, $projects, $folders); ${code}`;
    const result = await run('php', ['-d', 'display_errors=1', '-r', script, join(root, 'app/bootstrap.php'), storage], { env:{ ...process.env, LOGBUCH_ROOT_PATH:root } });
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  } finally { await rm(storage, { recursive:true, force:true }); }
}

test('Statusfreigaben liefern nur reduzierte Projektdaten und die benötigte Ordnerstruktur', async () => {
  const result = await scenario(`
    $share = $store->create(['scopeType'=>'STATUS','projectStatus'=>'active','name'=>'Aktuelle Projekte'], 'admin');
    $public = $store->publicData($share['token']);
    echo json_encode($public);
  `);
  assert.equal(result.projects.length, 2);
  assert.equal(result.folders.length, 2);
  assert.deepEqual(Object.keys(result.projects[0]).sort(), ['description','dueDate','folderKey','status','title']);
  assert.ok(result.projects.every(project => project.status === 'active'));
  assert.ok(result.folders.every(folder => !Object.hasOwn(folder, 'id') && !Object.hasOwn(folder, 'description')));
});

test('Ordnerfreigaben schließen Unterordner und alle regulären Projektstatus ein', async () => {
  const result = await scenario(`
    $share = $store->create(['scopeType'=>'FOLDER','folderId'=>$rootFolder['id']], 'admin');
    $before = $store->publicData($share['token']);
    $rotated = $store->rotate($share['id']);
    $oldUnavailable = false;
    try { $store->publicData($share['token']); } catch (\\Logbuch\\HttpError $error) { $oldUnavailable = $error->status === 404; }
    echo json_encode(['before'=>$before,'oldUnavailable'=>$oldUnavailable,'newTokenWorks'=>count($store->publicData($rotated['token'])['projects'])]);
  `);
  assert.equal(result.before.projects.length, 2);
  assert.deepEqual(new Set(result.before.projects.map(project => project.status)), new Set(['active','idea']));
  assert.equal(result.oldUnavailable, true);
  assert.equal(result.newTokenWorks, 2);
});
