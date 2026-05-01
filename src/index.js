// Default import: the blackbox singleton
export { default } from './core/blackbox.js';

// Named component exports
export { BlackBoxPanel, BlackBoxProvider } from './components/index.js';

// Firebase wrapper utilities
export { bbFirestoreOp, bbTrackAuth, bbOnSnapshot } from './core/hooks/firebaseHook.js';

// Object-storage wrapper (Cloudflare R2 / S3 / GCS)
export { bbR2Fetch } from './core/hooks/storageHook.js';
