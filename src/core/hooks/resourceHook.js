export function installResourceHook(blackbox) {
  const resourceTags = new Set(['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE']);
  // Use native fetch for probing — avoids triggering our own network hook
  const nativeFetch = window.fetch.bind(window);

  const handler = (event) => {
    try {
      const target = event.target;
      // Only resource errors, not JS errors
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;

      const tagName = target.tagName.toLowerCase();
      const src = blackbox._stripQueryParams(target.src || target.href || '');

      const context = {
        tagName,
        src,
        id: target.id || null,
        className: (target.className?.toString() || '').slice(0, 100),
      };

      // Try to find the nearest data-bb attribute for component identification
      let el = target;
      for (let i = 0; i < 5 && el; i++) {
        if (el.dataset?.bb) {
          context.dataBb = el.dataset.bb;
          break;
        }
        if (el.id) {
          context.nearestId = el.id;
          break;
        }
        el = el.parentElement;
      }

      // Probe URL with HEAD request to get HTTP status
      // (browser error events don't include status codes)
      if (src && src.startsWith('http')) {
        nativeFetch(src, { method: 'HEAD', mode: 'no-cors' }).then(res => {
          if (res.type !== 'opaque') {
            context.httpStatus = res.status;
          }
          // Record with status
          blackbox._recordError({
            message: `Resource failed to load: ${tagName} - ${src}`,
            stack: '',
            source: 'resource_load',
            context
          });
        }).catch(() => {
          context.httpStatus = 0;
          context.statusHint = 'unreachable';
          blackbox._recordError({
            message: `Resource failed to load: ${tagName} - ${src}`,
            stack: '',
            source: 'resource_load',
            context
          });
        });
      } else {
        blackbox._recordError({
          message: `Resource failed to load: ${tagName} - ${src}`,
          stack: '',
          source: 'resource_load',
          context
        });
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  window.addEventListener('error', handler, true);

  return () => {
    window.removeEventListener('error', handler, true);
  };
}
