'use client';
import {
  __objRest,
  __spreadValues,
  _resetPersistence,
  getCollectionRef,
  getFirestoreFunctions,
  getPersistenceConfig,
  initPersistence,
  isCircuitOpen
} from "./chunk-VVEOEWI2.js";

// src/core/constants.js
var DEFAULTS = {
  collectionName: "__blackbox",
  maxBreadcrumbs: 80,
  slowRequestThreshold: 3e3,
  silenceDetectionDelay: 2e3,
  maxMessageLength: 2e3,
  maxUrlLength: 500,
  maxBodyLength: 0,
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
  // Network noise filtering
  networkExcludePatterns: [
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "__nextjs_original-stack-frames",
    "hot-update"
  ],
  // Context tagging
  environment: null,
  tags: {},
  user: null
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
      const message = (reason == null ? void 0 : reason.message) || String(reason);
      const stack = (reason == null ? void 0 : reason.stack) || "";
      blackbox2._recordError({ message, stack, source: "unhandled_promise", context: {} });
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
  function getLabel(el) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    if ((_a = el.dataset) == null ? void 0 : _a.bb) return null;
    const text = ((_c = (_b = el.textContent) == null ? void 0 : _b.trim()) == null ? void 0 : _c.slice(0, 100)) || "";
    if (text.length >= 2) return null;
    const ariaLabel = (_d = el.getAttribute) == null ? void 0 : _d.call(el, "aria-label");
    if (ariaLabel) return ariaLabel.slice(0, 100);
    const title = (_e = el.getAttribute) == null ? void 0 : _e.call(el, "title");
    if (title) return title.slice(0, 100);
    const parent = (_f = el.closest) == null ? void 0 : _f.call(el, "button, a");
    if (parent && parent !== el) {
      const parentText = (_h = (_g = parent.textContent) == null ? void 0 : _g.trim()) == null ? void 0 : _h.slice(0, 100);
      if (parentText && parentText.length >= 2) return parentText;
      const parentAria = (_i = parent.getAttribute) == null ? void 0 : _i.call(parent, "aria-label");
      if (parentAria) return parentAria.slice(0, 100);
    }
    return null;
  }
  const handler = (event) => {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
      const target = event.target;
      if ((_a = target.closest) == null ? void 0 : _a.call(target, "[data-bb-panel]")) return;
      const el = target.closest ? target.closest('button, a, [role="button"], input[type="submit"], [data-bb]') || target : target;
      const tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
      const text = ((_c = (_b = el.textContent) == null ? void 0 : _b.trim()) == null ? void 0 : _c.slice(0, 100)) || "";
      const id = el.id || null;
      const className = ((_e = (_d = el.className) == null ? void 0 : _d.toString()) == null ? void 0 : _e.slice(0, config.maxClassNameLength)) || "";
      const dataBb = ((_f = el.dataset) == null ? void 0 : _f.bb) || null;
      let href = el.href || null;
      if (href) href = blackbox2._stripQueryParams(href);
      const autoLabel = text.length < 2 && !dataBb ? getLabel(el) : null;
      blackbox2._addBreadcrumb("click", { tag, text, id, className, dataBb, href, autoLabel });
      const isInteractive = tag === "button" || tag === "input" && el.type === "submit" || ((_g = el.getAttribute) == null ? void 0 : _g.call(el, "role")) === "button";
      if (isInteractive) {
        blackbox2._registerSilenceCheck({ tag, text: autoLabel || text, id, dataBb });
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
  const recordNavigation = () => {
    try {
      const newPath = blackbox2._getCurrentPath();
      if (newPath !== previousPath) {
        blackbox2._addBreadcrumb("navigation", { from: previousPath, to: newPath });
        previousPath = newPath;
      }
    } catch (e) {
    }
  };
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function(...args) {
    const result = originalPushState(...args);
    recordNavigation();
    return result;
  };
  history.replaceState = function(...args) {
    const result = originalReplaceState(...args);
    recordNavigation();
    return result;
  };
  const popstateHandler = () => {
    recordNavigation();
  };
  window.addEventListener("popstate", popstateHandler);
  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", popstateHandler);
  };
}

