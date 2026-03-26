export function installResourceHook(blackbox) {
  const resourceTags = new Set(['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE']);

  const handler = (event) => {
    try {
      const target = event.target;
      // Only resource errors, not JS errors
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;

      const tagName = target.tagName.toLowerCase();
      const src = blackbox._stripQueryParams(target.src || target.href || '');

      blackbox._recordError({
        message: `Resource failed to load: ${tagName} - ${src}`,
        stack: '',
        source: 'resource_load',
        context: {
          tagName,
          src,
          id: target.id || null,
          className: target.className?.toString() || ''
        }
      });
    } catch { /* BlackBox must never crash the host app */ }
  };

  window.addEventListener('error', handler, true);

  return () => {
    window.removeEventListener('error', handler, true);
  };
}
