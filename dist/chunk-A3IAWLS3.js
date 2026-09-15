import {
  __objRest,
  __spreadProps,
  __spreadValues,
  _resetPersistence,
  extractTopAppFrame,
  generateFingerprint,
  getCollectionRef,
  getFirestoreFunctions,
  getPersistenceConfig,
  initPersistence,
  isCircuitOpen,
  isStackEntirelyInternal,
  toFirestoreSafe
} from "./chunk-3QPKAOHJ.js";

// src/core/constants.js
var DEFAULTS = {
  collectionName: "__blackbox",
  maxBreadcrumbs: 80,
  slowRequestThreshold: 3e3,
  silenceDetectionDelay: 2e3,
  maxMessageLength: 2e3,
  maxUrlLength: 500,
  maxBodyLength: 0,
  maxErrorBodyLength: 1024,
  maxClassNameLength: 200,
  maxBreadcrumbRepeat: 3,
  activityFlushInterval: 12e4,
  schemaVersion: 1,
  // Persistence
  maxWriteFailures: 3,
  maxDocumentBytes: 5e5,
  // Privacy
  stripQueryParams: true,
  captureRequestBodies: false,
  consoleIgnorePatterns: [
    "Warning: Each child in a list",
    "Warning: Can't perform a React state update on an unmounted",
    "Download the React DevTools",
    "Warning: ReactDOM.render is no longer supported"
  ],
  sanitize: null,
  // Error filtering — suppress known errors by message substring
  errorExcludePatterns: [],
  // Network noise filtering
  networkExcludePatterns: [
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    // Firebase Auth token refresh
    "__nextjs_original-stack-frames",
    "hot-update"
  ],
  // Context tagging
  environment: null,
  tags: {},
  user: null,
  // Build / deploy provenance — auto-detected from common host env vars
  // when not provided. Surfaces "this error came from build X / env Y"
  // in the panel and bb-check, so devs can tell stale-vs-fresh at a glance.
  buildSha: null,
  nodeEnv: null
};

// src/core/session.js
function generateSessionId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// src/core/breadcrumbs.js
var BreadcrumbManager = class {
  constructor(maxSize = 80, maxRepeat = 3) {
    this._buffer = [];
    this._maxSize = maxSize;
    this._maxRepeat = maxRepeat;
  }
  add(type, data) {
    const breadcrumb = __spreadValues({
      type,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }, data);
    const last = this._buffer[this._buffer.length - 1];
    if (last && last.type === type && this._isSameEvent(type, last, breadcrumb)) {
      const repeatCount = last.repeatCount || 1;
      if (repeatCount < this._maxRepeat) {
        last.repeatCount = repeatCount + 1;
        last.timestamp = breadcrumb.timestamp;
        return last;
      }
    }
    this._buffer.push(breadcrumb);
    if (this._buffer.length > this._maxSize) {
      this._buffer.shift();
    }
    return breadcrumb;
  }
  _isSameEvent(type, a, b) {
    switch (type) {
      case "click":
        return a.tag === b.tag && a.id === b.id && a.text === b.text;
      case "navigation":
        return a.to === b.to;
      case "network":
        return a.method === b.method && a.url === b.url;
      case "warning":
      case "console":
        return a.message === b.message;
      default:
        return a.action === b.action;
    }
  }
  snapshot() {
    return Object.freeze(this._buffer.map((b) => __spreadValues({}, b)));
  }
  clear() {
    this._buffer = [];
  }
  size() {
    return this._buffer.length;
  }
};

// src/core/hooks/errorHook.js
function installErrorHook(blackbox2) {
  const errorHandler = (event) => {
    var _a;
    try {
      const message = event.message || "Unknown error";
      const stack = ((_a = event.error) == null ? void 0 : _a.stack) || `${event.filename || ""}:${event.lineno || 0}:${event.colno || 0}`;
      blackbox2._recordError({ message, stack, source: "window.onerror", context: {} });
    } catch (e) {
    }
  };
  const rejectionHandler = (event) => {
    try {
      const reason = event.reason;
      const isObject = reason !== null && typeof reason === "object";
      const isResponse = isObject && typeof Response !== "undefined" && reason instanceof Response;
      const context = {};
      let message;
      if (reason instanceof Error) {
        message = reason.message || String(reason);
      } else if (typeof (reason == null ? void 0 : reason.message) === "string" && reason.message) {
        message = reason.message;
      } else if (!isObject) {
        message = String(reason);
      } else if (isResponse) {
        message = `HTTP ${reason.status} ${blackbox2._stripQueryParams(reason.url) || ""}`.trim();
      } else if (typeof reason.error === "string" && reason.error) {
        message = reason.error;
      } else if (typeof reason.code === "string" && reason.code) {
        message = reason.code;
      } else {
        try {
          message = JSON.stringify(reason);
        } catch (e) {
        }
        if (!message || message === "{}") message = Object.prototype.toString.call(reason);
      }
      if (!(reason instanceof Error)) context.reasonType = isResponse ? "Response" : reason === null ? "null" : typeof reason;
      const isPrimitive = (v) => typeof v === "string" || typeof v === "number";
      if (isObject && isPrimitive(reason.code)) context.code = reason.code;
      if (isObject && isPrimitive(reason.status)) context.status = reason.status;
      const stack = typeof (reason == null ? void 0 : reason.stack) === "string" ? reason.stack : "";
      blackbox2._recordError({ message, stack, source: "unhandled_promise", context });
    } catch (e) {
    }
  };
  window.addEventListener("error", errorHandler);
  window.addEventListener("unhandledrejection", rejectionHandler);
  return () => {
    window.removeEventListener("error", errorHandler);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}

// src/core/hooks/clickHook.js
function installClickHook(blackbox2) {
  const config = blackbox2._getConfig();
  function synthesizeLabel(el, editable) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    if (!(el == null ? void 0 : el.getAttribute)) return null;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.slice(0, 100);
    const title = el.getAttribute("title");
    if (title) return title.slice(0, 100);
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt) return alt.slice(0, 100);
    }
    if (tag === "input" || tag === "textarea") {
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return `[${placeholder.slice(0, 50)}]`;
      if (["submit", "button", "reset"].includes(el.type)) {
        if (el.value) return el.value.slice(0, 50);
      } else {
        const labelText = (_c = (_b = (_a = el.labels) == null ? void 0 : _a[0]) == null ? void 0 : _b.textContent) == null ? void 0 : _c.trim();
        if (labelText) return labelText.slice(0, 50);
        const name = el.getAttribute("name");
        if (name) return name.slice(0, 50);
      }
    }
    const parent = (_d = el.closest) == null ? void 0 : _d.call(el, 'button, a, [role="button"]');
    if (parent && parent !== el) {
      const parentText = (_f = (_e = parent.textContent) == null ? void 0 : _e.trim()) == null ? void 0 : _f.slice(0, 100);
      if (parentText && parentText.length >= 2) return parentText;
      const parentAria = (_g = parent.getAttribute) == null ? void 0 : _g.call(parent, "aria-label");
      if (parentAria) return parentAria.slice(0, 100);
      const parentTitle = (_h = parent.getAttribute) == null ? void 0 : _h.call(parent, "title");
      if (parentTitle) return parentTitle.slice(0, 100);
    }
    if (!editable && !((_i = el.textContent) == null ? void 0 : _i.trim())) {
      const inner = (_j = el.querySelector) == null ? void 0 : _j.call(el, 'img[alt]:not([alt=""]), [aria-label]:not([aria-label=""]), svg title');
      const innerLabel = inner && (inner.getAttribute("alt") || inner.getAttribute("aria-label") || inner.textContent || "").trim();
      if (innerLabel) return innerLabel.slice(0, 100);
    }
    if (editable || ((_k = el.matches) == null ? void 0 : _k.call(el, 'button, a, [role="button"], input, textarea, select, [data-bb]'))) return null;
    const parentEl = el.parentElement;
    if (parentEl) {
      const parentText = (_m = (_l = parentEl.textContent) == null ? void 0 : _l.trim()) == null ? void 0 : _m.slice(0, 30);
      if (parentText && parentText.length >= 2) return parentText;
    }
    return null;
  }
  const handler = (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    try {
      const target = event.target;
      if ((_a = target.closest) == null ? void 0 : _a.call(target, "[data-bb-panel]")) return;
      if ((_b = target.closest) == null ? void 0 : _b.call(target, "nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast], [data-nextjs-error-overlay]")) return;
      const el = target.closest ? target.closest('button, a, [role="button"], input[type="submit"], [data-bb]') || target.namespaceURI === "http://www.w3.org/2000/svg" && target.closest("svg") || target : target;
      const tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
      const editable = tag === "textarea" || !!((_c = target.closest) == null ? void 0 : _c.call(target, '[contenteditable]:not([contenteditable="false"])'));
      const text = editable ? "" : ((_e = (_d = el.textContent) == null ? void 0 : _d.trim()) == null ? void 0 : _e.slice(0, 100)) || "";
      const id = el.id || null;
      const className = (((_f = el.getAttribute) == null ? void 0 : _f.call(el, "class")) || "").slice(0, config.maxClassNameLength);
      const dataBb = ((_g = el.dataset) == null ? void 0 : _g.bb) || null;
      const rawHref = typeof el.href === "string" ? el.href : (_h = el.getAttribute) == null ? void 0 : _h.call(el, "href");
      let href = rawHref || null;
      if (href) href = blackbox2._stripQueryParams(href);
      const autoLabel = synthesizeLabel(el, editable);
      blackbox2._addBreadcrumb("click", { tag, text, id, className, dataBb, href, autoLabel });
      const passiveInputTypes = ["text", "number", "email", "password", "tel", "search", "url", "date", "time", "datetime-local", "month", "week", "color", "range", "file"];
      const isPassiveInput = tag === "input" && passiveInputTypes.includes(el.type || "text");
      const isInteractive = tag === "button" || tag === "input" && el.type === "submit" || ((_i = el.getAttribute) == null ? void 0 : _i.call(el, "role")) === "button" || tag === "a" && (!rawHref || rawHref === "#" || rawHref.endsWith("#")) || !!dataBb && !isPassiveInput && tag !== "textarea";
      if (isInteractive) {
        blackbox2._registerSilenceCheck({ tag, text: text || autoLabel || "", id, dataBb });
      }
    } catch (e) {
    }
  };
  document.addEventListener("click", handler, true);
  return () => {
    document.removeEventListener("click", handler, true);
  };
}

