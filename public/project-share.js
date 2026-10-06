const main = document.querySelector('#public-share-main');
const statusLabels = { idea:'Idee', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen' };
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle:'medium' });
const formatDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? dateFormatter.format(new Date(`${value}T12:00:00`)) : '';
const today = () => { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10); };
const projectSortOptions = new Set(['due:asc','due:desc','title:asc','title:desc','status:asc']);
const statusOrder = { idea:0, active:1, paused:2, completed:3 };

function applyAppearance(appearance) {
  const accent = /^#[0-9a-f]{6}$/i.test(appearance?.accentColor || '') ? appearance.accentColor : '#e5322c';
  const mode = ['light','dark','auto'].includes(appearance?.themeMode) ? appearance.themeMode : 'light';
  const dark = mode === 'dark' || mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', accent);
  document.querySelector('[data-theme-color]').content = dark ? '#111317' : '#f6f7f9';
  document.querySelector('[data-brand-name]').textContent = appearance?.displayName || 'Logbuch';
  const subtitle = document.querySelector('[data-brand-subtitle]');
  subtitle.textContent = appearance?.subtitle || '';
  subtitle.hidden = !appearance?.subtitle;
  const logo = document.querySelector('[data-brand-logo]');
  if (appearance?.hasLogo && appearance.logoUrl) { logo.src = appearance.logoUrl; logo.hidden = false; }
  else logo.hidden = true;
}

function currentFolderKey(data) {
  const requested = new URLSearchParams(location.search).get('folder');
  if (requested && data.folders.some(folder => folder.key === requested)) return requested;
  return data.rootFolderKey || null;
}

function folderChain(data, folderKey) {
  const byKey = new Map(data.folders.map(folder => [folder.key, folder]));
  const chain = [];
  const visited = new Set();
  let folder = byKey.get(folderKey);
  while (folder && !visited.has(folder.key)) {
    chain.unshift(folder);
    visited.add(folder.key);
    folder = byKey.get(folder.parentKey);
  }
  return chain;
}

function folderLink(key) {
  const url = new URL(location.href);
  if (key) url.searchParams.set('folder', key); else url.searchParams.delete('folder');
  return `${url.pathname}${url.search}`;
}

function selectedProjectSort() {
  const requested = new URLSearchParams(location.search).get('sort') || 'due:asc';
  return projectSortOptions.has(requested) ? requested : 'due:asc';
}

function sortedProjects(projects, sort = selectedProjectSort()) {
  const [field, direction] = sort.split(':');
  const factor = direction === 'desc' ? -1 : 1;
  return [...projects].sort((left, right) => {
    if (field === 'due') {
      if (!left.dueDate && right.dueDate) return 1;
      if (left.dueDate && !right.dueDate) return -1;
      const comparison = String(left.dueDate || '').localeCompare(String(right.dueDate || ''));
      if (comparison) return comparison * factor;
    }
    if (field === 'status') {
      const comparison = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
      if (comparison) return comparison;
    }
    const titleComparison = String(left.title || '').localeCompare(String(right.title || ''), 'de', { sensitivity:'base', numeric:true });
    return field === 'title' ? titleComparison * factor : titleComparison;
  });
}

function projectRow(project) {
  const overdue = project.dueDate && project.dueDate < today() && project.status !== 'completed';
  return `<article class="public-project-row">
    <div class="public-project-copy"><h2>${escapeHtml(project.title)}</h2><p>${escapeHtml(project.description || 'Keine Beschreibung hinterlegt.')}</p></div>
    <div class="public-project-status"><small>Status</small><span class="public-status ${escapeHtml(project.status)}">${escapeHtml(statusLabels[project.status] || project.status)}</span></div>
    <div class="public-due${overdue ? ' overdue' : ''}"><small>Fälligkeit</small><strong>${project.dueDate ? escapeHtml(formatDate(project.dueDate)) : 'Keine Fälligkeit'}</strong></div>
  </article>`;
}

