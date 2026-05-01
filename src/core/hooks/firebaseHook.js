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
