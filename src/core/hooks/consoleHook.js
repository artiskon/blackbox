export function installConsoleHook(blackbox) {
  const config = blackbox._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  function interpolateFormatString(args) {
    if (args.length < 2 || typeof args[0] !== 'string') return null;
    const fmt = args[0];
    if (!/%[sdoOif%]/.test(fmt)) return null;
    let i = 1;
    const result = fmt.replace(/%([sdoOif%])/g, (match, type) => {
      if (type === '%') return '%';
      if (i >= args.length) return match;
      const val = args[i++];
      if (type === 's') return String(val);
      if (type === 'd' || type === 'i' || type === 'f') return Number(val);
      if (type === 'o' || type === 'O') { try { return JSON.stringify(val); } catch { return String(val); } }
      return String(val);
    });
    // Append any remaining args
    const remaining = args.slice(i);
    if (remaining.length > 0) {
      return (result + ' ' + remaining.map(a => typeof a === 'string' ? a : String(a)).join(' ')).slice(0, config.maxMessageLength);
    }
    return result.slice(0, config.maxMessageLength);
  }

  function stringifyArgs(args) {
    const interpolated = interpolateFormatString(args);
    if (interpolated !== null) return interpolated;
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
