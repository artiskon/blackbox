import { DEFAULTS } from './constants.js';
import { generateSessionId } from './session.js';
import { generateFingerprint, isStackEntirelyInternal } from './fingerprint.js';
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
let _recentErrors = []; // dedup window: [{ m: norm, t: time, sigs: Map<source, stack+context>, entry }]
let _errorStorms = new Map(); // norm → { count, firstSeen, lastSeen, lastEntry }
let _diagnostics = []; // [{ name, match, run, timeoutMs }]
let _preInit = {}; // setUser/setTag/setEnvironment values set before init()
const DIAGNOSTIC_DEFAULT_TIMEOUT_MS = 200;
// Ignore/exclude lists where user patterns extend the built-in defaults
const EXTENDING_LIST_OPTIONS = ['consoleIgnorePatterns', 'networkExcludePatterns'];
const ERROR_STORM_WINDOW = 5000;
const ERROR_STORM_THRESHOLD = 5;

// Keep hash routes ('#/route', '#section') but drop query strings inside
// them ('#/reset?token=x' → '#/reset') and key=value fragments like OAuth
// implicit-flow '#access_token=...', which would otherwise persist tokens.
function _sanitizeHash(hash) {
  const qIndex = hash.indexOf('?');
  const route = qIndex === -1 ? hash : hash.substring(0, qIndex);
  return route.includes('=') ? '' : route;
}

function _stripQueryParams(url) {
  if (!url || !_config.stripQueryParams) return url;
  try {
    if (url.startsWith('http')) {
      const u = new URL(url);
      return u.origin + u.pathname + _sanitizeHash(u.hash);
    }
    // Relative path
    const hashIndex = url.indexOf('#');
    let base = hashIndex === -1 ? url : url.substring(0, hashIndex);
    const hash = hashIndex === -1 ? '' : _sanitizeHash(url.substring(hashIndex));
    const qIndex = base.indexOf('?');
    if (qIndex !== -1) base = base.substring(0, qIndex);
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

function _diagnosticMatches(d, errorEntry) {
  try {
    if (typeof d.match === 'function') return !!d.match(errorEntry);
    // RegExp tested against the most likely identifying surfaces. The
    // _rawUrl / _rawSrc surfaces are ephemeral (not persisted) and carry
    // the URL with query params intact — needed when the diagnostic is
    // keyed off `?mode=foo` / signed-token-bearing URLs that the privacy
    // strip would otherwise hide from the matcher. See ADR-0021.
    const probes = [
      errorEntry.message || '',
      errorEntry.url || '',
      errorEntry.context?.src || '',
      errorEntry.context?.url || '',
      errorEntry.context?._rawSrc || '',
      errorEntry.context?._rawUrl || '',
    ];
    return probes.some(s => s && d.match.test(s));
  } catch {
    return false;
  }
}

function _runDiagnosticsFor(errorEntry) {
  if (_diagnostics.length === 0) return;
  // One promise per matching diagnostic, resolved when it settles (result,
  // error or timeout). Persistence awaits entry._diagnosticsDone before the
  // Firestore write so context.diagnostics lands in the stored doc.
  const done = [];
  for (const d of _diagnostics) {
    if (!_diagnosticMatches(d, errorEntry)) continue;
    const timeoutMs = d.timeoutMs || DIAGNOSTIC_DEFAULT_TIMEOUT_MS;
    let settled = false;
    let markDone;
    done.push(new Promise(resolve => { markDone = resolve; }));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      _attachDiagnosticResult(errorEntry, d.name, { error: 'timeout', timeoutMs });
      markDone();
    }, timeoutMs);
    Promise.resolve().then(() => d.run(errorEntry)).then(
      result => {
        if (settled) return; // timeout fired first — drop late result
        settled = true;
        clearTimeout(timer);
        _attachDiagnosticResult(errorEntry, d.name, result);
        markDone();
      },
      err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        _attachDiagnosticResult(errorEntry, d.name, { error: err?.message || String(err) });
        markDone();
      }
    );
  }
  if (done.length > 0) {
    try {
      // Non-enumerable so JSON.stringify(entry) (panel copy) doesn't print it
      Object.defineProperty(errorEntry, '_diagnosticsDone', {
        value: Promise.allSettled(done),
        enumerable: false,
        configurable: true
      });
    } catch { /* ignore */ }
  }
}

