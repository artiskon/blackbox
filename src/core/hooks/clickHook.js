export function installClickHook(blackbox) {
  const config = blackbox._getConfig();

  // Cascading attempt to produce a human-meaningful label for any clickable
  // element. The order matters: explicit labels (aria, title, alt) beat
  // inferred ones (parent text, sibling caption). Images get alt early so
  // a click on a profile-pic <img> shows "Avatar of Jane" rather than
  // <img>. Data-bb is handled separately and not duplicated here.
  function synthesizeLabel(el, editable) {
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

    if (tag === 'input' || tag === 'textarea') {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return `[${placeholder.slice(0, 50)}]`;
      // Only button-type inputs show their value as a visible label. Any
      // other value is what the user typed (password, card number), so it
      // is never recorded: use the <label> text or the field name instead.
      if (['submit', 'button', 'reset'].includes(el.type)) {
        if (el.value) return el.value.slice(0, 50);
      } else {
        const labelText = el.labels?.[0]?.textContent?.trim();
        if (labelText) return labelText.slice(0, 50);
        const name = el.getAttribute('name');
        if (name) return name.slice(0, 50);
      }
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

    // Icon-only button/link (no own text): use a labelled descendant, e.g. the
    // avatar <img alt> inside <a>, or an <svg><title>.
    if (!editable && !el.textContent?.trim()) {
      const inner = el.querySelector?.('img[alt]:not([alt=""]), [aria-label]:not([aria-label=""]), svg title');
      const innerLabel = inner && (inner.getAttribute('alt') || inner.getAttribute('aria-label') || inner.textContent || '').trim();
      if (innerLabel) return innerLabel.slice(0, 100);
    }

    // Last resort: trimmed text from the immediate parent — gives at least
    // some lexical context (e.g. "Jane's profile") so the breadcrumb isn't
    // just `el: 'img'`. Only for non-interactive targets: for a button the
    // parent text is its siblings' labels joined ("EditDeleteShare"), and
    // inside an editor or form field it is the user's typed content.
    if (editable || el.matches?.('button, a, [role="button"], input, textarea, select, [data-bb]')) return null;
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

      // Skip clicks inside Next.js's dev error overlay — clicking "Try
      // again" on the error overlay is a development-tool action, not a
      // user-feature action, and it pollutes the breadcrumb trail right
      // when you most need a clean trail (the overlay only appears when
      // an error already fired). Covers both the legacy iframe-portal
      // overlay and the modern in-tree React overlay.
      if (target.closest?.('nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast], [data-nextjs-error-overlay]')) return;

      // A click on an icon usually lands on an unclassed <path>/<rect>; record
      // the <svg> root instead, which carries the lucide/heroicons class.
      const el = target.closest
        ? target.closest('button, a, [role="button"], input[type="submit"], [data-bb]')
          || (target.namespaceURI === 'http://www.w3.org/2000/svg' && target.closest('svg'))
          || target
        : target;

      const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
      // Text inside a contenteditable editor or a textarea is user content,
      // not a label — never record it.
      const editable = tag === 'textarea' || !!target.closest?.('[contenteditable]:not([contenteditable="false"])');
      const text = editable ? '' : el.textContent?.trim()?.slice(0, 100) || '';
      const id = el.id || null;
      // On SVG elements className and href are SVGAnimatedString objects, not
      // strings, so read the attributes instead
      const className = (el.getAttribute?.('class') || '').slice(0, config.maxClassNameLength);
      const dataBb = el.dataset?.bb || null;
      const rawHref = typeof el.href === 'string' ? el.href : el.getAttribute?.('href');
      let href = rawHref || null;
      if (href) href = blackbox._stripQueryParams(href);

      // Always try to synthesize a label — even when text exists, so an icon
      // button with text "×" still records a meaningful aria-label like
      // "Close dialog". The breadcrumb consumer can prefer text when present.
      const autoLabel = synthesizeLabel(el, editable);

      blackbox._addBreadcrumb('click', { tag, text, id, className, dataBb, href, autoLabel });

      // Suspicious silence check for interactive elements
      // Broad coverage: any clickable element that might trigger an action
      const passiveInputTypes = ['text', 'number', 'email', 'password', 'tel', 'search', 'url', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'file'];
      const isPassiveInput = tag === 'input' && passiveInputTypes.includes(el.type || 'text');
      const isInteractive = tag === 'button'
        || (tag === 'input' && el.type === 'submit')
        || el.getAttribute?.('role') === 'button'
        || (tag === 'a' && (!rawHref || rawHref === '#' || rawHref.endsWith('#')))
        || (!!dataBb && !isPassiveInput && tag !== 'textarea');

      if (isInteractive) {
        // `text` is canonical when present (ADR-0005); autoLabel only fills in
        blackbox._registerSilenceCheck({ tag, text: text || autoLabel || '', id, dataBb });
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  document.addEventListener('click', handler, true);

  return () => {
    document.removeEventListener('click', handler, true);
  };
}
