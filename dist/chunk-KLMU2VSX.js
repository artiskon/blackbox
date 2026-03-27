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
var SKIP_FRAMES_RE = /node_modules|webpack|blackbox|__webpack|hot-update|\(native\)|<anonymous>/i;
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
var _firestoreFns = null;
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
function initPersistence(blackbox, db) {
  try {
    _blackbox = blackbox;
    _db = db;
    _config = blackbox._getConfig();
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
  initPersistence,
  isCircuitOpen,
  getCollectionRef,
  getFirestoreFunctions,
  getPersistenceConfig,
  _resetPersistence,
  _setFirestoreFns,
  _setCollectionRef
};
