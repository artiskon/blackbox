import blackbox from '../blackbox.js';
import { extractTopAppFrame } from '../fingerprint.js';

/**
 * Walk a Firestore write payload to find the first `undefined` value and
 * map a 2-level shape of the keys.
 *
 * Firestore's own error tells you the document ID but not the field path
 * within the document; the SDK walks the object internally, finds the
 * undefined, throws, and discards the path. This walker reproduces enough
 * of that traversal to surface the exact dotted path (e.g.
 * `sections[5].subtitle`) plus a top-2-level shape so the agent can jump
 * straight to the bug instead of grepping for the call site.
 *
 * Bounded to keep cost per-error tiny:
 * - depth 4 (the Firestore SDK enforces a 100-level cap; 4 captures the
 *   real-world cases without chasing pathological structures)
 * - 200 keys total visited (bail early on huge payloads)
 * - cycle-safe via a WeakSet
 */
function summarizePayload(data, maxDepth = 4, maxKeys = 200) {
  const out = { firstUndefinedPath: null, payloadShape: null };
  if (!data || typeof data !== 'object') return out;
  let visited = 0;
  const seen = new WeakSet();
  const shape = {};

  function walk(value, path, depth, shapeNode) {
    if (visited >= maxKeys) return;
    if (value === undefined) {
      if (!out.firstUndefinedPath) out.firstUndefinedPath = path || '<root>';
      return;
    }
    if (value === null) return;
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (depth >= maxDepth) return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (visited >= maxKeys) return;
        visited++;
        const child = value[i];
        const childPath = `${path}[${i}]`;
        if (child === undefined) {
          if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
        } else if (child && typeof child === 'object' && depth < maxDepth - 1) {
          walk(child, childPath, depth + 1, null);
        }
      }
      return;
    }

    for (const k of Object.keys(value)) {
      if (visited >= maxKeys) return;
      visited++;
      const child = value[k];
      const childPath = path ? `${path}.${k}` : k;
      if (depth === 0 && shapeNode) {
        if (child === undefined) shapeNode[k] = 'undefined';
        else if (child === null) shapeNode[k] = 'null';
        else if (Array.isArray(child)) shapeNode[k] = `array[${child.length}]`;
        else if (typeof child === 'object') {
          shapeNode[k] = {};
          for (const k2 of Object.keys(child).slice(0, 12)) {
            const v2 = child[k2];
            if (v2 === undefined) shapeNode[k][k2] = 'undefined';
            else if (v2 === null) shapeNode[k][k2] = 'null';
            else if (Array.isArray(v2)) shapeNode[k][k2] = `array[${v2.length}]`;
            else shapeNode[k][k2] = typeof v2;
          }
        } else {
          shapeNode[k] = typeof child;
        }
      }
      if (child === undefined) {
        if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
      } else if (child && typeof child === 'object') {
        walk(child, childPath, depth + 1, null);
      }
    }
  }

  walk(data, '', 0, shape);
  if (Object.keys(shape).length > 0) out.payloadShape = shape;
  return out;
}

// When a Firebase error is permission-denied, attach a generic action_hint
// that tells the dev WHERE to look — the rules file plus the rejected path.
// Mirrors the existing Firestore-index URL pattern that consumers praised
// as the gold standard. Caller passes the inferred path/queryDescription.
function permissionDeniedActionHint(documentPath, queryPath, queryDescription) {
  const target = documentPath || queryPath || 'the rejected path';
  const desc = queryDescription ? ` (${queryDescription})` : '';
  return `Open firestore.rules and verify a matching match{} block grants the requesting user access to ${target}${desc}. Check the user's auth state and any role/uid fields the rule reads.`;
}

/**
 * Best-effort introspection of a Firestore Query / CollectionReference.
 * Reads the SDK's internal `_query` / `_path` shapes — these are stable in
 * the JS SDK across v9+. Returns an object the caller can spread into the
 * error context. Failures are silent: the calling code falls back to the
 * caller-supplied description.
 *
 * The single biggest investigative win for permission-denied errors is
 * knowing WHICH collection and WHICH filters Firestore rejected. Without
 * this the user has to grep the error message for the calling service file,
 * read the function, and reconstruct the query themselves.
 */
