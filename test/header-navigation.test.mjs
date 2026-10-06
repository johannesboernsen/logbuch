import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/header-navigation.js', import.meta.url), 'utf8');

test('Seitenrahmen ist inklusive Innenabständen auf 1600px begrenzt; Kopfzeilen bleiben durchgehend', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /--page-max-width:1600px;/);
  assert.ok(css.includes('--page-gutter:max(var(--page-inner-gutter),calc((100vw - var(--page-max-width)) / 2 + var(--page-inner-gutter)))'));
  assert.match(css, /\.app-header \{[^}]*padding:0 var\(--page-gutter\);/);
  assert.match(css, /main \{ --main-gutter:var\(--page-gutter\);/);
  assert.match(css, /\.standard-page-head \{[^}]*margin:-54px calc\(var\(--main-gutter\) \* -1\) 0;/);
  assert.match(css, /main \{ --main-gutter:18px;/);
  assert.match(css, /body\.project-print-mode main \{ margin:0; padding:32px 24px 60px; \}/);
});

test('Kopfmenü-Dropdowns beginnen links am Hauptmenüpunkt und öffnen nach rechts', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-header \.settings-subnav \{ position:absolute;[^}]*left:0; right:auto; width:260px;/);
  assert.match(css, /\.app-header \.settings-subnav \{ position:static; width:auto;/);
});

test('Alle Kopfmenü-Elemente teilen neutrale Hover-, Fokus-, Auswahl- und Offen-Zustände', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.app-header :is(.nav-item,.settings-subnav a,#global-search-toggle,#menu-button):is(:hover,:focus-visible,[aria-expanded="true"],.active) { color:var(--red); background:var(--interactive-hover); }'));
  assert.ok(css.includes('.app-header :is(.nav-item,.settings-subnav a,#global-search-toggle,#menu-button):focus-visible { outline:2px solid var(--red); outline-offset:2px; }'));
  const headerStyles = css.slice(css.indexOf('.app-header {'), css.indexOf('.nav-item { width:100%'));
  assert.doesNotMatch(headerStyles, /background:var\(--red-soft\)/);
});

test('Projektstruktur ohne Ansichtswechsel; Statussichtbarkeit liegt als Auge bei den Werkzeugen', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const browser = await readFile(new URL('../public/project-browser.js', import.meta.url), 'utf8');
  assert.match(browser, /const head = standardPageHeader\([^\n]+toolbar:projectBrowserToolbar\(\)/);
  assert.match(app, /<div class="standard-page-toolbar">\$\{toolbar\}<\/div>/);
  assert.doesNotMatch(browser, /projectViewSwitch|data-project-view|Alle Projekte/);
  assert.doesNotMatch(app, /projectBrowserView|projectUnfiledOnly/);
  const controls = app.split('function projectListControls(')[1].split('function selectedTagFiltersMarkup')[0];
  assert.match(controls, /!archived \? projectStatusFilterMarkup\(\) : ''/);
  assert.match(app, /data-toggle-status aria-label="Status-Sichtbarkeit"/);
  assert.match(app, /aria-controls="project-status-panel"/);
  assert.match(app, /return renderProjectColumns\(\);/);
});

