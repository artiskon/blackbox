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
      query: mod.query,
      where: mod.where,
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

  // Step 2: truncate context values to 200 chars
  if (trimmed.context && typeof trimmed.context === 'object') {
    const ctx = {};
    for (const [k, v] of Object.entries(trimmed.context)) {
      if (typeof v === 'string' && v.length > 200) {
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
  // _writingError prevents synchronous re-entry (infinite loop guard):
  // if a Firestore write triggers console.error → _recordError → _onError → persistError
  if (_writingError) return;

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
    if (!fns || !_collectionRef) return;

    const { fingerprint, groupingInputs } = generateFingerprint(
      errorEntry.message,
      errorEntry.source,
      errorEntry.path,
      errorEntry.stack
    );

    // Deduplication: check for existing error with same fingerprint in last 24h
    let existingDoc = null;
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dedupQuery = fns.query(
        _collectionRef,
        fns.where('fingerprint', '==', fingerprint),
        fns.where('type', '==', 'error'),
        fns.where('createdAt', '>=', fns.Timestamp.fromDate(twentyFourHoursAgo)),
        fns.limit(1)
      );
      const snapshot = await fns.getDocs(dedupQuery);
      if (!snapshot.empty) {
        existingDoc = snapshot.docs[0];
      }
    } catch {
      // Dedup query failed — fall through to create new doc
      existingDoc = null;
    }

    if (existingDoc) {
      // Update existing: increment occurrences, update lastSeen + breadcrumbs
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

    // Create new document
    let doc = {
      schemaVersion: _config.schemaVersion,
      fingerprint,
      groupingInputs,
      sessionId: errorEntry.sessionId,
      type: 'error',
      message: errorEntry.message,
      stack: errorEntry.stack || '',
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

export function initPersistence(blackbox, db) {
  try {
    _blackbox = blackbox;
    _db = db;
    _config = blackbox._getConfig();
    _failureCount = 0;
    _circuitOpen = false;
    _writingError = false;

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
}

export function _setFirestoreFns(fns) {
  _firestoreFns = fns;
}

export function _setCollectionRef(ref) {
  _collectionRef = ref;
}