// src/core/hooks/navigationHook.js
function installNavigationHook(blackbox2) {
  let previousPath = blackbox2._getCurrentPath();
  let active = true;
  const recordNavigation = () => {
    if (!active) return;
    try {
      const newPath = blackbox2._getCurrentPath();
      if (newPath !== previousPath) {
        blackbox2._addBreadcrumb("navigation", { from: previousPath, to: newPath });
        previousPath = newPath;
      }
    } catch (e) {
    }
  };
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const patchedPushState = function(...args) {
    const result = originalPushState.apply(history, args);
    recordNavigation();
    return result;
  };
  const patchedReplaceState = function(...args) {
    const result = originalReplaceState.apply(history, args);
    recordNavigation();
    return result;
  };
  history.pushState = patchedPushState;
  history.replaceState = patchedReplaceState;
  const popstateHandler = () => {
    recordNavigation();
  };
  window.addEventListener("popstate", popstateHandler);
  return () => {
    active = false;
    if (history.pushState === patchedPushState) history.pushState = originalPushState;
    if (history.replaceState === patchedReplaceState) history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", popstateHandler);
  };
}

// src/core/hooks/consoleHook.js
function installConsoleHook(blackbox2) {
  const config = blackbox2._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];
  function interpolateFormatString(args) {
    if (args.length < 2 || typeof args[0] !== "string") return null;
    const fmt = args[0];
    if (!/%[sdoOifc%]/.test(fmt)) return null;
    let i = 1;
    const result = fmt.replace(/%([sdoOifc%])/g, (match, type) => {
      if (type === "%") return "%";
      if (i >= args.length) return match;
      const val = args[i++];
      if (type === "c") return "";
      if (type === "d" || type === "i") return String(parseInt(val, 10));
      if (type === "f") return String(parseFloat(val));
      return serializeArg(val);
    });
    const remaining = args.slice(i);
    if (remaining.length > 0) {
      return (result + " " + remaining.map(serializeArg).join(" ")).trim().slice(0, config.maxMessageLength);
    }
    return result.trim().slice(0, config.maxMessageLength);
  }
  function serializeArg(a) {
    if (typeof a === "string") return a;
    if (a && typeof a === "object" && (a instanceof Error || a.code || a.message)) {
      const parts = [];
      if (a.message) parts.push(a.message);
      if (a.code) parts.push(`[code: ${a.code}]`);
      if (a.path) parts.push(`[path: ${a.path}]`);
      if (a.stack && !a.message) parts.push(a.stack.split("\n")[0]);
      return parts.length > 0 ? parts.join(" ") : String(a);
    }
    try {
      return JSON.stringify(a);
    } catch (e) {
      return String(a);
    }
  }
  function stringifyArgs(args) {
    const interpolated = interpolateFormatString(args);
    if (interpolated !== null) return interpolated;
    return args.map(serializeArg).join(" ").slice(0, config.maxMessageLength);
  }
  function matchesIgnorePattern(message) {
    return ignorePatterns.some((pattern) => message.includes(pattern));
  }
  let _recording = false;
  function bbHandleError(...args) {
    if (_recording) return;
    _recording = true;
    try {
      const message = stringifyArgs(args);
      if (message.includes("[BlackBox]")) return;
      if (matchesIgnorePattern(message)) return;
      let stack = new Error().stack || "";
      const ctx = {};
      for (const a of args) {
        if (a && typeof a === "object" && (a instanceof Error || a.code)) {
          if (a.code) ctx.code = a.code;
          if (a.path) ctx.path = a.path;
          if (a.stack) stack = a.stack;
        }
      }
      try {
        const frame = extractTopAppFrame(stack);
        if (frame) ctx.callerFrame = frame.replace(/^\s*at\s+/, "").slice(0, 200);
      } catch (e) {
      }
      blackbox2._recordError({ message, stack, source: "console.error", context: ctx });
    } catch (e) {
    } finally {
      _recording = false;
    }
  }
  function bbHandleWarn(...args) {
    if (_recording) return;
    _recording = true;
    try {
      const message = stringifyArgs(args);
      if (message.includes("[BlackBox]")) return;
      if (matchesIgnorePattern(message)) return;
      blackbox2._addBreadcrumb("warning", { message });
    } catch (e) {
    } finally {
      _recording = false;
    }
  }
  const SENTINEL = "__bb_hooked";
  let errorDepth = 0;
  let warnDepth = 0;
  let active = true;
  const isActive = () => active;
  let currentErrorWrapper = null, errorBelow = null;
  let currentWarnWrapper = null, warnBelow = null;
  function patchError() {
    var _a, _b;
    if ((_b = (_a = console.error).__bb_active) == null ? void 0 : _b.call(_a)) return;
    const thirdPartyWrapper = console.error;
    const wrapped = function(...args) {
      if (!active) return thirdPartyWrapper.apply(console, args);
      errorDepth++;
      try {
        thirdPartyWrapper.apply(console, args);
      } finally {
        errorDepth--;
      }
      if (errorDepth === 0) bbHandleError(...args);
    };
    wrapped[SENTINEL] = true;
    wrapped.__bb_active = isActive;
    errorBelow = thirdPartyWrapper;
    console.error = currentErrorWrapper = wrapped;
  }
  function patchWarn() {
    var _a, _b;
    if ((_b = (_a = console.warn).__bb_active) == null ? void 0 : _b.call(_a)) return;
    const thirdPartyWrapper = console.warn;
    const wrapped = function(...args) {
      if (!active) return thirdPartyWrapper.apply(console, args);
      warnDepth++;
      try {
        thirdPartyWrapper.apply(console, args);
      } finally {
        warnDepth--;
      }
      if (warnDepth === 0) bbHandleWarn(...args);
    };
    wrapped[SENTINEL] = true;
    wrapped.__bb_active = isActive;
    warnBelow = thirdPartyWrapper;
    console.warn = currentWarnWrapper = wrapped;
  }
  patchError();
  patchWarn();
  const repatchInterval = setInterval(() => {
    patchError();
    patchWarn();
  }, 2e3);
  return () => {
    clearInterval(repatchInterval);
    active = false;
    if (console.error === currentErrorWrapper) console.error = errorBelow;
    if (console.warn === currentWarnWrapper) console.warn = warnBelow;
  };
}

