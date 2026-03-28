export function installNetworkHook(blackbox) {
  const config = blackbox._getConfig();
  const originalFetch = window.fetch.bind(window);
  const excludePatterns = config.networkExcludePatterns || [];

  function isExcludedUrl(url) {
    return excludePatterns.some(pattern => url.includes(pattern));
  }

  window.fetch = async function (input, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || String(input);
      url = blackbox._stripQueryParams(url);
      if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
    } catch { /* ignore */ }

    // Skip tracking for excluded URLs (Firestore internal, HMR, etc.)
    if (isExcludedUrl(url)) {
      return originalFetch(input, init);
    }

    const start = Date.now();
    let response;
    blackbox._incrementPendingFetches();

    try {
      response = await originalFetch(input, init);
    } catch (err) {
      blackbox._decrementPendingFetches();
      // Network error (offline, DNS failure, etc.)
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
      throw err; // Re-throw original error
    }

    try {
      const duration = Date.now() - start;
      const status = response.status;
      const ok = response.ok;

      const crumbData = { method, url, status, duration, ok };

      // Capture bodies only if explicitly enabled
      if (config.captureRequestBodies && config.maxBodyLength > 0) {
        try {
          if (init.body) {
            crumbData.requestBody = String(init.body).slice(0, config.maxBodyLength);
          }
        } catch { /* ignore */ }
      }

      // On non-2xx: capture request + response bodies for debugging
      if (!ok) {
        const maxBody = config.maxErrorBodyLength || 1024;
        const errorContext = { status, method, url, duration };

        // Capture request body
        try {
          if (init.body) {
            const bodyStr = typeof init.body === 'string' ? init.body
              : init.body instanceof FormData ? [...init.body.keys()].join(', ')
              : String(init.body);
            errorContext.requestBody = bodyStr.slice(0, maxBody);
          }
        } catch { /* ignore */ }

        // Capture response body (clone to avoid consuming the stream)
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (text) {
            errorContext.responseBody = text.slice(0, maxBody);
            crumbData.responseBody = text.slice(0, 200); // shorter for breadcrumbs
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
          method,
          url,
          duration,
          threshold: config.slowRequestThreshold
        });
      }
    } catch { /* ignore */ }

    blackbox._decrementPendingFetches();
    return response; // Always return original response
  };

  return () => {
    window.fetch = originalFetch;
  };
}
