export function installErrorHook(blackbox) {
  const errorHandler = (event) => {
    try {
      const message = event.message || 'Unknown error';
      const stack = event.error?.stack || `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`;
      blackbox._recordError({ message, stack, source: 'window.onerror', context: {} });
    } catch { /* BlackBox must never crash the host app */ }
  };

  const rejectionHandler = (event) => {
    try {
      const reason = event.reason;
      const message = reason?.message || String(reason);
      const stack = reason?.stack || '';
      blackbox._recordError({ message, stack, source: 'unhandled_promise', context: {} });
    } catch { /* BlackBox must never crash the host app */ }
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);

  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  };
}
