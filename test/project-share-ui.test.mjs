import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('..', import.meta.url);

test('Öffentliche Freigabe zeigt einen schlichten Titel und nur vorhandene Ablaufdaten', async () => {
  const source = await readFile(new URL('public/project-share.js', root), 'utf8');
  const main = { innerHTML:'' };
  const document = { querySelector: selector => selector === '#public-share-main' ? main : null, querySelectorAll: () => [], title:'' };
  const context = { document, URL, URLSearchParams, Intl, location:{ search:'', href:'http://localhost/share/projects/test' }, window:{ addEventListener() {} } };
  runInNewContext(source.replace(/\nload\(\);\s*$/, ''), context);
  const data = { name:'Ordner: Elektronik', rootFolderKey:'root', scopeLabel:'Ordner: Elektronik · Alle Status', expiresAt:null, folders:[{key:'root',parentKey:null,name:'Elektronik'}], projects:[] };
  context.render(data);
  assert.match(main.innerHTML, /<h1>Elektronik<\/h1>/);
  assert.doesNotMatch(main.innerHTML, /Ordner:|Alle Status|Freigabe gültig|Freigabe ohne|freigegebenen Übersicht/);
  assert.equal(document.title, 'Elektronik · Projektübersicht');
  assert.doesNotMatch(main.innerHTML, /aria-label="Ordnerpfad"/);
  context.location.search = '?folder=child';
  context.render({ ...data, folders:[...data.folders, {key:'child',parentKey:'root',name:'Sensoren'}] });
  assert.match(main.innerHTML, /aria-label="Ordnerpfad"/);
  assert.match(main.innerHTML, /Sensoren/);
  assert.match(main.innerHTML, /<h1><a[^>]+>Elektronik<\/a>.*aria-current="page">Sensoren<\/span><\/h1>/);
  assert.doesNotMatch(main.innerHTML, /public-breadcrumbs/);
  assert.equal((main.innerHTML.match(/<h1>/g) || []).length, 1);
  context.location.search = '?folder=deep';
  context.render({ ...data, folders:[...data.folders, {key:'child',parentKey:'root',name:'Sensoren'}, {key:'deep',parentKey:'child',name:'Temperatur'}] });
  assert.match(main.innerHTML, /<a[^>]+folder=child[^>]*>Sensoren<\/a>/);
  assert.match(main.innerHTML, /aria-current="page">Temperatur/);
  context.location.search = '';
  context.render({ ...data, projects:[{title:'Sensor',status:'active',folderKey:'root'}] });
  assert.doesNotMatch(main.innerHTML, /<strong>1 Projekt|<select|Sortieren nach/);
  assert.match(main.innerHTML, /<summary aria-label="Projekte sortieren"/);
  assert.match(main.innerHTML, /data-project-sort="due:asc" aria-pressed="true"/);
  const folderData = { ...data, folders:[...data.folders, {key:'b',parentKey:'root',name:'Beta'}, {key:'a',parentKey:'root',name:'Alpha'}, {key:'nested',parentKey:'b',name:'Nested'}], projects:[{title:'Projekt',status:'active',folderKey:'root'}] };
  for (const sort of ['title:asc', 'title:desc', 'due:asc', 'due:desc', 'status:asc']) {
    context.location.search = '?sort=' + sort;
    context.render(folderData);
    const html = main.innerHTML;
    assert.ok(html.indexOf('public-project-toolbar') < html.indexOf('public-folders'));
    assert.ok(html.indexOf('public-project-toolbar') < html.indexOf('</section>'));
    assert.ok(html.indexOf('public-folders') < html.indexOf('public-project-list'));
    assert.equal(html.indexOf('<strong>Alpha') < html.indexOf('<strong>Beta'), sort !== 'title:desc');
    assert.doesNotMatch(html, /Nested/);
  }
  context.render({ ...folderData, projects:[] });
  assert.match(main.innerHTML, /public-project-toolbar/);
  context.location.search = '';
  context.render({ ...data, expiresAt:'2027-12-31' });
  assert.match(main.innerHTML, /Freigabe gültig bis 31\.12\.2027/);
  context.render({ ...data, name:'Werkstattprojekte' });
  assert.match(main.innerHTML, /<h1>Werkstattprojekte<\/h1>/);
  context.render({ ...data, rootFolderKey:null, name:'Alle Projekte' });
  assert.match(main.innerHTML, /<h1>Alle Projekte<\/h1>/);
});

