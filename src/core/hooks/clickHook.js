export function installClickHook(blackbox) {
  const config = blackbox._getConfig();

  // Cascading attempt to produce a human-meaningful label for any clickable
  // element. The order matters: explicit labels (aria, title, alt) beat
  // inferred ones (parent text, sibling caption). Images get alt early so
  // a click on a profile-pic <img> shows "Avatar of Jane" rather than
  // <img>. Data-bb is handled separately and not duplicated here.
  function synthesizeLabel(el) {
    if (!el?.getAttribute) return null;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    const aria = el.getAttribute('aria-label');
    if (aria) return aria.slice(0, 100);

    const title = el.getAttribute('title');
    if (title) return title.slice(0, 100);

    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt) return alt.slice(0, 100);
    }

    if (tag === 'input') {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return `[${placeholder.slice(0, 50)}]`;
      const value = el.value;
      if (value) return value.slice(0, 50);
    }

    // Closest interactive ancestor — the click probably "belongs" to it.
    const parent = el.closest?.('button, a, [role="button"]');
    if (parent && parent !== el) {
      const parentText = parent.textContent?.trim()?.slice(0, 100);
      if (parentText && parentText.length >= 2) return parentText;
      const parentAria = parent.getAttribute?.('aria-label');
      if (parentAria) return parentAria.slice(0, 100);
      const parentTitle = parent.getAttribute?.('title');
      if (parentTitle) return parentTitle.slice(0, 100);
    }

    // Last resort: trimmed text from the immediate parent — gives at least
    // some lexical context (e.g. "Jane's profile") so the breadcrumb isn't
    // just `el: 'img'`.
    const parentEl = el.parentElement;
    if (parentEl) {
      const parentText = parentEl.textContent?.trim()?.slice(0, 30);
      if (parentText && parentText.length >= 2) return parentText;
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

      // Always try to synthesize a label — even when text exists, so an icon
      // button with text "×" still records a meaningful aria-label like
      // "Close dialog". The breadcrumb consumer can prefer text when present.
      const autoLabel = synthesizeLabel(el);

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
