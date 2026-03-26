// Default import: the blackbox singleton
export { default } from './core/blackbox.js';

// Named component exports
export { BlackBoxPanel, BlackBoxProvider } from './components/index.js';

// Firebase wrapper utilities
export { bbFirestoreOp, bbTrackAuth, bbOnSnapshot } from './core/hooks/firebaseHook.js';
