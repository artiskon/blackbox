'use client';
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
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
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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

// src/core/fingerprint.js
var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
var NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;
var HASH_SEGMENT_RE = /\/[a-zA-Z0-9]{15,}(?=\/|$)/g;
var SKIP_FRAMES_RE = /node_modules|webpack|blackbox|__webpack|hot-update|\(native\)|<anonymous>|bbHandleError|console\.wrapped|at wrapped \(|consoleHook|errorHook|networkHook/i;
var INTERNAL_ONLY_FRAMES_RE = /react-dom[-_/]|react\/cjs\/|next\/dist\/|next\/router|next-server|webpack-internal|__webpack_require__|pdfjs-dist\/|firebase\/|@firebase\/|@grpc\/|grpc-web|hot-update|chunk-[a-zA-Z0-9]+\.(m?js)|node_modules_.*\._\.(m?js)|<anonymous>|\(native\)/i;
var FIRESTORE_DOC_PATH_RE = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\/([\w]{16,28})\b/g;
var ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+-]*/g;
var CHUNK_FILENAME_RE = /chunk-[a-zA-Z0-9]{6,}\.(m?js)/g;
var BUNDLE_HASH_RE = /\b[a-f0-9]{8,}\.bundle\.(m?js)/g;
var TURBOPACK_MODULE_RE = /_[a-f0-9]{6,}\._\.(m?js)/g;
var TRAILING_NUMBER_RE = /\s*[#(]\d+[)]?\s*$/;
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
  normalized = normalized.replace(HASH_SEGMENT_RE, "/:hash");
  return normalized;
}
var CDN_CGI_PREFIX_RE = /^\/cdn-cgi\/(?:image|imagedelivery)\/[^/]+/;
function normalizeMessageUrls(message) {
  if (!message) return message;
  return message.replace(/https?:\/\/[^\s"']+/g, (url) => {
    try {
      const u = new URL(url);
      let path = u.pathname;
      path = path.replace(CDN_CGI_PREFIX_RE, "");
      path = path.replace(UUID_RE, ":id");
      path = path.replace(NUMERIC_ID_RE, "/:num");
      path = path.replace(HASH_SEGMENT_RE, "/:hash");
      path = path.replace(/\/[^/]+\.[a-z]{2,5}$/i, "/*");
      return u.hostname + path;
    } catch (e) {
      return url;
    }
  });
}
function normalizeMessage(message) {
  if (!message) return "";
  let normalized = message.slice(0, 100);
  normalized = normalizeMessageUrls(normalized);
  normalized = normalized.replace(FIRESTORE_DOC_PATH_RE, "$1/:docId");
  normalized = normalized.replace(ISO_TIMESTAMP_RE, ":timestamp");
  normalized = normalized.replace(UUID_RE, ":id");
  normalized = normalized.replace(TRAILING_NUMBER_RE, "");
  return normalized;
}
function extractTopAppFrame(stack) {
  if (!stack) return "";
  const lines = stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("at ")) continue;
    if (SKIP_FRAMES_RE.test(trimmed)) continue;
    let normalized = trimmed;
    normalized = normalized.replace(CHUNK_FILENAME_RE, "chunk-:hash.$1");
    normalized = normalized.replace(BUNDLE_HASH_RE, ":hash.bundle.$1");
    normalized = normalized.replace(TURBOPACK_MODULE_RE, "_:hash._.$1");
    return normalized;
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
function isStackEntirelyInternal(stack) {
  if (!stack) return false;
  const lines = stack.split("\n");
  let frameCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("at ")) continue;
    frameCount++;
    if (!INTERNAL_ONLY_FRAMES_RE.test(trimmed)) {
      return false;
    }
  }
  return frameCount >= 2;
}
function generateFingerprint(message, source, path, stack) {
  const truncatedMessage = normalizeMessage(message);
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

// src/core/persistence.js
var _db = null;
var _config = {};
var _blackbox = null;
var _failureCount = 0;
var _circuitOpen = false;
var _writingError = false;
var _collectionRef = null;
var _writeQueue = [];
var _processing = false;
var _fingerprintCache = /* @__PURE__ */ new Map();
var _firstWriteLogged = false;
var _stormTracker = /* @__PURE__ */ new Map();
var STORM_WINDOW_MS = 5e3;
var STORM_THRESHOLD = 5;
var _firestoreFns = null;
async function getFirestoreFns() {
  if (_firestoreFns) return _firestoreFns;
  try {
    const mod = await import("firebase/firestore");
    _firestoreFns = {
      collection: mod.collection,
      addDoc: mod.addDoc,
      updateDoc: mod.updateDoc,
      deleteDoc: mod.deleteDoc,
      query: mod.query,
      where: mod.where,
      orderBy: mod.orderBy,
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
var MAX_TRACKED_USERS = 50;
function userKeyFor(errorEntry) {
  var _a;
  const uid = (_a = errorEntry == null ? void 0 : errorEntry.user) == null ? void 0 : _a.id;
  if (uid) return String(uid).slice(0, 64);
  if (errorEntry == null ? void 0 : errorEntry.sessionId) return `anon:${String(errorEntry.sessionId).slice(0, 16)}`;
  return null;
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
    const preserveKeys = ["componentStack"];
    for (const [k, v] of Object.entries(trimmed.context)) {
      if (typeof v === "string" && v.length > 200 && !preserveKeys.includes(k)) {
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
  const { fingerprint } = generateFingerprint(
    errorEntry.message,
    errorEntry.source,
    errorEntry.path,
    errorEntry.stack
  );
  const now = Date.now();
  const storm = _stormTracker.get(fingerprint);
  if (storm) {
    if (now - storm.firstSeen < STORM_WINDOW_MS) {
      storm.count++;
      storm.lastSeen = now;
      if (storm.count === STORM_THRESHOLD) {
        errorEntry._storm = { count: storm.count, windowMs: now - storm.firstSeen };
      }
      if (storm.count > STORM_THRESHOLD) {
        return;
      }
    } else {
      _stormTracker.set(fingerprint, { count: 1, firstSeen: now, lastSeen: now });
    }
  } else {
    _stormTracker.set(fingerprint, { count: 1, firstSeen: now, lastSeen: now });
  }
  if (_stormTracker.size > 100) {
    for (const [fp, s] of _stormTracker) {
      if (now - s.lastSeen > STORM_WINDOW_MS * 2) _stormTracker.delete(fp);
    }
  }
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
  var _a, _b;
  _writingError = true;
  try {
    const fns = await getFirestoreFns();
    if (!_collectionRef && fns && _db) {
      _collectionRef = fns.collection(_db, _config.collectionName);
    }
    if (!fns || !_collectionRef) return;
    const { fingerprint, groupingInputs } = generateFingerprint(
      errorEntry.message,
      errorEntry.source,
      errorEntry.path,
      errorEntry.stack
    );
    const cachedRef = _fingerprintCache.get(fingerprint);
    if (cachedRef) {
      try {
        const currentData = (_a = (await fns.getDocs(fns.query(_collectionRef, fns.where("fingerprint", "==", fingerprint), fns.limit(1)))).docs[0]) == null ? void 0 : _a.data();
        const stormCount = errorEntry._storm ? errorEntry._storm.count : 1;
        const updateData = {
          occurrences: ((currentData == null ? void 0 : currentData.occurrences) || 1) + stormCount,
          lastSeen: fns.serverTimestamp(),
          lastSeenSessionId: errorEntry.sessionId,
          breadcrumbs: errorEntry.breadcrumbs || []
        };
        const userKey2 = userKeyFor(errorEntry);
        if (userKey2) {
          const tracked = Array.isArray(currentData == null ? void 0 : currentData.uniqueUsers) ? currentData.uniqueUsers : [];
          if (!tracked.includes(userKey2) && tracked.length < MAX_TRACKED_USERS) {
            updateData.uniqueUsers = [...tracked, userKey2];
            updateData.uniqueUserCount = ((currentData == null ? void 0 : currentData.uniqueUserCount) || tracked.length) + 1;
          }
        }
        if (errorEntry._storm) {
          updateData.storm = { count: errorEntry._storm.count, windowMs: errorEntry._storm.windowMs };
        }
        await fns.updateDoc(cachedRef, updateData);
        _failureCount = 0;
        return;
      } catch (e) {
        _fingerprintCache.delete(fingerprint);
      }
    }
    let existingDoc = null;
    try {
      const dedupQuery = fns.query(
        _collectionRef,
        fns.where("fingerprint", "==", fingerprint),
        fns.limit(1)
      );
      const snapshot = await fns.getDocs(dedupQuery);
      if (!snapshot.empty) {
        existingDoc = snapshot.docs[0];
      }
    } catch (dedupErr) {
      existingDoc = null;
    }
    if (existingDoc) {
      try {
        const currentData = existingDoc.data();
        const stormCount = errorEntry._storm ? errorEntry._storm.count : 1;
        const updateData = {
          occurrences: (currentData.occurrences || 1) + stormCount,
          lastSeen: fns.serverTimestamp(),
          lastSeenSessionId: errorEntry.sessionId,
          breadcrumbs: errorEntry.breadcrumbs || []
        };
        const userKey2 = userKeyFor(errorEntry);
        if (userKey2) {
          const tracked = Array.isArray(currentData.uniqueUsers) ? currentData.uniqueUsers : [];
          if (!tracked.includes(userKey2) && tracked.length < MAX_TRACKED_USERS) {
            updateData.uniqueUsers = [...tracked, userKey2];
            updateData.uniqueUserCount = (currentData.uniqueUserCount || tracked.length) + 1;
          }
        }
        if (errorEntry._storm) {
          updateData.storm = { count: errorEntry._storm.count, windowMs: errorEntry._storm.windowMs };
        }
        await fns.updateDoc(existingDoc.ref, updateData);
        _fingerprintCache.set(fingerprint, existingDoc.ref);
        _failureCount = 0;
        return;
      } catch (e) {
        handleWriteFailure(e);
        return;
      }
    }
    const userKey = userKeyFor(errorEntry);
    let doc = __spreadValues(__spreadProps(__spreadValues(__spreadValues(__spreadProps(__spreadValues({
      schemaVersion: _config.schemaVersion,
      fingerprint,
      groupingInputs,
      sessionId: errorEntry.sessionId,
      lastSeenSessionId: errorEntry.sessionId,
      type: "error",
      message: errorEntry.message,
      stack: errorEntry.stack || "",
      source: errorEntry.source
    }, errorEntry.firedAs && errorEntry.firedAs.length > 1 ? { firedAs: errorEntry.firedAs } : {}), {
      url: errorEntry.url,
      path: errorEntry.path,
      breadcrumbs: errorEntry.breadcrumbs || [],
      context: errorEntry.context || {},
      metadata: errorEntry.metadata || {},
      occurrences: errorEntry._storm ? errorEntry._storm.count : 1
    }), userKey ? { uniqueUsers: [userKey], uniqueUserCount: 1 } : {}), errorEntry.internal ? { internal: true } : {}), {
      firstSeen: fns.serverTimestamp(),
      lastSeen: fns.serverTimestamp(),
      createdAt: fns.serverTimestamp()
    }), errorEntry._storm ? { storm: { count: errorEntry._storm.count, windowMs: errorEntry._storm.windowMs } } : {});
    doc = trimDocument(doc, _config.maxDocumentBytes);
    try {
      const docRef = await fns.addDoc(_collectionRef, doc);
      _fingerprintCache.set(fingerprint, docRef);
      _failureCount = 0;
      if (!_firstWriteLogged) {
        _firstWriteLogged = true;
        console.log("[BlackBox] First error captured and written to Firestore");
      }
    } catch (e) {
      handleWriteFailure(e);
      if (!_firstWriteLogged && ((_b = e == null ? void 0 : e.message) == null ? void 0 : _b.includes("permission"))) {
        console.error("[BlackBox] Firestore rules block writes to __blackbox. Add rules to allow read/write on the __blackbox collection.");
      }
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
function initPersistence(blackbox, db, externalFns) {
  try {
    _blackbox = blackbox;
    _db = db;
    _config = blackbox._getConfig();
    _failureCount = 0;
    _circuitOpen = false;
    _writingError = false;
    if (externalFns) {
      _firestoreFns = externalFns;
    }
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
    blackbox._onError((errorEntry) => {
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
  _fingerprintCache = /* @__PURE__ */ new Map();
  _firstWriteLogged = false;
  _stormTracker = /* @__PURE__ */ new Map();
}
function _setFirestoreFns(fns) {
  _firestoreFns = fns;
}
function _setCollectionRef(ref) {
  _collectionRef = ref;
}

export {
  __spreadValues,
  __spreadProps,
  __objRest,
  isStackEntirelyInternal,
  generateFingerprint,
  initPersistence,
  isCircuitOpen,
  getCollectionRef,
  getFirestoreFunctions,
  getPersistenceConfig,
  _resetPersistence,
  _setFirestoreFns,
  _setCollectionRef
};
