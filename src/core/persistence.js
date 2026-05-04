import { generateFingerprint } from './fingerprint.js';

let _db = null;
let _config = {};
let _blackbox = null;
let _failureCount = 0;
let _circuitOpen = false;
let _writingError = false;
let _collectionRef = null;
let _writeQueue = [];
let _processing = false;
let _fingerprintCache = new Map();
let _firstWriteLogged = false; // fingerprint → docRef (avoids Firestore eventual consistency race)
let _stormTracker = new Map(); // fingerprint → { count, firstSeen, lastSeen }
const STORM_WINDOW_MS = 5000; // 5-second window for detecting error storms
const STORM_THRESHOLD = 5;    // 5+ occurrences in window = storm

// Firestore SDK functions — resolved dynamically
let _firestoreFns = null;

async function getFirestoreFns() {
  if (_firestoreFns) return _firestoreFns;
  try {
    const mod = await import('firebase/firestore');
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
    console.warn('[BlackBox] Failed to load firebase/firestore:', e);
    return null;
  }
}

// Stable identifier for "who saw this error" — prefer real user.id when set,
// fall back to sessionId so anonymous traffic still contributes to a unique
// count. Capped on read so doc size stays bounded.
const MAX_TRACKED_USERS = 50;
function userKeyFor(errorEntry) {
  const uid = errorEntry?.user?.id;
  if (uid) return String(uid).slice(0, 64);
  if (errorEntry?.sessionId) return `anon:${String(errorEntry.sessionId).slice(0, 16)}`;
  return null;
}

// Underscore-prefixed context keys are an ephemeral, in-process-only
// convention (see ADR-0021): visible to registerDiagnostic match functions
// but never persisted. Used to carry raw / privacy-sensitive data
// (e.g. _rawUrl with query strings + signed tokens) that the matcher needs
// but the Firestore record must not.
function stripEphemeralContextKeys(context) {
  if (!context || typeof context !== 'object') return context;
  const out = {};
  for (const [k, v] of Object.entries(context)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch {
    return JSON.stringify(doc).length * 2; // rough fallback
  }
}

function trimDocument(doc, maxBytes) {
  let trimmed = { ...doc };
  let size = estimateDocBytes(trimmed);
  if (size <= maxBytes) return trimmed;

  // Step 1: truncate breadcrumbs to 40
  if (trimmed.breadcrumbs && trimmed.breadcrumbs.length > 40) {
    trimmed.breadcrumbs = trimmed.breadcrumbs.slice(-40);
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }

  // Step 2: truncate context values to 200 chars (preserve componentStack for React diagnostics)
  if (trimmed.context && typeof trimmed.context === 'object') {
    const ctx = {};
    const preserveKeys = ['componentStack'];
    for (const [k, v] of Object.entries(trimmed.context)) {
      if (typeof v === 'string' && v.length > 200 && !preserveKeys.includes(k)) {
        ctx[k] = v.slice(0, 200);
      } else {
        ctx[k] = v;
      }
    }
    trimmed.context = ctx;
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }

  // Step 3: remove metadata.userAgent
  if (trimmed.metadata) {
    trimmed.metadata = { ...trimmed.metadata };
    delete trimmed.metadata.userAgent;
    size = estimateDocBytes(trimmed);
    if (size <= maxBytes) return trimmed;
  }

  // Step 4: truncate breadcrumbs to 20
  if (trimmed.breadcrumbs && trimmed.breadcrumbs.length > 20) {
    trimmed.breadcrumbs = trimmed.breadcrumbs.slice(-20);
  }

  return trimmed;
}

function isSafeEnvironment(config) {
  // Always safe if collection starts with __
  if (config.collectionName && config.collectionName.startsWith('__')) return true;

  // Check if we're on the emulator
  try {
    if (_db && _db._settings && _db._settings.host && _db._settings.host.includes('localhost')) return true;
    // Firestore emulator sets this
    if (_db && _db.toJSON && JSON.stringify(_db.toJSON()).includes('localhost')) return true;
  } catch { /* ignore */ }

  // Check NODE_ENV
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') return true;
  } catch { /* ignore */ }

  return false;
}

function persistError(errorEntry) {
  if (_circuitOpen) return;
  if (_writingError) return;

  // Error storm detection: collapse rapid-fire identical errors
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
      // Within storm window — increment count, skip the write
      storm.count++;
      storm.lastSeen = now;
      if (storm.count === STORM_THRESHOLD) {
        // Mark the entry as a storm so the single write reflects it
        errorEntry._storm = { count: storm.count, windowMs: now - storm.firstSeen };
      }
      if (storm.count > STORM_THRESHOLD) {
        // Already wrote the storm entry — just keep counting, don't persist
        return;
      }
      // Below threshold — let it through normally
    } else {
      // Window expired — reset tracker for this fingerprint
      _stormTracker.set(fingerprint, { count: 1, firstSeen: now, lastSeen: now });
    }
  } else {
    _stormTracker.set(fingerprint, { count: 1, firstSeen: now, lastSeen: now });
  }

  // Prune old storm entries every 50 writes
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
    if (_circuitOpen) { _writeQueue = []; break; }
    const entry = _writeQueue.shift();
    await _doWrite(entry);
  }
  _processing = false;
}

