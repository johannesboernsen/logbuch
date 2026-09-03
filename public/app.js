const $ = (selector, root = document) => root.querySelector(selector);
const state = { user: null, users: [], sessions: [], audit: [], tags: [], folders: [], storageLocations:[], storageLocationsIncludeArchived:false, storageLocationSort:'name', storageLocationSortDirection:'asc', storageLocationsShowEmpty:true, inventoryCategories:[], inventoryItems:[], inventoryItemsIncludeArchived:false, inventoryItemQuery:'', inventoryItemCategoryFilter:'', inventoryItemSort:'name', inventoryItemSortDirection:'asc', inventoryItemNotes:[], inventoryStockEntries:[], inventoryStockTransactions:[], inventoryStockItem:null, inventoryReservations:[], projectReservations:[], reservationProjects:[], todos:[], todosOpenOpen:true, todosCompletedOpen:false, collapsedTodoGroups:{}, editingTodoId:null, todoRepeatTimer:null, iconLibrary:null, currentFolderId:null, projectStatusFilter:'all', server: null, system: null, storage:null, update:null, projects: [], current: null, activeTab: 'entries', activeSettings:'general', fileViewerId:null, visibleProjectFiles:50, activityObserver:null, timelineObserver:null, overviewGridObservers:[], projectSort: { field:'status', direction:'asc' }, archiveSort: { field:'createdAt', direction:'desc' }, projectSearch: { active:'', archived:'' }, projectTagFilter:{ active:{ ids:[], mode:'all' }, archived:{ ids:[], mode:'all' } }, projectDialogTagIds:[], projectTagDraftOpen:false, projectTagSearchOpen:false, collapsedProjectFolders:false, collapsedProjectStatusGroups:{ idea:false, active:false, paused:false, completed:false }, collapsedLogSections:{ tasks:false, entries:false }, collapsedProjectSections:{} };
let iconLibraryPromise = null;
let storageDragEntry = null;
let storageLocationDrag = null;
let inventoryCategoryDrag = null;
let inventoryCategoryItemDrag = null;
let inventoryItemImagePreviewUrl = '';
const api = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const csrf = !['GET','HEAD'].includes(method) && state.user?.csrfToken ? { 'X-Logbuch-CSRF': state.user.csrfToken } : {};
  const contentHeaders = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(`/api${path}`, { ...options, headers: { ...contentHeaders, ...csrf, ...(options.headers || {}) } });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Etwas ist schiefgegangen');
    error.status = response.status;
    throw error;
  }
  return data;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const today = () => {
  const value = new Date();
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const mediumDateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle:'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle:'medium', timeStyle:'short' });
const formatDate = value => value ? mediumDateFormatter.format(new Date(`${value}T12:00:00`)) : 'Heute';
const formatDateTime = value => value ? dateTimeFormatter.format(new Date(value)) : 'Noch nie angemeldet';
const formatEpoch = value => Number(value) > 0 ? formatDateTime(new Date(Number(value) * 1000).toISOString()) : 'Noch nicht geplant';
const formatBytes = value => { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; const units = ['KB','MB','GB','TB']; let size = bytes / 1024, index = 0; while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; } return `${size.toLocaleString('de-DE', { maximumFractionDigits:1 })} ${units[index]}`; };
const dateFieldText = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : 'TT.MM.JJJJ';
};
const dateDigitsText = digits => [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
const dateFromDigits = digits => {
  if (!/^\d{8}$/.test(digits)) return '';
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  const candidate = new Date(year, month - 1, day, 12);
  return year >= 1000 && candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
};
const dateCalendarState = { input:null, year:0, month:0, focusedDate:'', popover:null };
const isoDate = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const shiftedDate = (value, days) => {
  const [year, month, day] = String(value).split('-').map(Number);
  const shifted = new Date(year, month - 1, day + days, 12);
  return isoDate(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
};
function closeDateCalendar(restoreFocus = true) {
  const input = dateCalendarState.input;
  if (dateCalendarState.popover?.matches(':popover-open')) dateCalendarState.popover.hidePopover();
  dateCalendarState.input = null;
  if (restoreFocus) input?.focus();
}
function focusCalendarDate(value) {
  const [year, month] = String(value).split('-').map(Number);
  dateCalendarState.focusedDate = value;
  dateCalendarState.year = year;
  dateCalendarState.month = month - 1;
  renderDateCalendar();
  requestAnimationFrame(() => dateCalendarState.popover?.querySelector(`[data-calendar-date="${value}"]`)?.focus());
}
function renderDateCalendar() {
  const popover = dateCalendarState.popover;
  const input = dateCalendarState.input;
  if (!popover || !input) return;
  const { year, month } = dateCalendarState;
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayValue = today();
  const days = Array.from({ length:42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return '<span class="date-calendar-blank" aria-hidden="true"></span>';
    const value = isoDate(year, month, day);
    const classes = [value === todayValue ? 'today' : '', value === input.value ? 'selected' : '', value === dateCalendarState.focusedDate ? 'keyboard-focused' : ''].filter(Boolean).join(' ');
    return `<button type="button"${classes ? ` class="${classes}"` : ''} data-calendar-date="${value}" aria-label="${dateFieldText(value)}">${day}</button>`;
  }).join('');
  const monthLabel = new Intl.DateTimeFormat('de-DE', { month:'long', year:'numeric' }).format(new Date(year, month, 1));
  popover.innerHTML = `<div class="date-calendar-head"><button class="date-calendar-nav" type="button" data-calendar-step="-1" aria-label="Vorheriger Monat">‹</button><strong>${escapeHtml(monthLabel)}</strong><button class="date-calendar-nav" type="button" data-calendar-step="1" aria-label="Nächster Monat">›</button></div><div class="date-calendar-weekdays" aria-hidden="true"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="date-calendar-days">${days}</div>${input.required ? '' : '<button class="date-calendar-clear" type="button" data-calendar-clear>Datum entfernen</button>'}`;
  popover.querySelectorAll('[data-calendar-step]').forEach(button => button.onclick = () => {
    const next = new Date(year, month + Number(button.dataset.calendarStep), 1);
    dateCalendarState.year = next.getFullYear();
    dateCalendarState.month = next.getMonth();
    const focusedDay = Number(String(dateCalendarState.focusedDate || input.value || today()).slice(-2));
    const lastDay = new Date(dateCalendarState.year, dateCalendarState.month + 1, 0).getDate();
    dateCalendarState.focusedDate = isoDate(dateCalendarState.year, dateCalendarState.month, Math.min(focusedDay, lastDay));
    renderDateCalendar();
    requestAnimationFrame(() => popover.querySelector(`[data-calendar-date="${dateCalendarState.focusedDate}"]`)?.focus());
  });
  popover.querySelectorAll('[data-calendar-date]').forEach(button => {
    button.onclick = () => {
      input.dataset.dateDigits = '';
      input.value = button.dataset.calendarDate;
      input.setCustomValidity('');
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('change', { bubbles:true }));
      closeDateCalendar();
    };
    button.onkeydown = event => {
      const offsets = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 };
      if (Object.hasOwn(offsets, event.key)) {
        event.preventDefault();
        event.stopPropagation();
        focusCalendarDate(shiftedDate(button.dataset.calendarDate, offsets[event.key]));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        button.click();
      }
    };
  });
  const clear = popover.querySelector('[data-calendar-clear]');
  if (clear) clear.onclick = () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    closeDateCalendar();
  };
}
function openDateCalendar(input) {
  if (dateCalendarState.input === input && dateCalendarState.popover?.matches(':popover-open')) {
    closeDateCalendar();
    return;
  }
  if (!dateCalendarState.popover) {
    const popover = document.createElement('div');
    popover.className = 'date-calendar';
    popover.setAttribute('popover', 'manual');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Datum auswählen');
    (input.closest('dialog') || document.body).append(popover);
    dateCalendarState.popover = popover;
    document.addEventListener('pointerdown', event => {
      const path = event.composedPath();
      if (!popover.matches(':popover-open') || path.includes(popover) || path.includes(dateCalendarState.input)) return;
      closeDateCalendar(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && popover.matches(':popover-open')) closeDateCalendar();
    });
  }
  const selected = String(input.value || today()).split('-').map(Number);
  dateCalendarState.input = input;
  dateCalendarState.year = selected[0];
  dateCalendarState.month = selected[1] - 1;
  dateCalendarState.focusedDate = input.value || today();
  const popover = dateCalendarState.popover;
  const calendarOwner = input.closest('dialog') || document.body;
  if (popover.parentElement !== calendarOwner) calendarOwner.append(popover);
  renderDateCalendar();
  if (!popover.matches(':popover-open')) popover.showPopover();
  const inputRect = input.getBoundingClientRect();
  const calendarRect = popover.getBoundingClientRect();
  const left = Math.min(Math.max(12, inputRect.left), window.innerWidth - calendarRect.width - 12);
  const below = inputRect.bottom + 8;
  const top = below + calendarRect.height <= window.innerHeight - 12 ? below : Math.max(12, inputRect.top - calendarRect.height - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  requestAnimationFrame(() => popover.querySelector(`[data-calendar-date="${dateCalendarState.focusedDate}"]`)?.focus());
}
function updateDatePresentation(input) {
  const text = input.closest('.date-input')?.querySelector('.date-input-text');
  if (!text) return;
  const digits = input.dataset.dateDigits || '';
  text.textContent = digits ? dateDigitsText(digits) : dateFieldText(input.value);
  text.classList.toggle('placeholder', !digits && !input.value);
}
function focusAdjacentFormControl(input, backwards = false) {
  const scope = input.closest('dialog, form') || document;
  const controls = [...scope.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(control => !control.closest('[hidden], .hidden, [aria-hidden="true"]') && control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');
  const currentIndex = controls.indexOf(input);
  const next = controls[currentIndex + (backwards ? -1 : 1)];
  if (!next) return false;
  next.focus();
  return true;
}
function enhanceDateInputs(root = document) {
  root.querySelectorAll('input[type="date"]:not([data-date-enhanced])').forEach(input => {
    const wrapper = document.createElement('span');
    wrapper.className = 'date-input';
    input.before(wrapper);
    wrapper.append(input);
    wrapper.insertAdjacentHTML('beforeend', '<span class="date-input-text" aria-hidden="true"></span>');
    input.dataset.dateEnhanced = 'true';
    input.addEventListener('pointerdown', event => {
      event.preventDefault();
      openDateCalendar(input);
    });
    input.addEventListener('keydown', event => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const existing = input.dataset.dateDigits || '';
        const digits = existing.length >= 8 ? event.key : existing + event.key;
        input.dataset.dateDigits = digits;
        input.setCustomValidity('');
        input.classList.remove('input-invalid');
        input.removeAttribute('aria-invalid');
        updateDatePresentation(input);
        if (digits.length === 8) {
          const value = dateFromDigits(digits);
          if (value) {
            input.dataset.dateDigits = '';
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles:true }));
            input.dispatchEvent(new Event('change', { bubbles:true }));
          } else {
            input.setCustomValidity('Bitte gib ein gültiges Datum im Format TTMMJJJJ ein.');
            input.classList.add('input-invalid');
            input.setAttribute('aria-invalid', 'true');
          }
        }
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        const valueDigits = input.value ? `${input.value.slice(8, 10)}${input.value.slice(5, 7)}${input.value.slice(0, 4)}` : '';
        input.dataset.dateDigits = (input.dataset.dateDigits || valueDigits).slice(0, -1);
        input.setCustomValidity('');
        input.classList.remove('input-invalid');
        input.removeAttribute('aria-invalid');
        updateDatePresentation(input);
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        input.dataset.dateDigits = '';
        input.value = '';
        input.setCustomValidity('');
        input.dispatchEvent(new Event('input', { bubbles:true }));
        input.dispatchEvent(new Event('change', { bubbles:true }));
        return;
      }
      if (event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        openDateCalendar(input);
        return;
      }
      if (event.key === 'Enter' && input.dataset.dateDigits) {
        event.preventDefault();
        event.stopPropagation();
        input.setCustomValidity(input.dataset.dateDigits.length === 8
          ? 'Bitte gib ein gültiges Datum im Format TTMMJJJJ ein.'
          : 'Bitte gib das Datum vollständig im Format TTMMJJJJ ein.');
        input.classList.add('input-invalid');
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      if (event.key === 'Tab' && focusAdjacentFormControl(input, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!['Tab','Enter','Escape'].includes(event.key)) event.preventDefault();
    });
    input.addEventListener('blur', () => {
      if (!input.dataset.dateDigits || input.dataset.dateDigits.length === 8 && dateFromDigits(input.dataset.dateDigits)) return;
      input.setCustomValidity(input.dataset.dateDigits.length === 8
        ? 'Bitte gib ein gültiges Datum im Format TTMMJJJJ ein.'
        : 'Bitte gib das Datum vollständig im Format TTMMJJJJ ein.');
      input.classList.add('input-invalid');
      input.setAttribute('aria-invalid', 'true');
    });
    const update = () => {
      input.dataset.dateDigits = '';
      input.setCustomValidity('');
      updateDatePresentation(input);
      if (!input.value) return;
      input.classList.remove('input-invalid');
      input.removeAttribute('aria-invalid');
    };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    updateDatePresentation(input);
  });
}
const toast = message => { const node = $('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2600); };
const entryTitle = entry => entry?.title || entry?.body?.split('\n')[0]?.slice(0, 70) || 'Arbeitsschritt ohne Titel';
const countWords = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const workStepCount = (count, completed = false) => `${completed ? 'Abgeschlossen' : 'Anstehend'} (${count})`;
const itemCount = (collection, count) => {
  const config = sections[collection];
  if (count === 0) return `Keine ${config.plural}`;
  if (count === 1) return `${['ideas','learnings','notes'].includes(collection) ? 'Eine' : 'Ein'} ${config.singular}`;
  const value = count < 10 ? countWords[count][0].toUpperCase() + countWords[count].slice(1) : String(count);
  return `${value} ${config.plural}`;
};
const regularProjectStatuses = ['idea','active','paused','completed'];
const projectStatusLabels = { idea:'Idee', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen', archived:'Archiviert', trashed:'Papierkorb' };
const searchTypeLabels = { all:'Alle Bereiche', project:'Projekte', entries:'Logbuch', tasks:'Arbeitsschritte', shopping:'Einkaufsliste', materials:'Material', contacts:'Kontakte', links:'Links', ideas:'Ideen', learnings:'Erkenntnisse', notes:'Notizen', files:'Dateien' };
const searchSortLabels = { relevance:'Relevanz', newest:'Neueste zuerst', oldest:'Älteste zuerst', project:'Projektname', title:'Titel' };
const projectPriority = project => ['Hoch','Mittel','Gering'].includes(project?.priority) ? project.priority : 'Mittel';
const projectPriorityMarkup = project => `<span class="project-priority ${projectPriority(project).toLocaleLowerCase('de')}">${escapeHtml(projectPriority(project))}</span>`;
const projectStatusControl = project => mayEditProjects()
  ? `<select class="project-inline-select project-status ${escapeHtml(project.status)}" data-project-inline-status="${escapeHtml(project.id)}" aria-label="Status von ${escapeHtml(project.title)} ändern">${['idea','active','paused','completed','archived'].map(status => `<option value="${status}"${project.status === status ? ' selected' : ''}>${projectStatusLabels[status]}</option>`).join('')}</select>`
  : `<span class="project-status ${escapeHtml(project.status)}">${escapeHtml(projectStatusLabels[project.status] || project.status)}</span>`;
const projectPriorityControl = project => mayEditProjects()
  ? `<select class="project-inline-select project-priority ${projectPriority(project).toLocaleLowerCase('de')}" data-project-inline-priority="${escapeHtml(project.id)}" aria-label="Priorität von ${escapeHtml(project.title)} ändern">${['Hoch','Mittel','Gering'].map(priority => `<option value="${priority}"${projectPriority(project) === priority ? ' selected' : ''}>${priority}</option>`).join('')}</select>`
  : projectPriorityMarkup(project);
const projectFlagIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 21V4"></path><path d="M6 5h10l-2 3 2 3H6Z"></path></svg>';
const editIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.9.5l-2.9.9a.5.5 0 0 1-.6-.6l.9-2.9a2 2 0 0 1 .5-.9Z"></path></svg>';
const printIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 9V3h10v6"></path><path d="M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M7 14h10v7H7Z"></path><path d="M17.5 12h.01"></path></svg>';
const exportIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path></svg>';
const projectEditButton = project => mayEditProjects() ? `<button class="edit-action" type="button" data-edit-project="${escapeHtml(project.id)}" aria-label="Projekt bearbeiten" title="Projekt bearbeiten">${editIcon()}</button>` : '';
const projectExportButton = project => `<details class="action-menu project-export-menu"><summary aria-label="Projekt teilen oder exportieren" title="Projekt teilen oder exportieren">${exportIcon()}</summary><div class="action-menu-panel"><button class="menu-item" type="button" data-ai-project-export="${escapeHtml(project.id)}"><strong>Für KI herunterladen</strong><small>Projektstand als Markdown weitergeben</small></button><span class="action-menu-separator" aria-hidden="true"></span><a class="menu-item" href="/api/backup/projects/${encodeURIComponent(project.id)}"><strong>Rohdaten</strong><small>Für eine andere Logbuch-Instanz</small></a><a class="menu-item" href="/#/projects/${encodeURIComponent(project.id)}/export" target="_blank" rel="noopener"><strong>PDF-Export</strong><small>Farbig, inklusive Bilder</small></a><a class="menu-item" href="/#/projects/${encodeURIComponent(project.id)}/print" target="_blank" rel="noopener"><strong>Druckansicht</strong><small>Schwarz-weiß</small></a></div></details>`;
const folderEditButton = folder => mayEditProjects() ? `<button class="edit-action" type="button" data-edit-folder="${escapeHtml(folder.id)}" aria-label="Ordner bearbeiten" title="Ordner bearbeiten">${editIcon()}</button>` : '';
const itemEditButton = (collection, id, label = 'Arbeitsschritt') => `<button class="edit-action" type="button" data-edit-item="${collection}:${escapeHtml(id)}" aria-label="${escapeHtml(label)} bearbeiten" title="${escapeHtml(label)} bearbeiten">${editIcon()}</button>`;
const entryEditButton = id => `<button class="edit-action" type="button" data-edit-entry="${escapeHtml(id)}" aria-label="Arbeitsschritt bearbeiten" title="Arbeitsschritt bearbeiten">${editIcon()}</button>`;
const copyLinkIcon = () => '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8.25 11.75 3.5-3.5"></path><path d="M6.5 13.5 5 15a2.12 2.12 0 0 1-3-3l3-3a2.12 2.12 0 0 1 3 0"></path><path d="m13.5 6.5 1.5-1.5a2.12 2.12 0 0 1 3 3l-3 3a2.12 2.12 0 0 1-3 0"></path></svg>';
const trashIcon = () => '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 6h11l-.75 11h-9.5L4.5 6Z"></path><path d="M3 6h14M7.5 6V3.5h5V6M8 9v5M12 9v5"></path></svg>';
const entryCopyButton = id => `<button class="edit-action" type="button" data-copy-entry-link="${escapeHtml(id)}" aria-label="Link zum Arbeitsschritt kopieren" title="Link kopieren">${copyLinkIcon()}</button>`;
const entryDeleteButton = id => `<button class="edit-action delete-action" type="button" data-delete-entry="${escapeHtml(id)}" aria-label="Arbeitsschritt löschen" title="Arbeitsschritt löschen">${trashIcon()}</button>`;
const itemDeleteButton = (collection, id, label = 'Eintrag') => `<button class="edit-action delete-action" type="button" data-delete-item="${collection}:${escapeHtml(id)}" aria-label="${escapeHtml(label)} löschen" title="${escapeHtml(label)} löschen">${trashIcon()}</button>`;
const projectFlagControl = project => mayEditProjects()
  ? `<button class="project-flag-toggle${project.flagged === true ? ' active' : ''}" type="button" data-project-flag="${escapeHtml(project.id)}" data-flagged="${project.flagged === true}" aria-pressed="${project.flagged === true}" aria-label="${project.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen'}" title="${project.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen'}">${projectFlagIcon()}</button>`
  : project.flagged === true ? `<span class="project-flag-indicator" aria-label="Projekt ist markiert" title="Projekt ist markiert">${projectFlagIcon()}</span>` : '';
const folderFlagControl = folder => mayEditProjects()
  ? `<button class="project-flag-toggle${folder.flagged === true ? ' active' : ''}" type="button" data-folder-flag="${escapeHtml(folder.id)}" data-flagged="${folder.flagged === true}" aria-pressed="${folder.flagged === true}" aria-label="${folder.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen'}" title="${folder.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen'}">${projectFlagIcon()}</button>`
  : folder.flagged === true ? `<span class="project-flag-indicator" aria-label="Ordner ist markiert" title="Ordner ist markiert">${projectFlagIcon()}</span>` : '';
const taskFlagControl = task => mayEditProjects()
  ? `<button class="project-flag-toggle${task.flagged === true ? ' active' : ''}" type="button" data-task-flag="${escapeHtml(task.id)}" data-flagged="${task.flagged === true}" aria-pressed="${task.flagged === true}" aria-label="${task.flagged === true ? 'Markierung des Arbeitsschritts entfernen' : 'Arbeitsschritt markieren'}" title="${task.flagged === true ? 'Markierung entfernen' : 'Arbeitsschritt markieren'}">${projectFlagIcon()}</button>`
  : task.flagged === true ? `<span class="project-flag-indicator" aria-label="Arbeitsschritt ist markiert" title="Arbeitsschritt ist markiert">${projectFlagIcon()}</span>` : '';
const safeUrl = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
const mayEditProjects = () => state.user?.admin || state.user?.role === 'editor';
const sections = {
  tasks: { singular:'Arbeitsschritt', plural:'Arbeitsschritte', emptyText:'Plane die nächsten konkreten Arbeitsschritte für dieses Projekt.', fields:[
    { name:'title', label:'Arbeitsschritt', required:true, placeholder:'z. B. Kabel ablängen und beschriften' },
    { name:'description', label:'Beschreibung', type:'textarea', placeholder:'Zusätzliche Informationen, Anforderungen oder offene Fragen …' },
    { name:'priority', label:'Priorität', type:'select', options:['Normal','Hoch','Niedrig'] },
    { name:'dueDate', label:'Fällig am', type:'date' }
  ]},
  shopping: { singular:'Gegenstand', plural:'Gegenstände', emptyText:'Sammle alles, was du für dieses Projekt noch besorgen möchtest.', fields:[
    { name:'name', label:'Gegenstand', required:true, placeholder:'z. B. Edelstahlschrauben M4 × 20' },
    { name:'properties', label:'Eigenschaft', placeholder:'z. B. Senkkopf, Innensechskant, A2' },
    { name:'quantity', label:'Anzahl', placeholder:'z. B. 12 Stück' },
    { name:'retailer', label:'Händler', placeholder:'z. B. Eisenwaren Müller' },
    { name:'url', label:'Link', type:'url', placeholder:'https://…' },
    { name:'status', label:'Status', type:'select', options:['Benötigt','Bestellt','Gekauft'] },
    { name:'priority', label:'Priorität', type:'select', options:['Normal','Hoch','Niedrig'] },
    { name:'unitPrice', label:'Preis', placeholder:'z. B. 8,90 €' },
    { name:'notes', label:'Notizen', type:'textarea', placeholder:'Alternative, Lieferhinweise oder weitere Angaben …' }
  ]},
  materials: { singular:'Material', plural:'Materialien', emptyText:'Erfasse benötigte, mögliche oder bereits gekaufte Materialien.', fields:[
    { name:'name', label:'Bezeichnung', required:true, placeholder:'z. B. Aluminiumprofil 20 × 20 mm' },
    { name:'quantity', label:'Menge', placeholder:'z. B. 2 × 1 m' },
    { name:'status', label:'Status', type:'select', options:['Kommt infrage','Geplant','Gekauft','Vorhanden'] },
    { name:'price', label:'Preis', placeholder:'z. B. 19,90 €' },
    { name:'url', label:'Produktlink', type:'url', placeholder:'https://…' },
    { name:'properties', label:'Eigenschaften und Notizen', type:'textarea', placeholder:'Abmessungen, Material, Bezugsquelle …' }
  ]},
  contacts: { singular:'Kontakt', plural:'Kontakte', emptyText:'Halte Personen fest, die dich bei diesem Projekt unterstützen.', fields:[
    { name:'name', label:'Name', required:true, placeholder:'Vor- und Nachname' },
    { name:'role', label:'Rolle', placeholder:'z. B. Elektronik, Beratung' },
    { name:'company', label:'Firma oder Organisation' },
    { name:'email', label:'E-Mail', type:'email' },
    { name:'phone', label:'Telefon', type:'tel' },
    { name:'notes', label:'Notizen', type:'textarea' }
  ]},
  links: { singular:'Link', plural:'Links', emptyText:'Sammle hilfreiche Webseiten, Anleitungen und Datenblätter.', fields:[
    { name:'title', label:'Titel', required:true, placeholder:'z. B. Datenblatt des Netzteils' },
    { name:'url', label:'Adresse', type:'url', required:true, placeholder:'https://…' },
    { name:'notes', label:'Beschreibung', type:'textarea', placeholder:'Warum ist dieser Link wichtig?' }
  ]},
  ideas: { singular:'Idee', plural:'Ideen', emptyText:'Sammle Einfälle, Varianten und offene Gedanken zu deinem Projekt.', fields:[
    { name:'title', label:'Titel', required:true, placeholder:'Eine kurze Bezeichnung' },
    { name:'status', label:'Status', type:'select', options:['Offen','Prüfen','Umgesetzt','Verworfen'] },
    { name:'description', label:'Beschreibung', type:'textarea', placeholder:'Gedanke, mögliche Umsetzung, offene Fragen …' }
  ]},
  learnings: { singular:'Erkenntnis', plural:'Erkenntnisse', emptyText:'Halte fest, was du während dieses Projekts gelernt hast.', fields:[
    { name:'title', label:'Erkenntnis', required:true, placeholder:'Eine kurze Zusammenfassung' },
    { name:'description', label:'Beschreibung', type:'textarea', placeholder:'Was genau hast du gelernt und in welchem Zusammenhang?' },
    { name:'futureUse', label:'Für die Zukunft', type:'textarea', placeholder:'Was möchtest du beim nächsten Mal beibehalten oder anders machen?' }
  ]},
  notes: { singular:'Notiz', plural:'Notizen', emptyText:'Halte Gedanken und Informationen fest, die du im Projekt griffbereit haben möchtest.', fields:[
    { name:'title', label:'Titel', required:true, placeholder:'Eine kurze Bezeichnung' },
    { name:'description', label:'Notiz', type:'textarea', placeholder:'Deine Notiz …' }
  ]}
};

const startPageHref = value => ({ home:'/#/', projects:'/#/projects', archive:'/#/archive' }[value] || '/#/');

function showApp(afterLogin = false) {
  state.projectSort = sortFromPreference(state.user?.projectSort, true, 'status:asc');
  state.archiveSort = sortFromPreference(state.user?.archiveSort, false, 'createdAt:desc');
  loadIconLibrary().then(updateProjectNavigationIcon).catch(() => {});
  $('#login-view').classList.add('hidden');
  $('#app').classList.remove('hidden');
  document.querySelectorAll('[data-admin-setting]').forEach(node => node.hidden = !state.user.admin);
  if (!state.user.mustChangePassword) loadTodos().catch(() => {});
  if (!state.user.mustChangePassword) loadProjects().catch(() => {});
  if (!state.user.mustChangePassword) loadInventoryMenuCounts().catch(() => {});
  if (state.user.admin && !state.user.mustChangePassword) loadUpdateStatus().catch(() => {});
  if (state.user.mustChangePassword) {
    history.replaceState(null, '', '/#/settings/profile');
    route().then(() => openPasswordDialog(true));
  } else {
    if (afterLogin) history.replaceState(null, '', startPageHref(state.user.startPage));
    route();
  }
}

async function loadProjects() {
  const data = await api('/projects');
  state.projects = data.projects || [];
  updateProjectMenuCounts();
}

function updateTodoMenuCount() {
  const count = state.todos.filter(todo => !todo.completedAt).length;
  const badge = $('#todo-nav-count');
  badge.textContent = String(count);
  badge.hidden = false;
  badge.title = 'Anzahl der offenen Erinnerungen';
  badge.setAttribute('aria-label', `Anzahl der offenen Erinnerungen: ${count}`);
}

async function loadTodos() {
  const data = await api('/todos');
  state.todos = data.todos || [];
  updateTodoMenuCount();
  return state.todos;
}

async function loadTags() {
  const data = await api('/tags');
  state.tags = data.tags || [];
}

async function loadFolders() {
  const data = await api('/folders');
  state.folders = data.folders || [];
}

async function loadProjectBrowser() {
  const [data] = await Promise.all([api('/project-browser'), loadIconLibrary()]);
  state.projects = data.projects || [];
  state.tags = data.tags || [];
  state.folders = data.folders || [];
  updateProjectMenuCounts();
}

async function loadIconLibrary() {
  if (state.iconLibrary) return state.iconLibrary;
  if (!iconLibraryPromise) iconLibraryPromise = fetch('/lucide-icons.json?v=20260820-1').then(response => {
    if (!response.ok) throw new Error('Symbolbibliothek konnte nicht geladen werden');
    return response.json();
  }).then(library => {
    state.iconLibrary = library;
    return library;
  }).catch(error => {
    iconLibraryPromise = null;
    throw error;
  });
  return iconLibraryPromise;
}

const entityIconName = (entity, fallback) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(entity?.icon || '')) ? entity.icon : fallback;
const defaultProjectIconName = () => entityIconName({ icon:state.user?.defaultProjectIcon }, 'box');
const projectUsesDefaultIcon = project => project?.iconInherited === true || (project?.iconInherited === undefined && entityIconName(project, 'box') === 'box');
const projectIconName = project => projectUsesDefaultIcon(project) ? defaultProjectIconName() : entityIconName(project, 'box');
function updateProjectNavigationIcon() {
  const icon = document.querySelector('[data-project-nav-icon]');
  if (icon) icon.innerHTML = iconSvg(defaultProjectIconName());
}
function iconSvg(name) {
  const library = state.iconLibrary;
  const icon = library?.icons?.[name] || library?.icons?.circle;
  if (!icon && name === 'box') return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m4 7.5 8 4.5 8-4.5M12 12v9"></path></svg>';
  if (!icon) return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle></svg>';
  return `<svg viewBox="0 0 ${Number(icon.width || library.width || 24)} ${Number(icon.height || library.height || 24)}" aria-hidden="true">${icon.body}</svg>`;
}

function contextActionMenu(label, items, { className = '', title = label } = {}) {
  if (!items) return '';
  return `<details class="action-menu${className ? ` ${className}` : ''}"><summary aria-label="${escapeHtml(label)}" title="${escapeHtml(title)}">${iconSvg('ellipsis')}</summary><div class="action-menu-panel">${items}</div></details>`;
}

function inventoryItemManagementActions(item, archived = item.status === 'ARCHIVED', { includeEdit = true } = {}) {
  if (!mayEditProjects()) return '';
  return archived
    ? `<button class="menu-item" type="button" data-inventory-item-restore="${escapeHtml(item.id)}">Wiederherstellen</button>`
    : `${includeEdit ? `<button class="menu-item" type="button" data-inventory-item-edit="${escapeHtml(item.id)}">Artikel bearbeiten</button>` : ''}<button class="menu-item danger" type="button" data-inventory-item-archive="${escapeHtml(item.id)}" data-inventory-item-name="${escapeHtml(item.name)}">Archivieren</button>`;
}

function inventoryItemDetailsButton(item, includeArchived = item.status === 'ARCHIVED') {
  return `<a class="edit-action inventory-item-details-link" href="${inventoryItemHref(item.id, includeArchived, '')}" aria-label="Vollständige Artikeldetails für ${escapeHtml(item.name)} öffnen" title="Vollständige Artikeldetails öffnen">${iconSvg('search')}</a>`;
}

function inventoryItemEditButton(item, archived = item.status === 'ARCHIVED') {
  return mayEditProjects() && !archived ? `<button class="edit-action" type="button" data-inventory-item-edit="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} bearbeiten" title="Artikel bearbeiten">${editIcon()}</button>` : '';
}

function standardPageHeader({ title, description = '', icon = 'circle', iconMarkup = '', actions = '', breadcrumbs = '', className = '' }) {
  return `<div class="project-page-head standard-page-head standard-plain-page-head${className ? ` ${className}` : ''}"><div class="standard-page-breadcrumbs${breadcrumbs ? '' : ' empty'}">${breadcrumbs}</div><span class="project-hero-icon" aria-hidden="true">${iconMarkup || iconSvg(icon)}</span><div class="project-heading-content"><div class="project-title-line"><h1>${escapeHtml(title)}</h1></div><p class="project-description">${escapeHtml(description)}</p></div><div class="standard-page-head-actions">${actions}</div></div>`;
}

function confirmAction(message, { title = 'Bitte bestätigen', confirmLabel = 'Bestätigen', danger = true } = {}) {
  const dialog = $('#confirmation-dialog');
  const form = $('#confirmation-form');
  $('#confirmation-dialog-title').textContent = title;
  $('#confirmation-dialog-copy').textContent = message;
  const submit = $('#confirmation-submit');
  submit.textContent = confirmLabel;
  submit.classList.toggle('danger-button', danger);
  submit.classList.toggle('primary', !danger);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', submitHandler);
      dialog.removeEventListener('close', closeHandler);
      resolve(value);
    };
    const submitHandler = event => {
      event.preventDefault();
      dialog.close('confirm');
      finish(true);
    };
    const closeHandler = () => finish(dialog.returnValue === 'confirm');
    form.addEventListener('submit', submitHandler);
    dialog.addEventListener('close', closeHandler);
    dialog.returnValue = '';
    dialog.showModal();
    requestAnimationFrame(() => submit.focus());
  });
}

function updateProjectMenuCounts() {
  const counts = state.projects.reduce((result, project) => {
    if (Object.hasOwn(result, project.status)) result[project.status] += 1;
    return result;
  }, { idea:0, active:0, paused:0, completed:0, archived:0, trashed:0 });
  counts.all = counts.idea + counts.active + counts.paused + counts.completed;
  document.querySelectorAll('[data-project-count]').forEach(node => { node.textContent = counts[node.dataset.projectCount] ?? 0; });
  const badge = $('#project-nav-count');
  const menuOpen = $('#projects-toggle').getAttribute('aria-expanded') === 'true';
  badge.dataset.count = String(counts.active);
  badge.textContent = String(counts.active);
  badge.hidden = menuOpen;
  badge.title = 'Anzahl der aktiven Projekte';
  badge.setAttribute('aria-label', `Anzahl der aktiven Projekte: ${counts.active}`);
}

async function loadInventoryMenuCounts() {
  const [locationData, categoryData, itemData, replenishmentData] = await Promise.all([
    api('/storage-locations?includeArchived=1'),
    api('/inventory-categories'),
    api('/inventory-items?includeArchived=1'),
    api('/inventory-replenishment'),
  ]);
  const locations = locationData.locations || [];
  const items = itemData.items || [];
  const counts = {
    locations:locations.filter(location => location.status === 'ACTIVE').length,
    categories:(categoryData.categories || []).length,
    items:items.filter(item => item.status === 'ACTIVE').length,
    replenishment:Number(replenishmentData.summary?.itemCount || 0),
    archive:locations.filter(location => location.status === 'ARCHIVED').length + items.filter(item => item.status === 'ARCHIVED').length,
  };
  document.querySelectorAll('[data-inventory-count]').forEach(node => { node.textContent = counts[node.dataset.inventoryCount] ?? 0; });
  const badge = $('#inventory-nav-count');
  const menuOpen = $('#inventory-toggle').getAttribute('aria-expanded') === 'true';
  badge.dataset.count = String(counts.items);
  badge.textContent = String(counts.items);
  badge.hidden = menuOpen;
  badge.title = 'Anzahl unterschiedlicher Artikel im Lager';
  badge.setAttribute('aria-label', `Anzahl unterschiedlicher Artikel im Lager: ${counts.items}`);
  return counts;
}

function rememberProject(project) {
  const index = state.projects.findIndex(item => item.id === project.id);
  if (index >= 0) state.projects[index] = { ...state.projects[index], ...project };
  else state.projects.push(project);
  updateProjectMenuCounts();
}

const tagById = id => state.tags.find(tag => tag.id === id);
const tagLink = (tag, archived = false) => `/#/${archived ? 'archive' : 'projects'}?${!archived && state.projectStatusFilter !== 'all' ? `status=${encodeURIComponent(state.projectStatusFilter)}&` : ''}tags=${encodeURIComponent(tag.id)}`;
function tagChips(tagIds = [], { limit = 5, linked = true, archived = false } = {}) {
  const tags = tagIds.map(tagById).filter(Boolean);
  if (!tags.length) return '';
  const shown = tags.slice(0, limit);
  const chips = shown.map(tag => linked ? `<a class="tag-chip" href="${tagLink(tag, archived)}">${escapeHtml(tag.name)}</a>` : `<span class="tag-chip">${escapeHtml(tag.name)}</span>`).join('');
  return `<div class="tag-chips">${chips}${tags.length > limit ? `<span class="tag-chip more">+${tags.length - limit}</span>` : ''}</div>`;
}

function projectCardActions(project) {
  return `${projectEditButton(project)}${projectFlagControl(project)}`;
}

function projectCard(project, archived = false, showFolder = false) {
  const nextSteps = (Array.isArray(project.nextTaskTitles) ? project.nextTaskTitles : [project.nextTaskTitle]).map(value => String(value || '').trim()).filter(Boolean).slice(0, 3);
  if (!nextSteps.length && String(project.latestNextStep || '').trim()) nextSteps.push(String(project.latestNextStep).trim());
  const tagNames = (project.tagIds || []).map(tagById).filter(Boolean).map(tag => tag.name);
  const folderPath = showFolder ? folderPathLabel(project.folderId) : '';
  const searchText = [project.title, project.description, project.latestEntryTitle, project.latestEntryBody, folderPath, ...nextSteps, ...tagNames].filter(Boolean).join(' ').toLocaleLowerCase('de');
  return `<article class="project-card" data-project-card data-project-card-status="${escapeHtml(project.status)}" data-project-tags="${escapeHtml((project.tagIds || []).join(','))}" data-project-search="${escapeHtml(searchText)}">
    <a class="project-card-content" href="/#/projects/${encodeURIComponent(project.id)}"><div class="entity-card-lead"><span class="project-entity-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><span class="entity-card-copy"><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p></span></div><div class="project-next-step"><small>Nächste anstehende Schritte</small>${nextSteps.length ? `<ul class="project-next-steps">${nextSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>` : '<strong>Kein nächster Schritt hinterlegt</strong>'}</div></a>
    <aside class="project-card-status project-card-collapsible-status mobile-collapsed" data-mobile-status-panel aria-label="Projektstatus"><div class="project-card-status-head">${mobileStatusToggle('Statusdetails')}<div class="project-card-actions">${projectCardActions(project)}</div></div><div class="project-card-status-content" data-mobile-status-content><div class="project-status-row"><small>Status</small>${projectStatusControl(project)}</div><div class="project-status-row"><small>Priorität</small>${projectPriorityControl(project)}</div><div class="project-status-row"><small>Start</small><span class="project-status-value">${project.createdAt ? formatDate(project.createdAt) : 'ohne'}</span></div><div class="project-status-row"><small>Fällig</small><span class="project-status-value">${project.dueDate ? formatDate(project.dueDate) : 'ohne'}</span></div>${folderPath ? `<div class="project-status-row project-status-folder"><small>Ordner</small><a href="${folderHref(project.folderId)}" title="Ordner öffnen">${escapeHtml(folderPath)}</a></div>` : ''}<div class="project-status-row project-status-tags"><small>Tags</small>${tagChips(project.tagIds, { archived }) || '<span class="project-status-empty">Keine</span>'}</div></div></aside>
  </article>`;
}

function projectCards(projects, archived = false, showFolder = false, separateStatuses = false) {
  if (!separateStatuses) return projects.map(project => projectCard(project, archived, showFolder)).join('');
  const statusGroupLabels = { idea:'Projektideen', active:'Aktive Projekte', paused:'Pausierte Projekte', completed:'Abgeschlossene Projekte' };
  const statuses = state.projectStatusFilter === 'all' ? regularProjectStatuses : [state.projectStatusFilter];
  return statuses.map(status => {
    const groupedProjects = projects.filter(project => project.status === status);
    const collapsed = state.collapsedProjectStatusGroups[status] === true;
    const label = statusGroupLabels[status] || 'Projekte';
    const divider = `<div class="project-status-divider project-list-divider"><button class="project-divider-toggle" type="button" data-toggle-project-status-group="${escapeHtml(status)}" aria-expanded="${!collapsed}" aria-label="${escapeHtml(label)} ${collapsed ? 'ausklappen' : 'einklappen'}" title="${collapsed ? 'Ausklappen' : 'Einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><strong class="divider-label">${escapeHtml(label)} <b data-project-status-count>(${groupedProjects.length})</b></strong></button></div>`;
    return `<div class="project-group-head" data-project-status-divider="${escapeHtml(status)}">${divider}</div>${groupedProjects.map(project => projectCard(project, archived, showFolder)).join('')}`;
  }).join('');
}

const folderById = id => state.folders.find(folder => folder.id === id);
function folderPathLabel(folderId) {
  const names = [];
  const visited = new Set();
  let current = folderById(folderId);
  while (current && !visited.has(current.id)) {
    names.unshift(current.name);
    visited.add(current.id);
    current = folderById(current.parentId);
  }
  return names.join(' › ');
}
function descendantFolderIds(folderId) {
  const descendants = new Set(folderId ? [folderId] : state.folders.filter(folder => !folder.parentId).map(folder => folder.id));
  let changed = true;
  while (changed) {
    changed = false;
    state.folders.forEach(folder => {
      if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    });
  }
  return descendants;
}
const folderHref = id => {
  const params = new URLSearchParams();
  if (id) params.set('folder', id);
  if (state.projectStatusFilter !== 'all') params.set('status', state.projectStatusFilter);
  return `/#/projects${params.size ? `?${params}` : ''}`;
};
function folderProjectCount(folderId) {
  const descendants = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    state.folders.forEach(folder => {
      if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    });
  }
  return state.projects.filter(project => regularProjectStatuses.includes(project.status) && (state.projectStatusFilter === 'all' || project.status === state.projectStatusFilter) && descendants.has(project.folderId)).length;
}

function folderCard(folder) {
  const count = folderProjectCount(folder.id);
  return `<article class="folder-card"><a class="folder-card-main" href="${folderHref(folder.id)}"><span class="folder-icon" aria-hidden="true">${iconSvg(entityIconName(folder, 'folder'))}</span><span><h3>${escapeHtml(folder.name)}</h3><p>${escapeHtml(folder.description || 'Keine Beschreibung')}</p><small>${count} ${count === 1 ? 'Projekt' : 'Projekte'}</small></span></a><aside class="project-card-status folder-card-status" aria-label="Ordneraktionen"><div class="project-card-actions">${folderEditButton(folder)}${folderFlagControl(folder)}</div></aside></article>`;
}

function folderBreadcrumbs(folderId) {
  const chain = [];
  const visited = new Set();
  let current = folderById(folderId);
  while (current && !visited.has(current.id)) {
    chain.unshift(current);
    visited.add(current.id);
    current = folderById(current.parentId);
  }
  return `<nav class="folder-breadcrumbs" aria-label="Ordnerpfad"><a href="${folderHref(null)}">Projekte</a>${chain.map(folder => `<span>›</span><a href="${folderHref(folder.id)}">${escapeHtml(folder.name)}</a>`).join('')}</nav>`;
}

function folderSelectOptions(selectedId = '', excludedId = '') {
  const children = parentId => state.folders.filter(folder => folder.parentId === parentId && folder.id !== excludedId).sort((a,b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
  const rows = [];
  const append = (parentId, depth) => children(parentId).forEach(folder => {
    rows.push(`<option value="${escapeHtml(folder.id)}"${folder.id === selectedId ? ' selected' : ''}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(folder.name)}</option>`);
    append(folder.id, depth + 1);
  });
  append(null, 0);
  return `<option value=""${selectedId ? '' : ' selected'}>Kein Ordner</option>${rows.join('')}`;
}

function projectCreatedAt(project) {
  if (project.createdAt) return project.createdAt;
  const timestamp = String(project.id || '').match(/^project-(\d+)$/)?.[1];
  return timestamp ? new Date(Number(timestamp)).toISOString() : '';
}

function sortedProjects(projects, sort = state.projectSort) {
  const { field, direction } = sort;
  const factor = direction === 'asc' ? 1 : -1;
  return [...projects].sort((a, b) => {
    if (field === 'status') {
      const statusOrder = { idea:0, active:1, paused:2, completed:3, archived:4, trashed:5 };
      const statusComparison = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      if (statusComparison) return statusComparison * factor;
      const createdComparison = String(projectCreatedAt(b) || '').localeCompare(String(projectCreatedAt(a) || ''), 'de', { numeric:true });
      if (createdComparison) return createdComparison;
      return String(a.title || '').localeCompare(String(b.title || ''), 'de', { sensitivity:'base' });
    }
    if (field === 'priority') {
      const priorityOrder = { Hoch:3, Mittel:2, Gering:1 };
      const priorityComparison = (priorityOrder[projectPriority(a)] ?? 2) - (priorityOrder[projectPriority(b)] ?? 2);
      if (priorityComparison) return priorityComparison * factor;
      const createdComparison = String(projectCreatedAt(b) || '').localeCompare(String(projectCreatedAt(a) || ''), 'de', { numeric:true });
      if (createdComparison) return createdComparison;
      return String(a.title || '').localeCompare(String(b.title || ''), 'de', { sensitivity:'base' });
    }
    const left = field === 'title' ? a.title : field === 'latestEntryDate' ? a.latestEntryDate : field === 'dueDate' ? a.dueDate : projectCreatedAt(a);
    const right = field === 'title' ? b.title : field === 'latestEntryDate' ? b.latestEntryDate : field === 'dueDate' ? b.dueDate : projectCreatedAt(b);
    if (!left && right) return 1;
    if (left && !right) return -1;
    const comparison = String(left || '').localeCompare(String(right || ''), 'de', { sensitivity:'base', numeric:true });
    return comparison ? comparison * factor : String(a.title || '').localeCompare(String(b.title || ''), 'de', { sensitivity:'base' });
  });
}

const projectSortOptions = includeStatus => [
  ...(includeStatus ? [['status:asc','Status · Idee → Aktiv → Pausiert → Abgeschlossen']] : []),
  ['priority:desc','Priorität · Hoch → Gering'],
  ['priority:asc','Priorität · Gering → Hoch'],
  ['dueDate:asc','Fälligkeit · früheste zuerst'],
  ['dueDate:desc','Fälligkeit · späteste zuerst'],
  ['createdAt:desc','Erstelldatum · neueste zuerst'],
  ['createdAt:asc','Erstelldatum · älteste zuerst'],
  ['latestEntryDate:desc','Letzter Arbeitsschritt · neueste zuerst'],
  ['latestEntryDate:asc','Letzter Arbeitsschritt · älteste zuerst'],
  ['title:asc','Projektname · A–Z'],
  ['title:desc','Projektname · Z–A']
];
const sortFromPreference = (value, includeStatus, fallback) => {
  const selected = projectSortOptions(includeStatus).some(([option]) => option === value) ? value : fallback;
  const [field, direction] = selected.split(':');
  return { field, direction };
};

function projectSortControls(sort = state.projectSort, includeStatus = true) {
  const { field, direction } = sort;
  const selected = `${field}:${direction}`;
  const options = projectSortOptions(includeStatus);
  return `<div class="project-sort-panel" hidden><div class="tag-filter-head"><strong>Projekte sortieren</strong></div><div class="project-sort-options">${options.map(([value, label]) => `<label><input type="radio" name="project-sort" value="${value}"${value === selected ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></div>`;
}

function projectListControls(archived = false, projects = []) {
  const search = state.projectSearch[archived ? 'archived' : 'active'];
  const searchOpen = Boolean(search.trim());
  const key = archived ? 'archived' : 'active';
  const filter = state.projectTagFilter[key];
  const availableIds = new Set(projects.flatMap(project => project.tagIds || []));
  const availableTags = state.tags.filter(tag => availableIds.has(tag.id)).map(tag => ({ ...tag, viewProjectCount:projects.filter(project => (project.tagIds || []).includes(tag.id)).length })).sort((a,b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
  const foldersVisible = state.user.showProjectFolders !== false;
  const folderToggle = !archived ? `<button class="project-tool-toggle project-folder-toggle" type="button" data-toggle-folders aria-pressed="${!foldersVisible}" aria-label="${foldersVisible ? 'Ordner ausblenden' : 'Ordner einblenden'}" title="${foldersVisible ? 'Ordner ausblenden' : 'Ordner einblenden'}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z"></path><path d="M3.5 9h17"></path></svg></button>` : '';
  return `<div class="project-list-controls">
    <div class="project-compact-control${searchOpen ? ' open has-value' : ''}" data-search-control><button class="project-tool-toggle" type="button" data-toggle-search aria-label="Suche öffnen" aria-expanded="${searchOpen}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.8"></circle><path d="m15 15 4.5 4.5"></path></svg></button><input id="project-search" class="project-search" type="search" value="${escapeHtml(search)}" placeholder="${archived ? 'Archiv durchsuchen' : 'Projekte durchsuchen'}" aria-label="${archived ? 'Archivierte Projekte durchsuchen' : 'Projekte durchsuchen'}" autocomplete="off"></div>
    ${folderToggle}
    <div class="project-sort-control" data-sort-control><button class="project-tool-toggle" type="button" data-toggle-sort aria-label="Sortierung öffnen" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4m-3.5 12.5L16 20l3.5-3.5"></path></svg></button>${projectSortControls(archived ? state.archiveSort : state.projectSort, !archived)}</div>
    <div class="project-filter-control${filter.ids.length ? ' has-value' : ''}" data-filter-control><button class="project-tool-toggle" type="button" data-toggle-filter aria-label="Nach Tags filtern" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16l-6.2 7v5l-3.6 1.8V13L4 6Z"></path></svg>${filter.ids.length ? `<b>${filter.ids.length}</b>` : ''}</button><div class="tag-filter-panel" hidden><div class="tag-filter-head"><strong>Nach Tags filtern</strong>${filter.ids.length ? '<button type="button" data-clear-tag-filter>Zurücksetzen</button>' : ''}</div>${availableTags.length ? `<div class="tag-filter-options">${availableTags.map(tag => `<label><input type="checkbox" value="${escapeHtml(tag.id)}" ${filter.ids.includes(tag.id) ? 'checked' : ''}><span>${escapeHtml(tag.name)}</span><small>${tag.viewProjectCount}</small></label>`).join('')}</div><label class="tag-filter-mode">Verknüpfung<select data-tag-filter-mode><option value="all" ${filter.mode === 'all' ? 'selected' : ''}>Alle ausgewählten Tags</option><option value="any" ${filter.mode === 'any' ? 'selected' : ''}>Mindestens ein Tag</option></select></label>` : '<p class="tag-filter-empty">Für diese Projekte sind noch keine Tags vergeben.</p>'}</div></div>
  </div>`;
}

function selectedTagFiltersMarkup(archived) {
  const filter = state.projectTagFilter[archived ? 'archived' : 'active'];
  const tags = filter.ids.map(tagById).filter(Boolean);
  return tags.length ? `<div class="active-tag-filters"><span>Gefiltert nach:</span>${tags.map(tag => `<button type="button" data-remove-tag-filter="${escapeHtml(tag.id)}">${escapeHtml(tag.name)} ×</button>`).join('')}<small>${filter.mode === 'all' && tags.length > 1 ? 'Alle Tags' : filter.mode === 'any' && tags.length > 1 ? 'Mindestens ein Tag' : ''}</small></div>` : '';
}

function applyProjectSearch(archived) {
  const key = archived ? 'archived' : 'active';
  const query = state.projectSearch[key].trim().toLocaleLowerCase('de');
  const filter = state.projectTagFilter[key];
  const filtering = Boolean(query || filter.ids.length);
  const groupedByStatus = !archived && ((state.projectStatusFilter === 'all' && state.projectSort.field === 'status') || regularProjectStatuses.includes(state.projectStatusFilter));
  let visible = 0;
  document.querySelectorAll('[data-project-card]').forEach(card => {
    const cardTags = new Set((card.dataset.projectTags || '').split(',').filter(Boolean));
    const tagMatches = !filter.ids.length || (filter.mode === 'any' ? filter.ids.some(id => cardTags.has(id)) : filter.ids.every(id => cardTags.has(id)));
    const matches = (!query || card.dataset.projectSearch.includes(query)) && tagMatches;
    const collapsed = groupedByStatus && state.collapsedProjectStatusGroups[card.dataset.projectCardStatus] === true;
    card.dataset.projectFilterMatch = String(matches);
    card.classList.toggle('hidden', !matches || collapsed);
    if (matches) visible += 1;
  });
  document.querySelectorAll('[data-project-status-divider]').forEach(divider => {
    const statusCards = [...document.querySelectorAll('[data-project-card]')]
      .filter(card => card.dataset.projectCardStatus === divider.dataset.projectStatusDivider && card.dataset.projectFilterMatch === 'true');
    divider.classList.toggle('hidden', filtering && statusCards.length === 0);
    const count = divider.querySelector('[data-project-status-count]');
    if (count) count.textContent = `(${statusCards.length})`;
  });
  const noResults = $('#project-no-results');
  if (noResults) noResults.classList.toggle('hidden', !filtering || visible > 0);
}

function bindProjectStatusGroups() {
  document.querySelectorAll('[data-toggle-project-status-group]').forEach(button => button.onclick = () => {
    const status = button.dataset.toggleProjectStatusGroup;
    state.collapsedProjectStatusGroups[status] = !state.collapsedProjectStatusGroups[status];
    const expanded = !state.collapsedProjectStatusGroups[status];
    const label = button.querySelector('.divider-label')?.textContent.replace(/\s+\(\d+\)$/, '') || 'Projekte';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${label} ${expanded ? 'einklappen' : 'ausklappen'}`);
    button.title = expanded ? 'Einklappen' : 'Ausklappen';
    applyProjectSearch(false);
  });
}

function bindProjectFolderGroup() {
  const button = $('[data-toggle-project-folder-group]');
  if (!button) return;
  button.onclick = () => {
    state.collapsedProjectFolders = !state.collapsedProjectFolders;
    const expanded = !state.collapsedProjectFolders;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `Ordner ${expanded ? 'einklappen' : 'ausklappen'}`);
    button.title = expanded ? 'Einklappen' : 'Ausklappen';
    const content = $('[data-project-folder-group]');
    if (content) content.classList.toggle('hidden', state.collapsedProjectFolders);
  };
}

function updateTagFilterUrl(archived) {
  const filter = state.projectTagFilter[archived ? 'archived' : 'active'];
  const base = archived ? '/#/archive' : '/#/projects';
  const params = new URLSearchParams();
  if (!archived && state.currentFolderId) params.set('folder', state.currentFolderId);
  if (!archived && state.projectStatusFilter !== 'all') params.set('status', state.projectStatusFilter);
  if (filter.ids.length) params.set('tags', filter.ids.join(','));
  if (filter.ids.length > 1 && filter.mode === 'any') params.set('match', 'any');
  history.replaceState(null, '', `${base}${params.size ? `?${params}` : ''}`);
}

function bindProjectListControls(archived) {
  const searchControl = $('[data-search-control]');
  const sortControl = $('[data-sort-control]');
  const filterControl = $('[data-filter-control]');
  const searchToggle = $('[data-toggle-search]');
  const sortToggle = $('[data-toggle-sort]');
  const filterToggle = $('[data-toggle-filter]');
  const folderToggle = $('[data-toggle-folders]');
  const setControlOpen = (control, toggle, open) => {
    control.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  searchToggle.onclick = () => {
    const open = !searchControl.classList.contains('open');
    setControlOpen(searchControl, searchToggle, open);
    sortControl.querySelector('.project-sort-panel').hidden = true;
    sortToggle.setAttribute('aria-expanded', 'false');
    filterControl.querySelector('.tag-filter-panel').hidden = true;
    filterToggle.setAttribute('aria-expanded', 'false');
    if (open) requestAnimationFrame(() => $('#project-search').focus());
  };
  sortToggle.onclick = () => {
    const panel = sortControl.querySelector('.project-sort-panel');
    const open = panel.hidden;
    panel.hidden = !open;
    sortToggle.setAttribute('aria-expanded', String(open));
    setControlOpen(searchControl, searchToggle, false);
    filterControl.querySelector('.tag-filter-panel').hidden = true;
    filterToggle.setAttribute('aria-expanded', 'false');
  };
  filterToggle.onclick = () => {
    const panel = filterControl.querySelector('.tag-filter-panel');
    const open = panel.hidden;
    panel.hidden = !open;
    filterToggle.setAttribute('aria-expanded', String(open));
    setControlOpen(searchControl, searchToggle, false);
    sortControl.querySelector('.project-sort-panel').hidden = true;
    sortToggle.setAttribute('aria-expanded', 'false');
  };
  if (folderToggle) folderToggle.onclick = async () => {
    const showProjectFolders = state.user.showProjectFolders === false;
    folderToggle.disabled = true;
    try {
      const result = await api('/account/preferences', { method:'PATCH', body:JSON.stringify({ showProjectFolders }) });
      Object.assign(state.user, result);
      toast(showProjectFolders ? 'Ordner eingeblendet' : 'Ordner ausgeblendet');
      await renderProjects();
    } catch (error) { toast(error.message); folderToggle.disabled = false; }
  };
  const refreshFilterSummary = () => {
    const count = state.projectTagFilter[archived ? 'archived' : 'active'].ids.length;
    let badge = filterToggle.querySelector('b');
    if (count && !badge) { badge = document.createElement('b'); filterToggle.append(badge); }
    if (badge) { if (count) badge.textContent = count; else badge.remove(); }
    const current = $('#active-tag-filters');
    if (current) current.innerHTML = selectedTagFiltersMarkup(archived);
    bindTagFilterSummary();
    filterControl.classList.toggle('has-value', count > 0);
    applyProjectSearch(archived);
    updateTagFilterUrl(archived);
  };
  filterControl.querySelectorAll('.tag-filter-options input').forEach(input => input.onchange = () => {
    const filter = state.projectTagFilter[archived ? 'archived' : 'active'];
    filter.ids = [...filterControl.querySelectorAll('.tag-filter-options input:checked')].map(item => item.value);
    refreshFilterSummary();
  });
  const mode = filterControl.querySelector('[data-tag-filter-mode]');
  if (mode) mode.onchange = () => { state.projectTagFilter[archived ? 'archived' : 'active'].mode = mode.value; refreshFilterSummary(); };
  const clear = filterControl.querySelector('[data-clear-tag-filter]');
  if (clear) clear.onclick = () => {
    state.projectTagFilter[archived ? 'archived' : 'active'].ids = [];
    filterControl.querySelectorAll('.tag-filter-options input').forEach(input => { input.checked = false; });
    refreshFilterSummary();
  };
  sortControl.querySelectorAll('[name="project-sort"]').forEach(input => input.onchange = event => {
    const sort = archived ? state.archiveSort : state.projectSort;
    [sort.field, sort.direction] = event.target.value.split(':');
    archived ? renderArchive() : renderProjects();
  });
  $('#project-search').oninput = event => {
    state.projectSearch[archived ? 'archived' : 'active'] = event.target.value;
    searchControl.classList.toggle('has-value', Boolean(event.target.value.trim()));
    applyProjectSearch(archived);
  };
  $('#project-search').onkeydown = event => {
    if (event.key !== 'Escape') return;
    setControlOpen(searchControl, searchToggle, false);
    searchToggle.focus();
  };
  applyProjectSearch(archived);
}

function bindTagFilterSummary() {
  document.querySelectorAll('[data-remove-tag-filter]').forEach(button => button.onclick = () => {
    const archived = location.hash.startsWith('#/archive');
    const filter = state.projectTagFilter[archived ? 'archived' : 'active'];
    filter.ids = filter.ids.filter(id => id !== button.dataset.removeTagFilter);
    updateTagFilterUrl(archived);
    archived ? renderArchive() : renderProjects();
  });
}

function recentEntryCard(project) {
  if (!project.latestEntryId) return projectCard(project);
  const title = project.latestEntryTitle || project.latestEntryBody?.split('\n')[0]?.slice(0, 70) || 'Arbeitsschritt ohne Titel';
  const summary = project.latestEntryBody || project.latestNextStep || project.title;
  return `<a class="project-card" data-overview-card href="/p/${encodeURIComponent(project.id)}/e/${encodeURIComponent(project.latestEntryId)}">
    <h3>${escapeHtml(project.title)}</h3>
    <p><strong class="recent-entry-title">${escapeHtml(title)}</strong>${summary !== title ? `<span>${escapeHtml(summary)}</span>` : ''}</p>
    <div class="project-meta">Eingetragen am: ${formatDate(project.latestEntryDate)}</div>
  </a>`;
}

function nextTaskCard({ project, task }) {
  return overviewTaskCard(project, task);
}

function recentlyEditedProjectCard(project) {
  return `<a class="project-card overview-project-card" data-overview-card href="/#/projects/${encodeURIComponent(project.id)}">
    <span class="overview-card-kicker">Projekt</span>
    <div class="overview-project-heading"><span class="project-entity-icon overview-project-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><h3>${escapeHtml(project.title)}</h3></div>
    <p class="overview-project-description">${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p>
    <div class="project-meta">Zuletzt bearbeitet: ${escapeHtml(formatDateTime(project.lastActivityAt || project.updatedAt || project.createdAt))}</div>
  </a>`;
}

function overviewCompleteButton(project, task) {
  return `<button class="status-action complete-action overview-complete-action" type="button" data-overview-complete-task="${escapeHtml(task.id)}" data-overview-project="${escapeHtml(project.id)}" aria-label="${escapeHtml(task.title || 'Arbeitsschritt')} als erledigt loggen" title="Als erledigt loggen"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4.5 10.5 3.4 3.4 7.6-8"></path></svg></button>`;
}

async function finishCompletionTransition(cards, startedAt) {
  const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
  if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
  cards.forEach(card => card.classList.add('completion-removing'));
  await new Promise(resolve => setTimeout(resolve, 180));
}

function overviewTaskCard(project, task, extraClass = '', marked = false) {
  const title = task.title || 'Arbeitsschritt';
  const priority = task.priority || 'Normal';
  const priorityClass = priority.toLocaleLowerCase('de');
  const dueLabel = task.dueDate ? `Fällig am: ${formatDate(task.dueDate)}` : 'Fällig am: ohne';
  const projectUrl = `/#/projects/${encodeURIComponent(project.id)}`;
  const complete = mayEditProjects() ? overviewCompleteButton(project, task) : '';
  const marker = marked ? `<span class="project-flag-indicator overview-marked-flag" aria-label="Arbeitsschritt ist markiert" title="Arbeitsschritt ist markiert">${projectFlagIcon()}</span>` : '';
  return `<article class="project-card overview-task-card ${escapeHtml(extraClass)}${marked ? ' overview-marked-card' : ''}" data-overview-card>
    <div class="overview-card-topline"><span class="overview-card-kicker">Arbeitsschritt</span>${marker}</div>
    <a class="overview-project-heading overview-task-project" href="${projectUrl}"><span class="project-entity-icon overview-project-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><h3>${escapeHtml(project.title)}</h3></a>
    <div class="overview-task-step">${complete}<a class="overview-task-copy" href="${projectUrl}"><span class="overview-task-meta"><small>${escapeHtml(dueLabel)}</small>${marked ? '' : `<span class="project-priority task-priority ${escapeHtml(priorityClass)}">${escapeHtml(priority)}</span>`}</span><strong>${escapeHtml(title)}</strong></a></div>
  </article>`;
}

function dueBadge(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '<span class="overview-due upcoming">Ohne Fälligkeit</span>';
  const days = Math.round((new Date(`${date}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000);
  const stateClass = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming';
  const prefix = days < 0 ? 'Überfällig' : days === 0 ? 'Heute fällig' : days === 1 ? 'Morgen fällig' : 'Fällig';
  return `<span class="overview-due ${stateClass}">${prefix}${days > 1 || days < 0 ? `: ${formatDate(date)}` : ''}</span>`;
}

function overviewFocusCard({ project, task = null }, marked = false) {
  const isTask = Boolean(task);
  if (isTask) return overviewTaskCard(project, task, 'overview-focus-card', marked);
  const title = project.title;
  const description = project.description || 'Projekt ohne Beschreibung';
  const priority = projectPriority(project);
  const priorityClass = priority.toLocaleLowerCase('de');
  const marker = marked ? `<span class="project-flag-indicator overview-marked-flag" aria-label="Projekt ist markiert" title="Projekt ist markiert">${projectFlagIcon()}</span>` : '';
  const content = `<div class="overview-card-topline"><span class="overview-card-kicker">Projekt</span><span class="overview-card-top-meta">${dueBadge(project.dueDate)}${marked ? '' : `<span class="project-priority ${escapeHtml(priorityClass)}">${escapeHtml(priority)}</span>`}${marker}</span></div>
      <div class="overview-project-heading"><span class="project-entity-icon overview-project-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><h3>${escapeHtml(title)}</h3></div>
      <p class="overview-project-description">${escapeHtml(description)}</p>`;
  return `<a class="project-card overview-focus-card${marked ? ' overview-marked-card' : ''}" data-overview-card href="/#/projects/${encodeURIComponent(project.id)}">${content}</a>`;
}

function activityView(entries) {
  const counts = new Map();
  const titles = new Map();
  for (const entry of entries) if (/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) {
    counts.set(entry.date, (counts.get(entry.date) || 0) + 1);
    if (!titles.has(entry.date)) titles.set(entry.date, []);
    titles.get(entry.date).push(`${entry.projectTitle ? `${entry.projectTitle}, ` : ''}${entryTitle(entry)}`);
  }
  const end = new Date(`${today()}T12:00:00`);
  const longDateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle:'long' });
  const shortMonthFormatter = new Intl.DateTimeFormat('de-DE', { month:'short' });
  const periodStart = new Date(end); periodStart.setDate(periodStart.getDate() - 2239);
  const gridStart = new Date(periodStart); gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
  const gridEnd = new Date(end); gridEnd.setDate(gridEnd.getDate() + ((7 - gridEnd.getDay()) % 7));
  const days = [];
  for (const date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    const count = counts.get(key) || 0;
    const withinPeriod = date >= periodStart && date <= end;
    const level = !withinPeriod || !count ? 0 : count >= 4 ? 4 : count;
    days.push({ key, count:withinPeriod ? count : 0, level, label:longDateFormatter.format(date), titles:withinPeriod ? titles.get(key) || [] : [] });
  }
  const weeks = Math.ceil(days.length / 7);
  const monthLabels = Array.from({ length:weeks }, (_, week) => {
    const dates = days.slice(week * 7, week * 7 + 7);
    const transition = dates.find((day, index) => week === 0 && index === 0 || day.key.slice(0, 7) !== days[week * 7 + index - 1]?.key?.slice(0, 7));
    return transition ? shortMonthFormatter.format(new Date(`${transition.key}T12:00:00`)) : '';
  });
  const yearMarkers = Array.from({ length:weeks }, (_, week) => {
    const newYear = days.slice(week * 7, week * 7 + 7).find(day => day.key.endsWith('-01-01'));
    return newYear && week > 0 ? { week, year:newYear.key.slice(0, 4) } : null;
  }).filter(Boolean);
  const yearsByWeek = new Map(yearMarkers.map(marker => [marker.week, marker.year]));
  const initialStart = new Date(end); initialStart.setDate(initialStart.getDate() - 364);
  const total = [...counts].filter(([date]) => date >= initialStart.toISOString().slice(0, 10) && date <= today()).reduce((sum, [, count]) => sum + count, 0);
  const weekMarkup = Array.from({ length:weeks }, (_, week) => {
    const year = yearsByWeek.get(week);
    const weekDays = days.slice(week * 7, week * 7 + 7);
    return `<div class="activity-week${year ? ' year-start' : ''}" data-week="${week}"${year ? ` data-year="${year}"` : ''}>${year ? `<span class="activity-year-line" aria-hidden="true"></span><b class="activity-year-label">${year}</b>` : ''}${monthLabels[week] ? `<span class="activity-month-label">${escapeHtml(monthLabels[week])}</span>` : ''}<div class="activity-week-days">${weekDays.map(day => {
      const detail = `${day.label}: ${day.count} ${day.count === 1 ? 'Log' : 'Logs'}${day.titles.length ? `\n${day.titles.map(title => `• ${title}`).join('\n')}` : ''}`;
      return `<span class="activity-day" data-date="${day.key}" data-count="${day.count}" data-level="${day.level}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}"></span>`;
    }).join('')}</div></div>`;
  }).join('');
  return `<section class="activity-section overview-section"><div class="section-head"><h2>Aktivität</h2><span class="activity-total" data-activity-total><b>${total}</b> ${total === 1 ? 'Log' : 'Logs'} in den letzten 12 Monaten</span></div><div class="activity-card"><div class="activity-chart"><div class="activity-weekdays"><span>Mo</span><span></span><span>Mi</span><span></span><span>Fr</span><span></span><span>So</span></div><div class="activity-plot"><div class="activity-grid-clip"><div class="activity-weeks">${weekMarkup}</div></div></div></div><div class="activity-legend"><span>Weniger</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>Mehr</span></div></div></section>`;
}

function bindActivitySummary() {
  state.activityObserver?.disconnect();
  const container = $('.activity-plot');
  const grid = $('.activity-weeks');
  const gridClip = $('.activity-grid-clip');
  const summary = $('[data-activity-total]');
  const days = [...document.querySelectorAll('.activity-day')];
  const weeks = [...document.querySelectorAll('.activity-week')];
  if (!container || !grid || !gridClip || !summary || !weeks.length || days.length < 8) return;
  const update = () => {
    const lastWeek = weeks.at(-1);
    const rightEdge = lastWeek.offsetLeft + lastWeek.offsetWidth;
    let firstVisibleWeek = weeks.length - 1;
    for (let index = weeks.length - 1; index >= 0; index--) {
      const margin = Number.parseFloat(getComputedStyle(weeks[index]).marginLeft) || 0;
      const requiredWidth = rightEdge - weeks[index].offsetLeft + margin;
      if (requiredWidth > container.clientWidth) break;
      firstVisibleWeek = index;
    }
    const firstMargin = Number.parseFloat(getComputedStyle(weeks[firstVisibleWeek]).marginLeft) || 0;
    const clipWidth = Math.max(10, rightEdge - weeks[firstVisibleWeek].offsetLeft + firstMargin);
    gridClip.style.width = `${clipWidth}px`;
    const visibleWeeks = weeks.length - firstVisibleWeek;
    weeks.forEach((week, index) => {
      const visible = index >= firstVisibleWeek;
      week.querySelectorAll('.activity-year-label,.activity-year-line').forEach(marker => marker.hidden = !visible);
    });
    const clipRect = gridClip.getBoundingClientRect();
    grid.querySelectorAll('.activity-month-label').forEach(label => {
      label.hidden = false;
      const rect = label.getBoundingClientRect();
      label.hidden = rect.left < clipRect.left || rect.right > clipRect.right;
    });
    grid.querySelectorAll('.activity-year-label').forEach(label => {
      if (label.hidden) return;
      const rect = label.getBoundingClientRect();
      label.hidden = rect.left < clipRect.left || rect.right > clipRect.right;
    });
    const visibleDays = weeks.slice(firstVisibleWeek).flatMap(week => [...week.querySelectorAll('.activity-day')]);
    const logCount = visibleDays.reduce((sum, day) => sum + Number(day.dataset.count || 0), 0);
    const visibleMonths = Math.max(12, Math.round(visibleWeeks * 7 / 30.44));
    const period = visibleWeeks >= 52 ? `in den letzten ${visibleMonths} Monaten` : `in den letzten ${visibleWeeks} Wochen`;
    summary.innerHTML = `<b>${logCount}</b> ${logCount === 1 ? 'Log' : 'Logs'} ${period}`;
  };
  state.activityObserver = new ResizeObserver(update);
  state.activityObserver.observe(container);
  requestAnimationFrame(update);
}

function projectTimelineView(projects) {
  if (!projects.length) return '';
  const todayValue = today();
  const end = new Date(`${todayValue}T12:00:00`);
  const shortMonthFormatter = new Intl.DateTimeFormat('de-DE', { month:'short' });
  const periodStart = new Date(end); periodStart.setDate(periodStart.getDate() - 2239);
  const gridStart = new Date(periodStart); gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
  const gridEnd = new Date(end); gridEnd.setDate(gridEnd.getDate() + ((7 - gridEnd.getDay()) % 7));
  const days = [];
  for (const date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) days.push(date.toISOString().slice(0, 10));
  const weekCount = Math.ceil(days.length / 7);
  const weeks = Array.from({ length:weekCount }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const weekByDay = new Map();
  weeks.forEach((week, weekIndex) => week.forEach(day => weekByDay.set(day, weekIndex)));
  const monthLabels = weeks.map((week, weekIndex) => {
    const transition = week.find((day, dayIndex) => weekIndex === 0 && dayIndex === 0 || day.slice(0, 7) !== days[weekIndex * 7 + dayIndex - 1]?.slice(0, 7));
    return transition ? shortMonthFormatter.format(new Date(`${transition}T12:00:00`)) : '';
  });
  const years = new Map();
  weeks.forEach((week, index) => { const newYear = week.find(day => day.endsWith('-01-01')); if (newYear && index > 0) years.set(index, newYear.slice(0, 4)); });
  const headerWeeks = weeks.map((week, index) => `<span class="project-time-week${years.has(index) ? ' year-start' : ''}" data-week="${index}">${years.has(index) ? `<i class="project-time-year-line"></i><b class="project-time-year">${years.get(index)}</b>` : ''}${monthLabels[index] ? `<em class="project-time-month">${escapeHtml(monthLabels[index])}</em>` : ''}</span>`).join('');
  const rows = projects.map(project => {
    const createdAt = /^\d{4}-\d{2}-\d{2}/.test(project.createdAt || '') ? String(project.createdAt).slice(0, 10) : (project.entries || []).map(entry => entry.date).filter(Boolean).sort()[0] || todayValue;
    const logCounts = new Map();
    const entriesByWeek = new Map();
    for (const entry of project.entries || []) if (/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) {
      logCounts.set(entry.date, (logCounts.get(entry.date) || 0) + 1);
      const weekIndex = weekByDay.get(entry.date);
      if (weekIndex !== undefined) {
        if (!entriesByWeek.has(weekIndex)) entriesByWeek.set(weekIndex, []);
        entriesByWeek.get(weekIndex).push(entry);
      }
    }
    const cells = weeks.map((week, index) => {
      const logs = week.reduce((sum, day) => sum + (logCounts.get(day) || 0), 0);
      const weekEntries = (entriesByWeek.get(index) || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const running = week.at(-1) >= createdAt && week[0] <= todayValue;
      const runningStart = running && week[0] <= createdAt && week.at(-1) >= createdAt;
      const runningEnd = running && week[0] <= todayValue && week.at(-1) >= todayValue;
      const level = !logs ? 0 : logs >= 4 ? 4 : logs;
      const title = `${formatDate(week[0])}–${formatDate(week.at(-1))}: ${logs} ${logs === 1 ? 'Log' : 'Logs'}${weekEntries.length ? `\n${weekEntries.map(entry => `• ${formatDate(entry.date)}: ${project.title}, ${entryTitle(entry)}`).join('\n')}` : ''}`;
      return `<span class="project-time-week project-time-cell${years.has(index) ? ' year-start' : ''}${running ? ' running' : ''}${runningStart ? ' running-start' : ''}${runningEnd ? ' running-end' : ''}" data-week="${index}" data-level="${level}" title="${escapeHtml(title)}">${years.has(index) ? '<i class="project-time-year-line"></i>' : ''}</span>`;
    }).join('');
    return `<a class="project-timeline-row" href="/#/projects/${encodeURIComponent(project.id)}"><div class="project-timeline-label"><strong>${escapeHtml(project.title)}</strong></div><div class="project-timeline-plot"><div class="project-timeline-clip" data-project-timeline-clip><div class="project-time-weeks">${cells}</div></div></div></a>`;
  }).join('');
  return `<section class="project-timeline-section overview-section"><div class="section-head"><h2>Projekt-Timeline</h2><span class="activity-total"><b>${projects.length}</b> ${projects.length === 1 ? 'aktives Projekt' : 'aktive Projekte'}</span></div><div class="project-timeline-card"><div class="project-timeline-scale"><div class="project-timeline-label project-timeline-label-head">Projekt</div><div class="project-timeline-plot"><div class="project-timeline-clip" data-project-timeline-clip><div class="project-time-weeks project-time-header">${headerWeeks}</div></div></div></div><div class="project-timeline-rows">${rows}</div></div></section>`;
}

function bindProjectTimeline() {
  state.timelineObserver?.disconnect();
  const container = $('.project-timeline-plot');
  const header = $('.project-time-header');
  const weeks = [...header?.querySelectorAll('.project-time-week') || []];
  const clips = [...document.querySelectorAll('[data-project-timeline-clip]')];
  if (!container || !header || !weeks.length || !clips.length) return;
  const update = () => {
    const lastWeek = weeks.at(-1);
    const rightEdge = lastWeek.offsetLeft + lastWeek.offsetWidth;
    let firstVisibleWeek = weeks.length - 1;
    for (let index = weeks.length - 1; index >= 0; index--) {
      const margin = Number.parseFloat(getComputedStyle(weeks[index]).marginLeft) || 0;
      const requiredWidth = rightEdge - weeks[index].offsetLeft + margin;
      if (requiredWidth > container.clientWidth) break;
      firstVisibleWeek = index;
    }
    const firstMargin = Number.parseFloat(getComputedStyle(weeks[firstVisibleWeek]).marginLeft) || 0;
    const clipWidth = Math.max(10, rightEdge - weeks[firstVisibleWeek].offsetLeft + firstMargin);
    clips.forEach(clip => clip.style.width = `${clipWidth}px`);
    const headerClip = clips[0].getBoundingClientRect();
    header.querySelectorAll('.project-time-month,.project-time-year').forEach(label => {
      label.hidden = false;
      const rect = label.getBoundingClientRect();
      label.hidden = rect.left < headerClip.left || rect.right > headerClip.right;
    });
  };
  state.timelineObserver = new ResizeObserver(update);
  state.timelineObserver.observe(container);
  requestAnimationFrame(update);
}

const defaultOverviewOrder = ['summary','recentlyEdited','marked','dueSoon','highPriority','next','recent','activity','timeline'];
const overviewSectionConfig = {
  summary:{ label:'Statistik', flag:'showOverviewSummary' },
  recentlyEdited:{ label:'Zuletzt bearbeitete Projekte', flag:'showOverviewRecentlyEdited', rows:'overviewRecentlyEditedRows', fallbackRows:1 },
  marked:{ label:'Markiert', flag:'showOverviewMarked', rows:'overviewMarkedRows', fallbackRows:1 },
  dueSoon:{ label:'Demnächst fällig', flag:'showOverviewDueSoon', rows:'overviewDueSoonRows', fallbackRows:2 },
  highPriority:{ label:'Hohe Priorität', flag:'showOverviewHighPriority', rows:'overviewHighPriorityRows', fallbackRows:2 },
  next:{ label:'Nächste Arbeitsschritte', flag:'showOverviewNext', rows:'overviewNextRows', fallbackRows:2 },
  recent:{ label:'Letzte Arbeitsschritte', flag:'showOverviewRecent', rows:'overviewRecentRows', fallbackRows:2 },
  activity:{ label:'Aktivität', flag:'showOverviewActivity' },
  timeline:{ label:'Projekt-Timeline', flag:'showOverviewTimeline' }
};
function currentOverviewOrder() {
  const stored = Array.isArray(state.user?.overviewOrder) ? state.user.overviewOrder.filter(section => defaultOverviewOrder.includes(section)) : [];
  return [...new Set([...stored, ...defaultOverviewOrder])];
}
const overviewOrderHandle = label => `<button class="drag-handle overview-order-handle" type="button" data-reorder-handle aria-label="${escapeHtml(label)} verschieben" title="Ziehen, um die Reihenfolge zu ändern"><svg viewBox="0 0 16 20" aria-hidden="true"><circle cx="5" cy="4" r="1.25"></circle><circle cx="11" cy="4" r="1.25"></circle><circle cx="5" cy="10" r="1.25"></circle><circle cx="11" cy="10" r="1.25"></circle><circle cx="5" cy="16" r="1.25"></circle><circle cx="11" cy="16" r="1.25"></circle></svg></button>`;

function overviewMenuContent(extraClass = '') {
  const checked = key => state.user[key] !== false ? ' checked' : '';
  const rowControl = (setting, label, selected) => `<details class="overview-row-select"><summary aria-label="Zeilen ${escapeHtml(label)}">${selected} ${selected === 1 ? 'Zeile' : 'Zeilen'}</summary><div class="overview-row-options" role="menu" aria-label="Zeilen ${escapeHtml(label)}">${Array.from({ length:6 }, (_, index) => index + 1).map(rows => `<button type="button" role="menuitemradio" aria-checked="${rows === selected ? 'true' : 'false'}" data-overview-row-setting="${setting}" data-overview-row-value="${rows}">${rows} ${rows === 1 ? 'Zeile' : 'Zeilen'}</button>`).join('')}</div></details>`;
  const rows = currentOverviewOrder().map(section => {
    const config = overviewSectionConfig[section];
    const select = config.rows ? rowControl(config.rows, config.label, Math.min(6, Math.max(1, Number(state.user[config.rows]) || config.fallbackRows))) : '';
    return `<div class="overview-config-row" data-reorder-card data-reorder-id="${section}"><label><input type="checkbox" data-overview-setting="${config.flag}"${checked(config.flag)}><span>${escapeHtml(config.label)}</span></label>${select}${overviewOrderHandle(config.label)}</div>`;
  }).join('');
  return `<details class="action-menu overview-config-menu${extraClass ? ` ${extraClass}` : ''}"><summary aria-label="Übersicht konfigurieren" title="Übersicht konfigurieren">${iconSvg('sliders-horizontal')}</summary><div class="action-menu-panel overview-config-panel"><strong>Übersicht konfigurieren</strong><div class="overview-config-list" data-reorder-list="overview">${rows}</div></div></details>`;
}

function bindOverviewPreferenceControls() {
  const savePreference = async (control, payload) => {
    control.disabled = true;
    try {
      const result = await api('/account/preferences', { method:'PATCH', body:JSON.stringify(payload) });
      Object.assign(state.user, result);
      toast('Übersicht angepasst');
      await renderHome(true);
    } catch (error) { toast(error.message); control.disabled = false; }
  };
  document.querySelectorAll('[data-overview-setting]').forEach(control => control.onchange = event => {
    const key = event.currentTarget.dataset.overviewSetting;
    const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : Number(event.currentTarget.value);
    savePreference(event.currentTarget, { [key]:value });
  });
  document.querySelectorAll('.overview-row-select').forEach(control => control.ontoggle = () => {
    if (!control.open) return;
    document.querySelectorAll('.overview-row-select[open]').forEach(other => { if (other !== control) other.open = false; });
  });
  document.querySelectorAll('[data-overview-row-setting]').forEach(button => button.onclick = () => {
    savePreference(button, { [button.dataset.overviewRowSetting]:Number(button.dataset.overviewRowValue) });
  });
}

function bindOverviewGridRows() {
  state.overviewGridObservers.forEach(observer => observer.disconnect());
  state.overviewGridObservers = [];
  document.querySelectorAll('[data-overview-grid]').forEach(grid => {
    const cards = [...grid.querySelectorAll('[data-overview-card]')];
    const rows = Math.min(6, Math.max(1, Number(grid.dataset.overviewRows) || 2));
    if (!cards.length) return;
    let lastWidth = -1;
    const update = force => {
      const width = Math.round(grid.getBoundingClientRect().width);
      if (!force && width === lastWidth) return;
      lastWidth = width;
      cards.forEach(card => card.classList.remove('hidden'));
      const firstTop = cards[0].offsetTop;
      const nextRowIndex = cards.findIndex(card => card.offsetTop !== firstTop);
      const columns = nextRowIndex === -1 ? cards.length : Math.max(1, nextRowIndex);
      const visibleCount = rows * columns;
      cards.forEach((card, index) => card.classList.toggle('hidden', index >= visibleCount));
    };
    const observer = new ResizeObserver(() => update(false));
    observer.observe(grid);
    state.overviewGridObservers.push(observer);
    requestAnimationFrame(() => update(true));
  });
}

function overviewStats(activeProjects, completedProjects) {
  const todayValue = today();
  const todayDate = new Date(`${todayValue}T12:00:00`);
  const fourWeeksAgo = new Date(todayDate); fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 27);
  const eightWeeksAgo = new Date(fourWeeksAgo); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 28);
  const yearAgo = new Date(todayDate); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const twoYearsAgo = new Date(yearAgo); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 1);
  const iso = date => date.toISOString().slice(0, 10);
  const completionDate = project => String(project.completedAt || '').slice(0, 10);
  const trend = (current, previous, enoughData = current + previous >= 2) => enoughData ? (current > previous ? 'up' : current < previous ? 'down' : 'steady') : null;
  const completed4Weeks = completedProjects.filter(project => completionDate(project) >= iso(fourWeeksAgo) && completionDate(project) <= todayValue).length;
  const completedPrevious4Weeks = completedProjects.filter(project => completionDate(project) >= iso(eightWeeksAgo) && completionDate(project) < iso(fourWeeksAgo)).length;
  const allEntries = activeProjects.flatMap(project => project.entries || []);
  const allTasks = activeProjects.flatMap(project => project.tasks || []);
  const openTasks = allTasks.filter(task => task.status !== 'Erledigt');
  const overdueTasks = openTasks.filter(task => /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || '') && task.dueDate < todayValue);
  const completedTasks = allTasks.filter(task => task.status === 'Erledigt');
  const taskCompletionRate = allTasks.length ? Math.round(completedTasks.length / allTasks.length * 100) : null;
  const inactiveProjects = activeProjects.filter(project => String(project.lastActivityAt || project.latestEntryDate || project.createdAt || '').slice(0, 10) < iso(fourWeeksAgo));
  const entries4Weeks = allEntries.filter(entry => entry.date >= iso(fourWeeksAgo) && entry.date <= todayValue).length;
  const entriesPrevious4Weeks = allEntries.filter(entry => entry.date >= iso(eightWeeksAgo) && entry.date < iso(fourWeeksAgo)).length;
  const activeDays = new Set(allEntries.map(entry => entry.date).filter(date => date >= iso(yearAgo) && date <= todayValue)).size;
  const activeDaysPreviousYear = new Set(allEntries.map(entry => entry.date).filter(date => date >= iso(twoYearsAgo) && date < iso(yearAgo))).size;
  const weekKey = value => {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return iso(date);
  };
  const activeWeeks = new Set(allEntries.map(entry => entry.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')).map(weekKey));
  const currentWeek = new Date(todayDate); currentWeek.setDate(currentWeek.getDate() - ((currentWeek.getDay() + 6) % 7));
  if (!activeWeeks.has(iso(currentWeek))) currentWeek.setDate(currentWeek.getDate() - 7);
  let weekStreak = 0;
  while (activeWeeks.has(iso(currentWeek))) { weekStreak += 1; currentWeek.setDate(currentWeek.getDate() - 7); }
  const projectDuration = project => {
    const start = String(project.createdAt || '').slice(0, 10);
    const end = completionDate(project);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
    return Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000);
  };
  const durations = completedProjects.map(projectDuration).filter(days => days !== null);
  const currentDurations = completedProjects.filter(project => completionDate(project) >= iso(yearAgo) && completionDate(project) <= todayValue).map(projectDuration).filter(days => days !== null);
  const previousDurations = completedProjects.filter(project => completionDate(project) >= iso(twoYearsAgo) && completionDate(project) < iso(yearAgo)).map(projectDuration).filter(days => days !== null);
  const averageDays = durations.length ? Math.round(durations.reduce((sum, days) => sum + days, 0) / durations.length) : null;
  const currentAverageDays = currentDurations.length ? Math.round(currentDurations.reduce((sum, days) => sum + days, 0) / currentDurations.length) : null;
  const previousAverageDays = previousDurations.length ? Math.round(previousDurations.reduce((sum, days) => sum + days, 0) / previousDurations.length) : null;
  const durationText = averageDays === null ? '–' : averageDays === 0 ? '0 Wochen' : averageDays < 7 ? '< 1 Woche' : `${Math.round(averageDays / 7)} Wochen`;
  return {
    completed4Weeks, entries4Weeks, allEntries, activeDays, weekStreak, averageDays, durationText, durationCount:durations.length,
    openTaskCount:openTasks.length, overdueTaskCount:overdueTasks.length, completedTaskCount:completedTasks.length,
    totalTaskCount:allTasks.length, taskCompletionRate, inactiveProjectCount:inactiveProjects.length,
    completedTrend:trend(completed4Weeks, completedPrevious4Weeks),
    entriesTrend:trend(entries4Weeks, entriesPrevious4Weeks),
    activeDaysTrend:trend(activeDays, activeDaysPreviousYear),
    durationTrend:currentAverageDays !== null && previousAverageDays !== null ? trend(currentAverageDays, previousAverageDays, currentDurations.length >= 2 && previousDurations.length >= 2) : null
  };
}

function trendMarkup(direction, comparison) {
  if (!direction) return '';
  const details = direction === 'up' ? ['↗', 'Tendenz steigend'] : direction === 'down' ? ['↘', 'Tendenz abnehmend'] : ['→', 'Tendenz gleichbleibend'];
  const label = `${details[1]}: ${comparison}`;
  return `<span class="stat-trend ${direction}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${details[0]}</span>`;
}

function statCard(id, title, value, subtitle, description, trend = '') {
  const tooltipId = `stat-info-${id}`;
  return `<div class="stat"><div class="stat-head"><span>${escapeHtml(title)}</span><span class="stat-info"><button type="button" aria-label="${escapeHtml(title)} erklären" aria-describedby="${tooltipId}">?</button><span class="stat-info-tooltip" id="${tooltipId}" role="tooltip">${escapeHtml(description)}</span></span></div><div class="stat-value"><b>${escapeHtml(value)}</b>${trend}</div><small>${escapeHtml(subtitle)}</small></div>`;
}

async function renderHome(keepMenuOpen = false) {
  const overview = await api('/overview');
  const showSummary = state.user.showOverviewSummary !== false;
  const showRecentlyEdited = state.user.showOverviewRecentlyEdited !== false;
  const showMarked = state.user.showOverviewMarked !== false;
  const showDueSoon = state.user.showOverviewDueSoon !== false;
  const showHighPriority = state.user.showOverviewHighPriority !== false;
  const showNext = state.user.showOverviewNext !== false;
  const showRecent = state.user.showOverviewRecent !== false;
  const showActivity = state.user.showOverviewActivity !== false;
  const showTimeline = state.user.showOverviewTimeline !== false;
  const recentRows = Math.min(6, Math.max(1, Number(state.user.overviewRecentRows) || 2));
  const nextRows = Math.min(6, Math.max(1, Number(state.user.overviewNextRows) || 2));
  const recentlyEditedRows = Math.min(6, Math.max(1, Number(state.user.overviewRecentlyEditedRows) || 1));
  const markedRows = Math.min(6, Math.max(1, Number(state.user.overviewMarkedRows) || 1));
  const dueSoonRows = Math.min(6, Math.max(1, Number(state.user.overviewDueSoonRows) || 2));
  const highPriorityRows = Math.min(6, Math.max(1, Number(state.user.overviewHighPriorityRows) || 2));
  const activeProjects = overview.projects || [];
  const completedProjects = overview.completedProjects || [];
  const stats = overviewStats(activeProjects, completedProjects);
  const recentProjects = activeProjects.filter(project => project.latestEntryId).sort((a, b) => String(b.latestEntryDate || '').localeCompare(String(a.latestEntryDate || '')));
  const recentlyEditedProjects = [...activeProjects].sort((a, b) => String(b.lastActivityAt || b.updatedAt || b.createdAt || '').localeCompare(String(a.lastActivityAt || a.updatedAt || a.createdAt || '')));
  const markedItems = activeProjects.flatMap(project => [
    ...(project.flagged === true ? [{ project }] : []),
    ...(project.tasks || []).filter(task => task.flagged === true && task.status !== 'Erledigt').map(task => ({ project, task })),
  ]);
  const detailProjects = showNext || showDueSoon || showHighPriority || showActivity || showTimeline ? activeProjects : [];
  const priorityOrder = { Hoch:0, Normal:1, Niedrig:2 };
  const nextTasks = detailProjects.flatMap(project => (project.tasks || []).filter(task => task.status !== 'Erledigt').map(task => ({ project, task }))).sort((left, right) => {
    const due = String(left.task.dueDate || '9999-12-31').localeCompare(String(right.task.dueDate || '9999-12-31'));
    if (due) return due;
    const priority = (priorityOrder[left.task.priority] ?? 1) - (priorityOrder[right.task.priority] ?? 1);
    if (priority) return priority;
    return String(left.project.title).localeCompare(String(right.project.title), 'de', { sensitivity:'base' }) || Number(left.task.sortOrder || 0) - Number(right.task.sortOrder || 0);
  });
  const dueSoonItems = detailProjects.flatMap(project => {
    const items = project.dueDate ? [{ project }] : [];
    return items.concat((project.tasks || []).filter(task => task.status !== 'Erledigt' && task.dueDate).map(task => ({ project, task })));
  }).sort((left, right) => {
    const leftDue = String(left.task?.dueDate || left.project.dueDate || '9999-12-31');
    const rightDue = String(right.task?.dueDate || right.project.dueDate || '9999-12-31');
    const due = leftDue.localeCompare(rightDue);
    if (due) return due;
    return String(left.task?.title || left.project.title).localeCompare(String(right.task?.title || right.project.title), 'de', { sensitivity:'base' });
  });
  const highPriorityItems = detailProjects.flatMap(project => {
    const items = projectPriority(project) === 'Hoch' ? [{ project }] : [];
    return items.concat((project.tasks || []).filter(task => task.status !== 'Erledigt' && task.priority === 'Hoch').map(task => ({ project, task })));
  }).sort((left, right) => {
    const leftDue = String(left.task?.dueDate || left.project.dueDate || '9999-12-31');
    const rightDue = String(right.task?.dueDate || right.project.dueDate || '9999-12-31');
    const due = leftDue.localeCompare(rightDue);
    if (due) return due;
    const leftPriority = left.task?.priority || projectPriority(left.project);
    const rightPriority = right.task?.priority || projectPriority(right.project);
    const priority = (priorityOrder[leftPriority] ?? 1) - (priorityOrder[rightPriority] ?? 1);
    if (priority) return priority;
    return String(left.task?.title || left.project.title).localeCompare(String(right.task?.title || right.project.title), 'de', { sensitivity:'base' });
  });
  const activityEntries = detailProjects.flatMap(project => (project.entries || []).map(entry => ({ ...entry, projectTitle:project.title })));
  const entries = stats.entries4Weeks;
  const sectionMarkup = {
    summary:showSummary ? `<section class="overview-work-section overview-section" aria-label="Statistik"><div class="section-head"><h2>Statistik</h2></div><div class="stats">${[
      statCard('active-projects', 'Aktive Projekte', activeProjects.length, 'aktuell in Arbeit', 'Gezählt werden alle Projekte mit dem Status „Aktiv“. Projektideen, pausierte, abgeschlossene, archivierte und gelöschte Projekte bleiben unberücksichtigt. Die Zahl zeigt, wie viele Vorhaben gleichzeitig Aufmerksamkeit benötigen.'),
      statCard('open-tasks', 'Offene Arbeitsschritte', stats.openTaskCount, 'in aktiven Projekten', 'Gezählt werden alle Arbeitsschritte in aktiven Projekten, deren Status nicht „Erledigt“ ist. Fälligkeit und Priorität spielen dabei keine Rolle. Die Zahl zeigt die Größe des aktuellen Arbeitsvorrats und kann auf zu viele gleichzeitig geplante Aufgaben hinweisen.'),
      statCard('overdue-tasks', 'Überfällige Arbeitsschritte', stats.overdueTaskCount, 'offen und vor heute fällig', 'Gezählt werden offene Arbeitsschritte in aktiven Projekten, deren Fälligkeitsdatum vor dem heutigen Tag liegt. Heute fällige Schritte gelten noch nicht als überfällig. Die Zahl macht sichtbar, wo Termine geprüft, neu geplant oder Arbeitsschritte abgeschlossen werden sollten.'),
      statCard('inactive-projects', 'Projekte ohne Aktivität', stats.inactiveProjectCount, 'seit mindestens 4 Wochen', 'Gezählt werden aktive Projekte, deren letzte gespeicherte Änderung länger als 4 Wochen zurückliegt. Dazu zählen Änderungen am Projekt und seinen Inhalten. Die Zahl hilft, festgefahrene Vorhaben zu entdecken und zu entscheiden, ob sie weitergeführt, pausiert oder abgeschlossen werden sollten.'),
      statCard('completed-projects', 'Abgeschlossene Projekte', stats.completed4Weeks, `in den letzten 4 Wochen · ${completedProjects.length} insgesamt`, 'Gezählt werden Projekte, deren Abschlussdatum innerhalb der letzten 28 Kalendertage einschließlich heute liegt. Die Gesamtzahl darunter umfasst alle abgeschlossenen Projekte. Der Pfeil vergleicht die letzten 4 Wochen mit den unmittelbar davorliegenden 4 Wochen und macht den Projektdurchsatz sichtbar.', trendMarkup(stats.completedTrend, '4 Wochen gegenüber den 4 Wochen davor')),
      statCard('task-completion-rate', 'Erledigungsquote', stats.taskCompletionRate === null ? '–' : `${stats.taskCompletionRate} %`, `${stats.completedTaskCount} von ${stats.totalTaskCount} Arbeitsschritten erledigt`, 'Die Quote teilt die Anzahl erledigter Arbeitsschritte durch alle Arbeitsschritte in aktiven Projekten und rundet das Ergebnis auf ganze Prozent. Sie bezieht sich auf den gesamten aktuellen Aufgabenbestand, nicht auf einen Zeitraum. Eine steigende Quote zeigt Fortschritt; neue geplante Schritte können sie sinnvollerweise wieder senken.'),
      statCard('documented-steps', 'Dokumentierte Arbeitsschritte', entries, 'in den letzten 4 Wochen', 'Gezählt werden Dokumentationseinträge in aktuell aktiven Projekten, deren Datum innerhalb der letzten 28 Kalendertage einschließlich heute liegt. Mehrere Einträge am selben Tag zählen jeweils einzeln. Der Pfeil vergleicht mit den 4 Wochen davor und zeigt, ob die Dokumentationsaktivität zu- oder abnimmt.', trendMarkup(stats.entriesTrend, '4 Wochen gegenüber den 4 Wochen davor')),
      statCard('active-days', 'Aktive Tage', stats.activeDays, 'in den letzten 12 Monaten', 'Ein Tag gilt als aktiv, sobald an diesem Datum mindestens ein Arbeitsschritt in einem aktuell aktiven Projekt dokumentiert wurde. Mehrere Einträge am selben Tag erhöhen den Wert nicht. Der Pfeil vergleicht die Anzahl unterschiedlicher aktiver Tage mit den vorherigen 12 Monaten und zeigt, wie regelmäßig dokumentiert wird.', trendMarkup(stats.activeDaysTrend, '12 Monate gegenüber den 12 Monaten davor')),
      statCard('week-streak', 'Wochenserie', stats.weekStreak, `${stats.weekStreak === 1 ? 'Woche' : 'Wochen'} mit Dokumentation`, 'Gezählt werden aufeinanderfolgende Kalenderwochen mit mindestens einem dokumentierten Arbeitsschritt in einem aktuell aktiven Projekt. Die Serie endet in der laufenden Woche oder – falls dort noch nichts dokumentiert wurde – in der unmittelbar vorherigen Woche. Sie macht eine beständige Dokumentationsroutine sichtbar.'),
      statCard('project-duration', 'Ø Projektdauer', stats.durationText, `${stats.durationCount} ${stats.durationCount === 1 ? 'abgeschlossenes Projekt' : 'abgeschlossene Projekte'}`, 'Für alle abgeschlossenen Projekte mit gültigem Erstellungs- und Abschlussdatum wird die Dauer in Tagen berechnet. Daraus entsteht das arithmetische Mittel, das auf ganze Wochen gerundet wird; Dauern unter einer Woche werden entsprechend ausgewiesen. Der Pfeil vergleicht Projekte der letzten 12 Monate mit denen der 12 Monate davor. Eine längere oder kürzere Dauer ist nicht automatisch besser, sondern hilft vor allem bei realistischeren Planungen.', trendMarkup(stats.durationTrend, 'Abschlüsse der letzten 12 Monate gegenüber dem Vorzeitraum'))
    ].join('')}</div></section>` : '',
    recentlyEdited:showRecentlyEdited ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Zuletzt bearbeitete Projekte</h2></div>${recentlyEditedProjects.length ? `<div class="project-grid" data-overview-grid data-overview-rows="${recentlyEditedRows}">${recentlyEditedProjects.map(recentlyEditedProjectCard).join('')}</div>` : `<div class="empty"><strong>Noch keine Projekte vorhanden.</strong>Lege ein Projekt an, um hier weiterzuarbeiten.</div>`}</section>` : '',
    marked:showMarked ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Markiert</h2></div>${markedItems.length ? `<div class="project-grid overview-marked-grid" data-overview-grid data-overview-rows="${markedRows}">${markedItems.map(item => overviewFocusCard(item, true)).join('')}</div>` : `<div class="empty"><strong>Noch nichts markiert.</strong>Markiere wichtige Projekte oder Arbeitsschritte mit dem Fähnchen.</div>`}</section>` : '',
    dueSoon:showDueSoon ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Demnächst fällig</h2></div>${dueSoonItems.length ? `<div class="project-grid" data-overview-grid data-overview-rows="${dueSoonRows}">${dueSoonItems.map(item => overviewFocusCard(item)).join('')}</div>` : `<div class="empty"><strong>Keine Fälligkeiten anstehend.</strong>Projekte und offene Arbeitsschritte mit Fälligkeit erscheinen hier.</div>`}</section>` : '',
    highPriority:showHighPriority ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Hohe Priorität</h2></div>${highPriorityItems.length ? `<div class="project-grid" data-overview-grid data-overview-rows="${highPriorityRows}">${highPriorityItems.map(item => overviewFocusCard(item)).join('')}</div>` : `<div class="empty"><strong>Nichts mit hoher Priorität.</strong>Projekte und offene Arbeitsschritte mit hoher Priorität erscheinen hier.</div>`}</section>` : '',
    next:showNext ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Nächste Arbeitsschritte</h2></div>${nextTasks.length ? `<div class="project-grid" data-overview-grid data-overview-rows="${nextRows}">${nextTasks.map(nextTaskCard).join('')}</div>` : `<div class="empty"><strong>Keine Arbeitsschritte geplant.</strong>Lege in einem Projekt den nächsten Arbeitsschritt an.</div>`}</section>` : '',
    recent:showRecent ? `<section class="overview-work-section overview-section"><div class="section-head"><h2>Letzte Arbeitsschritte</h2></div>${recentProjects.length ? `<div class="project-grid" data-overview-grid data-overview-rows="${recentRows}">${recentProjects.map(recentEntryCard).join('')}</div>` : `<div class="empty"><strong>Noch keine Arbeitsschritte vorhanden.</strong>Öffne ein Projekt und dokumentiere den ersten Arbeitsschritt.</div>`}</section>` : '',
    activity:showActivity ? activityView(activityEntries) : '',
    timeline:showTimeline ? projectTimelineView(detailProjects) : ''
  };
  const overviewHead = standardPageHeader({ title:'Übersicht', description:'Aktuelle Projekte, Termine und Aktivitäten im Blick.', iconMarkup:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5"></circle><path d="m8.2 12.2 2.5 2.5 5.4-5.6"></path></svg>', actions:overviewMenuContent('desktop-overview-config'), className:'overview-page-head' });
  $('#main').innerHTML = `${overviewHead}<section class="project-page-content overview-page-content">${currentOverviewOrder().map(section => sectionMarkup[section] || '').join('')}</section>`;
  $('#mobile-header-actions').innerHTML = overviewMenuContent('mobile-overview-config');
  document.querySelectorAll('[data-overview-complete-task]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const project = activeProjects.find(item => item.id === button.dataset.overviewProject);
    const task = project?.tasks?.find(item => item.id === button.dataset.overviewCompleteTask);
    if (!project || !task) return;
    const startedAt = Date.now();
    const matchingButtons = [...document.querySelectorAll('[data-overview-complete-task]')].filter(item => item.dataset.overviewProject === project.id && item.dataset.overviewCompleteTask === task.id);
    const cards = [...new Set(matchingButtons.map(item => item.closest('[data-overview-card]')).filter(Boolean))];
    matchingButtons.forEach(item => { item.disabled = true; });
    cards.forEach(card => card.classList.add('completion-pending'));
    try {
      await api(`/projects/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(task.id)}/complete`, { method:'POST', body:JSON.stringify({ date:today() }) });
      toast('Arbeitsschritt als erledigt geloggt');
      await finishCompletionTransition(cards, startedAt);
      await renderHome();
    } catch (error) {
      toast(error.message);
      matchingButtons.forEach(item => { item.disabled = false; });
      cards.forEach(card => card.classList.remove('completion-pending', 'completion-removing'));
    }
  });
  bindOverviewGridRows();
  if (showActivity) bindActivitySummary(); else state.activityObserver?.disconnect();
  if (showTimeline) bindProjectTimeline(); else state.timelineObserver?.disconnect();
  bindOverviewPreferenceControls();
  bindReordering();
  if (keepMenuOpen) document.querySelectorAll('.overview-config-menu').forEach(menu => { menu.open = true; });
}

const todoReorderHandle = id => `<button class="drag-handle todo-drag-handle" type="button" data-todo-drag-handle data-reorder-id="${escapeHtml(id)}" aria-label="Erinnerung verschieben" title="Ziehen, um zu sortieren oder unter einer anderen Erinnerung abzulegen"><svg viewBox="0 0 16 20" aria-hidden="true"><circle cx="5" cy="4" r="1.25"></circle><circle cx="11" cy="4" r="1.25"></circle><circle cx="5" cy="10" r="1.25"></circle><circle cx="11" cy="10" r="1.25"></circle><circle cx="5" cy="16" r="1.25"></circle><circle cx="11" cy="16" r="1.25"></circle></svg></button>`;

const todoRepeatIcon = () => '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.7 7A6.2 6.2 0 0 0 5.2 5.1L3.5 7"></path><path d="M3.5 3.8V7h3.2"></path><path d="M4.3 13a6.2 6.2 0 0 0 10.5 1.9l1.7-1.9"></path><path d="M16.5 16.2V13h-3.2"></path></svg>';
const todoRepeatLabel = todo => {
  const interval = Number(todo.repeatInterval) || 0;
  const singular = { day:'Jeden Tag', week:'Jede Woche', month:'Jeden Monat', year:'Jedes Jahr' }[todo.repeatUnit];
  if (interval === 1) return singular || '';
  const plural = { day:'Tage', week:'Wochen', month:'Monate', year:'Jahre' }[todo.repeatUnit] || '';
  return `Alle ${interval} ${plural}`;
};
const todoRepeatControls = todo => {
  const active = Number(todo.repeatInterval) > 0;
  const repeat = `<button class="edit-action todo-repeat-action${active ? ' active' : ''}" type="button" data-repeat-todo="${escapeHtml(todo.id)}" aria-label="Wiederholung ${active ? 'bearbeiten' : 'einstellen'}" title="Wiederholung ${active ? 'bearbeiten' : 'einstellen'}">${todoRepeatIcon()}</button>`;
  const remove = active ? `<button class="edit-action todo-repeat-remove" type="button" data-remove-todo-repeat="${escapeHtml(todo.id)}" aria-label="Wiederholung entfernen" title="Wiederholung entfernen">${todoRepeatIcon()}<span aria-hidden="true">×</span></button>` : '';
  return repeat + remove;
};
const todoProjectControl = todo => mayEditProjects() ? `<button class="edit-action todo-project-action" type="button" data-convert-todo="${escapeHtml(todo.id)}" aria-label="Erinnerung in Projekt umwandeln" title="In Projekt umwandeln">${iconSvg(defaultProjectIconName())}</button>` : '';

function todoRow(todo, completed = false, level = 'root', childState = null) {
  const editing = state.editingTodoId === todo.id;
  const editForm = `<form class="todo-edit-form" data-todo-edit-form="${escapeHtml(todo.id)}"><input name="title" maxlength="200" value="${escapeHtml(todo.title)}" aria-label="Erinnerung bearbeiten" required></form>`;
  const parent = todo.parentId ? state.todos.find(candidate => candidate.id === todo.parentId) : null;
  const recurring = Number(todo.repeatInterval) > 0;
  const scheduled = completed && recurring && Boolean(todo.repeatDueAt);
  const meta = [];
  if (parent && completed) meta.push(`Untergeordnet zu ${escapeHtml(parent.title)}`);
  if (scheduled) meta.push(`Wieder offen ${escapeHtml(formatDateTime(todo.repeatDueAt))}`);
  else if (completed) meta.push(`Erledigt ${escapeHtml(formatDateTime(todo.completedAt))}`);
  if (recurring) meta.push(todoRepeatLabel(todo));
  const todoMeta = meta.length ? `<small class="${recurring ? 'todo-repeat-meta' : ''}">${meta.join(' · ')}</small>` : '';
  const childToggle = childState ? `<button class="todo-children-toggle" type="button" data-toggle-todo-children="${escapeHtml(todo.id)}" aria-expanded="${!childState.collapsed}" aria-controls="todo-children-${escapeHtml(todo.id)}" aria-label="${childState.count} untergeordnete Erinnerung${childState.count === 1 ? '' : 'en'} ${childState.collapsed ? 'ausklappen' : 'einklappen'}" title="${childState.collapsed ? 'Untergeordnete Erinnerungen ausklappen' : 'Untergeordnete Erinnerungen einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><span>${childState.count}</span></button>` : '';
  return `<article class="todo-item${completed ? ' completed' : ''}" data-todo-id="${escapeHtml(todo.id)}" data-todo-level="${level}">
    <label class="todo-check"><input type="checkbox" data-toggle-todo="${escapeHtml(todo.id)}"${completed ? ' checked' : ''}><span aria-hidden="true"></span><span class="visually-hidden">${completed ? 'Erinnerung wieder öffnen' : 'Erinnerung erledigen'}</span></label>
    <div class="todo-copy">${editing ? editForm : `<span class="todo-title">${escapeHtml(todo.title)}</span>${todoMeta}`}</div>
    <div class="todo-actions">${editing ? '' : childToggle}${completed || editing ? '' : todoReorderHandle(todo.id)}${editing ? '' : todoRepeatControls(todo)}${editing ? '' : todoProjectControl(todo)}${editing ? '' : `<button class="edit-action delete-action" type="button" data-delete-todo="${escapeHtml(todo.id)}" aria-label="Erinnerung löschen" title="Erinnerung löschen">${trashIcon()}</button>`}</div>
  </article>`;
}

function openTodoTree(todos) {
  const ids = new Set(todos.map(todo => todo.id));
  const roots = todos.filter(todo => !todo.parentId || !ids.has(todo.parentId));
  const children = new Map();
  todos.forEach(todo => {
    if (!todo.parentId || !ids.has(todo.parentId)) return;
    if (!children.has(todo.parentId)) children.set(todo.parentId, []);
    children.get(todo.parentId).push(todo);
  });
  return roots.map(todo => {
    const childTodos = children.get(todo.id) || [];
    const childRows = childTodos.map(child => `<div class="todo-node todo-subitem" data-todo-node data-todo-node-id="${escapeHtml(child.id)}">${todoRow(child, Boolean(child.completedAt), 'child')}</div>`).join('');
    const collapsed = childTodos.length > 0 && state.collapsedTodoGroups[todo.id] === true;
    return `<div class="todo-node todo-group${childRows ? ' has-children' : ''}${collapsed ? ' children-collapsed' : ''}" data-todo-node data-todo-node-id="${escapeHtml(todo.id)}">${todoRow(todo, Boolean(todo.completedAt), 'root', childTodos.length ? { count:childTodos.length, collapsed } : null)}<div class="todo-children" id="todo-children-${escapeHtml(todo.id)}" data-todo-children="${escapeHtml(todo.id)}">${childRows}<div class="todo-child-dropzone" data-todo-child-dropzone="${escapeHtml(todo.id)}"><span>Hier als untergeordnete Erinnerung ablegen</span></div></div></div>`;
  }).join('');
}

function openTodoRepeatDialog(todo) {
  const form = $('#todo-repeat-form');
  form.reset();
  form.elements.todoId.value = todo.id;
  form.elements.interval.value = Number(todo.repeatInterval) > 0 ? String(todo.repeatInterval) : '1';
  form.elements.unit.value = todo.repeatUnit || 'day';
  $('#todo-repeat-title').textContent = todo.title;
  $('#todo-repeat-delete-zone').hidden = !(Number(todo.repeatInterval) > 0);
  showFormDialog($('#todo-repeat-dialog'));
}

async function renderTodos() {
  if (state.todoRepeatTimer) clearTimeout(state.todoRepeatTimer);
  state.todoRepeatTimer = null;
  await Promise.all([loadTodos(), loadIconLibrary().catch(() => null)]);
  const clearedRootIds = new Set(state.todos.filter(todo => !todo.parentId && todo.clearedAt).map(todo => todo.id));
  const isCleared = todo => clearedRootIds.has(todo.parentId || todo.id);
  const open = state.todos.filter(todo => !isCleared(todo));
  const completed = state.todos.filter(isCleared);
  const cleanupCount = open.filter(todo => !todo.parentId && todo.completedAt)
    .filter(parent => open.filter(todo => todo.parentId === parent.id).every(child => Boolean(child.completedAt))).length;
  const completedRootCount = completed.filter(todo => !todo.parentId || !clearedRootIds.has(todo.parentId)).length;
  const completedRoots = completed.filter(todo => !todo.parentId || !clearedRootIds.has(todo.parentId));
  const deletableCompletedCount = completedRoots.filter(root => !root.repeatInterval && !completed.some(todo => todo.parentId === root.id && todo.repeatInterval)).length;
  const protectedCompletedCount = completedRootCount - deletableCompletedCount;
  const deleteCompletedTitle = protectedCompletedCount ? `${protectedCompletedCount} wiederkehrende Erinnerung${protectedCompletedCount === 1 ? '' : 'en'} bleibt erhalten` : 'Erledigte Erinnerungen löschen';
  const todoSectionToggle = (section, label, count, expanded) => `<button class="todo-section-toggle" type="button" data-toggle-todo-section="${section}" aria-expanded="${expanded}" aria-label="${label} Erinnerungen ${expanded ? 'einklappen' : 'ausklappen'}" title="${expanded ? 'Einklappen' : 'Ausklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><strong>${label} (${count})</strong></button>`;
  const completedSection = completed.length ? `<section class="todo-completed-section"><div class="section-head todo-section-head"><div class="project-status-divider log-section-divider todo-section-divider">${todoSectionToggle('completed', 'Erledigt', completedRootCount, state.todosCompletedOpen)}</div><div class="section-head-actions"><button class="button secondary compact todo-section-action" type="button" data-delete-completed-todos title="${deleteCompletedTitle}"${deletableCompletedCount ? '' : ' disabled'}>Erledigte löschen</button></div></div><div class="todo-list completed-todo-list" data-todo-section-content="completed"${state.todosCompletedOpen ? '' : ' hidden'}>${openTodoTree(completed)}</div></section>` : '';
  const openContent = open.length ? `<div class="todo-list todo-tree" data-todo-tree>${openTodoTree(open)}</div>` : '<div class="empty todo-empty"><strong>Alles aufgeräumt.</strong>Neue kurze Erinnerungen kannst du oben eintragen.</div>';
  const todoHead = standardPageHeader({ title:'Erinnerungen', description:'Persönliche Hinweise ohne direkten Projektbezug.', iconMarkup:'<svg viewBox="0 0 24 24" fill="none"><path d="M9 6h11M9 12h11M9 18h11"></path><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"></path></svg>', className:'todo-page-head' });
  $('#main').innerHTML = `${todoHead}
    <section class="project-page-content todo-page-content"><form class="todo-add-form" id="todo-add-form"><input name="title" maxlength="200" placeholder="Notiere dir hier wichtige Dinge, die keinen Projektbezug haben." aria-label="Neue Erinnerung" autocomplete="off" required><button class="button primary" type="submit">Hinzufügen</button></form>
    <section class="todo-open-section"><div class="section-head todo-section-head"><div class="project-status-divider log-section-divider todo-section-divider">${todoSectionToggle('open', 'Offen', open.length, state.todosOpenOpen)}</div><div class="section-head-actions"><button class="button secondary compact todo-section-action" type="button" data-cleanup-todos${cleanupCount ? '' : ' disabled'}>Aufräumen</button></div></div><div data-todo-section-content="open"${state.todosOpenOpen ? '' : ' hidden'}>${openContent}</div></section>${completedSection}</section>`;

  const nextRepeat = state.todos.map(todo => Date.parse(todo.repeatDueAt || '')).filter(value => Number.isFinite(value) && value > Date.now()).sort((a,b) => a - b)[0];
  if (nextRepeat) state.todoRepeatTimer = setTimeout(() => {
    state.todoRepeatTimer = null;
    if (location.hash.startsWith('#/todos')) renderTodos();
  }, Math.min(2147483000, Math.max(1000, nextRepeat - Date.now() + 250)));

  $('#todo-add-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.elements.title.value.trim();
    if (!title) return form.elements.title.focus();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/todos', { method:'POST', body:JSON.stringify({ title }) });
      form.reset();
      await renderTodos();
      $('#todo-add-form input')?.focus();
    } catch (error) { toast(error.message); submit.disabled = false; }
  };
  document.querySelectorAll('[data-toggle-todo]').forEach(input => input.onchange = async () => {
    input.disabled = true;
    try {
      await api(`/todos/${encodeURIComponent(input.dataset.toggleTodo)}`, { method:'PATCH', body:JSON.stringify({ completed:input.checked }) });
      toast(input.checked ? 'Erinnerung erledigt' : 'Erinnerung wieder geöffnet');
      await renderTodos();
    } catch (error) { toast(error.message); input.checked = !input.checked; input.disabled = false; }
  });
  document.querySelectorAll('[data-toggle-todo-children]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const id = button.dataset.toggleTodoChildren;
    const collapsed = state.collapsedTodoGroups[id] !== true;
    state.collapsedTodoGroups[id] = collapsed;
    const group = button.closest('[data-todo-node].todo-group');
    group?.classList.toggle('children-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    const count = group?.querySelectorAll(':scope > [data-todo-children] > [data-todo-node]').length || 0;
    button.setAttribute('aria-label', `${count} untergeordnete Erinnerung${count === 1 ? '' : 'en'} ${collapsed ? 'ausklappen' : 'einklappen'}`);
    button.title = collapsed ? 'Untergeordnete Erinnerungen ausklappen' : 'Untergeordnete Erinnerungen einklappen';
  });
  document.querySelectorAll('[data-repeat-todo]').forEach(button => button.onclick = () => {
    const todo = state.todos.find(item => item.id === button.dataset.repeatTodo);
    if (todo) openTodoRepeatDialog(todo);
  });
  document.querySelectorAll('[data-remove-todo-repeat]').forEach(button => button.onclick = async () => {
    const todo = state.todos.find(item => item.id === button.dataset.removeTodoRepeat);
    if (!todo) return;
    button.disabled = true;
    try {
      await api(`/todos/${encodeURIComponent(todo.id)}`, { method:'PATCH', body:JSON.stringify({ recurrence:null }) });
      toast('Wiederholung entfernt');
      await renderTodos();
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-convert-todo]').forEach(button => button.onclick = async () => {
    const todo = state.todos.find(item => item.id === button.dataset.convertTodo);
    if (!todo) return;
    const childCount = state.todos.filter(item => item.parentId === todo.id).length;
    const childHint = childCount
      ? ` ${childCount} untergeordnete Erinnerung${childCount === 1 ? ' wird' : 'en werden'} als anstehende Einträge übernommen.`
      : '';
    if (!await confirmAction(`Erinnerung „${todo.title}“ in ein neues Projekt umwandeln? Die Erinnerung wird anschließend gelöscht.${childHint}`, { title:'In Projekt umwandeln', confirmLabel:'Umwandeln' })) return;
    button.disabled = true;
    try {
      const result = await api(`/todos/${encodeURIComponent(todo.id)}/convert-to-project`, { method:'POST', body:'{}' });
      rememberProject(result.project);
      delete state.collapsedTodoGroups[todo.id];
      toast(childCount ? `Projekt mit ${childCount} anstehenden Einträgen angelegt` : 'Projekt angelegt');
      location.href = `/#/projects/${encodeURIComponent(result.project.id)}`;
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-todo-id]').forEach(row => row.onclick = event => {
    if (state.editingTodoId || event.target.closest('button,input,label,form')) return;
    state.editingTodoId = row.dataset.todoId;
    renderTodos().then(() => document.querySelector('[data-todo-edit-form] input')?.select());
  });
  const saveTodoEdit = async form => {
    if (form.dataset.editState) return;
    const title = form.elements.title.value.trim();
    if (!title) return form.elements.title.focus();
    form.dataset.editState = 'saving';
    const id = form.dataset.todoEditForm;
    state.editingTodoId = null;
    const localTodo = state.todos.find(todo => todo.id === id);
    if (localTodo) localTodo.title = title;
    const titleNode = document.createElement('span');
    titleNode.className = 'todo-title';
    titleNode.textContent = title;
    form.replaceWith(titleNode);
    try {
      const saved = await api(`/todos/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ title }) });
      const index = state.todos.findIndex(todo => todo.id === id);
      if (index >= 0) state.todos[index] = saved;
      toast('Erinnerung aktualisiert');
      if (!state.editingTodoId) await renderTodos();
    } catch (error) {
      toast(error.message);
      state.editingTodoId = id;
      await renderTodos();
      document.querySelector('[data-todo-edit-form] input')?.select();
    }
  };
  document.querySelectorAll('[data-todo-edit-form]').forEach(form => {
    form.onsubmit = event => { event.preventDefault(); saveTodoEdit(form); };
    const input = form.elements.title;
    input.onblur = () => saveTodoEdit(form);
    input.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveTodoEdit(form);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        form.dataset.editState = 'cancelled';
        state.editingTodoId = null;
        renderTodos();
      }
    };
  });
  $('#main').onclick = event => {
    const form = $('[data-todo-edit-form]');
    if (form && !form.contains(event.target)) saveTodoEdit(form);
  };
  document.querySelectorAll('[data-delete-todo]').forEach(button => button.onclick = async () => {
    const todo = state.todos.find(item => item.id === button.dataset.deleteTodo);
    const childCount = state.todos.filter(item => item.parentId === todo?.id).length;
    const question = childCount ? `Erinnerung „${todo.title}“ und ${childCount} untergeordnete Erinnerung${childCount === 1 ? '' : 'en'} löschen?` : `Erinnerung „${todo?.title || ''}“ löschen?`;
    if (!todo || !await confirmAction(question, { title:'Erinnerung löschen', confirmLabel:'Löschen' })) return;
    try { await api(`/todos/${encodeURIComponent(todo.id)}`, { method:'DELETE' }); toast('Erinnerung gelöscht'); await renderTodos(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-toggle-todo-section]').forEach(button => button.onclick = () => {
    if (button.dataset.toggleTodoSection === 'open') state.todosOpenOpen = !state.todosOpenOpen;
    else state.todosCompletedOpen = !state.todosCompletedOpen;
    renderTodos();
  });
  const cleanup = $('[data-cleanup-todos]');
  if (cleanup) cleanup.onclick = async () => {
    cleanup.disabled = true;
    try {
      const result = await api('/todos/cleanup', { method:'POST', body:'{}' });
      toast(result.cleared ? `${result.cleared} Erinnerung${result.cleared === 1 ? '' : 'en'} aufgeräumt` : 'Nichts aufzuräumen');
      await renderTodos();
    } catch (error) { toast(error.message); cleanup.disabled = false; }
  };
  const deleteCompleted = $('[data-delete-completed-todos]');
  if (deleteCompleted) deleteCompleted.onclick = async () => {
    const protectionHint = protectedCompletedCount ? ` ${protectedCompletedCount} wiederkehrende Erinnerung${protectedCompletedCount === 1 ? '' : 'en'} bleibt erhalten.` : '';
    if (!await confirmAction(`${deletableCompletedCount} erledigte Erinnerung${deletableCompletedCount === 1 ? '' : 'en'} samt untergeordneten Erinnerungen endgültig löschen?${protectionHint}`, { title:'Erledigte Erinnerungen löschen', confirmLabel:'Endgültig löschen' })) return;
    try {
      const result = await api('/todos/completed', { method:'DELETE' });
      state.todosCompletedOpen = false;
      toast(result.removed ? `${result.removed} erledigte Erinnerung${result.removed === 1 ? '' : 'en'} gelöscht` : 'Keine löschbaren Erinnerungen');
      await renderTodos();
    }
    catch (error) { toast(error.message); }
  };
  bindTodoReordering();
}

function searchResultHref(result) {
  if (result.type === 'project') return `/#/projects/${encodeURIComponent(result.projectId)}`;
  const tab = ['entries','tasks'].includes(result.type) ? 'entries' : result.type;
  const query = new URLSearchParams({ tab, item:result.id });
  return `/#/projects/${encodeURIComponent(result.projectId)}?${query}`;
}

function searchResultDate(value) {
  if (!value) return '';
  return String(value).includes('T') ? formatDateTime(value) : formatDate(value);
}

function globalSearchResult(result) {
  const status = projectStatusLabels[result.projectStatus] || result.projectStatus;
  return `<article class="global-search-result"><a href="${escapeHtml(searchResultHref(result))}"><div class="global-search-result-head"><span class="global-search-result-type">${escapeHtml(searchTypeLabels[result.type] || result.type)}</span><span class="project-status ${escapeHtml(result.projectStatus)}">${escapeHtml(status)}</span></div><h2>${escapeHtml(result.title)}</h2>${result.excerpt ? `<p>${escapeHtml(result.excerpt)}</p>` : ''}<footer><strong>${escapeHtml(result.projectTitle)}</strong>${result.date ? `<span>${escapeHtml(searchResultDate(result.date))}</span>` : ''}</footer></a></article>`;
}

function storageViewParams(includeArchived = state.storageLocationsIncludeArchived) {
  const params = new URLSearchParams();
  if (includeArchived) params.set('archived', '1');
  if (state.storageLocationSort !== 'name') params.set('sort', state.storageLocationSort);
  if (state.storageLocationSortDirection === 'desc') params.set('direction', 'desc');
  if (!state.storageLocationsShowEmpty) params.set('empty', 'hide');
  return params;
}
const storageLocationHref = (id = '', includeArchived = state.storageLocationsIncludeArchived) => {
  const params = storageViewParams(includeArchived);
  return `/#/inventory${id ? `/location/${encodeURIComponent(id)}` : ''}${params.size ? `?${params}` : ''}`;
};
const storageContextItemHref = (locationId, itemId, includeArchived = state.storageLocationsIncludeArchived) => {
  const params = storageViewParams(includeArchived);
  return `/#/inventory/location/${encodeURIComponent(locationId)}/item/${encodeURIComponent(itemId)}${params.size ? `?${params}` : ''}`;
};
const inventoryItemHref = (id = '', includeArchived = state.inventoryItemsIncludeArchived, query = state.inventoryItemQuery, categoryId = '', sort = 'name', direction = 'asc') => {
  const params = new URLSearchParams();
  if (includeArchived) params.set('archived', '1');
  if (query) params.set('q', query);
  if (categoryId) params.set('category', categoryId);
  if (sort !== 'name') params.set('sort', sort);
  if (direction === 'desc') params.set('direction', 'desc');
  return `/#/inventory/${id ? `item/${encodeURIComponent(id)}` : 'items'}${params.size ? `?${params}` : ''}`;
};
const inventoryReplenishmentHref = (query = '', includeSatisfied = false, sort = 'urgency') => {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (includeSatisfied) params.set('all', '1');
  if (sort !== 'urgency') params.set('sort', sort);
  return `/#/inventory/replenishment${params.size ? `?${params}` : ''}`;
};

async function loadStorageLocations(includeArchived = false) {
  const data = await api(`/storage-locations${includeArchived ? '?includeArchived=1' : ''}`);
  state.storageLocations = data.locations || [];
  state.storageLocationsIncludeArchived = includeArchived;
  return state.storageLocations;
}

async function loadInventoryItems(includeArchived = false, query = '') {
  const params = new URLSearchParams({ withOverview:'1' });
  if (includeArchived) params.set('includeArchived', '1');
  if (query) params.set('q', query);
  const data = await api(`/inventory-items${params.size ? `?${params}` : ''}`);
  state.inventoryItems = data.items || [];
  state.inventoryItemsIncludeArchived = includeArchived;
  state.inventoryItemQuery = query;
  return state.inventoryItems;
}

async function loadInventoryCategories() {
  const data = await api('/inventory-categories');
  state.inventoryCategories = data.categories || [];
  return state.inventoryCategories;
}

function initialCompactColumnPath(items, selectedIds) {
  const byId = new Map(items.map(item => [item.id, item]));
  const target = items.find(item => selectedIds.has(item.id));
  if (!target) return [];
  const path = [];
  for (let current = target.parentId ? byId.get(target.parentId) : null; current; current = current.parentId ? byId.get(current.parentId) : null) path.unshift(current.id);
  if (items.some(item => item.parentId === target.id)) path.push(target.id);
  return path;
}

function renderCompactColumnPicker({ container, items, selectedIds, path = [], selectionMode = 'multiple', inputName, rootLabel, fallbackIcon, disabledIds = new Set(), onSelectionChange, onPathChange }) {
  const compare = (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name, 'de', { sensitivity:'base', numeric:true });
  const childrenOf = parentId => items.filter(item => item.parentId === parentId).sort(compare);
  const validPath = [];
  let parentId = null;
  for (const id of path) {
    const item = childrenOf(parentId).find(candidate => candidate.id === id);
    if (!item || !childrenOf(item.id).length) break;
    validPath.push(item.id);
    parentId = item.id;
  }
  onPathChange(validPath);
  const columns = [];
  parentId = null;
  for (let depth = 0; ; depth += 1) {
    const parent = parentId ? items.find(item => item.id === parentId) : null;
    const children = childrenOf(parentId);
    const activeId = validPath[depth] || '';
    const rows = children.map(item => {
      const hasChildren = childrenOf(item.id).length > 0;
      const disabled = disabledIds.has(item.id);
      const type = selectionMode === 'single' ? 'radio' : 'checkbox';
      const title = `<span aria-hidden="true">${iconSvg(entityIconName(item, fallbackIcon))}</span><strong>${escapeHtml(item.name)}</strong>${hasChildren ? '<i aria-hidden="true">›</i>' : ''}`;
      return `<div class="compact-column-picker-row${item.id === activeId ? ' active' : ''}${selectedIds.has(item.id) ? ' selected' : ''}${disabled ? ' disabled' : ''}"><label class="compact-column-picker-check"><input type="${type}" name="${escapeHtml(inputName)}" value="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} auswählen"${selectedIds.has(item.id) ? ' checked' : ''}${disabled ? ' disabled' : ''}></label>${hasChildren ? `<button class="compact-column-picker-title" type="button" data-compact-column-open="${escapeHtml(item.id)}" data-compact-column-depth="${depth}" aria-label="Unterelemente von ${escapeHtml(item.name)} öffnen">${title}</button>` : `<span class="compact-column-picker-title">${title}</span>`}</div>`;
    }).join('') || '<p class="compact-column-picker-empty">Keine Unterelemente</p>';
    columns.push(`<section class="compact-column-picker-column"><header>${escapeHtml(parent?.name || rootLabel)}</header><div data-compact-column-clear="${depth}">${rows}</div></section>`);
    if (!activeId) break;
    parentId = activeId;
  }
  container.innerHTML = items.length ? `<div class="compact-column-picker">${columns.join('')}</div>` : `<p class="field-hint">Noch keine ${escapeHtml(rootLabel)} angelegt.</p>`;
  container.querySelectorAll(`input[name="${inputName}"]`).forEach(input => input.onchange = () => {
    if (selectionMode === 'single') {
      selectedIds.clear();
      container.querySelectorAll('.compact-column-picker-row.selected').forEach(row => row.classList.remove('selected'));
    }
    if (input.checked) selectedIds.add(input.value);
    else selectedIds.delete(input.value);
    input.closest('.compact-column-picker-row')?.classList.toggle('selected', input.checked);
    onSelectionChange(selectedIds);
  });
  const rerender = nextPath => renderCompactColumnPicker({ container, items, selectedIds, path:nextPath, selectionMode, inputName, rootLabel, fallbackIcon, disabledIds, onSelectionChange, onPathChange });
  container.querySelectorAll('[data-compact-column-open]').forEach(button => button.onclick = () => {
    const nextPath = validPath.slice(0, Number(button.dataset.compactColumnDepth));
    nextPath.push(button.dataset.compactColumnOpen);
    rerender(nextPath);
  });
  container.querySelectorAll('[data-compact-column-clear]').forEach(column => column.onclick = event => {
    if (event.target.closest('.compact-column-picker-row')) return;
    rerender(validPath.slice(0, Number(column.dataset.compactColumnClear)));
  });
  container.querySelectorAll('.compact-column-picker-title:is(button)').forEach(title => title.onkeydown = event => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const titles = [...title.closest('.compact-column-picker-column').querySelectorAll('.compact-column-picker-title:is(button)')];
    const index = titles.indexOf(title);
    if (event.key === 'ArrowUp') titles[Math.max(0, index - 1)]?.focus();
    if (event.key === 'ArrowDown') titles[Math.min(titles.length - 1, index + 1)]?.focus();
    if (event.key === 'ArrowLeft') rerender(validPath.slice(0, Math.max(0, Number(title.dataset.compactColumnDepth))));
    if (event.key === 'ArrowRight') title.click();
  });
}

function renderInventoryCategoryPicker(form, requestedPath = null) {
  const selectedIds = new Set(JSON.parse(form.dataset.categoryIds || '[]'));
  renderCompactColumnPicker({
    container:$('#inventory-item-category-options'),
    items:state.inventoryCategories,
    selectedIds,
    path:requestedPath || JSON.parse(form.dataset.categoryPath || '[]'),
    selectionMode:'multiple',
    inputName:'categoryIds',
    rootLabel:'Kategorien',
    fallbackIcon:'folder',
    onSelectionChange:next => { form.dataset.categoryIds = JSON.stringify([...next]); },
    onPathChange:next => { form.dataset.categoryPath = JSON.stringify(next); },
  });
}

async function openInventoryItemDialog(itemId = '', storageLocationId = '', categoryId = '') {
  const dialog = $('#inventory-item-dialog');
  const form = $('#inventory-item-form');
  const item = itemId ? state.inventoryItems.find(candidate => candidate.id === itemId) : null;
  const storageLocation = !item && storageLocationId ? state.storageLocations.find(candidate => candidate.id === storageLocationId) : null;
  if (itemId && !item) return toast('Artikel nicht gefunden.');
  if (storageLocationId && !storageLocation) return toast('Lagerort nicht gefunden.');
  if (!state.inventoryCategories.length) await loadInventoryCategories();
  const category = !item && categoryId ? state.inventoryCategories.find(candidate => candidate.id === categoryId) : null;
  if (categoryId && !category) return toast('Kategorie nicht gefunden.');
  form.reset();
  form.dataset.storageLocationId = storageLocation?.id || '';
  form.dataset.storageLocationAssigned = '0';
  form.dataset.categoryContextId = category?.id || '';
  form.elements.itemId.value = item?.id || '';
  form.elements.name.value = item?.name || '';
  form.elements.trackingMode.value = item?.trackingMode || 'QUANTITY';
  form.elements.stockUnit.value = item?.stockUnit || 'Stück';
  form.elements.description.value = item?.description || '';
  form.elements.manufacturer.value = item?.manufacturer || '';
  form.elements.articleNumber.value = item?.articleNumber || '';
  form.elements.barcode.value = item?.barcode || '';
  form.elements.defaultMinimumQuantity.value = item?.defaultMinimumQuantity ?? '';
  form.elements.initialQuantity.value = '0';
  form.elements.merchantUrl.value = item?.merchantUrl || '';
  form.elements.image.value = '';
  form.dataset.removeImage = '0';
  setInventoryItemImagePreview(item?.hasImage ? inventoryItemImageUrl(item) : '');
  $('#inventory-item-image-remove').hidden = !item?.hasImage;
  const selected = new Set(item?.categoryIds || (category ? [category.id] : []));
  form.dataset.categoryIds = JSON.stringify([...selected]);
  renderInventoryCategoryPicker(form, initialCompactColumnPath(state.inventoryCategories, selected));
  $('#inventory-item-dialog-title').textContent = item ? 'Artikel bearbeiten' : storageLocation ? `Artikel in ${storageLocation.name} anlegen` : category ? `Artikel in ${category.name} anlegen` : 'Artikel anlegen';
  $('#inventory-item-dialog-copy').textContent = storageLocation
    ? `Der neue Artikel wird nach dem Speichern automatisch dem Lagerort „${storageLocation.name}“ zugeordnet.`
    : category
      ? `Die Kategorie „${category.name}“ ist vorausgewählt; weitere Kategorien können ergänzt werden.`
      : 'Der Artikel beschreibt den Gegenstand unabhängig von Lagerort und Bestand.';
  $('#inventory-item-error').textContent = '';
  syncInventoryItemTrackingMode();
  dialog.showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

const formatInventoryQuantity = value => value === null || value === undefined ? 'Nicht festgelegt' : new Intl.NumberFormat('de-DE', { maximumFractionDigits:6 }).format(value);
const isLooseCollection = item => item?.trackingMode === 'COLLECTION';
const inventoryItemImageUrl = item => `/api/inventory-items/${encodeURIComponent(item.id)}/image${item.image?.updatedAt ? `?v=${encodeURIComponent(item.image.updatedAt)}` : ''}`;

function syncInventoryItemTrackingMode() {
  const form = $('#inventory-item-form');
  const collection = form.elements.trackingMode.value === 'COLLECTION';
  const directStorageCreation = Boolean(form.dataset.storageLocationId) && !form.elements.itemId.value;
  form.querySelectorAll('[data-inventory-quantity-field]').forEach(field => { field.hidden = collection; });
  $('[data-inventory-initial-field]', form).hidden = collection || !directStorageCreation;
  form.elements.stockUnit.disabled = collection;
  form.elements.stockUnit.required = !collection;
  form.elements.defaultMinimumQuantity.disabled = collection;
  form.elements.initialQuantity.disabled = collection || !directStorageCreation;
  form.elements.initialQuantity.required = !collection && directStorageCreation;
  if (collection) {
    form.elements.defaultMinimumQuantity.value = '';
    form.elements.initialQuantity.value = '0';
  }
}

function setInventoryItemImagePreview(source = '') {
  const image = $('#inventory-item-image-preview');
  const placeholder = $('#inventory-item-image-placeholder');
  image.hidden = !source;
  placeholder.hidden = Boolean(source);
  if (source) image.src = source;
  else image.removeAttribute('src');
}

function openInventoryItemNoteDialog(itemId, noteId = '') {
  const note = noteId ? state.inventoryItemNotes.find(candidate => candidate.id === noteId && candidate.itemId === itemId) : null;
  if (noteId && !note) return toast('Notiz nicht gefunden.');
  const form = $('#inventory-item-note-form');
  form.reset();
  form.elements.itemId.value = itemId;
  form.elements.noteId.value = note?.id || '';
  form.elements.content.value = note?.content || '';
  $('#inventory-item-note-dialog-title').textContent = note ? 'Notiz bearbeiten' : 'Notiz hinzufügen';
  $('#inventory-item-note-error').textContent = '';
  $('#inventory-item-note-dialog').showModal();
  requestAnimationFrame(() => form.elements.content.focus());
}

function inventoryItemRow(item, selectedId = '', categoryId = '', sort = 'name', direction = 'asc') {
  const archived = item.status === 'ARCHIVED';
  const actions = contextActionMenu(`Aktionen für ${item.name}`, inventoryItemManagementActions(item, archived), { className:'inventory-item-menu' });
  const href = inventoryItemHref(item.id, state.inventoryItemsIncludeArchived, state.inventoryItemQuery, categoryId, sort, direction);
  const quantity = value => `${formatInventoryQuantity(value || 0)} ${escapeHtml(item.stockUnit)}`;
  const collection = isLooseCollection(item);
  const stock = collection ? 'Vorhanden' : quantity(item.physicalQuantity);
  const reserved = collection ? `${Number(item.bookingCount || 0)} Projekte` : quantity(item.reservedQuantity);
  const available = collection ? 'Ohne Menge' : quantity(item.availableQuantity);
  return `<tr class="inventory-item-row${item.id === selectedId ? ' selected' : ''}${archived ? ' archived' : ''}" data-inventory-item-route="${escapeHtml(href)}" tabindex="0"><td class="inventory-item-name-column"><a href="${href}"${item.id === selectedId ? ' aria-current="page"' : ''}><strong>${escapeHtml(item.name)}</strong>${collection ? '<small>Lose Sammlung ohne Mengenerfassung</small>' : archived ? '<small>Archiviert</small>' : ''}</a></td><td class="inventory-item-meta-column"><span>${escapeHtml(item.manufacturer || '–')}</span><small>${escapeHtml(item.articleNumber || '–')}</small></td><td class="inventory-item-number-column"><span>${stock}</span></td><td class="inventory-item-number-column inventory-item-reserved-column"><span>${reserved}</span></td><td class="inventory-item-number-column${!collection && Number(item.availableQuantity || 0) < 0 ? ' low' : ''}"><span>${available}</span></td><td class="inventory-item-actions-column">${actions}</td></tr>`;
}

function inventoryItemSortHeader(label, field, sort, direction, className = '') {
  const active = field === sort;
  const nextDirection = active && direction === 'asc' ? 'desc' : 'asc';
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const href = inventoryItemHref('', state.inventoryItemsIncludeArchived, state.inventoryItemQuery, state.inventoryItemCategoryFilter, field, nextDirection);
  return `<th${className ? ` class="${className}"` : ''} aria-sort="${ariaSort}"><a class="inventory-item-sort-link${active ? ' active' : ''}" href="${href}" title="Nach ${escapeHtml(label)} ${nextDirection === 'asc' ? 'aufsteigend' : 'absteigend'} sortieren"><span>${escapeHtml(label)}</span><i aria-hidden="true">${active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</i></a></th>`;
}

function inventoryItemTable(rows, sort, direction) {
  return `<table class="inventory-item-table"><thead><tr>${inventoryItemSortHeader('Artikel', 'name', sort, direction)}${inventoryItemSortHeader('Hersteller · Artikelnummer', 'manufacturer', sort, direction, 'inventory-item-meta-column')}${inventoryItemSortHeader('Bestand', 'physical', sort, direction, 'inventory-item-number-heading')}${inventoryItemSortHeader('Reserviert', 'reserved', sort, direction, 'inventory-item-number-heading inventory-item-reserved-column')}${inventoryItemSortHeader('Verfügbar', 'available', sort, direction, 'inventory-item-number-heading')}<th><span class="visually-hidden">Aktionen</span></th></tr></thead><tbody>${rows}</tbody></table>`;
}

const stockTransactionLabels = { RECEIPT:'Zugang', RETURN:'Rückgabe', CONSUMPTION:'Verbrauch', TRANSFER:'Umlagerung', CORRECTION:'Korrektur', DISPOSAL:'Entsorgung', LOSS:'Verlust' };

function stockLocationPath(entry) {
  return (entry.locationPath || []).map(part => part.name).join(' › ') || entry.locationName;
}

function inventoryStockEntryMarkup(entry, editable) {
  const archived = entry.status === 'ARCHIVED';
  const collection = isLooseCollection(entry);
  const canDelete = editable && Number(entry.quantity) === 0;
  const actions = !editable ? '' : archived
    ? `${canDelete ? `<button class="button secondary compact danger" type="button" data-stock-entry-delete="${escapeHtml(entry.id)}">Zuordnung entfernen</button>` : ''}`
    : `<button class="button secondary compact" type="button" data-stock-entry-edit="${escapeHtml(entry.id)}">${collection ? 'Lagerortnotiz' : 'Lokaler Mindestbestand'}</button>${canDelete ? `<button class="button secondary compact danger" type="button" data-stock-entry-delete="${escapeHtml(entry.id)}">Zuordnung entfernen</button>` : ''}`;
  const stock = collection ? 'Vorhanden' : `${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(entry.stockUnit)}`;
  const detail = collection ? 'Lose Sammlung ohne Mengenerfassung' : entry.minimumQuantity === null ? 'Kein lokaler Mindestbestand' : `Lokales Minimum: ${escapeHtml(formatInventoryQuantity(entry.minimumQuantity))} ${escapeHtml(entry.stockUnit)}`;
  return `<article class="inventory-stock-entry${archived ? ' archived' : ''}"><div><a href="${storageLocationHref(entry.storageLocationId, archived)}">${escapeHtml(stockLocationPath(entry))}</a><strong>${stock}</strong></div><p>${detail}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}${archived ? ' · Archiviert' : ''}</p>${actions ? `<footer>${actions}</footer>` : ''}</article>`;
}

function stockTransactionMarkup(transaction, reservations = []) {
  const outbound = ['CONSUMPTION','DISPOSAL','LOSS'].includes(transaction.type) || (transaction.type === 'CORRECTION' && transaction.sourceStorageLocationId);
  const sign = transaction.type === 'TRANSFER' ? '' : outbound ? '−' : '+';
  const route = transaction.type === 'TRANSFER' ? `${transaction.sourceName} → ${transaction.destinationName}` : transaction.sourceName || transaction.destinationName;
  const reservation = transaction.reservationId ? reservations.find(candidate => candidate.id === transaction.reservationId) : null;
  const label = reservation ? 'Für Projekt entnommen' : stockTransactionLabels[transaction.type] || transaction.type;
  const context = reservation ? [reservationTargetLabel(reservation), route].filter(Boolean).join(' · ') : route;
  return `<article class="inventory-stock-transaction"><span class="${outbound ? 'outbound' : 'inbound'}">${escapeHtml(sign)}${escapeHtml(formatInventoryQuantity(transaction.quantity))} ${escapeHtml(transaction.stockUnit)}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(context)}${transaction.note ? ` · ${escapeHtml(transaction.note)}` : ''}</small></div><time>${escapeHtml(formatDateTime(transaction.occurredAt))}</time></article>`;
}

const reservationStatusLabels = { ACTIVE:'Aktiv', FULFILLED:'Erfüllt', RELEASED:'Aufgehoben', CANCELLED:'Aufgehoben' };

function reservationTargetLabel(reservation, context = 'item') {
  if (!reservation.targetResolved) return 'Historischer, nicht mehr auflösbarer Projektbezug';
  if (context === 'project') return reservation.projectEntryTitle || 'Gesamtes Projekt';
  return `${reservation.projectTitle}${reservation.projectEntryTitle ? ` · ${reservation.projectEntryTitle}` : ''}`;
}

function reservationMarkup(reservation, context = 'item') {
  const active = reservation.status === 'ACTIVE';
  const collection = isLooseCollection(reservation);
  const targetHref = context === 'project' ? inventoryItemHref(reservation.itemId, reservation.itemStatus === 'ARCHIVED', '') : `/#/projects/${encodeURIComponent(reservation.projectId)}`;
  const targetTitle = context === 'project' ? reservation.itemName : reservationTargetLabel(reservation, context);
  const progress = collection ? 'Lose Sammlung ohne Mengenerfassung' : reservation.fulfilledQuantity > 0
    ? `${formatInventoryQuantity(reservation.fulfilledQuantity)} von ${formatInventoryQuantity(reservation.requestedQuantity)} ${reservation.stockUnit} erfüllt`
    : `${formatInventoryQuantity(reservation.requestedQuantity)} ${reservation.stockUnit} benötigt`;
  const actions = mayEditProjects() && active
    ? `<footer>${collection ? '' : `<button class="button primary compact" type="button" data-reservation-fulfill="${escapeHtml(reservation.id)}">Entnehmen</button>`}<button class="button secondary compact" type="button" data-reservation-edit="${escapeHtml(reservation.id)}">Bearbeiten</button><button class="button secondary compact danger" type="button" data-reservation-release="${escapeHtml(reservation.id)}">${collection ? 'Projektbuchung aufheben' : 'Reservierung aufheben'}</button></footer>`
    : '';
  const status = collection && active ? 'Gebucht' : reservationStatusLabels[reservation.status] || reservation.status;
  return `<article class="inventory-reservation${active ? ' active' : ' closed'}"><div><a href="${escapeHtml(targetHref)}">${escapeHtml(targetTitle)}</a><span class="reservation-status ${escapeHtml(reservation.status.toLowerCase())}">${escapeHtml(status)}</span></div><strong>${escapeHtml(progress)}</strong>${active && !collection ? `<p>Noch offen: ${escapeHtml(formatInventoryQuantity(reservation.remainingQuantity))} ${escapeHtml(reservation.stockUnit)}</p>` : ''}${reservation.note ? `<p>${escapeHtml(reservation.note)}</p>` : ''}${actions}</article>`;
}

function reservationHistoryMarkup(reservation, type) {
  const lifted = type === 'RELEASED';
  const collection = isLooseCollection(reservation);
  const quantity = lifted ? reservation.remainingQuantity : reservation.requestedQuantity;
  const label = collection ? (lifted ? 'Projektbuchung aufgehoben' : 'Auf Projekt gebucht') : (lifted ? 'Reservierung aufgehoben' : 'Für Projekt reserviert');
  const occurredAt = lifted ? reservation.closedAt || reservation.updatedAt : reservation.createdAt;
  const context = reservationTargetLabel(reservation);
  return `<article class="inventory-stock-transaction reservation-event"><span>${collection ? 'Ohne Menge' : `${escapeHtml(formatInventoryQuantity(quantity))} ${escapeHtml(reservation.stockUnit)}`}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(context)}${reservation.note ? ` · ${escapeHtml(reservation.note)}` : ''}</small></div><time>${escapeHtml(formatDateTime(occurredAt))}</time></article>`;
}

function inventoryHistoryMarkup(transactions, reservations) {
  const events = transactions.map(transaction => ({ occurredAt:transaction.occurredAt, markup:stockTransactionMarkup(transaction, reservations) }));
  reservations.forEach(reservation => {
    events.push({ occurredAt:reservation.createdAt, markup:reservationHistoryMarkup(reservation, 'CREATED') });
    if (['RELEASED','CANCELLED'].includes(reservation.status)) events.push({ occurredAt:reservation.closedAt || reservation.updatedAt, markup:reservationHistoryMarkup(reservation, 'RELEASED') });
  });
  return events.sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt))).map(event => event.markup).join('');
}

function inventoryItemOverview(item, summary = {}, contextualContent = '', actions = '', expandedHeading = false) {
  const collection = isLooseCollection(item);
  const unit = item.stockUnit;
  const physical = summary.physicalQuantity || 0;
  const reserved = summary.reservedQuantity || 0;
  const available = summary.availableQuantity ?? physical;
  const metadata = [item.manufacturer, item.articleNumber].filter(Boolean).join(' · ');
  const globalMinimum = item.defaultMinimumQuantity === null ? '–' : `${formatInventoryQuantity(item.defaultMinimumQuantity)} ${unit}`;
  const heading = expandedHeading ? `<div class="inventory-item-overview-heading"><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.description || 'Noch keine Beschreibung hinterlegt.')}</p></div>` : '';
  const description = expandedHeading ? '' : `<p>${escapeHtml(item.description || 'Noch keine Beschreibung hinterlegt.')}</p>`;
  const preview = item.hasImage ? `<img src="${escapeHtml(inventoryItemImageUrl(item))}" alt="" loading="lazy" decoding="async">` : iconSvg('tag');
  const metrics = collection
    ? `<div><dt>Bestandsführung</dt><dd>Lose Sammlung</dd></div><div><dt>Mengenerfassung</dt><dd>Keine</dd></div><div><dt>Lagerorte</dt><dd>${Number(summary.locationCount ?? summary.entries?.length ?? 0)}</dd></div><div><dt>Projektbuchungen</dt><dd>${Number(summary.bookingCount || 0)}</dd></div>`
    : `<div><dt>Gesamtbestand</dt><dd>${escapeHtml(formatInventoryQuantity(physical))} ${escapeHtml(unit)}</dd></div><div><dt>Reserviert</dt><dd>${escapeHtml(formatInventoryQuantity(reserved))} ${escapeHtml(unit)}</dd></div><div><dt>Verfügbar</dt><dd class="${available < 0 ? 'low' : ''}">${escapeHtml(formatInventoryQuantity(available))} ${escapeHtml(unit)}</dd></div><div><dt>Globales Minimum</dt><dd>${escapeHtml(globalMinimum)}</dd></div>`;
  return `<div class="inventory-item-overview"><span class="storage-item-preview${item.hasImage ? ' has-image' : ''}" aria-hidden="true">${preview}</span>${heading}${metadata ? `<p class="storage-item-metadata">${escapeHtml(metadata)}</p>` : ''}${description}${contextualContent}<div class="inventory-item-stock-overview"><dl>${metrics}</dl>${actions ? `<div class="inventory-item-overview-actions">${actions}</div>` : ''}</div></div>`;
}

function inventoryDetailSummary(title, subtitle) {
  return `<summary class="inventory-stock-section-head"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(subtitle)}</span></div></summary>`;
}

function inventoryItemNotesSection(item, notes = [], archived = false) {
  const createAction = mayEditProjects() && !archived ? `<div class="inventory-section-create"><button class="button secondary compact" type="button" data-inventory-item-note-create="${escapeHtml(item.id)}">Notiz hinzufügen</button></div>` : '';
  const noteRows = notes.map(note => {
    const changed = note.updatedAt ? ` · geändert ${formatDateTime(note.updatedAt)}` : '';
    const actions = mayEditProjects() && !archived ? `<details class="action-menu inventory-item-note-menu"><summary aria-label="Aktionen für Notiz">${iconSvg('ellipsis')}</summary><div class="action-menu-panel"><button class="menu-item" type="button" data-inventory-item-note-edit="${escapeHtml(note.id)}" data-inventory-item="${escapeHtml(item.id)}">Bearbeiten</button><button class="menu-item danger" type="button" data-inventory-item-note-delete="${escapeHtml(note.id)}" data-inventory-item="${escapeHtml(item.id)}">Löschen</button></div></details>` : '';
    return `<article class="inventory-item-note"><div class="inventory-item-note-copy">${escapeHtml(note.content).replace(/\n/g, '<br>')}</div><footer><span>${escapeHtml(formatDateTime(note.createdAt))}${note.createdBy ? ` · ${escapeHtml(note.createdBy)}` : ''}${escapeHtml(changed)}</span>${actions}</footer></article>`;
  }).join('');
  const content = noteRows ? `<div class="inventory-item-note-list">${noteRows}</div>${createAction}` : `<div class="inventory-stock-empty inventory-item-note-empty">Noch keine Notizen.${createAction}</div>`;
  return `<details class="inventory-stock-section inventory-detail-section inventory-item-notes-section" open>${inventoryDetailSummary('Notizen', `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}`)}<div class="inventory-detail-section-body">${content}</div></details>`;
}

function inventoryItemDetail(item, includeArchived, stockData = { entries:[], summary:null }, transactions = [], reservations = [], notes = [], categoryId = '', sort = 'name', direction = 'asc') {
  if (!item) return `<aside class="inventory-item-detail inventory-item-welcome"><span class="storage-finder-detail-icon" aria-hidden="true">${iconSvg('tag')}</span><h2>Artikel auswählen</h2><p>Artikel werden unabhängig von Lagerort und Bestand geführt.</p></aside>`;
  const archived = item.status === 'ARCHIVED';
  const collection = isLooseCollection(item);
  const actions = inventoryItemManagementActions(item, archived, { includeEdit:false });
  const merchant = item.merchantUrl ? `<a class="menu-item storage-item-menu-link" href="${escapeHtml(item.merchantUrl)}" target="_blank" rel="noopener noreferrer">Händler öffnen</a>` : '';
  const menu = contextActionMenu(`Aktionen für ${item.name}`, `${actions}${merchant}<button class="menu-item" type="button" data-inventory-item-copy-link="${escapeHtml(item.id)}">Link kopieren</button>`, { className:'storage-finder-column-menu storage-item-column-menu' });
  const close = `<a class="inventory-item-detail-close" href="${inventoryItemHref('', includeArchived, state.inventoryItemQuery, categoryId, sort, direction)}" aria-label="Artikelansicht schließen" title="Artikelansicht schließen">×</a>`;
  const edit = inventoryItemEditButton(item, archived);
  const entries = stockData.entries || [];
  const activeEntries = entries.filter(entry => entry.status === 'ACTIVE');
  const physical = stockData.summary?.physicalQuantity || 0;
  const reserved = stockData.summary?.reservedQuantity || 0;
  const available = stockData.summary?.availableQuantity ?? physical;
  const reorder = stockData.summary?.reorderQuantity || 0;
  const low = reorder > 0;
  const stockBookingAction = mayEditProjects() && !archived && !collection ? '<button class="button secondary compact" type="button" data-stock-movement="RECEIPT">Bestand buchen</button>' : '';
  const stockLocationAction = mayEditProjects() && !archived ? `<div class="inventory-section-create"><button class="button secondary compact" type="button" data-stock-entry-create="${escapeHtml(item.id)}">Weiteren Lagerort hinzufügen</button></div>` : '';
  const entryContent = entries.length ? `<div class="inventory-stock-entry-list">${entries.map(entry => inventoryStockEntryMarkup(entry, mayEditProjects() && !archived)).join('')}${stockLocationAction}</div>` : `<div class="inventory-stock-empty">Noch keinem Lagerort zugeordnet.${stockLocationAction}</div>`;
  const entrySection = `<details class="inventory-stock-section inventory-detail-section inventory-location-section" open>${inventoryDetailSummary('Lagerorte', `${activeEntries.length} ${activeEntries.length === 1 ? 'Zuordnung' : 'Zuordnungen'}`)}<div class="inventory-detail-section-body">${entryContent}</div></details>`;
  const reservationActions = mayEditProjects() && !archived ? `<div class="inventory-section-create"><button class="button secondary compact" type="button" data-reservation-create data-reservation-item="${escapeHtml(item.id)}">${collection ? 'Auf Projekt buchen' : 'Für Projekt reservieren'}</button></div>` : '';
  const activeReservations = reservations.filter(reservation => reservation.status === 'ACTIVE');
  const reservationContent = activeReservations.length ? `<div class="inventory-reservation-list">${activeReservations.map(reservation => reservationMarkup(reservation, 'item')).join('')}${reservationActions}</div>` : `<div class="inventory-stock-empty inventory-reservation-empty">${collection ? 'Noch auf kein Projekt gebucht.' : 'Keine aktive Projektreservierung.'}${reservationActions}</div>`;
  const reservationTitle = collection ? 'Projektbuchungen' : 'Projektreservierungen';
  const reservationSubtitle = collection ? `${activeReservations.length} ${activeReservations.length === 1 ? 'Projekt' : 'Projekte'}` : `${formatInventoryQuantity(reserved)} ${item.stockUnit} reserviert`;
  const reservationSection = `<details class="inventory-stock-section inventory-detail-section inventory-reservation-section" open>${inventoryDetailSummary(reservationTitle, reservationSubtitle)}<div class="inventory-detail-section-body">${reservationContent}${!collection && activeReservations.length && available < 0 ? `<p class="inventory-stock-warning">Der Projektbedarf übersteigt den physischen Bestand um ${escapeHtml(formatInventoryQuantity(Math.abs(available)))} ${escapeHtml(item.stockUnit)}.</p>` : ''}</div></details>`;
  const itemCategories = (item.categoryIds || []).map(id => state.inventoryCategories.find(category => category.id === id)).filter(Boolean);
  const categorySection = `<details class="inventory-stock-section inventory-detail-section inventory-category-section" open>${inventoryDetailSummary('Kategorien', `${itemCategories.length} zugeordnet`)}<div class="inventory-detail-section-body"><div class="category-item-memberships"><div>${itemCategories.map(category => `<a class="tag-chip" href="${inventoryCategoryHref(category.id, item.id)}">${escapeHtml(category.name)}</a>`).join('') || '<span>Keine Kategorie zugeordnet.</span>'}</div></div></div></details>`;
  const historyEntries = inventoryHistoryMarkup(transactions, reservations);
  const history = `<details class="inventory-stock-section inventory-detail-section inventory-history-section">${inventoryDetailSummary('Historie', 'Unveränderlich protokolliert')}<div class="inventory-detail-section-body">${historyEntries ? `<div class="inventory-stock-history">${historyEntries}</div>` : '<div class="inventory-stock-empty">Noch keine Bestands- oder Reservierungsvorgänge.</div>'}</div></details>`;
  const masterData = `<details class="inventory-stock-section inventory-detail-section inventory-item-master-data">${inventoryDetailSummary('Weitere Stammdaten', 'Zusätzliche Artikelangaben')}<div class="inventory-detail-section-body"><dl><div><dt>Bestandsführung</dt><dd>${collection ? 'Lose Sammlung ohne Mengenerfassung' : 'Artikel mit Mengenerfassung'}</dd></div><div><dt>Hersteller</dt><dd>${escapeHtml(item.manufacturer || '–')}</dd></div><div><dt>Artikelnummer</dt><dd>${escapeHtml(item.articleNumber || '–')}</dd></div><div><dt>Barcode / EAN</dt><dd>${escapeHtml(item.barcode || '–')}</dd></div><div><dt>Interne Kennung</dt><dd>${escapeHtml(item.id)}</dd></div></dl></div></details>`;
  return `<aside class="inventory-item-detail storage-item-detail${archived ? ' archived' : ''}"><header class="storage-finder-detail-header inventory-item-detail-menu-header"><div class="storage-finder-column-actions">${close}${edit}${menu}</div></header><div class="inventory-item-detail-body"><a class="inventory-item-mobile-back" href="${inventoryItemHref('', includeArchived, state.inventoryItemQuery, categoryId, sort, direction)}"><span aria-hidden="true">‹</span>Alle Artikel</a>${inventoryItemOverview(item, stockData.summary || {}, '', stockBookingAction, true)}${!collection && low ? `<p class="inventory-stock-warning">Unter Berücksichtigung der Reservierungen sollten ${escapeHtml(formatInventoryQuantity(reorder))} ${escapeHtml(item.stockUnit)} nachbestellt werden.</p>` : ''}${archived ? '<div class="storage-archive-notice"><strong>Archiviert</strong><span>Lagerorte, Projektbezüge und Historie bleiben lesbar; neue Vorgänge sind gesperrt.</span></div>' : ''}${inventoryItemNotesSection(item, notes, archived)}${reservationSection}${entrySection}${categorySection}${masterData}${history}</div></aside>`;
}

async function ensureActiveStorageLocations() {
  const data = await api('/storage-locations');
  state.storageLocations = data.locations || [];
  return state.storageLocations;
}

const storageLocationOptionLabel = location => storageLocationPath(location).map(part => part.name).join(' › ');

function renderStockLocationPicker(form, locations, usedIds, requestedPath = null) {
  const selectedIds = new Set(form.elements.storageLocationId.value ? [form.elements.storageLocationId.value] : []);
  renderCompactColumnPicker({
    container:$('#stock-entry-location-options'),
    items:locations,
    selectedIds,
    path:requestedPath || JSON.parse(form.dataset.storageLocationPath || '[]'),
    selectionMode:'single',
    inputName:'storageLocationChoice',
    rootLabel:'Lagerorte',
    fallbackIcon:'archive',
    disabledIds:usedIds,
    onSelectionChange:next => { form.elements.storageLocationId.value = [...next][0] || ''; },
    onPathChange:next => { form.dataset.storageLocationPath = JSON.stringify(next); },
  });
}

async function openStockEntryDialog(itemId, entryId = '') {
  const item = state.inventoryItems.find(candidate => candidate.id === itemId) || state.inventoryStockItem;
  if (!item) return toast('Artikel nicht gefunden.');
  const locations = await ensureActiveStorageLocations();
  const entry = entryId ? state.inventoryStockEntries.find(candidate => candidate.id === entryId) : null;
  const collection = isLooseCollection(item);
  const form = $('#stock-entry-form');
  form.reset();
  form.classList.toggle('stock-entry-editing', Boolean(entry));
  form.elements.entryId.value = entry?.id || '';
  form.elements.itemId.value = item.id;
  form.elements.storageLocationId.value = entry?.storageLocationId || '';
  form.dataset.storageLocationPath = '[]';
  form.elements.minimumQuantity.value = entry?.minimumQuantity ?? '';
  const wholeUnits = item.stockUnit.toLocaleLowerCase('de-DE') === 'stück';
  form.elements.initialQuantity.step = wholeUnits ? '1' : 'any';
  form.elements.initialQuantity.classList.toggle('whole-units', wholeUnits);
  form.elements.minimumQuantity.step = wholeUnits ? '1' : 'any';
  form.elements.minimumQuantity.classList.toggle('whole-units', wholeUnits);
  form.elements.note.value = entry?.note || '';
  const used = new Set(state.inventoryStockEntries.filter(candidate => candidate.status === 'ACTIVE').map(candidate => candidate.storageLocationId));
  const available = entry ? locations.filter(location => location.id === entry.storageLocationId) : locations.filter(location => !used.has(location.id));
  if (!entry && !available.length) return toast('Alle aktiven Lagerorte sind bereits zugeordnet.');
  if (entry) $('#stock-entry-location-options').innerHTML = '';
  else renderStockLocationPicker(form, locations, used);
  $('[data-stock-entry-location-field]').hidden = Boolean(entry);
  $('[data-stock-entry-initial-field]').hidden = Boolean(entry) || collection;
  $('[data-stock-entry-minimum-field]').hidden = collection;
  form.elements.initialQuantity.required = !entry && !collection;
  form.elements.initialQuantity.disabled = collection;
  form.elements.minimumQuantity.disabled = collection;
  $('#stock-entry-dialog-title').textContent = entry ? (collection ? 'Lagerortnotiz bearbeiten' : 'Lokaler Mindestbestand') : 'Weiteren Lagerort hinzufügen';
  $('#stock-entry-dialog-copy').textContent = entry ? `${item.name} · ${stockLocationPath(entry)}` : collection ? `${item.name} · lose Sammlung ohne Mengenerfassung` : `${item.name} · ${item.stockUnit}`;
  $('#stock-entry-error').textContent = '';
  $('#stock-entry-dialog').showModal();
}

function syncStockMovementFields() {
  const form = $('#stock-movement-form');
  const type = form.elements.type.value;
  const outbound = ['CONSUMPTION','DISPOSAL','LOSS'].includes(type);
  const fixedConsumption = form.dataset.fixedType === 'CONSUMPTION';
  $('[data-stock-type-field]').hidden = fixedConsumption;
  $('[data-stock-source-field]').hidden = fixedConsumption || !(outbound || type === 'TRANSFER');
  $('[data-stock-destination-field]').hidden = !(['RECEIPT','RETURN','TRANSFER'].includes(type));
  $('[data-stock-correction-location-field]').hidden = type !== 'CORRECTION';
  $('[data-stock-quantity-field]').hidden = type === 'CORRECTION';
  $('[data-stock-counted-field]').hidden = type !== 'CORRECTION';
  form.elements.sourceStorageLocationId.required = outbound || type === 'TRANSFER';
  form.elements.destinationStorageLocationId.required = ['RECEIPT','RETURN','TRANSFER'].includes(type);
  form.elements.storageLocationId.required = type === 'CORRECTION';
  form.elements.quantity.required = type !== 'CORRECTION';
  form.elements.countedQuantity.required = type === 'CORRECTION';
  const source = form.elements.sourceStorageLocationId.value;
  [...form.elements.destinationStorageLocationId.options].forEach(option => { option.disabled = type === 'TRANSFER' && option.value === source; });
  if (form.elements.destinationStorageLocationId.selectedOptions[0]?.disabled) form.elements.destinationStorageLocationId.value = [...form.elements.destinationStorageLocationId.options].find(option => !option.disabled)?.value || '';
}

async function openStockMovementDialog(itemId, type = 'RECEIPT', sourceId = '') {
  let item = state.inventoryItems.find(candidate => candidate.id === itemId) || (state.inventoryStockItem?.id === itemId ? state.inventoryStockItem : null);
  if (!item && itemId) item = await api(`/inventory-items/${encodeURIComponent(itemId)}`);
  if (!item) return toast('Artikel nicht gefunden.');
  if (isLooseCollection(item)) return toast('Lose Sammlungen werden ohne Mengenbuchungen geführt.');
  const locations = await ensureActiveStorageLocations();
  const stockData = state.inventoryStockItem?.id === item.id
    ? { entries:state.inventoryStockEntries }
    : await api(`/stock-entries?itemId=${encodeURIComponent(item.id)}`);
  const entries = (stockData.entries || []).filter(entry => entry.status === 'ACTIVE');
  const sourceEntries = entries.filter(entry => entry.quantity > 0);
  const form = $('#stock-movement-form');
  form.reset();
  form.elements.itemId.value = item.id;
  form.elements.type.value = type;
  const locationOptions = locations.map(location => `<option value="${escapeHtml(location.id)}">${escapeHtml(storageLocationOptionLabel(location))}</option>`).join('');
  const sourceOptions = sourceEntries.map(entry => `<option value="${escapeHtml(entry.storageLocationId)}">${escapeHtml(stockLocationPath(entry))} · ${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(entry.stockUnit)}</option>`).join('');
  const correctionOptions = entries.map(entry => `<option value="${escapeHtml(entry.storageLocationId)}">${escapeHtml(stockLocationPath(entry))} · ${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(entry.stockUnit)}</option>`).join('');
  form.elements.sourceStorageLocationId.innerHTML = sourceOptions;
  form.elements.destinationStorageLocationId.innerHTML = locationOptions;
  form.elements.storageLocationId.innerHTML = correctionOptions;
  if (sourceId) form.elements.sourceStorageLocationId.value = sourceId;
  const sourceEntry = sourceEntries.find(entry => entry.storageLocationId === sourceId);
  const fixedConsumption = type === 'CONSUMPTION' && Boolean(sourceEntry);
  const wholeUnits = item.stockUnit.toLocaleLowerCase('de-DE') === 'stück';
  form.dataset.fixedType = fixedConsumption ? 'CONSUMPTION' : '';
  form.elements.quantity.max = fixedConsumption ? sourceEntry.quantity : 1000000000000;
  form.elements.quantity.min = wholeUnits ? '1' : '0.000001';
  form.elements.quantity.step = wholeUnits ? '1' : 'any';
  form.elements.quantity.value = wholeUnits ? '1' : '';
  form.elements.quantity.classList.toggle('whole-units', wholeUnits);
  form.elements.countedQuantity.step = wholeUnits ? '1' : 'any';
  form.elements.countedQuantity.classList.toggle('whole-units', wholeUnits);
  form.querySelectorAll('[data-stock-quantity-step],[data-stock-counted-step]').forEach(button => { button.hidden = false; });
  $('#stock-movement-dialog-title').textContent = fixedConsumption ? 'Artikel entnehmen' : 'Bestand buchen';
  $('#stock-movement-dialog-copy').textContent = fixedConsumption
    ? `${item.name} · ${stockLocationPath(sourceEntry)} · ${formatInventoryQuantity(sourceEntry.quantity)} ${item.stockUnit} verfügbar`
    : `${item.name} · Bestandseinheit ${item.stockUnit}`;
  $('#stock-movement-quantity-hint').hidden = !fixedConsumption;
  $('#stock-movement-quantity-hint').textContent = fixedConsumption ? `Maximal ${formatInventoryQuantity(sourceEntry.quantity)} ${item.stockUnit}` : '';
  $('#stock-movement-submit').textContent = fixedConsumption ? 'Entnehmen' : 'Verbindlich buchen';
  $('#stock-movement-error').textContent = '';
  syncStockMovementFields();
  $('#stock-movement-dialog').showModal();
}

function syncStockTransferQuantityMode() {
  const form = $('#stock-transfer-form');
  if (form.elements.trackingMode.value === 'COLLECTION') {
    $('#stock-transfer-quantity-field').hidden = true;
    form.elements.quantity.disabled = true;
    form.elements.quantity.required = false;
    return;
  }
  const custom = form.elements.quantityMode.value === 'custom';
  $('#stock-transfer-quantity-field').hidden = !custom;
  form.elements.quantity.disabled = !custom;
  form.elements.quantity.required = custom;
  form.querySelectorAll('[data-stock-transfer-quantity-step]').forEach(button => { button.hidden = !custom; });
  if (custom) requestAnimationFrame(() => form.elements.quantity.select());
}

function openStockTransferDialog(entry, destinationId) {
  const maximum = Number(entry?.quantity) || 0;
  const collection = isLooseCollection(entry);
  if (!entry || (!collection && maximum <= 0)) return;
  const activeLocations = state.storageLocations.filter(location => location.status === 'ACTIVE');
  const destinations = activeLocations.filter(location => location.id !== entry.sourceStorageLocationId);
  const destination = destinationId ? destinations.find(location => location.id === destinationId) : null;
  if (destinationId && !destination) return;
  if (!destinations.length) return toast('Es gibt keinen anderen aktiven Lagerort als Ziel.');
  const orderedLocations = storageLocationTree(activeLocations);
  const form = $('#stock-transfer-form');
  form.reset();
  form.elements.entryId.value = entry.id || '';
  form.elements.itemId.value = entry.itemId;
  form.elements.trackingMode.value = entry.trackingMode || 'QUANTITY';
  form.elements.sourceStorageLocationId.value = entry.sourceStorageLocationId;
  form.elements.destinationStorageLocationId.innerHTML = orderedLocations.map(({ location, depth }) => {
    const source = location.id === entry.sourceStorageLocationId;
    const selected = destination ? location.id === destination.id : source;
    return `<option value="${source ? '' : escapeHtml(location.id)}"${source ? ' disabled' : ''}${selected ? ' selected' : ''}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(location.name)}${source ? ' (aktueller Lagerort)' : ''}</option>`;
  }).join('');
  form.elements.destinationStorageLocationId.value = destinationId || '';
  $('[data-stock-transfer-destination-field]').hidden = Boolean(destination);
  form.elements.maximumQuantity.value = maximum;
  form.elements.stockUnit.value = entry.stockUnit;
  const wholeUnits = entry.stockUnit.toLocaleLowerCase('de-DE') === 'stück';
  form.dataset.wholeUnits = wholeUnits ? '1' : '';
  form.elements.quantity.max = maximum;
  form.elements.quantity.min = wholeUnits ? 1 : 0.000001;
  form.elements.quantity.step = wholeUnits ? '1' : 'any';
  form.elements.quantity.value = wholeUnits ? '1' : '';
  form.elements.quantity.classList.toggle('whole-units', wholeUnits);
  form.elements.quantityMode.value = 'all';
  $('#stock-transfer-copy').textContent = destination
    ? `${entry.itemName} von ${entry.sourceName} nach ${destination.name}`
    : `${entry.itemName} aus ${entry.sourceName}`;
  $('[data-stock-transfer-quantity-choices]').hidden = collection;
  $('[data-stock-transfer-note]').textContent = collection ? 'Die Lagerortzuordnung der losen Sammlung wird vollständig verschoben.' : 'Bei „Alle verschieben“ verschwindet der Artikel am bisherigen Lagerort. Verlauf und lokale Einstellungen bleiben historisch erhalten.';
  $('#stock-transfer-all-copy').textContent = collection ? '' : `${formatInventoryQuantity(maximum)} ${entry.stockUnit} – gesamter Bestand an diesem Lagerort`;
  $('#stock-transfer-limit').textContent = collection ? '' : `Maximal ${formatInventoryQuantity(maximum)} ${entry.stockUnit}`;
  $('#stock-transfer-error').textContent = '';
  syncStockTransferQuantityMode();
  $('#stock-transfer-dialog').showModal();
}

function clearStorageDragState() {
  document.querySelectorAll('.storage-finder-row.dragging,.storage-finder-row.drop-ready,.storage-finder-row.drop-over,.storage-finder-column.drop-ready-column,.storage-finder-column.drop-over-column').forEach(element => element.classList.remove('dragging', 'drop-ready', 'drop-over', 'drop-ready-column', 'drop-over-column'));
  storageDragEntry = null;
}

function bindStorageTransferDragDrop() {
  document.querySelectorAll('[data-stock-drag-entry]').forEach(row => {
    row.ondragstart = event => {
      storageDragEntry = {
        id:row.dataset.stockDragEntry,
        itemId:row.dataset.stockDragItem,
        itemName:row.dataset.stockDragName,
        sourceStorageLocationId:row.dataset.stockDragSource,
        sourceName:row.dataset.stockDragSourceName,
        quantity:Number(row.dataset.stockDragQuantity),
        stockUnit:row.dataset.stockDragUnit,
        trackingMode:row.dataset.stockDragTracking || 'QUANTITY',
      };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', storageDragEntry.itemName);
      row.classList.add('dragging');
      document.querySelectorAll('[data-storage-drop-target]').forEach(target => {
        if (target.dataset.storageDropTarget !== storageDragEntry.sourceStorageLocationId) target.classList.add('drop-ready');
      });
      document.querySelectorAll('[data-storage-column-drop-target]').forEach(column => {
        if (column.dataset.storageColumnDropTarget !== storageDragEntry.sourceStorageLocationId) column.classList.add('drop-ready-column');
      });
    };
    row.ondragend = clearStorageDragState;
  });
  document.querySelectorAll('[data-storage-drop-target]').forEach(target => {
    const valid = () => storageDragEntry && target.dataset.storageDropTarget !== storageDragEntry.sourceStorageLocationId;
    target.ondragover = event => {
      if (!valid()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };
    target.ondragenter = event => {
      if (!valid()) return;
      event.preventDefault();
      target.classList.add('drop-over');
    };
    target.ondragleave = event => {
      if (!target.contains(event.relatedTarget)) target.classList.remove('drop-over');
    };
    target.ondrop = event => {
      if (!valid()) return;
      event.preventDefault();
      event.stopPropagation();
      const entry = storageDragEntry;
      const destinationId = target.dataset.storageDropTarget;
      clearStorageDragState();
      openStockTransferDialog(entry, destinationId);
    };
  });
  document.querySelectorAll('[data-storage-column-drop-target]').forEach(column => {
    const valid = event => storageDragEntry
      && column.dataset.storageColumnDropTarget !== storageDragEntry.sourceStorageLocationId
      && !event.target.closest('[data-storage-drop-target]');
    column.ondragover = event => {
      if (!valid(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };
    column.ondragenter = event => {
      if (!valid(event)) return;
      event.preventDefault();
      column.classList.add('drop-over-column');
    };
    column.ondragleave = event => {
      if (!column.contains(event.relatedTarget) || event.relatedTarget?.closest('[data-storage-drop-target]')) column.classList.remove('drop-over-column');
    };
    column.ondrop = event => {
      if (!valid(event)) return;
      event.preventDefault();
      const entry = storageDragEntry;
      const destinationId = column.dataset.storageColumnDropTarget;
      clearStorageDragState();
      openStockTransferDialog(entry, destinationId);
    };
  });
}

function clearStorageLocationDragState() {
  document.querySelectorAll('.storage-finder-row.location-dragging,.storage-finder-row.location-move-ready,.storage-finder-row.location-move-over,.storage-finder-column.location-column-move-ready,.storage-finder-column.location-column-move-over').forEach(element => element.classList.remove('location-dragging', 'location-move-ready', 'location-move-over', 'location-column-move-ready', 'location-column-move-over'));
  storageLocationDrag = null;
}

function bindStorageLocationMoveDragDrop() {
  const rows = [...document.querySelectorAll('[data-storage-move-location]')];
  const columns = [...document.querySelectorAll('[data-storage-location-column-target]')];
  const isDescendant = (candidateId, ancestorId) => {
    let candidate = state.storageLocations.find(location => location.id === candidateId);
    while (candidate?.parentId) {
      if (candidate.parentId === ancestorId) return true;
      candidate = state.storageLocations.find(location => location.id === candidate.parentId);
    }
    return false;
  };
  const validDestination = destinationId => storageLocationDrag
    && destinationId !== storageLocationDrag.id
    && destinationId !== storageLocationDrag.parentId
    && !isDescendant(destinationId, storageLocationDrag.id);
  const move = async destinationId => {
    if (!validDestination(destinationId)) return;
    const dragged = storageLocationDrag;
    clearStorageLocationDragState();
    try {
      await api(`/storage-locations/${encodeURIComponent(dragged.id)}`, { method:'PATCH', body:JSON.stringify({ parentId:destinationId || null }) });
      toast(`${dragged.name} wurde umplatziert.`);
      await route();
    } catch (error) { toast(error.message); }
  };
  rows.forEach(row => {
    row.addEventListener('dragstart', event => {
      storageLocationDrag = {
        id:row.dataset.storageMoveLocation,
        parentId:row.dataset.storageMoveParent,
        name:row.dataset.storageMoveName,
      };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', storageLocationDrag.name);
      row.classList.add('location-dragging');
      rows.filter(candidate => validDestination(candidate.dataset.storageMoveLocation)).forEach(candidate => candidate.classList.add('location-move-ready'));
      columns.filter(column => validDestination(column.dataset.storageLocationColumnTarget)).forEach(column => column.classList.add('location-column-move-ready'));
    });
    row.addEventListener('dragend', clearStorageLocationDragState);
    row.addEventListener('dragover', event => {
      if (!validDestination(row.dataset.storageMoveLocation)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('location-move-over');
    });
    row.addEventListener('dragleave', event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('location-move-over');
    });
    row.addEventListener('drop', event => {
      if (!validDestination(row.dataset.storageMoveLocation)) return;
      event.preventDefault();
      event.stopPropagation();
      move(row.dataset.storageMoveLocation);
    });
  });
  columns.forEach(column => {
    const destinationId = () => column.dataset.storageLocationColumnTarget;
    const valid = event => validDestination(destinationId()) && !event.target.closest('[data-storage-drop-target]');
    column.addEventListener('dragover', event => {
      if (!valid(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    column.addEventListener('dragenter', event => {
      if (!valid(event)) return;
      event.preventDefault();
      column.classList.add('location-column-move-over');
    });
    column.addEventListener('dragleave', event => {
      if (!column.contains(event.relatedTarget) || event.relatedTarget?.closest('[data-storage-drop-target]')) column.classList.remove('location-column-move-over');
    });
    column.addEventListener('drop', event => {
      if (!valid(event)) return;
      event.preventDefault();
      move(destinationId());
    });
  });
}

function findReservation(id) {
  return [...state.inventoryReservations, ...state.projectReservations].find(reservation => reservation.id === id);
}

async function reservationProject(projectId) {
  if (state.current?.id === projectId) return state.current;
  const view = await api(`/project-view/${encodeURIComponent(projectId)}`);
  return view.project;
}

function setReservationTaskOptions(project, selectedId = '') {
  const form = $('#reservation-form');
  const tasks = (project?.tasks || []).filter(task => task.status !== 'Erledigt' || task.id === selectedId);
  form.elements.projectEntryId.innerHTML = `<option value="">Gesamtes Projekt</option>${tasks.map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title || 'Arbeitsschritt')}</option>`).join('')}`;
  form.elements.projectEntryId.value = selectedId || '';
}

async function updateReservationAvailability() {
  const form = $('#reservation-form');
  const itemId = form.elements.itemId.value;
  const hint = $('#reservation-availability-hint');
  if (!itemId) { hint.textContent = ''; return; }
  const item = state.inventoryItems.find(candidate => candidate.id === itemId);
  if (isLooseCollection(item)) {
    hint.textContent = 'Die Sammlung kann ohne Menge gleichzeitig mehreren Projekten zugeordnet werden.';
    return;
  }
  try {
    const data = await api(`/stock-entries?itemId=${encodeURIComponent(itemId)}`);
    const summary = data.summary || {};
    hint.textContent = `Aktuell verfügbar: ${formatInventoryQuantity(summary.availableQuantity ?? summary.physicalQuantity ?? 0)} ${summary.stockUnit || ''}. Überbedarf ist zulässig.`;
  } catch { hint.textContent = ''; }
}

function syncReservationQuantityUnit() {
  const form = $('#reservation-form');
  const item = state.inventoryItems.find(candidate => candidate.id === form.elements.itemId.value);
  const collection = isLooseCollection(item);
  const quantityField = form.querySelector('[data-reservation-quantity-field]');
  quantityField.hidden = collection;
  const wholeUnits = item?.stockUnit.toLocaleLowerCase('de-DE') === 'stück';
  const input = form.elements.requestedQuantity;
  input.disabled = collection;
  input.required = !collection;
  input.min = wholeUnits ? '1' : '0.000001';
  input.step = wholeUnits ? '1' : 'any';
  input.classList.toggle('whole-units', wholeUnits);
  form.querySelectorAll('[data-reservation-quantity-step]').forEach(button => { button.hidden = !wholeUnits; });
  if (wholeUnits && input.value === '') input.value = '1';
  $('#reservation-dialog-copy').textContent = collection
    ? 'Die Projektbuchung merkt sich die Verwendung dieser losen Sammlung. Eine Menge wird nicht erfasst; weitere Projekte können dieselbe Sammlung ebenfalls buchen.'
    : 'Die Reservierung plant Bedarf, ohne den physischen Bestand zu verändern.';
  $('#reservation-submit').textContent = collection ? 'Auf Projekt buchen' : 'Reservieren';
  const editing = Boolean(form.elements.reservationId.value);
  $('#reservation-dialog-title').textContent = collection
    ? (editing ? 'Projektbuchung bearbeiten' : 'Lose Sammlung auf Projekt buchen')
    : (editing ? 'Reservierung bearbeiten' : 'Für Projekt reservieren');
}

async function openReservationDialog({ itemId = '', projectId = '', reservationId = '' } = {}) {
  const reservation = reservationId ? findReservation(reservationId) : null;
  if (reservationId && !reservation) return toast('Reservierung nicht gefunden.');
  const form = $('#reservation-form');
  form.reset();
  const fixedItemId = reservation?.itemId || itemId;
  const fixedProjectId = reservation?.projectId || projectId;
  if (!state.inventoryItems.length || projectId) await loadInventoryItems(false, '');
  const items = state.inventoryItems.filter(item => item.status === 'ACTIVE' || item.id === fixedItemId);
  form.elements.itemId.innerHTML = items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${isLooseCollection(item) ? 'Lose Sammlung' : escapeHtml(item.stockUnit)}</option>`).join('');
  if (fixedItemId) form.elements.itemId.value = fixedItemId;

  const projectData = await api('/projects');
  state.reservationProjects = (projectData.projects || []).filter(project => !['completed','archived','trashed'].includes(project.status) || project.id === fixedProjectId);
  form.elements.projectId.innerHTML = `<option value="" disabled>Projekt auswählen</option>${state.reservationProjects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join('')}`;
  if (fixedProjectId) form.elements.projectId.value = fixedProjectId;
  else form.elements.projectId.value = '';
  if (!form.elements.itemId.value) return toast('Für eine Reservierung wird ein aktiver Artikel benötigt.');
  if (!state.reservationProjects.length) return toast('Für eine Reservierung wird ein aktives Projekt benötigt.');

  if (form.elements.projectId.value) setReservationTaskOptions(await reservationProject(form.elements.projectId.value), reservation?.projectEntryId || '');
  else setReservationTaskOptions(null);
  form.elements.projectEntryId.disabled = !form.elements.projectId.value;
  form.elements.reservationId.value = reservation?.id || '';
  form.elements.requestedQuantity.value = reservation?.requestedQuantity ?? '';
  syncReservationQuantityUnit();
  form.elements.note.value = reservation?.note || '';
  $('[data-reservation-item-field]').hidden = Boolean(fixedItemId);
  $('[data-reservation-project-field]').hidden = Boolean(fixedProjectId);
  form.elements.itemId.disabled = Boolean(reservation);
  form.elements.projectId.disabled = Boolean(reservation);
  $('#reservation-error').textContent = '';
  await updateReservationAvailability();
  $('#reservation-dialog').showModal();
}

async function openReservationFulfillDialog(reservationId) {
  const reservation = findReservation(reservationId);
  if (!reservation) return toast('Reservierung nicht gefunden.');
  if (reservation.trackingMode === 'COLLECTION') return toast('Lose Sammlungen werden ohne Menge gebucht und nicht entnommen.');
  const data = await api(`/stock-entries?itemId=${encodeURIComponent(reservation.itemId)}`);
  const entries = (data.entries || []).filter(entry => entry.status === 'ACTIVE' && entry.quantity > 0);
  if (!entries.length) return toast('Für diesen Artikel ist kein physischer Bestand verfügbar.');
  const form = $('#reservation-fulfill-form');
  form.reset();
  form.elements.reservationId.value = reservation.id;
  form.dataset.remainingQuantity = reservation.remainingQuantity;
  form.elements.sourceStorageLocationId.innerHTML = entries.map(entry => `<option value="${escapeHtml(entry.storageLocationId)}" data-quantity="${escapeHtml(entry.quantity)}">${escapeHtml(stockLocationPath(entry))} · ${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(entry.stockUnit)}</option>`).join('');
  syncReservationFulfillLimit();
  $('#reservation-fulfill-copy').textContent = `${reservation.itemName} · noch ${formatInventoryQuantity(reservation.remainingQuantity)} ${reservation.stockUnit} offen`;
  $('#reservation-fulfill-error').textContent = '';
  $('#reservation-fulfill-dialog').showModal();
}

function syncReservationFulfillLimit() {
  const form = $('#reservation-fulfill-form');
  const remaining = Number(form.dataset.remainingQuantity) || 0;
  const available = Number(form.elements.sourceStorageLocationId.selectedOptions[0]?.dataset.quantity) || 0;
  const maximum = Math.min(remaining, available);
  form.elements.quantity.max = maximum;
  if (!Number(form.elements.quantity.value) || Number(form.elements.quantity.value) > maximum) form.elements.quantity.value = maximum;
}

function bindReservationActions() {
  document.querySelectorAll('[data-reservation-create]').forEach(button => button.onclick = () => openReservationDialog({ itemId:button.dataset.reservationItem || '', projectId:button.dataset.reservationProject || '' }));
  document.querySelectorAll('[data-reservation-edit]').forEach(button => button.onclick = () => openReservationDialog({ reservationId:button.dataset.reservationEdit }));
  document.querySelectorAll('[data-reservation-fulfill]').forEach(button => button.onclick = () => openReservationFulfillDialog(button.dataset.reservationFulfill));
  document.querySelectorAll('[data-reservation-release]').forEach(button => button.onclick = async () => {
    const reservation = findReservation(button.dataset.reservationRelease);
    const collection = reservation?.trackingMode === 'COLLECTION';
    if (!await confirmAction(collection ? 'Diese Projektbuchung aufheben?' : 'Diese Reservierung aufheben? Der offene Bedarf wird wieder verfügbar.', { title:collection ? 'Projektbuchung aufheben' : 'Reservierung aufheben', confirmLabel:'Aufheben' })) return;
    try { await api(`/reservations/${encodeURIComponent(button.dataset.reservationRelease)}/release`, { method:'POST', body:'{}' }); toast(collection ? 'Projektbuchung aufgehoben.' : 'Reservierung aufgehoben.'); await route(); }
    catch (error) { toast(error.message); }
  });
}

function bindInventoryItemActions() {
  const main = $('#main');
  main.onclick = state.inventoryStockItem ? event => {
    if (event.target === main && location.hash.startsWith('#/inventory/item/')) location.href = inventoryItemHref('', state.inventoryItemsIncludeArchived, state.inventoryItemQuery, state.inventoryItemCategoryFilter, state.inventoryItemSort, state.inventoryItemSortDirection);
  } : null;
  document.querySelectorAll('[data-inventory-item-route]').forEach(row => {
    const open = event => {
      if (event.target.closest('a,button,details,summary')) return;
      location.href = row.dataset.inventoryItemRoute;
    };
    row.onclick = open;
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } };
  });
  document.querySelectorAll('[data-inventory-item-create]').forEach(button => button.onclick = () => openInventoryItemDialog());
  document.querySelectorAll('[data-inventory-item-edit]').forEach(button => button.onclick = () => openInventoryItemDialog(button.dataset.inventoryItemEdit));
  document.querySelectorAll('[data-inventory-item-archive]').forEach(button => button.onclick = async () => {
    const name = button.dataset.inventoryItemName || 'Diesen Artikel';
    if (!await confirmAction(`„${name}“ archivieren? Historische Verweise bleiben erhalten.`, { title:'Artikel archivieren', confirmLabel:'Archivieren' })) return;
    try {
      await api(`/inventory-items/${encodeURIComponent(button.dataset.inventoryItemArchive)}/archive`, { method:'POST', body:'{}' });
      toast('Artikel archiviert.');
      location.href = inventoryItemHref('', state.inventoryItemsIncludeArchived, state.inventoryItemQuery, state.inventoryItemCategoryFilter, state.inventoryItemSort, state.inventoryItemSortDirection);
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-inventory-item-restore]').forEach(button => button.onclick = async () => {
    try {
      await api(`/inventory-items/${encodeURIComponent(button.dataset.inventoryItemRestore)}/restore`, { method:'POST', body:'{}' });
      toast('Artikel wiederhergestellt.');
      await route();
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-inventory-item-copy-link]').forEach(button => button.onclick = async () => {
    const url = new URL(inventoryItemHref(button.dataset.inventoryItemCopyLink, false, ''), location.origin).href;
    try { await navigator.clipboard.writeText(url); toast('Artikel-Link kopiert.'); }
    catch { toast('Der Link konnte nicht kopiert werden.'); }
  });
  document.querySelectorAll('[data-inventory-item-note-create]').forEach(button => button.onclick = () => openInventoryItemNoteDialog(button.dataset.inventoryItemNoteCreate));
  document.querySelectorAll('[data-inventory-item-note-edit]').forEach(button => button.onclick = () => openInventoryItemNoteDialog(button.dataset.inventoryItem, button.dataset.inventoryItemNoteEdit));
  document.querySelectorAll('[data-inventory-item-note-delete]').forEach(button => button.onclick = async () => {
    if (!await confirmAction('Diese Notiz endgültig löschen?', { title:'Notiz löschen', confirmLabel:'Endgültig löschen' })) return;
    try {
      await api(`/inventory-items/${encodeURIComponent(button.dataset.inventoryItem)}/notes/${encodeURIComponent(button.dataset.inventoryItemNoteDelete)}`, { method:'DELETE', body:'{}' });
      toast('Notiz gelöscht.');
      await route();
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-stock-entry-create]').forEach(button => button.onclick = () => openStockEntryDialog(button.dataset.stockEntryCreate));
  document.querySelectorAll('[data-stock-entry-edit]').forEach(button => button.onclick = () => openStockEntryDialog(state.inventoryStockItem?.id || '', button.dataset.stockEntryEdit));
  document.querySelectorAll('[data-stock-entry-delete]').forEach(button => button.onclick = async () => {
    if (!await confirmAction('Diese leere Zuordnung entfernen? Die Buchungshistorie bleibt erhalten. Lokaler Mindestbestand und Notiz werden gelöscht.', { title:'Zuordnung entfernen', confirmLabel:'Entfernen' })) return;
    try { await api(`/stock-entries/${encodeURIComponent(button.dataset.stockEntryDelete)}`, { method:'DELETE' }); toast('Zuordnung entfernt.'); await route(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-stock-transfer-menu]').forEach(button => button.onclick = () => openStockTransferDialog({
    id:button.dataset.stockEntry,
    itemId:button.dataset.stockItem,
    itemName:button.dataset.stockName,
    sourceStorageLocationId:button.dataset.stockSource,
    sourceName:button.dataset.stockSourceName,
    quantity:Number(button.dataset.stockQuantity),
    stockUnit:button.dataset.stockUnit,
    trackingMode:button.dataset.stockTracking,
  }, ''));
  document.querySelectorAll('[data-stock-movement]').forEach(button => button.onclick = () => openStockMovementDialog(button.dataset.stockItem || state.inventoryStockItem?.id || '', button.dataset.stockMovement, button.dataset.stockSource || ''));
  bindReservationActions();
  const search = $('#inventory-item-search');
  let inventorySearchTimer;
  const navigateInventorySearch = () => {
    location.href = inventoryItemHref('', state.inventoryItemsIncludeArchived, search.elements.q.value.trim(), search.elements.category.value, state.inventoryItemSort, state.inventoryItemSortDirection);
  };
  if (search) search.onsubmit = event => {
    event.preventDefault();
    navigateInventorySearch();
  };
  if (search?.elements.q) search.elements.q.oninput = () => {
    clearTimeout(inventorySearchTimer);
    inventorySearchTimer = setTimeout(navigateInventorySearch, 300);
  };
  if (search?.elements.category) search.elements.category.onchange = () => {
    navigateInventorySearch();
  };
  const clear = $('[data-clear-inventory-search]');
  if (clear) clear.onclick = () => { location.href = inventoryItemHref('', state.inventoryItemsIncludeArchived, '', ''); };
}

function fitInventoryWorkspaces() {
  const compact = window.matchMedia('(max-width:780px)').matches;
  const main = $('#main');
  ['.storage-finder-frame', '.inventory-item-shell'].forEach(selector => {
    const workspace = $(selector);
    if (!workspace) return;
    if (compact) {
      workspace.style.removeProperty('height');
      return;
    }
    const bottomGap = workspace.classList.contains('storage-finder-edge-to-edge') ? 0 : main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    const available = window.innerHeight - workspace.getBoundingClientRect().top - bottomGap;
    workspace.style.height = `${Math.max(260, available)}px`;
  });
}

function revealFinderItemInspector() {
  const shell = $('[data-storage-finder-shell]');
  const inspector = shell?.querySelector('[data-finder-item-inspector]');
  if (!shell || !inspector || window.matchMedia('(max-width:780px)').matches) return false;
  const shellBounds = shell.getBoundingClientRect();
  const inspectorBounds = inspector.getBoundingClientRect();
  if (inspectorBounds.right > shellBounds.right) shell.scrollTo({ left:shell.scrollLeft + inspectorBounds.right - shellBounds.right, behavior:'smooth' });
  else if (inspectorBounds.left < shellBounds.left) shell.scrollTo({ left:Math.max(0, shell.scrollLeft - (shellBounds.left - inspectorBounds.left)), behavior:'smooth' });
  return true;
}

function inventoryItemCategoryFilterOptions(selectedId = '') {
  return `<option value="">Alle Kategorien</option>${inventoryCategoryTree(state.inventoryCategories).map(({ category, depth }) => `<option value="${escapeHtml(category.id)}"${category.id === selectedId ? ' selected' : ''}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(category.name)}</option>`).join('')}`;
}

function sortInventoryItems(items, sort, direction) {
  const collator = new Intl.Collator('de', { sensitivity:'base', numeric:true });
  const compareText = (left, right) => collator.compare(String(left || ''), String(right || ''));
  const compare = (left, right) => {
    let result = 0;
    if (sort === 'manufacturer') result = compareText(left.manufacturer, right.manufacturer) || compareText(left.articleNumber, right.articleNumber);
    else if (sort === 'physical') result = Number(left.physicalQuantity || 0) - Number(right.physicalQuantity || 0);
    else if (sort === 'reserved') result = Number(left.reservedQuantity || 0) - Number(right.reservedQuantity || 0);
    else if (sort === 'available') result = Number(left.availableQuantity || 0) - Number(right.availableQuantity || 0);
    else result = compareText(left.name, right.name);
    if (!result) result = compareText(left.name, right.name);
    return direction === 'desc' ? -result : result;
  };
  return [...items].sort(compare);
}

async function renderInventoryItems(itemId = '', includeArchived = false, query = '', categoryId = '', sort = 'name', direction = 'asc') {
  await Promise.all([loadInventoryItems(includeArchived, query), loadInventoryCategories()]);
  const selectedCategory = state.inventoryCategories.find(category => category.id === categoryId);
  categoryId = selectedCategory?.id || '';
  sort = ['name','manufacturer','physical','reserved','available'].includes(sort) ? sort : 'name';
  direction = direction === 'desc' ? 'desc' : 'asc';
  state.inventoryItemCategoryFilter = categoryId;
  state.inventoryItemSort = sort;
  state.inventoryItemSortDirection = direction;
  const current = itemId ? await api(`/inventory-items/${encodeURIComponent(itemId)}`) : null;
  if (current && !state.inventoryItems.some(item => item.id === current.id)) state.inventoryItems.unshift(current);
  const [stockData, transactionData, reservationData, noteData] = current ? await Promise.all([
    api(`/stock-entries?itemId=${encodeURIComponent(current.id)}&includeArchived=1`),
    api(`/stock-transactions?itemId=${encodeURIComponent(current.id)}&limit=100`),
    api(`/reservations?itemId=${encodeURIComponent(current.id)}`),
    api(`/inventory-items/${encodeURIComponent(current.id)}/notes`),
  ]) : [{ entries:[], summary:null }, { transactions:[] }, { reservations:[] }, { notes:[] }];
  state.inventoryStockItem = current;
  state.inventoryStockEntries = stockData.entries || [];
  state.inventoryStockTransactions = transactionData.transactions || [];
  state.inventoryReservations = reservationData.reservations || [];
  state.inventoryItemNotes = noteData.notes || [];
  const categoryIds = categoryId ? inventoryCategoryDescendants(categoryId) : new Set();
  if (categoryId) categoryIds.add(categoryId);
  const filteredItems = categoryId ? state.inventoryItems.filter(item => (item.categoryIds || []).some(id => categoryIds.has(id))) : state.inventoryItems;
  const visibleItems = sortInventoryItems(filteredItems, sort, direction);
  const rows = visibleItems.map(item => inventoryItemRow(item, current?.id || '', categoryId, sort, direction)).join('');
  const empty = query || categoryId ? `<div class="inventory-item-empty"><strong>Keine passenden Artikel.</strong><span>Ändere den Suchbegriff oder die gewählte Kategorie.</span></div>` : `<div class="inventory-item-empty"><strong>Noch keine Artikel vorhanden.</strong>${mayEditProjects() ? '<button class="button primary compact" type="button" data-inventory-item-create>Ersten Artikel anlegen</button>' : ''}</div>`;
  const inventoryItemsHead = standardPageHeader({ title:'Artikel', description:'Artikelstammdaten unabhängig von Lagerort und Bestand.', icon:'tag', actions:mayEditProjects() ? '<button class="button primary compact" type="button" data-inventory-item-create>Artikel anlegen</button>' : '', className:'storage-finder-page-head inventory-items-page-head' });
  $('#main').innerHTML = `${inventoryItemsHead}<form id="inventory-item-search" class="inventory-item-search" role="search"><span aria-hidden="true">${iconSvg('search')}</span><input name="q" type="search" maxlength="200" value="${escapeHtml(query)}" placeholder="Name, Hersteller, Artikelnummer oder Barcode" aria-label="Artikel durchsuchen"><label class="inventory-item-category-filter"><span class="visually-hidden">Nach Kategorie filtern</span><select name="category" aria-label="Nach Kategorie filtern">${inventoryItemCategoryFilterOptions(categoryId)}</select></label>${query || categoryId ? '<button class="button secondary compact" type="button" data-clear-inventory-search>Zurücksetzen</button>' : ''}</form><div class="inventory-item-shell${current ? ' has-selection' : ''}"><section class="inventory-item-list-panel" aria-label="Artikelliste">${rows ? inventoryItemTable(rows, sort, direction) : empty}</section>${inventoryItemDetail(current, includeArchived, stockData, transactionData.transactions || [], reservationData.reservations || [], noteData.notes || [], categoryId, sort, direction)}</div>`;
  requestAnimationFrame(fitInventoryWorkspaces);
  document.title = current ? `${current.name} · Artikel · Logbuch` : 'Artikel · Lager · Logbuch';
  bindInventoryItemActions();
}

function replenishmentReasonMarkup(item) {
  const reasons = [];
  if (item.projectShortageQuantity > 0) reasons.push(`<span class="project">Projektbedarf fehlt: ${escapeHtml(formatInventoryQuantity(item.projectShortageQuantity))} ${escapeHtml(item.stockUnit)}</span>`);
  if (item.globalReorderQuantity > 0 && item.minimumQuantity !== null) reasons.push('<span>Globaler Mindestbestand</span>');
  if (item.localReorderQuantity > 0) reasons.push('<span>Lagerort-Mindestbestand</span>');
  return reasons.join('');
}

function replenishmentItemMarkup(item) {
  const local = (item.localShortages || []).map(shortage => `<a href="${storageLocationHref(shortage.storageLocationId)}"><span>${escapeHtml((shortage.locationPath || []).map(part => part.name).join(' › ') || shortage.locationName)}</span><strong>${escapeHtml(formatInventoryQuantity(shortage.quantity))} / ${escapeHtml(formatInventoryQuantity(shortage.minimumQuantity))} ${escapeHtml(item.stockUnit)}</strong></a>`).join('');
  const metadata = [item.manufacturer, item.articleNumber].filter(Boolean).join(' · ');
  const satisfied = item.reorderQuantity <= 0;
  return `<article class="replenishment-item${satisfied ? ' satisfied' : ''}"><header><div><div class="replenishment-reasons">${replenishmentReasonMarkup(item) || '<span class="satisfied">Kein Fehlbedarf</span>'}</div><h2><a href="${inventoryItemHref(item.itemId, false, '')}">${escapeHtml(item.name)}</a></h2>${metadata ? `<p>${escapeHtml(metadata)}</p>` : ''}</div><div class="replenishment-order"><span>${satisfied ? 'Vorschlag' : 'Nachbestellen'}</span><strong>${escapeHtml(formatInventoryQuantity(item.reorderQuantity))} ${escapeHtml(item.stockUnit)}</strong></div></header><div class="replenishment-metrics"><div><span>Physisch</span><strong>${escapeHtml(formatInventoryQuantity(item.physicalQuantity))}</strong></div><div><span>Reserviert</span><strong>${escapeHtml(formatInventoryQuantity(item.reservedQuantity))}</strong></div><div class="${item.availableQuantity < 0 ? 'negative' : ''}"><span>Verfügbar</span><strong>${escapeHtml(formatInventoryQuantity(item.availableQuantity))}</strong></div><div><span>Globales Minimum</span><strong>${item.minimumQuantity === null ? '–' : escapeHtml(formatInventoryQuantity(item.minimumQuantity))}</strong></div></div>${local ? `<details class="replenishment-local"><summary>${item.localShortages.length} ${item.localShortages.length === 1 ? 'Lagerort' : 'Lagerorte'} unter lokalem Minimum</summary><div>${local}</div></details>` : ''}<footer><a class="button secondary compact" href="${inventoryItemHref(item.itemId, false, '')}">Artikel öffnen</a>${item.merchantUrl ? `<a class="button primary compact" href="${escapeHtml(item.merchantUrl)}" target="_blank" rel="noopener noreferrer">Beim Händler öffnen</a>` : '<span class="replenishment-no-merchant">Kein Händlerlink hinterlegt</span>'}</footer></article>`;
}

async function renderInventoryReplenishment(routeQuery) {
  const query = (routeQuery.get('q') || '').trim().slice(0, 200);
  const includeSatisfied = routeQuery.get('all') === '1';
  const sort = ['urgency','name','available','reorder'].includes(routeQuery.get('sort')) ? routeQuery.get('sort') : 'urgency';
  const params = new URLSearchParams({ sort });
  if (query) params.set('q', query);
  if (includeSatisfied) params.set('includeSatisfied', '1');
  const data = await api(`/inventory-replenishment?${params}`);
  const summary = data.summary || { itemCount:0, projectShortageCount:0, localShortageCount:0, unitTotals:{} };
  const totals = Object.entries(summary.unitTotals || {}).map(([unit, quantity]) => `${formatInventoryQuantity(quantity)} ${unit}`).join(' · ') || 'Kein Nachbestellbedarf';
  const cards = (data.items || []).map(replenishmentItemMarkup).join('') || `<div class="empty replenishment-empty"><strong>${query ? 'Keine passenden Artikel.' : 'Aktuell ist nichts nachzubestellen.'}</strong>${query ? 'Passe den Suchbegriff oder die Ansicht an.' : 'Verfügbare Mengen und lokale Mindestbestände sind ausreichend.'}</div>`;
  const replenishmentHead = standardPageHeader({ title:'Nachbestellen', description:'Projektbedarf und Mindestbestände in einer gemeinsamen, berechneten Übersicht.', icon:'shopping-cart', className:'storage-finder-page-head replenishment-page-head' });
  $('#main').innerHTML = `${replenishmentHead}<section class="replenishment-summary" aria-label="Fehlbedarfsübersicht"><div><span>Angezeigte Artikel</span><strong>${summary.itemCount}</strong></div><div><span>Mit Projektfehlbedarf</span><strong>${summary.projectShortageCount}</strong></div><div><span>Mit lokalem Fehlbestand</span><strong>${summary.localShortageCount}</strong></div><div><span>Summen nach Einheit</span><strong>${escapeHtml(totals)}</strong></div></section><form id="replenishment-controls" class="replenishment-controls" role="search"><label class="replenishment-query">Artikel suchen<input name="q" type="search" maxlength="200" value="${escapeHtml(query)}" placeholder="Name, Hersteller, Artikelnummer oder Barcode"></label><label>Ansicht<select name="view"><option value="shortage"${includeSatisfied ? '' : ' selected'}>Nur Nachbestellbedarf</option><option value="all"${includeSatisfied ? ' selected' : ''}>Alle aktiven Artikel</option></select></label><label>Sortierung<select name="sort"><option value="urgency"${sort === 'urgency' ? ' selected' : ''}>Dringlichkeit</option><option value="reorder"${sort === 'reorder' ? ' selected' : ''}>Nachbestellmenge</option><option value="available"${sort === 'available' ? ' selected' : ''}>Verfügbarkeit</option><option value="name"${sort === 'name' ? ' selected' : ''}>Artikelname</option></select></label>${query || includeSatisfied || sort !== 'urgency' ? '<button class="button secondary compact" type="button" data-reset-replenishment>Zurücksetzen</button>' : ''}</form><section class="replenishment-list" aria-live="polite">${cards}</section>`;
  document.title = 'Nachbestellen · Lager · Logbuch';
  const form = $('#replenishment-controls');
  const navigate = () => { location.href = inventoryReplenishmentHref(form.elements.q.value.trim(), form.elements.view.value === 'all', form.elements.sort.value); };
  form.onsubmit = event => { event.preventDefault(); navigate(); };
  let replenishmentSearchTimer;
  form.elements.q.oninput = () => {
    clearTimeout(replenishmentSearchTimer);
    replenishmentSearchTimer = setTimeout(navigate, 300);
  };
  form.elements.view.onchange = navigate;
  form.elements.sort.onchange = navigate;
  form.querySelector('[data-reset-replenishment]')?.addEventListener('click', () => { location.href = inventoryReplenishmentHref(); });
}

function storageLocationDescendantIds(id) {
  const descendants = new Set();
  const pending = [id];
  while (pending.length) {
    const parentId = pending.pop();
    state.storageLocations.filter(location => location.parentId === parentId).forEach(location => {
      if (descendants.has(location.id)) return;
      descendants.add(location.id);
      pending.push(location.id);
    });
  }
  return descendants;
}

function storageLocationPath(location, byId = new Map(state.storageLocations.map(item => [item.id, item]))) {
  const path = [];
  const seen = new Set();
  for (let current = location; current; current = current.parentId ? byId.get(current.parentId) : null) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    path.unshift(current);
  }
  return path;
}

const inventoryCategoryHref = (id = '', itemId = '') => `/#/inventory/${id ? `category/${encodeURIComponent(id)}${itemId ? `/item/${encodeURIComponent(itemId)}` : ''}` : 'categories'}`;

function inventoryCategoryTree(categories) {
  const compare = (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name, 'de', { sensitivity:'base', numeric:true });
  const children = parentId => categories.filter(category => category.parentId === parentId).sort(compare);
  const ordered = [];
  const append = (parentId, depth) => children(parentId).forEach(category => { ordered.push({ category, depth }); append(category.id, depth + 1); });
  append(null, 0);
  return ordered;
}

function inventoryCategoryDescendants(id) {
  const result = new Set();
  const visit = parentId => state.inventoryCategories.filter(category => category.parentId === parentId).forEach(category => { result.add(category.id); visit(category.id); });
  visit(id);
  return result;
}

function inventoryCategoryParentOptions(editingId = '', selectedParentId = null) {
  const blocked = editingId ? inventoryCategoryDescendants(editingId) : new Set();
  if (editingId) blocked.add(editingId);
  return `<option value=""${selectedParentId === null ? ' selected' : ''}>Oberste Ebene</option>${inventoryCategoryTree(state.inventoryCategories.filter(category => !blocked.has(category.id))).map(({ category, depth }) => `<option value="${escapeHtml(category.id)}"${category.id === selectedParentId ? ' selected' : ''}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(category.name)}</option>`).join('')}`;
}

function openInventoryCategoryDialog(categoryId = '', parentId = null) {
  const category = categoryId ? state.inventoryCategories.find(candidate => candidate.id === categoryId) : null;
  if (categoryId && !category) return toast('Kategorie nicht gefunden.');
  const form = $('#inventory-category-form');
  form.reset();
  form.elements.categoryId.value = category?.id || '';
  form.elements.name.value = category?.name || '';
  form.elements.icon.value = entityIconName(category, 'folder');
  form.elements.parentId.innerHTML = inventoryCategoryParentOptions(category?.id || '', category ? category.parentId : parentId);
  form.elements.description.value = category?.description || '';
  $('#inventory-category-dialog-title').textContent = category ? 'Kategorie bearbeiten oder verschieben' : 'Kategorie anlegen';
  $('#inventory-category-error').textContent = '';
  $('#inventory-category-delete-zone').hidden = !category;
  $('#inventory-category-delete').disabled = Boolean(category && (category.childCount || category.directItemCount));
  renderIconPicker('inventory-category');
  $('#inventory-category-dialog').showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

function inventoryCategoryActionMenu(category) {
  if (!category || !mayEditProjects()) return '';
  const actions = `<button class="menu-item" type="button" data-category-edit="${escapeHtml(category.id)}">Bearbeiten oder verschieben</button><button class="menu-item" type="button" data-category-copy-link="${escapeHtml(category.id)}">Link kopieren</button>`;
  return contextActionMenu(`Aktionen für ${category.name}`, actions, { className:'storage-finder-column-menu' });
}

function inventoryCategoryCreateControl(parent) {
  if (!parent) return '<button class="storage-finder-column-add" type="button" data-category-create="" aria-label="Hauptkategorie anlegen">+</button>';
  return `<details class="action-menu storage-finder-create-menu"><summary aria-label="In ${escapeHtml(parent.name)} hinzufügen" title="Hinzufügen">+</summary><div class="action-menu-panel"><button class="menu-item" type="button" data-category-create-item="${escapeHtml(parent.id)}"><strong>Neuer Artikel</strong><small>Artikel anlegen und dieser Kategorie zuordnen</small></button><button class="menu-item" type="button" data-category-create="${escapeHtml(parent.id)}"><strong>Unterkategorie</strong><small>Eine Kategorie in ${escapeHtml(parent.name)} anlegen</small></button></div></details>`;
}

function inventoryCategoryRow(category, selectedId = '') {
  const selected = category.id === selectedId;
  return `<article class="storage-finder-row${selected ? ' selected' : ''}" draggable="${mayEditProjects() ? 'true' : 'false'}" data-category-row="${escapeHtml(category.id)}" data-category-drop="${escapeHtml(category.id)}" data-category-drag="${escapeHtml(category.id)}"><a class="storage-finder-link" href="${inventoryCategoryHref(category.id)}" data-storage-parent-href="${inventoryCategoryHref(category.parentId || '')}"${selected ? ' aria-current="page"' : ''}><span class="storage-finder-icon storage-finder-location-icon" aria-hidden="true">${iconSvg(entityIconName(category, 'folder'))}</span><span class="storage-finder-copy"><strong>${escapeHtml(category.name)}</strong><small>${category.childCount ? `${category.childCount} Unterkategorie${category.childCount === 1 ? '' : 'n'}` : ''}${category.childCount && category.directItemCount ? ' · ' : ''}${category.directItemCount ? `${category.directItemCount} Artikel` : ''}</small></span></a></article>`;
}

function inventoryCategoryItemRow(item, categoryId, selectedId = '') {
  return `<article class="storage-finder-row storage-finder-item-row${item.id === selectedId ? ' selected' : ''}" draggable="${mayEditProjects() ? 'true' : 'false'}" data-category-item-drag="${escapeHtml(item.id)}"><a class="storage-finder-link" href="${inventoryCategoryHref(categoryId, item.id)}" data-storage-parent-href="${inventoryCategoryHref(categoryId)}"${item.id === selectedId ? ' aria-current="page"' : ''}><span class="storage-finder-icon storage-finder-item-icon" aria-hidden="true">${iconSvg('tag')}</span><span class="storage-finder-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.stockUnit)}</small></span></a></article>`;
}

function inventoryCategoryColumn(parent, children, items, selectedCategoryId = '', selectedItemId = '', current = false) {
  const parentId = parent?.id || '';
  const rows = children.map(category => inventoryCategoryRow(category, selectedCategoryId)).join('') + (parent ? items.map(item => inventoryCategoryItemRow(item, parent.id, selectedItemId)).join('') : '');
  return `<section class="storage-finder-column" data-category-column="${escapeHtml(parentId)}"${current ? ' data-finder-current-column' : ''}><header><strong>${escapeHtml(parent?.name || 'Kategorien')}</strong><div class="storage-finder-column-actions">${mayEditProjects() ? inventoryCategoryCreateControl(parent) : ''}${inventoryCategoryActionMenu(parent)}</div></header><div class="storage-finder-list" data-category-clear-selection="${escapeHtml(parentId)}">${rows || `<div class="storage-finder-empty"><span>${parent ? 'Noch keine Unterkategorien oder Artikel' : 'Noch keine Kategorien'}</span></div>`}</div></section>`;
}

function inventoryCategoryItemInspector(category, item, stockData) {
  const categories = (item.categoryIds || []).map(id => state.inventoryCategories.find(candidate => candidate.id === id)).filter(Boolean);
  const menu = `<details class="action-menu storage-finder-column-menu"><summary aria-label="Menü für ${escapeHtml(item.name)}">${iconSvg('ellipsis')}</summary><div class="action-menu-panel">${mayEditProjects() && (item.categoryIds || []).includes(category.id) ? `<button class="menu-item danger" type="button" data-category-item-remove="${escapeHtml(item.id)}" data-category-id="${escapeHtml(category.id)}">Aus dieser Kategorie entfernen</button>` : ''}<a class="menu-item" href="${inventoryItemHref(item.id)}">Vollständige Artikeldetails</a></div></details>`;
  return `<aside class="storage-finder-detail storage-item-detail" data-finder-item-inspector><header class="storage-finder-detail-header"><strong>${escapeHtml(item.name)}</strong><div class="storage-finder-column-actions">${inventoryItemDetailsButton(item)}${menu}</div></header><div class="storage-finder-detail-body">${inventoryItemOverview(item, stockData.summary || {})}<section class="category-item-memberships"><h3>Kategorien</h3><div>${categories.map(candidate => `<a class="tag-chip" href="${inventoryCategoryHref(candidate.id, item.id)}">${escapeHtml(candidate.name)}</a>`).join('') || '<span>Keine Kategorie</span>'}</div></section></div></aside>`;
}

function bindInventoryCategoryActions() {
  document.querySelectorAll('[data-category-create]').forEach(button => button.onclick = () => openInventoryCategoryDialog('', button.dataset.categoryCreate || null));
  document.querySelectorAll('[data-category-create-item]').forEach(button => button.onclick = () => {
    button.closest('details')?.removeAttribute('open');
    openInventoryItemDialog('', '', button.dataset.categoryCreateItem);
  });
  document.querySelectorAll('[data-category-edit]').forEach(button => button.onclick = () => openInventoryCategoryDialog(button.dataset.categoryEdit));
  document.querySelectorAll('[data-category-copy-link]').forEach(button => button.onclick = async () => { await navigator.clipboard.writeText(new URL(inventoryCategoryHref(button.dataset.categoryCopyLink), location.origin).href); toast('Kategorie-Link kopiert.'); });
  document.querySelectorAll('[data-category-item-remove]').forEach(button => button.onclick = async () => { if (!await confirmAction('Artikel aus dieser Kategorie entfernen?', { title:'Zuordnung entfernen', confirmLabel:'Entfernen' })) return; await api(`/inventory-categories/${encodeURIComponent(button.dataset.categoryId)}/items/${encodeURIComponent(button.dataset.categoryItemRemove)}`, { method:'DELETE', body:'{}' }); await route(); });
  document.querySelectorAll('[data-category-clear-selection]').forEach(list => list.onclick = event => {
    if (event.target.closest('.storage-finder-row') || inventoryCategoryDrag || inventoryCategoryItemDrag) return;
    location.href = inventoryCategoryHref(list.dataset.categoryClearSelection || '');
  });
  document.querySelectorAll('[data-category-drag]').forEach(row => {
    row.ondragstart = event => { inventoryCategoryDrag = row.dataset.categoryDrag; inventoryCategoryItemDrag = null; event.dataTransfer.effectAllowed = 'move'; };
    row.ondragend = () => { inventoryCategoryDrag = null; };
  });
  document.querySelectorAll('[data-category-item-drag]').forEach(row => {
    row.ondragstart = event => { inventoryCategoryItemDrag = row.dataset.categoryItemDrag; inventoryCategoryDrag = null; event.dataTransfer.effectAllowed = 'copy'; };
    row.ondragend = () => { inventoryCategoryItemDrag = null; };
  });
  const targets = [...document.querySelectorAll('[data-category-drop],[data-category-column]')];
  targets.forEach(target => {
    target.ondragover = event => {
      const targetId = target.dataset.categoryDrop ?? target.dataset.categoryColumn ?? '';
      if (inventoryCategoryItemDrag && targetId) event.preventDefault();
      if (inventoryCategoryDrag && targetId !== inventoryCategoryDrag && !inventoryCategoryDescendants(inventoryCategoryDrag).has(targetId)) event.preventDefault();
    };
    target.ondrop = async event => {
      event.preventDefault(); event.stopPropagation();
      const targetId = target.dataset.categoryDrop ?? target.dataset.categoryColumn ?? '';
      try {
        if (inventoryCategoryItemDrag && targetId) await api(`/inventory-categories/${encodeURIComponent(targetId)}/items`, { method:'POST', body:JSON.stringify({ itemId:inventoryCategoryItemDrag }) });
        else if (inventoryCategoryDrag) await api(`/inventory-categories/${encodeURIComponent(inventoryCategoryDrag)}`, { method:'PATCH', body:JSON.stringify({ parentId:targetId || null }) });
        await route();
      } catch (error) { toast(error.message); }
    };
  });
  bindStorageFinderKeyboard();
}

async function renderInventoryCategories(categoryId = '', itemId = '') {
  await Promise.all([loadInventoryCategories(), loadInventoryItems(false)]);
  const detail = categoryId ? await api(`/inventory-categories/${encodeURIComponent(categoryId)}`) : null;
  const path = detail?.path || [];
  const childrenOf = parentId => state.inventoryCategories.filter(category => category.parentId === parentId);
  const itemSets = await Promise.all(path.map(category => api(`/inventory-categories/${encodeURIComponent(category.id)}/items`)));
  const columns = [inventoryCategoryColumn(null, childrenOf(null), [], path[0]?.id || '', '', path.length === 0)];
  path.forEach((category, index) => columns.push(inventoryCategoryColumn(category, childrenOf(category.id), itemSets[index]?.items || [], path[index + 1]?.id || '', index === path.length - 1 ? itemId : '', index === path.length - 1)));
  const item = itemId ? (itemSets.at(-1)?.items || []).find(candidate => candidate.id === itemId) || await api(`/inventory-items/${encodeURIComponent(itemId)}`) : null;
  const stockData = item ? await api(`/stock-entries?itemId=${encodeURIComponent(item.id)}`) : null;
  const breadcrumbs = `<nav class="folder-breadcrumbs storage-breadcrumbs" aria-label="Kategoriepfad"><a href="${inventoryCategoryHref()}">Kategorien</a>${path.map(category => `<span>›</span><a href="${inventoryCategoryHref(category.id)}">${escapeHtml(category.name)}</a>`).join('')}${item ? `<span>›</span><a aria-current="page" href="${inventoryCategoryHref(categoryId, item.id)}">${escapeHtml(item.name)}</a>` : ''}</nav>`;
  const head = standardPageHeader({ title:'Kategorien', description:'Artikel thematisch ordnen und aus mehreren Blickwinkeln wiederfinden.', icon:'folder', actions:mayEditProjects() ? '<button class="button primary compact" type="button" data-category-create="">Kategorie anlegen</button>' : '', className:'storage-finder-page-head' });
  $('#main').innerHTML = `${head}<div class="storage-finder-frame storage-finder-edge-to-edge"><div class="storage-finder-shell${item ? ' has-item-selection' : ''}" data-storage-finder-shell><div class="storage-finder-columns">${columns.join('')}</div>${item ? inventoryCategoryItemInspector(detail.category, item, stockData) : ''}</div><footer class="storage-finder-statusbar">${breadcrumbs}</footer></div>`;
  document.title = `${item?.name || detail?.category?.name || 'Kategorien'} · Lager · Logbuch`;
  bindInventoryCategoryActions();
  requestAnimationFrame(() => {
    fitInventoryWorkspaces();
    if (!revealFinderItemInspector()) {
      const shell = $('[data-storage-finder-shell]');
      const currentColumn = $('[data-finder-current-column]');
      if (shell && currentColumn && window.matchMedia('(min-width:781px)').matches) shell.scrollLeft = Math.max(0, currentColumn.offsetLeft - shell.clientWidth / 3);
    }
  });
}

function storageLocationTree(locations) {
  const compare = (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    || left.name.localeCompare(right.name, 'de', { sensitivity:'base', numeric:true })
    || left.id.localeCompare(right.id);
  const children = parentId => locations.filter(location => location.parentId === parentId).sort(compare);
  const ordered = [];
  const append = (parentId, depth) => children(parentId).forEach(location => {
    ordered.push({ location, depth });
    append(location.id, depth + 1);
  });
  append(null, 0);
  return ordered;
}

function storageParentOptions(editingId = '', selectedParentId = null) {
  const blocked = editingId ? storageLocationDescendantIds(editingId) : new Set();
  if (editingId) blocked.add(editingId);
  const active = state.storageLocations.filter(location => location.status === 'ACTIVE' && !blocked.has(location.id));
  const ordered = storageLocationTree(active);
  return `<option value=""${selectedParentId === null ? ' selected' : ''}>Oberste Ebene</option>${ordered.map(({ location, depth }) => {
    const selected = location.id === selectedParentId ? ' selected' : '';
    return `<option value="${escapeHtml(location.id)}"${selected}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(location.name)}</option>`;
  }).join('')}`;
}

function syncStorageLocationCreationMode() {
  const form = $('#storage-location-form');
  const editing = Boolean(form.elements.locationId.value);
  const series = !editing && form.elements.creationMode.value === 'series';
  const matrix = !editing && form.elements.creationMode.value === 'matrix';
  $('#storage-location-series-fields').hidden = !series;
  $('#storage-location-matrix-fields').hidden = !matrix;
  $('#storage-location-series-fields').querySelectorAll('input').forEach(input => input.disabled = !series);
  $('#storage-location-matrix-fields').querySelectorAll('input').forEach(input => input.disabled = !matrix);
  $('#storage-location-name-label').textContent = series || matrix ? 'Namensbasis' : 'Name';
  form.elements.name.placeholder = series ? 'z. B. Kiste' : matrix ? 'z. B. Schublade' : 'z. B. Garage';
  $('#storage-location-dialog-copy').textContent = editing
    ? 'Name, Beschreibung und Position dieses Lagerorts bearbeiten.'
    : series
      ? 'Alle Lagerorte werden auf derselben Ebene mit fortlaufenden Namen angelegt.'
      : matrix
        ? 'Buchstaben bilden die Zeilen, Zähler die Plätze jeder Zeile.'
      : 'Lagerorte können beliebig tief ineinander verschachtelt werden.';
  updateStorageLocationSeriesPreview();
  updateStorageLocationMatrixPreview();
  if (!series && !matrix) $('#storage-location-submit').textContent = 'Speichern';
}

function updateStorageLocationSeriesPreview() {
  const form = $('#storage-location-form');
  const preview = $('#storage-location-series-preview');
  const baseName = form.elements.name.value.trim();
  const counterStart = Number(form.elements.counterStart.value);
  const count = Number(form.elements.count.value);
  const valid = baseName && Number.isInteger(counterStart) && counterStart >= 0 && Number.isInteger(count) && count >= 2 && count <= 500;
  preview.textContent = valid
    ? `Erstellt werden „${baseName} ${counterStart}“ bis „${baseName} ${counterStart + count - 1}“ (${count} Lagerorte).`
    : 'Name, Zählerstart und Anzahl ergeben die fortlaufenden Lagerortnamen.';
  if (!form.elements.locationId.value && form.elements.creationMode.value === 'series') $('#storage-location-submit').textContent = valid ? `${count} Lagerorte anlegen` : 'Lagerorte anlegen';
}

function updateStorageLocationMatrixPreview() {
  const form = $('#storage-location-form');
  const preview = $('#storage-location-matrix-preview');
  const baseName = form.elements.name.value.trim();
  const letterStart = form.elements.letterStart.value.trim().toUpperCase();
  const letterEnd = form.elements.letterEnd.value.trim().toUpperCase();
  const counterStart = Number(form.elements.matrixCounterStart.value);
  const counterEnd = Number(form.elements.matrixCounterEnd.value);
  const validLetters = /^[A-Z]$/.test(letterStart) && /^[A-Z]$/.test(letterEnd) && letterStart <= letterEnd;
  const validCounters = Number.isInteger(counterStart) && counterStart >= 0 && Number.isInteger(counterEnd) && counterEnd >= counterStart;
  const count = validLetters && validCounters ? (letterEnd.charCodeAt(0) - letterStart.charCodeAt(0) + 1) * (counterEnd - counterStart + 1) : 0;
  const valid = baseName && validLetters && validCounters && count >= 2 && count <= 500;
  preview.textContent = valid
    ? `Erstellt werden „${baseName} ${letterStart}${counterStart}“ bis „${baseName} ${letterEnd}${counterEnd}“ (${count} Lagerorte).`
    : 'Name, Buchstaben und Zähler müssen eine Matrix mit 2 bis 500 Lagerorten ergeben.';
  if (!form.elements.locationId.value && form.elements.creationMode.value === 'matrix') $('#storage-location-submit').textContent = valid ? `${count} Lagerorte anlegen` : 'Lagermatrix anlegen';
}

function openStorageLocationDialog(locationId = '', parentId = null, creationMode = 'single') {
  const dialog = $('#storage-location-dialog');
  const form = $('#storage-location-form');
  const location = locationId ? state.storageLocations.find(item => item.id === locationId) : null;
  if (locationId && !location) return toast('Lagerort nicht gefunden.');
  form.reset();
  form.elements.locationId.value = location?.id || '';
  form.elements.name.value = location?.name || '';
  form.elements.creationMode.value = !location && ['series', 'matrix'].includes(creationMode) ? creationMode : 'single';
  form.elements.icon.value = entityIconName(location, 'archive');
  form.elements.description.value = location?.description || '';
  form.elements.parentId.innerHTML = storageParentOptions(location?.id || '', location ? location.parentId : parentId);
  $('#storage-location-dialog-title').textContent = location
    ? 'Lagerort bearbeiten oder umplatzieren'
    : form.elements.creationMode.value === 'series'
      ? 'Mehrere Lagerorte anlegen'
      : form.elements.creationMode.value === 'matrix'
        ? 'Lagermatrix anlegen'
        : 'Lagerort anlegen';
  $('#storage-location-error').textContent = '';
  syncStorageLocationCreationMode();
  renderIconPicker('storage-location');
  dialog.showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

function storageLocationActionMenu(location) {
  if (!location || !mayEditProjects()) return '';
  const archived = location.status === 'ARCHIVED';
  const actions = archived
    ? `<button class="menu-item" type="button" data-storage-restore="${escapeHtml(location.id)}">Wiederherstellen</button>`
    : `<button class="menu-item" type="button" data-storage-edit="${escapeHtml(location.id)}">Bearbeiten oder umplatzieren</button><button class="menu-item danger" type="button" data-storage-archive="${escapeHtml(location.id)}" data-storage-name="${escapeHtml(location.name)}">Unterbaum archivieren</button>`;
  return contextActionMenu(`Aktionen für ${location.name}`, actions, { className:'storage-finder-column-menu' });
}

function storageLocationCreateMenu(parent) {
  const parentId = parent?.id || '';
  const itemAction = parent ? `<button class="menu-item" type="button" data-storage-create-item="${escapeHtml(parentId)}"><strong>Neuer Artikel</strong><small>Artikel anlegen und diesem Lagerort zuordnen</small></button>` : '';
  return `<details class="action-menu storage-finder-create-menu"><summary aria-label="${parent ? `In ${escapeHtml(parent.name)} hinzufügen` : 'Lagerort anlegen'}" title="${parent ? 'Hinzufügen' : 'Lagerort anlegen'}">+</summary><div class="action-menu-panel">${itemAction}<button class="menu-item" type="button" data-storage-create-single="${escapeHtml(parentId)}"><strong>Einzelner Lagerort</strong><small>Einen frei benannten Lagerort anlegen</small></button><button class="menu-item" type="button" data-storage-create-series="${escapeHtml(parentId)}"><strong>Mehrere Lagerorte</strong><small>Eine fortlaufend nummerierte Reihe anlegen</small></button><button class="menu-item" type="button" data-storage-create-matrix="${escapeHtml(parentId)}"><strong>Lagermatrix</strong><small>Ein Raster wie A1, A2, B1 … anlegen</small></button></div></details>`;
}

function storageLocationViewControls() {
  const selected = `${state.storageLocationSort}:${state.storageLocationSortDirection}`;
  const sortOptions = [
    ['name:asc', 'Titel · A–Z'],
    ['name:desc', 'Titel · Z–A'],
    ['locations:asc', 'Unterlagerorte · wenig → viele'],
    ['locations:desc', 'Unterlagerorte · viele → wenige'],
    ['items:asc', 'Artikel · wenig → viele'],
    ['items:desc', 'Artikel · viele → wenige'],
    ['updated:desc', 'Zuletzt geändert · neueste zuerst'],
    ['updated:asc', 'Zuletzt geändert · älteste zuerst'],
  ];
  const filtering = !state.storageLocationsShowEmpty;
  return `<div class="project-list-controls storage-view-controls">
    <div class="project-sort-control" data-sort-control data-storage-sort-control><button class="project-tool-toggle" type="button" data-storage-toggle-sort aria-label="Lagerorte sortieren" title="Lagerorte sortieren" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4m-3.5 12.5L16 20l3.5-3.5"></path></svg></button><div class="project-sort-panel" hidden><div class="tag-filter-head"><strong>Lagerorte sortieren</strong></div><div class="project-sort-options">${sortOptions.map(([value, label]) => `<label><input type="radio" name="storage-location-sort" value="${value}"${value === selected ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></div></div>
    <div class="project-filter-control${filtering ? ' has-value' : ''}" data-filter-control data-storage-filter-control><button class="project-tool-toggle" type="button" data-storage-toggle-filter aria-label="Lagerorte filtern" title="Lagerorte filtern" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16l-6.2 7v5l-3.6 1.8V13L4 6Z"></path></svg></button><div class="tag-filter-panel storage-filter-panel" hidden><div class="tag-filter-head"><strong>Lagerorte filtern</strong></div><label class="storage-empty-toggle"><input type="checkbox" data-storage-show-empty${state.storageLocationsShowEmpty ? ' checked' : ''}><span><strong>Leere Lagerorte anzeigen</strong><small>Ohne Artikel im gesamten Unterbaum</small></span></label></div></div>
  </div>`;
}

function sortStorageLocations(locations) {
  const collator = new Intl.Collator('de', { sensitivity:'base', numeric:true });
  const direction = state.storageLocationSortDirection === 'desc' ? -1 : 1;
  return [...locations].sort((left, right) => {
    let result = 0;
    if (state.storageLocationSort === 'locations') result = Number(left.descendantCount || 0) - Number(right.descendantCount || 0);
    else if (state.storageLocationSort === 'items') result = Number(left.subtreeItemCount || 0) - Number(right.subtreeItemCount || 0);
    else if (state.storageLocationSort === 'updated') result = String(left.updatedAt || left.createdAt || '').localeCompare(String(right.updatedAt || right.createdAt || ''));
    else result = collator.compare(left.name || '', right.name || '');
    if (result) return result * direction;
    return collator.compare(left.name || '', right.name || '') || String(left.id).localeCompare(String(right.id));
  });
}

function bindStorageLocationViewControls(locationId = '', itemId = '', includeArchived = false) {
  const sortControl = $('[data-storage-sort-control]');
  const filterControl = $('[data-storage-filter-control]');
  if (!sortControl || !filterControl) return;
  const sortToggle = $('[data-storage-toggle-sort]', sortControl);
  const filterToggle = $('[data-storage-toggle-filter]', filterControl);
  const sortPanel = $('.project-sort-panel', sortControl);
  const filterPanel = $('.tag-filter-panel', filterControl);
  const closePanels = except => {
    if (except !== 'sort') { sortPanel.hidden = true; sortToggle.setAttribute('aria-expanded', 'false'); }
    if (except !== 'filter') { filterPanel.hidden = true; filterToggle.setAttribute('aria-expanded', 'false'); }
  };
  sortToggle.onclick = () => {
    const open = sortPanel.hidden;
    closePanels(open ? 'sort' : '');
    sortPanel.hidden = !open;
    sortToggle.setAttribute('aria-expanded', String(open));
  };
  filterToggle.onclick = () => {
    const open = filterPanel.hidden;
    closePanels(open ? 'filter' : '');
    filterPanel.hidden = !open;
    filterToggle.setAttribute('aria-expanded', String(open));
  };
  const navigate = () => {
    location.href = itemId ? storageContextItemHref(locationId, itemId, includeArchived) : storageLocationHref(locationId, includeArchived);
  };
  sortControl.querySelectorAll('[name="storage-location-sort"]').forEach(input => input.onchange = event => {
    [state.storageLocationSort, state.storageLocationSortDirection] = event.target.value.split(':');
    navigate();
  });
  $('[data-storage-show-empty]', filterControl).onchange = event => {
    state.storageLocationsShowEmpty = event.target.checked;
    navigate();
  };
}

function storageFinderEntry(location, selectedId = '') {
  const archived = location.status === 'ARCHIVED';
  const movable = mayEditProjects() && !archived;
  const selected = location.id === selectedId;
  const descendantCount = Number(location.descendantCount || 0);
  const itemCount = Number(location.subtreeItemCount || 0);
  const counts = `<span class="storage-finder-counts"><span class="storage-finder-count" title="Anzahl aller untergeordneten Lagerorte" aria-label="Anzahl aller untergeordneten Lagerorte: ${descendantCount}"><span aria-hidden="true">${iconSvg('archive')}</span>${descendantCount}</span><span class="storage-finder-count" title="Anzahl unterschiedlicher Artikel in diesem Lagerort und seinem Unterbaum" aria-label="Anzahl unterschiedlicher Artikel in diesem Lagerort und seinem Unterbaum: ${itemCount}"><span aria-hidden="true">${iconSvg('tag')}</span>${itemCount}</span></span>`;
  return `<article class="storage-finder-row storage-finder-location-row${selected ? ' selected' : ''}${archived ? ' archived' : ''}" data-storage-finder-row="${escapeHtml(location.id)}"${archived ? '' : ` data-storage-drop-target="${escapeHtml(location.id)}" data-storage-drop-name="${escapeHtml(location.name)}"`}${movable ? ` draggable="true" data-storage-move-location="${escapeHtml(location.id)}" data-storage-move-parent="${escapeHtml(location.parentId || '')}" data-storage-move-name="${escapeHtml(location.name)}"` : ''}>
    <a class="storage-finder-link" href="${storageLocationHref(location.id)}"${selected ? ' aria-current="page"' : ''} data-storage-parent-href="${storageLocationHref(location.parentId || '')}"><span class="storage-finder-icon storage-finder-location-icon" aria-hidden="true">${iconSvg(entityIconName(location, 'archive'))}</span><span class="storage-finder-copy"><strong>${escapeHtml(location.name)}</strong>${archived ? '<small>Archiviert</small>' : ''}</span>${counts}</a>
  </article>`;
}

function storageFinderItemEntry(entry, parentId, selectedItemId = '', includeArchived = false) {
  const selected = entry.itemId === selectedItemId;
  const archived = entry.itemStatus === 'ARCHIVED' || entry.status === 'ARCHIVED';
  const collection = isLooseCollection(entry);
  const draggable = mayEditProjects() && !archived && (collection || entry.quantity > 0);
  const detail = collection ? 'Lose Sammlung · ohne Mengenerfassung' : `${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(entry.stockUnit)}${entry.minimumQuantity === null ? '' : ` · Min. ${escapeHtml(formatInventoryQuantity(entry.minimumQuantity))}`}`;
  return `<article class="storage-finder-row storage-finder-item-row${selected ? ' selected' : ''}${archived ? ' archived' : ''}" data-storage-finder-item="${escapeHtml(entry.itemId)}"${draggable ? ` draggable="true" data-stock-drag-entry="${escapeHtml(entry.id)}" data-stock-drag-item="${escapeHtml(entry.itemId)}" data-stock-drag-source="${escapeHtml(parentId)}" data-stock-drag-source-name="${escapeHtml(entry.locationName)}" data-stock-drag-name="${escapeHtml(entry.itemName)}" data-stock-drag-quantity="${escapeHtml(entry.quantity)}" data-stock-drag-unit="${escapeHtml(entry.stockUnit)}" data-stock-drag-tracking="${escapeHtml(entry.trackingMode)}"` : ''}>
    <a class="storage-finder-link" href="${storageContextItemHref(parentId, entry.itemId, includeArchived)}"${selected ? ' aria-current="page"' : ''} data-storage-parent-href="${storageLocationHref(parentId, includeArchived)}"><span class="storage-finder-icon storage-finder-item-icon" aria-hidden="true">${iconSvg('tag')}</span><span class="storage-finder-copy"><strong>${escapeHtml(entry.itemName)}</strong><small>${detail}${archived ? ' · Archiviert' : ''}</small></span></a>
  </article>`;
}

function storageFinderColumn(parent, locations, stockEntries = [], selectedLocationId = '', selectedItemId = '', current = false, includeArchived = false) {
  const parentId = parent?.id || '';
  const canAdd = mayEditProjects() && (!parent || parent.status === 'ACTIVE');
  const heading = parent ? parent.name : 'Lagerorte';
  const empty = parent ? 'Noch keine Unterorte oder Artikel' : 'Noch keine Lagerorte';
  const locationRows = locations.map(location => storageFinderEntry(location, selectedLocationId)).join('');
  const itemRows = parent ? [...stockEntries].sort((left, right) => String(left.itemName || '').localeCompare(String(right.itemName || ''), 'de', { sensitivity:'base', numeric:true })).map(entry => storageFinderItemEntry(entry, parentId, selectedItemId, includeArchived)).join('') : '';
  const columnDropTarget = parent && parent.status === 'ACTIVE' ? ` data-storage-column-drop-target="${escapeHtml(parentId)}" data-storage-column-drop-name="${escapeHtml(parent.name)}"` : '';
  const locationColumnDropTarget = !parent || parent.status === 'ACTIVE' ? ` data-storage-location-column-target="${escapeHtml(parentId)}"` : '';
  const headerActions = `${canAdd ? storageLocationCreateMenu(parent) : ''}${storageLocationActionMenu(parent)}`;
  return `<section class="storage-finder-column" data-storage-finder-column data-storage-parent="${escapeHtml(parentId)}"${columnDropTarget}${locationColumnDropTarget}${current ? ' data-finder-current-column' : ''}><header><strong>${escapeHtml(heading)}</strong><div class="storage-finder-column-actions">${headerActions}</div></header><div class="storage-finder-list" data-storage-clear-selection="${escapeHtml(parentId)}">${locationRows || itemRows ? `${locationRows}${itemRows}` : `<div class="storage-finder-empty"><span>${empty}</span></div>`}</div></section>`;
}

function storageFinderItemInspector(location, item, localEntry, stockData, notes, includeArchived) {
  if (!location || !item || !localEntry) return '';
  const summary = stockData.summary || {};
  const archived = item.status === 'ARCHIVED' || localEntry.status === 'ARCHIVED';
  const collection = isLooseCollection(item);
  const unit = item.stockUnit;
  const otherEntries = (stockData.entries || []).filter(entry => entry.status === 'ACTIVE' && entry.storageLocationId !== location.id);
  const localMinimum = localEntry.minimumQuantity === null ? '–' : `${formatInventoryQuantity(localEntry.minimumQuantity)} ${unit}`;
  const otherLocations = otherEntries.length ? `<section class="storage-item-other-locations"><h3>Weitere Lagerorte</h3>${otherEntries.map(entry => `<a href="${storageContextItemHref(entry.storageLocationId, item.id)}"><span>${escapeHtml(stockLocationPath(entry))}</span><strong>${collection ? 'Vorhanden' : `${escapeHtml(formatInventoryQuantity(entry.quantity))} ${escapeHtml(unit)}`}</strong></a>`).join('')}</section>` : '';
  const directConsume = mayEditProjects() && !archived && !collection && localEntry.quantity > 0 ? `<button class="button primary compact storage-item-header-consume" type="button" data-stock-movement="CONSUMPTION" data-stock-source="${escapeHtml(location.id)}">Entnehmen</button>` : '';
  const transferAction = collection || localEntry.quantity > 0 ? `<button class="menu-item" type="button" data-stock-transfer-menu data-stock-entry="${escapeHtml(localEntry.id)}" data-stock-item="${escapeHtml(item.id)}" data-stock-name="${escapeHtml(item.name)}" data-stock-source="${escapeHtml(location.id)}" data-stock-source-name="${escapeHtml(location.name)}" data-stock-quantity="${escapeHtml(localEntry.quantity)}" data-stock-unit="${escapeHtml(unit)}" data-stock-tracking="${escapeHtml(item.trackingMode)}">Umlagern</button>` : '';
  const actions = mayEditProjects() && !archived ? `${transferAction}<button class="menu-item" type="button" data-stock-entry-edit="${escapeHtml(localEntry.id)}">${collection ? 'Lagerortnotiz' : 'Lokaler Mindestbestand'}</button>` : '';
  const itemActions = inventoryItemManagementActions(item);
  const actionSeparator = actions && itemActions ? '<span class="action-menu-separator" aria-hidden="true"></span>' : '';
  const merchant = item.merchantUrl ? `<a class="menu-item storage-item-menu-link" href="${escapeHtml(item.merchantUrl)}" target="_blank" rel="noopener noreferrer">Händler öffnen</a>` : '';
  const menu = contextActionMenu(`Aktionen für ${item.name}`, `${actions}${actionSeparator}${itemActions}${merchant}<a class="menu-item storage-item-menu-link" href="${inventoryItemHref(item.id, archived, '')}">Vollständige Artikeldetails</a>`, { className:'storage-finder-column-menu storage-item-column-menu' });
  const localOverview = collection
    ? `<section class="storage-item-local"><span>In ${escapeHtml(location.name)}</span><strong>Vorhanden</strong><span>Bestandsführung</span><strong class="storage-item-local-minimum">Ohne Menge</strong>${localEntry.note ? `<small>${escapeHtml(localEntry.note)}</small>` : ''}</section>`
    : `<section class="storage-item-local"><span>In ${escapeHtml(location.name)}</span><strong>${escapeHtml(formatInventoryQuantity(localEntry.quantity))} ${escapeHtml(unit)}</strong><span>Lokales Minimum</span><strong class="storage-item-local-minimum">${escapeHtml(localMinimum)}</strong>${localEntry.note ? `<small>${escapeHtml(localEntry.note)}</small>` : ''}</section>`;
  return `<aside class="storage-finder-detail storage-item-detail${archived ? ' archived' : ''}" data-storage-item-detail data-finder-item-inspector><header class="storage-finder-detail-header"><strong>${escapeHtml(item.name)}</strong><div class="storage-finder-column-actions">${directConsume}${inventoryItemDetailsButton(item, archived)}${menu}</div></header><div class="storage-finder-detail-body"><a class="storage-mobile-back" href="${storageLocationHref(location.id, includeArchived)}"><span aria-hidden="true">‹</span>Zurück zu ${escapeHtml(location.name)}</a>${inventoryItemOverview(item, summary, localOverview)}${inventoryItemNotesSection(item, notes, archived)}${otherLocations}</div></aside>`;
}

function bindStorageFinderKeyboard() {
  document.querySelectorAll('.storage-finder-link').forEach(link => link.onkeydown = event => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const links = [...link.closest('.storage-finder-list').querySelectorAll('.storage-finder-link')];
    const index = links.indexOf(link);
    if (event.key === 'ArrowUp') links[Math.max(0, index - 1)]?.focus();
    if (event.key === 'ArrowDown') links[Math.min(links.length - 1, index + 1)]?.focus();
    if (event.key === 'ArrowLeft') location.href = link.dataset.storageParentHref;
    if (event.key === 'ArrowRight') location.href = link.href;
  });
}

function bindStorageFinderBlankNavigation(includeArchived = false) {
  document.querySelectorAll('[data-storage-clear-selection]').forEach(list => list.onclick = event => {
    if (event.target.closest('.storage-finder-row') || storageDragEntry || storageLocationDrag) return;
    location.href = storageLocationHref(list.dataset.storageClearSelection || '', includeArchived);
  });
}

function bindStorageLocationActions() {
  document.querySelectorAll('[data-storage-create-item]').forEach(button => button.onclick = () => {
    button.closest('details')?.removeAttribute('open');
    openInventoryItemDialog('', button.dataset.storageCreateItem);
  });
  document.querySelectorAll('[data-storage-create-single],[data-storage-create-series],[data-storage-create-matrix]').forEach(button => button.onclick = () => {
    button.closest('details')?.removeAttribute('open');
    const mode = button.hasAttribute('data-storage-create-series') ? 'series' : button.hasAttribute('data-storage-create-matrix') ? 'matrix' : 'single';
    const parentId = mode === 'series' ? button.dataset.storageCreateSeries : mode === 'matrix' ? button.dataset.storageCreateMatrix : button.dataset.storageCreateSingle;
    openStorageLocationDialog('', parentId || null, mode);
  });
  document.querySelectorAll('[data-storage-edit]').forEach(button => button.onclick = () => openStorageLocationDialog(button.dataset.storageEdit));
  document.querySelectorAll('[data-storage-archive]').forEach(button => button.onclick = async () => {
    const id = button.dataset.storageArchive;
    const name = button.dataset.storageName || state.storageLocations.find(item => item.id === id)?.name || 'Dieser Lagerort';
    if (!await confirmAction(`„${name}“ und alle enthaltenen Unterorte archivieren? Historische Verweise bleiben erhalten.`, { title:'Lagerorte archivieren', confirmLabel:'Archivieren' })) return;
    try {
      const result = await api(`/storage-locations/${encodeURIComponent(id)}/archive`, { method:'POST', body:'{}' });
      toast(`${result.changed} ${result.changed === 1 ? 'Lagerort wurde' : 'Lagerorte wurden'} archiviert.`);
      await route();
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-storage-restore]').forEach(button => button.onclick = async () => {
    try {
      const result = await api(`/storage-locations/${encodeURIComponent(button.dataset.storageRestore)}/restore`, { method:'POST', body:'{}' });
      toast(`${result.changed} ${result.changed === 1 ? 'Lagerort wurde' : 'Lagerorte wurden'} wiederhergestellt.`);
      await route();
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-storage-copy-link]').forEach(button => button.onclick = async () => {
    const url = new URL(storageLocationHref(button.dataset.storageCopyLink), location.origin).href;
    try { await navigator.clipboard.writeText(url); toast('Lagerort-Link kopiert.'); }
    catch { toast('Der Link konnte nicht kopiert werden.'); }
  });
  bindStorageFinderKeyboard();
  bindStorageFinderBlankNavigation(state.storageLocationsIncludeArchived);
  bindStorageTransferDragDrop();
  bindStorageLocationMoveDragDrop();
}

async function renderInventory(locationId = '', includeArchived = false, itemId = '', sort = 'name', direction = 'asc', showEmpty = true) {
  state.storageLocationSort = ['name','locations','items','updated'].includes(sort) ? sort : 'name';
  state.storageLocationSortDirection = direction === 'desc' ? 'desc' : 'asc';
  state.storageLocationsShowEmpty = showEmpty;
  await loadStorageLocations(includeArchived);
  const detail = locationId ? await api(`/storage-locations/${encodeURIComponent(locationId)}`) : null;
  const current = detail?.location || null;
  const path = detail?.path || [];
  const columnStockData = await Promise.all(path.map(location => api(`/stock-entries?storageLocationId=${encodeURIComponent(location.id)}${includeArchived ? '&includeArchived=1' : ''}`)));
  const stockByLocation = new Map(path.map((location, index) => [location.id, columnStockData[index]?.entries || []]));
  let selectedItem = null;
  let selectedStockData = { entries:[], summary:null };
  let selectedNoteData = { notes:[] };
  let localEntry = null;
  if (itemId && current) {
    [selectedItem, selectedStockData, selectedNoteData] = await Promise.all([
      api(`/inventory-items/${encodeURIComponent(itemId)}`),
      api(`/stock-entries?itemId=${encodeURIComponent(itemId)}&includeArchived=1`),
      api(`/inventory-items/${encodeURIComponent(itemId)}/notes`),
    ]);
    localEntry = (selectedStockData.entries || []).find(entry => entry.storageLocationId === current.id && (includeArchived || entry.status === 'ACTIVE')) || null;
    if (!localEntry) {
      location.href = storageLocationHref(current.id, includeArchived);
      return;
    }
    if (!state.inventoryItems.some(item => item.id === selectedItem.id)) state.inventoryItems.unshift(selectedItem);
    state.inventoryStockItem = selectedItem;
    state.inventoryStockEntries = selectedStockData.entries || [];
    state.inventoryItemNotes = selectedNoteData.notes || [];
  } else {
    state.inventoryStockItem = null;
    state.inventoryStockEntries = [];
    state.inventoryItemNotes = [];
  }
  const visibleDetailChildren = (detail?.children || []).filter(location => includeArchived || location.status === 'ACTIVE');
  const merged = new Map(state.storageLocations.map(location => [location.id, location]));
  [...path, ...visibleDetailChildren].forEach(location => merged.set(location.id, location));
  if (current) merged.set(current.id, current);
  const locations = [...merged.values()];
  const selectedPathIds = new Set(path.map(location => location.id));
  const childrenOf = parentId => sortStorageLocations(locations.filter(location => location.parentId === parentId
    && (includeArchived || location.status === 'ACTIVE')
    && (state.storageLocationsShowEmpty || Number(location.subtreeItemCount || 0) > 0 || selectedPathIds.has(location.id))));
  const roots = childrenOf(null);
  const columns = [storageFinderColumn(null, roots, [], path[0]?.id || '', '', path.length === 0, includeArchived)];
  path.forEach((parent, index) => columns.push(storageFinderColumn(parent, childrenOf(parent.id), stockByLocation.get(parent.id) || [], path[index + 1]?.id || '', index === path.length - 1 ? itemId : '', index === path.length - 1, includeArchived)));
  const breadcrumbs = `<nav class="folder-breadcrumbs storage-breadcrumbs" aria-label="Lagerpfad"><a href="${storageLocationHref()}">Lager</a>${path.map(location => `<span>›</span><a href="${storageLocationHref(location.id)}"${!selectedItem && location.id === current?.id ? ' aria-current="page"' : ''}>${escapeHtml(location.name)}</a>`).join('')}${selectedItem ? `<span>›</span><a href="${storageContextItemHref(current.id, selectedItem.id, includeArchived)}" aria-current="page">${escapeHtml(selectedItem.name)}</a>` : ''}</nav>`;
  const headingCopy = 'Lagerorte und Artikel verwalten.';
  const inspector = selectedItem ? storageFinderItemInspector(current, selectedItem, localEntry, selectedStockData, selectedNoteData.notes || [], includeArchived) : '';
  const createAction = mayEditProjects() && !includeArchived ? '<button class="button primary compact" type="button" data-storage-create-single="">Lagerort anlegen</button>' : '';
  const inventoryHead = standardPageHeader({ title:'Lager', description:headingCopy, icon:'warehouse', className:'storage-finder-page-head', actions:`${storageLocationViewControls()}${createAction}` });
  $('#main').innerHTML = `${inventoryHead}<div class="storage-finder-frame storage-finder-edge-to-edge"><div class="storage-finder-shell${selectedItem ? ' has-item-selection' : ''}" data-storage-finder-shell><div class="storage-finder-columns">${columns.join('')}</div>${inspector}</div><footer class="storage-finder-statusbar">${breadcrumbs}</footer></div>`;
  document.title = selectedItem ? `${selectedItem.name} · ${current.name} · Lager · Logbuch` : current ? `${current.name} · Lager · Logbuch` : 'Lager · Logbuch';
  bindStorageLocationActions();
  bindStorageLocationViewControls(locationId, itemId, includeArchived);
  if (selectedItem) bindInventoryItemActions();
  requestAnimationFrame(() => {
    fitInventoryWorkspaces();
    const shell = $('[data-storage-finder-shell]');
    const currentColumn = $('[data-finder-current-column]');
    if (!revealFinderItemInspector() && shell && currentColumn && window.matchMedia('(min-width:781px)').matches) shell.scrollLeft = Math.max(0, currentColumn.offsetLeft - shell.clientWidth / 3);
    document.querySelector('[data-finder-current-column] .storage-finder-row.selected .storage-finder-link')?.scrollIntoView({ block:'nearest', inline:'nearest' });
  });
}

async function renderInventoryArchive() {
  const [locationData, itemData] = await Promise.all([
    api('/storage-locations?includeArchived=1'),
    api('/inventory-items?includeArchived=1'),
  ]);
  const locations = (locationData.locations || []).filter(location => location.status === 'ARCHIVED');
  const items = (itemData.items || []).filter(item => item.status === 'ARCHIVED');
  const archiveMenu = (kind, id, name) => mayEditProjects() ? contextActionMenu(`Aktionen für ${name}`, `<button class="menu-item" type="button" data-inventory-archive-restore="${kind}" data-archive-id="${escapeHtml(id)}">Wiederherstellen</button><button class="menu-item danger" type="button" data-inventory-permanent-delete="${kind}" data-archive-id="${escapeHtml(id)}">Endgültig löschen</button>`, { className:'inventory-archive-menu' }) : '';
  const locationRows = locations.map(location => `<article class="inventory-archive-row"><a href="${storageLocationHref(location.id, true)}"><span><strong>${escapeHtml(location.name)}</strong></span><i aria-hidden="true">›</i></a>${archiveMenu('location', location.id, location.name)}</article>`).join('');
  const itemRows = items.map(item => `<article class="inventory-archive-row"><a href="${inventoryItemHref(item.id, true, '')}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.stockUnit)}${item.manufacturer ? ` · ${escapeHtml(item.manufacturer)}` : ''}</small></span><i aria-hidden="true">›</i></a>${archiveMenu('item', item.id, item.name)}</article>`).join('');
  const inventoryArchiveHead = standardPageHeader({ title:'Archiv', description:'Archivierte Lagerorte und Artikel bleiben mit ihren historischen Referenzen erhalten.', icon:'archive', className:'storage-finder-page-head inventory-archive-page-head' });
  $('#main').innerHTML = `${inventoryArchiveHead}<div class="inventory-archive-grid"><section class="inventory-archive-group"><header><h2>Lagerorte</h2><span>${locations.length}</span></header>${locationRows ? `<div class="inventory-archive-list">${locationRows}</div>` : '<div class="inventory-archive-empty">Keine archivierten Lagerorte.</div>'}</section><section class="inventory-archive-group"><header><h2>Artikel</h2><span>${items.length}</span></header>${itemRows ? `<div class="inventory-archive-list">${itemRows}</div>` : '<div class="inventory-archive-empty">Keine archivierten Artikel.</div>'}</section></div>`;
  document.title = 'Archiv · Lager · Logbuch';
  bindInventoryArchiveActions();
}

function bindInventoryArchiveActions() {
  document.querySelectorAll('[data-inventory-archive-restore]').forEach(button => button.onclick = async () => {
    const kind = button.dataset.inventoryArchiveRestore;
    const endpoint = kind === 'item' ? 'inventory-items' : 'storage-locations';
    try { await api(`/${endpoint}/${encodeURIComponent(button.dataset.archiveId)}/restore`, { method:'POST', body:'{}' }); toast(kind === 'item' ? 'Artikel wiederhergestellt.' : 'Lagerort-Unterbaum wiederhergestellt.'); await renderInventoryArchive(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-inventory-permanent-delete]').forEach(button => button.onclick = async () => {
    const kind = button.dataset.inventoryPermanentDelete;
    const id = button.dataset.archiveId;
    const endpoint = kind === 'item' ? 'inventory-items' : 'storage-locations';
    try {
      const preview = await api(`/${endpoint}/${encodeURIComponent(id)}/purge-preview`);
      const details = kind === 'item'
        ? `${preview.stockEntries} Bestandseinträge, ${preview.transactions} Buchungen, ${preview.reservations} Reservierungen und ${preview.categoryAssignments} Kategoriezuordnungen`
        : `${preview.locations} Lagerorte, ${preview.stockEntries} Bestandseinträge, ${preview.transactions} Buchungen und Bestände von ${preview.affectedItems} Artikeln`;
      if (!await confirmAction(`„${preview.name}“ endgültig löschen?\n\nDabei werden ${details} unwiderruflich gelöscht.`, { title:'Lagerdaten endgültig löschen', confirmLabel:'Endgültig löschen' })) return;
      await api(`/${endpoint}/${encodeURIComponent(id)}/permanent`, { method:'DELETE', body:'{}' });
      toast(kind === 'item' ? 'Artikel endgültig gelöscht.' : 'Lagerort-Unterbaum endgültig gelöscht.');
      await renderInventoryArchive();
      await loadInventoryMenuCounts();
    } catch (error) { toast(error.message); }
  });
}

async function renderGlobalSearch(routeQuery) {
  const query = (routeQuery.get('q') || '').trim().slice(0, 200);
  const type = Object.hasOwn(searchTypeLabels, routeQuery.get('type')) ? routeQuery.get('type') : 'all';
  const status = ['all', ...Object.keys(projectStatusLabels)].includes(routeQuery.get('status')) ? routeQuery.get('status') : 'all';
  const sort = Object.hasOwn(searchSortLabels, routeQuery.get('sort')) ? routeQuery.get('sort') : 'relevance';
  $('#global-search-input').value = query;
  syncSidebarSearchClear();
  let data = { total:0, results:[], truncated:false };
  let content = '<div class="empty"><strong>Was möchtest du finden?</strong>Durchsuche Projekte, Logbucheinträge, Arbeitsschritte und alle weiteren Projektinhalte.</div>';
  if (query.length === 1) {
    content = '<div class="empty"><strong>Noch ein Zeichen.</strong>Der Suchbegriff muss mindestens zwei Zeichen lang sein.</div>';
  } else if (query.length >= 2) {
    const params = new URLSearchParams({ q:query, type, status, sort });
    data = await api(`/search?${params}`);
    content = data.results.length
      ? `<div class="global-search-results">${data.results.map(globalSearchResult).join('')}</div>${data.truncated ? '<p class="global-search-truncated">Es werden die ersten 500 Treffer angezeigt. Grenze die Suche mit Filtern weiter ein.</p>' : ''}`
      : `<div class="empty"><strong>Keine Treffer für „${escapeHtml(query)}“.</strong>Versuche einen allgemeineren Begriff oder ändere die Filter.</div>`;
  }
  const statusOptions = { all:'Alle Status', idea:'Idee', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen', archived:'Archiviert', trashed:'Papierkorb' };
  const searchDescription = query.length >= 2 ? `${data.total} ${data.total === 1 ? 'Treffer' : 'Treffer'} für „${query}“` : 'Alle Projekte und Inhalte an einem Ort';
  const searchHead = standardPageHeader({ title:'Suche', description:searchDescription, icon:'search', className:'search-page-head' });
  $('#main').innerHTML = `${searchHead}<section class="project-page-content search-page-content"><form id="search-page-form" class="global-search-controls" role="search"><div class="global-search-query"><span aria-hidden="true">${iconSvg('search')}</span><div class="global-search-input-wrap"><input name="q" type="search" maxlength="200" value="${escapeHtml(query)}" placeholder="Suchbegriff eingeben" aria-label="Suchbegriff" autocomplete="off"><button type="button" data-clear-global-search aria-label="Suchbegriff löschen" title="Suchbegriff löschen"${query ? '' : ' hidden'}>×</button></div><button class="button primary" type="submit">Suchen</button></div><div class="global-search-filters"><label>Bereich<select name="type">${Object.entries(searchTypeLabels).map(([value,label]) => `<option value="${value}"${value === type ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Projektstatus<select name="status">${Object.entries(statusOptions).map(([value,label]) => `<option value="${value}"${value === status ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Sortierung<select name="sort">${Object.entries(searchSortLabels).map(([value,label]) => `<option value="${value}"${value === sort ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div></form><section class="global-search-content" aria-live="polite">${content}</section></section>`;
  const form = $('#search-page-form');
  const searchInput = form.elements.q;
  const clearSearch = form.querySelector('[data-clear-global-search]');
  const syncClearSearch = () => { clearSearch.hidden = !searchInput.value; };
  let globalSearchTimer;
  searchInput.addEventListener('input', () => {
    syncClearSearch();
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(navigate, 300);
  });
  clearSearch.onclick = () => {
    searchInput.value = '';
    syncClearSearch();
    searchInput.focus();
    navigate();
  };
  const navigate = () => {
    const values = new FormData(form);
    const params = new URLSearchParams();
    const nextQuery = String(values.get('q') || '').trim();
    if (nextQuery) params.set('q', nextQuery);
    if (values.get('type') !== 'all') params.set('type', String(values.get('type')));
    if (values.get('status') !== 'all') params.set('status', String(values.get('status')));
    if (values.get('sort') !== 'relevance') params.set('sort', String(values.get('sort')));
    location.href = `/#/search${params.size ? `?${params}` : ''}`;
  };
  form.onsubmit = event => { event.preventDefault(); navigate(); };
  form.querySelectorAll('select').forEach(select => select.onchange = navigate);
}

async function renderProjects() {
  await loadProjectBrowser();
  if (state.currentFolderId && !folderById(state.currentFolderId)) state.currentFolderId = null;
  const showFolders = state.user.showProjectFolders !== false;
  const visibleFolderIds = showFolders ? null : descendantFolderIds(state.currentFolderId);
  const projects = sortedProjects(state.projects.filter(project => {
    if (!regularProjectStatuses.includes(project.status) || (state.projectStatusFilter !== 'all' && project.status !== state.projectStatusFilter)) return false;
    if (showFolders) return (project.folderId || null) === state.currentFolderId;
    if (state.currentFolderId) return visibleFolderIds.has(project.folderId);
    return !project.folderId || visibleFolderIds.has(project.folderId);
  }));
  const folders = showFolders ? state.folders.filter(folder => folder.parentId === state.currentFolderId).sort((a,b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' })) : [];
  const currentFolder = folderById(state.currentFolderId);
  const title = { all:'Alle', idea:'Idee', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen' }[state.projectStatusFilter] || 'Alle';
  const dedicatedStatusSection = regularProjectStatuses.includes(state.projectStatusFilter);
  const separateStatuses = dedicatedStatusSection || (state.projectStatusFilter === 'all' && state.projectSort.field === 'status');
  const collapsibleFolders = dedicatedStatusSection || state.projectStatusFilter === 'all';
  const folderGroup = collapsibleFolders && showFolders ? `<div class="project-group-head folder-group-head"><div class="project-status-divider project-list-divider folder-list-divider"><button class="project-divider-toggle" type="button" data-toggle-project-folder-group aria-expanded="${!state.collapsedProjectFolders}" aria-label="Ordner ${state.collapsedProjectFolders ? 'ausklappen' : 'einklappen'}" title="${state.collapsedProjectFolders ? 'Ausklappen' : 'Einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><strong class="divider-label">Ordner <b>(${folders.length})</b></strong></button></div></div><div class="folder-grid${state.collapsedProjectFolders ? ' hidden' : ''}" data-project-folder-group>${folders.map(folderCard).join('')}</div>` : folders.length ? `<div class="folder-grid" data-project-folder-group>${folders.map(folderCard).join('')}</div>` : '';
  const groupedProjects = projectCards(projects, false, !showFolders, separateStatuses);
  const addButton = mayEditProjects() ? '<button class="button primary compact project-add-button project-browser-add-button" type="button" data-open-project-create aria-label="Projekt oder Ordner hinzufügen"><span aria-hidden="true">+</span><b>Hinzufügen</b></button>' : '';
  const projectHead = standardPageHeader({ title, description:currentFolder?.description || 'Projekte nach Status und Ordnern verwalten.', icon:'box', actions:`${projectListControls(false, projects)}${addButton}`, breadcrumbs:folderBreadcrumbs(state.currentFolderId), className:'project-browser-page-head' });
  $('#main').innerHTML = `${projectHead}<section class="project-page-content project-browser-page-content"><div id="active-tag-filters">${selectedTagFiltersMarkup(false)}</div>
    ${folderGroup || groupedProjects ? `<div class="project-grid project-list">${folderGroup}${groupedProjects}</div>${projects.length ? '<div id="project-no-results" class="empty hidden"><strong>Keine passenden Projekte gefunden.</strong>Versuche einen anderen Suchbegriff.</div>' : ''}` : `<div class="empty"><strong>${currentFolder ? 'Dieser Ordner enthält keine passenden Projekte.' : 'Noch keine Projekte vorhanden.'}</strong></div>`}</section>`;
  bindMobileProjectControls();
  bindNewProject();
  bindFolderActions();
  bindProjectListControls(false);
  bindTagFilterSummary();
  bindProjectFolderGroup();
  bindProjectStatusGroups();
  bindProjectActions();
}

async function renderArchive() {
  await loadProjectBrowser();
  const projects = sortedProjects(state.projects.filter(project => project.status === 'archived'), state.archiveSort);
  const archiveHead = standardPageHeader({ title:'Archiv', description:'Archivierte Projekte bleiben vollständig erhalten.', icon:'archive', actions:projectListControls(true, projects), className:'project-browser-page-head project-archive-page-head' });
  $('#main').innerHTML = `${archiveHead}<section class="project-page-content project-browser-page-content"><div id="active-tag-filters">${selectedTagFiltersMarkup(true)}</div>
    ${projects.length ? `<div class="project-grid project-list">${projectCards(projects, true)}</div><div id="project-no-results" class="empty hidden"><strong>Keine passenden Projekte gefunden.</strong>Versuche einen anderen Suchbegriff.</div>` : `<div class="empty"><strong>Das Archiv ist leer.</strong>Archivierte Projekte erscheinen hier und können jederzeit wiederhergestellt werden.</div>`}
    <aside class="archive-note"><p>Das Archiv dient dazu, deine Projektliste übersichtlich zu halten. Archivierte Projekte und ihre Logs bleiben erhalten, werden in der Aktivitätsanzeige und der Projekt-Timeline in der Übersicht jedoch nicht mehr berücksichtigt.</p></aside></section>`;
  bindMobileProjectControls();
  bindProjectListControls(true);
  bindTagFilterSummary();
  bindProjectActions();
}

function trashProjectCard(project) {
  const deletedAt = Number(project.deletedAt) > 0 ? formatEpoch(project.deletedAt) : 'Unbekannt';
  const actions = mayEditProjects() ? `<details class="action-menu card-menu"><summary aria-label="Papierkorbaktionen">${iconSvg('ellipsis')}</summary><div class="action-menu-panel"><button class="menu-item" data-restore-project="${escapeHtml(project.id)}">Wiederherstellen</button><button class="menu-item danger" data-purge-project="${escapeHtml(project.id)}">Endgültig löschen</button></div></details>` : '';
  return `<article class="project-card trash-project-card" data-project-card>
    <div class="project-card-content"><div class="entity-card-lead"><span class="project-entity-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><span class="entity-card-copy"><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p></span></div><div class="project-next-step trash-deleted-at"><small>In den Papierkorb verschoben</small><strong>${escapeHtml(deletedAt)}</strong></div></div>
    <aside class="project-card-status" aria-label="Papierkorbstatus"><div class="project-card-actions">${actions}</div><div class="project-status-row"><small>Status</small><span class="project-status trashed">Papierkorb</span></div><div class="project-status-row"><small>Priorität</small>${projectPriorityMarkup(project)}</div><div class="project-status-row"><small>Start</small><span class="project-status-value">${project.createdAt ? formatDate(project.createdAt) : 'ohne'}</span></div><div class="project-status-row project-status-tags"><small>Tags</small>${tagChips(project.tagIds, { linked:false }) || '<span class="project-status-empty">Keine</span>'}</div></aside>
  </article>`;
}

async function renderTrash() {
  await loadProjectBrowser();
  const projects = state.projects.filter(project => project.status === 'trashed').sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  const emptyButton = state.user.admin && projects.length ? '<button class="button danger" data-empty-trash>Papierkorb leeren</button>' : '';
  const trashHead = standardPageHeader({ title:'Papierkorb', description:'Gelöschte Projekte prüfen, wiederherstellen oder endgültig entfernen.', icon:'trash', actions:emptyButton, className:'project-trash-page-head' });
  $('#main').innerHTML = `${trashHead}<section class="project-page-content project-browser-page-content">
    ${projects.length ? `<div class="project-grid project-list">${projects.map(trashProjectCard).join('')}</div>` : '<div class="empty"><strong>Der Papierkorb ist leer.</strong>Gelöschte Projekte erscheinen hier, bevor sie endgültig entfernt werden.</div>'}</section>`;
  bindTrashActions();
}

const settingsSections = [
  ['general','Allgemein','Persönliches Verhalten beim Öffnen des Logbuchs.'],
  ['tags','Tags','Projektübergreifende Tags ordnen, zusammenführen und verwalten.'],
  ['profile','Profil','Dein persönlicher Zugang zum Logbuch.'],
  ['users','Benutzerverwaltung','Konten, Rollen und Projektfreigaben verwalten.'],
  ['data','Daten & Backups','Projektdaten und Benutzerkonten unabhängig voneinander sichern und wiederherstellen.'],
  ['server','Server','Adresse, Name und Zeitzone dieser Logbuch-Instanz konfigurieren.'],
  ['security','Sicherheit','Aktive Anmeldungen und verbundene Geräte verwalten.'],
  ['system','System','Wartung und Aktualisierung des Logbuchs sowie Fehlerdiagnose.'],
  ['audit','Protokoll','Administrative und sicherheitsrelevante Änderungen am Logbuch nachvollziehen.']
];

const settingRow = (title, description, status = 'Geplant') => `<div class="setting-row"><div><strong>${title}</strong><p>${description}</p></div><span class="setting-status">${status}</span></div>`;
const settingLink = (title, description, href) => `<a class="setting-row setting-link" href="${href}"><div><strong>${title}</strong><p>${description}</p></div><span aria-hidden="true">→</span></a>`;
const userRoleLabel = role => ({ admin:'Administrator', editor:'Bearbeiter', viewer:'Leser' }[role] || role);
const backupCollections = ['entries','tasks','shopping','materials','contacts','links','ideas','learnings','notes'];

function tagSettingsContent() {
  const tags = [...state.tags].sort((a,b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
  return `<div class="settings-group tag-settings"><div class="setting-list tag-management-list">${tags.length ? tags.map(tag => {
    const active = Number(tag.activeProjectCount || 0), archived = Number(tag.archivedProjectCount || 0);
    return `<div class="setting-row tag-management-row"><a class="tag-management-link" href="${tagLink(tag)}"><strong>${escapeHtml(tag.name)}</strong><p>${active} ${active === 1 ? 'Projekt' : 'Projekte'} · ${archived} ${archived === 1 ? 'archiviertes Projekt' : 'archivierte Projekte'}</p></a><div class="tag-management-actions"><details class="action-menu"><summary aria-label="Tagaktionen">${iconSvg('ellipsis')}</summary><div class="action-menu-panel"><button class="menu-item" data-edit-tag="${escapeHtml(tag.id)}">Umbenennen</button>${tags.length > 1 ? `<button class="menu-item" data-merge-tag="${escapeHtml(tag.id)}">Zusammenführen</button>` : ''}<button class="menu-item danger" data-delete-tag="${escapeHtml(tag.id)}">Löschen</button></div></details></div></div>`;
  }).join('') : '<div class="settings-empty"><strong>Noch keine Tags vorhanden</strong><p>Tags können hier oder direkt beim Bearbeiten eines Projekts angelegt werden.</p></div>'}</div></div>`;
}

function generalSettingsContent() {
  const sortOptions = (includeStatus, selected) => projectSortOptions(includeStatus).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  return `<div class="settings-group"><div class="setting-list">
    <div class="setting-row"><div><strong>Startseite</strong><p>Diese Seite wird direkt nach deiner Anmeldung geöffnet.</p></div><select id="start-page-setting" class="setting-select" aria-label="Startseite"><option value="home" ${state.user.startPage !== 'projects' && state.user.startPage !== 'archive' ? 'selected' : ''}>Übersicht</option><option value="projects" ${state.user.startPage === 'projects' ? 'selected' : ''}>Projekte</option><option value="archive" ${state.user.startPage === 'archive' ? 'selected' : ''}>Archiv</option></select></div>
    <div class="setting-row"><div><strong>Projekte sortieren</strong><p>Diese Sortierung wird beim Öffnen der Projektliste verwendet.</p></div><select data-general-preference="projectSort" class="setting-select general-sort-select" aria-label="Standardsortierung der Projekte">${sortOptions(true, state.user.projectSort || 'status:asc')}</select></div>
    <div class="setting-row"><div><strong>Archiv sortieren</strong><p>Diese Sortierung wird beim Öffnen des Archivs verwendet.</p></div><select data-general-preference="archiveSort" class="setting-select general-sort-select" aria-label="Standardsortierung des Archivs">${sortOptions(false, state.user.archiveSort || 'createdAt:desc')}</select></div>
    <div class="setting-row general-icon-setting"><div><strong>Standard-Projektsymbol</strong><p>Dieses Symbol erscheint bei allen Projekten, denen kein eigenes Symbol zugewiesen wurde.</p></div><form id="default-project-icon-form"><input type="hidden" name="icon" value="${escapeHtml(defaultProjectIconName())}"><div class="icon-picker" data-icon-picker="default-project"></div></form></div>
  </div></div>`;
}

function dataContent() {
  const projectCount = state.projects.length;
  const userCount = state.users.length;
  const storage = state.storage || {};
  const usedPercent = storage.totalBytes ? Math.max(0, Math.min(100, Math.round((storage.totalBytes - storage.freeBytes) / storage.totalBytes * 100))) : 0;
  const storageWarning = storage.warning ? '<div class="storage-warning"><strong>Speicher wird knapp</strong><span>Bitte räume Speicher frei oder vergrößere das Docker-Volume. Backups sollten weiterhin extern aufbewahrt werden.</span></div>' : '';
  return `<div class="settings-group data-settings">
    <section class="backup-area storage-area"><div class="backup-area-head"><div><h2>Speicher</h2><p>Überblick über Projektdateien und den freien Platz des eingebundenen Datenträgers.</p></div></div>${storageWarning}<div class="storage-summary">
      <div><small>Dateien</small><strong>${Number(storage.attachmentCount || 0)}</strong><span>${formatBytes(storage.attachmentBytes || 0)}</span></div>
      <div><small>Gesamte Projektdaten</small><strong>${formatBytes(storage.projectBytes || 0)}</strong><span>inklusive Metadaten und Vorschaubildern</span></div>
      <div><small>Datenträger frei</small><strong>${formatBytes(storage.freeBytes || 0)}</strong><span>von ${formatBytes(storage.totalBytes || 0)} · ${usedPercent}% belegt</span></div>
    </div></section>
    <section class="backup-area"><div class="backup-area-head"><div><h2>Backup herunterladen</h2><p>Das Vollbackup enthält den gesamten wiederherstellbaren Stand des Logbuchs. Die getrennten Exporte bleiben für gezielte Übertragungen verfügbar.</p></div></div><div class="backup-export-grid">
      <article class="backup-card full-backup-card sensitive-backup"><div><h3>Vollständiges Backup</h3><p>Sichert Projekte und Dateien, Benutzer und Erinnerungen, Ordner und Tags sowie das gesamte Lager mit Kategorien, Lagerorten, Artikeln, Beständen, Reservierungen und Historie. Auch Servereinstellungen und das Prüfprotokoll sind enthalten.</p><small>Passwort-Hashes sind enthalten; Klartextpasswörter und aktive Sitzungen nicht. Bewahre dieses Archiv geschützt auf.</small></div><a class="button primary" href="/api/backup/full">Vollbackup herunterladen</a></article>
      <article class="backup-card"><div><h3>Nur Projekte</h3><p>${projectCount} ${projectCount === 1 ? 'Projekt' : 'Projekte'} mit Ordnerstruktur, Inhalten und Projektdateien. Dieser Export eignet sich zum gezielten Übertragen einzelner Projektbestände, ist aber kein vollständiges Backup.</p></div><a class="button secondary" href="/api/backup/projects">Projektdaten herunterladen</a></article>
      <article class="backup-card sensitive-backup"><div><h3>Nur Benutzer</h3><p>${userCount} ${userCount === 1 ? 'Benutzerkonto' : 'Benutzerkonten'} mit Rollen, Status, Projektfreigaben, persönlichen Einstellungen und Erinnerungen. Lager und Projekte sind nicht enthalten.</p><small>Passwort-Hashes sind enthalten; Klartextpasswörter und aktive Sitzungen nicht.</small></div><button class="button secondary" data-export-users>Benutzerkonten herunterladen</button></article>
    </div></section>
    <section class="backup-area"><div class="backup-area-head"><div><h2>Import & Wiederherstellung</h2><p>Ein Vollbackup ersetzt den aktuellen Stand vollständig. Die gezielten Importe ergänzen oder ersetzen nur den jeweils gewählten Bereich.</p></div></div><div class="backup-import-grid">
      <article class="backup-card backup-import-card full-backup-card sensitive-backup"><div><h3>Vollbackup wiederherstellen</h3><p>Stellt alle gesicherten Inhalte gemeinsam und mit unveränderten Verknüpfungen wieder her. Der aktuelle Stand wird dabei vollständig ersetzt und alle angemeldeten Geräte werden abgemeldet.</p></div><div class="backup-restore-form"><label>Vollbackup<input id="full-backup-file" type="file" accept=".tar,application/x-tar"></label><div id="full-backup-preview" class="backup-preview">Noch kein Vollbackup ausgewählt.</div><button class="button danger-button" data-import-full disabled>Vollbackup wiederherstellen</button></div></article>
      <article class="backup-card backup-import-card"><div><h3>Projekt importieren</h3><p>Akzeptiert den Rohdatenexport eines einzelnen Projekts ebenso wie ein vollständiges Projektarchiv. Inhalte, Zuordnungen, Metadaten und Dateien werden übernommen.</p></div><div class="backup-restore-form"><label>Projekt- oder Backup-Archiv<input id="project-backup-file" type="file" accept=".tar,application/x-tar"></label><label>Bei vorhandenen Projekten<select id="project-backup-conflict"><option value="skip">Vorhandenes Projekt überspringen</option><option value="replace">Vorhandenes Projekt ersetzen</option></select></label><div id="project-backup-preview" class="backup-preview">Noch kein Projektarchiv ausgewählt.</div><button class="button secondary" data-import-projects disabled>Projekt importieren</button></div></article>
      <article class="backup-card backup-import-card sensitive-backup"><div><h3>Benutzerarchiv einspielen</h3></div><div class="backup-restore-form"><label>Benutzerarchiv<input id="user-backup-file" type="file" accept=".tar,application/x-tar"></label><label>Bei vorhandenen Benutzern<select id="user-backup-conflict"><option value="skip">Vorhandenen Benutzer überspringen</option><option value="replace">Vorhandenen Benutzer ersetzen</option></select></label><div id="user-backup-preview" class="backup-preview">Noch kein Benutzerarchiv ausgewählt.</div><button class="button secondary" data-import-users disabled>Benutzerkonten einspielen</button></div></article>
    </div></section>
  </div>`;
}

function userRow(user) {
  const ownAccount = user.id === state.user.id;
  const projectCount = user.projectIds?.length || 0;
  const projects = user.role === 'admin' || user.projectAccessMode === 'all' ? 'Alle Projekte' : user.projectAccessMode === 'exclude' ? (projectCount ? `Alle außer ${projectCount}` : 'Alle Projekte') : `${projectCount} ${projectCount === 1 ? 'Projekt' : 'Projekte'}`;
  const actions = `<details class="action-menu user-menu"><summary aria-label="Benutzeraktionen">${iconSvg('ellipsis')}</summary><div class="action-menu-panel"><button class="menu-item" data-edit-user="${escapeHtml(user.id)}">Bearbeiten</button>${ownAccount ? '' : `<button class="menu-item" data-toggle-user="${escapeHtml(user.id)}" data-active="${user.active ? 'false' : 'true'}">${user.active ? 'Deaktivieren' : 'Aktivieren'}</button><button class="menu-item danger" data-delete-user="${escapeHtml(user.id)}">Löschen</button>`}</div></details>`;
  const accountDetails = `${ownAccount ? 'Dein Benutzerkonto · ' : ''}Letzte Anmeldung: ${escapeHtml(formatDateTime(user.lastLoginAt))}${user.mustChangePassword ? ' · Passwortwechsel ausstehend' : ''}`;
  return `<div class="setting-row user-row"><div class="user-identity"><strong>${escapeHtml(user.id)}</strong><p>${accountDetails}</p></div><div class="user-row-meta"><div class="user-access"><strong>${escapeHtml(userRoleLabel(user.role))}</strong><small>${projects}</small></div><span class="setting-status ${user.active ? 'active' : 'inactive'}">${user.active ? 'Aktiv' : 'Deaktiviert'}</span>${actions}</div></div>`;
}

const durationLabel = seconds => seconds < 60 ? 'Gerade aktiv' : seconds < 3600 ? `Vor ${Math.floor(seconds / 60)} Min.` : `Vor ${Math.floor(seconds / 3600)} Std.`;
const deviceLabel = userAgent => {
  const value = String(userAgent || 'Unbekanntes Gerät');
  if (/iPhone/i.test(value)) return 'iPhone';
  if (/iPad/i.test(value)) return 'iPad';
  if (/Android/i.test(value)) return 'Android-Gerät';
  if (/Macintosh/i.test(value)) return 'Mac';
  if (/Windows/i.test(value)) return 'Windows-PC';
  return value.slice(0, 55);
};
const auditLabel = action => ({ 'user.created':'Benutzer angelegt', 'user.updated':'Benutzer geändert', 'user.deleted':'Benutzer gelöscht', 'password.changed':'Passwort geändert', 'session.revoked':'Sitzung beendet', 'log.created':'Log angelegt', 'log.updated':'Log bearbeitet', 'log.deleted':'Log gelöscht', 'tag.created':'Tag angelegt', 'tag.updated':'Tag geändert', 'tag.merged':'Tags zusammengeführt', 'tag.deleted':'Tag gelöscht', 'file.imported':'Datei aus Backup importiert', 'data.project_imported':'Projekt aus Backup importiert', 'data.users_exported':'Benutzerkonten exportiert', 'data.users_imported':'Benutzerkonten importiert', 'data.full_backup_restored':'Vollbackup wiederhergestellt', 'server.settings_updated':'Servereinstellungen geändert', 'system.update_requested':'Logbuch-Update angefordert', 'system.content_cleared':'Alle Inhalte gelöscht', 'system.users_cleared':'Benutzerkonten zurückgesetzt', 'demo.installed':'Beispieldaten eingespielt', 'demo.removed':'Beispieldaten entfernt' }[action] || action);

function updateCardContent() {
  const update = state.update || {};
  const current = update.currentVersion || state.system?.version || '–';
  const latest = update.latestVersion || '';
  const checkingFailed = Boolean(update.checkError);
  let title = 'Das Logbuch ist aktuell';
  let copy = `Version ${escapeHtml(current)} ist installiert.`;
  let statusClass = 'active';
  let status = 'Aktuell';
  if (update.state === 'queued') {
    title = `Update ${escapeHtml(update.requestedVersion || latest)} angefordert`;
    copy = 'Der AIO-Updater übernimmt Download, Neustart und Healthcheck. Die Seite kann dabei kurz nicht erreichbar sein.';
    statusClass = '';
    status = 'Wartet';
  } else if (update.state === 'failed') {
    title = 'Das letzte Update ist fehlgeschlagen';
    copy = escapeHtml(update.stateMessage || 'Die vorherige Version blieb aktiv.');
    statusClass = 'inactive';
    status = 'Fehler';
  } else if (update.available) {
    title = `Logbuch-Version ${escapeHtml(latest)} ist verfügbar`;
    copy = escapeHtml(update.summary || `Installiert ist Version ${current}.`);
    statusClass = '';
    status = 'Verfügbar';
  } else if (checkingFailed) {
    title = 'Update-Prüfung nicht möglich';
    copy = escapeHtml(update.checkError);
    statusClass = 'inactive';
    status = 'Offline';
  }
  const highlights = update.available && Array.isArray(update.highlights) && update.highlights.length
    ? `<div class="update-highlights"><h3>Die wichtigsten Änderungen</h3><ul>${update.highlights.map(highlight => `<li>${escapeHtml(highlight)}</li>`).join('')}</ul></div>`
    : '';
  const changelogUrl = update.changelogUrl || update.releaseNotesUrl;
  const releaseLink = changelogUrl ? `<a href="${escapeHtml(changelogUrl)}" target="_blank" rel="noopener">Ausführliches Changelog auf GitHub</a>` : '';
  const install = update.available ? `<button class="button primary" data-install-update ${update.installSupported ? '' : 'disabled'}>Update installieren</button>` : '';
  const reason = update.available && !update.installSupported && update.installReason ? `<small>${escapeHtml(update.installReason)}</small>` : '';
  return `<section class="update-card"><div class="update-card-copy"><div class="update-card-title"><h2>${title}</h2><span class="setting-status ${statusClass}">${status}</span></div><p>${copy}</p>${highlights}<div class="update-card-meta">${releaseLink}${update.checkedAt ? `<span>Geprüft: ${escapeHtml(formatDateTime(update.checkedAt))}</span>` : ''}</div>${reason}</div><div class="update-card-actions"><button class="button secondary" data-check-update>Neu prüfen</button>${install}</div></section>`;
}

function serverContent() {
  const server = state.server || {};
  const platform = server.platform === 'docker' ? 'Docker' : server.platform === 'test' ? 'Testumgebung' : 'Webhosting';
  return `<div class="settings-group device-settings">
    <section><div class="settings-section-head"><h2>Instanz</h2><p>Diese Angaben gelten für alle Benutzer und für erzeugte Projektlinks.</p></div><form id="server-form" class="device-form"><div class="device-form-fields">
      <label>Name der Instanz<input name="siteName" value="${escapeHtml(server.siteName || 'Logbuch')}" minlength="2" maxlength="80" required><small>Wird in Backups und Systeminformationen verwendet.</small></label>
      <label>Öffentliche Webadresse<input name="baseUrl" type="url" value="${escapeHtml(server.baseUrl || location.origin)}" maxlength="300" required><small>Beispiel: https://log.example.de. Relative Projektlinks bleiben bei Umzügen erhalten.</small></label>
      <label>Zeitzone<select name="timezone"><option value="Europe/Berlin" ${server.timezone === 'Europe/Berlin' ? 'selected' : ''}>Europe/Berlin</option><option value="Europe/Vienna" ${server.timezone === 'Europe/Vienna' ? 'selected' : ''}>Europe/Vienna</option><option value="Europe/Zurich" ${server.timezone === 'Europe/Zurich' ? 'selected' : ''}>Europe/Zurich</option><option value="UTC" ${server.timezone === 'UTC' ? 'selected' : ''}>UTC</option></select><small>Wird für Zeitangaben im Logbuch verwendet.</small></label>
    </div><div class="device-form-actions"><p>Betriebsart: ${escapeHtml(platform)} · Serverzeit: ${escapeHtml(formatDateTime(server.currentTime))}</p><button class="button primary" type="submit">Servereinstellungen speichern</button></div></form></section>
  </div>`;
}

function auditContent() {
  return `<div class="settings-group audit-settings"><div class="audit-list">${state.audit.length ? [...state.audit].reverse().map(event => `<div class="audit-row"><div><strong>${escapeHtml(auditLabel(event.action))}</strong><small>${escapeHtml(event.actor || 'System')} → ${escapeHtml(event.target || '')}</small></div><span>${event.at ? escapeHtml(formatDateTime(event.at)) : 'Ohne Zeitangabe'}</span></div>`).join('') : '<div class="settings-empty">Noch keine Änderungen protokolliert.</div>'}</div></div>`;
}

function securityContent() {
  const sessions = state.user.admin ? `<section class="security-section"><div class="security-section-head"><h3>Aktive Sitzungen</h3><p>Angemeldete Geräte aller Benutzer. Die aktuelle Sitzung wird über „Abmelden“ beendet.</p></div><div class="session-list">${state.sessions.length ? state.sessions.map(session => `<div class="session-row"><div><strong>${escapeHtml(session.name || session.userId)}</strong><small>${escapeHtml(deviceLabel(session.userAgent))} · ${escapeHtml(session.ip || 'Unbekannte IP')}</small></div><span>${durationLabel(session.activeAgoSeconds || 0)}</span>${session.current ? '<span class="setting-status active">Diese Sitzung</span>' : `<button class="button secondary compact" data-revoke-session="${escapeHtml(session.id)}">Beenden</button>`}</div>`).join('') : '<div class="settings-empty">Keine aktiven Sitzungen.</div>'}</div></section>` : '';
  return `<div class="settings-group">${sessions}</div>`;
}

function settingsContent(section) {
  if (!['general','profile'].includes(section) && !state.user?.admin) return `<div class="settings-empty"><strong>Nur für Administratoren</strong><p>Dieser Bereich enthält geräteweite Einstellungen und ist deshalb nur für Administratoren sichtbar.</p></div>`;
  if (section === 'general') return generalSettingsContent();
  if (section === 'profile') return profileContent();
  if (section === 'tags') return tagSettingsContent();
  if (section === 'users') return `<div class="settings-group user-settings"><section class="user-section" aria-label="Benutzerrollen"><div class="settings-section-head"><h2>Benutzerrollen</h2><p>Zur Einordnung der Berechtigungen im Logbuch.</p></div><div class="role-legend">
    <div class="role-legend-row"><strong>Administrator</strong><p>Verwaltet alle Projekte, Benutzer und Einstellungen.</p></div>
    <div class="role-legend-row"><strong>Bearbeiter</strong><p>Kann freigegebene Projekte ansehen und verändern.</p></div>
    <div class="role-legend-row"><strong>Leser</strong><p>Kann freigegebene Projekte ausschließlich ansehen.</p></div>
  </div></section><section class="user-section" aria-label="Benutzerkonten"><div class="settings-section-head"><h2>Benutzerkonten</h2><p>Status, Rolle und Projektzugriff der angelegten Benutzer.</p></div><div class="setting-list user-list">${state.users.length ? state.users.map(userRow).join('') : '<div class="settings-empty"><strong>Noch keine Benutzer vorhanden</strong></div>'}</div></section></div>`;
  if (section === 'data') return dataContent();
  if (section === 'server') return serverContent();
  if (section === 'security') return securityContent();
  if (section === 'audit') return auditContent();
  const system = state.system || {};
  return `<div class="settings-group">${updateCardContent()}<div class="setting-list">
    ${settingRow('Version','Installierte Logbuch-Version. ',escapeHtml(system.version || 'Wird geladen'))}
    ${settingRow('Betriebsart','Art der aktuellen Installation.',escapeHtml(system.platform === 'docker' ? 'Docker' : 'Webhosting'))}
    ${settingRow('PHP & Datenbank','Laufzeit und lokaler Datenspeicher.',escapeHtml(`${system.phpVersion || '–'} · ${system.database || '–'}`))}
    ${settingRow('Speicherbelegung','Vom Logbuch belegter Speicherplatz.',formatBytes(system.storageBytes))}
    ${settingRow('Freier Speicher','Am Datenspeicher noch verfügbar.',formatBytes(system.storageFreeBytes))}
    ${settingLink('Protokoll','Administrative und sicherheitsrelevante Änderungen nachvollziehen.','/#/settings/audit')}
  </div><section class="danger-zone"><div class="danger-zone-head"><h2>DANGER ZONE</h2><p>Diese Aktionen verändern oder löschen zentrale Daten dieser Logbuch-Instanz.</p></div>
    <div class="danger-row"><div><strong>Alle Inhalte löschen</strong><p>Löscht Projekte, Erinnerungen und den gesamten Lagerbereich einschließlich Archiv, Kategorien, Beständen, Reservierungen und Historie. Benutzerkonten, Einstellungen und das Systemprotokoll bleiben erhalten.</p></div><button class="button danger-button" data-clear-content>Alle Inhalte löschen</button></div>
    <div class="danger-row"><div><strong>Benutzerkonten zurücksetzen</strong><p>Löscht alle Benutzerkonten und deren Sitzungen. Der aktuell angemeldete Administrator bleibt erhalten.</p></div><button class="button danger-button" data-clear-users>Andere Benutzer löschen</button></div>
    <div class="danger-row demo-row"><div><strong>Beispieldaten einspielen</strong><p>Spielt Maker-Projekte, Lagerorte, Artikel, Bestände und Reservierungen ein oder setzt sie auf den Lieferzustand zurück. Eigene Inhalte bleiben erhalten.</p></div><button class="button secondary" data-load-demo>${system.demoProjectCount || system.demoFolderCount || system.demoStorageLocationCount || system.demoInventoryItemCount ? 'Beispieldaten zurücksetzen' : 'Beispieldaten einspielen'}</button></div>
    <div class="danger-row demo-row"><div><strong>Beispieldaten entfernen</strong><p>Löscht die mitgelieferten Demo-Projekte und Demo-Artikel. Demo-Ordner und Demo-Lagerorte mit eigenen Inhalten bleiben erhalten.</p></div><button class="button danger-button" data-remove-demo ${system.demoProjectCount || system.demoFolderCount || system.demoStorageLocationCount || system.demoInventoryItemCount ? '' : 'disabled'}>Beispieldaten entfernen</button></div>
  </section></div>`;
}

async function loadUsers() {
  const data = await api('/users');
  state.users = data.users || [];
}

async function loadSessions() {
  if (!state.user.admin) { state.sessions = []; return; }
  const data = await api('/sessions');
  state.sessions = data.sessions || [];
}

async function loadAudit() {
  if (!state.user.admin) { state.audit = []; return; }
  const data = await api('/audit');
  state.audit = data.events || [];
}

async function loadSystemStatus() {
  if (!state.user.admin) { state.system = null; return; }
  [state.system] = await Promise.all([api('/system'), loadUpdateStatus()]);
}

function updateUpdateBadge() {
  const settingsBadge = $('#update-badge');
  const systemBadge = $('#system-update-badge');
  const menuOpen = $('#settings-toggle')?.getAttribute('aria-expanded') === 'true';
  const available = Boolean(state.update?.available);
  if (settingsBadge) settingsBadge.hidden = !available || menuOpen;
  if (systemBadge) systemBadge.hidden = !available || !menuOpen;
}

async function loadUpdateStatus(force = false) {
  if (!state.user?.admin) { state.update = null; return; }
  state.update = await api(force ? '/update/check' : '/update/status', force ? { method:'POST', body:'{}' } : {});
  updateUpdateBadge();
}

async function loadServerSettings() {
  if (!state.user.admin) { state.server = null; return; }
  state.server = await api('/settings/server');
}

async function loadStorageStats() {
  if (!state.user.admin) { state.storage = null; return; }
  state.storage = await api('/storage');
}

function bindServerActions() {
  const form = $('#server-form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    try {
      await api('/settings/server', { method:'PATCH', body:JSON.stringify(values) });
      toast('Servereinstellungen gespeichert');
      await loadServerSettings();
      renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  });
}

async function renderSettings() {
  const active = settingsSections.some(([id]) => id === state.activeSettings) ? state.activeSettings : 'general';
  const [, title, description] = settingsSections.find(([id]) => id === active);
  if (active === 'users' && state.user?.admin) await Promise.all([loadUsers(), loadProjects()]);
  if (active === 'tags' && state.user?.admin) await loadTags();
  if (active === 'data' && state.user?.admin) await Promise.all([loadUsers(), loadProjects(), loadTags(), loadFolders(), loadServerSettings(), loadStorageStats()]);
  if (active === 'profile') await loadProjects();
  if (active === 'security' && !state.user.mustChangePassword) await loadSessions();
  if (active === 'audit' && state.user?.admin) await loadAudit();
  if (active === 'server' && state.user?.admin) await loadServerSettings();
  if (active === 'system' && state.user?.admin) await loadSystemStatus();
  if (active === 'general') await loadIconLibrary();
  const headerAction = active === 'users' && state.user?.admin ? '<button class="button primary compact" data-new-user>+ Benutzer</button>' : active === 'tags' && state.user?.admin ? '<button class="button primary compact" data-new-tag>+ Tag</button>' : '';
  const settingsHead = standardPageHeader({ title, description, icon:'settings', actions:headerAction, className:'settings-page-head' });
  $('#main').innerHTML = `${settingsHead}<section class="project-page-content settings-page-content"><section class="settings-panel settings-panel-wide">${settingsContent(active)}</section></section>`;
  if (active === 'users' && state.user?.admin) bindUserActions();
  if (active === 'tags' && state.user?.admin) bindTagActions();
  if (active === 'data' && state.user?.admin) bindDataActions();
  if (active === 'security') bindSecurityActions();
  if (active === 'system' && state.user?.admin) bindSystemActions();
  if (active === 'server' && state.user?.admin) bindServerActions();
  if (active === 'profile') $('[data-change-password]').onclick = () => openPasswordDialog(false);
  if (active === 'general') {
    const savePreference = async (control, key, value) => {
      control.disabled = true;
      try {
        const result = await api('/account/preferences', { method:'PATCH', body:JSON.stringify({ [key]:value }) });
        Object.assign(state.user, result);
        if (key === 'projectSort') state.projectSort = sortFromPreference(value, true, 'status:asc');
        if (key === 'archiveSort') state.archiveSort = sortFromPreference(value, false, 'createdAt:desc');
        if (key === 'defaultProjectIcon') updateProjectNavigationIcon();
        toast('Allgemeine Einstellung gespeichert');
      } catch (error) { toast(error.message); }
      finally { control.disabled = false; }
    };
    $('#start-page-setting').onchange = event => savePreference(event.currentTarget, 'startPage', event.currentTarget.value);
    document.querySelectorAll('[data-general-preference]').forEach(select => select.onchange = event => savePreference(event.currentTarget, event.currentTarget.dataset.generalPreference, event.currentTarget.value));
    renderIconPicker('default-project');
    const iconInput = $('#default-project-icon-form').elements.icon;
    iconInput.onchange = () => savePreference(iconInput, 'defaultProjectIcon', iconInput.value);
  }
}

const tarDecoder = new TextDecoder();

const createTar = files => LogbuchBackupArchive.create(files);
const parseTar = buffer => LogbuchBackupArchive.parse(buffer);

function validateProjectBackup(manifest) {
  if (!LogbuchBackupFormat.isProjectManifest(manifest) || !Array.isArray(manifest.projects)) throw new Error('Kein unterstütztes Logbuch-Projektarchiv');
  for (const project of manifest.projects) {
    if (!project?.id || !project?.title || !Array.isArray(project.entries)) throw new Error('Das Backup enthält unvollständige Projektdaten');
    for (const collection of backupCollections) {
      if (['tasks','shopping','learnings','notes'].includes(collection) && !Array.isArray(project[collection])) project[collection] = [];
      if (!Array.isArray(project[collection])) throw new Error(`Der Bereich „${collection}“ fehlt im Backup`);
    }
    if (!Array.isArray(project.files)) project.files = [];
  }
  if (manifest.tags != null && !Array.isArray(manifest.tags)) throw new Error('Die Tag-Definitionen im Backup sind ungültig');
  if (manifest.folders != null && (!Array.isArray(manifest.folders) || manifest.folders.length > 1000)) throw new Error('Die Projektordner im Backup sind ungültig');
  if (manifest.serverSettings != null && (typeof manifest.serverSettings !== 'object' || Array.isArray(manifest.serverSettings))) throw new Error('Die Servereinstellungen im Backup sind ungültig');
  manifest.tags ||= [];
  manifest.folders ||= [];
  manifest.serverSettings ||= null;
  return manifest;
}

function validateUserBackup(manifest) {
  if (!LogbuchBackupFormat.isUserManifest(manifest) || !Array.isArray(manifest.accounts)) throw new Error('Kein unterstütztes Logbuch-Benutzerarchiv');
  for (const account of manifest.accounts) {
    const phpBackup = account?.passwordAlgorithm === 'php-password-hash' && account?.passwordHash;
    const legacyBackup = account?.passwordHash && account?.salt;
    if (!account?.id || !account?.name || (!phpBackup && !legacyBackup)) throw new Error('Das Archiv enthält unvollständige Benutzerkonten');
  }
  return manifest;
}

async function buildUserBackup() {
  const data = await api('/backup/users');
  const manifest = { format:'logbuch-users', version:1, exportedAt:new Date().toISOString(), source:{ name:'Logbuch', host:location.host }, accounts:data.accounts || [] };
  return createTar([['manifest.json', JSON.stringify(manifest, null, 2)], ['users/accounts.json', JSON.stringify(manifest.accounts, null, 2)]]);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readBackupFile(file, validator, maxMegabytes = 1024) {
  if (!file) return null;
  if (file.size > maxMegabytes * 1024 * 1024) throw new Error(`Das Archiv ist größer als ${maxMegabytes} MB`);
  const files = parseTar(await file.arrayBuffer());
  if (!files.has('manifest.json')) throw new Error('Im Archiv fehlt manifest.json');
  const manifest = validator(JSON.parse(tarDecoder.decode(files.get('manifest.json'))));
  Object.defineProperty(manifest, '_archiveFiles', { value:files, enumerable:false });
  return manifest;
}

function bindDataActions() {
  let selectedFull = null;
  let selectedProjects = null;
  let selectedUsers = null;
  const userExport = $('[data-export-users]');
  const fullImport = $('[data-import-full]');
  const projectImport = $('[data-import-projects]');
  const userImport = $('[data-import-users]');

  userExport.onclick = async () => {
    userExport.disabled = true; userExport.textContent = 'Archiv wird erstellt …';
    try {
      downloadBlob(await buildUserBackup(), `logbuch-benutzer-${today()}.tar`); toast('Benutzerkonten wurden gesichert');
    } catch (error) { toast(error.message); }
    finally { userExport.disabled = false; userExport.textContent = 'Benutzerkonten herunterladen'; }
  };

  $('#full-backup-file').onchange = event => {
    selectedFull = null; fullImport.disabled = true;
    const file = event.target.files?.[0]; const preview = $('#full-backup-preview');
    if (!file) { preview.textContent = 'Noch kein Vollbackup ausgewählt.'; return; }
    if (file.size > 4 * 1024 ** 3) { preview.textContent = 'Das Archiv ist größer als 4 GB.'; return; }
    selectedFull = file;
    preview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(formatBytes(file.size))} · Aufbau, Verknüpfungen und Dateiprüfsummen werden vor dem Ersetzen geprüft.</span>`;
    fullImport.disabled = false;
  };

  $('#project-backup-file').onchange = async event => {
    selectedProjects = null; projectImport.disabled = true;
    const file = event.target.files?.[0]; const preview = $('#project-backup-preview');
    if (!file) { preview.textContent = 'Noch kein Projektarchiv ausgewählt.'; return; }
    if (file.size > 4 * 1024 ** 3) { preview.textContent = 'Das Archiv ist größer als 4 GB.'; return; }
    selectedProjects = file;
    preview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(formatBytes(file.size))} · Inhalt und Prüfsummen werden beim Import auf dem Server geprüft.</span>`;
    projectImport.textContent = 'Projektarchiv importieren';
    projectImport.disabled = false;
  };

  $('#user-backup-file').onchange = async event => {
    selectedUsers = null; userImport.disabled = true;
    const file = event.target.files?.[0]; const preview = $('#user-backup-preview');
    if (!file) { preview.textContent = 'Noch kein Benutzerarchiv ausgewählt.'; return; }
    try {
      selectedUsers = await readBackupFile(file, validateUserBackup, 10);
      preview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${selectedUsers.accounts.length} ${selectedUsers.accounts.length === 1 ? 'Benutzerkonto' : 'Benutzerkonten'} · Export ${escapeHtml(formatDateTime(selectedUsers.exportedAt))}</span>`;
      userImport.disabled = false;
    } catch (error) { preview.textContent = error.message; toast(error.message); }
  };

  projectImport.onclick = async () => {
    if (!selectedProjects) return;
    const replace = $('#project-backup-conflict').value === 'replace';
    if (replace && !await confirmAction('Vorhandene Projekte mit gleicher ID werden vollständig ersetzt. Fortfahren?', { title:'Projekte ersetzen', confirmLabel:'Importieren' })) return;
    projectImport.disabled = true; projectImport.textContent = 'Import läuft …';
    try {
      const payload = new FormData();
      payload.append('archive', selectedProjects, selectedProjects.name);
      payload.append('conflict', replace ? 'replace' : 'skip');
      const result = await api('/import/projects-archive', { method:'POST', body:payload });
      toast(`${result.imported || 0} Projekte importiert${result.skipped ? `, ${result.skipped} übersprungen` : ''} · ${result.filesImported || 0} Dateien`);
      await Promise.all([loadProjects(), loadUsers(), loadTags(), loadFolders(), loadStorageStats()]); renderSettings();
    } catch (error) { toast(`Import abgebrochen: ${error.message}`); projectImport.disabled = false; projectImport.textContent = 'Projektarchiv importieren'; }
  };

  userImport.onclick = async () => {
    if (!selectedUsers) return;
    const replace = $('#user-backup-conflict').value === 'replace';
    if (replace && !await confirmAction('Vorhandene Benutzerkonten werden durch den Stand aus dem Archiv ersetzt. Fortfahren?', { title:'Benutzerkonten ersetzen', confirmLabel:'Importieren' })) return;
    userImport.disabled = true; userImport.textContent = 'Import läuft …';
    try {
      const result = await api('/import/users', { method:'POST', body:JSON.stringify({ accounts:selectedUsers.accounts, replace }) });
      toast(`${result.imported || 0} Benutzer importiert${result.skipped ? `, ${result.skipped} übersprungen` : ''}`);
      await loadUsers(); renderSettings();
    } catch (error) { toast(`Import abgebrochen: ${error.message}`); userImport.disabled = false; userImport.textContent = 'Benutzerkonten einspielen'; }
  };

  fullImport.onclick = async () => {
    if (!selectedFull || !await confirmAction('Das Vollbackup ersetzt alle aktuellen Projekte, Erinnerungen, Benutzer- und Lagerdaten. Alle angemeldeten Geräte werden danach abgemeldet. Wirklich fortfahren?', { title:'Vollbackup wiederherstellen', confirmLabel:'Alles ersetzen' })) return;
    fullImport.disabled = true; fullImport.textContent = 'Wiederherstellung läuft …';
    try {
      const payload = new FormData();
      payload.append('archive', selectedFull, selectedFull.name);
      await api('/import/full-archive', { method:'POST', body:payload });
      alert('Das Vollbackup wurde wiederhergestellt. Bitte melde dich erneut an.');
      location.href = '/';
      location.reload();
    } catch (error) {
      toast(`Wiederherstellung abgebrochen: ${error.message}`);
      fullImport.disabled = false; fullImport.textContent = 'Vollbackup wiederherstellen';
    }
  };
}

function profileContent() {
  const accessibleProjects = state.user.admin
    ? '<span class="profile-value">Alle Projekte</span>'
    : state.projects.length
      ? `<div class="profile-projects">${state.projects.map(project => `<span>${escapeHtml(project.title)}</span>`).join('')}</div>`
      : '<span class="profile-value">Keine Projekte</span>';
  return `<div class="settings-group profile-settings"><div class="setting-list">
    <div class="setting-row"><div><strong>Benutzername</strong><p>Mit diesem Namen meldest du dich beim Logbuch an.</p></div><span class="profile-value">${escapeHtml(state.user.id)}</span></div>
    <div class="setting-row"><div><strong>Rolle</strong><p>Die Rolle bestimmt deine grundlegenden Rechte im Logbuch.</p></div><span class="profile-value">${escapeHtml(userRoleLabel(state.user.role))}</span></div>
    <div class="setting-row profile-project-row"><div><strong>Zugängliche Projekte</strong><p>Diese Projekte kannst du entsprechend deiner Rolle ansehen oder bearbeiten.</p></div>${accessibleProjects}</div>
    <div class="setting-row"><div><strong>Passwort</strong><p>Ändere das Passwort für deinen persönlichen Zugang.</p></div><button class="button secondary compact" data-change-password>Passwort ändern</button></div>
  </div></div>`;
}

const tabEmpty = config => `<div class="empty"><strong>Noch keine ${config.plural}.</strong>${config.emptyText}</div>`;
function orderedItems(items, fallbackCompare) {
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftOrder = Number.isInteger(left.item.sortOrder) ? left.item.sortOrder : null;
    const rightOrder = Number.isInteger(right.item.sortOrder) ? right.item.sortOrder : null;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftOrder === null && rightOrder !== null) return -1;
    if (leftOrder !== null && rightOrder === null) return 1;
    return fallbackCompare ? fallbackCompare(left.item, right.item) || left.index - right.index : left.index - right.index;
  }).map(entry => entry.item);
}

const reorderHandle = (collection, id) => mayEditProjects() ? `<button class="drag-handle" type="button" data-reorder-handle data-reorder-collection="${collection}" data-reorder-id="${escapeHtml(id)}" aria-label="Reihenfolge ändern" title="Ziehen, um die Reihenfolge zu ändern"><svg viewBox="0 0 16 20" aria-hidden="true"><circle cx="5" cy="4" r="1.25"></circle><circle cx="11" cy="4" r="1.25"></circle><circle cx="5" cy="10" r="1.25"></circle><circle cx="11" cy="10" r="1.25"></circle><circle cx="5" cy="16" r="1.25"></circle><circle cx="11" cy="16" r="1.25"></circle></svg></button>` : '';
const completeButton = id => `<button class="status-action complete-action" type="button" data-complete-task="${escapeHtml(id)}" aria-label="Als erledigt loggen" title="Als erledigt loggen"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4.5 10.5 3.4 3.4 7.6-8"></path></svg></button>`;
const reopenButton = id => `<button class="status-action reopen-action" type="button" data-reopen-entry="${escapeHtml(id)}" aria-label="Zu den anstehenden Arbeitsschritten zurückstellen" title="Zu den anstehenden Arbeitsschritten zurückstellen"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 15.5v-11m-5 5 5-5 5 5"></path></svg></button>`;
const mobileStatusToggle = label => `<button class="mobile-status-toggle" type="button" data-mobile-status-toggle aria-expanded="false"><span>${escapeHtml(label)}</span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5"></path></svg></button>`;
const mobileActionMenu = (label, items) => `<details class="action-menu mobile-workstep-menu"><summary aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${iconSvg('ellipsis')}</summary><div class="action-menu-panel">${items}</div></details>`;

function mobileTaskControls(task) {
  if (!mayEditProjects()) return task.flagged === true ? `<div class="mobile-workstep-actions">${taskFlagControl(task)}</div>` : '';
  const id = escapeHtml(task.id);
  const items = `<button class="menu-item" type="button" data-edit-item="tasks:${id}">Bearbeiten</button><button class="menu-item" type="button" data-task-flag="${id}" data-flagged="${task.flagged === true}">${task.flagged === true ? 'Markierung entfernen' : 'Markieren'}</button><button class="menu-item" type="button" data-complete-task="${id}">Als erledigt loggen</button><button class="menu-item danger" type="button" data-delete-item="tasks:${id}">Löschen</button>`;
  return `<div class="mobile-workstep-actions">${reorderHandle('tasks', task.id)}${mobileActionMenu('Arbeitsschrittaktionen', items)}</div>`;
}

function mobileEntryControls(entry) {
  if (!mayEditProjects()) return '';
  const id = escapeHtml(entry.id);
  const items = `<button class="menu-item" type="button" data-edit-entry="${id}">Bearbeiten</button><button class="menu-item" type="button" data-copy-entry-link="${id}">Link kopieren</button><button class="menu-item" type="button" data-reopen-entry="${id}">Zurückstellen</button><button class="menu-item danger" type="button" data-delete-entry="${id}">Löschen</button>`;
  return `<div class="mobile-workstep-actions">${reorderHandle('entries', entry.id)}${mobileActionMenu('Arbeitsschrittaktionen', items)}</div>`;
}

const attachmentCollectionLabels = { entries:'Logbucheintrag', tasks:'Arbeitsschritt', shopping:'Einkaufsgegenstand', materials:'Material', contacts:'Kontakt', links:'Link', ideas:'Idee', learnings:'Erkenntnis', notes:'Notiz' };
const attachmentTabByCollection = { entries:'entries', tasks:'entries', shopping:'shopping', materials:'materials', contacts:'contacts', links:'links', ideas:'ideas', learnings:'learnings', notes:'notes' };

function attachmentEntity(collection, itemId, project = state.current) {
  const item = project?.[collection]?.find(candidate => candidate.id === itemId);
  if (!item) return null;
  return { item, label:attachmentCollectionLabels[collection] || 'Eintrag', title:item.name || item.title || entryTitle(item) };
}

function attachmentContentUrl(file, download = false) {
  return `/api/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(file.id)}/content${download ? '?download=1' : ''}`;
}

function attachmentThumbnailUrl(file) {
  return `/api/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(file.id)}/thumbnail`;
}

function entityAttachments(collection, itemId) {
  return (state.current?.files || []).filter(file => file.association?.collection === collection && file.association?.itemId === itemId);
}

function attachmentStrip(collection, itemId) {
  const files = entityAttachments(collection, itemId);
  const links = files.map(file => {
    const image = String(file.mimeType || '').startsWith('image/');
    const thumbnail = image
      ? `<span class="attachment-thumbnail image"><img data-file-image="${escapeHtml(file.id)}" src="${attachmentThumbnailUrl(file)}" alt="" loading="lazy" decoding="async" style="transform:rotate(${Number(file.rotation) || 0}deg)"></span>`
      : `<span class="attachment-thumbnail document" aria-hidden="true"><small>${String(file.mimeType || '').includes('pdf') ? 'PDF' : 'DATEI'}</small></span>`;
    const content = `${thumbnail}<span class="attachment-name">${escapeHtml(file.displayName || file.originalName)}</span><span class="attachment-size">${escapeHtml(formatBytes(file.size))}</span>`;
    return image
      ? `<button class="attachment-row attachment-view" type="button" data-view-file="${escapeHtml(file.id)}" title="${escapeHtml(file.originalName)}">${content}</button>`
      : `<a class="attachment-row" href="${attachmentContentUrl(file, true)}" title="${escapeHtml(file.originalName)}">${content}</a>`;
  }).join('');
  const add = mayEditProjects() ? `<button class="attachment-add" type="button" data-upload-file="${collection}:${escapeHtml(itemId)}">Datei anhängen</button>` : '';
  if (!files.length && !add) return '';
  return `<div class="entity-attachments" aria-label="Dateianhänge">${links}${add}</div>`;
}

function filesView(project) {
  const files = project.files || [];
  const visibleFiles = files.slice(0, state.visibleProjectFiles);
  const cards = visibleFiles.map(file => {
    const association = file.association ? attachmentEntity(file.association.collection, file.association.itemId, project) : null;
    const image = String(file.mimeType || '').startsWith('image/');
    const preview = image
      ? `<button class="file-preview image" type="button" data-view-file="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.displayName || file.originalName)} im Bildbetrachter öffnen"><img data-file-image="${escapeHtml(file.id)}" src="${attachmentThumbnailUrl(file)}" alt="" loading="lazy" decoding="async" style="transform:rotate(${Number(file.rotation) || 0}deg)"></button>`
      : `<a class="file-preview document" href="${attachmentContentUrl(file, true)}"><span aria-hidden="true">${String(file.mimeType || '').includes('pdf') ? 'PDF' : 'DATEI'}</span></a>`;
    const relation = association ? `<button class="file-association" type="button" data-file-jump="${escapeHtml(file.association.collection)}:${escapeHtml(file.association.itemId)}"><small>Zugeordnet zu</small><strong>${escapeHtml(association.label)} · ${escapeHtml(association.title)}</strong></button>` : '<span class="file-unassigned">Ohne Eintragszuordnung</span>';
    const actions = mayEditProjects() ? `<div class="file-actions">${image ? `<button class="icon-button" type="button" data-rotate-file="${escapeHtml(file.id)}" aria-label="Bild im Uhrzeigersinn drehen" title="Bild drehen">↻</button>` : ''}<button class="icon-button" type="button" data-edit-file="${escapeHtml(file.id)}" aria-label="Dateimetadaten bearbeiten" title="Bearbeiten">✎</button><button class="icon-button delete-action" type="button" data-delete-file="${escapeHtml(file.id)}" aria-label="Datei löschen" title="Löschen">×</button></div>` : '';
    return `<article class="file-card" id="${escapeHtml(file.id)}" data-file-card="${escapeHtml(file.id)}">${preview}<div class="file-card-copy"><h3>${escapeHtml(file.displayName || file.originalName)}</h3><p class="file-original-name">${escapeHtml(file.originalName)}</p><p class="file-description"${file.description ? '' : ' hidden'}>${escapeHtml(file.description || '')}</p><div class="file-meta"><span>${escapeHtml(formatBytes(file.size))}</span><span>${escapeHtml(file.mimeType || 'Datei')}</span><span>${escapeHtml(formatDateTime(file.uploadedAt))}</span></div>${relation}</div>${actions}</article>`;
  }).join('');
  const remaining = files.length - visibleFiles.length;
  const more = remaining > 0 ? `<button class="button secondary files-load-more" type="button" data-load-more-files>Weitere ${Math.min(50, remaining)} anzeigen <small>(${remaining} übrig)</small></button>` : '';
  return `<div class="file-grid">${cards}</div>${more}`;
}

function entriesView(project) {
  if (!project.entries?.length) return `<div class="empty">Halte fest, was du an diesem Projekt gemacht hast.</div>`;
  const entries = orderedItems(project.entries, (a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return `<div class="timeline" data-reorder-list="entries">${entries.map(entry => {
    const body = entry.body ? `<div class="entry-body">${escapeHtml(entry.body)}</div>` : '';
    const empty = !body ? '<div class="entry-empty">Arbeitsschritt ohne zusätzliche Notiz</div>' : '';
    const editCard = mayEditProjects() ? ` data-edit-entry-card="${escapeHtml(entry.id)}" role="button" tabindex="0" aria-label="${escapeHtml(entryTitle(entry))} bearbeiten"` : '';
    const controls = mayEditProjects() ? `<div class="workstep-card-actions desktop-workstep-actions">${entryEditButton(entry.id)}<div class="workstep-action-group">${entryCopyButton(entry.id)}${reopenButton(entry.id)}${reorderHandle('entries', entry.id)}${entryDeleteButton(entry.id)}</div></div>` : '';
    return `<article class="entry workstep-card" id="${escapeHtml(entry.id)}" data-reorder-card data-reorder-id="${escapeHtml(entry.id)}"${editCard}><div class="workstep-card-content"><strong>${escapeHtml(entryTitle(entry))}</strong>${body}${empty}${attachmentStrip('entries', entry.id)}</div><aside class="workstep-card-status mobile-collapsed" data-mobile-status-panel aria-label="Attribute des erledigten Arbeitsschritts"><div class="mobile-workstep-status-head">${mobileStatusToggle('Statusdetails')}${mobileEntryControls(entry)}</div><div class="workstep-status-content" data-mobile-status-content>${controls}<div class="project-status-row"><small>Erledigt am</small><span class="project-status-value">${formatDate(entry.date)}</span></div><div class="project-status-row"><small>Bearbeitet von</small><span class="project-status-value">${escapeHtml(entry.author)}</span></div></div></aside></article>`;
  }).join('')}</div>`;
}

function itemCard(collection, item) {
  const config = sections[collection];
  const title = item.name || item.title || config.singular;
  let meta = '';
  let description = '';
  if (collection === 'shopping') {
    meta = [item.quantity, item.retailer, item.status, item.priority && item.priority !== 'Normal' ? `Priorität ${item.priority}` : '', item.unitPrice].filter(Boolean).map(escapeHtml).join(' · ');
    description = item.notes ? escapeHtml(item.notes) : '';
  }
  if (collection === 'materials') meta = [item.quantity, item.status, item.price].filter(Boolean).map(escapeHtml).join(' · ');
  if (collection === 'contacts') meta = [item.role, item.company, item.email, item.phone].filter(Boolean).map(escapeHtml).join(' · ');
  if (collection === 'links') description = item.notes ? escapeHtml(item.notes) : '';
  if (collection === 'ideas') { meta = item.status ? escapeHtml(item.status) : ''; description = item.description ? escapeHtml(item.description) : ''; }
  if (['learnings','notes'].includes(collection)) description = item.description ? escapeHtml(item.description) : '';
  const url = item.url ? `<a class="item-link" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>` : '';
  const actions = mayEditProjects() ? `<div class="item-actions">${reorderHandle(collection, item.id)}<details class="action-menu"><summary aria-label="${config.singular}aktionen">${iconSvg('ellipsis')}</summary><div class="action-menu-panel"><button class="menu-item" data-edit-item="${collection}:${escapeHtml(item.id)}">Bearbeiten</button><button class="menu-item danger" data-delete-item="${collection}:${escapeHtml(item.id)}">Löschen</button></div></details></div>` : '';
  const editCard = mayEditProjects() ? ` data-edit-item-card="${collection}:${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="${escapeHtml(title)} bearbeiten"` : '';
  return `<article class="item-card" id="${escapeHtml(item.id)}" data-reorder-card data-reorder-id="${escapeHtml(item.id)}"${editCard}><div class="item-card-copy"><h3>${escapeHtml(title)}</h3>${meta ? `<small>${meta}</small>` : ''}${description ? `<p>${description}</p>` : ''}${item.futureUse && collection === 'learnings' ? `<p><strong>Für die Zukunft:</strong> ${escapeHtml(item.futureUse)}</p>` : ''}${url}${item.properties ? `<p>${escapeHtml(item.properties)}</p>` : ''}${item.notes && collection === 'contacts' ? `<p>${escapeHtml(item.notes)}</p>` : ''}${attachmentStrip(collection, item.id)}</div>${actions}</article>`;
}

function itemsView(project, collection) {
  const items = orderedItems(project[collection] || []);
  return `<div class="item-grid" data-reorder-list="${collection}">${items.map(item => itemCard(collection, item)).join('')}</div>`;
}

function taskCard(task) {
  const editCard = mayEditProjects() ? ` data-edit-item-card="tasks:${escapeHtml(task.id)}" role="button" tabindex="0" aria-label="${escapeHtml(task.title)} bearbeiten"` : '';
  const priority = ['Normal','Hoch','Niedrig'].includes(task.priority) ? task.priority : 'Normal';
  const priorityClass = priority.toLocaleLowerCase('de');
  const priorityControl = mayEditProjects() ? `<select class="project-inline-select project-priority task-attribute-select task-priority ${priorityClass}" data-task-inline-priority="${escapeHtml(task.id)}" aria-label="Priorität von ${escapeHtml(task.title)} ändern"><option${priority === 'Hoch' ? ' selected' : ''}>Hoch</option><option${priority === 'Normal' ? ' selected' : ''}>Normal</option><option${priority === 'Niedrig' ? ' selected' : ''}>Niedrig</option></select>` : `<span class="project-priority task-priority ${priorityClass}">${escapeHtml(priority)}</span>`;
  const controls = mayEditProjects() ? `<div class="workstep-card-actions desktop-workstep-actions">${itemEditButton('tasks', task.id)}<div class="workstep-action-group">${taskFlagControl(task)}${completeButton(task.id)}${reorderHandle('tasks', task.id)}${itemDeleteButton('tasks', task.id, 'Arbeitsschritt')}</div></div>` : task.flagged === true ? `<div class="workstep-card-actions desktop-workstep-actions"><span></span><div class="workstep-action-group">${taskFlagControl(task)}</div></div>` : '';
  return `<article class="task-card workstep-card" id="${escapeHtml(task.id)}" data-reorder-card data-reorder-id="${escapeHtml(task.id)}"${editCard}><div class="workstep-card-content"><h3>${escapeHtml(task.title)}</h3>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}${attachmentStrip('tasks', task.id)}</div><aside class="workstep-card-status mobile-collapsed" data-mobile-status-panel aria-label="Attribute des Arbeitsschritts"><div class="mobile-workstep-status-head">${mobileStatusToggle('Statusdetails')}${mobileTaskControls(task)}</div><div class="workstep-status-content" data-mobile-status-content>${controls}<div class="project-status-row"><small>Priorität</small>${priorityControl}</div><div class="project-status-row"><small>Fälligkeit</small><span class="project-status-value">${task.dueDate ? formatDate(task.dueDate) : 'ohne'}</span></div></div></aside></article>`;
}

function diaryView(project) {
  const tasks = orderedItems((project.tasks || []).filter(task => task.status !== 'Erledigt'), (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const entries = project.entries || [];
  const taskHeading = workStepCount(tasks.length);
  const entryHeading = workStepCount(entries.length, true);
  const sectionToggle = (section, label) => `<div class="project-status-divider log-section-divider"><button class="log-divider-toggle" type="button" data-toggle-log-section="${section}" aria-expanded="${!state.collapsedLogSections[section]}" aria-label="${label} ${state.collapsedLogSections[section] ? 'ausklappen' : 'einklappen'}" title="${state.collapsedLogSections[section] ? 'Ausklappen' : 'Einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><strong class="divider-label">${escapeHtml(label)}</strong></button></div>`;
  const tasksSection = tasks.length ? `<section class="next-steps-section"><div class="section-head log-section-head">${sectionToggle('tasks', taskHeading)}</div><div data-log-section-content="tasks"${state.collapsedLogSections.tasks ? ' hidden' : ''}><div class="next-steps-list" data-reorder-list="tasks">${tasks.map(taskCard).join('')}</div></div></section>` : '';
  const entriesSection = entries.length ? `<section class="diary-section"><div class="section-head log-section-head">${sectionToggle('entries', entryHeading)}</div><div data-log-section-content="entries"${state.collapsedLogSections.entries ? ' hidden' : ''}>${entriesView(project)}</div></section>` : '';
  return `${tasksSection}${entriesSection}`;
}

const projectSectionLabels = { logbook:'Logbuch', inventoryMaterials:'Lagermaterial', notes:'Notizen', shopping:'Einkaufsliste', materials:'Material', contacts:'Kontakte', links:'Links', ideas:'Ideen', learnings:'Erkenntnisse', files:'Dateien' };

function unifiedProjectSection(id, count, content) {
  const collapsed = state.collapsedProjectSections[id] === true;
  const label = projectSectionLabels[id] || id;
  return `<section class="project-unified-section" data-project-section="${id}"><div class="unified-section-head"><button type="button" data-toggle-project-section="${id}" aria-expanded="${!collapsed}" aria-label="${escapeHtml(label)} ${collapsed ? 'ausklappen' : 'einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg><span><strong>${escapeHtml(label)}</strong><small>${count}</small></span></button></div><div class="project-unified-content" data-project-section-content="${id}"${collapsed ? ' hidden' : ''}>${content}</div></section>`;
}

function unifiedProjectView(project) {
  const openTasks = (project.tasks || []).filter(task => task.status !== 'Erledigt');
  const logCount = openTasks.length + (project.entries || []).length;
  const definitions = [
    ['logbook', logCount, () => diaryView(project)],
    ['inventoryMaterials', state.projectReservations.length, () => `<div class="project-reservation-list">${state.projectReservations.map(reservation => reservationMarkup(reservation, 'project')).join('')}</div>`],
    ['notes', (project.notes || []).length, () => itemsView(project, 'notes')],
    ['shopping', (project.shopping || []).length, () => itemsView(project, 'shopping')],
    ['materials', (project.materials || []).length, () => itemsView(project, 'materials')],
    ['contacts', (project.contacts || []).length, () => itemsView(project, 'contacts')],
    ['links', (project.links || []).length, () => itemsView(project, 'links')],
    ['ideas', (project.ideas || []).length, () => itemsView(project, 'ideas')],
    ['learnings', (project.learnings || []).length, () => itemsView(project, 'learnings')],
    ['files', (project.files || []).length, () => filesView(project)],
  ];
  const visible = definitions.filter(([, count]) => count > 0).map(([id, count, render]) => unifiedProjectSection(id, count, render())).join('');
  if (visible) return `<div class="project-unified-sections">${visible}</div>`;
  return `<div class="empty project-content-empty"><strong>Noch keine Projektinhalte vorhanden.</strong>${mayEditProjects() ? 'Nutze den Plus-Button, um den ersten Eintrag anzulegen.' : 'Sobald Inhalte angelegt wurden, erscheinen sie hier.'}</div>`;
}

const printDate = value => value ? formatDate(String(value).slice(0, 10)) : 'ohne';
const printText = value => String(value || '').trim() ? `<p>${escapeHtml(String(value).trim())}</p>` : '';
const printLink = value => String(value || '').trim() ? `<a class="project-print-link" href="${escapeHtml(safeUrl(String(value).trim()))}">${escapeHtml(String(value).trim())}</a>` : '';

function printRecordMeta(rows) {
  return `<dl class="project-print-record-meta">${rows.filter(([, value]) => String(value ?? '').trim()).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function printRecord(title, rows = [], body = '') {
  return `<article class="project-print-record"><h3>${escapeHtml(title)}</h3>${rows.length ? printRecordMeta(rows) : ''}${body}</article>`;
}

function printSection(title, items) {
  if (!items.length) return '';
  return `<section class="project-print-section"><div class="project-print-section-head"><h2>${escapeHtml(title)}</h2><span>${items.length}</span></div><div class="project-print-records">${items.join('')}</div></section>`;
}

function printTaskRecord(task) {
  return printRecord(task.title || 'Arbeitsschritt', [
    ['Priorität', task.priority || 'Normal'],
    ['Fälligkeit', printDate(task.dueDate)],
    ...(task.flagged === true ? [['Markiert', 'Ja']] : []),
  ], printText(task.description));
}

function printEntryRecord(entry, sourceTask = null) {
  return printRecord(entryTitle(entry), [
    ['Erledigt am', printDate(entry.date)],
    ['Bearbeitet von', entry.author || 'Unbekannt'],
    ...(sourceTask ? [['Priorität', sourceTask.priority || 'Normal'], ['Ursprünglich fällig', printDate(sourceTask.dueDate)]] : []),
  ], `${printText(entry.body)}${String(entry.nextStep || '').trim() ? `<div class="project-print-future"><strong>Nächster Schritt</strong>${printText(entry.nextStep)}</div>` : ''}`);
}

function printItemRecord(collection, item) {
  if (collection === 'notes') return printRecord(item.title || 'Notiz', [], printText(item.description));
  if (collection === 'shopping') return printRecord(item.name || 'Einkaufsgegenstand', [
    ['Eigenschaft', item.properties || 'ohne'],
    ['Anzahl', item.quantity || 'ohne'],
    ['Händler', item.retailer || 'ohne'],
    ['Status', item.status || 'Benötigt'],
    ['Priorität', item.priority || 'Normal'],
    ['Preis', item.unitPrice || 'ohne'],
  ], `${printText(item.notes)}${printLink(item.url)}`);
  if (collection === 'materials') return printRecord(item.name || 'Material', [
    ['Menge', item.quantity || 'ohne'],
    ['Status', item.status || 'ohne'],
    ['Preis', item.price || 'ohne'],
  ], `${printText(item.properties)}${printLink(item.url)}`);
  if (collection === 'contacts') return printRecord(item.name || 'Kontakt', [
    ['Rolle', item.role || 'ohne'],
    ['Firma', item.company || 'ohne'],
    ['E-Mail', item.email || 'ohne'],
    ['Telefon', item.phone || 'ohne'],
  ], printText(item.notes));
  if (collection === 'links') return printRecord(item.title || 'Link', [], `${printText(item.notes)}${printLink(item.url)}`);
  if (collection === 'ideas') return printRecord(item.title || 'Idee', [['Status', item.status || 'Offen']], printText(item.description));
  if (collection === 'learnings') return printRecord(item.title || 'Erkenntnis', [], `${printText(item.description)}${String(item.futureUse || '').trim() ? `<div class="project-print-future"><strong>Für die Zukunft</strong>${printText(item.futureUse)}</div>` : ''}`);
  return printRecord(item.title || item.name || 'Eintrag');
}

function projectExportFileRecord(project, file) {
  const isImage = String(file.mimeType || '').startsWith('image/');
  const association = file.association ? attachmentEntity(file.association.collection, file.association.itemId, project) : null;
  const associationLabel = association ? `${association.label}: ${association.title}` : 'Ohne Zuordnung';
  const rotation = ((Number(file.rotation) || 0) % 360 + 360) % 360;
  const preview = isImage
    ? `<figure class="project-export-image"><img src="${attachmentContentUrl(file)}" alt="${escapeHtml(file.displayName || file.originalName)}" style="transform:rotate(${rotation}deg)"></figure>`
    : `<div class="project-export-document" aria-hidden="true"><strong>${String(file.mimeType || '').includes('pdf') ? 'PDF' : 'DATEI'}</strong></div>`;
  const description = String(file.description || '').trim() ? `<p class="project-export-file-description">${escapeHtml(file.description)}</p>` : '';
  return `<article class="project-print-record project-export-file-record">${preview}<div class="project-export-file-copy"><h3>${escapeHtml(file.displayName || file.originalName || 'Datei')}</h3>${description}${printRecordMeta([
    ['Originaldatei', file.originalName || 'ohne'],
    ['Dateityp', file.mimeType || 'Unbekannt'],
    ['Größe', formatBytes(file.size)],
    ['Zuordnung', associationLabel],
    ['Hochgeladen', formatDateTime(file.uploadedAt)],
    ['Von', file.uploadedBy || 'Unbekannt'],
  ])}</div></article>`;
}

function projectPrintMarkup(project, includeFiles = false) {
  const allTasks = orderedItems(project.tasks || [], (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const taskById = new Map(allTasks.map(task => [task.id, task]));
  const orderedEntries = orderedItems(project.entries || [], (a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const entrySourceIds = new Set(orderedEntries.map(entry => entry.sourceTaskId).filter(Boolean));
  const tasks = allTasks.filter(task => task.status !== 'Erledigt').map(printTaskRecord);
  const entries = [
    ...orderedEntries.map(entry => printEntryRecord(entry, taskById.get(entry.sourceTaskId) || null)),
    ...allTasks.filter(task => task.status === 'Erledigt' && !entrySourceIds.has(task.id)).map(printTaskRecord),
  ];
  const tagNames = (project.tagIds || []).map(tagById).filter(Boolean).map(tag => tag.name).join(', ') || 'Keine';
  const folderPath = folderPathLabel(project.folderId) || 'Kein Ordner';
  const projectFacts = [
    ['Status', projectStatusLabels[project.status] || project.status || 'ohne'],
    ['Priorität', projectPriority(project)],
    ['Startdatum', printDate(project.createdAt)],
    ['Fälligkeit', printDate(project.dueDate)],
    ...(project.completedAt ? [['Abgeschlossen am', printDate(project.completedAt)]] : []),
    ['Ordner', folderPath],
    ['Tags', tagNames],
    ...(project.flagged === true ? [['Markiert', 'Ja']] : []),
  ];
  const logbookContents = `${tasks.length ? `<div class="project-print-subsection"><h3>Anstehende Arbeitsschritte <span>${tasks.length}</span></h3><div class="project-print-records">${tasks.join('')}</div></div>` : ''}${entries.length ? `<div class="project-print-subsection"><h3>Erledigte Arbeitsschritte <span>${entries.length}</span></h3><div class="project-print-records">${entries.join('')}</div></div>` : ''}`;
  const logbook = logbookContents ? `<section class="project-print-section project-print-logbook"><div class="project-print-section-head"><h2>Logbuch</h2><span>${tasks.length + entries.length}</span></div>${logbookContents}</section>` : '';
  const itemSections = [
    ['notes', 'Notizen'],
    ['shopping', 'Einkaufsliste'],
    ['materials', 'Material'],
    ['contacts', 'Kontakte'],
    ['links', 'Links'],
    ['ideas', 'Ideen'],
    ['learnings', 'Erkenntnisse'],
  ].map(([collection, label]) => {
    const items = orderedItems(project[collection] || []).map(item => printItemRecord(collection, item));
    return printSection(label, items);
  }).join('');
  const files = includeFiles ? printSection('Dateien & Bilder', (project.files || []).map(file => projectExportFileRecord(project, file))) : '';
  return `<article class="project-print-sheet"><header class="project-print-header"><img src="/logbuch-logo.svg?v=20260822-3" alt="Logbuch"><p>Projektbericht</p><h1>${escapeHtml(project.title)}</h1><div class="project-print-description">${escapeHtml(project.description || 'Keine Projektbeschreibung hinterlegt.')}</div></header><section class="project-print-facts" aria-label="Projektstatus">${projectFacts.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</section>${logbook}${itemSections}${files}<footer class="project-print-footer"><span>Logbuch</span><span>Erstellt am ${escapeHtml(formatDate(today()))}</span></footer></article>`;
}

async function renderProjectPrint(id) {
  const view = await api(`/project-view/${encodeURIComponent(id)}`);
  state.current = view.project;
  state.tags = view.tags || [];
  state.folders = view.folders || [];
  const project = state.current;
  document.body.classList.add('project-print-mode');
  document.title = `${project.title} – Druckansicht – Logbuch`;
  setProjectsMenu(true, project.status);
  $('#main').innerHTML = `<div class="project-print-shell"><div class="project-print-toolbar"><a class="button secondary compact" href="/#/projects/${encodeURIComponent(project.id)}">Zurück zum Projekt</a><div><span>DIN A4 · Hochformat</span><button class="button primary compact" type="button" data-print-now>${printIcon()} Drucken / als PDF speichern</button></div></div>${projectPrintMarkup(project)}</div>`;
  $('[data-print-now]').onclick = () => window.print();
}

async function renderProjectExport(id) {
  const view = await api(`/project-view/${encodeURIComponent(id)}`);
  state.current = view.project;
  state.tags = view.tags || [];
  state.folders = view.folders || [];
  const project = state.current;
  document.body.classList.add('project-print-mode', 'project-export-mode');
  document.title = `${project.title} – PDF-Export – Logbuch`;
  setProjectsMenu(true, project.status);
  $('#main').innerHTML = `<div class="project-print-shell"><div class="project-print-toolbar"><a class="button secondary compact" href="/#/projects/${encodeURIComponent(project.id)}">Zurück zum Projekt</a><div><span>Farbiges DIN A4 · inklusive Bilder und Metadaten</span><button class="button primary compact" type="button" data-export-pdf>${exportIcon()} Als PDF speichern</button></div></div>${projectPrintMarkup(project, true)}</div>`;
  $('[data-export-pdf]').onclick = async buttonEvent => {
    const button = buttonEvent.currentTarget;
    button.disabled = true;
    button.lastChild.textContent = ' PDF wird vorbereitet …';
    await Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : image.decode?.().catch(() => null) || Promise.resolve()));
    await document.fonts?.ready;
    button.disabled = false;
    button.lastChild.textContent = ' Als PDF speichern';
    window.print();
  };
}

function bindMobileProjectControls() {
  const mobile = window.matchMedia('(max-width: 780px)').matches;
  document.querySelectorAll('[data-mobile-status-panel]').forEach(panel => {
    const toggle = panel.querySelector('[data-mobile-status-toggle]');
    if (!toggle) return;
    panel.classList.toggle('mobile-collapsed', mobile);
    toggle.setAttribute('aria-expanded', String(!mobile));
    toggle.onclick = event => {
      event.stopPropagation();
      const collapsed = panel.classList.toggle('mobile-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    };
  });
}

async function renderProject(id) {
  const [view, reservationData] = await Promise.all([api(`/project-view/${encodeURIComponent(id)}`), api(`/reservations?projectId=${encodeURIComponent(id)}`), loadIconLibrary().catch(() => null)]);
  if (state.current?.id !== view.project.id) state.visibleProjectFiles = 50;
  state.current = view.project;
  state.tags = view.tags || [];
  state.folders = view.folders || [];
  state.projectReservations = (reservationData.reservations || []).filter(reservation => reservation.status === 'ACTIVE');
  const p = state.current;
  if (p.status === 'trashed') { location.href = '/#/trash'; return; }
  setProjectsMenu(true, p.status);
  const content = unifiedProjectView(p);
  const breadcrumbs = p.status === 'archived' ? '<nav class="folder-breadcrumbs" aria-label="Projektpfad"><a href="/#/archive">Archiv</a></nav>' : folderBreadcrumbs(p.folderId || null);
  const addButton = mayEditProjects() ? `<button class="button primary compact project-add-button" type="button" data-open-project-add aria-label="Projektinhalt hinzufügen"><span aria-hidden="true">+</span><b>Hinzufügen</b></button><button class="button secondary compact" type="button" data-reservation-create data-reservation-project="${escapeHtml(p.id)}">Lagermaterial zuordnen</button>` : '';
  $('#main').innerHTML = `<div class="project-page-breadcrumbs">${breadcrumbs}</div><div class="project-page-head"><section class="project-hero"><div class="project-hero-layout"><div class="project-hero-main"><div class="project-heading-row"><span class="project-hero-icon" aria-hidden="true">${iconSvg(projectIconName(p))}</span><div class="project-heading-content"><div class="project-title-line"><h1>${escapeHtml(p.title)}</h1></div><p class="project-description">${escapeHtml(p.description || 'Noch keine Projektbeschreibung hinterlegt.')}</p></div></div></div><aside class="project-hero-status mobile-collapsed" data-mobile-status-panel aria-label="Projektstatus"><div class="project-hero-status-head"><span class="desktop-status-label">Projektdaten</span><div class="mobile-project-status-controls">${mobileStatusToggle('Statusdetails')}</div><div class="project-hero-actions">${projectExportButton(p)}${projectCardActions(p)}</div></div><div class="project-hero-facts" data-mobile-status-content><div class="project-hero-fact"><small>Status</small>${projectStatusControl(p)}</div><div class="project-hero-fact"><small>Priorität</small>${projectPriorityControl(p)}</div><div class="project-hero-fact"><small>Start</small><span class="project-status-value">${p.createdAt ? formatDate(p.createdAt) : 'ohne'}</span></div><div class="project-hero-fact"><small>Fällig</small><span class="project-status-value">${p.dueDate ? formatDate(p.dueDate) : 'ohne'}</span></div><div class="project-hero-fact project-hero-tags"><small>Tags</small>${tagChips(p.tagIds, { limit:20, archived:p.status === 'archived' }) || '<span class="project-status-empty">Keine</span>'}</div></div></aside></div></section></div><section class="project-page-content">${addButton ? `<div class="project-content-toolbar">${addButton}</div>` : ''}${content}</section>`;
  $('[data-ai-project-export]')?.addEventListener('click', () => openAiProjectExportDialog(p));
  document.querySelectorAll('[data-open-project-add]').forEach(button => button.onclick = () => openProjectAddDialog(p.id));
  bindReservationActions();
  bindMobileProjectControls();
  document.querySelectorAll('[data-toggle-project-section]').forEach(button => button.onclick = () => {
    const section = button.dataset.toggleProjectSection;
    state.collapsedProjectSections[section] = !state.collapsedProjectSections[section];
    const expanded = !state.collapsedProjectSections[section];
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${projectSectionLabels[section] || section} ${expanded ? 'einklappen' : 'ausklappen'}`);
    const sectionContent = document.querySelector(`[data-project-section-content="${section}"]`);
    if (sectionContent) sectionContent.hidden = !expanded;
  });
  document.querySelectorAll('[data-toggle-log-section]').forEach(button => button.onclick = () => {
    const section = button.dataset.toggleLogSection;
    state.collapsedLogSections[section] = !state.collapsedLogSections[section];
    const expanded = !state.collapsedLogSections[section];
    const label = button.querySelector('.divider-label')?.textContent || '';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${label} ${expanded ? 'einklappen' : 'ausklappen'}`);
    button.title = expanded ? 'Einklappen' : 'Ausklappen';
    const content = document.querySelector(`[data-log-section-content="${section}"]`);
    if (content) content.hidden = state.collapsedLogSections[section];
  });
  bindEntryActions();
  bindItemActions();
  bindFileActions();
  const loadMoreFiles = $('[data-load-more-files]');
  if (loadMoreFiles) loadMoreFiles.onclick = () => { state.visibleProjectFiles += 50; renderProject(p.id); };
  bindProjectActions();
  bindReordering();
  document.querySelectorAll('[data-complete-task]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const task = p.tasks?.find(item => item.id === button.dataset.completeTask);
    if (!task) return;
    const startedAt = Date.now();
    const card = button.closest('.workstep-card');
    button.disabled = true;
    card?.classList.add('completion-pending');
    try {
      await api(`/projects/${encodeURIComponent(p.id)}/tasks/${encodeURIComponent(task.id)}/complete`, { method:'POST', body:JSON.stringify({ date:today() }) });
      toast('Arbeitsschritt als erledigt geloggt');
      await finishCompletionTransition(card ? [card] : [], startedAt);
      await renderProject(p.id);
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      card?.classList.remove('completion-pending', 'completion-removing');
    }
  });
  document.querySelectorAll('[data-reopen-entry]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const entry = p.entries?.find(item => item.id === button.dataset.reopenEntry);
    if (!entry) return;
    button.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(p.id)}/entries/${encodeURIComponent(entry.id)}/reopen`, { method:'POST', body:'{}' });
      toast('Arbeitsschritt zurückgestellt');
      await renderProject(p.id);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
}

function setSettingsMenu(open) {
  const toggle = $('#settings-toggle');
  const subnav = $('#settings-subnav');
  toggle.setAttribute('aria-expanded', String(open));
  subnav.hidden = !open;
  updateUpdateBadge();
}

function setProjectsMenu(open, activeStatus = '') {
  const toggle = $('#projects-toggle');
  const subnav = $('#projects-subnav');
  const badge = $('#project-nav-count');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Projekte' : 'Projektmenü aufklappen');
  toggle.title = open ? 'Projekte' : 'Projektmenü aufklappen';
  subnav.hidden = !open;
  badge.hidden = open;
  document.querySelectorAll('[data-projects-route]').forEach(node => node.classList.toggle('active', open && node.dataset.projectsRoute === activeStatus));
}

function setInventoryMenu(open, activeRoute = '') {
  const toggle = $('#inventory-toggle');
  const subnav = $('#inventory-subnav');
  const badge = $('#inventory-nav-count');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Lager' : 'Lagermenü aufklappen');
  toggle.title = open ? 'Lager' : 'Lagermenü aufklappen';
  subnav.hidden = !open;
  badge.hidden = open;
  document.querySelectorAll('[data-inventory-route]').forEach(node => node.classList.toggle('active', open && node.dataset.inventoryRoute === activeRoute));
}

function currentInventoryMenuRoute() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (path.startsWith('inventory/archive')) return 'archive';
  if (path.startsWith('inventory/replenishment')) return 'replenishment';
  if (path.startsWith('inventory/categories') || path.startsWith('inventory/category/')) return 'categories';
  if (path.startsWith('inventory/items') || path.startsWith('inventory/item/')) return 'items';
  return 'locations';
}

function currentProjectMenuStatus() {
  const hash = location.hash;
  if (hash.startsWith('#/archive')) return 'archived';
  if (hash.startsWith('#/trash')) return 'trashed';
  if (!hash.startsWith('#/projects')) return '';
  const query = hash.split('?')[1] || '';
  const status = new URLSearchParams(query).get('status');
  return regularProjectStatuses.includes(status) ? status : 'all';
}

function setNav(routeName, projectStatus = '') {
  document.querySelectorAll('[data-route]').forEach(node => node.classList.toggle('active', node.dataset.route === routeName));
  $('#global-search-form').classList.toggle('active', routeName === 'search');
  if (routeName !== 'search') {
    $('#global-search-input').value = '';
    syncSidebarSearchClear();
  }
  const settingsActive = routeName === 'settings';
  const projectsActive = routeName === 'projects';
  const inventoryActive = routeName === 'inventory';
  setSettingsMenu(settingsActive);
  setProjectsMenu(projectsActive, projectStatus);
  setInventoryMenu(inventoryActive, inventoryActive ? currentInventoryMenuRoute() : '');
  document.querySelectorAll('[data-settings-route]').forEach(node => node.classList.toggle('active', settingsActive && node.dataset.settingsRoute === state.activeSettings));
}
async function route() {
  if (!state.user) return;
  document.body.classList.remove('project-print-mode', 'project-export-mode');
  $('#mobile-header-actions').innerHTML = '';
  document.title = 'Logbuch';
  const hashValue = location.hash.replace(/^#\/?/, '');
  const [hashPath, hashQuery = ''] = hashValue.split('?');
  const hashParts = hashPath.split('/').filter(Boolean);
  const routeQuery = new URLSearchParams(hashQuery);
  const pathParts = location.pathname.split('/').filter(Boolean);
  const directProject = pathParts[0] === 'p' && pathParts[1];
  const directEntry = directProject && pathParts[2] === 'e' && pathParts[3];
  const parts = hashParts.length ? hashParts : directProject ? ['projects', pathParts[1]] : [];
  try {
    if (parts[0] === 'todos') { setNav('todos'); await renderTodos(); }
    else if (parts[0] === 'inventory') {
      setNav('inventory');
      if (parts[1] === 'replenishment') {
        await renderInventoryReplenishment(routeQuery);
      } else if (parts[1] === 'archive') {
        await renderInventoryArchive();
      } else if (parts[1] === 'categories' || parts[1] === 'category') {
        const categoryId = parts[1] === 'category' && parts[2] ? parts[2] : '';
        const itemId = parts[1] === 'category' && parts[3] === 'item' && parts[4] ? parts[4] : '';
        await renderInventoryCategories(categoryId, itemId);
      } else if (parts[1] === 'items' || parts[1] === 'item') {
        const itemId = parts[1] === 'item' && parts[2] ? parts[2] : '';
        await renderInventoryItems(itemId, routeQuery.get('archived') === '1', (routeQuery.get('q') || '').trim(), routeQuery.get('category') || '', routeQuery.get('sort') || 'name', routeQuery.get('direction') || 'asc');
      } else {
        const locationId = parts[1] === 'location' && parts[2] ? parts[2] : '';
        const itemId = parts[1] === 'location' && parts[3] === 'item' && parts[4] ? parts[4] : '';
        const locationSort = ['name','locations','items','updated'].includes(routeQuery.get('sort')) ? routeQuery.get('sort') : 'name';
        const locationSortDirection = routeQuery.get('direction') === 'desc' ? 'desc' : 'asc';
        await renderInventory(locationId, routeQuery.get('archived') === '1', itemId, locationSort, locationSortDirection, routeQuery.get('empty') !== 'hide');
      }
      await loadInventoryMenuCounts();
    }
    else if (parts[0] === 'projects' && parts[1] && parts[2] === 'export') {
      setNav('projects');
      await renderProjectExport(parts[1]);
    }
    else if (parts[0] === 'projects' && parts[1] && parts[2] === 'print') {
      setNav('projects');
      await renderProjectPrint(parts[1]);
    }
    else if (parts[0] === 'projects' && parts[1]) {
      setNav('projects');
      const requestedTab = routeQuery.get('tab');
      if (['entries','tasks','shopping','materials','contacts','links','ideas','learnings','notes','files'].includes(requestedTab)) {
        const requestedSection = ['entries','tasks'].includes(requestedTab) ? 'logbook' : requestedTab;
        state.collapsedProjectSections[requestedSection] = false;
      }
      if (directEntry) state.collapsedProjectSections.logbook = false;
      await renderProject(parts[1]);
      if (directEntry) document.getElementById(pathParts[3])?.scrollIntoView({ block:'center' });
      const searchItem = routeQuery.get('item');
      if (searchItem) requestAnimationFrame(() => {
        const target = document.getElementById(searchItem);
        if (!target) return;
        target.classList.add('search-target');
        target.scrollIntoView({ block:'center', behavior:'smooth' });
        setTimeout(() => target.classList.remove('search-target'), 2400);
      });
    }
    else if (parts[0] === 'projects') {
      state.currentFolderId = routeQuery.get('folder') || null;
      state.projectStatusFilter = regularProjectStatuses.includes(routeQuery.get('status')) ? routeQuery.get('status') : 'all';
      state.projectTagFilter.active.ids = (routeQuery.get('tags') || '').split(',').filter(Boolean);
      state.projectTagFilter.active.mode = routeQuery.get('match') === 'any' ? 'any' : 'all';
      setNav('projects', state.projectStatusFilter); await renderProjects();
    }
    else if (parts[0] === 'archive') {
      state.projectTagFilter.archived.ids = (routeQuery.get('tags') || '').split(',').filter(Boolean);
      state.projectTagFilter.archived.mode = routeQuery.get('match') === 'any' ? 'any' : 'all';
      setNav('projects', 'archived'); await renderArchive();
    }
    else if (parts[0] === 'trash') { setNav('projects', 'trashed'); await renderTrash(); }
    else if (parts[0] === 'search') { setNav('search'); await renderGlobalSearch(routeQuery); }
    else if (parts[0] === 'settings') {
      const requestedSection = parts[1] === 'device' ? 'server' : parts[1];
      if (parts[1] === 'device') history.replaceState(null, '', '/#/settings/server');
      if (settingsSections.some(([id]) => id === requestedSection)) state.activeSettings = requestedSection;
      if (!state.user.admin && !['general','profile'].includes(state.activeSettings)) state.activeSettings = 'general';
      setNav('settings'); await renderSettings();
    }
    else if (parts[0] === 'profile') { state.activeSettings = 'profile'; setNav('settings'); await renderSettings(); }
    else { setNav('home'); await renderHome(); }
    $('#main').focus({ preventScroll: true });
  } catch (error) { toast(error.message); if (error.message.includes('Anmeldung')) location.reload(); }
}

function renderProjectTagPicker(query = '') {
  const options = $('#project-tag-options');
  const normalized = query.trim().toLocaleLowerCase('de');
  const matches = state.tags
    .filter(tag => !normalized || tag.name.toLocaleLowerCase('de').includes(normalized))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
  const tagOptions = matches.map(tag => {
    const checked = state.projectDialogTagIds.includes(tag.id);
    return `<button type="button" class="tag-picker-option${checked ? ' selected' : ''}" data-toggle-project-tag="${escapeHtml(tag.id)}" aria-pressed="${checked}">${escapeHtml(tag.name)}</button>`;
  }).join('');
  const emptyText = !matches.length && !state.projectTagDraftOpen ? `<span class="tag-picker-options-empty">${normalized ? 'Kein Tag passt zur Suche.' : 'Noch keine Tags vorhanden.'}</span>` : '';
  const createControl = state.projectTagDraftOpen
    ? '<input class="tag-picker-new" type="text" maxlength="40" placeholder="Tagname" aria-label="Name des neuen Tags">'
    : '<button class="tag-picker-add" type="button" data-new-project-tag aria-label="Neuen Tag anlegen" title="Neuen Tag anlegen">+</button>';
  const searchControl = state.projectTagSearchOpen
    ? `<span class="tag-picker-search-inline"><input id="project-tag-input" class="tag-picker-search" type="search" maxlength="40" value="${escapeHtml(query)}" placeholder="Tags suchen" aria-label="Tags durchsuchen" autocomplete="off"><button class="tag-picker-search-close" type="button" data-close-project-tag-search aria-label="Tagsuche schließen" title="Tagsuche schließen">×</button></span>`
    : '<button class="tag-picker-search-button" type="button" data-open-project-tag-search aria-label="Tags durchsuchen" title="Tags durchsuchen"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.8"></circle><path d="m15 15 4.5 4.5"></path></svg></button>';
  options.innerHTML = `${searchControl}${tagOptions}${emptyText}${createControl}`;
  const searchButton = options.querySelector('[data-open-project-tag-search]');
  if (searchButton) searchButton.onclick = () => {
    state.projectTagSearchOpen = true;
    renderProjectTagPicker();
    requestAnimationFrame(() => options.querySelector('#project-tag-input')?.focus());
  };
  const searchInput = options.querySelector('#project-tag-input');
  if (searchInput) {
    searchInput.oninput = () => {
      const value = searchInput.value;
      renderProjectTagPicker(value);
      requestAnimationFrame(() => {
        const nextInput = options.querySelector('#project-tag-input');
        nextInput?.focus();
        nextInput?.setSelectionRange(value.length, value.length);
      });
    };
    searchInput.onkeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      state.projectTagSearchOpen = false;
      renderProjectTagPicker();
      options.querySelector('[data-open-project-tag-search]')?.focus();
    };
  }
  const searchClose = options.querySelector('[data-close-project-tag-search]');
  if (searchClose) searchClose.onclick = () => {
    state.projectTagSearchOpen = false;
    renderProjectTagPicker();
    options.querySelector('[data-open-project-tag-search]')?.focus();
  };
  options.querySelectorAll('[data-toggle-project-tag]').forEach(button => button.onclick = () => {
    const id = button.dataset.toggleProjectTag;
    if (state.projectDialogTagIds.includes(id)) state.projectDialogTagIds = state.projectDialogTagIds.filter(tagId => tagId !== id);
    else state.projectDialogTagIds.push(id);
    renderProjectTagPicker(options.querySelector('#project-tag-input')?.value || '');
    [...options.querySelectorAll('[data-toggle-project-tag]')]
      .find(option => option.dataset.toggleProjectTag === id)
      ?.focus();
  });
  const addButton = options.querySelector('[data-new-project-tag]');
  if (addButton) addButton.onclick = () => {
    state.projectTagDraftOpen = true;
    renderProjectTagPicker(query);
    requestAnimationFrame(() => options.querySelector('.tag-picker-new')?.focus());
  };
  const draft = options.querySelector('.tag-picker-new');
  if (draft) draft.onkeydown = async event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      state.projectTagDraftOpen = false;
      renderProjectTagPicker(query);
      options.querySelector('[data-new-project-tag]')?.focus();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const name = draft.value.trim();
    if (!name) return;
    draft.disabled = true;
    try {
      const tag = await api('/tags', { method:'POST', body:JSON.stringify({ name }) });
      const existingIndex = state.tags.findIndex(item => item.id === tag.id);
      if (existingIndex >= 0) state.tags[existingIndex] = tag; else state.tags.push(tag);
      if (!state.projectDialogTagIds.includes(tag.id)) state.projectDialogTagIds.push(tag.id);
      state.projectTagDraftOpen = false;
      state.projectTagSearchOpen = false;
      renderProjectTagPicker();
      toast('Tag angelegt und ausgewählt');
    } catch (error) {
      draft.disabled = false;
      draft.focus();
      draft.select();
      toast(error.message);
    }
  };
}

function renderIconPicker(scope, query = '', open = false) {
  const picker = document.querySelector(`[data-icon-picker="${scope}"]`);
  const form = picker?.closest('form');
  if (!picker || !form) return;
  const input = form.elements.icon;
  const projectPicker = scope === 'project';
  const defaultPicker = scope === 'default-project';
  const fallback = scope === 'folder' || scope === 'inventory-category' ? 'folder' : scope === 'storage-location' ? 'archive' : defaultProjectIconName();
  const inherited = projectPicker && form.elements.iconInherited?.value === '1';
  const selected = inherited ? defaultProjectIconName() : entityIconName({ icon:input.value }, fallback);
  const pickerLabel = defaultPicker ? '' : '<label>Symbol</label>';
  if (!state.iconLibrary) {
    picker.innerHTML = `${pickerLabel}<div class="icon-picker-loading">Symbolbibliothek wird geladen …</div>`;
    loadIconLibrary().then(() => renderIconPicker(scope, query, open)).catch(error => { picker.innerHTML = `${pickerLabel}<div class="icon-picker-loading">${escapeHtml(error.message)}</div>`; });
    return;
  }
  const normalized = query.trim().toLocaleLowerCase('de');
  const matchingNames = Object.keys(state.iconLibrary.icons).filter(name => !normalized || name.includes(normalized));
  const names = normalized ? matchingNames.slice(0, 120) : matchingNames;
  const defaultChoice = projectPicker ? `<button class="icon-picker-default${inherited ? ' selected' : ''}" type="button" data-use-default-icon><span class="entity-icon-preview">${iconSvg(defaultProjectIconName())}</span><span>Standardsymbol verwenden</span></button>` : '';
  picker.innerHTML = `${pickerLabel}<button class="icon-picker-current" type="button" data-toggle-icon-picker aria-expanded="${open}"><span class="entity-icon-preview">${iconSvg(selected)}</span><span>${inherited ? `Standard · ${escapeHtml(selected.replaceAll('-', ' '))}` : escapeHtml(selected.replaceAll('-', ' '))}</span><span aria-hidden="true">⌄</span></button><div class="icon-picker-panel"${open ? '' : ' hidden'}>${defaultChoice}<input class="icon-picker-search" type="search" value="${escapeHtml(query)}" placeholder="Symbole durchsuchen" aria-label="Symbole durchsuchen" autocomplete="off"><div class="icon-picker-grid">${names.length ? names.map(name => `<button type="button" class="icon-picker-option${!inherited && name === selected ? ' selected' : ''}" data-select-icon="${escapeHtml(name)}" title="${escapeHtml(name.replaceAll('-', ' '))}" aria-label="${escapeHtml(name.replaceAll('-', ' '))}">${iconSvg(name)}</button>`).join('') : '<span class="icon-picker-empty">Kein passendes Symbol gefunden.</span>'}</div><small>${normalized && matchingNames.length > names.length ? `Die ersten ${names.length} von ${matchingNames.length} Treffern werden angezeigt. Suche genauer, um weitere Symbole zu finden.` : `${names.length} Symbole`}</small></div>`;
  picker.querySelector('[data-toggle-icon-picker]').onclick = () => renderIconPicker(scope, '', !open);
  const search = picker.querySelector('.icon-picker-search');
  if (search) {
    search.oninput = () => {
      const value = search.value;
      renderIconPicker(scope, value, true);
      requestAnimationFrame(() => {
        const next = picker.querySelector('.icon-picker-search');
        next?.focus();
        next?.setSelectionRange(value.length, value.length);
      });
    };
    search.onkeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      renderIconPicker(scope, '', false);
      picker.querySelector('[data-toggle-icon-picker]')?.focus();
    };
  }
  picker.querySelectorAll('[data-select-icon]').forEach(button => button.onclick = () => {
    input.value = button.dataset.selectIcon;
    if (projectPicker && form.elements.iconInherited) form.elements.iconInherited.value = '0';
    renderIconPicker(scope, '', false);
    picker.querySelector('[data-toggle-icon-picker]')?.focus();
    if (defaultPicker) input.dispatchEvent(new Event('change', { bubbles:true }));
  });
  const useDefault = picker.querySelector('[data-use-default-icon]');
  if (useDefault) useDefault.onclick = () => {
    form.elements.iconInherited.value = '1';
    renderIconPicker(scope, '', false);
    picker.querySelector('[data-toggle-icon-picker]')?.focus();
  };
}

function showFormDialog(dialog) {
  dialog.querySelectorAll('input[type="date"]').forEach(input => {
    input.dataset.dateDigits = '';
    input.setCustomValidity('');
    input.classList.remove('input-invalid');
    input.removeAttribute('aria-invalid');
    updateDatePresentation(input);
  });
  dialog.showModal();
  requestAnimationFrame(() => {
    const firstField = [...dialog.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])')]
      .find(field => !field.closest('[hidden], .hidden') && field.getClientRects().length);
    firstField?.focus();
  });
}

function openProjectAddDialog(projectId) {
  const dialog = $('#project-add-dialog');
  dialog.querySelector('form').elements.projectId.value = projectId;
  showFormDialog(dialog);
  requestAnimationFrame(() => dialog.querySelector('[data-project-add-choice]')?.focus());
}

function openProjectDialog(project = null, { status = null } = {}) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#project-form');
  form.reset();
  form.elements.projectId.value = project?.id || '';
  form.elements.title.value = project?.title || '';
  form.elements.title.classList.remove('input-invalid');
  form.elements.title.removeAttribute('aria-invalid');
  form.elements.title.oninput = () => {
    if (!form.elements.title.value.trim()) return;
    form.elements.title.classList.remove('input-invalid');
    form.elements.title.removeAttribute('aria-invalid');
  };
  form.elements.description.value = project?.description || '';
  form.elements.status.value = project?.status || (regularProjectStatuses.includes(status) ? status : 'active');
  form.elements.iconInherited.value = project ? (projectUsesDefaultIcon(project) ? '1' : '0') : '1';
  form.elements.icon.value = project ? entityIconName(project, 'box') : defaultProjectIconName();
  renderIconPicker('project');
  const linkZone = $('#project-link-zone');
  const link = $('#project-dialog-link');
  linkZone.hidden = !project;
  if (project) {
    const path = `/p/${encodeURIComponent(project.id)}`;
    const fallbackLink = new URL(path, location.origin).href;
    link.href = fallbackLink;
    link.textContent = fallbackLink;
    stableLink(path).then(stableUrl => {
      if (form.elements.projectId.value !== project.id) return;
      link.href = stableUrl;
      link.textContent = stableUrl;
    }).catch(() => {});
  }
  $('#project-delete-zone').hidden = !project;
  form.elements.folderId.innerHTML = folderSelectOptions(project?.folderId || state.currentFolderId || '');
  form.elements.createdAt.value = String(project?.createdAt || today()).slice(0, 10);
  form.elements.dueDate.value = String(project?.dueDate || '').slice(0, 10);
  form.elements.createdAt.classList.remove('input-invalid');
  form.elements.createdAt.removeAttribute('aria-invalid');
  updateDatePresentation(form.elements.createdAt);
  updateDatePresentation(form.elements.dueDate);
  state.projectDialogTagIds = [...(project?.tagIds || [])];
  state.projectTagDraftOpen = false;
  state.projectTagSearchOpen = false;
  renderProjectTagPicker();
  form.dataset.returnUrl = location.href;
  $('#project-dialog-title').textContent = project ? 'Projekt bearbeiten' : 'Neues Projekt';
  $('#project-submit').textContent = 'Speichern';
  showFormDialog($('#project-dialog'));
}

function downloadTextFile(name, content, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeDownloadName = value => String(value || 'projekt').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projekt';

function openAiProjectExportDialog(project) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#ai-project-export-form');
  form.reset();
  form.elements.projectId.value = project.id;
  showFormDialog($('#ai-project-export-dialog'));
}

function openFolderDialog(folder = null, { selectAfterCreate = false, parentId = state.currentFolderId } = {}) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#folder-form');
  form.reset();
  form.elements.folderId.value = folder?.id || '';
  form.elements.selectAfterCreate.value = selectAfterCreate ? '1' : '';
  form.elements.name.value = folder?.name || '';
  form.elements.description.value = folder?.description || '';
  form.elements.icon.value = entityIconName(folder, 'folder');
  renderIconPicker('folder');
  $('#folder-delete-zone').hidden = !folder;
  const folderProjectCount = folder ? state.projects.filter(project => project.folderId === folder.id).length : 0;
  const childFolderCount = folder ? state.folders.filter(candidate => candidate.parentId === folder.id).length : 0;
  const folderIsEmpty = folderProjectCount === 0 && childFolderCount === 0;
  const deleteButton = $('#folder-dialog-delete');
  deleteButton.disabled = Boolean(folder && !folderIsEmpty);
  deleteButton.title = folder && !folderIsEmpty ? 'Nur leere Ordner können gelöscht werden' : '';
  $('#folder-delete-hint').textContent = folder && !folderIsEmpty
    ? 'Dieser Ordner enthält Projekte oder Unterordner. Verschiebe oder lösche diese zuerst – nur leere Ordner können gelöscht werden.'
    : 'Der leere Ordner wird endgültig gelöscht. Das Löschen kann nicht rückgängig gemacht werden.';
  form.elements.parentId.innerHTML = folderSelectOptions(folder?.parentId || parentId || '', folder?.id || '');
  $('#folder-dialog-title').textContent = folder ? 'Ordner bearbeiten' : 'Neuer Ordner';
  showFormDialog($('#folder-dialog'));
}

function openEntryDialog(projectId, entry = null) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#entry-form');
  form.reset();
  form.elements.projectId.value = projectId;
  form.elements.entryId.value = entry?.id || '';
  form.elements.date.value = String(entry?.date || today()).slice(0, 10);
  updateDatePresentation(form.elements.date);
  form.elements.title.value = entry?.title || '';
  form.elements.body.value = entry?.body || '';
  if (form.elements.nextStep) form.elements.nextStep.value = entry?.nextStep || '';
  $('#entry-dialog-title').textContent = entry ? 'Arbeitsschritt bearbeiten' : 'Erledigten Arbeitsschritt festhalten';
  $('#entry-submit').textContent = entry ? 'Änderungen speichern' : 'Arbeitsschritt speichern';
  updateDialogAttachmentSummary(form.elements.attachments);
  showFormDialog($('#entry-dialog'));
}

function updateDialogAttachmentSummary(input) {
  const summary = input?.closest('.dialog-attachments')?.querySelector('[data-attachment-summary]');
  if (!summary) return;
  const files = [...(input.files || [])];
  summary.innerHTML = files.length
    ? files.map((file, index) => `<span class="dialog-selected-file"><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(formatBytes(file.size))}</small><button type="button" data-remove-dialog-attachment="${index}" aria-label="${escapeHtml(file.name)} aus der Upload-Liste entfernen" title="Aus Upload-Liste entfernen">${iconSvg('x')}</button></span>`).join('')
    : '<span class="dialog-no-files">Keine Dateien ausgewählt</span>';
  summary.classList.toggle('has-files', files.length > 0);
  summary.classList.remove('is-overflowing');
  requestAnimationFrame(() => summary.classList.toggle('is-overflowing', summary.scrollHeight > summary.clientHeight));
}

function removeDialogAttachment(button) {
  const input = button.closest('.dialog-attachments')?.querySelector('input[type="file"]');
  const removeIndex = Number(button.dataset.removeDialogAttachment);
  if (!input || !Number.isInteger(removeIndex)) return;
  const transfer = new DataTransfer();
  [...input.files].forEach((file, index) => { if (index !== removeIndex) transfer.items.add(file); });
  input.files = transfer.files;
  updateDialogAttachmentSummary(input);
}

function selectedDialogAttachments(form) {
  const files = [...(form.elements.attachments?.files || [])];
  const oversized = files.find(file => file.size > 50 * 1024 * 1024);
  if (oversized) throw new Error(`Die Datei „${oversized.name}“ ist größer als 50 MB.`);
  return files;
}

async function uploadDialogAttachments(projectId, collection, itemId, files) {
  let uploaded = 0;
  const failed = [];
  for (const file of files) {
    const payload = new FormData();
    payload.append('file', file);
    payload.append('displayName', '');
    payload.append('description', '');
    payload.append('associationCollection', collection);
    payload.append('associationItemId', itemId);
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/files`, { method:'POST', body:payload });
      uploaded += 1;
    } catch (error) { failed.push(`${file.name}: ${error.message}`); }
  }
  return { uploaded, failed };
}

function savedWithAttachmentsMessage(label, editing, result) {
  const base = `${label} ${editing ? 'aktualisiert' : 'gespeichert'}`;
  if (!result.uploaded && !result.failed.length) return base;
  const uploaded = result.uploaded ? ` · ${result.uploaded} ${result.uploaded === 1 ? 'Datei' : 'Dateien'} hochgeladen` : '';
  const failed = result.failed.length ? ` · ${result.failed.length} fehlgeschlagen: ${result.failed[0]}` : '';
  return `${base}${uploaded}${failed}`;
}

function fieldMarkup(field, value = '') {
  const required = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  if (field.type === 'textarea') return `<label>${escapeHtml(field.label)}<textarea name="${field.name}" rows="4"${placeholder}${required}>${escapeHtml(value)}</textarea></label>`;
  if (field.type === 'select') return `<label>${escapeHtml(field.label)}<select name="${field.name}">${field.options.map(option => `<option${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  return `<label>${escapeHtml(field.label)}<input name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(value)}"${placeholder}${required}></label>`;
}

function openItemDialog(projectId, collection, item = null) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const config = sections[collection];
  const form = $('#item-form');
  form.reset();
  form.elements.projectId.value = projectId;
  form.elements.collection.value = collection;
  form.elements.itemId.value = item?.id || '';
  $('#item-dialog-title').textContent = item ? `${config.singular} bearbeiten` : `${config.singular} anlegen`;
  $('#item-submit').textContent = item ? 'Änderungen speichern' : `${config.singular} speichern`;
  $('#item-fields').innerHTML = config.fields.map(field => fieldMarkup(field, item?.[field.name] || '')).join('');
  enhanceDateInputs($('#item-fields'));
  updateDialogAttachmentSummary(form.elements.attachments);
  showFormDialog($('#item-dialog'));
}

function openFileDialog(projectId, association = null, file = null) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#file-form');
  form.reset();
  form.elements.projectId.value = projectId;
  form.elements.fileId.value = file?.id || '';
  form.elements.associationCollection.value = association?.collection || file?.association?.collection || '';
  form.elements.associationItemId.value = association?.itemId || file?.association?.itemId || '';
  form.elements.displayName.value = file?.displayName || '';
  form.elements.description.value = file?.description || '';
  form.elements.file.required = !file;
  $('#file-input-label').hidden = Boolean(file);
  $('#file-dialog-title').textContent = file ? 'Dateiinformationen bearbeiten' : 'Datei hochladen';
  $('#file-submit').textContent = file ? 'Änderungen speichern' : 'Datei hochladen';
  const entity = association ? attachmentEntity(association.collection, association.itemId) : file?.association ? attachmentEntity(file.association.collection, file.association.itemId) : null;
  $('#file-dialog-context').textContent = entity ? `Zuordnung: ${entity.label} · ${entity.title}` : 'Ohne Eintragszuordnung – die Datei gehört weiterhin zu diesem Projekt.';
  showFormDialog($('#file-dialog'));
}

function replaceFileInState(file) {
  const index = state.current?.files?.findIndex(candidate => candidate.id === file.id) ?? -1;
  if (index >= 0) state.current.files[index] = file;
  document.querySelectorAll(`[data-file-image="${CSS.escape(file.id)}"]`).forEach(image => { image.style.transform = `rotate(${Number(file.rotation) || 0}deg)`; });
  const card = document.querySelector(`[data-file-card="${CSS.escape(file.id)}"]`);
  if (card) {
    const title = card.querySelector('h3');
    if (title) title.textContent = file.displayName || file.originalName;
    const description = card.querySelector('.file-description');
    if (description) { description.textContent = file.description || ''; description.hidden = !file.description; }
  }
  document.querySelectorAll(`.attachment-row[data-view-file="${CSS.escape(file.id)}"] .attachment-name`).forEach(name => { name.textContent = file.displayName || file.originalName; });
}

function renderFileViewer(file) {
  const form = $('#file-viewer-form');
  const editable = mayEditProjects();
  const association = file.association ? attachmentEntity(file.association.collection, file.association.itemId) : null;
  form.elements.fileId.value = file.id;
  form.elements.displayName.value = file.displayName || file.originalName;
  form.elements.description.value = file.description || '';
  form.elements.displayName.disabled = !editable;
  form.elements.description.disabled = !editable;
  $('#file-viewer-save').hidden = !editable;
  $('#file-viewer-rotate-left').hidden = !editable;
  $('#file-viewer-rotate-right').hidden = !editable;
  $('#file-viewer-title').textContent = file.displayName || file.originalName;
  $('#file-viewer-subtitle').textContent = file.originalName;
  $('#file-viewer-size').textContent = formatBytes(file.size);
  $('#file-viewer-download').href = attachmentContentUrl(file, true);
  $('#file-viewer-content').innerHTML = `<img data-file-image="${escapeHtml(file.id)}" src="${attachmentContentUrl(file)}" alt="${escapeHtml(file.displayName || file.originalName)}" style="transform:rotate(${Number(file.rotation) || 0}deg)">`;
  $('#file-viewer-association').innerHTML = association ? `<small>Zugeordnet zu</small><strong>${escapeHtml(association.label)}</strong><span>${escapeHtml(association.title)}</span>` : '<small>Zuordnung</small><span>Ohne Eintragszuordnung</span>';
  $('#file-viewer-meta').innerHTML = `<div><small>Dateityp</small><span>${escapeHtml(file.mimeType || 'Unbekannt')}</span></div><div><small>Hochgeladen</small><span>${escapeHtml(formatDateTime(file.uploadedAt))}</span></div><div><small>Von</small><span>${escapeHtml(file.uploadedBy || 'Unbekannt')}</span></div>`;
}

function openFileViewer(file) {
  if (!String(file?.mimeType || '').startsWith('image/')) return;
  state.fileViewerId = file.id;
  renderFileViewer(file);
  const dialog = $('#file-viewer-dialog');
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('button[value="cancel"]')?.focus());
}

async function rotateViewedFile(degrees, button) {
  const file = state.current?.files?.find(candidate => candidate.id === state.fileViewerId);
  if (!file) return;
  button.disabled = true;
  try {
    const updated = await api(`/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(file.id)}/rotate`, { method:'POST', body:JSON.stringify({ degrees }) });
    replaceFileInState(updated);
    renderFileViewer(updated);
    toast(degrees > 0 ? 'Bild nach rechts gedreht' : 'Bild nach links gedreht');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function openTagDialog(tag = null) {
  const form = $('#tag-form');
  form.reset();
  form.elements.tagId.value = tag?.id || '';
  form.elements.name.value = tag?.name || '';
  $('#tag-dialog-title').textContent = tag ? 'Tag umbenennen' : 'Tag anlegen';
  $('#tag-submit').textContent = tag ? 'Änderung speichern' : 'Tag anlegen';
  showFormDialog($('#tag-dialog'));
}

function openTagMergeDialog(tag) {
  const form = $('#tag-merge-form');
  form.reset();
  form.elements.sourceId.value = tag.id;
  form.elements.targetId.innerHTML = state.tags.filter(candidate => candidate.id !== tag.id).sort((a,b) => a.name.localeCompare(b.name, 'de')).map(candidate => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`).join('');
  $('#tag-merge-copy').textContent = `„${tag.name}“ wird aktuell von ${(tag.activeProjectCount || 0) + (tag.archivedProjectCount || 0)} Projekten verwendet.`;
  showFormDialog($('#tag-merge-dialog'));
}

function bindTagActions() {
  $('[data-new-tag]').onclick = () => openTagDialog();
  document.querySelectorAll('[data-edit-tag]').forEach(button => button.onclick = () => openTagDialog(tagById(button.dataset.editTag)));
  document.querySelectorAll('[data-merge-tag]').forEach(button => button.onclick = () => openTagMergeDialog(tagById(button.dataset.mergeTag)));
  document.querySelectorAll('[data-delete-tag]').forEach(button => button.onclick = async () => {
    const tag = tagById(button.dataset.deleteTag);
    const projectUsage = Number(tag.activeProjectCount || 0) + Number(tag.archivedProjectCount || 0);
    const folderUsage = Number(tag.folderCount || 0);
    const usage = projectUsage + folderUsage;
    const message = projectUsage ? `Der Tag „${tag.name}“ ist noch ${projectUsage} Projekten zugewiesen. Überall entfernen und endgültig löschen?` : `Tag „${tag.name}“ endgültig löschen?`;
    if (!await confirmAction(message, { title:'Tag löschen', confirmLabel:'Löschen' })) return;
    try {
      await api(`/tags/${encodeURIComponent(tag.id)}`, { method:'DELETE', body:JSON.stringify({ removeFromProjects:usage > 0 }) });
      toast('Tag gelöscht');
      await renderSettings();
    } catch (error) { toast(error.message); }
  });
}

function openUserDialog(user = null) {
  document.querySelectorAll('.action-menu[open]').forEach(menu => menu.removeAttribute('open'));
  const form = $('#user-form');
  form.reset();
  const editing = Boolean(user);
  form.elements.userId.value = user?.id || '';
  form.elements.id.value = user?.id || '';
  form.elements.id.disabled = editing;
  form.elements.role.value = user?.role || 'editor';
  form.elements.projectAccessMode.value = user?.projectAccessMode || 'all';
  form.elements.mustChangePassword.checked = user ? Boolean(user.mustChangePassword) : true;
  form.elements.password.required = !editing;
  $('#user-password-label').textContent = editing ? 'Neues Passwort (optional)' : 'Startpasswort';
  $('#user-dialog-title').textContent = editing ? 'Benutzer bearbeiten' : 'Benutzer anlegen';
  $('#user-submit').textContent = editing ? 'Änderungen speichern' : 'Benutzer anlegen';
  const selected = new Set(user?.projectIds || []);
  const projects = state.projects.filter(project => project.status !== 'trashed').sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || String(a.title || '').localeCompare(String(b.title || ''), 'de', { sensitivity:'base' }));
  $('#user-projects').innerHTML = projects.length ? projects.map(project => `<label class="project-access-option"><input type="checkbox" value="${escapeHtml(project.id)}"${selected.has(project.id) ? ' checked' : ''}><span><strong>${escapeHtml(project.title)}</strong>${project.status !== 'active' ? `<small>${escapeHtml(projectStatusLabels[project.status] || project.status)}</small>` : ''}</span></label>`).join('') : '<p class="project-access-empty">Noch keine Projekte vorhanden.</p>';
  const updateAccessCopy = () => {
    const mode = form.elements.projectAccessMode.value;
    const excludes = mode === 'exclude';
    const all = mode === 'all';
    $('.project-access').hidden = all;
    $('#project-access-title').textContent = excludes ? 'Verborgene Projekte' : 'Freigegebene Projekte';
    $('#project-access-description').textContent = excludes ? 'Die ausgewählten Projekte werden für diesen Benutzer verborgen. Administratoren haben immer Zugriff auf alle Projekte.' : 'Der Benutzer erhält Zugriff auf die ausgewählten Projekte. Administratoren haben immer Zugriff auf alle Projekte.';
  };
  form.elements.projectAccessMode.onchange = updateAccessCopy;
  updateAccessCopy();
  showFormDialog($('#user-dialog'));
}

function bindUserActions() {
  $('[data-new-user]').onclick = () => openUserDialog();
  document.querySelectorAll('[data-edit-user]').forEach(button => button.onclick = () => {
    const user = state.users.find(candidate => candidate.id === button.dataset.editUser);
    if (user) openUserDialog(user);
  });
  document.querySelectorAll('[data-toggle-user]').forEach(button => button.onclick = async () => {
    const id = button.dataset.toggleUser;
    const active = button.dataset.active === 'true';
    try { await api(`/users/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ active }) }); toast(active ? 'Benutzer aktiviert' : 'Benutzer deaktiviert'); await renderSettings(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-delete-user]').forEach(button => button.onclick = async () => {
    const id = button.dataset.deleteUser;
    const user = state.users.find(candidate => candidate.id === id);
    if (!await confirmAction(`Benutzer „${user?.name || id}“ endgültig löschen? Die Projektdaten bleiben erhalten.`, { title:'Benutzer löschen', confirmLabel:'Endgültig löschen' })) return;
    try { await api(`/users/${encodeURIComponent(id)}`, { method:'DELETE' }); toast('Benutzer gelöscht'); await renderSettings(); }
    catch (error) { toast(error.message); }
  });
}

function openPasswordDialog(forced = false) {
  const dialog = $('#password-dialog');
  const form = $('#password-form');
  form.reset();
  form.dataset.forced = forced ? 'true' : 'false';
  $('#password-error').textContent = '';
  $('#password-dialog-title').textContent = forced ? 'Startpasswort ändern' : 'Passwort ändern';
  $('#password-dialog-copy').textContent = forced ? 'Bevor du das Logbuch verwenden kannst, musst du das vom Administrator vergebene Startpasswort ändern.' : 'Gib dein aktuelles und anschließend ein neues Passwort ein.';
  document.querySelectorAll('.password-cancel').forEach(button => button.classList.toggle('hidden', forced));
  dialog.oncancel = event => { if (forced) event.preventDefault(); };
  showFormDialog(dialog);
}

function bindSecurityActions() {
  document.querySelectorAll('[data-revoke-session]').forEach(button => button.onclick = async () => {
    try { await api(`/sessions/${encodeURIComponent(button.dataset.revokeSession)}`, { method:'DELETE' }); toast('Sitzung beendet'); await renderSettings(); }
    catch (error) { toast(error.message); }
  });
}

function resetUpdateDialog() {
  const dialog = $('#update-dialog');
  dialog.dataset.updating = 'false';
  dialog.oncancel = event => { if (dialog.dataset.updating === 'true') event.preventDefault(); };
  $('#update-confirmation').hidden = false;
  $('#update-progress').hidden = true;
  $('#update-progress').classList.remove('failed');
  $('#update-progress').setAttribute('aria-busy', 'false');
  $('#update-close').hidden = false;
  $('#update-manual-reload').hidden = true;
}

function showUpdateProgress(title, copy, { failed = false, allowClose = false, manualReload = false } = {}) {
  const dialog = $('#update-dialog');
  dialog.dataset.updating = allowClose ? 'false' : 'true';
  $('#update-confirmation').hidden = true;
  const progress = $('#update-progress');
  progress.hidden = false;
  progress.classList.toggle('failed', failed);
  progress.setAttribute('aria-busy', !failed && !allowClose ? 'true' : 'false');
  $('#update-progress-title').textContent = title;
  $('#update-progress-copy').textContent = copy;
  $('#update-close').hidden = !allowClose;
  $('#update-manual-reload').hidden = !manualReload;
}

async function monitorRequestedUpdate(targetVersion) {
  const result = await LogbuchUpdateMonitor.waitForVersion({
    targetVersion,
    check:async () => {
      const response = await fetch('/api/update/status', { headers:{ Accept:'application/json' }, cache:'no-store' });
      if (!response.ok) throw new Error('Das Logbuch ist noch nicht erreichbar.');
      return response.json();
    },
    onAttempt:({ reachable, elapsedMs }) => {
      const seconds = Math.max(1, Math.round(elapsedMs / 1000));
      showUpdateProgress(
        reachable ? 'Update wird installiert …' : 'Das Logbuch wird neu gestartet …',
        reachable
          ? `Der AIO-Updater arbeitet weiter. Die neue Version wird automatisch geprüft. Seit ${seconds} Sekunden.`
          : 'Die kurze Unterbrechung ist erwartet. Diese Seite prüft automatisch, wann das Logbuch wieder erreichbar ist.',
      );
    },
  });
  if (result.outcome === 'complete') {
    showUpdateProgress('Update abgeschlossen', `Version ${targetVersion} ist erreichbar. Die Seite wird jetzt automatisch neu geladen.`);
    setTimeout(() => location.reload(), 900);
    return;
  }
  if (result.outcome === 'failed') {
    showUpdateProgress(
      'Das Update ist fehlgeschlagen',
      result.status?.stateMessage || 'Die vorherige Version ist weiterhin aktiv. Lade die Seite neu, um den aktuellen Zustand anzuzeigen.',
      { failed:true, allowClose:true, manualReload:true },
    );
    return;
  }
  showUpdateProgress(
    'Das Update dauert länger als erwartet',
    'Die automatische Prüfung wurde beendet. Der Update-Prozess kann im Hintergrund noch laufen. Lade die Seite in einigen Augenblicken manuell neu.',
    { allowClose:true, manualReload:true },
  );
}

function bindSystemActions() {
  const checkButton = $('[data-check-update]');
  if (checkButton) checkButton.onclick = async () => {
    checkButton.disabled = true;
    try {
      await loadUpdateStatus(true);
      toast(state.update.available ? `Version ${state.update.latestVersion} ist verfügbar` : 'Das Logbuch ist aktuell');
      await renderSettings();
    } catch (error) { toast(error.message); checkButton.disabled = false; }
  };
  const installButton = $('[data-install-update]');
  if (installButton) installButton.onclick = () => {
    const update = state.update || {};
    const dialog = $('#update-dialog');
    const form = $('#update-form');
    form.reset();
    resetUpdateDialog();
    $('#update-error').textContent = '';
    $('#update-dialog-copy').textContent = update.platform === 'docker'
      ? `Version ${update.latestVersion} wird beim AIO-Updater angefordert. Der Anwendungscontainer erhält dabei keinen Zugriff auf den Docker-Socket.`
      : `Version ${update.latestVersion} wird geprüft, gesichert und anschließend installiert. Währenddessen befindet sich das Logbuch kurz im Wartungsmodus.`;
    showFormDialog(dialog);
  };
  $('[data-clear-content]').onclick = async event => {
    if (!await confirmAction('Wirklich alle Projekte, Erinnerungen und sämtliche Lagerinhalte einschließlich Archiv, Kategorien und Historie endgültig löschen? Benutzerkonten und Einstellungen bleiben erhalten.', { title:'Alle Inhalte löschen', confirmLabel:'Endgültig löschen' })) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/system/content', { method:'DELETE' });
      state.projects = [];
      state.todos = [];
      state.tags = [];
      state.folders = [];
      state.storageLocations = [];
      state.inventoryCategories = [];
      state.inventoryItems = [];
      state.inventoryStockEntries = [];
      state.inventoryStockTransactions = [];
      state.inventoryStockItem = null;
      state.inventoryReservations = [];
      state.projectReservations = [];
      updateProjectMenuCounts();
      updateTodoMenuCount();
      await loadInventoryMenuCounts();
      toast(`Alle Inhalte gelöscht: ${result.projects || 0} Projekte, ${result.reminders || 0} Erinnerungen, ${result.items || 0} Artikel und ${result.storageLocations || 0} Lagerorte`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  };
  $('[data-clear-users]').onclick = async event => {
    if (!await confirmAction('Wirklich alle Benutzerkonten außer dem aktuell angemeldeten Administrator endgültig löschen? Alle anderen Sitzungen werden beendet.', { title:'Benutzerkonten löschen', confirmLabel:'Endgültig löschen' })) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/system/users', { method:'DELETE' });
      toast(`${result.removed || 0} Benutzer gelöscht`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  };
  $('[data-load-demo]').onclick = async event => {
    if (!await confirmAction('Die elf Beispielprojekte und zwei Demo-Ordner einspielen? Bereits vorhandene Demodaten werden auf den Lieferzustand zurückgesetzt; eigene Inhalte bleiben erhalten.', { title:'Beispieldaten einspielen', confirmLabel:'Einspielen', danger:false })) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Beispieldaten werden eingespielt …';
    try {
      const result = await api('/demo', { method:'POST' });
      toast(`${result.installed || 0} Beispielprojekte eingespielt`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Beispieldaten einspielen'; }
  };
  $('[data-remove-demo]').onclick = async event => {
    if (!await confirmAction('Wirklich alle Beispielprojekte einschließlich nachträglich darin angelegter Inhalte endgültig löschen? Demo-Ordner mit eigenen Projekten oder Unterordnern bleiben erhalten.', { title:'Beispieldaten löschen', confirmLabel:'Endgültig löschen' })) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/demo', { method:'DELETE' });
      const retained = result.foldersRetained || 0;
      toast(`${result.removed || 0} Beispielprojekte entfernt${retained ? ` · ${retained} belegte Demo-Ordner behalten` : ''}`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  };
}

function bindNewProject() {
  const button = $('[data-open-project-create]');
  if (button) button.onclick = () => {
    const dialog = $('#project-create-dialog');
    showFormDialog(dialog);
    requestAnimationFrame(() => dialog.querySelector('[data-project-create-choice]')?.focus());
  };
}

function bindFolderActions() {
  document.querySelectorAll('[data-folder-flag]').forEach(button => button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      await api(`/folders/${encodeURIComponent(button.dataset.folderFlag)}`, { method:'PATCH', body:JSON.stringify({ flagged:button.dataset.flagged !== 'true' }) });
      toast(button.dataset.flagged === 'true' ? 'Markierung entfernt' : 'Ordner markiert');
      await renderProjects();
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-edit-folder]').forEach(button => button.onclick = event => {
    event.preventDefault();
    const folder = folderById(button.dataset.editFolder);
    if (folder) openFolderDialog(folder);
  });
}

async function stableLink(path) {
  let baseUrl = location.origin;
  try { baseUrl = (await api('/system')).baseUrl || baseUrl; } catch {}
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).href;
}

async function copyLink(path, button) {
  const link = await stableLink(path);
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    const field = document.createElement('textarea');
    field.value = link;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    copied = document.execCommand('copy');
    field.remove();
  }
  button.closest('details')?.removeAttribute('open');
  if (copied) toast('Link kopiert');
  else window.prompt('Link kopieren:', link);
}

function bindProjectActions() {
  document.querySelectorAll('[data-project-flag]').forEach(button => button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.projectFlag;
    const flagged = button.dataset.flagged !== 'true';
    button.disabled = true;
    try {
      const updated = await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ flagged }) });
      rememberProject(updated);
      button.dataset.flagged = String(updated.flagged === true);
      button.classList.toggle('active', updated.flagged === true);
      button.setAttribute('aria-pressed', String(updated.flagged === true));
      button.setAttribute('aria-label', updated.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen');
      button.title = updated.flagged === true ? 'Fähnchen entfernen' : 'Fähnchen setzen';
      toast(updated.flagged === true ? 'Projekt markiert' : 'Markierung entfernt');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-project-inline-status]').forEach(select => select.onchange = async event => {
    event.preventDefault();
    event.stopPropagation();
    const id = select.dataset.projectInlineStatus;
    const status = select.value;
    const project = state.projects.find(item => item.id === id) || (state.current?.id === id ? state.current : null);
    if (status === 'archived' && project?.status !== 'archived' && !await confirmAction(`Projekt „${project?.title || id}“ archivieren?`, { title:'Projekt archivieren', confirmLabel:'Archivieren' })) {
      select.value = project?.status || 'active';
      return;
    }
    select.disabled = true;
    const inArchive = location.hash.startsWith('#/archive');
    const onDetail = location.hash.startsWith('#/projects/') || location.pathname.startsWith('/p/');
    try {
      const updated = await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status }) });
      rememberProject(updated);
      toast({ idea:'Projekt ist eine Idee', active:'Projekt ist aktiv', paused:'Projekt pausiert', completed:'Projekt abgeschlossen', archived:'Projekt archiviert' }[status] || 'Projektstatus geändert');
      if (status === 'archived' && onDetail) location.href = '/#/archive';
      else if (inArchive) await renderArchive();
      else if (onDetail) await renderProject(id);
      else await renderProjects();
    } catch (error) {
      toast(error.message);
      if (inArchive) await renderArchive();
      else if (onDetail) await renderProject(id);
      else await renderProjects();
    }
  });
  document.querySelectorAll('[data-project-inline-priority]').forEach(select => select.onchange = async event => {
    event.preventDefault();
    event.stopPropagation();
    const id = select.dataset.projectInlinePriority;
    const priority = select.value;
    select.disabled = true;
    const inArchive = location.hash.startsWith('#/archive');
    const onDetail = location.hash.startsWith('#/projects/') || location.pathname.startsWith('/p/');
    try {
      const updated = await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ priority }) });
      rememberProject(updated);
      toast('Projektpriorität geändert');
      if (inArchive) await renderArchive();
      else if (onDetail) await renderProject(id);
      else await renderProjects();
    } catch (error) {
      toast(error.message);
      if (inArchive) await renderArchive();
      else if (onDetail) await renderProject(id);
      else await renderProjects();
    }
  });
  document.querySelectorAll('[data-edit-project]').forEach(button => button.onclick = event => {
    event.preventDefault();
    const project = state.projects.find(item => item.id === button.dataset.editProject) || (state.current?.id === button.dataset.editProject ? state.current : null);
    if (project) openProjectDialog(project);
  });
  document.querySelectorAll('[data-project-status]').forEach(button => button.onclick = async event => {
    event.preventDefault();
    const id = button.dataset.projectStatus;
    const status = button.dataset.status;
    const project = state.projects.find(item => item.id === id) || (state.current?.id === id ? state.current : null);
    if (status === 'archived' && project?.status !== 'archived' && !await confirmAction(`Projekt „${project?.title || id}“ archivieren?`, { title:'Projekt archivieren', confirmLabel:'Archivieren' })) return;
    const inArchive = location.hash.startsWith('#/archive');
    const onDetail = location.hash.startsWith('#/projects/') || location.pathname.startsWith('/p/');
    const messages = { active:'Projekt ist wieder aktiv', paused:'Projekt pausiert', completed:'Projekt abgeschlossen', archived:'Projekt archiviert' };
    try {
      const updated = await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status }) });
      rememberProject(updated);
      toast(messages[status] || 'Projektstatus geändert');
      if (status === 'archived') {
        if (onDetail) location.href = '/#/archive';
        else await renderProjects();
      } else if (inArchive) await renderArchive();
      else if (onDetail) await renderProject(id);
      else await renderProjects();
    } catch (error) { toast(error.message); }
  });
}

function bindTrashActions() {
  document.querySelectorAll('[data-restore-project]').forEach(button => button.onclick = async event => {
    event.preventDefault();
    const id = button.dataset.restoreProject;
    button.closest('[data-project-card]')?.remove();
    try { await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status:'active' }) }); toast('Projekt wiederhergestellt'); await renderTrash(); }
    catch (error) { toast(error.message); await renderTrash(); }
  });
  document.querySelectorAll('[data-purge-project]').forEach(button => button.onclick = async event => {
    event.preventDefault();
    const id = button.dataset.purgeProject;
    const project = state.projects.find(item => item.id === id);
    if (!await confirmAction(`Projekt „${project?.title || id}“ mit allen Inhalten endgültig löschen? Das kann nicht rückgängig gemacht werden.`, { title:'Projekt endgültig löschen', confirmLabel:'Endgültig löschen' })) return;
    button.closest('[data-project-card]')?.remove();
    try { await api(`/projects/${encodeURIComponent(id)}/permanent`, { method:'DELETE' }); toast('Projekt endgültig gelöscht'); await renderTrash(); }
    catch (error) { toast(error.message); await renderTrash(); }
  });
  const empty = $('[data-empty-trash]');
  if (empty) empty.onclick = async () => {
    if (!await confirmAction('Papierkorb endgültig leeren? Alle enthaltenen Projekte und ihre Inhalte werden unwiderruflich gelöscht.', { title:'Papierkorb leeren', confirmLabel:'Endgültig löschen' })) return;
    empty.disabled = true;
    try { const result = await api('/projects/trash', { method:'DELETE' }); toast(`${result.removed || 0} Projekte endgültig gelöscht`); await renderTrash(); }
    catch (error) { toast(error.message); empty.disabled = false; }
  };
}

function bindEntryActions() {
  document.querySelectorAll('[data-edit-entry-card]').forEach(card => {
    const open = () => {
      const entry = state.current.entries.find(item => item.id === card.dataset.editEntryCard);
      if (entry) openEntryDialog(state.current.id, entry);
    };
    card.onclick = event => { if (!event.target.closest('a,button,summary,details,input,select,textarea')) open(); };
    card.onkeydown = event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } };
  });
  document.querySelectorAll('[data-copy-entry-link]').forEach(button => button.onclick = () => {
    copyLink(`/p/${encodeURIComponent(state.current.id)}/e/${encodeURIComponent(button.dataset.copyEntryLink)}`, button);
  });
  document.querySelectorAll('[data-edit-entry]').forEach(button => button.onclick = () => {
    const entry = state.current.entries.find(item => item.id === button.dataset.editEntry);
    if (entry) openEntryDialog(state.current.id, entry);
  });
  document.querySelectorAll('[data-delete-entry]').forEach(button => button.onclick = async () => {
    const id = button.dataset.deleteEntry;
    const entry = state.current.entries.find(item => item.id === id);
    if (!await confirmAction(`Arbeitsschritt „${entryTitle(entry)}“ endgültig löschen?`, { title:'Arbeitsschritt löschen', confirmLabel:'Endgültig löschen' })) return;
    try { await api(`/projects/${encodeURIComponent(state.current.id)}/entries/${encodeURIComponent(id)}`, { method:'DELETE' }); toast('Arbeitsschritt gelöscht'); await renderProject(state.current.id); }
    catch (error) { toast(error.message); }
  });
}

function bindItemActions() {
  document.querySelectorAll('[data-edit-item-card]').forEach(card => {
    const open = () => {
      const [collection, id] = card.dataset.editItemCard.split(':');
      const item = state.current[collection]?.find(candidate => candidate.id === id);
      if (item) openItemDialog(state.current.id, collection, item);
    };
    card.onclick = event => { if (!event.target.closest('a,button,summary,details,input,select,textarea')) open(); };
    card.onkeydown = event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } };
  });
  document.querySelectorAll('[data-edit-item]').forEach(button => button.onclick = () => {
    const [collection, id] = button.dataset.editItem.split(':');
    const item = state.current[collection]?.find(candidate => candidate.id === id);
    if (item) openItemDialog(state.current.id, collection, item);
  });
  document.querySelectorAll('[data-task-flag]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const id = button.dataset.taskFlag;
    const flagged = button.dataset.flagged !== 'true';
    button.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(state.current.id)}/tasks/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ flagged }) });
      toast(flagged ? 'Arbeitsschritt markiert' : 'Markierung entfernt');
      await renderProject(state.current.id);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-task-inline-priority]').forEach(select => select.onchange = async event => {
    event.stopPropagation();
    const id = select.dataset.taskInlinePriority;
    select.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(state.current.id)}/tasks/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ priority:select.value }) });
      toast('Priorität des Arbeitsschritts geändert');
      await renderProject(state.current.id);
    } catch (error) { toast(error.message); await renderProject(state.current.id); }
  });
  document.querySelectorAll('[data-delete-item]').forEach(button => button.onclick = async () => {
    const [collection, id] = button.dataset.deleteItem.split(':');
    const config = sections[collection];
    const item = state.current[collection]?.find(candidate => candidate.id === id);
    const title = item?.name || item?.title || config.singular;
    if (!await confirmAction(`${config.singular} „${title}“ endgültig löschen?`, { title:`${config.singular} löschen`, confirmLabel:'Endgültig löschen' })) return;
    try { await api(`/projects/${encodeURIComponent(state.current.id)}/${collection}/${encodeURIComponent(id)}`, { method:'DELETE' }); toast(`${config.singular} gelöscht`); await renderProject(state.current.id); }
    catch (error) { toast(error.message); }
  });
}

function bindFileActions() {
  document.querySelectorAll('[data-view-file]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const file = state.current.files?.find(candidate => candidate.id === button.dataset.viewFile);
    if (file) openFileViewer(file);
  });
  document.querySelectorAll('[data-upload-file]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const value = button.dataset.uploadFile || '';
    if (!value) return openFileDialog(state.current.id);
    const separator = value.indexOf(':');
    openFileDialog(state.current.id, { collection:value.slice(0, separator), itemId:value.slice(separator + 1) });
  });
  document.querySelectorAll('[data-edit-file]').forEach(button => button.onclick = () => {
    const file = state.current.files?.find(candidate => candidate.id === button.dataset.editFile);
    if (file) openFileDialog(state.current.id, null, file);
  });
  document.querySelectorAll('[data-rotate-file]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(button.dataset.rotateFile)}/rotate`, { method:'POST', body:JSON.stringify({ degrees:90 }) });
      toast('Bild gedreht');
      await renderProject(state.current.id);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-delete-file]').forEach(button => button.onclick = async () => {
    const file = state.current.files?.find(candidate => candidate.id === button.dataset.deleteFile);
    if (!file || !await confirmAction(`Datei „${file.displayName || file.originalName}“ endgültig löschen?`, { title:'Datei löschen', confirmLabel:'Endgültig löschen' })) return;
    button.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(file.id)}`, { method:'DELETE' });
      toast('Datei gelöscht');
      await renderProject(state.current.id);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  document.querySelectorAll('[data-file-jump]').forEach(button => button.onclick = async () => {
    const [collection, itemId] = button.dataset.fileJump.split(':');
    const section = ['entries','tasks'].includes(collection) ? 'logbook' : attachmentTabByCollection[collection] || collection;
    state.collapsedProjectSections[section] = false;
    await renderProject(state.current.id);
    requestAnimationFrame(() => {
      const target = document.getElementById(itemId);
      target?.scrollIntoView({ behavior:'smooth', block:'center' });
      target?.classList.add('search-target');
      setTimeout(() => target?.classList.remove('search-target'), 2200);
    });
  });
}

async function persistReorder(list) {
  const collection = list.dataset.reorderList;
  const ids = [...list.querySelectorAll(':scope > [data-reorder-card]')].map(card => card.dataset.reorderId);
  if (collection === 'overview') {
    try {
      const preferences = await api('/account/preferences', { method:'PATCH', body:JSON.stringify({ overviewOrder:ids }) });
      Object.assign(state.user, preferences);
      toast('Reihenfolge gespeichert');
    } catch (error) {
      toast(error.message);
    }
    await renderHome(true);
    return;
  }
  if (collection === 'todos') {
    try {
      await api('/todos/reorder', { method:'POST', body:JSON.stringify({ ids }) });
      ids.forEach((id, sortOrder) => {
        const todo = state.todos.find(candidate => candidate.id === id);
        if (todo) todo.sortOrder = sortOrder;
      });
      toast('Reihenfolge gespeichert');
    } catch (error) {
      toast(error.message);
      await renderTodos();
    }
    return;
  }
  try {
    await api(`/projects/${encodeURIComponent(state.current.id)}/${collection}/reorder`, { method:'POST', body:JSON.stringify({ ids }) });
    const items = state.current[collection] || [];
    ids.forEach((id, sortOrder) => {
      const item = items.find(candidate => candidate.id === id);
      if (item) item.sortOrder = sortOrder;
    });
    toast('Reihenfolge gespeichert');
  } catch (error) {
    toast(error.message);
    await renderProject(state.current.id);
  }
}

function todoStructure(list) {
  const items = [];
  list.querySelectorAll(':scope > [data-todo-node]').forEach(root => {
    const id = root.dataset.todoNodeId;
    items.push({ id, parentId:null });
    root.querySelectorAll(':scope > [data-todo-children] > [data-todo-node]').forEach(child => items.push({ id:child.dataset.todoNodeId, parentId:id }));
  });
  return items;
}

async function persistTodoStructure(list) {
  const items = todoStructure(list);
  const focusedId = list.querySelector('[data-todo-drag-handle]:focus')?.dataset.reorderId || null;
  try {
    await api('/todos/reorder', { method:'POST', body:JSON.stringify({ items }) });
    const orders = new Map();
    items.forEach(item => {
      const key = item.parentId || '';
      const todo = state.todos.find(candidate => candidate.id === item.id);
      if (todo) {
        todo.parentId = item.parentId;
        todo.sortOrder = orders.get(key) || 0;
      }
      orders.set(key, (orders.get(key) || 0) + 1);
    });
    toast('Erinnerungsstruktur gespeichert');
    await renderTodos();
    if (focusedId) document.querySelector(`[data-todo-drag-handle][data-reorder-id="${focusedId}"]`)?.focus({ preventScroll:true });
  } catch (error) {
    toast(error.message);
    await renderTodos();
  }
}

function bindTodoReordering() {
  const list = $('[data-todo-tree]');
  if (!list) return;
  let dragged = null;
  let placeholder = null;
  let initialStructure = '';
  let originalStyle = null;
  let draggedSourceWidth = 0;
  let draggedSourceHeight = 0;
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let activePointerId = null;
  let saving = false;
  let draggedHasChildren = false;
  let draggedParentId = null;
  let hoverTarget = null;
  let hoverTimer = null;
  let expandedTarget = null;
  let pendingChildTarget = null;
  let pointerX = 0;
  let pointerY = 0;
  const hoverDelay = 250;
  const signature = () => JSON.stringify(todoStructure(list));
  const syncTodoGroupStates = () => list.querySelectorAll(':scope > [data-todo-node].todo-group').forEach(group => group.classList.toggle('has-children', Boolean(group.querySelector(':scope > [data-todo-children] > [data-todo-node]'))));
  const setDraggedRootAppearance = root => {
    if (!dragged) return;
    dragged.classList.toggle('todo-drag-root', root);
    if (!dragged.classList.contains('todo-subitem') || !dragged.classList.contains('dragging')) return;
    if (!root) {
      dragged.style.width = `${draggedSourceWidth}px`;
      dragged.style.height = `${draggedSourceHeight}px`;
      return;
    }
    dragged.style.width = `${list.getBoundingClientRect().width}px`;
    dragged.style.height = 'auto';
    dragged.style.height = `${Math.ceil(dragged.getBoundingClientRect().height)}px`;
  };
  const markPlaceholder = (parentId = null) => {
    placeholder.classList.toggle('as-child', Boolean(parentId));
    placeholder.dataset.dropLabel = parentId ? 'Als untergeordnete Erinnerung ablegen' : 'Auf Hauptebene ablegen';
    setDraggedRootAppearance(!parentId);
  };
  const syncDraggedLevelFromPlaceholder = () => setDraggedRootAppearance(placeholder?.parentElement === list);
  const place = (targetList, candidate, after, parentId = null) => {
    markPlaceholder(parentId);
    const reference = after ? candidate?.nextElementSibling || null : candidate;
    if (placeholder.parentElement === targetList && placeholder.nextElementSibling === reference) return;
    targetList.insertBefore(placeholder, reference);
  };
  const placeInChildDropzone = target => {
    const dropzone = target?.querySelector(':scope > [data-todo-children] > [data-todo-child-dropzone]');
    if (!dropzone || draggedHasChildren) return false;
    pendingChildTarget = target;
    setDraggedRootAppearance(false);
    return true;
  };
  const cancelHover = () => {
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverTarget = null;
  };
  const collapseExpanded = (restore = true) => {
    cancelHover();
    if (restore) {
      pendingChildTarget = null;
      syncDraggedLevelFromPlaceholder();
    }
    expandedTarget?.classList.remove('todo-drop-parent');
    expandedTarget = null;
  };
  const expandAfterPause = target => {
    if (expandedTarget === target || hoverTarget === target) return;
    cancelHover();
    hoverTarget = target;
    hoverTimer = window.setTimeout(() => {
      if (!dragged || hoverTarget !== target) return;
      expandedTarget?.classList.remove('todo-drop-parent');
      expandedTarget = target;
      hoverTarget = null;
      hoverTimer = null;
      target.classList.add('todo-drop-parent');
      const currentHit = document.elementFromPoint(pointerX, pointerY);
      const currentGroup = currentHit?.closest?.('[data-todo-node].todo-group');
      if (currentGroup === target) placeInChildDropzone(target);
    }, hoverDelay);
  };
  const removePointerListeners = () => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    window.removeEventListener('blur', finish);
  };
  const finish = async event => {
    if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;
    if (!dragged || !placeholder || saving) return;
    saving = true;
    removePointerListeners();
    cancelHover();
    const childTarget = pendingChildTarget;
    pendingChildTarget = null;
    expandedTarget?.classList.remove('todo-drop-parent');
    expandedTarget = null;
    const childDropzone = childTarget?.querySelector(':scope > [data-todo-children] > [data-todo-child-dropzone]');
    if (childDropzone && !draggedHasChildren) {
      childDropzone.parentElement.insertBefore(dragged, childDropzone);
      placeholder.remove();
    } else placeholder.replaceWith(dragged);
    syncTodoGroupStates();
    if (originalStyle === null) dragged.removeAttribute('style'); else dragged.setAttribute('style', originalStyle);
    dragged.classList.remove('dragging');
    dragged.classList.remove('todo-drag-root');
    document.body.classList.remove('is-sorting');
    const changed = signature() !== initialStructure;
    dragged = null;
    placeholder = null;
    draggedParentId = null;
    activePointerId = null;
    if (changed) await persistTodoStructure(list);
    saving = false;
  };
  const move = event => {
    if (!dragged || !placeholder || event.pointerId !== activePointerId) return;
    event.preventDefault();
    dragged.style.left = `${event.clientX - pointerOffsetX}px`;
    dragged.style.top = `${event.clientY - pointerOffsetY}px`;
    pointerX = event.clientX;
    pointerY = event.clientY;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const hitChildren = hit?.closest?.('[data-todo-children]');
    const hitGroup = hitChildren?.closest('[data-todo-node].todo-group') || hit?.closest?.('[data-todo-node].todo-group') || hit?.closest?.('[data-todo-level="root"]')?.closest('[data-todo-node].todo-group') || null;
    const expandedRect = expandedTarget?.getBoundingClientRect();
    const insideExpandedTarget = expandedRect && event.clientX >= expandedRect.left && event.clientX <= expandedRect.right && event.clientY >= expandedRect.top && event.clientY <= expandedRect.bottom;
    if (expandedTarget && hitGroup !== expandedTarget && !insideExpandedTarget) collapseExpanded(true);
    const groupCanReceiveChild = hitGroup && hitGroup.dataset.todoNodeId !== dragged.dataset.todoNodeId && hitGroup.dataset.todoNodeId !== draggedParentId && !draggedHasChildren;
    if (groupCanReceiveChild) expandAfterPause(hitGroup);
    const dropzone = hit?.closest?.('[data-todo-child-dropzone]');
    const placeholderHit = hit?.closest?.('.todo-drag-placeholder');
    if (pendingChildTarget && hitGroup !== expandedTarget && !placeholderHit) {
      pendingChildTarget = null;
      syncDraggedLevelFromPlaceholder();
    }
    if (dropzone && expandedTarget && hitGroup === expandedTarget && !draggedHasChildren) {
      placeInChildDropzone(expandedTarget);
      return;
    }
    if (expandedTarget && hitGroup === expandedTarget && !draggedHasChildren) {
      placeInChildDropzone(expandedTarget);
      return;
    }
    if (placeholderHit && hitGroup === expandedTarget) return;
    const row = hit?.closest?.('[data-todo-id]');
    const candidate = row?.closest?.('[data-todo-node]');
    if (!row || !candidate || candidate.dataset.todoNodeId === dragged.dataset.todoNodeId) {
      if (!hitGroup) cancelHover();
      return;
    }
    const rect = row.getBoundingClientRect();
    if (row.dataset.todoLevel === 'root') {
      if (draggedHasChildren) cancelHover();
      place(list, candidate, event.clientY >= rect.top + rect.height / 2);
      return;
    }
    const childList = candidate.parentElement;
    const parent = childList.closest('[data-todo-node]');
    if (draggedHasChildren) {
      const parentRow = parent.querySelector(':scope > [data-todo-id]');
      place(list, parent, event.clientY >= parentRow.getBoundingClientRect().top + parentRow.getBoundingClientRect().height / 2);
      return;
    }
    const pullToRoot = event.clientX < Math.min(rect.left - 8, list.getBoundingClientRect().left + 72);
    if (pullToRoot) {
      cancelHover();
      const parentRow = parent.querySelector(':scope > [data-todo-id]');
      place(list, parent, event.clientY >= parentRow.getBoundingClientRect().top + parentRow.getBoundingClientRect().height / 2);
    } else if (placeholder.parentElement === childList) {
      place(childList, candidate, event.clientY >= rect.top + rect.height / 2, parent.dataset.todoNodeId);
    }
  };
  list.querySelectorAll('[data-todo-drag-handle]').forEach(handle => {
    const node = handle.closest('[data-todo-node]');
    handle.addEventListener('click', event => event.stopPropagation());
    handle.addEventListener('keydown', async event => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const parentList = node.parentElement;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const siblings = [...parentList.children].filter(candidate => candidate.matches('[data-todo-node]'));
        const index = siblings.indexOf(node);
        const sibling = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!sibling) return;
        if (event.key === 'ArrowUp') parentList.insertBefore(node, sibling); else parentList.insertBefore(sibling, node);
      } else if (event.key === 'ArrowLeft' && parentList.matches('[data-todo-children]')) {
        const parent = parentList.closest('[data-todo-node]');
        list.insertBefore(node, parent.nextElementSibling);
      } else if (event.key === 'ArrowRight' && parentList === list && !node.querySelector(':scope > [data-todo-children] > [data-todo-node]')) {
        const previous = node.previousElementSibling;
        if (!previous?.matches('[data-todo-node]')) return;
        const childList = previous.querySelector(':scope > [data-todo-children]');
        childList.insertBefore(node, childList.querySelector(':scope > [data-todo-child-dropzone]'));
      } else return;
      handle.focus();
      await persistTodoStructure(list);
    });
    handle.addEventListener('pointerdown', event => {
      if (dragged || event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = node;
      draggedParentId = node.parentElement.matches('[data-todo-children]') ? node.parentElement.dataset.todoChildren : null;
      draggedHasChildren = Boolean(node.querySelector(':scope > [data-todo-children] > [data-todo-node]'));
      initialStructure = signature();
      const rect = node.getBoundingClientRect();
      draggedSourceWidth = rect.width;
      draggedSourceHeight = rect.height;
      pointerOffsetX = event.clientX - rect.left;
      pointerOffsetY = event.clientY - rect.top;
      activePointerId = event.pointerId;
      handle.focus({ preventScroll:true });
      placeholder = document.createElement('div');
      placeholder.className = 'todo-drag-placeholder';
      placeholder.style.height = `${rect.height}px`;
      placeholder.setAttribute('aria-hidden', 'true');
      node.parentElement.insertBefore(placeholder, node);
      const sourceParentId = node.parentElement.matches('[data-todo-children]') ? node.parentElement.dataset.todoChildren : null;
      originalStyle = node.getAttribute('style');
      node.classList.add('dragging');
      Object.assign(node.style, { position:'fixed', zIndex:'2000', left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`, margin:'0', boxSizing:'border-box', pointerEvents:'none' });
      document.body.append(node);
      markPlaceholder(sourceParentId);
      document.body.classList.add('is-sorting');
      document.addEventListener('pointermove', move, { capture:true, passive:false });
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
      window.addEventListener('blur', finish);
    });
  });
}

function placeDraggedCard(list, placeholder, dragged, movementX, movementY) {
  if (!movementX && !movementY) return;
  const draggedRect = dragged.getBoundingClientRect();
  let target = null;
  let strongestOverlap = .4;
  list.querySelectorAll(':scope > [data-reorder-card]').forEach(candidate => {
    const rect = candidate.getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(draggedRect.right, rect.right) - Math.max(draggedRect.left, rect.left));
    const overlapHeight = Math.max(0, Math.min(draggedRect.bottom, rect.bottom) - Math.max(draggedRect.top, rect.top));
    const overlap = rect.width && rect.height ? overlapWidth * overlapHeight / (rect.width * rect.height) : 0;
    if (overlap > strongestOverlap) {
      strongestOverlap = overlap;
      target = candidate;
    }
  });
  if (!target) return;
  const after = Math.abs(movementX) >= Math.abs(movementY) ? movementX > 0 : movementY > 0;
  if ((!after && placeholder.nextElementSibling === target) || (after && target.nextElementSibling === placeholder)) return;
  list.insertBefore(placeholder, after ? target.nextElementSibling : target);
}

function bindReordering() {
  document.querySelectorAll('[data-reorder-list]').forEach(list => {
    let dragged = null;
    let placeholder = null;
    let initialOrder = '';
    let originalStyle = null;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let activePointerId = null;
    let saving = false;
    const order = () => [...list.querySelectorAll(':scope > [data-reorder-card]')].map(card => card.dataset.reorderId).join(',');
    const removePointerListeners = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
    };
    const finish = async event => {
      if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;
      if (!dragged || !placeholder || saving) return;
      saving = true;
      removePointerListeners();
      placeholder.replaceWith(dragged);
      if (originalStyle === null) dragged.removeAttribute('style'); else dragged.setAttribute('style', originalStyle);
      dragged.classList.remove('dragging');
      document.body.classList.remove('is-sorting');
      const changed = order() !== initialOrder;
      dragged = null;
      placeholder = null;
      activePointerId = null;
      if (changed) await persistReorder(list);
      saving = false;
    };
    const move = event => {
      if (!dragged || !placeholder || event.pointerId !== activePointerId) return;
      event.preventDefault();
      const movementX = event.clientX - lastPointerX;
      const movementY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      dragged.style.left = `${event.clientX - pointerOffsetX}px`;
      dragged.style.top = `${event.clientY - pointerOffsetY}px`;
      placeDraggedCard(list, placeholder, dragged, movementX, movementY);
    };
    list.querySelectorAll('[data-reorder-handle]').forEach(handle => {
      const card = handle.closest('[data-reorder-card]');
      handle.addEventListener('click', event => event.stopPropagation());
      handle.addEventListener('keydown', async event => {
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        const target = backwards ? card.previousElementSibling : card.nextElementSibling;
        if (!target) return;
        if (backwards) list.insertBefore(card, target); else list.insertBefore(target, card);
        handle.focus();
        await persistReorder(list);
      });
      handle.addEventListener('pointerdown', event => {
        if (dragged || event.button > 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragged = card;
        initialOrder = order();
        const rect = card.getBoundingClientRect();
        pointerOffsetX = event.clientX - rect.left;
        pointerOffsetY = event.clientY - rect.top;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        activePointerId = event.pointerId;
        placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
        placeholder.style.height = `${rect.height}px`;
        placeholder.setAttribute('aria-hidden', 'true');
        list.insertBefore(placeholder, card);
        originalStyle = card.getAttribute('style');
        card.classList.add('dragging');
        handle.focus({ preventScroll:true });
        Object.assign(card.style, { position:'fixed', zIndex:'2000', left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`, margin:'0', boxSizing:'border-box', pointerEvents:'none' });
        document.body.append(card);
        document.body.classList.add('is-sorting');
        document.addEventListener('pointermove', move, { capture:true, passive:false });
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', finish, true);
        window.addEventListener('blur', finish);
      });
    });
  });
}
enhanceDateInputs();

document.querySelectorAll('[data-project-add-choice]').forEach(button => button.addEventListener('click', () => {
  const dialog = $('#project-add-dialog');
  const projectId = dialog.querySelector('form').elements.projectId.value;
  const choice = button.dataset.projectAddChoice;
  dialog.close();
  if (choice === 'entries') openEntryDialog(projectId);
  else if (choice === 'files') openFileDialog(projectId);
  else openItemDialog(projectId, choice);
}));

document.querySelectorAll('[data-project-create-choice]').forEach(button => button.addEventListener('click', () => {
  $('#project-create-dialog').close();
  if (button.dataset.projectCreateChoice === 'folder') {
    openFolderDialog();
    return;
  }
  const status = regularProjectStatuses.includes(state.projectStatusFilter) ? state.projectStatusFilter : 'active';
  openProjectDialog(null, { status });
}));

$('#ai-project-export-form').onsubmit = event => {
  event.preventDefault();
  const form = event.currentTarget;
  const project = state.current?.id === form.elements.projectId.value ? state.current : null;
  if (!project) return toast('Das Projekt ist nicht mehr geöffnet.');
  try {
    const markdown = LogbuchAiProject.exportContext(project, state.tags, { includeFileMetadata:form.elements.files.value === 'metadata' });
    downloadTextFile(`logbuch-${safeDownloadName(project.title)}-ki-kontext.md`, markdown);
    $('#ai-project-export-dialog').close();
    toast('KI-Kontext exportiert');
  } catch (error) { toast(error.message); }
};

document.querySelectorAll('dialog form').forEach(form => form.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
  if (event.target.matches('button')) {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.target.matches('textarea')) return;
  const submit = form.querySelector('button[type="submit"]:not(:disabled)');
  if (!submit) return;
  event.preventDefault();
  form.requestSubmit(submit);
}));

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = $('#login-error'); error.textContent = '';
  try { state.user = await api('/login', { method:'POST', body:JSON.stringify(Object.fromEntries(form)) }); showApp(true); }
  catch (cause) { error.textContent = cause.message; }
});
$('#todo-repeat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.todoId.value;
  const interval = Number(form.elements.interval.value);
  const unit = form.elements.unit.value;
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    form.elements.interval.focus();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api(`/todos/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ recurrence:{ interval, unit } }) });
    $('#todo-repeat-dialog').close();
    form.reset();
    toast('Wiederholung gespeichert');
    await renderTodos();
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});
$('#todo-repeat-delete').addEventListener('click', async event => {
  const button = event.currentTarget;
  const form = $('#todo-repeat-form');
  const id = form.elements.todoId.value;
  button.disabled = true;
  try {
    await api(`/todos/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ recurrence:null }) });
    $('#todo-repeat-dialog').close();
    form.reset();
    toast('Wiederholung entfernt');
    await renderTodos();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#project-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const titleInput = formElement.elements.title;
  if (!String(form.title || '').trim()) {
    titleInput.classList.add('input-invalid');
    titleInput.setAttribute('aria-invalid', 'true');
  }
  const dateInput = formElement.elements.createdAt;
  if (!form.createdAt) {
    dateInput.classList.add('input-invalid');
    dateInput.setAttribute('aria-invalid', 'true');
  }
  const invalidDateInput = [...formElement.querySelectorAll('input[type="date"]')].find(input => !input.checkValidity());
  if (invalidDateInput) {
    invalidDateInput.classList.add('input-invalid');
    invalidDateInput.setAttribute('aria-invalid', 'true');
  }
  if (!String(form.title || '').trim() || !form.createdAt || invalidDateInput) {
    (!String(form.title || '').trim() ? titleInput : invalidDateInput || dateInput).focus();
    return;
  }
  const editing = Boolean(form.projectId);
  const path = editing ? `/projects/${encodeURIComponent(form.projectId)}` : '/projects';
  const returnUrl = formElement.dataset.returnUrl;
  try {
    const payload = { title:form.title, description:form.description, status:form.status, icon:form.icon, iconInherited:form.iconInherited === '1', createdAt:form.createdAt, dueDate:form.dueDate || '', folderId:form.folderId || null, tagIds:state.projectDialogTagIds };
    const project = await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    rememberProject(project);
    $('#project-dialog').close(); formElement.reset(); toast(editing ? 'Projekt aktualisiert' : 'Projekt angelegt');
    if (!editing) location.href = `/#/projects/${project.id}`;
    else if (returnUrl && returnUrl !== location.href) location.href = returnUrl;
    else await route();
  }
  catch (error) { toast(error.message); }
});
$('#project-dialog-copy').addEventListener('click', event => {
  const id = $('#project-form').elements.projectId.value;
  if (id) copyLink(`/p/${encodeURIComponent(id)}`, event.currentTarget);
});
$('#project-dialog-delete').addEventListener('click', async event => {
  const button = event.currentTarget;
  const form = $('#project-form');
  const id = form.elements.projectId.value;
  const project = state.projects.find(item => item.id === id) || (state.current?.id === id ? state.current : null);
  if (!id || !await confirmAction(`Projekt „${project?.title || id}“ in den Papierkorb verschieben?`, { title:'Projekt löschen', confirmLabel:'In Papierkorb' })) return;
  button.disabled = true;
  try {
    const trashed = await api(`/projects/${encodeURIComponent(id)}`, { method:'DELETE' });
    rememberProject({ ...trashed, status:'trashed' });
    $('#project-dialog').close();
    form.reset();
    toast('Projekt in den Papierkorb verschoben');
    if (location.hash.startsWith('#/projects/') || location.pathname.startsWith('/p/')) location.href = '/#/projects';
    else if (location.hash.startsWith('#/archive')) await renderArchive();
    else await renderProjects();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#project-form [data-new-folder-from-project]').addEventListener('click', () => {
  const parentId = $('#project-form').elements.folderId.value || null;
  openFolderDialog(null, { selectAfterCreate:true, parentId });
});
$('#folder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  if (!String(form.name || '').trim()) {
    formElement.elements.name.classList.add('input-invalid');
    formElement.elements.name.focus();
    return;
  }
  const editing = Boolean(form.folderId);
  try {
    const folder = await api(editing ? `/folders/${encodeURIComponent(form.folderId)}` : '/folders', { method:editing ? 'PATCH' : 'POST', body:JSON.stringify({ name:form.name, description:form.description, icon:form.icon, parentId:form.parentId || null }) });
    const index = state.folders.findIndex(item => item.id === folder.id);
    if (index >= 0) state.folders[index] = folder; else state.folders.push(folder);
    $('#folder-dialog').close();
    if (!editing && form.selectAfterCreate === '1' && $('#project-dialog').open) {
      const select = $('#project-form').elements.folderId;
      select.innerHTML = folderSelectOptions(folder.id);
      select.value = folder.id;
    } else {
      toast(editing ? 'Ordner aktualisiert' : 'Ordner angelegt');
      await renderProjects();
    }
  } catch (error) { toast(error.message); }
});
$('#folder-dialog-delete').addEventListener('click', async event => {
  const button = event.currentTarget;
  const form = $('#folder-form');
  const id = form.elements.folderId.value;
  const folder = folderById(id);
  if (!folder || !await confirmAction(`Ordner „${folder.name}“ endgültig löschen?`, { title:'Ordner löschen', confirmLabel:'Endgültig löschen' })) return;
  button.disabled = true;
  try {
    await api(`/folders/${encodeURIComponent(id)}`, { method:'DELETE' });
    state.folders = state.folders.filter(item => item.id !== id);
    $('#folder-dialog').close();
    form.reset();
    toast('Ordner gelöscht');
    await renderProjects();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
document.querySelectorAll('.dialog-attachments input[type="file"]').forEach(input => input.addEventListener('change', () => updateDialogAttachmentSummary(input)));
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const editing = Boolean(form.entryId);
  const path = `/projects/${encodeURIComponent(form.projectId)}/entries${editing ? `/${encodeURIComponent(form.entryId)}` : ''}`;
  const submit = $('#entry-submit');
  submit.disabled = true;
  try {
    const files = selectedDialogAttachments(formElement);
    const saved = await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify({ title:form.title, body:form.body, nextStep:'', date:form.date }) });
    const uploads = await uploadDialogAttachments(form.projectId, 'entries', saved.id, files);
    $('#entry-dialog').close(); formElement.reset(); toast(savedWithAttachmentsMessage('Arbeitsschritt', editing, uploads)); await renderProject(form.projectId);
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});
$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const editing = Boolean(form.itemId);
  const path = `/projects/${encodeURIComponent(form.projectId)}/${form.collection}${editing ? `/${encodeURIComponent(form.itemId)}` : ''}`;
  const payload = { ...form, createdAt:today() };
  delete payload.projectId; delete payload.collection; delete payload.itemId; delete payload.attachments;
  const submit = $('#item-submit');
  submit.disabled = true;
  try {
    const files = selectedDialogAttachments(formElement);
    const saved = await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    const uploads = await uploadDialogAttachments(form.projectId, form.collection, saved.id, files);
    $('#item-dialog').close(); formElement.reset(); toast(savedWithAttachmentsMessage(sections[form.collection].singular, editing, uploads)); await renderProject(form.projectId);
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});
$('#file-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const values = Object.fromEntries(new FormData(formElement));
  const editing = Boolean(values.fileId);
  const submit = $('#file-submit');
  submit.disabled = true;
  try {
    if (editing) {
      await api(`/projects/${encodeURIComponent(values.projectId)}/files/${encodeURIComponent(values.fileId)}`, { method:'PATCH', body:JSON.stringify({ displayName:values.displayName, description:values.description }) });
      toast('Dateiinformationen aktualisiert');
    } else {
      const file = formElement.elements.file.files?.[0];
      if (!file) throw new Error('Wähle zuerst eine Datei aus.');
      if (file.size > 50 * 1024 * 1024) throw new Error('Die Datei ist größer als 50 MB.');
      const payload = new FormData();
      payload.append('file', file);
      payload.append('displayName', values.displayName || '');
      payload.append('description', values.description || '');
      payload.append('associationCollection', values.associationCollection || '');
      payload.append('associationItemId', values.associationItemId || '');
      await api(`/projects/${encodeURIComponent(values.projectId)}/files`, { method:'POST', body:payload });
      toast('Datei hochgeladen');
    }
    $('#file-dialog').close();
    formElement.reset();
    await renderProject(values.projectId);
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});
$('#file-viewer-rotate-left').onclick = event => rotateViewedFile(-90, event.currentTarget);
$('#file-viewer-rotate-right').onclick = event => rotateViewedFile(90, event.currentTarget);
$('#file-viewer-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!mayEditProjects()) return;
  const form = event.currentTarget;
  const file = state.current?.files?.find(candidate => candidate.id === form.elements.fileId.value);
  if (!file) return;
  const save = $('#file-viewer-save');
  save.disabled = true;
  try {
    const updated = await api(`/projects/${encodeURIComponent(state.current.id)}/files/${encodeURIComponent(file.id)}`, { method:'PATCH', body:JSON.stringify({ displayName:form.elements.displayName.value, description:form.elements.description.value }) });
    replaceFileInState(updated);
    renderFileViewer(updated);
    toast('Dateiinformationen gespeichert');
  } catch (error) { toast(error.message); }
  finally { save.disabled = false; }
});
$('#file-viewer-dialog').addEventListener('close', () => { state.fileViewerId = null; });
$('#user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const editing = Boolean(form.elements.userId.value);
  const projectIds = [...$('#user-projects').querySelectorAll('input:checked')].map(input => input.value);
  const payload = { role:form.elements.role.value, projectAccessMode:form.elements.projectAccessMode.value, mustChangePassword:form.elements.mustChangePassword.checked, projectIds };
  if (!editing) payload.id = form.elements.id.value;
  if (form.elements.password.value) payload.password = form.elements.password.value;
  const path = editing ? `/users/${encodeURIComponent(form.elements.userId.value)}` : '/users';
  try {
    await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#user-dialog').close(); form.reset(); toast(editing ? 'Benutzer aktualisiert' : 'Benutzer angelegt'); await renderSettings();
  } catch (error) { toast(error.message); }
});
$('#tag-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.tagId.value;
  try {
    const tag = await api(id ? `/tags/${encodeURIComponent(id)}` : '/tags', { method:id ? 'PATCH' : 'POST', body:JSON.stringify({ name:form.elements.name.value }) });
    $('#tag-dialog').close();
    toast(id ? 'Tag umbenannt' : 'Tag angelegt');
    await renderSettings();
  } catch (error) { toast(error.message); }
});
$('#tag-merge-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api(`/tags/${encodeURIComponent(form.elements.sourceId.value)}/merge`, { method:'POST', body:JSON.stringify({ targetId:form.elements.targetId.value }) });
    $('#tag-merge-dialog').close();
    toast('Tags zusammengeführt');
    await renderSettings();
  } catch (error) { toast(error.message); }
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#password-error');
  error.textContent = '';
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) { error.textContent = 'Die neuen Passwörter stimmen nicht überein.'; return; }
  try {
    await api('/account/password', { method:'POST', body:JSON.stringify({ currentPassword:form.elements.currentPassword.value, newPassword:form.elements.newPassword.value }) });
    state.user.mustChangePassword = false;
    $('#password-dialog').close(); form.reset(); toast('Passwort geändert');
    if (form.dataset.forced === 'true') { location.hash = '#/settings/profile'; await route(); }
  } catch (cause) { error.textContent = cause.message; }
});
$('#update-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#update-error');
  const submit = form.querySelector('button[type="submit"]');
  const targetVersion = state.update?.latestVersion || '';
  const platform = state.update?.platform || '';
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = platform === 'docker' ? 'Update wird angefordert …' : 'Update wird installiert …';
  showUpdateProgress(
    platform === 'docker' ? 'Update wird vorbereitet …' : 'Update wird installiert …',
    platform === 'docker'
      ? `Version ${targetVersion} wird sicher an den AIO-Updater übergeben.`
      : `Version ${targetVersion} wird geprüft, gesichert und installiert.`,
  );
  try {
    const result = await api('/update/install', { method:'POST', body:JSON.stringify({ password:form.elements.password.value }) });
    form.reset();
    if (result.reload) {
      showUpdateProgress('Update abgeschlossen', `Version ${targetVersion} wurde installiert. Die Seite wird jetzt automatisch neu geladen.`);
      setTimeout(() => location.reload(), 900);
      return;
    }
    await monitorRequestedUpdate(targetVersion);
  } catch (cause) {
    if (!cause.status) {
      await monitorRequestedUpdate(targetVersion);
      return;
    }
    resetUpdateDialog();
    error.textContent = cause.message;
    form.elements.password.focus();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Update installieren';
  }
});
$('#update-manual-reload').onclick = () => location.reload();
$('#logout').onclick = async () => { await api('/logout', { method:'POST' }); location.reload(); };
$('#global-search-form').onsubmit = event => {
  event.preventDefault();
  const query = $('#global-search-input').value.trim();
  location.href = `/#/search${query ? `?q=${encodeURIComponent(query)}` : ''}`;
};

$('#storage-location-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const id = form.elements.locationId.value;
  const series = !id && form.elements.creationMode.value === 'series';
  const matrix = !id && form.elements.creationMode.value === 'matrix';
  const payload = {
    name:form.elements.name.value,
    icon:form.elements.icon.value,
    parentId:form.elements.parentId.value || null,
    description:form.elements.description.value,
  };
  if (series) {
    payload.counterStart = form.elements.counterStart.value;
    payload.count = form.elements.count.value;
  }
  if (matrix) {
    payload.letterStart = form.elements.letterStart.value;
    payload.letterEnd = form.elements.letterEnd.value;
    payload.counterStart = form.elements.matrixCounterStart.value;
    payload.counterEnd = form.elements.matrixCounterEnd.value;
  }
  try {
    const saved = await api(id ? `/storage-locations/${encodeURIComponent(id)}` : series ? '/storage-locations/batch' : matrix ? '/storage-locations/matrix' : '/storage-locations', { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#storage-location-dialog').close();
    form.reset();
    toast(id ? 'Lagerort aktualisiert.' : series || matrix ? `${saved.count} Lagerorte angelegt.` : 'Lagerort angelegt.');
    if (id && location.hash.includes(`/location/${encodeURIComponent(id)}`)) await route();
    else if (series || matrix) {
      location.href = storageLocationHref(payload.parentId || '');
      await route();
    } else location.href = storageLocationHref(saved.id);
  } catch (error) { $('#storage-location-error').textContent = error.message; }
};
$('#storage-location-form').elements.name.addEventListener('input', () => {
  updateStorageLocationSeriesPreview();
  updateStorageLocationMatrixPreview();
});
for (const field of ['counterStart', 'count']) $('#storage-location-form').elements[field].addEventListener('input', updateStorageLocationSeriesPreview);
for (const field of ['letterStart', 'letterEnd', 'matrixCounterStart', 'matrixCounterEnd']) $('#storage-location-form').elements[field].addEventListener('input', event => {
  if (field === 'letterStart' || field === 'letterEnd') event.currentTarget.value = event.currentTarget.value.toUpperCase();
  updateStorageLocationMatrixPreview();
});
document.querySelectorAll('[data-storage-series-step]').forEach(button => button.onclick = () => {
  const [field, rawDirection] = button.dataset.storageSeriesStep.split(':');
  stepInventoryQuantity($('#storage-location-form').elements[field], Number(rawDirection));
});
document.querySelectorAll('[data-storage-matrix-step]').forEach(button => button.onclick = () => {
  const [field, rawDirection] = button.dataset.storageMatrixStep.split(':');
  stepInventoryQuantity($('#storage-location-form').elements[field], Number(rawDirection));
});
$('#inventory-category-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const id = form.elements.categoryId.value;
  const payload = { name:form.elements.name.value, icon:form.elements.icon.value, parentId:form.elements.parentId.value || null, description:form.elements.description.value };
  try {
    const saved = await api(id ? `/inventory-categories/${encodeURIComponent(id)}` : '/inventory-categories', { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#inventory-category-dialog').close();
    toast(id ? 'Kategorie aktualisiert.' : 'Kategorie angelegt.');
    location.href = inventoryCategoryHref(saved.id);
  } catch (error) { $('#inventory-category-error').textContent = error.message; }
};
$('#inventory-category-delete').onclick = async () => {
  const id = $('#inventory-category-form').elements.categoryId.value;
  if (!id || !await confirmAction('Diese leere Kategorie endgültig löschen?', { title:'Kategorie löschen', confirmLabel:'Endgültig löschen' })) return;
  try { await api(`/inventory-categories/${encodeURIComponent(id)}`, { method:'DELETE', body:'{}' }); $('#inventory-category-dialog').close(); location.href = inventoryCategoryHref(); }
  catch (error) { $('#inventory-category-error').textContent = error.message; }
};
$('#inventory-item-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const id = form.elements.itemId.value;
  const storageLocationId = form.dataset.storageLocationId || '';
  const categoryContextId = form.dataset.categoryContextId || '';
  const payload = {
    name:form.elements.name.value,
    trackingMode:form.elements.trackingMode.value,
    stockUnit:form.elements.stockUnit.value,
    description:form.elements.description.value,
    manufacturer:form.elements.manufacturer.value,
    articleNumber:form.elements.articleNumber.value,
    barcode:form.elements.barcode.value,
    defaultMinimumQuantity:form.elements.defaultMinimumQuantity.value || null,
    merchantUrl:form.elements.merchantUrl.value,
    categoryIds:JSON.parse(form.dataset.categoryIds || '[]'),
  };
  try {
    const saved = await api(id ? `/inventory-items/${encodeURIComponent(id)}` : '/inventory-items', { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    form.elements.itemId.value = saved.id;
    if (storageLocationId && form.dataset.storageLocationAssigned !== '1') {
      await api('/stock-entries', { method:'POST', body:JSON.stringify({ itemId:saved.id, storageLocationId, initialQuantity:payload.trackingMode === 'COLLECTION' ? 0 : form.elements.initialQuantity.value || 0, minimumQuantity:null, note:'' }) });
      form.dataset.storageLocationAssigned = '1';
    }
    const image = form.elements.image.files?.[0];
    if (image) {
      const imagePayload = new FormData();
      imagePayload.append('image', image, image.name);
      await api(`/inventory-items/${encodeURIComponent(saved.id)}/image`, { method:'POST', body:imagePayload });
    } else if (form.dataset.removeImage === '1') {
      await api(`/inventory-items/${encodeURIComponent(saved.id)}/image`, { method:'DELETE' });
    }
    $('#inventory-item-dialog').close();
    form.reset();
    const storageLocation = storageLocationId ? state.storageLocations.find(candidate => candidate.id === storageLocationId) : null;
    const category = categoryContextId ? state.inventoryCategories.find(candidate => candidate.id === categoryContextId) : null;
    toast(storageLocation ? `Artikel angelegt und „${storageLocation.name}“ zugeordnet.` : category ? `Artikel angelegt und „${category.name}“ zugeordnet.` : id ? 'Artikel aktualisiert.' : 'Artikel angelegt.');
    if (id && location.hash.includes(`/item/${encodeURIComponent(id)}`)) await route();
    else location.href = storageLocationId ? storageContextItemHref(storageLocationId, saved.id, false) : categoryContextId ? inventoryCategoryHref(categoryContextId, saved.id) : inventoryItemHref(saved.id, false, '');
  } catch (error) { $('#inventory-item-error').textContent = error.message; }
};
[...$('#inventory-item-form').elements.trackingMode].forEach(input => input.onchange = syncInventoryItemTrackingMode);
document.querySelectorAll('[data-inventory-initial-step]').forEach(button => button.onclick = () => stepInventoryQuantity(
  $('#inventory-item-form').elements.initialQuantity,
  Number(button.dataset.inventoryInitialStep),
));
document.querySelectorAll('[data-inventory-minimum-step]').forEach(button => button.onclick = () => {
  const input = $('#inventory-item-form').elements.defaultMinimumQuantity;
  const direction = Number(button.dataset.inventoryMinimumStep);
  const next = input.value === '' ? (direction > 0 ? 1 : 0) : Number(input.value) + direction;
  input.value = String(Math.min(Number(input.max), Math.max(0, next)));
  input.dispatchEvent(new Event('input', { bubbles:true }));
});
$('#inventory-item-note-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const itemId = form.elements.itemId.value;
  const noteId = form.elements.noteId.value;
  try {
    await api(`/inventory-items/${encodeURIComponent(itemId)}/notes${noteId ? `/${encodeURIComponent(noteId)}` : ''}`, { method:noteId ? 'PATCH' : 'POST', body:JSON.stringify({ content:form.elements.content.value }) });
    $('#inventory-item-note-dialog').close();
    toast(noteId ? 'Notiz aktualisiert.' : 'Notiz hinzugefügt.');
    await route();
  } catch (error) { $('#inventory-item-note-error').textContent = error.message; }
};
$('#inventory-item-image-input').onchange = event => {
  const form = $('#inventory-item-form');
  const file = event.currentTarget.files?.[0];
  if (inventoryItemImagePreviewUrl) URL.revokeObjectURL(inventoryItemImagePreviewUrl);
  inventoryItemImagePreviewUrl = file ? URL.createObjectURL(file) : '';
  if (file) {
    form.dataset.removeImage = '0';
    setInventoryItemImagePreview(inventoryItemImagePreviewUrl);
    $('#inventory-item-image-remove').hidden = false;
  }
};
$('#inventory-item-image-remove').onclick = () => {
  const form = $('#inventory-item-form');
  form.elements.image.value = '';
  form.dataset.removeImage = '1';
  if (inventoryItemImagePreviewUrl) URL.revokeObjectURL(inventoryItemImagePreviewUrl);
  inventoryItemImagePreviewUrl = '';
  setInventoryItemImagePreview('');
  $('#inventory-item-image-remove').hidden = true;
};
$('#stock-entry-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const entryId = form.elements.entryId.value;
  if (!entryId && !form.elements.storageLocationId.value) {
    $('#stock-entry-error').textContent = 'Bitte einen Lagerort auswählen.';
    return;
  }
  const item = state.inventoryItems.find(candidate => candidate.id === form.elements.itemId.value) || state.inventoryStockItem;
  const collection = isLooseCollection(item);
  const payload = {
    itemId:form.elements.itemId.value,
    storageLocationId:form.elements.storageLocationId.value,
    initialQuantity:collection ? 0 : form.elements.initialQuantity.value || 0,
    minimumQuantity:collection ? null : form.elements.minimumQuantity.value || null,
    note:form.elements.note.value,
  };
  try {
    await api(entryId ? `/stock-entries/${encodeURIComponent(entryId)}` : '/stock-entries', { method:entryId ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#stock-entry-dialog').close();
    toast(entryId ? (collection ? 'Lagerortnotiz aktualisiert.' : 'Lokaler Mindestbestand aktualisiert.') : 'Lagerort hinzugefügt.');
    await route();
  } catch (error) { $('#stock-entry-error').textContent = error.message; }
};
$('#stock-movement-form').elements.type.onchange = syncStockMovementFields;
$('#stock-movement-form').elements.sourceStorageLocationId.onchange = syncStockMovementFields;
function stepInventoryQuantity(input, direction) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const current = Number(input.value);
  const base = Number.isFinite(current) && input.value !== '' ? current : direction > 0 ? 0 : minimum;
  const next = Math.round((base + direction) * 1000000) / 1000000;
  input.value = String(Math.min(maximum, Math.max(minimum, next)));
  input.dispatchEvent(new Event('input', { bubbles:true }));
}
document.querySelectorAll('[data-todo-repeat-step]').forEach(button => button.onclick = () => stepInventoryQuantity(
  $('#todo-repeat-form').elements.interval,
  Number(button.dataset.todoRepeatStep),
));
document.querySelectorAll('[data-stock-quantity-step]').forEach(button => button.onclick = () => {
  const input = $('#stock-movement-form').elements.quantity;
  stepInventoryQuantity(input, Number(button.dataset.stockQuantityStep));
});
document.querySelectorAll('[data-stock-counted-step]').forEach(button => button.onclick = () => stepInventoryQuantity(
  $('#stock-movement-form').elements.countedQuantity,
  Number(button.dataset.stockCountedStep),
));
document.querySelectorAll('[data-stock-entry-initial-step]').forEach(button => button.onclick = () => stepInventoryQuantity(
  $('#stock-entry-form').elements.initialQuantity,
  Number(button.dataset.stockEntryInitialStep),
));
document.querySelectorAll('[data-stock-entry-minimum-step]').forEach(button => button.onclick = () => {
  const input = $('#stock-entry-form').elements.minimumQuantity;
  const current = Number(input.value);
  const direction = Number(button.dataset.stockEntryMinimumStep);
  const next = input.value === '' ? (direction > 0 ? 1 : 0) : current + direction;
  input.value = String(Math.min(Number(input.max), Math.max(0, next)));
  input.dispatchEvent(new Event('input', { bubbles:true }));
});
$('#stock-movement-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  syncStockMovementFields();
  if (!form.reportValidity()) return;
  const type = form.elements.type.value;
  const payload = { type, itemId:form.elements.itemId.value, note:form.elements.note.value };
  if (type === 'CORRECTION') {
    payload.storageLocationId = form.elements.storageLocationId.value;
    payload.countedQuantity = form.elements.countedQuantity.value;
  } else {
    payload.quantity = form.elements.quantity.value;
    if (['CONSUMPTION','DISPOSAL','LOSS','TRANSFER'].includes(type)) payload.sourceStorageLocationId = form.elements.sourceStorageLocationId.value;
    if (['RECEIPT','RETURN','TRANSFER'].includes(type)) payload.destinationStorageLocationId = form.elements.destinationStorageLocationId.value;
  }
  try {
    const result = await api('/stock-movements', { method:'POST', body:JSON.stringify(payload) });
    $('#stock-movement-dialog').close();
    toast(result.changed ? 'Bestandsbewegung verbucht.' : 'Der gezählte Bestand war bereits aktuell.');
    await route();
  } catch (error) { $('#stock-movement-error').textContent = error.message; }
};
[...$('#stock-transfer-form').elements.quantityMode].forEach(input => input.onchange = syncStockTransferQuantityMode);
document.querySelectorAll('[data-stock-transfer-quantity-step]').forEach(button => button.onclick = () => {
  const input = $('#stock-transfer-form').elements.quantity;
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const current = Number(input.value);
  const next = (Number.isFinite(current) && input.value !== '' ? current : minimum) + Number(button.dataset.stockTransferQuantityStep);
  input.value = String(Math.min(maximum, Math.max(minimum, next)));
  input.dispatchEvent(new Event('input', { bubbles:true }));
});
$('#stock-transfer-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  syncStockTransferQuantityMode();
  if (!form.reportValidity()) return;
  if (form.elements.trackingMode.value === 'COLLECTION') {
    try {
      await api(`/stock-entries/${encodeURIComponent(form.elements.entryId.value)}`, { method:'PATCH', body:JSON.stringify({ storageLocationId:form.elements.destinationStorageLocationId.value, note:form.elements.note.value }) });
      $('#stock-transfer-dialog').close();
      toast('Lose Sammlung umgelagert.');
      await route();
    } catch (error) { $('#stock-transfer-error').textContent = error.message; }
    return;
  }
  const maximum = Number(form.elements.maximumQuantity.value);
  const quantity = form.elements.quantityMode.value === 'all' ? maximum : Number(form.elements.quantity.value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > maximum) {
    $('#stock-transfer-error').textContent = `Die Menge muss größer als 0 und höchstens ${formatInventoryQuantity(maximum)} ${form.elements.stockUnit.value} sein.`;
    return;
  }
  try {
    await api('/stock-movements', { method:'POST', body:JSON.stringify({
      type:'TRANSFER',
      itemId:form.elements.itemId.value,
      sourceStorageLocationId:form.elements.sourceStorageLocationId.value,
      destinationStorageLocationId:form.elements.destinationStorageLocationId.value,
      quantity,
      note:form.elements.note.value,
    }) });
    $('#stock-transfer-dialog').close();
    toast(`${formatInventoryQuantity(quantity)} ${form.elements.stockUnit.value} umgelagert.`);
    await route();
  } catch (error) { $('#stock-transfer-error').textContent = error.message; }
};
$('#reservation-form').elements.projectId.onchange = async event => {
  const projectId = event.currentTarget.value;
  $('#reservation-form').elements.projectEntryId.disabled = !projectId;
  if (!projectId) return setReservationTaskOptions(null);
  try { setReservationTaskOptions(await reservationProject(projectId)); }
  catch (error) { $('#reservation-error').textContent = error.message; }
};
$('#reservation-form').elements.itemId.onchange = () => { syncReservationQuantityUnit(); updateReservationAvailability(); };
document.querySelectorAll('[data-reservation-quantity-step]').forEach(button => button.onclick = () => {
  const input = $('#reservation-form').elements.requestedQuantity;
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const current = Number(input.value);
  const next = (Number.isFinite(current) && input.value !== '' ? current : minimum) + Number(button.dataset.reservationQuantityStep);
  input.value = String(Math.min(maximum, Math.max(minimum, next)));
  input.dispatchEvent(new Event('input', { bubbles:true }));
});
document.querySelectorAll('[data-reservation-fulfill-step]').forEach(button => button.onclick = () => stepInventoryQuantity(
  $('#reservation-fulfill-form').elements.quantity,
  Number(button.dataset.reservationFulfillStep),
));
$('#reservation-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const id = form.elements.reservationId.value;
  const payload = {
    itemId:form.elements.itemId.value,
    projectId:form.elements.projectId.value,
    projectEntryCollection:form.elements.projectEntryId.value ? 'tasks' : null,
    projectEntryId:form.elements.projectEntryId.value || null,
    note:form.elements.note.value,
  };
  const collection = form.elements.requestedQuantity.disabled;
  if (!collection) payload.requestedQuantity = form.elements.requestedQuantity.value;
  try {
    await api(id ? `/reservations/${encodeURIComponent(id)}` : '/reservations', { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#reservation-dialog').close();
    toast(collection
      ? (id ? 'Projektbuchung aktualisiert.' : 'Lose Sammlung auf Projekt gebucht.')
      : (id ? 'Reservierung aktualisiert.' : 'Material reserviert.'));
    await route();
  } catch (error) { $('#reservation-error').textContent = error.message; }
};
$('#reservation-fulfill-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  try {
    await api(`/reservations/${encodeURIComponent(form.elements.reservationId.value)}/fulfill`, { method:'POST', body:JSON.stringify({
      sourceStorageLocationId:form.elements.sourceStorageLocationId.value,
      quantity:form.elements.quantity.value,
      note:form.elements.note.value,
    }) });
    $('#reservation-fulfill-dialog').close();
    toast('Material entnommen und Projektbedarf aktualisiert.');
    await route();
  } catch (error) { $('#reservation-fulfill-error').textContent = error.message; }
};
$('#reservation-fulfill-form').elements.sourceStorageLocationId.onchange = syncReservationFulfillLimit;
const sidebarSearchInput = $('#global-search-input');
const sidebarSearchClear = $('.sidebar-search-clear');
function syncSidebarSearchClear() {
  sidebarSearchClear.hidden = !sidebarSearchInput.value;
}
sidebarSearchInput.oninput = syncSidebarSearchClear;
sidebarSearchClear.onclick = () => {
  sidebarSearchInput.value = '';
  syncSidebarSearchClear();
  sidebarSearchInput.focus();
};
$('#settings-toggle').onclick = () => {
  if ($('#settings-toggle').getAttribute('aria-expanded') === 'true') return;
  setProjectsMenu(false);
  setInventoryMenu(false);
  if (location.hash !== '#/settings/general') {
    setSettingsMenu(true);
    location.href = '/#/settings/general';
    return;
  }
  setSettingsMenu(true);
};
$('#projects-toggle').onclick = async () => {
  if ($('#projects-toggle').getAttribute('aria-expanded') === 'true') return;
  setSettingsMenu(false);
  setInventoryMenu(false);
  if (location.hash !== '#/projects') {
    setProjectsMenu(true);
    location.href = '/#/projects';
    return;
  }
  try { await loadProjects(); } catch (error) { toast(error.message); }
  setProjectsMenu(true, currentProjectMenuStatus());
};
$('#inventory-toggle').onclick = () => {
  if ($('#inventory-toggle').getAttribute('aria-expanded') === 'true') return;
  setProjectsMenu(false);
  setSettingsMenu(false);
  if (!location.hash.startsWith('#/inventory')) {
    setInventoryMenu(true, 'locations');
    location.href = '/#/inventory';
    return;
  }
  setInventoryMenu(true, currentInventoryMenuRoute());
};
$('#menu-button').onclick = () => {
  const open = $('.sidebar').classList.toggle('open');
  $('#menu-button').setAttribute('aria-expanded', String(open));
  $('#menu-button').setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
};
document.querySelectorAll('dialog button[value="cancel"]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  const dialog = button.closest('dialog');
  if (dialog.dataset.updating !== 'true') dialog.close();
}));
window.addEventListener('hashchange', () => {
  $('.sidebar').classList.remove('open');
  $('#menu-button').setAttribute('aria-expanded', 'false');
  $('#menu-button').setAttribute('aria-label', 'Menü öffnen');
  route();
});
window.addEventListener('resize', fitInventoryWorkspaces);
document.addEventListener('click', event => {
  const removeAttachment = event.target.closest('[data-remove-dialog-attachment]');
  if (removeAttachment) removeDialogAttachment(removeAttachment);
  document.querySelectorAll('.action-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.removeAttribute('open'); });
  document.querySelectorAll('[data-filter-control]').forEach(control => {
    if (control.contains(event.target)) return;
    const panel = control.querySelector('.tag-filter-panel');
    const toggle = control.querySelector('[data-toggle-filter]');
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('[data-sort-control]').forEach(control => {
    if (control.contains(event.target)) return;
    const panel = control.querySelector('.project-sort-panel');
    const toggle = control.querySelector('[data-toggle-sort]');
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
});

api('/me').then(user => { state.user = user; showApp(); }).catch(() => {});
