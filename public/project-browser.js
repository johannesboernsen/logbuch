let projectSelectedId = '';
let projectBrowserDrag = null;
let projectPreviewScrollTimer;

function projectBrowserHref(folderId = null, projectId = '') {
  const params = new URLSearchParams();
  params.set('view', 'columns');
  params.set('status', state.projectStatusFilter);
  params.set('sort', `${state.projectSort.field}:${state.projectSort.direction}`);
  if (folderId) params.set('folder', folderId);
  if (projectId) params.set('project', projectId);
  if (state.projectSearch.active) params.set('q', state.projectSearch.active);
  if (state.projectTagFilter.active.ids.length) params.set('tags', state.projectTagFilter.active.ids.join(','));
  if (state.projectTagFilter.active.mode === 'any') params.set('match', 'any');
  return `/#/projects?${params}`;
}

function projectBrowserToolbar() {
  return `<div id="active-tag-filters">${selectedTagFiltersMarkup(false)}</div>`;
}

function projectMatchesBrowser(project) {
  if (!matchesProjectStatus(project)) return false;
  const query = state.projectSearch.active.trim().toLocaleLowerCase('de');
  const text = [project.title, project.description, folderPathLabel(project.folderId), ...(project.nextTaskTitles || [])].join(' ').toLocaleLowerCase('de');
  const filter = state.projectTagFilter.active;
  const tags = project.tagIds || [];
  return (!query || text.includes(query)) && (!filter.ids.length || (filter.mode === 'any' ? filter.ids.some(id => tags.includes(id)) : filter.ids.every(id => tags.includes(id))));
}

function projectColumnCreateControl(folderId) {
  if (!mayEditProjects()) return '';
  return `<details class="action-menu storage-finder-create-menu"><summary aria-label="${folderId ? 'In diesem Ordner' : 'Auf oberster Ebene'} hinzufügen">+</summary><div class="action-menu-panel"><button type="button" class="menu-item" data-column-create-project="${escapeHtml(folderId || '')}">Neues Projekt</button><button type="button" class="menu-item" data-column-create-folder="${escapeHtml(folderId || '')}">Neuer Ordner</button></div></details>`;
}

function projectFolderMenu(folder) {
  if (!folder || !mayEditProjects()) return '';
  return contextActionMenu(`Aktionen für ${folder.name}`, `<button class="menu-item" type="button" data-edit-folder="${escapeHtml(folder.id)}">Ordner bearbeiten</button><button class="menu-item" type="button" data-project-move="folder:${escapeHtml(folder.id)}">Verschieben …</button>`, { className:'storage-finder-column-menu' });
}

function projectColumnRow(project) {
  const overdue = project.dueDate && project.dueDate.slice(0, 10) < today() && project.status !== 'completed';
  return `<article class="storage-finder-row project-browser-row${projectSelectedId === project.id ? ' selected' : ''}" data-project-browser-row="${escapeHtml(project.id)}"${mayEditProjects() ? ` draggable="true" data-project-drag="project:${escapeHtml(project.id)}"` : ''}><a class="storage-finder-link" href="${projectBrowserHref(project.folderId, project.id)}" data-project-preview="${escapeHtml(project.id)}"${projectSelectedId === project.id ? ' aria-current="true"' : ''} data-storage-parent-href="${projectBrowserHref(project.folderId)}"><span class="storage-finder-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><span class="storage-finder-copy"><strong>${escapeHtml(project.title)}</strong><small><span>${escapeHtml(projectStatusLabels[project.status])}</span><span class="${overdue ? 'project-due-overdue' : ''}">${project.dueDate ? `${overdue ? 'Überfällig: ' : 'Fällig: '}${escapeHtml(formatDate(project.dueDate))}` : 'Ohne Fälligkeit'}</span></small></span>${project.flagged ? `<span class="project-row-marker" title="Markiert" aria-label="Markiert">${projectFlagIcon()}</span>` : project.priority === 'Hoch' ? '<span class="project-row-marker" title="Hohe Priorität" aria-label="Hohe Priorität">!</span>' : ''}</a></article>`;
}

