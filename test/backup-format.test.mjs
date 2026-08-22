import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/backup-format.js');
const formats = globalThis.LogbuchBackupFormat;

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
