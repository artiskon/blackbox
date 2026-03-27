import { DEFAULTS } from './constants.js';
import { generateSessionId } from './session.js';
import { BreadcrumbManager } from './breadcrumbs.js';
import { installErrorHook } from './hooks/errorHook.js';
import { installClickHook } from './hooks/clickHook.js';
import { installNavigationHook } from './hooks/navigationHook.js';
import { installConsoleHook } from './hooks/consoleHook.js';
import { installNetworkHook } from './hooks/networkHook.js';
import { installFormHook } from './hooks/formHook.js';
import { installResourceHook } from './hooks/resourceHook.js';
import { initPersistence, _resetPersistence } from './persistence.js';
import { initActivityLog, _resetActivityLog } from './activityLog.js';

let _initialized = false;
let _config = {};
let _sessionId = null;
let _breadcrumbs = null;
let _errors = [];
let _errorCount = 0;
let _subscribers = [];
let _onErrorCallback = null;
let _onActivityFlushCallback = null;
let _flushTimer = null;
let _writingError = false;
let _suspiciousSilences = [];
let _pendingSilenceChecks = [];
let _cleanupFns = [];

function _stripQueryParams(url) {
  if (!url || !_config.stripQueryParams) return url;
  try {
    if (url.startsWith('http')) {
      const u = new URL(url);
      return u.origin + u.pathname + u.hash;
    }
    // Relative path
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return url;
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1 && hashIndex < qIndex) return url;
    const base = url.substring(0, qIndex);
    const hash = hashIndex > qIndex ? url.substring(hashIndex) : '';
    return base + hash;
  } catch {
    return url;
  }
}

function _getCurrentPath() {
  try {
    const path = window.location.pathname + window.location.hash;
    return _stripQueryParams(path);
  } catch {
    return '';
  }
}

function _notifySubscribers() {
  for (const cb of _subscribers) {
    try { cb(); } catch { /* ignore */ }
  }
}

