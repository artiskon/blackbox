export function installClickHook(blackbox) {
  const config = blackbox._getConfig();

  function getLabel(el) {
    // data-bb is highest priority
    if (el.dataset?.bb) return null; // handled separately as dataBb
    // Try text content
    const text = el.textContent?.trim()?.slice(0, 100) || '';
    if (text.length >= 2) return null; // text is good enough

    // Fallback for icon-only / empty elements
    const ariaLabel = el.getAttribute?.('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 100);

    const title = el.getAttribute?.('title');
    if (title) return title.slice(0, 100);

    // Try parent button/link text
    const parent = el.closest?.('button, a');
    if (parent && parent !== el) {
      const parentText = parent.textContent?.trim()?.slice(0, 100);
      if (parentText && parentText.length >= 2) return parentText;
      const parentAria = parent.getAttribute?.('aria-label');
      if (parentAria) return parentAria.slice(0, 100);
    }

    return null;
  }

  const handler = (event) => {
    try {
      const target = event.target;

      // Skip clicks inside the BlackBox panel
      if (target.closest?.('[data-bb-panel]')) return;

      const el = target.closest
        ? target.closest('button, a, [role="button"], input[type="submit"], [data-bb]') || target
        : target;

      const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
      const text = el.textContent?.trim()?.slice(0, 100) || '';
      const id = el.id || null;
      const className = el.className?.toString()?.slice(0, config.maxClassNameLength) || '';
      const dataBb = el.dataset?.bb || null;
      let href = el.href || null;
      if (href) href = blackbox._stripQueryParams(href);

      // Use fallback label when text is too short
      const autoLabel = (text.length < 2 && !dataBb) ? getLabel(el) : null;

      blackbox._addBreadcrumb('click', { tag, text, id, className, dataBb, href, autoLabel });

      // Suspicious silence check for interactive elements
      // Broad coverage: any clickable element that might trigger an action
      const passiveInputTypes = ['text', 'number', 'email', 'password', 'tel', 'search', 'url', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'file'];
      const isPassiveInput = tag === 'input' && passiveInputTypes.includes(el.type || 'text');
      const isInteractive = tag === 'button'
        || (tag === 'input' && el.type === 'submit')
        || el.getAttribute?.('role') === 'button'
        || (tag === 'a' && (!el.href || el.href === '#' || el.href.endsWith('#')))
        || (!!dataBb && !isPassiveInput && tag !== 'textarea');

      if (isInteractive) {
        blackbox._registerSilenceCheck({ tag, text: autoLabel || text, id, dataBb });
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  document.addEventListener('click', handler, true);

  return () => {
    document.removeEventListener('click', handler, true);
  };
}
