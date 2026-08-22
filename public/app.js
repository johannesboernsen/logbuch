const $ = (selector, root = document) => root.querySelector(selector);
const state = { user: null, users: [], sessions: [], audit: [], tags: [], folders: [], iconLibrary:null, currentFolderId:null, projectStatusFilter:'all', server: null, system: null, update:null, projects: [], current: null, activeTab: 'entries', activeSettings:'general', activityObserver:null, timelineObserver:null, overviewGridObservers:[], projectSort: { field:'status', direction:'asc' }, archiveSort: { field:'createdAt', direction:'desc' }, projectSearch: { active:'', archived:'' }, projectTagFilter:{ active:{ ids:[], mode:'all' }, archived:{ ids:[], mode:'all' } }, projectDialogTagIds:[], projectTagDraftOpen:false, projectTagSearchOpen:false, collapsedLogSections:{ tasks:false, entries:false } };
let iconLibraryPromise = null;
const api = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const csrf = !['GET','HEAD'].includes(method) && state.user?.csrfToken ? { 'X-Logbuch-CSRF': state.user.csrfToken } : {};
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...csrf, ...(options.headers || {}) } });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Etwas ist schiefgegangen');
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
const workStepCount = (count, completed = false) => {
  if (count === 0) return completed ? 'Keine erledigten Arbeitsschritte' : 'Keine anstehenden Arbeitsschritte';
  if (count === 1) return completed ? 'Ein erledigter Arbeitsschritt' : 'Ein anstehender Arbeitsschritt';
  const value = count < 10 ? countWords[count][0].toUpperCase() + countWords[count].slice(1) : String(count);
  return `${value} ${completed ? 'erledigte' : 'anstehende'} Arbeitsschritte`;
};
const itemCount = (collection, count) => {
  const config = sections[collection];
  if (count === 0) return `Keine ${config.plural}`;
  if (count === 1) return `${['ideas','learnings','notes'].includes(collection) ? 'Eine' : 'Ein'} ${config.singular}`;
  const value = count < 10 ? countWords[count][0].toUpperCase() + countWords[count].slice(1) : String(count);
  return `${value} ${config.plural}`;
};
const regularProjectStatuses = ['active','paused','completed'];
const projectStatusLabels = { active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen', archived:'Archiviert', trashed:'Papierkorb' };
const projectPriority = project => ['Hoch','Mittel','Gering'].includes(project?.priority) ? project.priority : 'Mittel';
const projectPriorityMarkup = project => `<span class="project-priority ${projectPriority(project).toLocaleLowerCase('de')}">${escapeHtml(projectPriority(project))}</span>`;
const projectStatusControl = project => mayEditProjects()
  ? `<select class="project-inline-select project-status ${escapeHtml(project.status)}" data-project-inline-status="${escapeHtml(project.id)}" aria-label="Status von ${escapeHtml(project.title)} ändern">${['active','paused','completed','archived'].map(status => `<option value="${status}"${project.status === status ? ' selected' : ''}>${projectStatusLabels[status]}</option>`).join('')}</select>`
  : `<span class="project-status ${escapeHtml(project.status)}">${escapeHtml(projectStatusLabels[project.status] || project.status)}</span>`;
const projectPriorityControl = project => mayEditProjects()
  ? `<select class="project-inline-select project-priority ${projectPriority(project).toLocaleLowerCase('de')}" data-project-inline-priority="${escapeHtml(project.id)}" aria-label="Priorität von ${escapeHtml(project.title)} ändern">${['Hoch','Mittel','Gering'].map(priority => `<option value="${priority}"${projectPriority(project) === priority ? ' selected' : ''}>${priority}</option>`).join('')}</select>`
  : projectPriorityMarkup(project);
const projectFlagIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 21V4"></path><path d="M6 5h10l-2 3 2 3H6Z"></path></svg>';
const editIcon = () => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.9.5l-2.9.9a.5.5 0 0 1-.6-.6l.9-2.9a2 2 0 0 1 .5-.9Z"></path></svg>';
const projectEditButton = project => mayEditProjects() ? `<button class="edit-action" type="button" data-edit-project="${escapeHtml(project.id)}" aria-label="Projekt bearbeiten" title="Projekt bearbeiten">${editIcon()}</button>` : '';
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
  $('#device-host').textContent = location.host;
  document.querySelectorAll('[data-admin-setting]').forEach(node => node.hidden = !state.user.admin);
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

function updateProjectMenuCounts() {
  const counts = state.projects.reduce((result, project) => {
    if (Object.hasOwn(result, project.status)) result[project.status] += 1;
    return result;
  }, { active:0, paused:0, completed:0, archived:0, trashed:0 });
  counts.all = counts.active + counts.paused + counts.completed;
  document.querySelectorAll('[data-project-count]').forEach(node => { node.textContent = counts[node.dataset.projectCount] ?? 0; });
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
  return `<article class="project-card" data-project-card data-project-tags="${escapeHtml((project.tagIds || []).join(','))}" data-project-search="${escapeHtml(searchText)}">
    <a class="project-card-content" href="/#/projects/${encodeURIComponent(project.id)}"><div class="entity-card-lead"><span class="project-entity-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><span class="entity-card-copy"><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p></span></div><div class="project-next-step"><small>Nächste anstehende Schritte</small>${nextSteps.length ? `<ul class="project-next-steps">${nextSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>` : '<strong>Kein nächster Schritt hinterlegt</strong>'}</div></a>
    <aside class="project-card-status" aria-label="Projektstatus"><div class="project-card-actions">${projectCardActions(project)}</div><div class="project-status-row"><small>Status</small>${projectStatusControl(project)}</div><div class="project-status-row"><small>Priorität</small>${projectPriorityControl(project)}</div><div class="project-status-row"><small>Fälligkeit</small><span class="project-status-value">${project.dueDate ? formatDate(project.dueDate) : 'ohne'}</span></div>${folderPath ? `<div class="project-status-row project-status-folder"><small>Ordner</small><a href="${folderHref(project.folderId)}" title="Ordner öffnen">${escapeHtml(folderPath)}</a></div>` : ''}<div class="project-status-row project-status-tags"><small>Tags</small>${tagChips(project.tagIds, { archived }) || '<span class="project-status-empty">Keine</span>'}</div></aside>
  </article>`;
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
      const statusOrder = { active:0, paused:1, completed:2, archived:3, trashed:4 };
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
  ...(includeStatus ? [['status:asc','Status · Aktiv → Pausiert → Abgeschlossen']] : []),
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
  const createControl = !archived && mayEditProjects() ? `<details class="action-menu project-create-control"><summary class="project-tool-toggle project-create-toggle" aria-label="Projekt oder Ordner anlegen" title="Projekt oder Ordner anlegen">+</summary><div class="action-menu-panel project-create-panel"><button class="menu-item" type="button" data-new-project>Projekt anlegen</button><button class="menu-item" type="button" data-new-folder>Ordner anlegen</button></div></details>` : '';
  const foldersVisible = state.user.showProjectFolders !== false;
  const folderToggle = !archived ? `<button class="project-tool-toggle project-folder-toggle" type="button" data-toggle-folders aria-pressed="${!foldersVisible}" aria-label="${foldersVisible ? 'Ordner ausblenden' : 'Ordner einblenden'}" title="${foldersVisible ? 'Ordner ausblenden' : 'Ordner einblenden'}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z"></path><path d="M3.5 9h17"></path></svg></button>` : '';
  return `<div class="project-list-controls">
    <div class="project-compact-control${searchOpen ? ' open has-value' : ''}" data-search-control><button class="project-tool-toggle" type="button" data-toggle-search aria-label="Suche öffnen" aria-expanded="${searchOpen}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.8"></circle><path d="m15 15 4.5 4.5"></path></svg></button><input id="project-search" class="project-search" type="search" value="${escapeHtml(search)}" placeholder="${archived ? 'Archiv durchsuchen' : 'Projekte durchsuchen'}" aria-label="${archived ? 'Archivierte Projekte durchsuchen' : 'Projekte durchsuchen'}" autocomplete="off"></div>
    ${folderToggle}
    <div class="project-sort-control" data-sort-control><button class="project-tool-toggle" type="button" data-toggle-sort aria-label="Sortierung öffnen" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4m-3.5 12.5L16 20l3.5-3.5"></path></svg></button>${projectSortControls(archived ? state.archiveSort : state.projectSort, !archived)}</div>
    <div class="project-filter-control${filter.ids.length ? ' has-value' : ''}" data-filter-control><button class="project-tool-toggle" type="button" data-toggle-filter aria-label="Nach Tags filtern" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16l-6.2 7v5l-3.6 1.8V13L4 6Z"></path></svg>${filter.ids.length ? `<b>${filter.ids.length}</b>` : ''}</button><div class="tag-filter-panel" hidden><div class="tag-filter-head"><strong>Nach Tags filtern</strong>${filter.ids.length ? '<button type="button" data-clear-tag-filter>Zurücksetzen</button>' : ''}</div>${availableTags.length ? `<div class="tag-filter-options">${availableTags.map(tag => `<label><input type="checkbox" value="${escapeHtml(tag.id)}" ${filter.ids.includes(tag.id) ? 'checked' : ''}><span>${escapeHtml(tag.name)}</span><small>${tag.viewProjectCount}</small></label>`).join('')}</div><label class="tag-filter-mode">Verknüpfung<select data-tag-filter-mode><option value="all" ${filter.mode === 'all' ? 'selected' : ''}>Alle ausgewählten Tags</option><option value="any" ${filter.mode === 'any' ? 'selected' : ''}>Mindestens ein Tag</option></select></label>` : '<p class="tag-filter-empty">Für diese Projekte sind noch keine Tags vergeben.</p>'}</div></div>
    ${createControl}
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
  let visible = 0;
  document.querySelectorAll('[data-project-card]').forEach(card => {
    const cardTags = new Set((card.dataset.projectTags || '').split(',').filter(Boolean));
    const tagMatches = !filter.ids.length || (filter.mode === 'any' ? filter.ids.some(id => cardTags.has(id)) : filter.ids.every(id => cardTags.has(id)));
    const matches = (!query || card.dataset.projectSearch.includes(query)) && tagMatches;
    card.classList.toggle('hidden', !matches);
    if (matches) visible += 1;
  });
  const filtering = Boolean(query || filter.ids.length);
  const noResults = $('#project-no-results');
  if (noResults) noResults.classList.toggle('hidden', !filtering || visible > 0);
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

function overviewMenuContent() {
  const checked = key => state.user[key] !== false ? ' checked' : '';
  const rowControl = (setting, label, selected) => `<details class="overview-row-select"><summary aria-label="Zeilen ${escapeHtml(label)}">${selected} ${selected === 1 ? 'Zeile' : 'Zeilen'}</summary><div class="overview-row-options" role="menu" aria-label="Zeilen ${escapeHtml(label)}">${Array.from({ length:6 }, (_, index) => index + 1).map(rows => `<button type="button" role="menuitemradio" aria-checked="${rows === selected ? 'true' : 'false'}" data-overview-row-setting="${setting}" data-overview-row-value="${rows}">${rows} ${rows === 1 ? 'Zeile' : 'Zeilen'}</button>`).join('')}</div></details>`;
  const rows = currentOverviewOrder().map(section => {
    const config = overviewSectionConfig[section];
    const select = config.rows ? rowControl(config.rows, config.label, Math.min(6, Math.max(1, Number(state.user[config.rows]) || config.fallbackRows))) : '';
    return `<div class="overview-config-row" data-reorder-card data-reorder-id="${section}"><label><input type="checkbox" data-overview-setting="${config.flag}"${checked(config.flag)}><span>${escapeHtml(config.label)}</span></label>${select}${overviewOrderHandle(config.label)}</div>`;
  }).join('');
  return `<details class="action-menu overview-config-menu"><summary aria-label="Übersicht konfigurieren" title="Übersicht konfigurieren">☰</summary><div class="action-menu-panel overview-config-panel"><strong>Übersicht konfigurieren</strong><div class="overview-config-list" data-reorder-list="overview">${rows}</div></div></details>`;
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
      statCard('active-projects', 'Aktive Projekte', activeProjects.length, 'aktuell in Arbeit', 'Gezählt werden alle Projekte mit dem Status „Aktiv“. Pausierte, abgeschlossene, archivierte und gelöschte Projekte bleiben unberücksichtigt. Die Zahl zeigt, wie viele Vorhaben gleichzeitig Aufmerksamkeit benötigen.'),
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
  $('#main').innerHTML = `<header class="page-head overview-head"><div><h1>Übersicht</h1></div>${overviewMenuContent()}</header>${currentOverviewOrder().map(section => sectionMarkup[section] || '').join('')}`;
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
  if (keepMenuOpen) $('.overview-config-menu').open = true;
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
  const title = { all:'Alle', active:'Aktiv', paused:'Pausiert', completed:'Abgeschlossen' }[state.projectStatusFilter] || 'Alle';
  $('#main').innerHTML = `${folderBreadcrumbs(state.currentFolderId)}<header class="page-head project-browser-head"><div><h1>${escapeHtml(title)}</h1>${currentFolder?.description ? `<p>${escapeHtml(currentFolder.description)}</p>` : ''}</div><div class="page-actions">${projectListControls(false, projects)}</div></header><div id="active-tag-filters">${selectedTagFiltersMarkup(false)}</div>
    ${folders.length ? `<section class="folder-section"><div class="folder-grid">${folders.map(folderCard).join('')}</div></section>` : ''}
    ${projects.length ? `<div class="project-grid project-list">${projects.map(project => projectCard(project, false, !showFolders)).join('')}</div><div id="project-no-results" class="empty hidden"><strong>Keine passenden Projekte gefunden.</strong>Versuche einen anderen Suchbegriff.</div>` : (!folders.length ? `<div class="empty"><strong>${currentFolder ? 'Dieser Ordner enthält keine passenden Projekte.' : state.projectStatusFilter === 'paused' ? 'Keine pausierten Projekte vorhanden.' : state.projectStatusFilter === 'completed' ? 'Noch keine abgeschlossenen Projekte vorhanden.' : state.projectStatusFilter === 'active' ? 'Keine aktiven Projekte vorhanden.' : 'Noch keine Projekte vorhanden.'}</strong></div>` : '')}`;
  bindNewProject();
  bindFolderActions();
  bindProjectListControls(false);
  bindTagFilterSummary();
  bindProjectActions();
}

async function renderArchive() {
  await loadProjectBrowser();
  const projects = sortedProjects(state.projects.filter(project => project.status === 'archived'), state.archiveSort);
  $('#main').innerHTML = `<header class="page-head project-browser-head"><div><h1>Archiv</h1></div><div class="page-actions">${projectListControls(true, projects)}</div></header><div id="active-tag-filters">${selectedTagFiltersMarkup(true)}</div>
    ${projects.length ? `<div class="project-grid project-list">${projects.map(project => projectCard(project, true)).join('')}</div><div id="project-no-results" class="empty hidden"><strong>Keine passenden Projekte gefunden.</strong>Versuche einen anderen Suchbegriff.</div>` : `<div class="empty"><strong>Das Archiv ist leer.</strong>Archivierte Projekte erscheinen hier und können jederzeit wiederhergestellt werden.</div>`}
    <aside class="archive-note"><p>Das Archiv dient dazu, deine Projektliste übersichtlich zu halten. Archivierte Projekte und ihre Logs bleiben erhalten, werden in der Aktivitätsanzeige und der Projekt-Timeline in der Übersicht jedoch nicht mehr berücksichtigt.</p></aside>`;
  bindProjectListControls(true);
  bindTagFilterSummary();
  bindProjectActions();
}

function trashProjectCard(project) {
  const deletedAt = Number(project.deletedAt) > 0 ? formatEpoch(project.deletedAt) : 'Unbekannt';
  const actions = mayEditProjects() ? `<details class="action-menu card-menu"><summary aria-label="Papierkorbaktionen">☰</summary><div class="action-menu-panel"><button class="menu-item" data-restore-project="${escapeHtml(project.id)}">Wiederherstellen</button><button class="menu-item danger" data-purge-project="${escapeHtml(project.id)}">Endgültig löschen</button></div></details>` : '';
  return `<article class="project-card trash-project-card" data-project-card>
    <div class="project-card-content"><div class="entity-card-lead"><span class="project-entity-icon" aria-hidden="true">${iconSvg(projectIconName(project))}</span><span class="entity-card-copy"><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || 'Noch keine Beschreibung hinterlegt.')}</p></span></div><div class="project-next-step trash-deleted-at"><small>In den Papierkorb verschoben</small><strong>${escapeHtml(deletedAt)}</strong></div></div>
    <aside class="project-card-status" aria-label="Papierkorbstatus"><div class="project-card-actions">${actions}</div><div class="project-status-row"><small>Status</small><span class="project-status trashed">Papierkorb</span></div><div class="project-status-row"><small>Priorität</small>${projectPriorityMarkup(project)}</div><div class="project-status-row project-status-tags"><small>Tags</small>${tagChips(project.tagIds, { linked:false }) || '<span class="project-status-empty">Keine</span>'}</div></aside>
  </article>`;
}

async function renderTrash() {
  await loadProjectBrowser();
  const projects = state.projects.filter(project => project.status === 'trashed').sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  const emptyButton = state.user.admin && projects.length ? '<button class="button danger" data-empty-trash>Papierkorb leeren</button>' : '';
  $('#main').innerHTML = `<header class="page-head"><div><h1>Papierkorb</h1></div>${emptyButton}</header>
    ${projects.length ? `<div class="project-grid project-list">${projects.map(trashProjectCard).join('')}</div>` : '<div class="empty"><strong>Der Papierkorb ist leer.</strong>Gelöschte Projekte erscheinen hier, bevor sie endgültig entfernt werden.</div>'}`;
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
const backupCollections = ['entries','tasks','materials','contacts','links','ideas','learnings','notes'];

function tagSettingsContent() {
  const tags = [...state.tags].sort((a,b) => a.name.localeCompare(b.name, 'de', { sensitivity:'base' }));
  return `<div class="settings-group tag-settings"><div class="setting-list tag-management-list">${tags.length ? tags.map(tag => {
    const active = Number(tag.activeProjectCount || 0), archived = Number(tag.archivedProjectCount || 0);
    return `<div class="setting-row tag-management-row"><a class="tag-management-link" href="${tagLink(tag)}"><strong>${escapeHtml(tag.name)}</strong><p>${active} ${active === 1 ? 'Projekt' : 'Projekte'} · ${archived} ${archived === 1 ? 'archiviertes Projekt' : 'archivierte Projekte'}</p></a><div class="tag-management-actions"><details class="action-menu"><summary aria-label="Tagaktionen">☰</summary><div class="action-menu-panel"><button class="menu-item" data-edit-tag="${escapeHtml(tag.id)}">Umbenennen</button>${tags.length > 1 ? `<button class="menu-item" data-merge-tag="${escapeHtml(tag.id)}">Zusammenführen</button>` : ''}<button class="menu-item danger" data-delete-tag="${escapeHtml(tag.id)}">Löschen</button></div></details></div></div>`;
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
  return `<div class="settings-group data-settings">
    <section class="backup-area"><div class="backup-area-head"><div><h2>Backup herunterladen</h2><p>Projektdaten und Benutzerkonten getrennt als Archiv herunterladen.</p></div></div><div class="backup-export-grid">
      <article class="backup-card"><div><h3>Projekte herunterladen</h3><p>${projectCount} ${projectCount === 1 ? 'Projekt' : 'Projekte'} mit Logbucheinträgen, Material, Kontakten, Links und Ideen. Markdown und JSON bleiben offen lesbar; stabile IDs erhalten bestehende NFC-Links.</p></div><button class="button primary" data-export-projects>Projektdaten herunterladen</button></article>
      <article class="backup-card sensitive-backup"><div><h3>Benutzer herunterladen</h3><p>${userCount} ${userCount === 1 ? 'Benutzerkonto' : 'Benutzerkonten'} mit Rollen, Status, Projektfreigaben und Passwort-Hashes. Klartextpasswörter und aktive Sitzungen werden nicht exportiert.</p><small>Dieses Archiv ist sicherheitskritisch. Bewahre es geschützt auf.</small></div><button class="button primary" data-export-users>Benutzerkonten herunterladen</button></article>
    </div></section>
    <section class="backup-area"><div class="backup-area-head"><div><h2>Backup einspielen</h2><p>Ein vorhandenes Projekt- oder Benutzerarchiv prüfen und wiederherstellen.</p></div></div><div class="backup-import-grid">
      <article class="backup-card backup-import-card"><div><h3>Projektarchiv einspielen</h3></div><div class="backup-restore-form"><label>Projektarchiv<input id="project-backup-file" type="file" accept=".tar,application/x-tar"></label><label>Bei vorhandenen Projekten<select id="project-backup-conflict"><option value="skip">Vorhandenes Projekt überspringen</option><option value="replace">Vorhandenes Projekt ersetzen</option></select></label><div id="project-backup-preview" class="backup-preview">Noch kein Projektarchiv ausgewählt.</div><button class="button secondary" data-import-projects disabled>Projektdaten einspielen</button></div></article>
      <article class="backup-card backup-import-card sensitive-backup"><div><h3>Benutzerarchiv einspielen</h3></div><div class="backup-restore-form"><label>Benutzerarchiv<input id="user-backup-file" type="file" accept=".tar,application/x-tar"></label><label>Bei vorhandenen Benutzern<select id="user-backup-conflict"><option value="skip">Vorhandenen Benutzer überspringen</option><option value="replace">Vorhandenen Benutzer ersetzen</option></select></label><div id="user-backup-preview" class="backup-preview">Noch kein Benutzerarchiv ausgewählt.</div><button class="button secondary" data-import-users disabled>Benutzerkonten einspielen</button></div></article>
    </div></section>
  </div>`;
}

function userRow(user) {
  const ownAccount = user.id === state.user.id;
  const projectCount = user.projectIds?.length || 0;
  const projects = user.role === 'admin' || user.projectAccessMode === 'all' ? 'Alle Projekte' : user.projectAccessMode === 'exclude' ? (projectCount ? `Alle außer ${projectCount}` : 'Alle Projekte') : `${projectCount} ${projectCount === 1 ? 'Projekt' : 'Projekte'}`;
  const actions = `<details class="action-menu user-menu"><summary aria-label="Benutzeraktionen">☰</summary><div class="action-menu-panel"><button class="menu-item" data-edit-user="${escapeHtml(user.id)}">Bearbeiten</button>${ownAccount ? '' : `<button class="menu-item" data-toggle-user="${escapeHtml(user.id)}" data-active="${user.active ? 'false' : 'true'}">${user.active ? 'Deaktivieren' : 'Aktivieren'}</button><button class="menu-item danger" data-delete-user="${escapeHtml(user.id)}">Löschen</button>`}</div></details>`;
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
const auditLabel = action => ({ 'user.created':'Benutzer angelegt', 'user.updated':'Benutzer geändert', 'user.deleted':'Benutzer gelöscht', 'password.changed':'Passwort geändert', 'session.revoked':'Sitzung beendet', 'log.created':'Log angelegt', 'log.updated':'Log bearbeitet', 'log.deleted':'Log gelöscht', 'tag.created':'Tag angelegt', 'tag.updated':'Tag geändert', 'tag.merged':'Tags zusammengeführt', 'tag.deleted':'Tag gelöscht', 'data.project_imported':'Projekt aus Backup importiert', 'data.users_exported':'Benutzerkonten exportiert', 'data.users_imported':'Benutzerkonten importiert', 'server.settings_updated':'Servereinstellungen geändert', 'system.update_requested':'Logbuch-Update angefordert', 'system.content_cleared':'Alle Projektinhalte gelöscht', 'system.users_cleared':'Benutzerkonten zurückgesetzt', 'demo.installed':'Beispieldaten eingespielt', 'demo.removed':'Beispieldaten entfernt' }[action] || action);

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
  const releaseLink = update.releaseNotesUrl ? `<a href="${escapeHtml(update.releaseNotesUrl)}" target="_blank" rel="noopener">Release Notes ansehen</a>` : '';
  const install = update.available ? `<button class="button primary" data-install-update ${update.installSupported ? '' : 'disabled'}>Update installieren</button>` : '';
  const reason = update.available && !update.installSupported && update.installReason ? `<small>${escapeHtml(update.installReason)}</small>` : '';
  return `<section class="update-card"><div class="update-card-copy"><div class="update-card-title"><h2>${title}</h2><span class="setting-status ${statusClass}">${status}</span></div><p>${copy}</p><div class="update-card-meta">${releaseLink}${update.checkedAt ? `<span>Geprüft: ${escapeHtml(formatDateTime(update.checkedAt))}</span>` : ''}</div>${reason}</div><div class="update-card-actions"><button class="button secondary" data-check-update>Neu prüfen</button>${install}</div></section>`;
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
    <div class="danger-row"><div><strong>Alle Inhalte löschen</strong><p>Löscht sämtliche aktiven und archivierten Projekte einschließlich Logs, Materialien, Kontakte, Links und Ideen. Benutzerkonten bleiben erhalten.</p></div><button class="button danger-button" data-clear-content>Alle Inhalte löschen</button></div>
    <div class="danger-row"><div><strong>Benutzerkonten zurücksetzen</strong><p>Löscht alle Benutzerkonten und deren Sitzungen. Der aktuell angemeldete Administrator bleibt erhalten.</p></div><button class="button danger-button" data-clear-users>Andere Benutzer löschen</button></div>
    <div class="danger-row demo-row"><div><strong>Beispieldaten einspielen</strong><p>Spielt elf Maker-Projekte und zwei thematische Ordner ein oder setzt sie auf den Lieferzustand zurück. Eigene Inhalte bleiben erhalten.</p></div><button class="button secondary" data-load-demo>${system.demoProjectCount || system.demoFolderCount ? 'Beispieldaten zurücksetzen' : 'Beispieldaten einspielen'}</button></div>
    <div class="danger-row demo-row"><div><strong>Beispieldaten entfernen</strong><p>Löscht die mitgelieferten Demo-Projekte. Demo-Ordner werden nur gelöscht, wenn keine eigenen Projekte oder Unterordner darin liegen. Inhalte innerhalb eines Demo-Projekts werden mitgelöscht.</p></div><button class="button danger-button" data-remove-demo ${system.demoProjectCount || system.demoFolderCount ? '' : 'disabled'}>Beispieldaten entfernen</button></div>
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
  const badge = $('#update-badge');
  if (!badge) return;
  badge.hidden = !state.update?.available;
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
  if (active === 'data' && state.user?.admin) await Promise.all([loadUsers(), loadProjects(), loadTags()]);
  if (active === 'profile') await loadProjects();
  if (active === 'security' && !state.user.mustChangePassword) await loadSessions();
  if (active === 'audit' && state.user?.admin) await loadAudit();
  if (active === 'server' && state.user?.admin) await loadServerSettings();
  if (active === 'system' && state.user?.admin) await loadSystemStatus();
  if (active === 'general') await loadIconLibrary();
  const headerAction = active === 'users' && state.user?.admin ? '<button class="button primary compact" data-new-user>+ Benutzer</button>' : active === 'tags' && state.user?.admin ? '<button class="button primary compact" data-new-tag>+ Tag</button>' : '';
  $('#main').innerHTML = `<header class="page-head settings-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${headerAction}</header><section class="settings-panel settings-panel-wide">${settingsContent(active)}</section>`;
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

const tarEncoder = new TextEncoder();
const tarDecoder = new TextDecoder();
const markdownValue = value => String(value ?? '').replace(/\r\n/g, '\n');
const yamlValue = value => JSON.stringify(String(value ?? ''));

function projectMarkdown(project) {
  const tagNames = (project.tagIds || []).map(tagById).filter(Boolean).map(tag => `\n  - ${yamlValue(tag.name)}`).join('');
  return `---\nid: ${project.id}\ntitle: ${yamlValue(project.title)}\nstatus: ${project.status || 'active'}\npriority: ${yamlValue(projectPriority(project))}\nflagged: ${project.flagged === true}\nicon: ${yamlValue(entityIconName(project, 'box'))}\niconInherited: ${projectUsesDefaultIcon(project)}\ncreatedAt: ${yamlValue(project.createdAt)}\ndueDate: ${yamlValue(project.dueDate || '')}\ntags:${tagNames}\n---\n\n${markdownValue(project.description)}\n`;
}

function entryMarkdown(entry) {
  const sourceTask = entry.sourceTaskId ? `\nsourceTaskId: ${yamlValue(entry.sourceTaskId)}` : '';
  const sortOrder = Number.isInteger(entry.sortOrder) ? `\nsortOrder: ${entry.sortOrder}` : '';
  return `---\nid: ${entry.id}\ndate: ${yamlValue(entry.date)}\ntitle: ${yamlValue(entry.title)}\nauthor: ${yamlValue(entry.author)}${sourceTask}${sortOrder}\n---\n\n## Gemacht\n\n${markdownValue(entry.body)}\n`;
}

function itemMarkdown(collection, item) {
  const labels = { name:'Bezeichnung', title:'Titel', quantity:'Menge', status:'Status', priority:'Priorität', dueDate:'Fällig am', completedAt:'Erledigt am', completedEntryId:'Erledigter Arbeitsschritt', price:'Preis', url:'Link', properties:'Eigenschaften', role:'Rolle', company:'Firma oder Organisation', email:'E-Mail', phone:'Telefon', notes:'Notizen', description:'Beschreibung' };
  const fields = Object.keys(labels).filter(field => item[field]);
  const sortOrder = Number.isInteger(item.sortOrder) ? `\nsortOrder: ${item.sortOrder}` : '';
  return `---\nid: ${item.id}\ntype: ${collection}\ncreatedAt: ${yamlValue(item.createdAt)}\nauthor: ${yamlValue(item.author)}${sortOrder}\n---\n${fields.map(field => `\n## ${labels[field]}\n\n${markdownValue(item[field])}\n`).join('')}`;
}

function tarHeader(name, size) {
  const header = new Uint8Array(512);
  const write = (offset, length, value) => header.set(tarEncoder.encode(String(value)).slice(0, length), offset);
  const octal = (offset, length, value) => write(offset, length, Math.floor(value).toString(8).padStart(length - 1, '0') + '\0');
  write(0, 100, name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, size); octal(136, 12, Date.now() / 1000);
  header.fill(32, 148, 156); header[156] = 48; write(257, 6, 'ustar\0'); write(263, 2, '00');
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
  write(148, 8, `${checksum}\0 `);
  return header;
}

function createTar(files) {
  const chunks = [];
  for (const [name, content] of files) {
    const data = tarEncoder.encode(content);
    chunks.push(tarHeader(name, data.length), data);
    const padding = (512 - data.length % 512) % 512;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  return new Blob(chunks, { type:'application/x-tar' });
}

function parseTar(buffer) {
  const bytes = new Uint8Array(buffer);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, length) => tarDecoder.decode(header.slice(start, start + length)).replace(/\0.*$/, '').trim();
    const name = text(0, 100);
    const size = Number.parseInt(text(124, 12) || '0', 8);
    if (!name || !Number.isFinite(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error('Das TAR-Archiv ist beschädigt');
    files.set(name, tarDecoder.decode(bytes.slice(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function validateProjectBackup(manifest) {
  if (!['logbuch-projects','logbuch-backup'].includes(manifest?.format) || manifest.version !== 1 || !Array.isArray(manifest.projects)) throw new Error('Kein unterstütztes Logbuch-Projektarchiv');
  for (const project of manifest.projects) {
    if (!project?.id || !project?.title || !Array.isArray(project.entries)) throw new Error('Das Backup enthält unvollständige Projektdaten');
    for (const collection of backupCollections) {
      if (['tasks','learnings','notes'].includes(collection) && !Array.isArray(project[collection])) project[collection] = [];
      if (!Array.isArray(project[collection])) throw new Error(`Der Bereich „${collection}“ fehlt im Backup`);
    }
  }
  if (manifest.tags != null && !Array.isArray(manifest.tags)) throw new Error('Die Tag-Definitionen im Backup sind ungültig');
  manifest.tags ||= [];
  return manifest;
}

function validateUserBackup(manifest) {
  if (manifest?.format !== 'logbuch-users' || manifest.version !== 1 || !Array.isArray(manifest.accounts)) throw new Error('Kein unterstütztes Logbuch-Benutzerarchiv');
  for (const account of manifest.accounts) {
    const phpBackup = account?.passwordAlgorithm === 'php-password-hash' && account?.passwordHash;
    const legacyBackup = account?.passwordHash && account?.salt;
    if (!account?.id || !account?.name || (!phpBackup && !legacyBackup)) throw new Error('Das Archiv enthält unvollständige Benutzerkonten');
  }
  return manifest;
}

async function buildProjectBackup() {
  const fullProjects = await Promise.all(state.projects.map(project => api(`/projects/${encodeURIComponent(project.id)}`)));
  const metadataUsers = state.users.map(({ id, name, role, active, projectAccessMode, projectIds }) => ({ id, name, role, active, projectAccessMode, projectIds }));
  const projects = fullProjects.map(project => ({ ...project, accessUsers:metadataUsers.filter(user => user.role !== 'admin' && user.projectIds?.includes(project.id)).map(user => user.id) }));
  const usedTagIds = new Set(projects.flatMap(project => project.tagIds || []));
  const tags = state.tags.filter(tag => usedTagIds.has(tag.id)).map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  const manifest = { format:'logbuch-projects', version:1, exportedAt:new Date().toISOString(), source:{ name:'Logbuch', host:location.host }, tags, projects };
  const files = [['manifest.json', JSON.stringify(manifest, null, 2)]];
  for (const project of projects) {
    const root = `projects/${project.id}`;
    files.push([`${root}/README.md`, projectMarkdown(project)], [`${root}/project.json`, JSON.stringify(project, null, 2)]);
    for (const entry of project.entries) files.push([`${root}/entries/${entry.id}.md`, entryMarkdown(entry)], [`${root}/entries/${entry.id}.json`, JSON.stringify(entry, null, 2)]);
    for (const collection of backupCollections.slice(1)) for (const item of project[collection]) files.push([`${root}/${collection}/${item.id}.md`, itemMarkdown(collection, item)], [`${root}/${collection}/${item.id}.json`, JSON.stringify(item, null, 2)]);
  }
  return createTar(files);
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

async function readBackupFile(file, validator, maxMegabytes = 25) {
  if (!file) return null;
  if (file.size > maxMegabytes * 1024 * 1024) throw new Error(`Das Archiv ist größer als ${maxMegabytes} MB`);
  const files = parseTar(await file.arrayBuffer());
  if (!files.has('manifest.json')) throw new Error('Im Archiv fehlt manifest.json');
  return validator(JSON.parse(files.get('manifest.json')));
}

function bindDataActions() {
  let selectedProjects = null;
  let selectedUsers = null;
  const projectExport = $('[data-export-projects]');
  const userExport = $('[data-export-users]');
  const projectImport = $('[data-import-projects]');
  const userImport = $('[data-import-users]');

  projectExport.onclick = async () => {
    projectExport.disabled = true; projectExport.textContent = 'Archiv wird erstellt …';
    try {
      downloadBlob(await buildProjectBackup(), `logbuch-projekte-${today()}.tar`); toast('Projektdaten wurden gesichert');
    } catch (error) { toast(error.message); }
    finally { projectExport.disabled = false; projectExport.textContent = 'Projektdaten herunterladen'; }
  };

  userExport.onclick = async () => {
    userExport.disabled = true; userExport.textContent = 'Archiv wird erstellt …';
    try {
      downloadBlob(await buildUserBackup(), `logbuch-benutzer-${today()}.tar`); toast('Benutzerkonten wurden gesichert');
    } catch (error) { toast(error.message); }
    finally { userExport.disabled = false; userExport.textContent = 'Benutzerkonten herunterladen'; }
  };

  $('#project-backup-file').onchange = async event => {
    selectedProjects = null; projectImport.disabled = true;
    const file = event.target.files?.[0]; const preview = $('#project-backup-preview');
    if (!file) { preview.textContent = 'Noch kein Projektarchiv ausgewählt.'; return; }
    try {
      selectedProjects = await readBackupFile(file, validateProjectBackup);
      const entries = selectedProjects.projects.reduce((sum, project) => sum + project.entries.length, 0);
      preview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${selectedProjects.projects.length} ${selectedProjects.projects.length === 1 ? 'Projekt' : 'Projekte'} · ${entries} ${entries === 1 ? 'erledigter Arbeitsschritt' : 'erledigte Arbeitsschritte'} · Export ${escapeHtml(formatDateTime(selectedProjects.exportedAt))}</span>`;
      projectImport.disabled = false;
    } catch (error) { preview.textContent = error.message; toast(error.message); }
  };

  $('#user-backup-file').onchange = async event => {
    selectedUsers = null; userImport.disabled = true;
    const file = event.target.files?.[0]; const preview = $('#user-backup-preview');
    if (!file) { preview.textContent = 'Noch kein Benutzerarchiv ausgewählt.'; return; }
    try {
      selectedUsers = await readBackupFile(file, validateUserBackup, 5);
      preview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${selectedUsers.accounts.length} ${selectedUsers.accounts.length === 1 ? 'Benutzerkonto' : 'Benutzerkonten'} · Export ${escapeHtml(formatDateTime(selectedUsers.exportedAt))}</span>`;
      userImport.disabled = false;
    } catch (error) { preview.textContent = error.message; toast(error.message); }
  };

  projectImport.onclick = async () => {
    if (!selectedProjects) return;
    const replace = $('#project-backup-conflict').value === 'replace';
    if (replace && !confirm('Vorhandene Projekte mit gleicher ID werden vollständig ersetzt. Fortfahren?')) return;
    projectImport.disabled = true; projectImport.textContent = 'Import läuft …';
    let imported = 0; let skipped = 0;
    try {
      for (const project of selectedProjects.projects) {
        const result = await api('/import/project', { method:'POST', body:JSON.stringify({ project, tags:selectedProjects.tags || [], accessUsers:project.accessUsers || [], replace }) });
        result.skipped ? skipped++ : imported++;
      }
      toast(`${imported} Projekte importiert${skipped ? `, ${skipped} übersprungen` : ''}`);
      await Promise.all([loadProjects(), loadUsers()]); renderSettings();
    } catch (error) { toast(`Import abgebrochen: ${error.message}`); projectImport.disabled = false; projectImport.textContent = 'Projektdaten einspielen'; }
  };

  userImport.onclick = async () => {
    if (!selectedUsers) return;
    const replace = $('#user-backup-conflict').value === 'replace';
    if (replace && !confirm('Vorhandene Benutzerkonten werden durch den Stand aus dem Archiv ersetzt. Fortfahren?')) return;
    userImport.disabled = true; userImport.textContent = 'Import läuft …';
    try {
      const result = await api('/import/users', { method:'POST', body:JSON.stringify({ accounts:selectedUsers.accounts, replace }) });
      toast(`${result.imported || 0} Benutzer importiert${result.skipped ? `, ${result.skipped} übersprungen` : ''}`);
      await loadUsers(); renderSettings();
    } catch (error) { toast(`Import abgebrochen: ${error.message}`); userImport.disabled = false; userImport.textContent = 'Benutzerkonten einspielen'; }
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

function entriesView(project) {
  if (!project.entries?.length) return `<div class="empty">Halte fest, was du an diesem Projekt gemacht hast.</div>`;
  const entries = orderedItems(project.entries, (a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return `<div class="timeline" data-reorder-list="entries">${entries.map(entry => {
    const body = entry.body ? `<div class="entry-body">${escapeHtml(entry.body)}</div>` : '';
    const empty = !body ? '<div class="entry-empty">Arbeitsschritt ohne zusätzliche Notiz</div>' : '';
    const editCard = mayEditProjects() ? ` data-edit-entry-card="${escapeHtml(entry.id)}" role="button" tabindex="0" aria-label="${escapeHtml(entryTitle(entry))} bearbeiten"` : '';
    const controls = mayEditProjects() ? `<div class="workstep-card-actions">${entryEditButton(entry.id)}<div class="workstep-action-group">${entryCopyButton(entry.id)}${reopenButton(entry.id)}${reorderHandle('entries', entry.id)}${entryDeleteButton(entry.id)}</div></div>` : '';
    return `<article class="entry workstep-card" id="${escapeHtml(entry.id)}" data-reorder-card data-reorder-id="${escapeHtml(entry.id)}"${editCard}><div class="workstep-card-content"><strong>${escapeHtml(entryTitle(entry))}</strong>${body}${empty}</div><aside class="workstep-card-status" aria-label="Attribute des erledigten Arbeitsschritts">${controls}<div class="project-status-row"><small>Status</small><span class="project-status completed">Erledigt</span></div><div class="project-status-row"><small>Erledigt am</small><span class="project-status-value">${formatDate(entry.date)}</span></div><div class="project-status-row"><small>Bearbeitet von</small><span class="project-status-value">${escapeHtml(entry.author)}</span></div></aside></article>`;
  }).join('')}</div>`;
}

function itemCard(collection, item) {
  const config = sections[collection];
  const title = item.name || item.title || config.singular;
  let meta = '';
  let description = '';
  if (collection === 'materials') meta = [item.quantity, item.status, item.price].filter(Boolean).map(escapeHtml).join(' · ');
  if (collection === 'contacts') meta = [item.role, item.company, item.email, item.phone].filter(Boolean).map(escapeHtml).join(' · ');
  if (collection === 'links') description = item.notes ? escapeHtml(item.notes) : '';
  if (collection === 'ideas') { meta = item.status ? escapeHtml(item.status) : ''; description = item.description ? escapeHtml(item.description) : ''; }
  if (['learnings','notes'].includes(collection)) description = item.description ? escapeHtml(item.description) : '';
  const url = item.url ? `<a class="item-link" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>` : '';
  const actions = mayEditProjects() ? `<div class="item-actions">${reorderHandle(collection, item.id)}<details class="action-menu"><summary aria-label="${config.singular}aktionen">☰</summary><div class="action-menu-panel"><button class="menu-item" data-edit-item="${collection}:${escapeHtml(item.id)}">Bearbeiten</button><button class="menu-item danger" data-delete-item="${collection}:${escapeHtml(item.id)}">Löschen</button></div></details></div>` : '';
  const editCard = mayEditProjects() ? ` data-edit-item-card="${collection}:${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="${escapeHtml(title)} bearbeiten"` : '';
  return `<article class="item-card" data-reorder-card data-reorder-id="${escapeHtml(item.id)}"${editCard}><div class="item-card-copy"><h3>${escapeHtml(title)}</h3>${meta ? `<small>${meta}</small>` : ''}${description ? `<p>${description}</p>` : ''}${item.futureUse && collection === 'learnings' ? `<p><strong>Für die Zukunft:</strong> ${escapeHtml(item.futureUse)}</p>` : ''}${url}${item.properties ? `<p>${escapeHtml(item.properties)}</p>` : ''}${item.notes && collection === 'contacts' ? `<p>${escapeHtml(item.notes)}</p>` : ''}</div>${actions}</article>`;
}

function itemsView(project, collection) {
  const config = sections[collection];
  const items = orderedItems(project[collection] || []);
  const heading = itemCount(collection, items.length);
  const addButton = mayEditProjects() ? `<button class="button primary compact" data-new-item="${collection}">${config.singular} hinzufügen</button>` : '';
  const content = items.length ? `<div class="item-grid" data-reorder-list="${collection}">${items.map(item => itemCard(collection, item)).join('')}</div>` : tabEmpty(config);
  return `<section class="project-item-section"><div class="section-head"><h2>${heading}</h2>${addButton}</div>${content}</section>`;
}

function taskCard(task) {
  const editCard = mayEditProjects() ? ` data-edit-item-card="tasks:${escapeHtml(task.id)}" role="button" tabindex="0" aria-label="${escapeHtml(task.title)} bearbeiten"` : '';
  const status = ['Offen','In Arbeit'].includes(task.status) ? task.status : 'Offen';
  const priority = ['Normal','Hoch','Niedrig'].includes(task.priority) ? task.priority : 'Normal';
  const statusClass = status === 'In Arbeit' ? 'in-progress' : 'open';
  const priorityClass = priority.toLocaleLowerCase('de');
  const statusControl = mayEditProjects() ? `<select class="project-inline-select project-status task-attribute-select task-status ${statusClass}" data-task-inline-status="${escapeHtml(task.id)}" aria-label="Status von ${escapeHtml(task.title)} ändern"><option${status === 'Offen' ? ' selected' : ''}>Offen</option><option${status === 'In Arbeit' ? ' selected' : ''}>In Arbeit</option></select>` : `<span class="project-status task-status ${statusClass}">${escapeHtml(status)}</span>`;
  const priorityControl = mayEditProjects() ? `<select class="project-inline-select project-priority task-attribute-select task-priority ${priorityClass}" data-task-inline-priority="${escapeHtml(task.id)}" aria-label="Priorität von ${escapeHtml(task.title)} ändern"><option${priority === 'Hoch' ? ' selected' : ''}>Hoch</option><option${priority === 'Normal' ? ' selected' : ''}>Normal</option><option${priority === 'Niedrig' ? ' selected' : ''}>Niedrig</option></select>` : `<span class="project-priority task-priority ${priorityClass}">${escapeHtml(priority)}</span>`;
  const controls = mayEditProjects() ? `<div class="workstep-card-actions">${itemEditButton('tasks', task.id)}<div class="workstep-action-group">${taskFlagControl(task)}${completeButton(task.id)}${reorderHandle('tasks', task.id)}${itemDeleteButton('tasks', task.id, 'Arbeitsschritt')}</div></div>` : task.flagged === true ? `<div class="workstep-card-actions"><span></span><div class="workstep-action-group">${taskFlagControl(task)}</div></div>` : '';
  return `<article class="task-card workstep-card" data-reorder-card data-reorder-id="${escapeHtml(task.id)}"${editCard}><div class="workstep-card-content"><h3>${escapeHtml(task.title)}</h3>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}</div><aside class="workstep-card-status" aria-label="Attribute des Arbeitsschritts">${controls}<div class="project-status-row"><small>Status</small>${statusControl}</div><div class="project-status-row"><small>Priorität</small>${priorityControl}</div><div class="project-status-row"><small>Fälligkeit</small><span class="project-status-value">${task.dueDate ? formatDate(task.dueDate) : 'ohne'}</span></div></aside></article>`;
}

function diaryView(project) {
  const tasks = orderedItems((project.tasks || []).filter(task => task.status !== 'Erledigt'), (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const entries = project.entries || [];
  const taskHeading = workStepCount(tasks.length);
  const entryHeading = workStepCount(entries.length, true);
  const sectionToggle = (section, label) => `<button class="section-toggle" type="button" data-toggle-log-section="${section}" aria-expanded="${!state.collapsedLogSections[section]}" aria-label="${label} ${state.collapsedLogSections[section] ? 'ausklappen' : 'einklappen'}" title="${state.collapsedLogSections[section] ? 'Ausklappen' : 'Einklappen'}"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5"></path></svg></button>`;
  const taskButton = mayEditProjects() ? '<button class="button primary compact" data-new-item="tasks">Arbeitsschritt hinzufügen</button>' : '';
  const entryButton = mayEditProjects() ? '<button class="button primary compact" data-new-entry>Erledigten Arbeitsschritt hinzufügen</button>' : '';
  return `<section class="next-steps-section"><div class="section-head"><h2>${taskHeading}</h2><div class="section-head-actions">${taskButton}${sectionToggle('tasks', taskHeading)}</div></div><div data-log-section-content="tasks"${state.collapsedLogSections.tasks ? ' hidden' : ''}>${tasks.length ? `<div class="next-steps-list" data-reorder-list="tasks">${tasks.map(taskCard).join('')}</div>` : '<div class="empty compact-empty">Füge einen Arbeitsschritt hinzu, wenn klar ist, wie es weitergeht.</div>'}</div></section><section class="diary-section"><div class="section-head"><h2>${entryHeading}</h2><div class="section-head-actions">${entryButton}${sectionToggle('entries', entryHeading)}</div></div><div data-log-section-content="entries"${state.collapsedLogSections.entries ? ' hidden' : ''}>${entriesView(project)}</div></section>`;
}

async function renderProject(id) {
  const [view] = await Promise.all([api(`/project-view/${encodeURIComponent(id)}`), loadIconLibrary().catch(() => null)]);
  state.current = view.project;
  state.tags = view.tags || [];
  state.folders = view.folders || [];
  const p = state.current;
  if (p.status === 'trashed') { location.href = '/#/trash'; return; }
  setProjectsMenu(true, p.status);
  if (state.activeTab === 'tasks') state.activeTab = 'entries';
  const openTaskCount = (p.tasks || []).filter(task => task.status !== 'Erledigt').length;
  const tabs = [
    ['entries','Logbuch',`${openTaskCount}/${(p.entries || []).length}`],
    ['notes','Notizen',(p.notes || []).length],
    ['materials','Material',(p.materials || []).length],
    ['contacts','Kontakte',(p.contacts || []).length],
    ['links','Links',(p.links || []).length],
    ['ideas','Ideen',(p.ideas || []).length],
    ['learnings','Erkenntnisse',(p.learnings || []).length]
  ];
  const content = state.activeTab === 'entries' ? diaryView(p) : itemsView(p, state.activeTab);
  const breadcrumbs = p.status === 'archived' ? '<nav class="folder-breadcrumbs" aria-label="Projektpfad"><a href="/#/archive">Archiviert</a></nav>' : folderBreadcrumbs(p.folderId || null);
  $('#main').innerHTML = `<div class="project-page-breadcrumbs">${breadcrumbs}</div><div class="project-page-head"><section class="project-hero"><div class="project-hero-layout"><div class="project-hero-main"><div class="project-heading-row"><span class="project-hero-icon" aria-hidden="true">${iconSvg(projectIconName(p))}</span><div class="project-heading-content"><div class="project-title-line"><h1>${escapeHtml(p.title)}</h1></div><p class="project-description">${escapeHtml(p.description || 'Noch keine Projektbeschreibung hinterlegt.')}</p></div></div></div><aside class="project-hero-status" aria-label="Projektstatus"><div class="project-hero-status-head"><span>Projektstatus</span><div class="project-hero-actions">${projectCardActions(p)}</div></div><div class="project-hero-facts"><div class="project-hero-fact"><small>Status</small>${projectStatusControl(p)}</div><div class="project-hero-fact"><small>Priorität</small>${projectPriorityControl(p)}</div><div class="project-hero-fact"><small>Fälligkeit</small><span class="project-status-value">${p.dueDate ? formatDate(p.dueDate) : 'ohne'}</span></div><div class="project-hero-fact project-hero-tags"><small>Tags</small>${tagChips(p.tagIds, { limit:20, archived:p.status === 'archived' }) || '<span class="project-status-empty">Keine</span>'}</div></div></aside></div><div class="project-subnav"><nav class="tabs" aria-label="Projektbereiche">${tabs.map(([id,label,count]) => `<button class="tab ${state.activeTab===id?'active':''}" data-tab="${id}"><span>${label}</span><span class="tab-count">(${count})</span></button>`).join('')}</nav></div></section></div><section class="project-page-content">${content}</section>`;
  const newEntryButton = $('[data-new-entry]');
  if (newEntryButton) newEntryButton.onclick = () => openEntryDialog(p.id);
  const newItemButton = $('[data-new-item]');
  if (newItemButton) newItemButton.onclick = () => openItemDialog(p.id, newItemButton.dataset.newItem);
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { state.activeTab = button.dataset.tab; renderProject(p.id); });
  document.querySelectorAll('[data-toggle-log-section]').forEach(button => button.onclick = () => {
    const section = button.dataset.toggleLogSection;
    state.collapsedLogSections[section] = !state.collapsedLogSections[section];
    const expanded = !state.collapsedLogSections[section];
    const label = button.closest('.section-head')?.querySelector('h2')?.textContent || '';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${label} ${expanded ? 'einklappen' : 'ausklappen'}`);
    button.title = expanded ? 'Einklappen' : 'Ausklappen';
    const content = document.querySelector(`[data-log-section-content="${section}"]`);
    if (content) content.hidden = state.collapsedLogSections[section];
  });
  bindEntryActions();
  bindItemActions();
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
    if (!entry || !confirm(`„${entryTitle(entry)}“ wieder zu den anstehenden Arbeitsschritten verschieben?`)) return;
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
}

function setProjectsMenu(open, activeStatus = '') {
  const toggle = $('#projects-toggle');
  const subnav = $('#projects-subnav');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `Projektmenü ${open ? 'zuklappen' : 'aufklappen'}`);
  toggle.title = `Projektmenü ${open ? 'zuklappen' : 'aufklappen'}`;
  subnav.hidden = !open;
  document.querySelectorAll('[data-projects-route]').forEach(node => node.classList.toggle('active', open && node.dataset.projectsRoute === activeStatus));
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
  const settingsActive = routeName === 'settings';
  const projectsActive = routeName === 'projects';
  setSettingsMenu(settingsActive);
  setProjectsMenu(projectsActive, projectStatus);
  document.querySelectorAll('[data-settings-route]').forEach(node => node.classList.toggle('active', settingsActive && node.dataset.settingsRoute === state.activeSettings));
}
async function route() {
  if (!state.user) return;
  const hashValue = location.hash.replace(/^#\/?/, '');
  const [hashPath, hashQuery = ''] = hashValue.split('?');
  const hashParts = hashPath.split('/').filter(Boolean);
  const routeQuery = new URLSearchParams(hashQuery);
  const pathParts = location.pathname.split('/').filter(Boolean);
  const directProject = pathParts[0] === 'p' && pathParts[1];
  const directEntry = directProject && pathParts[2] === 'e' && pathParts[3];
  const parts = hashParts.length ? hashParts : directProject ? ['projects', pathParts[1]] : [];
  try {
    if (parts[0] === 'projects' && parts[1]) {
      setNav('projects');
      if (directEntry) state.activeTab = 'entries';
      await renderProject(parts[1]);
      if (directEntry) document.getElementById(pathParts[3])?.scrollIntoView({ block:'center' });
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
  const fallback = scope === 'folder' ? 'folder' : defaultProjectIconName();
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

function openProjectDialog(project = null) {
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
  showFormDialog($('#entry-dialog'));
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
  showFormDialog($('#item-dialog'));
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
    if (!confirm(message)) return;
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
    if (!confirm(`Benutzer „${user?.name || id}“ endgültig löschen? Die Projektdaten bleiben erhalten.`)) return;
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
    $('#update-error').textContent = '';
    $('#update-dialog-copy').textContent = update.platform === 'docker'
      ? `Version ${update.latestVersion} wird beim AIO-Updater angefordert. Der Anwendungscontainer erhält dabei keinen Zugriff auf den Docker-Socket.`
      : `Version ${update.latestVersion} wird geprüft, gesichert und anschließend installiert. Währenddessen befindet sich das Logbuch kurz im Wartungsmodus.`;
    showFormDialog(dialog);
  };
  $('[data-clear-content]').onclick = async event => {
    if (!confirm('Wirklich alle Projekte einschließlich aller Logs und Projektinhalte endgültig löschen? Benutzerkonten bleiben erhalten.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/system/content', { method:'DELETE' });
      state.projects = [];
      toast(`${result.removed || 0} Projekte gelöscht`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  };
  $('[data-clear-users]').onclick = async event => {
    if (!confirm('Wirklich alle Benutzerkonten außer dem aktuell angemeldeten Administrator endgültig löschen? Alle anderen Sitzungen werden beendet.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/system/users', { method:'DELETE' });
      toast(`${result.removed || 0} Benutzer gelöscht`);
      await renderSettings();
    } catch (error) { toast(error.message); button.disabled = false; }
  };
  $('[data-load-demo]').onclick = async event => {
    if (!confirm('Die elf Beispielprojekte und zwei Demo-Ordner einspielen? Bereits vorhandene Demodaten werden auf den Lieferzustand zurückgesetzt; eigene Inhalte bleiben erhalten.')) return;
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
    if (!confirm('Wirklich alle Beispielprojekte einschließlich nachträglich darin angelegter Inhalte endgültig löschen? Demo-Ordner mit eigenen Projekten oder Unterordnern bleiben erhalten.')) return;
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

function bindNewProject() { const button = $('[data-new-project]'); if (button) button.onclick = () => openProjectDialog(); }

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
  const create = $('[data-new-folder]');
  if (create) create.onclick = () => openFolderDialog();
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
    if (status === 'archived' && project?.status !== 'archived' && !confirm(`Projekt „${project?.title || id}“ archivieren?`)) {
      select.value = project?.status || 'active';
      return;
    }
    select.disabled = true;
    const inArchive = location.hash.startsWith('#/archive');
    const onDetail = location.hash.startsWith('#/projects/') || location.pathname.startsWith('/p/');
    try {
      const updated = await api(`/projects/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status }) });
      rememberProject(updated);
      toast({ active:'Projekt ist aktiv', paused:'Projekt pausiert', completed:'Projekt abgeschlossen', archived:'Projekt archiviert' }[status] || 'Projektstatus geändert');
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
    if (status === 'archived' && project?.status !== 'archived' && !confirm(`Projekt „${project?.title || id}“ archivieren?`)) return;
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
    if (!confirm(`Projekt „${project?.title || id}“ mit allen Inhalten endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    button.closest('[data-project-card]')?.remove();
    try { await api(`/projects/${encodeURIComponent(id)}/permanent`, { method:'DELETE' }); toast('Projekt endgültig gelöscht'); await renderTrash(); }
    catch (error) { toast(error.message); await renderTrash(); }
  });
  const empty = $('[data-empty-trash]');
  if (empty) empty.onclick = async () => {
    if (!confirm('Papierkorb endgültig leeren? Alle enthaltenen Projekte und ihre Inhalte werden unwiderruflich gelöscht.')) return;
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
    if (!confirm(`Arbeitsschritt „${entryTitle(entry)}“ endgültig löschen?`)) return;
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
  document.querySelectorAll('[data-task-inline-status]').forEach(select => select.onchange = async event => {
    event.stopPropagation();
    const id = select.dataset.taskInlineStatus;
    select.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(state.current.id)}/tasks/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status:select.value }) });
      toast('Status des Arbeitsschritts geändert');
      await renderProject(state.current.id);
    } catch (error) { toast(error.message); await renderProject(state.current.id); }
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
    if (!confirm(`${config.singular} „${title}“ endgültig löschen?`)) return;
    try { await api(`/projects/${encodeURIComponent(state.current.id)}/${collection}/${encodeURIComponent(id)}`, { method:'DELETE' }); toast(`${config.singular} gelöscht`); await renderProject(state.current.id); }
    catch (error) { toast(error.message); }
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
    const payload = { title:form.title, description:form.description, icon:form.icon, iconInherited:form.iconInherited === '1', createdAt:form.createdAt, dueDate:form.dueDate || '', folderId:form.folderId || null, tagIds:state.projectDialogTagIds };
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
  if (!id || !confirm(`Projekt „${project?.title || id}“ in den Papierkorb verschieben?`)) return;
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
  if (!folder || !confirm(`Ordner „${folder.name}“ endgültig löschen?`)) return;
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
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const editing = Boolean(form.entryId);
  const path = `/projects/${encodeURIComponent(form.projectId)}/entries${editing ? `/${encodeURIComponent(form.entryId)}` : ''}`;
  try { await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify({ title:form.title, body:form.body, nextStep:'', date:form.date }) }); $('#entry-dialog').close(); formElement.reset(); toast(editing ? 'Arbeitsschritt aktualisiert' : 'Arbeitsschritt gespeichert'); await renderProject(form.projectId); }
  catch (error) { toast(error.message); }
});
$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const editing = Boolean(form.itemId);
  const path = `/projects/${encodeURIComponent(form.projectId)}/${form.collection}${editing ? `/${encodeURIComponent(form.itemId)}` : ''}`;
  const payload = { ...form, createdAt:today() };
  delete payload.projectId; delete payload.collection; delete payload.itemId;
  try {
    await api(path, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
    $('#item-dialog').close(); formElement.reset(); toast(`${sections[form.collection].singular} ${editing ? 'aktualisiert' : 'gespeichert'}`); await renderProject(form.projectId);
  } catch (error) { toast(error.message); }
});
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
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = state.update?.platform === 'docker' ? 'Update wird angefordert …' : 'Update wird installiert …';
  try {
    const result = await api('/update/install', { method:'POST', body:JSON.stringify({ password:form.elements.password.value }) });
    $('#update-dialog').close();
    form.reset();
    if (result.reload) {
      toast('Update installiert · Das Logbuch wird neu geladen');
      setTimeout(() => location.reload(), 700);
      return;
    }
    toast('Docker-Update wurde angefordert');
    await loadUpdateStatus();
    await renderSettings();
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Update installieren';
  }
});
$('#logout').onclick = async () => { await api('/logout', { method:'POST' }); location.reload(); };
$('#settings-toggle').onclick = () => {
  const open = $('#settings-toggle').getAttribute('aria-expanded') !== 'true';
  if (open) {
    setProjectsMenu(false);
    if (location.hash !== '#/settings/general') {
      setSettingsMenu(true);
      location.href = '/#/settings/general';
      return;
    }
  }
  setSettingsMenu(open);
};
$('#projects-toggle').onclick = async () => {
  const open = $('#projects-toggle').getAttribute('aria-expanded') !== 'true';
  if (open) {
    setSettingsMenu(false);
    if (location.hash !== '#/projects') {
      setProjectsMenu(true);
      location.href = '/#/projects';
      return;
    }
    try { await loadProjects(); } catch (error) { toast(error.message); }
  }
  setProjectsMenu(open, currentProjectMenuStatus());
};
$('#menu-button').onclick = () => $('.sidebar').classList.toggle('open');
document.querySelectorAll('dialog button[value="cancel"]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); button.closest('dialog').close(); }));
window.addEventListener('hashchange', () => { $('.sidebar').classList.remove('open'); route(); });
document.addEventListener('click', event => {
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