// src/core/hooks/networkHook.js
function installNetworkHook(blackbox2) {
  const config = blackbox2._getConfig();
  const nativeFetch = window.fetch.bind(window);
  const excludePatterns = config.networkExcludePatterns || [];
  function isExcludedUrl(url) {
    return excludePatterns.some((pattern) => url.includes(pattern));
  }
  const _firstSeenUrls = /* @__PURE__ */ new Set();
  function classifyHtmlErrorPage(text, status) {
    if (!text || text.length < 200) return null;
    const head = text.slice(0, 2e3);
    if (!/<html/i.test(head)) return null;
    let titleMatch = head.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : null;
    const isCloudflare = /cf-error-details|cloudflare-static|cloudflare\.com\/5xx-error-landing|<title>\s*[^<]*\|\s*Cloudflare/i.test(head) || /Cloudflare Ray ID/i.test(text.slice(0, 8e3));
    if (isCloudflare) {
      return {
        kind: "cloudflare_error_page",
        summary: `Cloudflare ${status || ""} page${title ? ` \u2014 ${title}` : ""}`.trim()
      };
    }
    if (/<center>\s*<h1>\s*\d{3}/i.test(head) && /nginx/i.test(text.slice(0, 4e3))) {
      return {
        kind: "nginx_error_page",
        summary: `nginx ${status || ""} page${title ? ` \u2014 ${title}` : ""}`.trim()
      };
    }
    if (status && status >= 500) {
      return {
        kind: "html_error_page",
        summary: `HTML ${status} page${title ? ` \u2014 ${title}` : ""}`.trim()
      };
    }
    return null;
  }
  async function readBodyPreview(res, maxChars, timeoutMs) {
    var _a, _b;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs, null);
    });
    const reader = (_b = (_a = res.body) == null ? void 0 : _a.getReader) == null ? void 0 : _b.call(_a);
    try {
      if (!reader) return await Promise.race([res.text(), timeout]) || "";
      const decoder = new TextDecoder();
      let text = "";
      while (text.length < maxChars) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    } finally {
      clearTimeout(timer);
      try {
        reader == null ? void 0 : reader.cancel().catch(() => {
        });
      } catch (e) {
      }
    }
  }
  const SECRET_KEY = '[^"=&]{0,40}(?:passw(?:or)?d|passcode|token|secret|authoriz|api[_-]?key)[^"=&]{0,40}';
  const SECRET_JSON = new RegExp(`("${SECRET_KEY}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi");
  const SECRET_FORM = new RegExp(`((?:^|&)${SECRET_KEY}=)[^&]*`, "gi");
  function redactBody(str) {
    return /^\s*[[{]/.test(str) ? str.replace(SECRET_JSON, '$1"[redacted]"') : str.replace(SECRET_FORM, "$1[redacted]");
  }
  const BB_MARK = /* @__PURE__ */ Symbol.for("bb.fetch.recorded");
  function markInit(init) {
    const proto = init ? Object.getPrototypeOf(init) : Object.prototype;
    return proto === Object.prototype || proto === null ? __spreadProps(__spreadValues({}, init), { [BB_MARK]: true }) : init;
  }
  function describeRequest(method, rawInput) {
    const req = { method, url: "", rawUrl: "", isSameOrigin: false };
    try {
      req.rawUrl = String(rawInput);
      req.url = blackbox2._stripQueryParams(req.rawUrl);
      if (req.url.length > config.maxUrlLength) req.url = req.url.slice(0, config.maxUrlLength);
      if (req.rawUrl.length > config.maxUrlLength) req.rawUrl = req.rawUrl.slice(0, config.maxUrlLength);
      if (typeof location !== "undefined") {
        req.isSameOrigin = new URL(req.rawUrl, location.href).origin === location.origin;
      }
    } catch (e) {
    }
    return req;
  }
  const PROBE_TIMEOUT_MS = 2e3;
  function recordNetworkError(req, duration, errMsg, stack, aborted, reqHeaders) {
    var _a;
    const { method, url, rawUrl, isSameOrigin } = req;
    const crumbData = __spreadValues({ method, url, status: 0, duration, ok: false, error: errMsg }, aborted ? { aborted: true } : {});
    blackbox2._addBreadcrumb("network", crumbData);
    if (aborted) return;
    const errorContext = __spreadValues({ method, url, duration }, rawUrl !== url ? { _rawUrl: rawUrl } : {});
    const record = () => blackbox2._recordError({
      message: `Network error: ${method} ${url} - ${errMsg}`,
      stack: stack || "",
      source: "network",
      context: errorContext
    });
    const probeFetch = (_a = blackbox2._getNativeFetch) == null ? void 0 : _a.call(blackbox2);
    if (isSameOrigin || !probeFetch || !/^(https?:)?\/\//i.test(rawUrl)) {
      record();
      return;
    }
    const probeCtl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let probeTimer;
    let probeTimedOut = false;
    Promise.race([
      probeFetch(rawUrl, markInit({ method: "HEAD", mode: "no-cors", signal: probeCtl == null ? void 0 : probeCtl.signal })),
      new Promise((_, reject) => {
        probeTimer = setTimeout(() => {
          probeTimedOut = true;
          probeCtl == null ? void 0 : probeCtl.abort();
          reject();
        }, PROBE_TIMEOUT_MS);
      })
    ]).then(() => {
      errorContext.urlReachability = "opaque_response";
      errorContext.statusHint = "reachable_but_request_blocked_cors_likely_check_network_tab";
      try {
        const preflight = { method };
        const SIMPLE_HEADERS = ["accept", "accept-language", "content-language", "content-type"];
        const nonSimple = [];
        if (reqHeaders) {
          const entries = reqHeaders instanceof Headers ? [...reqHeaders.entries()] : Object.entries(reqHeaders);
          for (const [k] of entries) {
            if (!SIMPLE_HEADERS.includes(k.toLowerCase())) nonSimple.push(k);
          }
          const ct = (reqHeaders instanceof Headers ? reqHeaders.get("content-type") : reqHeaders["content-type"] || reqHeaders["Content-Type"]) || "";
          if (ct && !ct.startsWith("application/x-www-form-urlencoded") && !ct.startsWith("multipart/form-data") && !ct.startsWith("text/plain")) {
            nonSimple.push("content-type(" + ct.split(";")[0] + ")");
          }
        }
        if (nonSimple.length > 0) preflight.headers = nonSimple;
        if (!["GET", "HEAD", "POST"].includes(method)) {
          preflight.reason = "non-simple method: " + method;
        } else if (nonSimple.length > 0) {
          preflight.reason = "non-simple headers: " + nonSimple.join(", ");
        }
        errorContext.preflight_if_cors = preflight;
      } catch (e) {
      }
    }, () => {
      if (probeTimedOut) {
        errorContext.urlReachability = "unknown";
        errorContext.statusHint = "probe_timed_out_origin_slow_or_hung";
      } else {
        errorContext.urlReachability = "unreachable_origin";
        errorContext.statusHint = "origin_dns_or_refused";
      }
    }).then(() => {
      clearTimeout(probeTimer);
      try {
        record();
      } catch (e) {
      }
    });
  }
  function recordResponse(req, crumbData, isError, body, readErrorBody) {
    const { method, url, rawUrl, isSameOrigin } = req;
    const { status, duration, ok } = crumbData;
    const bodyLimit = config.maxBodyLength > 0 ? config.maxBodyLength : 300;
    const shouldCaptureReqBody = config.captureRequestBodies || isSameOrigin && ["POST", "PUT", "PATCH"].includes(method);
    if (shouldCaptureReqBody) {
      try {
        if (body) {
          const bodyStr = typeof body === "string" ? body : body instanceof FormData ? "[FormData: " + [...body.keys()].join(", ") + "]" : String(body);
          crumbData.requestBody = redactBody(bodyStr).slice(0, bodyLimit);
        }
      } catch (e) {
      }
    }
    blackbox2._addBreadcrumb("network", crumbData);
    if (isError) {
      const maxBody = config.maxErrorBodyLength || 1024;
      const errorContext = __spreadValues({ status, method, url, duration }, rawUrl !== url ? { _rawUrl: rawUrl } : {});
      if (config.captureRequestBodies || isSameOrigin) {
        try {
          if (body) {
            const bodyStr = typeof body === "string" ? body : body instanceof FormData ? [...body.keys()].join(", ") : String(body);
            errorContext.requestBody = redactBody(bodyStr).slice(0, maxBody);
          }
        } catch (e) {
        }
      }
      void (async () => {
        try {
          const text = await readErrorBody(Math.max(maxBody, 8192));
          if (text) {
            const classified = classifyHtmlErrorPage(text, status);
            if (classified) {
              errorContext.responseBody = `[${classified.summary}]`;
              errorContext.responseBodyKind = classified.kind;
            } else {
              errorContext.responseBody = text.slice(0, maxBody);
            }
          }
        } catch (e) {
        }
        try {
          blackbox2._recordError({
            message: `HTTP ${status}: ${method} ${url}`,
            stack: "",
            source: "network",
            context: errorContext
          });
        } catch (e) {
        }
      })();
    }
    const isFirstHit = !_firstSeenUrls.has(url);
    if (isFirstHit) _firstSeenUrls.add(url);
    if (ok && duration > config.slowRequestThreshold && !isFirstHit) {
      blackbox2._addBreadcrumb("performance", {
        action: "slow_request",
        method,
        url,
        duration,
        threshold: config.slowRequestThreshold
      });
    }
  }
  function createFetchWrapper(baseFetch) {
    const wrapped = async function(input, init) {
      var _a;
      if (init && init[BB_MARK]) {
        return baseFetch(input, init);
      }
      const opts = init || {};
      const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const method = (opts.method || (request == null ? void 0 : request.method) || "GET").toUpperCase();
      let rawInput = "";
      try {
        rawInput = typeof input === "string" ? input : (input == null ? void 0 : input.url) || String(input);
      } catch (e) {
      }
      const req = describeRequest(method, rawInput);
      if (isExcludedUrl(req.url)) {
        return baseFetch(input, init);
      }
      const start = Date.now();
      let response;
      blackbox2._incrementPendingFetches();
      try {
        response = await baseFetch(input, markInit(init));
      } catch (err) {
        blackbox2._decrementPendingFetches();
        try {
          const signal = opts.signal || (input == null ? void 0 : input.signal);
          const aborted = (err == null ? void 0 : err.name) === "AbortError" || !!(signal == null ? void 0 : signal.aborted) && (err == null ? void 0 : err.name) !== "TimeoutError";
          recordNetworkError(req, Date.now() - start, (err == null ? void 0 : err.message) || "", err == null ? void 0 : err.stack, aborted, (_a = opts.headers) != null ? _a : request == null ? void 0 : request.headers);
        } catch (e) {
        }
        throw err;
      }
      try {
        const crumbData = { method, url: req.url, status: response.status, duration: Date.now() - start, ok: response.ok };
        const opaque = response.type === "opaque" || response.type === "opaqueredirect";
        if (opaque) crumbData.responseType = response.type;
        const isError = !response.ok && !opaque;
        let cloned = null;
        if (isError) {
          try {
            cloned = response.clone();
          } catch (e) {
          }
        }
        recordResponse(
          req,
          crumbData,
          isError,
          opts.body,
          (maxChars) => cloned ? readBodyPreview(cloned, maxChars, 1500) : ""
        );
      } catch (e) {
      }
      blackbox2._decrementPendingFetches();
      return response;
    };
    wrapped.__bb_hooked = true;
    return wrapped;
  }
  function patchFetch() {
    if (window.fetch.__bb_hooked) return;
    window.fetch = createFetchWrapper(window.fetch);
  }
  patchFetch();
  const repatchInterval = setInterval(patchFetch, 2e3);
  const xhrProto = typeof XMLHttpRequest !== "undefined" && !XMLHttpRequest.prototype.send.__bb_hooked ? XMLHttpRequest.prototype : null;
  const nativeOpen = xhrProto == null ? void 0 : xhrProto.open;
  const nativeSend = xhrProto == null ? void 0 : xhrProto.send;
  const xhrRequests = /* @__PURE__ */ new WeakMap();
  let xhrActive = true;
  let patchedOpen = null, patchedSend = null;
  if (xhrProto) {
    xhrProto.open = patchedOpen = function(method, url) {
      if (!xhrActive) return nativeOpen.apply(this, arguments);
      try {
        xhrRequests.set(this, describeRequest(String(method || "GET").toUpperCase(), url));
      } catch (e) {
      }
      return nativeOpen.apply(this, arguments);
    };
    xhrProto.send = patchedSend = function(body) {
      const req = xhrRequests.get(this);
      if (!xhrActive || !req || isExcludedUrl(req.url)) return nativeSend.apply(this, arguments);
      const xhr = this;
      const start = Date.now();
      const events = ["load", "error", "abort", "timeout", "loadend"];
      let outcome = "error";
      const onEvent = (e) => {
        if (e.type !== "loadend") {
          outcome = e.type;
          return;
        }
        for (const type of events) xhr.removeEventListener(type, onEvent);
        blackbox2._decrementPendingFetches();
        if (xhrRequests.get(xhr) !== req) return;
        try {
          const duration = Date.now() - start;
          if (outcome !== "load") {
            recordNetworkError(req, duration, `XHR ${outcome}`, "", outcome === "abort", null);
          } else {
            const status = xhr.status;
            const ok = status >= 200 && status < 300;
            recordResponse(
              req,
              { method: req.method, url: req.url, status, duration, ok },
              !ok,
              body,
              () => xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : ""
            );
          }
        } catch (e2) {
        }
      };
      for (const type of events) xhr.addEventListener(type, onEvent);
      blackbox2._incrementPendingFetches();
      try {
        return nativeSend.apply(this, arguments);
      } catch (err) {
        for (const type of events) xhr.removeEventListener(type, onEvent);
        blackbox2._decrementPendingFetches();
        throw err;
      }
    };
    xhrProto.send.__bb_hooked = true;
  }
  return () => {
    clearInterval(repatchInterval);
    window.fetch = nativeFetch;
    xhrActive = false;
    if (xhrProto) {
      if (xhrProto.open === patchedOpen) xhrProto.open = nativeOpen;
      if (xhrProto.send === patchedSend) xhrProto.send = nativeSend;
    }
  };
}

// src/core/hooks/formHook.js
function installFormHook(blackbox2) {
  const report = (form, blocked) => {
    var _a;
    try {
      if (!form || ((_a = form.tagName) == null ? void 0 : _a.toLowerCase()) !== "form") return;
      const fields = form.elements ? Array.from(form.elements) : [];
      const invalidFields = [];
      for (const field of fields) {
        if (field.name && field.validity && !field.validity.valid) {
          invalidFields.push({
            name: field.name,
            validationMessage: field.validationMessage || ""
          });
        }
      }
      const crumb = __spreadValues({
        action: "form_submit",
        // Attributes, not `form.id` / `form.name`: a control named "id" or
        // "name" shadows those properties and would put a DOM node here,
        // which Firestore rejects on every later write.
        formId: form.getAttribute("id") || form.getAttribute("name") || "unknown_form",
        fieldCount: fields.filter((f) => f.name).length,
        invalidCount: invalidFields.length,
        invalidFields
      }, blocked ? { blocked: true } : {});
      blackbox2._addBreadcrumb("form", crumb);
      if (invalidFields.length > 0) {
        blackbox2._recordError({
          message: `Form validation failed: ${crumb.formId} (${invalidFields.length} invalid fields)`,
          stack: "",
          source: "form_validation",
          context: { formId: crumb.formId, invalidFields }
        });
      }
    } catch (e) {
    }
  };
  const onSubmit = (event) => report(event.target, false);
  const attempted = /* @__PURE__ */ new Set();
  const markAttempt = (form) => {
    if (!form || attempted.has(form)) return;
    attempted.add(form);
    setTimeout(() => attempted.delete(form), 0);
  };
  const onClick = (event) => {
    var _a, _b;
    try {
      const el = (_b = (_a = event.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, "button, input");
      if (el && (el.type === "submit" || el.type === "image")) markAttempt(el.form);
    } catch (e) {
    }
  };
  const onKey = (event) => {
    var _a, _b;
    try {
      if (event.key === "Enter" && ((_a = event.target) == null ? void 0 : _a.tagName) !== "TEXTAREA") markAttempt((_b = event.target) == null ? void 0 : _b.form);
    } catch (e) {
    }
  };
  const pending = /* @__PURE__ */ new Set();
  const onInvalid = (event) => {
    var _a;
    try {
      const form = (_a = event.target) == null ? void 0 : _a.form;
      if (!form || !attempted.has(form) || pending.has(form)) return;
      pending.add(form);
      setTimeout(() => {
        pending.delete(form);
        report(form, true);
      }, 0);
    } catch (e) {
    }
  };
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("invalid", onInvalid, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keypress", onKey, true);
  return () => {
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("invalid", onInvalid, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keypress", onKey, true);
  };
}

// src/core/hooks/resourceHook.js
function installResourceHook(blackbox2) {
  const resourceTags = /* @__PURE__ */ new Set(["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO", "SOURCE"]);
  const nativeFetch = blackbox2._getNativeFetch();
  function safeHostname(src) {
    try {
      if (!src || !src.startsWith("http")) return null;
      return new URL(src).hostname;
    } catch (e) {
      return null;
    }
  }
  const PROBE_HEADER_ALLOWLIST = [
    "cf-ray",
    "cf-cache-status",
    "content-type",
    "content-length",
    "x-amz-request-id",
    "x-amz-id-2",
    "x-mediaitem",
    "x-version",
    "x-served-by",
    "server"
  ];
  function pickHeaders(headers) {
    var _a;
    const out = {};
    try {
      for (const name of PROBE_HEADER_ALLOWLIST) {
        const v = (_a = headers.get) == null ? void 0 : _a.call(headers, name);
        if (v) out[name] = String(v).slice(0, 200);
      }
    } catch (e) {
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  const TAG_CONTENT_TYPES = {
    img: /^image\//i,
    script: /^(application|text)\/(javascript|ecmascript|json)/i,
    link: /^text\/css/i,
    video: /^video\//i,
    audio: /^audio\//i,
    source: /^(video|audio|image)\//i
  };
  function detectTagMismatch(tag, contentType) {
    if (!contentType || !tag) return null;
    const expected = TAG_CONTENT_TYPES[tag];
    if (!expected) return null;
    const ct = contentType.split(";")[0].trim();
    if (expected.test(ct)) return null;
    return ct;
  }
  const handler = (event) => {
    var _a, _b;
    try {
      const target = event.target;
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;
      const tagName = target.tagName.toLowerCase();
      const srcAttr = target.getAttribute(tagName === "link" ? "href" : "src");
      const emptySrc = srcAttr !== null && srcAttr.trim() === "" && !target.getAttribute("srcset");
      const rawSrc = emptySrc ? "" : target.currentSrc || target.src || target.href || "";
      const src = blackbox2._stripQueryParams(rawSrc);
      let upstreamSrc = null;
      let viaPath = null;
      try {
        const wrapper = new URL(rawSrc);
        const inner = wrapper.searchParams.get("url");
        if (inner && /\/_(?:next|vercel)\/image$/.test(wrapper.pathname)) {
          upstreamSrc = blackbox2._stripQueryParams(new URL(inner, wrapper.href).href);
          viaPath = wrapper.pathname;
        }
      } catch (e) {
      }
      const hostname = safeHostname(upstreamSrc || src);
      const context = __spreadValues(__spreadValues({
        tagName,
        src,
        hostname,
        id: target.id || null,
        // Attribute, not .className: on SVG <image>/<use> that's an
        // SVGAnimatedString and would stringify to '[object SVGAnimatedString]'
        className: (((_a = target.getAttribute) == null ? void 0 : _a.call(target, "class")) || "").slice(0, 100)
      }, upstreamSrc ? { upstreamSrc } : {}), rawSrc !== src ? { _rawSrc: rawSrc } : {});
      let el = target;
      for (let i = 0; i < 5 && el; i++) {
        if ((_b = el.dataset) == null ? void 0 : _b.bb) {
          context.dataBb = el.dataset.bb;
          break;
        }
        if (el.id) {
          context.nearestId = el.id;
          break;
        }
        el = el.parentElement;
      }
      try {
        if (tagName === "img") {
          const alt = target.getAttribute("alt");
          if (alt) context.alt = alt.slice(0, 100);
        }
      } catch (e) {
      }
      const label = emptySrc ? "(empty src)" : upstreamSrc ? `${upstreamSrc} (via ${viaPath})` : src;
      const emit = (reachability, extra) => {
        context.urlReachability = reachability;
        if (extra) Object.assign(context, extra);
        blackbox2._recordError({
          message: `Resource failed to load: ${tagName} - ${label}`,
          stack: "",
          source: "resource_load",
          context
        });
      };
      if (emptySrc) {
        emit("unknown", {
          emptySrc: true,
          action_hint: `<${tagName}> rendered with an empty src; the URL variable was empty/undefined at render time. Don't render the element until the URL exists instead of passing ''.`
        });
      } else if (rawSrc && rawSrc.startsWith("http") && nativeFetch) {
        nativeFetch(rawSrc, {
          method: "GET",
          mode: "cors",
          headers: { Range: "bytes=0-512" }
        }).then(async (res) => {
          const headers = pickHeaders(res.headers);
          let bodyPreview = null;
          try {
            const text = await res.clone().text();
            if (text) bodyPreview = text.slice(0, 200);
          } catch (e) {
          }
          const extra = __spreadValues(__spreadValues({
            httpStatus: res.status
          }, headers ? { responseHeaders: headers } : {}), bodyPreview ? { responseBodyPreview: bodyPreview } : {});
          if (res.status >= 200 && res.status < 400) {
            const mismatchType = detectTagMismatch(tagName, headers == null ? void 0 : headers["content-type"]);
            if (mismatchType) {
              emit("tag_content_type_mismatch", __spreadProps(__spreadValues({}, extra), {
                contentType: mismatchType,
                action_hint: `<${tagName}> tag received "${mismatchType}" \u2014 element rendered the wrong KIND of file. Check the asset-id / URL mapping at the call site.`
              }));
            } else {
              emit("ok", extra);
            }
          } else {
            emit("http_error", extra);
          }
        }).catch(() => {
          nativeFetch(rawSrc, { method: "HEAD", mode: "no-cors" }).then(() => {
            emit("opaque_response", {
              httpStatus: 0,
              statusHint: "reachable_but_status_unknown_check_network_tab"
            });
          }).catch(() => {
            emit("unreachable_origin", {
              httpStatus: 0,
              statusHint: "origin_dns_or_refused"
            });
          });
        });
      } else {
        emit("unknown");
      }
    } catch (e) {
    }
  };
  window.addEventListener("error", handler, true);
  return () => {
    window.removeEventListener("error", handler, true);
  };
}

