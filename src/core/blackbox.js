import { DEFAULTS } from './constants.js';
import { generateSessionId } from './session.js';
import { generateFingerprint } from './fingerprint.js';
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

// Save native fetch before any hooks replace it
const _nativeFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;

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
let _pendingFetchCount = 0;
let _lastFetchStartTime = 0;
let _cleanupFns = [];
let _recentErrors = []; // dedup window: [{norm, time}]
let _errorStorms = new Map(); // norm → { count, firstSeen, lastEntry }
const ERROR_STORM_WINDOW = 5000;
const ERROR_STORM_THRESHOLD = 5;

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
  // Defer to avoid calling setState during React commit phase (SF-10)
  queueMicrotask(() => {
    for (const cb of _subscribers) {
      try { cb(); } catch { /* ignore */ }
    }
  });
}

const blackbox = {
  init(options = {}) {
    // SSR guard — no-op on server
    if (typeof window === 'undefined') return blackbox;

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

    // Validate db if provided
    if (options.db && typeof options.db !== 'object') {
      console.error('[BlackBox] init() `db` must be a Firestore instance. Got:', typeof options.db);
    }

    _config = { ...DEFAULTS, ...options };
    _sessionId = generateSessionId();

    // Recover breadcrumbs from previous session saved on unload
    let _pendingRecovery = null;
    try {
      const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('__bb_pending_crumbs') : null;
      if (saved) {
        const { sessionId: prevSession, breadcrumbs: prevCrumbs, timestamp } = JSON.parse(saved);
        sessionStorage.removeItem('__bb_pending_crumbs');
        const age = Date.now() - new Date(timestamp).getTime();
        if (age < 5 * 60 * 1000 && prevCrumbs.length > 0) {
          _pendingRecovery = { sessionId: prevSession, breadcrumbs: prevCrumbs };
        }
      }
    } catch { /* sessionStorage not available */ }
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

    // Flush breadcrumbs on tab close/hide
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const handleUnload = () => {
        try {
          const pending = _breadcrumbs ? _breadcrumbs.snapshot() : [];
          if (pending.length > 0) {
            sessionStorage.setItem('__bb_pending_crumbs', JSON.stringify({
              sessionId: _sessionId,
              breadcrumbs: pending.slice(-40),
              timestamp: new Date().toISOString()
            }));
          }
          if (_onActivityFlushCallback) {
            _onActivityFlushCallback(pending);
          }
        } catch { /* sessionStorage may not be available */ }
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') handleUnload();
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('beforeunload', handleUnload);
      _cleanupFns.push(() => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('beforeunload', handleUnload);
      });
    }

    _initialized = true;

    // Initialize persistence and activity log if db is provided
    if (_config.db) {
      try { initPersistence(blackbox, _config.db, _config.firestoreFns); } catch (e) {
        console.warn('[BlackBox] Persistence init failed:', e);
      }
      try { initActivityLog(blackbox); } catch (e) {
        console.warn('[BlackBox] Activity log init failed:', e);
      }
      // Flush recovered breadcrumbs from previous session
      if (_pendingRecovery && _onActivityFlushCallback) {
        try { _onActivityFlushCallback(_pendingRecovery.breadcrumbs); } catch { /* ignore */ }
        _pendingRecovery = null;
      }
    }

    blackbox._addBreadcrumb('system', { action: 'blackbox_initialized', sessionId: _sessionId });
    const env = _config.environment || 'default';
    const dbStatus = _config.db ? 'Firestore connected' : 'local only';
    console.log(`[BlackBox] Active | ${dbStatus} | env: ${env} | session: ${_sessionId}`);

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

      const queryConstraints = [fns.where('type', '==', 'error')];
      if (fns.orderBy) queryConstraints.push(fns.orderBy('lastSeen', 'desc'));
      queryConstraints.push(fns.limit(limit));
      const q = fns.query(ref, ...queryConstraints);
      const snapshot = await fns.getDocs(q);
      const errors = snapshot.docs.map(d => {
        const data = d.data();
        if (data.firstSeen?.toDate) data.firstSeen = data.firstSeen.toDate().toISOString();
        if (data.lastSeen?.toDate) data.lastSeen = data.lastSeen.toDate().toISOString();
        if (data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
        return { id: d.id, ...data };
      });

      // Rank by impact: occurrences × recency score (0-1 based on last 24h)
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      errors.sort((a, b) => {
        const recencyA = Math.max(0, 1 - (now - new Date(a.lastSeen).getTime()) / DAY_MS);
        const recencyB = Math.max(0, 1 - (now - new Date(b.lastSeen).getTime()) / DAY_MS);
        const scoreA = (a.occurrences || 1) * (0.3 + 0.7 * recencyA);
        const scoreB = (b.occurrences || 1) * (0.3 + 0.7 * recencyB);
        return scoreB - scoreA;
      });

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
      if (!fns || !ref || !fns.deleteDoc) return { success: false, error: 'Not connected to Firestore' };

      // Only delete error documents, not activity documents
      const errorQuery = fns.query(ref, fns.where('type', '==', 'error'));
      const snapshot = await fns.getDocs(errorQuery);
      let deleted = 0;
      for (const doc of snapshot.docs) {
        try {
          await fns.deleteDoc(doc.ref);
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

      // Check errorExcludePatterns
      const excludes = _config.errorExcludePatterns || [];
      if (excludes.length > 0 && message) {
        if (excludes.some(p => message.includes(p))) return;
      }

      // Dedup: skip if same error recorded within 150ms
      // (prevents double-count from window.onerror + React's console.error re-throw)
      const now = Date.now();
      const norm = (message || '').replace(/^Uncaught\s+\w+:\s*/, '').slice(0, 100);
      _recentErrors = _recentErrors.filter(r => now - r.t < 150);
      if (_recentErrors.some(r => r.m === norm)) return;
      _recentErrors.push({ m: norm, t: now });

      // Error storm detection: collapse rapid-fire identical errors in-memory
      const storm = _errorStorms.get(norm);
      if (storm && (now - storm.firstSeen) < ERROR_STORM_WINDOW) {
        storm.count++;
        if (storm.count > ERROR_STORM_THRESHOLD) {
          // Update the existing entry's storm count instead of adding a new one
          if (storm.lastEntry) {
            storm.lastEntry._stormCount = storm.count;
          }
          _errorCount++;
          _notifySubscribers();
          return;
        }
      } else {
        _errorStorms.set(norm, { count: 1, firstSeen: now, lastEntry: null });
      }

      // Strip webpack/Next.js noise from messages
      if (message && message.includes('Import trace')) {
        message = message.split(/\nImport trace/)[0].trim();
      }

      // Extract Firestore index creation URL from "requires an index" errors
      if (message && message.includes('requires an index')) {
        try {
          const indexUrlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s"')]+/);
          if (indexUrlMatch) {
            context = { ...context, action_url: indexUrlMatch[0], action_hint: 'Create the missing Firestore index' };
          }
        } catch { /* ignore */ }
      }

      _writingError = true;
      _errorCount++;

      const truncatedMessage = message
        ? message.slice(0, _config.maxMessageLength)
        : '';

      // Generate fingerprint for in-memory correlation (silence ↔ error linking)
      const { fingerprint: _fp } = generateFingerprint(truncatedMessage, source, _getCurrentPath(), stack);

      const entry = {
        _fingerprint: _fp,
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
        schemaVersion: _config.schemaVersion,
        environment: _config.environment || null,
        tags: _config.tags || {},
        user: _config.user || null
      };

      _errors.push(entry);
      if (_errors.length > 50) _errors.shift();

      // Link storm tracker to this entry so future hits update it
      const stormEntry = _errorStorms.get(norm);
      if (stormEntry) stormEntry.lastEntry = entry;

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
    const prev = _onErrorCallback;
    _onErrorCallback = prev ? (entry) => { prev(entry); callback(entry); } : callback;
  },

  _onActivityFlush(callback) {
    const prev = _onActivityFlushCallback;
    _onActivityFlushCallback = prev ? (data) => { prev(data); callback(data); } : callback;
  },

  _stripQueryParams(url) {
    return _stripQueryParams(url);
  },

  _getNativeFetch() {
    return _nativeFetch;
  },

  _getCurrentPath() {
    return _getCurrentPath();
  },

  // Pending fetch tracking (used by silence detector)
  _incrementPendingFetches() { _pendingFetchCount++; _lastFetchStartTime = Date.now(); },
  _decrementPendingFetches() { _pendingFetchCount = Math.max(0, _pendingFetchCount - 1); },

  // Suspicious silence support
  _registerSilenceCheck(clickDetails) {
    if (!_initialized) return;
    const clickTime = Date.now();
    const checkId = setTimeout(() => {
      try {
        // Check if any meaningful followup breadcrumb was added after the click
        const crumbs = _breadcrumbs ? _breadcrumbs.snapshot() : [];
        const meaningfulTypes = ['network', 'navigation', 'warning', 'error', 'custom', 'form'];
        const hasFollowup = crumbs.some(c => {
          if (!meaningfulTypes.includes(c.type)) return false;
          return new Date(c.timestamp).getTime() > clickTime;
        });

        if (!hasFollowup && _pendingFetchCount > 0 && _lastFetchStartTime > clickTime) {
          // A fetch started AFTER this click is still in flight — not a silence
          return;
        }
        if (!hasFollowup) {
          // Correlate with errors that occurred shortly after the click (within the silence window)
          let relatedError = null;
          const recentErrs = _errors.slice(-10);
          for (const err of recentErrs) {
            const errTime = err.metadata?.timestamp ? new Date(err.metadata.timestamp).getTime() : 0;
            if (errTime > clickTime && errTime < clickTime + _config.silenceDetectionDelay + 500) {
              relatedError = { message: err.message, source: err.source, fingerprint: err._fingerprint || null };
              break;
            }
          }

          // Also check persisted history: errors from prior sessions matching this action
          // (lightweight check against in-memory error buffer only)

          const silence = {
            type: 'suspicious_silence',
            action: 'click_without_followup',
            clickedElement: clickDetails,
            waitedMs: _config.silenceDetectionDelay,
            ...(relatedError ? { relatedError } : {})
          };

          // Repeated silence grouping: detect "user is stuck" pattern
          const recentSilences = _suspiciousSilences.filter(s => {
            const sTime = s._timestamp || 0;
            return (clickTime - sTime) < 15000; // within 15 seconds
          });
          const isSameAction = recentSilences.some(s =>
            s.clickedElement?.tag === clickDetails.tag &&
            (s.clickedElement?.text === clickDetails.text || s.clickedElement?.dataBb === clickDetails.dataBb)
          );
          const relatedSilenceCount = recentSilences.filter(s =>
            s.clickedElement?.tag === clickDetails.tag
          ).length;

          if (relatedSilenceCount >= 2) {
            // 3rd+ silence on similar elements within 15s — mark as "user stuck"
            silence.action = 'user_stuck';
            silence.relatedSilenceCount = relatedSilenceCount + 1;
          } else if (isSameAction) {
            silence.action = 'repeated_silence';
          }

          silence._timestamp = clickTime;
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();
          blackbox._addBreadcrumb('suspicious_silence', silence);
        }
      } catch { /* ignore */ }
      // Clean up: remove this timer ID from the list
      const idx = _pendingSilenceChecks.indexOf(checkId);
      if (idx !== -1) _pendingSilenceChecks.splice(idx, 1);
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
    _pendingFetchCount = 0;
    _lastFetchStartTime = 0;
    _recentErrors = [];
    _errorStorms = new Map();
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
