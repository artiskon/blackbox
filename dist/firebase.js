var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/fingerprint.js
function stripQueryParams(path) {
  if (!path) return "";
  try {
    const qIndex = path.indexOf("?");
    if (qIndex === -1) return path;
    const hashIndex = path.indexOf("#");
    if (hashIndex !== -1 && hashIndex < qIndex) return path;
    const base = path.substring(0, qIndex);
    const hash = hashIndex > qIndex ? path.substring(hashIndex) : "";
    return base + hash;
  } catch (e) {
    return path;
  }
}
function normalizePath(path) {
  let normalized = stripQueryParams(path || "");
  normalized = normalized.replace(UUID_RE, ":id");
  normalized = normalized.replace(NUMERIC_ID_RE, "/:num");
  return normalized;
}
function extractTopAppFrame(stack) {
  if (!stack) return "";
  const lines = stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("at ")) continue;
    if (SKIP_FRAMES_RE.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}
function hashString(str) {
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
  h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
  h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  let val = combined;
  for (let i = 0; i < 8; i++) {
    result += chars[Math.abs(val) % 36];
    val = Math.floor(val / 36);
  }
  return result;
}
function generateFingerprint(message, source, path, stack) {
  const truncatedMessage = (message || "").slice(0, 100);
  const normalizedPath = normalizePath(path);
  const topFrame = extractTopAppFrame(stack);
  const input = `${truncatedMessage}|${source || ""}|${normalizedPath}|${topFrame}`;
  const fingerprint = hashString(input);
  return {
    fingerprint,
    groupingInputs: {
      message: truncatedMessage,
      source: source || "",
      normalizedPath,
      topFrame
    }
  };
}
var UUID_RE, NUMERIC_ID_RE, SKIP_FRAMES_RE;
var init_fingerprint = __esm({
  "src/core/fingerprint.js"() {
    "use strict";
    UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;
    SKIP_FRAMES_RE = /node_modules|webpack|blackbox|__webpack|hot-update|\(native\)|<anonymous>/i;
  }
});