test('Projektansichten bieten eine verwaltete öffentliche Freigabe', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('public/app.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/styles.css', root), 'utf8'),
  ]);
  assert.match(html, /id="project-share-dialog"/);
  assert.match(html, /Ohne Anmeldung sichtbar/);
  const browser = await readFile(new URL('public/project-browser.js', root), 'utf8');
  assert.match(browser, /data-open-project-share/);
  assert.match(browser, /state.user.admin && !state.currentFolderId/);
  assert.match(browser, /data-folder-share="\$\{escapeHtml\(folder.id\)\}">Freigeben …/);
  assert.match(browser, /openProjectShareDialog\(button.dataset.folderShare\)/);
  assert.match(js, /function currentProjectShareScope\(folderId = ''\)/);
  assert.match(js, /share.scopeType === 'FOLDER' && share.folderId === folderId/);
  assert.match(html, /name="statusMode"/);
  for (const status of ['idea', 'active', 'paused', 'completed']) assert.ok(html.includes(`name="projectStatuses" value="${status}"`));
  assert.match(js, /Bitte mindestens einen Projektstatus auswählen/);
  assert.match(js, /scopeType:'FOLDER'/);
  assert.match(js, /scopeType:'STATUS'/);
  assert.match(js, /api\('\/project-shares'/);
  assert.match(js, /data-project-share-rotate/);
  assert.match(js, /data-project-share-disable/);
  assert.match(css, /\.project-share-row/);
  assert.match(html, /href="\/#\/project-shares" data-projects-route="shares"/);
  assert.match(js, /function renderProjectShares\(\)/);
  assert.match(js, /if \(!state.user\?\.admin\)/);
  assert.match(js, /data-project-share-edit/);
  assert.match(js, /data-project-share-delete/);
  assert.match(js, /title:'Freigabe löschen', confirmLabel:'Endgültig löschen'/);
  assert.match(js, /shareId \? 'PATCH' : 'POST'/);
  assert.match(js, /if \(!dialog.open\) dialog.showModal\(\)/);
  assert.match(css, /#project-share-form \[hidden\] \{ display:none; \}/);
});

test('Öffentliche Projektseite zeigt ausschließlich reduzierte Felder und Ordnernavigation', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('public/project-share.html', root), 'utf8'),
    readFile(new URL('public/project-share.js', root), 'utf8'),
    readFile(new URL('public/project-share.css', root), 'utf8'),
  ]);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.doesNotMatch(html, /Öffentliche Projektübersicht|Nur lesbare Übersicht|Keine Anmeldung erforderlich/);
  assert.doesNotMatch(js, /Freigabe ohne Ablaufdatum|in dieser freigegebenen Übersicht|data\.scopeLabel/);
  assert.match(js, /api\/public\/project-shares/);
  assert.match(js, /project\.title/);
  assert.match(js, /project\.description/);
  assert.match(js, /project\.status/);
  assert.match(js, /project\.dueDate/);
  assert.match(js, /Fälligkeit · früheste zuerst/);
  assert.match(js, /Projektname · A–Z/);
  assert.match(js, /Status · Idee bis Abgeschlossen/);
  assert.match(js, /data-project-sort/);
  assert.match(css, /\.public-project-list/);
  assert.match(css, /\.public-project-row/);
  assert.doesNotMatch(js, /public-project-card/);
  assert.doesNotMatch(js, /project\.(entries|tasks|files|materials)/);
});
