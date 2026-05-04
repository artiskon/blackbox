// Default import: the blackbox singleton
export { default } from './core/blackbox.js';

// Firebase wrapper utilities
export { bbFirestoreOp, bbTrackAuth, bbOnSnapshot, bbWrapWrites } from './core/hooks/firebaseHook.js';

// Object-storage wrapper (Cloudflare R2 / S3 / GCS)
export { bbR2Fetch } from './core/hooks/storageHook.js';

// NOTE: BlackBoxPanel and BlackBoxProvider are intentionally NOT re-exported
// from the root. They live at @artiskon/blackbox/components which carries
// 'use client'. Re-exporting them from the (server-safe) root would let
// consumers import them on the server without the directive boundary,
// silently bundling client code server-side. The documented pattern is:
//   import { BlackBoxPanel, BlackBoxProvider } from '@artiskon/blackbox/components';
