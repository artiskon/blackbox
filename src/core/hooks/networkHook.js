export function installNetworkHook(blackbox) {
  const config = blackbox._getConfig();
  const nativeFetch = window.fetch.bind(window);
  const excludePatterns = config.networkExcludePatterns || [];

  function isExcludedUrl(url) {
    return excludePatterns.some(pattern => url.includes(pattern));
  }

  // First-seen URL set used to suppress the slow_request breadcrumb the
  // FIRST time we hit any given URL in a session. Rationale: in Next.js
  // dev, the first request to a route triggers a JIT compile that can
  // easily take 5–10s on a cold cache — that's expected and not actionable.
  // The same URL slow on its SECOND hit is real signal worth surfacing.
  // Tiny memory cost (Set of URL strings) and reset on destroy().
  const _firstSeenUrls = new Set();

  // Recognize generic upstream error pages so we don't shove 4 KB of
  // boilerplate HTML into the report. Returns either null (keep body
  // verbatim) or a structured replacement: {summary, kind} that the
  // network hook substitutes for responseBody. Cloudflare and nginx error
  // pages were the most actionable to detect — both leak a helpful one-line
  // status in <title> that beats the surrounding 4 KB of cruft.
  function classifyHtmlErrorPage(text, status) {
    if (!text || text.length < 200) return null;
    const head = text.slice(0, 2000);
    if (!/<html/i.test(head)) return null;

    let titleMatch = head.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : null;

    // Cloudflare-styled error page signals: "Cloudflare" branding, a
    // cf-error-* class, or the ray-id at the bottom. Any one is enough.
    const isCloudflare =
      /cf-error-details|cloudflare-static|cloudflare\.com\/5xx-error-landing|<title>\s*[^<]*\|\s*Cloudflare/i.test(head) ||
      /Cloudflare Ray ID/i.test(text.slice(0, 8000));
    if (isCloudflare) {
      return {
        kind: 'cloudflare_error_page',
        summary: `Cloudflare ${status || ''} page${title ? ` — ${title}` : ''}`.trim()
      };
    }

    if (/<center>\s*<h1>\s*\d{3}/i.test(head) && /nginx/i.test(text.slice(0, 4000))) {
      return {
        kind: 'nginx_error_page',
        summary: `nginx ${status || ''} page${title ? ` — ${title}` : ''}`.trim()
      };
    }

    // Generic HTML upstream error — still worth collapsing so the report
    // shows "[HTML upstream error: <title>]" instead of <!DOCTYPE html>...
    if (status && status >= 500) {
      return {
        kind: 'html_error_page',
        summary: `HTML ${status} page${title ? ` — ${title}` : ''}`.trim()
      };
    }
    return null;
  }

  // Prevent double-recording when wrapper chain grows from HMR re-patching
  let _bbRecording = false;

  function createFetchWrapper(baseFetch) {
    const wrapped = async function (input, init = {}) {
      // If already being recorded by an outer BB wrapper in the chain, just pass through
      if (_bbRecording) {
        return baseFetch(input, init);
      }

      const method = (init.method || 'GET').toUpperCase();
      let url = '';
      let isSameOrigin = false;
      try {
        url = typeof input === 'string' ? input : input?.url || String(input);
        url = blackbox._stripQueryParams(url);
        if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
        // Same-origin if relative or matches current origin. Used to gate
        // request-body capture (external hosts may carry API keys).
        if (typeof location !== 'undefined') {
          isSameOrigin = !url.startsWith('http') || url.startsWith(location.origin);
        }
      } catch { /* ignore */ }

      // Skip tracking for excluded URLs (Firestore internal, HMR, etc.)
      if (isExcludedUrl(url)) {
        return baseFetch(input, init);
      }

      _bbRecording = true;

      const start = Date.now();
      let response;
      blackbox._incrementPendingFetches();

      try {
        response = await baseFetch(input, init);
      } catch (err) {
        blackbox._decrementPendingFetches();
        _bbRecording = false;
        try {
          const duration = Date.now() - start;
          const errMsg = err.message || '';

          // Detect CORS blocks — browsers surface this in the TypeError message
          const corsBlocked = /cors|blocked|cross.origin|not allowed by access/i.test(errMsg)
            || (err.name === 'TypeError' && errMsg === 'Failed to fetch');

          const crumbData = { method, url, status: 0, duration, ok: false, error: errMsg };
          const errorContext = { method, url, duration };

          if (corsBlocked) {
            crumbData.cors_blocked = true;
            errorContext.cors_blocked = true;
            // Capture what triggered the preflight — the method and non-simple headers
            errorContext.preflight_trigger_method = method;
            try {
              const SIMPLE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type'];
              const reqHeaders = init.headers;
              const nonSimple = [];
              if (reqHeaders) {
                const entries = reqHeaders instanceof Headers
                  ? [...reqHeaders.entries()]
                  : Object.entries(reqHeaders);
                for (const [k] of entries) {
                  if (!SIMPLE_HEADERS.includes(k.toLowerCase())) nonSimple.push(k);
                }
                // content-type is only "simple" for form values
                const ct = (reqHeaders instanceof Headers ? reqHeaders.get('content-type') : reqHeaders['content-type'] || reqHeaders['Content-Type']) || '';
                if (ct && !ct.startsWith('application/x-www-form-urlencoded') && !ct.startsWith('multipart/form-data') && !ct.startsWith('text/plain')) {
                  nonSimple.push('content-type(' + ct.split(';')[0] + ')');
                }
              }
              if (nonSimple.length > 0) errorContext.preflight_trigger_headers = nonSimple;
              // For non-GET/HEAD/POST methods, the method itself triggers the preflight
              if (!['GET', 'HEAD', 'POST'].includes(method)) {
                errorContext.preflight_reason = 'non-simple method: ' + method;
              } else if (nonSimple.length > 0) {
                errorContext.preflight_reason = 'non-simple headers: ' + nonSimple.join(', ');
              }
            } catch { /* ignore header inspection errors */ }
          }

          blackbox._addBreadcrumb('network', crumbData);
          blackbox._recordError({
            message: `Network error: ${method} ${url} - ${errMsg}`,
            stack: err.stack || '',
            source: 'network',
            context: errorContext
          });
        } catch { /* ignore */ }
        throw err;
      }

      try {
        const duration = Date.now() - start;
        const status = response.status;
        const ok = response.ok;

        const crumbData = { method, url, status, duration, ok };

        // Capture request body on same-origin POST/PUT/PATCH requests so the
        // breadcrumb trail shows WHAT was sent — critical for diagnosing
        // "wrong-branch" bugs where a request returns 200 but with missing
        // params (e.g. missing projectId in an AI chat call). External hosts
        // are skipped to avoid leaking API keys.
        const bodyLimit = config.maxBodyLength > 0 ? config.maxBodyLength : 300;
        const shouldCaptureReqBody =
          config.captureRequestBodies ||
          (isSameOrigin && ['POST', 'PUT', 'PATCH'].includes(method));
        if (shouldCaptureReqBody) {
          try {
            if (init.body) {
              const bodyStr = typeof init.body === 'string' ? init.body
                : init.body instanceof FormData ? '[FormData: ' + [...init.body.keys()].join(', ') + ']'
                : String(init.body);
              crumbData.requestBody = bodyStr.slice(0, bodyLimit);
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
              const classified = classifyHtmlErrorPage(text, status);
              if (classified) {
                // Replace the HTML dump with a one-liner so the report
                // doesn't bury the actual signal under boilerplate.
                errorContext.responseBody = `[${classified.summary}]`;
                errorContext.responseBodyKind = classified.kind;
                crumbData.responseBody = `[${classified.summary}]`;
              } else {
                errorContext.responseBody = text.slice(0, maxBody);
                crumbData.responseBody = text.slice(0, 200);
              }
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

        // slow_request: skip the FIRST occurrence of any URL in this session
        // — in dev mode that's almost always a Next.js cold-compile and not
        // an app-level performance issue. Subsequent slow hits are real signal.
        const isFirstHit = !_firstSeenUrls.has(url);
        if (isFirstHit) _firstSeenUrls.add(url);
        if (ok && duration > config.slowRequestThreshold && !isFirstHit) {
          blackbox._addBreadcrumb('performance', {
            action: 'slow_request',
            method, url, duration,
            threshold: config.slowRequestThreshold
          });
        }
      } catch { /* ignore */ }

      blackbox._decrementPendingFetches();
      _bbRecording = false;
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
