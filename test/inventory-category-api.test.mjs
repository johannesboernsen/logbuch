import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = 'http://127.0.0.1:4241';
let storage, server, cookie = '', csrf = '', errors = '';
async function request(path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {}), ...(!['GET','HEAD'].includes(method) && csrf ? {'X-Logbuch-CSRF':csrf} : {}) } });
  const text = await response.text();
  return { response, data:text ? JSON.parse(text) : null };
}
before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'logbuch-category-api-'));
  server = spawn('php', ['-S','127.0.0.1:4241','-t','public','public/router.php'], { cwd:root, env:{...process.env,LOGBUCH_STORAGE_PATH:storage,LOGBUCH_PLATFORM:'test'}, stdio:['ignore','ignore','pipe'] });
  server.stderr.on('data', chunk => { errors += chunk; });
  for (let i=0;i<40;i+=1) { if (await fetch(`${baseUrl}/api/install/status`).then(r=>r.ok).catch(()=>false)) break; await new Promise(r=>setTimeout(r,100)); }
  assert.equal((await request('/api/install',{method:'POST',body:JSON.stringify({siteName:'Kategorie-Test',timezone:'Europe/Berlin',adminUser:'admin',adminPassword:'ein-langes-Testpasswort'})})).response.status,201,errors);
  const login = await request('/api/login',{method:'POST',body:JSON.stringify({user:'admin',password:'ein-langes-Testpasswort'})});
  cookie = login.response.headers.get('set-cookie').split(';',1)[0]; csrf = login.data.csrfToken;
});
after(async () => { server?.kill('SIGTERM'); if (storage) await rm(storage,{recursive:true,force:true}); });

test('Kategorie-API verbindet Baum, Mehrfachzuordnung und rekursive Artikelsicht', async () => {
  const rootCategory = await request('/api/inventory-categories',{method:'POST',body:JSON.stringify({name:'Elektronik'})});
  const child = await request('/api/inventory-categories',{method:'POST',body:JSON.stringify({name:'Displays',parentId:rootCategory.data.id})});
  const second = await request('/api/inventory-categories',{method:'POST',body:JSON.stringify({name:'Ersatzteile'})});
  const item = await request('/api/inventory-items',{method:'POST',body:JSON.stringify({name:'Touchdisplay',stockUnit:'Stück',categoryIds:[child.data.id,second.data.id]})});
  assert.deepEqual(new Set(item.data.categoryIds), new Set([child.data.id,second.data.id]));
  assert.equal((await request(`/api/inventory-categories/${rootCategory.data.id}/items?recursive=1`)).data.items[0].id,item.data.id);
  const cycle = await request(`/api/inventory-categories/${rootCategory.data.id}`,{method:'PATCH',body:JSON.stringify({parentId:child.data.id})});
  assert.equal(cycle.response.status,422);
  assert.equal((await request(`/api/inventory-categories/${second.data.id}/items/${item.data.id}`,{method:'DELETE',body:'{}'})).data.removed,true);
});