// src/core/hooks/consoleHook.js
function installConsoleHook(blackbox2) {
  const config = blackbox2._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  function interpolateFormatString(args) {
    if (args.length < 2 || typeof args[0] !== "string") return null;
    const fmt = args[0];
    if (!/%[sdoOif%]/.test(fmt)) return null;
    let i = 1;
    const result = fmt.replace(/%([sdoOif%])/g, (match, type) => {
      if (type === "%") return "%";
      if (i >= args.length) return match;
      const val = args[i++];
      if (type === "s") return String(val);
      if (type === "d" || type === "i" || type === "f") return Number(val);
      if (type === "o" || type === "O") {
        try {
          return JSON.stringify(val);
        } catch (e) {
          return String(val);
        }
      }
      return String(val);
    });
    const remaining = args.slice(i);
    if (remaining.length > 0) {
      return (result + " " + remaining.map((a) => typeof a === "string" ? a : String(a)).join(" ")).slice(0, config.maxMessageLength);
    }
    return result.slice(0, config.maxMessageLength);
  }
  function stringifyArgs(args) {
    const interpolated = interpolateFormatString(args);
    if (interpolated !== null) return interpolated;
    return args.map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    }).join(" ").slice(0, config.maxMessageLength);
  }
  function matchesIgnorePattern(message) {
    return ignorePatterns.some((pattern) => message.includes(pattern));
  }
  console.error = function(...args) {
    originalError(...args);
    try {
      const message = stringifyArgs(args);
      if (message.includes("[BlackBox]")) return;
      if (matchesIgnorePattern(message)) return;
      const stack = new Error().stack || "";
      blackbox2._recordError({ message, stack, source: "console.error", context: {} });
    } catch (e) {
    }
  };
  console.warn = function(...args) {
    originalWarn(...args);
    try {
      const message = stringifyArgs(args);
      if (message.includes("[BlackBox]")) return;
      if (matchesIgnorePattern(message)) return;
      blackbox2._addBreadcrumb("warning", { message });
    } catch (e) {
    }
  };
  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}

// src/core/hooks/networkHook.js
function installNetworkHook(blackbox2) {
  const config = blackbox2._getConfig();
  const originalFetch = window.fetch.bind(window);
  const excludePatterns = config.networkExcludePatterns || [];
  function isExcludedUrl(url) {
    return excludePatterns.some((pattern) => url.includes(pattern));
  }
  window.fetch = async function(input, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    let url = "";
    try {
      url = typeof input === "string" ? input : (input == null ? void 0 : input.url) || String(input);
      url = blackbox2._stripQueryParams(url);
      if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
    } catch (e) {
    }
    if (isExcludedUrl(url)) {
      return originalFetch(input, init);
    }
    const start = Date.now();
    let response;
    try {
      response = await originalFetch(input, init);
    } catch (err) {
      try {
        const duration = Date.now() - start;
        blackbox2._addBreadcrumb("network", { method, url, status: 0, duration, ok: false, error: err.message });
        blackbox2._recordError({
          message: `Network error: ${method} ${url} - ${err.message}`,
          stack: err.stack || "",
          source: "network",
          context: { method, url, duration }
        });
      } catch (e) {
      }
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
        } catch (e) {
        }
      }
      blackbox2._addBreadcrumb("network", crumbData);
      if (!ok) {
        blackbox2._recordError({
          message: `HTTP ${status}: ${method} ${url}`,
          stack: "",
          source: "network",
          context: { status, method, url, duration }
        });
      }
      if (ok && duration > config.slowRequestThreshold) {
        blackbox2._addBreadcrumb("performance", {
          action: "slow_request",
          method,
          url,
          duration,
          threshold: config.slowRequestThreshold
        });
      }
    } catch (e) {
    }
    return response;
  };
  return () => {
    window.fetch = originalFetch;
  };
}

