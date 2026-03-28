export function installNetworkHook(blackbox) {
  const config = blackbox._getConfig();
  const nativeFetch = window.fetch.bind(window);
  const excludePatterns = config.networkExcludePatterns || [];

  function isExcludedUrl(url) {
    return excludePatterns.some(pattern => url.includes(pattern));
  }

  function createFetchWrapper(baseFetch) {
    const wrapped = async function (input, init = {}) {
      const method = (init.method || 'GET').toUpperCase();
      let url = '';
      try {
        url = typeof input === 'string' ? input : input?.url || String(input);
        url = blackbox._stripQueryParams(url);
        if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
      } catch { /* ignore */ }

      // Skip tracking for excluded URLs (Firestore internal, HMR, etc.)
      if (isExcludedUrl(url)) {
        return baseFetch(input, init);
      }

      const start = Date.now();
      let response;
      blackbox._incrementPendingFetches();

      try {
        response = await baseFetch(input, init);
      } catch (err) {
        blackbox._decrementPendingFetches();
        try {
          const duration = Date.now() - start;
          blackbox._addBreadcrumb('network', { method, url, status: 0, duration, ok: false, error: err.message });
          blackbox._recordError({
            message: `Network error: ${method} ${url} - ${err.message}`,
            stack: err.stack || '',
            source: 'network',
            context: { method, url, duration }
          });
        } catch { /* ignore */ }
        throw err;
      }

      try {
        const duration = Date.now() - start;
        const status = response.status;
        const ok = response.ok;

        const crumbData = { method, url, status, duration, ok };

        if (config.captureRequestBodies && config.maxBodyLength > 0) {
          try {
            if (init.body) {
              crumbData.requestBody = String(init.body).slice(0, config.maxBodyLength);
            }
          } catch { /* ignore */ }
        }

        if (!ok) {
          const maxBody = config.maxErrorBodyLength || 1024;
          const errorContext = { status, method, url, duration };

          try {
            if (init.body) {
              const bodyStr = typeof init.body === 'string' ? init.body
                : init.body instanceof FormData ? [...init.body.keys()].join(', ')
                : String(init.body);
              errorContext.requestBody = bodyStr.slice(0, maxBody);
            }
          } catch { /* ignore */ }

          try {
            const cloned = response.clone();
            const text = await cloned.text();
            if (text) {
              errorContext.responseBody = text.slice(0, maxBody);
              crumbData.responseBody = text.slice(0, 200);
            }
          } catch { /* ignore */ }

          blackbox._addBreadcrumb('network', crumbData);

          blackbox._recordError({
            message: `HTTP ${status}: ${method} ${url}`,
            stack: '',
            source: 'network',
            context: errorContext
          });
        } else {
          blackbox._addBreadcrumb('network', crumbData);
        }

        if (ok && duration > config.slowRequestThreshold) {
          blackbox._addBreadcrumb('performance', {
            action: 'slow_request',
            method, url, duration,
            threshold: config.slowRequestThreshold
          });
        }
      } catch { /* ignore */ }

      blackbox._decrementPendingFetches();
      return response;
    };
    wrapped.__bb_hooked = true;
    return wrapped;
  }

  // Initial patch — wrap whatever fetch is current (may already be Next.js's wrapper)
  function patchFetch() {
    if (window.fetch.__bb_hooked) return;
    window.fetch = createFetchWrapper(window.fetch);
  }

  patchFetch();

  // Re-check every 2s in case Next.js/Turbopack re-wraps fetch (HMR, etc.)
  const repatchInterval = setInterval(patchFetch, 2000);

  return () => {
    clearInterval(repatchInterval);
    window.fetch = nativeFetch;
  };
}
