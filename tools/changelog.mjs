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
