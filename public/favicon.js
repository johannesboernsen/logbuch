// One favicon renderer for the application, login and public project shares.
(() => {
  const normalize = value => {
    const color = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) return `#${[...color.slice(1)].map(char => char.repeat(2)).join('')}`;
    return null;
  };
  const luminance = color => {
    const channels = [1,3,5].map(index => {
      const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;
      return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrast = (left, right) => {
    const values = [luminance(left), luminance(right)].sort((a,b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  function svg(accentColor, contrastColor, iconBody = '') {
    const background = normalize(accentColor) || '#e5322c';
    const foreground = normalize(contrastColor) || (contrast(background, '#ffffff') >= contrast(background, '#202327') ? '#ffffff' : '#202327');
    // iconBody is trusted bundled library markup, never user-supplied SVG.
    const body = iconBody || '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7l8.7 5l8.7-5M12 22V12"/>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Logbuch</title><rect width="32" height="32" rx="6.5" fill="${background}"/><g transform="translate(4 4)" color="${foreground}" fill="none" stroke="${foreground}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${body}</g></svg>`;
  }
  function apply(accentColor, contrastColor, iconBody = '') {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    const href = `data:image/svg+xml,${encodeURIComponent(svg(accentColor, contrastColor, iconBody))}`;
    // A new color gets a new URL; repeated theme updates need no favicon reload.
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
  globalThis.LogbuchFavicon = { svg, apply };
})();