test('Projekte öffnet direkt die Ordnerstruktur und bietet Archiv und Papierkorb ohne separaten Pfeil', async () => {
  const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const browser = await readFile(new URL('../public/project-browser.js', import.meta.url), 'utf8');
  assert.match(html, /<a id="projects-link"[^>]+href="\/#\/projects\?view=columns"/);
  assert.doesNotMatch(html, /id="projects-toggle"|id="inventory-toggle"/);
  const menu = html.split('id="projects-subnav"')[1].split('</div>')[0];
  assert.deepEqual([...menu.matchAll(/data-projects-route="([^"]+)"/g)].map(match => match[1]), ['shares', 'archived', 'trashed']);
  assert.equal((menu.match(/<a /g) || []).length, 3);
  assert.doesNotMatch(html + app + browser, /data-pin-project-folder|project-folder-shortcuts|renderProjectFolderShortcuts/);
  assert.match(app, /link.href = projectBrowserHref\(null, '', 'columns'\)/);
});

function fixture({ manualTimers = false } = {}) {
  const timers = new Map();
  let timerId = 0;
  const elements = new Map();
  const document = { activeElement:null, handlers:{}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  function element(name) {
    const classes = new Set();
    const node = { name, hidden:false, attributes:{}, handlers:{}, children:[],
      classList:{ toggle(key, value) { if (value) classes.add(key); else classes.delete(key); }, contains:key => classes.has(key) },
      setAttribute(key, value) { this.attributes[key] = value; },
      focus() { document.activeElement = this; },
      contains(target) { return target === this || this.children.some(child => child.contains(target)); },
      closest() { return null; }, querySelectorAll() { return this.children; },
      addEventListener(type, handler) { this.handlers[type] = handler; },
    };
    elements.set(name, node); return node;
  }
  const header = element('.app-header');
  for (const key of ['projects', 'inventory']) {
    const wrapper = element(`.${key}-menu`), toggle = element(`#${key}-link`), panel = element(`#${key}-subnav`);
    toggle.tagName = 'A';
    wrapper.children = [toggle, panel]; toggle.parentElement = wrapper; header.children.push(wrapper);
    panel.hidden = true; panel.children = [element(`${key}-first`), element(`${key}-last`)];
  }
  const search = element('.header-search');
  search.children = [element('#global-search-toggle'), element('#global-search-panel')];
  search.children[1].hidden = true;
  search.children[1].children = [element('#global-search-input')];
  header.children.push(search, element('#menu-button'));
  const $ = name => elements.get(name);
  const set = key => open => { $(`#${key}-subnav`).hidden = !open; $(`#${key}-link`).setAttribute('aria-expanded', String(open)); };
  const context = vm.createContext({ $, document, location:{hash:'#/inventory'},
    setTimeout(callback, delay) { if (!manualTimers) return callback(); const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    window:{matchMedia:() => ({addEventListener(){}})},
    setProjectsMenu:set('projects'), setInventoryMenu:set('inventory'),
    currentProjectMenuStatus:() => '', currentInventoryMenuRoute:() => 'locations',
  });
  vm.runInContext(source, context); context.bindHeaderNavigation();
  const key = (name, value) => $(name).handlers.keydown?.({key:value, preventDefault(){}, stopPropagation(){}});
  const flushTimers = () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } };
  return { $, context, document, key, timers, flushTimers };
}

test('Hover schließt beim Verlassen sofort und ohne Timer', () => {
  const {$, timers} = fixture({manualTimers:true});
  const wrapper = $('.projects-menu');
  wrapper.handlers.pointerenter({pointerType:'mouse'});
  wrapper.handlers.pointerleave({pointerType:'mouse'});
  assert.equal(timers.size, 0);
  assert.equal($('#projects-subnav').hidden, true);
});

test('Offene Desktop-Dropdowns überbrücken den Abstand zum Hauptmenüpunkt', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-header \.settings-subnav \{[^}]*top:calc\(100% \+ 5px\);/);
  assert.match(css, /@media \(min-width:1101px\) \{[^}]*:has\(> \.settings-subnav:not\(\[hidden\]\)\)::after \{[^}]*top:100%; left:0; width:260px; height:6px;/);
  assert.doesNotMatch(source, /headerDropdownCloseTimer/);
});

test('Verlassen per Maus schließt kein per Tastatur fokussiertes Dropdown', () => {
  const {$, flushTimers} = fixture({manualTimers:true});
  $('.projects-menu').handlers.pointerenter({pointerType:'mouse'});
  $('projects-first').focus();
  $('.projects-menu').handlers.pointerleave({pointerType:'mouse'});
  flushTimers();
  assert.equal($('#projects-subnav').hidden, false);
});

