import { writeFile } from 'node:fs/promises';

const source = (process.argv[2] || '').replace(/\/$/, '');
const output = process.argv[3];
if (!source || !output) {
  console.error('Verwendung: node tools/export-legacy.mjs <URL> <Zieldatei>');
  process.exit(2);
}

async function api(path) {
  const response = await fetch(`${source}/api${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const projectList = (await api('/projects')).projects || [];
const projects = await Promise.all(projectList.map(project => api(`/projects/${encodeURIComponent(project.id)}`)));
const tags = (await api('/tags').catch(() => ({ tags: [] }))).tags || [];
const backup = { format: 'make-log-legacy-migration', version: 1, exportedAt: new Date().toISOString(), source, tags, projects };
await writeFile(output, JSON.stringify(backup, null, 2));
console.log(`${projects.length} Projekte und ${tags.length} Tags exportiert.`);

