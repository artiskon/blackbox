// ---- Config ----

/** Options passed as `undefined` fall back to their defaults. */
export interface BlackBoxConfig {
  /** Firestore database instance */
  db?: any;
  /** Force BlackBox on even when NODE_ENV === 'production' */
  enabled?: boolean;
  /** Strip query parameters from stored URLs (default: true). Also strips
   *  queries inside hash routes (`#/reset?token=x` → `#/reset`) and drops
   *  key=value fragments such as `#access_token=...`. */
  stripQueryParams?: boolean;
  /** Extend request-body capture to cross-origin hosts and all methods
   *  (default: false). Even when false, same-origin POST/PUT/PATCH request
   *  bodies go on network breadcrumbs (300 chars), same-origin failed-request
   *  bodies go on the error context (maxErrorBodyLength), and non-2xx
   *  response bodies are captured for any host. Values of secret-looking
   *  request-body keys (password, token, secret, authorization, api key) are
   *  replaced with `[redacted]`. */
  captureRequestBodies?: boolean;
  /** Custom redaction hook — return null to drop the breadcrumb */
  sanitize?: ((breadcrumb: Breadcrumb) => Breadcrumb | null) | null;
  /** Console messages matching these patterns are silently dropped. Added to
   *  the built-in defaults (they can't be removed by passing a shorter list). */
  consoleIgnorePatterns?: string[];
  /** Firestore collection name (default: '__blackbox') */
  collectionName?: string;
  /** Maximum breadcrumbs to keep in memory (default: 80) */
  maxBreadcrumbs?: number;
  /** Max bytes to capture from request/response bodies on non-2xx responses (default: 1024) */
  maxErrorBodyLength?: number;
  /** URL patterns to exclude from network tracking. Added to the built-in
   *  defaults (Firestore, Identity Toolkit, Secure Token, Next stack frames,
   *  hot-update). */
  networkExcludePatterns?: string[];
  /** Environment label (e.g. 'development', 'staging'). Wins over a
   *  setEnvironment() call made before init. */
  environment?: string;
  /** Arbitrary key-value tags. Merged with setTag() calls made before init;
   *  on a conflicting key the value passed here wins. */
  tags?: Record<string, string>;
  /** User context for error attribution. Wins over a setUser() call made
   *  before init. */
  user?: { id?: string; role?: string; [key: string]: any } | null;
  /** Correlation token persisted as top-level `sessionTag` on each new error
   *  doc, and as `lastSeenSessionTag` on both create and update, so
   *  `where('lastSeenSessionTag', '==', tag)` finds new and re-fired
   *  fingerprints alike. Auto-read from
   *  `window.__BB_SESSION_TAG__` if set before init. Trimmed to 64 chars.
   *  Used by audit runners (e.g. DigitalDen ui-check Playwright runner) to
   *  filter `__blackbox` by their own session and ignore concurrent
   *  real-user activity. */
  sessionTag?: string;
  /** When true, BlackBox sets `window.__BB_FAIL_FAST_TRIPPED__` and
   *  dispatches a `blackbox:fail-fast` CustomEvent on the first non-internal
   *  error captured, so an audit runner can halt immediately. BlackBox
   *  does not throw — that would re-enter the capture path. Auto-on when
   *  `window.__BB_FAIL_FAST__` is truthy at init. Internal-frame-only
   *  errors (framework warnings) never trip. Never enable in real-user
   *  sessions. */
  failFast?: boolean;
}

// ---- Breadcrumbs & Errors ----

export interface Breadcrumb {
  type: string;
  timestamp: string;
  tag?: string;
  id?: string;
  text?: string;
  url?: string;
  from?: string;
  to?: string;
  method?: string;
  status?: number;
  message?: string;
  action?: string;
  [key: string]: any;
}

