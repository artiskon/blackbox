export function installResourceHook(blackbox) {
  const resourceTags = new Set(['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE']);
  // Use native fetch for probing — avoids triggering our own network hook
  const nativeFetch = blackbox._getNativeFetch();

  // Pull hostname out without throwing on relative/data: URLs.
  function safeHostname(src) {
    try {
      if (!src || !src.startsWith('http')) return null;
      return new URL(src).hostname;
    } catch {
      return null;
    }
  }

  // Map HEAD probe outcomes to a single urlReachability label so triage in
  // bb-check / panel can branch on cause without re-reading httpStatus +
  // statusHint. Browsers don't expose net::ERR_* names through fetch — we
  // distinguish "origin alive but blocking us" (CORS) from "origin doesn't
  // answer at all" (DNS / connection refused) by attempting a no-cors probe
  // after a cors failure: if no-cors also fails, the origin is unreachable
  // (DNS, TLS, connection-refused all collapse to this — we expose it as
  // unreachable_origin, which is an instant tell that the hostname is dead).
  const handler = (event) => {
    try {
      const target = event.target;
      // Only resource errors, not JS errors
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;

      const tagName = target.tagName.toLowerCase();
      const src = blackbox._stripQueryParams(target.src || target.href || '');

      const hostname = safeHostname(src);
      const context = {
        tagName,
        src,
        hostname,
        id: target.id || null,
        className: (target.className?.toString() || '').slice(0, 100),
      };

      // Capture nearby React component name and a few discriminating
      // data-* attributes so a bare <img> error still tells you which
      // component rendered it. Walks up at most 5 levels.
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
      // Even when we found data-bb, try to pull alt text / title for img tags —
      // it's the cheapest way to identify what role the image plays.
      try {
        if (tagName === 'img') {
          const alt = target.getAttribute('alt');
          if (alt) context.alt = alt.slice(0, 100);
        }
      } catch { /* ignore */ }

      const emit = (reachability, extra) => {
        context.urlReachability = reachability;
        if (extra) Object.assign(context, extra);
        blackbox._recordError({
          message: `Resource failed to load: ${tagName} - ${src}`,
          stack: '',
          source: 'resource_load',
          context
        });
      };

      // Probe URL with HEAD request to classify reachability.
      // (browser error events don't include status codes)
      if (src && src.startsWith('http') && nativeFetch) {
        nativeFetch(src, { method: 'HEAD', mode: 'cors' }).then(res => {
          // Got a real response — reachable. Status tells us if it's a
          // proper HTTP error (404/500) or actually OK (in which case the
          // failure was something else: CORS during img decode, mixed
          // content, etc).
          if (res.status >= 200 && res.status < 400) {
            emit('ok', { httpStatus: res.status });
          } else {
            emit('http_error', { httpStatus: res.status });
          }
        }).catch(() => {
          // No usable response from cors. Try no-cors: if THAT succeeds, the
          // origin is alive — we just can't read it (CORS). If no-cors ALSO
          // fails, the origin itself is unreachable (DNS / refused / TLS).
          nativeFetch(src, { method: 'HEAD', mode: 'no-cors' }).then(() => {
            emit('cors_blocked', { httpStatus: 0 });
          }).catch(() => {
            emit('unreachable_origin', {
              httpStatus: 0,
              // Best-effort hint so users don't have to re-read the field
              // pair to know what to do. "unreachable_origin" is the strong
              // signal that the hostname doesn't resolve.
              statusHint: 'origin_dns_or_refused'
            });
          });
        });
      } else {
        // Probably a data: URL or relative path the browser already
        // resolved to nothing. We can't classify further.
        emit('unknown');
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  window.addEventListener('error', handler, true);

  return () => {
    window.removeEventListener('error', handler, true);
  };
}