function describeQueryRef(queryRef) {
  if (!queryRef) return null;
  const out = {};
  try {
    // CollectionReference / DocumentReference: has `path`
    if (typeof queryRef.path === 'string') {
      out.queryPath = queryRef.path.slice(0, 200);
    }
    // Query: has `_query.path.canonicalString()` or similar internal shape
    const internal = queryRef._query || queryRef._delegate?._query;
    if (internal) {
      const segments = internal.path?.segments;
      if (Array.isArray(segments)) {
        out.queryPath = segments.join('/').slice(0, 200);
      } else if (typeof internal.path?.canonicalString === 'function') {
        out.queryPath = internal.path.canonicalString().slice(0, 200);
      }
      // Filters: where(field, op, value) tuples are stored as filters[].
      const filters = internal.filters || internal.explicitOrderBy || [];
      if (Array.isArray(filters) && filters.length > 0) {
        out.queryFilters = filters.slice(0, 8).map(f => {
          try {
            const field = f.field?.canonicalString?.() || f.field?.segments?.join('.') || '?';
            const op = f.op?._opStr || f.op || '?';
            // Don't capture filter values — they may carry user data.
            return `${field} ${op} ?`;
          } catch { return '?'; }
        });
      }
    }
  } catch { /* ignore — internal SDK shape isn't guaranteed */ }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Wraps a Firestore operation promise with error tracking.
 * @param {string} operationName - e.g., 'getDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'getDocs'
 * @param {Promise} promise - the Firestore operation promise
 * @param {object} [details] - optional details:
 *   { path: 'collection/docId', data: {...}, queryRef, queryDescription }
 *   - queryRef: the Query/CollectionReference for getDocs/onSnapshot — auto-extracts path+filters
 *   - queryDescription: human-readable fallback when the queryRef can't be introspected
 */
export async function bbFirestoreOp(operationName, promise, details = {}) {
  // Capture the caller's stack BEFORE the await — once the promise resolves
  // we're back on the microtask queue and `new Error().stack` no longer has
  // the app frame that invoked us. Cheap on the success path (string lives
  // on a local until GC); the only cost paid on every call.
  const callerStack = (() => { try { return new Error().stack || ''; } catch { return ''; } })();
  try {
    const result = await promise;
    try {
      blackbox._addBreadcrumb('firebase', {
        action: operationName,
        status: 'success',
        path: details.path || null,
      });
    } catch { /* ignore */ }
    return result;
  } catch (error) {
    try {
      const ctx = {
        code: error.code,
        operation: operationName,
      };
      if (details.path) ctx.documentPath = details.path;
      if (details.queryDescription) ctx.queryDescription = String(details.queryDescription).slice(0, 200);
      if (details.queryRef) {
        const described = describeQueryRef(details.queryRef);
        if (described) Object.assign(ctx, described);
      }
      // Include sanitized write payload for invalid-argument errors
      if (error.code === 'invalid-argument' && details.data) {
        try {
          const keys = Object.keys(details.data);
          const undefinedKeys = keys.filter(k => details.data[k] === undefined);
          ctx.writeFields = keys.slice(0, 20);
          if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
          const summary = summarizePayload(details.data);
          if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
          if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
        } catch { /* ignore */ }
      }
      if (error.code === 'permission-denied') {
        ctx.action_hint = permissionDeniedActionHint(ctx.documentPath, ctx.queryPath, ctx.queryDescription);
      }
      try {
        const frame = extractTopAppFrame(callerStack);
        if (frame) ctx.callerFrame = frame.slice(0, 200);
      } catch { /* ignore */ }
      blackbox._recordError({
        message: `Firestore ${operationName} failed: ${error.message || error.code}`,
        stack: error.stack || '',
        source: 'firebase',
        context: ctx
      });
    } catch { /* ignore */ }
    throw error;
  }
}

export async function bbTrackAuth(auth) {
  try {
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(auth, (user) => {
      try {
        if (user) {
          blackbox._addBreadcrumb('firebase', {
            action: 'auth_state_changed',
            status: 'signed_in',
            uid: user.uid,
            provider: user.providerData?.[0]?.providerId || 'unknown'
          });
        } else {
          blackbox._addBreadcrumb('firebase', {
            action: 'auth_state_changed',
            status: 'signed_out'
          });
        }
      } catch { /* ignore */ }
    });
  } catch (e) {
    console.warn('[BlackBox] bbTrackAuth failed:', e);
  }
}

/**
 * @param {*} queryRef - Firestore Query, CollectionReference, or DocumentReference
 * @param {*} onNext - success callback
 * @param {*} onError - failure callback
 * @param {object} [opts] - { description: 'agency prompts where ownerOnly==false' }
 *   Passed-through description is the fallback when SDK introspection fails.
 */
/**
 * Auto-instrument Firestore write functions so silent permission-denied
 * (and other rejections) become BB errors + breadcrumbs even when the
 * caller doesn't .catch() the promise.
 *
 * The motivating bug: a delete handler called `deleteDoc(ref)` without a
 * .catch. The rule rejected it. The Firestore JS SDK rejects the promise
 * but the caller swallowed it; the snapshot listener re-emitted the row
 * unchanged. From BB's point of view, nothing happened — the user clicked
 * "delete," items came back, no error, no clue. Auto-instrumentation
 * solves it: every write goes through this wrapper, which records the
 * rejection regardless of whether the caller handles it.
 *
 * Usage (replaces direct imports of write fns):
 *
 *   import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
 *   import { bbWrapWrites } from '@artiskon/blackbox';
 *
 *   const wrapped = bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc });
 *   // use wrapped.addDoc / wrapped.deleteDoc throughout the app
 *
 * The wrappers preserve the underlying functions' return values and rethrow
 * errors verbatim — they never alter call shape, only observe.
 */
export function bbWrapWrites(firestoreFns) {
  // Server-side passthrough. The wrapper only emits BB breadcrumbs on the
  // client (the singleton's hooks are never armed on the server), so on
  // SSR the wrapped fns would be no-op-with-overhead. Returning the input
  // object unchanged lets consumers call bbWrapWrites once at module top
  // from a file imported by both client components and route handlers
  // without needing a typeof window guard at the call site.
  if (typeof window === 'undefined') return firestoreFns ?? {};

  const out = {};
  const writeOps = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc'];
  for (const op of writeOps) {
    const original = firestoreFns?.[op];
    if (typeof original !== 'function') continue;
    out[op] = function (refOrQuery, ...args) {
      const path = refOrQuery?.path || refOrQuery?._key?.path?.canonicalString?.() || null;
      // Capture the caller's stack synchronously, BEFORE invoking the SDK.
      // Once we're inside `original(...)` or its returned promise, the stack
      // is the SDK's own; the app frame is gone.
      const callerStack = (() => { try { return new Error().stack || ''; } catch { return ''; } })();
      const callerFrame = (() => { try { return extractTopAppFrame(callerStack).slice(0, 200) || null; } catch { return null; } })();
      // Pre-compute payload summary so the async error handler doesn't need
      // to walk the args from scratch. Cheap; bounded; only meaningful for
      // writes that actually pass data.
      const writeData = (op === 'addDoc' || op === 'setDoc' || op === 'updateDoc') ? args[0] : null;
      let result;
      try {
        result = original(refOrQuery, ...args);
      } catch (syncErr) {
        // Some Firestore variants throw synchronously on bad args.
        try {
          blackbox._addBreadcrumb('firebase', {
            action: op,
            status: 'error',
            path,
            code: syncErr?.code || null,
          });
          const syncCtx = { code: syncErr?.code, operation: op, documentPath: path };
          if (callerFrame) syncCtx.callerFrame = callerFrame;
          if (syncErr?.code === 'invalid-argument' && writeData && typeof writeData === 'object') {
            try {
              const keys = Object.keys(writeData);
              syncCtx.writeFields = keys.slice(0, 20);
              const undefinedKeys = keys.filter(k => writeData[k] === undefined);
              if (undefinedKeys.length > 0) syncCtx.undefinedFields = undefinedKeys;
              const summary = summarizePayload(writeData);
              if (summary.firstUndefinedPath) syncCtx.firstUndefinedPath = summary.firstUndefinedPath;
              if (summary.payloadShape) syncCtx.payloadShape = summary.payloadShape;
            } catch { /* ignore */ }
          }
          blackbox._recordError({
            message: `Firestore ${op} failed (sync): ${syncErr?.message || syncErr?.code || syncErr}`,
            stack: syncErr?.stack || '',
            source: 'firebase',
            context: syncCtx
          });
        } catch { /* ignore */ }
        throw syncErr;
      }
      // Most writes return a Promise. Tap it for rejection without
      // affecting the caller's chain.
      if (result && typeof result.then === 'function') {
        result.then(
          () => {
            try {
              blackbox._addBreadcrumb('firebase', { action: op, status: 'success', path });
            } catch { /* ignore */ }
          },
          (err) => {
            try {
              blackbox._addBreadcrumb('firebase', {
                action: op,
                status: 'error',
                path,
                code: err?.code || null,
              });
              const ctx = {
                code: err?.code,
                operation: op,
                documentPath: path,
              };
              // For invalid-argument, include sanitized field names of the
              // write payload (writes pass data as 2nd arg for setDoc/updateDoc,
              // or no data for deleteDoc).
              if (err?.code === 'invalid-argument' && writeData && typeof writeData === 'object') {
                try {
                  const keys = Object.keys(writeData);
                  ctx.writeFields = keys.slice(0, 20);
                  const undefinedKeys = keys.filter(k => writeData[k] === undefined);
                  if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
                  const summary = summarizePayload(writeData);
                  if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
                  if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
                } catch { /* ignore */ }
              }
              if (err?.code === 'permission-denied') {
                ctx.action_hint = permissionDeniedActionHint(path, null, null);
              }
              if (callerFrame) ctx.callerFrame = callerFrame;
              blackbox._recordError({
                message: `Firestore ${op} failed: ${err?.message || err?.code || err}`,
                stack: err?.stack || '',
                source: 'firebase',
                context: ctx
              });
            } catch { /* ignore */ }
          }
        );
      }
      return result;
    };
  }
  return out;
}

export async function bbOnSnapshot(queryRef, onNext, onError, opts = {}) {
  try {
    const { onSnapshot } = await import('firebase/firestore');
    return onSnapshot(
      queryRef,
      (snapshot) => {
        try {
          blackbox._addBreadcrumb('firebase', {
            action: 'snapshot_received',
            docs: snapshot.size,
            fromCache: snapshot.metadata?.fromCache || false
          });
        } catch { /* ignore */ }
        try { onNext(snapshot); } catch { /* ignore */ }
      },
      (error) => {
        try {
          const ctx = { code: error.code, message: error.message };
          if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
          // describeQueryRef is defined above in this module; re-inline a
          // tiny version here to avoid a circular import.
          try {
            const internal = queryRef?._query || queryRef?._delegate?._query;
            if (internal) {
              const segments = internal.path?.segments;
              if (Array.isArray(segments)) {
                ctx.queryPath = segments.join('/').slice(0, 200);
              }
              const filters = internal.filters;
              if (Array.isArray(filters) && filters.length > 0) {
                ctx.queryFilters = filters.slice(0, 8).map(f => {
                  try {
                    const field = f.field?.canonicalString?.() || f.field?.segments?.join('.') || '?';
                    const op = f.op?._opStr || f.op || '?';
                    return `${field} ${op} ?`;
                  } catch { return '?'; }
                });
              }
            } else if (typeof queryRef?.path === 'string') {
              ctx.queryPath = queryRef.path.slice(0, 200);
            }
          } catch { /* ignore */ }
          if (error.code === 'permission-denied') {
            ctx.action_hint = permissionDeniedActionHint(null, ctx.queryPath, ctx.queryDescription);
          }
          blackbox._recordError({
            message: `Firestore listener error: ${error.message || error.code}`,
            stack: error.stack || '',
            source: 'firebase_listener',
            context: ctx
          });
        } catch { /* ignore */ }
        if (onError) {
          try { onError(error); } catch { /* ignore */ }
        }
      }
    );
  } catch (e) {
    console.warn('[BlackBox] bbOnSnapshot failed:', e);
  }
}
