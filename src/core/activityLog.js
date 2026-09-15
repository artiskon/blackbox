import { isCircuitOpen, getCollectionRef, getFirestoreFunctions, getPersistenceConfig, toFirestoreSafe } from './persistence.js';

let _blackbox = null;
let _lastFlushTime = null;
let _lastFlushIndex = 0;

// Unflushed crumbs of an in-flight flush, replayed on next init if the flush
// dies with the page (see initActivityLog).
const PENDING_KEY = '__bb_pending_crumbs';

function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch {
    return JSON.stringify(doc).length * 2;
  }
}

// Returns true once the doc is written, false if persistence isn't available.
async function writeActivityDoc(crumbs, sessionId, from, to) {
  const fns = await getFirestoreFunctions();
  // Read the ref after the await: initPersistence resolves it in a microtask,
  // so a flush fired right after init would otherwise see null.
  const collRef = getCollectionRef();
  if (!fns || !collRef || isCircuitOpen()) return false;

  const config = getPersistenceConfig();
  // Strip undefined/non-plain values Firestore would reject (see toFirestoreSafe)
  const breadcrumbs = toFirestoreSafe(crumbs, []);
  const maxBytes = config.maxDocumentBytes || 500000;

  const bbConfig = _blackbox._getConfig();
  let doc = {
    schemaVersion: config.schemaVersion,
    type: 'activity',
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
    expireAt: fns.Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000))
  };

  // Size management: trim only when the doc is over maxDocumentBytes
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
    const now = new Date().toISOString();
    const from = _lastFlushTime || now;

    // Only include breadcrumbs added since last flush
    const newCrumbs = currentBreadcrumbs.filter(c => {
      return !_lastFlushTime || c.timestamp > _lastFlushTime;
    });

    // Save the unflushed crumbs synchronously, before any await, so a flush
    // on beforeunload that dies with the page is recovered on next init.
    // A flush that completes clears it, so nothing is replayed twice.
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
    } catch { /* sessionStorage not available */ }

    if (newCrumbs.length === 0) return; // Skip empty flushes

    if (!(await writeActivityDoc(newCrumbs, _blackbox.getSessionId(), from, now))) return;
    // Bookmark the last crumb written, not `now`, so crumbs added in the same
    // millisecond or while the write was in flight aren't skipped next time.
    _lastFlushTime = newCrumbs[newCrumbs.length - 1].timestamp;
    try {
      // Leave it if a later flush has already replaced it
      if (saved && sessionStorage.getItem(PENDING_KEY) === saved) sessionStorage.removeItem(PENDING_KEY);
    } catch { /* ignore */ }
  } catch (e) {
    // Don't let activity flush failures affect the app
    // Don't count these toward circuit breaker — that's only for error writes
  }
}

// `recovery` is { sessionId, breadcrumbs } read from PENDING_KEY by init().
export function initActivityLog(blackbox, recovery) {
  try {
    _blackbox = blackbox;
    _lastFlushTime = null; // null means first flush captures everything since init

    blackbox._onActivityFlush((breadcrumbs) => {
      flushActivity(breadcrumbs);
    });

    // Replay crumbs from a flush that died with the previous page. Written
    // under the previous sessionId, and leaves _lastFlushTime alone so this
    // session's first flush still covers everything since init.
    const crumbs = recovery?.breadcrumbs;
    if (Array.isArray(crumbs) && crumbs.length > 0) {
      writeActivityDoc(crumbs, recovery.sessionId, crumbs[0].timestamp, crumbs[crumbs.length - 1].timestamp)
        .catch(() => { /* don't let recovery failures affect the app */ });
    }
  } catch (e) {
    console.warn('[BlackBox] Activity log init failed:', e);
  }
}

// For testing
export function _resetActivityLog() {
  _blackbox = null;
  _lastFlushTime = null;
  _lastFlushIndex = 0;
}
