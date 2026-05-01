// ---- Config ----

export interface BlackBoxConfig {
  /** Firestore database instance */
  db?: any;
  /** Force BlackBox on even when NODE_ENV === 'production' */
  enabled?: boolean;
  /** Strip query parameters from stored URLs (default: true) */
  stripQueryParams?: boolean;
  /** Capture request/response bodies (default: false) */
  captureRequestBodies?: boolean;
  /** Custom redaction hook — return null to drop the breadcrumb */
  sanitize?: ((breadcrumb: Breadcrumb) => Breadcrumb | null) | null;
  /** Console messages matching these patterns are silently dropped */
  consoleIgnorePatterns?: string[];
  /** Firestore collection name (default: '__blackbox') */
  collectionName?: string;
  /** Maximum breadcrumbs to keep in memory (default: 80) */
  maxBreadcrumbs?: number;
  /** Max bytes to capture from request/response bodies on non-2xx responses (default: 1024) */
  maxErrorBodyLength?: number;
  /** URL patterns to exclude from network tracking (default: Firestore, HMR, etc.) */
  networkExcludePatterns?: string[];
  /** Environment label (e.g. 'development', 'staging') */
  environment?: string;
  /** Arbitrary key-value tags */
  tags?: Record<string, string>;
  /** User context for error attribution */
  user?: { id?: string; role?: string; [key: string]: any } | null;
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
  success: boolean;
  deleted?: number;
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

  /** Query health summary from Firestore (last 24 hours) */
  queryHealth(): Promise<QueryHealthResult>;

  /** Query activity timeline from Firestore */
  queryTimeline(minutes?: number): Promise<QueryTimelineResult>;

  /** Delete all persisted errors from Firestore */
  clearPersistedErrors(): Promise<ClearResult>;

  /** Check if BlackBox is connected to Firestore */
  isConnectedToFirestore(): boolean;

  /** Set user context for error attribution */
  setUser(user: { id?: string; role?: string; [key: string]: any } | null): void;

  /** Set a tag key-value pair */
  setTag(key: string, value: string): void;

  /** Set the environment label */
  setEnvironment(env: string): void;

  /** Tear down BlackBox: remove all hooks, clear timers, reset state. Useful for HMR cleanup. */
  destroy(): void;
}

declare const blackbox: BlackBox;
export default blackbox;

// ---- Re-exports ----

export { bbFirestoreOp, bbTrackAuth, bbOnSnapshot } from './firebase.js';
export { bbR2Fetch } from './storage.js';