// src/core/hooks/formHook.js
function installFormHook(blackbox2) {
  const handler = (event) => {
    var _a;
    try {
      const form = event.target;
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
      const crumb = {
        action: "form_submit",
        formId: form.id || form.name || "unknown_form",
        fieldCount: fields.filter((f) => f.name).length,
        invalidCount: invalidFields.length,
        invalidFields
      };
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
  document.addEventListener("submit", handler, true);
  return () => {
    document.removeEventListener("submit", handler, true);
  };
}

// src/core/hooks/resourceHook.js
function installResourceHook(blackbox2) {
  const resourceTags = /* @__PURE__ */ new Set(["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO", "SOURCE"]);
  const handler = (event) => {
    var _a;
    try {
      const target = event.target;
      if (target === window || !target.tagName) return;
      if (!resourceTags.has(target.tagName)) return;
      const tagName = target.tagName.toLowerCase();
      const src = blackbox2._stripQueryParams(target.src || target.href || "");
      blackbox2._recordError({
        message: `Resource failed to load: ${tagName} - ${src}`,
        stack: "",
        source: "resource_load",
        context: {
          tagName,
          src,
          id: target.id || null,
          className: ((_a = target.className) == null ? void 0 : _a.toString()) || ""
        }
      });
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
function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch (e) {
    return JSON.stringify(doc).length * 2;
  }
}
async function flushActivity(currentBreadcrumbs) {
  if (isCircuitOpen()) return;
  try {
    const collRef = getCollectionRef();
    const fns = await getFirestoreFunctions();
    if (!fns || !collRef) return;
    const config = getPersistenceConfig();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const from = _lastFlushTime || now;
    const newCrumbs = currentBreadcrumbs.filter((c) => {
      return !_lastFlushTime || c.timestamp > _lastFlushTime;
    });
    if (newCrumbs.length === 0) return;
    let breadcrumbs = newCrumbs;
    const maxBytes = config.maxDocumentBytes || 5e5;
    if (breadcrumbs.length > 40) {
      breadcrumbs = breadcrumbs.slice(-40);
    }
    const bbConfig = _blackbox._getConfig();
    let doc = {
      schemaVersion: config.schemaVersion,
      type: "activity",
      sessionId: _blackbox.getSessionId(),
      environment: bbConfig.environment || null,
      tags: bbConfig.tags || {},
      user: bbConfig.user || null,
      breadcrumbs,
      period: {
        from,
        to: now
      },
      metadata: {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: now
      },
      createdAt: fns.serverTimestamp(),
      expireAt: fns.Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1e3))
      // auto-delete after 48h via Firestore TTL
    };
    const size = estimateDocBytes(doc);
    if (size > maxBytes && doc.breadcrumbs.length > 20) {
      doc.breadcrumbs = doc.breadcrumbs.slice(-20);
    }
    await fns.addDoc(collRef, doc);
    _lastFlushTime = now;
  } catch (e) {
  }
}
function initActivityLog(blackbox2) {
  try {
    _blackbox = blackbox2;
    _lastFlushTime = null;
    blackbox2._onActivityFlush((breadcrumbs) => {
      flushActivity(breadcrumbs);
    });
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
var _cleanupFns = [];
function _stripQueryParams(url) {
  if (!url || !_config.stripQueryParams) return url;
  try {
    if (url.startsWith("http")) {
      const u = new URL(url);
      return u.origin + u.pathname + u.hash;
    }
    const qIndex = url.indexOf("?");
    if (qIndex === -1) return url;
    const hashIndex = url.indexOf("#");
    if (hashIndex !== -1 && hashIndex < qIndex) return url;
    const base = url.substring(0, qIndex);
    const hash = hashIndex > qIndex ? url.substring(hashIndex) : "";
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
        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
          console.log("[BlackBox] Disabled");
          return blackbox;
        }
      } catch (e) {
      }
    }
    if (options.db && typeof options.db !== "object") {
      console.error("[BlackBox] init() `db` must be a Firestore instance. Got:", typeof options.db);
    }
    _config = __spreadValues(__spreadValues({}, DEFAULTS), options);
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
          if (pending.length > 0) {
            sessionStorage.setItem("__bb_pending_crumbs", JSON.stringify({
              sessionId: _sessionId,
              breadcrumbs: pending.slice(-40),
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }));
          }
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
        initPersistence(blackbox, _config.db);
      } catch (e) {
        console.warn("[BlackBox] Persistence init failed:", e);
      }
      try {
        initActivityLog(blackbox);
      } catch (e) {
        console.warn("[BlackBox] Activity log init failed:", e);
      }
      if (_pendingRecovery && _onActivityFlushCallback) {
        try {
          _onActivityFlushCallback(_pendingRecovery.breadcrumbs);
        } catch (e) {
        }
        _pendingRecovery = null;
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
    if (!_initialized) return;
    _config.user = userInfo;
  },
  setTag(key, value) {
    if (!_initialized) return;
    if (!_config.tags) _config.tags = {};
    _config.tags[key] = value;
  },
  setEnvironment(env) {
    if (!_initialized) return;
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
    return [..._suspiciousSilences];
  },
  clearErrors() {
    _errorCount = 0;
    _errors = [];
    _suspiciousSilences = [];
    _notifySubscribers();
  },
  getBreadcrumbs() {
    if (!_breadcrumbs) return [];
    return _breadcrumbs.snapshot();
  },
  // --- Firestore query methods for the UI panel ---
  async queryPersistedErrors(limit = 50) {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-76GQSQHZ.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { errors: [], connected: false };
      const q = fns.query(
        ref,
        fns.where("type", "==", "error"),
        fns.limit(limit)
      );
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map((d) => {
        var _a, _b, _c;
        const data = d.data();
        if ((_a = data.firstSeen) == null ? void 0 : _a.toDate) data.firstSeen = data.firstSeen.toDate().toISOString();
        if ((_b = data.lastSeen) == null ? void 0 : _b.toDate) data.lastSeen = data.lastSeen.toDate().toISOString();
        if ((_c = data.createdAt) == null ? void 0 : _c.toDate) data.createdAt = data.createdAt.toDate().toISOString();
        return __spreadValues({ id: d.id }, data);
      });
      errors.sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
      return { errors, connected: true };
    } catch (e) {
      return { errors: [], connected: false, error: e.message };
    }
  },
  async queryHealth() {
    try {
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-76GQSQHZ.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { connected: false };
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
      const q = fns.query(
        ref,
        fns.where("type", "==", "error"),
        fns.where("createdAt", ">=", fns.Timestamp.fromDate(twentyFourHoursAgo))
      );
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-76GQSQHZ.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { events: [], connected: false };
      const cutoff = new Date(Date.now() - minutes * 60 * 1e3);
      const q = fns.query(
        ref,
        fns.where("createdAt", ">=", fns.Timestamp.fromDate(cutoff))
      );
      const snapshot = await fns.getDocs(q);
      const seen = /* @__PURE__ */ new Set();
      const events = [];
      for (const doc of snapshot.docs) {
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await import("./persistence-76GQSQHZ.js");
      const fns = await getFirestoreFunctions2();
      const ref = getCollectionRef2();
      if (!fns || !ref) return { success: false, error: "Not connected to Firestore" };
      const snapshot = await fns.getDocs(ref);
      let deleted = 0;
      const { deleteDoc } = await import("firebase/firestore");
      for (const doc of snapshot.docs) {
        try {
          await deleteDoc(doc.ref);
          deleted++;
        } catch (e) {
        }
      }
      return { success: true, deleted };
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
      _writingError = true;
      _errorCount++;
      const truncatedMessage = message ? message.slice(0, _config.maxMessageLength) : "";
      const entry = {
        message: truncatedMessage,
        stack: stack || "",
        source,
        path: _getCurrentPath(),
        url: _stripQueryParams(window.location.href),
        breadcrumbs: _breadcrumbs ? _breadcrumbs.snapshot() : [],
        context,
        metadata: {
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          language: navigator.language
        },
        sessionId: _sessionId,
        schemaVersion: _config.schemaVersion,
        environment: _config.environment || null,
        tags: _config.tags || {},
        user: _config.user || null
      };
      _errors.push(entry);
      if (_errors.length > 50) _errors.shift();
      blackbox._addBreadcrumb("error", { message: truncatedMessage, source });
      if (_onErrorCallback) {
        try {
          _onErrorCallback(entry);
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
    _onErrorCallback = callback;
  },
  _onActivityFlush(callback) {
    _onActivityFlushCallback = callback;
  },
  _stripQueryParams(url) {
    return _stripQueryParams(url);
  },
  _getCurrentPath() {
    return _getCurrentPath();
  },
  // Suspicious silence support
  _registerSilenceCheck(clickDetails) {
    if (!_initialized) return;
    const clickTime = Date.now();
    const checkId = setTimeout(() => {
      try {
        const crumbs = _breadcrumbs ? _breadcrumbs.snapshot() : [];
        const meaningfulTypes = ["network", "navigation", "warning", "error", "custom"];
        const hasFollowup = crumbs.some((c) => {
          if (!meaningfulTypes.includes(c.type)) return false;
          return new Date(c.timestamp).getTime() > clickTime;
        });
        if (!hasFollowup) {
          const silence = {
            type: "suspicious_silence",
            action: "click_without_followup",
            clickedElement: clickDetails,
            waitedMs: _config.silenceDetectionDelay
          };
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();
          blackbox._addBreadcrumb("suspicious_silence", silence);
        }
      } catch (e) {
      }
    }, _config.silenceDetectionDelay);
    _pendingSilenceChecks.push(checkId);
  },
  /** Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup. */
  destroy() {
    _initialized = false;
    _config = {};
    _sessionId = null;
    _breadcrumbs = null;
    _errors = [];
    _errorCount = 0;
    _subscribers = [];
    _onErrorCallback = null;
    _onActivityFlushCallback = null;
    _suspiciousSilences = [];
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
  },
  // For testing: alias
  _reset() {
    this.destroy();
  }
};
var blackbox_default = blackbox;

export {
  blackbox_default
};
