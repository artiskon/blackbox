export const DEFAULTS = {
  collectionName: '__blackbox',
  maxBreadcrumbs: 80,
  slowRequestThreshold: 3000,
  silenceDetectionDelay: 2000,
  maxMessageLength: 2000,
  maxUrlLength: 500,
  maxBodyLength: 0,
  maxClassNameLength: 200,
  maxBreadcrumbRepeat: 3,
  activityFlushInterval: 60000,
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
  sanitize: null
};
