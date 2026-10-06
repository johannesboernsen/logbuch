export function changelogRelease(markdown, version) {
  const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escapedVersion}\\](?: - [^\\n]+)?$`, 'm');
  const match = heading.exec(markdown);
  if (!match) throw new Error(`Im CHANGELOG.md fehlt der Abschnitt für Version ${version}.`);
  const nextHeading = markdown.slice(match.index + match[0].length).search(/^## /m);
  const end = nextHeading < 0 ? markdown.length : match.index + match[0].length + nextHeading;
  const markdownSection = markdown.slice(match.index, end).trim();
  const body = markdownSection.slice(match[0].length).trim();
  const summary = body.split(/^### /m)[0].trim().replace(/\s+/g, ' ');
  const highlightsStart = body.match(/^### Wichtigste Änderungen\s*$/m);
  const highlightsBody = highlightsStart ? body.slice(highlightsStart.index + highlightsStart[0].length).trimStart() : '';
  const highlightsSection = highlightsBody.split(/^### /m)[0];
  const highlights = [...highlightsSection.matchAll(/^-\s+(.+)$/gm)].map(entry => entry[1].trim());
  if (!highlights.length) throw new Error(`Im CHANGELOG.md fehlen die wichtigsten Änderungen für Version ${version}.`);
  return {
    summary:summary || highlights[0],
    highlights,
    markdown:`${markdownSection}\n`,
  };
}

export function updateManifestRelease(release) {
  const summary = String(release?.summary || '').trim();
  const highlights = Array.isArray(release?.highlights) ? release.highlights.slice(0, 10) : [];
  if (!summary || summary.length > 1000) {
    throw new Error('Die Zusammenfassung für das Update-Manifest muss zwischen 1 und 1000 Zeichen lang sein.');
  }
  if (!highlights.length || highlights.some(highlight => typeof highlight !== 'string' || !highlight.trim() || highlight.length > 300)) {
    throw new Error('Die Änderungspunkte für das Update-Manifest müssen zwischen 1 und 300 Zeichen lang sein.');
  }
  return { summary, highlights };
}