const blackbox = {
  init(options = {}) {
    if (_initialized) {
      console.warn('[BlackBox] Already initialized, skipping');
      return blackbox;
    }

    const enabled = options.enabled;
    if (enabled === false) {
      console.log('[BlackBox] Disabled');
      return blackbox;
    }
    if (enabled === undefined || enabled === null) {
      try {
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
          console.log('[BlackBox] Disabled');
          return blackbox;
        }
      } catch { /* process not available, continue */ }
    }

    _config = { ...DEFAULTS, ...options };
    _sessionId = generateSessionId();
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
      () => installResourceHook(blackbox),
    ];

    for (const installHook of hooks) {
      try {
        const cleanup = installHook();
        if (cleanup) _cleanupFns.push(cleanup);
      } catch (e) {
        console.warn('[BlackBox] Hook install failed:', e);
      }
    }

    // Activity flush timer
    _flushTimer = setInterval(() => {
      try {
        if (_onActivityFlushCallback) {
          _onActivityFlushCallback(_breadcrumbs.snapshot());
        }
      } catch { /* ignore */ }
    }, _config.activityFlushInterval);

    _initialized = true;

    // Initialize persistence and activity log if db is provided
    if (_config.db) {
      try { initPersistence(blackbox, _config.db); } catch (e) {
        console.warn('[BlackBox] Persistence init failed:', e);
      }
      try { initActivityLog(blackbox); } catch (e) {
        console.warn('[BlackBox] Activity log init failed:', e);
      }
    }

    blackbox._addBreadcrumb('system', { action: 'blackbox_initialized', sessionId: _sessionId });
    console.log(`[BlackBox] Active | session: ${_sessionId}`);

    return blackbox;
  },

  log(action, data = {}) {
    if (!_initialized) return;
    try {
      blackbox._addBreadcrumb('custom', { action, ...data });
    } catch { /* ignore */ }
  },

  captureError(error, context = {}) {
    if (!_initialized) return;
    try {
      const message = error?.message || String(error);
      const stack = error?.stack || '';
      blackbox._recordError({ message, stack, source: 'manual', context });
    } catch { /* ignore */ }
  },

  onUpdate(callback) {
    _subscribers.push(callback);
    return () => {
      _subscribers = _subscribers.filter(cb => cb !== callback);
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
      const { getCollectionRef, getFirestoreFunctions } = await import('./persistence.js');
      const fns = await getFirestoreFunctions();
      const ref = getCollectionRef();
      if (!fns || !ref) return { errors: [], connected: false };

      const q = fns.query(ref,
        fns.where('type', '==', 'error'),
        fns.limit(limit)
      );
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map(d => {
        const data = d.data();
        if (data.firstSeen?.toDate) data.firstSeen = data.firstSeen.toDate().toISOString();
        if (data.lastSeen?.toDate) data.lastSeen = data.lastSeen.toDate().toISOString();
        if (data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
        return { id: d.id, ...data };
      });
      errors.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
      return { errors, connected: true };
    } catch (e) {
      return { errors: [], connected: false, error: e.message };
    }
  },

  async queryHealth() {
    try {
      const { getCollectionRef, getFirestoreFunctions } = await import('./persistence.js');
      const fns = await getFirestoreFunctions();
      const ref = getCollectionRef();
      if (!fns || !ref) return { connected: false };

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const q = fns.query(ref,
        fns.where('type', '==', 'error'),
        fns.where('createdAt', '>=', fns.Timestamp.fromDate(twentyFourHoursAgo))
      );
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map(d => d.data());

      const totalOccurrences = errors.reduce((sum, e) => sum + (e.occurrences || 1), 0);
      const bySource = {};
      const systemic = [];
      for (const e of errors) {
        const src = e.source || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
        if ((e.occurrences || 1) > 10) systemic.push(e);
      }

      let verdict = 'HEALTHY';
      if (systemic.length > 0) verdict = 'UNHEALTHY';
      else if (errors.length > 0) verdict = 'WARNING';

      return {
        connected: true,
        verdict,
        uniqueErrors: errors.length,
        totalOccurrences,
        bySource,
        systemicCount: systemic.length,
        topErrors: errors
          .sort((a, b) => (b.occurrences || 1) - (a.occurrences || 1))
          .slice(0, 5)
          .map(e => ({ message: e.message, source: e.source, occurrences: e.occurrences || 1 })),
      };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  },

  async queryTimeline(minutes = 5) {
    try {
      const { getCollectionRef, getFirestoreFunctions } = await import('./persistence.js');
      const fns = await getFirestoreFunctions();
      const ref = getCollectionRef();
      if (!fns || !ref) return { events: [], connected: false };

      const cutoff = new Date(Date.now() - minutes * 60 * 1000);
      const q = fns.query(ref,
        fns.where('createdAt', '>=', fns.Timestamp.fromDate(cutoff))
      );
      const snapshot = await fns.getDocs(q);

      const seen = new Set();
      const events = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        for (const bc of (data.breadcrumbs || [])) {
          if (bc.timestamp && !seen.has(bc.timestamp)) {
            seen.add(bc.timestamp);
            events.push(bc);
          }
        }
      }
      events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      return { events, connected: true };
    } catch (e) {
      return { events: [], connected: false, error: e.message };
    }
  },

  async clearPersistedErrors() {
    try {
      const { getCollectionRef, getFirestoreFunctions } = await import('./persistence.js');
      const fns = await getFirestoreFunctions();
      const ref = getCollectionRef();
      if (!fns || !ref) return { success: false, error: 'Not connected to Firestore' };

      const snapshot = await fns.getDocs(ref);
      let deleted = 0;
      const { deleteDoc } = await import('firebase/firestore');
      for (const doc of snapshot.docs) {
        try {
          await deleteDoc(doc.ref);
          deleted++;
        } catch { /* skip */ }
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

    // Every breadcrumb gets the current path automatically
    let breadcrumb = { type, path: _getCurrentPath(), ...data };

    // Apply sanitize hook
    if (_config.sanitize) {
      try {
        breadcrumb = _config.sanitize(breadcrumb);
        if (breadcrumb === null || breadcrumb === undefined) return;
      } catch { /* ignore sanitize errors */ }
    }

    // Extract type separately for the manager (avoids duplicate in spread)
    const { type: crumbType, ...rest } = breadcrumb;
    _breadcrumbs.add(crumbType, rest);
    _notifySubscribers();
  },

  _recordError({ message, stack, source, context = {} }) {
    if (_writingError) return;
    if (!_initialized) return;

    try {
      if (message && message.includes('[BlackBox]')) return;

      _writingError = true;
      _errorCount++;

      const truncatedMessage = message
        ? message.slice(0, _config.maxMessageLength)
        : '';

      const entry = {
        message: truncatedMessage,
        stack: stack || '',
        source,
        path: _getCurrentPath(),
        url: _stripQueryParams(window.location.href),
        breadcrumbs: _breadcrumbs ? _breadcrumbs.snapshot() : [],
        context,
        metadata: {
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: new Date().toISOString(),
          language: navigator.language
        },
        sessionId: _sessionId,
        schemaVersion: _config.schemaVersion
      };

      _errors.push(entry);
      if (_errors.length > 50) _errors.shift();

      blackbox._addBreadcrumb('error', { message: truncatedMessage, source });

      if (_onErrorCallback) {
        try { _onErrorCallback(entry); } catch { /* ignore */ }
      }

      _notifySubscribers();
    } catch { /* ignore */ } finally {
      _writingError = false;
    }
  },

  _getConfig() {
    return { ..._config };
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
        // Check if any meaningful followup breadcrumb was added after the click
        const crumbs = _breadcrumbs ? _breadcrumbs.snapshot() : [];
        const meaningfulTypes = ['network', 'navigation', 'warning', 'error', 'custom'];
        const hasFollowup = crumbs.some(c => {
          if (!meaningfulTypes.includes(c.type)) return false;
          return new Date(c.timestamp).getTime() > clickTime;
        });

        if (!hasFollowup) {
          const silence = {
            type: 'suspicious_silence',
            action: 'click_without_followup',
            clickedElement: clickDetails,
            waitedMs: _config.silenceDetectionDelay
          };
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();
          blackbox._addBreadcrumb('suspicious_silence', silence);
        }
      } catch { /* ignore */ }
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
      try { cleanup(); } catch { /* ignore */ }
    }
    _cleanupFns = [];
    try { _resetPersistence(); } catch { /* ignore */ }
    try { _resetActivityLog(); } catch { /* ignore */ }
  },

  // For testing: alias
  _reset() {
    this.destroy();
  }
};

export default blackbox;