function _attachDiagnosticResult(errorEntry, name, result) {
  try {
    if (!errorEntry.context) errorEntry.context = {};
    if (!errorEntry.context.diagnostics) errorEntry.context.diagnostics = {};
    errorEntry.context.diagnostics[name] = result;
    _notifySubscribers();
  } catch { /* ignore */ }
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
      // Bare `process.env.NODE_ENV` on purpose: bundlers (Vite, webpack5,
      // Rspack) inline the literal but define no runtime `process` global,
      // so a `typeof process` guard would read false and leave BB enabled
      // in production. When nothing inlines it, the ReferenceError is caught.
      try {
        if (process.env.NODE_ENV === 'production') {
          console.log('[BlackBox] Disabled');
          return blackbox;
        }
      } catch { /* process not available, continue */ }
    }

    // Validate db if provided
    if (options.db && typeof options.db !== 'object') {
      console.error('[BlackBox] init() `db` must be a Firestore instance. Got:', typeof options.db);
    }

    // Explicitly-undefined options fall back to the default (e.g.
    // `stripQueryParams: appConfig.unsetFlag` must not turn privacy off), and
    // ignore/exclude lists add to the built-in noise filters. Setter calls
    // made before init() (a child component's effect runs before its
    // parent's) apply here; explicit init options win, tags merge.
    const cfg = { ...DEFAULTS, ..._preInit };
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) cfg[key] = value;
    }
    cfg.tags = { ...DEFAULTS.tags, ..._preInit.tags, ...options.tags };
    for (const key of EXTENDING_LIST_OPTIONS) {
      cfg[key] = [...DEFAULTS[key], ...(Array.isArray(options[key]) ? options[key] : [])];
    }
    _config = cfg;
    _preInit = {};

    // Auto-detect build SHA and NODE_ENV from common host env vars when the
    // app didn't pass them explicitly. Saves the user from threading a
    // value through init() in the most common cases (Next/Vercel/Netlify/
    // GitHub Actions). Custom values from options.* always win.
    // Bare `process.env.*` reads so bundler-inlined literals work without a
    // `process` global (see the production guard above). Separate try blocks
    // so a missing buildSha var can't skip the nodeEnv detection.
    try {
      if (!_config.buildSha) {
        _config.buildSha =
          process.env.NEXT_PUBLIC_BUILD_SHA ||
          process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.NETLIFY_COMMIT_REF ||
          process.env.GITHUB_SHA ||
          null;
      }
    } catch { /* process not available */ }
    try {
      if (!_config.nodeEnv) {
        _config.nodeEnv = process.env.NODE_ENV || null;
      }
    } catch { /* process not available */ }

    // Pick up runner-supplied tags from the global scope. The DigitalDen
    // ui-check runner injects these via Playwright's addInitScript before
    // the page boots, so they're available before init() runs. Both are
    // explicitly optional and only read once — re-init would re-read.
    //   __BB_SESSION_TAG__ : a unique correlation token for this audit run.
    //                       Persists on every error doc as `sessionTag` so
    //                       the runner can filter __blackbox by its own
    //                       session, ignoring concurrent real-user activity.
    //   __BB_FAIL_FAST__   : when truthy, BB sets window.__BB_FAIL_FAST_TRIPPED__
    //                       (with details) and dispatches a 'blackbox:fail-fast'
    //                       CustomEvent on the first recorded error. The
    //                       runner watches for either signal and halts.
    try {
      if (typeof window !== 'undefined') {
        if (!_config.sessionTag && typeof window.__BB_SESSION_TAG__ === 'string') {
          _config.sessionTag = window.__BB_SESSION_TAG__.trim().slice(0, 64) || null;
        }
        if (_config.failFast === undefined && window.__BB_FAIL_FAST__) {
          _config.failFast = true;
        }
      }
    } catch { /* ignore — sandboxed iframes can throw on window access */ }

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
      // flushActivity saves its unflushed crumbs to sessionStorage before its
      // first await and clears them once the write lands, so a flush that
      // dies with the page is recovered on next init.
      const handleUnload = () => {
        try {
          const pending = _breadcrumbs ? _breadcrumbs.snapshot() : [];
          if (_onActivityFlushCallback) {
            _onActivityFlushCallback(pending);
          }
        } catch { /* ignore */ }
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
      // Replays crumbs from a flush that died with the previous page, under
      // that page's sessionId (see activityLog.js initActivityLog).
      try { initActivityLog(blackbox, _pendingRecovery); } catch (e) {
        console.warn('[BlackBox] Activity log init failed:', e);
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
    // Server: never keep user IDs in module state shared across requests
    if (typeof window === 'undefined') return;
    if (!_initialized) { _preInit.user = userInfo; return; }
    _config.user = userInfo;
  },

  /**
   * Register an app-defined diagnostic that runs on every matching error
   * and attaches its result to the error's context.diagnostics[name].
   *
   * Closes the "I had to write 5 ad-hoc probe scripts to diagnose one
   * asset URL" gap an agent reported in a v1.8 session — the app knows
   * how to check its own state (KV, R2 buckets, Firestore docs); BB
   * just needs a hook to run that check and embed the result.
   *
   * @param {string} name    Result key under context.diagnostics.
   * @param {object} options
   * @param {RegExp|Function} options.match  RegExp tested against the error
   *   message + url + context.src, OR a function (errorEntry) => boolean.
   * @param {Function} options.run  async (errorEntry) => any. Result is
   *   attached verbatim. Keep it small and fast — capped at timeoutMs.
   * @param {number} [options.timeoutMs=200]  Hard cap; on timeout the entry
   *   gets {error: 'timeout'} and the run keeps going in the background
   *   (its result is dropped).
   */
  registerDiagnostic(name, { match, run, timeoutMs = DIAGNOSTIC_DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof name !== 'string' || !name) return;
    if (typeof run !== 'function') return;
    if (!(match instanceof RegExp) && typeof match !== 'function') return;
    // Replace any existing diagnostic with the same name so re-registering
    // during HMR doesn't accumulate duplicates.
    _diagnostics = _diagnostics.filter(d => d.name !== name);
    // Drop the stateful g/y flags: test() would otherwise carry lastIndex
    // across probes and errors and miss every other matching error.
    if (match instanceof RegExp && /[gy]/.test(match.flags)) {
      match = new RegExp(match.source, match.flags.replace(/[gy]/g, ''));
    }
    _diagnostics.push({ name, match, run, timeoutMs });
  },

  unregisterDiagnostic(name) {
    _diagnostics = _diagnostics.filter(d => d.name !== name);
  },

  setTag(key, value) {
    if (typeof window === 'undefined') return;
    if (!_initialized) { _preInit.tags = { ..._preInit.tags, [key]: value }; return; }
    if (!_config.tags) _config.tags = {};
    _config.tags[key] = value;
  },

  setEnvironment(env) {
    if (typeof window === 'undefined') return;
    if (!_initialized) { _preInit.environment = env; return; }
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
    // Only return silences we surfaced (user_stuck or correlated with an error).
    // Raw single silences are kept internally for burst detection but not shown.
    return _suspiciousSilences.filter(s => s._surfaced);
  },

  clearErrors() {
    _errorCount = 0;
    _errors = [];
    _recentErrors = [];
    _errorStorms = new Map();
    _suspiciousSilences = [];
    if (_breadcrumbs) _breadcrumbs.clear();
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

      // Rank by impact: occurrences × recency × cause-weight.
      // Cause-weight downranks SDK internal cascades (INTERNAL ASSERTION, etc.)
      // that are noisy effects of a quieter root error like permission-denied.
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      const isCascadeNoise = (msg) => {
        if (!msg) return false;
        return /INTERNAL ASSERTION FAILED|Unexpected state \(ID:|__PRIVATE_hardAssert|__PRIVATE__fail/i.test(msg);
      };
      errors.sort((a, b) => {
        const recencyA = Math.max(0, 1 - (now - new Date(a.lastSeen).getTime()) / DAY_MS);
        const recencyB = Math.max(0, 1 - (now - new Date(b.lastSeen).getTime()) / DAY_MS);
        const causeA = isCascadeNoise(a.message) ? 0.4 : 1;
        const causeB = isCascadeNoise(b.message) ? 0.4 : 1;
        const scoreA = (a.occurrences || 1) * (0.3 + 0.7 * recencyA) * causeA;
        const scoreB = (b.occurrences || 1) * (0.3 + 0.7 * recencyB) * causeB;
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

      const since = fns.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      // Window on lastSeen (matches bb-health), so an old error that recurred
      // today counts. Served by the type ASC + lastSeen DESC index, which
      // needs orderBy: without it the implicit ASC sort needs an index nobody
      // deploys, so older firestoreFns lists keep the createdAt window
      // (type ASC + createdAt ASC index).
      const q = fns.orderBy
        ? fns.query(ref, fns.where('type', '==', 'error'), fns.where('lastSeen', '>=', since), fns.orderBy('lastSeen', 'desc'))
        : fns.query(ref, fns.where('type', '==', 'error'), fns.where('createdAt', '>=', since));
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
      const ts = fns.Timestamp.fromDate(cutoff);
      const q = fns.query(ref, fns.where('createdAt', '>=', ts));
      // Same as bb-timeline: a re-fired error keeps its old createdAt but gets
      // fresh breadcrumbs and lastSeen, so also pull errors by lastSeen
      // (type ASC + lastSeen DESC index, so only with orderBy) and merge; the
      // dedup below absorbs the overlap. A failure of that extra query (e.g.
      // index not deployed) falls back to the createdAt results alone.
      const errQ = fns.orderBy
        ? fns.query(ref, fns.where('type', '==', 'error'), fns.where('lastSeen', '>=', ts), fns.orderBy('lastSeen', 'desc'))
        : null;
      const [snapshot, errSnapshot] = await Promise.all([
        fns.getDocs(q),
        errQ ? fns.getDocs(errQ).catch(() => null) : null
      ]);

      const seen = new Set();
      const events = [];
      for (const doc of [...snapshot.docs, ...(errSnapshot?.docs || [])]) {
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
      let firstError = null;
      for (const doc of snapshot.docs) {
        try {
          await fns.deleteDoc(doc.ref);
          deleted++;
        } catch (e) {
          // Keep going, but report the first failure so a partial delete isn't shown as success
          firstError = firstError || e?.message || String(e);
        }
      }
      return { success: deleted === snapshot.size, deleted, total: snapshot.size, ...(firstError ? { error: firstError } : {}) };
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

      // Cross-channel dedup with firedAs tracking (200ms window).
      // When the same error fires via console.error, window.onerror, and
      // unhandled_promise, record ONE row and track which channels it hit.
      // A channel the slot hasn't seen yet is a duplicate. So is an exact
      // same-source repeat (same stack and context), e.g. React 18 dev
      // dispatching one render crash to window 'error' twice. A same-source
      // repeat with different stack/context (several bbOnSnapshot listeners
      // denied in one tick, each with its own queryPath) is a distinct error
      // and falls through to storm detection.
      const now = Date.now();
      const norm = (message || '').replace(/^Uncaught\s+\w+:\s*/, '').slice(0, 100);
      let sig;
      try { sig = (stack || '') + '\n' + JSON.stringify(context); } catch { sig = {}; /* unserializable: never equal */ }
      _recentErrors = _recentErrors.filter(r => now - r.t < 200);
      const existingRecent = _recentErrors.find(r => r.m === norm && (!r.sigs.has(source) || r.sigs.get(source) === sig));
      if (existingRecent) {
        if (!existingRecent.sigs.has(source)) existingRecent.sigs.set(source, sig);
        if (existingRecent.entry && source) {
          existingRecent.entry.firedAs = existingRecent.entry.firedAs || [existingRecent.entry.source];
          if (!existingRecent.entry.firedAs.includes(source)) {
            existingRecent.entry.firedAs.push(source);
          }
        }
        return;
      }
      const recentSlot = { m: norm, t: now, sigs: new Map([[source, sig]]), entry: null };
      _recentErrors.push(recentSlot);

      // Error storm detection: collapse rapid-fire identical errors in-memory.
      // Sliding window: a storm stays open until the message goes quiet for
      // ERROR_STORM_WINDOW, so a sustained loop doesn't re-admit 5 fresh
      // entries every window and push the root cause out of _errors.
      if (_errorStorms.size > 100) {
        // Prune expired trackers (mirrors persistence.js) so unique messages
        // don't pin their full entries in memory for the whole session.
        for (const [key, s] of _errorStorms) {
          if (now - s.lastSeen >= ERROR_STORM_WINDOW) _errorStorms.delete(key);
        }
      }
      const storm = _errorStorms.get(norm);
      if (storm && (now - storm.lastSeen) < ERROR_STORM_WINDOW) {
        storm.count++;
        storm.lastSeen = now;
        // Collapse into the existing entry while it's still in the buffer;
        // if it was shifted out or cleared, record a fresh one so the storm
        // stays visible.
        if (storm.count > ERROR_STORM_THRESHOLD && storm.lastEntry && _errors.includes(storm.lastEntry)) {
          storm.lastEntry._stormCount = storm.count;
          _errorCount++;
          // Still tell persistence about the hit: it skips the write past its
          // own threshold and adds these to `occurrences` at window end.
          if (_onErrorCallback) {
            try { _onErrorCallback(storm.lastEntry); } catch { /* ignore */ }
          }
          _notifySubscribers();
          return;
        }
      } else {
        _errorStorms.set(norm, { count: 1, firstSeen: now, lastSeen: now, lastEntry: null });
      }

      // Strip webpack/Next.js noise from messages
      if (message && message.includes('Import trace')) {
        message = message.split(/\nImport trace/)[0].trim();
      }

      // Extract Firestore index creation URL from "requires an index" errors.
      // Distinguish transient (still-building) from missing — both surface as
      // failed-precondition, but the fix is different: wait vs deploy.
      if (message && message.includes('requires an index')) {
        try {
          const indexUrlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s"')]+/);
          const isBuilding = /currently building|cannot be used yet|is not yet usable/i.test(message);
          const hint = isBuilding
            ? 'Index is still building — wait 1–5 minutes and retry'
            : 'Create the missing Firestore index';
          context = {
            ...context,
            ...(indexUrlMatch ? { action_url: indexUrlMatch[0] } : {}),
            action_hint: hint,
            ...(isBuilding ? { transient: true } : {})
          };
        } catch { /* ignore */ }
      }

      _writingError = true;
      _errorCount++;

      const truncatedMessage = message
        ? message.slice(0, _config.maxMessageLength)
        : '';

      // Generate fingerprint for in-memory correlation (silence ↔ error linking)
      const { fingerprint: _fp } = generateFingerprint(truncatedMessage, source, _getCurrentPath(), stack);

      // Detect framework-only errors so the panel and CLI can hide them by
      // default — they're almost always BB capturing a framework warning
      // about itself, not an app bug the developer can fix.
      const _internal = isStackEntirelyInternal(stack);

      const entry = {
        _fingerprint: _fp,
        message: truncatedMessage,
        stack: stack || '',
        source,
        firedAs: source ? [source] : [],
        path: _getCurrentPath(),
        url: _stripQueryParams(window.location.href),
        breadcrumbs: _breadcrumbs ? _breadcrumbs.snapshot() : [],
        context,
        internal: _internal || undefined,
        metadata: {
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: new Date().toISOString(),
          language: navigator.language,
          ...(_config.buildSha ? { buildSha: _config.buildSha } : {}),
          ...(_config.nodeEnv ? { nodeEnv: _config.nodeEnv } : {})
        },
        sessionId: _sessionId,
        ...(_config.sessionTag ? { sessionTag: _config.sessionTag } : {}),
        schemaVersion: _config.schemaVersion,
        environment: _config.environment || null,
        tags: _config.tags || {},
        user: _config.user || null
      };

      _errors.push(entry);
      if (_errors.length > 50) _errors.shift();

      // Link the recent-dedup slot so cross-channel fires append to firedAs
      recentSlot.entry = entry;

      // Fire any matching app-registered diagnostics in the background.
      // Results land on entry.context.diagnostics[name] when they resolve;
      // if they take longer than timeoutMs, the entry shows {error:'timeout'}
      // and the actual result is dropped (no orphan writes).
      _runDiagnosticsFor(entry);

      // Link storm tracker to this entry so future hits update it
      const stormEntry = _errorStorms.get(norm);
      if (stormEntry) stormEntry.lastEntry = entry;

      blackbox._addBreadcrumb('error', { message: truncatedMessage, source });

      if (_onErrorCallback) {
        try { _onErrorCallback(entry); } catch { /* ignore */ }
      }

      // Fail-fast trip: when armed, expose the captured error to the host
      // (typically the ui-check Playwright runner) so it can halt the route
      // capture early instead of waiting for the post-settle Firestore
      // poll. Two surfaces: a window flag (cheap to poll) and a CustomEvent
      // (cheap to listen for). Skip if internal: true — those are framework
      // warnings, not app bugs the runner should halt on. We do NOT throw
      // here; throwing would re-enter the BB capture path via window.onerror
      // / unhandledrejection and risk recursion. The runner controls halt.
      if (_config.failFast && !_internal) {
        try {
          if (typeof window !== 'undefined' && !window.__BB_FAIL_FAST_TRIPPED__) {
            const trip = {
              fingerprint: _fp,
              message: truncatedMessage,
              source,
              recordedAt: new Date().toISOString(),
              sessionTag: _config.sessionTag || null,
            };
            window.__BB_FAIL_FAST_TRIPPED__ = trip;
            try {
              window.dispatchEvent(new CustomEvent('blackbox:fail-fast', { detail: trip }));
            } catch { /* CustomEvent unavailable in some environments */ }
          }
        } catch { /* ignore */ }
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

          // Track the raw click internally for "user stuck" detection, but do
          // NOT surface single silences — they were false-positive ~100% of the
          // time (modals, state toggles, slow async all look silent).
          // Only surface when we see 3+ similar clicks within 15s (rage-click).
          const silence = {
            type: 'suspicious_silence',
            action: 'click_without_followup',
            clickedElement: clickDetails,
            waitedMs: _config.silenceDetectionDelay,
            ...(relatedError ? { relatedError } : {}),
            _timestamp: clickTime
          };

          const recentSilences = _suspiciousSilences.filter(s => {
            const sTime = s._timestamp || 0;
            return (clickTime - sTime) < 15000;
          });
          // Same element = same tag plus the most specific identifier present:
          // data-bb, then id, then non-empty text. Missing values never match
          // each other (null === null would lump every unlabeled same-tag click).
          const sameElement = (a, b) => {
            if (!a || !b || a.tag !== b.tag) return false;
            if (a.dataBb != null || b.dataBb != null) return a.dataBb === b.dataBb;
            if (a.id || b.id) return a.id === b.id;
            if (a.text || b.text) return a.text === b.text;
            return false;
          };
          const relatedSilenceCount = recentSilences.filter(s =>
            sameElement(s.clickedElement, clickDetails)
          ).length;

          // Always track internally so the next one can count
          _suspiciousSilences.push(silence);
          if (_suspiciousSilences.length > 20) _suspiciousSilences.shift();

          // Only surface "user stuck" (3+ same-element silences in 15s) OR
          // silences that correlate with an error that fired nearby — those
          // are the signal. Everything else is noise.
          const isUserStuck = relatedSilenceCount >= 2;
          const hasRelatedError = !!relatedError;
          if (isUserStuck || hasRelatedError) {
            if (isUserStuck) {
              silence.action = 'user_stuck';
              silence.relatedSilenceCount = relatedSilenceCount + 1;
            }
            silence._surfaced = true;
            blackbox._addBreadcrumb('suspicious_silence', silence);
          }
        }
      } catch { /* ignore */ }
      // Clean up: remove this timer ID from the list
      const idx = _pendingSilenceChecks.indexOf(checkId);
      if (idx !== -1) _pendingSilenceChecks.splice(idx, 1);
    }, _config.silenceDetectionDelay);

    _pendingSilenceChecks.push(checkId);
  },

  /**
   * Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup.
   * Keeps onUpdate subscribers and registered diagnostics: their owners (e.g. the panel,
   * top-level registerDiagnostic calls) outlive this teardown and remove them with the
   * unsubscribe function / unregisterDiagnostic.
   */
  destroy() {
    _initialized = false;
    _config = {};
    _preInit = {};
    _sessionId = null;
    _breadcrumbs = null;
    _errors = [];
    _errorCount = 0;
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
    // Surviving subscribers re-read the now-empty state instead of showing stale counts
    _notifySubscribers();
  },

  // For testing: full wipe, including caller-owned registrations
  _reset() {
    this.destroy();
    _subscribers = [];
    _diagnostics = [];
  }
};

export default blackbox;