// src/core/activityLog.js
var _blackbox = null;
var _lastFlushTime = null;
var _lastFlushIndex = 0;
var PENDING_KEY = "__bb_pending_crumbs";
function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch (e) {
    return JSON.stringify(doc).length * 2;
  }
}
async function writeActivityDoc(crumbs, sessionId, from, to) {
  const fns = await getFirestoreFunctions();
  const collRef = getCollectionRef();
  if (!fns || !collRef || isCircuitOpen()) return false;
  const config = getPersistenceConfig();
  const breadcrumbs = toFirestoreSafe(crumbs, []);
  const maxBytes = config.maxDocumentBytes || 5e5;
  const bbConfig = _blackbox._getConfig();
  let doc = {
    schemaVersion: config.schemaVersion,
    type: "activity",
    sessionId,
    environment: bbConfig.environment || null,
    tags: toFirestoreSafe(bbConfig.tags, {}),
    user: toFirestoreSafe(bbConfig.user, null),
    breadcrumbs,
    period: {
      from,
      to
    },
    metadata: {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: to
    },
    createdAt: fns.serverTimestamp(),
    // Expires after 48h: removed by a Firestore TTL policy on expireAt if one is
    // enabled, otherwise by the next bb-check run
    expireAt: fns.Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1e3))
  };
  const size = estimateDocBytes(doc);
  if (size > maxBytes && doc.breadcrumbs.length > 20) {
    doc.breadcrumbs = doc.breadcrumbs.slice(-20);
  }
  await fns.addDoc(collRef, doc);
  return true;
}
async function flushActivity(currentBreadcrumbs) {
  if (isCircuitOpen()) return;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const from = _lastFlushTime || now;
    const newCrumbs = currentBreadcrumbs.filter((c) => {
      return !_lastFlushTime || c.timestamp > _lastFlushTime;
    });
    let saved = null;
    try {
      if (newCrumbs.length === 0) {
        sessionStorage.removeItem(PENDING_KEY);
      } else {
        saved = JSON.stringify({
          sessionId: _blackbox.getSessionId(),
          breadcrumbs: newCrumbs.slice(-40),
          timestamp: now
        });
        sessionStorage.setItem(PENDING_KEY, saved);
      }
    } catch (e) {
    }
    if (newCrumbs.length === 0) return;
    if (!await writeActivityDoc(newCrumbs, _blackbox.getSessionId(), from, now)) return;
    _lastFlushTime = newCrumbs[newCrumbs.length - 1].timestamp;
    try {
      if (saved && sessionStorage.getItem(PENDING_KEY) === saved) sessionStorage.removeItem(PENDING_KEY);
    } catch (e) {
    }
  } catch (e) {
  }
}
function initActivityLog(blackbox2, recovery) {
  try {
    _blackbox = blackbox2;
    _lastFlushTime = null;
    blackbox2._onActivityFlush((breadcrumbs) => {
      flushActivity(breadcrumbs);
    });
    const crumbs = recovery == null ? void 0 : recovery.breadcrumbs;
    if (Array.isArray(crumbs) && crumbs.length > 0) {
      writeActivityDoc(crumbs, recovery.sessionId, crumbs[0].timestamp, crumbs[crumbs.length - 1].timestamp).catch(() => {
      });
    }
  } catch (e) {
    console.warn("[BlackBox] Activity log init failed:", e);
  }
}
function _resetActivityLog() {
  _blackbox = null;
  _lastFlushTime = null;
  _lastFlushIndex = 0;
}

