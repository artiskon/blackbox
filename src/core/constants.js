export const DEFAULTS = {
  collectionName: '__blackbox',
  maxBreadcrumbs: 80,
  slowRequestThreshold: 3000,
  silenceDetectionDelay: 2000,
  maxMessageLength: 2000,
  maxUrlLength: 500,
  maxBodyLength: 0,
  maxErrorBodyLength: 1024,
  maxClassNameLength: 200,
  maxBreadcrumbRepeat: 3,
  activityFlushInterval: 120000,
  schemaVersion: 1,

  // Persistence
  maxWriteFailures: 3,
  maxDocumentBytes: 500000,

  // Privacy
  stripQueryParams: true,
  captureRequestBodies: false,
  consoleIgnorePatterns: [
    'Warning: Each child in a list',
    'Warning: Can\'t perform a React state update on an unmounted',
    'Download the React DevTools',
    'Warning: ReactDOM.render is no longer supported'
  ],
  sanitize: null,

  // Error filtering — suppress known errors by message substring
  errorExcludePatterns: [],

  // Network noise filtering
  networkExcludePatterns: [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    '__nextjs_original-stack-frames',
    'hot-update',
  ],

  // Context tagging
  environment: null,
  tags: {},
  user: null,

  // Build / deploy provenance — auto-detected from common host env vars
  // when not provided. Surfaces "this error came from build X / env Y"
  // in the panel and bb-check, so devs can tell stale-vs-fresh at a glance.
  buildSha: null,
  nodeEnv: null
};
