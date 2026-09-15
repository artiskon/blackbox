import { generateFingerprint } from './fingerprint.js';

let _db = null;
let _config = {};
let _blackbox = null;
let _failureCount = 0;
let _circuitOpen = false;
let _collectionRef = null;
let _writeQueue = [];
let _processing = false;
let _fingerprintCache = new Map(); // fingerprint → { ref, users: Set } for the doc this tab writes
let _firstWriteLogged = false;
let _stormTracker = new Map(); // fingerprint → { count, firstSeen, lastSeen }
const STORM_WINDOW_MS = 5000; // 5-second window for detecting error storms
const STORM_THRESHOLD = 5;    // 5+ occurrences in window = storm
const MAX_QUEUE = 100;        // bounds memory while Firestore is slow/offline
const WRITE_ACK_TIMEOUT_MS = 10000;
let _ackTimeoutWarned = false;

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
      increment: mod.increment,
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

// Firestore rejects undefined values and class instances (invalid-argument),
// and one bad crumb in the breadcrumb snapshot would fail every error write.
// JSON round-trip drops undefined keys, nulls undefined array items, and
// flattens Dates/instances. Only apply to app-supplied parts of a doc, never
// to SDK sentinels like serverTimestamp().
export function toFirestoreSafe(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
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
    // Bare read so bundler-inlined NODE_ENV works without a `process` global
    if (process.env.NODE_ENV === 'development') return true;
  } catch { /* ignore */ }

  return false;
}

function _enqueue(item) {
  if (_writeQueue.length >= MAX_QUEUE) return;
  _writeQueue.push(item);
  if (!_processing) {
    _processQueue();
  }
}