function projectFolderColumn(folder, selectedFolderId = '', current = false) {
  const parentId = folder?.id || null;
  const folders = state.folders.filter(candidate => (candidate.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric:true }));
  const projects = sortedProjects(state.projects.filter(project => (project.folderId || null) === parentId && projectMatchesBrowser(project)));
  const folderRows = folders.map(child => `<article class="storage-finder-row${child.id === selectedFolderId ? ' selected' : ''}" data-project-drop="${escapeHtml(child.id)}"${mayEditProjects() ? ` draggable="true" data-project-drag="folder:${escapeHtml(child.id)}"` : ''}><a class="storage-finder-link" href="${projectBrowserHref(child.id)}" data-storage-parent-href="${projectBrowserHref(parentId)}"><span class="storage-finder-icon storage-finder-location-icon" aria-hidden="true">${iconSvg(entityIconName(child, 'folder'))}</span><span class="storage-finder-copy"><strong>${escapeHtml(child.name)}</strong><small>${folderProjectCount(child.id)} Projekte im Unterbaum</small></span></a></article>`).join('');
  const mobileBack = folder ? `<a class="storage-mobile-back" href="${projectBrowserHref(folder.parentId || null)}">‹ ${escapeHtml(folderById(folder.parentId)?.name || 'Projekte')}</a>` : '';
  const projectRows = state.projectSort.field === 'status'
    ? projectNavigation.statusGroups(projects).map(group => `<div class="project-column-group" role="heading" aria-level="2">${escapeHtml({ idea:'Ideen', active:'Aktive Projekte', paused:'Pausierte Projekte', completed:'Abgeschlossene Projekte' }[group.status])} <span>${group.projects.length}</span></div>${group.projects.map(projectColumnRow).join('')}`).join('')
    : projects.map(projectColumnRow).join('');
  return `<section class="storage-finder-column" data-project-column="${escapeHtml(parentId || '')}"${current ? ' data-finder-current-column' : ''}><header><strong>${escapeHtml(folder?.name || 'Projekte')}</strong><div class="storage-finder-column-actions">${projectColumnCreateControl(parentId)}${projectFolderMenu(folder)}</div></header><div class="storage-finder-list" data-project-column-drop="${escapeHtml(parentId || '')}">${mobileBack}${folderRows}${projectRows}${!folderRows && !projectRows ? '<div class="storage-finder-empty">Keine Projekte für diese Auswahl.</div>' : ''}</div></section>`;
}

function projectPreviewMarkup(project) {
  const fullHref = `/#/projects/${encodeURIComponent(project.id)}`;
  const steps = (project.nextTaskTitles || [project.nextTaskTitle]).filter(Boolean).slice(0, 3);
  const menu = mayEditProjects() ? contextActionMenu(`Aktionen für ${project.title}`, `<button type="button" class="menu-item" data-project-move="project:${escapeHtml(project.id)}">Verschieben …</button>`, { className:'storage-finder-column-menu' }) : '';
  return `<aside class="storage-finder-detail storage-item-detail project-browser-preview" data-finder-item-inspector><header class="storage-finder-detail-header"><strong>${escapeHtml(project.title)}</strong><div class="storage-finder-column-actions"><a class="edit-action" href="${fullHref}" aria-label="Vollständiges Projekt öffnen" title="Vollständiges Projekt öffnen">${iconSvg('search')}</a>${projectEditButton(project)}${menu}</div></header><div class="storage-finder-detail-body"><a class="storage-mobile-back" href="${projectBrowserHref(project.folderId)}">‹ Zurück zum Ordner</a><span class="storage-finder-detail-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><h2>${escapeHtml(project.title)}</h2><p>${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p><dl><div><dt>Status</dt><dd>${escapeHtml(projectStatusLabels[project.status])}</dd></div><div><dt>Priorität</dt><dd>${escapeHtml(projectPriority(project))}</dd></div><div><dt>Start</dt><dd>${project.createdAt ? escapeHtml(formatDate(project.createdAt)) : '–'}</dd></div><div><dt>Fällig</dt><dd>${project.dueDate ? escapeHtml(formatDate(project.dueDate)) : '–'}</dd></div><div><dt>Markierung</dt><dd>${project.flagged ? 'Markiert' : '–'}</dd></div></dl>${tagChips(project.tagIds || [], { linked:false })}<section class="project-preview-steps"><h3>Nächste Arbeitsschritte</h3>${steps.length ? `<ul>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>` : '<p>Keine anstehenden Arbeitsschritte.</p>'}</section><a class="button secondary compact" href="${fullHref}">Projekt öffnen</a></div></aside>`;
}

function projectBrowserBreadcrumbs() {
  return `<nav class="folder-breadcrumbs storage-breadcrumbs" aria-label="Projektpfad"><a href="${projectBrowserHref()}">Projekte</a>${projectNavigation.folderPath(state.folders, state.currentFolderId).map(folder => `<span>›</span><a href="${projectBrowserHref(folder.id)}">${escapeHtml(folder.name)}</a>`).join('')}${projectSelectedId ? `<span>›</span><span>${escapeHtml(state.projects.find(project => project.id === projectSelectedId)?.title || '')}</span>` : ''}</nav>`;
}

