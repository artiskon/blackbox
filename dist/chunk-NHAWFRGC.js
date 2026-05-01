'use client';
import {
  blackbox_default
} from "./chunk-WCMKI43W.js";
import {
  __spreadProps,
  __spreadValues
} from "./chunk-7MPHHMMU.js";

// src/core/hooks/storageHook.js
async function bbR2Fetch(input, init = {}, details = {}) {
  var _a, _b;
  const method = (init.method || "GET").toUpperCase();
  let url = "";
  try {
    url = typeof input === "string" ? input : (input == null ? void 0 : input.url) || String(input);
  } catch (e) {
  }
  let safeUrl = url;
  try {
    safeUrl = blackbox_default._stripQueryParams(url) || url;
  } catch (e) {
  }
  const nativeFetch = (_b = (_a = blackbox_default)._getNativeFetch) == null ? void 0 : _b.call(_a);
  const fetchFn = nativeFetch || fetch;
  const start = Date.now();
  let response;
  try {
    response = await fetchFn(input, init);
  } catch (err) {
    try {
      const duration = Date.now() - start;
      const ctx = __spreadProps(__spreadValues(__spreadValues(__spreadValues({
        method,
        url: safeUrl,
        duration
      }, details.description ? { description: String(details.description).slice(0, 200) } : {}), details.bucket ? { bucket: String(details.bucket).slice(0, 100) } : {}), details.key ? { key: String(details.key).slice(0, 200) } : {}), {
        error: (err == null ? void 0 : err.message) || String(err)
      });
      blackbox_default._addBreadcrumb("network", { method, url: safeUrl, status: 0, duration, ok: false, error: ctx.error, _storage: true });
      blackbox_default._recordError({
        message: `Storage error: ${method} ${safeUrl} - ${ctx.error}`,
        stack: (err == null ? void 0 : err.stack) || "",
        source: "storage",
        context: ctx
      });
    } catch (e) {
    }
    throw err;
  }
  try {
    const duration = Date.now() - start;
    const status = response.status;
    const ok = response.ok;
    const crumb = __spreadValues({
      method,
      url: safeUrl,
      status,
      duration,
      ok,
      _storage: true
    }, details.description ? { description: String(details.description).slice(0, 80) } : {});
    blackbox_default._addBreadcrumb("network", crumb);
    if (!ok) {
      blackbox_default._recordError({
        message: `Storage HTTP ${status}: ${method} ${safeUrl}`,
        stack: "",
        source: "storage",
        context: __spreadValues(__spreadValues(__spreadValues({
          method,
          url: safeUrl,
          status,
          duration
        }, details.description ? { description: String(details.description).slice(0, 200) } : {}), details.bucket ? { bucket: String(details.bucket).slice(0, 100) } : {}), details.key ? { key: String(details.key).slice(0, 200) } : {})
      });
    }
  } catch (e) {
  }
  return response;
}

export {
  bbR2Fetch
};
