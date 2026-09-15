import { extractTopAppFrame } from '../fingerprint.js';

export function installConsoleHook(blackbox) {
  const config = blackbox._getConfig();
  const ignorePatterns = config.consoleIgnorePatterns || [];

  function interpolateFormatString(args) {
    if (args.length < 2 || typeof args[0] !== 'string') return null;
    const fmt = args[0];
    if (!/%[sdoOifc%]/.test(fmt)) return null;
    let i = 1;
    const result = fmt.replace(/%([sdoOifc%])/g, (match, type) => {
      if (type === '%') return '%';
      if (i >= args.length) return match;
      const val = args[i++];
      // %c consumes a CSS argument and prints nothing (React's " Server " badge
      // replay uses it); objects go through serializeArg so an Error keeps its
      // message instead of JSON's "{}".
      if (type === 'c') return '';
      if (type === 'd' || type === 'i') return String(parseInt(val, 10));
      if (type === 'f') return String(parseFloat(val));
      return serializeArg(val);
    });
    const remaining = args.slice(i);
    if (remaining.length > 0) {
      return (result + ' ' + remaining.map(serializeArg).join(' ')).trim().slice(0, config.maxMessageLength);
    }
    return result.trim().slice(0, config.maxMessageLength);
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
  // 2. Runs BB recording logic
  // Re-patch (every 2s) wraps again only when something else has replaced our
  // wrapper on top, giving BB2 -> third-party -> BB1 -> native. The depth
  // counters make only the outermost BB layer record; inner layers pass through.

  const SENTINEL = '__bb_hooked';
  let errorDepth = 0;
  let warnDepth = 0;
  // Cleared on teardown: layers left inside someone else's chain become pass-throughs
  let active = true;
  const isActive = () => active;
  // Our newest wrapper and the function it wraps, for teardown
  let currentErrorWrapper = null, errorBelow = null;
  let currentWarnWrapper = null, warnBelow = null;

  // Skip when any live BB layer is on top (ours or another install's, e.g. a
  // second instance after Fast Refresh): wrapping it would make two installs
  // wrap each other every 2s without limit. A torn-down (pass-through) layer
  // or a third-party wrapper on top still gets wrapped.
  function patchError() {
    if (console.error.__bb_active?.()) return;
    // Capture the current non-BB wrapper (e.g., React's)
    const thirdPartyWrapper = console.error;
    const wrapped = function (...args) {
      if (!active) return thirdPartyWrapper.apply(console, args);
      errorDepth++;
      // Call the third-party wrapper (which calls native internally)
      try { thirdPartyWrapper.apply(console, args); } finally { errorDepth--; }
      if (errorDepth === 0) bbHandleError(...args);
    };
    wrapped[SENTINEL] = true;
    wrapped.__bb_active = isActive;
    errorBelow = thirdPartyWrapper;
    console.error = currentErrorWrapper = wrapped;
  }

  function patchWarn() {
    if (console.warn.__bb_active?.()) return;
    const thirdPartyWrapper = console.warn;
    const wrapped = function (...args) {
      if (!active) return thirdPartyWrapper.apply(console, args);
      warnDepth++;
      try { thirdPartyWrapper.apply(console, args); } finally { warnDepth--; }
      if (warnDepth === 0) bbHandleWarn(...args);
    };
    wrapped[SENTINEL] = true;
    wrapped.__bb_active = isActive;
    warnBelow = thirdPartyWrapper;
    console.warn = currentWarnWrapper = wrapped;
  }

  patchError();
  patchWarn();

  const repatchInterval = setInterval(() => {
    patchError();
    patchWarn();
  }, 2000);

  return () => {
    clearInterval(repatchInterval);
    active = false;
    // Only unwind our top layer, and only while it's still on top; otherwise
    // restoring would throw away wrappers installed after us (Next's overlay,
    // Sentry, app filters). Any older layers stay as pass-throughs.
    if (console.error === currentErrorWrapper) console.error = errorBelow;
    if (console.warn === currentWarnWrapper) console.warn = warnBelow;
  };
}
