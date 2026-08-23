import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/backup-format.js');
const formats = globalThis.LogbuchBackupFormat;
const archives = globalThis.LogbuchBackupArchive;

test('Backupformate aus 0.2.1 und 0.3.x werden ohne alte Markentexte erkannt', () => {
  const legacyPrefix = ['make', 'log'].join('-');
  assert.equal(formats.isProjectManifest({ format:`${legacyPrefix}-projects`, version:1 }), true);
  assert.equal(formats.isProjectManifest({ format:`${legacyPrefix}-backup`, version:1 }), true);
  assert.equal(formats.isUserManifest({ format:`${legacyPrefix}-users`, version:1 }), true);
  assert.equal(formats.isProjectManifest({ format:'logbuch-projects', version:1 }), true);
  assert.equal(formats.isUserManifest({ format:'logbuch-users', version:1 }), true);
  assert.equal(formats.isProjectManifest({ format:'fremd', version:1 }), false);
  assert.equal(formats.isUserManifest({ format:'logbuch-users', version:2 }), false);
});

test('TAR-Projektarchive erhalten Bilddateien und Metadaten bytegenau', async () => {
  const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const metadata = { id:'file-backup-image', originalName:'bild.png', displayName:'Aufbau', description:'Ansicht von oben', mimeType:'image/png', size:image.length, sha256:'0'.repeat(64), rotation:90, association:{ collection:'notes', itemId:'note-backup' }, uploadedAt:'2026-08-23T18:00:00Z', uploadedBy:'admin' };
  const manifest = { format:'logbuch-projects', version:1, projects:[{ id:'project-backup', title:'Backup', entries:[], tasks:[], materials:[], contacts:[], links:[], ideas:[], learnings:[], notes:[{ id:'note-backup', title:'Notiz' }], files:[metadata] }] };
  const archive = await archives.create([
    ['manifest.json', JSON.stringify(manifest)],
    ['projects/project-backup/attachments/file-backup-image/metadata.json', JSON.stringify(metadata)],
    ['projects/project-backup/attachments/file-backup-image/original.bin', image],
  ]);
  const files = archives.parse(await archive.arrayBuffer());
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), manifest);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('projects/project-backup/attachments/file-backup-image/metadata.json'))), metadata);
  assert.deepEqual(files.get('projects/project-backup/attachments/file-backup-image/original.bin'), image);
});