function renderProjectColumnContents() {
  const shell = $('[data-project-browser-columns]');
  if (!shell) return;
  const selected = state.projects.find(project => project.id === projectSelectedId && (project.folderId || null) === state.currentFolderId && projectMatchesBrowser(project));
  if (!selected) projectSelectedId = '';
  const path = projectNavigation.folderPath(state.folders, state.currentFolderId);
  const columns = [projectFolderColumn(null, path[0]?.id, !path.length), ...path.map((folder, index) => projectFolderColumn(folder, path[index + 1]?.id, index === path.length - 1))];
  shell.innerHTML = `<div class="storage-finder-columns">${columns.join('')}</div>${selected ? projectPreviewMarkup(selected) : ''}`;
  shell.classList.toggle('has-item-selection', Boolean(selected));
  $('.project-browser-frame .storage-finder-statusbar').innerHTML = projectBrowserBreadcrumbs();
  updateTagFilterUrl(false);
  bindProjectBrowserActions();
  requestAnimationFrame(() => {
    fitInventoryWorkspaces();
    if (!revealFinderItemInspector()) {
      const column = shell.querySelector('[data-finder-current-column]');
      if (column && !window.matchMedia('(max-width:780px)').matches) shell.scrollLeft = Math.max(0, column.offsetLeft - shell.clientWidth / 3);
    }
  });
}

function selectProjectPreview(project, link) {
  state.currentFolderId = project.folderId || null;
  projectSelectedId = project.id;
  const column = link.closest('[data-project-column]');
  while (column.nextElementSibling) column.nextElementSibling.remove();
  document.querySelectorAll('[data-project-column]').forEach(node => node.toggleAttribute('data-finder-current-column', node === column));
  document.querySelectorAll('[data-project-browser-row]').forEach(row => {
    const selected = row.dataset.projectBrowserRow === project.id;
    row.classList.toggle('selected', selected);
    if (selected) row.querySelector('a').setAttribute('aria-current', 'true'); else row.querySelector('a').removeAttribute('aria-current');
  });
  column.querySelectorAll('[data-project-drop]').forEach(row => row.classList.remove('selected'));
  const shell = $('[data-project-browser-columns]');
  shell.querySelector('[data-finder-item-inspector]')?.remove();
  shell.insertAdjacentHTML('beforeend', projectPreviewMarkup(project));
  shell.classList.add('has-item-selection');
  const href = projectBrowserHref(state.currentFolderId, project.id);
  if (`/${location.hash}` !== href) history.pushState(null, '', href);
  $('.project-browser-frame .storage-finder-statusbar').innerHTML = projectBrowserBreadcrumbs();
  updateProjectNavigationLink();
  bindProjectActions();
  bindProjectMoveButtons();
  clearTimeout(projectPreviewScrollTimer);
  // Keep the clicked row in place until a possible double-click has completed.
  projectPreviewScrollTimer = setTimeout(revealFinderItemInspector, 500);
}

async function renderProjectColumns() {
  const head = standardPageHeader({ title:'Projekte', description:'Ordner und Projekte organisieren.', icon:'box', actions:`${projectListControls(false, state.projects.filter(matchesProjectStatus))}${state.user.admin ? '<button class="button secondary compact" type="button" data-open-project-share>Freigeben</button>' : ''}`, className:'project-browser-page-head', toolbar:projectBrowserToolbar() });
  $('#main').innerHTML = `${head}<div class="storage-finder-frame project-browser-frame"><div class="storage-finder-shell" data-storage-finder-shell data-project-browser-columns></div><footer class="storage-finder-statusbar"></footer></div>`;
  bindProjectListControls(false);
  bindTagFilterSummary();
  bindProjectStatusFilter();
  updateProjectNavigationLink();
  $('[data-open-project-share]')?.addEventListener('click', openProjectShareDialog);
  document.title = 'Projekte · Logbuch';
}

function validProjectMove(entity, destination) {
  if (!entity || destination === undefined || !mayEditProjects()) return false;
  if (entity.type === 'folder') return projectNavigation.canMoveFolder(state.folders, entity.id, destination);
  const project = state.projects.find(candidate => candidate.id === entity.id);
  return Boolean(project) && (project.folderId || null) !== (destination || null) && (!destination || Boolean(folderById(destination)));
}

async function moveProjectEntity(entity, destination) {
  if (!validProjectMove(entity, destination)) throw new Error('Dieses Ziel ist für die Verschiebung nicht möglich.');
  await api(`/${entity.type === 'folder' ? 'folders' : 'projects'}/${encodeURIComponent(entity.id)}`, { method:'PATCH', body:JSON.stringify(entity.type === 'folder' ? { parentId:destination || null } : { folderId:destination || null }) });
  toast(entity.type === 'folder' ? 'Ordner verschoben' : 'Projekt verschoben');
  if (projectSelectedId === entity.id) projectSelectedId = '';
  await renderProjects();
}

function bindProjectMoveButtons() {
  document.querySelectorAll('[data-project-move]').forEach(button => button.onclick = () => {
    const [type, id] = button.dataset.projectMove.split(':');
    openProjectMoveDialog({ type, id });
  });
}

