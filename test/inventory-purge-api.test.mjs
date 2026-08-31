import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4242';

test('Archivierte Lagerdaten lassen sich nach Vorschau endgültig per API löschen', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'logbuch-purge-api-'));
  let errors = '';
  const server = spawn('php',['-S','127.0.0.1:4242','-t','public','public/router.php'],{cwd:root,env:{...process.env,LOGBUCH_STORAGE_PATH:storage,LOGBUCH_PLATFORM:'test'},stdio:['ignore','ignore','pipe']});
  server.stderr.on('data',chunk=>{errors+=chunk;});
  try {
    for(let i=0;i<40;i+=1){if(await fetch(`${baseUrl}/api/install/status`).then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
    const installed=await fetch(`${baseUrl}/api/install`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteName:'Löschtest',timezone:'Europe/Berlin',adminUser:'admin',adminPassword:'ein-langes-Testpasswort',demoData:true})});
    assert.equal(installed.status,201,errors);
    const login=await fetch(`${baseUrl}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',password:'ein-langes-Testpasswort'})});
    const loginData=await login.json(); const cookie=login.headers.get('set-cookie').split(';',1)[0];
    const headers={Cookie:cookie,'X-Logbuch-CSRF':loginData.csrfToken,'Content-Type':'application/json'};
    const locationPreview=await fetch(`${baseUrl}/api/storage-locations/demo-location-alte-kiste/purge-preview`,{headers:{Cookie:cookie}}).then(r=>r.json());
    assert.equal(locationPreview.stockEntries,1); assert.equal(locationPreview.transactions,1);
    const deletedLocation=await fetch(`${baseUrl}/api/storage-locations/demo-location-alte-kiste/permanent`,{method:'DELETE',headers,body:'{}'});
    assert.equal(deletedLocation.status,200,await deletedLocation.clone().text());
    const note=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/notes`,{method:'POST',headers,body:JSON.stringify({content:'Historischer Hinweis'})});
    assert.equal(note.status,409,await note.clone().text());
    const restoredItem=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/restore`,{method:'POST',headers,body:'{}'});
    assert.equal(restoredItem.status,200,await restoredItem.clone().text());
    const createdNote=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/notes`,{method:'POST',headers,body:JSON.stringify({content:'Historischer Hinweis'})});
    assert.equal(createdNote.status,201,await createdNote.clone().text());
    const archivedItem=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/archive`,{method:'POST',headers,body:'{}'});
    assert.equal(archivedItem.status,200,await archivedItem.clone().text());
    const itemPreview=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/purge-preview`,{headers:{Cookie:cookie}}).then(r=>r.json());
    assert.equal(itemPreview.stockEntries,0); assert.equal(itemPreview.transactions,0);
    assert.equal(itemPreview.notes,1);
    const deletedItem=await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb/permanent`,{method:'DELETE',headers,body:'{}'});
    assert.equal(deletedItem.status,200,await deletedItem.clone().text());
    assert.equal((await fetch(`${baseUrl}/api/inventory-items/demo-item-mini-usb`,{headers:{Cookie:cookie}})).status,404);
  } finally { server.kill('SIGTERM'); await rm(storage,{recursive:true,force:true}); }
});
