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
      const isObject = reason !== null && typeof reason === 'object';
      const isResponse = isObject && typeof Response !== 'undefined' && reason instanceof Response;
      const context = {};
      let message;
      // Non-Error reasons (`throw res`, `{status, code, error}` from fetch
      // wrappers) would otherwise all read "[object Object]" and share one
      // fingerprint. String() is never called on objects: it throws for
      // null-prototype ones, which silently dropped the rejection.
      if (reason instanceof Error) {
        message = reason.message || String(reason);
      } else if (typeof reason?.message === 'string' && reason.message) {
        message = reason.message;
      } else if (!isObject) {
        message = String(reason);
      } else if (isResponse) {
        message = `HTTP ${reason.status} ${blackbox._stripQueryParams(reason.url) || ''}`.trim();
      } else if (typeof reason.error === 'string' && reason.error) {
        message = reason.error;
      } else if (typeof reason.code === 'string' && reason.code) {
        message = reason.code;
      } else {
        try { message = JSON.stringify(reason); } catch { /* circular */ }
        if (!message || message === '{}') message = Object.prototype.toString.call(reason);
      }
      if (!(reason instanceof Error)) context.reasonType = isResponse ? 'Response' : reason === null ? 'null' : typeof reason;
      const isPrimitive = (v) => typeof v === 'string' || typeof v === 'number';
      if (isObject && isPrimitive(reason.code)) context.code = reason.code;
      if (isObject && isPrimitive(reason.status)) context.status = reason.status;
      const stack = typeof reason?.stack === 'string' ? reason.stack : '';
      blackbox._recordError({ message, stack, source: 'unhandled_promise', context });
    } catch { /* BlackBox must never crash the host app */ }
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);

  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  };
}