function openProjectMoveDialog(entity) {
  const item = entity.type === 'folder' ? folderById(entity.id) : state.projects.find(project => project.id === entity.id);
  if (!item || !mayEditProjects()) return;
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const dialog = document.createElement('dialog');
  dialog.className = 'project-move-dialog';
  dialog.innerHTML = `<form><div class="dialog-head"><h2>${entity.type === 'folder' ? 'Ordner' : 'Projekt'} verschieben</h2><button class="icon-button" type="button" data-cancel aria-label="Schließen">×</button></div><p class="dialog-copy">Ziel für „${escapeHtml(item.name || item.title)}“ auswählen.</p><label class="checkbox-line"><input type="radio" name="destination-root" value="root">Oberste Ebene (ohne Ordner)</label><div data-move-picker></div><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Abbrechen</button><button type="submit" class="button primary" disabled>Verschieben</button></div></form>`;
  document.body.append(dialog);
  const selectedIds = new Set();
  const disabledIds = new Set(state.folders.filter(folder => !validProjectMove(entity, folder.id)).map(folder => folder.id));
  let destination;
  const rootInput = dialog.querySelector('[name="destination-root"]');
  rootInput.disabled = !validProjectMove(entity, null);
  const submit = dialog.querySelector('[type="submit"]');
  const render = () => renderCompactColumnPicker({ container:dialog.querySelector('[data-move-picker]'), items:state.folders, selectedIds, path:[], selectionMode:'single', inputName:'project-move-folder', rootLabel:'Ordner', fallbackIcon:'folder', disabledIds, onPathChange:() => {}, onSelectionChange:ids => { destination = [...ids][0]; rootInput.checked = false; submit.disabled = !validProjectMove(entity, destination); } });
  render();
  rootInput.onchange = () => { destination = null; selectedIds.clear(); render(); submit.disabled = !validProjectMove(entity, null); };
  dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => dialog.close());
  dialog.onclose = () => dialog.remove();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try { await moveProjectEntity(entity, destination); dialog.close(); }
    catch (error) { dialog.querySelector('.form-error').textContent = error.message; submit.disabled = false; }
  };
  dialog.showModal();
}

function bindProjectBrowserActions() {
  bindFolderActions();
  bindProjectActions();
  bindProjectMoveButtons();
  bindStorageFinderKeyboard();
  document.querySelectorAll('[data-column-create-project]').forEach(button => button.onclick = () => {
    openProjectDialog();
    $('#project-form').elements.folderId.value = button.dataset.columnCreateProject;
  });
  document.querySelectorAll('[data-column-create-folder]').forEach(button => button.onclick = () => openFolderDialog(null, { parentId:button.dataset.columnCreateFolder || null }));
  document.querySelectorAll('[data-project-preview]').forEach(link => {
    link.onclick = event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const project = state.projects.find(candidate => candidate.id === link.dataset.projectPreview);
      if (project) selectProjectPreview(project, link);
    };
    link.ondblclick = event => { event.preventDefault(); clearTimeout(projectPreviewScrollTimer); location.href = `/#/projects/${encodeURIComponent(link.dataset.projectPreview)}`; };
  });
  const clearDrag = () => { projectBrowserDrag = null; document.querySelectorAll('.project-browser-frame .dragging,.project-browser-frame .drop-over').forEach(node => node.classList.remove('dragging', 'drop-over')); };
  document.querySelectorAll('[data-project-drag]').forEach(row => {
    row.ondragstart = event => {
      const [type, id] = row.dataset.projectDrag.split(':');
      projectBrowserDrag = { type, id };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.textContent.trim());
      row.classList.add('dragging');
    };
    row.ondragend = clearDrag;
  });
  document.querySelectorAll('[data-project-column-drop], [data-project-drop]').forEach(target => {
    const destination = target.dataset.projectDrop || target.dataset.projectColumnDrop || null;
    const isOwnTarget = event => event.target.closest('[data-project-drop], [data-project-column-drop]') === target;
    target.ondragover = event => { if (isOwnTarget(event) && validProjectMove(projectBrowserDrag, destination)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drop-over'); } };
    target.ondragleave = event => { if (!target.contains(event.relatedTarget)) target.classList.remove('drop-over'); };
    target.ondrop = async event => {
      if (!isOwnTarget(event) || !validProjectMove(projectBrowserDrag, destination)) return;
      event.preventDefault(); event.stopPropagation(); const entity = projectBrowserDrag; clearDrag();
      try { await moveProjectEntity(entity, destination); } catch (error) { toast(error.message); }
    };
  });
  document.querySelectorAll('[data-project-column-drop]').forEach(list => list.onclick = event => {
    if (event.target.closest('.storage-finder-row, a, button, input') || projectBrowserDrag) return;
    location.href = projectBrowserHref(list.dataset.projectColumnDrop || null);
  });
}
