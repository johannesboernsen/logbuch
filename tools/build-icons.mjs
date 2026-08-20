import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('../node_modules/@iconify-json/lucide/icons.json', import.meta.url);
const targetUrl = new URL('../public/lucide-icons.json', import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
const library = {
  prefix: source.prefix,
  width: source.width || 24,
  height: source.height || 24,
  icons: source.icons,
};

await writeFile(targetUrl, `${JSON.stringify(library)}\n`);
console.log(`${Object.keys(library.icons).length} Lucide-Symbole nach public/lucide-icons.json geschrieben.`);
