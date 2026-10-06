(() => {
  const statuses = ['idea', 'active', 'paused', 'completed'];
  function statusSelection(value, fallback = ['idea', 'active']) {
    if (Array.isArray(value) && !value.length) return [];
    if (value === 'all') return [...statuses];
    if (value === 'none') return [];
    const values = Array.isArray(value) ? value : String(value ?? '').split(',');
    const selected = statuses.filter(status => values.includes(status));
    return selected.length ? selected : [...fallback];
  }
  function shortcuts(folders, pinned = [], recent = []) {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    return [...new Set([...pinned, ...recent])].filter(id => byId.has(id)).slice(0, 5)
      .map(id => ({ ...byId.get(id), pinned:pinned.includes(id) }));
  }
  function folderRows(folders, expanded, query = '') {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    const children = new Map();
    for (const folder of folders) {
      const parent = byId.has(folder.parentId) ? folder.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(folder);
    }
    for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
    const search = query.trim().toLocaleLowerCase('de');
    const visible = new Set();
    if (search) for (const folder of folders) {
      if (!`${folder.name} ${folder.description || ''}`.toLocaleLowerCase('de').includes(search)) continue;
      let current = folder;
      while (current && !visible.has(current.id)) { visible.add(current.id); current = byId.get(current.parentId); }
    }
    const rows = [];
    const visited = new Set();
    const pending = (children.get(null) || []).map(folder => ({ folder, depth:0 })).reverse();
    while (pending.length) {
      const { folder, depth } = pending.pop();
      if (visited.has(folder.id) || (search && !visible.has(folder.id))) continue;
      visited.add(folder.id);
      const descendants = children.get(folder.id) || [];
      const open = Boolean(search) || expanded.has(folder.id);
      rows.push({ folder, depth, hasChildren:descendants.length > 0, open });
      if (open) pending.push(...descendants.map(child => ({ folder:child, depth:depth + 1 })).reverse());
    }
    return rows;
  }
  function folderPath(folders, id) {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    const seen = new Set();
    const path = [];
    for (let folder = byId.get(id); folder && !seen.has(folder.id); folder = byId.get(folder.parentId)) {
      path.unshift(folder); seen.add(folder.id);
    }
    return path;
  }
  function canMoveFolder(folders, id, targetId) {
    const folder = folders.find(candidate => candidate.id === id);
    return Boolean(folder) && (folder.parentId || null) !== (targetId || null)
      && (!targetId || folders.some(candidate => candidate.id === targetId))
      && !folderPath(folders, targetId).some(candidate => candidate.id === id);
  }
  function statusGroups(projects) {
    return statuses.map(status => ({ status, projects:projects.filter(project => project.status === status) })).filter(group => group.projects.length);
  }
  globalThis.LogbuchProjectNavigation = { statusSelection, shortcuts, folderRows, folderPath, canMoveFolder, statusGroups };
})();