export interface CapturedError {
  message: string;
  stack: string;
  source: string;
  breadcrumbs: Breadcrumb[];
  metadata: {
    timestamp: string;
    sessionId: string;
    url: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface PersistedError {
  id: string;
  fingerprint: string;
  message: string;
  stack: string;
  source: string;
  path: string;
  breadcrumbs: Breadcrumb[];
  context: Record<string, any>;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  [key: string]: any;
}

export interface SuspiciousSilence {
  clickedElement: {
    tag?: string;
    id?: string;
    text?: string;
    [key: string]: any;
  };
  /** 'click_without_followup' | 'repeated_silence' | 'user_stuck' */
  action: string;
  timestamp: string;
  /** Error that occurred within the silence window, if any */
  relatedError?: {
    message: string;
    source: string;
    fingerprint: string | null;
  };
  /** Number of related silences when action is 'user_stuck' */
  relatedSilenceCount?: number;
  [key: string]: any;
}

// ---- Query Results ----

export interface QueryErrorsResult {
  errors: PersistedError[];
  connected: boolean;
  error?: string;
}

export interface QueryHealthResult {
  connected: boolean;
  verdict?: 'HEALTHY' | 'WARNING' | 'UNHEALTHY';
  uniqueErrors?: number;
  totalOccurrences?: number;
  systemicCount?: number;
  bySource?: Record<string, number>;
  topErrors?: PersistedError[];
  error?: string;
}

export interface QueryTimelineResult {
  events: Breadcrumb[];
  connected: boolean;
  error?: string;
}

export interface ClearResult {
  /** True only when every matched doc was deleted */
  success: boolean;
  deleted?: number;
  /** Number of error docs the delete query matched (absent if the query itself failed) */
  total?: number;
  /** The query error, or the first per-doc delete failure */
  error?: string;
}

// ---- Main BlackBox Object ----

export interface BlackBox {
  /** Initialize BlackBox with optional config */
  init(options?: BlackBoxConfig): BlackBox;

  /** Log a custom event that appears in breadcrumb trails */
  log(action: string, data?: Record<string, any>): void;

  /** Manually capture an error */
  captureError(error: Error | any, context?: Record<string, any>): void;

  /** Subscribe to error updates. Returns an unsubscribe function. */
  onUpdate(callback: () => void): () => void;

  /** Get the current error count for this session */
  getErrorCount(): number;

  /** Get the current session ID */
  getSessionId(): string | null;

  /** Get recent in-memory errors */
  getRecentErrors(limit?: number): CapturedError[];

  /** Get detected suspicious silences (unresponsive clicks) */
  getSuspiciousSilences(): SuspiciousSilence[];

  /** Clear all in-memory errors and silences */
  clearErrors(): void;

  /** Get the current breadcrumb buffer */
  getBreadcrumbs(): Breadcrumb[];

  /** Query persisted errors from Firestore */
  queryPersistedErrors(limit?: number): Promise<QueryErrorsResult>;

  /** Query health summary from Firestore: errors seen (lastSeen) in the last
   *  24 hours; totalOccurrences are those errors' lifetime counts */
  queryHealth(): Promise<QueryHealthResult>;

  /** Query activity timeline from Firestore */
  queryTimeline(minutes?: number): Promise<QueryTimelineResult>;

  /** Delete all persisted errors from Firestore */
  clearPersistedErrors(): Promise<ClearResult>;

  /** Check if BlackBox is connected to Firestore */
  isConnectedToFirestore(): boolean;

  /** Set user context for error attribution. A call made before init() is
   *  applied when init() runs (an explicit `user` init option wins). No-op on
   *  the server. */
  setUser(user: { id?: string; role?: string; [key: string]: any } | null): void;

  /** Set a tag key-value pair. Calls made before init() are applied when
   *  init() runs, merged with the `tags` init option (which wins on
   *  conflicts). No-op on the server. */
  setTag(key: string, value: string): void;

  /** Set the environment label. A call made before init() is applied when
   *  init() runs (an explicit `environment` init option wins). No-op on the
   *  server. */
  setEnvironment(env: string): void;

  /** Register an app-defined diagnostic that runs on every matching error
   *  and attaches its result to context.diagnostics[name]. Hard-capped at
   *  timeoutMs (default 200ms) — design diagnostics to be fast. The error's
   *  Firestore write waits for matching diagnostics (up to timeoutMs), so the
   *  result is persisted. RegExp `g`/`y` flags are ignored. Registrations
   *  survive destroy(); remove them with unregisterDiagnostic().
   */
  registerDiagnostic(
    name: string,
    options: {
      match: RegExp | ((errorEntry: CapturedError) => boolean);
      run: (errorEntry: CapturedError) => any | Promise<any>;
      timeoutMs?: number;
    }
  ): void;

  /** Remove a previously-registered diagnostic. */
  unregisterDiagnostic(name: string): void;

  /** Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup.
   *  Keeps onUpdate subscribers and registered diagnostics: their owners (e.g. the panel,
   *  top-level registerDiagnostic calls) remove them with the unsubscribe function /
   *  unregisterDiagnostic. Subscribers are notified so they re-read the empty state. */
  destroy(): void;
}

declare const blackbox: BlackBox;
export default blackbox;

// ---- Re-exports ----

export { bbFirestoreOp, bbTrackAuth, bbOnSnapshot, bbWrapWrites } from './firebase.js';
export { bbR2Fetch } from './storage.js';
// BlackBoxPanel / BlackBoxProvider are NOT re-exported here. Import from
// '@artiskon/blackbox/components' to get the proper 'use client' boundary.
