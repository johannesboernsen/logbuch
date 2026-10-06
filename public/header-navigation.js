// Hover navigation with direct links, touch disclosure and keyboard access.
function setHeaderSearch(open) {
  $('#global-search-toggle').setAttribute('aria-expanded', String(open));
  $('#global-search-panel').hidden = !open;
}

function setMobileNavigation(open) {
  $('.app-header').classList.toggle('navigation-open', open);
  $('#menu-button').setAttribute('aria-expanded', String(open));
  $('#menu-button').setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
}

function closeHeaderDropdowns() {
  setProjectsMenu(false, currentProjectMenuStatus());
  setInventoryMenu(false, location.hash.startsWith('#/inventory') ? currentInventoryMenuRoute() : '');
  setHeaderSearch(false);
}

function closeHeaderNavigation() {
  closeHeaderDropdowns();
  setMobileNavigation(false);
}

function bindHeaderNavigation() {
  const header = $('.app-header');
  const menus = [
    { toggle:$('#projects-link'), panel:$('#projects-subnav'), set:open => setProjectsMenu(open, currentProjectMenuStatus()) },
    { toggle:$('#inventory-link'), panel:$('#inventory-subnav'), set:open => setInventoryMenu(open, location.hash.startsWith('#/inventory') ? currentInventoryMenuRoute() : '') },
  ];
  const links = panel => [...panel.querySelectorAll('a[href]')].filter(link => !link.hidden && !link.closest('[hidden]'));
  for (const menu of menus) {
    const wrapper = menu.toggle.parentElement;
    let pointerType = '';
    wrapper.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      closeHeaderDropdowns();
      menu.set(true);
    });
    wrapper.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse') return;
      // The CSS hover bridge makes the button, gap and panel one pointer area.
      if (!menu.panel.contains(document.activeElement)) menu.set(false);
    });
    menu.toggle.addEventListener('pointerdown', event => { pointerType = event.pointerType; });
    menu.toggle.onclick = event => {
      const directLink = menu.toggle.tagName === 'A';
      const touch = pointerType === 'touch' || pointerType === 'pen';
      pointerType = '';
      // Mouse/keyboard activate the destination. On touch, first tap reveals
      // subpages; a second tap follows the same link.
      if (directLink && (!touch || !menu.panel.hidden)) return;
      if (directLink) { event.preventDefault(); event.stopPropagation(); }
      const open = menu.panel.hidden;
      closeHeaderDropdowns();
      menu.set(open);
    };
    menu.toggle.onkeydown = event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      closeHeaderDropdowns();
      menu.set(true);
      const options = links(menu.panel);
      (event.key === 'ArrowUp' ? options.at(-1) : options[0])?.focus();
    };
    menu.panel.onkeydown = event => {
      const options = links(menu.panel);
      const index = options.indexOf(document.activeElement);
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    };
    wrapper.addEventListener('focusout', () => {
      setTimeout(() => { if (!wrapper.contains(document.activeElement)) menu.set(false); }, 0);
    });
  }
  $('#global-search-toggle').onclick = () => {
    const open = $('#global-search-panel').hidden;
    closeHeaderNavigation();
    setHeaderSearch(open);
    if (open) $('#global-search-input').focus();
  };
  $('#menu-button').onclick = () => {
    const open = !header.classList.contains('navigation-open');
    closeHeaderDropdowns();
    setMobileNavigation(open);
  };
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openMenu = menus.find(menu => !menu.panel.hidden);
    const target = !$('#global-search-panel').hidden ? $('#global-search-toggle') : openMenu?.toggle || (header.classList.contains('navigation-open') ? $('#menu-button') : null);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    if (openMenu) closeHeaderDropdowns(); else closeHeaderNavigation();
    target.focus();
  });
  header.addEventListener('click', event => { if (event.target.closest('a[href]')) closeHeaderNavigation(); });
  document.addEventListener('click', event => { if (!header.contains(event.target)) closeHeaderNavigation(); });
  header.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!header.contains(document.activeElement)) closeHeaderNavigation();
      else if (!$('.header-search').contains(document.activeElement)) setHeaderSearch(false);
    }, 0);
  });
  window.matchMedia('(max-width:1100px)').addEventListener('change', closeHeaderNavigation);
}