function persistError(errorEntry) {
  if (_circuitOpen) return;

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
    if (now - storm.firstSeen < STORM_WINDOW_MS && !storm.flushed) {
      // Within storm window — increment count, skip the write
      storm.count++;
      storm.lastSeen = now;
      if (storm.count === STORM_THRESHOLD) {
        // Mark the entry as a storm so the single write reflects it
        errorEntry._storm = { count: storm.count, windowMs: now - storm.firstSeen };
      }
      if (storm.count > STORM_THRESHOLD) {
        // Already wrote the storm entry — just keep counting, don't persist.
        // The first suppressed hit schedules one update at window end that
        // adds the suppressed hits to `occurrences`.
        if (storm.count === STORM_THRESHOLD + 1) {
          setTimeout(() => {
            storm.flushed = true;
            _enqueue({
              _stormFlush: {
                fingerprint,
                extra: storm.count - STORM_THRESHOLD,
                count: storm.count,
                windowMs: storm.lastSeen - storm.firstSeen
              }
            });
          }, Math.max(0, storm.firstSeen + STORM_WINDOW_MS - now));
        }
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

  _enqueue(errorEntry);
}

// Firestore write promises stay pending until the backend acks, so offline or
// an emulator that isn't running would stall the queue forever with nothing
// rejecting. Move on after a timeout; the SDK still delivers the write when
// it reconnects.
function _withAckTimeout(promise) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      if (!_ackTimeoutWarned) {
        _ackTimeoutWarned = true;
        console.warn(`[BlackBox] Firestore write not acknowledged after ${WRITE_ACK_TIMEOUT_MS / 1000}s; check network or that the Firestore emulator is running. Errors are still captured in the panel.`);
      }
      resolve();
    }, WRITE_ACK_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function _processQueue() {
  _processing = true;
  while (_writeQueue.length > 0) {
    if (_circuitOpen) { _writeQueue = []; break; }
    const entry = _writeQueue.shift();
    if (entry._stormFlush) {
      await _withAckTimeout(_doStormFlush(entry._stormFlush));
      continue;
    }
    // Let background registerDiagnostic probes settle (each is capped by its
    // timeoutMs) so their results land in the persisted doc (ADR-0014).
    if (entry._diagnosticsDone) {
      try { await entry._diagnosticsDone; } catch { /* ignore */ }
    }
    await _withAckTimeout(_doWrite(entry));
  }
  _processing = false;
}

// Adds a storm's suppressed hits to the doc in one write and records the
// real storm size.
async function _doStormFlush({ fingerprint, extra, count, windowMs }) {
  try {
    const fns = await getFirestoreFns();
    if (!fns || !_collectionRef) return;
    const storm = { count, windowMs };
    const cached = _fingerprintCache.get(fingerprint);
    if (cached && fns.increment) {
      await fns.updateDoc(cached.ref, { occurrences: fns.increment(extra), storm });
    } else {
      // Read and write the same doc, so a duplicate doc for this fingerprint
      // can't lend it its count.
      const snapshot = await fns.getDocs(fns.query(_collectionRef, fns.where('fingerprint', '==', fingerprint), fns.limit(1)));
      const existing = snapshot.docs[0];
      if (!existing) return;
      await fns.updateDoc(existing.ref, {
        occurrences: fns.increment ? fns.increment(extra) : (existing.data()?.occurrences || STORM_THRESHOLD) + extra,
        storm
      });
    }
    _failureCount = 0;
  } catch (e) {
    handleWriteFailure(e);
  }
}

// Update-path fields shared by the cached-ref and existing-doc branches.
function _commonUpdateFields(errorEntry) {
  const fields = {
    environment: errorEntry.environment ?? null,
    breadcrumbs: toFirestoreSafe(errorEntry.breadcrumbs, [])
  };
  // Refresh the build on every recurrence so a live regression on the
  // current deploy doesn't look stale (ADR-0002). Field paths leave the rest
  // of the first-seen metadata alone; never write undefined.
  if (errorEntry.metadata?.buildSha) fields['metadata.buildSha'] = errorEntry.metadata.buildSha;
  if (errorEntry.metadata?.nodeEnv) fields['metadata.nodeEnv'] = errorEntry.metadata.nodeEnv;
  const diagnostics = errorEntry.context?.diagnostics;
  if (diagnostics && Object.keys(diagnostics).length > 0) {
    // Field path so the rest of the stored context is left alone
    fields['context.diagnostics'] = toFirestoreSafe(diagnostics, {});
  }
  return fields;
}

async function _doWrite(errorEntry) {
  // Take the storm mark once. Past the threshold blackbox.js re-sends the
  // same entry object, so a mark left on it would rewrite an old window's
  // count over the full size a storm flush stored.
  const stormMark = errorEntry._storm;
  delete errorEntry._storm;
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

    // sessionTag is the runner-supplied correlation token. Both the create
    // and update paths set lastSeenSessionTag, so every doc that fires during
    // the runner's window (new, or created in an earlier real-user session)
    // surfaces in the runner's `lastSeenSessionTag == X` query (optionally
    // AND lastSeen > t). The historical sessionTag is only set on create.
    const sessionTag = errorEntry.sessionTag || _config.sessionTag || null;

    const userKey = userKeyFor(errorEntry);

    // Deduplication: the doc this tab already wrote is updated directly with
    // increment(), with no query read, so concurrent tabs don't lose counts
    // and a duplicate doc for the fingerprint can't lend it its count. A user
    // not yet recorded on the doc by this tab, or caller firestoreFns without
    // increment, takes the query path, which owns the capped uniqueUsers logic.
    const cached = _fingerprintCache.get(fingerprint);
    if (cached && fns.increment && (!userKey || cached.users.has(userKey))) {
      try {
        const updateData = {
          occurrences: fns.increment(1),
          lastSeen: fns.serverTimestamp(),
          lastSeenSessionId: errorEntry.sessionId,
          ...(sessionTag ? { lastSeenSessionTag: sessionTag } : {}),
          ..._commonUpdateFields(errorEntry)
        };
        if (stormMark) {
          updateData.storm = { count: stormMark.count, windowMs: stormMark.windowMs };
        }
        await fns.updateDoc(cached.ref, updateData);
        _failureCount = 0;
        return;
      } catch {
        _fingerprintCache.delete(fingerprint);
        // Fall through to query (e.g. the doc was cleared)
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
        const updateData = {
          occurrences: fns.increment ? fns.increment(1) : (currentData.occurrences || 1) + 1,
          lastSeen: fns.serverTimestamp(),
          lastSeenSessionId: errorEntry.sessionId,
          ...(sessionTag ? { lastSeenSessionTag: sessionTag } : {}),
          ..._commonUpdateFields(errorEntry)
        };
        if (userKey) {
          const tracked = Array.isArray(currentData.uniqueUsers) ? currentData.uniqueUsers : [];
          if (!tracked.includes(userKey) && tracked.length < MAX_TRACKED_USERS) {
            updateData.uniqueUsers = [...tracked, userKey];
            updateData.uniqueUserCount = (currentData.uniqueUserCount || tracked.length) + 1;
          }
        }
        if (stormMark) {
          updateData.storm = { count: stormMark.count, windowMs: stormMark.windowMs };
        }
        await fns.updateDoc(existingDoc.ref, updateData);
        _fingerprintCache.set(fingerprint, { ref: existingDoc.ref, users: new Set(userKey ? [userKey] : []) });
        _failureCount = 0;
        return;
      } catch (e) {
        handleWriteFailure(e);
        return;
      }
    }

    // Create new document
    let doc = {
      schemaVersion: _config.schemaVersion,
      fingerprint,
      groupingInputs,
      sessionId: errorEntry.sessionId,
      lastSeenSessionId: errorEntry.sessionId,
      ...(sessionTag ? { sessionTag, lastSeenSessionTag: sessionTag } : {}),
      type: 'error',
      message: errorEntry.message,
      stack: errorEntry.stack || '',
      source: errorEntry.source,
      ...(errorEntry.firedAs && errorEntry.firedAs.length > 1 ? { firedAs: errorEntry.firedAs } : {}),
      url: errorEntry.url,
      path: errorEntry.path,
      breadcrumbs: toFirestoreSafe(errorEntry.breadcrumbs, []),
      context: toFirestoreSafe(stripEphemeralContextKeys(errorEntry.context || {}), {}),
      metadata: toFirestoreSafe(errorEntry.metadata, {}),
      environment: errorEntry.environment ?? null,
      tags: toFirestoreSafe(errorEntry.tags, {}),
      user: toFirestoreSafe(errorEntry.user, null),
      occurrences: 1,
      ...(userKey ? { uniqueUsers: [userKey], uniqueUserCount: 1 } : {}),
      ...(errorEntry.internal ? { internal: true } : {}),
      firstSeen: fns.serverTimestamp(),
      lastSeen: fns.serverTimestamp(),
      createdAt: fns.serverTimestamp(),
      ...(stormMark ? { storm: { count: stormMark.count, windowMs: stormMark.windowMs } } : {})
    };

    doc = trimDocument(doc, _config.maxDocumentBytes);

    try {
      const docRef = await fns.addDoc(_collectionRef, doc);
      _fingerprintCache.set(fingerprint, { ref: docRef, users: new Set(userKey ? [userKey] : []) });
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
  } catch { /* ignore top-level */ }
}

function handleWriteFailure(e) {
  // A single malformed payload is not a Firestore outage; don't let it
  // disable persistence for the session.
  if (e?.code === 'invalid-argument') return;
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

    // Use externally provided Firestore functions if available
    // (avoids module duplication when BB is in a submodule with its own node_modules)
    if (externalFns) {
      _firestoreFns = externalFns;
    }

    // Production safety check
    if (!isSafeEnvironment(_config)) {
      try {
        // Bare `process.env.NODE_ENV` reads: Vite/webpack5/Rspack inline the
        // literal but define no `process` global; the ReferenceError is caught.
        if (process.env.NODE_ENV === 'production') {
          console.warn('[BlackBox] Persistence disabled in production.');
          return;
        }
        if (process.env.NODE_ENV !== 'development') {
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
  _collectionRef = null;
  _firestoreFns = null;
  _writeQueue = [];
  _processing = false;
  _fingerprintCache = new Map();
  _firstWriteLogged = false;
  _stormTracker = new Map();
  _ackTimeoutWarned = false;
}

export function _setFirestoreFns(fns) {
  _firestoreFns = fns;
}

export function _setCollectionRef(ref) {
  _collectionRef = ref;
}