// src/core/persistence.js
var persistence_exports = {};
__export(persistence_exports, {
  _resetPersistence: () => _resetPersistence,
  _setCollectionRef: () => _setCollectionRef,
  _setFirestoreFns: () => _setFirestoreFns,
  getCollectionRef: () => getCollectionRef,
  getFirestoreFunctions: () => getFirestoreFunctions,
  getPersistenceConfig: () => getPersistenceConfig,
  initPersistence: () => initPersistence,
  isCircuitOpen: () => isCircuitOpen
});
async function getFirestoreFns() {
  if (_firestoreFns) return _firestoreFns;
  try {
    const mod = await import("firebase/firestore");
    _firestoreFns = {
      collection: mod.collection,
      addDoc: mod.addDoc,
      updateDoc: mod.updateDoc,
      query: mod.query,
      where: mod.where,
      limit: mod.limit,
      getDocs: mod.getDocs,
      serverTimestamp: mod.serverTimestamp,
      Timestamp: mod.Timestamp
    };
    return _firestoreFns;
  } catch (e) {
    console.warn("[BlackBox] Failed to load firebase/firestore:", e);
    return null;
  }
}
function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch (e) {
    return JSON.stringify(doc).length * 2;
  }
}
function trimDocument(doc, maxBytes) {
  let trimmed = __spreadValues({}, doc);
  let size = estimateDocBytes(trimmed);
  if (size <= maxBytes) return trimmed;
  if (trimmed.breadcrumbs && trimmed.breadcrumbs.length > 40) {
    trimmed.breadcrumbs = trimmed.breadcrumbs.slice(-40);
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }
  if (trimmed.context && typeof trimmed.context === "object") {
    const ctx = {};
    for (const [k, v] of Object.entries(trimmed.context)) {
      if (typeof v === "string" && v.length > 200) {
        ctx[k] = v.slice(0, 200);
      } else {
        ctx[k] = v;
      }
    }
    trimmed.context = ctx;
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }
  if (trimmed.metadata) {
    trimmed.metadata = __spreadValues({}, trimmed.metadata);
    delete trimmed.metadata.userAgent;
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }
  if (trimmed.breadcrumbs && trimmed.breadcrumbs.length > 20) {
    trimmed.breadcrumbs = trimmed.breadcrumbs.slice(-20);
  }
  return trimmed;
}
function isSafeEnvironment(config) {
  if (config.collectionName && config.collectionName.startsWith("__")) return true;
  try {
    if (_db && _db._settings && _db._settings.host && _db._settings.host.includes("localhost")) return true;
    if (_db && _db.toJSON && JSON.stringify(_db.toJSON()).includes("localhost")) return true;
  } catch (e) {
  }
  try {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development") return true;
  } catch (e) {
  }
  return false;
}
function persistError(errorEntry) {
  if (_circuitOpen) return;
  if (_writingError) return;
  _writeQueue.push(errorEntry);
  if (!_processing) {
    _processQueue();
  }
}
async function _processQueue() {
  _processing = true;
  while (_writeQueue.length > 0) {
    if (_circuitOpen) {
      _writeQueue = [];
      break;
    }
    const entry = _writeQueue.shift();
    await _doWrite(entry);
  }
  _processing = false;
}
async function _doWrite(errorEntry) {
  _writingError = true;
  try {
    const fns = await getFirestoreFns();
    if (!fns || !_collectionRef) return;
    const { fingerprint, groupingInputs } = generateFingerprint(
      errorEntry.message,
      errorEntry.source,
      errorEntry.path,
      errorEntry.stack
    );
    let existingDoc = null;
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
      const dedupQuery = fns.query(
        _collectionRef,
        fns.where("fingerprint", "==", fingerprint),
        fns.where("type", "==", "error"),
        fns.where("createdAt", ">=", fns.Timestamp.fromDate(twentyFourHoursAgo)),
        fns.limit(1)
      );
      const snapshot = await fns.getDocs(dedupQuery);
      if (!snapshot.empty) {
        existingDoc = snapshot.docs[0];
      }
    } catch (e) {
      existingDoc = null;
    }
    if (existingDoc) {
      try {
        const currentData = existingDoc.data();
        await fns.updateDoc(existingDoc.ref, {
          occurrences: (currentData.occurrences || 1) + 1,
          lastSeen: fns.serverTimestamp(),
          breadcrumbs: errorEntry.breadcrumbs || []
        });
        _failureCount = 0;
        return;
      } catch (e) {
        handleWriteFailure(e);
        return;
      }
    }
    let doc = {
      schemaVersion: _config.schemaVersion,
      fingerprint,
      groupingInputs,
      sessionId: errorEntry.sessionId,
      type: "error",
      message: errorEntry.message,
      stack: errorEntry.stack || "",
      source: errorEntry.source,
      url: errorEntry.url,
      path: errorEntry.path,
      breadcrumbs: errorEntry.breadcrumbs || [],
      context: errorEntry.context || {},
      metadata: errorEntry.metadata || {},
      occurrences: 1,
      firstSeen: fns.serverTimestamp(),
      lastSeen: fns.serverTimestamp(),
      createdAt: fns.serverTimestamp()
    };
    doc = trimDocument(doc, _config.maxDocumentBytes);
    try {
      await fns.addDoc(_collectionRef, doc);
      _failureCount = 0;
    } catch (e) {
      handleWriteFailure(e);
    }
  } catch (e) {
  } finally {
    _writingError = false;
  }
}
function handleWriteFailure(e) {
  _failureCount++;
  if (_failureCount >= _config.maxWriteFailures) {
    _circuitOpen = true;
    console.warn(`[BlackBox] Firestore writes disabled after ${_config.maxWriteFailures} failures. Running in memory-only mode.`);
  }
}
function initPersistence(blackbox2, db) {
  try {
    _blackbox = blackbox2;
    _db = db;
    _config = blackbox2._getConfig();
    _failureCount = 0;
    _circuitOpen = false;
    _writingError = false;
    if (!isSafeEnvironment(_config)) {
      try {
        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
          console.warn("[BlackBox] Persistence disabled in production.");
          return;
        }
        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "development") {
          console.warn("[BlackBox] Persistence disabled: environment is not development and collection does not start with __.");
          return;
        }
      } catch (e) {
      }
    }
    getFirestoreFns().then((fns) => {
      if (fns) {
        _collectionRef = fns.collection(db, _config.collectionName);
      }
    }).catch(() => {
    });
    blackbox2._onError((errorEntry) => {
      persistError(errorEntry);
    });
  } catch (e) {
    console.warn("[BlackBox] Persistence init failed:", e);
  }
}
function isCircuitOpen() {
  return _circuitOpen;
}
function getCollectionRef() {
  return _collectionRef;
}
function getFirestoreFunctions() {
  return getFirestoreFns();
}
function getPersistenceConfig() {
  return _config;
}
function _resetPersistence() {
  _db = null;
  _config = {};
  _blackbox = null;
  _failureCount = 0;
  _circuitOpen = false;
  _writingError = false;
  _collectionRef = null;
  _firestoreFns = null;
  _writeQueue = [];
  _processing = false;
}
function _setFirestoreFns(fns) {
  _firestoreFns = fns;
}
function _setCollectionRef(ref) {
  _collectionRef = ref;
}
var _db, _config, _blackbox, _failureCount, _circuitOpen, _writingError, _collectionRef, _writeQueue, _processing, _firestoreFns;
var init_persistence = __esm({
  "src/core/persistence.js"() {
    "use strict";
    init_fingerprint();
    _db = null;
    _config = {};
    _blackbox = null;
    _failureCount = 0;
    _circuitOpen = false;
    _writingError = false;
    _collectionRef = null;
    _writeQueue = [];
    _processing = false;
    _firestoreFns = null;
  }
});

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
  activityFlushInterval: 6e4,
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
  sanitize: null
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
  const handler = (event) => {
    var _a, _b, _c, _d, _e, _f;
    try {
      const target = event.target;
      const el = target.closest ? target.closest('button, a, [role="button"], input[type="submit"], [data-bb]') || target : target;
      const tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
      const text = ((_b = (_a = el.textContent) == null ? void 0 : _a.trim()) == null ? void 0 : _b.slice(0, 100)) || "";
      const id = el.id || null;
      const className = ((_d = (_c = el.className) == null ? void 0 : _c.toString()) == null ? void 0 : _d.slice(0, config.maxClassNameLength)) || "";
      const dataBb = ((_e = el.dataset) == null ? void 0 : _e.bb) || null;
      let href = el.href || null;
      if (href) href = blackbox2._stripQueryParams(href);
      blackbox2._addBreadcrumb("click", { tag, text, id, className, dataBb, href });
      const isInteractive = tag === "button" || tag === "input" && el.type === "submit" || ((_f = el.getAttribute) == null ? void 0 : _f.call(el, "role")) === "button";
      if (isInteractive) {
        blackbox2._registerSilenceCheck({ tag, text, id, dataBb });
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
  function stringifyArgs(args) {
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
  window.fetch = async function(input, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    let url = "";
    try {
      url = typeof input === "string" ? input : (input == null ? void 0 : input.url) || String(input);
      url = blackbox2._stripQueryParams(url);
      if (url.length > config.maxUrlLength) url = url.slice(0, config.maxUrlLength);
    } catch (e) {
    }
    const start = Date.now();
    let response;
    try {
      response = await originalFetch(input, init);
    } catch (err) {
      try {
        const duration = Date.now() - start;
        blackbox2._addBreadcrumb("network", { method, url, status: 0, duration: `${duration}ms`, ok: false, error: err.message });
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
      const crumbData = { method, url, status, duration: `${duration}ms`, ok };
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
          duration: `${duration}ms`,
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

// src/core/blackbox.js
init_persistence();

// src/core/activityLog.js
init_persistence();
var _blackbox2 = null;
var _lastFlushTime = null;
var _lastFlushIndex = 0;
function estimateDocBytes2(doc) {
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
    let doc = {
      schemaVersion: config.schemaVersion,
      type: "activity",
      sessionId: _blackbox2.getSessionId(),
      breadcrumbs,
      period: {
        from,
        to: now
      },
      metadata: {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: now
      },
      createdAt: fns.serverTimestamp()
    };
    const size = estimateDocBytes2(doc);
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
    _blackbox2 = blackbox2;
    _lastFlushTime = null;
    blackbox2._onActivityFlush((breadcrumbs) => {
      flushActivity(breadcrumbs);
    });
  } catch (e) {
    console.warn("[BlackBox] Activity log init failed:", e);
  }
}
function _resetActivityLog() {
  _blackbox2 = null;
  _lastFlushTime = null;
  _lastFlushIndex = 0;
}

// src/core/blackbox.js
var _initialized = false;
var _config2 = {};
var _sessionId = null;
var _breadcrumbs = null;
var _errors = [];
var _errorCount = 0;
var _subscribers = [];
var _onErrorCallback = null;
var _onActivityFlushCallback = null;
var _flushTimer = null;
var _writingError2 = false;
var _suspiciousSilences = [];
var _pendingSilenceChecks = [];
var _cleanupFns = [];
function _stripQueryParams(url) {
  if (!url || !_config2.stripQueryParams) return url;
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
  for (const cb of _subscribers) {
    try {
      cb();
    } catch (e) {
    }
  }
}
var blackbox = {
  init(options = {}) {
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
    _config2 = __spreadValues(__spreadValues({}, DEFAULTS), options);
    _sessionId = generateSessionId();
    _breadcrumbs = new BreadcrumbManager(_config2.maxBreadcrumbs, _config2.maxBreadcrumbRepeat);
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
    }, _config2.activityFlushInterval);
    _initialized = true;
    if (_config2.db) {
      try {
        initPersistence(blackbox, _config2.db);
      } catch (e) {
        console.warn("[BlackBox] Persistence init failed:", e);
      }
      try {
        initActivityLog(blackbox);
      } catch (e) {
        console.warn("[BlackBox] Activity log init failed:", e);
      }
    }
    blackbox._addBreadcrumb("system", { action: "blackbox_initialized", sessionId: _sessionId });
    console.log(`[BlackBox] Active | session: ${_sessionId}`);
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await Promise.resolve().then(() => (init_persistence(), persistence_exports));
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await Promise.resolve().then(() => (init_persistence(), persistence_exports));
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await Promise.resolve().then(() => (init_persistence(), persistence_exports));
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
      const { getCollectionRef: getCollectionRef2, getFirestoreFunctions: getFirestoreFunctions2 } = await Promise.resolve().then(() => (init_persistence(), persistence_exports));
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
    return !!_config2.db;
  },
  _addBreadcrumb(type, data) {
    if (!_initialized || !_breadcrumbs) return;
    let breadcrumb = __spreadValues({ type, path: _getCurrentPath() }, data);
    if (_config2.sanitize) {
      try {
        breadcrumb = _config2.sanitize(breadcrumb);
        if (breadcrumb === null || breadcrumb === void 0) return;
      } catch (e) {
      }
    }
    const _a = breadcrumb, { type: crumbType } = _a, rest = __objRest(_a, ["type"]);
    _breadcrumbs.add(crumbType, rest);
    _notifySubscribers();
  },
  _recordError({ message, stack, source, context = {} }) {
    if (_writingError2) return;
    if (!_initialized) return;
    try {
      if (message && message.includes("[BlackBox]")) return;
      _writingError2 = true;
      _errorCount++;
      const truncatedMessage = message ? message.slice(0, _config2.maxMessageLength) : "";
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
        schemaVersion: _config2.schemaVersion
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
      _writingError2 = false;
    }
  },
  _getConfig() {
    return __spreadValues({}, _config2);
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
            waitedMs: _config2.silenceDetectionDelay
          };
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();
          blackbox._addBreadcrumb("suspicious_silence", silence);
        }
      } catch (e) {
      }
    }, _config2.silenceDetectionDelay);
    _pendingSilenceChecks.push(checkId);
  },
  /** Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup. */
  destroy() {
    _initialized = false;
    _config2 = {};
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

// src/core/hooks/firebaseHook.js
async function bbFirestoreOp(operationName, promise) {
  try {
    const result = await promise;
    try {
      blackbox_default._addBreadcrumb("firebase", { action: operationName, status: "success" });
    } catch (e) {
    }
    return result;
  } catch (error) {
    try {
      blackbox_default._recordError({
        message: error.message || String(error),
        stack: error.stack || "",
        source: "firebase",
        context: { code: error.code, message: error.message, operation: operationName }
      });
    } catch (e) {
    }
    throw error;
  }
}
async function bbTrackAuth(auth) {
  try {
    const { onAuthStateChanged } = await import("firebase/auth");
    return onAuthStateChanged(auth, (user) => {
      var _a, _b;
      try {
        if (user) {
          blackbox_default._addBreadcrumb("firebase", {
            action: "auth_state_changed",
            status: "signed_in",
            uid: user.uid,
            provider: ((_b = (_a = user.providerData) == null ? void 0 : _a[0]) == null ? void 0 : _b.providerId) || "unknown"
          });
        } else {
          blackbox_default._addBreadcrumb("firebase", {
            action: "auth_state_changed",
            status: "signed_out"
          });
        }
      } catch (e) {
      }
    });
  } catch (e) {
    console.warn("[BlackBox] bbTrackAuth failed:", e);
  }
}
async function bbOnSnapshot(query, onNext, onError) {
  try {
    const { onSnapshot } = await import("firebase/firestore");
    return onSnapshot(
      query,
      (snapshot) => {
        var _a;
        try {
          blackbox_default._addBreadcrumb("firebase", {
            action: "snapshot_received",
            docs: snapshot.size,
            fromCache: ((_a = snapshot.metadata) == null ? void 0 : _a.fromCache) || false
          });
        } catch (e) {
        }
        try {
          onNext(snapshot);
        } catch (e) {
        }
      },
      (error) => {
        try {
          blackbox_default._recordError({
            message: error.message || String(error),
            stack: error.stack || "",
            source: "firebase_listener",
            context: { code: error.code }
          });
        } catch (e) {
        }
        if (onError) {
          try {
            onError(error);
          } catch (e) {
          }
        }
      }
    );
  } catch (e) {
    console.warn("[BlackBox] bbOnSnapshot failed:", e);
  }
}
export {
  bbFirestoreOp,
  bbOnSnapshot,
  bbTrackAuth
};
