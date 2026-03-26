export function installNetworkHook(blackbox) {
  const config = blackbox._getConfig();
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || String(input);
      url = blackbox._stripQueryParams(url);
      if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
    } catch { /* ignore */ }

    const start = Date.now();
    let response;

    try {
      response = await originalFetch(input, init);
    } catch (err) {
      // Network error (offline, DNS failure, etc.)
      try {
        const duration = Date.now() - start;
        blackbox._addBreadcrumb('network', { method, url, status: 0, duration: `${duration}ms`, ok: false, error: err.message });
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

      const crumbData = { method, url, status, duration: `${duration}ms`, ok };

      // Capture bodies only if explicitly enabled
      if (config.captureRequestBodies && config.maxBodyLength > 0) {
        try {
          if (init.body) {
            crumbData.requestBody = String(init.body).slice(0, config.maxBodyLength);
          }
        } catch { /* ignore */ }
      }

      blackbox._addBreadcrumb('network', crumbData);

      if (!ok) {
        blackbox._recordError({
          message: `HTTP ${status}: ${method} ${url}`,
          stack: '',
          source: 'network',
          context: { status, method, url, duration }
        });
      }

      if (ok && duration > config.slowRequestThreshold) {
        blackbox._addBreadcrumb('performance', {
          action: 'slow_request',
          method,
          url,
          duration: `${duration}ms`,
          threshold: config.slowRequestThreshold
        });
      }
    } catch { /* ignore */ }

    return response; // Always return original response
  };

  return () => {
    window.fetch = originalFetch;
  };
}