function projectSortControl(sort) {
  const options = [
    ['due:asc','Fälligkeit · früheste zuerst'],
    ['due:desc','Fälligkeit · späteste zuerst'],
    ['title:asc','Projektname · A–Z'],
    ['title:desc','Projektname · Z–A'],
    ['status:asc','Status · Idee bis Abgeschlossen'],
  ];
  return `<label class="public-sort"><span>Sortieren nach</span><select data-project-sort>${options.map(([value, label]) => `<option value="${value}"${value === sort ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function render(data) {
  const folderKey = currentFolderKey(data);
  const folders = data.folders.filter(folder => folder.parentKey === folderKey).sort((a,b) => a.name.localeCompare(b.name, 'de'));
  const sort = selectedProjectSort();
  const projects = sortedProjects(data.projects.filter(project => project.folderKey === folderKey), sort);
  const chain = folderChain(data, folderKey);
  const rootLink = data.rootFolderKey || null;
  const crumbs = `<nav class="public-breadcrumbs" aria-label="Ordnerpfad"><a href="${folderLink(rootLink)}">${escapeHtml(data.name)}</a>${chain.filter(folder => folder.key !== data.rootFolderKey).map(folder => `<span>›</span><a href="${folderLink(folder.key)}">${escapeHtml(folder.name)}</a>`).join('')}</nav>`;
  const folderCards = folders.map(folder => `<a class="public-folder-card" href="${folderLink(folder.key)}"><span class="public-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z"></path><path d="M3.5 9h17"></path></svg></span><span><strong>${escapeHtml(folder.name)}</strong><small>${escapeHtml(folder.description || 'Ordner öffnen')}</small></span><b aria-hidden="true">›</b></a>`).join('');
  const expiry = data.expiresAt ? `<span>Freigabe gültig bis ${escapeHtml(formatDate(data.expiresAt))}</span>` : '<span>Freigabe ohne Ablaufdatum</span>';
  main.innerHTML = `<section class="public-share-intro"><div><span class="public-kicker">${escapeHtml(data.scopeLabel)}</span><h1>${escapeHtml(data.name)}</h1><p>${data.projects.length} ${data.projects.length === 1 ? 'Projekt' : 'Projekte'} in dieser freigegebenen Übersicht</p></div>${expiry}</section>${crumbs}<section class="public-content">${folderCards ? `<div class="public-folders">${folderCards}</div>` : ''}${projects.length ? `<section class="public-project-section"><div class="public-project-toolbar"><strong>${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'}</strong>${projectSortControl(sort)}</div><div class="public-project-list"><div class="public-project-list-head" aria-hidden="true"><span>Projekt</span><span>Status</span><span>Fälligkeit</span></div>${projects.map(projectRow).join('')}</div></section>` : !folders.length ? '<div class="public-empty"><strong>Hier sind keine Projekte enthalten.</strong><p>Die freigegebene Übersicht wird automatisch aktualisiert.</p></div>' : ''}</section>`;
  document.querySelector('[data-project-sort]')?.addEventListener('change', event => {
    const url = new URL(location.href);
    url.searchParams.set('sort', event.currentTarget.value);
    history.replaceState(null, '', `${url.pathname}${url.search}`);
    render(data);
  });
  document.title = `${data.name} · Projektübersicht`;
}

async function load() {
  const token = location.pathname.split('/').filter(Boolean).at(-1) || '';
  try {
    const [appearanceResponse, dataResponse] = await Promise.all([fetch('/api/appearance'), fetch(`/api/public/project-shares/${encodeURIComponent(token)}`)]);
    if (appearanceResponse.ok) applyAppearance(await appearanceResponse.json());
    const data = await dataResponse.json();
    if (!dataResponse.ok) throw new Error(data.error || 'Diese Projektfreigabe ist nicht verfügbar.');
    render(data);
  } catch (error) {
    main.innerHTML = `<section class="public-share-error"><span aria-hidden="true">×</span><h1>Freigabe nicht verfügbar</h1><p>${escapeHtml(error.message)}</p></section>`;
  }
}

window.addEventListener('popstate', load);
load();