async function _doWrite(errorEntry) {
  _writingError = true;
  try {
    const fns = await getFirestoreFns();
    // Wait for collection ref if not ready yet (async init race)
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

    // Deduplication: check local cache first (avoids Firestore eventual consistency race)
    const cachedRef = _fingerprintCache.get(fingerprint);
    if (cachedRef) {
      try {
        const currentData = (await fns.getDocs(fns.query(_collectionRef, fns.where('fingerprint', '==', fingerprint), fns.limit(1)))).docs[0]?.data();
        const stormCount = errorEntry._storm ? errorEntry._storm.count : 1;
        const updateData = {
          occurrences: (currentData?.occurrences || 1) + stormCount,
          lastSeen: fns.serverTimestamp(),
          lastSeenSessionId: errorEntry.sessionId,
          breadcrumbs: errorEntry.breadcrumbs || []
        };
        const userKey = userKeyFor(errorEntry);
        if (userKey) {
          const tracked = Array.isArray(currentData?.uniqueUsers) ? currentData.uniqueUsers : [];
          if (!tracked.includes(userKey) && tracked.length < MAX_TRACKED_USERS) {
            updateData.uniqueUsers = [...tracked, userKey];
            updateData.uniqueUserCount = (currentData?.uniqueUserCount || tracked.length) + 1;
          }
        }
        if (errorEntry._storm) {
          updateData.storm = { count: errorEntry._storm.count, windowMs: errorEntry._storm.windowMs };
        }
        await fns.updateDoc(cachedRef, updateData);
        _failureCount = 0;
        return;
      } catch {
        _fingerprintCache.delete(fingerprint);
        // Fall through to query
      }
    }

    // Then check Firestore (for dedup across sessions/page loads)
    let existingDoc = null;
    try {
      const dedupQuery = fns.query(
        _collectionRef,
        fns.where('fingerprint', '==', fingerprint),
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
        const userKey = userKeyFor(errorEntry);
        if (userKey) {
          const tracked = Array.isArray(currentData.uniqueUsers) ? currentData.uniqueUsers : [];
          if (!tracked.includes(userKey) && tracked.length < MAX_TRACKED_USERS) {
            updateData.uniqueUsers = [...tracked, userKey];
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

    // Create new document
    const userKey = userKeyFor(errorEntry);
    let doc = {
      schemaVersion: _config.schemaVersion,
      fingerprint,
      groupingInputs,
      sessionId: errorEntry.sessionId,
      lastSeenSessionId: errorEntry.sessionId,
      type: 'error',
      message: errorEntry.message,
      stack: errorEntry.stack || '',
      source: errorEntry.source,
      ...(errorEntry.firedAs && errorEntry.firedAs.length > 1 ? { firedAs: errorEntry.firedAs } : {}),
      url: errorEntry.url,
      path: errorEntry.path,
      breadcrumbs: errorEntry.breadcrumbs || [],
      context: stripEphemeralContextKeys(errorEntry.context || {}),
      metadata: errorEntry.metadata || {},
      occurrences: errorEntry._storm ? errorEntry._storm.count : 1,
      ...(userKey ? { uniqueUsers: [userKey], uniqueUserCount: 1 } : {}),
      ...(errorEntry.internal ? { internal: true } : {}),
      firstSeen: fns.serverTimestamp(),
      lastSeen: fns.serverTimestamp(),
      createdAt: fns.serverTimestamp(),
      ...(errorEntry._storm ? { storm: { count: errorEntry._storm.count, windowMs: errorEntry._storm.windowMs } } : {})
    };

    doc = trimDocument(doc, _config.maxDocumentBytes);

    try {
      const docRef = await fns.addDoc(_collectionRef, doc);
      _fingerprintCache.set(fingerprint, docRef);
      _failureCount = 0;
      if (!_firstWriteLogged) {
        _firstWriteLogged = true;
        console.log('[BlackBox] First error captured and written to Firestore');
      }
    } catch (e) {
      handleWriteFailure(e);
      if (!_firstWriteLogged && e?.message?.includes('permission')) {
        console.error('[BlackBox] Firestore rules block writes to __blackbox. Add rules to allow read/write on the __blackbox collection.');
      }
    }
  } catch { /* ignore top-level */ } finally {
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

export function initPersistence(blackbox, db, externalFns) {
  try {
    _blackbox = blackbox;
    _db = db;
    _config = blackbox._getConfig();
    _failureCount = 0;
    _circuitOpen = false;
    _writingError = false;

    // Use externally provided Firestore functions if available
    // (avoids module duplication when BB is in a submodule with its own node_modules)
    if (externalFns) {
      _firestoreFns = externalFns;
    }

    // Production safety check
    if (!isSafeEnvironment(_config)) {
      try {
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
          console.warn('[BlackBox] Persistence disabled in production.');
          return;
        }
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'development') {
          console.warn('[BlackBox] Persistence disabled: environment is not development and collection does not start with __.');
          return;
        }
      } catch { /* process not available, proceed */ }
    }

    // Resolve collection ref asynchronously
    getFirestoreFns().then(fns => {
      if (fns) {
        _collectionRef = fns.collection(db, _config.collectionName);
      }
    }).catch(() => { /* ignore */ });

    // Register as the error handler
    blackbox._onError((errorEntry) => {
      persistError(errorEntry);
    });
  } catch (e) {
    console.warn('[BlackBox] Persistence init failed:', e);
  }
}

// Exposed for activityLog and testing
export function isCircuitOpen() {
  return _circuitOpen;
}

export function getCollectionRef() {
  return _collectionRef;
}

export function getFirestoreFunctions() {
  return getFirestoreFns();
}

export function getPersistenceConfig() {
  return _config;
}

// For testing
export function _resetPersistence() {
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
  _fingerprintCache = new Map();
  _firstWriteLogged = false;
  _stormTracker = new Map();
}

export function _setFirestoreFns(fns) {
  _firestoreFns = fns;
}

export function _setCollectionRef(ref) {
  _collectionRef = ref;
}
