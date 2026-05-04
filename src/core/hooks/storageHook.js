import blackbox from '../blackbox.js';

/**
 * Wrap a fetch call against object storage (Cloudflare R2, S3, GCS, etc.)
 * so the resulting breadcrumbs and any error are tagged with
 * `source: 'storage'` instead of the generic `source: 'network'`. This
 * gives bb-check a discriminator: `bb-check --source=storage` shows only
 * storage failures, separate from API/network noise.
 *
 * Pass a description ("upload avatar", "fetch private url") so the
 * breadcrumb is self-explanatory even when the URL is opaque (signed
 * URLs lose all meaning once decoded).
 *
 * Usage:
 *   const res = await bbR2Fetch(signedUrl, { method: 'PUT', body }, {
 *     description: 'upload avatar',
 *     bucket: 'tiskon-media-private',
 *     key: `users/${uid}/avatar.jpg`,
 *   });
 *
 * The wrapper preserves the underlying fetch's return value and rethrows
 * errors verbatim — it never alters the call's success/failure shape.
 */
export async function bbR2Fetch(input, init = {}, details = {}) {
  const method = (init.method || 'GET').toUpperCase();
  let url = '';
  try {
    url = typeof input === 'string' ? input : input?.url || String(input);
  } catch { /* ignore */ }

  // Strip query (signed URLs carry signing tokens) before logging. The raw
  // URL stays available to registerDiagnostic match functions via the
  // ephemeral context._rawUrl field below — never persisted.
  let safeUrl = url;
  try { safeUrl = blackbox._stripQueryParams(url) || url; } catch { /* ignore */ }

  // Use native fetch so the network hook doesn't also record this — we'd
  // otherwise emit one storage breadcrumb plus one network breadcrumb plus
  // potentially two error rows for the same failure. The network hook keeps
  // a reference to the pre-patch fetch via blackbox._getNativeFetch().
  const nativeFetch = blackbox._getNativeFetch?.();
  const fetchFn = nativeFetch || fetch;

  const start = Date.now();
  let response;
  try {
    response = await fetchFn(input, init);
  } catch (err) {
    try {
      const duration = Date.now() - start;
      const ctx = {
        method,
        url: safeUrl,
        duration,
        ...(details.description ? { description: String(details.description).slice(0, 200) } : {}),
        ...(details.bucket ? { bucket: String(details.bucket).slice(0, 100) } : {}),
        ...(details.key ? { key: String(details.key).slice(0, 200) } : {}),
        error: err?.message || String(err),
        ...(url !== safeUrl ? { _rawUrl: url } : {}),
      };
      blackbox._addBreadcrumb('network', { method, url: safeUrl, status: 0, duration, ok: false, error: ctx.error, _storage: true });
      blackbox._recordError({
        message: `Storage error: ${method} ${safeUrl} - ${ctx.error}`,
        stack: err?.stack || '',
        source: 'storage',
        context: ctx
      });
    } catch { /* ignore */ }
    throw err;
  }

  try {
    const duration = Date.now() - start;
    const status = response.status;
    const ok = response.ok;
    const crumb = {
      method, url: safeUrl, status, duration, ok, _storage: true,
      ...(details.description ? { description: String(details.description).slice(0, 80) } : {}),
    };
    blackbox._addBreadcrumb('network', crumb);
    if (!ok) {
      blackbox._recordError({
        message: `Storage HTTP ${status}: ${method} ${safeUrl}`,
        stack: '',
        source: 'storage',
        context: {
          method,
          url: safeUrl,
          status,
          duration,
          ...(details.description ? { description: String(details.description).slice(0, 200) } : {}),
          ...(details.bucket ? { bucket: String(details.bucket).slice(0, 100) } : {}),
          ...(details.key ? { key: String(details.key).slice(0, 200) } : {}),
          ...(url !== safeUrl ? { _rawUrl: url } : {}),
        }
      });
    }
  } catch { /* ignore */ }

  return response;
}