// src/core/blackbox.js
var _nativeFetch = typeof window !== "undefined" ? window.fetch.bind(window) : null;
var _initialized = false;
var _config = {};
var _sessionId = null;
var _breadcrumbs = null;
var _errors = [];
var _errorCount = 0;
var _subscribers = [];
var _onErrorCallback = null;
var _onActivityFlushCallback = null;
var _flushTimer = null;
var _writingError = false;
var _suspiciousSilences = [];
var _pendingSilenceChecks = [];
var _pendingFetchCount = 0;
var _lastFetchStartTime = 0;
var _cleanupFns = [];
var _recentErrors = [];
var _errorStorms = /* @__PURE__ */ new Map();
var _diagnostics = [];
var _preInit = {};
var DIAGNOSTIC_DEFAULT_TIMEOUT_MS = 200;
var EXTENDING_LIST_OPTIONS = ["consoleIgnorePatterns", "networkExcludePatterns"];
var ERROR_STORM_WINDOW = 5e3;
var ERROR_STORM_THRESHOLD = 5;
function _sanitizeHash(hash) {
  const qIndex = hash.indexOf("?");
  const route = qIndex === -1 ? hash : hash.substring(0, qIndex);
  return route.includes("=") ? "" : route;
}
function _stripQueryParams(url) {
  if (!url || !_config.stripQueryParams) return url;
  try {
    if (url.startsWith("http")) {
      const u = new URL(url);
      return u.origin + u.pathname + _sanitizeHash(u.hash);
    }
    const hashIndex = url.indexOf("#");
    let base = hashIndex === -1 ? url : url.substring(0, hashIndex);
    const hash = hashIndex === -1 ? "" : _sanitizeHash(url.substring(hashIndex));
    const qIndex = base.indexOf("?");
    if (qIndex !== -1) base = base.substring(0, qIndex);
    return base + hash;
  } catch (e) {
    return url;
  }
}
function _getCurrentPath() {
  try {
    const path = window.location.pathname + window.location.hash;
    return _stripQueryParams(path);
  } catch (e) {
    return "";
  }
}
function _notifySubscribers() {
  queueMicrotask(() => {
    for (const cb of _subscribers) {
      try {
        cb();
      } catch (e) {
      }
    }
  });
}
function _diagnosticMatches(d, errorEntry) {
  var _a, _b, _c, _d;
  try {
    if (typeof d.match === "function") return !!d.match(errorEntry);
    const probes = [
      errorEntry.message || "",
      errorEntry.url || "",
      ((_a = errorEntry.context) == null ? void 0 : _a.src) || "",
      ((_b = errorEntry.context) == null ? void 0 : _b.url) || "",
      ((_c = errorEntry.context) == null ? void 0 : _c._rawSrc) || "",
      ((_d = errorEntry.context) == null ? void 0 : _d._rawUrl) || ""
    ];
    return probes.some((s) => s && d.match.test(s));
  } catch (e) {
    return false;
  }
}
function _runDiagnosticsFor(errorEntry) {
  if (_diagnostics.length === 0) return;
  const done = [];
  for (const d of _diagnostics) {
    if (!_diagnosticMatches(d, errorEntry)) continue;
    const timeoutMs = d.timeoutMs || DIAGNOSTIC_DEFAULT_TIMEOUT_MS;
    let settled = false;
    let markDone;
    done.push(new Promise((resolve) => {
      markDone = resolve;
    }));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      _attachDiagnosticResult(errorEntry, d.name, { error: "timeout", timeoutMs });
      markDone();
    }, timeoutMs);
    Promise.resolve().then(() => d.run(errorEntry)).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        _attachDiagnosticResult(errorEntry, d.name, result);
        markDone();
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        _attachDiagnosticResult(errorEntry, d.name, { error: (err == null ? void 0 : err.message) || String(err) });
        markDone();
      }
    );
  }
  if (done.length > 0) {
    try {
      Object.defineProperty(errorEntry, "_diagnosticsDone", {
        value: Promise.allSettled(done),
        enumerable: false,
        configurable: true
      });
    } catch (e) {
    }
  }
}
function _attachDiagnosticResult(errorEntry, name, result) {
  try {
    if (!errorEntry.context) errorEntry.context = {};
    if (!errorEntry.context.diagnostics) errorEntry.context.diagnostics = {};
    errorEntry.context.diagnostics[name] = result;
    _notifySubscribers();
  } catch (e) {
  }
}
var blackbox = {
  init(options = {}) {
    if (typeof window === "undefined") return blackbox;
    if (_initialized) {
      console.warn("[BlackBox] Already initialized, skipping");
      return blackbox;
    }
    const enabled = options.enabled;
    if (enabled === false) {
      console.log("[BlackBox] Disabled");
      return blackbox;
    }
    if (enabled === void 0 || enabled === null) {
      try {
        if (process.env.NODE_ENV === "production") {
          console.log("[BlackBox] Disabled");
          return blackbox;
        }
      } catch (e) {
      }
    }
    if (options.db && typeof options.db !== "object") {
      console.error("[BlackBox] init() `db` must be a Firestore instance. Got:", typeof options.db);
    }
    const cfg = __spreadValues(__spreadValues({}, DEFAULTS), _preInit);
    for (const [key, value] of Object.entries(options)) {
      if (value !== void 0) cfg[key] = value;
    }
    cfg.tags = __spreadValues(__spreadValues(__spreadValues({}, DEFAULTS.tags), _preInit.tags), options.tags);
    for (const key of EXTENDING_LIST_OPTIONS) {
      cfg[key] = [...DEFAULTS[key], ...Array.isArray(options[key]) ? options[key] : []];
    }
    _config = cfg;
    _preInit = {};
    try {
      if (!_config.buildSha) {
        _config.buildSha = process.env.NEXT_PUBLIC_BUILD_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.NETLIFY_COMMIT_REF || process.env.GITHUB_SHA || null;
      }
    } catch (e) {
    }
    try {
      if (!_config.nodeEnv) {
        _config.nodeEnv = process.env.NODE_ENV || null;
      }
    } catch (e) {
    }
    try {
      if (typeof window !== "undefined") {
        if (!_config.sessionTag && typeof window.__BB_SESSION_TAG__ === "string") {
          _config.sessionTag = window.__BB_SESSION_TAG__.trim().slice(0, 64) || null;
        }
        if (_config.failFast === void 0 && window.__BB_FAIL_FAST__) {
          _config.failFast = true;
        }
      }
    } catch (e) {
    }
    _sessionId = generateSessionId();
    let _pendingRecovery = null;
    try {
      const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("__bb_pending_crumbs") : null;
      if (saved) {
        const { sessionId: prevSession, breadcrumbs: prevCrumbs, timestamp } = JSON.parse(saved);
        sessionStorage.removeItem("__bb_pending_crumbs");
        const age = Date.now() - new Date(timestamp).getTime();
        if (age < 5 * 60 * 1e3 && prevCrumbs.length > 0) {
          _pendingRecovery = { sessionId: prevSession, breadcrumbs: prevCrumbs };
        }
      }
    } catch (e) {
    }
    _breadcrumbs = new BreadcrumbManager(_config.maxBreadcrumbs, _config.maxBreadcrumbRepeat);
    _errors = [];
    _errorCount = 0;
    _suspiciousSilences = [];
    _pendingSilenceChecks = [];
    _cleanupFns = [];
    const hooks = [
      () => installErrorHook(blackbox),
      () => installClickHook(blackbox),
      () => installNavigationHook(blackbox),
      () => installConsoleHook(blackbox),
      () => installNetworkHook(blackbox),
      () => installFormHook(blackbox),
      () => installResourceHook(blackbox)
    ];
    for (const installHook of hooks) {
      try {
        const cleanup = installHook();
        if (cleanup) _cleanupFns.push(cleanup);
      } catch (e) {
        console.warn("[BlackBox] Hook install failed:", e);
      }
    }
    _flushTimer = setInterval(() => {
      try {
        if (_onActivityFlushCallback) {
          _onActivityFlushCallback(_breadcrumbs.snapshot());
        }
      } catch (e) {
      }
    }, _config.activityFlushInterval);
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      const handleUnload = () => {
        try {
          const pending = _breadcrumbs ? _breadcrumbs.snapshot() : [];
          if (_onActivityFlushCallback) {
            _onActivityFlushCallback(pending);
          }
        } catch (e) {
        }
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") handleUnload();
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("beforeunload", handleUnload);
      _cleanupFns.push(() => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("beforeunload", handleUnload);
      });
    }
    _initialized = true;
    if (_config.db) {
      try {
        initPersistence(blackbox, _config.db, _config.firestoreFns);
      } catch (e) {
        console.warn("[BlackBox] Persistence init failed:", e);
      }
      try {
        initActivityLog(blackbox, _pendingRecovery);
      } catch (e) {
        console.warn("[BlackBox] Activity log init failed:", e);
      }
    }
    blackbox._addBreadcrumb("system", { action: "blackbox_initialized", sessionId: _sessionId });
    const env = _config.environment || "default";
    const dbStatus = _config.db ? "Firestore connected" : "local only";
    console.log(`[BlackBox] Active | ${dbStatus} | env: ${env} | session: ${_sessionId}`);
    return blackbox;
  },
  log(action, data = {}) {
    if (!_initialized) return;
    try {
      blackbox._addBreadcrumb("custom", __spreadValues({ action }, data));
    } catch (e) {
    }
  },
  captureError(error, context = {}) {
    if (!_initialized) return;
    try {
      const message = (error == null ? void 0 : error.message) || String(error);
      const stack = (error == null ? void 0 : error.stack) || "";
      blackbox._recordError({ message, stack, source: "manual", context });
    } catch (e) {
    }
  },
  setUser(userInfo) {
    if (typeof window === "undefined") return;
    if (!_initialized) {
      _preInit.user = userInfo;
      return;
    }
    _config.user = userInfo;
  },
  /**
   * Register an app-defined diagnostic that runs on every matching error
   * and attaches its result to the error's context.diagnostics[name].
   *
   * Closes the "I had to write 5 ad-hoc probe scripts to diagnose one
   * asset URL" gap an agent reported in a v1.8 session — the app knows
   * how to check its own state (KV, R2 buckets, Firestore docs); BB
   * just needs a hook to run that check and embed the result.
   *
   * @param {string} name    Result key under context.diagnostics.
   * @param {object} options
   * @param {RegExp|Function} options.match  RegExp tested against the error
   *   message + url + context.src, OR a function (errorEntry) => boolean.
   * @param {Function} options.run  async (errorEntry) => any. Result is
   *   attached verbatim. Keep it small and fast — capped at timeoutMs.
   * @param {number} [options.timeoutMs=200]  Hard cap; on timeout the entry
   *   gets {error: 'timeout'} and the run keeps going in the background
   *   (its result is dropped).
   */
  registerDiagnostic(name, { match, run, timeoutMs = DIAGNOSTIC_DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof name !== "string" || !name) return;
    if (typeof run !== "function") return;
    if (!(match instanceof RegExp) && typeof match !== "function") return;
    _diagnostics = _diagnostics.filter((d) => d.name !== name);
    if (match instanceof RegExp && /[gy]/.test(match.flags)) {
      match = new RegExp(match.source, match.flags.replace(/[gy]/g, ""));
    }
    _diagnostics.push({ name, match, run, timeoutMs });
  },
  unregisterDiagnostic(name) {
    _diagnostics = _diagnostics.filter((d) => d.name !== name);
  },
  setTag(key, value) {
    if (typeof window === "undefined") return;
    if (!_initialized) {
      _preInit.tags = __spreadProps(__spreadValues({}, _preInit.tags), { [key]: value });
      return;
    }
    if (!_config.tags) _config.tags = {};
    _config.tags[key] = value;
  },
  setEnvironment(env) {
    if (typeof window === "undefined") return;
    if (!_initialized) {
      _preInit.environment = env;
      return;
    }
    _config.environment = env;
  },
  onUpdate(callback) {
    _subscribers.push(callback);
    return () => {
      _subscribers = _subscribers.filter((cb) => cb !== callback);
    };
  },
  getErrorCount() {
    return _errorCount;
  },
  getSessionId() {
    return _sessionId;
  },
  getRecentErrors(limit = 10) {
    return _errors.slice(-limit);
  },
  getSuspiciousSilences() {
    return _suspiciousSilences.filter((s) => s._surfaced);
  },
  clearErrors() {
    _errorCount = 0;
    _errors = [];
    _recentErrors = [];
    _errorStorms = /* @__PURE__ */ new Map();
    _suspiciousSilences = [];
    if (_breadcrumbs) _breadcrumbs.clear();
    _notifySubscribers();
  },
  getBreadcrumbs() {
    if (!_breadcrumbs) return [];
    return _breadcrumbs.snapshot();
  },
  // --- Firestore query methods for the UI panel ---
  async queryPersistedErrors(limit = 50) {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-WQDXJK3C.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { errors: [], connected: false };
      const queryConstraints = [fns.where("type", "==", "error")];
      if (fns.orderBy) queryConstraints.push(fns.orderBy("lastSeen", "desc"));
      queryConstraints.push(fns.limit(limit));
      const q = fns.query(ref, ...queryConstraints);
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map((d) => {
        var _a, _b, _c;
        const data = d.data();
        if ((_a = data.firstSeen) == null ? void 0 : _a.toDate) data.firstSeen = data.firstSeen.toDate().toISOString();
        if ((_b = data.lastSeen) == null ? void 0 : _b.toDate) data.lastSeen = data.lastSeen.toDate().toISOString();
        if ((_c = data.createdAt) == null ? void 0 : _c.toDate) data.createdAt = data.createdAt.toDate().toISOString();
        return __spreadValues({ id: d.id }, data);
      });
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1e3;
      const isCascadeNoise = (msg) => {
        if (!msg) return false;
        return /INTERNAL ASSERTION FAILED|Unexpected state \(ID:|__PRIVATE_hardAssert|__PRIVATE__fail/i.test(msg);
      };
      errors.sort((a, b) => {
        const recencyA = Math.max(0, 1 - (now - new Date(a.lastSeen).getTime()) / DAY_MS);
        const recencyB = Math.max(0, 1 - (now - new Date(b.lastSeen).getTime()) / DAY_MS);
        const causeA = isCascadeNoise(a.message) ? 0.4 : 1;
        const causeB = isCascadeNoise(b.message) ? 0.4 : 1;
        const scoreA = (a.occurrences || 1) * (0.3 + 0.7 * recencyA) * causeA;
        const scoreB = (b.occurrences || 1) * (0.3 + 0.7 * recencyB) * causeB;
        return scoreB - scoreA;
      });
      return { errors, connected: true };
    } catch (e) {
      return { errors: [], connected: false, error: e.message };
    }
  },
  async queryHealth() {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-WQDXJK3C.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { connected: false };
      const since = fns.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1e3));
      const q = fns.orderBy ? fns.query(ref, fns.where("type", "==", "error"), fns.where("lastSeen", ">=", since), fns.orderBy("lastSeen", "desc")) : fns.query(ref, fns.where("type", "==", "error"), fns.where("createdAt", ">=", since));
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map((d) => d.data());
      const totalOccurrences = errors.reduce((sum, e) => sum + (e.occurrences || 1), 0);
      const bySource = {};
      const systemic = [];
      for (const e of errors) {
        const src = e.source || "unknown";
        bySource[src] = (bySource[src] || 0) + 1;
        if ((e.occurrences || 1) > 10) systemic.push(e);
      }
      let verdict = "HEALTHY";
      if (systemic.length > 0) verdict = "UNHEALTHY";
      else if (errors.length > 0) verdict = "WARNING";
      return {
        connected: true,
        verdict,
        uniqueErrors: errors.length,
        totalOccurrences,
        bySource,
        systemicCount: systemic.length,
        topErrors: errors.sort((a, b) => (b.occurrences || 1) - (a.occurrences || 1)).slice(0, 5).map((e) => ({ message: e.message, source: e.source, occurrences: e.occurrences || 1 }))
      };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  },
  async queryTimeline(minutes = 5) {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-WQDXJK3C.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { events: [], connected: false };
      const cutoff = new Date(Date.now() - minutes * 60 * 1e3);
      const ts = fns.Timestamp.fromDate(cutoff);
      const q = fns.query(ref, fns.where("createdAt", ">=", ts));
      const errQ = fns.orderBy ? fns.query(ref, fns.where("type", "==", "error"), fns.where("lastSeen", ">=", ts), fns.orderBy("lastSeen", "desc")) : null;
      const [snapshot, errSnapshot] = await Promise.all([
        fns.getDocs(q),
        errQ ? fns.getDocs(errQ).catch(() => null) : null
      ]);
      const seen = /* @__PURE__ */ new Set();
      const events = [];
      for (const doc of [...snapshot.docs, ...(errSnapshot == null ? void 0 : errSnapshot.docs) || []]) {
        const data = doc.data();
        for (const bc of data.breadcrumbs || []) {
          if (bc.timestamp && !seen.has(bc.timestamp)) {
            seen.add(bc.timestamp);
            events.push(bc);
          }
        }
      }
      events.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
      return { events, connected: true };
    } catch (e) {
      return { events: [], connected: false, error: e.message };
    }
  },
  async clearPersistedErrors() {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-WQDXJK3C.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref || !fns.deleteDoc) return { success: false, error: "Not connected to Firestore" };
      const errorQuery = fns.query(ref, fns.where("type", "==", "error"));
      const snapshot = await fns.getDocs(errorQuery);
      let deleted = 0;
      let firstError = null;
      for (const doc of snapshot.docs) {
        try {
          await fns.deleteDoc(doc.ref);
          deleted++;
        } catch (e) {
          firstError = firstError || (e == null ? void 0 : e.message) || String(e);
        }
      }
      return __spreadValues({ success: deleted === snapshot.size, deleted, total: snapshot.size }, firstError ? { error: firstError } : {});
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  isConnectedToFirestore() {
    return !!_config.db;
  },
  _addBreadcrumb(type, data) {
    if (!_initialized || !_breadcrumbs) return;
    let breadcrumb = __spreadValues({ type, path: _getCurrentPath() }, data);
    if (_config.sanitize) {
      try {
        breadcrumb = _config.sanitize(breadcrumb);
        if (breadcrumb === null || breadcrumb === void 0) return;
      } catch (e) {
      }
    }
    const _a = breadcrumb, { type: crumbType } = _a, rest = __objRest(_a, ["type"]);
    _breadcrumbs.add(crumbType, rest);
    _notifySubscribers();
  },
  _recordError({ message, stack, source, context = {} }) {
    if (_writingError) return;
    if (!_initialized) return;
    try {
      if (message && message.includes("[BlackBox]")) return;
      const excludes = _config.errorExcludePatterns || [];
      if (excludes.length > 0 && message) {
        if (excludes.some((p) => message.includes(p))) return;
      }
      const now = Date.now();
      const norm = (message || "").replace(/^Uncaught\s+\w+:\s*/, "").slice(0, 100);
      let sig;
      try {
        sig = (stack || "") + "\n" + JSON.stringify(context);
      } catch (e) {
        sig = {};
      }
      _recentErrors = _recentErrors.filter((r) => now - r.t < 200);
      const existingRecent = _recentErrors.find((r) => r.m === norm && (!r.sigs.has(source) || r.sigs.get(source) === sig));
      if (existingRecent) {
        if (!existingRecent.sigs.has(source)) existingRecent.sigs.set(source, sig);
        if (existingRecent.entry && source) {
          existingRecent.entry.firedAs = existingRecent.entry.firedAs || [existingRecent.entry.source];
          if (!existingRecent.entry.firedAs.includes(source)) {
            existingRecent.entry.firedAs.push(source);
          }
        }
        return;
      }
      const recentSlot = { m: norm, t: now, sigs: /* @__PURE__ */ new Map([[source, sig]]), entry: null };
      _recentErrors.push(recentSlot);
      if (_errorStorms.size > 100) {
        for (const [key, s] of _errorStorms) {
          if (now - s.lastSeen >= ERROR_STORM_WINDOW) _errorStorms.delete(key);
        }
      }
      const storm = _errorStorms.get(norm);
      if (storm && now - storm.lastSeen < ERROR_STORM_WINDOW) {
        storm.count++;
        storm.lastSeen = now;
        if (storm.count > ERROR_STORM_THRESHOLD && storm.lastEntry && _errors.includes(storm.lastEntry)) {
          storm.lastEntry._stormCount = storm.count;
          _errorCount++;
          if (_onErrorCallback) {
            try {
              _onErrorCallback(storm.lastEntry);
            } catch (e) {
            }
          }
          _notifySubscribers();
          return;
        }
      } else {
        _errorStorms.set(norm, { count: 1, firstSeen: now, lastSeen: now, lastEntry: null });
      }
      if (message && message.includes("Import trace")) {
        message = message.split(/\nImport trace/)[0].trim();
      }
      if (message && message.includes("requires an index")) {
        try {
          const indexUrlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s"')]+/);
          const isBuilding = /currently building|cannot be used yet|is not yet usable/i.test(message);
          const hint = isBuilding ? "Index is still building \u2014 wait 1\u20135 minutes and retry" : "Create the missing Firestore index";
          context = __spreadValues(__spreadProps(__spreadValues(__spreadValues({}, context), indexUrlMatch ? { action_url: indexUrlMatch[0] } : {}), {
            action_hint: hint
          }), isBuilding ? { transient: true } : {});
        } catch (e) {
        }
      }
      _writingError = true;
      _errorCount++;
      const truncatedMessage = message ? message.slice(0, _config.maxMessageLength) : "";
      const { fingerprint: _fp } = generateFingerprint(truncatedMessage, source, _getCurrentPath(), stack);
      const _internal = isStackEntirelyInternal(stack);
      const entry = __spreadProps(__spreadValues({
        _fingerprint: _fp,
        message: truncatedMessage,
        stack: stack || "",
        source,
        firedAs: source ? [source] : [],
        path: _getCurrentPath(),
        url: _stripQueryParams(window.location.href),
        breadcrumbs: _breadcrumbs ? _breadcrumbs.snapshot() : [],
        context,
        internal: _internal || void 0,
        metadata: __spreadValues(__spreadValues({
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          language: navigator.language
        }, _config.buildSha ? { buildSha: _config.buildSha } : {}), _config.nodeEnv ? { nodeEnv: _config.nodeEnv } : {}),
        sessionId: _sessionId
      }, _config.sessionTag ? { sessionTag: _config.sessionTag } : {}), {
        schemaVersion: _config.schemaVersion,
        environment: _config.environment || null,
        tags: _config.tags || {},
        user: _config.user || null
      });
      _errors.push(entry);
      if (_errors.length > 50) _errors.shift();
      recentSlot.entry = entry;
      _runDiagnosticsFor(entry);
      const stormEntry = _errorStorms.get(norm);
      if (stormEntry) stormEntry.lastEntry = entry;
      blackbox._addBreadcrumb("error", { message: truncatedMessage, source });
      if (_onErrorCallback) {
        try {
          _onErrorCallback(entry);
        } catch (e) {
        }
      }
      if (_config.failFast && !_internal) {
        try {
          if (typeof window !== "undefined" && !window.__BB_FAIL_FAST_TRIPPED__) {
            const trip = {
              fingerprint: _fp,
              message: truncatedMessage,
              source,
              recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
              sessionTag: _config.sessionTag || null
            };
            window.__BB_FAIL_FAST_TRIPPED__ = trip;
            try {
              window.dispatchEvent(new CustomEvent("blackbox:fail-fast", { detail: trip }));
            } catch (e) {
            }
          }
        } catch (e) {
        }
      }
      _notifySubscribers();
    } catch (e) {
    } finally {
      _writingError = false;
    }
  },
  _getConfig() {
    return __spreadValues({}, _config);
  },
  _onError(callback) {
    const prev = _onErrorCallback;
    _onErrorCallback = prev ? (entry) => {
      prev(entry);
      callback(entry);
    } : callback;
  },
  _onActivityFlush(callback) {
    const prev = _onActivityFlushCallback;
    _onActivityFlushCallback = prev ? (data) => {
      prev(data);
      callback(data);
    } : callback;
  },
  _stripQueryParams(url) {
    return _stripQueryParams(url);
  },
  _getNativeFetch() {
    return _nativeFetch;
  },
  _getCurrentPath() {
    return _getCurrentPath();
  },
  // Pending fetch tracking (used by silence detector)
  _incrementPendingFetches() {
    _pendingFetchCount++;
    _lastFetchStartTime = Date.now();
  },
  _decrementPendingFetches() {
    _pendingFetchCount = Math.max(0, _pendingFetchCount - 1);
  },
  // Suspicious silence support
  _registerSilenceCheck(clickDetails) {
    if (!_initialized) return;
    const clickTime = Date.now();
    const checkId = setTimeout(() => {
      var _a;
      try {
        const crumbs = _breadcrumbs ? _breadcrumbs.snapshot() : [];
        const meaningfulTypes = ["network", "navigation", "warning", "error", "custom", "form"];
        const hasFollowup = crumbs.some((c) => {
          if (!meaningfulTypes.includes(c.type)) return false;
          return new Date(c.timestamp).getTime() > clickTime;
        });
        if (!hasFollowup && _pendingFetchCount > 0 && _lastFetchStartTime > clickTime) {
          return;
        }
        if (!hasFollowup) {
          let relatedError = null;
          const recentErrs = _errors.slice(-10);
          for (const err of recentErrs) {
            const errTime = ((_a = err.metadata) == null ? void 0 : _a.timestamp) ? new Date(err.metadata.timestamp).getTime() : 0;
            if (errTime > clickTime && errTime < clickTime + _config.silenceDetectionDelay + 500) {
              relatedError = { message: err.message, source: err.source, fingerprint: err._fingerprint || null };
              break;
            }
          }
          const silence = __spreadProps(__spreadValues({
            type: "suspicious_silence",
            action: "click_without_followup",
            clickedElement: clickDetails,
            waitedMs: _config.silenceDetectionDelay
          }, relatedError ? { relatedError } : {}), {
            _timestamp: clickTime
          });
          const recentSilences = _suspiciousSilences.filter((s) => {
            const sTime = s._timestamp || 0;
            return clickTime - sTime < 15e3;
          });
          const sameElement = (a, b) => {
            if (!a || !b || a.tag !== b.tag) return false;
            if (a.dataBb != null || b.dataBb != null) return a.dataBb === b.dataBb;
            if (a.id || b.id) return a.id === b.id;
            if (a.text || b.text) return a.text === b.text;
            return false;
          };
          const relatedSilenceCount = recentSilences.filter(
            (s) => sameElement(s.clickedElement, clickDetails)
          ).length;
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();
          const isUserStuck = relatedSilenceCount >= 2;
          const hasRelatedError = !!relatedError;
          if (isUserStuck || hasRelatedError) {
            if (isUserStuck) {
              silence.action = "user_stuck";
              silence.relatedSilenceCount = relatedSilenceCount + 1;
            }
            silence._surfaced = true;
            blackbox._addBreadcrumb("suspicious_silence", silence);
          }
        }
      } catch (e) {
      }
      const idx = _pendingSilenceChecks.indexOf(checkId);
      if (idx !== -1) _pendingSilenceChecks.splice(idx, 1);
    }, _config.silenceDetectionDelay);
    _pendingSilenceChecks.push(checkId);
  },
  /**
   * Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup.
   * Keeps onUpdate subscribers and registered diagnostics: their owners (e.g. the panel,
   * top-level registerDiagnostic calls) outlive this teardown and remove them with the
   * unsubscribe function / unregisterDiagnostic.
   */
  destroy() {
    _initialized = false;
    _config = {};
    _preInit = {};
    _sessionId = null;
    _breadcrumbs = null;
    _errors = [];
    _errorCount = 0;
    _onErrorCallback = null;
    _onActivityFlushCallback = null;
    _suspiciousSilences = [];
    _pendingFetchCount = 0;
    _lastFetchStartTime = 0;
    _recentErrors = [];
    _errorStorms = /* @__PURE__ */ new Map();
    for (const id of _pendingSilenceChecks) clearTimeout(id);
    _pendingSilenceChecks = [];
    if (_flushTimer) clearInterval(_flushTimer);
    _flushTimer = null;
    for (const cleanup of _cleanupFns) {
      try {
        cleanup();
      } catch (e) {
      }
    }
    _cleanupFns = [];
    try {
      _resetPersistence();
    } catch (e) {
    }
    try {
      _resetActivityLog();
    } catch (e) {
    }
    _notifySubscribers();
  },
  // For testing: full wipe, including caller-owned registrations
  _reset() {
    this.destroy();
    _subscribers = [];
    _diagnostics = [];
  }
};
var blackbox_default = blackbox;

export {
  blackbox_default
};
