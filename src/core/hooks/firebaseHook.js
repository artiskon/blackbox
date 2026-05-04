import blackbox from '../blackbox.js';

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
        } catch { /* ignore */ }
      }
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
  const out = {};
  const writeOps = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc'];
  for (const op of writeOps) {
    const original = firestoreFns?.[op];
    if (typeof original !== 'function') continue;
    out[op] = function (refOrQuery, ...args) {
      const path = refOrQuery?.path || refOrQuery?._key?.path?.canonicalString?.() || null;
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
          blackbox._recordError({
            message: `Firestore ${op} failed (sync): ${syncErr?.message || syncErr?.code || syncErr}`,
            stack: syncErr?.stack || '',
            source: 'firebase',
            context: { code: syncErr?.code, operation: op, documentPath: path }
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
              if (err?.code === 'invalid-argument' && (op === 'setDoc' || op === 'updateDoc' || op === 'addDoc')) {
                try {
                  const data = op === 'addDoc' ? args[0] : args[0];
                  if (data && typeof data === 'object') {
                    const keys = Object.keys(data);
                    ctx.writeFields = keys.slice(0, 20);
                    const undefinedKeys = keys.filter(k => data[k] === undefined);
                    if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
                  }
                } catch { /* ignore */ }
              }
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
