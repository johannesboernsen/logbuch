(() => {
  const kind = manifest => typeof manifest?.format === 'string' ? manifest.format.split('-').at(-1) : '';
  globalThis.LogbuchBackupFormat = Object.freeze({
    isProjectManifest: manifest => manifest?.version === 1 && ['projects', 'backup'].includes(kind(manifest)),
    isUserManifest: manifest => manifest?.version === 1 && kind(manifest) === 'users',
  });
})();
