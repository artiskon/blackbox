import { isCircuitOpen, getCollectionRef, getFirestoreFunctions, getPersistenceConfig } from './persistence.js';

let _blackbox = null;
let _lastFlushTime = null;
let _lastFlushIndex = 0;

function estimateDocBytes(doc) {
  try {
    return new TextEncoder().encode(JSON.stringify(doc)).length;
  } catch {
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
    const now = new Date().toISOString();
    const from = _lastFlushTime || now;

    // Only include breadcrumbs added since last flush
    const newCrumbs = currentBreadcrumbs.filter(c => {
      return !_lastFlushTime || c.timestamp > _lastFlushTime;
    });

    if (newCrumbs.length === 0) return; // Skip empty flushes

    // Size management: trim to 40 if very large
    let breadcrumbs = newCrumbs;
    const maxBytes = config.maxDocumentBytes || 500000;

    if (breadcrumbs.length > 40) {
      breadcrumbs = breadcrumbs.slice(-40);
    }

    const bbConfig = _blackbox._getConfig();
    let doc = {
      schemaVersion: config.schemaVersion,
      type: 'activity',
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
      expireAt: fns.Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000)) // auto-delete after 48h via Firestore TTL
    };

    // Final size check
    const size = estimateDocBytes(doc);
    if (size > maxBytes && doc.breadcrumbs.length > 20) {
      doc.breadcrumbs = doc.breadcrumbs.slice(-20);
    }

    await fns.addDoc(collRef, doc);
    _lastFlushTime = now;
  } catch (e) {
    // Don't let activity flush failures affect the app
    // Don't count these toward circuit breaker — that's only for error writes
  }
}

export function initActivityLog(blackbox) {
  try {
    _blackbox = blackbox;
    _lastFlushTime = null; // null means first flush captures everything since init

    blackbox._onActivityFlush((breadcrumbs) => {
      flushActivity(breadcrumbs);
    });
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
