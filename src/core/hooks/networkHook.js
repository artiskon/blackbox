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

  // Read at most maxChars of a response body, giving up after timeoutMs, so
  // a streaming (SSE / long-poll) or huge error body can never stall us.
  // Cancelling the clone's reader leaves the app's own body untouched.
  async function readBodyPreview(res, maxChars, timeoutMs) {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs, null); });
    const reader = res.body?.getReader?.();
    try {
      // No body stream (polyfilled fetch): whole text, still time-boxed
      if (!reader) return (await Promise.race([res.text(), timeout])) || '';
      const decoder = new TextDecoder();
      let text = '';
      while (text.length < maxChars) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    } finally {
      clearTimeout(timer);
      try { reader?.cancel().catch(() => {}); } catch { /* ignore */ }
    }
  }

  // Mask values of secret-looking keys (password, token, secret, api key,
  // authorization) in JSON and urlencoded request bodies before they're
  // stored, so login forms and token refreshes don't land in Firestore.
  // Key text around the keyword is bounded ({0,40}): an unbounded [^"=&]*
  // backtracks quadratically on big bodies that mention "token" a lot (an
  // AI-chat POST froze the page for seconds), and this runs before the app
  // gets its response. Bounded, it stays linear on the full body, so a long
  // secret that starts before the stored cut is still redacted.
  const SECRET_KEY = '[^"=&]{0,40}(?:passw(?:or)?d|passcode|token|secret|authoriz|api[_-]?key)[^"=&]{0,40}';
  const SECRET_JSON = new RegExp(`("${SECRET_KEY}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');
  const SECRET_FORM = new RegExp(`((?:^|&)${SECRET_KEY}=)[^&]*`, 'gi');
  function redactBody(str) {
    return /^\s*[[{]/.test(str)
      ? str.replace(SECRET_JSON, '$1"[redacted]"')
      : str.replace(SECRET_FORM, '$1[redacted]');
  }

  // Marks the init an outer BB wrapper forwards, so an inner BB wrapper (the
  // chain grows when HMR / Next.js re-patches fetch) passes the call through
  // instead of recording it twice. A per-call mark, not a shared flag held
  // across an await: that made every fetch overlapping another in-flight one
  // pass through unrecorded. Symbol.for so separately evaluated copies of
  // this module agree; fetch ignores unknown keys.
  const BB_MARK = Symbol.for('bb.fetch.recorded');
  function markInit(init) {
    // Only plain objects: spreading a Request (or other class) passed as
    // init would drop its getter-backed method/headers/body. Those go
    // through unmarked; worst case is a double record, never a changed call.
    const proto = init ? Object.getPrototypeOf(init) : Object.prototype;
    return proto === Object.prototype || proto === null ? { ...init, [BB_MARK]: true } : init;
  }

  // Shared by the fetch wrapper and the XHR patch below. rawUrl keeps the
  // query for the ephemeral _rawUrl key; url is what gets persisted.
  function describeRequest(method, rawInput) {
    const req = { method, url: '', rawUrl: '', isSameOrigin: false };
    try {
      req.rawUrl = String(rawInput);
      req.url = blackbox._stripQueryParams(req.rawUrl);
      if (req.url.length > config.maxUrlLength) req.url = req.url.slice(0, config.maxUrlLength);
      if (req.rawUrl.length > config.maxUrlLength) req.rawUrl = req.rawUrl.slice(0, config.maxUrlLength);
      // Real origin comparison, not a prefix test ('//other.com/x' and
      // 'https://app.com.evil.net' are cross-origin). Gates request-body
      // capture (external hosts may carry API keys).
      if (typeof location !== 'undefined') {
        req.isSameOrigin = new URL(req.rawUrl, location.href).origin === location.origin;
      }
    } catch { /* ignore */ }
    return req;
  }

  // Request that never got a response (network error, abort, timeout).
  // reqHeaders feeds the CORS preflight hint; null when unreadable (XHR).
  const PROBE_TIMEOUT_MS = 2000;
  function recordNetworkError(req, duration, errMsg, stack, aborted, reqHeaders) {
    const { method, url, rawUrl, isSameOrigin } = req;
    const crumbData = { method, url, status: 0, duration, ok: false, error: errMsg, ...(aborted ? { aborted: true } : {}) };
    blackbox._addBreadcrumb('network', crumbData);
    if (aborted) return;

    // Underscore-prefixed: ephemeral, stripped before persistence and
    // panel report export. Visible to registerDiagnostic match
    // functions so they can match on URLs whose query params determine
    // the response (signed-URL tokens, ?mode= selectors, etc).
    const errorContext = { method, url, duration, ...(rawUrl !== url ? { _rawUrl: rawUrl } : {}) };
    const record = () => blackbox._recordError({
      message: `Network error: ${method} ${url} - ${errMsg}`,
      stack: stack || '',
      source: 'network',
      context: errorContext
    });

    // Chrome says "Failed to fetch" for CORS, DNS failure, refused
    // connection, offline and ad-blockers alike, so CORS is never
    // inferred from the message (ADR-0007). Same-origin can't be
    // CORS. Cross-origin: a no-cors HEAD tells reachable-but-blocked
    // from origin-down, then the error is recorded. The probe is capped
    // at PROBE_TIMEOUT_MS: a hung server (the usual cause of a timed-out
    // request) would hang the HEAD too and the row would never land.
    const probeFetch = blackbox._getNativeFetch?.();
    if (isSameOrigin || !probeFetch || !/^(https?:)?\/\//i.test(rawUrl)) {
      record();
      return;
    }
    const probeCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let probeTimer;
    let probeTimedOut = false;
    Promise.race([
      probeFetch(rawUrl, markInit({ method: 'HEAD', mode: 'no-cors', signal: probeCtl?.signal })),
      new Promise((_, reject) => {
        probeTimer = setTimeout(() => { probeTimedOut = true; probeCtl?.abort(); reject(); }, PROBE_TIMEOUT_MS);
      })
    ]).then(() => {
      errorContext.urlReachability = 'opaque_response';
      errorContext.statusHint = 'reachable_but_request_blocked_cors_likely_check_network_tab';
      // What would trigger a CORS preflight, if CORS is the cause
      try {
        const preflight = { method };
        const SIMPLE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type'];
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
        if (nonSimple.length > 0) preflight.headers = nonSimple;
        // For non-GET/HEAD/POST methods, the method itself triggers the preflight
        if (!['GET', 'HEAD', 'POST'].includes(method)) {
          preflight.reason = 'non-simple method: ' + method;
        } else if (nonSimple.length > 0) {
          preflight.reason = 'non-simple headers: ' + nonSimple.join(', ');
        }
        errorContext.preflight_if_cors = preflight;
      } catch { /* ignore header inspection errors */ }
    }, () => {
      if (probeTimedOut) {
        errorContext.urlReachability = 'unknown';
        errorContext.statusHint = 'probe_timed_out_origin_slow_or_hung';
      } else {
        errorContext.urlReachability = 'unreachable_origin';
        errorContext.statusHint = 'origin_dns_or_refused';
      }
    }).then(() => {
      clearTimeout(probeTimer);
      try { record(); } catch { /* ignore */ }
    });
  }

  // Request that got a response. isError is false for opaque responses
  // (status 0 by design). readErrorBody(maxChars) returns the error body
  // text (or a promise of it); it runs after the app already has its
  // response, so the app never waits on it.
  function recordResponse(req, crumbData, isError, body, readErrorBody) {
    const { method, url, rawUrl, isSameOrigin } = req;
    const { status, duration, ok } = crumbData;

    // Capture request body on same-origin POST/PUT/PATCH requests so the
    // breadcrumb trail shows WHAT was sent — critical for diagnosing
    // "wrong-branch" bugs where a request returns 200 but with missing
    // params (e.g. missing projectId in an AI chat call). External hosts
    // are skipped (unless captureRequestBodies) to avoid leaking API
    // keys, and secret-looking values are redacted.
    const bodyLimit = config.maxBodyLength > 0 ? config.maxBodyLength : 300;
    const shouldCaptureReqBody =
      config.captureRequestBodies ||
      (isSameOrigin && ['POST', 'PUT', 'PATCH'].includes(method));
    if (shouldCaptureReqBody) {
      try {
        if (body) {
          const bodyStr = typeof body === 'string' ? body
            : body instanceof FormData ? '[FormData: ' + [...body.keys()].join(', ') + ']'
            : String(body);
          crumbData.requestBody = redactBody(bodyStr).slice(0, bodyLimit);
        }
      } catch { /* ignore */ }
    }

    // Crumb goes in now, before the app sees the response, so an app error
    // raised on `!res.ok` has the failing request in its breadcrumbs. Only
    // the error row waits for the body; the body lives on its context.
    blackbox._addBreadcrumb('network', crumbData);

    if (isError) {
      const maxBody = config.maxErrorBodyLength || 1024;
      const errorContext = { status, method, url, duration, ...(rawUrl !== url ? { _rawUrl: rawUrl } : {}) };

      // Same gate as the breadcrumb: external hosts only when opted in
      if (config.captureRequestBodies || isSameOrigin) {
        try {
          if (body) {
            const bodyStr = typeof body === 'string' ? body
              : body instanceof FormData ? [...body.keys()].join(', ')
              : String(body);
            errorContext.requestBody = redactBody(bodyStr).slice(0, maxBody);
          }
        } catch { /* ignore */ }
      }

      // Error body capped at 8 KB (the window classifyHtmlErrorPage scans,
      // ADR-0004).
      void (async () => {
        try {
          const text = await readErrorBody(Math.max(maxBody, 8192));
          if (text) {
            const classified = classifyHtmlErrorPage(text, status);
            if (classified) {
              // Replace the HTML dump with a one-liner so the report
              // doesn't bury the actual signal under boilerplate.
              errorContext.responseBody = `[${classified.summary}]`;
              errorContext.responseBodyKind = classified.kind;
            } else {
              errorContext.responseBody = text.slice(0, maxBody);
            }
          }
        } catch { /* ignore */ }

        try {
          blackbox._recordError({
            message: `HTTP ${status}: ${method} ${url}`,
            stack: '',
            source: 'network',
            context: errorContext
          });
        } catch { /* ignore */ }
      })();
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
  }

  function createFetchWrapper(baseFetch) {
    const wrapped = async function (input, init) {
      // If already being recorded by an outer BB wrapper in the chain, just pass through
      if (init && init[BB_MARK]) {
        return baseFetch(input, init);
      }

      // fetch(url, null) is valid. A Request input carries its own method
      // and headers; its body is a stream we must not consume, so only an
      // init body is captured.
      const opts = init || {};
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const method = (opts.method || request?.method || 'GET').toUpperCase();
      let rawInput = '';
      try { rawInput = typeof input === 'string' ? input : input?.url || String(input); } catch { /* ignore */ }
      const req = describeRequest(method, rawInput);

      // Skip tracking for excluded URLs (Firestore internal, HMR, etc.)
      if (isExcludedUrl(req.url)) {
        return baseFetch(input, init);
      }

      const start = Date.now();
      let response;
      blackbox._incrementPendingFetches();

      try {
        response = await baseFetch(input, markInit(init));
      } catch (err) {
        blackbox._decrementPendingFetches();
        try {
          // Intentional cancel (AbortController, effect cleanup, query
          // cancellation) isn't a failure: breadcrumb only, no error row.
          // abort(reason) rejects with the reason itself, so also trust the
          // signal. Timeouts (AbortSignal.timeout) still record.
          const signal = opts.signal || input?.signal;
          const aborted = err?.name === 'AbortError' || (!!signal?.aborted && err?.name !== 'TimeoutError');
          recordNetworkError(req, Date.now() - start, err?.message || '', err?.stack, aborted, opts.headers ?? request?.headers);
        } catch { /* ignore */ }
        throw err;
      }

      try {
        const crumbData = { method, url: req.url, status: response.status, duration: Date.now() - start, ok: response.ok };
        // no-cors and redirect:'manual' responses are status 0 / ok:false even
        // on success: status unknown is not a failure (ADR-0007).
        const opaque = response.type === 'opaque' || response.type === 'opaqueredirect';
        if (opaque) crumbData.responseType = response.type;
        const isError = !response.ok && !opaque;

        // Clone before returning (the app may consume the body); the read is
        // time-boxed (~1.5s) so a streaming error body can't hold the record.
        let cloned = null;
        if (isError) {
          try { cloned = response.clone(); } catch { /* ignore */ }
        }
        recordResponse(req, crumbData, isError, opts.body,
          (maxChars) => (cloned ? readBodyPreview(cloned, maxChars, 1500) : ''));
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

  // XMLHttpRequest: axios's browser adapter and the Firebase Storage SDK
  // don't use fetch. Same records as the fetch wrapper, except request
  // headers can't be read back (no preflight hint). No repatch interval:
  // frameworks don't re-wrap the XHR prototype the way Next re-wraps fetch.
  const xhrProto = typeof XMLHttpRequest !== 'undefined' && !XMLHttpRequest.prototype.send.__bb_hooked
    ? XMLHttpRequest.prototype
    : null;
  const nativeOpen = xhrProto?.open;
  const nativeSend = xhrProto?.send;
  const xhrRequests = new WeakMap();
  // Cleared on teardown: a layer left under someone else's XHR patch
  // becomes a pass-through instead of being ripped out from under them
  let xhrActive = true;
  let patchedOpen = null, patchedSend = null;
  if (xhrProto) {
    xhrProto.open = patchedOpen = function (method, url) {
      if (!xhrActive) return nativeOpen.apply(this, arguments);
      try { xhrRequests.set(this, describeRequest(String(method || 'GET').toUpperCase(), url)); } catch { /* ignore */ }
      // arguments, not named params: an explicit undefined `async` means sync
      return nativeOpen.apply(this, arguments);
    };
    xhrProto.send = patchedSend = function (body) {
      const req = xhrRequests.get(this);
      if (!xhrActive || !req || isExcludedUrl(req.url)) return nativeSend.apply(this, arguments);

      const xhr = this;
      const start = Date.now();
      const events = ['load', 'error', 'abort', 'timeout', 'loadend'];
      let outcome = 'error';
      const onEvent = (e) => {
        if (e.type !== 'loadend') { outcome = e.type; return; }
        for (const type of events) xhr.removeEventListener(type, onEvent);
        blackbox._decrementPendingFetches();
        // open() again mid-flight drops the request without events; this
        // loadend then belongs to the next request, which records itself.
        if (xhrRequests.get(xhr) !== req) return;
        try {
          const duration = Date.now() - start;
          if (outcome !== 'load') {
            recordNetworkError(req, duration, `XHR ${outcome}`, '', outcome === 'abort', null);
          } else {
            const status = xhr.status;
            const ok = status >= 200 && status < 300;
            recordResponse(req, { method: req.method, url: req.url, status, duration, ok }, !ok, body,
              () => (xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : ''));
          }
        } catch { /* ignore */ }
      };
      for (const type of events) xhr.addEventListener(type, onEvent);
      blackbox._incrementPendingFetches();
      try {
        return nativeSend.apply(this, arguments);
      } catch (err) {
        // Threw before any event fired (not opened, sync network error)
        for (const type of events) xhr.removeEventListener(type, onEvent);
        blackbox._decrementPendingFetches();
        throw err;
      }
    };
    xhrProto.send.__bb_hooked = true;
  }

  return () => {
    clearInterval(repatchInterval);
    window.fetch = nativeFetch;
    xhrActive = false;
    // Restore only while our patch is still on top (same rule as the
    // console and navigation hooks), so a later Sentry/Datadog/mock XHR
    // patch keeps working
    if (xhrProto) {
      if (xhrProto.open === patchedOpen) xhrProto.open = nativeOpen;
      if (xhrProto.send === patchedSend) xhrProto.send = nativeSend;
    }
  };
}
