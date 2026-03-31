export function installResourceHook(blackbox) {
  const resourceTags = new Set(['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE']);
  // Use native fetch for probing — avoids triggering our own network hook
  const nativeFetch = blackbox._getNativeFetch();

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
      if (src && src.startsWith('http') && nativeFetch) {
        // Try cors first (gets real status), fall back to no-cors
        nativeFetch(src, { method: 'HEAD', mode: 'cors' }).then(res => {
          context.httpStatus = res.status;
          blackbox._recordError({ message: `Resource failed to load: ${tagName} - ${src}`, stack: '', source: 'resource_load', context });
        }).catch(() => {
          // CORS blocked — try no-cors to distinguish reachable from unreachable
          nativeFetch(src, { method: 'HEAD', mode: 'no-cors' }).then(() => {
            context.statusHint = 'cors_blocked';
            blackbox._recordError({ message: `Resource failed to load: ${tagName} - ${src}`, stack: '', source: 'resource_load', context });
          }).catch(() => {
            context.httpStatus = 0;
            context.statusHint = 'unreachable';
            blackbox._recordError({ message: `Resource failed to load: ${tagName} - ${src}`, stack: '', source: 'resource_load', context });
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
