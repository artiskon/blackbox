import { extractTopAppFrame } from '../fingerprint.js';

export function installConsoleHook(blackbox) {
  const config = blackbox._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];

  const nativeError = console.error;
  const nativeWarn = console.warn;

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
    const remaining = args.slice(i);
    if (remaining.length > 0) {
      return (result + ' ' + remaining.map(a => typeof a === 'string' ? a : String(a)).join(' ')).slice(0, config.maxMessageLength);
    }
    return result.slice(0, config.maxMessageLength);
  }

  function serializeArg(a) {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object' && (a instanceof Error || a.code || a.message)) {
      const parts = [];
      if (a.message) parts.push(a.message);
      if (a.code) parts.push(`[code: ${a.code}]`);
      if (a.path) parts.push(`[path: ${a.path}]`);
      if (a.stack && !a.message) parts.push(a.stack.split('\n')[0]);
      return parts.length > 0 ? parts.join(' ') : String(a);
    }
    try { return JSON.stringify(a); } catch { return String(a); }
  }

  function stringifyArgs(args) {
    const interpolated = interpolateFormatString(args);
    if (interpolated !== null) return interpolated;
    return args.map(serializeArg).join(' ').slice(0, config.maxMessageLength);
  }

  function matchesIgnorePattern(message) {
    return ignorePatterns.some(pattern => message.includes(pattern));
  }

  // BB recording flag — prevents re-entry from nested wrappers
  let _recording = false;

  function bbHandleError(...args) {
    if (_recording) return;
    _recording = true;
    try {
      const message = stringifyArgs(args);
      if (message.includes('[BlackBox]')) return;
      if (matchesIgnorePattern(message)) return;
      let stack = new Error().stack || '';
      const ctx = {};
      for (const a of args) {
        if (a && typeof a === 'object' && (a instanceof Error || a.code)) {
          if (a.code) ctx.code = a.code;
          if (a.path) ctx.path = a.path;
          if (a.stack) stack = a.stack;
        }
      }
      // Pull out the first non-framework frame from the captured stack and
      // surface it as context.callerFrame. For bare console.error("...") with
      // no Error object, the synthetic stack is otherwise just the BB
      // wrapper chain — useless in a report. Filtered through the same
      // SKIP_FRAMES_RE used by fingerprinting, so framework noise doesn't
      // sneak in. Saves the dev from grepping the codebase for the message
      // string to find the call site.
      try {
        const frame = extractTopAppFrame(stack);
        if (frame) ctx.callerFrame = frame.replace(/^\s*at\s+/, '').slice(0, 200);
      } catch { /* ignore */ }
      blackbox._recordError({ message, stack, source: 'console.error', context: ctx });
    } catch { /* BlackBox must never crash the host app */ }
    finally { _recording = false; }
  }

  function bbHandleWarn(...args) {
    if (_recording) return;
    _recording = true;
    try {
      const message = stringifyArgs(args);
      if (message.includes('[BlackBox]')) return;
      if (matchesIgnorePattern(message)) return;
      blackbox._addBreadcrumb('warning', { message });
    } catch { /* BlackBox must never crash the host app */ }
    finally { _recording = false; }
  }

  // Patch strategy: replace console.error/warn with a function that:
  // 1. Calls whatever console.error currently points to (may be React's wrapper)
  //    but through the NATIVE function to avoid chain growth
  // 2. Runs BB recording logic
  // On re-patch: we always replace console.error fresh, never wrapping our own wrapper.

  const SENTINEL = '__bb_hooked';

  function patchError() {
    if (console.error[SENTINEL]) return;
    // Capture the current non-BB wrapper (e.g., React's)
    const thirdPartyWrapper = console.error;
    const wrapped = function (...args) {
      // Call the third-party wrapper (which calls native internally)
      thirdPartyWrapper.apply(console, args);
      bbHandleError(...args);
    };
    wrapped[SENTINEL] = true;
    // Store ref so re-patch can detect if we're still the top-level
    wrapped.__bb_fn = bbHandleError;
    console.error = wrapped;
  }

  function patchWarn() {
    if (console.warn[SENTINEL]) return;
    const thirdPartyWrapper = console.warn;
    const wrapped = function (...args) {
      thirdPartyWrapper.apply(console, args);
      bbHandleWarn(...args);
    };
    wrapped[SENTINEL] = true;
    wrapped.__bb_fn = bbHandleWarn;
    console.warn = wrapped;
  }

  patchError();
  patchWarn();

  const repatchInterval = setInterval(() => {
    patchError();
    patchWarn();
  }, 2000);

  return () => {
    clearInterval(repatchInterval);
    console.error = nativeError;
    console.warn = nativeWarn;
  };
}
