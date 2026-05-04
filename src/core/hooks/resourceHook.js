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

  // Headers we want to surface from a probe response — they materially
  // change diagnosis (cf-ray identifies which Cloudflare PoP, x-amz-* /
  // x-mediaitem identify the upstream/route, content-type tells image
  // vs error-page, content-length disambiguates "empty 200" from real).
  const PROBE_HEADER_ALLOWLIST = [
    'cf-ray',
    'cf-cache-status',
    'content-type',
    'content-length',
    'x-amz-request-id',
    'x-amz-id-2',
    'x-mediaitem',
    'x-version',
    'x-served-by',
    'server',
  ];
  function pickHeaders(headers) {
    const out = {};
    try {
      for (const name of PROBE_HEADER_ALLOWLIST) {
        const v = headers.get?.(name);
        if (v) out[name] = String(v).slice(0, 200);
      }
    } catch { /* ignore */ }
    return Object.keys(out).length > 0 ? out : null;
  }

  // Reachability is the single most-asked field from this hook. Values:
  //   'ok'                       — server responded 2xx/3xx (probable img-decode issue)
  //   'http_error'               — server responded 4xx/5xx (status in httpStatus)
  //   'tag_content_type_mismatch'— server returned 200 but the content-type can't
  //                                  be rendered by the host tag (e.g. <img src>
  //                                  pointed at video/mp4 or application/pdf).
  //                                  Common when an asset-id mapping renders the
  //                                  wrong file in the wrong element. Burned an
  //                                  agent ~15 min in BB-1.8 chasing CORS.
  //   'opaque_response'          — server responded but cors prevented status read.
  //                                  DOES NOT mean CORS is the cause — a 404 served
  //                                  without CORS headers also lands here. Caller
  //                                  should check the Network tab to disambiguate.
  //                                  (Replaces the old, misleading 'cors_blocked'.)
  //   'unreachable_origin'       — DNS / TLS / connection refused (origin doesn't answer)
  //   'unknown'                  — couldn't probe (data: URL, relative path, etc.)

  // Maps each tag to the content-type families it can actually render. Used to
  // detect "img tag receiving video bytes" mismatches once we have the probe's
  // content-type header.
  const TAG_CONTENT_TYPES = {
    img: /^image\//i,
    script: /^(application|text)\/(javascript|ecmascript|json)/i,
    link: /^text\/css/i,
    video: /^video\//i,
    audio: /^audio\//i,
    source: /^(video|audio|image)\//i,
  };
  function detectTagMismatch(tag, contentType) {
    if (!contentType || !tag) return null;
    const expected = TAG_CONTENT_TYPES[tag];
    if (!expected) return null;
    // Strip parameters (charset etc.) — just the type/subtype matters here.
    const ct = contentType.split(';')[0].trim();
    if (expected.test(ct)) return null;
    return ct;
  }
  const handler = (event) => {
    try {
      const target = event.target;
      // Only resource errors, not JS errors
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;

      const tagName = target.tagName.toLowerCase();
      // rawSrc keeps the query string intact (signed-URL tokens, ?mode=
      // selectors, cache busters). Used for the probe (so we hit the
      // actual response the browser saw) and exposed as the ephemeral
      // context._rawSrc surface for diagnostic matchers. Stripped src
      // is what we persist for fingerprint stability and privacy.
      const rawSrc = target.src || target.href || '';
      const src = blackbox._stripQueryParams(rawSrc);

      const hostname = safeHostname(src);
      const context = {
        tagName,
        src,
        hostname,
        id: target.id || null,
        className: (target.className?.toString() || '').slice(0, 100),
        // Underscore-prefixed: ephemeral, stripped before persistence and
        // before panel report export. Visible to registerDiagnostic match
        // functions so they can match on the original URL with query.
        ...(rawSrc !== src ? { _rawSrc: rawSrc } : {}),
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

      // Try a small Range GET so we can read both real status AND a body
      // preview — the body preview is what tells us "the URL returned a
      // JSON {error: ...}" vs "the URL returned an HTML 404 page" vs
      // "the URL is actually an image but the browser couldn't decode."
      // Range header keeps the data tiny even on accidental large bodies.
      // If GET fails (CORS, network), fall through to a no-cors HEAD to
      // distinguish reachable-but-opaque from origin-down.
      //
      // Probe the rawSrc (with query params): the params often determine
      // the response (signed-URL tokens, ?mode= selectors). Stripping them
      // before the probe — as we did pre-1.9.3 — caused a tag_content_type_
      // mismatch demo to misclassify, because the probe hit the bare
      // endpoint instead of the URL the browser actually loaded.
      if (rawSrc && rawSrc.startsWith('http') && nativeFetch) {
        nativeFetch(rawSrc, {
          method: 'GET',
          mode: 'cors',
          headers: { Range: 'bytes=0-512' },
        }).then(async res => {
          const headers = pickHeaders(res.headers);
          let bodyPreview = null;
          try {
            const text = await res.clone().text();
            if (text) bodyPreview = text.slice(0, 200);
          } catch { /* ignore — body unreadable */ }
          const extra = {
            httpStatus: res.status,
            ...(headers ? { responseHeaders: headers } : {}),
            ...(bodyPreview ? { responseBodyPreview: bodyPreview } : {}),
          };
          if (res.status >= 200 && res.status < 400) {
            // 200 OK but the body might still be the wrong KIND for the tag
            // — e.g. an image-id mapping bug that puts video bytes into <img>.
            // The browser raises a generic resource-load error event with no
            // status; without this check BB would've labeled it 'ok' and
            // sent the dev down the wrong rabbit hole.
            const mismatchType = detectTagMismatch(tagName, headers?.['content-type']);
            if (mismatchType) {
              emit('tag_content_type_mismatch', {
                ...extra,
                contentType: mismatchType,
                action_hint: `<${tagName}> tag received "${mismatchType}" — element rendered the wrong KIND of file. Check the asset-id / URL mapping at the call site.`,
              });
            } else {
              emit('ok', extra);
            }
          } else {
            emit('http_error', extra);
          }
        }).catch(() => {
          // CORS prevented us from reading the response (or the origin is
          // dead). Use no-cors HEAD to disambiguate the two — but DO NOT
          // claim it was CORS-blocked: an origin returning 404 without
          // CORS headers also lands here, and that misleading label burned
          // ~20 min of debugging in two separate sessions.
          nativeFetch(rawSrc, { method: 'HEAD', mode: 'no-cors' }).then(() => {
            emit('opaque_response', {
              httpStatus: 0,
              statusHint: 'reachable_but_status_unknown_check_network_tab'
            });
          }).catch(() => {
            emit('unreachable_origin', {
              httpStatus: 0,
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
