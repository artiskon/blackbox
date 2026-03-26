export function installConsoleHook(blackbox) {
  const config = blackbox._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  function stringifyArgs(args) {
    return args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ').slice(0, config.maxMessageLength);
  }

  function matchesIgnorePattern(message) {
    return ignorePatterns.some(pattern => message.includes(pattern));
  }

  console.error = function (...args) {
    originalError(...args);
    try {
      const message = stringifyArgs(args);
      if (message.includes('[BlackBox]')) return;
      if (matchesIgnorePattern(message)) return;
      const stack = new Error().stack || '';
      blackbox._recordError({ message, stack, source: 'console.error', context: {} });
    } catch { /* BlackBox must never crash the host app */ }
  };

  console.warn = function (...args) {
    originalWarn(...args);
    try {
      const message = stringifyArgs(args);
      if (message.includes('[BlackBox]')) return;
      if (matchesIgnorePattern(message)) return;
      blackbox._addBreadcrumb('warning', { message });
    } catch { /* BlackBox must never crash the host app */ }
  };

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}