test('Maus öffnet Menüs exklusiv und schließt sie beim Verlassen', () => {
  const {$} = fixture();
  $('.projects-menu').handlers.pointerenter({pointerType:'mouse'}); assert.equal($('#projects-subnav').hidden, false);
  $('.inventory-menu').handlers.pointerenter({pointerType:'mouse'}); assert.equal($('#projects-subnav').hidden, true); assert.equal($('#inventory-subnav').hidden, false);
  $('.inventory-menu').handlers.pointerleave({pointerType:'mouse'}); assert.equal($('#inventory-subnav').hidden, true);
});

test('Direktlinks navigieren per Maus; Touch öffnet zuerst und navigiert beim zweiten Tippen', () => {
  const {$} = fixture();
  let prevented = 0;
  const event = {preventDefault(){prevented++;},stopPropagation(){}};
  $('#projects-link').onclick(event);
  assert.equal(prevented, 0);
  $('.projects-menu').handlers.pointerenter({pointerType:'touch'});
  assert.equal($('#projects-subnav').hidden, true);
  $('#projects-link').handlers.pointerdown({pointerType:'touch'});
  $('#projects-link').onclick(event);
  assert.equal(prevented, 1);
  assert.equal($('#projects-subnav').hidden, false);
  $('#projects-link').handlers.pointerdown({pointerType:'touch'});
  $('#projects-link').onclick(event);
  assert.equal(prevented, 1);
});

test('Lupe fokussiert Suche, schließt Navigation und Escape kehrt zur Lupe zurück', () => {
  const {$, document, key} = fixture();
  $('#menu-button').onclick(); $('.inventory-menu').handlers.pointerenter({pointerType:'mouse'}); $('#global-search-toggle').onclick();
  assert.equal($('.app-header').classList.contains('navigation-open'), false);
  assert.equal($('#inventory-subnav').hidden, true);
  assert.equal(document.activeElement, $('#global-search-input'));
  key('.app-header', 'Escape');
  assert.equal($('#global-search-panel').hidden, true);
  assert.equal(document.activeElement, $('#global-search-toggle'));
});

test('Dropdowns unterstützen Pfeiltasten und Escape ohne Seitennavigation', () => {
  const {$, document, key} = fixture();
  const event = name => ({key:name, preventDefault(){}});
  $('#projects-link').onkeydown(event('ArrowDown'));
  assert.equal(document.activeElement, $('projects-first'));
  $('#projects-subnav').onkeydown(event('End'));
  assert.equal(document.activeElement, $('projects-last'));
  $('#projects-subnav').onkeydown(event('ArrowDown'));
  assert.equal(document.activeElement, $('projects-first'));
  key('.app-header', 'Escape');
  assert.equal($('#projects-subnav').hidden, true);
  assert.equal(document.activeElement, $('#projects-link'));
});

test('Klick außerhalb und Routenwechsel schließen mobile Navigation und Dropdowns', () => {
  const {$, document, context} = fixture();
  $('#menu-button').onclick(); $('.inventory-menu').handlers.pointerenter({pointerType:'mouse'});
  document.handlers.click({target:{}});
  assert.equal($('.app-header').classList.contains('navigation-open'), false);
  assert.equal($('#inventory-subnav').hidden, true);
  $('.projects-menu').handlers.pointerenter({pointerType:'mouse'}); context.closeHeaderNavigation();
  assert.equal($('#projects-subnav').hidden, true);
});

test('Kopfzeile hat eine gemeinsame Marke, Suche ganz rechts und keinen linken Inhaltsabstand', async () => {
  const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const header = html.split('<header class="app-header">')[1].split('</header>')[0];
  assert.equal((header.match(/data-brand-name/g) || []).length, 1);
  assert.ok(header.indexOf('global-search-toggle') > header.indexOf('</nav>'));
  assert.match(css, /main \{[^}]*margin-left:0;/);
  assert.doesNotMatch(html, /class="sidebar"|class="mobile-header"/);
  assert.match(css, /\.app-header\.navigation-open nav/);
  assert.match(css, /\.project-print-mode \.app \{ padding-top:0; \}/);
});
