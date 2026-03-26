export function installClickHook(blackbox) {
  const config = blackbox._getConfig();

  const handler = (event) => {
    try {
      const target = event.target;
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

      blackbox._addBreadcrumb('click', { tag, text, id, className, dataBb, href });

      // Suspicious silence check for interactive elements
      const isInteractive = tag === 'button'
        || (tag === 'input' && el.type === 'submit')
        || el.getAttribute?.('role') === 'button';

      if (isInteractive) {
        blackbox._registerSilenceCheck({ tag, text, id, dataBb });
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  document.addEventListener('click', handler, true);

  return () => {
    document.removeEventListener('click', handler, true);
  };
}
